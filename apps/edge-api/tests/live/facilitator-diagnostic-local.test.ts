/**
 * FIRST-PAID-VERIFY-REJECTION-OBSERVABILITY-01 — zero-economic facilitator
 * diagnostic.
 *
 * Question answered: can the production Worker reach and authenticate to the
 * CDP facilitator's /verify? This is answered with ONE submission whose
 * payment authorization is structurally valid (passes the Worker's parser and
 * requirement binding, so it reaches the facilitator) but carries a sentinel
 * all-zero signature over a `from` address nobody controls. It uses NO buyer
 * key, NO wallet secret, NO CDP credential, and cannot be settled:
 *
 *   - `signature` is 65 zero bytes (ecrecover cannot yield an address),
 *   - `from` is a random unowned address (no key, no code, zero USDC),
 *   - the EIP-3009 transfer therefore reverts on-chain even if a facilitator
 *     mistakenly accepted it.
 *
 * The mocked suite always runs (no network). The single live test runs only
 * with RUN_FACILITATOR_DIAGNOSTIC=1 and needs no credentials.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import {
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  type PaymentPayload,
  type PaymentRequired,
  type ProductionAuthorizationInput,
} from '@siteborne/protocol-x402';
import { resolveProductionCdpEvidenceProvider } from '../../src/control-plane/config/production-payment';
import { buildPaidServicesApp } from '../../src/control-plane/routes/paid-services';

const DIAGNOSTIC_VERSION_ID = '8cddb16e-7f73-4875-8d50-4adc0ade5eb4';
const VERSION_OVERRIDE_HEADER = 'Cloudflare-Workers-Version-Overrides';
const TARGET_BASE = 'https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev';
const TARGET_PATH = '/v2/verify/agent-output';

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT = '17000';
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const CONTROLLED_BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';

// Randomly generated 20 bytes; no key exists for it. Verified on Base
// mainnet at authoring time: 0 USDC, 0 transactions, no code. (The
// conventional 0x...dEaD burn address was deliberately NOT used: it holds
// USDC, so a zero balance would not add a second layer of safety.)
const UNOWNED_FROM = '0xb4e4d6800c1c445035d067e39b9d76dfef06f9a4';
const SENTINEL_SIGNATURE = `0x${'00'.repeat(65)}`;

const REQUEST_BODY = Object.freeze({
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [],
  },
  candidate_output: { total: 42 },
  required_schema: {},
  verification_mode: 'standard',
});

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface DiagnosticAuthorization {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

export function buildDiagnosticPayload(challenge: PaymentRequired): PaymentPayload {
  const accepted = challenge.accepts[0]!;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const inner: DiagnosticAuthorization = {
    signature: SENTINEL_SIGNATURE,
    authorization: {
      from: UNOWNED_FROM,
      to: accepted.payTo,
      value: accepted.amount,
      validAfter: String(nowSeconds - 600),
      validBefore: String(nowSeconds + (accepted.maxTimeoutSeconds ?? 60)),
      nonce: `0x${randomBytes(32).toString('hex')}`,
    },
  };
  return {
    x402Version: 2,
    resource: challenge.resource,
    accepted,
    payload: inner as unknown as Record<string, unknown>,
    extensions: buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}),
  };
}

/** Hard safety gate evaluated before anything is sent: the payload must be
 * provably unspendable and unrelated to the controlled buyer. */
export function assertDiagnosticPayloadUnspendable(payload: PaymentPayload): void {
  const inner = payload.payload as unknown as DiagnosticAuthorization;
  if (inner.signature !== SENTINEL_SIGNATURE)
    throw new Error('diagnostic signature is not the sentinel');
  if (inner.authorization.from !== UNOWNED_FROM)
    throw new Error('diagnostic from is not the unowned zero-balance address');
  const serialized = JSON.stringify(payload).toLowerCase();
  if (serialized.includes(CONTROLLED_BUYER.toLowerCase())) {
    throw new Error('diagnostic payload references the controlled buyer');
  }
}

