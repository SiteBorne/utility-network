// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Price quote for a service execution. Includes pricing details, validity, and execution
 * metadata.
 */
export interface QuoteResponse {
  /**
   * ISO 4217 currency code.
   */
  currency: Currency;
  /**
   * Declared limitations of the quoted service.
   */
  declared_limitations: string[];
  /**
   * Estimated resource class for execution.
   */
  estimated_execution_class: EstimatedExecutionClass;
  /**
   * Execution mode.
   */
  execution_mode: ExecutionMode;
  /**
   * Expected completeness score for the result.
   */
  expected_completeness: number;
  /**
   * Quote expiration timestamp (RFC 3339 UTC). Must be after issued_at.
   */
  expires_at: string;
  /**
   * SHA-256 hash of the input payload.
   */
  input_hash: string;
  /**
   * SHA-256 hash of the input schema.
   */
  input_schema_hash: string;
  /**
   * Quote issuance timestamp (RFC 3339 UTC).
   */
  issued_at: string;
  /**
   * Maximum authorized price for 'upto' scheme. Must not be present for 'exact' scheme.
   */
  maximum_authorized_price?: DecimalMoney;
  /**
   * SHA-256 hash of the output schema.
   */
  output_schema_hash: string;
  /**
   * Payment asset for settlement.
   */
  payment_asset: string;
  /**
   * Payment network for settlement.
   */
  payment_network: string;
  /**
   * Whether payment is required for execution.
   */
  payment_required: boolean;
  /**
   * Exact price for 'exact' scheme. Must not be present for 'upto' scheme.
   */
  price?: DecimalMoney;
  /**
   * Pricing policy version used for this quote.
   */
  pricing_policy_version: string;
  /**
   * Pricing scheme for this quote.
   */
  pricing_scheme: PricingScheme;
  /**
   * Whether the service is production-enabled. Must be false for SUN-0101.
   */
  production_enabled: boolean;
  /**
   * Unique quote identifier.
   */
  quote_id: string;
  /**
   * Original quote request identifier.
   */
  request_id: string;
  /**
   * Canonical service identifier.
   */
  service_id: string;
  /**
   * Service version.
   */
  service_version: string;
}

/**
 * ISO 4217 currency code.
 */
export type Currency = 'USD';

/**
 * Estimated resource class for execution.
 */
export type EstimatedExecutionClass = 'light' | 'standard' | 'heavy' | 'intensive';

/**
 * Execution mode.
 */
export type ExecutionMode = 'sync' | 'async';

/**
 * Maximum authorized price for 'upto' scheme. Must not be present for 'exact' scheme.
 *
 * Canonical decimal-safe money representation. No binary floating-point. Amount is a
 * canonical decimal string.
 *
 * Exact price for 'exact' scheme. Must not be present for 'upto' scheme.
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
 * Pricing scheme for this quote.
 */
export type PricingScheme = 'exact' | 'upto';
