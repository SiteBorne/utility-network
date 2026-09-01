/**
 * SUN-1221E6R-H2AWI-2 — shared test fixtures for the paid-continuation
 * Workflow test suite. Every fake here is an in-memory double; nothing
 * makes a real network call, opens a real D1 binding, or talks to a real
 * facilitator/chain RPC.
 */
import { vi } from 'vitest';
import type {
  PaymentSettlementContext,
  ExternalVerificationEvidence,
  ExternalSettlementEvidence,
  PaymentLifecycleStage,
} from '@siteborne/protocol-x402';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import type {
  ContinuationEnvelopeMetadata,
  WorkflowContinuationInput,
} from '../../src/control-plane/continuation/types';
import { sealContinuationEnvelope } from '../../src/control-plane/continuation/envelope';
import type {
  DecryptedContinuationPayload,
  PaidContinuationWorkflowDependencies,
  JobRecord,
  JobStatePersistence,
  PaymentAttemptSettlementRepository,
} from '../../src/control-plane/workflows/paid-continuation-workflow';
import type { ExecutorOutcome, ServiceExecutor } from '../../src/control-plane/routes/x402-service';
import type { StateEvent } from '../../src/control-plane/state-machine';

export const TEST_NETWORK = 'eip155:84532' as const;
export const TEST_PAYMENT_IDENTIFIER = 'pay_test_0001';
// `StateEventSchema.job_id` requires a UUID (state-machine reuse, real
// guard, not relaxed for tests) — a fixed, readable-looking UUID.
export const TEST_JOB_ID = '11111111-1111-4111-8111-111111111111';

export async function generateTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export function buildTestMetadata(
  overrides: Partial<ContinuationEnvelopeMetadata> = {}
): ContinuationEnvelopeMetadata {
  return {
    job_id: TEST_JOB_ID,
    payment_identifier: TEST_PAYMENT_IDENTIFIER,
    service: 'web_context_verified.v2',
    network: TEST_NETWORK,
    asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    pay_to: '0x000000000000000000000000000000000000aa',
    amount_atomic: '9000',
    valid_before_unix: 2_000_000_000,
    ...overrides,
  };
}

function buildVerificationEvidence(
  metadata: ContinuationEnvelopeMetadata
): ExternalVerificationEvidence {
  return {
    x402_version: 2,
    scheme: 'exact',
    network: metadata.network as ExternalVerificationEvidence['network'],
    quote_id: 'quote_test_0001',
    requirement_id: 'requirement_test_0001',
    payment_identifier: metadata.payment_identifier,
    verified: true,
    payer: '0x000000000000000000000000000000000000bb',
    verifier_identity: 'test-facilitator',
    evidence_timestamp: '2026-08-31T00:00:00.000Z',
    raw_evidence_hash: 'sha256:test-verification-hash',
    trust_class: 'synthetic_fixture',
  };
}

