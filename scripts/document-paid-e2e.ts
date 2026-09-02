/**
 * SUN-1222C-R3B — thin CLI wrapper for the mainnet, one-shot
 * `document_evidence_json.v2` `upto` qualification client
 * (apps/edge-api/tests/live/document-paid-e2e-mainnet.test.ts).
 *
 * Same zero-workspace-import, shell-to-vitest pattern as
 * `scripts/first-paid-e2e.ts` and `scripts/nevermined-recover.ts` (see
 * those files' own doc comments for the confirmed root cause: a bare
 * `tsx` invocation of this repo's own workspace packages does not
 * resolve `@siteborne/*` transitive deps correctly). This script never
 * imports `@coinbase/cdp-sdk`, `@x402/evm`, or `@siteborne/protocol-x402`
 * itself — it only checks *presence* (never the values) of the required
 * credential env vars, then shells out to vitest, which resolves the
 * real workspace aliases correctly.
 *
 * Two independent modes, matching the two-stage design SUN-1222C-R3B
 * requires:
 *
 *   inspect  — safe by default. Runs only the always-on, non-live test
 *              suite inside the target file (network/asset/payTo/scheme
 *              locks, Permit2 allowance-read-only reporting). Requires
 *              no credentials and performs no signing.
 *
 *   live     — requires every credential below AND
 *              `SITEBORNE_LIVE_DOCUMENT_PAYMENT_CONFIRMATION=I_UNDERSTAND_THIS_SPENDS_REAL_USDC_ON_BASE_MAINNET`
 *              to be set, in addition to `RUN_LIVE_DOCUMENT_PAYMENT=1`.
 *              SUN-1222C-R3B itself does NOT authorize running this —
 *              invoking `live` requires a separate, later, standalone
 *              financial authorization (mirrors `first-paid-e2e.ts`'s own
 *              boundary).
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED_ENV_VARS = [
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
  'CDP_WALLET_SECRET',
  'SELLER_WALLET_ADDRESS',
] as const;

const LIVE_CONFIRMATION_VALUE = 'I_UNDERSTAND_THIS_SPENDS_REAL_USDC_ON_BASE_MAINNET';

/** Presence-only check — never reads or echoes a value, only whether one
 * is set and non-empty. */
export function hasAllRequiredCredentials(env: Record<string, string | undefined>): boolean {
  return REQUIRED_ENV_VARS.every((name) => typeof env[name] === 'string' && env[name]!.length > 0);
}

export function hasExplicitLiveConfirmation(env: Record<string, string | undefined>): boolean {
  return env.SITEBORNE_LIVE_DOCUMENT_PAYMENT_CONFIRMATION === LIVE_CONFIRMATION_VALUE;
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
  const testFile = 'apps/edge-api/tests/live/document-paid-e2e-mainnet.test.ts';

  if (mode !== 'inspect' && mode !== 'live') {
    console.error(
      '[document-paid-e2e] usage: tsx scripts/document-paid-e2e.ts <inspect|live>\n' +
        '  inspect — safe, no credentials required, no signing, no network mutation.\n' +
        '  live    — MAINNET REAL MONEY. Requires credentials + explicit confirmation env var.'
    );
    return 1;
  }

  if (mode === 'inspect') {
    console.error(
      '[document-paid-e2e] running inspect-only checks (network/asset/payTo/scheme locks, ' +
        'read-only Permit2 allowance reporting). No signing, no submission.'
    );
    return runVitest(testFile, {});
  }

  // mode === 'live'
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `[document-paid-e2e] missing required environment variable(s): ${missing.join(', ')}\n` +
        '[document-paid-e2e] set them in your local shell before running live mode.'
    );
    return 1;
  }
  if (!hasExplicitLiveConfirmation(process.env)) {
    console.error(
      '[document-paid-e2e] refusing to run live: this spends real USDC on Base mainnet.\n' +
        `[document-paid-e2e] set SITEBORNE_LIVE_DOCUMENT_PAYMENT_CONFIRMATION=${LIVE_CONFIRMATION_VALUE}\n` +
        '[document-paid-e2e] SUN-1222C-R3B does not itself authorize this — a separate, ' +
        'standalone financial authorization is required first.'
    );
    return 1;
  }

  console.error(
    '[document-paid-e2e] credentials present and live confirmation set (values not shown). ' +
      'Running the mainnet-gated live test via vitest...'
  );
  return runVitest(testFile, { RUN_LIVE_DOCUMENT_PAYMENT: '1' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
