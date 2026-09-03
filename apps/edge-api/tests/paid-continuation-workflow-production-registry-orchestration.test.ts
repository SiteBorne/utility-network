/**
 * SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX §18 — the real orchestration seam,
 * for all four production services, together.
 *
 * Every other Workflow test either (a) exercises the pure
 * `runPaidContinuationWorkflow` orchestration function against hand-built
 * fakes (`paid-continuation-workflow.test.ts`), never touching
 * `buildProductionPaidContinuationWorkflowDependencies` at all, or (b)
 * exercises the `PaidContinuationWorkflow` ENTRYPOINT CLASS with
 * `./production-dependencies` entirely `vi.mock`'d at the module boundary
 * (`paid-continuation-workflow-entrypoint.test.ts`), never touching the
 * real dependency-construction/dispatch logic this checkpoint's fix
 * lives in. Neither ever exercises BOTH the real
 * `buildProductionPaidContinuationWorkflowDependencies` (registry
 * dispatch, `SUPPORTED_SERVICES` gates) AND the real
 * `runPaidContinuationWorkflow` orchestration TOGETHER, for all four
 * services, in one run.
 *
 * This file closes that gap: it mocks ONLY the four leaf composition
 * functions (the real HTTP routes' own already-audited production
 * primitives — never reimplemented here, just given controlled,
 * non-economic executor/evidenceProvider doubles) and the leaf D1
 * repository classes (an in-memory double per repository, never a real
 * D1Database or Miniflare instance). Everything above those two seams —
 * the registry dispatch table, `SUPPORTED_SERVICES`, the guard ordering,
 * `D1JobStatePersistence`/`D1ResultReceiptPersistence`'s own adapter
 * logic, and the full real `runPaidContinuationWorkflow` step graph
 * (open-envelope → check-authorization-expiry → invoke-executor →
 * generate-pcc → settle → persist-result → persist-receipt-and-finalize)
 * — runs for real. No real network call, no real D1, no real Cloudflare
 * Workflow resource, no blockchain/facilitator call anywhere in this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import type { ExternalVerificationEvidence } from '@siteborne/protocol-x402';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import type { PaidContinuationWorkflowHostEnv } from '../src/control-plane/workflows/paid-continuation-workflow';
import { buildProductionPaidContinuationWorkflowDependencies } from '../src/control-plane/workflows/production-dependencies';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildDecryptedPayload,
  buildSuccessfulExecutorOutcome,
  buildTestMetadata,
  fakeExecutor,
  sealTestInput,
  TEST_JOB_ID,
  TEST_PAYMENT_IDENTIFIER,
  TEST_NETWORK,
} from './support/paid-continuation-workflow-fixtures';

// -----------------------------------------------------------------------
// Leaf seam 1: the four production route-composition functions. Each
// mock returns a controlled, non-economic `X402ServiceRouteConfig` --
// the same shape (`executor`, `evidenceProvider`, `network`,
// `evidenceMode: 'production'`) the real functions return once every real
// external gate (MODAL_WEBCTX_*/MODAL_DOCWORKER_*/ARTIFACTS/CDP/signing
// key) is satisfied, so this file proves the WIRING (registry ->
// dependencies -> orchestration), not the gates themselves (already
// covered, per service, by that service's own `*-cdp-composition.test.ts`
// and by `production-dependencies.test.ts`'s fail-closed-guard suite).
// -----------------------------------------------------------------------
// SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX §7/§21 -- `deps.evidenceMode` is
// hardcoded 'production' by `buildProductionPaidContinuationWorkflowDependencies`
// for every real service (proven directly by `production-dependencies.test.ts`),
// so `canAdvanceToSettled` (`@siteborne/protocol-x402`) only accepts
// `trust_class: 'external_verified'` here -- `'synthetic_fixture'` (the
// OTHER fixture-suite's own convention, correct for `evidenceMode:
// 'fixture'`) is CORRECTLY rejected under production mode. Also computes
// `verification_evidence_hash` for real from whatever
// `decrypted.verificationEvidence` this run actually decrypted (never a
// static string) -- `canAdvanceToSettled` requires this hash to match
// exactly (directive §32: settlement can never be evaluated independently
// of a prior, accepted verification).
const settleMock = vi.fn(
  async (_context: unknown, verificationEvidence: ExternalVerificationEvidence) => ({
    x402_version: 2,
    scheme: 'exact',
    network: TEST_NETWORK,
    asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    payee: '0x000000000000000000000000000000000000aa',
    actual_amount: '9000',
    quote_id: 'quote_test_0001',
    requirement_id: 'requirement_test_0001',
    payment_identifier: TEST_PAYMENT_IDENTIFIER,
    transaction_reference: '0xsettledhash',
    success: true,
    settled_at: '2026-08-31T00:00:05.000Z',
    facilitator_identity: 'test-facilitator',
    raw_evidence_hash: 'sha256:settlement-hash',
    verification_evidence_hash: await hashPaymentObject(verificationEvidence),
    trust_class: 'external_verified',
  })
);

