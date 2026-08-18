/**
 * SUN-1200 checkpoint C — CDP-rail settlement-recovery convergence.
 * Proves `attemptCdpRecovery` (`x402-service.ts`) against the real
 * `CdpPaymentEvidenceProvider` with a mock `HTTPFacilitatorClient` (no
 * real network call, matching `production-cdp-provider-wiring.test.ts`'s
 * own established pattern). Real Miniflare D1 throughout.
 *
 * Frozen recovery policy under test (user-authorized "OPTION 1 —
 * RETRY-BASED CDP SETTLEMENT CONVERGENCE"): for a `duplicate_same` retry
 * on a `settlement_failed` CDP payment attempt --
 *   1. `explicit_rejection` is permanently terminal: reconstruct the same
 *      402, never call the provider again.
 *   2. `ambiguous` with both a candidate transaction reference and a
 *      wired `cdpChainReceiptChecker`: read-only chain reconciliation
 *      first, no facilitator write.
 *   3. Otherwise: at most ONE bounded, identical `.settle()` retry.
 *      Converges to a real success, or to a new, honest, distinct `503
 *      settlement_manual_reconciliation_required` if still ambiguous --
 *      never a silent permanent 202, never a false success, never a
 *      second automatic retry within the same recovery invocation.
 *
 * `exact` (EIP-3009) and `upto` (Permit2) authorizations are both
 * single-use at the smart-contract level per the x402 spec, so an
 * identical retry payload can never itself produce a second successful
 * on-chain charge -- this is the real-world justification for treating
 * settle-retry as safe recovery rather than a double-spend risk.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import type { Network, PaymentRequired, PaymentPayload } from '@siteborne/protocol-x402';
import {
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  generateSiteborneePaymentId,
  type ProductionAuthorizationInput,
} from '@siteborne/protocol-x402';
import { CdpPaymentEvidenceProvider } from '../src/control-plane/evidence/cdp-provider';
import {
  buildPaidServicesApp,
  type PaidServicesConfig,
} from '../src/control-plane/routes/paid-services';

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

function buildBuyerPayload(challenge: PaymentRequired, id?: string): PaymentPayload {
  const requirement = challenge.accepts[0];
  const extensions = buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}, id);
  return {
    x402Version: 2,
    resource: challenge.resource,
    accepted: requirement,
    payload: { synthetic_signature: 'synthetic:buyer-fixture' },
    extensions,
  };
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

async function payAndRetry(
  app: Awaited<ReturnType<typeof buildPaidServicesApp>>,
  path: string,
  body: unknown,
  challenge: PaymentRequired,
  id?: string
) {
  const payload = buildBuyerPayload(challenge, id);
  const header = encodePaymentSignatureHeaderSafe(payload);
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
    body: JSON.stringify(body),
  });
}

const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
const DOCUMENT_INPUT = {
  artifact_reference: {
    artifact_id: 'doc/native-fixture.pdf',
    media_type: 'application/pdf',
    size_bytes: 1,
  },
};

const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

const SETTLED_TX = '0x' + 'a'.repeat(64);
const PAYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';

function mockFacilitator(
  overrides: Partial<Pick<HTTPFacilitatorClient, 'verify' | 'settle'>> = {}
): HTTPFacilitatorClient {
  return {
    async verify() {
      return { isValid: true, payer: PAYER };
    },
    async settle(context: unknown) {
      const network = (context as { network?: string })?.network ?? 'eip155:8453';
      return { success: true, transaction: SETTLED_TX, network, payer: PAYER };
    },
    async getSupported() {
      return { kinds: [], extensions: [], signers: {} };
    },
    ...overrides,
  } as unknown as HTTPFacilitatorClient;
}

describe('production CDP settlement recovery (SUN-1200 checkpoint C)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-cdp-settlement-recovery-'));
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

  function app(
    facilitator: HTTPFacilitatorClient,
    extra: Partial<PaidServicesConfig> = {}
  ): Promise<Awaited<ReturnType<typeof buildPaidServicesApp>>> {
    return buildPaidServicesApp({
      db,
      evidenceMode: 'production',
      evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
      productionAuthorization: FULLY_AUTHORIZED,
      ...extra,
    });
  }

  // ---- exact scheme -------------------------------------------------

  it('exact Case B: ambiguous (transport failure), no chain checker wired -- bounded identical retry converges to real success (facilitator attempts=2, successful settlements=1, execution=1)', async () => {
    let verifyCount = 0;
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async verify() {
        verifyCount += 1;
        return { isValid: true, payer: PAYER };
      },
      async settle(context) {
        settleCount += 1;
        if (settleCount === 1) throw new Error('facilitator_transport_timeout');
        const network = (context as { network?: string })?.network ?? 'eip155:8453';
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER };
      },
    });
    const a = await app(facilitator);
    const challenge = await get402(a, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(first.status).toBe(402);
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.result_class).toBe('success');
    // Never re-executed and never re-verified during recovery.
    expect(verifyCount).toBe(1);
    // Exactly one bounded retry -- two total facilitator settle attempts,
    // one successful economic settlement.
    expect(settleCount).toBe(2);
  });

  it('exact Case C: ambiguous, retry also ambiguous -- no automatic third settle, remains explicitly recoverable, never auto-marked settled', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle() {
        settleCount += 1;
        throw new Error('facilitator_transport_timeout');
      },
    });
    const a = await app(facilitator);
    const challenge = await get402(a, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(first.status).toBe(402);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(503);
    const retryBody = (await retry.json()) as Record<string, unknown>;
    expect(retryBody.status).toBe('settlement_manual_reconciliation_required');
    // Exactly one bounded retry per recovery invocation -- never a tight
    // loop, never a second automatic attempt within this same call.
    expect(settleCount).toBe(2);

    // A THIRD replay (a second, independent recovery invocation) is
    // allowed to attempt one more bounded retry each time it is
    // separately invoked -- still never more than one settle call per
    // invocation, and still never a false success while the facilitator
    // keeps failing.
    const secondRetry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(secondRetry.status).toBe(503);
    expect(settleCount).toBe(3);
  });

  it('exact Case A: candidate transaction reference + wired cdpChainReceiptChecker -- read-only chain check converges to success with zero additional facilitator settle calls', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle() {
        settleCount += 1;
        // Returns success with a transaction hash but the WRONG network,
        // so `CdpPaymentEvidenceProvider` classifies it as
        // `settlement_network_mismatch` -- structural, ambiguous, never
        // explicit -- while still surfacing a real transaction reference
        // for the read-only chain checker to reconcile.
        return {
          success: true,
          transaction: SETTLED_TX,
          network: 'wrong-network' as Network,
          payer: PAYER,
        };
      },
    });
    let checkerCalls = 0;
    const a = await app(facilitator, {
      cdpChainReceiptChecker: async (txRef, network) => {
        checkerCalls += 1;
        expect(txRef).toBe(SETTLED_TX);
        expect(network).toBe('eip155:8453');
        return 'SETTLED';
      },
    });
    const challenge = await get402(a, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(first.status).toBe(402);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.result_class).toBe('success');
    // Chain check resolved recovery -- zero additional facilitator
    // settle() calls.
    expect(checkerCalls).toBe(1);
    expect(settleCount).toBe(1);
  });

  it('chain checker returns FAILED -- converges to explicit, terminal rejection without a facilitator retry', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle() {
        settleCount += 1;
        return {
          success: true,
          transaction: SETTLED_TX,
          network: 'wrong-network' as Network,
          payer: PAYER,
        };
      },
    });
    const a = await app(facilitator, {
      cdpChainReceiptChecker: async () => 'FAILED',
    });
    const challenge = await get402(a, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(402);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.error).toBe('settlement_rejected');
    // A chain-confirmed failure never triggers a facilitator settle
    // retry.
    expect(settleCount).toBe(1);

    // Now permanently terminal -- a third attempt still never re-calls
    // the facilitator.
    const secondRetry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(secondRetry.status).toBe(402);
    expect(settleCount).toBe(1);
  });

  it('chain checker returns STILL_UNKNOWN -- falls through to the bounded settle retry, exactly like no checker being wired at all', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle(context) {
        settleCount += 1;
        if (settleCount === 1) {
          return {
            success: true,
            transaction: SETTLED_TX,
            network: 'wrong-network' as Network,
            payer: PAYER,
          };
        }
        const network = (context as { network?: string })?.network ?? 'eip155:8453';
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER };
      },
    });
    let checkerCalls = 0;
    const a = await app(facilitator, {
      cdpChainReceiptChecker: async () => {
        checkerCalls += 1;
        return 'STILL_UNKNOWN';
      },
    });
    const challenge = await get402(a, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(checkerCalls).toBe(1);
    expect(retry.status).toBe(200);
    expect(settleCount).toBe(2);
  });

  it('explicit rejection is never converted into ambiguous recovery merely because retry-based recovery now exists', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle() {
        settleCount += 1;
        return { success: false, errorReason: 'insufficient_funds' };
      },
    });
    const a = await app(facilitator);
    const challenge = await get402(a, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(402);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.error).toBe('settlement_rejected');
    // Explicit rejection never re-invokes the facilitator, ever.
    expect(settleCount).toBe(1);
  });

  // ---- upto scheme ----------------------------------------------------

  it('upto: ambiguous settlement recovers via bounded retry, preserving authorized_maximum=190000 / actual_amount=12000', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle(context) {
        settleCount += 1;
        if (settleCount === 1) throw new Error('facilitator_transport_timeout');
        const network = (context as { network?: string })?.network ?? 'eip155:8453';
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER, amount: '12000' };
      },
    });
    const a = await app(facilitator);
    const challenge = await get402(a, '/v2/document/evidence-json', DOCUMENT_INPUT);
    expect(challenge.accepts[0]!.amount).toBe('190000');
    const id = generateSiteborneePaymentId();
    await payAndRetry(a, '/v2/document/evidence-json', DOCUMENT_INPUT, challenge, id);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/document/evidence-json', DOCUMENT_INPUT, challenge, id);
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.result_class).toBe('success');
    expect(body.authorized_maximum).toBe('190000');
    expect(body.actual_amount).toBe('12000');
    expect(settleCount).toBe(2);
  });

  it('upto: ambiguous with no decisive evidence remains explicitly ambiguous, never silently reconciled as settled', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle() {
        settleCount += 1;
        throw new Error('facilitator_transport_timeout');
      },
    });
    const a = await app(facilitator);
    const challenge = await get402(a, '/v2/document/evidence-json', DOCUMENT_INPUT);
    const id = generateSiteborneePaymentId();
    await payAndRetry(a, '/v2/document/evidence-json', DOCUMENT_INPUT, challenge, id);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(a, '/v2/document/evidence-json', DOCUMENT_INPUT, challenge, id);
    expect(retry.status).toBe(503);
    expect(settleCount).toBe(2);
  });

  // ---- crash/restart proof --------------------------------------------

  it('crash/restart proof: recovery works identically from a brand-new app instance sharing the same D1, no in-memory module dependency', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle(context) {
        settleCount += 1;
        if (settleCount === 1) throw new Error('facilitator_transport_timeout');
        const network = (context as { network?: string })?.network ?? 'eip155:8453';
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER };
      },
    });
    const firstApp = await app(facilitator);
    const challenge = await get402(firstApp, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(firstApp, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(first.status).toBe(402);
    expect(settleCount).toBe(1);

    // A genuinely fresh app instance (fresh Hono app, fresh repository
    // instances, fresh in-memory closures) -- only `db` is shared, exactly
    // as a real Worker restart or a request routed to a different isolate
    // would look.
    const restartedApp = await app(facilitator);
    const retry = await payAndRetry(restartedApp, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.result_class).toBe('success');
    expect(settleCount).toBe(2);
  });
});
