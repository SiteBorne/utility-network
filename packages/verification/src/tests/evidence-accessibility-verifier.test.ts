import { describe, expect, it } from 'vitest';
import { EvidenceAccessibilityVerifier } from '../verifiers/evidence-accessibility-verifier';
import { buildContext, createTestClock } from '../context';
import { validCandidate } from './fixtures';

describe('EvidenceAccessibilityVerifier', () => {
  const verifier = new EvidenceAccessibilityVerifier();

  it('passes when every referenced evidence item is accessible', async () => {
    const context = buildContext({ clock: createTestClock() });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('pass');
  });

  it('fails closed when evidence has a disqualifying result_class, even though it is otherwise well-formed', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.evidence[0].result_class = 'source_changed';
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('blocking');
    expect(result.findings.some((f) => f.code === 'evidence_disqualified')).toBe(true);
  });

  it('fails closed when evidence has no locator', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    delete candidate.evidence[0].locator;
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'evidence_no_locator')).toBe(true);
  });

  it('fails closed when a claim references an evidence_id that does not exist', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.claims[0].evidence_ids = ['evd_doesnotexist000000000000'];
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'claim_references_missing_evidence')).toBe(true);
  });

  it('only warns (not blocking) on a missing content_hash', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    delete candidate.evidence[0].content_hash;
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('pass');
    expect(
      result.findings.some((f) => f.code === 'evidence_no_hash' && f.severity === 'warning')
    ).toBe(true);
  });
});