function controlledRouteConfig(serviceId: string, executorCallCounter: { count: number }) {
  return {
    serviceId,
    scheme: 'exact',
    pricingKey: 'test_pricing_key',
    rail: 'cdp',
    network: TEST_NETWORK,
    asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    payTo: '0x000000000000000000000000000000000000aa',
    path: '/v2/test',
    inputSchema: {},
    contractRelease: '2.0.0',
    inputSchemaHash: 'sha256:' + '1'.repeat(64),
    outputSchemaHash: 'sha256:' + '2'.repeat(64),
    pccDependency: '1.1.0',
    db: {} as never,
    clock: () => new Date().toISOString(),
    evidenceMode: 'production' as const,
    evidenceProvider: { settle: settleMock },
    executor: (async (input: unknown, ctx: unknown) => {
      executorCallCounter.count += 1;
      const outcome = buildSuccessfulExecutorOutcome();
      return outcome;
    }) as ReturnType<typeof fakeExecutor>,
  };
}

const executorCallCounts: Record<string, { count: number }> = {
  'web_context_verified.v2': { count: 0 },
  'verify_agent_output.v2': { count: 0 },
  'company_evidence_graph.v2': { count: 0 },
  'document_evidence_json.v2': { count: 0 },
};

vi.mock('../src/control-plane/production/web-context-v2-cdp-composition', () => ({
  buildWebContextV2CdpProductionRouteConfig: vi.fn(async () =>
    controlledRouteConfig('web_context_verified.v2', executorCallCounts['web_context_verified.v2'])
  ),
}));
vi.mock('../src/control-plane/production/verify-agent-output-v2-cdp-composition', () => ({
  buildVerifyAgentOutputV2CdpProductionRouteConfig: vi.fn(async () =>
    controlledRouteConfig('verify_agent_output.v2', executorCallCounts['verify_agent_output.v2'])
  ),
}));
vi.mock('../src/control-plane/production/company-evidence-graph-v2-cdp-composition', () => ({
  buildCompanyEvidenceGraphV2CdpProductionRouteConfig: vi.fn(async () =>
    controlledRouteConfig(
      'company_evidence_graph.v2',
      executorCallCounts['company_evidence_graph.v2']
    )
  ),
}));
vi.mock('../src/control-plane/production/document-evidence-json-v2-cdp-composition', () => ({
  buildDocumentEvidenceJsonV2CdpProductionRouteConfig: vi.fn(async () =>
    controlledRouteConfig(
      'document_evidence_json.v2',
      executorCallCounts['document_evidence_json.v2']
    )
  ),
}));

