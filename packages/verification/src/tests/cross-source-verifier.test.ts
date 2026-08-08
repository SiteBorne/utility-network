import { describe, expect, it } from 'vitest';
import { CrossSourceVerifier } from '../verifiers/cross-source-verifier';
import { buildContext, createTestClock } from '../context';
import { validCandidate } from './fixtures';

describe('CrossSourceVerifier', () => {
  const verifier = new CrossSourceVerifier();

  it('scores 1.0 (vacuous pass) when no claim has more than one evidence item', async () => {
    const context = buildContext({ clock: createTestClock() });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.score).toBe(1);
    expect(result.status).toBe('pass');
  });

  it('flags conflicting sibling claims for the same subject/predicate as warnings, not blocking', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.claims[0].subject = 'doc';
    candidate.claims[0].predicate = 'page_count';
    candidate.claims[0].evidence_ids = [
      'evd_verificationfixture01aaa',
      'evd_second00000000000000aaa',
    ];
    candidate.evidence.push({
      evidence_id: 'evd_second00000000000000aaa',
      locator: { type: 'byte_range', value: '0-10' },
      content_hash: 'sha256:' + 'b'.repeat(64),
      retrieved_at: candidate.evidence[0].retrieved_at,
      result_class: 'success',
    });
    candidate.claims.push({
      claim_id: 'clm_conflicting0000000000aaa',
      subject: 'doc',
      predicate: 'page_count',
      value: 999,
      evidence_ids: ['evd_second00000000000000aaa'],
    });
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('pass'); // cross-source disagreement is informational, never blocking on its own
    expect(result.findings.some((f) => f.code === 'cross_source_disagreement')).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.score).toBeLessThan(1);
  });
});
