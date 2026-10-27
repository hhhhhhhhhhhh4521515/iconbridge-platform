import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { remember } from './cleanup';
import { adminSession, readyCandidate, rememberApplications } from './support';

/**
 * Screenshots of docs/USER-GUIDE-CANDIDATE.md and docs/USER-GUIDE-ADMIN.md, taken from the
 * local stack with fake data only: the sample jobs of the development seed and a test
 * candidate (e2e-…@example.test) created here and removed at the end of the run.
 *
 *   SCREENSHOTS=1 pnpm --filter @iconbridge/web exec playwright test --project=admin admin-guide-screenshots
 *
 * Skipped in the normal browser suite.
 */
const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'screenshots');
const DESKTOP = { width: 1280, height: 800 };

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Toasts and the animated slider would differ from one run to the next.
  await page.addStyleTag({
    content:
      '[data-sonner-toaster]{display:none!important} *{animation:none!important;transition:none!important}',
  });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

test.describe('user guide screenshots', () => {
  test('candidate and back office screens, fake data only', async ({ browser }) => {
    test.skip(
      process.env.SCREENSHOTS !== '1' || test.info().project.name !== 'admin',
      'run on demand with SCREENSHOTS=1, in the admin project',
    );
    test.setTimeout(300_000);
    mkdirSync(OUT, { recursive: true });

    // ---------------------------------------------------------------- visitor
    const visitorContext = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
    const visitor = await visitorContext.newPage();
    await visitor.goto('/en');
    await shot(visitor, 'candidate-01-home');
    await visitor.goto('/en/jobs');
    await shot(visitor, 'candidate-02-jobs');
    const jobs = (await (
      await visitorContext.request.get('/api/v1/jobs?destination=MALTA')
    ).json()) as {
      items: { id: string; slug: string; title: string; questions: unknown[] }[];
    };
    const job = jobs.items.find((entry) => entry.questions.length === 0);
    if (!job) {
      throw new Error('The development data has no open job in Malta without questions');
    }
    await visitor.goto(`/en/jobs/${job.slug}`);
    await shot(visitor, 'candidate-03-job');
    await visitor.goto('/en/register');
    await shot(visitor, 'candidate-04-register');
    await visitorContext.close();

    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      reducedMotion: 'reduce',
    });
    const phone = await phoneContext.newPage();
    await phone.goto('/en');
    await shot(phone, 'candidate-05-home-phone');
    await phoneContext.close();

    // -------------------------------------------------------------- candidate
    const candidate = await readyCandidate(browser, 'Amira', '-guide');
    const candidatePage = await candidate.context.newPage();
    await candidatePage.setViewportSize(DESKTOP);
    await candidatePage.goto('/en/account/profile');
    await expect(candidatePage.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(candidatePage, 'candidate-06-profile');
    await candidatePage.goto('/en/account/documents');
    await shot(candidatePage, 'candidate-07-documents');
    await candidatePage.goto(`/en/account/apply/${job.slug}`);
    await shot(candidatePage, 'candidate-08-apply');

    const documents = (await (
      await candidate.context.request.get('/api/v1/me/documents')
    ).json()) as {
      id: string;
    }[];
    const applied = await candidate.context.request.post(`/api/v1/jobs/${job.id}/apply`, {
      data: {
        documentIds: documents.map((document) => document.id),
        turnstileToken: 'turnstile-test-key',
      },
    });
    expect(applied.status()).toBe(201);
    const applicationId = ((await applied.json()) as { id: string }).id;
    remember({ kind: 'application', id: applicationId });

    // ------------------------------------------------------------ back office
    const admin = await adminSession(browser, { viewport: DESKTOP, reducedMotion: 'reduce' });
    for (const [status, messageToCandidate] of [
      ['UNDER_REVIEW', null],
      ['SHORTLISTED', 'We would like to arrange an interview next week.'],
    ] as const) {
      const moved = await admin.request.patch(
        `/api/v1/admin/applications/${applicationId}/status`,
        {
          data: { status, ...(messageToCandidate ? { messageToCandidate } : {}) },
        },
      );
      expect(moved.status()).toBe(200);
    }

    await candidatePage.goto('/en/account/applications');
    await shot(candidatePage, 'candidate-09-applications');
    await candidatePage.goto(`/en/account/applications/${applicationId}`);
    await shot(candidatePage, 'candidate-10-application', true);

    const page = await admin.newPage();
    await page.goto('/en/admin');
    await shot(page, 'admin-01-dashboard');
    await page.goto('/en/admin/jobs');
    await shot(page, 'admin-02-jobs');
    await page.goto('/en/admin/jobs/new');
    await shot(page, 'admin-03-job-form');
    await page.goto('/en/admin/applications');
    await page.getByRole('button', { name: 'Board' }).click();
    await shot(page, 'admin-04-applications-board');
    await page.getByRole('button', { name: 'Table' }).click();
    await page.getByRole('searchbox').fill(candidate.email);
    await page.getByRole('button', { name: 'Amira Khelifi', exact: true }).click();
    await expect(page.getByTestId('application-detail')).toBeVisible();
    await shot(page, 'admin-05-application');
    await page.goto('/en/admin/candidates');
    await page.getByRole('searchbox').fill(candidate.email);
    await page.getByRole('link', { name: 'Amira Khelifi' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'admin-06-candidate');
    // Not the success stories or the slides: their photos in the development data are not
    // test images, and this repository is public.
    await page.goto('/en/admin/content/catalog');
    await shot(page, 'admin-07-catalog');
    await page.goto('/en/admin/settings');
    await shot(page, 'admin-08-settings');
    await page.goto('/en/admin/users');
    await shot(page, 'admin-09-users');
    await page.goto('/en/admin/audit');
    await shot(page, 'admin-10-audit');

    await rememberApplications(candidate.context.request);
    await candidate.context.close();
    await admin.close();
  });
});
