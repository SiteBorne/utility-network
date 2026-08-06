// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Common request envelope for all SITEBORNE service invocations. Wraps service-specific
 * input payload.
 */
export interface RequestEnvelope {
  /**
   * Optional buyer-provided metadata that cannot alter execution policy, pricing, or security
   * constraints.
   */
  buyer_metadata?: BuyerMetadata;
  /**
   * Reverse-domain qualified extensions per PCC 1.0.0 rules.
   */
  extensions?: Extensions;
  /**
   * Maximum acceptable age of cached data in seconds. 0 = no cache. Bounded to prevent stale
   * data.
   */
  freshness_seconds?: number;
  /**
   * Client-generated idempotency key for exactly-once semantics. Required for paid operations.
   */
  idempotency_key?: string;
  /**
   * Service-specific input payload. Schema determined by service_id.
   */
  input: { [key: string]: unknown };
  /**
   * Maximum price the caller authorizes for this request. Required for paid services.
   */
  maximum_authorized_price?: DecimalMoney;
  /**
   * Minimum PCC verification score required for the result to be accepted. Range [0, 1].
   */
  minimum_verification_score?: number;
  /**
   * Unique request identifier. Must be a valid UUID v4 or ULID.
   */
  request_id: string;
  /**
   * Expected output schema version. Allows forward-compatible evolution.
   */
  response_schema_version?: Version;
  /**
   * Canonical service identifier. Must match the target service schema.
   */
  service_id: ServiceID;
  /**
   * Explicit service version. Must match the service schema version.
   */
  service_version: Version;
}

/**
 * Optional buyer-provided metadata that cannot alter execution policy, pricing, or security
 * constraints.
 */
export interface BuyerMetadata {
  /**
   * Buyer's internal reference.
   */
  reference?: string;
  tags?: string[];
}

/**
 * Reverse-domain qualified extensions per PCC 1.0.0 rules.
 */
export interface Extensions {}

/**
 * Maximum price the caller authorizes for this request. Required for paid services.
 *
 * Canonical decimal-safe money representation. No binary floating-point. Amount is a
 * canonical decimal string.
 */
export interface DecimalMoney {
  /**
   * Canonical decimal string. No scientific notation, no leading zeros (except single '0'),
   * no trailing zeros unless significant, no sign. Maximum 18 decimal places.
   */
  amount: string;
  /**
   * Payment asset identifier (e.g., 'USDC', 'ETH'). Optional for non-payment contexts.
   */
  asset?: string;
  /**
   * ISO 4217 currency code.
   */
  currency: Currency;
  /**
   * Payment network identifier (e.g., 'base-mainnet', 'base-sepolia'). Optional for
   * non-payment contexts.
   */
  network?: string;
  /**
   * Maximum decimal places supported by the asset/network. Metadata only.
   */
  precision?: number;
}

/**
 * ISO 4217 currency code.
 */
export type Currency = 'USD';

/**
 * Expected output schema version. Allows forward-compatible evolution.
 *
 * Explicit service version. Must match the service schema version.
 */
export type Version = 'v1';

/**
 * Canonical service identifier. Must match the target service schema.
 */
export type ServiceID =
  | 'company_evidence_graph.v1'
  | 'web_context_verified.v1'
  | 'document_evidence_json.v1'
  | 'verify_agent_output.v1';
