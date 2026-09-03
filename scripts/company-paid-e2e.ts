/**
 * SUN-1222C-COMPANY-E2E-HARNESS — thin CLI wrapper for the local-only,
 * exactly-once `company_evidence_graph.v2` paid-E2E client
 * (apps/edge-api/tests/live/company-paid-e2e-local.test.ts).
 *
 * Same zero-workspace-import, shell-to-vitest pattern as
 * `scripts/first-paid-e2e.ts` (SUN-1220J) and `scripts/document-paid-e2e.ts`
 * (SUN-1222C-R3B) — see those files' own doc comments for the confirmed
 * root cause a bare `tsx` invocation of this repo's own workspace packages
 * does not resolve `@siteborne/*` transitive deps correctly. This script
 * never imports `@coinbase/cdp-sdk`, `@x402/evm`, or `@siteborne/protocol-x402`
 * itself — it only checks *presence* (never the values) of the required
 * credential env vars, then shells out to vitest, which resolves the real
 * workspace aliases correctly.
 *
 * Two independent modes (§7/§14 of SUN-1222C-COMPANY-E2E-HARNESS's own
 * two-stage design requirement, mirroring `document-paid-e2e.ts` exactly):
 *
 *   dry-run — safe by default. Runs only the always-on, non-live test
 *             suite inside the target file (state-machine/economic/service
 *             rejection matrix, canonical-body freeze, CLI gating). Requires
 *             no credentials and performs no signing, no network payment.
 *
 *   live    — requires every credential below AND
 *             `SITEBORNE_LIVE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_CONFIRMATION_31200=I_AUTHORIZE_ONE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_31200`
 *             to be set, in addition to `RUN_LIVE_COMPANY_PAYMENT=1`.
 *             SUN-1222C-COMPANY-E2E-HARNESS itself does NOT authorize
 *             running this — invoking `live` requires a separate, later,
 *             standalone financial authorization specific to this one
 *             attempt (§7/§20: no standing authorization; the confirmation
 *             string is service- and amount-specific, never a generic
 *             "yes").
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED_ENV_VARS = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'] as const;

const LIVE_CONFIRMATION_VALUE = 'I_AUTHORIZE_ONE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_31200';
const LIVE_CONFIRMATION_ENV_VAR =
  'SITEBORNE_LIVE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_CONFIRMATION_31200';
const RUN_LIVE_ENV_VAR = 'RUN_LIVE_COMPANY_PAYMENT';

/** Presence-only check — never reads or echoes a value, only whether one
 * is set and non-empty. Exported so the test suite can assert this exact
 * fail-closed contract without needing to spawn a subprocess. */
export function hasAllRequiredCredentials(env: Record<string, string | undefined>): boolean {
  return REQUIRED_ENV_VARS.every((name) => typeof env[name] === 'string' && env[name]!.length > 0);
}

/** Service- and amount-specific — a generic "yes"/"I understand" string
 * (or the confirmation for a DIFFERENT service/amount) must not satisfy
 * this. No standing authorization: this env var must be set fresh for
 * this specific run; nothing in this script treats its own prior
 * invocation, this repo-only checkpoint, or test configuration as
 * financial authorization (§7). */
export function hasExplicitLiveConfirmation(env: Record<string, string | undefined>): boolean {
  return env[LIVE_CONFIRMATION_ENV_VAR] === LIVE_CONFIRMATION_VALUE;
}

function runVitest(testFile: string, extraEnv: Record<string, string>): number {
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', testFile],
    { stdio: 'inherit', env: { ...process.env, ...extraEnv } }
  );
  return result.status ?? 1;
}

function main(): number {
  const mode = process.argv[2];
  const testFile = 'apps/edge-api/tests/live/company-paid-e2e-local.test.ts';

  if (mode !== 'dry-run' && mode !== 'live') {
    console.error(
      '[company-paid-e2e] usage: tsx scripts/company-paid-e2e.ts <dry-run|live>\n' +
        '  dry-run — safe, no credentials required, no signing, no network payment.\n' +
        '  live    — REAL MONEY. Requires credentials + explicit service/amount-specific confirmation env var.'
    );
    return 1;
  }

  if (mode === 'dry-run') {
    console.error(
      '[company-paid-e2e] running dry-run checks (state machine, economic/service rejection ' +
        'matrix, canonical-body freeze, CLI gating). No live network 402, no signing, no submission.'
    );
    return runVitest(testFile, {});
  }

  // mode === 'live'
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `[company-paid-e2e] missing required environment variable(s): ${missing.join(', ')}\n` +
        '[company-paid-e2e] set them in your local shell before running live mode.'
    );
    return 1;
  }
  if (!hasExplicitLiveConfirmation(process.env)) {
    console.error(
      '[company-paid-e2e] refusing to run live: this spends real USDC on Base mainnet ' +
        'to pay for exactly one company_evidence_graph.v2 request.\n' +
        `[company-paid-e2e] set ${LIVE_CONFIRMATION_ENV_VAR}=${LIVE_CONFIRMATION_VALUE}\n` +
        '[company-paid-e2e] SUN-1222C-COMPANY-E2E-HARNESS does not itself authorize this — a ' +
        'separate, standalone financial authorization for this exact service/amount is required first.'
    );
    return 1;
  }

  console.error(
    '[company-paid-e2e] credentials present and live confirmation set (values not shown). ' +
      'Running the one-shot company_evidence_graph.v2 payment via vitest...'
  );
  return runVitest(testFile, { [RUN_LIVE_ENV_VAR]: '1' });
}

// `file://${process.argv[1]}` breaks on any path containing characters
// `pathToFileURL` percent-encodes (e.g. a space in the repo's own
// directory name) — use the same encoding on both sides of the comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
