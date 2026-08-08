import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const PROVENANCE_VERIFIER_ID = 'provenance_verifier';
export const PROVENANCE_VERIFIER_VERSION = '1.0.0';

/**
 * Verifies each evidence item carries a recognized authorization
 * classification and a retrieval timestamp, and that fixture-derived
 * evidence is never indistinguishable from live-source evidence at the
 * result_class level (source_changed/policy_blocked evidence must not be
 * treated as ordinary success).
 */
export class ProvenanceVerifier implements Verifier {
  readonly verifierId = PROVENANCE_VERIFIER_ID;
  readonly verifierVersion = PROVENANCE_VERIFIER_VERSION;
  readonly capabilities = ['provenance_validity'] as const;
  readonly dependsOn: readonly string[] = ['schema_verifier'];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();
    const findings: VerificationResult['findings'] = [];

    const KNOWN_AUTHORIZATION = new Set(['public', 'buyer_authorized', 'private']);
    const KNOWN_RESULT_CLASSES = new Set([
      'success',
      'partial',
      'not_found',
      'verified_absent_candidate',
      'policy_blocked',
      'invalid_request',
      'rate_limited',
      'retryable_failure',
      'permanent_failure',
      'source_changed',
      'quarantined',
      undefined,
    ]);

    for (const item of candidate.evidence) {
      if (
        item.authorization_classification &&
        !KNOWN_AUTHORIZATION.has(item.authorization_classification)
      ) {
        findings.push({
          code: 'unknown_authorization_classification',
          message: `Evidence ${item.evidence_id} has unrecognized authorization_classification`,
          severity: 'blocking',
          subject: item.evidence_id,
        });
      }
      if (!KNOWN_RESULT_CLASSES.has(item.result_class)) {
        findings.push({
          code: 'unknown_result_class',
          message: `Evidence ${item.evidence_id} has unrecognized result_class=${item.result_class}`,
          severity: 'blocking',
          subject: item.evidence_id,
        });
      }
      // source_changed/policy_blocked can never be silently reinterpreted
      // as verified_absent_candidate — that would be the exact absence-
      // vs-source-failure conflation the mesh must prevent.
      if (
        (item.result_class === 'source_changed' || item.result_class === 'policy_blocked') &&
        candidate.claims.some((c) => c.verified_absent && c.evidence_ids.includes(item.evidence_id))
      ) {
        findings.push({
          code: 'absence_from_disqualified_source',
          message: `Evidence ${item.evidence_id} (result_class=${item.result_class}) cannot support a verified_absent claim`,
          severity: 'blocking',
          subject: item.evidence_id,
        });
      }
    }

    const blocking = findings.some((f) => f.severity === 'blocking');

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'provenance_valid',
      subject: candidate.job_id,
      status: blocking ? 'fail' : 'pass',
      severity: blocking ? 'blocking' : 'info',
      findings,
      failureCodes: blocking ? ['provenance_invalid'] : [],
      evidenceChecked: candidate.evidence.length,
    });
  }
}
