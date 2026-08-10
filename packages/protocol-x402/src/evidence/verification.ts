/**
 * Structural validation and the state-advancement guard for external
 * verification evidence (directive §10, §13). Never returns
 * `payment_verified` merely because shape validation passed — that
 * requires BOTH structural validity AND `evidence.verified === true` AND
 * an allowed trust class (directive: "Do not let caller-supplied
 * `verified: true` alone advance the state").
 */
import { isSchemeSupportedOnNetwork } from '../network/schemes';
import { isTrustClassAllowed } from './policy';
import type { PaymentEvidenceMode } from './policy';
import type { ExternalVerificationEvidence, PaymentEvidenceContext } from './types';

export type VerificationEvidenceValidation =
  | 'structurally_valid'
  | 'requirement_mismatch'
  | 'quote_mismatch'
  | 'payment_identifier_mismatch'
  | 'scheme_mismatch'
  | 'network_mismatch'
  | 'verification_rejected'
  | 'malformed_evidence'
  | 'unsupported_version';

/** Pure structural validation — checks the evidence's declared binding
 * against the payment context it must have come from. Returns
 * `structurally_valid` for evidence declaring `verified: false` too (a
 * well-formed rejection is still structurally valid evidence — see
 * `canAdvanceToVerified` for the separate, additional check that actually
 * gates the state transition). */
export function validateVerificationEvidence(
  evidence: ExternalVerificationEvidence,
  context: PaymentEvidenceContext
): VerificationEvidenceValidation {
  if (typeof evidence.x402_version !== 'number' || !Number.isFinite(evidence.x402_version)) {
    return 'malformed_evidence';
  }
  if (evidence.x402_version !== 2) {
    return 'unsupported_version';
  }
  if (!evidence.raw_evidence_hash || !evidence.verifier_identity || !evidence.evidence_timestamp) {
    return 'malformed_evidence';
  }
  if (evidence.scheme !== context.scheme) {
    return 'scheme_mismatch';
  }
  const networkSupport = isSchemeSupportedOnNetwork(evidence.scheme, evidence.network);
  if (!networkSupport.supported || evidence.network !== context.network) {
    return 'network_mismatch';
  }
  if (
    evidence.quote_id !== context.quote_id ||
    evidence.requirement_id !== context.requirement_id
  ) {
    return evidence.quote_id !== context.quote_id ? 'quote_mismatch' : 'requirement_mismatch';
  }
  if (evidence.payment_identifier !== context.payment_identifier) {
    return 'payment_identifier_mismatch';
  }
  if (!evidence.verified && !evidence.reason) {
    // A rejection with no reason is itself malformed — a real verifier
    // always explains a rejection.
    return 'malformed_evidence';
  }
  return 'structurally_valid';
}

export type VerifiedAdvanceOutcome =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'not_structurally_valid' | 'verification_not_successful' | 'trust_class_not_allowed';
      detail: VerificationEvidenceValidation | undefined;
    };

/** The one function a caller must consult before actually invoking the
 * job-state-machine's `PAYMENT_CHALLENGED -> PAYMENT_VERIFIED` transition
 * (see docs/decisions/0046). Requires ALL of: structural validity, a
 * successful verification result, and a trust class the current
 * evidence mode permits. */
export function canAdvanceToVerified(
  evidence: ExternalVerificationEvidence,
  context: PaymentEvidenceContext,
  mode: PaymentEvidenceMode
): VerifiedAdvanceOutcome {
  const validation = validateVerificationEvidence(evidence, context);
  if (validation !== 'structurally_valid') {
    return { allowed: false, reason: 'not_structurally_valid', detail: validation };
  }
  if (!evidence.verified) {
    return { allowed: false, reason: 'verification_not_successful', detail: undefined };
  }
  if (!isTrustClassAllowed(evidence.trust_class, mode)) {
    return { allowed: false, reason: 'trust_class_not_allowed', detail: undefined };
  }
  return { allowed: true };
}
