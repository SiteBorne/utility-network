/**
 * SUN-1206 supersedes the production-entrypoint portion of checkpoint F:
 * payment-provider construction is now behind a stronger service-availability
 * gate.  Until a governed production executor exists, even a complete CDP
 * configuration must not construct the facilitator or emit payment terms.
 * The payment provider's explicit-credential behavior remains covered at its
 * own injected boundary by production-cdp-provider/full-stack tests.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';

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

  it('with every ADR 0055 gate true, service unavailability wins before facilitator construction', async () => {
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
    expect(res.status).toBe(503);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'service_executor_not_configured' });
    expect(capturedFacilitatorArgs).toHaveLength(0);
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
    expect(res.status).toBe(503);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
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
    expect(res.status).toBe(503);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    expect(capturedFacilitatorArgs.length).toBe(0);
  });
});
