import { expect, test, type Page } from '@playwright/test';

/**
 * The partner area is part of the site (ADR-027, amendment 2): the site's header (desk and
 * phone menu) and footer lead to the partner sign-in in the matching language, Arabic to
 * English, and the partner screens use the site's font. Read-only: nothing is created.
 */
const CASES = [
  { locale: 'en', label: 'Partner space', lang: 'en', title: 'Sign in to the partner area' },
  {
    locale: 'fr',
    label: 'Espace partenaire',
    lang: 'fr',
    title: 'Connexion à l’espace partenaire',
  },
  { locale: 'ar', label: 'مساحة الشركاء', lang: 'en', title: 'Sign in to the partner area' },
] as const;

const OPEN_MENU = { en: 'Open menu', fr: 'Ouvrir le menu', ar: 'فتح القائمة' } as const;

async function expectSignIn(page: Page, lang: string, title: string) {
  await expect(page).toHaveURL(new RegExp(`/partners/${lang}/login$`));
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

const fontOf = (page: Page) => page.evaluate(() => getComputedStyle(document.body).fontFamily);

test.describe('the partner space from the site', () => {
  for (const { locale, label, lang, title } of CASES) {
    test(`the header leads to the partner sign-in (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}`);
      const banner = page.getByRole('banner');
      const menu = banner.getByRole('button', { name: OPEN_MENU[locale] });
      // Phones and narrow windows: the link is in the menu, next to the account buttons.
      if (await menu.isVisible()) {
        await menu.click();
        await page.locator('#mobile-menu').getByRole('link', { name: label }).click();
      } else {
        await banner.getByRole('link', { name: label }).click();
      }
      await expectSignIn(page, lang, title);
    });

    test(`the footer leads to the partner sign-in (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await page.getByRole('contentinfo').getByRole('link', { name: label }).click();
      await expectSignIn(page, lang, title);
    });
  }

  test('the partner screens use the font, header and footer of the site', async ({ page }) => {
    await page.goto('/en');
    const site = await fontOf(page);
    expect(site).toMatch(/Inter/);
    for (const lang of ['en', 'fr', 'pl']) {
      await page.goto(`/partners/${lang}/login`);
      expect(await fontOf(page)).toBe(site);
      // The site's logo (decorative: the link carries the name).
      await expect(page.getByRole('banner').locator('img[src*="logo.webp"]')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toContainText('IconBridge Recruitment Ltd.');
    }
    // The logo goes back to the site, Polish to English.
    await page.getByRole('link', { name: 'IconBridge Jobs, strona publiczna' }).click();
    await expect(page).toHaveURL(/\/en$/);
  });

  test('the dark theme of the site is the dark theme of the partner area', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    try {
      const page = await context.newPage();
      const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.goto('/en');
      await expect(page.locator('html')).toHaveClass(/dark/);
      const site = await background();
      await page.goto('/partners/en/login');
      await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await background()).toBe(site);
    } finally {
      await context.close();
    }
  });

  test('the sign-in stays out of search engines', async ({ request }) => {
    const response = await request.get('/partners/en/login');
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(await response.text()).toContain('noindex');
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /*/login');
  });
});
