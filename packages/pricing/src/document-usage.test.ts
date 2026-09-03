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
    // SUN-1222C-R3: calculateDocumentUsage resolves the dedicated v2 tier
    // keys (document_evidence_json.v2 is the only real production executor
    // for this service — see packages/pricing/src/document-usage.ts).
    const expected =
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_native_v2')) +
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_ocr_v2')) +
      usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_table_v2'));
    const maximum = usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_max_job'));

    expect(usage.subtotal_usd_micro).toBe(expected);
    expect(usage.total_usd_micro).toBe(expected);
    expect(usage.total_usd_micro).toBeLessThan(maximum);
    expect(documentUsageToAtomicUnits(usage, 6)).toBe(String(expected));
  });

  it('SUN-1222C-R3 (was SUN-0900B checkpoint 2A): single native page settles exactly 9800 atomic v2 experiment price (dynamic PAYG matrix item A)', () => {
    const usage = calculateDocumentUsage([{ page_number: 1, ocr_used: false, table_count: 0 }]);
    expect(documentUsageToAtomicUnits(usage, 6)).toBe('9800');
    expect(usage.capped).toBe(false);
  });

  it('SUN-1222C-R3 (was SUN-0900B checkpoint 2A): single OCR page settles exactly 15600 atomic v2 experiment price (dynamic PAYG matrix item B)', () => {
    const usage = calculateDocumentUsage([{ page_number: 1, ocr_used: true, table_count: 0 }]);
    expect(documentUsageToAtomicUnits(usage, 6)).toBe('15600');
    expect(usage.capped).toBe(false);
  });

  it('SUN-1222C-R3 (was SUN-0900B checkpoint 2A): single table page settles exactly 23800 atomic v2 experiment price (dynamic PAYG matrix item C)', () => {
    const usage = calculateDocumentUsage([{ page_number: 1, ocr_used: false, table_count: 1 }]);
    expect(documentUsageToAtomicUnits(usage, 6)).toBe('23800');
    expect(usage.capped).toBe(false);
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

  it('SUN-1222C-R3 (was SUN-0900B checkpoint 2I): thirteen measured OCR pages exceed and cap at the unchanged 190000 maximum', () => {
    // At the v2 experiment OCR rate (15600/page), 10 pages no longer lands
    // exactly on the 190000 ceiling (156000 < 190000) — 13 pages does
    // (202800 > 190000), exercising the same cap behavior this fixture
    // originally proved.
    const usage = calculateDocumentUsage(
      Array.from({ length: 13 }, (_, index) => ({
        page_number: index + 1,
        ocr_used: true,
        table_count: 0,
      }))
    );

    expect(usage.page_costs).toHaveLength(13);
    expect(usage.page_costs.every((page) => page.tier === 'ocr')).toBe(true);
    expect(usage.subtotal_usd_micro).toBe(202800);
    expect(usage.max_job_usd_micro).toBe(190000);
    expect(usage.total_usd_micro).toBe(190000);
    expect(usage.capped).toBe(true);
    expect(documentUsageToAtomicUnits(usage, 6)).toBe('190000');
  });
});
