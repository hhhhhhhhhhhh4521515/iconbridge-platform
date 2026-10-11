import { defineConfig } from 'vitest/config';

// Coverage of the API: the unit tests and the end-to-end tests together, since most
// services are exercised over HTTP against the test database.
//
//   pnpm --filter @iconbridge/api test:cov      (needs `pnpm infra:up`)
//
// Thresholds: 80% of the lines of the services, and 100% of the application rules
// (waiting period, eligibility decision, status transitions live in packages/shared
// and have their own thresholds there).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/e2e/**/*.e2e-spec.ts'],
    globalSetup: ['./test/e2e/global-setup.ts'],
    setupFiles: ['./test/e2e/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/generated/**',
        'src/main.ts',
        'src/cli.ts',
        'src/openapi-export.ts',
        'src/**/*.module.ts',
      ],
      thresholds: {
        'src/**/*.service.ts': { lines: 80 },
        'src/applications/cooldown.ts': { lines: 100, branches: 100, functions: 100 },
        'src/applications/applications.service.ts': { lines: 95 },
      },
    },
  },
});
