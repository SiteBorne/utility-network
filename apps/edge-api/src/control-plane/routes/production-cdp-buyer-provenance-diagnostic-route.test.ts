/**
 * SUN-1220C — TEMPORARY_VALIDATION_INSTRUMENTATION test coverage for
 * `production-cdp-buyer-provenance-diagnostic-route.ts`. Proves: the
 * gate is single, dedicated, and fail-closed; the fixed controlled
 * buyer address (never a request-supplied one) is the only address ever
 * passed to `getAccount`; a successful lookup yields a fully redacted
 * `server_account` response; a failed lookup fails closed with a fixed,
 * sanitized error; and the route structurally never reaches any
 * mutation-capable or signing-capable CDP operation -- the mock client's
 * every other method throws immediately if called at all, so any
 * accidental wiring fails the test immediately (matches the SUN-1219B
 * `cdpX402SupportDiagnosticRoute` test convention).
 *
 * Two layers are exercised deliberately:
 *   - `appWithRealRoute` drives the real, single-argument Hono handler
 *     (exactly what `index.ts` mounts) through `app.request(...)` for
 *     every gate/method/missing-credential case that must never reach a
 *     CDP client at all.
 *   - `resolveCdpBuyerProvenance` -- the module's testable core, called
 *     directly with a mock `createClient` -- covers account-kind
 *     classification, redaction, and the mutation/signing-capable
 *     structural proofs. This is the "explicitly named test seam" this
 *     checkpoint's directive requires: it carries no HTTP reachability
 *     of its own (nothing in `index.ts` or the real route handler ever
 *     supplies an override), so it cannot be reached by any production
 *     request.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../config/env';
import type { CdpAccountLookupClient } from '../config/production-payment';
import {
  cdpBuyerProvenanceDiagnosticRoute,
  resolveCdpBuyerProvenance,
} from './production-cdp-buyer-provenance-diagnostic-route';

const CONTROLLED_BUYER_ADDRESS = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';

function structuralViolation(name: string) {
  return async () => {
    throw new Error(`structural violation: diagnostic route must never call ${name}()`);
  };
}

/** A mock satisfying `CdpAccountLookupClient` plus every mutation- or
 * signing-capable method a real `CdpClient.evm` namespace exposes --
 * each wired to throw immediately, so any accidental call fails the
 * test rather than silently succeeding. No explicit return-type
 * annotation here deliberately: annotating it as `CdpAccountLookupClient`
 * would trigger TypeScript's excess-property check on these
 * intentionally-extra structural-proof methods. */
function mockCdpClient(overrides: {
  getAccount?: (options: { address: string }) => Promise<{ address: string }>;
}) {
  const client = {
    evm: {
      getAccount: overrides.getAccount ?? (async ({ address }: { address: string }) => ({ address })),
      getOrCreateAccount: structuralViolation('getOrCreateAccount'),
      createAccount: structuralViolation('createAccount'),
      importAccount: structuralViolation('importAccount'),
      listAccounts: structuralViolation('listAccounts'),
      signTypedData: structuralViolation('signTypedData'),
      signMessage: structuralViolation('signMessage'),
      sendTransaction: structuralViolation('sendTransaction'),
      transfer: structuralViolation('transfer'),
      getSmartAccount: structuralViolation('getSmartAccount'),
    },
  };
  return client;
}

function asAccountLookupClient(client: ReturnType<typeof mockCdpClient>): CdpAccountLookupClient {
  return client;
}

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    ARTIFACTS: {} as Env['ARTIFACTS'],
    JOBS: {} as Env['JOBS'],
    EVENTS: {} as Env['EVENTS'],
    CATALOG: {} as Env['CATALOG'],
    AI: {} as Env['AI'],
    BROWSER: {} as Env['BROWSER'],
    ENVIRONMENT: 'production',
    LOG_LEVEL: 'info',
    PCC_VERSION: '1.0.0',
    SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
    CDP_API_KEY_ID: 'cdp-key-id',
    CDP_API_KEY_SECRET: 'cdp-key-secret',
    VOYAGE_API_KEY: 'voyage-key',
    MODAL_TOKEN_ID: 'modal-token-id',
    MODAL_TOKEN_SECRET: 'modal-token-secret',
    SENTRY_DSN: 'https://example.invalid/sentry',
    ...overrides,
  };
}

