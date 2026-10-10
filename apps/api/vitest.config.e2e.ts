import { defineConfig } from 'vitest/config';

// End-to-end tests: the real application over HTTP against a PostgreSQL test
// database (see test/e2e/test-database.ts). Files run one after the other
// because they share that database.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    globalSetup: ['./test/e2e/global-setup.ts'],
    setupFiles: ['./test/e2e/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
