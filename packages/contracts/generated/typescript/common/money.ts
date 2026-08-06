// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Canonical decimal-safe money representation. No binary floating-point. Amount is a
 * canonical decimal string.
 */
export interface Money {
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
