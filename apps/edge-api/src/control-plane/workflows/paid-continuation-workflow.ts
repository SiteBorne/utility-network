/**
 * SUN-1221E6R-H2AWI-2 — durable paid-continuation Workflow orchestration.
 *
 * Local source + tests only. No Workflow resource, no route wiring (that
 * is H2AWI-3's job), no deployment. See
 * docs/superpowers/plans/2026-08-31-siteborne-durable-paid-continuation-workflow.md
 * (H2AWI-2, Tasks 2.1-2.8) and
 * docs/reports/SUN-1221E6R-H2AW-durable-paid-continuation-workflow-design.md
 * (§11-16) for the frozen step graph and retry-policy table this file
 * implements exactly.
 *
 * Architecture: `runPaidContinuationWorkflow` is the pure, fully
 * dependency-injected orchestration function every test in this checkpoint
 * exercises directly with fake `WorkflowStep`/`WorkflowEvent` doubles and
 * fake ports (executor, PCC validator, settlement facilitator, settlement
 * repository, reconciliation, job/result/receipt persistence, clock) — no
 * real network call, no real D1, no live Workflow resource anywhere in
 * this checkpoint's tests. `PaidContinuationWorkflow` is the thin real
 * `WorkflowEntrypoint` subclass the Cloudflare platform will eventually
 * dispatch into (wired to `wrangler.toml` only in H2AWI-4) — it exists in
 * source now so H2AWI-4 has a stable target, but is unreferenced by any
 * production route or config this checkpoint (bundle-isolation-proven,
 * see `paid-continuation-workflow.test.ts`).
 *
 * Every dependency this module needs is either a frozen H2AWI-1 primitive
 * (`openContinuationEnvelope`) reused unmodified, a real, already-audited
 * production type reused via structural typing / `Pick<>` (never forked):
 * `ServiceExecutor`/`ExecutorOutcome` (`../routes/x402-service.ts`,
 * type-only import — this file never imports that module's runtime code),
 * `PaymentEvidenceProvider['settle']` (`@siteborne/protocol-x402`),
 * `D1PaymentAttemptRepository`'s settlement-recovery methods
 * (`../repositories/d1/payment-attempts.ts`, `Pick<>`'d, not
 * reimplemented), and the state-machine's own `createStateEvent`/
 * `isTerminal` (`../state-machine`, called for real — these are pure,
 * side-effect-free functions, not I/O, so there is nothing to fake).
 */
// Value import (needed for `extends`) — resolved by the real
// `cloudflare:workers` platform module in production bundling
// (wrangler/esbuild), and by the vitest-only structural shim
// (`apps/edge-api/tests/support/cloudflare-workers-shim.ts`, aliased in
// the root `vitest.config.ts`) under the default Node test pool, mirroring
// the already-accepted `cloudflare:sockets` shim precedent (SUN-1221C).
import { WorkflowEntrypoint } from 'cloudflare:workers';
import type {
  Network,
  PaymentEvidenceProvider,
  PaymentSettlementContext,
  ExternalVerificationEvidence,
  ExternalSettlementEvidence,
  PaymentLifecycleStage,
} from '@siteborne/protocol-x402';
import type {
  ContinuationEnvelopeMetadata,
  WorkflowContinuationInput,
  WorkflowContinuationResult,
  WorkflowTerminalStatus,
  SettlementReconciliationResult,
} from '../continuation/types';
import { openContinuationEnvelope, EnvelopeOpenError } from '../continuation/envelope';
import { reconcileAmbiguousSettlement } from '../continuation/settlement-reconciliation';
import { createStateEvent, isTerminal, getAllowedTransitions } from '../state-machine';
import type { JobState, TransitionReason, StateEvent } from '../state-machine';
import type { ServiceExecutor, ExecutorOutcome } from '../routes/x402-service';
import type { D1PaymentAttemptRepository } from '../repositories/d1/payment-attempts';
import type { Env } from '../config/env';

