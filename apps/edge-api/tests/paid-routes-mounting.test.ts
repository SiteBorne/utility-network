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

  it('PAID_ROUTES_ENABLED=true with no D1 binding -> 500 configuration_error, never silently mounted', async () => {
    const res = await app.request(
      '/v1/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { PAID_ROUTES_ENABLED: 'true' } as never
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('configuration_error');
  });

  it('PAID_ROUTES_ENABLED=false (explicitly disabled) -> /v1/* is still a plain 404', async () => {
    const res = await app.request(
      '/v1/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { PAID_ROUTES_ENABLED: 'false' } as never
    );
    expect(res.status).toBe(404);
  });
});
