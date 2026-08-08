import { canonicalize, contentHash } from '../canonical';
import type {
  CandidateResult,
  VerificationContext,
  VerificationResult,
  VerifierFinding,
  VerificationStatus,
  Severity,
} from '../types';

export interface ResultBuilderInput {
  verifierId: string;
  verifierVersion: string;
  ruleId: string;
  subject: string;
  status: VerificationStatus;
  severity: Severity;
  findings?: VerifierFinding[];
  failureCodes?: string[];
  warnings?: string[];
  limitations?: string[];
  claimsChecked?: number;
  evidenceChecked?: number;
  evidenceHashes?: string[];
  deterministic?: boolean;
  retryable?: boolean;
  provenance?: string[];
  score?: number;
}

export async function buildResult(
  candidate: CandidateResult,
  context: VerificationContext,
  startedAtMs: number,
  input: ResultBuilderInput
): Promise<VerificationResult> {
  const completedAtMs = context.clock.nowMs();
  const inputHash = await contentHash(
    canonicalize({ job_id: candidate.job_id, output: candidate.output })
  );
  return {
    verifier_id: input.verifierId,
    verifier_version: input.verifierVersion,
    status: input.status,
    severity: input.severity,
    rule_id: input.ruleId,
    subject: input.subject,
    claims_checked: input.claimsChecked ?? 0,
    evidence_checked: input.evidenceChecked ?? 0,
    findings: input.findings ?? [],
    failure_codes: input.failureCodes ?? [],
    warnings: input.warnings ?? [],
    limitations: input.limitations ?? [],
    input_hash: inputHash,
    evidence_hashes: input.evidenceHashes ?? [],
    started_at: new Date(startedAtMs).toISOString(),
    completed_at: new Date(completedAtMs).toISOString(),
    elapsed_ms: completedAtMs - startedAtMs,
    deterministic: input.deterministic ?? true,
    retryable: input.retryable ?? false,
    provenance: input.provenance ?? [],
    score: input.score,
  };
}
