import { expect, test, type Page } from '@playwright/test';

/** On a phone the language links are inside the menu. */
async function switchLanguage(page: Page, code: 'FR' | 'EN' | 'AR') {
  const menu = page.getByRole('button', { name: /menu/i });
  if (await menu.isVisible()) {
    await menu.click();
  }
  await page
    .getByRole('link', {
      name: { FR: 'Français', EN: 'English', AR: 'العربية' }[code],
      exact: true,
    })
    .first()
    .click();
}

test.describe('home page', () => {
  test('renders the hero slider and the success stories', async ({ page }) => {
    await page.goto('/fr');
    const hero = page.getByRole('region', { name: 'Destinations à la une' });
    await expect(hero).toBeVisible();
    await expect(hero.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await expect(hero.getByRole('link', { name: 'Voir les offres' }).first()).toBeVisible();
    await expect(hero.getByRole('search')).toBeVisible();

    const stories = page.getByTestId('story-card');
    await stories.first().scrollIntoViewIfNeeded();
    await expect(stories.first()).toBeVisible();
    expect(await stories.count()).toBeGreaterThan(0);
    await expect(stories.first().getByText('Visa approuvé')).toBeVisible();
    await expect(stories.first().getByRole('img')).toBeVisible();
  });

  test('the slider moves on by itself and can be paused', async ({ page }) => {
    await page.goto('/en');
    const hero = page.getByRole('region', { name: 'Featured destinations' });
    const firstTitle = await hero.getByRole('heading', { level: 2 }).first().innerText();
    await expect(hero.getByRole('heading', { level: 2 }).first()).not.toHaveText(firstTitle, {
      timeout: 12_000,
    });

    await hero.getByRole('button', { name: 'Pause the slideshow' }).click();
    await expect(hero.getByRole('button', { name: 'Play the slideshow' })).toBeVisible();
    const pausedTitle = await hero.getByRole('heading', { level: 2 }).first().innerText();
    await page.waitForTimeout(7_500);
    await expect(hero.getByRole('heading', { level: 2 }).first()).toHaveText(pausedTitle);
  });

  test('the slider stands still when the visitor prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en');
    const hero = page.getByRole('region', { name: 'Featured destinations' });
    const title = await hero.getByRole('heading', { level: 2 }).first().innerText();
    await page.waitForTimeout(7_500);
    await expect(hero.getByRole('heading', { level: 2 }).first()).toHaveText(title);
  });

  test('shows the counters, the destinations and the anti-scam notice', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByText('Open jobs').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /View jobs in Malta/ })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'We never ask candidates for money to apply' }),
    ).toBeVisible();
  });

  test('the hero search opens the jobs page with the keyword', async ({ page }) => {
    await page.goto('/en');
    const search = page.getByRole('search');
    await search.getByLabel('Job title or keyword').fill('welders');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/en\/jobs\?.*q=welders/);
    await expect(page.getByTestId('job-list')).toContainText('Welder');
  });
});