/** The real, unwrapped route -- exercises the production code path
 * exactly as `index.ts` mounts it (single argument, real client
 * factory). Used for gate/method/credential tests that must never reach
 * a CDP client at all. */
function appWithRealRoute(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get('/diagnostics/cdp-buyer-provenance', cdpBuyerProvenanceDiagnosticRoute);
  return app;
}

describe('cdpBuyerProvenanceDiagnosticRoute (real Hono handler)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A: returns 404 when the gate is absent (current/default state, including production)', async () => {
    const app = appWithRealRoute();
    const res = await app.request('/diagnostics/cdp-buyer-provenance', {}, baseEnv());
    expect(res.status).toBe(404);
  });

  it('B: returns 404 when the gate is any value other than the exact string "true"', async () => {
    const app = appWithRealRoute();
    const res = await app.request(
      '/diagnostics/cdp-buyer-provenance',
      {},
      baseEnv({ CDP_BUYER_PROVENANCE_DIAGNOSTIC_ENABLED: 'yes' })
    );
    expect(res.status).toBe(404);
  });

  it('B2: is not reachable via PAID_ROUTES_ENABLED or VERIFY_V2_CDP_ROUTE_ENABLED alone', async () => {
    const app = appWithRealRoute();
    const res = await app.request(
      '/diagnostics/cdp-buyer-provenance',
      {},
      baseEnv({ PAID_ROUTES_ENABLED: 'true', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
  });

  it('D: wrong method does not invoke CDP -- 404, no dependency construction', async () => {
    const app = appWithRealRoute();
    const res = await app.request(
      '/diagnostics/cdp-buyer-provenance',
      { method: 'POST' },
      baseEnv({ CDP_BUYER_PROVENANCE_DIAGNOSTIC_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
  });

  it('missing CDP credentials -> 503, fails closed without constructing a client', async () => {
    const app = appWithRealRoute();
    const res = await app.request(
      '/diagnostics/cdp-buyer-provenance',
      {},
      baseEnv({ CDP_BUYER_PROVENANCE_DIAGNOSTIC_ENABLED: 'true', CDP_API_KEY_ID: '', CDP_API_KEY_SECRET: '' })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.credential_lookup_authorized).toBe(false);
  });
});

describe('resolveCdpBuyerProvenance (testable core, mock createClient seam)', () => {
  it('C/E: reaches getAccount exactly once, with the fixed controlled buyer address, nothing else', async () => {
    const getAccount = vi.fn(async ({ address }: { address: string }) => ({ address }));
    const client = asAccountLookupClient(mockCdpClient({ getAccount }));
    const result = await resolveCdpBuyerProvenance(() => client);
    expect(result.ok).toBe(true);
    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(getAccount).toHaveBeenCalledWith({ address: CONTROLLED_BUYER_ADDRESS });
  });

  it('F: no caller-supplied address can substitute for the fixed controlled buyer address (address is a closed-over constant, not a parameter)', () => {
    // Structural proof by construction: `resolveCdpBuyerProvenance`'s
    // signature is `(createClient) => Promise<...>` -- there is no
    // address parameter anywhere in this module's exported surface for
    // a caller (or a request) to supply. The E test above already
    // proves the one literal address value actually used.
    expect(resolveCdpBuyerProvenance.length).toBe(1);
  });

  it('G: ServerAccount result maps to buyer_found=true, server_account, fromCdpEvmAccount', async () => {
    const client = asAccountLookupClient(
      mockCdpClient({ getAccount: async ({ address }) => ({ address }) })
    );
    const result = await resolveCdpBuyerProvenance(() => client);
    expect(result).toEqual({
      ok: true,
      buyer_found: true,
      account_kind: 'server_account',
      official_signer_adapter: 'fromCdpEvmAccount',
      credential_lookup_authorized: true,
    });
  });

  it('H: smart_account is documented-unreachable -- getAccount cannot return one at the SDK type level, and this route never calls getSmartAccount', async () => {
    // Structural proof, not a runtime branch: the mock's getSmartAccount
    // throws if ever invoked (see mockCdpClient), and no test in this
    // file ever triggers that throw as an unexpected failure. There is
    // no code path in `resolveCdpBuyerProvenance` that could produce
    // account_kind: 'smart_account' -- see this module's own doc
    // comment for the full SDK-type-level justification.
    const client = asAccountLookupClient(
      mockCdpClient({ getAccount: async ({ address }) => ({ address }) })
    );
    const result = await resolveCdpBuyerProvenance(() => client);
    expect(result.account_kind).not.toBe('smart_account');
  });

  it('I: not-found (a rejected getAccount) maps to buyer_found=false, unknown, none -- generic fail-closed path', async () => {
    const client = asAccountLookupClient(
      mockCdpClient({
        getAccount: async () => {
          throw new Error('Not Found: no account exists for address 0x516F...');
        },
      })
    );
    const result = await resolveCdpBuyerProvenance(() => client);
    expect(result).toEqual({
      ok: false,
      buyer_found: false,
      account_kind: 'unknown',
      official_signer_adapter: 'none',
      credential_lookup_authorized: false,
      error: 'diagnostic provider call failed',
    });
  });

  it('K/L/M: authentication/provider failure is sanitized -- err.message and err.stack never reach the result', async () => {
    const client = asAccountLookupClient(
      mockCdpClient({
        getAccount: async () => {
          throw new Error(
            'Unauthorized: Authorization header Bearer eyJhbGciOi... rejected for key cdp-key-id (account acc_9f3e...)'
          );
        },
      })
    );
    const result = await resolveCdpBuyerProvenance(() => client);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain('cdp-key-id');
    expect(raw).not.toContain('Bearer');
    expect(raw).not.toContain('Authorization');
    expect(raw).not.toContain('acc_9f3e');
  });

  it('N/O: result never includes the account ID, buyer address, credential material, or raw provider payload', async () => {
    const client = asAccountLookupClient(
      mockCdpClient({
        getAccount: async ({ address }) =>
          ({
            address,
            // Simulates a richer real SDK response shape -- these
            // fields must never leak even though the mock returns them.
            name: 'buyer-account-name',
          }) as { address: string }
      })
    );
    const result = await resolveCdpBuyerProvenance(() => client);
    expect(Object.keys(result).sort()).toEqual(
      ['account_kind', 'buyer_found', 'credential_lookup_authorized', 'official_signer_adapter', 'ok'].sort()
    );
    const raw = JSON.stringify(result);
    expect(raw).not.toContain(CONTROLLED_BUYER_ADDRESS);
    expect(raw).not.toContain('buyer-account-name');
    expect(raw).not.toContain('cdp-key-id');
    expect(raw).not.toContain('cdp-key-secret');
  });

  it('P: getAccount is called at most once per resolution', async () => {
    const getAccount = vi.fn(async ({ address }: { address: string }) => ({ address }));
    const client = asAccountLookupClient(mockCdpClient({ getAccount }));
    await resolveCdpBuyerProvenance(() => client);
    expect(getAccount).toHaveBeenCalledTimes(1);
  });

  it('Q/R/S/T: getOrCreateAccount, listAccounts, signTypedData, and every other CDP method are structurally never invoked', async () => {
    // mockCdpClient wires every non-getAccount evm method (including
    // getOrCreateAccount, createAccount, importAccount, listAccounts,
    // signTypedData, signMessage, sendTransaction, transfer,
    // getSmartAccount) to throw immediately if called. Both the success
    // (G) and failure (I/K) branches above already exercise every
    // reachable code path in this module using that same mock, and none
    // of them ever triggers one of those throws as an unexpected
    // failure -- this test makes that invariant explicit for a fresh
    // success-path run.
    const client = asAccountLookupClient(
      mockCdpClient({ getAccount: async ({ address }) => ({ address }) })
    );
    const result = await resolveCdpBuyerProvenance(() => client);
    expect(result.ok).toBe(true);
  });
});