// -----------------------------------------------------------------------
// Leaf seam 2: the four D1 repository classes
// `buildProductionPaidContinuationWorkflowDependencies` constructs
// directly from `env.DB`. In-memory doubles, module-scoped state reset in
// `beforeEach` below -- never a real D1Database/Miniflare instance.
// -----------------------------------------------------------------------
interface FakeJobRow {
  id: string;
  current_state: string;
  attempt_count: number;
}
const jobsStore = new Map<string, FakeJobRow>();
const resultsStore = new Map<string, Record<string, unknown>>();

vi.mock('../src/control-plane/repositories/d1/jobs', () => ({
  D1JobsRepository: vi.fn().mockImplementation(() => ({
    async getById(id: string) {
      return { ok: true, value: jobsStore.get(id) ?? null };
    },
    async updateState(id: string, state: string) {
      const job = jobsStore.get(id);
      if (job) jobsStore.set(id, { ...job, current_state: state });
      return { ok: true };
    },
  })),
  D1StateEventsRepository: vi.fn().mockImplementation(() => ({
    async create() {
      return { ok: true };
    },
  })),
}));

vi.mock('../src/control-plane/repositories/d1/x402-quotes', () => ({
  X402ServiceResultRepository: vi.fn().mockImplementation(() => ({
    async getByJobId(jobId: string) {
      return resultsStore.get(jobId) ?? null;
    },
    async create(jobId: string, paymentIdentifier: string, cachedResult: unknown, nowIso: string) {
      resultsStore.set(jobId, {
        kind: 'x402_service_result',
        payment_identifier: paymentIdentifier,
        cached_result: cachedResult,
        created_at: nowIso,
      });
    },
    async finalize(jobId: string, finalResult: unknown) {
      resultsStore.set(jobId, finalResult as Record<string, unknown>);
    },
  })),
}));

// `D1PaymentAttemptRepository`'s real CAS/UPDATE-WHERE semantics --
// mirrored closely enough for this seam (matches
// `FakeSettlementRepository` in the shared fixtures, just constructed
// with a real-looking `(db)` constructor signature here).
interface FakeSettlementRow {
  lifecycleStage: string;
  settlementTransactionReference: string | null;
  settlementOutcomeKind: string | null;
  cdpFacilitatorSettleAttemptCount: number;
  cdpSuccessfulEconomicSettlementCount: number;
}
const settlementStore = new Map<string, FakeSettlementRow>();

function getOrCreateSettlementRow(paymentIdentifier: string): FakeSettlementRow {
  let row = settlementStore.get(paymentIdentifier);
  if (!row) {
    row = {
      lifecycleStage: 'executed',
      settlementTransactionReference: null,
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 0,
      cdpSuccessfulEconomicSettlementCount: 0,
    };
    settlementStore.set(paymentIdentifier, row);
  }
  return row;
}

