import { usdToMicro } from './index';
import { resolveServiceMaxPriceUsd } from './service-prices';

export interface DocumentPageUsageMetrics {
  page_number: number;
  ocr_used: boolean;
  table_count: number;
}

export type DocumentPageCostTier = 'native' | 'ocr' | 'table';

export interface DocumentPageCost {
  page_number: number;
  tier: DocumentPageCostTier;
  price_usd_micro: number;
}

export interface DocumentUsageCalculation {
  page_costs: DocumentPageCost[];
  subtotal_usd_micro: number;
  max_job_usd_micro: number;
  total_usd_micro: number;
  capped: boolean;
}

function tierForPage(page: DocumentPageUsageMetrics): DocumentPageCostTier {
  if (page.table_count > 0) return 'table';
  if (page.ocr_used) return 'ocr';
  return 'native';
}

function pricingKeyForTier(
  tier: DocumentPageCostTier
): 'document_evidence_json_native' | 'document_evidence_json_ocr' | 'document_evidence_json_table' {
  switch (tier) {
    case 'native':
      return 'document_evidence_json_native';
    case 'ocr':
      return 'document_evidence_json_ocr';
    case 'table':
      return 'document_evidence_json_table';
  }
}

/**
 * Computes document actual usage from measured page modes through the
 * canonical governance-backed pricing package. The maximum is a hard
 * authorization ceiling, never the source of the measured actual amount.
 */
export function calculateDocumentUsage(
  pages: DocumentPageUsageMetrics[]
): DocumentUsageCalculation {
  const page_costs = pages.map((page) => {
    const tier = tierForPage(page);
    return {
      page_number: page.page_number,
      tier,
      price_usd_micro: usdToMicro(resolveServiceMaxPriceUsd(pricingKeyForTier(tier))),
    };
  });
  const subtotal_usd_micro = page_costs.reduce((sum, page) => sum + page.price_usd_micro, 0);
  const max_job_usd_micro = usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_max_job'));
  const capped = subtotal_usd_micro > max_job_usd_micro;
  return {
    page_costs,
    subtotal_usd_micro,
    max_job_usd_micro,
    total_usd_micro: capped ? max_job_usd_micro : subtotal_usd_micro,
    capped,
  };
}

/** Converts integer micro-USD usage to asset atomic units without floating point. */
export function documentUsageToAtomicUnits(
  calculation: DocumentUsageCalculation,
  assetDecimals: number
): string {
  const micro = calculation.total_usd_micro;
  if (assetDecimals === 6) return String(micro);
  if (assetDecimals > 6) return String(micro * 10 ** (assetDecimals - 6));
  return String(Math.floor(micro / 10 ** (6 - assetDecimals)));
}
