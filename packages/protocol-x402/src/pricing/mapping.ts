/**
 * x402 does NOT own filesystem/YAML access to governance/RISK_LIMITS.yaml
 * — that ownership lives entirely in @siteborne/pricing
 * (src/service-prices.ts), which is the single, shared, runtime-safe API
 * every consumer (this package, and any future one) goes through:
 *
 *   governance/RISK_LIMITS.yaml -> @siteborne/pricing -> @siteborne/protocol-x402
 *
 * This module is a thin re-export, not a second implementation — see
 * docs/decisions/0042-x402-pricing-boundary-correction.md for why the
 * checkpoint-1 version (which parsed the governance YAML directly inside
 * this package) was corrected.
 */
export {
  resolveServiceMaxPriceUsd,
  resolvePricingSourceVersion,
  usdToAtomicUnits,
  UnknownPricingKeyError,
  __setRiskLimitsForTesting,
  type PricingKey,
} from '@siteborne/pricing';
