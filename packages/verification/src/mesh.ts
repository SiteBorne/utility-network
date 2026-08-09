import { MeshError } from './failures';
import { computeWaves } from './graph';
import type {
  CandidateResult,
  VerificationContext,
  VerificationDecision,
  VerificationResult,
  Verifier,
} from './types';

export interface MeshVerdict {
  decision: VerificationDecision;
  /** Frozen PCC `verification` block (schemas/proof-carrying-context.schema.json). */
  verification: {
    schema_valid: boolean;
    material_claims_supported: boolean;
    evidence_accessibility: number;
    freshness: number;
    completeness: number;
    cross_source_agreement: number;
    provenance_valid: boolean;
    prompt_injection_result: {
      checked: boolean;
      result: 'clean' | 'suspected' | 'confirmed';
      details?: string;
    };
    deterministic_failures: string[];
    verifier_versions: Record<string, string>;
    policy: string;
    decision: VerificationDecision;
    score: number;
    failed_requirements: string[];
  };
  results: VerificationResult[];
  waves: string[][];
}

const MANDATORY_VERIFIER_IDS_BY_MODE: Record<string, string[]> = {
  standard: [
    'schema_verifier',
    'evidence_accessibility_verifier',
    'claim_evidence_verifier',
    'freshness_verifier',
    'completeness_verifier',
    'cross_source_verifier',
    'provenance_verifier',
    'prompt_injection_verifier',
  ],
  independent_reproduction: [
    'schema_verifier',
    'evidence_accessibility_verifier',
    'claim_evidence_verifier',
    'freshness_verifier',
    'completeness_verifier',
    'cross_source_verifier',
    'provenance_verifier',
    'prompt_injection_verifier',
    'reproduction_verifier',
  ],
};

/** Converts any unexpected internal exception at the mesh boundary into a
 * fail-closed VerificationResult, never letting it escape as a raw throw. */
async function runVerifier(
  verifier: Verifier,
  candidate: CandidateResult,
  context: VerificationContext
): Promise<VerificationResult> {
  const startedAt = context.clock.nowMs();
  context.audit.emit({
    type: 'verifier_started',
    details: { verifier_id: verifier.verifierId },
    correlation_id: context.request_id,
  });

  const timeoutMs = context.budget.perVerifierTimeoutMs;
  try {
    const result = await withTimeout(
      Promise.resolve(verifier.verify(candidate, context)),
      timeoutMs
    );
    context.audit.emit({
      type:
        result.status === 'pass'
          ? 'verifier_passed'
          : result.status === 'fail'
            ? 'verifier_failed'
            : 'verifier_indeterminate',
      details: { verifier_id: verifier.verifierId, status: result.status },
      correlation_id: context.request_id,
    });
    return result;
  } catch (err) {
    const timedOut = err instanceof TimeoutMarker;
    context.audit.emit({
      type: timedOut ? 'verification_timed_out' : 'verifier_failed',
      details: { verifier_id: verifier.verifierId, error: String(err) },
      correlation_id: context.request_id,
    });
    const completedAt = context.clock.nowMs();
    return {
      verifier_id: verifier.verifierId,
      verifier_version: verifier.verifierVersion,
      status: 'fail',
      severity: 'blocking',
      rule_id: timedOut ? 'verifier_timeout' : 'verifier_exception',
      subject: candidate.job_id,
      claims_checked: 0,
      evidence_checked: 0,
      findings: [
        {
          code: timedOut ? 'verifier_timeout' : 'verifier_exception',
          message: timedOut
            ? `Verifier exceeded ${timeoutMs}ms budget`
            : `Internal verifier exception: ${String(err)}`,
          severity: 'blocking',
        },
      ],
      failure_codes: [timedOut ? 'verifier_timeout' : 'verifier_exception'],
      warnings: [],
      limitations: [],
      input_hash: 'sha256:' + '0'.repeat(64),
      evidence_hashes: [],
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      elapsed_ms: completedAt - startedAt,
      deterministic: false,
      retryable: timedOut,
      provenance: [],
    };
  }
}