// ---------------------------------------------------------------------
// Structural WorkflowStep/WorkflowEvent typing
// ---------------------------------------------------------------------

/** Only the one method this orchestration ever calls on a real
 * `WorkflowStep` (`Pick<>`'d from the ambient `cloudflare:workers` type,
 * never forked) — deliberately narrow so a test double only has to
 * implement `.do()`, not `.sleep()`/`.sleepUntil()`/`.waitForEvent()`
 * this checkpoint never uses. */
export type PaidContinuationWorkflowStep = {
  do<T>(
    name: string,
    config: {
      readonly retries?: { readonly limit: number; readonly delay?: unknown; readonly backoff?: string };
      readonly timeout?: unknown;
    },
    callback: () => Promise<T>
  ): Promise<T>;
};

export type PaidContinuationWorkflowEvent = {
  readonly payload: Readonly<WorkflowContinuationInput>;
};

// ---------------------------------------------------------------------
// Dependency ports — every one either a real reused type/`Pick<>` or a
// narrow, H2AWI-2-owned interface a fake test double implements.
// ---------------------------------------------------------------------

/** The decrypted continuation payload this Workflow's step 0 expects to
 * find inside the AEAD envelope (H2AWI-1's `SealInput.payload: unknown`
 * intentionally left this shape to its consumer — this is that
 * consumer's contract, owned by H2AWI-2, documented here rather than
 * forked into `continuation/types.ts`, which stays frozen). The caller
 * that seals the envelope (H2AWI-3's future HTTP handoff) is responsible
 * for assembling exactly this shape — never reconstructed or re-derived
 * inside the Workflow, which only ever sees it post-decrypt. */
export interface DecryptedContinuationPayload {
  /** Forwarded verbatim to `ServiceExecutor` as its `input` argument. */
  readonly executorInput: unknown;
  /** The exact `PaymentSettlementContext` `evidenceProvider.settle()`
   * needs — assembled once, at seal time, by the same logic
   * `x402-service.ts` already uses for its own (soon-to-be-removed,
   * H2AWI-3) direct settle call; this Workflow never rebuilds it. */
  readonly settlementContext: PaymentSettlementContext;
  /** The facilitator's own already-accepted VERIFY response —
   * `evidenceProvider.settle()`'s second argument, and the correlation
   * data `recordSettlementPending` durably persists before the real
   * settle call (mirrors `x402-service.ts`'s `CdpSettlementPendingDraft`
   * exactly). */
  readonly verificationEvidence: ExternalVerificationEvidence;
  readonly actualAmount: string;
}

/** The narrow slice of `D1PaymentAttemptRepository` step 4 needs, reused
 * via `Pick<>` on the REAL concrete class — any signature drift there
 * breaks this file's typecheck immediately. This is the "existing D1/
 * application at-most-one invariant", never an in-memory boolean: a fake
 * test double must implement the exact same CAS/UPDATE-WHERE semantics
 * the real repository does (see the test-support fake), not merely a flag. */
export type PaymentAttemptSettlementRepository = Pick<
  D1PaymentAttemptRepository,
  | 'recordSettlementPending'
  | 'getSettlementRecoveryRecord'
  | 'recordCdpSettlementOutcome'
  | 'recordSettledExternal'
  | 'incrementCdpSuccessfulSettlementCount'
  // SUN-1221E6R-H2AWI-3 fix: needed to durably advance
  // `verified` -> `executed` after executor success, the exact
  // precondition `recordSettlementPending`'s own CAS already requires
  // (see the call site below) -- see that call site's own doc comment
  // for the full incident this closes.
  | 'transitionLifecycleStage'
  // SUN-1221E6R-H2AWI-3 fix: needed so a Workflow-settled payment's
  // `payment_attempts.consumed_at` is actually set (see the call sites'
  // own doc comment for the full incident this closes).
  | 'markConsumed'
>;

/** `PaymentEvidenceProvider['settle']` reused exactly, via `Pick<>` —
 * the real `CdpPaymentEvidenceProvider` (`../evidence/cdp-provider.ts`)
 * satisfies this without modification. */
