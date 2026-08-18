/**
 * SUN-1200 checkpoint F remediation — a deliberately SEPARATE Vitest
 * config for the real-workerd regression suite
 * (`tests/workerd/*.workerd-test.ts`), invoked as its own script
 * (`pnpm test:workerd`, wired into `pnpm check`), never merged into the
 * default `vitest run` config every other test file already uses.
 *
 * Why separate: `@cloudflare/vitest-pool-workers` executes test code
 * itself inside the workerd runtime and has real incompatibilities with
 * plugins/patterns the rest of this monorepo's ~600 other tests rely on
 * (real Node `fs`/`node:crypto` usage in setup, other Vitest pools,
 * etc.) — isolating it here means the existing, extensively-accepted
 * test suite is completely unaffected, and this new suite gets exactly
 * the runtime fidelity it needs (real workerd, the exact production
 * `compatibility_date`/`compatibility_flags`) without compromise on
 * either side.
 */
import path from 'node:path';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Mirrors the root `vitest.config.ts`'s own `test.alias` map exactly --
// this repository's `@siteborne/*` workspace packages resolve via
// tsconfig `paths` for Vitest's default pool, but Vite's own resolver
// (which vitest-pool-workers uses directly) needs the same mapping
// spelled out explicitly, since these packages' real `dist/` builds are
// not produced anywhere in this repository's actual pipeline (their
// tsconfigs set `noEmit: true`).
const ROOT = path.resolve(__dirname, '..', '..');

export default defineWorkersConfig({
  ssr: {
    // Works around a Vite SSR/CJS-interop transform issue specific to
    // this pinned vitest-pool-workers version parsing ajv's `dist/*.js`
    // CJS build (`SyntaxError: Unexpected token ':'` in `ajv/dist/core.js`)
    // -- confirmed NOT a genuine workerd restriction: the real deployed
    // Worker's `/a2a` route already uses the same real, module-top-level
    // Ajv import successfully in production today.
    external: ['ajv'],
  },
  resolve: {
    alias: {
      '@siteborne/contracts': path.resolve(ROOT, 'packages/contracts/src'),
      '@siteborne/pcc-schema': path.resolve(ROOT, 'packages/pcc-schema/src'),
      '@siteborne/provider-adapters': path.resolve(ROOT, 'packages/provider-adapters/src'),
      '@siteborne/verification': path.resolve(ROOT, 'packages/verification/src'),
      '@siteborne/service-runtime': path.resolve(ROOT, 'packages/service-runtime/src'),
      '@siteborne/pricing': path.resolve(ROOT, 'packages/pricing/src'),
      '@siteborne/policy': path.resolve(ROOT, 'packages/policy/src'),
      '@siteborne/test-fixtures': path.resolve(ROOT, 'packages/test-fixtures/src'),
      '@siteborne/protocol-x402': path.resolve(ROOT, 'packages/protocol-x402/src'),
      '@siteborne/protocol-mcp': path.resolve(ROOT, 'packages/protocol-mcp/src'),
      '@siteborne/protocol-a2a': path.resolve(ROOT, 'packages/protocol-a2a/src'),
      '@siteborne/protocol-nevermined': path.resolve(ROOT, 'packages/protocol-nevermined/src'),
    },
  },
  test: {
    include: ['tests/workerd/**/*.workerd-test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.workerd-test.toml' },
      },
    },
  },
});