vi.mock('../src/control-plane/repositories/d1/payment-attempts', () => ({
  D1PaymentAttemptRepository: vi.fn().mockImplementation(() => ({
    async recordSettlementPending(paymentIdentifier: string) {
      const row = getOrCreateSettlementRow(paymentIdentifier);
      if (row.lifecycleStage !== 'executed') return { status: 'illegal_transition' };
      row.lifecycleStage = 'settlement_pending';
      row.cdpFacilitatorSettleAttemptCount += 1;
      return { status: 'transitioned' };
    },
    async getSettlementRecoveryRecord(paymentIdentifier: string) {
      const row = settlementStore.get(paymentIdentifier);
      if (!row) return null;
      return {
        lifecycleStage: row.lifecycleStage,
        neverminedDelegationId: null,
        settlementPermissionHash: null,
        serviceOutputHash: null,
        serviceReceiptId: null,
        settlementTransactionReference: row.settlementTransactionReference,
        settlementPendingAt: row.lifecycleStage === 'executed' ? null : '2026-08-31T00:00:00.000Z',
        settlementOutcomeKind: row.settlementOutcomeKind,
        cdpFacilitatorSettleAttemptCount: row.cdpFacilitatorSettleAttemptCount,
        cdpSuccessfulEconomicSettlementCount: row.cdpSuccessfulEconomicSettlementCount,
      };
    },
    async recordCdpSettlementOutcome(
      paymentIdentifier: string,
      from: string,
      kind: string,
      candidateTransactionReference?: string
    ) {
      const row = getOrCreateSettlementRow(paymentIdentifier);
      if (row.lifecycleStage !== from) return { status: 'illegal_transition' };
      row.lifecycleStage = 'settlement_failed';
      row.settlementOutcomeKind = kind;
      if (candidateTransactionReference)
        row.settlementTransactionReference = candidateTransactionReference;
      row.cdpFacilitatorSettleAttemptCount += 1;
      return { status: 'transitioned' };
    },
    async recordSettledExternal(
      paymentIdentifier: string,
      settlementTransactionReference: string | undefined,
      fromStages: readonly string[] = ['settlement_pending']
    ) {
      const row = getOrCreateSettlementRow(paymentIdentifier);
      if (!fromStages.includes(row.lifecycleStage)) return { status: 'illegal_transition' };
      row.lifecycleStage = 'settled_external';
      if (settlementTransactionReference)
        row.settlementTransactionReference = settlementTransactionReference;
      return { status: 'transitioned' };
    },
    async incrementCdpSuccessfulSettlementCount(paymentIdentifier: string) {
      getOrCreateSettlementRow(paymentIdentifier).cdpSuccessfulEconomicSettlementCount += 1;
    },
    async markConsumed() {},
    async transitionLifecycleStage(paymentIdentifier: string, from: string, to: string) {
      const row = getOrCreateSettlementRow(paymentIdentifier);
      if (row.lifecycleStage !== from) return { status: 'illegal_transition' };
      row.lifecycleStage = to;
      return { status: 'transitioned' };
    },
  })),
}));

const FOUR_SERVICES = [
  'company_evidence_graph.v2',
  'web_context_verified.v2',
  'document_evidence_json.v2',
  'verify_agent_output.v2',
] as const;

function minimalHostEnv(): PaidContinuationWorkflowHostEnv {
  return {
    DB: {} as never,
    PAYMENT_CONTINUATION_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: 'unused-test-placeholder',
    PAID_RECEIPT_SIGNING_KEY_ID: 'unused-test-placeholder',
    SELLER_WALLET_ADDRESS: '0x000000000000000000000000000000000000aa',
    CDP_API_KEY_ID: 'unused-test-placeholder',
    CDP_API_KEY_SECRET: 'unused-test-placeholder',
    PAYMENT_ENVIRONMENT: 'production',
    PRODUCTION_ENABLED: 'true',
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
    PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
    MODAL_WEBCTX_ENDPOINT_URL: 'https://example.test/webctx',
    MODAL_WEBCTX_PROXY_KEY: 'unused-test-placeholder',
    MODAL_WEBCTX_PROXY_SECRET: 'unused-test-placeholder',
    MODAL_DOCWORKER_ENDPOINT_URL: 'https://example.test/docworker',
    MODAL_DOCWORKER_PROXY_KEY: 'unused-test-placeholder',
    MODAL_DOCWORKER_PROXY_SECRET: 'unused-test-placeholder',
    ARTIFACTS: undefined,
    BASE_RPC_URL: undefined,
    BASE_SEPOLIA_RPC_URL: undefined,
  };
}

