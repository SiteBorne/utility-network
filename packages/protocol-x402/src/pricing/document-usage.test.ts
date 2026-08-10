import { describe, expect, it } from 'vitest';
import { usdToMicro } from '@siteborne/pricing';
import { resolveServiceMaxPriceUsd } from './mapping';
import { calculateDocumentUsage, documentUsageToAtomicUnits } from './document-usage';
import type { DocumentPageUsageMetrics } from './document-usage';

describe('calculateDocumentUsage', () => {
  it('prices a single native-text page at the native rate', () => {
    const pages: DocumentPageUsageMetrics[] = [{ page_number: 1, ocr_used: false, table_count: 0 }];
    const result = calculateDocumentUsage(pages);
    expect(result.page_costs).toEqual([
      {
        page_number: 1,
        tier: 'native',
        price_usd_micro: usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_native')),
      },
    ]);
    expect(result.capped).toBe(false);
  });

  it('prices a single OCR page at the ocr rate', () => {
    const pages: DocumentPageUsageMetrics[] = [{ page_number: 1, ocr_used: true, table_count: 0 }];
    const result = calculateDocumentUsage(pages);
    expect(result.page_costs[0]!.tier).toBe('ocr');
    expect(result.page_costs[0]!.price_usd_micro).toBe(
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_ocr'))
    );
  });

  it('prices a page with a table at the table rate, even if it also used OCR', () => {
    const pages: DocumentPageUsageMetrics[] = [{ page_number: 1, ocr_used: true, table_count: 2 }];
    const result = calculateDocumentUsage(pages);
    expect(result.page_costs[0]!.tier).toBe('table');
  });

  it('sums multi-page combinations before capping', () => {
    const pages: DocumentPageUsageMetrics[] = [
      { page_number: 1, ocr_used: false, table_count: 0 }, // native
      { page_number: 2, ocr_used: true, table_count: 0 }, // ocr
      { page_number: 3, ocr_used: false, table_count: 1 }, // table
    ];
    const result = calculateDocumentUsage(pages);
    const expectedSubtotal =
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_native')) +
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_ocr')) +
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_table'));
    expect(result.subtotal_usd_micro).toBe(expectedSubtotal);
  });

  it('caps a large document at document_evidence_json_max_job, never charging above the ceiling', () => {
    const pages: DocumentPageUsageMetrics[] = Array.from({ length: 50 }, (_, i) => ({
      page_number: i + 1,
      ocr_used: false,
      table_count: 1, // table tier every page — deliberately maximal
    }));
    const result = calculateDocumentUsage(pages);
    const maxJobMicro = usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_max_job'));
    expect(result.subtotal_usd_micro).toBeGreaterThan(maxJobMicro);
    expect(result.capped).toBe(true);
    expect(result.total_usd_micro).toBe(maxJobMicro);
  });

  it('an empty page set produces zero cost, uncapped', () => {
    const result = calculateDocumentUsage([]);
    expect(result.total_usd_micro).toBe(0);
    expect(result.capped).toBe(false);
  });

  it('is deterministic: identical page metrics always produce identical costs', () => {
    const pages: DocumentPageUsageMetrics[] = [{ page_number: 1, ocr_used: true, table_count: 0 }];
    const a = calculateDocumentUsage(pages);
    const b = calculateDocumentUsage(pages);
    expect(a).toEqual(b);
  });
});

describe('documentUsageToAtomicUnits', () => {
  it('converts a total to 6-decimal atomic units without a float round-trip', () => {
    const pages: DocumentPageUsageMetrics[] = [{ page_number: 1, ocr_used: false, table_count: 0 }];
    const calc = calculateDocumentUsage(pages);
    const atomic = documentUsageToAtomicUnits(calc, 6);
    expect(atomic).toBe(String(calc.total_usd_micro));
  });

  it('converts a zero-cost calculation to "0"', () => {
    const calc = calculateDocumentUsage([]);
    expect(documentUsageToAtomicUnits(calc, 6)).toBe('0');
  });
});
