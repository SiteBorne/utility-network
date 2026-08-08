import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const COMPLETENESS_VERIFIER_ID = 'completeness_verifier';
export const COMPLETENESS_VERIFIER_VERSION = '1.0.0';

/**
 * Recomputes the frozen PCC completeness score (supported_fields /
 * requested_fields) from the candidate's own declared completeness block
 * and cross-checks it is not overstated. A candidate must not claim full
 * completeness if any evidence item failed, a document page failed, or a
 * mandatory verifier upstream failed — those signals are passed in via the
 * evidence result_classes / disqualifying findings, not re-derived here.
 */
export class CompletenessVerifier implements Verifier {
  readonly verifierId = COMPLETENESS_VERIFIER_ID;
  readonly verifierVersion = COMPLETENESS_VERIFIER_VERSION;
  readonly capabilities = ['completeness'] as const;
  readonly dependsOn: readonly string[] = ['evidence_accessibility_verifier'];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();
    const c = candidate.completeness;
    const findings: VerificationResult['findings'] = [];

    if (!c) {
      return buildResult(candidate, context, startedAt, {
        verifierId: this.verifierId,
        verifierVersion: this.verifierVersion,
        ruleId: 'completeness_missing',
        subject: candidate.job_id,
        status: 'indeterminate',
        severity: 'warning',
        warnings: ['candidate did not declare a completeness block'],
        score: 0,
      });
    }

    if (c.requested_fields < 0 || c.populated_fields < 0 || c.supported_fields < 0) {
      findings.push({
        code: 'negative_field_count',
        message: 'completeness field counts must be non-negative',
        severity: 'blocking',
      });
    }
    if (c.supported_fields > c.populated_fields || c.populated_fields > c.requested_fields) {
      findings.push({
        code: 'inconsistent_completeness_counts',
        message: `supported (${c.supported_fields}) <= populated (${c.populated_fields}) <= requested (${c.requested_fields}) violated`,
        severity: 'blocking',
      });
    }

    // A field disqualified by an evidence-inaccessibility finding cannot
    // simultaneously count as "supported" — the candidate's own declared
    // missing_fields must be consistent with disqualified evidence.
    const disqualifiedEvidenceIds = new Set(
      candidate.evidence
        .filter((e) =>
          ['source_changed', 'policy_blocked', 'quarantined'].includes(e.result_class ?? '')
        )
        .map((e) => e.evidence_id)
    );
    const claimsBackedByDisqualifiedEvidence = candidate.claims.filter((claim) =>
      claim.evidence_ids.some((id) => disqualifiedEvidenceIds.has(id))
    );
    if (claimsBackedByDisqualifiedEvidence.length > 0 && c.missing_fields.length === 0) {
      findings.push({
        code: 'completeness_overstated',
        message: `${claimsBackedByDisqualifiedEvidence.length} claim(s) rely on disqualified evidence but missing_fields is empty`,
        severity: 'blocking',
      });
    }

    const score = c.requested_fields === 0 ? 1 : c.supported_fields / c.requested_fields;
    const blocking = findings.some((f) => f.severity === 'blocking');

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'completeness_consistency',
      subject: candidate.job_id,
      status: blocking ? 'fail' : 'pass',
      severity: blocking ? 'blocking' : 'info',
      findings,
      failureCodes: blocking ? ['completeness_inconsistent'] : [],
      score,
    });
  }
}
