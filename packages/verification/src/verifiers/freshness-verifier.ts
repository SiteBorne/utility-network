import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const FRESHNESS_VERIFIER_ID = 'freshness_verifier';
export const FRESHNESS_VERIFIER_VERSION = '1.0.0';

/**
 * Computes a [0,1] freshness score from each evidence item's retrieved_at
 * relative to the candidate's freshness_requirement_ms (or a policy
 * default). "not observed" (no retrieved_at) is scored as stale, never
 * as fresh-by-default — freshness must never be assumed.
 */
export class FreshnessVerifier implements Verifier {
  readonly verifierId = FRESHNESS_VERIFIER_ID;
  readonly verifierVersion = FRESHNESS_VERIFIER_VERSION;
  readonly capabilities = ['freshness'] as const;
  readonly dependsOn: readonly string[] = ['schema_verifier'];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();
    const requirementMs = candidate.freshness_requirement_ms ?? 24 * 60 * 60 * 1000;
    const nowMs = context.clock.nowMs();

    let freshCount = 0;
    let scored = 0;
    const findings: VerificationResult['findings'] = [];
    const warnings: string[] = [];

    for (const item of candidate.evidence) {
      scored++;
      if (!item.retrieved_at) {
        warnings.push(`Evidence ${item.evidence_id} has no retrieved_at — scored stale`);
        continue;
      }
      const ageMs = nowMs - Date.parse(item.retrieved_at);
      if (Number.isNaN(ageMs)) {
        findings.push({
          code: 'invalid_retrieved_at',
          message: `Evidence ${item.evidence_id} has an unparseable retrieved_at`,
          severity: 'warning',
          subject: item.evidence_id,
        });
        continue;
      }
      if (ageMs <= requirementMs) freshCount++;
      else
        warnings.push(
          `Evidence ${item.evidence_id} is stale (age ${ageMs}ms > requirement ${requirementMs}ms)`
        );
    }

    const score = scored === 0 ? 1 : freshCount / scored;

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'freshness_score',
      subject: candidate.job_id,
      status: 'pass', // freshness is a score, not a pass/fail gate on its own; mesh policy decides
      severity: 'info',
      evidenceChecked: scored,
      findings,
      warnings,
      score,
    });
  }
}
