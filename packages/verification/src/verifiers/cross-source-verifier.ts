import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const CROSS_SOURCE_VERIFIER_ID = 'cross_source_verifier';
export const CROSS_SOURCE_VERIFIER_VERSION = '1.0.0';

/**
 * For claims backed by more than one evidence item, checks the evidence
 * items agree (deterministic value-equality where the claim carries a
 * concrete `value`). Claims with a single evidence item are not scored
 * (nothing to cross-check) and do not lower the agreement score.
 */
export class CrossSourceVerifier implements Verifier {
  readonly verifierId = CROSS_SOURCE_VERIFIER_ID;
  readonly verifierVersion = CROSS_SOURCE_VERIFIER_VERSION;
  readonly capabilities = ['cross_source_agreement'] as const;
  readonly dependsOn: readonly string[] = ['claim_evidence_verifier'];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();
    const findings: VerificationResult['findings'] = [];

    const multiSourceClaims = candidate.claims.filter(
      (c) => c.evidence_ids.length > 1 && c.value !== undefined
    );
    let agreeing = 0;

    for (const claim of multiSourceClaims) {
      // In this closed candidate model there is one value per claim (not
      // per evidence item), so "agreement" here validates that a
      // multi-source claim's value is a defined, stable primitive rather
      // than conflicting values smuggled in via separate claim entries for
      // the same subject/predicate pair.
      const conflictingSiblings = candidate.claims.filter(
        (other) =>
          other.claim_id !== claim.claim_id &&
          other.subject === claim.subject &&
          other.predicate === claim.predicate &&
          JSON.stringify(other.value) !== JSON.stringify(claim.value)
      );
      if (conflictingSiblings.length > 0) {
        findings.push({
          code: 'cross_source_disagreement',
          message: `Claim ${claim.claim_id} (${claim.subject}/${claim.predicate}) conflicts with ${conflictingSiblings.length} other claim(s)`,
          severity: 'warning',
          subject: claim.claim_id,
        });
      } else {
        agreeing++;
      }
    }

    const score = multiSourceClaims.length === 0 ? 1 : agreeing / multiSourceClaims.length;

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'cross_source_agreement',
      subject: candidate.job_id,
      status: 'pass',
      severity: findings.length > 0 ? 'warning' : 'info',
      findings,
      claimsChecked: multiSourceClaims.length,
      score,
    });
  }
}