export type SettlementFacilitator = Pick<PaymentEvidenceProvider, 'settle'>;

export type PccValidationResult =
  | { readonly valid: true; readonly pcc: unknown }
  | { readonly valid: false; readonly reason: string };

export type PccValidator = (outcome: ExecutorOutcome) => PccValidationResult | Promise<PccValidationResult>;

/** The read-only on-chain checker's exact type from
 * `../evidence/chain-receipt-checker.ts`'s `buildCdpChainReceiptChecker`
 * return shape — reused, not forked. */
export type ChainReceiptChecker = (
  transactionReference: string,
  network: Network
) => Promise<'SETTLED' | 'FAILED' | 'STILL_UNKNOWN'>;

export interface JobRecord {
  readonly id: string;
  readonly current_state: JobState;
  readonly attempt_number: number;
}

/** Minimal job-state persistence port. A real caller (H2AWI-3/4) wires
 * this to `D1JobsRepository`/`D1StateEventsRepository`; every test in
 * this checkpoint uses an in-memory fake. */
export interface JobStatePersistence {
  getJob(jobId: string): Promise<JobRecord | null>;
  appendStateEvent(event: StateEvent): Promise<void>;
  setCurrentState(jobId: string, state: JobState): Promise<void>;
}

export interface PersistResultInput {
  readonly jobId: string;
  readonly paymentIdentifier: string;
  readonly settlementTransactionReference?: string;
}

export interface PersistReceiptInput {
  readonly jobId: string;
  readonly paymentIdentifier: string;
}

/** Idempotent (UPSERT-shaped) result/receipt persistence port — `status:
 * 'already_written'` is how a fake proves repeated persistence never
 * creates a second logical record (proof requirement §12). */
export interface ResultReceiptPersistence {
  persistResult(input: PersistResultInput): Promise<{ status: 'written' | 'already_written' }>;
  persistReceipt(
    input: PersistReceiptInput
  ): Promise<{ status: 'written' | 'already_written'; receiptId: string }>;
}

export interface PaidContinuationWorkflowDependencies {
  /** Imported once by the caller (never read from `env` inside
   * `openContinuationEnvelope` itself — H2AWI-1's own boundary). */
  readonly envelopeKey: CryptoKey;
  /** Unix seconds. Injected so authorization-expiry boundary tests never
   * depend on real wall time. */
  readonly clock: () => number;
  readonly executor: ServiceExecutor;
  readonly validatePcc: PccValidator;
  readonly settlement: {
    readonly repository: PaymentAttemptSettlementRepository;
    readonly evidenceProvider: SettlementFacilitator;
  };
  readonly reconciliation: {
    readonly checker: ChainReceiptChecker;
    readonly network: Network;
    readonly maxAttempts?: number;
    readonly delayMs?: number;
  };
  readonly persistence: {
    readonly job: JobStatePersistence;
    readonly resultReceipt: ResultReceiptPersistence;
  };
}

// ---------------------------------------------------------------------
// Step configuration — the frozen retry-policy table (plan Task 2.1 /
// design §12). Every step declares BOTH `retries` and `timeout`
// explicitly; none inherits a platform default.
// ---------------------------------------------------------------------

const STEP_CONFIG = {
  OPEN_ENVELOPE: { retries: { limit: 0, delay: '1 second' }, timeout: '10 seconds' },
  CHECK_AUTHORIZATION_EXPIRY: { retries: { limit: 0, delay: '1 second' }, timeout: '5 seconds' },
  INVOKE_EXECUTOR: {
    retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
    timeout: '40 seconds',
  },
  GENERATE_PCC: { retries: { limit: 1, delay: '2 seconds' }, timeout: '10 seconds' },
  // FROZEN INVARIANT: zero blind retries on settlement. See
  // `paid-continuation-workflow.test.ts`'s dedicated mutation-sensitive
  // test — mutating this to `{ limit: 1, ... }` must fail that test.
  SETTLE: { retries: { limit: 0, delay: '1 second' }, timeout: '20 seconds' },
  PERSIST_RESULT: {
    retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
    timeout: '10 seconds',
  },
  PERSIST_RECEIPT_AND_FINALIZE: {
    retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
    timeout: '10 seconds',
  },
} as const;

