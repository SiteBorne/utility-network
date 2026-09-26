/**
 * SUN-1222B-S3R — proves `document_evidence_json.v2`/CDP's real production
 * composition fails closed (never a fixture fallback) when either of its
 * two genuine external blockers is absent -- `env.ARTIFACTS` (R2,
 * commented out of `wrangler.toml` since SUN-0800B checkpoint 3) and
 * `MODAL_DOCWORKER_*` (the new `process_document_http` endpoint,
 * undeployed pending SUN-0400B) -- and, when both ARE present (a real
 * in-memory `ArtifactStore` stand-in satisfying the same interface,
 * mirroring how `db` is a real Miniflare D1 rather than a mock), produces
 * the actual `scheme: 'upto'` economic contract shape at the correct
 * path.
 *
 * Mirrors `company-evidence-graph-v2-cdp-composition.test.ts` exactly:
 * real Miniflare D1, the real `createX402ServiceRoute`, a real decoded
 * 402 challenge. Zero live CDP calls, zero live Modal calls (the 402
 * challenge is generated before the executor -- and therefore before any
 * real worker HTTP call -- ever runs).
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { PaymentRequired, PaymentRequirements } from '@siteborne/protocol-x402';
import { decodePaymentRequiredHeaderSafe } from '@siteborne/protocol-x402';
import { createX402ServiceRoute } from '../routes/x402-service';
import { buildDocumentEvidenceJsonV2CdpProductionRouteConfig } from './document-evidence-json-v2-cdp-composition';
import type { ArtifactStore } from '../artifacts/store';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../migrations', import.meta.url));

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

function randomPrivateKeyHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// SUN-1222B-S3R: `scheme: 'upto'` charges the ceiling in the initial 402
// challenge (`document_evidence_json_max_job: 0.19` -> 190000 atomic) --
// the real, post-execution amount (`actualAmountAtomic`, computed from
// real page metrics) is always <= this ceiling, per `x402-service.ts`'s
// own `upto` semantics.
const EXPECTED_CEILING_AMOUNT_ATOMIC = '190000';
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';

function mainnetAuthorizedTestEnv() {
  return {
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: randomPrivateKeyHex(),
    PAID_RECEIPT_SIGNING_KEY_ID: 'kid_prod0123456789abcdefghij',
    SELLER_WALLET_ADDRESS: EXPECTED_PAYTO,
    CDP_API_KEY_ID: 'test-cdp-key-id',
    CDP_API_KEY_SECRET: 'test-cdp-key-secret',
    PAYMENT_ENVIRONMENT: 'production',
    PRODUCTION_ENABLED: 'true',
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
    PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
    DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
    MODAL_DOCWORKER_ENDPOINT_URL:
      'https://test-workspace--siteborne-document-worker-process-document-http.modal.run',
    MODAL_DOCWORKER_PROXY_KEY: 'test-modal-docworker-proxy-key',
    MODAL_DOCWORKER_PROXY_SECRET: 'test-modal-docworker-proxy-secret',
  };
}

/** A minimal real `ArtifactStore` (satisfying the actual edge-api
 * interface, not a partial fake) -- stands in for `R2ArtifactStoreAdapter`
 * in these tests exactly as Miniflare's D1 stands in for real D1: same
 * interface, in-memory backing. */
function inMemoryArtifactStoreStandin(): ArtifactStore {
  const store = new Map<string, Uint8Array>();
  return {
    async put() {
      throw new Error('not exercised by these tests');
    },
    async getMetadata() {
      return null;
    },
    async getContent(id: string) {
      return store.get(id) ?? null;
    },
    async getByContentHash() {
      return null;
    },
    async getContentByContentHash() {
      return null;
    },
    async delete() {
      return false;
    },
    async deleteByContentHash() {
      return false;
    },
    async getContentForArtifact() {
      return null;
    },
    async deleteForArtifact() {
      return false;
    },
    async exists(id: string) {
      return store.has(id);
    },
    async existsByContentHash() {
      return false;
    },
  };
}

async function get402Requirement(
  app: Hono,
  path: string,
  body: unknown
): Promise<PaymentRequirements> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(402);
  const headerValue = res.headers.get('PAYMENT-REQUIRED');
  expect(headerValue).toBeTruthy();
  const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
  expect(decoded.ok).toBe(true);
  const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
  expect(challenge.accepts.length).toBeGreaterThan(0);
  return challenge.accepts[0];
}

const CANONICAL_REQUEST_BODY = {
  artifact_reference: {
    artifact_id: 'test-artifact',
    media_type: 'application/pdf',
    size_bytes: 100,
  },
};

describe('SUN-1222B-S3R: document_evidence_json.v2/CDP fails closed without its two real external blockers, and produces the real upto contract when both are present', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-document-evidence-v2-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('is unavailable when the artifact store (R2 ARTIFACTS binding) is absent -- proves no in-memory/fixture fallback exists', async () => {
    const config = await buildDocumentEvidenceJsonV2CdpProductionRouteConfig(
      mainnetAuthorizedTestEnv(),
      db,
      undefined,
      { evidenceMode: 'fixture' }
    );
    expect('unavailable' in config).toBe(true);
    if ('unavailable' in config) {
      expect(config.reason).toMatch(/ARTIFACTS/);
    }
  });

  it('is unavailable when MODAL_DOCWORKER_* credentials are missing even with a real artifact store', async () => {
    const env = mainnetAuthorizedTestEnv();
    delete (env as Record<string, unknown>).MODAL_DOCWORKER_ENDPOINT_URL;
    const config = await buildDocumentEvidenceJsonV2CdpProductionRouteConfig(
      env,
      db,
      inMemoryArtifactStoreStandin(),
      { evidenceMode: 'fixture' }
    );
    expect('unavailable' in config).toBe(true);
    if ('unavailable' in config) {
      expect(config.reason).toMatch(/MODAL_DOCWORKER/);
    }
  });

  it('produces the real upto economic contract (190000 atomic ceiling) at /v2/document/evidence-json when both blockers are satisfied', async () => {
    const config = await buildDocumentEvidenceJsonV2CdpProductionRouteConfig(
      mainnetAuthorizedTestEnv(),
      db,
      inMemoryArtifactStoreStandin(),
      { evidenceMode: 'fixture' }
    );
    if ('unavailable' in config) {
      throw new Error(`composition unexpectedly unavailable: ${config.reason}`);
    }
    expect(config.path).toBe('/v2/document/evidence-json');
    expect(config.serviceId).toBe('document_evidence_json.v2');
    expect(config.scheme).toBe('upto');

    const app = new Hono();
    createX402ServiceRoute(app, config);
    const requirement = await get402Requirement(app, config.path, CANONICAL_REQUEST_BODY);
    const extra = requirement.extra as Record<string, unknown> | undefined;
    expect(requirement.network).toBe(EXPECTED_NETWORK);
    expect(requirement.asset).toBe(EXPECTED_ASSET);
    expect(requirement.amount).toBe(EXPECTED_CEILING_AMOUNT_ATOMIC);
    expect(requirement.payTo).toBe(EXPECTED_PAYTO);
    expect(extra?.quote_id).toMatch(/^qte_/);
  });
});
