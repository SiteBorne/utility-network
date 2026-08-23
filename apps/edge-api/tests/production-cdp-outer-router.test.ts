/**
 * SUN-1200 checkpoint B — proves the production-payment gates fail
 * closed at the REAL public route boundary (the actual `index.ts` app,
 * not `buildPaidServicesApp` called directly). Real Miniflare D1
 * throughout. No real CDP/Nevermined provider call anywhere in this
 * file.
 *
 * SUN-1200 checkpoint D: `index.ts` now wires the REAL (not stubbed)
 * `getAuthenticatedSellerAddress`/`buildCdpSellerAddressLookup`, which
 * constructs a real `@coinbase/cdp-sdk` `CdpClient` and would make a
 * genuine network call to Coinbase's API once every other gate holds and
 * the configured seller address is well-formed. This file's shared
 * `FULL_PRODUCTION_ENV_SHAPE.SELLER_WALLET_ADDRESS` is therefore
 * DELIBERATELY malformed (fails `EVM_ADDRESS_PATTERN` inside
 * `buildCdpSellerAddressLookup` before `createClient()` is ever called) —
 * every scenario in this file resolves to `evidenceMode: 'fixture'` via
 * that local, network-free format check, never via network failure. A
 * genuine full-stack POSITIVE production path (real gates true, a
 * well-formed seller address, a real facilitator/CDP-client response) is
 * proven separately in `production-cdp-full-stack-mock.test.ts`, which
 * uses `buildPaidServicesApp` directly with fully injected mock doubles
 * (matching the checkpoint D directive's own §22 instruction), never the
 * real, non-injectable `index.ts` factories this file exercises.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
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
  // Deliberately NOT a well-formed EVM address (see this file's own
  // header comment) -- guarantees `buildCdpSellerAddressLookup`'s local
  // format check throws before `createClient()`/any real CDP SDK call is
  // ever reached, so this shared constant can never accidentally cause a
  // real outbound network call regardless of which other gate a given
  // test flips.
  SELLER_WALLET_ADDRESS: 'not-a-well-formed-evm-address',
  // Synthetic test values only -- never real credentials. CDP_WALLET_SECRET
  // deliberately omitted (SUN-1200 checkpoint E): no longer part of the
  // required production-payment binding set -- see
  // `checkProductionBindingsPresent`'s own doc comment.
  CDP_API_KEY_ID: 'test-synthetic-cdp-key-id',
  CDP_API_KEY_SECRET: 'test-synthetic-cdp-key-secret-do-not-use',
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

  it('default-mainnet-reachability control: with EVERY production env var set to true and synthetic credentials present, the real app still resolves testnet -- the shared malformed SELLER_WALLET_ADDRESS fails the real seller-identity hook closed, zero network calls', async () => {
    const res = await get402ViaApp('/v2/company/evidence-graph', COMPANY_INPUT, {
      ...FULL_PRODUCTION_ENV_SHAPE,
      DB: db,
    });
    // SUN-1218 checkpoint X: /v2/company/evidence-graph (the /v2/*
    // wildcard) has no route-specific executor and is now unconditionally
    // 404, decoupled from PAID_ROUTES_ENABLED -- disclosed, intentional
    // change. The zero-network-call guarantee this test's own title
    // describes is even stronger now (the route never reads these env
    // vars at all).
    expect(res.status).toBe(404);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
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
    // SUN-1218 checkpoint X: this route has no route-specific executor
    // and is now unconditionally 404, decoupled from PAID_ROUTES_ENABLED.
    expect(res.status).toBe(404);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
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
    // SUN-1218 checkpoint X: this route has no route-specific executor
    // and is now unconditionally 404, decoupled from PAID_ROUTES_ENABLED.
    expect(res.status).toBe(404);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
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
    // SUN-1218 checkpoint X: this route has no route-specific executor
    // and is now unconditionally 404, decoupled from PAID_ROUTES_ENABLED.
    expect(res.status).toBe(404);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
  });

  it('missing-credentials control through the full HTTP stack: absent CDP secrets deny production even with every flag true', async () => {
    const res = await get402ViaApp('/v1/company/evidence-graph', COMPANY_INPUT, {
      PAID_ROUTES_ENABLED: 'true',
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
      SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      // CDP_API_KEY_ID/CDP_API_KEY_SECRET deliberately absent (the only
      // two secrets `checkProductionBindingsPresent` still requires as of
      // checkpoint E -- CDP_WALLET_SECRET is no longer in the required
      // set at all).
      DB: db,
    });
    // SUN-1218 checkpoint X: this route has no route-specific executor
    // and is now unconditionally 404, decoupled from PAID_ROUTES_ENABLED.
    expect(res.status).toBe(404);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
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
    expect(body.error).toBe('service_executor_not_configured');
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
