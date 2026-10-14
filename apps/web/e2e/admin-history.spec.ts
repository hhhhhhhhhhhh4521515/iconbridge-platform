import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { remember } from './cleanup';
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
    // The figures of the dashboard are shared: the same test in another browser at the
    // same moment would add its own 250 visas to the totals this one reads.
    test.skip(test.info().project.name !== 'admin', 'changes figures shared by every browser');
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
    // Whatever happens below, the figure of the test year is removed at the end of the run.
    const destinations = (await (await admin.request.get('/api/v1/admin/destinations')).json()) as {
      id: string;
      code: string;
    }[];
    remember({
      kind: 'figure',
      metric: 'VISAS_APPROVED',
      year: YEAR,
      destinationId: destinations.find((entry) => entry.code === 'MALTA')?.id ?? null,
      value: null,
      note: null,
    });
    const before = await stats(admin.request);
    const historical = before.history.visasApproved + 250;
    // Other tests run at the same time and one of them gets a visa approved: the
    // platform figure is read again each time it is needed, never remembered.
    const platformNow = async () => (await stats(admin.request)).platform.visasApproved;

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
      expect((await stats(admin.request)).history.visasApproved).toBe(historical);
      await expect(async () => {
        const platform = await platformNow();
        await page.goto('/en/admin');
        await expect(page.getByTestId('kpi-visas-total')).toHaveText(number(historical + platform));
        await expect(page.getByTestId('kpi-visas-total-split')).toHaveText(
          `${number(historical + platform)} = ${number(historical)} historical + ${number(platform)} platform`,
        );
      }).toPass({ timeout: 30_000 });
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
      // Exactly the historical part less than before.
      const withoutHistory = async () =>
        Number((await page.getByTestId('kpi-visas-total').textContent())?.replace(/\D/g, ''));
      await expect(page.getByTestId('kpi-visas-total-split')).toHaveCount(0);
      await expect(perYear).not.toContainText('Historical (before the platform)');
      const platformShown = await withoutHistory();
      expect(platformShown).toBeGreaterThanOrEqual(before.platform.visasApproved);
      await page.getByRole('button', { name: 'Including history' }).click();
      await expect(page.getByTestId('kpi-visas-total')).toHaveText(
        number(historical + platformShown),
      );
    });

    await test.step('the counter of the home page includes the history', async () => {
      // Saving the figure told the site to forget its copy: the home page follows at once.
      const publicVisas = async () =>
        (
          (await (await admin.request.get('/api/v1/stats')).json()) as {
            visasApproved: number;
          }
        ).visasApproved;
      expect(await publicVisas()).toBe(historical + (await platformNow()));
      const visitor = await browser.newContext();
      const home = await visitor.newPage();
      await expect(async () => {
        const expected = await publicVisas();
        await home.goto('/en');
        await expect(home.getByTestId('counter-visas')).toHaveAttribute(
          'data-value',
          String(expected),
        );
        expect(expected).toBeGreaterThanOrEqual(historical);
      }).toPass({ timeout: 15_000 });
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
      const applied = await apply();
      expect(applied.status()).toBe(201);
      const applicationId = ((await applied.json()) as { id: string }).id;
      remember({ kind: 'application', id: applicationId });

      // Signed links to the two files in the private storage: they work now...
      const links: string[] = [];
      for (const document of documents) {
        const redirect = await admin.request.get(`/api/v1/documents/${document.id}/download`, {
          maxRedirects: 0,
        });
        expect(redirect.status()).toBe(302);
        // With docker-compose.prod.yml the storage is signed as azurite.localhost, a name
        // browsers resolve by themselves and Node does not; the signature does not cover the host.
        links.push(
          (redirect.headers().location ?? '').replace('//azurite.localhost:', '//localhost:'),
        );
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

      // The totals of the dashboard do not move: the application is still counted, as a
      // withdrawn row that names nobody.
      const kept = (await (
        await admin.request.get(`/api/v1/admin/applications/${applicationId}`)
      ).json()) as { status: string; candidate: { firstName: string; email: string } };
      expect(kept.status).toBe('WITHDRAWN');
      expect(kept.candidate.firstName).toBe('Deleted');
      expect(JSON.stringify(kept)).not.toContain(firstName);

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
