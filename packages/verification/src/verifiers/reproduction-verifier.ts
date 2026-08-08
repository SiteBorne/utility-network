import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const REPRODUCTION_VERIFIER_ID = 'reproduction_verifier';
export const REPRODUCTION_VERIFIER_VERSION = '1.0.0';

/**
 * Only runs (is mandatory) in `independent_reproduction` mode. Compares the
 * candidate's claim values against an independently supplied reproduction
 * result (fixture/local-derived — SUN-0500 does not perform any live
 * external call). Never silently falls back to standard-mode verification:
 * if no reproduction result is supplied in reproduction mode, this
 * verifier fails (indeterminate is not "pass").
 */
export interface ReproductionInput {
  claims: Array<{ claim_id: string; value: unknown }>;
}

export class ReproductionVerifier implements Verifier {
  readonly verifierId = REPRODUCTION_VERIFIER_ID;
  readonly verifierVersion = REPRODUCTION_VERIFIER_VERSION;
  readonly capabilities = ['independent_reproduction'] as const;
  readonly dependsOn: readonly string[] = ['claim_evidence_verifier'];
  readonly mandatory = true;

  constructor(private readonly reproduction: ReproductionInput | null) {}

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();

    if (context.mode !== 'independent_reproduction') {
      return buildResult(candidate, context, startedAt, {
        verifierId: this.verifierId,
        verifierVersion: this.verifierVersion,
        ruleId: 'reproduction_not_applicable',
        subject: candidate.job_id,
        status: 'skipped_by_policy',
        severity: 'info',
      });
    }

    if (!this.reproduction) {
      return buildResult(candidate, context, startedAt, {
        verifierId: this.verifierId,
        verifierVersion: this.verifierVersion,
        ruleId: 'reproduction_unavailable',
        subject: candidate.job_id,
        status: 'fail',
        severity: 'blocking',
        failureCodes: ['reproduction_unavailable'],
        findings: [
          {
            code: 'reproduction_unavailable',
            message:
              'independent_reproduction mode requires a reproduction result; none was supplied',
            severity: 'blocking',
          },
        ],
      });
    }

    const reproById = new Map(this.reproduction.claims.map((c) => [c.claim_id, c.value]));
    const findings: VerificationResult['findings'] = [];
    let matched = 0;
    let compared = 0;

    for (const claim of candidate.claims) {
      if (!reproById.has(claim.claim_id)) continue;
      compared++;
      const reproducedValue = reproById.get(claim.claim_id);
      if (compareNormalized(claim.value, reproducedValue)) {
        matched++;
      } else {
        findings.push({
          code: 'reproduction_mismatch',
          message: `Claim ${claim.claim_id} candidate value does not match reproduced value`,
          severity: 'blocking',
          subject: claim.claim_id,
        });
      }
    }

    const blocking = findings.length > 0;

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'reproduction_agreement',
      subject: candidate.job_id,
      status: blocking ? 'fail' : 'pass',
      severity: blocking ? 'blocking' : 'info',
      findings,
      failureCodes: blocking ? ['reproduction_mismatch'] : [],
      claimsChecked: compared,
      score: compared === 0 ? 1 : matched / compared,
    });
  }
}

/** Deterministic comparison: exact identity for primitives, set equality
 * for arrays where order is not material, deep-equal otherwise. Decimal
 * strings compare as strings (never via floating point). */
function compareNormalized(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map((x) => JSON.stringify(x)).sort();
    const sb = [...b].map((x) => JSON.stringify(x)).sort();
    return sa.every((x, i) => x === sb[i]);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
