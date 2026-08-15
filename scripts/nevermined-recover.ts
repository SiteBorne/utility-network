#!/usr/bin/env tsx
/**
 * SUN-0900B checkpoint 1B — thin CLI wrapper for the recovery-only
 * operator path.
 *
 * Deliberately has ZERO `@siteborne/*` workspace imports (and imports
 * nothing beyond Node builtins) — the actual recovery logic lives in
 * `apps/edge-api/tests/live/nevermined-recover-operator.test.ts`, run
 * through `vitest run`, which is this project's only proven-working
 * module-resolution path for the deep `@siteborne/*` workspace import
 * graph (via the explicit aliases in root `vitest.config.ts`). A bare
 * `tsx` invocation of a root-level script hit an ESM export/binding
 * failure resolving `@siteborne/pricing` transitively through
 * `@siteborne/protocol-x402` — not present under vitest, which is why
 * this wrapper shells out to vitest rather than importing the recovery
 * logic directly.
 *
 * `NEVERMINED_RECOVER_PAYMENT_ID` (not `RUN_LIVE_NEVERMINED`) is the run
 * signal for the underlying test file — this wrapper never sets or reads
 * `RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402`.
 *
 * Usage:
 *   pnpm nevermined:recover -- --payment-id <Payment-Identifier>
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function parsePaymentId(argv: string[]): string {
  const idx = argv.indexOf('--payment-id');
  if (idx === -1 || !argv[idx + 1]) {
    throw new Error('usage: nevermined:recover -- --payment-id <Payment-Identifier>');
  }
  return argv[idx + 1]!;
}

const paymentId = parsePaymentId(process.argv.slice(2));

if (process.env.RUN_LIVE_NEVERMINED || process.env.RUN_LIVE_X402) {
  throw new Error(
    'nevermined:recover must not run with RUN_LIVE_NEVERMINED or RUN_LIVE_X402 set — recovery performs no ' +
      'live payment-flow operation and must never accidentally piggyback on that gate.'
  );
}

const result = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    '--config',
    'vitest.config.ts',
    'apps/edge-api/tests/live/nevermined-recover-operator.test.ts',
  ],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEVERMINED_RECOVER_PAYMENT_ID: paymentId,
    },
  }
);

process.exitCode = result.status ?? 1;
