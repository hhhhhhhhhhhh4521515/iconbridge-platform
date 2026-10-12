import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BRAND,
  inviteStaff,
  PASSWORD,
  PDF,
  readyCandidate,
  rememberApplications,
  STAMP,
} from './support';

/**
 * The back office, in a real browser against the real stack.
 *
 * 1. A recruiter creates and publishes a job; it appears on the public site; a
 *    candidate applies; the recruiter moves the application to Visa approved and
 *    creates a success story; the story appears on the home page.
 * 2. A viewer sees the data but no button that writes, and the API answers 403
 *    when a write is forced.
 *
 * The recruiter and the viewer are invited by the seeded super admin of
 * `apps/api/.env` and choose their password with the link read from Mailpit.
 */

/** Presses on a card, moves it over a column and releases: a drag with a real mouse. */
async function drag(page: Page, card: Locator, column: Locator): Promise<void> {
  const from = await card.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) {
    throw new Error('Nothing to drag');
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height - 8);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height - 8, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 20 });
  await page.mouse.up();
}

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

test.describe('back office', () => {
  test('recruiter: job, public site, application, visa approved, success story on the home page', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const title = `E2E Welder ${STAMP}`;
    const firstName = `Nour${STAMP}`;
    const question = 'Can you work night shifts?';
    const staff = await inviteStaff(browser, 'RECRUITER');
    const recruiter = await staff.context.newPage();
    let slug = '';

    await test.step('the recruiter sees the dashboard and a menu without the admin pages', async () => {
      await recruiter.goto('/en/admin');
      await expect(recruiter.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      await expect(recruiter.getByTestId('admin-user')).toHaveText(staff.email);
      await expect(recruiter.getByTestId('kpi-open-jobs')).toHaveText(/^\d/);
      await expect(
        recruiter.getByRole('figure').filter({ hasText: 'Applications per month' }),
      ).toBeVisible();
      await expect(
        recruiter.getByRole('figure').filter({ hasText: 'Applications by status' }),
      ).toBeVisible();
      const menu = recruiter.getByRole('navigation', { name: 'Back office' });
      await expect(menu.getByRole('link', { name: 'Success stories' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Users and roles' })).toHaveCount(0);
      await expect(menu.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    });

    await test.step('creates a job with rich text, a question and a cropped cover, then publishes it', async () => {
      await recruiter
        .getByRole('navigation', { name: 'Back office' })
        .getByRole('link', { name: 'Jobs' })
        .click();
      await recruiter.getByRole('link', { name: 'New job' }).click();

      // Saving an empty form shows what is missing instead of calling the API.
      await recruiter.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        recruiter
          .getByRole('alert')
          .filter({ hasText: /required|at least/ })
          .first(),
      ).toBeVisible();

      await recruiter.getByLabel(/^Job title/).fill(title);
      await recruiter.getByLabel(/^Destination/).selectOption({ label: 'Malta' });
      await recruiter.getByLabel(/^Category/).selectOption({ index: 1 });
      const editor = recruiter.getByTestId('editor-description').getByRole('textbox');
      await editor.click();
      await recruiter.keyboard.type('Weld steel frames in a shipyard near Valletta. ');
      const bold = recruiter
        .getByTestId('editor-description')
        .getByRole('button', { name: 'Bold' });
      await bold.click();
      await expect(bold).toHaveAttribute('aria-pressed', 'true');
      await recruiter.keyboard.type('Accommodation is provided.');
      await recruiter.getByLabel(/^Positions/).fill('2');

      await recruiter.getByRole('button', { name: 'Add a question' }).click();
      const added = recruiter.getByTestId('question').first();
      await added.getByLabel('Kind of answer').selectOption('YES_NO');
      await added.getByLabel('Answer required').check();
      await added.getByLabel('Question (English)').fill(question);
      await added.getByLabel('Question (Français)').fill('Pouvez-vous travailler de nuit ?');
      await added.getByLabel('Question (العربية)').fill('هل يمكنك العمل ليلًا؟');

      await recruiter
        .locator('input[type="file"]')
        .setInputFiles(path.join(BRAND, 'hero-malta-1.webp'));
      await expect(recruiter.getByTestId('image-cropper')).toBeVisible();
      await recruiter.getByRole('button', { name: 'Use this picture' }).click();
      await expect(recruiter.getByTestId('cover-image')).toBeVisible();

      await recruiter.getByRole('button', { name: 'Preview' }).click();
      const preview = recruiter.getByTestId('job-preview');
      await expect(preview.getByRole('heading', { name: title })).toBeVisible();
      await expect(preview.locator('strong')).toHaveText('Accommodation is provided.');
      await recruiter.getByRole('button', { name: 'Close the preview' }).click();

      await expect(recruiter.getByTestId('auto-close')).toContainText('leaves the site by itself');
      await recruiter.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(toast(recruiter, 'created as a draft')).toBeVisible();
      await expect(recruiter).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}$/);
      await expect(recruiter.getByTestId('job-status')).toHaveAttribute('data-status', 'DRAFT');
      // The cropped picture was stored by the API and comes back from the storage.
      await expect(recruiter.getByTestId('cover-image')).toHaveAttribute('src', /^https?:\/\//);

      await recruiter.getByRole('button', { name: 'Publish' }).click();
      await expect(recruiter.getByTestId('job-status')).toHaveAttribute('data-status', 'PUBLISHED');

      // The table finds it, with its status and its quick actions.
      await recruiter.goto('/en/admin/jobs');
      await expect(recruiter.getByRole('searchbox')).toBeVisible();
      // "/" puts the cursor in the search box.
      await recruiter.keyboard.press('/');
      await expect(recruiter.getByRole('searchbox')).toBeFocused();
      await recruiter.keyboard.type(title);
      const row = recruiter.getByRole('row').filter({ hasText: title });
      await expect(row.getByTestId('job-status')).toHaveAttribute('data-status', 'PUBLISHED');
      await expect(row.getByRole('button', { name: 'Close' })).toBeVisible();
      const found = await staff.context.request.get('/api/v1/admin/jobs', { params: { q: title } });
      slug = ((await found.json()) as { items: { slug: string }[] }).items[0]?.slug ?? '';
      expect(slug).not.toBe('');
    });

    await test.step('the job appears on the public site', async () => {
      const visitor = await browser.newContext();
      const page = await visitor.newPage();
      await page.goto(`/en/jobs?q=${encodeURIComponent(title)}`);
      await page
        .getByRole('link', { name: new RegExp(title) })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`/en/jobs/${slug}$`));
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.locator('.rich-text strong')).toHaveText('Accommodation is provided.');
      await expect(page.getByTestId('apply-anonymous')).toBeVisible();
      await visitor.close();
    });

    const candidate = await readyCandidate(browser, firstName);
    await test.step('a candidate applies and answers the question of the job', async () => {
      const page = await candidate.context.newPage();
      await page.goto(`/en/jobs/${slug}`);
      await page.getByRole('link', { name: 'Apply now' }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      // The question of the job replaces the two general ones, and it is required.
      await expect(page.getByText(question)).toBeVisible();
      await expect(page.getByLabel('When could you start?')).toHaveCount(0);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'This field is required.' }),
      ).toBeVisible();
      await page.getByRole('radio', { name: 'Yes' }).check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByTestId('apply-review')).toContainText(question);
      await expect(page.getByTestId('apply-review')).toContainText('Yes');
      await page.getByRole('button', { name: 'Send my application' }).click();
      await expect(page.getByTestId('apply-success')).toBeVisible();
      await page.close();
    });

    await test.step('the board refuses a jump and accepts the next step', async () => {
      await recruiter.goto('/en/admin/applications?view=board');
      await recruiter.getByRole('searchbox').fill(candidate.email);
      const card = recruiter.getByTestId('board-card').filter({ hasText: firstName });
      const column = (status: string) =>
        recruiter.locator(`[data-testid="board-column"][data-status="${status}"]`);
      await expect(column('SUBMITTED').getByTestId('board-card')).toHaveCount(1);

      await drag(recruiter, card, column('SHORTLISTED'));
      await expect(toast(recruiter, /cannot go from “Submitted” to “Shortlisted”/)).toBeVisible();
      await expect(column('SUBMITTED').getByTestId('board-card')).toHaveCount(1);

      await drag(recruiter, card, column('UNDER_REVIEW'));
      await expect(toast(recruiter, 'Status: Under review.')).toBeVisible();
      await expect(column('UNDER_REVIEW').getByTestId('board-card')).toHaveCount(1);
      await expect(column('SUBMITTED').getByTestId('board-card')).toHaveCount(0);
    });

    await test.step('the detail shows the snapshot, the answer and a document preview; a change can be undone', async () => {
      await recruiter.goto('/en/admin/applications');
      await recruiter.getByRole('searchbox').fill(candidate.email);
      await recruiter.getByRole('button', { name: `${firstName} Khelifi` }).click();
      const detail = recruiter.getByTestId('application-detail');
      await expect(detail.getByTestId('snapshot')).toContainText('Welder');
      // Masked in the snapshot, whatever the role.
      await expect(detail.getByTestId('snapshot')).toContainText('*****567');
      await expect(detail.getByTestId('snapshot')).not.toContainText('X1234567');
      await expect(detail.getByTestId('answers')).toContainText(question);
      await expect(detail.getByTestId('answers')).toContainText('Yes');

      await detail.getByRole('button', { name: 'Preview: passport.png' }).click();
      await expect(recruiter.getByTestId('document-preview').getByRole('img')).toBeVisible();
      await recruiter.getByRole('button', { name: 'Close' }).last().click();

      await detail.getByLabel(/^Message to the candidate/).fill('We will call you this week.');
      await detail.getByTestId('move-SHORTLISTED').click();
      await expect(detail.getByTestId('application-status').first()).toHaveAttribute(
        'data-status',
        'SHORTLISTED',
      );
      // A mistake: the recruiter takes it back within the 15 minutes.
      await detail.getByRole('button', { name: 'Undo' }).click();
      await expect(detail.getByTestId('application-status').first()).toHaveAttribute(
        'data-status',
        'UNDER_REVIEW',
      );
      await expect(
        detail.getByTestId('admin-timeline').locator('[data-reverted="true"]'),
      ).toHaveCount(1);

      await detail.getByLabel('Add a note').fill('Strong welding portfolio.');
      await detail.getByRole('button', { name: 'Add a note' }).click();
      await expect(detail.getByTestId('notes')).toContainText('Strong welding portfolio.');
    });

    await test.step('moves the application step by step to Visa approved', async () => {
      const detail = recruiter.getByTestId('application-detail');
      for (const status of [
        'SHORTLISTED',
        'INTERVIEW',
        'OFFER',
        'CONTRACT_SIGNED',
        'VISA_PROCESSING',
        'VISA_APPROVED',
      ]) {
        await detail.getByTestId(`move-${status}`).click();
        await expect(detail.getByTestId('application-status').first()).toHaveAttribute(
          'data-status',
          status,
        );
      }
      // Only the next step is offered: Deployed, or a rejection.
      await expect(detail.getByTestId('move-DEPLOYED')).toBeVisible();
      await expect(detail.getByTestId('move-SUBMITTED')).toHaveCount(0);
    });

    await test.step('creates a success story from the application and publishes it', async () => {
      await recruiter.getByRole('button', { name: 'Create a success story' }).click();
      await expect(recruiter).toHaveURL(/\/admin\/content\/stories\?edit=/);
      const editor = recruiter.getByTestId('story-editor');
      await expect(editor.getByLabel(/^First name/)).toHaveValue(firstName);
      await editor
        .getByLabel('What the candidate says (English)')
        .fill('IconBridge guided me until my visa.');
      await editor
        .getByLabel('What the candidate says (Français)')
        .fill("IconBridge m'a accompagnée jusqu'au visa.");
      await editor
        .getByLabel('What the candidate says (العربية)')
        .fill('رافقتني IconBridge حتى التأشيرة.');
      await editor.getByRole('button', { name: 'Save' }).click();

      const story = recruiter.getByTestId('story').filter({ hasText: `${firstName} K.` });
      await expect(story).toHaveAttribute('data-published', 'false');
      // Without the signed consent the API refuses to publish.
      await story.getByRole('button', { name: 'Publish' }).click();
      await expect(toast(recruiter, 'consent document')).toBeVisible();
      await expect(story).toHaveAttribute('data-published', 'false');

      await story
        .locator('input[type="file"]')
        .first()
        .setInputFiles(path.join(BRAND, 'hero-malta-1.webp'));
      await recruiter.getByRole('button', { name: 'Use this picture' }).click();
      await expect(toast(recruiter, 'The photo is saved.')).toBeVisible();
      await story
        .getByTestId('consent-input')
        .setInputFiles({ name: 'consent.pdf', mimeType: 'application/pdf', buffer: PDF });
      await expect(story).toContainText('Consent document on file');
      await story.getByRole('button', { name: 'Publish' }).click();
      await expect(story).toHaveAttribute('data-published', 'true');
    });

    await test.step('the story appears on the home page', async () => {
      const visitor = await browser.newContext();
      const page = await visitor.newPage();
      // Publishing told the site to forget its copy: the story is there at once, not a minute later.
      await expect
        .poll(
          async () => {
            await page.goto('/en');
            return page
              .getByTestId('story-card')
              .filter({ hasText: `${firstName} K.` })
              .count();
          },
          { timeout: 15_000, intervals: [1_000] },
        )
        .toBeGreaterThan(0);
      const card = page
        .getByTestId('story-card')
        .filter({ hasText: `${firstName} K.` })
        .first();
      await expect(card).toContainText(title);
      await expect(card).not.toContainText('Khelifi');
      await visitor.close();
    });

    await test.step('the recruiter can show the passport number; it is logged', async () => {
      await recruiter.goto('/en/admin/candidates');
      await recruiter.getByRole('searchbox').fill(candidate.email);
      await recruiter.getByRole('link', { name: `${firstName} Khelifi` }).click();
      const passport = recruiter.getByTestId('passport-number');
      await expect(passport).toHaveText('*****567');
      await recruiter.getByRole('button', { name: 'Show' }).click();
      await expect(passport).toHaveText('X1234567');
      await expect(recruiter.getByTestId('candidate-applications')).toContainText(title);
    });

    await test.step('clean up: the story and the job leave the site, the candidate erases the account', async () => {
      const api = staff.context.request;
      const stories = (await (await api.get('/api/v1/admin/success-stories')).json()) as {
        id: string;
        firstName: string;
      }[];
      for (const story of stories.filter((entry) => entry.firstName === firstName)) {
        expect((await api.delete(`/api/v1/admin/success-stories/${story.id}`)).status()).toBe(204);
      }
      const jobs = (await (
        await api.get('/api/v1/admin/jobs', { params: { q: title } })
      ).json()) as { items: { id: string }[] };
      for (const job of jobs.items) {
        expect((await api.delete(`/api/v1/admin/jobs/${job.id}`)).status()).toBe(204);
      }
      // The application stays as an anonymous row after the account: the run removes it.
      await rememberApplications(candidate.context.request);
      const erased = await candidate.context.request.delete('/api/v1/me/account', {
        data: { password: PASSWORD },
      });
      expect(erased.status()).toBe(204);
    });

    await candidate.context.close();
    await staff.context.close();
  });

  test('viewer: sees the data, has no button that writes, and the API answers 403 to forced writes', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const staff = await inviteStaff(browser, 'VIEWER');
    const page = await staff.context.newPage();
    const { request } = staff.context;

    await test.step('the menu shows what a viewer may read', async () => {
      await page.goto('/en/admin');
      await expect(page.getByTestId('admin-user')).toHaveText(staff.email);
      await expect(page.getByTestId('kpi-open-jobs')).toHaveText(/^\d/);
      const menu = page.getByRole('navigation', { name: 'Back office' });
      for (const name of ['Jobs', 'Applications', 'Candidates', 'Contact messages']) {
        await expect(menu.getByRole('link', { name })).toBeVisible();
      }
      for (const name of [
        'Success stories',
        'Home slides',
        'Users and roles',
        'Settings',
        'Audit log',
      ]) {
        await expect(menu.getByRole('link', { name })).toHaveCount(0);
      }
    });

    let jobId = '';
    await test.step('jobs: a table without actions', async () => {
      await page.goto('/en/admin/jobs');
      await expect(page.getByRole('table', { name: 'Jobs' }).getByRole('row').nth(1)).toBeVisible();
      await expect(page.getByRole('link', { name: 'New job' })).toHaveCount(0);
      await expect(page.getByTestId('job-actions')).toHaveCount(0);
      const jobs = (await (await request.get('/api/v1/admin/jobs')).json()) as {
        items: { id: string }[];
      };
      jobId = jobs.items[0]?.id ?? '';
      await page.goto(`/en/admin/jobs/${jobId}`);
      await expect(page.getByLabel(/^Job title/)).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
    });

    let applicationId = '';
    let candidateId = '';
    await test.step('applications: no selection, no export, no status button', async () => {
      await page.goto('/en/admin/applications');
      const table = page.getByRole('table', { name: 'Applications' });
      await expect(table.getByRole('row').nth(1)).toBeVisible();
      await expect(table.getByRole('checkbox')).toHaveCount(0);
      await expect(table.getByRole('button', { name: /^Delete the application/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);
      await table.getByRole('row').nth(1).getByRole('button').first().click();
      const detail = page.getByTestId('application-detail');
      await expect(detail.getByTestId('admin-timeline')).toBeVisible();
      await expect(detail.getByTestId('status-actions')).toHaveCount(0);
      await expect(detail.getByRole('button', { name: 'Add a note' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create a success story' })).toHaveCount(0);
      const list = (await (await request.get('/api/v1/admin/applications')).json()) as {
        items: { id: string }[];
      };
      applicationId = list.items[0]?.id ?? '';
      // A candidate who still has an account (erased ones keep anonymous applications only).
      const candidates = (await (await request.get('/api/v1/admin/candidates')).json()) as {
        items: { id: string }[];
      };
      candidateId = candidates.items[0]?.id ?? '';

      // The board can be read, and nothing can be dragged.
      await page.goto('/en/admin/applications?view=board');
      await expect(page.getByTestId('board-column')).toHaveCount(11);
    });

    await test.step('candidates: the passport number stays masked', async () => {
      await page.goto(`/en/admin/candidates/${candidateId}`);
      await expect(page.getByTestId('candidate-profile')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Show' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Disable the account' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Delete the candidate' })).toHaveCount(0);
      const profile = (await (
        await request.get(`/api/v1/admin/candidates/${candidateId}`)
      ).json()) as {
        profile: { passportNumber: string | null };
      };
      expect(profile.profile.passportNumber).toBeNull();
    });

    await test.step('pages of other roles are refused, not just hidden', async () => {
      await page.goto('/en/admin/users');
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    });

    await test.step('forcing a write answers 403', async () => {
      const refused = async (response: Promise<{ status(): number }>, what: string) => {
        expect((await response).status(), what).toBe(403);
      };
      await refused(
        request.post('/api/v1/admin/jobs', { data: { title: 'Forced job' } }),
        'create a job',
      );
      await refused(request.post(`/api/v1/admin/jobs/${jobId}/close`), 'close a job');
      await refused(request.delete(`/api/v1/admin/jobs/${jobId}`), 'delete a job');
      await refused(
        request.patch(`/api/v1/admin/applications/${applicationId}/status`, {
          data: { status: 'REJECTED' },
        }),
        'change a status',
      );
      await refused(
        request.post(`/api/v1/admin/applications/${applicationId}/notes`, { data: { body: 'x' } }),
        'add a note',
      );
      await refused(
        request.post('/api/v1/admin/applications/export', { data: { format: 'csv' } }),
        'export',
      );
      await refused(
        request.post(`/api/v1/admin/candidates/${candidateId}/reveal-passport`),
        'reveal a passport number',
      );
      await refused(
        request.post(`/api/v1/admin/candidates/${candidateId}/disable`),
        'disable a candidate',
      );
      await refused(request.get('/api/v1/admin/success-stories'), 'read the stories manager');
      await refused(request.get('/api/v1/admin/users'), 'list the users');
      await refused(
        request.put('/api/v1/admin/settings/REAPPLY_COOLDOWN_MONTHS', { data: { value: 1 } }),
        'change a setting',
      );
      await refused(request.get('/api/v1/admin/audit-logs'), 'read the audit log');
      await refused(
        request.delete(`/api/v1/admin/applications/${applicationId}`, {
          data: { reason: 'Forced' },
        }),
        'delete an application',
      );
      await refused(
        request.delete(`/api/v1/admin/candidates/${candidateId}`, { data: { reason: 'Forced' } }),
        'delete a candidate',
      );
      await refused(
        request.put('/api/v1/admin/historical-figures', {
          data: { metric: 'PARTNER_COMPANIES', year: null, destinationId: null, value: 999 },
        }),
        'change a historical figure',
      );
    });

    await staff.context.close();
  });

  test('without a real session the back office sends to the login page, and Arabic opens it in English', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    await context.addCookies([
      { name: 'ib_session', value: '1', url: baseURL ?? 'http://localhost:3000' },
    ]);
    const page = await context.newPage();
    // A marker cookie without a session: the page loads its frame, the API says nobody is signed in.
    await page.goto('/en/admin');
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fadmin/);
    await context.close();

    const visitor = await browser.newContext();
    const anonymous = await visitor.newPage();
    await anonymous.goto('/ar/admin/jobs');
    await expect(anonymous).toHaveURL(/\/en\/login\?next=%2Fadmin%2Fjobs/);
    await visitor.close();
  });
});
