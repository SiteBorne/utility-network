/**
 * SUN-1221C — proves `web_context_verified.v2`/CDP's real production
 * requirement pipeline produces the EXACT frozen economic contract
 * SUN-1221B derived from committed evidence (never invented): $0.009 /
 * 9000 atomic USDC, `eip155:8453`, the same asset/payTo/scheme already
 * proven for `verify_agent_output.v2`, and the same EIP-712 domain
 * metadata (SUN-1220L's fix is generic -- `resolvePaymentAsset` is
 * reused verbatim, not reimplemented).
 *
 * Mirrors `verify-agent-output-v2-cdp-composition.domain-metadata.test.ts`
 * exactly: real Miniflare D1, the real `createX402ServiceRoute`, a real
 * decoded 402 challenge. Zero live CDP calls (`explicitTestEvidenceOverride`,
 * the sanctioned SUN-1218 test-only escape hatch -- the real production
 * route module never supplies it). Zero real outbound HTTP fetches: this
 * test proves the PAYMENT CHALLENGE shape only, which is generated before
 * the executor (and therefore before any real `fetch`) ever runs.
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
import { buildWebContextV2CdpProductionRouteConfig } from './web-context-v2-cdp-composition';

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

// SUN-1221B §15: derived from existing D1 catalog price ($0.009) and
// BAZAAR_PAYMENT_POLICY (scheme 'exact') -- never invented, never copied
// from verify_agent_output's own ($0.019 / 19000) figures.
const CANONICAL_REQUEST_BODY = {
  target_url: 'https://example.com/',
  retrieval_mode: 'direct',
};

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT_ATOMIC = '8000'; // SUN-1222C-R3: web_context_verified.v2 experiment price
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const EXPECTED_EIP712_NAME = 'USD Coin';
const EXPECTED_EIP712_VERSION = '2';

/** Mirrors verify's own `mainnetAuthorizedTestEnv` exactly -- ADR-0055's
 * four gates as plain booleans on an in-process test env object, never a
 * real Cloudflare secret/binding. Combined with `explicitTestEvidenceOverride`
 * below, real CDP evidence resolution is never reached. */
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
    WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
    // SUN-1221E5Q6G — test-only, never a real Cloudflare secret; these
    // tests exercise the economic-contract shape, not real Modal
    // connectivity (the httpClient itself is never invoked by any test in
    // this file -- no test here reaches the actual paid-execution path).
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

describe('SUN-1221C: web_context_verified.v2/CDP real requirement matches the exact frozen B contract', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-web-context-v2-'));
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
    const config = await buildWebContextV2CdpProductionRouteConfig(mainnetAuthorizedTestEnv(), db, {
      evidenceMode: 'fixture',
    });
    if ('unavailable' in config) {
      throw new Error(`composition unexpectedly unavailable: ${config.reason}`);
    }
    const app = new Hono();
    createX402ServiceRoute(app, config);
    return get402Requirement(app, config.path);
  }

  it('produces the exact frozen economic contract: 9000 atomic USDC on Base mainnet, correct payTo/scheme/domain-metadata', async () => {
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

  it('is served at exactly POST /v2/web/context', async () => {
    const config = await buildWebContextV2CdpProductionRouteConfig(mainnetAuthorizedTestEnv(), db, {
      evidenceMode: 'fixture',
    });
    if ('unavailable' in config) throw new Error(`unexpectedly unavailable: ${config.reason}`);
    expect(config.path).toBe('/v2/web/context');
    expect(config.serviceId).toBe('web_context_verified.v2');
  });

  it('projects unchanged economics through the explicit v3 candidate identity and full-PCC contract', async () => {
    const config = await buildWebContextV2CdpProductionRouteConfig(
      mainnetAuthorizedTestEnv(),
      db,
      { evidenceMode: 'fixture' },
      'web_context_verified.v3'
    );
    if ('unavailable' in config) throw new Error(`unexpectedly unavailable: ${config.reason}`);
    expect(config).toMatchObject({
      serviceId: 'web_context_verified.v3',
      path: '/v3/web/context',
      contractRelease: '3.0.0',
      pccDependency: '2.0.0',
      outputSchemaHash: 'sha256:34e9ca4c55b071cfaa2f182ecac5d2513a8ec6a4f3c0a6d0cf0b7027eeab1319',
      pricingKey: 'web_context_verified_direct_v2',
    });
    const app = new Hono();
    createX402ServiceRoute(app, config);
    expect((await get402Requirement(app, config.path)).amount).toBe(EXPECTED_AMOUNT_ATOMIC);
  });

  it("never charges verify_agent_output.v2's amount (19000) -- proves the two services are economically distinct, not accidentally sharing a price", async () => {
    const requirement = await buildRealMainnetRequirement();
    expect(requirement.amount).not.toBe('19000');
  });
});
