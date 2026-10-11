import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';

/** Shared by the back-office browser tests: accounts, sign-in and emails read from Mailpit. */

export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const PASSWORD = 'harbour-violet-compass-58';
export const STAMP = Date.now().toString(36);
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
