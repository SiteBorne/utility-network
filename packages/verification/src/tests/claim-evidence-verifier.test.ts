import { describe, expect, it } from 'vitest';
import { ClaimEvidenceVerifier } from '../verifiers/claim-evidence-verifier';
import { buildContext, createTestClock } from '../context';
import { validCandidate } from './fixtures';

describe('ClaimEvidenceVerifier', () => {
  const verifier = new ClaimEvidenceVerifier();

  it('passes when every material claim has supporting evidence', async () => {
    const context = buildContext({ clock: createTestClock() });
    const result = await verifier.verify(validCandidate(), context);
    expect(result.status).toBe('pass');
  });

  it('fails closed on a material claim with zero evidence_ids', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.claims[0].evidence_ids = [];
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'unsupported_material_claim')).toBe(true);
  });

  it('fails closed on a verified_absent claim with no absence-proof evidence', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.claims.push({
      claim_id: 'clm_absentnoevidence0000aaaa',
      evidence_ids: [],
      verified_absent: true,
    });
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'verified_absent_without_evidence')).toBe(true);
  });

  it('passes a verified_absent claim that does cite absence-proof evidence', async () => {
    const context = buildContext({ clock: createTestClock() });
    const candidate = validCandidate();
    candidate.claims.push({
      claim_id: 'clm_absentwithevidence00aaaa',
      evidence_ids: ['evd_verificationfixture01aaa'],
      verified_absent: true,
    });
    const result = await verifier.verify(candidate, context);
    expect(result.status).toBe('pass');
  });
});
