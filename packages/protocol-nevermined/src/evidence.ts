import { NEVERMINED_PAYMENT_PROVIDER, hashPaymentObject } from '@siteborne/protocol-x402';
import type { NeverminedSettlementResult, NeverminedVerificationResult } from './client';
import { normalizeSettlementSuccess } from './validation';

export interface NeverminedSettlementObservation {
  credits_redeemed: string | null;
  remaining_balance: string | null;
  transaction: string;
}

export interface NeverminedSettlementEvidenceCarrier {
  nevermined_settlement_observation: NeverminedSettlementObservation;
}

function optionalCanonicalAtomic(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? value : undefined;
}

/**
 * Reads the bounded public provider observation attached by the edge SDK
 * adapter. Unknown or malformed extensions fail closed as `null`; callers
 * never inspect raw SDK responses, authorization material, or free-form
 * provider objects.
 */
export function readNeverminedSettlementObservation(
  value: unknown
): NeverminedSettlementObservation | null {
  if (!value || typeof value !== 'object') return null;
  const observation = (value as { nevermined_settlement_observation?: unknown })
    .nevermined_settlement_observation;
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return null;
  const v = observation as Record<string, unknown>;
  const credits = optionalCanonicalAtomic(v.credits_redeemed);
  const remaining = optionalCanonicalAtomic(v.remaining_balance);
  if (
    credits === undefined ||
    remaining === undefined ||
    typeof v.transaction !== 'string' ||
    v.transaction.length === 0 ||
    v.transaction.length > 256
  ) {
    return null;
  }
  return {
    credits_redeemed: credits,
    remaining_balance: remaining,
    transaction: v.transaction,
  };
}

export interface NeverminedEvidenceBinding {
  paymentIdentifier: string;
  agentId: string;
  planId: string;
  observedAt: string;
}

function reasonCode(value: string | undefined, fallback: string): string {
  return value && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : fallback;
}

export async function sanitizeNeverminedVerification(
  binding: NeverminedEvidenceBinding,
  result: NeverminedVerificationResult
) {
  const evidence = {
    provider: NEVERMINED_PAYMENT_PROVIDER,
    rail: 'nevermined' as const,
    payment_identifier: binding.paymentIdentifier,
    agent_id: binding.agentId,
    plan_id: binding.planId,
    payer: result.payer,
    network: result.network,
    agent_request_id: result.agentRequestId,
    result: result.isValid ? ('verified' as const) : ('rejected' as const),
    reason_code: result.isValid ? undefined : reasonCode(result.invalidReason, 'provider_rejected'),
    observed_at: binding.observedAt,
  };
  return { ...evidence, evidence_hash: await hashPaymentObject(evidence) };
}

export async function sanitizeNeverminedSettlement(
  binding: NeverminedEvidenceBinding,
  result: NeverminedSettlementResult
) {
  const evidence = {
    provider: NEVERMINED_PAYMENT_PROVIDER,
    rail: 'nevermined' as const,
    payment_identifier: binding.paymentIdentifier,
    agent_id: binding.agentId,
    plan_id: binding.planId,
    payer: result.payer,
    network: result.network,
    transaction_reference: result.transaction || undefined,
    amount_redeemed: result.creditsRedeemed,
    remaining_balance: result.remainingBalance,
    // Uses the same evidence-backed normalizer validateNeverminedSettlementResult
    // enforces (see validation.ts) so this sanitized audit record never
    // disagrees with the actual pass/fail gate about whether a real
    // settlement occurred.
    result:
      normalizeSettlementSuccess(result) === 'positive_success'
        ? ('settled' as const)
        : ('rejected' as const),
    reason_code:
      normalizeSettlementSuccess(result) === 'positive_success'
        ? undefined
        : reasonCode(result.errorReason, 'provider_rejected'),
    observed_at: binding.observedAt,
  };
  return { ...evidence, evidence_hash: await hashPaymentObject(evidence) };
}
