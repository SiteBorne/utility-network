/**
 * SUN-1220L — TDD proof that verify_agent_output.v2/CDP's real production
 * requirement pipeline carries the EIP-712 domain metadata
 * (`extra.name`/`extra.version`) the official `@x402/evm` `ExactEvmScheme`
 * requires before it will ever call `signTypedData` (SUN-1220K's root
 * cause).
 *
 * Exercises the REAL production pipeline (per SUN-1220K §5):
 *
 *   buildVerifyAgentOutputV2CdpProductionRouteConfig
 *     -> X402ServiceRouteConfig
 *     -> createX402ServiceRoute (the real route handler, backed by a real
 *        D1 database via Miniflare, same convention as
 *        ../../../tests/x402-service-route.test.ts)
 *     -> the real buildExactPaymentRequirement helper x402-service.ts
 *        already calls
 *     -> the real, decoded PAYMENT-REQUIRED PaymentRequirements
 *
 * Then feeds that REAL requirement into the pinned, official
 * `ExactEvmScheme.createPaymentPayload` with a deterministic, synthetic
 * (never real, never network-reachable) fake signer.
 *
 * Zero live CDP calls: evidence is resolved via the sanctioned
 * `explicitTestEvidenceOverride` test-only escape hatch (SUN-1218
 * checkpoint X's own mechanism -- the real production route module
 * never supplies this argument, only tests do; see that parameter's own
 * doc comment on `buildVerifyAgentOutputV2CdpProductionRouteConfig`).
 * The four ADR-0055 gates below are plain booleans on an in-process test
 * env object -- never a real Cloudflare secret/binding -- set only so
 * the pure `resolvePaymentNetwork` function (packages/protocol-x402/src/
 * network/preproduction.ts) returns the Base-mainnet network STRING;
 * this triggers no CDP client construction, no network call, and no real
 * evidence resolution (bypassed entirely by the override above). Zero
 * real signatures: the fake signer returns a fixed, synthetic byte
 * pattern, never derived from any private key, never resembling a real
 * usable payment credential.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { ExactEvmScheme } from '@x402/evm';
import type { PaymentRequired, PaymentRequirements } from '@siteborne/protocol-x402';
import { decodePaymentRequiredHeaderSafe } from '@siteborne/protocol-x402';
import { createX402ServiceRoute } from '../routes/x402-service';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from './verify-agent-output-v2-cdp-composition';

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

// Matches SUN-1220I/J's own already-proven-fresh canonical request body for
// verify_agent_output.v2 -- not re-derived here, so this test's 402 shape
// is the exact real one a live buyer would receive.
const CANONICAL_REQUEST_BODY = {
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [],
  },
  candidate_output: { total: 42 },
  required_schema: {},
  verification_mode: 'standard',
};

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT_ATOMIC = '19000';
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const EXPECTED_EIP712_NAME = 'USD Coin';
const EXPECTED_EIP712_VERSION = '2';

/** ADR-0055's four gates, true only inside this in-process test env
 * object -- mirrors the already-accepted pattern in
 * verify-agent-output-v2-cdp-composition.production-evidence.test.ts's
 * own `fullEnvWithAdr0055Authorized`. Combined with the
 * `explicitTestEvidenceOverride` passed at each call site below, real
 * evidence resolution (the only path that would ever construct a real
 * CDP client) is never reached -- these four booleans only select which
 * network STRING the pure `resolvePaymentNetwork` function returns. */
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
  };
}

/** A deterministic, synthetic, TEST-ONLY signer. Records how many times
 * `signTypedData` is reached; its returned "signature" is a fixed
 * repeated byte pattern -- structurally shaped like a 65-byte ECDSA
 * signature so downstream codecs accept it, but not a real signature
 * over anything (not derived from any private key, not recoverable to
 * any address), never resembling a usable payment credential, and never
 * reachable from production source. */
