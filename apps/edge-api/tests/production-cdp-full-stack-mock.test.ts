/**
 * SUN-1200 checkpoint D — the full outer HTTP production/recovery mock
 * proof (directive §22/§23). Exercises the complete real stack --
 * `buildPaidServicesApp`, real Miniflare D1, the real
 * `resolveProductionCdpEvidenceProvider` gate, the real
 * `buildCdpSellerAddressLookup` and `buildCdpChainReceiptChecker`
 * boundary functions -- but with EVERY external network-facing dependency
 * (the CDP facilitator, the CDP account-lookup client, the chain-RPC
 * client) supplied as an injected, deterministic test double. No real
 * network call, no real `CdpClient`, no real viem RPC client, anywhere in
 * this file. This is deliberately separate from
 * `production-cdp-outer-router.test.ts`, which exercises the real,
 * non-injectable `index.ts` factories and therefore must never reach a
 * genuinely-authorized production path (see that file's own header
 * comment).
 */
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
  generateSiteborneePaymentId,
  type PaymentPayload,
  type PaymentRequired,
  type ProductionAuthorizationInput,
} from '@siteborne/protocol-x402';
import {
  buildCdpSellerAddressLookup,
  resolveProductionCdpEvidenceProvider,
  type CdpAccountLookupClient,
} from '../src/control-plane/config/production-payment';
import { buildCdpChainReceiptChecker } from '../src/control-plane/evidence/chain-receipt-checker';
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
const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const SETTLED_TX = '0x' + 'a'.repeat(64);
const PAYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';

const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

const BINDINGS = {
  SELLER_WALLET_ADDRESS: SELLER,
  CDP_API_KEY_ID: 'mock-key-id',
  CDP_API_KEY_SECRET: 'mock-key-secret',
  // CDP_WALLET_SECRET deliberately omitted (SUN-1200 checkpoint E) -- no
  // longer part of the required production-payment binding set.
};

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

function mockSellerClient(resolvedAddress: string): CdpAccountLookupClient {
  return {
    evm: {
      async getAccount() {
        return { address: resolvedAddress };
      },
    },
  };
}

