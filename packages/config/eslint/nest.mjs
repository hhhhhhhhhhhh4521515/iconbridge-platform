import tseslint from 'typescript-eslint';
import { base } from './base.mjs';

/**
 * Preset for the NestJS API.
 *
 * @param {string} tsconfigRootDir absolute path of the package (import.meta.dirname)
 */
export function nest(tsconfigRootDir) {
  return tseslint.config(...base(tsconfigRootDir), {
    rules: {
      // Nest modules are empty decorated classes.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  });
}
