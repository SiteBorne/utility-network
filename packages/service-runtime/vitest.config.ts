import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    alias: {
      '@siteborne/pcc-schema': path.resolve(__dirname, '../pcc-schema/src'),
      '@siteborne/provider-adapters': path.resolve(__dirname, '../provider-adapters/src'),
      '@siteborne/verification': path.resolve(__dirname, '../verification/src'),
    },
  },
});
