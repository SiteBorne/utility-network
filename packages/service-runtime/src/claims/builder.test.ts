import { describe, expect, it } from 'vitest';
import { buildClaim, buildVerifiedAbsentClaim } from './builder';

describe('buildClaim', () => {
  it('produces a deterministic claim_id for the same seed', () => {
    const a = buildClaim({ seed: 'x', predicate: 'p', value: 1, confidence: 1, evidenceIds: [] });
    const b = buildClaim({ seed: 'x', predicate: 'p', value: 1, confidence: 1, evidenceIds: [] });
    expect(a.claim_id).toBe(b.claim_id);
    expect(a.claim_id).toMatch(/^clm_[a-z0-9]{24}$/);
  });
});

describe('buildVerifiedAbsentClaim', () => {
  it('refuses to build a verified-absent claim with zero absence-proof evidence', () => {
    expect(() =>
      buildVerifiedAbsentClaim({ seed: 'x', predicate: 'p', absenceEvidenceIds: [] })
    ).toThrowError(/requires at least one absence-proof evidence_id/);
  });

  it('builds a well-formed claim when absence-proof evidence is supplied', () => {
    const claim = buildVerifiedAbsentClaim({
      seed: 'x',
      predicate: 'no_match_found',
      absenceEvidenceIds: ['evd_' + '0'.repeat(24)],
    });
    expect(claim.value).toBe(false);
    expect(claim.evidence_ids).toEqual(['evd_' + '0'.repeat(24)]);
  });
});
