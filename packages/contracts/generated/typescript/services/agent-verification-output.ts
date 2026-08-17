// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Output schema for verify_agent_output.v1 service. Must be a valid PCC 1.0.0 document with
 * required net.siteborne.agent-verification.v1 extension.
 *
 * Normative schema for Proof-Carrying Context 1.0.0. Frozen after compatibility validation
 * passes. Schema patch 1.0.1 (SUN-0100 correction): extension_container now structurally
 * permits qualified extension keys via patternProperties, matching documented semantics;
 * pcc_version (document content compatibility) is unchanged at 1.0.0. Schema minor 1.1.0
 * (SUN-1000 checkpoint 1M): service_id enum gains 4 new .v2 members (additive-only per
 * packages/pcc-schema/policy/COMPATIBILITY.md section 1/section 4, which explicitly
 * classifies new enum values as minor-compatible -- not the
 * docs/contracts/COMPATIBILITY_POLICY.md service-contract-release taxonomy, which does not
 * govern this file); the 4 existing .v1 members are unchanged and remain valid; pcc_version
 * is unchanged at 1.0.0.
 */
export interface AgentVerificationOutput {
  claims: Claim[];
  completeness: Completeness;
  contract: Contract;
  evidence: EvidenceItem[];
  extensions: ExtensionContainer;
  job_id: string;
  pcc_version: PccVersion;
  provenance: Provenance;
  receipt: Receipt;
  subject: Subject;
  verification: Verification;
}

export interface Claim {
  claim_id: string;
  confidence: number;
  evidence_ids: string[];
  materiality: Materiality;
  predicate: string;
  value: unknown[] | boolean | number | { [key: string]: unknown } | null | string;
  verification_status: VerificationStatus;
}

/**
 * Claim materiality classification
 */
export type Materiality = 'material' | 'supporting' | 'contextual';

/**
 * Claim verification status
 */
export type VerificationStatus = 'verified' | 'unsupported' | 'disputed' | 'pending';

export interface Completeness {
  missing_fields: string[];
  populated_fields: number;
  requested_fields: number;
  score: number;
  stale_fields: string[];
  supported_fields: number;
  unsupported_fields: string[];
  vector: CompletenessVectorEntry[];
}

export interface CompletenessVectorEntry {
  dimension: string;
  populated: number;
  requested: number;
  score: number;
  supported: number;
}

export interface Contract {
  currency: Currency;
  expires_at: string;
  freshness_seconds: number;
  idempotency_key: string;
  input_hash: string;
  input_schema_hash: string;
  issued_at: string;
  maximum_authorized_price?: string;
  minimum_quality: number;
  mode: ContractMode;
  network?: Network;
  output_schema_hash: string;
  price?: string;
  quote_id: string;
  service_id: ServiceID;
  service_version: ServiceVersion;
}

/**
 * Permitted currencies
 */
export type Currency = 'USD' | 'USDC';

/**
 * Contract mode determines required fields
 */
export type ContractMode = 'paid' | 'benchmark' | 'offline_verification';

export type Network = 'base' | 'base-testnet';

/**
 * Service identifier
 */
export type ServiceID = 'verify_agent_output.v1' | 'verify_agent_output.v2';

/**
 * Service version
 */
export type ServiceVersion = 'v1' | 'v2';

export interface EvidenceItem {
  accessibility_status: AccessibilityStatus;
  authorization_classification: AuthorizationClassification;
  content_hash: string;
  evidence_id: string;
  freshness_status: FreshnessStatus;
  locator: Locator;
  media_type: string;
  retrieved_at: string;
  source_timestamp?: string;
  source_uri: string;
  transformation_history: Transformation[];
}

/**
 * Evidence accessibility status
 */
export type AccessibilityStatus =
  | 'accessible'
  | 'unavailable'
  | 'restricted'
  | 'requires_authorization';

/**
 * Evidence authorization classification
 */
