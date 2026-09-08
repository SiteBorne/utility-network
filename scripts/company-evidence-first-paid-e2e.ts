/**
 * SUN-1222C2-Q1 — thin CLI wrapper for the local-only, one-shot
 * company_evidence_graph.v2 first-paid-E2E client
 * (apps/edge-api/tests/live/company-evidence-first-paid-e2e-local.test.ts).
 *
 * Structural sibling of scripts/first-paid-e2e.ts (SUN-1220J) and
 * scripts/web-context-first-paid-e2e.ts (SUN-1221E2) — same
 * zero-workspace-import, shell-to-vitest pattern, same presence-only
 * credential check (never reads or echoes a value, only whether one is
 * set).
 *
 * This script does NOT authorize itself. Running it with
 * RUN_LOCAL_COMPANY_EVIDENCE_FIRST_PAID_E2E=1 executes the one real paid
 * request authorized under SUN-1222C2-Q1's explicit human authorization
 * for exactly one company_evidence_graph.v2 / CDP payment (31200 atomic
 * USDC, Base mainnet, buyer 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99,
 * seller/payTo 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1), against
 * candidate a064477f-7b74-46c5-a5b6-799df114b252 (SUN-1222C-Q1R2-
 * CANDIDATE-REFRESH, carrying the R1/R2/R3 fixes). The 402 challenge is
 * fetched fresh, atomically, inside this one run — never a pre-fetched or
 * reused quote — so it can never expire between preparation and
 * submission.
 *
 * Run this yourself, in your own terminal, with CDP_API_KEY_ID /
 * CDP_API_KEY_SECRET / CDP_WALLET_SECRET set in your shell:
 *
 *   pnpm company-evidence-first-paid-e2e
 *
 * Per SUN-1222C2-Q1's own terms: after this returns (success, rejection,
 * or ambiguous), do not run it again — report the result back so
 * read-only reconciliation can proceed. No retry, no second attempt,
 * regardless of outcome.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED_ENV_VARS = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'] as const;

export function hasAllRequiredCredentials(env: Record<string, string | undefined>): boolean {
  return REQUIRED_ENV_VARS.every((name) => typeof env[name] === 'string' && env[name]!.length > 0);
}

// SUN-1222C-R6: candidate targeting is no longer a hardcoded literal in the
// test file this script drives -- it must be supplied explicitly here too,
// read fresh from live deployment state, never carried over from a
// previous run.
const CANDIDATE_VERSION_ENV_VAR = 'COMPANY_EVIDENCE_CANDIDATE_VERSION_ID';

function main(): number {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `[company-evidence-first-paid-e2e] missing required environment variable(s): ${missing.join(', ')}\n` +
        '[company-evidence-first-paid-e2e] set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET ' +
        'in your local shell before running this tool.'
    );
    return 1;
  }
  if (!process.env[CANDIDATE_VERSION_ENV_VAR]) {
    console.error(
      `[company-evidence-first-paid-e2e] missing required environment variable: ${CANDIDATE_VERSION_ENV_VAR}\n` +
        '[company-evidence-first-paid-e2e] set it to the exact candidate version under qualification, ' +
        'read fresh from `wrangler deployments list --name siteborne-utility-edge` -- ' +
        "never assume a previous run's candidate is still current (SUN-1222C-R5/R6)."
    );
    return 1;
  }

  console.error(
    '[company-evidence-first-paid-e2e] credentials present (values not shown). ' +
      'Running the local-only, credential-gated live test via vitest...'
  );

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      'apps/edge-api/tests/live/company-evidence-first-paid-e2e-local.test.ts',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        RUN_LOCAL_COMPANY_EVIDENCE_FIRST_PAID_E2E: '1',
      },
    }
  );

  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
