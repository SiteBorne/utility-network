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
      baseEnv({ PAID_ROUTES_ENABLED: 'true' })
    );
    // The generic /v2/* wildcard's own governed disposition (503), not a
    // 405 or anything the new POST-only registration would produce --
    // proving GET was never claimed by the new route.
    expect(enabledRes.status).toBe(503);
    const body = (await enabledRes.json()) as Record<string, unknown>;
    expect(body.error).toBe('service_executor_not_configured');
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
    'other paid route %s: enabled -> existing governed 503 (unchanged wildcard behavior)',
    async (route) => {
      const flagEnv = route.includes('/nevermined/')
        ? baseEnv({ NEVERMINED_ROUTES_ENABLED: 'true' })
        : baseEnv({ PAID_ROUTES_ENABLED: 'true' });
      const res = await app.request(route, postInit, flagEnv);
      expect(res.status).toBe(503);
    }
  );
});
