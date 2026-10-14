import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the public site, the candidate area and the back office, in
 * Chromium (desk and phone), Firefox and WebKit.
 *
 *   pnpm test:browser            (from the repository root: Chromium and Firefox)
 *   pnpm test:browser:webkit     (WebKit, in the Playwright container)
 *
 * They need `pnpm infra:up` (PostgreSQL, Azurite, Mailpit on port 8025) and the seeded
 * development data (`pnpm db:seed`). Playwright builds and starts the API (port 4000,
 * without rate limits) and the web app (port 3000) itself when nothing listens there.
 * The back-office tests sign in as the seeded super admin of `apps/api/.env`.
 *
 * Whatever the tests create is removed at the end of the run (`e2e/cleanup.ts`).
 */
const ADMIN = /admin.*\.spec\.ts$/;
const DESK = { width: 1440, height: 900 };
/**
 * WebKit runs through `pnpm test:browser:webkit` only (it sets E2E_WEBKIT): it needs
 * system libraries that the Playwright container has, and the site over HTTPS, because
 * WebKit does not keep the `Secure` session cookies over plain http://localhost.
 */
const WEBKIT = Boolean(process.env.E2E_WEBKIT);
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
  // Started only when nothing answers yet. `pnpm dev` must be stopped first: its API keeps
  // the rate limits (5 sign-ins a minute for one address), which the tests would wait out.
  webServer: [
    {
      // The built API, without rate limits: every test signs in from this machine.
      command: 'pnpm build && pnpm start',
      cwd: '../api',
      env: { RATE_LIMITS_ENABLED: 'false' },
      url: 'http://localhost:4000/health/ready',
      reuseExistingServer: true,
      timeout: 240_000,
    },
    {
      command: 'pnpm build && pnpm start',
      url: `${BASE}/fr`,
      ignoreHTTPSErrors: BASE.startsWith('https://'),
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
