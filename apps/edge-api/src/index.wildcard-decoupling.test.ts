/**
 * SUN-1218 checkpoint X — proves the `/v1/*` and `/v2/*` wildcard
 * fallbacks (the 7 unsupported, no-real-executor routes: v1 company/
 * web/document/verify + v2 company/web/document) are now unconditional
 * 404s, independent of `PAID_ROUTES_ENABLED` -- the exact contradiction
 * this checkpoint resolves. Also proves the 4 Nevermined routes (a
 * genuinely separate flag) are unaffected by every state this
 * checkpoint's own truth table exercises.
 */
import { describe, expect, it } from 'vitest';
import { app } from './index';
import type { Env } from './control-plane/config/env';

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

const WILDCARD_COVERED_ROUTES = [
  '/v1/company/evidence-graph',
  '/v1/web/context',
  '/v1/document/evidence-json',
  '/v1/verify/agent-output',
  '/v2/company/evidence-graph',
  '/v2/web/context',
  '/v2/document/evidence-json',
];

const NEVERMINED_ROUTES = [
  '/v2/nevermined/company/evidence-graph',
  '/v2/nevermined/web/context',
  '/v2/nevermined/document/evidence-json',
  '/v2/nevermined/verify/agent-output',
];

const postInit = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
} as const;

describe('SUN-1218: /v1/* and /v2/* wildcards are unconditional 404, decoupled from PAID_ROUTES_ENABLED', () => {
  it.each(WILDCARD_COVERED_ROUTES)('%s: PAID_ROUTES_ENABLED absent -> 404', async (route) => {
    const res = await app.request(route, postInit, baseEnv());
    expect(res.status).toBe(404);
  });

  it.each(WILDCARD_COVERED_ROUTES)(
    '%s: PAID_ROUTES_ENABLED=true -> STILL 404 (the exact contradiction resolved)',
    async (route) => {
      const res = await app.request(route, postInit, baseEnv({ PAID_ROUTES_ENABLED: 'true' }));
      expect(res.status).toBe(404);
    }
  );

  it.each(WILDCARD_COVERED_ROUTES)(
    '%s: both PAID_ROUTES_ENABLED and VERIFY_V2_CDP_ROUTE_ENABLED true -> STILL 404 (only the exact verify route is gated by these flags)',
    async (route) => {
      const res = await app.request(
        route,
        postInit,
        baseEnv({ PAID_ROUTES_ENABLED: 'true', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
      );
      expect(res.status).toBe(404);
    }
  );

  it.each(NEVERMINED_ROUTES)(
    '%s: unaffected by PAID_ROUTES_ENABLED/VERIFY_V2_CDP_ROUTE_ENABLED -- stays 404 (separate, untouched flag)',
    async (route) => {
      const res = await app.request(
        route,
        postInit,
        baseEnv({ PAID_ROUTES_ENABLED: 'true', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
      );
      expect(res.status).toBe(404);
    }
  );

  it.each(NEVERMINED_ROUTES)(
    '%s: NEVERMINED_ROUTES_ENABLED=true still reaches the existing governed 503 (that flag itself is untouched by this checkpoint)',
    async (route) => {
      const res = await app.request(
        route,
        postInit,
        baseEnv({ NEVERMINED_ROUTES_ENABLED: 'true' })
      );
      expect(res.status).toBe(503);
    }
  );
});
