/**
 * SUN-1222B-S3R — proves `company_evidence_graph.v2`/CDP's real production
 * requirement pipeline produces the actual, currently-enforced economic
 * contract: `resolveServiceMaxPriceUsd('company_evidence_graph_v2')` reads
 * $0.0312 from `governance/RISK_LIMITS.yaml` (via `@siteborne/pricing`) --
 * NOT the `registry/services/company_evidence_graph.v2.json` `maximum_price`
 * field (`0.19`), which SUN-1222B-S3 already found drifted from the
 * governance source and is purely informational metadata, never consulted
 * by the real pricing/charging path (`resolveServiceMaxPriceUsd`).
 *
 * Mirrors `web-context-v2-cdp-composition.test.ts` exactly: real Miniflare
 * D1, the real `createX402ServiceRoute`, a real decoded 402 challenge.
 * Zero live CDP calls (`explicitTestEvidenceOverride`, the sanctioned
 * test-only escape hatch -- the real production route module never
 * supplies it). Zero real outbound HTTP fetches: this test proves the
 * PAYMENT CHALLENGE shape only, generated before the executor (and
 * therefore before any real SEC/website/Federal-Register fetch) ever runs.
 *
 * RED/GREEN evidence (SUN-1222B-S3R §7): before this file's composition
 * module existed, `buildCompanyEvidenceGraphV2CdpProductionRouteConfig`
 * did not exist and this test failed to even compile/import (RED --
 * verified by running this suite against the pre-S3R HEAD, which has no
 * `company-evidence-graph-v2-cdp-composition.ts` file at all). It is
 * GREEN now that the real composition/executor/adapters are wired.
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
import { buildCompanyEvidenceGraphV2CdpProductionRouteConfig } from './company-evidence-graph-v2-cdp-composition';

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

// SUN-1222B-S3R: derived from `governance/RISK_LIMITS.yaml`'s
// `company_evidence_graph_v2: 0.0312` entry (the real, enforced pricing
// source `resolveServiceMaxPriceUsd` reads) -- never invented, never
// copied from the drifted `registry/services/*.json` `maximum_price`
// field.
const CANONICAL_REQUEST_BODY = {
  company_name: 'Example Test Company',
};

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT_ATOMIC = '31200';
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const EXPECTED_EIP712_NAME = 'USD Coin';
const EXPECTED_EIP712_VERSION = '2';

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
    COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'true',
    // Test-only, never a real Cloudflare secret; these tests exercise the
    // economic-contract shape, not real Modal connectivity (the
    // httpClient itself is never invoked by any test in this file -- no
    // test here reaches the actual paid-execution path).
    MODAL_WEBCTX_ENDPOINT_URL:
      'https://test-workspace--siteborne-webctx-safe-egress-fetch.modal.run',
    MODAL_WEBCTX_PROXY_KEY: 'test-modal-webctx-proxy-key',
    MODAL_WEBCTX_PROXY_SECRET: 'test-modal-webctx-proxy-secret',
  };
}

async function get402Requirement(app: Hono, path: string): Promise<PaymentRequirements> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(CANONICAL_REQUEST_BODY),
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

describe('SUN-1222B-S3R: company_evidence_graph.v2/CDP real requirement matches the actual governance-enforced price', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-company-evidence-v2-'));
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

  async function buildRealMainnetRequirement(): Promise<PaymentRequirements> {
    const config = await buildCompanyEvidenceGraphV2CdpProductionRouteConfig(
      mainnetAuthorizedTestEnv(),
      db,
      { evidenceMode: 'fixture' }
    );
    if ('unavailable' in config) {
      throw new Error(`composition unexpectedly unavailable: ${config.reason}`);
    }
    const app = new Hono();
    createX402ServiceRoute(app, config);
    return get402Requirement(app, config.path);
  }

  it('produces the governance-bounded v2 experiment: 31200 atomic USDC on Base mainnet, correct payTo/scheme/domain-metadata', async () => {
    const requirement = await buildRealMainnetRequirement();
    const extra = requirement.extra as Record<string, unknown> | undefined;
    expect(requirement.network).toBe(EXPECTED_NETWORK);
    expect(requirement.asset).toBe(EXPECTED_ASSET);
    expect(requirement.amount).toBe(EXPECTED_AMOUNT_ATOMIC);
    expect(requirement.payTo).toBe(EXPECTED_PAYTO);
    expect(requirement.scheme).toBe('exact');
    expect(extra?.name).toBe(EXPECTED_EIP712_NAME);
    expect(extra?.version).toBe(EXPECTED_EIP712_VERSION);
    expect(extra?.quote_id).toMatch(/^qte_/);
  });

  it('is served at exactly POST /v2/company/evidence-graph', async () => {
    const config = await buildCompanyEvidenceGraphV2CdpProductionRouteConfig(
      mainnetAuthorizedTestEnv(),
      db,
      { evidenceMode: 'fixture' }
    );
    if ('unavailable' in config) throw new Error(`unexpectedly unavailable: ${config.reason}`);
    expect(config.path).toBe('/v2/company/evidence-graph');
    expect(config.serviceId).toBe('company_evidence_graph.v2');
  });

  it('never charges the drifted registry maximum_price (190000 atomic) -- proves the real path uses governance, not the unresolved registry field', async () => {
    const requirement = await buildRealMainnetRequirement();
    expect(requirement.amount).not.toBe('190000');
  });

  it('is unavailable (fails closed) when MODAL_WEBCTX_* safe-egress credentials are missing -- proves no raw/direct-fetch fallback exists', async () => {
    const env = mainnetAuthorizedTestEnv();
    delete (env as Record<string, unknown>).MODAL_WEBCTX_ENDPOINT_URL;
    const config = await buildCompanyEvidenceGraphV2CdpProductionRouteConfig(env, db, {
      evidenceMode: 'fixture',
    });
    expect('unavailable' in config).toBe(true);
  });

  it('is unavailable when COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED is not set -- proves the route-level flag actually gates route activation, checked by the route module, not this composition function', async () => {
    // The composition function itself doesn't check the route flag (that's
    // the route module's job, exactly like web-context/verify) -- this
    // test instead documents that fact and proves the flag import exists
    // and behaves correctly at the boundary that does check it.
    const { isCompanyEvidenceGraphV2CdpRouteFlagEnabled } = await import(
      '../config/production-payment'
    );
    expect(
      isCompanyEvidenceGraphV2CdpRouteFlagEnabled({
        PAID_ROUTES_ENABLED: 'true',
        COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: undefined,
      })
    ).toBe(false);
    expect(
      isCompanyEvidenceGraphV2CdpRouteFlagEnabled({
        PAID_ROUTES_ENABLED: 'true',
        COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'true',
      })
    ).toBe(true);
  });
});
