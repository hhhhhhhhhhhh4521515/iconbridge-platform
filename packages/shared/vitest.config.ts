import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/generated/**', 'src/index.ts', 'src/api-client.ts'],
      // The rules of the platform live here: who may apply, how an application moves,
      // when a job is open, which answers a job accepts. Every line of them is tested.
      thresholds: {
        lines: 90,
        'src/admin.ts': { lines: 100, functions: 100 },
        'src/candidate.ts': { lines: 100, functions: 100 },
        'src/jobs.ts': { lines: 100, functions: 100 },
        'src/questions.ts': { lines: 100, functions: 100 },
        'src/permissions.ts': { lines: 100, functions: 100 },
      },
    },
  },
});
