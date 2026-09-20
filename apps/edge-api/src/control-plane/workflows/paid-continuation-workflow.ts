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
  PaymentEvidenceMode,
  PaymentServiceLink,
  SettleResponse,
} from '@siteborne/protocol-x402';
import {
  CDP_PAYMENT_PROVIDER,
  buildPaymentServiceLink,
  canAdvanceToSettled,
  extendWithSettlement,
  hashPaymentObject,
  verifyPaymentServiceLink,
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
import { buildProductionPaidContinuationWorkflowDependencies } from './production-dependencies';

// ---------------------------------------------------------------------
// SUN-1221E6R-H2BF4 — minimum-privilege host env type.
//
// SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX: widened (never loosened) to also
// cover `company_evidence_graph.v2`/`document_evidence_json.v2`'s own real
// dependency needs. `company_evidence_graph.v2` needs nothing new --
// SUN-1222B-S3R deliberately reuses the already-listed `MODAL_WEBCTX_*`
// safe-egress endpoint (see `company-evidence-graph-v2-cdp-composition.ts`'s
// own doc comment). `document_evidence_json.v2` needs two genuinely new
// members: `MODAL_DOCWORKER_*` (a dedicated, still-undeployed Modal App's
// credentials, SUN-0400B) and `ARTIFACTS` (an R2 bucket binding, commented
// out of the public `wrangler.toml` since SUN-0800B checkpoint 3 pending
// Cloudflare dashboard enablement). `ARTIFACTS` is deliberately added as
// its own OPTIONAL member below, not folded into the `Pick<Env, ...>` --
// `Env['ARTIFACTS']` is a required `R2Bucket` there (the public API
// Worker's declared shape), but on THIS dedicated host the real
// `wrangler.paid-continuation-runtime.toml` binds no `[[r2_buckets]]` at
// all today; typing it as required here would be a static lie about a
// binding this script does not actually have. Every field below (old and
// new) is a member this file's own dependency trace in
// `production-dependencies.ts` proves is actually dereferenced; none of
// the omitted `Env` fields are referenced anywhere in this module or that
// one.
export type PaidContinuationWorkflowHostEnv = Pick<
  Env,
  | 'DB'
  | 'PAYMENT_CONTINUATION_ENCRYPTION_KEY'
  | 'PAID_RECEIPT_SIGNING_PRIVATE_KEY'
  | 'PAID_RECEIPT_SIGNING_KEY_ID'
  | 'SELLER_WALLET_ADDRESS'
  | 'CDP_API_KEY_ID'
  | 'CDP_API_KEY_SECRET'
  | 'PAYMENT_ENVIRONMENT'
  | 'PRODUCTION_ENABLED'
  | 'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP'
  | 'PRODUCTION_CDP_CREDENTIALS_APPROVED'
  | 'MODAL_WEBCTX_ENDPOINT_URL'
  | 'MODAL_WEBCTX_PROXY_KEY'
  | 'MODAL_WEBCTX_PROXY_SECRET'
  | 'MODAL_DOCWORKER_ENDPOINT_URL'
  | 'MODAL_DOCWORKER_PROXY_KEY'
  | 'MODAL_DOCWORKER_PROXY_SECRET'
  | 'BASE_RPC_URL'
  | 'BASE_SEPOLIA_RPC_URL'
> & {
  /** Optional -- see this block's own doc comment for why this is not a
   * `Pick<Env, 'ARTIFACTS'>` member. Absent (the real, current state of
   * `wrangler.paid-continuation-runtime.toml`) means
   * `document_evidence_json.v2`'s own composition-level `!artifactStore`
   * gate fails closed, exactly like every other missing-credential case --
   * never a crash, never a fixture fallback. */
  readonly ARTIFACTS?: Env['ARTIFACTS'];
};

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
      readonly retries?: {
        readonly limit: number;
        readonly delay?: unknown;
        readonly backoff?: string;
      };
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
  /** Exact request-body hash already bound into the server-issued quote. */
  readonly requestInputHash: string;
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

export type PccValidator = (
  outcome: ExecutorOutcome
) => PccValidationResult | Promise<PccValidationResult>;

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
  readonly cachedResult: DurableCachedResult;
}

