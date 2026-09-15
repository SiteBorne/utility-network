/**
 * SUN-1222C closure — a deliberately SEPARATE Vitest config (mirrors
 * `vitest.workerd.config.ts`'s own separation rationale exactly) standing
 * up a REAL, local-only `@cloudflare/vitest-pool-workers` Service Binding
 * between two real Miniflare Workers:
 *
 *   caller  (tests/workerd/fixtures/service-binding-alert-caller.ts, the
 *            real `buildServiceBindingStorageAlertTransport` production
 *            transport, unmodified)
 *       ↓ real Miniflare Service Binding (STORAGE_ALERT_RECEIVER)
 *   receiver (../../src/storage-alert-receiver-entrypoint.ts, the real
 *             production receiver Worker module, unmodified)
 *
 * Exercises the PERMANENT `/alert/<token>` architecture (path-token check,
 * schema validation, `STORAGE_ALERT_DELIVERY_ENABLED` fail-closed gate)
 * through a real runtime-level Service Binding — the earlier
 * SUN-1222C-SMTP-ROOT-CAUSE version of this suite exercised the temporary
 * `/control` zero-network isolation modes, both removed from the receiver
 * once the Service-Binding timeout/cleanup machinery they were built to
 * isolate was proven correct and the SMTP root cause was closed (see
 * `tests/workerd/service-binding-timeout.workerd-test.ts` and git history
 * for that version). See `ionos-smtp-transport.test.ts` for the
 * unit-level proof that bounded cleanup survives a real hanging
 * `reader.cancel()`/`socket.close()` — this suite proves real Service
 * Binding dispatch/propagation of the permanent gate's results instead,
 * which needs no socket simulation.
 *
 * Never deployed, never referenced by any `wrangler deploy`/`versions
 * upload`/`versions deploy` command anywhere in this repository. The
 * `STORAGE_ALERT_PATH_TOKEN`/`ALERT_PATH_TOKEN` value below is a fixed,
 * non-random, test-only literal — never a production secret, never read
 * from a real Cloudflare account or `.dev.vars` — and is only meaningful
 * within this ephemeral in-memory Miniflare instance. `IONOS_SMTP_PASSWORD`
 * is deliberately left unbound: every test in this suite either keeps
 * `STORAGE_ALERT_DELIVERY_ENABLED` unset (so the send path is never
 * reached) or explicitly exercises the "unprovisioned password fails
 * closed" branch, so its real value must never exist inside this test
 * process regardless.
 */
import path from 'node:path';
import fs from 'node:fs';
import * as esbuild from 'esbuild';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const COMPATIBILITY_DATE = '2026-08-05';
const COMPATIBILITY_FLAGS = ['nodejs_compat'];

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
        main: './tests/workerd/fixtures/service-binding-alert-caller.ts',
        miniflare: {
          compatibilityDate: COMPATIBILITY_DATE,
          compatibilityFlags: COMPATIBILITY_FLAGS,
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
                // Deliberately NOT set: `STORAGE_ALERT_DELIVERY_ENABLED`
                // (so the send path is never reached at all -- every test
                // in this suite gets the fail-closed 503) and
                // `IONOS_SMTP_PASSWORD` (so even if that gate were somehow
                // bypassed, the send would fail closed before touching
                // `cloudflare:sockets` -- see
                // `storage-alert-receiver-entrypoint.ts`'s own module-level
                // doc comment on the capability-surface invariant). Neither
                // real value may ever exist inside this test process.
              },
            },
          ],
        },
      },
    },
  },
});
