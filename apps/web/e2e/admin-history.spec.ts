import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readyCandidate, seededAdmin, signIn, STAMP } from './support';

/**
 * Historical results and deletions, as the super admin:
 *
 * - 250 historical visas for Malta show on the dashboard as "total = historical +
 *   platform", disappear with "Platform only", and reach the counter of the home page;
 * - deleting an application lets the candidate apply again at once;
 * - deleting a candidate removes the files from the storage and keeps the totals.
 */

/** A year nobody uses for real figures in the development data. */
const YEAR = 1999;
const REASON = 'Browser test: record created for the test';

interface Stats {
  platform: { visasApproved: number };
  history: { visasApproved: number };
  applicationsByStatus: Record<string, number>;
}
const stats = async (request: APIRequestContext) =>
  (await (await request.get('/api/v1/admin/stats')).json()) as Stats;
const number = (value: number) => new Intl.NumberFormat('en').format(value);
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

/** Fills the deletion dialog: the button works only with a reason and the word DELETE. */
async function confirmDeletion(page: Page, button: string | RegExp): Promise<void> {
  const dialog = page.getByTestId('delete-dialog');
  const confirm = dialog.getByRole('button', { name: button });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Reason').fill(REASON);
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/^Type DELETE to confirm/).fill('DELETE');
  await confirm.click();
}