export interface DurableCachedResult {
  readonly status: 200;
  /**
   * SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: the governed v2 wire result
   * *is* the full PCC document (`durableEvidence.pcc`, unmodified) --
   * never a bespoke envelope. `contracts/releases/2.0.0/schemas/services/
   * *.schema.json` requires the entire validated object to itself be a
   * valid PCC document (`allOf` ref to `proof-carrying-context.schema.json`
   * at the schema's own top level, `additionalProperties: false`), so no
   * sibling metadata field (the previous `service_id` / `result_class` /
   * `receipt_id` / `link_id` / `link_hash` envelope this replaces) can be
   * added alongside it without breaking schema conformance. Service
   * identity already lives at `contract.service_id` /
   * `contract.service_version`; idempotency/correlation already lives at
   * `contract.idempotency_key` -- both already required by the base PCC
   * schema, so nothing is lost, only relocated to its already-governed
   * home. See docs/reports/SUN-1222C-pcc-wire-result-governance-decision.md.
   */
  readonly body: Readonly<Record<string, unknown>>;
  readonly settleResponse: SettleResponse;
  readonly durableEvidence: {
    readonly pcc: unknown;
    readonly receipt: unknown;
    readonly settlement_evidence: unknown;
    readonly payment_service_link: PaymentServiceLink;
  };
}

