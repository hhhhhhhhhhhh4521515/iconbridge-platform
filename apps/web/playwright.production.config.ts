import { defineConfig, devices } from '@playwright/test';

/**
 * Check of the production site with a dedicated test candidate (e2e/production.prod.ts).
 * Read only, except one test document that it uploads and deletes; it sends no email.
 *
 *   set -a; . ../../.env.e2e-prod; set +a     # PROD_URL, PROD_E2E_EMAIL, PROD_E2E_PASSWORD (git-ignored)
 *   pnpm --filter @iconbridge/web exec playwright test -c playwright.production.config.ts
 *
 * No web server is started and no local clean-up runs: e2e/cleanup.ts refuses any
 * address other than localhost on purpose.
 */
const BASE = process.env.PROD_URL;
if (!BASE?.startsWith('https://')) {
  throw new Error('PROD_URL must be the https:// address of the production site');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.prod.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // The first request may wake both apps from zero (about a minute).
  timeout: 180_000,
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 120_000,
  },
  projects: [{ name: 'production', use: { ...devices['Desktop Chrome'] } }],
});
