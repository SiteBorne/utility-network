// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Input schema for company_evidence_graph.v1 service. At least one identity signal is
 * required.
 */
export interface CompanyEvidenceInput {
  /**
   * Buyer-provided public URLs for supplemental evidence.
   */
  buyer_urls?: string[];
  /**
   * Company legal or common name.
   */
  company_name?: string;
  /**
   * Primary website domain.
   */
  domain?: string;
  /**
   * Maximum acceptable age of data in seconds.
   */
  freshness_seconds?: number;
  /**
   * Authoritative identifiers when known.
   */
  identifiers?: Identifiers;
  /**
   * Optional jurisdiction hints for regulatory context.
   */
  jurisdiction_hints?: string[];
  /**
   * Maximum price authorized for this request.
   */
  maximum_authorized_price?: DecimalMoney;
  /**
   * Minimum completeness score required [0, 1].
   */
  minimum_completeness?: number;
  /**
   * Minimum PCC verification score [0, 1].
   */
  minimum_verification_score?: number;
  /**
   * Field groups to include in the result.
   */
  requested_field_groups?: RequestedFieldGroup[];
  /**
   * Stock ticker symbol.
   */
  ticker?: string;
}

/**
 * Authoritative identifiers when known.
 */
export interface Identifiers {
  /**
   * SEC CIK
   */
  cik?: string;
  /**
   * CUSIP
   */
  cusip?: string;
  /**
   * Primary exchange
   */
  exchange?: string;
  /**
   * OpenFIGI
   */
  figi?: string;
  /**
   * ISIN
   */
  isin?: string;
  /**
   * Legal Entity Identifier
   */
  lei?: string;
  /**
   * Primary ticker
   */
  ticker_symbol?: string;
}

/**
 * Maximum price authorized for this request.
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

export type RequestedFieldGroup =
  | 'identity'
  | 'sec_submissions'
  | 'xbrl_facts'
  | 'recent_filings'
  | 'website_evidence'
  | 'regulatory_mentions'
  | 'public_repository_signals';
