import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'e2e/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'json'],
      // Unit tests cover the logic kept out of components. Pages and components are
      // exercised in real browsers by Playwright (pnpm test:browser), which is not
      // counted here.
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Thin wrappers around fetch, cookies and the environment: covered in the browser.
        'src/lib/api.ts',
        'src/lib/client-api.ts',
        'src/lib/env.ts',
        'src/lib/use-zod-form.ts',
        'src/lib/og.tsx',
        'src/lib/ui.ts',
        'src/lib/utils.ts',
      ],
      thresholds: { lines: 80 },
    },
  },
});
