import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Package-local Vitest config so `pnpm --filter @siteborne/verification
 * test` (and the root `verification:test` alias) work when invoked with
 * this package's directory as cwd, independent of the root workspace
 * config — matching the pattern in packages/provider-adapters/vitest.config.ts.
 * Vite resolves node_modules packages by package.json main/module/exports
 * (not by tsconfig `paths`), so cross-package `@siteborne/*` source imports
 * need an explicit alias here too.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    alias: {
      '@siteborne/pcc-schema': path.resolve(__dirname, '../pcc-schema/src'),
      '@siteborne/provider-adapters': path.resolve(__dirname, '../provider-adapters/src'),
    },
  },
});
