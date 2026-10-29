import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Readable } from 'node:stream';
import type { UserRole } from '@iconbridge/shared';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../src/auth/auth.constants.js';
import { TurnstileService } from '../../src/auth/turnstile.service.js';
import { Clock } from '../../src/common/clock/clock.js';
import { FieldCipher } from '../../src/common/crypto/field-cipher.js';
import { protectPassportNumber } from '../../src/common/crypto/passport.js';
import { hashPassword } from '../../src/common/crypto/password.js';
import { MailThrottledError } from '../../src/mail/mail-transport.js';
import { MAIL_TRANSPORT } from '../../src/mail/mail.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { StorageService } from '../../src/storage/storage.service.js';
import { databaseName } from './test-database.js';

export const API = '/api/v1';
export const PASSWORD = 'river-lantern-quartz-42';
/** The fake CAPTCHA accepts every token except this one. */
export const BAD_CAPTCHA = 'bad-captcha';

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  /** Public files "uploaded" during the tests: path -> content type and size. */
  files: Map<string, { contentType: string; size: number }>;
  /** Private files (candidate documents) held by the fake storage: path -> content. */
  privateFiles: Map<string, { contentType: string; content: Buffer }>;
  /** The application clock. `set` freezes it at a date; `reset` returns to real time. */
  clock: FakeClock;
  /** Emails "sent" since the last reset, oldest first. */
  outbox: SentEmail[];
  /**
   * Set `down` to true and the fake mail server refuses every message; `delayMs`
   * makes it take that long to accept one; `throttleMs` makes it refuse every message
   * as over quota, asking to wait that long (Azure Communication Services, HTTP 429).
   */
  mailServer: { down: boolean; delayMs: number; throttleMs: number };
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Replaces the Clock provider: real time until a test freezes it. */
export class FakeClock {
  private frozen: Date | null = null;
  now(): Date {
    return this.frozen ? new Date(this.frozen) : new Date();
  }
  set(date: Date): void {
    this.frozen = new Date(date);
  }
  reset(): void {
    this.frozen = null;
  }
}

/** Host of the fake signed links returned for private files. */
export const FAKE_PRIVATE_HOST = 'https://private.example.test';

