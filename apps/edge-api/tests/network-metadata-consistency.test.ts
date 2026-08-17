/**
 * SUN-1000 checkpoint 1O-A — network/metadata consistency gate (§11/§17).
 *
 * Proves the real, payment-executing v2 HTTP route (`paid-services.ts`'s
 * `v2CdpRoute()`) and the corresponding Bazaar discovery declaration
 * (`buildSiteborneDiscoveryDeclaration`, driven by `BAZAAR_PAYMENT_POLICY`)
 * agree on which network a buyer must pay on -- a real buyer's client must
 * never see "route = Sepolia, discovery metadata = mainnet" (or vice
 * versa) for the same service. Both sides are checked against a real,
 * live-constructed app and a real declaration build, never a hand-typed
 * expectation of either individually.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  buildSiteborneDiscoveryDeclaration,
  decodePaymentRequiredHeaderSafe,
  type PaymentRequired,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.reduce(async (prev, file) => {
    await prev;
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
  }, Promise.resolve());
}

const V2_ROUTES: Record<SiteborneServiceId, { path: string; input: unknown }> = {
  'company_evidence_graph.v2': {
    path: '/v2/company/evidence-graph',
    input: {
      identifiers: { cik: '0000320193' },
      requested_field_groups: ['identity', 'sec_submissions'],
    },
  },
  'web_context_verified.v2': {
    path: '/v2/web/context',
    input: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
  },
  'document_evidence_json.v2': {
    path: '/v2/document/evidence-json',
    input: {
      artifact_reference: {
        artifact_id: 'doc/native-fixture.pdf',
        media_type: 'application/pdf',
        size_bytes: 1,
      },
    },
  },
  'verify_agent_output.v2': {
    path: '/v2/verify/agent-output',
    input: {
      verification_contract: {
        claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
        deterministic_requirements: [],
      },
      candidate_output: { total: 42 },
      required_schema: {},
      verification_mode: 'standard',
    },
  },
} as unknown as Record<SiteborneServiceId, { path: string; input: unknown }>;

describe('SUN-1000 checkpoint 1O-A — v2 route/Bazaar network consistency', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  let app: Awaited<ReturnType<typeof buildPaidServicesApp>>;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-network-consistency-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    app = await buildPaidServicesApp({ db, evidenceMode: 'fixture' });
  }, 30_000);

  afterAll(async () => {
    await mf?.dispose();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it.each(Object.entries(V2_ROUTES) as [SiteborneServiceId, { path: string; input: unknown }][])(
    '%s: the real 402 challenge network matches the Bazaar discovery declaration network',
    async (serviceId, route) => {
      const res = await app.request(route.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(route.input),
      });
      expect(res.status).toBe(402);
      const decoded = decodePaymentRequiredHeaderSafe(res.headers.get('PAYMENT-REQUIRED') ?? '');
      expect(decoded.ok).toBe(true);
      const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
      const routeNetwork = challenge.accepts[0].network;

      const declaration = await buildSiteborneDiscoveryDeclaration({
        serviceId,
        nowIso: '2026-01-01T00:00:00.000Z',
        expiresInSeconds: 300,
        maxTimeoutSeconds: 30,
      });
      const declarationNetwork = declaration.accepts[0].network;

      expect(routeNetwork).toBe(declarationNetwork);
    }
  );
});
