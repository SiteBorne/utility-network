/**
 * SUN-1221C — bundle integration for web_context_verified.v2 / CDP behind
 * `PAID_ROUTES_ENABLED` + `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`. Mirrors
 * `production-verify-v2-cdp-route.test.ts` exactly: proves the
 * integration point itself (disabled -> 404 with zero dependency
 * construction; enabled + invalid config -> the existing governed 503;
 * activation independent of the first service's own flag) -- does not
 * re-prove web_context_verified's own fetch/PCC/receipt logic, proven
 * separately in `web-context-v2-cdp-composition.test.ts` and
 * `dns-rebinding.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { webContextVerifiedV2CdpProductionRoute } from './production-web-context-v2-cdp-route';
import { verifyAgentOutputV2CdpProductionRoute } from './production-verify-v2-cdp-route';
import * as composition from '../production/web-context-v2-cdp-composition';

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
  app.all('/v2/web/context', webContextVerifiedV2CdpProductionRoute);
  app.all('/v2/verify/agent-output', verifyAgentOutputV2CdpProductionRoute);
  return app;
}

describe('webContextVerifiedV2CdpProductionRoute (integration point only)', () => {
  it('returns 404 when PAID_ROUTES_ENABLED is absent (current/default state)', async () => {
    const app = appWithRoute();
    const res = await app.request('/v2/web/context', { method: 'POST' }, baseEnv());
    expect(res.status).toBe(404);
  });

  it('returns 404 when PAID_ROUTES_ENABLED is any value other than the exact string "true"', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/web/context',
      { method: 'POST' },
      baseEnv({ PAID_ROUTES_ENABLED: 'yes' })
    );
    expect(res.status).toBe(404);
  });

  it('never calls the production composition builder while disabled (zero dependency construction)', async () => {
    const spy = vi.spyOn(composition, 'buildWebContextV2CdpProductionRouteConfig');
    const app = appWithRoute();
    await app.request('/v2/web/context', { method: 'POST' }, baseEnv());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('global=true, route-specific=absent -> 404, zero dependency construction', async () => {
    const spy = vi.spyOn(composition, 'buildWebContextV2CdpProductionRouteConfig');
    const app = appWithRoute();
    const res = await app.request(
      '/v2/web/context',
      { method: 'POST' },
      baseEnv({ PAID_ROUTES_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('global=false, route-specific=true -> 404 (the global master switch is checked first, unconditionally)', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/web/context',
      { method: 'POST' },
      baseEnv({ WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
  });

  it('global=true, route-specific=true, then global flipped back to false -> immediate 404 (kill switch still works)', async () => {
    const app = appWithRoute();
    const enabledRes = await app.request(
      '/v2/web/context',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv({ PAID_ROUTES_ENABLED: 'true', WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(enabledRes.status).toBe(503); // no signing key configured in baseEnv -> unavailable
    const disabledRes = await app.request(
      '/v2/web/context',
      { method: 'POST' },
      baseEnv({ PAID_ROUTES_ENABLED: 'false', WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(disabledRes.status).toBe(404);
  });

  it('enabled + missing signing private key -> the existing governed unavailable response, before economics', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/web/context',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv({
        PAID_ROUTES_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
        PAID_RECEIPT_SIGNING_KEY_ID: 'kid_prod0123456789abcdefghij',
      })
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('service_executor_not_configured');
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
  });

  it('enabled + missing DB -> the existing governed unavailable response', async () => {
    const app = appWithRoute();
    const validHex = '2'.repeat(64);
    const res = await app.request(
      '/v2/web/context',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv({
        PAID_ROUTES_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: validHex,
        PAID_RECEIPT_SIGNING_KEY_ID: 'kid_prod0123456789abcdefghij',
        DB: undefined as unknown as Env['DB'],
      })
    );
    expect(res.status).toBe(503);
  });

  it('activating web_context_verified.v2 does not activate verify_agent_output.v2, and vice versa (route isolation)', async () => {
    const app = appWithRoute();
    const webCtxOnly = baseEnv({
      PAID_ROUTES_ENABLED: 'true',
      WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
      // VERIFY_V2_CDP_ROUTE_ENABLED deliberately absent
    });
    const verifyRes = await app.request(
      '/v2/verify/agent-output',
      { method: 'POST' },
      webCtxOnly
    );
    expect(verifyRes.status).toBe(404);

    const verifyOnly = baseEnv({
      PAID_ROUTES_ENABLED: 'true',
      VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
      // WEB_CONTEXT_V2_CDP_ROUTE_ENABLED deliberately absent
    });
    const webCtxRes = await app.request('/v2/web/context', { method: 'POST' }, verifyOnly);
    expect(webCtxRes.status).toBe(404);
  });

  it('never imports a fixture signer, fixture registry, or fixture composition (structural, import-lines only)', () => {
    const path = fileURLToPath(
      new URL('./production-web-context-v2-cdp-route.ts', import.meta.url)
    );
    const source = readFileSync(path, 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    expect(importLines).not.toMatch(/createFixtureSigner|buildFixtureRegistry|test-signer/);
  });
});
