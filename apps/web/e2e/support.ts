import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { remember } from './cleanup';

/** Shared by the back-office browser tests: accounts, sign-in and emails read from Mailpit. */

export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const PASSWORD = 'harbour-violet-compass-58';
// Several workers and browsers run at once: the stamp must differ in each of them.
export const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const BRAND = path.join(__dirname, '..', 'public', 'brand');
export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The super admin created by `pnpm db:seed`, read from the local API configuration. */
export function seededAdmin(): { email: string; password: string } {
  const file = readFileSync(path.join(__dirname, '..', '..', 'api', '.env'), 'utf8');
  const read = (name: string) =>
    (new RegExp(`^${name}=(.*)$`, 'm').exec(file)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  return {
    email: process.env.E2E_ADMIN_EMAIL ?? read('SEED_ADMIN_EMAIL'),
    password: process.env.E2E_ADMIN_PASSWORD ?? read('SEED_ADMIN_PASSWORD'),
  };
}

/** Signs in through the API of the site. Sign-ins are rate-limited: a 429 is waited out. */
export async function signIn(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await request.post('/api/v1/auth/login', { data: { email, password } });
    if (response.status() !== 429) {
      expect(response.status(), `sign-in of ${email}`).toBe(200);
      return;
    }
    const wait = Number(response.headers()['retry-after'] ?? '15');
    await new Promise((resolve) => setTimeout(resolve, (Math.min(wait, 60) + 1) * 1000));
  }
  throw new Error(`Could not sign in as ${email}: still rate-limited`);
}

