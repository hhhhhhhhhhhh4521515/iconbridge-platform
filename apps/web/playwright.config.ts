import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the public site, the candidate area and the back office.
 *
 *   pnpm test:browser            (from the repository root)
 *
 * They need the stack: `pnpm infra:up`, the API on port 4000 with the seeded
 * development data (`pnpm db:seed`), Mailpit on port 8025, and the web app on port 3000.
 * The back-office tests sign in as the seeded super admin of `apps/api/.env`. If nothing
 * listens on 3000, Playwright builds and starts the web app itself.
 */
const ADMIN = /admin.*\.spec\.ts$/;
const DESK = { width: 1440, height: 900 };
/**
 * WebKit needs system libraries that `playwright install --with-deps webkit` installs
 * (with sudo). CI has them; on a machine without them, run `pnpm test:browser:webkit`,
 * which uses the Playwright container instead.
 */
const WEBKIT = Boolean(process.env.CI || process.env.E2E_WEBKIT);
/** Where the site answers. HTTPS with a self-made certificate in the WebKit container. */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Removes what the tests created, even when one of them failed half-way.
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: BASE,
    ignoreHTTPSErrors: BASE.startsWith('https://'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'desktop', testIgnore: ADMIN, use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', testIgnore: ADMIN, use: { ...devices['Pixel 7'] } },
    {
      // The back office is made for a desk or a tablet. It runs after the two others: every
      // test here signs several people in, and sign-ins are rate-limited per address.
      name: 'admin',
      testMatch: ADMIN,
      dependencies: ['desktop', 'phone'],
      use: { ...devices['Desktop Chrome'], viewport: DESK },
    },
    // The same tests in the two other browser engines.
    { name: 'firefox', testIgnore: ADMIN, use: { ...devices['Desktop Firefox'] } },
    {
      name: 'firefox-admin',
      testMatch: ADMIN,
      dependencies: ['firefox'],
      use: { ...devices['Desktop Firefox'], viewport: DESK },
    },
    ...(WEBKIT
      ? [
          { name: 'webkit', testIgnore: ADMIN, use: { ...devices['Desktop Safari'] } },
          {
            name: 'webkit-admin',
            testMatch: ADMIN,
            dependencies: ['webkit'],
            use: { ...devices['Desktop Safari'], viewport: DESK },
          },
        ]
      : []),
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `${BASE}/fr`,
    ignoreHTTPSErrors: BASE.startsWith('https://'),
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
