import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/src/**/*.{test,spec}.ts',
      'apps/edge-api/**/*.{test,spec}.ts',
      'scripts/**/*.{test,spec}.ts',
    ],
    exclude: [
      'node_modules/**',
      '**/node_modules/**',
      'dist/**',
      'services/modal-worker/**',
      'packages/**/node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        'scripts/**',
        'services/**',
      ],
    },
    alias: {
      '@siteborne/contracts': path.resolve(__dirname, 'packages/contracts/src'),
      '@siteborne/pcc-schema': path.resolve(__dirname, 'packages/pcc-schema/src'),
      '@siteborne/provider-adapters': path.resolve(__dirname, 'packages/provider-adapters/src'),
      '@siteborne/verification': path.resolve(__dirname, 'packages/verification/src'),
      '@siteborne/service-runtime': path.resolve(__dirname, 'packages/service-runtime/src'),
      '@siteborne/pricing': path.resolve(__dirname, 'packages/pricing/src'),
      '@siteborne/policy': path.resolve(__dirname, 'packages/policy/src'),
      '@siteborne/test-fixtures': path.resolve(__dirname, 'packages/test-fixtures/src'),
      '@siteborne/protocol-x402': path.resolve(__dirname, 'packages/protocol-x402/src'),
      '@siteborne/protocol-mcp': path.resolve(__dirname, 'packages/protocol-mcp/src'),
      '@siteborne/protocol-a2a': path.resolve(__dirname, 'packages/protocol-a2a/src'),
      // SUN-1221C: `cloudflare:sockets` is a real Workers-runtime built-in
      // with no npm package -- unresolvable under plain Node/vitest.
      // Aliased to a throw-on-use shim so importing
      // `web-context-v2-cdp-composition.ts` doesn't crash at module-load
      // time; see that shim's own doc comment for why a throw, not a
      // working fake, is correct here. Wrangler/esbuild's real production
      // bundling never consults this config and resolves the real
      // platform module natively.
      'cloudflare:sockets': path.resolve(
        __dirname,
        'apps/edge-api/tests/support/cloudflare-sockets-shim.ts'
      ),
    },
    typecheck: {
      tsconfig: 'tsconfig.base.json',
    },
  },
});
