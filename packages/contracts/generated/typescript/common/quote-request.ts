// Generated from /Users/meta4ickal/SITEBORNE Utility Network/schemas/common/quote-request.schema.json
  // DO NOT EDIT MANUALLY — regenerate from canonical schema
  
  /**
 * Request for a price quote for a service execution. Used for pre-authorization and cost
 * estimation.
 */
export interface QuoteRequest {
    /**
     * Idempotency key for quote deduplication.
     */
    idempotency_key?: string;
    /**
     * SHA-256 hash of the canonicalized input payload that will be executed.
     */
    input_hash: string;
    /**
     * SHA-256 hash of the input schema that validates the input.
     */
    input_schema_hash: string;
    /**
     * Maximum price the requester authorizes. Required for 'upto' scheme; optional for 'exact'.
     */
    maximum_authorized_price?: DecimalMoney;
    /**
     * SHA-256 hash of the output schema that will validate the result.
     */
    output_schema_hash: string;
    /**
     * Unique quote request identifier.
     */
    request_id: string;
    /**
     * Preferred execution mode.
     */
    requested_execution_mode?: RequestedExecutionMode;
    /**
     * Requested freshness for the execution.
     */
    requested_freshness_seconds?: number;
    /**
     * Pricing scheme requested for the quote.
     */
    requested_pricing_scheme: RequestedPricingScheme;
    /**
     * Canonical service identifier.
     */
    service_id: ServiceID;
    /**
     * Explicit service version.
     */
    service_version: ServiceVersion;
}

/**
 * Maximum price the requester authorizes. Required for 'upto' scheme; optional for
 * 'exact'.
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
export type Currency = "USD";

/**
 * Preferred execution mode.
 */
export type RequestedExecutionMode = "sync" | "async";

/**
 * Pricing scheme requested for the quote.
 */
export type RequestedPricingScheme = "exact" | "upto";

/**
 * Canonical service identifier.
 */
export type ServiceID = "company_evidence_graph.v1" | "web_context_verified.v1" | "document_evidence_json.v1" | "verify_agent_output.v1";

/**
 * Explicit service version.
 */
export type ServiceVersion = "v1";
