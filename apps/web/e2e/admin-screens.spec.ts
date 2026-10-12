import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { remember } from './cleanup';
import {
  adminSession,
  BRAND,
  emailToken,
  inviteStaff,
  MAILPIT,
  PASSWORD,
  readyCandidate,
  rememberApplications,
  STAMP,
  toast,
} from './support';

/**
 * The screens of the back office that the two long scenarios do not open: home slides,
 * destinations and categories, users, settings, the audit log, the contact inbox, bulk
 * changes, exports, deletions, the "recruiters may delete" switch, the global
 * historical figures, and the applications on a phone.
 *
 * Every test removes what it creates and puts back what it changes; `cleanup.ts`
 * does it again at the end of the run for a test that stopped half-way.
 */

const REASON = 'Browser test: record created for the test';
const tag = () => test.info().project.name;

/** Letters only: codes of destinations accept nothing else. */
const LETTERS = STAMP.toUpperCase().replace(/\d/g, (digit) => 'ABCDEFGHIJ'[Number(digit)] ?? 'X');

async function confirmDeletion(page: Page, button: string | RegExp): Promise<void> {
  const dialog = page.getByTestId('delete-dialog');
  await dialog.getByLabel('Reason').fill(REASON);
  await dialog.getByLabel(/^Type DELETE to confirm/).fill('DELETE');
  await dialog.getByRole('button', { name: button }).click();
}

/** An open job of the development data without questions, to apply to through the API. */
async function openJob(request: APIRequestContext): Promise<{ id: string; title: string }> {
  const jobs = (await (await request.get('/api/v1/jobs?pageSize=50')).json()) as {
    items: { id: string; title: string; slug: string; questions: unknown[] }[];
  };
  const job = jobs.items.find(
    (entry) => entry.questions.length === 0 && entry.slug.startsWith('sample-'),
  );
  if (!job) {
    throw new Error('The development data has no open job without questions');
  }
  return job;
}

/** A ready candidate who has applied to the job; the application is written down for the clean-up. */
async function applicant(
  browser: import('@playwright/test').Browser,
  firstName: string,
  suffix: string,
  jobId: string,
): Promise<{ context: BrowserContext; email: string; firstName: string }> {
  const candidate = await readyCandidate(browser, firstName, `-${suffix}-${tag()}`);
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
  return { ...candidate, firstName };
}