function fakeSigner(recorder: { calls: number }) {
  return {
    address: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99' as `0x${string}`,
    async signTypedData(): Promise<`0x${string}`> {
      recorder.calls += 1;
      return ('0x' + '11'.repeat(65)) as `0x${string}`;
    },
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

describe('SUN-1220L: verify_agent_output.v2/CDP real requirement carries EIP-712 domain metadata', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-domain-metadata-'));
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
    const config = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
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

  it('A/B/C/D/E/F/G/H/I: the real generated requirement carries correct EIP-712 domain metadata and every economic field is unchanged', async () => {
    const requirement = await buildRealMainnetRequirement();
    const extra = requirement.extra as Record<string, unknown> | undefined;
    expect(extra?.name).toBe(EXPECTED_EIP712_NAME); // A, C
    expect(extra?.version).toBe(EXPECTED_EIP712_VERSION); // B, D
    expect(extra?.quote_id).toMatch(/^qte_/); // pre-existing extra field untouched
    expect(requirement.network).toBe(EXPECTED_NETWORK); // E
    expect(requirement.asset).toBe(EXPECTED_ASSET); // F
    expect(requirement.amount).toBe(EXPECTED_AMOUNT_ATOMIC); // G
    expect(requirement.payTo).toBe(EXPECTED_PAYTO); // H
    expect(requirement.scheme).toBe('exact'); // I
  });

  it('J/K: the real requirement is accepted by the official ExactEvmScheme, reaching signTypedData exactly once', async () => {
    const requirement = await buildRealMainnetRequirement();
    const recorder = { calls: 0 };
    const scheme = new ExactEvmScheme(fakeSigner(recorder) as never);
    const payload = await scheme.createPaymentPayload(2, requirement);
    expect(recorder.calls).toBe(1);
    expect(payload.payload).toBeTruthy();
  });

  it('L: a requirement with extra.name stripped fails closed before the fake signer is reached', async () => {
    const requirement = await buildRealMainnetRequirement();
    const stripped: PaymentRequirements = {
      ...requirement,
      extra: { ...(requirement.extra as Record<string, unknown>), name: undefined },
    };
    const recorder = { calls: 0 };
    const scheme = new ExactEvmScheme(fakeSigner(recorder) as never);
    await expect(scheme.createPaymentPayload(2, stripped)).rejects.toThrow(
      /EIP-712 domain parameters \(name, version\) are required/
    );
    expect(recorder.calls).toBe(0);
  });

  it('M: a requirement with extra.version stripped fails closed before the fake signer is reached', async () => {
    const requirement = await buildRealMainnetRequirement();
    const stripped: PaymentRequirements = {
      ...requirement,
      extra: { ...(requirement.extra as Record<string, unknown>), version: undefined },
    };
    const recorder = { calls: 0 };
    const scheme = new ExactEvmScheme(fakeSigner(recorder) as never);
    await expect(scheme.createPaymentPayload(2, stripped)).rejects.toThrow(
      /EIP-712 domain parameters \(name, version\) are required/
    );
    expect(recorder.calls).toBe(0);
  });

  it('N/O: the official ExactEvmScheme checks only PRESENCE, not exact value, of name/version -- documents the split with SUN-1220J\'s separate hard invariant', async () => {
    const requirement = await buildRealMainnetRequirement();
    const wrongValues: PaymentRequirements = {
      ...requirement,
      extra: {
        ...(requirement.extra as Record<string, unknown>),
        name: 'Not USD Coin',
        version: '1',
      },
    };
    const recorder = { calls: 0 };
    const scheme = new ExactEvmScheme(fakeSigner(recorder) as never);
    // The official library does NOT reject a semantically wrong,
    // non-empty name/version -- signEIP3009Authorization only guards
    // presence (`!requirements.extra?.name || !requirements.extra?.version`),
    // read directly from node_modules/@x402/evm/dist/cjs/index.js. This
    // test proves that real, narrower library behavior rather than
    // falsely claiming the library itself rejects drift (SUN-1220K §12).
    // SITEBORNE's own separate hard invariant -- SUN-1220J's
    // `validateChallengeAgainstExpectations`
    // (apps/edge-api/tests/live/first-paid-e2e-local.test.ts, already
    // proven and byte-identically unmodified by this checkpoint) -- is
    // what actually catches this drift before a real buyer would sign.
    await expect(scheme.createPaymentPayload(2, wrongValues)).resolves.toBeTruthy();
    expect(recorder.calls).toBe(1);
  });

  it('route isolation: paymentRequirementExtra is SET (as an object key, not the interface\'s optional declaration) only in the two real production CDP compositions -- never automatically added to any Nevermined or fixture-only route composition. SUN-1221C added the second entry (web_context_verified.v2, its own real CDP composition, the exact same pattern) -- this assertion was updated from "exactly one file" to this explicit two-file allowlist for that reason, not weakened to a wildcard', async () => {
    const { execFileSync } = await import('node:child_process');
    const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
    // Matches an actual object-literal key assignment (`paymentRequirementExtra:`
    // immediately followed by a colon) -- deliberately does NOT match the
    // interface's own optional declaration in x402-service.ts
    // (`paymentRequirementExtra?: Record<string, unknown>;`), which has a
    // `?` between the identifier and the colon.
    let matches = '';
    try {
      matches = execFileSync(
        'grep',
        ['-rlE', 'paymentRequirementExtra:', 'apps/edge-api/src', '--include=*.ts'],
        { cwd: repoRoot, encoding: 'utf-8' }
      );
    } catch (err: unknown) {
      matches = (err as { stdout?: string }).stdout ?? '';
    }
    const files = matches
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.endsWith('.test.ts'));
    expect(files.sort()).toEqual(
      [
        'apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts',
        'apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.ts',
      ].sort()
    );
  });
});
