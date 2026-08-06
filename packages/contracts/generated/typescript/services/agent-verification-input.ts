// Generated from /Users/meta4ickal/SITEBORNE Utility Network/schemas/services/agent-verification-input.schema.json
  // DO NOT EDIT MANUALLY — regenerate from canonical schema
  
  /**
 * Input schema for verify_agent_output.v1 service. Supports standard and independent
 * reproduction modes.
 */
export interface AgentVerificationInput {
    /**
     * Allowed evidence source domains/URIs.
     */
    allowed_evidence_sources?: string[];
    /**
     * The agent output to verify. Cannot modify verifier policy.
     */
    candidate_output:          { [key: string]: unknown };
    freshness_requirements?:   FreshnessRequirements;
    maximum_authorized_price?: DecimalMoney;
    /**
     * Minimum verification score [0, 1].
     */
    minimum_score?: number;
    /**
     * Required output schema (JSON Schema) that candidate must conform to.
     */
    required_schema: { [key: string]: unknown };
    /**
     * Evidence items supplied with the candidate output.
     */
    supplied_evidence?: SuppliedEvidence[];
    /**
     * Contract specifying what to verify.
     */
    verification_contract: VerificationContract;
    /**
     * Verification mode.
     */
    verification_mode: VerificationMode;
}

export interface FreshnessRequirements {
    evidence_max_age_seconds?: number;
    schema_max_age_seconds?:   number;
}

/**
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

export interface SuppliedEvidence {
    content:       { [key: string]: unknown };
    content_hash:  string;
    evidence_id:   string;
    retrieved_at?: string;
    source_uri?:   string;
}

/**
 * Contract specifying what to verify.
 */
export interface VerificationContract {
    claims:                     Claim[];
    deterministic_requirements: DeterministicRequirement[];
}

export interface Claim {
    claim_id:       string;
    expected_value: unknown[] | boolean | number | { [key: string]: unknown } | null | string;
    materiality?:   Materiality;
    predicate:      Predicate;
    tolerance?:     number;
}

export type Materiality = "material" | "supporting" | "contextual";

export type Predicate = "equals" | "contains" | "matches" | "greater_than" | "less_than" | "exists" | "not_exists";

export interface DeterministicRequirement {
    check:          Check;
    parameters?:    { [key: string]: unknown };
    requirement_id: string;
}

export type Check = "schema_valid" | "hash_match" | "signature_valid" | "evidence_resolves" | "no_pii" | "no_secrets";

/**
 * Verification mode.
 */
export type VerificationMode = "standard" | "independent_reproduction";
