/**
 * METADATA-VCM-06 §XXIII: four bounded structured-log counters, best-effort
 * and never authoritative over served output (§XXI: an observability
 * failure must never take down static machine metadata).
 */
import { describe, expect, it, vi } from 'vitest';
import { recordMetadataProjectionComparison } from './metadata-projection-telemetry';

describe('recordMetadataProjectionComparison', () => {
  it('emits compare_total and match_total on a clean match', () => {
    // This repo's lint rule permits only console.warn/console.error --
    // every structured log line here goes through console.error, matching
    // the repo-wide convention (see the module's own doc comment).
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    recordMetadataProjectionComparison({
      surface: 'a2a',
      differenceSummary: {
        EXACT_MATCH: 10,
        NORMALIZED_MATCH: 0,
        EXPECTED_VOLATILE_DIFFERENCE: 0,
        INTENTIONAL_GOVERNED_DIFFERENCE: 1,
        UNEXPLAINED_DIFFERENCE: 0,
      },
      fellBackToLegacy: false,
    });
    const lines = spy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(
      lines.some((l) => l.event === 'metadata_projection_compare_total' && l.surface === 'a2a')
    ).toBe(true);
    expect(
      lines.some((l) => l.event === 'metadata_projection_match_total' && l.surface === 'a2a')
    ).toBe(true);
    expect(lines.some((l) => l.event === 'metadata_projection_mismatch_total')).toBe(false);
    expect(lines.some((l) => l.event === 'metadata_projection_fallback_total')).toBe(false);
    spy.mockRestore();
  });

  it('emits mismatch_total with a domain on an unexplained difference, never the raw payload', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    recordMetadataProjectionComparison({
      surface: 'mcp',
      differenceSummary: {
        EXACT_MATCH: 5,
        NORMALIZED_MATCH: 0,
        EXPECTED_VOLATILE_DIFFERENCE: 0,
        INTENTIONAL_GOVERNED_DIFFERENCE: 0,
        UNEXPLAINED_DIFFERENCE: 2,
      },
      fellBackToLegacy: true,
    });
    const lines = spy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const mismatch = lines.find((l) => l.event === 'metadata_projection_mismatch_total');
    expect(mismatch).toBeDefined();
    expect(mismatch.surface).toBe('mcp');
    expect(mismatch.domain).toBe('static_semantic');
    expect(mismatch.differenceCount).toBe(2);
    const fallback = lines.find((l) => l.event === 'metadata_projection_fallback_total');
    expect(fallback).toBeDefined();
    expect(fallback.surface).toBe('mcp');
    // no full projection content anywhere in any emitted line
    for (const line of lines) {
      expect(JSON.stringify(line)).not.toMatch(/skills|tools|inputSchema|outputSchema/);
    }
    spy.mockRestore();
  });

  it('never throws even if console logging itself throws (best-effort, non-blocking)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('logging backend unavailable');
    });
    expect(() =>
      recordMetadataProjectionComparison({
        surface: 'a2a',
        differenceSummary: {
          EXACT_MATCH: 1,
          NORMALIZED_MATCH: 0,
          EXPECTED_VOLATILE_DIFFERENCE: 0,
          INTENTIONAL_GOVERNED_DIFFERENCE: 0,
          UNEXPLAINED_DIFFERENCE: 0,
        },
        fellBackToLegacy: false,
      })
    ).not.toThrow();
    spy.mockRestore();
  });
});