/** The token of the newest email with a link to `page` sent to an address. */
export async function emailToken(
  request: APIRequestContext,
  to: string,
  page: string,
): Promise<string> {
  let token = '';
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:"${to}"` },
        });
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        for (const { ID } of messages) {
          const message = await request.get(`${MAILPIT}/api/v1/message/${ID}`);
          const { Text } = (await message.json()) as { Text: string };
          token = new RegExp(`/${page}\\?token=([\\w-]+)`).exec(Text)?.[1] ?? '';
          if (token) {
            return true;
          }
        }
        return false;
      },
      { message: `an email with a ${page} link for ${to}`, timeout: 20_000 },
    )
    .toBe(true);
  return token;
}

/** A back-office account: invited by the super admin, password chosen with the emailed link. */
export async function inviteStaff(
  browser: Browser,
  role: 'RECRUITER' | 'VIEWER',
  tag = '',
): Promise<{ context: BrowserContext; email: string }> {
  const email = `e2e-${role.toLowerCase()}-${STAMP}${tag}@example.test`;
  const admin = await browser.newContext();
  const credentials = seededAdmin();
  await signIn(admin.request, credentials.email, credentials.password);
  const created = await admin.request.post('/api/v1/admin/users', {
    data: { email, role, locale: 'en' },
  });
  expect(created.status(), `invitation of the ${role}`).toBe(201);
  await admin.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  const token = await emailToken(context.request, email, 'set-password');
  // The page behind the invitation email.
  await page.goto(`/en/set-password?token=${token}`);
  await page.getByLabel(/^New password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Save my password' }).click();
  await expect(page).toHaveURL(/\/en\/login\?reset=done/);
  await page.close();
  await signIn(context.request, email, PASSWORD);
  return { context, email };
}

/** A verified candidate with a complete profile, a CV and a passport scan, made through the API. */
export async function readyCandidate(
  browser: Browser,
  firstName: string,
  tag = '',
): Promise<{ context: BrowserContext; email: string }> {
  const email = `e2e-candidate-${STAMP}${tag}@example.test`;
  const context = await browser.newContext();
  const { request } = context;
  const registered = await request.post('/api/v1/auth/register', {
    data: {
      email,
      password: PASSWORD,
      firstName,
      lastName: 'Khelifi',
      phone: '+21620123456',
      country: 'TN',
      gdprConsent: true,
      turnstileToken: 'turnstile-test-key',
      locale: 'en',
    },
  });
  expect(registered.status()).toBe(201);
  const token = await emailToken(request, email, 'verify-email');
  expect((await request.post('/api/v1/auth/verify-email', { data: { token } })).status()).toBe(204);
  await signIn(request, email, PASSWORD);
  const profile = await request.put('/api/v1/me/profile', {
    data: {
      firstName,
      lastName: 'Khelifi',
      gender: 'FEMALE',
      dateOfBirth: '1995-04-12',
      nationality: 'TN',
      countryOfResidence: 'TN',
      city: 'Tunis',
      phone: '+21620123456',
      whatsapp: null,
      passportNumber: 'X1234567',
      passportIssuingCountry: 'TN',
      passportIssueDate: '2022-01-15',
      passportExpiryDate: '2032-01-14',
      currentProfession: 'Welder',
      yearsOfExperience: 6,
      educationLevel: 'VOCATIONAL',
      languages: [{ language: 'en', level: 'B2' }],
      drivingLicenceCategories: [],
      preferredDestinations: ['MALTA'],
      hasStcwTraining: false,
      hasSeamanBook: false,
      hasMedicalCertificate: false,
      seaExperience: null,
    },
  });
  expect(profile.status()).toBe(200);
  for (const [type, name, mimeType, buffer] of [
    ['CV', 'cv.pdf', 'application/pdf', PDF],
    ['PASSPORT', 'passport.png', 'image/png', PNG],
  ] as const) {
    const uploaded = await request.post('/api/v1/me/documents', {
      multipart: { type, file: { name, mimeType, buffer } },
    });
    expect(uploaded.status(), `upload of ${name}`).toBe(201);
  }
  return { context, email };
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
let adminState: { state: StorageState; at: number } | undefined;

/**
 * A browser context signed in as the seeded super admin, at the size of a desk screen.
 * Sign-ins are rate-limited, so a worker signs in once and its tests share the session
 * for a few minutes: less than the life of an access token, so nobody has to refresh.
 */
export async function adminSession(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const size = { viewport: { width: 1440, height: 900 }, ...options };
  if (adminState && Date.now() - adminState.at < 8 * 60_000) {
    return browser.newContext({ ...size, storageState: adminState.state });
  }
  const context = await browser.newContext(size);
  const credentials = seededAdmin();
  await signIn(context.request, credentials.email, credentials.password);
  adminState = { state: await context.storageState(), at: Date.now() };
  return context;
}

/** A registered candidate with a confirmed address and nothing else. */
export async function verifiedCandidate(
  browser: Browser,
  tag: string,
): Promise<{ context: BrowserContext; email: string }> {
  const email = `e2e-candidate-${STAMP}${tag}@example.test`;
  const context = await browser.newContext();
  const registered = await context.request.post('/api/v1/auth/register', {
    data: {
      email,
      password: PASSWORD,
      firstName: 'Leila',
      lastName: 'Mansour',
      phone: '+21620123456',
      country: 'TN',
      gdprConsent: true,
      turnstileToken: 'turnstile-test-key',
      locale: 'en',
    },
  });
  expect(registered.status()).toBe(201);
  const token = await emailToken(context.request, email, 'verify-email');
  expect(
    (await context.request.post('/api/v1/auth/verify-email', { data: { token } })).status(),
  ).toBe(204);
  await signIn(context.request, email, PASSWORD);
  return { context, email };
}

/** Chooses a date in a field made of three lists (day, month, year). `date` is YYYY-MM-DD. */
export async function pickDate(scope: Page | Locator, label: RegExp, date: string): Promise<void> {
  const [year = '', month = '', day = ''] = date.split('-');
  const group = scope.getByRole('group', { name: label });
  await group.getByLabel('Day').selectOption(String(Number(day)));
  await group.getByLabel('Month').selectOption(String(Number(month)));
  await group.getByLabel('Year').selectOption(year);
}

/**
 * Chooses a country in a country field (a combobox): types `typed`, then picks the
 * option named `name` in the list it shows.
 */
export async function pickCountry(
  page: Page,
  label: RegExp | string,
  typed: string,
  name: string | RegExp,
): Promise<void> {
  const field = page.getByRole('combobox', { name: label });
  await field.fill(typed);
  await page.getByRole('listbox').filter({ visible: true }).getByRole('option', { name }).click();
}

export const toast = (page: Page, text: string | RegExp): Locator =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

/**
 * Writes down the applications of a candidate, so the run removes them at the end:
 * erasing an account keeps its applications as anonymous rows.
 */
export async function rememberApplications(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/me/applications');
  const list = (await response.json()) as { id: string }[] | { items: { id: string }[] };
  for (const application of Array.isArray(list) ? list : list.items) {
    remember({ kind: 'application', id: application.id });
  }
}
