/**
 * Structural validation and the state-advancement guard for external
 * settlement evidence (directive §12, §14). Named
 * `validateSettlementEvidenceStructureAndBinding` deliberately — never
 * `verifyOnchainPayment()` — this is structural/binding validation only,
 * never a claim of onchain authenticity.
 */
import { isCanonicalAtomicAmount } from '../requirements/upto';
import { isSchemeSupportedOnNetwork } from '../network/schemes';
import { isTrustClassAllowed } from './policy';
import type { PaymentEvidenceMode } from './policy';
import type { ExternalSettlementEvidence, PaymentEvidenceContext } from './types';

export type SettlementEvidenceValidation =
  | 'structurally_valid'
  | 'requirement_mismatch'
  | 'quote_mismatch'
  | 'payment_identifier_mismatch'
  | 'scheme_mismatch'
  | 'network_mismatch'
  | 'asset_mismatch'
  | 'payee_mismatch'
  | 'amount_mismatch'
  | 'amount_exceeds_maximum'
  | 'settlement_rejected'
  | 'malformed_evidence'
  | 'unsupported_version';

/** Pure structural + binding validation. Amount semantics differ by
 * scheme (directive §12): `exact` requires `actual_amount ===
 * context.amount` exactly; `upto` requires `0 <= actual_amount <=
 * context.amount` (the authorized maximum) and, when supplied,
 * consistency with `authorized_maximum`. */
export function validateSettlementEvidenceStructureAndBinding(
  evidence: ExternalSettlementEvidence,
  context: PaymentEvidenceContext
): SettlementEvidenceValidation {
  if (typeof evidence.x402_version !== 'number' || !Number.isFinite(evidence.x402_version)) {
    return 'malformed_evidence';
  }
  if (evidence.x402_version !== 2) {
    return 'unsupported_version';
  }
  if (
    !evidence.raw_evidence_hash ||
    !evidence.facilitator_identity ||
    !evidence.settled_at ||
    !evidence.verification_evidence_hash
  ) {
    return 'malformed_evidence';
  }
  if (evidence.scheme !== context.scheme) {
    return 'scheme_mismatch';
  }
  const networkSupport = isSchemeSupportedOnNetwork(evidence.scheme, evidence.network);
  if (!networkSupport.supported || evidence.network !== context.network) {
    return 'network_mismatch';
  }
  if (evidence.quote_id !== context.quote_id) return 'quote_mismatch';
  if (evidence.requirement_id !== context.requirement_id) return 'requirement_mismatch';
  if (evidence.payment_identifier !== context.payment_identifier) {
    return 'payment_identifier_mismatch';
  }
  if (evidence.asset !== context.asset) return 'asset_mismatch';
  if (evidence.payee !== context.payee) return 'payee_mismatch';
  if (!evidence.success && !evidence.reason) return 'malformed_evidence';
  if (
    evidence.success &&
    (typeof evidence.transaction_reference !== 'string' ||
      evidence.transaction_reference.trim().length === 0)
  ) {
    return 'malformed_evidence';
  }
  if (!isCanonicalAtomicAmount(evidence.actual_amount)) return 'malformed_evidence';

  // Amount semantics only apply to a claimed-successful settlement — a
  // failed settlement legitimately reports actual_amount: '0' and must
  // not be rejected as an amount mismatch for that.
  if (evidence.success) {
    if (evidence.scheme === 'exact') {
      if (evidence.actual_amount !== context.amount) return 'amount_mismatch';
    } else {
      const maximum = evidence.authorized_maximum ?? context.amount;
      if (!isCanonicalAtomicAmount(maximum)) return 'malformed_evidence';
      if (BigInt(evidence.actual_amount) > BigInt(maximum)) return 'amount_exceeds_maximum';
      if (BigInt(maximum) > BigInt(context.amount)) return 'amount_mismatch'; // cannot exceed the quoted maximum
    }
  }

  return 'structurally_valid';
}

export type SettledAdvanceOutcome =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'not_structurally_valid'
        | 'settlement_not_successful'
        | 'trust_class_not_allowed'
        | 'verification_not_accepted';
      detail: SettlementEvidenceValidation | undefined;
    };

/** The one function a caller must consult before actually invoking the
 * job-state-machine's `SETTLING -> DELIVERED` transition (see
 * docs/decisions/0046). Requires ALL of: structural/binding validity, a
 * successful settlement result, an allowed trust class, AND that this
 * settlement evidence's `verification_evidence_hash` matches the hash of
 * verification evidence that was itself already accepted via
 * `canAdvanceToVerified` — settlement can never be evaluated
 * independently of a prior, accepted verification (directive §32:
 * "settlement before verification" must fail). */
export function canAdvanceToSettled(
  evidence: ExternalSettlementEvidence,
  context: PaymentEvidenceContext,
  mode: PaymentEvidenceMode,
  acceptedVerificationEvidenceHash: string | undefined
): SettledAdvanceOutcome {
  const validation = validateSettlementEvidenceStructureAndBinding(evidence, context);
  if (validation !== 'structurally_valid') {
    return { allowed: false, reason: 'not_structurally_valid', detail: validation };
  }
  if (
    !acceptedVerificationEvidenceHash ||
    evidence.verification_evidence_hash !== acceptedVerificationEvidenceHash
  ) {
    return { allowed: false, reason: 'verification_not_accepted', detail: undefined };
  }
  if (!evidence.success) {
    return { allowed: false, reason: 'settlement_not_successful', detail: undefined };
  }
  if (!isTrustClassAllowed(evidence.trust_class, mode)) {
    return { allowed: false, reason: 'trust_class_not_allowed', detail: undefined };
  }
  return { allowed: true };
}