// ---------------------------------------------------------------------
// Terminal-result helper
// ---------------------------------------------------------------------

function terminal(
  status: WorkflowTerminalStatus,
  jobId: string,
  extra?: Partial<Pick<WorkflowContinuationResult, 'receipt_id' | 'settlement_transaction_reference' | 'error_code'>>
): WorkflowContinuationResult {
  return { status, job_id: jobId, ...extra };
}

function errorCode(e: unknown): string {
  if (e instanceof EnvelopeOpenError) return e.code;
  if (e instanceof Error) return e.name || 'error';
  return 'unknown_error';
}

// ---------------------------------------------------------------------
// Job state-machine helpers — real `createStateEvent`/`isTerminal`,
// never faked (pure functions, no I/O).
// ---------------------------------------------------------------------

async function transitionJobState(
  jobId: string,
  toState: JobState,
  reason: TransitionReason,
  persistence: JobStatePersistence
): Promise<void> {
  const job = await persistence.getJob(jobId);
  if (!job) return; // no job record wired yet (e.g. a unit test not exercising job-state assertions) — never throws for an absent optional record
  if (job.current_state === toState) return; // idempotent no-op — already there
  if (isTerminal(job.current_state)) return; // never attempt to leave a terminal state; safe re-entry
  if (!getAllowedTransitions(job.current_state).includes(toState)) {
    // A restart re-running this (unwrapped-by-step.do, so re-attempted on
    // every orchestration invocation) transition helper after a LATER
    // step already advanced the job further in a prior attempt — e.g.
    // steps 0-4 were memoized by the platform and this call is only
    // reached again because a later step (5/6) is being retried. The job
    // is already correctly positioned further along; nothing to do.
    return;
  }
  const event = createStateEvent(jobId, job.attempt_number, job.current_state, toState, reason, 'SYSTEM');
  await persistence.appendStateEvent(event);
  await persistence.setCurrentState(jobId, toState);
}

/** Step 6's terminal finalize — deliberately calls `createStateEvent` for
 * real (not silently guarded away) so `TerminalStateError` is the actual,
 * respected enforcement mechanism, per plan Task 2.7's dedicated proof
 * requirement. `isTerminal()` is consulted FIRST specifically so a
 * legitimate idempotent re-entry (this step running twice) never reaches
 * `createStateEvent` with an already-terminal `fromState` — removing that
 * `isTerminal()` guard is exactly the mutation
 * `paid-continuation-workflow.test.ts` proves is caught. */
async function finalizeTerminalState(jobId: string, persistence: JobStatePersistence): Promise<void> {
  const job = await persistence.getJob(jobId);
  if (!job) return;
  if (isTerminal(job.current_state)) return;
  const event = createStateEvent(
    jobId,
    job.attempt_number,
    job.current_state,
    'DELIVERED',
    'SETTLEMENT_COMPLETE',
    'SYSTEM'
  );
  await persistence.appendStateEvent(event);
  await persistence.setCurrentState(jobId, 'DELIVERED');
}

// ---------------------------------------------------------------------
// Settlement step internals (Task 2.4 / 2.5)
// ---------------------------------------------------------------------

type SettleStepOutcome =
  | { readonly kind: 'confirmed'; readonly transactionReference?: string }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'ambiguous_unresolved' };

const UNRESOLVED_LIFECYCLE_STAGES: readonly PaymentLifecycleStage[] = ['settlement_pending'];

