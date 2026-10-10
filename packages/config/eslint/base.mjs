import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
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
      // Plain JS config files are not part of any tsconfig.
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}
