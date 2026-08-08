import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const CLAIM_EVIDENCE_VERIFIER_ID = 'claim_evidence_verifier';
export const CLAIM_EVIDENCE_VERIFIER_VERSION = '1.0.0';

/**
 * Verifies every material (non-verified_absent) claim has at least one
 * supporting evidence_id, and every verified_absent claim satisfies its
 * special evidence policy (must itself carry evidence demonstrating an
 * authoritative absence check, not merely zero evidence items). Never
 * infers support from semantic similarity — evidence_ids must be present.
 */
export class ClaimEvidenceVerifier implements Verifier {
  readonly verifierId = CLAIM_EVIDENCE_VERIFIER_ID;
  readonly verifierVersion = CLAIM_EVIDENCE_VERIFIER_VERSION;
  readonly capabilities = ['claim_evidence_alignment'] as const;
  readonly dependsOn: readonly string[] = ['evidence_accessibility_verifier'];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();
    const findings: VerificationResult['findings'] = [];
    let claimsChecked = 0;

    for (const claim of candidate.claims) {
      claimsChecked++;
      if (claim.verified_absent) {
        if (claim.evidence_ids.length === 0) {
          findings.push({
            code: 'verified_absent_without_evidence',
            message: `Claim ${claim.claim_id} is verified_absent but cites no absence-proof evidence`,
            severity: 'blocking',
            subject: claim.claim_id,
          });
        }
        continue;
      }
      if (claim.evidence_ids.length === 0) {
        findings.push({
          code: 'unsupported_material_claim',
          message: `Claim ${claim.claim_id} has no supporting evidence`,
          severity: 'blocking',
          subject: claim.claim_id,
        });
      }
    }

    const blocking = findings.some((f) => f.severity === 'blocking');

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'material_claims_supported',
      subject: candidate.job_id,
      status: blocking ? 'fail' : 'pass',
      severity: blocking ? 'blocking' : 'info',
      claimsChecked,
      findings,
      failureCodes: blocking ? ['unsupported_claim'] : [],
    });
  }
}
