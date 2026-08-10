/**
 * Maps `document_evidence_json.v1`'s accepted per-page pricing modes
 * (directive §10) into a credential-independent, deterministic usage
 * calculation — the **actual usage binding** half of the
 * authorization/usage split (directive §26; see requirements/upto.ts's
 * module doc). Given a deterministic worker-result page metrics fixture,
 * this computes the structural actual amount that would later be
 * submitted for settlement (SUN-0700B) — it never settles anything
 * itself.
 *
 * Per-page cost driver is the page's own measured fields, not a
 * classification-string guess: a page with any extracted table costs the
 * `table` rate (the highest per-page rate — richer extraction, more
 * verification surface); a page that required OCR (and has no table)
 * costs the `ocr` rate; every other page costs the `native` rate. The
 * per-document total is capped at `document_evidence_json_max_job`
 * (governance/RISK_LIMITS.yaml) — SITEBORNE's own accepted ceiling,
 * never exceeded regardless of how many pages a document has.
 */
import { usdToMicro } from '@siteborne/pricing';
import { resolveServiceMaxPriceUsd } from './mapping';

/** The minimal per-page metrics this calculation needs — deliberately a
 * narrow, structural subset of service-runtime's `WorkerPage` (this
 * package does not depend on @siteborne/service-runtime; duplicating this
 * tiny shape avoids a cross-package dependency for three booleans/a
 * count). */
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
  /** Sum of every page's cost, before the max-job ceiling is applied. */
  subtotal_usd_micro: number;
  /** governance/RISK_LIMITS.yaml's `document_evidence_json_max_job`
   * ceiling, in micro-USD. */
  max_job_usd_micro: number;
  /** min(subtotal_usd_micro, max_job_usd_micro) — the actual amount this
   * document's usage produced, structurally. */
  total_usd_micro: number;
  /** Whether the max-job ceiling actually bound (subtotal exceeded it). */
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

/** Deterministic: identical page metrics always produce identical costs.
 * No page count limit is enforced here — an oversized document is instead
 * automatically bounded by the max-job ceiling (never a fabricated
 * discount, and never an unbounded charge). */
export function calculateDocumentUsage(
  pages: DocumentPageUsageMetrics[]
): DocumentUsageCalculation {
  const page_costs: DocumentPageCost[] = pages.map((page) => {
    const tier = tierForPage(page);
    const priceUsd = resolveServiceMaxPriceUsd(pricingKeyForTier(tier));
    return { page_number: page.page_number, tier, price_usd_micro: usdToMicro(priceUsd) };
  });

  const subtotal_usd_micro = page_costs.reduce((sum, p) => sum + p.price_usd_micro, 0);
  const max_job_usd_micro = usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_max_job'));
  const capped = subtotal_usd_micro > max_job_usd_micro;
  const total_usd_micro = capped ? max_job_usd_micro : subtotal_usd_micro;

  return { page_costs, subtotal_usd_micro, max_job_usd_micro, total_usd_micro, capped };
}

/** Converts a usage calculation's total (already an integer count of
 * micro-USD) into the atomic-unit integer string an `upto` settlement's
 * actual amount requires — pure integer arithmetic throughout, never a
 * float division/toFixed round-trip through a decimal string. Mirrors
 * @siteborne/pricing's `usdToAtomicUnits` scaling rule exactly, but
 * starting from an already-integer micro-USD value instead of a decimal
 * string, so no precision can be lost converting between the two. */
export function documentUsageToAtomicUnits(
  calculation: DocumentUsageCalculation,
  assetDecimals: number
): string {
  const micro = calculation.total_usd_micro;
  if (assetDecimals === 6) return String(micro);
  if (assetDecimals > 6) return String(micro * 10 ** (assetDecimals - 6));
  const divisor = 10 ** (6 - assetDecimals);
  return String(Math.floor(micro / divisor));
}
