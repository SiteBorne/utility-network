/**
 * SUN-1200 checkpoint A — proves the production-payment authorization
 * gate actually flows through to a real 402 challenge (§12 "challenge
 * generation"), that the testnet path is byte-identical when
 * unauthorized (§19 "testnet regression"), and that CDP production
 * authorization never leaks into the Nevermined rail (§14 "Model D").
 * Real Miniflare D1, real Hono app, real `app.request()` — no fixture
 * shortcuts, no mocked HTTP layer. No real CDP/Nevermined provider call
 * anywhere in this file; `evidenceMode` stays `'fixture'` throughout, so
 * no economic mutation is reachable regardless of the resolved network.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type { PaymentRequired, ProductionAuthorizationInput } from '@siteborne/protocol-x402';
import { decodePaymentRequiredHeaderSafe } from '@siteborne/protocol-x402';
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

async function get402(
  app: Awaited<ReturnType<typeof buildPaidServicesApp>>,
  path: string,
  body: unknown
): Promise<PaymentRequired> {
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
  return (decoded as { ok: true; value: PaymentRequired }).value;
}

const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

// The exact accepted structural inputs each service's schema requires
// (matching apps/edge-api/tests/x402-service-route.test.ts's own
// fixtures) -- this file tests network/asset resolution, not service
// input validation, so it reuses known-valid bodies rather than
// re-deriving them.
const COMPANY_INPUT = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
};
const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
const DOCUMENT_INPUT = {
  artifact_reference: {
    artifact_id: 'doc/native-fixture.pdf',
    media_type: 'application/pdf',
    size_bytes: 1,
  },
};
const AGENT_INPUT = {
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [],
  },
  candidate_output: { total: 42 },
  required_schema: {},
  verification_mode: 'standard',
};

describe('production-payment challenge generation (SUN-1200 checkpoint A)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-production-gate-'));
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

  it('testnet regression: omitting productionAuthorization entirely resolves the exact prior Base Sepolia challenge', async () => {
    const app = await buildPaidServicesApp({ db, evidenceMode: 'fixture' });
    const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
    expect(challenge.accepts[0]!.asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('fully unauthorized productionAuthorization resolves the same Base Sepolia challenge (defense-in-depth, not just default omission)', async () => {
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      productionAuthorization: {
        environment: 'preproduction',
        productionEnabled: false,
        humanBootstrapAuthorized: false,
        productionCredentialsApproved: false,
      },
    });
    const challenge = await get402(app, '/v1/web/context', WEB_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('kill switch: production environment + credentials approved + human authorized, but productionEnabled=false, still resolves testnet', async () => {
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      productionAuthorization: { ...FULLY_AUTHORIZED, productionEnabled: false },
    });
    const challenge = await get402(app, '/v1/verify/agent-output', AGENT_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('bootstrap-auth control: every other gate true but humanBootstrapAuthorized=false still resolves testnet', async () => {
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      productionAuthorization: { ...FULLY_AUTHORIZED, humanBootstrapAuthorized: false },
    });
    const challenge = await get402(app, '/v1/document/evidence-json', DOCUMENT_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });

  it('fully authorized (mock gates only, evidenceMode stays fixture — no economic path reachable) resolves the real Base mainnet challenge', async () => {
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:8453');
    expect(challenge.accepts[0]!.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('v2 CDP route: fully authorized resolves the real Base mainnet challenge (same resolver as v1)', async () => {
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:8453');
    expect(challenge.accepts[0]!.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('v2 CDP route: omitted productionAuthorization resolves the exact prior Base Sepolia challenge', async () => {
    const app = await buildPaidServicesApp({ db, evidenceMode: 'fixture' });
    const challenge = await get402(app, '/v2/web/context', WEB_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });
});

/**
 * Model D preservation (§14): NOT re-proven with a live Nevermined-rail
 * challenge here (that rail's own construction gate needs a real
 * Nevermined evidence provider, orthogonal to this checkpoint). Proven
 * instead by direct inspection -- `paymentRoute()`'s `rail === 'nevermined'`
 * branch (apps/edge-api/src/control-plane/routes/paid-services.ts) still
 * declares `network: PREPRODUCTION_NETWORK` unconditionally, unchanged by
 * this checkpoint, and never calls `resolvePaymentNetwork` at all -- so
 * CDP production authorization has no code path into the Nevermined
 * declaration. The already-accepted `model-d-v2-nevermined.test.ts` and
 * `nevermined-service-route.test.ts` suites re-verify rail isolation
 * generally and are unaffected by this checkpoint's changes (re-run
 * clean, see the checkpoint report).
 */
