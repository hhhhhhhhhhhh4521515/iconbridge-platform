import { expect, test } from '@playwright/test';
import { adminSession, PASSWORD, pickCountry, PNG, seededAdmin, STAMP, toast } from './support';

/**
 * The super admin's screens of the partner spaces (ADR-027): create a space, set its logo,
 * add a member and a partner login, disable and enable, then delete it by typing its name.
 * Names start with "E2E " and "e2e-partner-": `cleanup.ts` removes what a stopped test left.
 */
test.describe('back office: partner spaces', () => {
  test('a super admin creates, fills and deletes a space', async ({ browser }) => {
    test.setTimeout(120_000);
    const admin = await adminSession(browser);
    const page = await admin.newPage();
    const name = `E2E Partner ${STAMP}-${test.info().project.name}`;
    const loginEmail = `e2e-partner-${STAMP}-${test.info().project.name}@example.test`;
    try {
      await page.goto('/en/admin');
      await page.getByRole('link', { name: 'Partner spaces', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Partner spaces' })).toBeVisible();

      // Create.
      await page.getByRole('button', { name: 'New partner space' }).click();
      const form = page.getByTestId('create-space-form');
      await form.getByLabel('Name').fill(name);
      await pickCountry(page, /Country of the partner/, 'Pol', 'Poland');
      await form.getByLabel('Default language').selectOption('pl');
      await form.getByRole('button', { name: 'Create the space' }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(page.getByTestId('not-member')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open the space' })).toHaveCount(0);

      // Logo: checked and re-encoded by the API, private.
      await page.getByTestId('logo-input').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      });
      await expect(toast(page, 'Logo saved.')).toBeVisible();
      await expect(page.getByTestId('logo-state')).toContainText('A logo is set');

      // A member: the super admin themself; the space can then be opened.
      await page.getByRole('button', { name: 'Add a member' }).click();
      const member = page.getByTestId('add-member-form');
      const own = member.locator('option', { hasText: seededAdmin().email });
      await member.getByLabel('Account').selectOption((await own.getAttribute('value')) ?? '');
      await member.getByRole('button', { name: 'Add a member' }).click();
      await expect(toast(page, 'Member added.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open the space' })).toHaveAttribute(
        'href',
        /^\/partners\/pl\/spaces\//,
      );

      // A partner login with its first password set now.
      await page.getByRole('tab', { name: /Partner logins/ }).click();
      await page.getByRole('button', { name: 'Create a login' }).click();
      const login = page.getByTestId('create-login-form');
      await login.getByLabel('Email').fill(loginEmail);
      await login.getByLabel('Name shown to the members').fill('E2E Anna');
      await login.getByLabel('New password').fill(PASSWORD);
      await login.getByRole('button', { name: 'Create a login' }).click();
      await expect(toast(page, `Login ${loginEmail} created.`)).toBeVisible();
      const row = page.getByRole('row').filter({ hasText: loginEmail });
      await expect(row).toContainText('E2E Anna');
      await expect(row).toContainText(/must change|password/i);

      await row.getByRole('button', { name: `Disable: ${loginEmail}` }).click();
      await page.getByTestId('confirm-yes').click();
      await expect(row).toContainText('Disabled');
      await row.getByRole('button', { name: `Enable: ${loginEmail}` }).click();
      await expect(row).not.toContainText('Disabled');

      // Disable and enable the space.
      await page.getByRole('button', { name: 'Disable', exact: true }).click();
      await page.getByTestId('confirm-yes').click();
      await expect(toast(page, 'Space disabled.')).toBeVisible();
      await page.getByRole('button', { name: 'Enable', exact: true }).click();
      await expect(toast(page, 'Space enabled.')).toBeVisible();

      // Delete: the dialog states what goes and needs the exact name.
      await page.getByRole('button', { name: 'Delete the space' }).click();
      const dialog = page.getByTestId('delete-space-form');
      await expect(dialog.getByTestId('delete-removed')).toContainText('1 partner login');
      const confirm = dialog.getByRole('button', { name: 'Delete the space' });
      await dialog.getByLabel(/Type the name of the space/).fill('E2E wrong name');
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/Type the name of the space/).fill(name);
      await confirm.click();
      await expect(toast(page, 'Partner space deleted.')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Partner spaces' })).toBeVisible();
      await expect(page.getByRole('link', { name })).toHaveCount(0);
    } finally {
      await admin.close();
    }
  });
});
