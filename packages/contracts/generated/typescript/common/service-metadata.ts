// Generated from /Users/meta4ickal/SITEBORNE Utility Network/schemas/common/service-metadata.schema.json
  // DO NOT EDIT MANUALLY — regenerate from canonical schema
  
  /**
 * Machine-readable service metadata for discovery, pricing, and capability advertisement.
 */
export interface ServiceMetadata {
    /**
     * Required authorization level.
     */
    authorization_classification: AuthorizationClassification;
    /**
     * Base price for the service (exact scheme).
     */
    base_price: DecimalMoney;
    /**
     * List of capability identifiers.
     */
    capabilities: string[];
    /**
     * Explicit declared limitations.
     */
    declared_limitations: string[];
    /**
     * Literal capability description. No promotional language.
     */
    description: string;
    /**
     * Supported execution modes.
     */
    execution_mode: ExecutionMode;
    /**
     * Expected latency class for sync execution.
     */
    expected_latency_class: ExpectedLatencyClass;
    /**
     * SHA-256 hash of the canonical input schema.
     */
    input_schema_hash: string;
    /**
     * URI to the input schema (relative or absolute).
     */
    input_schema_uri: string;
    /**
     * Maximum input payload size in bytes.
     */
    maximum_input_bytes: number;
    /**
     * Maximum authorized price (upto scheme).
     */
    maximum_price: DecimalMoney;
    /**
     * SHA-256 hash of the canonical output schema.
     */
    output_schema_hash: string;
    /**
     * URI to the output schema (relative or absolute).
     */
    output_schema_uri: string;
    /**
     * PCC version this service conforms to.
     */
    pcc_version:     string;
    pricing_schemes: [PricingScheme, ...PricingScheme[]];
    /**
     * Whether the service is production-enabled. Must be false for SUN-0101.
     */
    production_enabled: boolean;
    /**
     * Service promotion state per governance.
     */
    promotion_state: PromotionState;
    /**
     * Protocol support status. Values: 'planned', 'scaffolded', 'tested', 'enabled',
     * 'not_enabled'.
     */
    protocols: Protocols;
    /**
     * Canonical service identifier.
     */
    service_id: string;
    /**
     * Service schema version.
     */
    service_version: string;
    /**
     * Human-readable service title.
     */
    title: string;
    /**
     * Metadata last updated timestamp (RFC 3339 UTC).
     */
    updated_at: string;
}

/**
 * Required authorization level.
 */
export type AuthorizationClassification = "public" | "buyer_authorized" | "restricted";

/**
 * Base price for the service (exact scheme).
 *
 * Canonical decimal-safe money representation. No binary floating-point. Amount is a
 * canonical decimal string.
 *
 * Maximum authorized price (upto scheme).
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
 * Supported execution modes.
 */
export type ExecutionMode = "sync" | "async" | "both";

/**
 * Expected latency class for sync execution.
 */
export type ExpectedLatencyClass = "fast" | "standard" | "slow" | "variable";

export type PricingScheme = "exact" | "upto";

/**
 * Service promotion state per governance.
 */
export type PromotionState = "draft" | "case_supported" | "multi_case_supported" | "verified_pattern" | "executable_candidate" | "executable_verified" | "retired" | "tombstoned";

/**
 * Protocol support status. Values: 'planned', 'scaffolded', 'tested', 'enabled',
 * 'not_enabled'.
 */
export interface Protocols {
    a2a:             A2A;
    agentverse:      A2A;
    coinbase_bazaar: A2A;
    mcp:             A2A;
    mcp_registry:    A2A;
    nevermined:      A2A;
    x402:            A2A;
}

export type A2A = "planned" | "scaffolded" | "tested" | "enabled" | "not_enabled";
