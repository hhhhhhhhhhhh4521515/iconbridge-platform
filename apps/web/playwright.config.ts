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
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'desktop', testIgnore: /admin.*\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', testIgnore: /admin.*\.spec\.ts$/, use: { ...devices['Pixel 7'] } },
    {
      // The back office is made for a desk or a tablet. It runs after the two others: every
      // test here signs several people in, and sign-ins are rate-limited per address.
      name: 'admin',
      testMatch: /admin.*\.spec\.ts$/,
      dependencies: ['desktop', 'phone'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000/fr',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
