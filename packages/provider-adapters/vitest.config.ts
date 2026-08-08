import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config so `pnpm --filter @siteborne/provider-adapters
 * run all:test` (and the root `adapters:test` alias) work when invoked with
 * this package's directory as cwd, independent of the root workspace config.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
