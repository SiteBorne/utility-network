/**
 * SUN-1221E2 — thin CLI wrapper for the local-only, one-shot
 * web_context_verified.v2 first-paid-E2E client
 * (apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts).
 *
 * Structural sibling of scripts/first-paid-e2e.ts (SUN-1220J) — same
 * zero-workspace-import, shell-to-vitest pattern, same presence-only
 * credential check (never reads or echoes a value, only whether one is
 * set).
 *
 * This script does NOT authorize itself. Running it with
 * RUN_LOCAL_WEB_CONTEXT_FIRST_PAID_E2E=1 executes the one real paid
 * request authorized under SUN-1221E2's explicit human authorization for
 * exactly one web_context_verified.v2 / CDP payment (max 9000 atomic USDC,
 * Base mainnet, buyer 0x516F...ecB99, seller/payTo 0x7f44...E6E1), against
 * candidate 915be949-b46f-464b-a4d6-17b74539ce55, using the fresh 402
 * (quote_id qte_1cdda6b84605101e2787ef9d) already obtained and verified by
 * SUN-1221E2's own pre-payment gates.
 *
 * Run this yourself, in your own terminal, with CDP_API_KEY_ID /
 * CDP_API_KEY_SECRET / CDP_WALLET_SECRET set in your shell:
 *
 *   pnpm web-context-first-paid-e2e
 *
 * Per SUN-1221E2's own terms: after this returns (success, rejection, or
 * ambiguous), do not run it again — report the result back so production
 * can be restored immediately.
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
      `[web-context-first-paid-e2e] missing required environment variable(s): ${missing.join(', ')}\n` +
        '[web-context-first-paid-e2e] set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET ' +
        'in your local shell before running this tool.'
    );
    return 1;
  }

  console.error(
    '[web-context-first-paid-e2e] credentials present (values not shown). ' +
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
      'apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        RUN_LOCAL_WEB_CONTEXT_FIRST_PAID_E2E: '1',
      },
    }
  );

  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
