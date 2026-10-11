import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests of the public site.
 *
 *   pnpm test:browser            (from the repository root)
 *
 * They need the stack: `pnpm infra:up`, the API on port 4000 with the seeded
 * development data (`pnpm db:seed`), and the web app on port 3000. If nothing
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000/fr',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