function buildSettlementContext(metadata: ContinuationEnvelopeMetadata): PaymentSettlementContext {
  return {
    service_id: 'web_context_verified.v2' as PaymentSettlementContext['service_id'],
    service_version: 'v2',
    scheme: 'exact',
    network: metadata.network as PaymentSettlementContext['network'],
    asset: metadata.asset,
    payee: metadata.pay_to,
    quote_id: 'quote_test_0001',
    requirement_id: 'requirement_test_0001',
    payment_identifier: metadata.payment_identifier,
    amount: metadata.amount_atomic,
    nowIso: '2026-08-31T00:00:00.000Z',
    expiresAt: '2026-08-31T00:10:00.000Z',
    authorizationContext: { rail: 'cdp' },
    paymentPayload: {
      x402Version: 2,
      scheme: 'exact',
      network: metadata.network,
      payload: {
        authorization: {
          from: '0x000000000000000000000000000000000000bb',
          to: metadata.pay_to,
          value: metadata.amount_atomic,
          validAfter: '0',
          validBefore: String(metadata.valid_before_unix),
          nonce: '0xnonce',
        },
        signature: '0xsignature',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture only, opaque to the Workflow
    } as any,
    paymentRequirements: {
      scheme: 'exact',
      network: metadata.network,
      maxAmountRequired: metadata.amount_atomic,
      resource: 'https://example.test/resource',
      payTo: metadata.pay_to,
      asset: metadata.asset,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture only, opaque to the Workflow
    } as any,
  };
}

export function buildDecryptedPayload(
  metadata: ContinuationEnvelopeMetadata,
  overrides: Partial<DecryptedContinuationPayload> = {}
): DecryptedContinuationPayload {
  return {
    executorInput: { url: 'https://example.test/context' },
    settlementContext: buildSettlementContext(metadata),
    verificationEvidence: buildVerificationEvidence(metadata),
    actualAmount: metadata.amount_atomic,
    ...overrides,
  };
}

export async function sealTestInput(
  metadata: ContinuationEnvelopeMetadata,
  opts: { key?: CryptoKey; payload?: DecryptedContinuationPayload; requestId?: string } = {}
): Promise<WorkflowContinuationInput> {
  const key = opts.key ?? (await generateTestKey());
  const payload = opts.payload ?? buildDecryptedPayload(metadata);
  const envelope = await sealContinuationEnvelope({
    payload,
    metadata,
    keyMaterial: key,
    keyId: 'test-key-v1',
  });
  return {
    envelope,
    metadata,
    request_id: opts.requestId ?? 'req_test_0001',
  };
}

// -----------------------------------------------------------------------
// Fake ServiceExecutor
// -----------------------------------------------------------------------

export function buildSuccessfulExecutorOutcome(
  overrides: Partial<ExecutorOutcome['result']> = {}
): ExecutorOutcome {
  return {
    result: {
      result_class: 'success',
      output: { text: 'ok' },
      output_hash: 'sha256:output-hash',
      receipt_id: 'receipt_test_0001',
      receipt: { id: 'receipt_test_0001' },
      verification: { pcc_id: 'pcc_test_0001', signature: '0xpccsignature' },
      ...overrides,
    },
  };
}

export function fakeExecutor(
  outcome: ExecutorOutcome | (() => Promise<ExecutorOutcome>)
): ServiceExecutor {
  return vi.fn(async () => (typeof outcome === 'function' ? outcome() : outcome));
}

// -----------------------------------------------------------------------
// Fake settlement repository — mirrors the REAL D1PaymentAttemptRepository
// CAS/UPDATE-WHERE semantics (never a bare in-memory boolean): each method
// only transitions when the row is currently in the expected `from` stage,
// matching payment-attempts.ts's own atomic-guard behavior exactly.
// -----------------------------------------------------------------------

export interface FakeSettlementRow {
  lifecycleStage: PaymentLifecycleStage;
  settlementTransactionReference: string | null;
  settlementOutcomeKind: 'explicit_rejection' | 'ambiguous' | null;
  cdpFacilitatorSettleAttemptCount: number;
  cdpSuccessfulEconomicSettlementCount: number;
}

export class FakeSettlementRepository implements PaymentAttemptSettlementRepository {
  readonly rows = new Map<string, FakeSettlementRow>();
  recordSettlementPendingCallCount = 0;
  recordSettledExternalCallCount = 0;
  recordCdpSettlementOutcomeCallCount = 0;

  seed(paymentIdentifier: string, row: Partial<FakeSettlementRow> = {}): void {
    this.rows.set(paymentIdentifier, {
      lifecycleStage: 'executed',
      settlementTransactionReference: null,
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 0,
      cdpSuccessfulEconomicSettlementCount: 0,
      ...row,
    });
  }

  private getOrCreate(paymentIdentifier: string): FakeSettlementRow {
    let row = this.rows.get(paymentIdentifier);
    if (!row) {
      row = {
        lifecycleStage: 'executed',
        settlementTransactionReference: null,
        settlementOutcomeKind: null,
        cdpFacilitatorSettleAttemptCount: 0,
        cdpSuccessfulEconomicSettlementCount: 0,
      };
      this.rows.set(paymentIdentifier, row);
    }
    return row;
  }

  async recordSettlementPending(
    paymentIdentifier: string
  ): ReturnType<PaymentAttemptSettlementRepository['recordSettlementPending']> {
    this.recordSettlementPendingCallCount += 1;
    const row = this.getOrCreate(paymentIdentifier);
    if (row.lifecycleStage !== 'executed') {
      return { status: 'illegal_transition' };
    }
    row.lifecycleStage = 'settlement_pending';
    row.cdpFacilitatorSettleAttemptCount += 1;
    return { status: 'transitioned' };
  }

  async getSettlementRecoveryRecord(
    paymentIdentifier: string
  ): ReturnType<PaymentAttemptSettlementRepository['getSettlementRecoveryRecord']> {
    const row = this.rows.get(paymentIdentifier);
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
  }

  async recordCdpSettlementOutcome(
    paymentIdentifier: string,
    from: 'verified' | 'settlement_pending' | 'settlement_failed',
    kind: 'explicit_rejection' | 'ambiguous',
    candidateTransactionReference?: string
  ): ReturnType<PaymentAttemptSettlementRepository['recordCdpSettlementOutcome']> {
    this.recordCdpSettlementOutcomeCallCount += 1;
    const row = this.getOrCreate(paymentIdentifier);
    if (row.lifecycleStage !== from) {
      return { status: 'illegal_transition' };
    }
    row.lifecycleStage = 'settlement_failed';
    row.settlementOutcomeKind = kind;
    if (candidateTransactionReference)
      row.settlementTransactionReference = candidateTransactionReference;
    row.cdpFacilitatorSettleAttemptCount += 1;
    return { status: 'transitioned' };
  }

  async recordSettledExternal(
    paymentIdentifier: string,
    settlementTransactionReference: string | undefined,
    fromStages: readonly ('settlement_pending' | 'settlement_failed')[] = ['settlement_pending']
  ): ReturnType<PaymentAttemptSettlementRepository['recordSettledExternal']> {
    this.recordSettledExternalCallCount += 1;
    const row = this.getOrCreate(paymentIdentifier);
    if (!fromStages.includes(row.lifecycleStage as 'settlement_pending' | 'settlement_failed')) {
      return { status: 'illegal_transition' };
    }
    row.lifecycleStage = 'settled_external';
    if (settlementTransactionReference)
      row.settlementTransactionReference = settlementTransactionReference;
    return { status: 'transitioned' };
  }

  async incrementCdpSuccessfulSettlementCount(paymentIdentifier: string): Promise<void> {
    const row = this.getOrCreate(paymentIdentifier);
    row.cdpSuccessfulEconomicSettlementCount += 1;
  }

  markConsumedCallCount = 0;
  consumedPaymentIdentifiers = new Set<string>();

  /** SUN-1221E6R-H2AWI-3 fix: mirrors the real
   * `D1PaymentAttemptRepository.markConsumed`'s idempotent
   * (`WHERE consumed_at IS NULL`) semantics closely enough for this
   * Workflow's own confirmed-settlement call sites. */
  async markConsumed(paymentIdentifier: string): Promise<void> {
    this.markConsumedCallCount += 1;
    this.consumedPaymentIdentifiers.add(paymentIdentifier);
  }

  transitionLifecycleStageCallCount = 0;

  /** SUN-1221E6R-H2AWI-3 fix: mirrors the real
   * `D1PaymentAttemptRepository.transitionLifecycleStage`'s CAS semantics
   * (UPDATE ... WHERE lifecycle_stage = from) closely enough for this
   * Workflow's own `verified -> executed` call site — every fixture in
   * this file already seeds `lifecycleStage: 'executed'` directly (never
   * `'verified'`), so this is a harmless, correctly-typed no-op
   * (`illegal_transition`) for every EXISTING test here, and becomes load
   * -bearing only for a test that deliberately seeds `'verified'`. */
  async transitionLifecycleStage(
    paymentIdentifier: string,
    from: PaymentLifecycleStage,
    to: PaymentLifecycleStage
  ): Promise<
    | { status: 'transitioned' }
    | { status: 'illegal_transition' }
    | { status: 'error'; reason: string }
  > {
    this.transitionLifecycleStageCallCount += 1;
    const row = this.getOrCreate(paymentIdentifier);
    if (row.lifecycleStage !== from) {
      return { status: 'illegal_transition' };
    }
    row.lifecycleStage = to;
    return { status: 'transitioned' };
  }
}

// -----------------------------------------------------------------------
// Fake settlement facilitator (evidenceProvider.settle)
// -----------------------------------------------------------------------

export function fakeSettleSuccess(
  transactionReference = '0xsettledhash',
  verificationEvidenceHash = 'sha256:test-verification-hash'
): ExternalSettlementEvidence {
  return {
    x402_version: 2,
    scheme: 'exact',
    network: TEST_NETWORK,
    asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    payee: '0x000000000000000000000000000000000000aa',
    actual_amount: '9000',
    quote_id: 'quote_test_0001',
    requirement_id: 'requirement_test_0001',
    payment_identifier: TEST_PAYMENT_IDENTIFIER,
    transaction_reference: transactionReference,
    success: true,
    settled_at: '2026-08-31T00:00:05.000Z',
    facilitator_identity: 'test-facilitator',
    raw_evidence_hash: 'sha256:settlement-hash',
    verification_evidence_hash: verificationEvidenceHash,
    trust_class: 'synthetic_fixture',
  };
}

export function fakeSettleRejected(reason = 'insufficient_funds'): ExternalSettlementEvidence {
  return {
    x402_version: 2,
    scheme: 'exact',
    network: TEST_NETWORK,
    asset: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    payee: '0x000000000000000000000000000000000000aa',
    actual_amount: '0',
    quote_id: 'quote_test_0001',
    requirement_id: 'requirement_test_0001',
    payment_identifier: TEST_PAYMENT_IDENTIFIER,
    success: false,
    reason,
    settled_at: '2026-08-31T00:00:05.000Z',
    facilitator_identity: 'test-facilitator',
    raw_evidence_hash: 'sha256:settlement-hash-rejected',
    verification_evidence_hash: 'sha256:test-verification-hash',
    trust_class: 'synthetic_fixture',
  };
}

// -----------------------------------------------------------------------
// Fake job/result/receipt persistence
// -----------------------------------------------------------------------

export class FakeJobStatePersistence implements JobStatePersistence {
  readonly jobs = new Map<string, JobRecord>();
  readonly events: StateEvent[] = [];
  /** Set to a target `to_state` (e.g. 'DELIVERED') to fail only the next
   * appendStateEvent call transitioning TO that specific state — lets a
   * test simulate the terminal-state write failing specifically, without
   * also breaking earlier, unrelated state transitions (ROUTED/EXECUTING/
   * VERIFYING/SETTLING) the same orchestration run performs first. */
  failAppendStateEventForToState: JobRecord['current_state'] | null = null;

  seed(job: JobRecord): void {
    this.jobs.set(job.id, job);
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async appendStateEvent(event: StateEvent): Promise<void> {
    if (
      this.failAppendStateEventForToState &&
      event.to_state === this.failAppendStateEventForToState
    ) {
      this.failAppendStateEventForToState = null;
      throw new Error('simulated terminal-state-event persistence failure');
    }
    this.events.push(event);
  }

  async setCurrentState(jobId: string, state: JobRecord['current_state']): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) this.jobs.set(jobId, { ...job, current_state: state });
  }
}

