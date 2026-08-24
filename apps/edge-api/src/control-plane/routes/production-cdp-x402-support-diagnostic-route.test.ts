/**
 * SUN-1219B — TEMPORARY_VALIDATION_INSTRUMENTATION test coverage for
 * `production-cdp-x402-support-diagnostic-route.ts`. Proves: the gate is
 * single, dedicated, and fail-closed; a successful provider call yields
 * a fully redacted response; a failed/erroring provider call fails
 * closed with a fixed, sanitized error string; and the route
 * structurally never reaches `verify`, `settle`, or any account/signer
 * capability -- the mocked facilitator's `verify`/`settle` throw if
 * called at all, so any accidental wiring fails the test immediately.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../config/env';

const capturedFacilitatorArgs: unknown[] = [];
let getSupportedImpl: () => Promise<unknown> = async () => ({
  kinds: [],
  extensions: [],
  signers: {},
});

vi.mock('@coinbase/cdp-sdk/x402', () => ({
  createCdpFacilitatorClient: (...args: unknown[]) => {
    capturedFacilitatorArgs.push(args);
    return {
      getSupported: () => getSupportedImpl(),
      verify: async () => {
        throw new Error('structural violation: diagnostic route must never call verify()');
      },
      settle: async () => {
        throw new Error('structural violation: diagnostic route must never call settle()');
      },
    };
  },
}));

import { cdpX402SupportDiagnosticRoute } from './production-cdp-x402-support-diagnostic-route';

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

function appWithRoute(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get('/diagnostics/cdp-x402-supported', cdpX402SupportDiagnosticRoute);
  return app;
}

describe('cdpX402SupportDiagnosticRoute', () => {
  beforeEach(() => {
    capturedFacilitatorArgs.length = 0;
    getSupportedImpl = async () => ({ kinds: [], extensions: [], signers: {} });
  });

  it('returns 404 when the gate is absent (current/default state, including production)', async () => {
    const app = appWithRoute();
    const res = await app.request('/diagnostics/cdp-x402-supported', {}, baseEnv());
    expect(res.status).toBe(404);
    expect(capturedFacilitatorArgs).toHaveLength(0);
  });

  it('returns 404 when the gate is any value other than the exact string "true"', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED: 'yes' })
    );
    expect(res.status).toBe(404);
    expect(capturedFacilitatorArgs).toHaveLength(0);
  });

  it('is not reachable via PAID_ROUTES_ENABLED or VERIFY_V2_CDP_ROUTE_ENABLED alone', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ PAID_ROUTES_ENABLED: 'true', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
    expect(capturedFacilitatorArgs).toHaveLength(0);
  });

  it('gate=true + facilitator advertises Base mainnet upto -> redacted success, base_mainnet_supported=true', async () => {
    getSupportedImpl = async () => ({
      kinds: [
        { x402Version: 2, scheme: 'upto', network: 'eip155:8453', extra: { facilitatorAddress: '0x' + 'a'.repeat(40) } },
      ],
      extensions: [],
      signers: {},
    });
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED: 'true' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      authentication_succeeded: true,
      base_mainnet_supported: true,
    });
  });

  it('gate=true + facilitator does not advertise Base mainnet -> base_mainnet_supported=false, still authenticated', async () => {
    getSupportedImpl = async () => ({
      kinds: [{ x402Version: 2, scheme: 'upto', network: 'eip155:84532', extra: {} }],
      extensions: [],
      signers: {},
    });
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED: 'true' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      authentication_succeeded: true,
      base_mainnet_supported: false,
    });
  });

  it('provider/authentication failure -> fails closed with a fixed, sanitized error, never the raw error', async () => {
    getSupportedImpl = async () => {
      throw new Error(
        'Unauthorized: Authorization header Bearer eyJhbGciOi... rejected for key cdp-key-id'
      );
    };
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED: 'true' })
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      authentication_succeeded: false,
      base_mainnet_supported: false,
      error: 'diagnostic provider call failed',
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('cdp-key-id');
    expect(raw).not.toContain('Bearer');
    expect(raw).not.toContain('Authorization');
  });

  it('missing CDP credentials -> 503, fails closed without constructing a facilitator client', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED: 'true', CDP_API_KEY_ID: '', CDP_API_KEY_SECRET: '' })
    );
    expect(res.status).toBe(503);
    expect(capturedFacilitatorArgs).toHaveLength(0);
  });

  it('response never includes the advertised kinds list, a facilitator address, or any credential field', async () => {
    getSupportedImpl = async () => ({
      kinds: [
        { x402Version: 2, scheme: 'upto', network: 'eip155:8453', extra: { facilitatorAddress: '0x' + 'b'.repeat(40) } },
      ],
      extensions: [],
      signers: {},
    });
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED: 'true' })
    );
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['authentication_succeeded', 'base_mainnet_supported', 'ok']);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('facilitatorAddress');
    expect(raw).not.toContain('kinds');
    expect(raw).not.toContain('cdp-key-id');
    expect(raw).not.toContain('cdp-key-secret');
  });

  it('the mocked facilitator verify()/settle() are structurally never invoked by any path through this route', async () => {
    // Both success and failure branches above already exercise
    // getSupported() only; this test makes the invariant explicit: the
    // mock's verify/settle throw immediately if ever called, and no
    // test in this file (covering every reachable branch) ever
    // triggers that throw as an unexpected failure.
    getSupportedImpl = async () => ({ kinds: [], extensions: [], signers: {} });
    const app = appWithRoute();
    const res = await app.request(
      '/diagnostics/cdp-x402-supported',
      {},
      baseEnv({ CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED: 'true' })
    );
    expect(res.status).toBe(200);
  });
});
