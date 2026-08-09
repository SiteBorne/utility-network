/**
 * TypeScript shapes mirroring the frozen PCC schema
 * (schemas/proof-carrying-context.schema.json) closely enough to build a
 * valid document, without re-deriving the full JSON Schema by hand — final
 * validation is always done against the actual frozen schema artifact via
 * @siteborne/verification's schema-registry (ajv), never against these
 * types alone. These types exist to give the builder/service code
 * compile-time shape safety; they are not the source of truth.
 */

export type SubjectType = 'organization' | 'person' | 'document' | 'webpage' | 'other';
export type Materiality = 'material' | 'supporting' | 'contextual';
export type ClaimVerificationStatus = 'verified' | 'unsupported' | 'disputed' | 'pending';
export type LocatorType =
  | 'json_pointer'
  | 'xpath'
  | 'css_selector'
  | 'text_quote'
  | 'page_region'
  | 'byte_range'
  | 'database_record'
  | 'artifact_pointer';
export type AccessibilityStatus =
  | 'accessible'
  | 'unavailable'
  | 'restricted'
  | 'requires_authorization';
export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';
export type AuthorizationClassification = 'public' | 'buyer_authorized' | 'private';
export type ContractMode = 'paid' | 'benchmark' | 'offline_verification';

/** The frozen `locator` definition has exactly two properties
 * (additionalProperties: false) — no source_uri/page/row/column, unlike
 * @siteborne/provider-adapters' richer EvidenceLocator or
 * @siteborne/verification's EvidenceLocatorRef. evidence/builder.ts strips
 * down to this shape explicitly rather than passing a richer locator
 * object through structurally. */
export interface PccLocator {
  type: LocatorType;
  value: string;
}

/** The frozen `claim` definition has exactly these seven properties
 * (additionalProperties: false) — notably no `subject` and no
 * `verified_absent` field; those are mesh-level concepts
 * (@siteborne/verification's CandidateClaim), not PCC document fields.
 * Verified-absence is expressed by convention (predicate naming + `value:
 * false` + absence-proof evidence), and threaded into candidate
 * construction via a parallel claim_id set — see
 * pcc/candidate-conversion.ts::toCandidateClaims. */
export interface PccClaim {
  claim_id: string;
  predicate: string;
  value: unknown;
  confidence: number;
  evidence_ids: string[];
  materiality: Materiality;
  verification_status: ClaimVerificationStatus;
}

export interface PccEvidenceItem {
  evidence_id: string;
  source_uri: string;
  source_timestamp?: string;
  retrieved_at: string;
  content_hash: string;
  media_type: string;
  locator: PccLocator;
  accessibility_status: AccessibilityStatus;
  transformation_history: Array<{ type: string; timestamp: string; tool_version: string }>;
  authorization_classification: AuthorizationClassification;
  freshness_status: FreshnessStatus;
}

export interface PccCompleteness {
  requested_fields: number;
  populated_fields: number;
  supported_fields: number;
  score: number;
  missing_fields: string[];
  unsupported_fields: string[];
  stale_fields: string[];
  vector: Array<{
    dimension: string;
    requested: number;
    populated: number;
    supported: number;
    score: number;
  }>;
}

export interface PccProvenance {
  routes: Array<{ type: string; provider: string; version: string }>;
  providers: Array<{ name: string; version: string; capabilities: string[] }>;
  tools: Record<string, string>;
  models: unknown[];
  software_versions: Record<string, string>;
  policy_versions: Record<string, string>;
  transformations: unknown[];
  cache_provenance: { enabled: boolean; hit: boolean };
  execution_environment: { runtime: string; version: string; platform: string };
  verification_routes: unknown[];
}

export interface PccSubject {
  type: SubjectType;
  canonical_name: string;
  identifiers?: Record<string, unknown>;
}

export interface PccContract {
  service_id: string;
  service_version: string;
  input_hash: string;
  input_schema_hash: string;
  output_schema_hash: string;
  quote_id: string;
  price?: string;
  maximum_authorized_price?: unknown;
  mode: ContractMode;
  currency: string;
  network?: string;
  minimum_quality: number;
  freshness_seconds: number;
  issued_at: string;
  expires_at: string;
  idempotency_key: string;
}

/** The frozen `verification` block shape — populated directly from
 * @siteborne/verification's MeshVerdict.verification, never hand-built. */
export interface PccVerificationBlock {
  schema_valid: boolean;
  material_claims_supported: boolean;
  evidence_accessibility: number;
  freshness: number;
  completeness: number;
  cross_source_agreement: number;
  provenance_valid: boolean;
  prompt_injection_result: {
    checked: boolean;
    result: 'clean' | 'suspected' | 'confirmed';
    details?: string;
  };
  deterministic_failures: string[];
  verifier_versions: Record<string, string>;
  policy: string;
  decision: 'pass' | 'conditional' | 'fail' | 'quarantined';
  score: number;
  failed_requirements: string[];
}

/** The frozen `receipt` block shape — mapped from a
 * @siteborne/verification VerificationReceipt (see pcc/receipt-mapping.ts). */
export interface PccReceiptBlock {
  output_hash: string;
  canonicalization_algorithm: 'RFC8785-JCS';
  policy_hash: string;
  schema_hash: string;
  signature_algorithm: 'Ed25519';
  signing_key_id: string;
  signature: string;
  signed_at: string;
}

export interface PccDocument<TExtensionKey extends string, TExtension> {
  pcc_version: string;
  job_id: string;
  contract: PccContract;
  subject: PccSubject;
  claims: PccClaim[];
  evidence: PccEvidenceItem[];
  completeness: PccCompleteness;
  provenance: PccProvenance;
  verification: PccVerificationBlock;
  receipt: PccReceiptBlock;
  extensions: { [K in TExtensionKey]: TExtension };
}
