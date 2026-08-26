#!/usr/bin/env tsx
/**
 * SUN-1220F — thin CLI wrapper for the local-only, non-Worker CDP buyer
 * signer-capability qualification tool.
 *
 * Deliberately has ZERO `@siteborne/*` workspace imports (and imports
 * nothing beyond Node builtins) — matches `scripts/nevermined-recover.ts`'s
 * own established pattern, adopted for the same reason: a bare `tsx`
 * invocation of a root-level script has previously hit an ESM export/
 * binding failure resolving deep `@siteborne/*` workspace imports, which
 * this project's `vitest.config.ts` module-resolution aliases already
 * handle correctly. The actual tool lives in
 * `apps/edge-api/tests/live/cdp-buyer-signer-capability-local-check.test.ts`,
 * run through `vitest run`.
 *
 * This wrapper NEVER reads the value of `CDP_API_KEY_ID`,
 * `CDP_API_KEY_SECRET`, or `CDP_WALLET_SECRET` — it only checks that
 * each is *present* (non-empty) in the calling shell's environment,
 * fails fast with a fixed, sanitized message if any is missing, and
 * otherwise forwards the inherited environment unchanged to the child
 * `vitest` process. It never prints, logs, or persists any of the three
 * values.
 *
 * Usage:
 *   pnpm cdp:signer-capability-check
 *
 * Requires, in the calling shell's environment (never passed as CLI
 * arguments):
 *   CDP_API_KEY_ID
 *   CDP_API_KEY_SECRET
 *   CDP_WALLET_SECRET
 *
 * `controlled_sandbox_self_test`: independent_customer=false,
 * revenue=false, open_market_purchase=false, production_ready=false,
 * production_enabled=false.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const REQUIRED_ENV_VAR_NAMES = [
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
  'CDP_WALLET_SECRET',
] as const;

const missing = REQUIRED_ENV_VAR_NAMES.filter((name) => !process.env[name]);
if (missing.length > 0) {
  // Names only -- never values.
  throw new Error(
    `cdp:signer-capability-check requires ${REQUIRED_ENV_VAR_NAMES.join(', ')} in the calling ` +
      `shell's environment; missing: ${missing.join(', ')}.`
  );
}

if (process.env.RUN_LIVE_NEVERMINED || process.env.RUN_LIVE_X402) {
  throw new Error(
    'cdp:signer-capability-check must not run with RUN_LIVE_NEVERMINED or RUN_LIVE_X402 set — this ' +
      'tool performs no payment-flow operation of any kind and must never accidentally piggyback on ' +
      'those gates.'
  );
}

const result = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    '--config',
    'vitest.config.ts',
    'apps/edge-api/tests/live/cdp-buyer-signer-capability-local-check.test.ts',
  ],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUN_LOCAL_CDP_SIGNER_CAPABILITY_CHECK: '1',
    },
  }
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