class TimeoutMarker extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutMarker(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

export interface MeshOptions {
  /** The frozen PCC `verification.policy` field is a `policy_id`
   * (`^pol_[a-z0-9]{24}$`), not a hash — see ADR 0036. Callers that also
   * need a policy *hash* for receipt binding pass that separately via
   * VerificationContext.policy_hash (packages/verification/src/policy.ts::hashPolicy). */
  policyId: string;
  /** Verifiers not in this set (for the active mode) are treated as
   * optional — their findings can only ever be warnings, never blocking. */
  requireAllMandatory?: boolean;
}

/**
 * Runs the full verifier mesh against a candidate result and produces a
 * deterministic verdict. Not a voting system: any blocking failure from a
 * mandatory verifier makes the final decision `fail` regardless of how many
 * other verifiers passed. Missing mandatory verifiers, unknown verifier
 * results, and verifier exceptions all fail closed.
 */
export async function runMesh(
  verifiers: readonly Verifier[],
  candidate: CandidateResult,
  context: VerificationContext,
  options: MeshOptions
): Promise<MeshVerdict> {
  const mandatoryIds = new Set(MANDATORY_VERIFIER_IDS_BY_MODE[context.mode] ?? []);
  const presentIds = new Set(verifiers.map((v) => v.verifierId));

  const missingMandatory = [...mandatoryIds].filter((id) => !presentIds.has(id));
  const waves = computeWaves(verifiers);

  const byId = new Map(verifiers.map((v) => [v.verifierId, v]));
  const resultsById = new Map<string, VerificationResult>();

  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map(async (id) => {
        const v = byId.get(id);
        if (!v) throw new MeshError('unknown_verifier_id', `unknown verifier id in wave: ${id}`);
        return [id, await runVerifier(v, candidate, context)] as const;
      })
    );
    for (const [id, result] of waveResults) resultsById.set(id, result);
  }

  const results = [...resultsById.values()];

  const failedRequirements: string[] = [];
  const deterministicFailures: string[] = [];

  for (const id of missingMandatory) {
    failedRequirements.push(`missing_mandatory_verifier:${id}`);
    deterministicFailures.push(`missing_mandatory_verifier:${id}`);
  }

  let anyMandatoryBlockingFail = missingMandatory.length > 0;
  let anyMandatoryIndeterminate = false;

  for (const result of results) {
    const isMandatory = mandatoryIds.has(result.verifier_id) || options.requireAllMandatory;
    if (!isMandatory) continue;
    if (result.status === 'fail' && result.severity === 'blocking') {
      anyMandatoryBlockingFail = true;
      failedRequirements.push(result.rule_id);
      deterministicFailures.push(...result.failure_codes);
    }
    if (result.status === 'indeterminate' || result.status === 'skipped_by_policy') {
      anyMandatoryIndeterminate = true;
      failedRequirements.push(`${result.rule_id}:${result.status}`);
    }
  }

  const get = (id: string) => resultsById.get(id);
  const schemaValid = get('schema_verifier')?.status === 'pass';
  const materialClaimsSupported = get('claim_evidence_verifier')?.status === 'pass';
  const provenanceValid = get('provenance_verifier')?.status === 'pass';
  const evidenceAccessibility = numericScoreOrRatio(
    'evidence_accessibility_verifier',
    get,
    results
  );
  const freshness = get('freshness_verifier')?.score ?? 0;
  const completeness = get('completeness_verifier')?.score ?? 0;
  const crossSourceAgreement = get('cross_source_verifier')?.score ?? 1;

  const injectionResult = extractInjectionResult(get('prompt_injection_verifier'));

  // Deterministic verdict: never a majority vote. Any mandatory blocking
  // failure, missing mandatory verifier, or mandatory-indeterminate result
  // forces fail/conditional — it can never be overridden by a numeric score.
  let decision: VerificationDecision;
  if (anyMandatoryBlockingFail) {
    decision = injectionResult === 'confirmed' ? 'quarantined' : 'fail';
  } else if (anyMandatoryIndeterminate) {
    decision = 'conditional';
  } else {
    decision = 'pass';
  }

  const score =
    decision === 'pass'
      ? averageScore([evidenceAccessibility, freshness, completeness, crossSourceAgreement])
      : 0;

  const verifierVersions: Record<string, string> = {};
  for (const r of results) verifierVersions[r.verifier_id] = r.verifier_version;

  return {
    decision,
    verification: {
      schema_valid: schemaValid,
      material_claims_supported: materialClaimsSupported,
      evidence_accessibility: evidenceAccessibility,
      freshness,
      completeness,
      cross_source_agreement: crossSourceAgreement,
      provenance_valid: provenanceValid,
      prompt_injection_result: { checked: true, result: injectionResult },
      deterministic_failures: deterministicFailures,
      verifier_versions: verifierVersions,
      policy: options.policyId,
      decision,
      score,
      failed_requirements: failedRequirements,
    },
    results,
    waves,
  };
}

function numericScoreOrRatio(
  id: string,
  get: (id: string) => VerificationResult | undefined,
  _results: VerificationResult[]
): number {
  const r = get(id);
  if (!r) return 0;
  if (typeof r.score === 'number') return r.score;
  return r.status === 'pass' ? 1 : 0;
}

function extractInjectionResult(
  r: VerificationResult | undefined
): 'clean' | 'suspected' | 'confirmed' {
  if (!r) return 'clean';
  const line = r.limitations.find((l) => l.startsWith('prompt_injection_result='));
  const value = line?.split('=')[1];
  if (value === 'confirmed' || value === 'suspected' || value === 'clean') return value;
  return 'clean';
}

function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