async function resolveViaReconciliation(
  paymentIdentifier: string,
  deps: PaidContinuationWorkflowDependencies
): Promise<SettleStepOutcome> {
  const reconciliation: SettlementReconciliationResult = await reconcileAmbiguousSettlement(
    paymentIdentifier,
    {
      repository: deps.settlement.repository,
      checker: deps.reconciliation.checker,
      network: deps.reconciliation.network,
      clock: deps.clock,
      maxAttempts: deps.reconciliation.maxAttempts,
      delayMs: deps.reconciliation.delayMs,
    }
  );

  if (reconciliation.outcome === 'confirmed') {
    await deps.settlement.repository.recordSettledExternal(
      paymentIdentifier,
      reconciliation.settlement_transaction_reference
    );
    await deps.settlement.repository.incrementCdpSuccessfulSettlementCount(paymentIdentifier);
    // SUN-1221E6R-H2AWI-3 fix (same real-D1 integration-testing discovery
    // as the verified->executed transition above): the old in-request
    // pipeline always called `markConsumed` once settlement was
    // confirmed -- this Workflow had no equivalent call anywhere,
    // leaving `payment_attempts.consumed_at` permanently NULL for every
    // Workflow-settled payment. `markConsumed` is itself idempotent
    // (`WHERE consumed_at IS NULL`), so calling it here in both the
    // direct-success and reconciliation-confirmed paths is safe under
    // resume/retry.
    await deps.settlement.repository.markConsumed(paymentIdentifier);
    return { kind: 'confirmed', transactionReference: reconciliation.settlement_transaction_reference };
  }
  if (reconciliation.outcome === 'not_found') {
    await deps.settlement.repository.recordCdpSettlementOutcome(
      paymentIdentifier,
      'settlement_pending',
      'explicit_rejection',
      undefined
    );
    return { kind: 'rejected', reason: 'reconciliation_not_found' };
  }
  return { kind: 'ambiguous_unresolved' };
}

/**
 * The SOLE production `evidenceProvider.settle()` call site introduced by
 * this Workflow (proof requirement #2 — see the dedicated static
 * source-scan test in `paid-continuation-workflow.test.ts`). Called from
 * exactly one place inside step 4's `step.do('settle', ...)` callback.
 *
 * Idempotency guard (proof requirement #3): BEFORE ever calling
 * `evidenceProvider.settle()`, this checks the EXISTING D1 settlement
 * record. If a prior attempt already durably claimed this
 * `payment_identifier` (`lifecycle_stage === 'settlement_pending'` — the
 * exact same `payment_attempts` CAS invariant `x402-service.ts` already
 * relies on), settlement is resolved EXCLUSIVELY via read-only
 * reconciliation — `evidenceProvider.settle()` is never reached a second
 * time, satisfying both the crash-after-transmission requirement (a
 * "restart" is simply a second call to this same function with the same
 * durable repository state) and the transport-ambiguity requirement (a
 * thrown/rejected `settle()` call is caught and routed to reconciliation,
 * never retried).
 */
