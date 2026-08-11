import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    alias: {
      '@siteborne/pricing': path.resolve(__dirname, '../pricing/src'),
      '@siteborne/pcc-schema': path.resolve(__dirname, '../pcc-schema/src'),
      '@siteborne/provider-adapters': path.resolve(__dirname, '../provider-adapters/src'),
      '@siteborne/protocol-x402': path.resolve(__dirname, '../protocol-x402/src'),
      '@siteborne/verification': path.resolve(__dirname, '../verification/src'),
    },
  },
});
