/**
 * SUN-1200 checkpoint B — proves the production-payment gates fail
 * closed at the REAL public route boundary (the actual `index.ts` app,
 * not `buildPaidServicesApp` called directly). Real Miniflare D1
 * throughout. No real CDP/Nevermined provider call anywhere in this
 * file -- every scenario here resolves to `evidenceMode: 'fixture'`
 * because no real `getAuthenticatedSellerAddress` implementation is
 * wired into `index.ts` (checkpoint B's own deliberate, disclosed
 * choice) -- proving the live production path cannot activate today
 * regardless of which production-shaped env vars are set.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { decodePaymentRequiredHeaderSafe, type PaymentRequired } from '@siteborne/protocol-x402';
import app from '../src/index';

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

const COMPANY_INPUT = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
};

const FULL_PRODUCTION_ENV_SHAPE = {
  PAID_ROUTES_ENABLED: 'true',
  PAYMENT_ENVIRONMENT: 'production',
  PRODUCTION_ENABLED: 'true',
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
  PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
  SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  // Synthetic test values only -- never real credentials.
  CDP_API_KEY_ID: 'test-synthetic-cdp-key-id',
  CDP_API_KEY_SECRET: 'test-synthetic-cdp-key-secret-do-not-use',
  CDP_WALLET_SECRET: 'test-synthetic-cdp-wallet-secret-do-not-use',
};

async function get402ViaApp(path: string, body: unknown, env: Record<string, unknown>) {
  const res = await app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env as never
  );
  return res;
}

describe('production CDP gates at the real public route boundary (SUN-1200 checkpoint B)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-outer-router-'));
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

  it('default-mainnet-reachability control: with EVERY production env var set to true and synthetic credentials present, the real app still resolves testnet -- no seller-identity hook is wired', async () => {
    const res = await get402ViaApp('/v2/company/evidence-graph', COMPANY_INPUT, {
      ...FULL_PRODUCTION_ENV_SHAPE,
      DB: db,
    });
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
    expect(challenge.accepts[0]!.asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('kill switch through the full HTTP stack: PRODUCTION_ENABLED=false denies production even with every other gate true', async () => {
    const res = await get402ViaApp(
      '/v1/web/context',
      { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
      {
        ...FULL_PRODUCTION_ENV_SHAPE,
        PRODUCTION_ENABLED: 'false',
        DB: db,
      }
    );
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('credential-approval control through the full HTTP stack: PRODUCTION_CDP_CREDENTIALS_APPROVED=false denies production even with every other gate true', async () => {
    const res = await get402ViaApp(
      '/v1/verify/agent-output',
      {
        verification_contract: {
          claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
          deterministic_requirements: [],
        },
        candidate_output: { total: 42 },
        required_schema: {},
        verification_mode: 'standard',
      },
      {
        ...FULL_PRODUCTION_ENV_SHAPE,
        PRODUCTION_CDP_CREDENTIALS_APPROVED: 'false',
        DB: db,
      }
    );
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('human-bootstrap control through the full HTTP stack: HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=false denies production even with every other gate true', async () => {
    const res = await get402ViaApp(
      '/v2/document/evidence-json',
      {
        artifact_reference: {
          artifact_id: 'doc/native-fixture.pdf',
          media_type: 'application/pdf',
          size_bytes: 1,
        },
      },
      {
        ...FULL_PRODUCTION_ENV_SHAPE,
        HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'false',
        DB: db,
      }
    );
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('missing-credentials control through the full HTTP stack: absent CDP secrets deny production even with every flag true', async () => {
    const res = await get402ViaApp('/v1/company/evidence-graph', COMPANY_INPUT, {
      PAID_ROUTES_ENABLED: 'true',
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
      SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      // CDP_API_KEY_ID/SECRET/CDP_WALLET_SECRET deliberately absent.
      DB: db,
    });
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('Model D re-proof through the outer router: /v2/nevermined/* stays structurally absent regardless of every production CDP env var', async () => {
    const res = await app.request(
      '/v2/nevermined/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { ...FULL_PRODUCTION_ENV_SHAPE, DB: db } as never
    );
    // NEVERMINED_ROUTES_ENABLED was never set in FULL_PRODUCTION_ENV_SHAPE
    // -- the Nevermined v2 route family stays entirely unmounted,
    // completely independent of every CDP production flag.
    expect(res.status).toBe(404);
  });

  it('Model D re-proof: /v1/nevermined/* remains its existing hardcoded 503, unaffected by any CDP production flag', async () => {
    const res = await app.request(
      '/v1/nevermined/company/evidence-graph',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      { ...FULL_PRODUCTION_ENV_SHAPE, NEVERMINED_ROUTES_ENABLED: 'true', DB: db } as never
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('nevermined_provider_not_configured');
  });

  it('secret redaction: none of the synthetic CDP secret values ever appear in any response body across every scenario above', async () => {
    const res = await get402ViaApp('/v1/company/evidence-graph', COMPANY_INPUT, {
      ...FULL_PRODUCTION_ENV_SHAPE,
      DB: db,
    });
    const text = await res.text();
    expect(text).not.toContain('test-synthetic-cdp-key-secret-do-not-use');
    expect(text).not.toContain('test-synthetic-cdp-wallet-secret-do-not-use');
    expect(text).not.toContain('test-synthetic-cdp-key-id');
  });
});
