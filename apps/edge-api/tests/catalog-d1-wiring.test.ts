/**
 * SUN-1100 checkpoint 1: `GET /catalog`/`GET /services/:service_id` were
 * unconditionally wired to the module-level in-memory repository — always
 * empty on a real Worker isolate (nothing ever writes to it). The real D1
 * `services` table was never read, so the public catalog endpoint returned
 * 200 with `services: []` despite real seeded data existing. Confirmed live
 * against https://utility.siteborne.net/catalog before this fix.
 *
 * Proves the fix: when `env.DB` is present (every real deployment), `/catalog`
 * reads from it; when absent (existing tests with no D1 binding), it falls
 * back to the in-memory repository unchanged.
 *
 * CATALOG-ROUTE-PARITY-01 update: `/catalog`'s list membership is now driven
 * by `CATALOG_SERVICE_IDS` (the real mounted `/v2/...`/`/v3/...` routes),
 * never by "every row the D1 `services` table happens to contain" — a `.v1`
 * row (like this fixture's original `company_evidence_graph.v1`) no longer
 * appears in the response at all, since `index.ts` hard-404s every `/v1/*`
 * path. The fixture below now seeds a real routable `.v2` id instead, and
 * proves D1 is still genuinely consulted by asserting the catalog entry
 * carries the D1 row's own `title` (a field `/catalog` never re-derives from
 * the registry when a D1 row exists) rather than the registry's default.
 */
import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { app } from '../src/index';
import { CATALOG_SERVICE_IDS } from '../src/control-plane/routes/catalog';

const SERVICE_ROW = {
  id: 'company_evidence_graph.v2',
  version: '2.0.0',
  title: 'D1-SOURCED-TITLE',
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
  it('GET /catalog with env.DB present surfaces the real D1-backed row, not the registry default', async () => {
    const res = await app.request('/catalog', {}, { DB: createFakeD1WithOneService() } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      services: Array<{ service_id: string; title: string }>;
    };
    // List membership is CATALOG_SERVICE_IDS, independent of what the D1
    // fixture returns -- proven separately by CATALOG-ROUTE-PARITY-01's own
    // suite. This test's job is narrower: prove D1 IS consulted.
    expect(body.services.length).toBe(CATALOG_SERVICE_IDS.length);
    const entry = body.services.find((s) => s.service_id === 'company_evidence_graph.v2');
    expect(entry).toBeDefined();
    expect(entry?.title).toBe('D1-SOURCED-TITLE');
  });

  it('GET /services/:service_id with env.DB present resolves from D1', async () => {
    const res = await app.request('/services/company_evidence_graph.v2', {}, {
      DB: createFakeD1WithOneService(),
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service_id: string };
    expect(body.service_id).toBe('company_evidence_graph.v2');
  });

  it('GET /catalog without env.DB falls back to the in-memory repository, still listing CATALOG_SERVICE_IDS from the registry defaults', async () => {
    const res = await app.request('/catalog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { services: Array<{ service_id: string }> };
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services.length).toBe(CATALOG_SERVICE_IDS.length);
  });
});