async function runSettlementStep(
  paymentIdentifier: string,
  decrypted: DecryptedContinuationPayload,
  deps: PaidContinuationWorkflowDependencies
): Promise<SettleStepOutcome> {
  const repo = deps.settlement.repository;
  const existing = await repo.getSettlementRecoveryRecord(paymentIdentifier);

  if (existing && UNRESOLVED_LIFECYCLE_STAGES.includes(existing.lifecycleStage)) {
    // A previous attempt already durably claimed this settlement and
    // either crashed before or after calling the real facilitator. NEVER
    // call settle() again — resolve exclusively via reconciliation.
    return resolveViaReconciliation(paymentIdentifier, deps);
  }
  if (existing && existing.lifecycleStage === 'settled_external') {
    // Already resolved by a prior attempt. Defensive re-entry only — the
    // platform's own step memoization should make this unreachable in
    // practice (step 4 itself would already be memoized once it returns
    // 'confirmed'), but never re-calls settle() even here.
    return { kind: 'confirmed', transactionReference: existing.settlementTransactionReference ?? undefined };
  }
  if (existing && existing.lifecycleStage === 'settlement_failed') {
    return { kind: 'rejected', reason: existing.settlementOutcomeKind ?? 'settlement_rejected' };
  }

  const pending = await repo.recordSettlementPending(paymentIdentifier, {
    serviceOutputHash: decrypted.verificationEvidence.raw_evidence_hash,
  });
  if (pending.status !== 'transitioned') {
    // Could not durably claim the pre-settle draft — fail closed, never
    // call settle() without this write having committed first (mirrors
    // x402-service.ts's own identical rule at its settle call site).
    return { kind: 'ambiguous_unresolved' };
  }

  let settlementEvidence: ExternalSettlementEvidence;
  try {
    settlementEvidence = await deps.settlement.evidenceProvider.settle(
      decrypted.settlementContext,
      decrypted.verificationEvidence,
      decrypted.actualAmount
    );
  } catch {
    // Transport ambiguity: the settle() call itself failed with no
    // definitive response. NEVER retried at this layer (retries.limit is
    // 0) — resolved only via read-only reconciliation.
    return resolveViaReconciliation(paymentIdentifier, deps);
  }

  if (settlementEvidence.success) {
    await repo.recordSettledExternal(paymentIdentifier, settlementEvidence.transaction_reference);
    await repo.incrementCdpSuccessfulSettlementCount(paymentIdentifier);
    // SUN-1221E6R-H2AWI-3 fix: see the reconciliation-confirmed branch's
    // identical call for the full incident this closes -- this is the
    // OTHER (direct-success, non-reconciliation) confirmed-settlement
    // path, which needs the exact same call.
    await repo.markConsumed(paymentIdentifier);
    return { kind: 'confirmed', transactionReference: settlementEvidence.transaction_reference };
  }

  await repo.recordCdpSettlementOutcome(
    paymentIdentifier,
    'settlement_pending',
    'explicit_rejection',
    settlementEvidence.transaction_reference
  );
  return { kind: 'rejected', reason: settlementEvidence.reason ?? 'settlement_rejected' };
}

// ---------------------------------------------------------------------
// The orchestration function — every test in this checkpoint calls this
// directly.
// ---------------------------------------------------------------------

