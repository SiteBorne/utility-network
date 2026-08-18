import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  ignores: [
    'node_modules/**',
    'dist/**',
    'build/**',
    '.turbo/**',
    '.venv/**',
    'pnpm-lock.yaml',
    '*.config.*',
    'scripts/*.ts',
    'coverage/**',
    'services/modal-worker/**',
    // SUN-1200 checkpoint F: machine-generated AJV standalone validator
    // module, never hand-edited -- see apps/edge-api/scripts/generate-input-validators.mts.
    // (apps/edge-api's own `lint` script also passes an explicit
    // --ignore-pattern for this path -- flat-config `ignores` combined
    // with other keys in the same object do not reliably act as a
    // blanket ignore, confirmed directly.)
    'apps/edge-api/src/generated/**',
  ],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: {
      console: 'readonly',
      process: 'readonly',
      Buffer: 'readonly',
      __dirname: 'readonly',
      __filename: 'readonly',
      global: 'readonly',
      module: 'readonly',
      require: 'readonly',
      exports: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      setInterval: 'readonly',
      clearInterval: 'readonly',
      Promise: 'readonly',
      Error: 'readonly',
      JSON: 'readonly',
      Object: 'readonly',
      Array: 'readonly',
      String: 'readonly',
      Number: 'readonly',
      Map: 'readonly',
      Set: 'readonly',
      Date: 'readonly',
      Math: 'readonly',
    },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
});
