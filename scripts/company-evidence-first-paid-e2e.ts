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
 * candidate efc5a287-d807-4b07-957f-ebbdf471e439. The 402 challenge is
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
