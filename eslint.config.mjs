// Root config: only covers loose scripts and config files at the repository root.
// Each workspace has its own eslint.config.mjs built from @iconbridge/config.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['apps/**', 'packages/**', 'infra/**', 'node_modules/**'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
];