export class FakeResultReceiptPersistence {
  readonly results = new Map<string, { jobId: string; paymentIdentifier: string }>();
  readonly receipts = new Map<string, string>();
  persistResultCallCount = 0;
  persistReceiptCallCount = 0;
  failResultOnce = false;
  failReceiptOnce = false;

  async persistResult(input: {
    jobId: string;
    paymentIdentifier: string;
  }): Promise<{ status: 'written' | 'already_written' }> {
    this.persistResultCallCount += 1;
    if (this.failResultOnce) {
      this.failResultOnce = false;
      throw new Error('simulated result persistence failure');
    }
    if (this.results.has(input.jobId)) return { status: 'already_written' };
    this.results.set(input.jobId, input);
    return { status: 'written' };
  }

  async persistReceipt(input: {
    jobId: string;
    paymentIdentifier: string;
  }): Promise<{ status: 'written' | 'already_written'; receiptId: string }> {
    this.persistReceiptCallCount += 1;
    if (this.failReceiptOnce) {
      this.failReceiptOnce = false;
      throw new Error('simulated receipt persistence failure');
    }
    const existing = this.receipts.get(input.jobId);
    if (existing) return { status: 'already_written', receiptId: existing };
    const receiptId = `receipt_${input.jobId}`;
    this.receipts.set(input.jobId, receiptId);
    return { status: 'written', receiptId };
  }
}

