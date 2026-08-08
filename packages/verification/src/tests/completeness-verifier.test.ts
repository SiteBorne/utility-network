import { describe, expect, it } from 'vitest';
import { CompletenessVerifier } from '../verifiers/completeness-verifier';
import { buildContext, createTestClock } from '../context';
import { validCandidate } from './fixtures';

describe('CompletenessVerifier', () => {
  const verifier = new CompletenessVerifier();

  it('passes and scores correctly for a consistent completeness block', async () => {
    const context = buildContext({ clock: createTestClock() });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('pass');
    expect(result.score).toBe(1);
  });

  it('is indeterminate (not pass) when the candidate omits a completeness block', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate({ completeness: undefined });
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('indeterminate');
  });

  it('fails closed when supported_fields exceeds populated_fields', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate({
      completeness: {
        requested_fields: 4,
        populated_fields: 2,
        supported_fields: 3,
        missing_fields: [],
      },
    });
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'inconsistent_completeness_counts')).toBe(true);
  });

  it('fails closed when a claim relies on disqualified evidence but missing_fields is empty (overstated completeness)', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.evidence[0].result_class = 'source_changed';
    // claims[0] cites this evidence_id, and completeness.missing_fields stays [].
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'completeness_overstated')).toBe(true);
  });
});
