/**
 * SUN-1216 checkpoint V — proves the integration point in the actual
 * production entrypoint (`index.ts`), not just the isolated route
 * module: the new `POST /v2/verify/agent-output` registration claims
 * only the method/path it is supposed to, the other 11 paid routes and
 * both Nevermined route families are provably unchanged, and the
 * default-disabled 404 behavior for the new route matches every other
 * paid route exactly.
 */
import { describe, expect, it } from 'vitest';
import app from './index';
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

const OTHER_ELEVEN_PAID_ROUTES = [
  '/v1/company/evidence-graph',
  '/v1/web/context',
  '/v1/document/evidence-json',
  '/v1/verify/agent-output',
  '/v2/company/evidence-graph',
  '/v2/web/context',
  '/v2/document/evidence-json',
  '/v2/nevermined/company/evidence-graph',
  '/v2/nevermined/web/context',
  '/v2/nevermined/document/evidence-json',
  '/v2/nevermined/verify/agent-output',
];

describe('index.ts — SUN-1216 integration point', () => {
  it('POST /v2/verify/agent-output is 404 by default (PAID_ROUTES_ENABLED absent)', async () => {
    const res = await app.request(
      '/v2/verify/agent-output',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv()
    );
    expect(res.status).toBe(404);
  });

  it('SUN-1218: POST /v2/verify/agent-output global=true, route-specific=absent -> 404 (the exact contradiction this checkpoint resolves)', async () => {
    const res = await app.request(
      '/v2/verify/agent-output',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv({ PAID_ROUTES_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
  });

  it('SUN-1218: POST /v2/verify/agent-output global=false, route-specific=true -> 404 (master kill switch checked first)', async () => {
    const res = await app.request(
      '/v2/verify/agent-output',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv({ VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
  });

  it("POST /v2/verify/agent-output both gates enabled + no signing secrets -> the existing governed 503, matching every other paid route's unavailable disposition", async () => {
    const res = await app.request(
      '/v2/verify/agent-output',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv({ PAID_ROUTES_ENABLED: 'true', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('service_executor_not_configured');
  });

  it('does not claim non-POST methods on /v2/verify/agent-output — GET still falls through to the untouched /v2/* wildcard', async () => {
    const disabledRes = await app.request('/v2/verify/agent-output', { method: 'GET' }, baseEnv());
    expect(disabledRes.status).toBe(404);

    const enabledRes = await app.request(
      '/v2/verify/agent-output',
      { method: 'GET' },
      baseEnv({ PAID_ROUTES_ENABLED: 'true', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    // SUN-1218: the generic /v2/* wildcard is now unconditionally 404
    // (decoupled from PAID_ROUTES_ENABLED, see index.wildcard-decoupling.test.ts)
    // -- proving GET was never claimed by the new POST-only route
    // registration, not merely that it produces some other non-405 status.
    expect(enabledRes.status).toBe(404);
  });

  const postInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  } as const;

  it.each(OTHER_ELEVEN_PAID_ROUTES)(
    'other paid route %s: disabled -> 404 (unchanged wildcard behavior)',
    async (route) => {
      const res = await app.request(route, postInit, baseEnv());
      expect(res.status).toBe(404);
    }
  );

  it.each(OTHER_ELEVEN_PAID_ROUTES)(
    // SUN-1218: nevermined routes still reach the existing governed 503
    // when their own (untouched) flag is true; the 7 non-nevermined
    // routes are now unconditionally 404 (see
    // index.wildcard-decoupling.test.ts for the full decoupling proof)
    // -- disclosed, intentional change from the pre-SUN-1218 behavior.
    'other paid route %s: enabled -> correct disposition for its own route family',
    async (route) => {
      if (route.includes('/nevermined/')) {
        const res = await app.request(
          route,
          postInit,
          baseEnv({ NEVERMINED_ROUTES_ENABLED: 'true' })
        );
        expect(res.status).toBe(503);
      } else {
        const res = await app.request(
          route,
          postInit,
          baseEnv({ PAID_ROUTES_ENABLED: 'true', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
        );
        expect(res.status).toBe(404);
      }
    }
  );
});
