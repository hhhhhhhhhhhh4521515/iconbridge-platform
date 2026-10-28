import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { remember } from './cleanup';
import {
  adminSession,
  MAILPIT,
  PDF,
  pickCountry,
  readyCandidate,
  rememberApplications,
  signIn,
  STAMP,
  toast,
} from './support';

/**
 * Country agents (ADR-024): a candidate belongs to a country by nationality. The super admin
 * creates an agent with his countries and a first password; the agent must choose his own
 * password, then sees and moves only the candidates of his countries.
 *
 * Accounts are named e2e-…@example.test and removed by the clean-up with the candidates
 * and their applications.
 */

const tag = () => test.info().project.name;
const FIRST = 'tangerine-orbit-granite-64';
const OWN = 'saffron-harbor-meadow-29';

/** An open job of the development data without questions. */
async function openJob(page: Page): Promise<string> {
  const jobs = (await (await page.request.get('/api/v1/jobs?pageSize=50')).json()) as {
    items: { id: string; slug: string; questions: unknown[] }[];
  };
  const job = jobs.items.find(
    (entry) => entry.questions.length === 0 && entry.slug.startsWith('sample-'),
  );
  if (!job) {
    throw new Error('The development data has no open job without questions');
  }
  return job.id;
}

/** A ready candidate of a nationality who has applied to the job. */
async function applicant(
  browser: Browser,
  firstName: string,
  nationality: string,
  jobId: string,
): Promise<{ context: BrowserContext; email: string; name: string }> {
  const candidate = await readyCandidate(
    browser,
    firstName,
    `-${nationality.toLowerCase()}-${tag()}`,
    nationality,
  );
  const documents = (await (
    await candidate.context.request.get('/api/v1/me/documents')
  ).json()) as { id: string }[];
  const applied = await candidate.context.request.post(`/api/v1/jobs/${jobId}/apply`, {
    data: {
      documentIds: documents.map((document) => document.id),
      turnstileToken: 'turnstile-test-key',
    },
  });
  expect(applied.status(), `application of ${candidate.email}`).toBe(201);
  await rememberApplications(candidate.context.request);
  return { ...candidate, name: `${firstName} Khelifi` };
}

/** Every candidate the agent's session can list has one of these nationalities. */
async function expectOnlyNationalities(context: BrowserContext, allowed: string[]) {
  const response = await context.request.get('/api/v1/admin/candidates?pageSize=100');
  expect(response.status()).toBe(200);
  const { items } = (await response.json()) as { items: { nationality: string | null }[] };
  expect(items.length).toBeGreaterThan(0);
  expect(items.every((item) => allowed.includes(item.nationality ?? ''))).toBe(true);
}

