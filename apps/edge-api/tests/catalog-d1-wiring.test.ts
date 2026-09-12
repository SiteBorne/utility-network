/**
 * SUN-1100 checkpoint 1: `GET /catalog`/`GET /services/:service_id` were
 * unconditionally wired to the module-level in-memory repository — always
 * empty on a real Worker isolate (nothing ever writes to it). The real D1
 * `services` table (seeded with 8 rows per SUN-0800B checkpoint 3) was never
 * read, so the public catalog endpoint returned 200 with `services: []`
 * despite real seeded data existing. Confirmed live against
 * https://utility.siteborne.net/catalog before this fix.
 *
 * Proves the fix: when `env.DB` is present (every real deployment), `/catalog`
 * reads from it; when absent (existing tests with no D1 binding), it falls
 * back to the in-memory repository unchanged.
 */
import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { app } from '../src/index';

const SERVICE_ROW = {
  id: 'company_evidence_graph.v1',
  version: '1.0.0',
  title: 'Company Evidence Graph',
  description: 'Verify company evidence',
  input_schema: 'schema',
  output_schema: 'schema',
  price_usd: '0.039',
  production_enabled: 0,
  production_ready: 0,
  protocol_status: 'preproduction',
};

function createFakeD1WithOneService(): D1Database {
  const prepare = (sql: string) => ({
    bind: (..._params: unknown[]) => ({
      all: async () => {
        if (sql.includes('FROM services')) {
          return { success: true, results: [SERVICE_ROW] };
        }
        return { success: true, results: [] };
      },
      run: async () => ({ success: true, results: [], meta: { changes: 0, last_row_id: 0 } }),
    }),
    all: async () => {
      if (sql.includes('FROM services')) {
        return { success: true, results: [SERVICE_ROW] };
      }
      return { success: true, results: [] };
    },
  });
  return {
    prepare,
    exec: async () => ({ count: 0, duration: 0 }),
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true, results: [] })),
    dump: async () => new Uint8Array(),
  } as unknown as D1Database;
}

describe('SUN-1100 checkpoint 1 — /catalog reads from D1 when the binding is present', () => {
  it('GET /catalog with env.DB present returns the real D1-backed service, not an empty in-memory list', async () => {
    const res = await app.request('/catalog', {}, { DB: createFakeD1WithOneService() } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { services: Array<{ service_id: string }> };
    expect(body.services.length).toBe(1);
    expect(body.services[0].service_id).toBe('company_evidence_graph.v1');
  });

  it('GET /services/:service_id with env.DB present resolves from D1', async () => {
    const res = await app.request('/services/company_evidence_graph.v1', {}, {
      DB: createFakeD1WithOneService(),
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service_id: string };
    expect(body.service_id).toBe('company_evidence_graph.v1');
  });

  it('GET /catalog without env.DB falls back to the empty in-memory repository (existing test behavior)', async () => {
    const res = await app.request('/catalog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { services: unknown[] };
    expect(Array.isArray(body.services)).toBe(true);
  });
});
