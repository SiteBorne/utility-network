/**
 * Core types for the SUN-0500 verification mesh.
 *
 * Mirrors the closed-result-union pattern already established in
 * packages/provider-adapters/src/types.ts and
 * services/modal-worker/src/modal_worker/document/models.py — every
 * verifier returns a closed, typed result; nothing is communicated through
 * an uncaught exception.
 */

export type VerificationStatus = 'pass' | 'fail' | 'indeterminate' | 'skipped_by_policy';
export type Severity = 'info' | 'warning' | 'blocking';

/** The frozen PCC verification_decision enum (schemas/proof-carrying-context.schema.json). */
export type VerificationDecision = 'pass' | 'conditional' | 'fail' | 'quarantined';

export interface VerifierFinding {
  code: string;
  message: string;
  severity: Severity;
  subject?: string;
}

/** Closed result every verifier must return. Never throws to its caller —
 * unexpected internal errors are converted to this shape at the mesh
 * boundary (see mesh.ts::runVerifier). */
export interface VerificationResult {
  verifier_id: string;
  verifier_version: string;
  status: VerificationStatus;
  severity: Severity;
  rule_id: string;
  subject: string;
  claims_checked: number;
  evidence_checked: number;
  findings: VerifierFinding[];
  failure_codes: string[];
  warnings: string[];
  limitations: string[];
  input_hash: string;
  evidence_hashes: string[];
  started_at: string;
  completed_at: string;
  elapsed_ms: number;
  deterministic: boolean;
  retryable: boolean;
  provenance: string[];
  audit_reference?: string;
  /** Present for verifiers whose frozen PCC field is numeric (freshness,
   * completeness, cross_source_agreement, evidence_accessibility) rather
   * than boolean. Absent for boolean/decision verifiers. */
  score?: number;
}

/** Minimal candidate-result shape the mesh verifies. A subset of the frozen
 * PCC document shape (schemas/proof-carrying-context.schema.json) — the
 * mesh does not require every PCC field, only the ones it verifies. */
export interface CandidateClaim {
  claim_id: string;
  subject?: string;
  predicate?: string;
  value?: unknown;
  evidence_ids: string[];
  verified_absent?: boolean;
}

export interface CandidateEvidenceItem {
  evidence_id: string;
  source_uri?: string;
  locator?: EvidenceLocatorRef;
  content_hash?: string;
  retrieved_at?: string;
  authorization_classification?: 'public' | 'buyer_authorized' | 'private';
  result_class?: string; // e.g. success | source_changed | policy_blocked | quarantined
}

export interface EvidenceLocatorRef {
  type:
    | 'json_pointer'
    | 'text_quote'
    | 'css_selector'
    | 'xpath'
    | 'byte_range'
    | 'page_region'
    | 'artifact_pointer'
    | 'database_record';
  value: string;
  source_uri?: string;
  page?: number;
  row?: number;
  column?: number;
}

export interface CandidateResult {
  job_id: string;
  request_id: string;
  service_id: string;
  service_version: string;
  contract_release: string;
  pcc_version?: string;
  input_hash: string;
  input_schema_hash: string;
  output_schema_hash: string;
  output: unknown; // the full candidate document/output being verified
  claims: CandidateClaim[];
  evidence: CandidateEvidenceItem[];
  completeness?: {
    requested_fields: number;
    populated_fields: number;
    supported_fields: number;
    missing_fields: string[];
  };
  freshness_requirement_ms?: number;
}

/** Verification budget bounds — enforced before/around each verifier run. */
export interface VerificationBudget {
  totalTimeoutMs: number;
  perVerifierTimeoutMs: number;
  maxEvidenceItems: number;
  maxClaims: number;
  maxArtifacts: number;
  maxLocatorResolutions: number;
  maxResultBytes: number;
}

export interface AuditEventSink {
  emit(event: { type: string; details: Record<string, unknown>; correlation_id?: string }): void;
  getEvents(): Array<{
    type: string;
    details: Record<string, unknown>;
    correlation_id?: string;
    timestamp: number;
  }>;
}

export interface InjectedClock {
  nowMs(): number;
  nowIso(): string;
}

/** Verification mode, per the master directive's two accepted modes. */
export type VerificationMode = 'standard' | 'independent_reproduction';

export interface VerificationContext {
  request_id: string;
  job_id: string;
  service_id: string;
  service_version: string;
  contract_release: string;
  pcc_schema_release: string;
  pcc_schema_hash: string;
  policy_version: string;
  policy_hash: string;
  mode: VerificationMode;
  budget: VerificationBudget;
  clock: InjectedClock;
  audit: AuditEventSink;
  cancellation_signal?: { aborted: boolean };
}

export interface Verifier {
  readonly verifierId: string;
  readonly verifierVersion: string;
  readonly capabilities: readonly string[];
  readonly dependsOn: readonly string[];
  readonly mandatory: boolean;
  verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> | VerificationResult;
}
