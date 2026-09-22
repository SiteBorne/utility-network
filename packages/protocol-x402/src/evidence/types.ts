/**
 * Shared types for external payment evidence (directive §4, §8-14).
 *
 * Three strictly separate concepts, never collapsed into one name or one
 * boolean:
 *
 * A. STRUCTURAL VALIDITY — "does this V2 payload structurally correspond
 *    to this SITEBORNE payment requirement?" Answered entirely by
 *    checkpoint 1/2's `payload/parser.ts` and `requirements/*.ts` — no
 *    new code needed here.
 * B. EXTERNAL VERIFICATION — "has a trusted verifier/facilitator
 *    determined the signed payment payload satisfies the requirement?"
 *    Modeled here as `ExternalVerificationEvidence`. SUN-0700A may only
 *    ever produce/consume `synthetic_fixture` or
 *    `locally_derived_structure_only` trust-classed evidence — never
 *    `external_verified` (that requires a real facilitator, SUN-0700B).
 * C. SETTLEMENT — "has the payment actually been executed/settled and
 *    confirmed?" Modeled here as `ExternalSettlementEvidence`. Same trust
 *    restriction applies.
 */
import type { Network } from '@x402/core/types';
import type { SiteborneServiceId } from '../types';

/** How much SITEBORNE trusts a given piece of external evidence. Only
 * `synthetic_fixture` and `locally_derived_structure_only` may ever be
 * produced or accepted by SUN-0700A — `external_verified` requires an
 * actual facilitator call, which is SUN-0700B's exclusive concern. See
 * `policy.ts`'s `isTrustClassAllowed`, the single gate every guard in
 * this package calls. */
export type EvidenceTrustClass =
  | 'synthetic_fixture'
  | 'locally_derived_structure_only'
  | 'external_unverified'
  | 'external_verified';

export interface ExternalVerificationEvidence {
  x402_version: number;
  scheme: 'exact' | 'upto';
  network: Network;
  quote_id: string;
  requirement_id: string;
  payment_identifier: string;
  /** Whether the (modeled) verifier reports this payload as satisfying
   * the requirement. This field alone must never advance state — see
   * `verification.ts`'s `canAdvanceToVerified`. */
  verified: boolean;
  payer?: string;
  /** Present when `verified` is false. */
  reason?: string;
  /** Identity of the (modeled) verifier/facilitator that produced this
   * evidence — never a real facilitator identity claim in SUN-0700A. */
  verifier_identity: string;
  evidence_timestamp: string;
  /** Canonical hash of the raw evidence payload this record summarizes —
   * never the raw payload itself, to avoid persisting more than needed. */
  raw_evidence_hash: string;
  trust_class: EvidenceTrustClass;
  /** Internal, classification-only diagnostics for a failed verification.
   * Closed-vocabulary code / integer status only — never free-form text.
   * Absent on success and never part of `raw_evidence_hash`. */
  subreason?: string;
  transport_status?: number;
  retryability?: string;
  jwt_subreason?: string;
  /** Closed-vocabulary same-invocation JWT control results (diagnostic canary only). */
  jwt_diagnostic?: Record<string, string>;
}

export interface ExternalSettlementEvidence {
  x402_version: number;
  scheme: 'exact' | 'upto';
  network: Network;
  asset: string;
  payer?: string;
  payee: string;
  /** Atomic-unit integer string — the amount actually settled. For
   * `exact`, must equal the requirement's amount. For `upto`, must
   * satisfy `0 <= actual <= authorized_maximum` and match the accepted
   * usage-result binding. */
  actual_amount: string;
  quote_id: string;
  requirement_id: string;
  payment_identifier: string;
  /** Present when supplied. Never a real transaction hash in SUN-0700A —
   * synthetic fixtures must be unmistakably synthetic (directive §11). */
  transaction_reference?: string;
  success: boolean;
  reason?: string;
  settled_at: string;
  facilitator_identity: string;
  raw_evidence_hash: string;
  /** Binds this settlement to the verification evidence that preceded
   * it — settlement must never be evaluated independently of a prior
   * verification. */
  verification_evidence_hash: string;
  trust_class: EvidenceTrustClass;
  /** `upto` only. */
  authorized_maximum?: string;
  usage_result_hash?: string;
  /** Internal, classification-only diagnostics for a failed settlement.
   * Closed-vocabulary code / integer status only — never free-form text.
   * Absent on success and never part of `raw_evidence_hash`. */
  subreason?: string;
  transport_status?: number;
  retryability?: string;
  jwt_subreason?: string;
}

export interface PaymentEvidenceContext {
  service_id: SiteborneServiceId;
  service_version: 'v1' | 'v2' | 'v3';
  scheme: 'exact' | 'upto';
  network: Network;
  asset: string;
  payee: string;
  quote_id: string;
  requirement_id: string;
  payment_identifier: string;
  /** `exact`: the exact amount. `upto`: the authorized maximum. */
  amount: string;
  nowIso: string;
  expiresAt: string;
}
