import { expect, test, type APIRequestContext } from '@playwright/test';
import { PDF } from './support';

/**
 * The production site after a deployment, with a dedicated test candidate
 * (PROD_E2E_EMAIL, PROD_E2E_PASSWORD; never a real candidate). Run with
 * playwright.production.config.ts.
 *
 * - public pages in the three languages, health of both apps;
 * - the test candidate signs in and opens the account pages;
 * - it uploads one test document, reads it through its 5-minute link (Blob Storage with
 *   the managed identity) and deletes it: the only data created, removed in the test;
 * - the public figures (jobs, success stories, counters with the historical figures) are
 *   the same before and after: real data is untouched.
 *
 * It sends no email (signing in sends none) and never applies to a job.
 */
const EMAIL = process.env.PROD_E2E_EMAIL ?? '';
const PASSWORD = process.env.PROD_E2E_PASSWORD ?? '';

interface Figures {
  jobs: number;
  stories: number;
  stats: unknown;
}

async function figures(request: APIRequestContext): Promise<Figures> {
  const jobs = (await (await request.get('/api/v1/jobs?pageSize=1')).json()) as { total: number };
  const stories = (await (await request.get('/api/v1/success-stories')).json()) as unknown[];
  const stats: unknown = await (await request.get('/api/v1/stats')).json();
  return { jobs: jobs.total, stories: stories.length, stats };
}

test('production: public pages, test candidate, nothing real changed', async ({
  page,
  request,
}) => {
  expect(EMAIL, 'PROD_E2E_EMAIL').toMatch(/(^e2e-prod-.*@example\.test$)|(\+e2e@)/);
  expect(PASSWORD, 'PROD_E2E_PASSWORD').not.toBe('');

  await test.step('both apps answer, with the same version', async () => {
    await expect(async () => {
      const response = await request.get('/api/health/ready', { timeout: 100_000 });
      const body = (await response.json()) as { status: string; version: string; api?: string };
      expect(body.status).toBe('ok');
      expect(body.api).toBe(body.version);
    }).toPass({ timeout: 170_000 });
  });

  const before = await figures(request);
  expect(before.jobs).toBeGreaterThan(0);

  await test.step('public pages in English, French and Arabic', async () => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.goto('/en/jobs');
    await expect(page.getByRole('heading', { name: 'Open jobs' })).toBeVisible();
    const jobs = (await (await request.get('/api/v1/jobs?pageSize=1')).json()) as {
      items: { slug: string; title: string }[];
    };
    const [first] = jobs.items;
    if (first) {
      await page.goto(`/en/jobs/${first.slug}`);
      await expect(page.getByRole('heading', { name: first.title })).toBeVisible();
    }
    await page.goto('/fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.goto('/en/success-stories');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await test.step('the test candidate signs in and opens the account pages', async () => {
    await page.goto('/en/login');
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/en\/account$/, { timeout: 60_000 });
    for (const [path, heading] of [
      ['/en/account/profile', 'My profile'],
      ['/en/account/documents', 'My documents'],
      ['/en/account/applications', 'My applications'],
      ['/en/account/settings', 'Settings'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
  });

  await test.step('a test document goes to private storage, opens by its link, and is deleted', async () => {
    const api = page.request;
    const uploaded = await api.post('/api/v1/me/documents', {
      multipart: {
        type: 'OTHER',
        file: { name: 'e2e-prod-check.pdf', mimeType: 'application/pdf', buffer: PDF },
      },
    });
    expect(uploaded.status(), 'upload').toBe(201);
    const { id } = (await uploaded.json()) as { id: string };
    try {
      const link = await api.get(`/api/v1/documents/${id}/download`, { maxRedirects: 0 });
      expect(link.status(), 'signed link').toBe(302);
      const location = link.headers().location ?? '';
      expect(location).toContain('.blob.core.windows.net/');
      expect(location).toContain('sig=');
      const file = await request.get(location);
      expect(file.status(), 'file through the link').toBe(200);
      expect((await file.body()).subarray(0, 4).toString()).toBe('%PDF');
    } finally {
      expect((await api.delete(`/api/v1/me/documents/${id}`)).status(), 'delete').toBe(204);
    }
    const left = (await (await api.get('/api/v1/me/documents')).json()) as { id: string }[];
    expect(left.map((document) => document.id)).not.toContain(id);
  });

  await test.step('real jobs, success stories and figures are untouched', async () => {
    expect(await figures(request)).toEqual(before);
  });
});
