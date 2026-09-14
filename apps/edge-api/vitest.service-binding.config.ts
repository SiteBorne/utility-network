/**
 * SUN-1222C-SMTP-ROOT-CAUSE Service-Binding-isolation addendum — a
 * deliberately SEPARATE Vitest config (mirrors `vitest.workerd.config.ts`'s
 * own separation rationale exactly) standing up a REAL, local-only
 * `@cloudflare/vitest-pool-workers` Service Binding between two real
 * Miniflare Workers:
 *
 *   caller  (tests/workerd/fixtures/service-binding-diagnostic-caller.ts,
 *            the real `storageAlertSmtpDiagnosticRoute` handler, unmodified)
 *       ↓ real Miniflare Service Binding (STORAGE_ALERT_RECEIVER)
 *   receiver (../../src/storage-alert-receiver-entrypoint.ts, the real
 *             production receiver Worker module, unmodified)
 *
 * Exists to answer, entirely locally and with zero external network
 * access, zero Cloudflare account access, and zero production secrets:
 * "does the receiver's real bounded timeout/catch/finally path return a
 * structured response through an actual runtime-level Service Binding
 * before the caller's own outer timeout fires?" — see
 * `tests/workerd/service-binding-timeout.workerd-test.ts`.
 *
 * Never deployed, never referenced by any `wrangler deploy`/`versions
 * upload`/`versions deploy` command anywhere in this repository. The two
 * bearer-style values below (`STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN`,
 * `STORAGE_ALERT_PATH_TOKEN`/`ALERT_PATH_TOKEN`) are fixed, non-random,
 * test-only literals — never a production secret, never read from a real
 * Cloudflare account or `.dev.vars` — and are only meaningful within this
 * ephemeral in-memory Miniflare instance.
 */
import path from 'node:path';
import fs from 'node:fs';
import * as esbuild from 'esbuild';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const COMPATIBILITY_DATE = '2026-08-05';
const COMPATIBILITY_FLAGS = ['nodejs_compat'];

const TEST_ONLY_DIAGNOSTIC_TOKEN = 'test-only-diagnostic-token-not-a-secret';
const TEST_ONLY_PATH_TOKEN = 'test-only-path-token-not-a-secret';
const RECEIVER_WORKER_NAME = 'test-storage-alert-receiver';

/**
 * `@cloudflare/vitest-pool-workers`'s `poolOptions.workers.main` Worker is
 * bundled through Vite (so plain `.ts` works there -- see
 * `service-binding-diagnostic-caller.ts`), but an auxiliary
 * `poolOptions.workers.miniflare.workers[].scriptPath` is handed to
 * Miniflare's own module parser UNTRANSFORMED, which cannot parse
 * TypeScript syntax at all. Bundling the real, unmodified
 * `storage-alert-receiver-entrypoint.ts` to plain ESM with esbuild here
 * (transpilation only -- `bundle: true` just inlines its own relative
 * imports, no logic is changed or reimplemented) is the documented
 * workaround for giving an auxiliary Worker real TypeScript source.
 * `cloudflare:sockets` is marked `external` so the bundle still imports it
 * as a runtime-provided module rather than esbuild trying (and failing) to
 * resolve it as an npm package.
 */
function bundleReceiverWorkerForTest(): string {
  const entryPoint = path.resolve(__dirname, 'src/storage-alert-receiver-entrypoint.ts');
  const result = esbuild.buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['cloudflare:sockets', 'cloudflare:workers', 'cloudflare:email'],
  });
  const outFile = result.outputFiles[0];
  if (!outFile) {
    throw new Error('esbuild produced no output bundling storage-alert-receiver-entrypoint.ts');
  }
  // Written inside the project tree (not the OS tmpdir): workerd's
  // sandboxed filesystem refuses a `scriptPath` that needs `..` to escape
  // its starting directory, which an out-of-tree path like `os.tmpdir()`
  // triggers. `.generated/` is test-output-only, never committed (see
  // `.gitignore`), regenerated fresh on every run.
  const outDir = path.resolve(__dirname, 'tests/workerd/.generated');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'service-binding-receiver-bundle.mjs');
  fs.writeFileSync(outPath, outFile.text);
  return outPath;
}

export default defineWorkersConfig({
  test: {
    include: ['tests/workerd/service-binding-timeout.workerd-test.ts'],
    poolOptions: {
      workers: {
        main: './tests/workerd/fixtures/service-binding-diagnostic-caller.ts',
        miniflare: {
          compatibilityDate: COMPATIBILITY_DATE,
          compatibilityFlags: COMPATIBILITY_FLAGS,
          bindings: {
            STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN: TEST_ONLY_DIAGNOSTIC_TOKEN,
            STORAGE_ALERT_PATH_TOKEN: TEST_ONLY_PATH_TOKEN,
          },
          // The real runtime-level Service Binding under test -- NOT a
          // mocked/plain-function `serviceBindings` entry. Points at the
          // auxiliary Worker's `name` below, which Miniflare resolves to
          // a real second Worker instance in the same runtime.
          serviceBindings: {
            STORAGE_ALERT_RECEIVER: RECEIVER_WORKER_NAME,
          },
          workers: [
            {
              name: RECEIVER_WORKER_NAME,
              modules: true,
              // The real, unmodified production receiver module -- see
              // this file's own top-level doc comment and
              // `bundleReceiverWorkerForTest`'s. Transpiled (not
              // reimplemented) so Miniflare's auxiliary-worker loader,
              // which does not run source through Vite, can parse it.
              scriptPath: bundleReceiverWorkerForTest(),
              compatibilityDate: COMPATIBILITY_DATE,
              compatibilityFlags: COMPATIBILITY_FLAGS,
              bindings: {
                ALERT_PATH_TOKEN: TEST_ONLY_PATH_TOKEN,
                // Deliberately NOT set: `IONOS_SMTP_PASSWORD`. Every
                // control-mode branch this test exercises returns before
                // that binding is ever read (see
                // `storage-alert-receiver-entrypoint.ts`'s own module-level
                // doc comment on the capability-surface invariant), and
                // its real value must never exist inside this test
                // process regardless.
              },
            },
          ],
        },
      },
    },
  },
});