export interface DiagnosticOutcome {
  challenge_received: boolean;
  challenge_validated: boolean;
  diagnostic_request_count: number;
  quote_id: string | null;
  requirement_id: string | null;
  payment_identifier: string | null;
  http_status: number | null;
  cf_ray: string | null;
  error_code: string | null;
  error_message: string | null;
  unexpected_acceptance: boolean;
  failure?: string;
}

function overrideHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'user-agent': 'siteborne-facilitator-diagnostic/1',
    [VERSION_OVERRIDE_HEADER]: `siteborne-utility-edge="${DIAGNOSTIC_VERSION_ID}"`,
    ...extra,
  };
}

/** Exactly one unpaid challenge fetch and AT MOST ONE diagnostic submission.
 * No retry path exists. */
export interface ChallengeExpectations {
  payTo: string;
  requireEip712Domain: boolean;
}

/** Live defaults are strict. The mocked stack (fixture payTo, no
 * facilitator-enhanced EIP-712 domain) may loosen only these two fields. */
const STRICT_EXPECTATIONS: ChallengeExpectations = {
  payTo: EXPECTED_PAYTO,
  requireEip712Domain: true,
};

export async function runDiagnostic(
  fetchImpl: FetchLike,
  baseUrl: string,
  expectations: ChallengeExpectations = STRICT_EXPECTATIONS
): Promise<DiagnosticOutcome> {
  const outcome: DiagnosticOutcome = {
    challenge_received: false,
    challenge_validated: false,
    diagnostic_request_count: 0,
    quote_id: null,
    requirement_id: null,
    payment_identifier: null,
    http_status: null,
    cf_ray: null,
    error_code: null,
    error_message: null,
    unexpected_acceptance: false,
  };
  const url = `${baseUrl}${TARGET_PATH}`;
  const unpaid = await fetchImpl(url, {
    method: 'POST',
    headers: overrideHeaders(),
    body: JSON.stringify(REQUEST_BODY),
  });
  if (unpaid.status !== 402) return { ...outcome, failure: `unpaid status ${unpaid.status}` };
  outcome.challenge_received = true;
  const decoded = decodePaymentRequiredHeaderSafe(unpaid.headers.get('PAYMENT-REQUIRED') ?? '');
  if (!decoded.ok) return { ...outcome, failure: 'challenge header undecodable' };
  const challenge = decoded.value;
  const accepted = challenge.accepts[0]!;
  const extra = (accepted.extra ?? {}) as Record<string, unknown>;
  const unpaidBody = (await unpaid.json().catch(() => ({}))) as Record<string, unknown>;
  outcome.quote_id = typeof extra.quote_id === 'string' ? extra.quote_id : null;
  outcome.requirement_id =
    typeof unpaidBody.requirement_id === 'string' ? unpaidBody.requirement_id : null;
  const mismatches: string[] = [];
  if (accepted.network !== EXPECTED_NETWORK) mismatches.push('network');
  if (accepted.asset !== EXPECTED_ASSET) mismatches.push('asset');
  if (accepted.amount !== EXPECTED_AMOUNT) mismatches.push('amount');
  if (accepted.payTo !== expectations.payTo) mismatches.push('payTo');
  if (accepted.scheme !== 'exact') mismatches.push('scheme');
  if (expectations.requireEip712Domain && (extra.name !== 'USD Coin' || extra.version !== '2'))
    mismatches.push('eip712_domain');
  if (!outcome.quote_id) mismatches.push('quote_id');
  if (mismatches.length > 0)
    return { ...outcome, failure: `challenge mismatch: ${mismatches.join(',')}` };
  outcome.challenge_validated = true;

  const payload = buildDiagnosticPayload(challenge);
  assertDiagnosticPayloadUnspendable(payload);
  const ext = payload.extensions as { 'payment-identifier'?: { info?: { id?: string } } };
  outcome.payment_identifier = ext['payment-identifier']?.info?.id ?? null;

  outcome.diagnostic_request_count = 1;
  const paid = await fetchImpl(url, {
    method: 'POST',
    headers: overrideHeaders({ 'PAYMENT-SIGNATURE': encodePaymentSignatureHeaderSafe(payload) }),
    body: JSON.stringify(REQUEST_BODY),
  });
  outcome.http_status = paid.status;
  outcome.cf_ray = paid.headers.get('cf-ray');
  const text = await paid.text();
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    outcome.error_code = typeof body.error === 'string' ? body.error : null;
    outcome.error_message = typeof body.message === 'string' ? body.message : null;
  } catch {
    // non-JSON body: leave error fields null; never echo the raw body.
  }
  // The ONLY expected outcome is a verification rejection. Anything else
  // (2xx, or a 402 from a later stage such as settlement) means the facilitator
  // did not reject the unspendable authorization: treat as a critical stop.
  outcome.unexpected_acceptance = !(
    paid.status === 402 && outcome.error_code === 'payment_verification_rejected'
  );
  return outcome;
}