test.describe('jobs', () => {
  test('filters by keyword and by destination, and keeps the filters in the URL', async ({
    page,
  }) => {
    await page.goto('/en/jobs');
    await expect(page.getByTestId('job-list').getByRole('article').first()).toBeVisible();
    const all = await page.getByTestId('job-list').getByRole('article').count();
    expect(all).toBeGreaterThan(1);

    // Keyword, with a plural the search must tolerate.
    await page.getByLabel('Keyword').fill('welders');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/q=welders/);
    await expect(page.getByTestId('job-count')).toHaveText('1 job found');
    await expect(page.getByTestId('job-list').getByRole('article')).toHaveCount(1);
    await expect(page.getByTestId('job-list')).toContainText('MIG/MAG Welder');

    // Destination: every card shown is in Malta.
    await page.getByRole('link', { name: 'Reset' }).click();
    await expect(page).toHaveURL(/\/en\/jobs$/);
    await expect(page.getByLabel('Keyword')).toHaveValue('');
    await page.getByLabel('Destination').selectOption({ label: 'Malta' });
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/destination=MALTA/);
    const cards = page.getByTestId('job-list').getByRole('article');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByLabel('Destination')).toHaveValue('MALTA');
    const shown = await cards.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(all);
    for (const card of await cards.all()) {
      await expect(card).toContainText('Malta');
    }

    // The URL alone gives the same result: it can be shared.
    await page.goto('/en/jobs?destination=MALTA');
    await expect(page.getByTestId('job-list').getByRole('article')).toHaveCount(shown);
    await expect(page.getByLabel('Destination')).toHaveValue('MALTA');
  });

  test('shows an empty state when nothing matches', async ({ page }) => {
    await page.goto('/en/jobs?q=astronaut');
    await expect(page.getByTestId('jobs-empty')).toBeVisible();
    await expect(page.getByText('No job matches your search')).toBeVisible();
    await page.getByRole('link', { name: 'Show all jobs' }).click();
    await expect(page.getByTestId('job-list')).toBeVisible();
  });

  test('a job page shows the details, structured data and "Login to apply" to a visitor', async ({
    page,
  }) => {
    await page.goto('/en/jobs/sample-welder-poland');
    await expect(page.getByRole('heading', { level: 1, name: 'MIG/MAG Welder' })).toBeVisible();
    await expect(
      page.getByTestId('apply-anonymous').getByRole('link', { name: 'Login to apply' }),
    ).toBeVisible();
    await expect(page.getByTestId('countdown')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Share on WhatsApp' })).toBeVisible();

    const jsonLd = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}',
    ) as { '@type': string; title: string };
    expect(jsonLd).toMatchObject({ '@type': 'JobPosting', title: 'MIG/MAG Welder' });
    await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute(
      'href',
      /\/ar\/jobs\/sample-welder-poland$/,
    );
  });

  test('a job that is not open, or does not exist, shows the 404 page', async ({ page }) => {
    const response = await page.goto('/en/jobs/sample-fruit-picker-poland');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('languages', () => {
  test('a visitor is sent to their own language, and to French when it is not offered', async ({
    browser,
  }) => {
    const visit = async (locale: string) => {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      await page.goto('/');
      const result = {
        url: page.url(),
        lang: await page.locator('html').getAttribute('lang'),
        dir: await page.locator('html').getAttribute('dir'),
      };
      await context.close();
      return result;
    };
    const german = await visit('de-DE');
    expect(german.url).toMatch(/\/fr$/);
    expect(german).toMatchObject({ lang: 'fr', dir: 'ltr' });
    expect(await visit('en-GB')).toMatchObject({ lang: 'en' });
    expect(await visit('ar-TN')).toMatchObject({ lang: 'ar', dir: 'rtl' });
  });

  test('switching to Arabic sets dir=rtl and translates the page', async ({ page }) => {
    await page.goto('/fr');
    await switchLanguage(page, 'AR');
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { name: 'أين تودّ أن تعمل؟' })).toBeVisible();
  });

  test('switching language keeps the visitor on the same page', async ({ page }) => {
    await page.goto('/fr/jobs/sample-welder-poland');
    await switchLanguage(page, 'EN');
    await expect(page).toHaveURL(/\/en\/jobs\/sample-welder-poland$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Job description' })).toBeVisible();
  });
});

test.describe('other pages', () => {
  test('success stories can be filtered by destination', async ({ page }) => {
    await page.goto('/en/success-stories');
    const cards = page.getByTestId('story-card');
    const all = await cards.count();
    expect(all).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Poland', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Poland', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await cards.count()).toBeLessThanOrEqual(all);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(cards).toHaveCount(all);
  });

  test('the contact page has a labelled form, and the legal pages exist', async ({ page }) => {
    await page.goto('/en/contact');
    await expect(page.getByLabel('Full name')).toBeVisible();
    await expect(page.getByLabel('Your message')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send the message' })).toBeVisible();
    await page.goto('/en/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
    await page.goto('/en/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
  });

  test('the theme button switches to dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('health routes: the web app alone, and the API with its database through it', async ({
    request,
  }) => {
    // Each app reports the commit it runs ("dev" from a local build, the image's VCS_REF
    // otherwise); the deployment waits until both report the commit it deployed.
    const live = await request.get('/api/health/live');
    expect(live.status()).toBe(200);
    const liveBody = (await live.json()) as { status: string; version: string };
    expect(Object.keys(liveBody).sort()).toEqual(['status', 'version']);
    expect(liveBody.status).toBe('ok');
    expect(liveBody.version).toMatch(/^\S+$/);
    const ready = await request.get('/api/health/ready');
    expect(ready.status()).toBe(200);
    // Built from the same commit here: the web app and the API report the same version.
    expect(await ready.json()).toEqual({
      status: 'ok',
      version: liveBody.version,
      api: liveBody.version,
    });
    expect(ready.headers()['cache-control']).toBe('no-store');
  });

  test('robots.txt and sitemap.xml list the site and its jobs', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Sitemap:');
    expect(robots).toContain('Disallow: /api/');
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/fr/jobs/sample-welder-poland');
    expect(sitemap).toContain('hreflang="ar"');
    expect(sitemap).not.toContain('sample-fruit-picker-poland');
  });
});
