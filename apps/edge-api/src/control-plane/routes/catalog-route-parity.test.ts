/**
 * CATALOG-ROUTE-PARITY-01 regression suite.
 *
 * Root cause proven by the R3 A1 per-service qualification audit
 * (docs/development/R3_A1_PER_SERVICE_QUALIFICATION_2026-09-25.md §12):
 * `/catalog` previously listed whatever rows happened to exist in the D1
 * `services` table, an out-of-band seed with no code-level relationship to
 * either the real mounted Hono routes (`index.ts`) or `/openapi.json`'s own
 * service list. That drifted seed advertised four dead `.v1` identities
 * (`index.ts` hard-404s every `/v1/*` path) and omitted all four live `.v3`
 * candidate identities (real `POST /v3/...` routes that already appear in
 * `/openapi.json`).
 *
 * This suite locks three-way parity between:
 *   1. `CATALOG_SERVICE_IDS` (catalog.ts's own list-membership authority)
 *   2. the real Hono routes mounted on the production `app` (index.ts)
 *   3. `/openapi.json`'s own `x-service-id`-tagged operations
 * and proves `GET /catalog` actually serves that same set, independent of
 * whatever the D1 `services` table does or doesn't contain — so a future
 * drift between the mounted routes and the catalog list fails a test here
 * instead of silently reaching production.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  ALL_BAZAAR_SERVICE_IDS,
  V2_PAID_SERVICE_IDS,
  V3_CANDIDATE_SERVICE_IDS,
  resolveServiceRoute,
} from '@siteborne/protocol-x402';
import { app } from '../../index';
import type { Env } from '../config/env';
import { CATALOG_SERVICE_IDS } from './catalog';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../migrations', import.meta.url));

async function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }
}

function baseEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
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

interface CatalogResponseBody {
  services: Array<{ service_id: string; production_enabled: boolean }>;
}

interface OpenApiOperationLike {
  'x-service-id'?: string;
}

interface OpenApiResponseBody {
  paths: Record<string, Record<string, OpenApiOperationLike>>;
}

function extractOpenApiServiceIds(openapi: OpenApiResponseBody): string[] {
  const ids: string[] = [];
  for (const methods of Object.values(openapi.paths)) {
    for (const operation of Object.values(methods)) {
      const id = operation['x-service-id'];
      if (id) ids.push(id);
    }
  }
  return ids;
}

describe('CATALOG-ROUTE-PARITY-01: CATALOG_SERVICE_IDS matches the real mounted routes', () => {
  it('excludes every dead .v1 identity (index.ts hard-404s /v1/*)', () => {
    const v1Ids = ALL_BAZAAR_SERVICE_IDS.filter((id) => id.endsWith('.v1'));
    expect(v1Ids.length).toBeGreaterThan(0);
    for (const id of v1Ids) {
      expect(CATALOG_SERVICE_IDS).not.toContain(id);
    }
  });

  it('includes all 4 live .v3 candidate identities', () => {
    for (const id of V3_CANDIDATE_SERVICE_IDS) {
      expect(CATALOG_SERVICE_IDS).toContain(id);
    }
  });

  it('includes all 4 live .v2 paid identities', () => {
    for (const id of V2_PAID_SERVICE_IDS) {
      expect(CATALOG_SERVICE_IDS).toContain(id);
    }
  });

  it('is exactly V2_PAID_SERVICE_IDS + V3_CANDIDATE_SERVICE_IDS, no more, no fewer', () => {
    expect([...CATALOG_SERVICE_IDS].sort()).toEqual(
      [...V2_PAID_SERVICE_IDS, ...V3_CANDIDATE_SERVICE_IDS].sort()
    );
    expect(CATALOG_SERVICE_IDS.length).toBe(8);
  });

  it.each(CATALOG_SERVICE_IDS)(
    '%s: has a real, non-wildcard route mounted on the production app',
    (serviceId) => {
      const route = resolveServiceRoute(serviceId);
      const exactMatch = app.routes.find(
        (r) => r.method === route.method && r.path === route.path
      );
      expect(exactMatch).toBeDefined();
    }
  );

  it.each(ALL_BAZAAR_SERVICE_IDS.filter((id) => id.endsWith('.v1')))(
    '%s: has NO exact route mounted -- only the /v1/* 404 wildcard covers it',
    (serviceId) => {
      const route = resolveServiceRoute(serviceId);
      const exactMatch = app.routes.find(
        (r) => r.method === route.method && r.path === route.path && r.path !== '/v1/*'
      );
      expect(exactMatch).toBeUndefined();
    }
  );
});

describe('CATALOG-ROUTE-PARITY-01: GET /catalog vs GET /openapi.json vs mounted routes', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-catalog-route-parity-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await runMigrations(db);
    // Deliberately NO seeding here (unlike catalog.test.ts's price-drift
    // fixture): this is the exact "D1 table doesn't know about a service
    // yet" case that used to make a live .v3 identity vanish from
    // /catalog -- the assertions below prove it no longer does.
  });

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /catalog lists exactly CATALOG_SERVICE_IDS, even with an empty D1 services table', async () => {
    const res = await app.request('/catalog', {}, baseEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogResponseBody;
    const catalogIds = body.services.map((s) => s.service_id).sort();
    expect(catalogIds).toEqual([...CATALOG_SERVICE_IDS].sort());
  });

  it('GET /catalog never advertises production_enabled=true for a service with no production executor (e.g. every .v3)', async () => {
    const res = await app.request('/catalog', {}, baseEnv(db));
    const body = (await res.json()) as CatalogResponseBody;
    for (const id of V3_CANDIDATE_SERVICE_IDS) {
      const entry = body.services.find((s) => s.service_id === id);
      expect(entry).toBeDefined();
      expect(entry?.production_enabled).toBe(false);
    }
  });

  it('GET /catalog and GET /openapi.json advertise the exact same service_id set (CATALOG_OPENAPI_PARITY)', async () => {
    const [catalogRes, openapiRes] = await Promise.all([
      app.request('/catalog', {}, baseEnv(db)),
      app.request('/openapi.json', {}, baseEnv(db)),
    ]);
    expect(catalogRes.status).toBe(200);
    expect(openapiRes.status).toBe(200);

    const catalogBody = (await catalogRes.json()) as CatalogResponseBody;
    const openapiBody = (await openapiRes.json()) as OpenApiResponseBody;

    const catalogIds = [...new Set(catalogBody.services.map((s) => s.service_id))].sort();
    const openapiIds = [...new Set(extractOpenApiServiceIds(openapiBody))].sort();

    expect(catalogIds).toEqual(openapiIds);
  });
});
