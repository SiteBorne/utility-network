/**
 * SUN-1200 checkpoint B — proves the real `CdpPaymentEvidenceProvider`
 * (not a hand-rolled double) integrates correctly through the complete
 * production-configured HTTP → verify → execute → settle → receipt →
 * PSL → D1 lifecycle, using a mock `HTTPFacilitatorClient` (no real
 * network call, matching `apps/edge-api/tests/cdp-provider.test.ts`'s
 * own established mock pattern). Real Miniflare D1 throughout — never
 * the in-memory repository.
 *
 * ORIGINAL FINDING (checkpoint B, now resolved by checkpoint C): CDP-rail
 * settlement had no Nevermined-style recovery path at all -- ANY settle
 * rejection (explicit or ambiguous) went straight to the terminal
 * `settlement_failed` state, and a same-Payment-Identifier retry
 * returned 202 "processing" indefinitely, forever, with no way to ever
 * resolve it. SUN-1200 checkpoint C (`attemptCdpRecovery` in
 * `x402-service.ts`) fixed this: `settlement_failed` now durably
 * classifies `explicit_rejection` (permanently terminal, unchanged) vs
 * `ambiguous` (recoverable). A same-identifier retry against an
 * `ambiguous` row now performs read-only chain reconciliation (when
 * wired -- it isn't, in this repository, today) or a bounded, single,
 * identical `.settle()` retry, converging to either a real success or a
 * new, honest, distinct `503 settlement_manual_reconciliation_required`
 * status -- never a silent permanent 202. See
 * `apps/edge-api/tests/production-cdp-settlement-recovery.test.ts` for
 * the full checkpoint C recovery-convergence test suite.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import type { PaymentRequired, PaymentPayload } from '@siteborne/protocol-x402';
import {
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  generateSiteborneePaymentId,
  type ProductionAuthorizationInput,
} from '@siteborne/protocol-x402';
import { CdpPaymentEvidenceProvider } from '../src/control-plane/evidence/cdp-provider';
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
const COMPANY_INPUT = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
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

const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

const SETTLED_TX = '0x' + 'a'.repeat(64);
const PAYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';

/** Matches `apps/edge-api/tests/cdp-provider.test.ts`'s own established
 * mock-facilitator pattern. Never a real network call. */
function mockFacilitator(
  overrides: Partial<Pick<HTTPFacilitatorClient, 'verify' | 'settle'>> = {}
): HTTPFacilitatorClient {
  return {
    async verify() {
      return { isValid: true, payer: PAYER };
    },
    async settle(context: unknown) {
      const network = (context as { network?: string })?.network ?? 'eip155:8453';
      // `amount` deliberately omitted: CdpPaymentEvidenceProvider treats
      // a defined `response.amount` that disagrees with the real
      // actualAmount as `settlement_amount_mismatch` -- tests that care
      // about the settled amount override `settle()` with the correct
      // value explicitly (see the exact/upto positive-lifecycle tests).
      return {
        success: true,
        transaction: SETTLED_TX,
        network,
        payer: PAYER,
      };
    },
    async getSupported() {
      return { kinds: [], extensions: [], signers: {} };
    },
    ...overrides,
  } as unknown as HTTPFacilitatorClient;
}