export async function runPaidContinuationWorkflow(
  event: PaidContinuationWorkflowEvent,
  step: PaidContinuationWorkflowStep,
  deps: PaidContinuationWorkflowDependencies
): Promise<WorkflowContinuationResult> {
  const input = event.payload;
  const metadata: ContinuationEnvelopeMetadata = input.metadata;
  const paymentIdentifier = metadata.payment_identifier;
  const jobId = metadata.job_id;

  // STEP 0 — open-envelope. Pure, given the key; a decrypt failure is
  // never transient (retries: 0). The decrypted payload lives only in
  // this function's closure for the remainder of the run — never logged,
  // never persisted, never part of the returned `WorkflowContinuationResult`.
  let decrypted: DecryptedContinuationPayload;
  try {
    decrypted = (await step.do('open-envelope', STEP_CONFIG.OPEN_ENVELOPE, async () => {
      return (await openContinuationEnvelope({
        envelope: input.envelope,
        expectedMetadata: metadata,
        keyMaterial: deps.envelopeKey,
      })) as DecryptedContinuationPayload;
    })) as DecryptedContinuationPayload;
  } catch (e) {
    return terminal('workflow_internal_error', jobId, { error_code: errorCode(e) });
  }

  // STEP 1 — check-authorization-expiry. `validBefore === now` is treated
  // as EXPIRED (fail-closed), never valid.
  const expiryCheck = await step.do(
    'check-authorization-expiry',
    STEP_CONFIG.CHECK_AUTHORIZATION_EXPIRY,
    async () => ({ expired: deps.clock() >= metadata.valid_before_unix })
  );
  if (expiryCheck.expired) {
    await transitionJobState(jobId, 'REJECTED', 'PAYMENT_FAILED', deps.persistence.job);
    return terminal('authorization_expired', jobId);
  }

  // Job-state advancement mirrors x402-service.ts's own existing chain
  // (LOCKED -> ROUTED -> EXECUTING -> VERIFYING -> SETTLING -> DELIVERED),
  // reusing the real state-machine guard/transition functions — never a
  // second, competing state machine (plan's global-constraints rule).
  await transitionJobState(jobId, 'ROUTED', 'ROUTED_TO_WORKER', deps.persistence.job);
  await transitionJobState(jobId, 'EXECUTING', 'EXECUTION_STARTED', deps.persistence.job);

  // STEP 2 — invoke-executor. A THROWN error (transport/timeout) maps to
  // `executor_timeout`; a resolved-but-unsuccessful outcome maps to
  // `executor_rejected` — two structurally distinct, independently
  // testable branches (plan Task 2.2's own mutation-proof requirement).
  let executorOutcome: ExecutorOutcome;
  try {
    executorOutcome = await step.do('invoke-executor', STEP_CONFIG.INVOKE_EXECUTOR, async () => {
      return deps.executor(decrypted.executorInput, { job_id: jobId, request_id: input.request_id });
    });
  } catch (e) {
    await transitionJobState(jobId, 'QUARANTINED', 'EXECUTION_FAILED', deps.persistence.job);
    await transitionJobState(jobId, 'REJECTED', 'QUARANTINE_POLICY', deps.persistence.job);
    return terminal('executor_timeout', jobId, { error_code: errorCode(e) });
  }
  if (executorOutcome.result.result_class !== 'success') {
    await transitionJobState(jobId, 'QUARANTINED', 'EXECUTION_FAILED', deps.persistence.job);
    await transitionJobState(jobId, 'REJECTED', 'QUARANTINE_POLICY', deps.persistence.job);
    return terminal('executor_rejected', jobId, {
      error_code: executorOutcome.result.failure?.code ?? executorOutcome.result.result_class,
    });
  }
  await transitionJobState(jobId, 'VERIFYING', 'EXECUTION_COMPLETED', deps.persistence.job);
  // SUN-1221E6R-H2AWI-3 fix (discovered via real-D1 integration testing,
  // not caught by H2AWI-2's own fake-repository unit tests): the REUSED
  // `D1PaymentAttemptRepository.recordSettlementPending` (called a few
  // lines below, inside `runSettlementStep`) has an existing, unchanged
  // `WHERE lifecycle_stage = 'executed'` CAS precondition -- the exact
  // same one `x402-service.ts`'s own removed in-request pipeline always
  // satisfied via its own `transitionLifecycleStage(paymentIdentifier,
  // 'verified', 'executed')` call immediately after executor success.
  // That call has no equivalent anywhere in this Workflow's original
  // step graph; without it, `recordSettlementPending` always failed its
  // CAS (the row was still at `verified`), and every real settlement
  // silently routed to `ambiguous_unresolved` before `.settle()` was
  // ever called. Reused unchanged, in the same place the old pipeline
  // called it. Best-effort/non-blocking: an `illegal_transition` here
  // (the row already advanced past `verified` on some prior/resumed
  // attempt) is not itself fatal -- `recordSettlementPending`'s own CAS
  // immediately below remains the authoritative, fail-closed gate.
  await deps.settlement.repository.transitionLifecycleStage(
    paymentIdentifier,
    'verified',
    'executed'
  );

  // STEP 3 — generate-pcc (validates the PCC the executor already
  // produced as part of its own signing call — see this file's module
  // doc comment; never a second, reinvented PCC-signing operation).
  const pccResult = await step.do('generate-pcc', STEP_CONFIG.GENERATE_PCC, async () =>
    deps.validatePcc(executorOutcome)
  );
  if (!pccResult.valid) {
    await transitionJobState(jobId, 'REJECTED', 'VERIFICATION_FAILED', deps.persistence.job);
    return terminal('pcc_failed', jobId, { error_code: pccResult.reason });
  }
  await transitionJobState(jobId, 'SETTLING', 'VERIFICATION_PASSED', deps.persistence.job);

  // STEP 4 — settle. Zero blind retries (frozen invariant, STEP_CONFIG.SETTLE).
  const settleOutcome = await step.do('settle', STEP_CONFIG.SETTLE, async () =>
    runSettlementStep(paymentIdentifier, decrypted, deps)
  );

  if (settleOutcome.kind === 'ambiguous_unresolved') {
    // Design §13: the job legitimately stays non-terminal, pending
    // ops/human reconciliation — never forced into a REJECTED-family
    // state merely because settlement is inconclusive.
    return terminal('settlement_ambiguous', jobId);
  }
  if (settleOutcome.kind === 'rejected') {
    await transitionJobState(jobId, 'REFUND_REQUIRED', 'PAYMENT_FAILED', deps.persistence.job);
    return terminal('settlement_rejected', jobId, { error_code: settleOutcome.reason });
  }

  // STEP 5 — persist-result. Settlement is already confirmed at this
  // point; safe to retry (idempotent UPSERT keyed by payment_identifier).
  let resultStatus: { status: 'written' | 'already_written' };
  try {
    resultStatus = await step.do('persist-result', STEP_CONFIG.PERSIST_RESULT, async () =>
      deps.persistence.resultReceipt.persistResult({
        jobId,
        paymentIdentifier,
        settlementTransactionReference: settleOutcome.transactionReference,
      })
    );
  } catch (e) {
    return terminal('persistence_failed_after_settlement', jobId, {
      error_code: errorCode(e),
      settlement_transaction_reference: settleOutcome.transactionReference,
    });
  }
  void resultStatus;

  // STEP 6 — persist-receipt-and-finalize. Receipt write + terminal
  // state-machine transition, both idempotent UPSERT-shaped.
  let receiptResult: { status: 'written' | 'already_written'; receiptId: string };
  try {
    receiptResult = await step.do(
      'persist-receipt-and-finalize',
      STEP_CONFIG.PERSIST_RECEIPT_AND_FINALIZE,
      async () => {
        const receipt = await deps.persistence.resultReceipt.persistReceipt({ jobId, paymentIdentifier });
        await finalizeTerminalState(jobId, deps.persistence.job);
        return receipt;
      }
    );
  } catch (e) {
    return terminal('persistence_failed_after_settlement', jobId, {
      error_code: errorCode(e),
      settlement_transaction_reference: settleOutcome.transactionReference,
    });
  }

  return terminal('settled', jobId, {
    receipt_id: receiptResult.receiptId,
    settlement_transaction_reference: settleOutcome.transactionReference,
  });
}

