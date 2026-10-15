import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { pickCountry, pickDate, rememberApplications } from './support';

/**
 * The whole road of a candidate, in a real browser against the real stack:
 * register -> verify the email (link read from Mailpit) -> complete the profile ->
 * upload a CV and a passport -> apply -> follow the application -> a second
 * application to the same job is blocked until the date the API gives.
 *
 * Needs, besides the stack of the other browser tests, Mailpit on port 8025.
 */

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const PASSWORD = 'harbour-violet-compass-58';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
/** A real 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The link of the newest email sent to an address, read from the Mailpit API. */
async function emailLink(request: APIRequestContext, to: string, path: string): Promise<string> {
  let link: string | undefined;
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
          link = new RegExp(`https?://\\S+/${path}\\?token=[\\w-]+`).exec(Text)?.[0];
          if (link) {
            return true;
          }
        }
        return false;
      },
      { message: `an email with a ${path} link for ${to}`, timeout: 20_000 },
    )
    .toBe(true);
  return link ?? '';
}

const saveAndContinue = (page: Page) =>
  page.getByRole('button', { name: 'Save and continue' }).click();

test.describe('candidate area', () => {
  test('visitors are sent to the login page, which remembers where they were going', async ({
    page,
  }) => {
    await page.goto('/en/account/documents');
    await expect(page).toHaveURL(/\/en\/login\?next=%2Faccount%2Fdocuments$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  });

  test('the registration form explains what is wrong, field by field', async ({ page }) => {
    await page.goto('/en/register');
    await page.getByRole('button', { name: 'Create my account' }).click();
    const firstName = page.getByLabel(/^First name/);
    await expect(firstName).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('alert').filter({ hasText: 'This field is required.' }),
    ).not.toHaveCount(0);

    await page.getByLabel(/^Password/).fill('password');
    await expect(page.getByTestId('password-strength')).toHaveAttribute('data-score', '0');
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await expect(page.getByTestId('password-strength')).toHaveAttribute('data-score', /[34]/);
    await expect(
      page.getByRole('main').getByRole('link', { name: 'privacy policy' }),
    ).toHaveAttribute('href', '/en/privacy');
  });

  test('register, verify the email, complete the profile, upload, apply, then wait to apply again', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const email = `e2e-${testInfo.project.name}-${Date.now().toString(36)}@example.test`;

    await test.step('register', async () => {
      await page.goto('/en/register');
      await page.getByLabel(/^First name/).fill('Amira');
      await page.getByLabel(/^Last name/).fill('Ben Salah');
      await page.getByLabel(/^Email address/).fill(email);
      await pickCountry(page, /^Country of residence/, 'tun', 'Tunisia');
      await expect(page.getByTestId('phone-country')).toHaveValue('TN');
      await page.locator('input[name="phone"]').fill('20 123 456');
      await page.getByLabel(/^Password/).fill(PASSWORD);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Create my account' }).click();
      await expect(page.getByTestId('check-inbox')).toContainText(email);
    });

    await test.step('verify the email with the link from Mailpit', async () => {
      const link = await emailLink(request, email, 'verify-email');
      expect(new URL(link).pathname).toBe('/en/verify-email');
      await page.goto(link);
      await expect(page.getByTestId('email-verified')).toBeVisible();
    });

    await test.step('log in', async () => {
      await page.getByRole('main').getByRole('link', { name: 'Log in' }).click();
      await page.getByLabel(/^Email address/).fill(email);
      await page.getByLabel(/^Password/).fill(PASSWORD);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL(/\/en\/account$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Hello Amira' })).toBeVisible();
      await expect(page.getByTestId('verify-banner')).toHaveCount(0);
      await expect(page.getByTestId('completeness')).not.toHaveText('100%');
      await expect(page.getByTestId('missing-items')).toContainText('Passport number');
    });

    await test.step('complete the profile, one saved step after the other', async () => {
      await page.getByRole('link', { name: 'Complete my profile' }).click();
      await expect(page).toHaveURL(/\/account\/profile\?step=identity/);
      // What was given at registration is already there.
      await expect(page.getByLabel(/^First name/)).toHaveValue('Amira');
      await expect(page.getByRole('combobox', { name: /^Country of residence/ })).toHaveValue(
        'Tunisia',
      );
      await expect(page.locator('input[name="phone"]')).toHaveValue('20123456');
      await page.getByLabel(/^Gender/).selectOption('FEMALE');
      // Too young: the rule of packages/shared answers in the page language.
      await pickDate(page, /^Date of birth/, '2015-01-01');
      await saveAndContinue(page);
      await expect(page.getByText('You must be at least 18 years old.').last()).toBeVisible();
      await pickDate(page, /^Date of birth/, '1995-04-12');
      await pickCountry(page, /^Nationality/, 'tun', 'Tunisia');
      await page.getByLabel(/^City/).fill('Tunis');
      await page.getByRole('checkbox', { name: 'Malta' }).check();
      await saveAndContinue(page);

      await expect(page).toHaveURL(/step=passport/);
      await page.getByLabel(/^Passport number/).fill('x1234567');
      await pickCountry(page, /^Issued by/, 'TN', 'Tunisia');
      await pickDate(page, /^Issue date/, '2022-01-15');
      await pickDate(page, /^Expiry date/, '2032-01-14');
      await saveAndContinue(page);

      await expect(page).toHaveURL(/step=experience/);
      await page.getByLabel(/^Current or last profession/).fill('Receptionist');
      await page.getByLabel(/^Years of experience/).fill('4');
      await page.getByLabel(/^Highest level of education/).selectOption('BACHELOR');
      await saveAndContinue(page);

      await expect(page).toHaveURL(/step=languages/);
      await page.getByRole('button', { name: 'Add a language' }).click();
      const row = page.getByTestId('language-row').first();
      await row.getByLabel(/^Language/).selectOption('en');
      await row.getByLabel(/^Level/).selectOption('B2');
      await saveAndContinue(page);

      await expect(page).toHaveURL(/step=licence/);
      await page.getByRole('checkbox', { name: 'B', exact: true }).check();
      await saveAndContinue(page);
      // No cruise-ship step: the candidate did not choose cruise ships.
      await expect(page).toHaveURL(/step=documents/);
      await expect(page.getByRole('link', { name: /Cruise ships/ })).toHaveCount(0);
    });

    await test.step('upload a CV and a passport scan', async () => {
      await expect(page.getByTestId('no-documents')).toBeVisible();
      const file = page.locator('input[type="file"]');
      // Refused in the browser, before anything is sent: a picture is not a CV.
      await file.setInputFiles({ name: 'cv.png', mimeType: 'image/png', buffer: PNG });
      await expect(
        page.getByRole('alert').filter({ hasText: 'cv.png is not accepted here' }),
      ).toBeVisible();

      await file.setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF });
      await expect(page.getByTestId('upload-done')).toContainText('cv.pdf');
      await page.getByLabel('Type of document').selectOption('PASSPORT');
      await file.setInputFiles({ name: 'passport.png', mimeType: 'image/png', buffer: PNG });
      await expect(page.getByTestId('upload-done')).toContainText('passport.png');
      await expect(page.getByTestId('documents').getByRole('listitem')).toHaveCount(2);

      await page.getByRole('button', { name: 'Preview: passport.png' }).click();
      await expect(page.getByTestId('document-preview').getByRole('img')).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).click();

      await page.getByRole('link', { name: 'Finish' }).click();
      await expect(page.getByTestId('completeness')).toHaveText('100%');
    });

    let jobTitle = '';
    let jobPath = '';
    await test.step('apply to a job', async () => {
      // A job of the destination chosen in the profile is recommended on the dashboard.
      const recommended = page.getByTestId('recommended-jobs').getByRole('link').first();
      await expect(recommended).toBeVisible();
      jobTitle = (await recommended.innerText()).trim();
      await recommended.click();
      await expect(page.getByRole('heading', { level: 1, name: jobTitle })).toBeVisible();
      jobPath = new URL(page.url()).pathname;

      await page.getByRole('link', { name: 'Apply now' }).click();
      await expect(page).toHaveURL(/\/account\/apply\//);
      const documents = page.getByTestId('apply-documents').getByRole('checkbox');
      await expect(documents).toHaveCount(2);
      await expect(documents.nth(0)).toBeChecked();
      await expect(documents.nth(1)).toBeChecked();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page
        .getByLabel('Cover letter')
        .fill('I worked four years at the front desk of a hotel.');
      await page.getByLabel('When could you start?').fill('Next month');
      await page.getByRole('button', { name: 'Continue' }).click();

      const review = page.getByTestId('apply-review');
      await expect(review).toContainText(jobTitle);
      await expect(review).toContainText('cv.pdf');
      await expect(review).toContainText('passport.png');
      await expect(review).toContainText('Next month');
      await page.getByRole('button', { name: 'Send my application' }).click();
      await expect(page.getByTestId('apply-success')).toContainText(
        'Your application has been sent',
      );
    });

    await test.step('see the application and its timeline', async () => {
      await page.getByRole('link', { name: 'Follow my application' }).click();
      await expect(page.getByRole('heading', { level: 1, name: jobTitle })).toBeVisible();
      await expect(page.getByTestId('status-badge').first()).toHaveText('Submitted');
      const timeline = page.getByTestId('timeline');
      await expect(timeline.getByRole('listitem')).toHaveCount(9);
      await expect(timeline.locator('[data-status="SUBMITTED"]')).toHaveAttribute(
        'data-state',
        'current',
      );
      await expect(timeline.locator('[data-status="VISA_APPROVED"]')).toHaveAttribute(
        'data-state',
        'upcoming',
      );
      await expect(timeline.locator('[data-status="DEPLOYED"]')).toContainText('Deployed');

      await page.getByRole('link', { name: 'Back to my applications' }).click();
      await expect(page.getByTestId('applications').getByRole('listitem')).toHaveCount(1);
      await expect(page.getByTestId('applications')).toContainText(jobTitle);
    });

    await test.step('a second application is blocked, with the date it becomes possible', async () => {
      const next = new Date();
      next.setUTCMonth(next.getUTCMonth() + 6);
      const year = String(next.getUTCFullYear());

      await page.goto(jobPath);
      const onJobPage = page.getByTestId('apply-cooldown');
      await expect(onJobPage).toContainText('You can apply again on');
      await expect(onJobPage).toContainText(year);
      await expect(page.getByRole('link', { name: 'Apply now' })).toHaveCount(0);

      await page.goto(jobPath.replace('/jobs/', '/account/apply/'));
      const blocked = page.getByTestId('apply-cooldown');
      await expect(blocked).toContainText('You can apply again from');
      await expect(blocked).toContainText(year);
      await expect(page.getByRole('button', { name: 'Send my application' })).toHaveCount(0);
    });

    await test.step('withdraw the application, then delete the account', async () => {
      await page.goto('/en/account/applications');
      await page.getByTestId('applications').getByRole('link').first().click();
      await page.getByRole('button', { name: 'Withdraw my application' }).click();
      await page.getByRole('button', { name: 'Yes, withdraw' }).click();
      await expect(page.getByTestId('status-badge').first()).toHaveText('Withdrawn');

      // The application stays after the account, as an anonymous row: the run removes it.
      await rememberApplications(page.request);
      await page.goto('/en/account/settings');
      await page.getByRole('button', { name: 'Delete my account' }).click();
      const confirm = page.getByRole('button', { name: 'Delete my account for good' });
      await expect(confirm).toBeDisabled();
      await page.getByLabel(/^Type DELETE to confirm/).fill('DELETE');
      await page
        .getByRole('dialog')
        .getByLabel(/^Current password/)
        .fill(PASSWORD);
      await confirm.click();
      await expect(page).toHaveURL(/\/en$/);
      await page.goto('/en/account');
      await expect(page).toHaveURL(/\/en\/login/);
    });
  });
});
