import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const EVIDENCE_ACCESSIBILITY_VERIFIER_ID = 'evidence_accessibility_verifier';
export const EVIDENCE_ACCESSIBILITY_VERIFIER_VERSION = '1.0.0';
const SCHEMA_DEP = 'schema_verifier';

/**
 * Verifies every evidence item referenced by a claim is itself present,
 * has a resolvable locator, and was not obtained from a source in a
 * disqualifying result_class (source_changed / policy_blocked /
 * quarantined must never be silently treated as accessible evidence).
 */
export class EvidenceAccessibilityVerifier implements Verifier {
  readonly verifierId = EVIDENCE_ACCESSIBILITY_VERIFIER_ID;
  readonly verifierVersion = EVIDENCE_ACCESSIBILITY_VERIFIER_VERSION;
  readonly capabilities = ['evidence_accessibility'] as const;
  readonly dependsOn: readonly string[] = [SCHEMA_DEP];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();
    const evidenceById = new Map(candidate.evidence.map((e) => [e.evidence_id, e]));

    const DISQUALIFYING = new Set([
      'source_changed',
      'policy_blocked',
      'quarantined',
      'retryable_failure',
      'permanent_failure',
    ]);

    let accessibleCount = 0;
    let checkedCount = 0;
    const findings: VerificationResult['findings'] = [];

    for (const item of candidate.evidence) {
      checkedCount++;
      if (item.result_class && DISQUALIFYING.has(item.result_class)) {
        findings.push({
          code: 'evidence_disqualified',
          message: `Evidence ${item.evidence_id} has disqualifying result_class=${item.result_class}`,
          severity: 'blocking',
          subject: item.evidence_id,
        });
        continue;
      }
      if (!item.locator) {
        findings.push({
          code: 'evidence_no_locator',
          message: `Evidence ${item.evidence_id} has no locator`,
          severity: 'blocking',
          subject: item.evidence_id,
        });
        continue;
      }
      if (!item.content_hash) {
        findings.push({
          code: 'evidence_no_hash',
          message: `Evidence ${item.evidence_id} has no content_hash`,
          severity: 'warning',
          subject: item.evidence_id,
        });
      }
      accessibleCount++;
    }

    // Every claim must reference evidence that actually exists.
    for (const claim of candidate.claims) {
      for (const evidenceId of claim.evidence_ids) {
        if (!evidenceById.has(evidenceId)) {
          findings.push({
            code: 'claim_references_missing_evidence',
            message: `Claim ${claim.claim_id} references unknown evidence_id ${evidenceId}`,
            severity: 'blocking',
            subject: claim.claim_id,
          });
        }
      }
    }

    const accessibilityRatio = checkedCount === 0 ? 1 : accessibleCount / checkedCount;
    const blocking = findings.some((f) => f.severity === 'blocking');

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'evidence_accessibility',
      subject: candidate.job_id,
      status: blocking ? 'fail' : 'pass',
      severity: blocking ? 'blocking' : 'info',
      evidenceChecked: checkedCount,
      findings,
      failureCodes: blocking ? ['evidence_inaccessible'] : [],
      evidenceHashes: candidate.evidence
        .map((e) => e.content_hash)
        .filter((h): h is string => Boolean(h)),
      limitations: [`evidence_accessibility_ratio=${accessibilityRatio.toFixed(3)}`],
    });
  }
}
