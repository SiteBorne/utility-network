import { deterministicId } from '../pcc/ids';
import type { Materiality, ClaimVerificationStatus, PccClaim } from '../pcc/document-types';

export interface ClaimInput {
  seed: string; // deterministic seed, e.g. `${service}:${predicate}:${subject}`
  predicate: string;
  value: unknown;
  confidence: number;
  evidenceIds: string[];
  materiality?: Materiality;
  verificationStatus?: ClaimVerificationStatus;
}

export function buildClaim(input: ClaimInput): PccClaim {
  return {
    claim_id: deterministicId('clm', input.seed),
    predicate: input.predicate,
    value: input.value,
    confidence: input.confidence,
    evidence_ids: input.evidenceIds,
    materiality: input.materiality ?? 'material',
    verification_status: input.verificationStatus ?? 'verified',
  };
}

/**
 * A verified-absent claim requires an explicit, bounded search scope
 * (directive §13/§8: "never convert source failure ... into verified
 * absence"). `absenceEvidenceIds` must reference evidence that itself
 * documents the search scope actually performed — callers construct that
 * evidence item explicitly; this function only refuses to build the claim
 * without at least one. The frozen `claim` shape has no `verified_absent`
 * field (see pcc/document-types.ts) — callers must additionally add the
 * returned claim_id to the `verifiedAbsentClaimIds` set passed to
 * pcc/verify-and-sign.ts::verifyAndSign so the mesh treats it correctly.
 */
export interface VerifiedAbsentClaimInput {
  seed: string;
  predicate: string;
  absenceEvidenceIds: string[];
  confidence?: number;
}

export function buildVerifiedAbsentClaim(input: VerifiedAbsentClaimInput): PccClaim {
  if (input.absenceEvidenceIds.length === 0) {
    throw new Error(
      `verified_absent claim for predicate "${input.predicate}" requires at least one absence-proof evidence_id`
    );
  }
  return {
    claim_id: deterministicId('clm', input.seed),
    predicate: input.predicate,
    value: false,
    confidence: input.confidence ?? 0.99,
    evidence_ids: input.absenceEvidenceIds,
    materiality: 'material',
    verification_status: 'verified',
  };
}