export interface TestAppOptions {
  /** Extra controllers, used to exercise guards on routes the product does not have yet. */
  controllers?: Type[];
  /** Keep the real rate limiter (off by default so suites can call auth routes freely). */
  throttling?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const outbox: SentEmail[] = [];
  const mailServer = { down: false, delayMs: 0, throttleMs: 0 };
  const files: TestApp['files'] = new Map();
  const privateFiles: TestApp['privateFiles'] = new Map();
  const clock = new FakeClock();
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(MAIL_TRANSPORT)
    .useValue({
      sendMail: async (message: SentEmail) => {
        if (mailServer.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, mailServer.delayMs));
        }
        if (mailServer.throttleMs > 0) {
          return Promise.reject(new MailThrottledError(mailServer.throttleMs));
        }
        if (mailServer.down) {
          return Promise.reject(
            Object.assign(new Error('connect ECONNREFUSED'), { name: 'SmtpDown' }),
          );
        }
        outbox.push(message);
        return Promise.resolve({});
      },
    })
    .overrideProvider(StorageService)
    .useValue({
      publicUrl: (path: string | null) => (path ? `https://media.example.test/${path}` : null),
      uploadPublic: (path: string, content: Buffer, contentType: string) => {
        files.set(path, { contentType, size: content.length });
        return Promise.resolve();
      },
      deletePublic: (path: string) => {
        files.delete(path);
        return Promise.resolve();
      },
      uploadPrivate: (path: string, content: Buffer, contentType: string) => {
        privateFiles.set(path, { contentType, content });
        return Promise.resolve();
      },
      deletePrivate: (path: string) => {
        privateFiles.delete(path);
        return Promise.resolve();
      },
      readPrivate: (path: string) => {
        const file = privateFiles.get(path);
        return file
          ? Promise.resolve(Readable.from(file.content))
          : Promise.reject(new Error('missing blob'));
      },
      privateDownloadUrl: (
        path: string,
        options: { fileName: string; expiresInSeconds?: number; inline?: boolean },
      ) =>
        Promise.resolve(
          `${FAKE_PRIVATE_HOST}/${path}?sp=r&ttl=${options.expiresInSeconds ?? 300}&name=${encodeURIComponent(options.fileName)}${options.inline ? '&inline=1' : ''}`,
        ),
    })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(TurnstileService)
    .useValue({ verify: (token: string) => Promise.resolve(token !== BAD_CAPTCHA) });
  if (!options.throttling) {
    builder = builder.overrideProvider(ThrottlerGuard).useValue({ canActivate: () => true });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  setupApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    outbox,
    mailServer,
    files,
    privateFiles,
    clock,
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/** Empties every table. Refuses to run on a database whose name does not end in "_test". */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  if (!databaseName(process.env['DATABASE_URL'] ?? '').endsWith('_test')) {
    throw new Error('resetDatabase may only run on a test database');
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((table) => `"${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// ---------------------------------------------------------------------------
// Cookies. The auth cookies are Secure, which supertest's own cookie jar does not
// send over plain HTTP, so the tests carry them by hand.
// ---------------------------------------------------------------------------

export interface Cookies {
  access?: string;
  refresh?: string;
}

function setCookieHeaders(response: Response): string[] {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
}

/** Values of the auth cookies set by a response (empty string when the cookie was cleared). */
export function cookiesFrom(response: Response): Cookies {
  const cookies: Cookies = {};
  for (const header of setCookieHeaders(response)) {
    const [pair = ''] = header.split(';');
    const [name, ...value] = pair.split('=');
    if (name === ACCESS_COOKIE) cookies.access = value.join('=');
    if (name === REFRESH_COOKIE) cookies.refresh = value.join('=');
  }
  return cookies;
}

/** Attributes of one Set-Cookie header, lower-cased, e.g. ["httponly", "secure", "samesite=lax"]. */
export function cookieAttributes(response: Response, name: string): string[] {
  const header = setCookieHeaders(response).find((value) => value.startsWith(`${name}=`));
  return (header ?? '')
    .split(';')
    .slice(1)
    .map((part) => part.trim().toLowerCase());
}

export function cookieHeader(cookies: Cookies): string {
  return [
    cookies.access ? `${ACCESS_COOKIE}=${cookies.access}` : null,
    cookies.refresh ? `${REFRESH_COOKIE}=${cookies.refresh}` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
  cookies: Cookies;
  /** Candidate profile id, for candidates. */
  profileId: string | null;
}

let passwordHash: Promise<string> | undefined;

/**
 * Inserts a verified, active user with PASSWORD and signs in through the API. A
 * COUNTRY_AGENT gets `countries` (Morocco by default).
 */
export async function createUser(
  test: TestApp,
  role: UserRole,
  email?: string,
  countries: string[] = ['MA'],
): Promise<TestUser> {
  passwordHash ??= hashPassword(PASSWORD);
  const address =
    email ?? `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}@example.test`;
  const user = await test.prisma.user.create({
    data: {
      email: address,
      passwordHash: await passwordHash,
      role,
      emailVerifiedAt: new Date(),
      assignedCountries: role === 'COUNTRY_AGENT' ? countries : [],
      ...(role === 'CANDIDATE'
        ? { candidateProfile: { create: { firstName: 'Test', lastName: 'Candidate' } } }
        : {}),
    },
    include: { candidateProfile: { select: { id: true } } },
  });
  return {
    id: user.id,
    email: address,
    role,
    cookies: await login(test, address),
    profileId: user.candidateProfile?.id ?? null,
  };
}

export async function login(test: TestApp, email: string, password = PASSWORD): Promise<Cookies> {
  const response = await test
    .http()
    .post(`${API}/auth/login`)
    .send({ email, password })
    .expect(200);
  return cookiesFrom(response);
}

/** Token carried by the link of an email. */
export function tokenFrom(email: SentEmail | undefined): string {
  const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(email?.text ?? '')?.[1];
  if (!token) {
    throw new Error('No token link in the email');
  }
  return token;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
export const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

export interface Catalog {
  destinations: Record<'MALTA' | 'POLAND' | 'CRUISE_SHIP', string>;
  categories: Record<'hospitality' | 'construction' | 'transport', string>;
  /** A user who can own jobs. */
  authorId: string;
}

/** Destinations, categories and an author, inserted directly. */
export async function seedCatalog(test: TestApp): Promise<Catalog> {
  const destination = async (code: string, en: string, sortOrder: number) =>
    (
      await test.prisma.destination.create({
        data: { code, name: { en, fr: en, ar: en }, sortOrder },
      })
    ).id;
  const category = async (slug: string, en: string) =>
    (await test.prisma.jobCategory.create({ data: { slug, name: { en, fr: en, ar: en } } })).id;
  const author = await test.prisma.user.create({
    data: {
      email: `author-${Math.random().toString(36).slice(2, 10)}@example.test`,
      role: 'RECRUITER',
    },
  });
  return {
    destinations: {
      MALTA: await destination('MALTA', 'Malta', 1),
      POLAND: await destination('POLAND', 'Poland', 2),
      CRUISE_SHIP: await destination('CRUISE_SHIP', 'Cruise ship', 3),
    },
    categories: {
      hospitality: await category('hospitality', 'Hospitality'),
      construction: await category('construction', 'Construction'),
      transport: await category('transport', 'Transport'),
    },
    authorId: author.id,
  };
}

export interface JobSeed {
  slug: string;
  title?: string;
  description?: string;
  destination?: keyof Catalog['destinations'];
  category?: keyof Catalog['categories'];
  status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  deadline?: Date;
  positions?: number;
  hiredCount?: number;
  deletedAt?: Date | null;
  featured?: boolean;
  salary?: [min: number, max: number, currency: string];
  languages?: string[];
  publishedAt?: Date;
  employerName?: string;
  showEmployerName?: boolean;
}

/** Inserts a job directly; by default it is published and open. */
export async function insertJob(test: TestApp, catalog: Catalog, seed: JobSeed) {
  const status = seed.status ?? 'PUBLISHED';
  return test.prisma.job.create({
    data: {
      slug: seed.slug,
      title: seed.title ?? seed.slug,
      description: seed.description ?? 'A description long enough for a job offer.',
      destinationId: catalog.destinations[seed.destination ?? 'MALTA'],
      categoryId: catalog.categories[seed.category ?? 'hospitality'],
      status,
      deadline: seed.deadline ?? daysFromNow(30),
      positions: seed.positions ?? 5,
      hiredCount: seed.hiredCount ?? 0,
      deletedAt: seed.deletedAt ?? null,
      featured: seed.featured ?? false,
      salaryMin: seed.salary?.[0] ?? null,
      salaryMax: seed.salary?.[1] ?? null,
      salaryCurrency: seed.salary?.[2] ?? null,
      salaryPeriod: seed.salary ? 'MONTH' : null,
      requiredLanguages: seed.languages ?? [],
      publishedAt: status === 'DRAFT' ? null : (seed.publishedAt ?? daysFromNow(-1)),
      closedAt: status === 'CLOSED' ? new Date() : null,
      employerName: seed.employerName ?? null,
      showEmployerName: seed.showEmployerName ?? false,
      createdById: catalog.authorId,
    },
  });
}

// ---------------------------------------------------------------------------
// Candidates ready to apply
// ---------------------------------------------------------------------------

export interface ReadyCandidate extends TestUser {
  profileId: string;
  cvId: string;
  passportId: string;
}

/**
 * A verified candidate with a complete profile, a CV and a passport scan, so
 * tests about applications start from "may apply".
 */
export async function createReadyCandidate(test: TestApp, email?: string): Promise<ReadyCandidate> {
  const user = await createUser(test, 'CANDIDATE', email);
  const profileId = user.profileId ?? '';
  await test.prisma.candidateProfile.update({
    where: { id: profileId },
    data: {
      gender: 'FEMALE',
      dateOfBirth: new Date('1995-04-12'),
      nationality: 'TN',
      countryOfResidence: 'TN',
      city: 'Tunis',
      phone: '+21612345678',
      ...protectPassportNumber(test.app.get(FieldCipher), 'FAKE1234567'),
      passportIssuingCountry: 'TN',
      passportIssueDate: new Date('2022-01-15'),
      passportExpiryDate: daysFromNow(365 * 5),
      currentProfession: 'Receptionist',
      yearsOfExperience: 4,
      educationLevel: 'BACHELOR',
      gdprConsentAt: new Date(),
      languages: { create: [{ language: 'en', level: 'B2' }] },
    },
  });
  const document = async (type: 'CV' | 'PASSPORT', extension: string, mimeType: string) => {
    const blobPath = `candidates/${profileId}/${type.toLowerCase()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const content = Buffer.from(`${type} of ${user.email}`);
    test.privateFiles.set(blobPath, { contentType: mimeType, content });
    const row = await test.prisma.document.create({
      data: {
        candidateId: profileId,
        type,
        blobPath,
        originalName: `${type.toLowerCase()}.${extension}`,
        mimeType,
        sizeBytes: content.length,
        sha256: 'a'.repeat(64),
      },
    });
    return row.id;
  };
  return {
    ...user,
    profileId,
    cvId: await document('CV', 'pdf', 'application/pdf'),
    passportId: await document('PASSPORT', 'jpg', 'image/jpeg'),
  };
}
