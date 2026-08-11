import { NEVERMINED_PAYMENT_PROVIDER, hashPaymentObject } from '@siteborne/protocol-x402';
import type { NeverminedSettlementResult, NeverminedVerificationResult } from './client';

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
    result: result.success ? ('settled' as const) : ('rejected' as const),
    reason_code: result.success ? undefined : reasonCode(result.errorReason, 'provider_rejected'),
    observed_at: binding.observedAt,
  };
  return { ...evidence, evidence_hash: await hashPaymentObject(evidence) };
}
