import { expect, test } from '@playwright/test';
import { emailToken, PASSWORD, pickDate, verifiedCandidate } from './support';

/**
 * What a candidate does with the account itself, in a real browser: a forgotten
 * password, a changed password, job alerts, the language, the export of the data,
 * and a session that goes on when the short-lived access token is over.
 *
 * Each test makes its own account and erases it at the end.
 */

const NEW_PASSWORD = 'lantern-orchid-saddle-47';

/** Erases the account the way a candidate does; the address becomes free again. */
async function erase(
  context: Awaited<ReturnType<typeof verifiedCandidate>>['context'],
  password = PASSWORD,
): Promise<void> {
  const erased = await context.request.delete('/api/v1/me/account', { data: { password } });
  expect(erased.status(), 'the test account is erased').toBe(204);
  await context.close();
}

test.describe('account', () => {
  test('a forgotten password is replaced with the link sent by email', async ({ browser }) => {
    const { context, email } = await verifiedCandidate(
      browser,
      `-forgot-${test.info().project.name}`,
    );
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    try {
      await page.goto('/en/login');
      await page.getByRole('link', { name: /Forgot/ }).click();
      await expect(page).toHaveURL(/\/en\/forgot-password$/);
      await page.getByLabel(/^Email address/).fill(email);
      await page.getByRole('button', { name: 'Send me a link' }).click();
      // The same sentence whether the address has an account or not.
      await expect(page.getByText('If an account uses this address')).toBeVisible();

      const token = await emailToken(page.request, email, 'reset-password');
      await page.goto(`/en/reset-password?token=${token}`);
      await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Save my password' }).click();
      await expect(page).toHaveURL(/\/en\/login\?reset=done/);
      await expect(page.getByText('Your password has been changed. You can log in.')).toBeVisible();

      // The link works once.
      const again = await visitor.newPage();
      await again.goto(`/en/reset-password?token=${token}`);
      await again.getByLabel(/^New password/).fill(PASSWORD);
      await again.getByRole('button', { name: 'Save my password' }).click();
      await expect(again.getByText('This link has expired or was already used.')).toBeVisible();
      await again.close();

      // The old password is refused, the new one opens the account.
      await page.getByLabel(/^Email address/).fill(email);
      await page.getByLabel(/^Password/).fill(PASSWORD);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.getByText('The email address or the password is wrong.')).toBeVisible();
      await page.getByLabel(/^Password/).fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL(/\/en\/account$/);

      // Changing the password ended the session opened before it.
      expect((await context.request.get('/api/v1/me/profile')).status()).toBe(401);
    } finally {
      await erase(visitor, NEW_PASSWORD);
      await context.close();
    }
  });

  test('settings: change the password, create and delete a job alert, download the data', async ({
    browser,
  }) => {
    const { context, email } = await verifiedCandidate(
      browser,
      `-settings-${test.info().project.name}`,
    );
    let password = PASSWORD;
    try {
      const page = await context.newPage();
      await page.goto('/en/account/settings');

      await test.step('job alerts', async () => {
        const alerts = page.getByRole('region', { name: 'Job alerts' });
        await expect(alerts.getByText('You have no job alert.')).toBeVisible();
        await alerts.getByRole('checkbox', { name: 'Malta' }).check();
        await alerts.getByRole('checkbox', { name: 'Hospitality' }).check();
        await alerts.getByRole('button', { name: 'Create the alert' }).click();
        const alert = alerts.getByRole('listitem').filter({ hasText: 'Malta' });
        await expect(alert).toContainText('Hospitality');
        await expect(alerts.getByText('You have no job alert.')).toHaveCount(0);
        // Still there after loading the page again: it was saved.
        await page.reload();
        await expect(alert).toBeVisible();
        await alert.getByRole('button', { name: 'Delete' }).click();
        await expect(alerts.getByText('You have no job alert.')).toBeVisible();
      });

      await test.step('download of the personal data', async () => {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('button', { name: 'Download my data' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('iconbridge-my-data.zip');
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk as Buffer);
        }
        const archive = Buffer.concat(chunks);
        // A zip archive ("PK") holding data.json, which names the account.
        expect(archive.subarray(0, 2).toString()).toBe('PK');
        expect(archive.includes(Buffer.from('data.json'))).toBe(true);
      });

      await test.step('change of password', async () => {
        const section = page.getByRole('region', { name: 'Password' });
        await section.getByLabel(/^Current password/).fill('not-my-password-12');
        await section.getByLabel(/^New password/).fill(NEW_PASSWORD);
        await section.getByRole('button', { name: 'Change my password' }).click();
        await expect(section.getByRole('alert')).toBeVisible();

        await section.getByLabel(/^Current password/).fill(PASSWORD);
        await section.getByRole('button', { name: 'Change my password' }).click();
        await expect(section.getByText('Your password has been changed.')).toBeVisible();
        password = NEW_PASSWORD;

        // This browser stays signed in; the old password no longer opens the account.
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
        const visitor = await browser.newContext();
        const old = await visitor.request.post('/api/v1/auth/login', {
          data: { email, password: PASSWORD },
        });
        expect(old.status()).toBe(401);
        await visitor.close();
      });
    } finally {
      await erase(context, password);
    }
  });

  test('the language chosen in the settings becomes the language of the page, dates included', async ({
    browser,
  }) => {
    const { context } = await verifiedCandidate(browser, `-language-${test.info().project.name}`);
    try {
      const page = await context.newPage();
      await page.goto('/en/account/settings');
      const language = page.getByRole('region', { name: 'Language' });
      await language.getByLabel('Preferred language').selectOption('fr');
      await language.getByRole('button', { name: 'Save' }).click();
      await expect(page).toHaveURL(/\/fr\/account\/settings$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Paramètres' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

      // The date lists follow the page, not the browser: day first and French months.
      await page.goto('/fr/account/profile?step=identity');
      const birth = page.getByRole('group', { name: /^Date de naissance/ });
      await expect(birth.getByRole('combobox')).toHaveCount(3);
      await expect(birth.getByRole('combobox').first()).toHaveAccessibleName('Jour');
      await expect(birth.getByRole('combobox').nth(1)).toHaveAccessibleName('Mois');
      await expect(
        birth.getByLabel('Mois').getByRole('option', { name: 'février' }),
      ).toBeAttached();

      // English puts the month first.
      await page.goto('/en/account/profile?step=identity');
      const english = page.getByRole('group', { name: /^Date of birth/ });
      await expect(english.getByRole('combobox').first()).toHaveAccessibleName('Month');
      await pickDate(page, /^Date of birth/, '1994-02-28');
      await expect(english.getByLabel('Month')).toHaveValue('2');

      // Arabic: from right to left, month names in Arabic.
      await page.goto('/ar/account/profile?step=identity');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('option', { name: 'فبراير' })).toBeAttached();
    } finally {
      await erase(context);
    }
  });

  test('the session goes on when the access token is over (silent refresh)', async ({
    browser,
  }) => {
    const { context } = await verifiedCandidate(browser, `-refresh-${test.info().project.name}`);
    try {
      const page = await context.newPage();
      await page.goto('/en/account/settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      const access = async () =>
        (await context.cookies()).find((cookie) => cookie.name === 'ib_access')?.value;
      const first = await access();
      expect(first).toBeTruthy();

      // With a short lifetime in the test stack (ACCESS_TOKEN_TTL_SECONDS on the API and
      // E2E_ACCESS_TOKEN_TTL_SECONDS here) the token really expires. Otherwise the browser
      // forgets it, which is what happens to an expired cookie.
      const lifetime = Number(process.env.E2E_ACCESS_TOKEN_TTL_SECONDS ?? '0');
      if (lifetime > 0) {
        await page.waitForTimeout((lifetime + 1) * 1000);
      } else {
        await context.clearCookies({ name: 'ib_access' });
        expect(await access()).toBeUndefined();
      }

      // A call from the page: refused once, refreshed without a word, then answered.
      const refreshed = page.waitForResponse(
        (response) => response.url().includes('/api/v1/auth/refresh') && response.status() < 300,
      );
      const alerts = page.getByRole('region', { name: 'Job alerts' });
      await alerts.getByRole('checkbox', { name: 'Poland' }).check();
      await alerts.getByRole('button', { name: 'Create the alert' }).click();
      await refreshed;
      await expect(alerts.getByRole('listitem').filter({ hasText: 'Poland' })).toBeVisible();
      await expect(page).toHaveURL(/\/en\/account\/settings$/);
      const second = await access();
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);

      // Opening a page of the account with an expired token works as well.
      await context.clearCookies({ name: 'ib_access' });
      await page.goto('/en/account/documents');
      await expect(page).toHaveURL(/\/en\/account\/documents$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    } finally {
      await erase(context);
    }
  });
});
