import { describe, expect, it } from 'vitest';
import { FreshnessVerifier } from '../verifiers/freshness-verifier';
import { buildContext, createAdvanceableTestClock } from '../context';
import { validCandidate, now } from './fixtures';

describe('FreshnessVerifier', () => {
  const verifier = new FreshnessVerifier();

  it('scores 1.0 when evidence is within the freshness requirement', async () => {
    const clock = createAdvanceableTestClock(Date.parse(now));
    const context = buildContext({ clock });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.score).toBe(1);
  });

  it('scores stale evidence as 0, never assuming freshness by default', async () => {
    const clock = createAdvanceableTestClock(Date.parse(now) + 48 * 60 * 60 * 1000); // +48h, requirement is 24h
    const context = buildContext({ clock });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.score).toBe(0);
    expect(result.warnings.some((w) => w.includes('stale'))).toBe(true);
  });

  it('scores evidence with no retrieved_at as stale, not fresh-by-default', async () => {
    const clock = createAdvanceableTestClock(Date.parse(now));
    const context = buildContext({ clock });
    const candidate = validCandidate();
    delete candidate.evidence[0].retrieved_at;
    const result = await verifier.verify(candidate, context);
    expect(result.score).toBe(0);
    expect(result.warnings.some((w) => w.includes('no retrieved_at'))).toBe(true);
  });

  it('scores 1.0 (vacuously) with no evidence at all', async () => {
    const clock = createAdvanceableTestClock(Date.parse(now));
    const context = buildContext({ clock });
    const candidate = validCandidate({ evidence: [] });
    const result = await verifier.verify(candidate, context);
    expect(result.score).toBe(1);
  });
});
