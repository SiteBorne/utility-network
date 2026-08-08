import { describe, expect, it } from 'vitest';
import { ReproductionVerifier } from '../verifiers/reproduction-verifier';
import { buildContext, createTestClock } from '../context';
import { validCandidate } from './fixtures';

describe('ReproductionVerifier', () => {
  it('is skipped_by_policy in standard mode, not silently passed', async () => {
    const verifier = new ReproductionVerifier(null);
    const context = buildContext({ clock: createTestClock(), mode: 'standard' });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('skipped_by_policy');
  });

  it('fails closed in independent_reproduction mode when no reproduction input is supplied (never falls back to standard)', async () => {
    const verifier = new ReproductionVerifier(null);
    const context = buildContext({ clock: createTestClock(), mode: 'independent_reproduction' });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('blocking');
    expect(result.failure_codes).toContain('reproduction_unavailable');
  });

  it('passes when the reproduced claim values match', async () => {
    const verifier = new ReproductionVerifier({
      claims: [{ claim_id: 'clm_verificationfixture01aaa', value: 24 }],
    });
    const context = buildContext({ clock: createTestClock(), mode: 'independent_reproduction' });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('pass');
    expect(result.score).toBe(1);
  });

  it('fails closed when the reproduced claim value disagrees with the candidate', async () => {
    const verifier = new ReproductionVerifier({
      claims: [{ claim_id: 'clm_verificationfixture01aaa', value: 999 }],
    });
    const context = buildContext({ clock: createTestClock(), mode: 'independent_reproduction' });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'reproduction_mismatch')).toBe(true);
  });
});