export type AuthorizationClassification =
  | 'public'
  | 'buyer_authorized'
  | 'restricted'
  | 'confidential';

/**
 * Evidence freshness status
 */
export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';

export interface Locator {
  type: LocatorType;
  value: string;
}

/**
 * Evidence locator type
 */
export type LocatorType =
  | 'json_pointer'
  | 'xpath'
  | 'css_selector'
  | 'text_quote'
  | 'page_region'
  | 'byte_range'
  | 'database_record'
  | 'artifact_pointer';

export interface Transformation {
  parameters?: { [key: string]: unknown };
  timestamp: string;
  tool_version: string;
  type: string;
}

/**
 * Controlled extension container. Keys must use reverse-domain qualified namespaces with at
 * least three DNS-safe labels (e.g., net.siteborne.verification.v1,
 * com.example.custom-metrics.v1). Underscores, leading/trailing hyphens, empty labels, and
 * uppercase are forbidden. Maximum 10 extensions. Maximum total namespace key length: 253
 * characters. Each value must conform to extension_value (bounded JSON data).
 */
export interface ExtensionContainer {}

/**
 * PCC specification version
 */
export type PccVersion = '1.0.0';

export interface Provenance {
  cache_provenance: CacheProvenance;
  execution_environment: ExecutionEnvironment;
  models: Model[];
  /**
   * Policy name to version mapping
   */
  policy_versions: { [key: string]: string };
  providers: Provider[];
  routes: ProvenanceRoute[];
  /**
   * Component name to version mapping
   */
  software_versions: { [key: string]: string };
  /**
   * Tool name to version mapping
   */
  tools: { [key: string]: string };
  transformations: Transformation[];
  verification_routes: ProvenanceRoute[];
}

export interface CacheProvenance {
  cache_key?: string;
  enabled: boolean;
  hit: boolean;
  stored_at?: string;
}

export interface ExecutionEnvironment {
  container_image?: string;
  platform: string;
  runtime: string;
  version: string;
}

export interface Model {
  name: string;
  provider: string;
  version: string;
}

export interface Provider {
  capabilities: string[];
  name: string;
  version: string;
}

export interface ProvenanceRoute {
  model_name?: string;
  model_version?: string;
  parameters?: { [key: string]: unknown };
  provider: string;
  type: Type;
  version: string;
}

export type Type = 'cache' | 'direct' | 'deterministic' | 'model' | 'hybrid';

export interface Receipt {
  canonicalization_algorithm: CanonicalizationAlgorithm;
  output_hash: string;
  policy_hash: string;
  schema_hash: string;
  signature: string;
  signature_algorithm: SignatureAlgorithm;
  signed_at: string;
  signing_key_id: string;
}

/**
 * Canonicalization algorithm
 */
export type CanonicalizationAlgorithm = 'RFC8785-JCS';

/**
 * Signature algorithm
 */
export type SignatureAlgorithm = 'Ed25519';

export interface Subject {
  canonical_name: string;
  identifiers?: { [key: string]: string };
  type: SubjectType;
}

/**
 * Subject type
 */
export type SubjectType = 'organization' | 'person' | 'document' | 'webpage' | 'other';

export interface Verification {
  completeness: number;
  cross_source_agreement: number;
  decision: VerificationDecision;
  deterministic_failures: string[];
  evidence_accessibility: number;
  failed_requirements: string[];
  freshness: number;
  material_claims_supported: boolean;
  policy: string;
  prompt_injection_result: PromptInjectionResult;
  provenance_valid: boolean;
  schema_valid: boolean;
  score: number;
  verifier_versions: { [key: string]: string };
}

/**
 * Verification decision
 */
export type VerificationDecision = 'pass' | 'conditional' | 'fail' | 'quarantined';

export interface PromptInjectionResult {
  checked: boolean;
  details?: string;
  result: Result;
}

export type Result = 'clean' | 'suspected' | 'confirmed';
