import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

/** Preset for the Next.js app. */
export function next() {
  return defineConfig([
    ...nextVitals,
    ...nextTs,
    {
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        'no-console': ['error', { allow: ['warn', 'error'] }],
      },
    },
    prettier,
    globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),
  ]);
}