// -----------------------------------------------------------------------
// Full dependency bundle
// -----------------------------------------------------------------------

export interface TestDependencyBundle extends PaidContinuationWorkflowDependencies {
  readonly settlementRepository: FakeSettlementRepository;
  readonly resultReceiptPersistence: FakeResultReceiptPersistence;
  readonly jobPersistence: FakeJobStatePersistence;
  readonly settle: ReturnType<typeof vi.fn>;
  readonly reconciliationChecker: ReturnType<typeof vi.fn>;
}

export async function buildTestDependencies(
  overrides: Partial<{
    executor: ServiceExecutor;
    validatePcc: PaidContinuationWorkflowDependencies['validatePcc'];
    settleResponse: ExternalSettlementEvidence | (() => Promise<ExternalSettlementEvidence>);
    clock: () => number;
    seedSettlement: Partial<FakeSettlementRow>;
    seedJob: Partial<JobRecord>;
    envelopeKey: CryptoKey;
  }> = {}
): Promise<TestDependencyBundle> {
  const settlementRepository = new FakeSettlementRepository();
  settlementRepository.seed(TEST_PAYMENT_IDENTIFIER, {
    lifecycleStage: 'executed',
    ...overrides.seedSettlement,
  });

  const resultReceiptPersistence = new FakeResultReceiptPersistence();
  const jobPersistence = new FakeJobStatePersistence();
  jobPersistence.seed({
    id: TEST_JOB_ID,
    current_state: 'LOCKED',
    attempt_number: 1,
    ...overrides.seedJob,
  });

  const settle = vi.fn(
    async (
      _context: PaymentSettlementContext,
      verificationEvidence: ExternalVerificationEvidence
    ) => {
      const response = overrides.settleResponse ?? fakeSettleSuccess();
      if (typeof response === 'function') return response();
      if (overrides.settleResponse !== undefined) return response;
      return fakeSettleSuccess('0xsettledhash', await hashPaymentObject(verificationEvidence));
    }
  );

  const reconciliationChecker = vi.fn(async () => 'STILL_UNKNOWN' as const);
  const envelopeKey = overrides.envelopeKey ?? (await generateTestKey());

  return {
    envelopeKey,
    clock: overrides.clock ?? (() => 0),
    evidenceMode: 'fixture',
    executor: overrides.executor ?? fakeExecutor(buildSuccessfulExecutorOutcome()),
    validatePcc:
      overrides.validatePcc ??
      ((outcome) =>
        outcome.result.verification !== undefined
          ? { valid: true, pcc: outcome.result.verification }
          : { valid: false, reason: 'missing_pcc' }),
    settlement: {
      repository: settlementRepository,
      evidenceProvider: { settle },
    },
    reconciliation: {
      checker: reconciliationChecker,
      network: TEST_NETWORK,
      maxAttempts: 5,
      delayMs: 0,
    },
    persistence: {
      job: jobPersistence,
      resultReceipt: resultReceiptPersistence,
    },
    settlementRepository,
    resultReceiptPersistence,
    jobPersistence,
    settle,
    reconciliationChecker,
  };
}