describe('production CDP provider wiring (SUN-1200 checkpoint B)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-cdp-provider-wiring-'));
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

  it('exact positive lifecycle: real CdpPaymentEvidenceProvider + mock facilitator, production network/asset, verify=1 execute=1 settle=1', async () => {
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
        // 8000 = the governed web_context_verified.v2 direct price (0.008 USD). This
        // previously read 9000 (the v1 price) because the fixture v2 route quoted the
        // v1 pricing key; the fixture now derives it from the canonical contract.
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER, amount: '8000' };
      },
    });
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'production',
      evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
      productionAuthorization: FULLY_AUTHORIZED,
    });
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
    // .test.ts's Section 8 comment), regardless of production/fixture
    // evidence mode -- empirically confirmed identical for this exact
    // production-CDP-evidenced route. `result_class` no longer exists on
    // the wire body; `verification.decision === 'pass'` is its governed
    // nested-location equivalent.
    expect(body.decision).toBe('pass');
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);
  });

  // SUN-1221E6R-H2AWI-3: `upto` scheme is intentionally, honestly
  // rejected wholesale by the new durable-continuation pipeline this
  // checkpoint -- see x402-service-route.test.ts's "upto scheme is not
  // supported" describe block and the checkpoint's evidence report.
  it.skip('upto positive lifecycle: max=190000, actual=12000, production network/asset, verify=1 execute=1 settle=1', async () => {
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
        return { success: true, transaction: SETTLED_TX, network, payer: PAYER, amount: '12000' };
      },
    });
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'production',
      evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const challenge = await get402(app, '/v2/document/evidence-json', DOCUMENT_INPUT);
    expect(challenge.accepts[0]!.network).toBe('eip155:8453');
    expect(challenge.accepts[0]!.amount).toBe('190000');

    const res = await payAndRetry(app, '/v2/document/evidence-json', DOCUMENT_INPUT, challenge);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.result_class).toBe('success');
    expect(body.actual_amount).toBe('12000');
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);
  });

  it('replay after success: resubmitting the same Payment-Identifier never re-verifies, re-executes, or re-settles', async () => {
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
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'production',
      evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const challenge = await get402(app, '/v2/verify/agent-output', AGENT_INPUT);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(app, '/v2/verify/agent-output', AGENT_INPUT, challenge, id);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);

    const second = await payAndRetry(app, '/v2/verify/agent-output', AGENT_INPUT, challenge, id);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
    // Zero additional real-provider calls on replay.
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);
  });

  it('settlement rejected (explicit): the facilitator explicitly declining settlement never reports a paid success; a same-identifier retry never re-processes (real, observed behavior)', async () => {
    let verifyCount = 0;
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async verify() {
        verifyCount += 1;
        return { isValid: true, payer: PAYER };
      },
      async settle() {
        settleCount += 1;
        return { success: false, errorReason: 'insufficient_funds' };
      },
    });
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'production',
      evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT);
    const id = generateSiteborneePaymentId();
    const res = await payAndRetry(app, '/v2/company/evidence-graph', COMPANY_INPUT, challenge, id);
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('settlement_rejected');
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);

    // SUN-1200 checkpoint C (real, observed, not assumed): the mock
    // facilitator's `settle()` returned normally with `success: false` and
    // a real `errorReason` ('insufficient_funds') -- `CdpPaymentEvidenceProvider`
    // surfaces this as `trust_class: 'external_verified'` with that exact
    // reason, which `isExplicitCdpSettlementFailure` classifies as
    // `explicit_rejection` (a definitive, structurally-clean "no" from the
    // facilitator, not one of the provider's own structural-mismatch
    // labels). A same-Payment-Identifier retry is therefore permanently
    // terminal: `attemptCdpRecovery` reconstructs the same 402 without
    // ever calling the provider again -- a real buyer whose settlement was
    // explicitly rejected must submit a genuinely NEW Payment-Identifier
    // to retry.
    const retry = await payAndRetry(
      app,
      '/v2/company/evidence-graph',
      COMPANY_INPUT,
      challenge,
      id
    );
    expect(retry.status).toBe(402);
    const retryBody = (await retry.json()) as Record<string, unknown>;
    expect(retryBody.error).toBe('settlement_rejected');
    // Zero additional real-provider calls -- explicit rejection never
    // re-invokes the facilitator.
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);
  });

  it('settlement ambiguous (real system behavior): a thrown/ambiguous CDP settle response also reaches settlement_failed; a same-identifier retry never re-processes -- same disclosed finding as the explicit-rejection case', async () => {
    let verifyCount = 0;
    let settleCount = 0;
    const facilitator = mockFacilitator({
      async verify() {
        verifyCount += 1;
        return { isValid: true, payer: PAYER };
      },
      async settle() {
        settleCount += 1;
        throw new Error('facilitator_transport_timeout');
      },
    });
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'production',
      evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const challenge = await get402(app, '/v2/web/context', WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const res = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge, id);
    // CdpPaymentEvidenceProvider.settle() catches the facilitator
    // exception and returns a structured rejection (never lets a raw
    // throw escape the route) -- confirmed by this real integration
    // test, not assumed.
    expect(res.status).toBe(402);
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);

    // SUN-1221E6R-H2AWI-3: was "a thrown facilitator exception... produces
    // trust_class: 'external_unverified'... attemptCdpRecovery performs
    // its one bounded, identical .settle() retry... converges to a new,
    // distinct 503 settlement_manual_reconciliation_required" before this
    // checkpoint. `attemptCdpRecovery` (and its bounded retry-then-503
    // escalation) is REMOVED -- settlement, and a same-identifier retry's
    // join, are now owned exclusively by the durable Workflow (H2AWI-2),
    // whose own zero-blind-retry invariant on the settle step means a
    // retry NEVER triggers a second real `.settle()` call. A retry
    // instead joins the SAME already-terminal Workflow instance and
    // observes its ALREADY-DECIDED outcome -- the same honest
    // `402 settlement_rejected` the first request got, not a two-tier
    // "different answer on retry" response. This is architecturally the
    // stronger guarantee mission §9/§16 requires (HTTP_SETTLE_CALL_COUNT_MAX=0,
    // WORKFLOW_SETTLE_CALL_COUNT_MAX=1 -- proven exactly once per
    // payment_identifier, never twice even across retries).
    const retry = await payAndRetry(app, '/v2/web/context', WEB_INPUT, challenge, id);
    expect(retry.status).toBe(402);
    const retryBody = (await retry.json()) as Record<string, unknown>;
    expect(retryBody.error).toBe('settlement_rejected');
    // The retry made NO additional real settle() call (and no second
    // verify) -- it joined the same already-terminal Workflow instance.
    expect(verifyCount).toBe(1);
    expect(settleCount).toBe(1);
  });
});