test.describe('back office: history and deletions', () => {
  test('historical visas show on the dashboard and the home page; an application and a candidate are deleted', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const credentials = seededAdmin();
    await signIn(admin.request, credentials.email, credentials.password);
    const page = await admin.newPage();

    // Start from a year without figures, whatever an interrupted run left behind.
    const figures = async () =>
      (await (await admin.request.get('/api/v1/admin/historical-figures')).json()) as {
        id: string;
        year: number | null;
      }[];
    const clearYear = async () => {
      for (const figure of (await figures()).filter((entry) => entry.year === YEAR)) {
        await admin.request.delete(`/api/v1/admin/historical-figures/${figure.id}`);
      }
    };
    await clearYear();
    const before = await stats(admin.request);
    const expectedTotal = before.history.visasApproved + 250 + before.platform.visasApproved;

    await test.step('the super admin enters 250 historical visas for Malta', async () => {
      await page.goto('/en/admin/settings');
      const section = page.getByTestId('historical-results');
      await section.getByTestId('history-year').fill(String(YEAR));
      await section.getByTestId('history-MALTA-VISAS_APPROVED').fill('250');
      await section.getByLabel(`Note: Malta, ${String(YEAR)}`).fill('Agency records');
      await section.getByRole('button', { name: 'Save the figures' }).click();
      await expect(toast(page, '1 figure saved')).toBeVisible();
      // Read again from the API: the figure is there, and the button has nothing left to save.
      await expect(section.getByTestId('history-MALTA-VISAS_APPROVED')).toHaveValue('250');
      await expect(section.getByRole('button', { name: 'Save the figures' })).toBeDisabled();
    });

    await test.step('the dashboard shows the total with its split, and the platform alone on demand', async () => {
      await page.goto('/en/admin');
      await expect(page.getByTestId('kpi-visas-total')).toHaveText(number(expectedTotal));
      await expect(page.getByTestId('kpi-visas-total-split')).toHaveText(
        `${number(expectedTotal)} = ${number(before.history.visasApproved + 250)} historical + ${number(before.platform.visasApproved)} platform`,
      );
      const perYear = page.getByRole('figure').filter({ hasText: 'Visas approved per year' });
      await expect(perYear).toContainText('Historical (before the platform)');
      await expect(
        perYear.getByRole('listitem').filter({ hasText: `${String(YEAR)}:` }),
      ).toContainText('Historical (before the platform) 250');
      const perDestination = page
        .getByRole('figure')
        .filter({ hasText: 'Visas approved per destination' });
      await expect(
        perDestination.getByRole('listitem').filter({ hasText: 'MALTA:' }),
      ).toContainText('Historical (before the platform)');

      await page.getByRole('button', { name: 'Platform only' }).click();
      await expect(page.getByTestId('kpi-visas-total')).toHaveText(
        number(before.platform.visasApproved),
      );
      await expect(page.getByTestId('kpi-visas-total-split')).toHaveCount(0);
      await expect(perYear).not.toContainText('Historical (before the platform)');
      await page.getByRole('button', { name: 'Including history' }).click();
      await expect(page.getByTestId('kpi-visas-total')).toHaveText(number(expectedTotal));
    });

    await test.step('the counter of the home page includes the history', async () => {
      // The API answers at once; the home page keeps its data for up to a minute.
      const api = (await (await admin.request.get('/api/v1/stats')).json()) as {
        visasApproved: number;
      };
      expect(api.visasApproved).toBe(expectedTotal);
      const visitor = await browser.newContext();
      const home = await visitor.newPage();
      await expect
        .poll(
          async () => {
            await home.goto('/en');
            return home.getByTestId('counter-visas').getAttribute('data-value');
          },
          { timeout: 150_000, intervals: [5_000] },
        )
        .toBe(String(expectedTotal));
      await visitor.close();
    });

    const firstName = `Sami${STAMP}`;
    const candidate = await readyCandidate(browser, firstName, '-history');
    const jobs = (await (await admin.request.get('/api/v1/jobs?destination=MALTA')).json()) as {
      items: { id: string; title: string; questions: unknown[] }[];
    };
    const job = jobs.items.find((entry) => entry.questions.length === 0);
    if (!job) {
      throw new Error('The development data has no open job in Malta without questions');
    }
    const documents = (await (
      await candidate.context.request.get('/api/v1/me/documents')
    ).json()) as { id: string }[];
    const apply = () =>
      candidate.context.request.post(`/api/v1/jobs/${job.id}/apply`, {
        data: {
          documentIds: documents.map((document) => document.id),
          turnstileToken: 'turnstile-test-key',
        },
      });
    const eligibility = async () =>
      (await (
        await candidate.context.request.get(`/api/v1/jobs/${job.id}/eligibility`)
      ).json()) as { canApply: boolean; reasons: string[] };

    await test.step('deleting an application lifts the waiting period', async () => {
      expect((await apply()).status()).toBe(201);
      expect((await eligibility()).reasons).toContain('REAPPLY_COOLDOWN');

      await page.goto('/en/admin/applications');
      await page.getByRole('searchbox').fill(candidate.email);
      const row = page.getByRole('row').filter({ hasText: candidate.email });
      await row.getByRole('button', { name: /^Delete the application/ }).click();
      const dialog = page.getByTestId('delete-dialog');
      await expect(dialog.getByTestId('delete-removed')).toContainText('status history');
      await expect(dialog.getByTestId('delete-notes')).toContainText(
        'apply to this job again at once',
      );
      await expect(dialog.getByTestId('delete-notes')).toContainText(
        "documents stay in the candidate's profile",
      );
      await confirmDeletion(page, 'Delete');
      await expect(toast(page, '1 application deleted')).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: candidate.email })).toHaveCount(0);

      expect(await eligibility()).toMatchObject({ canApply: true, reasons: [] });
      expect(
        ((await (await candidate.context.request.get('/api/v1/me/documents')).json()) as unknown[])
          .length,
      ).toBe(2);
    });

    await test.step('deleting a candidate removes the files and keeps the totals', async () => {
      // The candidate applies again, so there is an application to keep as an anonymous row.
      expect((await apply()).status()).toBe(201);
      const totalApplications = async () =>
        Object.values((await stats(admin.request)).applicationsByStatus).reduce((a, b) => a + b, 0);
      const applicationsBefore = await totalApplications();
      const visasBefore = (await stats(admin.request)).platform.visasApproved;

      // Signed links to the two files in the private storage: they work now...
      const links: string[] = [];
      for (const document of documents) {
        const redirect = await admin.request.get(`/api/v1/documents/${document.id}/download`, {
          maxRedirects: 0,
        });
        expect(redirect.status()).toBe(302);
        links.push(redirect.headers().location ?? '');
      }
      for (const link of links) {
        expect((await admin.request.get(link)).status(), 'file readable before').toBe(200);
      }

      await page.goto('/en/admin/candidates');
      await page.getByRole('searchbox').fill(candidate.email);
      await page.getByRole('link', { name: `${firstName} Khelifi` }).click();
      await page.getByRole('button', { name: 'Delete the candidate' }).click();
      const removed = page.getByTestId('delete-removed');
      await expect(removed).toContainText('The profile and the account');
      await expect(removed).toContainText('2 documents, removed from storage');
      await expect(removed).toContainText('The personal content of 1 application');
      await expect(page.getByTestId('delete-notes')).toContainText('anonymous rows');
      await confirmDeletion(page, 'Delete the candidate');
      await expect(toast(page, 'The candidate is deleted.')).toBeVisible();
      await expect(page).toHaveURL(/\/en\/admin\/candidates$/);
      await page.getByRole('searchbox').fill(candidate.email);
      await expect(page.getByTestId('empty')).toBeVisible();

      // ...and no longer after: the files have left the storage.
      for (const link of links) {
        expect((await admin.request.get(link)).status(), 'file gone after').toBe(404);
      }
      // The person cannot use the account any more.
      expect((await candidate.context.request.get('/api/v1/me/profile')).status()).toBe(401);

      // The totals of the dashboard did not move.
      expect(await totalApplications()).toBe(applicationsBefore);
      expect((await stats(admin.request)).platform.visasApproved).toBe(visasBefore);

      // The audit log says who, why and how much; not who the candidate was.
      const log = await (
        await admin.request.get('/api/v1/admin/audit-logs?action=candidate.delete&pageSize=5')
      ).text();
      expect(log).toContain(REASON);
      expect(log).toContain('"documents":2');
      expect(log).not.toContain(candidate.email);
      expect(log).not.toContain(firstName);
    });

    await clearYear();
    expect((await stats(admin.request)).history.visasApproved).toBe(before.history.visasApproved);
    await candidate.context.close();
    await admin.close();
  });
});
