/**
 * Core types for the SUN-0600 local service runtime.
 *
 * Mirrors the closed-result-union pattern already established in
 * packages/provider-adapters, services/modal-worker, and
 * packages/verification — every service returns a closed, typed result;
 * nothing is communicated through an uncaught exception across the local
 * service boundary (mesh.ts::runVerifier's pattern, reused here in
 * dispatcher.ts::executeLocalService).
 */
import type {
  InjectedClock,
  ArtifactStore,
  AuditEventSink as AdapterAuditEventSink,
} from '@siteborne/provider-adapters';
import type { VerificationMode, VerificationReceipt } from '@siteborne/verification';

/** The four frozen v1 service IDs this package implements. */
export type ServiceId =
  | 'company_evidence_graph.v1'
  | 'web_context_verified.v1'
  | 'document_evidence_json.v1'
  | 'verify_agent_output.v1';

/** The single canonical inventory of implemented service IDs — every place
 * that needs "all implemented services" (the fixture-matrix verifier, the
 * cross-service receipt test, wiring.ts) reads this constant rather than
 * hand-maintaining a parallel list that can silently drift. If a fifth
 * service is implemented, add it here once. */
export const ALL_SERVICE_IDS: readonly ServiceId[] = [
  'company_evidence_graph.v1',
  'web_context_verified.v1',
  'document_evidence_json.v1',
  'verify_agent_output.v1',
];

/** Closed service-level result classes (directive §6). Distinct from, but
 * modeled after, provider-adapters' AdapterResultClass and the document
 * worker's FailureCode taxonomy — a service result composes several
 * lower-layer results, so it needs its own closed set. */
export type ServiceResultClass =
  | 'success'
  | 'partial'
  | 'rejected'
  | 'retryable_failure'
  | 'permanent_failure'
  | 'policy_blocked'
  | 'dependency_unavailable'
  | 'source_changed'
  | 'internal_verification_failed';

/** Closed failure-code taxonomy (directive §38), mapped where applicable to
 * the frozen structured-error contract by callers outside this package
 * (e.g. a future control-plane HTTP adapter). */
export type ServiceFailureCode =
  | 'invalid_request'
  | 'unknown_service'
  | 'contract_mismatch'
  | 'dependency_unavailable'
  | 'provider_rate_limited'
  | 'provider_policy_blocked'
  | 'source_changed'
  | 'artifact_unavailable'
  | 'ocr_permission_required'
  | 'document_processing_failed'
  | 'verification_failed'
  | 'reproduction_unavailable'
  | 'execution_timeout'
  | 'result_limit_exceeded'
  | 'internal_verification_failed'
  | 'internal_error';

export interface ServiceFailure {
  code: ServiceFailureCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/** Closed result every LocalService.execute() must return (directive §6). */
export interface ServiceExecutionResult<TOutput = unknown> {
  result_class: ServiceResultClass;
  service_id: ServiceId;
  service_version: 'v1';
  contract_release: string;
  request_id: string;
  job_id: string;
  input_hash: string;
  output?: TOutput;
  output_hash?: string;
  pcc_hash?: string;
  receipt_id?: string;
  /** The full signed receipt — present whenever the mesh actually ran
   * (i.e. every result past input validation), regardless of decision, so
   * even a failed/quarantined verdict has a verifiable signed record.
   * Callers needing real cryptographic proof (not just receipt_id
   * pattern-matching) pass this to @siteborne/verification's
   * verifyReceipt() directly. */
  receipt?: VerificationReceipt;
  /** A summary of the mesh's verification block — present whenever
   * verifyAndSign ran. Mirrors the frozen PCC `verification` shape's
   * scored/decision fields (not the full findings list). */
  verification?: {
    schema_valid: boolean;
    material_claims_supported: boolean;
    evidence_accessibility: number;
    freshness: number;
    completeness: number;
    cross_source_agreement: number;
    provenance_valid: boolean;
    decision: 'pass' | 'conditional' | 'fail' | 'quarantined';
    score: number;
  };
  warnings: string[];
  limitations: string[];
  completeness?: {
    requested_fields: number;
    populated_fields: number;
    supported_fields: number;
    missing_fields: string[];
  };
  audit_references: string[];
  metrics: {
    elapsed_ms: number;
    dependency_calls: number;
    claims_produced: number;
    evidence_produced: number;
    output_bytes: number;
  };
  failure?: ServiceFailure;
}

export interface ServiceExecutionBudget {
  totalTimeoutMs: number;
  maxDependencyCalls: number;
  maxArtifacts: number;
  maxClaims: number;
  maxEvidenceItems: number;
  maxResultBytes: number;
}

export const DEFAULT_SERVICE_BUDGET: ServiceExecutionBudget = {
  totalTimeoutMs: 30_000,
  maxDependencyCalls: 20,
  maxArtifacts: 20,
  maxClaims: 200,
  maxEvidenceItems: 200,
  maxResultBytes: 5_000_000,
};

export interface ServiceAuditEventSink {
  emit(event: { type: string; details: Record<string, unknown>; correlation_id?: string }): void;
  getEvents(): Array<{
    type: string;
    details: Record<string, unknown>;
    correlation_id?: string;
    timestamp: number;
  }>;
}

/** Execution context shared by every local service (directive §5). Deliberately
 * does not expose payment secrets, signing private keys directly, provider
 * credentials, arbitrary network clients, or arbitrary filesystem paths —
 * only injected, bounded, already-authorized dependencies. */
export interface ServiceExecutionContext {
  request_id: string;
  job_id: string;
  idempotency_key?: string;
  service_id: ServiceId;
  contract_release: string;
  pcc_schema_release: string;
  pcc_schema_hash: string;
  /** A `pol_`-prefixed identifier — the frozen PCC `verification.policy`
   * field's shape (`^pol_[a-z0-9]{24}$`), distinct from policy_hash (see
   * docs/decisions/0036-mesh-policy-id-vs-policy-hash-fix.md). */
  policy_id: string;
  /** The canonical hash of the active verification policy document, used
   * for receipt binding (packages/verification/src/receipt/issue.ts). */
  policy_hash: string;
  clock: InjectedClock;
  artifact_store: ArtifactStore;
  audit: ServiceAuditEventSink;
  budget: ServiceExecutionBudget;
  mode: VerificationMode;
  /** 'fixture' never performs any real network/subprocess call, even if a
   * caller-supplied dependency object could technically do so — every
   * dependency injected in 'fixture' mode is itself fixture-backed. */
  execution_mode: 'fixture' | 'live';
  cancellation_signal?: { aborted: boolean };
}

/** The shared local-service execution interface (directive §5). */
export interface LocalService<TInput, TOutput> {
  readonly serviceId: ServiceId;
  readonly serviceVersion: 'v1';
  execute(
    input: TInput,
    context: ServiceExecutionContext
  ): Promise<ServiceExecutionResult<TOutput>>;
}

export type { AdapterAuditEventSink };