// ---------------------------------------------------------------------
// The real Cloudflare Workflow entrypoint. Unreferenced by any
// production route or `wrangler.toml` binding this checkpoint (wired only
// in H2AWI-4) — exists so H2AWI-3/4 have a stable class to import and
// bind. Dependency wiring is intentionally left unimplemented (a throwing
// stub) here: wiring real `env` bindings into
// `PaidContinuationWorkflowDependencies` (secret lookup, D1 repository
// construction, the real `CdpPaymentEvidenceProvider`, the real
// chain-receipt checker) is H2AWI-3/4 scope, not this checkpoint's.
// ---------------------------------------------------------------------
export class PaidContinuationWorkflow extends WorkflowEntrypoint<Env, WorkflowContinuationInput> {
  async run(
    event: PaidContinuationWorkflowEvent,
    step: PaidContinuationWorkflowStep
  ): Promise<WorkflowContinuationResult> {
    // `event`/`step` are accepted (not `_`-prefixed) to document the real
    // eventual call shape precisely — see `runPaidContinuationWorkflow`,
    // which H2AWI-3/4 will call from here once dependency wiring exists.
    void event;
    void step;
    throw new Error(
      'PaidContinuationWorkflow.run() dependency wiring is not implemented until H2AWI-3/4 — ' +
        'this checkpoint (H2AWI-2) only implements and tests runPaidContinuationWorkflow() ' +
        'directly against injected fakes.'
    );
  }
}
