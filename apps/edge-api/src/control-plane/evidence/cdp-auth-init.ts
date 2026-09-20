/**
 * FIRST-PAID-VERIFY-WORKER-JWT-BUNDLE-INIT-REMEDIATION-01.
 *
 * `@coinbase/cdp-sdk` declares `"sideEffects": false` in `_esm/package.json`.
 * When Wrangler/esbuild wraps `auth/utils/jwt.js` in a lazy `__esm` initialiser,
 * a static import that only references its hoisted functions
 * (`x402/facilitator.js` -> `generateJwt`) does not emit the `init_jwt()` call.
 * `generateJwt` then runs while the initialiser-assigned `getRandomValues`
 * binding (uncrypto) is still undefined, so `nonce()` throws
 * `getRandomValues is not a function` before any key handling.
 *
 * A dynamic `import()` of the SDK's public `./auth` entry is always a real,
 * awaited module load: esbuild emits the initialiser call at the import site
 * regardless of `sideEffects`, and the initialiser is idempotent, so the JWT
 * module graph (jose, uncrypto, SDK errors) is guaranteed initialised before
 * the first mint. It touches no credential, claim, algorithm, URI or header.
 */
import type { HTTPFacilitatorClient } from '@x402/core/server';

let authModule: Promise<unknown> | undefined;

/** Idempotent; a rejected load is not cached, so the next call retries. */
export function ensureCdpAuthModuleInitialized(): Promise<unknown> {
  authModule ??= import('@coinbase/cdp-sdk/auth').catch((error: unknown) => {
    authModule = undefined;
    throw error;
  });
  return authModule;
}

/**
 * Behaviour-neutral view of the facilitator client whose only difference is
 * that the JWT module graph is initialised before auth headers are built. The
 * SDK client mints its JWT for `/verify`, `/settle` and `/supported` through
 * `createAuthHeaders(path)`, so wrapping that one method covers all three.
 * Clients without `createAuthHeaders` (test doubles) are returned unchanged.
 */
export function withCdpAuthModuleInitialized(
  facilitator: HTTPFacilitatorClient
): HTTPFacilitatorClient {
  if (typeof facilitator.createAuthHeaders !== 'function') return facilitator;
  const initialized = Object.create(facilitator) as HTTPFacilitatorClient;
  initialized.createAuthHeaders = async (path: string) => {
    await ensureCdpAuthModuleInitialized();
    return facilitator.createAuthHeaders(path);
  };
  return initialized;
}