test.describe('back office: country agents', () => {
  test('a Moroccan agent: first password from the super admin, then only Moroccans, an application moved to Interview with a message', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    const adminPage = await admin.newPage();
    const jobId = await openJob(adminPage);
    const moroccan = await applicant(browser, 'Yassine', 'MA', jobId);
    const tunisian = await applicant(browser, 'Amel', 'TN', jobId);
    const email = `e2e-agent-ma-${STAMP}-${tag()}@example.test`;
    const agent = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await test.step('the super admin creates the agent with Morocco and a first password', async () => {
        await adminPage.goto('/en/admin/users');
        await adminPage.getByRole('button', { name: 'Invite a user' }).click();
        const dialog = adminPage.getByRole('dialog', { name: 'Invite a user' });
        await dialog.getByLabel('Email', { exact: true }).fill(email);
        await dialog.getByRole('combobox', { name: /^Role/ }).selectOption('COUNTRY_AGENT');
        await pickCountry(adminPage, /^Countries/, 'Moro', /Morocco/);
        await expect(dialog.getByRole('button', { name: /Remove Morocco/ })).toBeVisible();
        await dialog.getByLabel('Set the password now').check();
        await dialog.getByLabel(/^New password/).fill(FIRST);
        await dialog.getByRole('button', { name: 'Create the account' }).click();
        await expect(toast(adminPage, /is created/)).toBeVisible();
        const row = adminPage.getByRole('row').filter({ hasText: email });
        await expect(row).toContainText('MA');
        await expect(row).toContainText('Must change password');
      });

      const page = await agent.newPage();
      await test.step('at the first sign-in the agent must choose his own password', async () => {
        await page.goto('/en/login');
        await page.getByLabel(/^Email address/).fill(email);
        await page.getByLabel(/^Password/).fill(FIRST);
        await page.getByRole('button', { name: 'Log in' }).click();
        await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
        // Nothing else is reachable before: no menu, and the API refuses the rest.
        await expect(page.getByRole('navigation', { name: /Back office/ })).toHaveCount(0);
        const refused = await agent.request.get('/api/v1/admin/candidates');
        expect(refused.status()).toBe(403);
        await page.getByLabel(/^Password you were given/).fill(FIRST);
        await page.getByLabel(/^New password/).fill(OWN);
        await page.getByRole('button', { name: 'Change my password' }).click();
        await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
        await expect(page.getByText(/candidates of your countries: Morocco/)).toBeVisible();
      });

      await test.step('the menu shows only what an agent can use', async () => {
        const menu = page.getByRole('navigation', { name: /Back office/ });
        await expect(menu.getByRole('link', { name: 'Applications' })).toBeVisible();
        await expect(menu.getByRole('link', { name: 'Candidates' })).toBeVisible();
        for (const hidden of [
          'Jobs',
          'Messages',
          'Users and roles',
          'Settings',
          'Success stories',
        ]) {
          await expect(menu.getByRole('link', { name: hidden })).toHaveCount(0);
        }
      });

      await test.step('the candidates list holds Moroccan nationals only', async () => {
        await expectOnlyNationalities(agent, ['MA']);
        await page.goto('/en/admin/candidates');
        await page.getByRole('searchbox').fill(moroccan.email);
        await expect(page.getByRole('link', { name: moroccan.name })).toBeVisible();
        await page.getByRole('searchbox').fill(tunisian.email);
        await expect(page.getByRole('link', { name: tunisian.name })).toHaveCount(0);
        await expect(page.getByRole('row').filter({ hasText: tunisian.email })).toHaveCount(0);
      });

      await test.step('he moves the Moroccan application to Interview with a message', async () => {
        await page.goto('/en/admin/applications');
        await page.getByRole('searchbox').fill(moroccan.email);
        await page.getByRole('button', { name: moroccan.name }).click();
        const detail = page.getByTestId('application-detail');
        for (const status of ['UNDER_REVIEW', 'SHORTLISTED'] as const) {
          await detail.getByTestId(`move-${status}`).click();
          await expect(detail.getByTestId('application-status').first()).toHaveAttribute(
            'data-status',
            status,
          );
        }
        await detail.getByLabel(/^Message to the candidate/).fill('Interview on Monday at 10:00.');
        await detail.getByTestId('move-INTERVIEW').click();
        await expect(detail.getByTestId('application-status').first()).toHaveAttribute(
          'data-status',
          'INTERVIEW',
        );
        // No deletion, no story, no cooldown waiver for an agent.
        await expect(detail.getByRole('button', { name: /Delete/ })).toHaveCount(0);
        const timeline = await (
          await moroccan.context.request.get('/api/v1/me/applications')
        ).text();
        expect(timeline).toContain('Interview on Monday at 10:00.');
        await expect
          .poll(async () => {
            const search = await agent.request.get(`${MAILPIT}/api/v1/search`, {
              params: { query: `to:"${moroccan.email}" Interview on Monday` },
            });
            return ((await search.json()) as { messages: unknown[] }).messages.length;
          })
          .toBeGreaterThan(0);
      });

      await test.step('a Tunisian application answers 404 to him', async () => {
        const list = (await (
          await admin.request.get('/api/v1/admin/applications', {
            params: { q: tunisian.email },
          })
        ).json()) as { items: { id: string }[] };
        const tunisianApp = list.items[0]?.id ?? '';
        expect(tunisianApp).not.toBe('');
        expect(
          (await agent.request.get(`/api/v1/admin/applications/${tunisianApp}`)).status(),
        ).toBe(404);
        expect((await agent.request.get('/api/v1/admin/jobs')).status()).toBe(403);
      });
    } finally {
      await agent.close();
      await moroccan.context.close();
      await tunisian.context.close();
      await admin.close();
    }
  });

  test('a success story without a quote is saved, published and shown without a quote block', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const firstName = `Nour${STAMP}${tag().replaceAll('-', '')}`;
    let storyId = '';
    try {
      await page.goto('/en/admin/content/stories');
      await page.getByRole('button', { name: 'New story' }).click();
      const editor = page.getByTestId('story-editor');
      await editor.getByLabel(/^First name/).fill(firstName);
      await editor.getByLabel(/^Job/).fill('Hotel housekeeper');
      await expect(editor.getByText(/Optional\. Leave all three empty/)).toBeVisible();
      await editor.getByRole('button', { name: 'Save' }).click();
      const story = page.getByTestId('story').filter({ hasText: firstName });
      await expect(story).toHaveAttribute('data-published', 'false');
      const stories = (await (await admin.request.get('/api/v1/admin/success-stories')).json()) as {
        id: string;
        firstName: string;
      }[];
      storyId = stories.find((item) => item.firstName === firstName)?.id ?? '';
      expect(storyId).not.toBe('');
      remember({ kind: 'story', id: storyId });
      await story
        .getByTestId('consent-input')
        .setInputFiles({ name: 'consent.pdf', mimeType: 'application/pdf', buffer: PDF });
      await expect(story).toContainText('Consent document on file');
      await story.getByRole('button', { name: 'Publish' }).click();
      await expect(story).toHaveAttribute('data-published', 'true');

      const visitor = await browser.newContext();
      const site = await visitor.newPage();
      await expect
        .poll(
          async () => {
            await site.goto('/en/success-stories');
            return site.getByTestId('story-card').filter({ hasText: firstName }).count();
          },
          { timeout: 15_000, intervals: [1_000] },
        )
        .toBeGreaterThan(0);
      const card = site.getByTestId('story-card').filter({ hasText: firstName }).first();
      await expect(card).toContainText('Hotel housekeeper');
      await expect(card.locator('blockquote')).toHaveCount(0);
      await visitor.close();
    } finally {
      if (storyId) {
        await admin.request.delete(`/api/v1/admin/success-stories/${storyId}`);
      }
      await admin.close();
    }
  });

  test('a Tunisian agent sees only Tunisian nationals', async ({ browser }) => {
    test.setTimeout(150_000);
    const admin = await adminSession(browser);
    const adminPage = await admin.newPage();
    const jobId = await openJob(adminPage);
    const moroccan = await applicant(browser, 'Karim', 'MA', jobId);
    const tunisian = await applicant(browser, 'Ines', 'TN', jobId);
    const email = `e2e-agent-tn-${STAMP}-${tag()}@example.test`;
    const agent = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const created = await admin.request.post('/api/v1/admin/users', {
        data: { email, role: 'COUNTRY_AGENT', countries: ['TN'], password: FIRST, locale: 'en' },
      });
      expect(created.status()).toBe(201);
      await signIn(agent.request, email, FIRST);
      const changed = await agent.request.post('/api/v1/me/password', {
        data: { currentPassword: FIRST, newPassword: OWN },
      });
      expect(changed.status()).toBe(204);

      await expectOnlyNationalities(agent, ['TN']);
      const page = await agent.newPage();
      await page.goto('/en/admin');
      await expect(page.getByText(/candidates of your countries: Tunisia/)).toBeVisible();
      await page.goto('/en/admin/candidates');
      await page.getByRole('searchbox').fill(tunisian.email);
      await expect(page.getByRole('link', { name: tunisian.name })).toBeVisible();
      await page.getByRole('searchbox').fill(moroccan.email);
      await expect(page.getByRole('row').filter({ hasText: moroccan.email })).toHaveCount(0);
      await page.goto('/en/admin/applications');
      await page.getByRole('searchbox').fill(moroccan.email);
      await expect(page.getByRole('button', { name: moroccan.name })).toHaveCount(0);
    } finally {
      await agent.close();
      await moroccan.context.close();
      await tunisian.context.close();
      await admin.close();
    }
  });
});
