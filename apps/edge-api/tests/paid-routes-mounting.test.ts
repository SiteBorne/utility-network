/**
 * SUN-0700A checkpoint 5, directive §6/§32: the local x402 paid-service
 * routes must never be reachable by default — no default configuration
 * may accidentally enable payment execution.
 */
import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('paid-service route mounting gate (directive §6, §32)', () => {
  it('PAID_ROUTES_ENABLED unset (the default in every environment today) -> /v1/* is a plain 404', async () => {
    const res = await app.request('/v1/company/evidence-graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('PAID_ROUTES_ENABLED=true still fails before economics when no production executor exists', async () => {
    const res = await app.request(
      '/v1/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { PAID_ROUTES_ENABLED: 'true' } as never
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('service_executor_not_configured');
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
  });

  it('PAID_ROUTES_ENABLED=false (explicitly disabled) -> /v1/* is still a plain 404', async () => {
    const res = await app.request(
      '/v1/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { PAID_ROUTES_ENABLED: 'false' } as never
    );
    expect(res.status).toBe(404);
  });

  it('production Worker with paid routes enabled but no authenticated CDP provider fails closed instead of serving fixture economics', async () => {
    const res = await app.request(
      '/v1/company/evidence-graph',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identifiers: { cik: '0000320193' },
          requested_field_groups: ['identity'],
        }),
      },
      {
        ENVIRONMENT: 'production',
        PAID_ROUTES_ENABLED: 'true',
        DB: {} as never,
      } as never
    );

    expect(res.status).toBe(503);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'service_executor_not_configured' });
  });

  it('Nevermined routes are absent by default and fail closed without an authenticated provider', async () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    };
    expect((await app.request('/v1/nevermined/company/evidence-graph', request)).status).toBe(404);
    const enabled = await app.request('/v1/nevermined/company/evidence-graph', request, {
      NEVERMINED_ROUTES_ENABLED: 'true',
    } as never);
    expect(enabled.status).toBe(503);
    expect(await enabled.json()).toMatchObject({ error: 'service_executor_not_configured' });
  });
});

describe('SUN-1000 checkpoint 1O-B2 — v2 CDP/Nevermined route mounting gates', () => {
  it('PAID_ROUTES_ENABLED unset -> /v2/* is a plain 404 (matches /v1/* default behavior)', async () => {
    const res = await app.request('/v2/company/evidence-graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('PAID_ROUTES_ENABLED=true still fails before economics when no production executor exists', async () => {
    const res = await app.request(
      '/v2/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { PAID_ROUTES_ENABLED: 'true' } as never
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('service_executor_not_configured');
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
  });

  it('/v2/nevermined/* is absent by default (NEVERMINED_ROUTES_ENABLED unset) -> 404', async () => {
    const res = await app.request('/v2/nevermined/company/evidence-graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('/v2/nevermined/* with NEVERMINED_ROUTES_ENABLED=true but no NVM credential -> 503, never a fixture fallback', async () => {
    const res = await app.request(
      '/v2/nevermined/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { NEVERMINED_ROUTES_ENABLED: 'true', DB: {} as never } as never
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'service_executor_not_configured' });
  });

  it('/v2/nevermined/* with credentials present but RUN_LIVE_NEVERMINED unset -> 503 (the future-live guard denies construction, never silently proceeds)', async () => {
    const res = await app.request(
      '/v2/nevermined/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      {
        NEVERMINED_ROUTES_ENABLED: 'true',
        DB: {} as never,
        NVM_API_KEY: 'sandbox:not-a-real-key',
        NVM_ENVIRONMENT: 'sandbox',
        // RUN_LIVE_NEVERMINED deliberately absent
      } as never
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'service_executor_not_configured' });
  });

  it('/v2/nevermined/* with NVM_ENVIRONMENT=live -> 503 (live environment hard-rejected, even with RUN_LIVE_NEVERMINED=1)', async () => {
    const res = await app.request(
      '/v2/nevermined/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      {
        NEVERMINED_ROUTES_ENABLED: 'true',
        DB: {} as never,
        NVM_API_KEY: 'sandbox:not-a-real-key',
        NVM_ENVIRONMENT: 'live',
        RUN_LIVE_NEVERMINED: '1',
      } as never
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'service_executor_not_configured' });
  });
});
