import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { adminSession, readyCandidate, rememberApplications, signIn, STAMP } from './support';

/**
 * The nationality filter of the back office: by nationality only, combined with the other
 * filters, kept in the address. A country agent only ever chooses his own countries.
 */

const tag = () => test.info().project.name;
const FIRST = 'cobalt-river-lantern-73';
const OWN = 'amber-summit-harbor-46';

async function openJob(page: Page): Promise<string> {
  const jobs = (await (await page.request.get('/api/v1/jobs?open=true&pageSize=50')).json()) as {
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

async function applicant(
  browser: Browser,
  firstName: string,
  nationality: string,
  jobId: string,
): Promise<{ context: BrowserContext; email: string; name: string }> {
  const project = tag().replace(/[^a-z]/g, '');
  const unique = `${firstName}${project.charAt(0).toUpperCase()}${project.slice(1)}`;
  const candidate = await readyCandidate(
    browser,
    unique,
    `-nat-${nationality.toLowerCase()}-${tag()}`,
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
  return { ...candidate, name: `${unique} Khelifi` };
}

test.describe('back office: nationality filter', () => {
  test('filters applications and candidates by nationality, with the other filters, in the address; an agent keeps his own country', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const jobId = await openJob(page);
    const moroccan = await applicant(browser, 'Driss', 'MA', jobId);
    const tunisian = await applicant(browser, 'Sonia', 'TN', jobId);
    const agentEmail = `e2e-agent-nat-${STAMP}-${tag()}@example.test`;
    const agent = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await test.step('applications: Morocco with the search, kept in the address', async () => {
        await page.goto('/en/admin/applications');
        const filter = page.getByTestId('nationality-filter');
        await expect(filter.locator('option').nth(0)).toHaveText('All nationalities');
        await expect(filter.locator('option').nth(1)).toHaveText('Morocco');
        await expect(filter.locator('option').nth(2)).toHaveText('Tunisia');
        await expect(filter.locator('option').nth(3)).toHaveText('Other (not Morocco/Tunisia)');
        await filter.selectOption('MA');
        await page.getByRole('searchbox').fill(`e2e-candidate-${STAMP}`);
        await expect(page).toHaveURL(/nationality=MA/);
        await expect(page.getByRole('button', { name: moroccan.name, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: tunisian.name, exact: true })).toHaveCount(0);
        await expect(
          page.getByRole('row').filter({ hasText: moroccan.email }).getByText('Morocco'),
        ).toBeVisible();

        await page.reload();
        await expect(page.getByTestId('nationality-filter')).toHaveValue('MA');
        await expect(page.getByRole('button', { name: moroccan.name, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: tunisian.name, exact: true })).toHaveCount(0);

        await page.getByTestId('nationality-filter').selectOption('OTHER');
        await expect(page.getByRole('button', { name: moroccan.name, exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: tunisian.name, exact: true })).toHaveCount(0);
      });

      await test.step('candidates: Tunisia', async () => {
        await page.goto('/en/admin/candidates?nationality=TN');
        await expect(page.getByTestId('nationality-filter')).toHaveValue('TN');
        await page.getByRole('searchbox').fill(`e2e-candidate-${STAMP}`);
        await expect(page.getByRole('link', { name: tunisian.name })).toBeVisible();
        await expect(page.getByRole('link', { name: moroccan.name })).toHaveCount(0);
      });

      await test.step('the Moroccan agent: his country only, whatever the address says', async () => {
        const created = await admin.request.post('/api/v1/admin/users', {
          data: { email: agentEmail, role: 'COUNTRY_AGENT', countries: ['MA'], password: FIRST },
        });
        expect(created.status()).toBe(201);
        await signIn(agent.request, agentEmail, FIRST);
        expect(
          (
            await agent.request.post('/api/v1/me/password', {
              data: { currentPassword: FIRST, newPassword: OWN },
            })
          ).status(),
        ).toBe(204);
        const agentPage = await agent.newPage();
        await agentPage.goto('/en/admin/applications?nationality=TN');
        const filter = agentPage.getByTestId('nationality-filter');
        await expect(filter).toHaveValue('');
        await expect(filter.locator('option')).toHaveText(['All nationalities', 'Morocco']);
        await agentPage.getByRole('searchbox').fill(`e2e-candidate-${STAMP}`);
        await expect(
          agentPage.getByRole('button', { name: moroccan.name, exact: true }),
        ).toBeVisible();
        await expect(
          agentPage.getByRole('button', { name: tunisian.name, exact: true }),
        ).toHaveCount(0);
        // Through the API: another country gives nothing.
        const asked = (await (
          await agent.request.get('/api/v1/admin/candidates?nationality=TN&pageSize=100')
        ).json()) as { total: number };
        expect(asked.total).toBe(0);
      });
    } finally {
      await agent.close();
      await moroccan.context.close();
      await tunisian.context.close();
      await admin.close();
    }
  });
});
