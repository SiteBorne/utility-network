import type { CandidateClaim, CandidateEvidenceItem } from '@siteborne/verification';
import type { AccessibilityStatus, PccClaim, PccEvidenceItem } from './document-types';

/**
 * The frozen PCC evidence_item shape has no `result_class` field (only
 * @siteborne/provider-adapters' AdapterResult does, and it is not embedded
 * verbatim in the PCC document — additionalProperties: false on
 * evidence_item forbids it) — the mesh's evidence_accessibility_verifier /
 * provenance_verifier need one to detect disqualified evidence. This is the
 * documented, one-directional mapping from the frozen `accessibility_status`
 * enum onto the mesh's result_class vocabulary
 * (packages/verification/src/verifiers/evidence-accessibility-verifier.ts's
 * DISQUALIFYING set and provenance-verifier.ts's KNOWN_RESULT_CLASSES set).
 * `unavailable` covers both "source unreachable" and "source changed since
 * expected" — the frozen schema does not distinguish them at the
 * accessibility_status level, only via free-text `limitations` a service
 * may add elsewhere.
 */
const ACCESSIBILITY_TO_RESULT_CLASS: Record<AccessibilityStatus, string> = {
  accessible: 'success',
  unavailable: 'retryable_failure',
  restricted: 'policy_blocked',
  requires_authorization: 'policy_blocked',
};

/**
 * `subject` and `verified_absent` are mesh-level concepts with no field in
 * the frozen `claim` definition (see document-types.ts's PccClaim doc
 * comment) — `verifiedAbsentClaimIds` lets a service mark specific claims
 * as verified-absent for mesh purposes without embedding that flag in the
 * document itself.
 */
export function toCandidateClaims(
  claims: PccClaim[],
  verifiedAbsentClaimIds?: ReadonlySet<string>
): CandidateClaim[] {
  return claims.map((c) => ({
    claim_id: c.claim_id,
    predicate: c.predicate,
    value: c.value,
    evidence_ids: c.evidence_ids,
    verified_absent: verifiedAbsentClaimIds?.has(c.claim_id) ?? false,
  }));
}

export function toCandidateEvidence(evidence: PccEvidenceItem[]): CandidateEvidenceItem[] {
  return evidence.map((e) => ({
    evidence_id: e.evidence_id,
    source_uri: e.source_uri,
    locator: e.locator,
    content_hash: e.content_hash,
    retrieved_at: e.retrieved_at,
    authorization_classification: e.authorization_classification,
    result_class: ACCESSIBILITY_TO_RESULT_CLASS[e.accessibility_status],
  }));
}