describe('production CDP full-stack mock (SUN-1200 checkpoint D, directive §22/§23)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-cdp-full-stack-mock-'));
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

  async function buildFullyMockedApp(
    facilitator: HTTPFacilitatorClient,
    chainReceiptResult?: 'SETTLED' | 'FAILED' | 'STILL_UNKNOWN'
  ) {
    const cdpEvidence = await resolveProductionCdpEvidenceProvider(FULLY_AUTHORIZED, BINDINGS, {
      createFacilitatorClient: () => facilitator,
      getAuthenticatedSellerAddress: buildCdpSellerAddressLookup(
        () => mockSellerClient(SELLER),
        SELLER
      ),
    });
    const cdpChainReceiptChecker = chainReceiptResult
      ? buildCdpChainReceiptChecker(() => ({
          async getTransactionReceipt() {
            return chainReceiptResult === 'SETTLED'
              ? { status: 'success' as const }
              : { status: 'reverted' as const };
          },
        }))
      : undefined;
    return buildPaidServicesApp({
      db,
      evidenceMode: cdpEvidence.evidenceMode,
      evidenceProvider: cdpEvidence.evidenceProvider,
      productionAuthorization: FULLY_AUTHORIZED,
      ...(cdpChainReceiptChecker ? { cdpChainReceiptChecker } : {}),
    });
  }

  it('§22 full outer HTTP positive production mock: mainnet challenge, production USDC, seller identity match, verify=1 execute=1 settle=1, receipt, PSL', async () => {
    let verifyCount = 0;
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async verify() {
        verifyCount += 1;
        return { isValid: true, payer: PAYER };
      },
      async settle(context) {
        settleCount += 1;
        const network = (context as { network?: string })?.network ?? 'eip155:8453';
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER };
      },
    });
    const app = await buildFullyMockedApp(facilitator);
    const challenge = await get402(app, '/v2/web/context', WEB_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:8453');
    expect(challenge.accepts[0]!.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

    const res = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION (ac642cb): the 200 body is
    // now the governed v2 wire result -- the full PCC document, or (in
    // this harness) the `result.verification` fragment
    // `createInProcessWorkflowBinding`'s documented, pre-existing,
    // out-of-scope `validatePcc` stub forwards as-is (see
    // in-process-workflow-binding.ts and mcp-four-service-acceptance
    // .test.ts's Section 8 comment). `result_class`/`receipt_id`/
    // `link_id` no longer exist anywhere on the wire body by design --
    // `verification.decision === 'pass'` is the governed nested-location
    // equivalent for this test's "success, receipt, PSL" signal.
    expect(body.decision).toBe('pass');
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);

    // Replay: zero additional economic operations.
    const id = generateSiteborneePaymentId();
    const challenge2 = await get402(app, '/v2/web/context', WEB_INPUT);
    const first = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge2, id);
    expect(first.status).toBe(200);
    const replay = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge2, id);
    expect(replay.status).toBe(200);
    expect(verifyCount).toBe(2);
    expect(settleCount).toBe(2);
  });

  // SUN-1221E6R-H2AWI-3: `attemptCdpRecovery` (SUN-1200 checkpoint C),
  // the mechanism this test proves, is REMOVED -- settlement ambiguity
  // is now resolved exclusively INSIDE the durable Workflow (H2AWI-2's
  // `resolveViaReconciliation`, its own bounded retries happening BEFORE
  // the client ever sees a response), and a same-identifier HTTP retry
  // joins that SAME already-terminal Workflow instance rather than
  // triggering a second, distinct recovery attempt or a fresh "202
  // processing" placeholder. Equivalent settlement-ambiguity/
  // reconciliation coverage lives in H2AWI-2's own
  // `paid-continuation-workflow.test.ts`/
  // `paid-continuation-workflow-crash-matrix.test.ts` (already part of
  // the passing baseline) and in this checkpoint's own required test
  // matrix. Skipped rather than rewritten: this test's premise (a
  // SEPARATE recovery attempt on retry, converging to a NEW outcome) is
  // structurally the anti-pattern this checkpoint's architecture
  // eliminates -- see production-cdp-provider-wiring.test.ts's updated
  // "settlement ambiguous" test for the direct replacement proof.
  it.skip('§23 full outer HTTP recovery mock: ambiguous production settlement, fresh app context, same Payment-Identifier replay reaches recovery, never a generic perpetual 202', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle(context) {
        settleCount += 1;
        if (settleCount === 1) throw new Error('facilitator_transport_timeout');
        const network = (context as { network?: string })?.network ?? 'eip155:8453';
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER };
      },
    });
    const app = await buildFullyMockedApp(facilitator);
    const challenge = await get402(app, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(first.status).toBe(402);
    expect(settleCount).toBe(1);

    // Fresh app instance -- a genuinely new Worker context, only D1 shared.
    const freshApp = await buildFullyMockedApp(facilitator);
    const retry = await payAndRetry(freshApp, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.result_class).toBe('success');
    expect(settleCount).toBe(2);
  });

  // SUN-1221E6R-H2AWI-3: same disclosed reason as the test above --
  // `attemptCdpRecovery`'s chain-receipt-checker step is removed; the
  // Workflow's own settlement step (H2AWI-2) never had a
  // `cdpChainReceiptChecker` port wired to it in this checkpoint.
  it.skip('§23 recovery via chain receipt checker: ambiguous settlement with a candidate tx hash converges via the real (mocked) chain-receipt boundary, zero additional facilitator settle calls', async () => {
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async settle() {
        settleCount += 1;
        return {
          success: true,
          transaction: SETTLED_TX,
          network: 'wrong-network' as never,
          payer: PAYER,
        };
      },
    });
    const app = await buildFullyMockedApp(facilitator, 'SETTLED');
    const challenge = await get402(app, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(first.status).toBe(402);
    expect(settleCount).toBe(1);

    const retry = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(200);
    expect(settleCount).toBe(1);
  });

  it('seller mismatch through the full mocked stack: the mock CDP account lookup resolving a different address fails closed to fixture mode -- testnet, no economic path reachable', async () => {
    const facilitator = mockFacilitator();
    let facilitatorConstructed = false;
    const cdpEvidence = await resolveProductionCdpEvidenceProvider(FULLY_AUTHORIZED, BINDINGS, {
      createFacilitatorClient: () => {
        facilitatorConstructed = true;
        return facilitator;
      },
      getAuthenticatedSellerAddress: buildCdpSellerAddressLookup(
        () => mockSellerClient('0x0000000000000000000000000000000000dEaD'),
        SELLER
      ),
    });
    expect(cdpEvidence.evidenceMode).toBe('fixture');
    expect(facilitatorConstructed).toBe(false);

    // Mirrors `index.ts`'s own `resolveCdpEvidence` lockstep derivation
    // (checkpoint B's real finding #1): `productionAuthorization` must
    // never be more permissive than `cdpEvidence.evidenceMode` actually
    // achieved, or this test would itself reproduce that exact
    // truthfulness defect (a mainnet challenge with zero real settlement
    // capability behind it).
    const productionAuthorization =
      cdpEvidence.evidenceMode === 'production'
        ? FULLY_AUTHORIZED
        : {
            environment: 'preproduction' as const,
            productionEnabled: false,
            humanBootstrapAuthorized: false,
            productionCredentialsApproved: false,
          };
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: cdpEvidence.evidenceMode,
      evidenceProvider: cdpEvidence.evidenceProvider,
      productionAuthorization,
    });
    const challenge = await get402(app, '/v2/web/context', WEB_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:84532');
  });
});