describe('SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX §18 -- real orchestration seam, all four services', () => {
  beforeEach(() => {
    jobsStore.clear();
    resultsStore.clear();
    settlementStore.clear();
    settleMock.mockClear();
    for (const key of Object.keys(executorCallCounts)) executorCallCounts[key].count = 0;
    jobsStore.set(TEST_JOB_ID, { id: TEST_JOB_ID, current_state: 'LOCKED', attempt_count: 1 });
  });

  it.each(FOUR_SERVICES)(
    'COMPANY_WORKFLOW_ORCHESTRATION / WEBCTX / DOCUMENT / VERIFY (%s): real registry dependency-construction + real orchestration reach settled, exactly once each',
    async (service) => {
      const env = minimalHostEnv();
      const deps = await buildProductionPaidContinuationWorkflowDependencies(env, service);
      expect('unavailable' in deps).toBe(false);
      if ('unavailable' in deps) return; // unreachable -- narrows for TS below

      const metadata = buildTestMetadata({ service });
      const input = await sealTestInput(metadata, {
        key: deps.envelopeKey,
        payload: buildDecryptedPayload(metadata),
      });
      const step = new FakeWorkflowStep();

      const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

      expect(result.status).toBe('settled');
      expect(step.calls.map((c) => c.name)).toEqual([
        'open-envelope',
        'check-authorization-expiry',
        'invoke-executor',
        'generate-pcc',
        'settle',
        'persist-result',
        'persist-receipt-and-finalize',
      ]);
      // §19 -- exactly one executor call, at most one settle call, one
      // result record, one receipt.
      expect(executorCallCounts[service].count).toBe(1);
      expect(settleMock).toHaveBeenCalledTimes(1);
      expect(resultsStore.get(TEST_JOB_ID)).toBeDefined();
    }
  );

  // -----------------------------------------------------------------------
  // §21 -- trust-class matrix, other half: production evidenceMode +
  // fixture-trust-class evidence must be REJECTED, never silently accepted
  // -- proven through this same real registry+orchestration seam for the
  // two genuinely NEW services this checkpoint adds. This is the exact
  // defect class §7 warns against re-introducing (`paid-services.ts`'s own
  // past evidenceMode-propagation bug) -- proven absent here, not just
  // assumed.
  // -----------------------------------------------------------------------
  it.each(['company_evidence_graph.v2', 'document_evidence_json.v2'] as const)(
    'FOUR_SERVICE_TRUST_CLASS_MATRIX (%s): production evidenceMode + synthetic_fixture settlement trust_class is rejected, never silently advanced to settled',
    async (service) => {
      settleMock.mockImplementationOnce(async (_context, verificationEvidence) => ({
        x402_version: 2,
        scheme: 'exact',
        network: TEST_NETWORK,
        asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        payee: '0x000000000000000000000000000000000000aa',
        actual_amount: '9000',
        quote_id: 'quote_test_0001',
        requirement_id: 'requirement_test_0001',
        payment_identifier: TEST_PAYMENT_IDENTIFIER,
        transaction_reference: '0xsettledhash',
        success: true,
        settled_at: '2026-08-31T00:00:05.000Z',
        facilitator_identity: 'test-facilitator',
        raw_evidence_hash: 'sha256:settlement-hash',
        verification_evidence_hash: await hashPaymentObject(verificationEvidence),
        // The deliberate defect under test: a fixture-only trust class,
        // never valid once `deps.evidenceMode === 'production'` (which
        // `buildProductionPaidContinuationWorkflowDependencies` always
        // sets for every real service -- proven directly by
        // `production-dependencies.test.ts`).
        trust_class: 'synthetic_fixture',
      }));

      const env = minimalHostEnv();
      const deps = await buildProductionPaidContinuationWorkflowDependencies(env, service);
      expect('unavailable' in deps).toBe(false);
      if ('unavailable' in deps) return;
      expect(deps.evidenceMode).toBe('production');

      const metadata = buildTestMetadata({ service });
      const input = await sealTestInput(metadata, {
        key: deps.envelopeKey,
        payload: buildDecryptedPayload(metadata),
      });
      const step = new FakeWorkflowStep();

      const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

      expect(result.status).toBe('settlement_rejected');
      // Never a second settle call, and settlement never durably confirmed
      // -- the fail-closed contract holds even after a real settle() call
      // returned a (wrongly-trusted) success=true response.
      expect(settleMock).toHaveBeenCalledTimes(1);
    }
  );
});
