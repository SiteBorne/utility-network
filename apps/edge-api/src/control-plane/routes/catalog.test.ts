/**
 * SUN-1222C2-CANDIDATE-DISCOVERY-ECONOMICS-RECONCILIATION regression test.
 *
 * Root cause proven live against production D1 during this checkpoint:
 * `seedServices` inserts each service's `price_usd` into D1 exactly once
 * and never updates it (a `UNIQUE constraint` on re-seed is treated as a
 * no-op). When SUN-1000 checkpoint 1M / SUN-1222C-R3 later reduced the
 * `.v2` services' governed price in `REGISTRY_SERVICES`, the already-seeded
 * D1 rows kept their original (higher) price forever — `/catalog` and
 * `/services/:service_id` read `price_usd` straight from that stale row,
 * while the real x402 `PaymentRequirements` challenge (governed by
 * `REGISTRY_SERVICES` directly, not D1) already charged the correct,
 * lower, current price. This test seeds D1 with exactly that
 * pre-price-freeze state and proves both discovery routes now advertise
 * the governed price instead.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { REGISTRY_SERVICES } from '@siteborne/protocol-x402';
import { getGovernedMetadata } from '@siteborne/service-runtime';
import type { Env } from '../config/env';
import { D1ServicesRepository } from '../repositories/d1/services';
import { catalogRoute, serviceMetadataRoute } from './catalog';

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

function appWithRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('servicesRepo', new D1ServicesRepository(c.env.DB as unknown as D1Database));
    await next();
  });
  app.route('/catalog', catalogRoute);
  app.route('/services', serviceMetadataRoute);
  return app;
}

describe('catalog/service-detail price overlay (D1 price_usd drift)', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  const STALE_PRE_FREEZE_PRICE = '0.039';
  const GOVERNED_PRICE = REGISTRY_SERVICES['company_evidence_graph.v2'].maximum_price.amount;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-catalog-price-overlay-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await runMigrations(db);
    // Reproduces the real pre-freeze seed exactly: a `.v2` row inserted
    // with the (now stale) price that predates the governed price
    // reduction, never updated since.
    await db
      .prepare(
        `INSERT INTO services (id, version, title, description, input_schema, output_schema, price_usd, production_enabled, production_ready, protocol_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'company_evidence_graph.v2',
        'v2',
        'Company Evidence Graph',
        'test fixture',
        '{}',
        '{}',
        STALE_PRE_FREEZE_PRICE,
        0,
        0,
        'preproduction'
      )
      .run();
  });

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sanity: the fixture price actually differs from the governed price', () => {
    expect(GOVERNED_PRICE).not.toBe(STALE_PRE_FREEZE_PRICE);
  });

  it('GET /catalog advertises the governed price, not the stale D1 value', async () => {
    const app = appWithRoutes();
    const res = await app.request('/catalog', {}, { DB: db } as unknown as Env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { services: Array<{ service_id: string; price_usd: string }> };
    const entry = body.services.find((s) => s.service_id === 'company_evidence_graph.v2');
    expect(entry).toBeDefined();
    expect(entry?.price_usd).toBe(GOVERNED_PRICE);
    expect(entry?.price_usd).not.toBe(STALE_PRE_FREEZE_PRICE);
  });

  it('GET /services/:service_id advertises the governed price, not the stale D1 value', async () => {
    const app = appWithRoutes();
    const res = await app.request(
      '/services/company_evidence_graph.v2',
      {},
      { DB: db } as unknown as Env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { price_usd: string };
    expect(body.price_usd).toBe(GOVERNED_PRICE);
    expect(body.price_usd).not.toBe(STALE_PRE_FREEZE_PRICE);
  });
});

describe('CATALOG-HETEROGENEOUS-VERSION-SEMANTICS-01: per-service contract_release/pcc_version', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-catalog-heterogeneous-version-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await runMigrations(db);
    const repo = new D1ServicesRepository(db);
    // One real Catalog response listing two DIFFERENT service generations of
    // the same capability side by side -- the exact shape that makes a
    // single document-wide contract_release/pcc_version claim provably
    // false, since v2 and v3 are governed to different values (see
    // packages/service-runtime/src/pcc/governed-metadata.ts's V2_RELEASE vs
    // V3_RELEASE, and each registry file's own `pcc_version`).
    for (const serviceId of ['company_evidence_graph.v2', 'company_evidence_graph.v3'] as const) {
      const entry = REGISTRY_SERVICES[serviceId];
      const result = await repo.create({
        service_id: serviceId,
        version: entry.service_version,
        title: entry.title,
        description: entry.description,
        input_schema: entry.input_schema_uri,
        output_schema: entry.output_schema_uri,
        price_usd: entry.maximum_price.amount,
        production_enabled: false,
        production_ready: false,
        protocol_status: 'preproduction',
      });
      expect(result.ok).toBe(true);
    }
  });

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sanity: v2 and v3 are governed to different contract_release and pcc_version', () => {
    const v2 = getGovernedMetadata('company_evidence_graph.v2');
    const v3 = getGovernedMetadata('company_evidence_graph.v3');
    expect(v2.contractRelease).not.toBe(v3.contractRelease);
    expect(REGISTRY_SERVICES['company_evidence_graph.v2'].pcc_version).not.toBe(
      REGISTRY_SERVICES['company_evidence_graph.v3'].pcc_version
    );
  });

  it('GET /catalog gives each service its OWN contract_release and pcc_version, not one shared value', async () => {
    const app = appWithRoutes();
    const res = await app.request('/catalog', {}, { DB: db } as unknown as Env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      services: Array<{ service_id: string; contract_release?: string; pcc_version?: string }>;
      contract_release: string;
      pcc_version: string;
    };

    const v2Entry = body.services.find((s) => s.service_id === 'company_evidence_graph.v2');
    const v3Entry = body.services.find((s) => s.service_id === 'company_evidence_graph.v3');
    expect(v2Entry).toBeDefined();
    expect(v3Entry).toBeDefined();

    const v2Governed = getGovernedMetadata('company_evidence_graph.v2');
    const v3Governed = getGovernedMetadata('company_evidence_graph.v3');

    // This is the fixture that fails against the old flat-global behavior:
    // before this fix, neither entry carried a contract_release/pcc_version
    // field at all, and the only values present anywhere in the response
    // were the single document-level '1.0.0'/'1.0.0' literals -- which would
    // have silently equalled v2's real value here (masking the defect for a
    // v1/v2-only response) while being flatly wrong for v3.
    expect(v2Entry?.contract_release).toBe(v2Governed.contractRelease);
    expect(v3Entry?.contract_release).toBe(v3Governed.contractRelease);
    expect(v2Entry?.contract_release).not.toBe(v3Entry?.contract_release);

    expect(v2Entry?.pcc_version).toBe(REGISTRY_SERVICES['company_evidence_graph.v2'].pcc_version);
    expect(v3Entry?.pcc_version).toBe(REGISTRY_SERVICES['company_evidence_graph.v3'].pcc_version);
    expect(v2Entry?.pcc_version).not.toBe(v3Entry?.pcc_version);

    // The document-level fields remain present (non-breaking) but now
    // describe only the response envelope itself, never claimed as either
    // service's own contract_release/pcc_version.
    expect(body.contract_release).toBe('1.0.0');
    expect(body.pcc_version).toBe('1.0.0');
  });
});
