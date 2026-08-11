/**
 * Compatibility export for the accepted protocol-x402 API. The calculation
 * authority now lives in `@siteborne/pricing`, alongside the canonical
 * governance-backed price table; protocol-x402 remains credential-independent
 * and does not duplicate price constants or usage arithmetic.
 */
export { calculateDocumentUsage, documentUsageToAtomicUnits } from '@siteborne/pricing';
export type {
  DocumentPageCost,
  DocumentPageCostTier,
  DocumentPageUsageMetrics,
  DocumentUsageCalculation,
} from '@siteborne/pricing';
