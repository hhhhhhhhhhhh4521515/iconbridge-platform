import { expect, test } from '@playwright/test';
import { check, violations } from './axe';
import { readyCandidate } from './support';

/**
 * axe on the main pages of the site and of the candidate area: no violation of
 * WCAG 2.1 A and AA. The same pages must also load without anything refused by
 * the Content-Security-Policy.
 */

test.describe('accessibility', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const path of [
    '/en',
    '/fr',
    '/ar',
    '/en/jobs',
    '/ar/jobs',
    '/en/success-stories',
    '/en/about',
    '/en/contact',
    '/en/login',
    '/en/register',
    '/en/forgot-password',
    '/en/privacy',
    '/en/terms',
  ]) {
    test(`public page ${path}`, async ({ page }) => {
      await check(page, path);
    });
  }

  test('a job page', async ({ page }) => {
    await page.goto('/en/jobs');
    const href = await page.locator('a[href^="/en/jobs/"]').first().getAttribute('href');
    await check(page, href ?? '/en/jobs');
  });

  test('the dark theme of the home page', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.waitForTimeout(400);
    expect(await violations(page), 'axe on /en in dark mode').toEqual([]);
  });

  test('the candidate area', async ({ browser }) => {
    test.setTimeout(120_000);
    const candidate = await readyCandidate(browser, 'Axe', `-axe-${test.info().project.name}`);
    try {
      const page = await candidate.context.newPage();
      for (const path of [
        '/en/account',
        '/en/account/profile?step=identity',
        '/ar/account/profile?step=identity',
        '/en/account/profile?step=passport',
        '/en/account/profile?step=languages',
        '/en/account/documents',
        '/en/account/applications',
        '/en/account/settings',
        '/ar/account/settings',
      ]) {
        await check(page, path);
      }
      // A country field with its list open (combobox and list box).
      await page.goto('/en/account/profile?step=identity');
      await page.getByRole('combobox', { name: /^Nationality/ }).fill('ma');
      await expect(page.getByRole('listbox').filter({ visible: true })).toBeVisible();
      expect(await violations(page), 'axe on an open country list').toEqual([]);
    } finally {
      await candidate.context.request.delete('/api/v1/me/account', {
        data: { password: 'harbour-violet-compass-58' },
      });
      await candidate.context.close();
    }
  });
});