test.describe('back office: the other screens', () => {
  test('home slides: a slide is created, hidden, edited and deleted, and the site follows', async ({
    browser,
  }) => {
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const title = `E2E slide ${STAMP} ${tag()}`;
    const slides = async () =>
      (await (await admin.request.get('/api/v1/admin/home-slides')).json()) as {
        id: string;
        title: { en: string };
        isActive: boolean;
      }[];
    try {
      await page.goto('/en/admin/content/slides');
      await page.getByRole('button', { name: 'New slide' }).click();
      const editor = page.getByTestId('slide-editor');
      await expect(editor.getByRole('button', { name: 'Save' })).toBeDisabled();
      await editor.getByLabel('Title (English)', { exact: true }).fill(title);
      await editor.getByLabel('Title (Français)', { exact: true }).fill(`${title} FR`);
      await editor.getByLabel('Title (العربية)', { exact: true }).fill(`${title} AR`);
      await editor
        .getByLabel('Subtitle (English)', { exact: true })
        .fill('Written by a browser test');
      await editor.getByLabel(/^Button link/).fill('/jobs?destination=MALTA');
      await editor.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page, 'The slide is created.')).toBeVisible();
      const created = (await slides()).find((slide) => slide.title.en === title);
      expect(created).toBeDefined();
      remember({ kind: 'slide', id: created?.id ?? '' });

      const row = page.getByTestId('slide').filter({ hasText: title });
      // A new slide waits, hidden, for its picture: it cannot be shown without one.
      await expect(row).toContainText('Hidden');
      await expect(row).toContainText('No picture');
      await row.getByRole('button', { name: 'Show' }).click();
      await expect(row).toContainText('Hidden');
      await row.locator('input[type="file"]').setInputFiles(path.join(BRAND, 'hero-malta-1.webp'));
      await expect(page.getByTestId('image-cropper')).toBeVisible();
      await page.getByRole('button', { name: 'Use this picture' }).click();
      await expect(toast(page, 'The picture is saved.')).toBeVisible();
      await expect(row.locator('img')).toHaveAttribute('src', /^https?:\/\//);
      await row.getByRole('button', { name: 'Show' }).click();
      await expect(row).toContainText('Shown');

      // The home page follows at once, in both directions.
      const visitor = await browser.newContext();
      const home = await visitor.newPage();
      const onHomePage = async () => {
        await home.goto('/en');
        // The slider draws one slide at a time: the page received the new one with the others.
        return (await home.content()).includes(title) ? 1 : 0;
      };
      await expect.poll(onHomePage, { timeout: 15_000, intervals: [1_000] }).toBeGreaterThan(0);
      await row.getByRole('button', { name: 'Hide' }).click();
      await expect(row).toContainText('Hidden');
      await expect.poll(onHomePage, { timeout: 15_000, intervals: [1_000] }).toBe(0);
      await visitor.close();

      await row.getByRole('button', { name: `Edit the slide: ${title}` }).click();
      await editor.getByLabel('Title (English)', { exact: true }).fill(`${title} edited`);
      await editor.getByRole('button', { name: 'Save' }).click();
      const edited = page.getByTestId('slide').filter({ hasText: `${title} edited` });
      await expect(edited).toBeVisible();

      await edited.getByRole('button', { name: /^Delete/ }).click();
      await expect(page.getByText('Delete this slide?')).toBeVisible();
      await page.getByTestId('confirm-yes').click();
      await expect(toast(page, 'The slide is deleted.')).toBeVisible();
      await expect(page.getByTestId('slide').filter({ hasText: title })).toHaveCount(0);
      expect((await slides()).some((slide) => slide.title.en.startsWith(title))).toBe(false);
    } finally {
      await admin.close();
    }
  });

  test('destinations and categories: an entry is added, renamed and deleted, and the site follows', async ({
    browser,
  }) => {
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const suffix = tag() === 'admin' ? 'A' : tag().slice(0, 1).toUpperCase();
    const code = `EEE${LETTERS}${suffix}`.slice(0, 30);
    const slug = `e2e-${STAMP}-${tag()}`;
    try {
      await page.goto('/en/admin/content/catalog');
      for (const entry of [
        {
          kind: 'destinations',
          key: code,
          keyLabel: /^Code/,
          name: `E2E Island ${code}`,
          api: 'destinations',
        },
        {
          kind: 'categories',
          key: slug,
          keyLabel: /^Short name/,
          name: `E2E Trade ${slug}`,
          api: 'categories',
        },
      ] as const) {
        const section = page.getByTestId(`catalog-${entry.kind}`);
        await section.getByRole('button', { name: 'Add' }).click();
        const editor = page.getByTestId('catalog-editor');
        await editor.getByLabel(entry.keyLabel).fill(entry.key);
        await editor.getByLabel('Name (English)', { exact: true }).fill(entry.name);
        await editor.getByLabel('Name (Français)', { exact: true }).fill(`${entry.name} FR`);
        await editor.getByLabel('Name (العربية)', { exact: true }).fill(`${entry.name} AR`);
        await editor.getByRole('button', { name: 'Save' }).click();
        const row = section.getByRole('listitem').filter({ hasText: entry.name });
        await expect(row).toContainText('No job');
        const list = (await (await admin.request.get(`/api/v1/admin/${entry.api}`)).json()) as {
          id: string;
          name: { en: string };
        }[];
        const created = list.find((item) => item.name.en === entry.name);
        expect(created).toBeDefined();
        remember({
          kind: entry.kind === 'destinations' ? 'destination' : 'category',
          id: created?.id ?? '',
        });

        // The filters of the public job list offer it at once.
        const visitor = await browser.newContext();
        const jobs = await visitor.newPage();
        await expect
          .poll(
            async () => {
              await jobs.goto('/en/jobs');
              return jobs.getByRole('option', { name: entry.name }).count();
            },
            { timeout: 15_000, intervals: [1_000] },
          )
          .toBeGreaterThan(0);
        await visitor.close();

        await row.getByRole('button', { name: `Edit: ${entry.name}` }).click();
        // The code or short name is fixed once created.
        await expect(editor.getByLabel(entry.keyLabel)).toBeDisabled();
        await editor.getByLabel('Name (English)', { exact: true }).fill(`${entry.name} renamed`);
        await editor.getByRole('button', { name: 'Save' }).click();
        const renamed = section.getByRole('listitem').filter({ hasText: `${entry.name} renamed` });
        await expect(renamed).toBeVisible();

        await renamed.getByRole('button', { name: /^Delete/ }).click();
        await expect(page.getByText('Delete this entry?')).toBeVisible();
        await page.getByTestId('confirm-yes').click();
        await expect(toast(page, 'Deleted.')).toBeVisible();
        await expect(section.getByRole('listitem').filter({ hasText: entry.name })).toHaveCount(0);
      }
    } finally {
      await admin.close();
    }
  });

  test('users: invite, change the role, log out everywhere, disable, enable and delete', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const email = `e2e-viewer-${STAMP}-users-${tag()}@example.test`;
    const invited = await browser.newContext();
    const login = (password = PASSWORD) =>
      invited.request.post('/api/v1/auth/login', { data: { email, password } });
    const session = async () =>
      (
        (await (await invited.request.get('/api/v1/auth/session')).json()) as {
          user: { role: string } | null;
        }
      ).user;
    try {
      await page.goto('/en/admin/users');
      await page.getByRole('button', { name: 'Invite a user' }).click();
      const dialog = page.getByRole('dialog', { name: 'Invite a user' });
      await dialog.getByLabel('Email', { exact: true }).fill(email);
      await dialog.getByRole('combobox', { name: 'Role', exact: true }).selectOption('VIEWER');
      await expect(dialog).toContainText('Viewer: reads jobs');
      await dialog.getByRole('button', { name: 'Send the invitation' }).click();
      await expect(toast(page, `An invitation was sent to ${email}.`)).toBeVisible();
      const row = page.getByRole('row').filter({ hasText: email });
      await expect(row).toContainText('Invited');

      await test.step('the invited person chooses a password with the emailed link and gets in', async () => {
        const token = await emailToken(invited.request, email, 'set-password');
        const visitor = await invited.newPage();
        await visitor.goto(`/en/set-password?token=${token}`);
        await expect(
          visitor.getByRole('heading', { level: 1, name: 'Choose your password' }),
        ).toBeVisible();
        await visitor.getByLabel(/^New password/).fill(PASSWORD);
        await visitor.getByRole('button', { name: 'Save my password' }).click();
        await expect(visitor).toHaveURL(/\/en\/login\?reset=done/);
        await visitor.getByLabel(/^Email address/).fill(email);
        await visitor.getByLabel(/^Password/).fill(PASSWORD);
        await visitor.getByRole('button', { name: 'Log in' }).click();
        await expect(visitor).toHaveURL(/\/en\/admin$/);
        await expect(visitor.getByTestId('admin-user')).toHaveText(email);
        // A viewer has no "Users and roles" page.
        await visitor.goto('/en/admin/users');
        await expect(visitor.getByRole('table', { name: 'Users and roles' })).toHaveCount(0);
        await visitor.close();
        expect((await session())?.role).toBe('VIEWER');
      });

      await page.reload();
      await expect(row).toContainText('Active');

      await test.step('role', async () => {
        await row.getByLabel(`Role: ${email}`).selectOption('RECRUITER');
        await expect(page.getByText('Change the role?')).toBeVisible();
        await page.getByTestId('confirm-yes').click();
        await expect(toast(page, 'The role is changed.')).toBeVisible();
        await expect(row.getByLabel(`Role: ${email}`)).toHaveValue('RECRUITER');
        // The new rights apply to the very next request of the person, without logging in again.
        expect((await session())?.role).toBe('RECRUITER');
        expect((await invited.request.get('/api/v1/admin/users')).status()).toBe(403);
        expect(
          (
            await invited.request.post('/api/v1/admin/applications/bulk-status', {
              data: { ids: ['00000000-0000-4000-8000-000000000000'], status: 'UNDER_REVIEW' },
            })
          ).status(),
          'a recruiter may change statuses; a viewer got 403 here',
        ).toBe(200);
      });

      await test.step('log out everywhere', async () => {
        await row.getByRole('button', { name: 'Log out everywhere' }).click();
        await page.getByTestId('confirm-yes').click();
        await expect(toast(page, 'The user is logged out.')).toBeVisible();
        expect((await invited.request.get('/api/v1/admin/stats')).status()).toBe(401);
        expect((await login()).status()).toBe(200);
      });

      await test.step('disable, then enable', async () => {
        await row.getByRole('button', { name: 'Disable' }).click();
        await expect(page.getByText('Disable this account?')).toBeVisible();
        await page.getByTestId('confirm-yes').click();
        await expect(toast(page, 'The account is disabled.')).toBeVisible();
        await expect(row).toContainText('Disabled');
        expect((await invited.request.get('/api/v1/admin/stats')).status()).toBe(401);
        expect((await login()).status()).toBe(401);
        await row.getByRole('button', { name: 'Enable' }).click();
        await expect(toast(page, 'The account is active again.')).toBeVisible();
        expect((await login()).status()).toBe(200);
      });

      await test.step('delete', async () => {
        await row.getByRole('button', { name: `Delete: ${email}` }).click();
        await expect(page.getByText('Delete this account?')).toBeVisible();
        await page.getByTestId('confirm-yes').click();
        await expect(toast(page, 'The account is deleted.')).toBeVisible();
        await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0);
        expect((await invited.request.get('/api/v1/admin/stats')).status()).toBe(401);
        expect((await login()).status()).toBe(401);
        // Nothing of it comes back with the list.
        await page.reload();
        await expect(page.getByRole('table', { name: 'Users and roles' })).toBeVisible();
        await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0);
      });
    } finally {
      await invited.close();
      await admin.close();
    }
  });

  test('settings: a change shows on the site at once, is in the audit log, and is put back', async ({
    browser,
  }) => {
    // One setting, one test at a time: the other browsers would undo each other's change.
    test.skip(tag() !== 'admin', 'changes a setting shared by every browser');
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const before = (await (await admin.request.get('/api/v1/admin/settings')).json()) as Record<
      string,
      unknown
    >;
    const phone = '+356 2100 4477';
    remember({ kind: 'setting', key: 'CONTACT_PHONE', value: before.CONTACT_PHONE });
    try {
      await page.goto('/en/admin/settings');
      const form = page.getByTestId('settings-form');
      const save = form.getByRole('button', { name: 'Save the changes' });
      await expect(save).toBeDisabled();
      // The upload limit of the specification: 5 MB.
      await expect(form.getByLabel(/^Largest upload/)).toHaveValue('5');
      await form.getByLabel(/^Phone/).fill(phone);
      await save.click();
      await expect(toast(page, 'The settings are saved.')).toBeVisible();
      await expect(save).toBeDisabled();

      const visitor = await browser.newContext();
      const contact = await visitor.newPage();
      await expect
        .poll(
          async () => {
            await contact.goto('/en/contact');
            return contact.getByRole('main').getByText(phone).count();
          },
          { timeout: 15_000, intervals: [1_000] },
        )
        .toBeGreaterThan(0);

      await test.step('the audit log shows who changed what, with the value before and after', async () => {
        await page.goto('/en/admin/audit');
        const filters = page.getByTestId('audit-filters');
        await filters.getByLabel('Action').fill('setting.update');
        await filters.getByLabel('Record').selectOption('setting');
        const entry = page.getByRole('row').filter({ hasText: 'setting.update' }).first();
        await expect(entry).toContainText('admin@');
        await entry.getByRole('button').first().click();
        const detail = page.getByTestId('audit-detail');
        await expect(detail).toContainText('Before');
        await expect(detail).toContainText('After');
        await expect(detail).toContainText(phone);
        // A date in the future leaves nothing.
        await page.keyboard.press('Escape');
        const from = filters.getByRole('group', { name: 'From' });
        await from.getByLabel('Day').selectOption('31');
        await from.getByLabel('Month').selectOption('12');
        await from.getByLabel('Year').selectOption(String(new Date().getFullYear()));
        await expect(page.getByText('No entry matches.')).toBeVisible();
      });

      await page.goto('/en/admin/settings');
      await form.getByLabel(/^Phone/).fill(String(before.CONTACT_PHONE ?? ''));
      await save.click();
      await expect(toast(page, 'The settings are saved.')).toBeVisible();
      await expect
        .poll(
          async () => {
            await contact.goto('/en/contact');
            return contact.getByRole('main').getByText(phone).count();
          },
          { timeout: 15_000, intervals: [1_000] },
        )
        .toBe(0);
      await visitor.close();
    } finally {
      await admin.request.put('/api/v1/admin/settings/CONTACT_PHONE', {
        data: { value: before.CONTACT_PHONE },
      });
      await admin.close();
    }
  });

  test('"recruiters may delete": off, a recruiter has no delete button; on, the drawer deletes the application', async ({
    browser,
  }) => {
    test.skip(tag() !== 'admin', 'changes a setting shared by every browser');
    test.setTimeout(240_000);
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const before = (await (await admin.request.get('/api/v1/admin/settings')).json()) as Record<
      string,
      unknown
    >;
    remember({
      kind: 'setting',
      key: 'ALLOW_RECRUITER_DELETE',
      value: before.ALLOW_RECRUITER_DELETE,
    });
    const job = await openJob(admin.request);
    const candidate = await applicant(browser, `Rim${STAMP}`, 'switch', job.id);
    const staff = await inviteStaff(browser, 'RECRUITER', `-switch-${tag()}`);
    const recruiter = await staff.context.newPage();
    const applicationId = (
      (await (await candidate.context.request.get('/api/v1/me/applications')).json()) as {
        id: string;
      }[]
    )[0]?.id;
    const setSwitch = async (on: boolean) => {
      await page.goto('/en/admin/settings');
      const form = page.getByTestId('settings-form');
      const box = form.getByRole('checkbox', { name: /^Recruiters may delete/ });
      if ((await box.isChecked()) !== on) {
        await box.setChecked(on);
        await form.getByRole('button', { name: 'Save the changes' }).click();
        await expect(toast(page, 'The settings are saved.')).toBeVisible();
      }
    };
    const openDrawer = async () => {
      await recruiter.goto('/en/admin/applications');
      await recruiter.getByRole('searchbox').fill(candidate.email);
      await recruiter
        .getByRole('row')
        .filter({ hasText: candidate.email })
        .getByRole('button', { name: `${candidate.firstName} Khelifi`, exact: true })
        .click();
      await expect(recruiter.getByTestId('application-detail')).toBeVisible();
    };
    try {
      await setSwitch(false);
      await openDrawer();
      await expect(recruiter.getByRole('button', { name: /^Delete the application/ })).toHaveCount(
        0,
      );
      const refused = await staff.context.request.delete(
        `/api/v1/admin/applications/${applicationId ?? ''}`,
        { data: { reason: REASON } },
      );
      expect(refused.status()).toBe(403);

      await setSwitch(true);
      await openDrawer();
      await recruiter
        .getByTestId('application-detail')
        .getByRole('button', { name: 'Delete the application' })
        .click();
      await confirmDeletion(recruiter, 'Delete');
      await expect(toast(recruiter, /application.*deleted/i)).toBeVisible();
      await expect(recruiter.getByRole('row').filter({ hasText: candidate.email })).toHaveCount(0);

      // The recruiter may delete the candidate too, from the candidate page.
      await recruiter.goto('/en/admin/candidates');
      await recruiter.getByRole('searchbox').fill(candidate.email);
      await recruiter.getByRole('link', { name: `${candidate.firstName} Khelifi` }).click();
      await recruiter.getByRole('button', { name: 'Delete the candidate' }).click();
      await confirmDeletion(recruiter, 'Delete the candidate');
      await expect(toast(recruiter, 'The candidate is deleted.')).toBeVisible();

      await setSwitch(false);
      await recruiter.goto('/en/admin/candidates');
      await expect(recruiter.getByRole('checkbox', { name: /^Select/ })).toHaveCount(0);
    } finally {
      await admin.request.put('/api/v1/admin/settings/ALLOW_RECRUITER_DELETE', {
        data: { value: before.ALLOW_RECRUITER_DELETE },
      });
      await candidate.context.close();
      await staff.context.close();
      await admin.close();
    }
  });

  test('applications and candidates in bulk: status change, export, deletion', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const job = await openJob(admin.request);
    const group = `bulk${STAMP}`;
    const candidates = [
      await applicant(browser, `Ali${group}`, 'bulk1', job.id),
      await applicant(browser, `Sara${group}`, 'bulk2', job.id),
      await applicant(browser, `Omar${group}`, 'bulk3', job.id),
    ];
    try {
      await page.goto('/en/admin/applications');
      await page.getByRole('searchbox').fill(group);
      const rows = page.getByRole('row').filter({ hasText: group });
      // The search has answered: three results, and they are ours. Nothing else is ever ticked.
      await expect(page.getByTestId('total')).toHaveText('3 results');
      await expect(rows).toHaveCount(3);
      const tickAll = async () => {
        await expect(page.getByTestId('total')).toHaveText('3 results');
        for (const candidate of candidates) {
          await page
            .getByRole('checkbox', { name: `Select ${candidate.firstName} Khelifi` })
            .check();
        }
      };

      await test.step('bulk status change', async () => {
        await tickAll();
        const bar = page.getByTestId('bulk-bar');
        await expect(bar).toContainText('3 applications selected');
        await bar.getByLabel('Change the status to…').selectOption('UNDER_REVIEW');
        await bar.getByRole('button', { name: 'Apply' }).click();
        await expect(toast(page, '3 applications changed.')).toBeVisible();
        await expect(rows.filter({ hasText: 'Under review' })).toHaveCount(3);
        // A step that is not allowed is refused for each of them, and said so.
        await tickAll();
        await expect(bar).toContainText('3 applications selected');
        await bar.getByLabel('Change the status to…').selectOption('VISA_APPROVED');
        await bar.getByRole('button', { name: 'Apply' }).click();
        await expect(toast(page, '0 changed, 3 refused')).toBeVisible();
      });

      await test.step('export of the filtered list, with masked passport numbers', async () => {
        await page.getByRole('button', { name: 'Export' }).click();
        const dialog = page.getByRole('dialog', { name: 'Export applications' });
        await dialog.getByRole('radio', { name: 'CSV (.csv)' }).check();
        await expect(
          dialog.getByRole('checkbox', { name: 'Full passport number' }),
        ).not.toBeChecked();
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          dialog.getByRole('button', { name: 'Download' }).click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/^applications-\d{4}-\d{2}-\d{2}\.csv$/);
        const chunks: Buffer[] = [];
        for await (const chunk of await download.createReadStream()) {
          chunks.push(chunk as Buffer);
        }
        const csv = Buffer.concat(chunks).toString('utf8');
        for (const candidate of candidates) {
          expect(csv).toContain(candidate.email);
        }
        expect(csv).toContain('*****567');
        expect(csv).not.toContain('X1234567');
        expect(csv.trim().split('\n')).toHaveLength(4);
      });

      await test.step('bulk deletion of the applications', async () => {
        await tickAll();
        await expect(page.getByTestId('bulk-bar')).toContainText('3 applications selected');
        await page.getByTestId('bulk-bar').getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByRole('dialog', { name: 'Delete 3 applications?' })).toBeVisible();
        await confirmDeletion(page, 'Delete');
        await expect(toast(page, '3 applications deleted.')).toBeVisible();
        await expect(page.getByRole('row').filter({ hasText: group })).toHaveCount(0);
      });

      await test.step('bulk deletion of the candidates', async () => {
        await page.goto('/en/admin/candidates');
        await page.getByRole('searchbox').fill(group);
        await expect(page.getByTestId('total')).toHaveText('3 results');
        await expect(page.getByRole('row').filter({ hasText: group })).toHaveCount(3);
        await tickAll();
        await expect(page.getByTestId('bulk-bar')).toContainText('3 candidates selected');
        await page.getByTestId('bulk-bar').getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByRole('dialog', { name: 'Delete 3 candidates?' })).toBeVisible();
        const dialog = page.getByTestId('delete-dialog');
        await expect(dialog.getByTestId('delete-removed')).toContainText('3 profiles and accounts');
        await confirmDeletion(page, /^Delete/);
        await expect(page.getByTestId('empty')).toBeVisible();
        for (const candidate of candidates) {
          expect((await candidate.context.request.get('/api/v1/me/profile')).status()).toBe(401);
        }
      });
    } finally {
      for (const candidate of candidates) {
        await candidate.context.close();
      }
      await admin.close();
    }
  });

  test('contact inbox: a message of the site is read, handled, reopened and deleted', async ({
    browser,
  }) => {
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const subject = `E2E question ${STAMP} ${tag()}`;
    const sender = `e2e-visitor-${STAMP}-${tag()}@example.test`;
    const visitor = await browser.newContext();
    try {
      const contact = await visitor.newPage();
      await contact.goto('/en/contact');
      await contact.getByLabel('Full name').fill('Hedi Trabelsi');
      await contact.getByLabel('Email address').fill(sender);
      await contact.getByLabel(/^Subject/).fill(subject);
      await contact.getByLabel('Your message').fill('Do you have jobs for electricians in Malta?');
      await contact.getByRole('button', { name: 'Send the message' }).click();
      await expect(contact.getByRole('status').filter({ hasText: /./ }).first()).toBeVisible();

      const inbox = async () =>
        (
          (await (
            await admin.request.get('/api/v1/admin/contact-messages', {
              params: { q: subject },
            })
          ).json()) as { items: { id: string }[] }
        ).items;
      await expect.poll(async () => (await inbox()).length, { timeout: 10_000 }).toBe(1);
      remember({ kind: 'message', id: (await inbox())[0]?.id ?? '' });

      await page.goto('/en/admin/messages');
      await page.getByRole('searchbox').fill(subject);
      const item = page.getByTestId('messages').getByRole('listitem').filter({ hasText: subject });
      await expect(item).toContainText('To handle');
      await item.getByRole('button').first().click();
      const detail = page.getByTestId('message-detail');
      await expect(detail).toContainText('Do you have jobs for electricians in Malta?');
      await expect(detail.getByRole('link', { name: 'Reply by email' })).toHaveAttribute(
        'href',
        new RegExp(`^mailto:${sender.replace(/[.+]/g, '\\$&')}`),
      );
      await detail.getByRole('button', { name: 'Mark as handled' }).click();
      await expect(toast(page, 'Marked as handled.')).toBeVisible();
      await expect(page.getByTestId('empty')).toBeVisible();

      await page.getByLabel('Show').selectOption('true');
      await expect(item).toContainText('Handled');
      await item.getByRole('button').first().click();
      await detail.getByRole('button', { name: 'Put back to handle' }).click();
      await expect(toast(page, 'Put back among the messages to handle.')).toBeVisible();

      await page.getByLabel('Show').selectOption('');
      await item.getByRole('button').first().click();
      await detail.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('Delete this message?')).toBeVisible();
      await page.getByTestId('confirm-yes').click();
      await expect(toast(page, 'The message is deleted.')).toBeVisible();
      await expect(item).toHaveCount(0);
      expect(await inbox()).toHaveLength(0);
    } finally {
      await visitor.close();
      await admin.close();
    }
  });

  test('global historical figures: partner companies are saved, counted on the site, and put back', async ({
    browser,
  }) => {
    test.skip(tag() !== 'admin', 'changes a figure shared by every browser');
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const figures = async () =>
      (await (await admin.request.get('/api/v1/admin/historical-figures')).json()) as {
        id: string;
        metric: string;
        value: number;
        note: string | null;
      }[];
    const current = (await figures()).find((figure) => figure.metric === 'PARTNER_COMPANIES');
    remember({
      kind: 'figure',
      metric: 'PARTNER_COMPANIES',
      year: null,
      destinationId: null,
      value: current?.value ?? null,
      note: current?.note ?? null,
    });
    const stats = async () =>
      (await (await admin.request.get('/api/v1/stats')).json()) as { partnerCompanies: number };
    const before = await stats();
    const added = (current?.value ?? 0) + 40;
    try {
      await page.goto('/en/admin/settings');
      const section = page.getByTestId('historical-results');
      const save = section.getByRole('button', { name: 'Save the figures' });
      await expect(save).toBeDisabled();
      await section.getByLabel('Partner companies').fill(String(added));
      await save.click();
      await expect(toast(page, '1 figure saved.')).toBeVisible();
      await page.reload();
      await expect(section.getByLabel('Partner companies')).toHaveValue(String(added));
      expect((await stats()).partnerCompanies).toBe(before.partnerCompanies + 40);

      // Back to what it was, through the form when there was a figure.
      if (current) {
        await section.getByLabel('Partner companies').fill(String(current.value));
        await save.click();
        await expect(toast(page, '1 figure saved.')).toBeVisible();
      } else {
        const row = (await figures()).find((figure) => figure.metric === 'PARTNER_COMPANIES');
        await admin.request.delete(`/api/v1/admin/historical-figures/${row?.id ?? ''}`);
      }
      expect((await stats()).partnerCompanies).toBe(before.partnerCompanies);
    } finally {
      await admin.close();
    }
  });

  test('on a phone: the applications list, the detail, a status change and the internal notes', async ({
    browser,
  }) => {
    test.skip(tag() !== 'admin', 'the phone is emulated with Chromium');
    test.setTimeout(180_000);
    const admin = await adminSession(browser, { ...devices['Pixel 7'] });
    const page = await admin.newPage();
    const job = await openJob(admin.request);
    const candidate = await applicant(browser, `Mona${STAMP}`, 'phone', job.id);
    const fits = async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    try {
      await page.goto('/en/admin/applications');
      await page.getByRole('searchbox').fill(candidate.email);
      const card = page
        .getByTestId('application-cards')
        .getByRole('listitem')
        .filter({ hasText: candidate.email });
      await expect(card).toContainText(job.title);
      await expect(card).toContainText('Submitted');
      // Cards instead of the table, and nothing wider than the screen.
      await expect(page.getByRole('table')).toBeHidden();
      expect(await fits()).toBe(true);

      await card.getByRole('button', { name: new RegExp(`^${candidate.firstName}`) }).click();
      const detail = page.getByTestId('application-detail');
      await expect(detail).toBeVisible();
      expect(await fits()).toBe(true);
      await detail.getByLabel(/^Message to the candidate/).fill('We are reading your file.');
      await detail.getByTestId('move-UNDER_REVIEW').click();
      await expect(toast(page, 'Status: Under review.')).toBeVisible();
      await expect(detail.getByTestId('admin-timeline')).toContainText('We are reading your file.');

      const notes = detail.getByTestId('notes');
      await notes.getByLabel('Add a note').fill('Called on Monday');
      await notes.getByRole('button', { name: 'Add a note' }).click();
      await expect(notes.getByRole('listitem')).toContainText('Called on Monday');
      await notes.getByRole('button', { name: 'Edit this note' }).click();
      await notes.getByRole('textbox', { name: 'Edit this note' }).fill('Called on Tuesday');
      await notes.getByRole('button', { name: 'Save the note' }).click();
      await expect(notes.getByRole('listitem')).toContainText('Called on Tuesday');
      await expect(notes).not.toContainText('Called on Monday');
      // Buttons large enough for a thumb.
      const size = await notes.getByRole('button', { name: 'Edit this note' }).boundingBox();
      expect(size?.height ?? 0).toBeGreaterThanOrEqual(44);
      await notes.getByRole('button', { name: 'Delete this note' }).click();
      await expect(notes).toContainText('No note yet.');

      // The candidate sees the message, never the note.
      const timeline = await (
        await candidate.context.request.get('/api/v1/me/applications')
      ).text();
      expect(timeline).not.toContain('Called on');

      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(card).toContainText('Under review');
    } finally {
      await candidate.context.close();
      await admin.close();
    }
  });

  test('job alert of a visitor: confirmed by email, announces a new job, stopped with one click', async ({
    browser,
  }) => {
    test.skip(tag() !== 'admin', 'runs the scheduled task of the API once');
    test.setTimeout(180_000);
    const admin = await adminSession(browser);
    const email = `e2e-alert-${STAMP}@example.test`;
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    const title = `E2E Alert Job ${STAMP}`;
    remember({ kind: 'alert', email });
    try {
      await page.goto('/en');
      const form = page.locator('form').filter({ hasText: 'Create my alert' });
      await form.getByLabel('Email address').fill(email);
      await form.getByLabel('Destination').selectOption({ label: 'Malta' });
      await form.getByRole('button', { name: 'Create my alert' }).click();
      await expect(page.getByText('Check your inbox and confirm your email address')).toBeVisible();

      const token = await emailToken(page.request, email, 'job-alerts/confirm');
      await page.goto(`/en/job-alerts/confirm?token=${token}`);
      await expect(page.getByTestId('job-alert-confirm')).toHaveAttribute('data-state', 'done');
      await expect(page.getByRole('status')).toHaveText('Your job alert is active.');

      // A job is published in Malta after the alert was confirmed.
      const catalog = async (name: string) =>
        (await (await admin.request.get(`/api/v1/admin/${name}`)).json()) as {
          id: string;
          code?: string;
          isActive: boolean;
        }[];
      const malta = (await catalog('destinations')).find((entry) => entry.code === 'MALTA');
      const category = (await catalog('categories')).find((entry) => entry.isActive);
      const created = await admin.request.post('/api/v1/admin/jobs', {
        data: {
          title,
          destinationId: malta?.id,
          categoryId: category?.id,
          description: '<p>Published by a browser test to announce it to a job alert.</p>',
          positions: 1,
          deadline: new Date(Date.now() + 60 * 24 * 3_600_000).toISOString(),
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const job = (await created.json()) as { id: string };
      expect(
        (await admin.request.post(`/api/v1/admin/jobs/${job.id}/publish`)).status(),
      ).toBeLessThan(300);

      // The scheduled task, run now the way the Container Apps Job runs it.
      execFileSync('pnpm', ['--filter', '@iconbridge/api', 'task', 'job-alerts'], {
        cwd: path.join(__dirname, '..', '..', '..'),
        stdio: 'pipe',
      });
      let unsubscribe = '';
      await expect
        .poll(
          async () => {
            const search = await page.request.get(`${MAILPIT}/api/v1/search`, {
              params: { query: `to:"${email}"` },
            });
            const { messages } = (await search.json()) as { messages: { ID: string }[] };
            for (const { ID } of messages) {
              const { Text } = (await (
                await page.request.get(`${MAILPIT}/api/v1/message/${ID}`)
              ).json()) as { Text: string };
              const link = /\/en\/job-alerts\/unsubscribe\?token=[\w-]+/.exec(Text)?.[0];
              if (link && Text.includes(title)) {
                unsubscribe = link;
                return true;
              }
            }
            return false;
          },
          { message: 'an email announcing the job', timeout: 30_000 },
        )
        .toBe(true);

      await page.goto(unsubscribe);
      await expect(page.getByTestId('job-alert-unsubscribe')).toHaveAttribute('data-state', 'done');
      await expect(page.getByRole('status')).toHaveText('Your job alert is stopped.');
      // The link works once.
      await page.reload();
      await expect(page.getByTestId('job-alert-unsubscribe')).toHaveAttribute(
        'data-state',
        'failed',
      );
    } finally {
      await visitor.close();
      await admin.close();
    }
  });
});
