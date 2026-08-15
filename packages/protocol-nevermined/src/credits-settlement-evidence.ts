/**
 * Rail-specific settlement evidence for the accepted Nevermined prepaid
 * dynamic-credit model (SUN-0900B checkpoint 2E/2H).
 *
 * This object deliberately keeps three economically different values apart:
 * stablecoin movement used to acquire/top-up credits, credits redeemed by the
 * job, and the rail-agnostic UsageResult value. It is hashed into the existing
 * PaymentServiceLink v2 `settlement_evidence_hash`; PCC, UsageResult, receipt,
 * and the PaymentServiceLink schema remain unchanged.
 */
import { hashPaymentObject } from '@siteborne/protocol-x402';

export interface NeverminedCreditsSettlementEvidenceInput {
  payment_identifier: string;
  plan_id: string;
  starting_balance: string;
  credits_acquired: string;
  credits_redeemed: string;
  usage_value_atomic: string;
  remaining_balance: string;
  cash_movement_atomic: string;
  transaction: string;
  observed_at: string;
}

export interface NeverminedCreditsSettlementEvidence
  extends NeverminedCreditsSettlementEvidenceInput {
  kind: 'nevermined_credits_settlement';
  evidence_hash: string;
}

export interface NeverminedCreditsSettlementExpectation {
  payment_identifier: string;
  plan_id: string;
  authorized_maximum: string;
  actual_usage: string;
  expected_starting_balance: string;
  expected_acquisition: string;
}

export type NeverminedCreditsSettlementValidation =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'MALFORMED_EVIDENCE'
        | 'PAYMENT_IDENTIFIER_MISMATCH'
        | 'PLAN_ID_MISMATCH'
        | 'STARTING_BALANCE_MISMATCH'
        | 'CREDITS_ACQUIRED_MISMATCH'
        | 'CREDITS_REDEEMED_MISMATCH'
        | 'USAGE_VALUE_MISMATCH'
        | 'CASH_ACQUISITION_MISMATCH'
        | 'AUTHORIZATION_EXCEEDED'
        | 'CREDIT_BALANCE_EQUATION_MISMATCH'
        | 'EVIDENCE_HASH_MISMATCH';
    };

function isCanonicalAtomic(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
}

function payload(evidence: NeverminedCreditsSettlementEvidenceInput): Record<string, unknown> {
  return {
    kind: 'nevermined_credits_settlement',
    payment_identifier: evidence.payment_identifier,
    plan_id: evidence.plan_id,
    starting_balance: evidence.starting_balance,
    credits_acquired: evidence.credits_acquired,
    credits_redeemed: evidence.credits_redeemed,
    usage_value_atomic: evidence.usage_value_atomic,
    remaining_balance: evidence.remaining_balance,
    cash_movement_atomic: evidence.cash_movement_atomic,
    transaction: evidence.transaction,
    observed_at: evidence.observed_at,
  };
}

function structurallyValid(value: unknown): value is NeverminedCreditsSettlementEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === 'nevermined_credits_settlement' &&
    typeof v.payment_identifier === 'string' &&
    v.payment_identifier.length > 0 &&
    typeof v.plan_id === 'string' &&
    v.plan_id.length > 0 &&
    isCanonicalAtomic(v.starting_balance) &&
    isCanonicalAtomic(v.credits_acquired) &&
    isCanonicalAtomic(v.credits_redeemed) &&
    isCanonicalAtomic(v.usage_value_atomic) &&
    isCanonicalAtomic(v.remaining_balance) &&
    isCanonicalAtomic(v.cash_movement_atomic) &&
    typeof v.transaction === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(v.transaction) &&
    typeof v.observed_at === 'string' &&
    !Number.isNaN(Date.parse(v.observed_at)) &&
    typeof v.evidence_hash === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(v.evidence_hash)
  );
}

export async function buildNeverminedCreditsSettlementEvidence(
  input: NeverminedCreditsSettlementEvidenceInput
): Promise<NeverminedCreditsSettlementEvidence> {
  const candidate = {
    ...payload(input),
    evidence_hash: 'sha256:' + '0'.repeat(64),
  };
  if (!structurallyValid(candidate)) {
    throw new Error('invalid_nevermined_credits_settlement_evidence');
  }
  const evidence_hash = await hashPaymentObject(payload(input));
  return {
    kind: 'nevermined_credits_settlement',
    ...input,
    evidence_hash,
  };
}

export async function validateNeverminedCreditsSettlementEvidence(
  value: unknown,
  expected: NeverminedCreditsSettlementExpectation
): Promise<NeverminedCreditsSettlementValidation> {
  if (!structurallyValid(value)) return { valid: false, reason: 'MALFORMED_EVIDENCE' };
  if (
    !isCanonicalAtomic(expected.authorized_maximum) ||
    !isCanonicalAtomic(expected.actual_usage) ||
    !isCanonicalAtomic(expected.expected_starting_balance) ||
    !isCanonicalAtomic(expected.expected_acquisition)
  ) {
    return { valid: false, reason: 'MALFORMED_EVIDENCE' };
  }
  if (value.payment_identifier !== expected.payment_identifier) {
    return { valid: false, reason: 'PAYMENT_IDENTIFIER_MISMATCH' };
  }
  if (value.plan_id !== expected.plan_id) {
    return { valid: false, reason: 'PLAN_ID_MISMATCH' };
  }
  if (value.starting_balance !== expected.expected_starting_balance) {
    return { valid: false, reason: 'STARTING_BALANCE_MISMATCH' };
  }
  if (value.credits_acquired !== expected.expected_acquisition) {
    return { valid: false, reason: 'CREDITS_ACQUIRED_MISMATCH' };
  }
  if (value.credits_redeemed !== expected.actual_usage) {
    return { valid: false, reason: 'CREDITS_REDEEMED_MISMATCH' };
  }
  if (value.usage_value_atomic !== expected.actual_usage) {
    return { valid: false, reason: 'USAGE_VALUE_MISMATCH' };
  }
  if (BigInt(value.usage_value_atomic) > BigInt(expected.authorized_maximum)) {
    return { valid: false, reason: 'AUTHORIZATION_EXCEEDED' };
  }
  // For the frozen zero-balance first-use proof, one full 190000-credit
  // acquisition is one full 190000-atomic USDC cash movement. A later
  // partial-balance checkpoint may supply a different explicit expectation;
  // this validator never guesses or clips it.
  if (value.cash_movement_atomic !== expected.expected_acquisition) {
    return { valid: false, reason: 'CASH_ACQUISITION_MISMATCH' };
  }
  const expectedRemaining =
    BigInt(value.starting_balance) +
    BigInt(value.credits_acquired) -
    BigInt(value.credits_redeemed);
  if (expectedRemaining < 0n || BigInt(value.remaining_balance) !== expectedRemaining) {
    return { valid: false, reason: 'CREDIT_BALANCE_EQUATION_MISMATCH' };
  }
  const expectedHash = await hashPaymentObject(payload(value));
  if (value.evidence_hash !== expectedHash) {
    return { valid: false, reason: 'EVIDENCE_HASH_MISMATCH' };
  }
  return { valid: true };
}
