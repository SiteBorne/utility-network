/**
 * SUN-1200 checkpoint F — real bug found and fixed live during this
 * checkpoint's own cutover attempt: `index.ts`'s `resolveCdpEvidence`
 * previously passed `createCdpFacilitatorClient` bare (zero-arg) as
 * `createFacilitatorClient`. Confirmed directly in the installed
 * `@coinbase/cdp-sdk`'s own source (`x402/facilitator.js`): called with
 * no args, it falls back to `process.env.CDP_API_KEY_ID`/
 * `process.env.CDP_API_KEY_SECRET`. (Root-cause note: this repository's
 * own checkpoint-F incident report classifies WHY the real deployed
 * Worker actually returned 500 as `AMBIENT_PROCESS_ENV_SHOULD_HAVE_BEEN_AVAILABLE`
 * -- Cloudflare's `nodejs_compat_populate_process_env` is enabled by
 * default for compatibility dates ≥ 2025-04-01, and the failed version's
 * compatibility date was well past that threshold, so the ambient
 * fallback should have worked and the exact original cause remains
 * genuinely unresolved without further diagnosis. Regardless of that
 * classification, this file proves the code now consumes its declared
 * Worker `Env` dependency explicitly rather than relying on ambient
 * runtime behavior, which is correct practice independent of what
 * turns out to have caused the specific incident.)
 *
 * Every prior test (including every other file in this repository)
 * injects its own mock `createFacilitatorClient` closure directly into
 * `buildPaidServicesApp`/`resolveProductionCdpEvidenceProvider`, never
 * exercising `index.ts`'s own real, non-injected wiring at all. This
 * file closes that coverage gap: it mocks `@coinbase/cdp-sdk`'s
 * `CdpClient` (so the seller-lookup gate can succeed without a real
 * network call) and `@coinbase/cdp-sdk/x402`'s `createCdpFacilitatorClient`
 * (capturing exactly what arguments `index.ts` invokes it with), then
 * exercises the REAL `index.ts` app end-to-end with every ADR 0055 gate
 * true. No real CDP SDK call, no real network call, anywhere in this
 * file -- both SDK entry points are fully mocked.
 *
 * Each test re-imports `../src/index` fresh via `vi.resetModules()` --
 * `index.ts` caches its built app instance keyed only by D1 identity
 * (`cachedV2CdpDb !== c.env.DB`), and every test in this file shares one
 * real Miniflare D1 instance, so without a fresh module per test the
 * negative-control tests would silently reuse the positive test's
 * already-cached production app instance instead of genuinely
 * re-evaluating `resolveCdpEvidence` for their own env shape -- caught
 * live while writing this file (the first negative control initially,
 * incorrectly, "passed" a mainnet challenge because of exactly this
 * cache collision).
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { decodePaymentRequiredHeaderSafe, type PaymentRequired } from '@siteborne/protocol-x402';

const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';

let capturedFacilitatorArgs: unknown[] = [];

vi.mock('@coinbase/cdp-sdk', () => ({
  CdpClient: class MockCdpClient {
    evm = {
      async getAccount() {
        return { address: SELLER };
      },
    };
  },
}));

vi.mock('@coinbase/cdp-sdk/x402', () => ({
  createCdpFacilitatorClient: (...args: unknown[]) => {
    capturedFacilitatorArgs.push(args);
    return {
      verify: async () => ({ isValid: true, payer: '0x0000000000000000000000000000000000dEaD' }),
      settle: async () => ({ success: true, transaction: '0x' + 'a'.repeat(64) }),
      getSupported: async () => ({ kinds: [], extensions: [], signers: {} }),
    };
  },
}));

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

describe('index.ts real CDP facilitator wiring (SUN-1200 checkpoint F regression)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-cdp-facilitator-wiring-'));
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

  let app: typeof import('../src/index').default;

  beforeEach(async () => {
    capturedFacilitatorArgs = [];
    vi.resetModules();
    ({ default: app } = await import('../src/index'));
  });

  afterEach(() => {
    vi.doUnmock('../src/index');
  });

  it('with every ADR 0055 gate true, index.ts reaches a real 402 (not a 500) -- proving createCdpFacilitatorClient is invoked with explicit credentials, never relying on process.env', async () => {
    const env = {
      DB: db,
      PAID_ROUTES_ENABLED: 'true',
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
      SELLER_WALLET_ADDRESS: SELLER,
      CDP_API_KEY_ID: 'mock-key-id',
      CDP_API_KEY_SECRET: 'mock-key-secret',
    };
    const res = await app.request(
      '/v2/web/context',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_url: 'https://acme.example/', retrieval_mode: 'direct' }),
      },
      env as never
    );
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    expect(headerValue).toBeTruthy();
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.network).toBe('eip155:8453');
    expect(challenge.accepts[0]!.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(challenge.accepts[0]!.payTo).toBe(SELLER);

    // The real bug: `createCdpFacilitatorClient` called bare (zero-arg)
    // would show up here as `[[]]` (an empty args array) -- a genuine
    // fix must call it with an explicit credentials object.
    expect(capturedFacilitatorArgs.length).toBeGreaterThan(0);
    for (const args of capturedFacilitatorArgs) {
      expect(args).toEqual([{ apiKeyId: 'mock-key-id', apiKeySecret: 'mock-key-secret' }]);
    }
  });

  it('negative control: missing CDP_API_KEY_ID fails closed -- production provider unreachable, facilitator never constructed', async () => {
    const env = {
      DB: db,
      PAID_ROUTES_ENABLED: 'true',
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
      SELLER_WALLET_ADDRESS: SELLER,
      // CDP_API_KEY_ID deliberately absent.
      CDP_API_KEY_SECRET: 'mock-key-secret',
    };
    const res = await app.request(
      '/v2/web/context',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_url: 'https://acme.example/', retrieval_mode: 'direct' }),
      },
      env as never
    );
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    // Fails closed to preproduction (Base Sepolia), not mainnet.
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
    // The facilitator was never constructed at all -- checkProductionBindingsPresent
    // rejects before resolveProductionCdpEvidenceProvider ever reaches the
    // createFacilitatorClient call.
    expect(capturedFacilitatorArgs.length).toBe(0);
  });

  it('negative control: missing CDP_API_KEY_SECRET fails closed -- production provider unreachable, facilitator never constructed', async () => {
    const env = {
      DB: db,
      PAID_ROUTES_ENABLED: 'true',
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
      SELLER_WALLET_ADDRESS: SELLER,
      CDP_API_KEY_ID: 'mock-key-id',
      // CDP_API_KEY_SECRET deliberately absent.
    };
    const res = await app.request(
      '/v2/web/context',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_url: 'https://acme.example/', retrieval_mode: 'direct' }),
      },
      env as never
    );
    expect(res.status).toBe(402);
    const headerValue = res.headers.get('PAYMENT-REQUIRED');
    const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
    expect(capturedFacilitatorArgs.length).toBe(0);
  });
});
