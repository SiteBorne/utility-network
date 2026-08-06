// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Input schema for web_context_verified.v1 service. Supports direct and rendered retrieval
 * modes.
 */
export interface WebContextInput {
  /**
   * Optional buyer-provided JSON Schema for structured output validation.
   */
  buyer_schema?: { [key: string]: unknown };
  /**
   * Requested field selectors for structured output.
   */
  field_selectors?: string[];
  /**
   * Maximum acceptable age of cached content in seconds.
   */
  freshness_seconds?: number;
  /**
   * Locale hint for content negotiation (BCP 47).
   */
  locale_hint?: string;
  /**
   * Maximum content size in bytes to return.
   */
  max_content_size?: number;
  /**
   * Maximum number of redirects to follow.
   */
  max_redirects?: number;
  maximum_authorized_price?: DecimalMoney;
  /**
   * Minimum PCC verification score [0, 1].
   */
  minimum_verification_score?: number;
  /**
   * Desired output format.
   */
  output_mode?: OutputMode;
  /**
   * Redirect handling policy.
   */
  redirect_policy?: RedirectPolicy;
  /**
   * Retrieval mode.
   */
  retrieval_mode: RetrievalMode;
  /**
   * Target URL to retrieve. Public HTTP/HTTPS only.
   */
  target_url: string;
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
export type Currency = 'USD';

/**
 * Desired output format.
 */
export type OutputMode = 'clean_text' | 'markdown' | 'structured';

/**
 * Redirect handling policy.
 */
export type RedirectPolicy = 'follow' | 'follow_first' | 'manual';

/**
 * Retrieval mode.
 */
export type RetrievalMode = 'direct' | 'rendered';