export interface PersistReceiptInput {
  readonly jobId: string;
  readonly paymentIdentifier: string;
  /** SUN-1221E6R-H2B2-R4: the actual signed PCC/receipt document
   * (`PccValidationResult.pcc` when `valid: true`) — durably persisted
   * verbatim so the cryptographically signed artifact survives past
   * Workflow completion. Cloudflare's Workflow instance-describe API
   * truncates large step outputs (proven in H2B2-R3A/R4), so the
   * Workflow's own step-history log is never a durable source of
   * truth for this document; this is the only durable copy. Optional
   * only so existing fakes that don't model PCC content keep compiling
   * unchanged. */
  readonly pcc?: unknown;
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

export interface WorkflowFinalizationPersistence {
  recordProviderFailure(input: {
    readonly paymentIdentifier: string;
    readonly jobId: string;
    readonly reasonCode: string;
    readonly createdAt: string;
  }): Promise<void>;
  recordSettlementFinalizationUnresolved(input: {
    readonly paymentIdentifier: string;
    readonly jobId: string;
    readonly reasonCode: string;
    readonly createdAt: string;
  }): Promise<void>;
  persistLinkEvidence(input: {
    readonly paymentIdentifier: string;
    readonly jobId: string;
    readonly paymentServiceLink: PaymentServiceLink;
    readonly settlementTransactionReference: string;
    readonly settlementEvidenceHash: string;
    readonly pcc: unknown;
    readonly buyerReceiptId: string;
    readonly createdAt: string;
  }): Promise<void>;
  finalizeSettled(paymentIdentifier: string, now: string): Promise<void>;
}

export interface PaidContinuationWorkflowDependencies {
  /** Imported once by the caller (never read from `env` inside
   * `openContinuationEnvelope` itself — H2AWI-1's own boundary). */
  readonly envelopeKey: CryptoKey;
  /** Unix seconds. Injected so authorization-expiry boundary tests never
   * depend on real wall time. */
  readonly clock: () => number;
  /** Trust policy applied to both verification and settlement evidence.
   * Production dependency composition always supplies `production`; test
   * fixtures explicitly supply `fixture`. */
  readonly evidenceMode: PaymentEvidenceMode;
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
    readonly finalization: WorkflowFinalizationPersistence;
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
  extra?: Partial<
    Pick<
      WorkflowContinuationResult,
      | 'receipt_id'
      | 'settlement_transaction_reference'
      | 'error_code'
      | 'error_detail'
      | 'settlement_subreason'
      | 'settlement_jwt_subreason'
      | 'settlement_transport_status'
      | 'settlement_retryability'
    >
  >
): WorkflowContinuationResult {
  return { status, job_id: jobId, ...extra };
}

function errorCode(e: unknown): string {
  if (e instanceof EnvelopeOpenError) return e.code;
  if (e instanceof Error) return e.name || 'error';
  return 'unknown_error';
}

// SUN-1222C-R4 -- bounds how much of an executor-provided string ever
// reaches a terminal result. These are already sanitized, service-authored
// strings (e.g. `CompanyEvidenceGraphService`'s `limitations` entries are
// built from a fixed set of provider/result_class names and a validated
// CIK, never raw upstream response bodies, headers, or credentials) -- this
// is defense-in-depth against an unexpectedly long or malformed string ever
// reaching an HTTP response, not the primary sanitization boundary.
const ERROR_DETAIL_MAX_LENGTH = 500;

function boundedDetail(detail: string): string {
  return detail.length > ERROR_DETAIL_MAX_LENGTH
    ? `${detail.slice(0, ERROR_DETAIL_MAX_LENGTH)}…(truncated)`
    : detail;
}

// SUN-1222C-R4-D10 — the observational-only counterpart to the D5/D6/D7
// evidence_ref threading: `settlement_ambiguous` deliberately makes NO
// job-state-machine transition (see the call site below and design §13 —
// forcing one would either duplicate `REFUND_REQUIRED`'s no-DELIVERED-path
// problem D7 already ruled out for the sibling `persistence_failed_after_
// settlement` branches, or misrepresent an inconclusive economic outcome
// as a definitive one). The durable fact of the ambiguity already survives
// independently, in `payment_attempts.lifecycle_stage = 'settlement_pending'`
// (queryable via the new `listUnresolvedSettlements`,
// `../repositories/d1/payment-attempts.ts`) — this call adds only the
// active-signal half D10's audit found missing (`D10_ALERTING_CLASS=D`):
// a structured, correlation-only log emitted at the exact point automated
// reconciliation gives up. Carries no economic authority whatsoever — it
// is a `console.warn` call and nothing else (statically proven zero
// settle/verify/executor/chain callsites in
// `paid-continuation-workflow-observability.test.ts`) — and no secret:
// `job_id`/`payment_identifier` are the same two non-secret correlation
// identifiers already used throughout this file's own terminal results
// and every prior SUN-1222C-R4 evidence report.
function logSettlementAmbiguous(jobId: string, paymentIdentifier: string): void {
  console.warn(
    JSON.stringify({
      event: 'settlement_ambiguous_unresolved',
      job_id: jobId,
      payment_identifier: paymentIdentifier,
    })
  );
}

// SUN-1222C-R4-D1 proved: a legitimate `result_class !== 'success'`
// executor result need not carry a `failure` object at all -- e.g.
// `CompanyEvidenceGraphService` returns `failure: undefined` whenever its
// own internal verification mesh decision is `'pass'` (a `'partial'`
// result_class, not a mesh rejection), and in that case the only specific,
// informative detail lives in `limitations`. `error_code` (the stable,
// bounded machine code every existing caller already relies on) is
// deliberately left untouched by this function -- it still falls back to
// `result_class` exactly as before; this only adds a SEPARATE, additive
// `error_detail` for the specific reason.
function deriveErrorDetail(result: ExecutorOutcome['result']): string | undefined {
  if (result.failure?.message) return boundedDetail(result.failure.message);
  const limitations = result.limitations;
  if (limitations && limitations.length > 0) {
    // The last entry is the most specific (services append broader
    // context first, e.g. a `sec_submissions`-group-level note, then the
    // precise provider rejection last) -- matches SUN-1222C-R4-D1's
    // observed `CompanyEvidenceGraphService` ordering exactly.
    return boundedDetail(limitations[limitations.length - 1]);
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Job state-machine helpers — real `createStateEvent`/`isTerminal`,
// never faked (pure functions, no I/O).
// ---------------------------------------------------------------------

async function transitionJobState(
  jobId: string,
  toState: JobState,
  reason: TransitionReason,
  persistence: JobStatePersistence,
  // SUN-1222C-R4-D4-CONTINUED: the one place a caller may attach the
  // specific, already-bounded/already-sanitized reason text (from
  // `deriveErrorDetail`) to the durable state-event trail. Optional and
  // additive — every existing call site keeps working unchanged; only the
  // rejection/quarantine call sites below pass one.
  evidenceRef?: string
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
  const event = createStateEvent(
    jobId,
    job.attempt_number,
    job.current_state,
    toState,
    reason,
    'SYSTEM',
    evidenceRef
  );
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
async function finalizeTerminalState(
  jobId: string,
  persistence: JobStatePersistence
): Promise<void> {
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
  | {
      readonly kind: 'confirmed';
      readonly transactionReference?: string;
      readonly payer?: string;
      readonly settlementEvidence: unknown;
      readonly settlementEvidenceHash: string;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: string;
      /** FIRST-PAID-VERIFY-SETTLEMENT-OBSERVABILITY-01 — normalized, closed-vocabulary
       * provider cause. Absent when the provider supplied none. */
      readonly diagnostics?: SettlementRejectionDiagnostics;
    }
  | { readonly kind: 'authorization_expired' }
  | { readonly kind: 'ambiguous_unresolved' };

/** Closed-vocabulary settlement failure cause. Every field is re-validated
 * here against a strict token pattern, so nothing free-form (message, header,
 * JWT, body, stack) can enter durable Workflow state or the audit trail even
 * if a provider misbehaves. */
export interface SettlementRejectionDiagnostics {
  readonly subreason?: string;
  readonly jwt_subreason?: string;
  readonly transport_status?: number;
  readonly retryability?: string;
}

const SAFE_DIAGNOSTIC_TOKEN = /^[a-z0-9_]{1,64}$/;

export function normalizeSettlementDiagnostics(evidence: {
  subreason?: unknown;
  jwt_subreason?: unknown;
  transport_status?: unknown;
  retryability?: unknown;
}): SettlementRejectionDiagnostics | undefined {
  const token = (value: unknown): string | undefined =>
    typeof value === 'string' && SAFE_DIAGNOSTIC_TOKEN.test(value) ? value : undefined;
  const status =
    typeof evidence.transport_status === 'number' &&
    Number.isInteger(evidence.transport_status) &&
    evidence.transport_status >= 100 &&
    evidence.transport_status <= 599
      ? evidence.transport_status
      : undefined;
  const subreason = token(evidence.subreason);
  const jwt_subreason = token(evidence.jwt_subreason);
  const retryability = token(evidence.retryability);
  if (!subreason && !jwt_subreason && status === undefined && !retryability) return undefined;
  return {
    ...(subreason ? { subreason } : {}),
    ...(jwt_subreason ? { jwt_subreason } : {}),
    ...(status !== undefined ? { transport_status: status } : {}),
    ...(retryability ? { retryability } : {}),
  };
}

/** Durable audit detail: the gate reason first (unchanged prefix), then the
 * same normalized fields the Workflow result carries. */
export function formatSettlementAuditDetail(
  reason: string,
  diagnostics: SettlementRejectionDiagnostics | undefined
): string {
  if (!diagnostics) return reason;
  const parts = [
    diagnostics.subreason ? `subreason=${diagnostics.subreason}` : undefined,
    diagnostics.jwt_subreason ? `jwt=${diagnostics.jwt_subreason}` : undefined,
    diagnostics.transport_status !== undefined ? `http=${diagnostics.transport_status}` : undefined,
    diagnostics.retryability ? `retry=${diagnostics.retryability}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? `${reason};${parts.join(';')}` : reason;
}

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
    const settlementEvidence = {
      kind: 'cdp_settlement_reconciled',
      payment_identifier: paymentIdentifier,
      transaction_reference: reconciliation.settlement_transaction_reference,
      checked_at_unix: reconciliation.checked_at_unix,
    };
    return {
      kind: 'confirmed',
      transactionReference: reconciliation.settlement_transaction_reference,
      settlementEvidence,
      settlementEvidenceHash: await hashPaymentObject(settlementEvidence),
    };
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
  validBeforeUnix: number,
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
  if (
    existing &&
    (existing.lifecycleStage === 'settled_external' ||
      existing.lifecycleStage === 'link_verified' ||
      existing.lifecycleStage === 'settled')
  ) {
    // Already resolved by a prior attempt. Defensive re-entry only — the
    // platform's own step memoization should make this unreachable in
    // practice (step 4 itself would already be memoized once it returns
    // 'confirmed'), but never re-calls settle() even here.
    const settlementEvidence = {
      kind: 'cdp_settlement_existing',
      payment_identifier: paymentIdentifier,
      transaction_reference: existing.settlementTransactionReference,
    };
    return {
      kind: 'confirmed',
      transactionReference: existing.settlementTransactionReference ?? undefined,
      settlementEvidence,
      settlementEvidenceHash: await hashPaymentObject(settlementEvidence),
    };
  }
  if (existing && existing.lifecycleStage === 'settlement_failed') {
    return { kind: 'rejected', reason: existing.settlementOutcomeKind ?? 'settlement_rejected' };
  }

  // Recheck immediately before claiming a NEW settlement. Executor/PCC
  // work can outlive an authorization that was valid at Workflow entry.
  // This deliberately follows all existing-state guards above: an
  // already-transmitted settlement must still be reconciled after expiry,
  // never hidden behind an expiry error and never submitted a second time.
  if (deps.clock() >= validBeforeUnix) {
    return { kind: 'authorization_expired' };
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

  const acceptedVerificationEvidenceHash = await hashPaymentObject(decrypted.verificationEvidence);
  const settlementGate = canAdvanceToSettled(
    settlementEvidence,
    decrypted.settlementContext,
    deps.evidenceMode,
    acceptedVerificationEvidenceHash
  );

  if (settlementGate.allowed) {
    await repo.recordSettledExternal(paymentIdentifier, settlementEvidence.transaction_reference);
    await repo.incrementCdpSuccessfulSettlementCount(paymentIdentifier);
    // SUN-1221E6R-H2AWI-3 fix: see the reconciliation-confirmed branch's
    // identical call for the full incident this closes -- this is the
    // OTHER (direct-success, non-reconciliation) confirmed-settlement
    // path, which needs the exact same call.
    await repo.markConsumed(paymentIdentifier);
    return {
      kind: 'confirmed',
      transactionReference: settlementEvidence.transaction_reference,
      payer: settlementEvidence.payer,
      settlementEvidence,
      settlementEvidenceHash: settlementEvidence.raw_evidence_hash,
    };
  }

  await repo.recordCdpSettlementOutcome(
    paymentIdentifier,
    'settlement_pending',
    'explicit_rejection',
    settlementEvidence.transaction_reference
  );
  const gateReason = settlementGate.allowed
    ? undefined
    : `${settlementGate.reason}${settlementGate.detail ? `:${settlementGate.detail}` : ''}`;
  const diagnostics = normalizeSettlementDiagnostics(settlementEvidence);
  return {
    kind: 'rejected',
    reason: gateReason ?? settlementEvidence.reason ?? 'settlement_rejected',
    ...(diagnostics ? { diagnostics } : {}),
  };
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
    // SUN-1222C-R4-D7: sibling fix to D4-CONTINUED/D6's evidence_ref
    // threading — an envelope-open failure previously returned this
    // terminal result without ANY durable state transition at all (the
    // job stayed at whatever pre-Workflow state x402-service.ts left it
    // in, with zero D1 record that a failure occurred here or why).
    // `errorCode(e)` is already the same short, bounded code this
    // terminal result puts in `error_code` — never raw envelope
    // ciphertext, key material, or exception internals.
    await transitionJobState(
      jobId,
      'REJECTED',
      'VALIDATION_FAILED',
      deps.persistence.job,
      boundedDetail(errorCode(e))
    );
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
      return deps.executor(decrypted.executorInput, {
        job_id: jobId,
        request_id: input.request_id,
      });
    });
  } catch (e) {
    // SUN-1222C-R4-D4-CONTINUED: a thrown executor error's message is the
    // exact same text `terminal(...)` already puts in the (operator-only,
    // per R4-D3) `error_code` field — bounding it here too before it ever
    // reaches the durable event trail, same defense-in-depth rationale as
    // `deriveErrorDetail`/`boundedDetail` below.
    const timeoutDetail = boundedDetail(e instanceof Error ? e.message : errorCode(e));
    await transitionJobState(
      jobId,
      'QUARANTINED',
      'EXECUTION_FAILED',
      deps.persistence.job,
      timeoutDetail
    );
    await transitionJobState(
      jobId,
      'REJECTED',
      'QUARANTINE_POLICY',
      deps.persistence.job,
      timeoutDetail
    );
    await deps.persistence.finalization.recordProviderFailure({
      paymentIdentifier,
      jobId,
      reasonCode: `executor_timeout:${errorCode(e)}`,
      createdAt: new Date().toISOString(),
    });
    return terminal('executor_timeout', jobId, { error_code: errorCode(e) });
  }
  if (executorOutcome.result.result_class !== 'success') {
    // SUN-1222C-R4-D4-CONTINUED: computed once, reused for both the
    // terminal HTTP-facing result (unchanged) and the durable state-event
    // trail (new) — the exact same already-bounded, already-sanitized
    // string in both places, never two independent derivations.
    const rejectionDetail = deriveErrorDetail(executorOutcome.result);
    await transitionJobState(
      jobId,
      'QUARANTINED',
      'EXECUTION_FAILED',
      deps.persistence.job,
      rejectionDetail
    );
    await deps.persistence.finalization.recordProviderFailure({
      paymentIdentifier,
      jobId,
      reasonCode: `executor_rejected:${executorOutcome.result.failure?.code ?? executorOutcome.result.result_class}`,
      createdAt: new Date().toISOString(),
    });
    await transitionJobState(
      jobId,
      'REJECTED',
      'QUARANTINE_POLICY',
      deps.persistence.job,
      rejectionDetail
    );
    return terminal('executor_rejected', jobId, {
      error_code: executorOutcome.result.failure?.code ?? executorOutcome.result.result_class,
      error_detail: rejectionDetail,
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
    // SUN-1222C-R4-D6: sibling fix to D5's executor_rejected/
    // executor_timeout evidence_ref threading — `pccResult.reason` (e.g.
    // `signature_mismatch`, `missing_receipt`) is already a short,
    // service-authored code (see `PccValidationResult`, never raw PCC
    // content/payment material), but was previously only returned in the
    // terminal HTTP-facing result and dropped before the durable
    // state-event trail. Bounded for the same defense-in-depth reason
    // `deriveErrorDetail` bounds its own strings, even though this one is
    // always short in practice.
    await transitionJobState(
      jobId,
      'REJECTED',
      'VERIFICATION_FAILED',
      deps.persistence.job,
      boundedDetail(pccResult.reason)
    );
    return terminal('pcc_failed', jobId, { error_code: pccResult.reason });
  }
  await transitionJobState(jobId, 'SETTLING', 'VERIFICATION_PASSED', deps.persistence.job);

  // STEP 4 — settle. Zero blind retries (frozen invariant, STEP_CONFIG.SETTLE).
  const settleOutcome = await step.do('settle', STEP_CONFIG.SETTLE, async () =>
    runSettlementStep(paymentIdentifier, metadata.valid_before_unix, decrypted, deps)
  );

  if (settleOutcome.kind === 'authorization_expired') {
    await transitionJobState(jobId, 'REJECTED', 'PAYMENT_FAILED', deps.persistence.job);
    return terminal('authorization_expired', jobId);
  }
  if (settleOutcome.kind === 'ambiguous_unresolved') {
    // Design §13: the job legitimately stays non-terminal, pending
    // ops/human reconciliation — never forced into a REJECTED-family
    // state merely because settlement is inconclusive.
    // SUN-1222C-R4-D10: emit the durable-detection/operator-escalation
    // signal at this single convergence point — every `ambiguous_unresolved`
    // origin (pre-settle CAS contention, post-settle-throw reconciliation
    // exhaustion, prior-pending reconciliation exhaustion) reaches here.
    logSettlementAmbiguous(jobId, paymentIdentifier);
    return terminal('settlement_ambiguous', jobId);
  }
  if (settleOutcome.kind === 'rejected') {
    // SUN-1222C-R4-D7: `settleOutcome.reason` is already the same short,
    // structured, service-authored code this terminal result puts in
    // `error_code` (a `canAdvanceToSettled` gate enum, optionally suffixed
    // with a structural-validation detail, or a fixed reconciliation
    // code — never raw facilitator/provider content) — previously
    // computed but dropped before the durable state-event trail, same
    // gap class D5/D6 already closed for the other rejection branches.
    await transitionJobState(
      jobId,
      'REFUND_REQUIRED',
      'PAYMENT_FAILED',
      deps.persistence.job,
      boundedDetail(formatSettlementAuditDetail(settleOutcome.reason, settleOutcome.diagnostics))
    );
    // `error_code` is the public 402 body's detail and stays byte-identical;
    // the normalized cause travels only in the internal `settlement_*` fields.
    return terminal('settlement_rejected', jobId, {
      error_code: settleOutcome.reason,
      ...(settleOutcome.diagnostics?.subreason
        ? { settlement_subreason: settleOutcome.diagnostics.subreason }
        : {}),
      ...(settleOutcome.diagnostics?.jwt_subreason
        ? { settlement_jwt_subreason: settleOutcome.diagnostics.jwt_subreason }
        : {}),
      ...(settleOutcome.diagnostics?.transport_status !== undefined
        ? { settlement_transport_status: settleOutcome.diagnostics.transport_status }
        : {}),
      ...(settleOutcome.diagnostics?.retryability
        ? { settlement_retryability: settleOutcome.diagnostics.retryability }
        : {}),
    });
  }

  if (!settleOutcome.transactionReference) {
    await deps.persistence.finalization.recordSettlementFinalizationUnresolved({
      paymentIdentifier,
      jobId,
      reasonCode: 'missing_settlement_transaction_reference',
      createdAt: new Date().toISOString(),
    });
    return terminal('persistence_failed_after_settlement', jobId, {
      error_code: 'missing_settlement_transaction_reference',
    });
  }
  const settlementTransactionReference = settleOutcome.transactionReference;

  const verificationReceipt = pccResult.pcc;
  const verificationReceiptId =
    executorOutcome.result.receipt_id ??
    (typeof verificationReceipt === 'object' &&
    verificationReceipt !== null &&
    typeof (verificationReceipt as { receipt_id?: unknown }).receipt_id === 'string'
      ? (verificationReceipt as { receipt_id: string }).receipt_id
      : undefined);
  if (!verificationReceiptId) {
    // SUN-1222C-R4-D7 evaluated and deliberately did NOT add a durable
    // state transition here (or to the four sibling
    // `persistence_failed_after_settlement` branches below): the job is
    // intentionally left at 'SETTLING' — a `RetryableState` — exactly
    // like `settlement_ambiguous` above, so the Workflow platform's own
    // idempotent step-retry can still resolve to 'DELIVERED' normally
    // (proof: `paid-continuation-workflow.test.ts`'s
    // settled-then-*-persistence-failure retry tests). Forcing
    // 'REFUND_REQUIRED' here would permanently block that legitimate
    // retry path, since 'REFUND_REQUIRED' has no transition to
    // 'DELIVERED'. Classified Class E (not actually terminal), not a
    // durable-observability gap.
    return terminal('persistence_failed_after_settlement', jobId, {
      error_code: 'missing_verification_receipt_id',
      settlement_transaction_reference: settleOutcome.transactionReference,
    });
  }
  // `hashPaymentObject` canonicalizes through `canonical-json`, which
  // throws on `undefined` (root-level or nested) rather than silently
  // dropping it the way `JSON.stringify` would -- an uncaught throw here
  // would surface as an opaque 500 instead of the same clean, already-
  // established `persistence_failed_after_settlement` terminal state used
  // just above for the sibling `missing_verification_receipt_id` case.
  // `PccValidator`'s return type declares `pcc: unknown` as required, but
  // that's compile-time only; nothing stops an implementation from
  // resolving it to `undefined` at runtime.
  if (verificationReceipt === undefined) {
    // SUN-1222C-R4-D7: see the `missing_verification_receipt_id` sibling
    // above — Class E, no durable transition added, same retry-safety
    // rationale.
    return terminal('persistence_failed_after_settlement', jobId, {
      error_code: 'missing_verification_receipt',
      settlement_transaction_reference: settleOutcome.transactionReference,
    });
  }

  const serviceOutputHash =
    executorOutcome.result.output_hash ??
    (await hashPaymentObject({ output: executorOutcome.result.output ?? null }));
  const verificationEvidenceHash = await hashPaymentObject(decrypted.verificationEvidence);
  let paymentServiceLink = await buildPaymentServiceLink({
    link_version: 2,
    payment_rail: 'cdp',
    payment_provider: CDP_PAYMENT_PROVIDER,
    payment_identifier: paymentIdentifier,
    quote_id: decrypted.settlementContext.quote_id,
    requirement_id: decrypted.settlementContext.requirement_id,
    service_id: decrypted.settlementContext.service_id,
    service_version: decrypted.settlementContext.service_version,
    request_input_hash: decrypted.requestInputHash,
    job_id: jobId,
    service_output_hash: serviceOutputHash,
    verification_receipt_id: verificationReceiptId,
    verification_receipt_hash: await hashPaymentObject(verificationReceipt),
    verification_evidence_hash: verificationEvidenceHash,
  });
  paymentServiceLink = await extendWithSettlement(
    paymentServiceLink,
    settleOutcome.settlementEvidenceHash
  );
  const linkVerification = await verifyPaymentServiceLink(paymentServiceLink);
  if (!linkVerification.valid) {
    // SUN-1222C-R4-D7: see the `missing_verification_receipt_id` sibling
    // above — Class E, no durable transition added, same retry-safety
    // rationale.
    await deps.persistence.finalization.recordSettlementFinalizationUnresolved({
      paymentIdentifier,
      jobId,
      reasonCode: linkVerification.reason,
      createdAt: new Date().toISOString(),
    });
    return terminal('persistence_failed_after_settlement', jobId, {
      error_code: linkVerification.reason,
      settlement_transaction_reference: settleOutcome.transactionReference,
    });
  }

  const cachedResult: DurableCachedResult = {
    status: 200,
    // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: the wire body *is* the
    // already-built, already-signed PCC document -- the accepted v2
    // output-schema authority (see DurableCachedResult.body's own doc
    // comment). Never a second PCC construction; `verificationReceipt`
    // (== `pccResult.pcc`) is the exact same object every other use of
    // this result (durableEvidence.pcc below, receipt persistence)
    // already treats as authoritative.
    body: verificationReceipt as Readonly<Record<string, unknown>>,
    settleResponse: {
      success: true,
      transaction: settleOutcome.transactionReference ?? 'reconciled:transaction-unavailable',
      network: decrypted.settlementContext.network,
      ...(settleOutcome.payer ? { payer: settleOutcome.payer } : {}),
      amount: decrypted.actualAmount,
      extra: { link_id: paymentServiceLink.link_id, payment_identifier: paymentIdentifier },
    },
    durableEvidence: {
      pcc: verificationReceipt,
      receipt: executorOutcome.result.receipt,
      settlement_evidence: settleOutcome.settlementEvidence,
      payment_service_link: paymentServiceLink,
    },
  };

  // STEP 5 — persist-result. Settlement is already confirmed at this
  // point; safe to retry (idempotent UPSERT keyed by payment_identifier).
  let resultStatus: { status: 'written' | 'already_written' };
  try {
    resultStatus = await step.do('persist-result', STEP_CONFIG.PERSIST_RESULT, async () =>
      deps.persistence.resultReceipt.persistResult({
        jobId,
        paymentIdentifier,
        settlementTransactionReference: settleOutcome.transactionReference,
        cachedResult,
      })
    );
  } catch (e) {
    // SUN-1222C-R4-D7: see the `missing_verification_receipt_id` sibling
    // above — Class E, no durable transition added, same retry-safety
    // rationale (this is exactly the step-retry case the comment above
    // this try block describes).
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
        const receipt = await deps.persistence.resultReceipt.persistReceipt({
          jobId,
          paymentIdentifier,
          pcc: pccResult.valid ? pccResult.pcc : undefined,
        });
        await deps.persistence.finalization.persistLinkEvidence({
          paymentIdentifier,
          jobId,
          paymentServiceLink,
          settlementTransactionReference,
          settlementEvidenceHash: settleOutcome.settlementEvidenceHash,
          pcc: pccResult.pcc,
          buyerReceiptId: receipt.receiptId,
          createdAt: new Date().toISOString(),
        });
        await deps.persistence.finalization.finalizeSettled(
          paymentIdentifier,
          new Date().toISOString()
        );
        await finalizeTerminalState(jobId, deps.persistence.job);
        return receipt;
      }
    );
  } catch (e) {
    // SUN-1222C-R4-D7: see the `missing_verification_receipt_id` sibling
    // above — Class E, no durable transition added. Critically, adding
    // one here was tried and reverted: it broke the exact idempotent
    // retry this step's own doc comment above promises (a job already
    // marked 'REFUND_REQUIRED' can never legitimately reach 'DELIVERED'
    // on a later successful retry — proof:
    // `paid-continuation-workflow.test.ts`'s
    // settled-then-terminal-state-persistence-failure test).
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
export class PaidContinuationWorkflow extends WorkflowEntrypoint<
  PaidContinuationWorkflowHostEnv,
  WorkflowContinuationInput
> {
  /**
   * SUN-1221E6R-H2BF1 — real production wiring. Deferred since H2AWI-2
   * (this class was a hard-coded throwing stub straight through
   * provisioning and the H2B real-payment attempt, which errored with
   * zero Workflow steps executed — see
   * `docs/reports/SUN-1221E6R-H2B-real-durable-workflow-payment-
   * qualification.md` and `SUN-1221E6R-H2BF1-workflow-entrypoint-
   * version-graph-reconciliation.md`).
   *
   * Deliberately thin: `this.env` is the only thing a real
   * `WorkflowEntrypoint.run()` ever has, so dependency construction
   * itself lives in the separate, independently testable
   * `buildProductionPaidContinuationWorkflowDependencies` (module
   * boundary tests mock this import; see
   * `paid-continuation-workflow-entrypoint.test.ts`). No settlement
   * semantics, retry policy, or step graph changed by this wiring —
   * `runPaidContinuationWorkflow` (already exhaustively tested against
   * fakes by H2AWI-2) is called completely unmodified.
   */
  async run(
    event: PaidContinuationWorkflowEvent,
    step: PaidContinuationWorkflowStep
  ): Promise<WorkflowContinuationResult> {
    const deps = await buildProductionPaidContinuationWorkflowDependencies(
      this.env,
      event.payload.metadata.service
    );
    if ('unavailable' in deps) {
      // SUN-1221E6R-H2BF5-R1 — THROW, never resolve. A resolved return
      // value here (the pre-fix behavior) is recorded by the real
      // Cloudflare Workflows platform as instance status "Completed" /
      // "Success" purely because `run()` didn't throw — the platform has
      // no visibility into this object's own `status:
      // 'workflow_internal_error'` field, which is application-level
      // payload, not a platform signal. That mismatch produced the real
      // H2BF5 synthetic instance's "Completed, Success=Yes, Steps=0"
      // result when the five required host secrets were absent (see
      // `docs/reports/SUN-1221E6R-H2BF5-R1-*.md`) — a genuine
      // configuration failure recorded by Cloudflare as a success.
      // Throwing is the only way to make the PLATFORM's own status field
      // agree with reality; never a plaintext fallback, never a
      // partial/guessed dependency set. Mirrors the exact convention
      // every real production route composition function already uses
      // for a missing MODAL_WEBCTX_*/CDP/receipt-signing credential —
      // this is that same fail-closed contract, now enforced at the
      // one additional layer (Workflow instance status) those HTTP
      // routes never had to account for.
      throw new Error(`dependencies_unavailable: ${deps.reason}`);
    }
    return runPaidContinuationWorkflow(event, step, deps);
  }
}
