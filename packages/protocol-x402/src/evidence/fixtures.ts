/**
 * Deterministic synthetic evidence fixtures (directive §30). Every value
 * produced here is unmistakably synthetic — `trust_class:
 * 'synthetic_fixture'`, `verifier_identity`/`facilitator_identity`
 * literally prefixed `synthetic:`, and `transaction_reference` (when
 * present) prefixed `synthetic-tx:` so it can never be mistaken for a
 * real chain transaction hash.
 */
import { hashPaymentObject } from '../canonical';
import type {
  PaymentEvidenceContext,
  ExternalVerificationEvidence,
  ExternalSettlementEvidence,
} from './types';

export async function syntheticVerificationEvidenceSuccess(
  context: PaymentEvidenceContext,
  overrides: Partial<ExternalVerificationEvidence> = {}
): Promise<ExternalVerificationEvidence> {
  const raw_evidence_hash = await hashPaymentObject({
    kind: 'synthetic_verification_success',
    quote_id: context.quote_id,
  });
  return {
    x402_version: 2,
    scheme: context.scheme,
    network: context.network,
    quote_id: context.quote_id,
    requirement_id: context.requirement_id,
    payment_identifier: context.payment_identifier,
    verified: true,
    verifier_identity: 'synthetic:fixture-verifier',
    evidence_timestamp: context.nowIso,
    raw_evidence_hash,
    trust_class: 'synthetic_fixture',
    ...overrides,
  };
}

export async function syntheticVerificationEvidenceRejected(
  context: PaymentEvidenceContext,
  reason = 'synthetic rejection reason',
  overrides: Partial<ExternalVerificationEvidence> = {}
): Promise<ExternalVerificationEvidence> {
  const raw_evidence_hash = await hashPaymentObject({
    kind: 'synthetic_verification_rejected',
    quote_id: context.quote_id,
    reason,
  });
  return {
    x402_version: 2,
    scheme: context.scheme,
    network: context.network,
    quote_id: context.quote_id,
    requirement_id: context.requirement_id,
    payment_identifier: context.payment_identifier,
    verified: false,
    reason,
    verifier_identity: 'synthetic:fixture-verifier',
    evidence_timestamp: context.nowIso,
    raw_evidence_hash,
    trust_class: 'synthetic_fixture',
    ...overrides,
  };
}

export async function syntheticSettlementEvidenceSuccess(
  context: PaymentEvidenceContext,
  verificationEvidenceHash: string,
  actualAmount: string,
  overrides: Partial<ExternalSettlementEvidence> = {}
): Promise<ExternalSettlementEvidence> {
  const raw_evidence_hash = await hashPaymentObject({
    kind: 'synthetic_settlement_success',
    quote_id: context.quote_id,
    actualAmount,
  });
  return {
    x402_version: 2,
    scheme: context.scheme,
    network: context.network,
    asset: context.asset,
    payee: context.payee,
    actual_amount: actualAmount,
    quote_id: context.quote_id,
    requirement_id: context.requirement_id,
    payment_identifier: context.payment_identifier,
    transaction_reference: 'synthetic-tx:' + raw_evidence_hash.slice(0, 24),
    success: true,
    settled_at: context.nowIso,
    facilitator_identity: 'synthetic:fixture-facilitator',
    raw_evidence_hash,
    verification_evidence_hash: verificationEvidenceHash,
    trust_class: 'synthetic_fixture',
    ...(context.scheme === 'upto' ? { authorized_maximum: context.amount } : {}),
    ...overrides,
  };
}

export async function syntheticSettlementEvidenceFailed(
  context: PaymentEvidenceContext,
  verificationEvidenceHash: string,
  reason = 'synthetic settlement failure',
  overrides: Partial<ExternalSettlementEvidence> = {}
): Promise<ExternalSettlementEvidence> {
  const raw_evidence_hash = await hashPaymentObject({
    kind: 'synthetic_settlement_failed',
    quote_id: context.quote_id,
    reason,
  });
  return {
    x402_version: 2,
    scheme: context.scheme,
    network: context.network,
    asset: context.asset,
    payee: context.payee,
    actual_amount: '0',
    quote_id: context.quote_id,
    requirement_id: context.requirement_id,
    payment_identifier: context.payment_identifier,
    success: false,
    reason,
    settled_at: context.nowIso,
    facilitator_identity: 'synthetic:fixture-facilitator',
    raw_evidence_hash,
    verification_evidence_hash: verificationEvidenceHash,
    trust_class: 'synthetic_fixture',
    ...overrides,
  };
}