// ---------------------------------------------------------------------------
// Mocked suite (always runs, no network)
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));
const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};
const MOCK_EXPECTATIONS: ChallengeExpectations = {
  payTo: 'siteborne-fixture:payto-not-configured',
  requireEip712Domain: false,
};
const BINDINGS = {
  SELLER_WALLET_ADDRESS: EXPECTED_PAYTO,
  CDP_API_KEY_ID: 'diag-mock-key-id',
  CDP_API_KEY_SECRET: 'diag-mock-key-secret',
};

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
    for (const stmt of statements) await db.exec(stmt);
  }, Promise.resolve());
}

describe('facilitator diagnostic payload (mocked, zero-economic)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-facilitator-diagnostic-'));
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

  async function harness(verify: (...args: unknown[]) => Promise<unknown>) {
    const seen = { verify: [] as unknown[][], settle: 0 };
    const facilitator = {
      async verify(...args: unknown[]) {
        seen.verify.push(args);
        return verify(...args);
      },
      async settle() {
        seen.settle += 1;
        throw new Error('settle must never be reached by the diagnostic');
      },
      async getSupported() {
        return { kinds: [], extensions: [], signers: {} };
      },
    } as unknown as HTTPFacilitatorClient;
    const cdp = await resolveProductionCdpEvidenceProvider(FULLY_AUTHORIZED, BINDINGS, {
      createFacilitatorClient: () => facilitator,
    });
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: cdp.evidenceMode,
      evidenceProvider: cdp.evidenceProvider,
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const fetchImpl: FetchLike = (url, init) =>
      Promise.resolve(app.request(new URL(url).pathname, init));
    return { seen, fetchImpl };
  }

  it('reaches facilitator verify exactly once with the unspendable payload; audit records the reason', async () => {
    const { seen, fetchImpl } = await harness(async () => ({
      isValid: false,
      invalidReason: 'invalid_exact_evm_payload_signature',
    }));
    const outcome = await runDiagnostic(fetchImpl, 'https://diag.test', MOCK_EXPECTATIONS);

    expect(outcome.challenge_validated).toBe(true);
    expect(outcome.diagnostic_request_count).toBe(1);
    expect(outcome.http_status).toBe(402);
    expect(outcome.error_code).toBe('payment_verification_rejected');
    expect(outcome.unexpected_acceptance).toBe(false);

    expect(seen.verify).toHaveLength(1);
    expect(seen.settle).toBe(0);
    const [paymentPayload, paymentRequirements] = seen.verify[0] as [
      PaymentPayload,
      PaymentRequired['accepts'][number],
    ];
    const inner = paymentPayload.payload as unknown as DiagnosticAuthorization;
    expect(inner.signature).toBe(SENTINEL_SIGNATURE);
    expect(inner.authorization.from).toBe(UNOWNED_FROM);
    expect(inner.authorization.to).toBe(MOCK_EXPECTATIONS.payTo);
    expect(inner.authorization.value).toBe(EXPECTED_AMOUNT);
    expect(paymentRequirements.amount).toBe(EXPECTED_AMOUNT);
    expect(JSON.stringify(paymentPayload).toLowerCase()).not.toContain(
      CONTROLLED_BUYER.toLowerCase()
    );

    const rows = await db
      .prepare(
        "SELECT details FROM audit_events WHERE event_type = 'payment_verification_failed' AND details LIKE ?"
      )
      .bind(`%${outcome.payment_identifier}%`)
      .all<{ details: string }>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.parse(rows.results![0]!.details)).toMatchObject({
      verification_reason: 'invalid_exact_evm_payload_signature',
      trust_class: 'external_verified',
      verification_provider: 'cdp:facilitator',
    });
  });

  it('facilitator unreachable is distinguishable from invalid-signature evaluation', async () => {
    const { seen, fetchImpl } = await harness(async () => {
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    });
    const outcome = await runDiagnostic(fetchImpl, 'https://diag.test', MOCK_EXPECTATIONS);
    expect(seen.verify).toHaveLength(1);
    const rows = await db
      .prepare(
        "SELECT details FROM audit_events WHERE event_type = 'payment_verification_failed' AND details LIKE ?"
      )
      .bind(`%${outcome.payment_identifier}%`)
      .all<{ details: string }>();
    expect(JSON.parse(rows.results![0]!.details)).toMatchObject({
      verification_reason: 'facilitator_verify_unavailable',
      trust_class: 'external_unverified',
    });
  });

  it('an (impossible) facilitator acceptance is flagged as a critical unexpected acceptance', async () => {
    const { fetchImpl } = await harness(async () => ({ isValid: true, payer: UNOWNED_FROM }));
    const outcome = await runDiagnostic(fetchImpl, 'https://diag.test', MOCK_EXPECTATIONS);
    // Whatever the downstream mock settlement does, the runner must never
    // report a facilitator-accepted diagnostic as an ordinary rejection.
    expect(outcome.diagnostic_request_count).toBe(1);
    expect(outcome.error_code).not.toBe('payment_verification_rejected');
    expect(outcome.unexpected_acceptance).toBe(true);
  });

  it('strict live expectations fail closed against a non-conforming challenge: nothing is signed or sent', async () => {
    const { seen, fetchImpl } = await harness(async () => ({ isValid: false }));
    const outcome = await runDiagnostic(fetchImpl, 'https://diag.test');
    expect(outcome.challenge_validated).toBe(false);
    expect(outcome.diagnostic_request_count).toBe(0);
    expect(outcome.failure).toMatch(/challenge mismatch/);
    expect(seen.verify).toHaveLength(0);
  });

  it('safety gate rejects any payload that could be a real buyer authorization', () => {
    const challenge = {
      x402Version: 2,
      resource: { url: `${TARGET_BASE}${TARGET_PATH}` },
      accepts: [
        {
          scheme: 'exact',
          network: EXPECTED_NETWORK,
          asset: EXPECTED_ASSET,
          amount: EXPECTED_AMOUNT,
          payTo: EXPECTED_PAYTO,
          maxTimeoutSeconds: 60,
          extra: { name: 'USD Coin', version: '2', quote_id: 'qte_x' },
        },
      ],
      extensions: {},
    } as unknown as PaymentRequired;
    const good = buildDiagnosticPayload(challenge);
    expect(() => assertDiagnosticPayloadUnspendable(good)).not.toThrow();

    const realish = structuredClone(good) as PaymentPayload;
    (realish.payload as unknown as DiagnosticAuthorization).authorization.from = CONTROLLED_BUYER;
    expect(() => assertDiagnosticPayloadUnspendable(realish)).toThrow();

    const signed = structuredClone(good) as PaymentPayload;
    (signed.payload as unknown as DiagnosticAuthorization).signature = `0x${'ab'.repeat(65)}`;
    expect(() => assertDiagnosticPayloadUnspendable(signed)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The ONE live diagnostic (opt-in; no credentials required or read)
// ---------------------------------------------------------------------------

describe.skipIf(process.env.RUN_FACILITATOR_DIAGNOSTIC !== '1')(
  'LIVE zero-economic facilitator diagnostic',
  () => {
    it('submits exactly one unspendable authorization to the exact diagnostic canary', async () => {
      const outcome = await runDiagnostic((url, init) => fetch(url, init), TARGET_BASE);
      // Single sanitized line: no payload, signature, header or body is printed.
      console.log(`DIAGNOSTIC_RESULT ${JSON.stringify(outcome)}`);
      expect(outcome.diagnostic_request_count).toBe(1);
      expect(outcome.unexpected_acceptance).toBe(false);
    }, 60_000);
  }
);
