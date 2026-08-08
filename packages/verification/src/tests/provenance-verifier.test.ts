import { describe, expect, it } from 'vitest';
import { ProvenanceVerifier } from '../verifiers/provenance-verifier';
import { buildContext, createTestClock } from '../context';
import { validCandidate } from './fixtures';

describe('ProvenanceVerifier', () => {
  const verifier = new ProvenanceVerifier();

  it('passes for evidence with known classifications and result classes', async () => {
    const context = buildContext({ clock: createTestClock() });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('pass');
  });

  it('fails closed on an unrecognized authorization_classification', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    // @ts-expect-error deliberately invalid for the test
    candidate.evidence[0].authorization_classification = 'made_up_classification';
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'unknown_authorization_classification')).toBe(
      true
    );
  });

  it('fails closed on an unrecognized result_class', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.evidence[0].result_class = 'not_a_real_result_class';
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'unknown_result_class')).toBe(true);
  });

  it('fails closed when source_changed evidence backs a verified_absent claim (absence-vs-failure conflation)', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.evidence[0].result_class = 'source_changed';
    candidate.claims[0].verified_absent = true;
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'absence_from_disqualified_source')).toBe(true);
  });
});
