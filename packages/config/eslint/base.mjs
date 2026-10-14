import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Base preset for TypeScript packages that run on Node.
 * Type-aware rules are on: each package passes its own directory as `tsconfigRootDir`.
 *
 * @param {string} tsconfigRootDir absolute path of the package (import.meta.dirname)
 */
export function base(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'src/generated/**'] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    // Patterns that often hide a vulnerability: eval, child processes, unsafe regular
    // expressions, non-literal file paths and requires, timing attacks.
    security.configs.recommended,
    {
      rules: {
        // Reports every obj[key], including indexes of arrays and typed records: too noisy
        // with strict TypeScript (noUncheckedIndexedAccess already covers the real risk).
        'security/detect-object-injection': 'off',
      },
    },
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        'no-console': ['error', { allow: ['warn', 'error'] }],
      },
    },
    {
      // Tests and development scripts build patterns and paths from their own fixtures,
      // never from a request.
      files: ['**/*.spec.ts', '**/*.test.ts', 'test/**', 'prisma/seed/**', 'src/openapi-export.ts'],
      rules: {
        'security/detect-non-literal-regexp': 'off',
        'security/detect-non-literal-fs-filename': 'off',
        'security/detect-unsafe-regex': 'off',
      },
    },
    {
      // Plain JS config files are not part of any tsconfig.
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}
