import { describe, expect, it } from 'vitest';
import {
  calculateDocumentUsage,
  documentUsageToAtomicUnits,
  resolveServiceMaxPriceUsd,
  usdToMicro,
} from './index';

describe('document usage pricing authority', () => {
  it('calculates deterministic mixed-page actual usage below the canonical maximum', () => {
    const usage = calculateDocumentUsage([
      { page_number: 1, ocr_used: false, table_count: 0 },
      { page_number: 2, ocr_used: true, table_count: 0 },
      { page_number: 3, ocr_used: false, table_count: 1 },
    ]);
    const expected =
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_native')) +
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_ocr')) +
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_table'));
    const maximum = usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_max_job'));

    expect(usage.subtotal_usd_micro).toBe(expected);
    expect(usage.total_usd_micro).toBe(expected);
    expect(usage.total_usd_micro).toBeLessThan(maximum);
    expect(documentUsageToAtomicUnits(usage, 6)).toBe(String(expected));
  });

  it('caps measured usage at the canonical maximum without exceeding it', () => {
    const usage = calculateDocumentUsage(
      Array.from({ length: 50 }, (_, index) => ({
        page_number: index + 1,
        ocr_used: true,
        table_count: 1,
      }))
    );
    const maximum = usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_max_job'));

    expect(usage.subtotal_usd_micro).toBeGreaterThan(maximum);
    expect(usage.total_usd_micro).toBe(maximum);
    expect(usage.capped).toBe(true);
  });
});
