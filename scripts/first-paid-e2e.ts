/**
 * SUN-1220J — thin CLI wrapper for the local-only, one-shot first-paid-E2E
 * client (apps/edge-api/tests/live/first-paid-e2e-local.test.ts).
 *
 * Same zero-workspace-import, shell-to-vitest pattern as
 * scripts/nevermined-recover.ts and scripts/cdp-buyer-signer-capability-check.ts
 * (a bare `tsx` invocation of this repo's own workspace packages does not
 * resolve `@siteborne/*` transitive deps correctly — see those two files'
 * own doc comments for the confirmed root cause). This script never imports
 * `@coinbase/cdp-sdk`, `@x402/evm`, or `@siteborne/protocol-x402` itself —
 * it only checks *presence* (never the values) of the three required CDP
 * credential env vars, then shells out to vitest, which resolves the real
 * workspace aliases correctly.
 *
 * SUN-1220J itself does NOT authorize running this live — invoking it with
 * RUN_LOCAL_FIRST_PAID_E2E=1 requires a separate, later authorization.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED_ENV_VARS = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'] as const;

/** Presence-only check — never reads or echoes a value, only whether one
 * is set and non-empty. Exported so the test suite can assert this exact
 * fail-closed contract without needing to spawn a subprocess. */
export function hasAllRequiredCredentials(env: Record<string, string | undefined>): boolean {
  return REQUIRED_ENV_VARS.every((name) => typeof env[name] === 'string' && env[name]!.length > 0);
}

function main(): number {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    // Never print or persist any value — only the NAMES of what's absent.
    console.error(
      `[first-paid-e2e] missing required environment variable(s): ${missing.join(', ')}\n` +
        '[first-paid-e2e] set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET ' +
        'in your local shell before running this tool.'
    );
    return 1;
  }

  console.error(
    '[first-paid-e2e] credentials present (values not shown). ' +
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
      'apps/edge-api/tests/live/first-paid-e2e-local.test.ts',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        RUN_LOCAL_FIRST_PAID_E2E: '1',
      },
    }
  );

  return result.status ?? 1;
}

// `file://${process.argv[1]}` breaks on any path containing characters
// `pathToFileURL` percent-encodes (e.g. a space in the repo's own
// directory name) — use the same encoding on both sides of the comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
