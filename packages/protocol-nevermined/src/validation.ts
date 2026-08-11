import { NEVERMINED_PAYMENT_PROVIDER, type SiteborneServiceId } from '@siteborne/protocol-x402';
import type {
  NeverminedPaymentRequired,
  NeverminedSettlementResult,
  NeverminedVerificationResult,
} from './client';
import { SITEBORNE_NEVERMINED_EXTENSION, type NeverminedRequirementExtension } from './requirement';

export interface NeverminedRequirementExpectation {
  resource: string;
  network: string;
  agentId: string;
  planId: string;
  serviceId?: SiteborneServiceId;
  quoteId?: string;
  requirementId?: string;
  amount?: string;
  semantics?: 'exact' | 'upto';
  expiresAt?: string;
}

export type NeverminedRequirementValidation =
  | { valid: true; paymentRequired: NeverminedPaymentRequired }
  | {
      valid: false;
      reason:
        | 'invalid_payment_required'
        | 'unsupported_x402_version'
        | 'resource_mismatch'
        | 'ambiguous_accepts'
        | 'scheme_mismatch'
        | 'network_mismatch'
        | 'plan_mismatch'
        | 'agent_mismatch'
        | 'http_verb_mismatch'
        | 'siteborne_binding_mismatch';
    };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Validates the official Nevermined X402PaymentRequired wire shape at the
 * credential-independent boundary, then binds its selected scheme to the
 * SITEBORNE route declaration. */
export function validateNeverminedPaymentRequired(
  value: unknown,
  expected: NeverminedRequirementExpectation
): NeverminedRequirementValidation {
  const required = record(value);
  if (!required || !record(required.resource) || !record(required.extensions)) {
    return { valid: false, reason: 'invalid_payment_required' };
  }
  if (required.x402Version !== 2) {
    return { valid: false, reason: 'unsupported_x402_version' };
  }
  if (record(required.resource)!.url !== expected.resource) {
    return { valid: false, reason: 'resource_mismatch' };
  }
  if (!Array.isArray(required.accepts) || required.accepts.length !== 1) {
    return { valid: false, reason: 'ambiguous_accepts' };
  }
  const accepted = record(required.accepts[0]);
  if (!accepted) return { valid: false, reason: 'invalid_payment_required' };
  if (accepted.scheme !== 'nvm:erc4337') return { valid: false, reason: 'scheme_mismatch' };
  if (accepted.network !== expected.network) return { valid: false, reason: 'network_mismatch' };
  if (accepted.planId !== expected.planId) return { valid: false, reason: 'plan_mismatch' };
  const extra = record(accepted.extra);
  if (!extra || extra.agentId !== expected.agentId) {
    return { valid: false, reason: 'agent_mismatch' };
  }
  if (extra.httpVerb !== 'POST') return { valid: false, reason: 'http_verb_mismatch' };
  if (expected.serviceId !== undefined) {
    const extension = record(
      record(required.extensions)?.[SITEBORNE_NEVERMINED_EXTENSION]
    ) as NeverminedRequirementExtension | null;
    if (
      !extension ||
      extension.version !== 1 ||
      extension.payment_rail !== 'nevermined' ||
      extension.payment_provider !== NEVERMINED_PAYMENT_PROVIDER ||
      extension.service_id !== expected.serviceId ||
      extension.route !== expected.resource ||
      extension.quote_id !== expected.quoteId ||
      extension.requirement_id !== expected.requirementId ||
      extension.amount !== expected.amount ||
      extension.semantics !== expected.semantics ||
      extension.expires_at !== expected.expiresAt ||
      extension.payment_identifier_required !== true ||
      extension.production_enabled !== false
    ) {
      return { valid: false, reason: 'siteborne_binding_mismatch' };
    }
  }
  return { valid: true, paymentRequired: value as NeverminedPaymentRequired };
}

export interface NeverminedVerificationExpectation {
  network: string;
}

export type NeverminedVerificationValidation =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'provider_rejected'
        | 'payer_missing_or_malformed'
        | 'network_mismatch'
        | 'request_identity_missing_or_malformed';
    };

export function validateNeverminedVerificationResult(
  result: NeverminedVerificationResult,
  expected: NeverminedVerificationExpectation
): NeverminedVerificationValidation {
  if (!result.isValid) return { valid: false, reason: 'provider_rejected' };
  if (!result.payer || !/^0x[a-fA-F0-9]{40}$/.test(result.payer)) {
    return { valid: false, reason: 'payer_missing_or_malformed' };
  }
  if (result.network !== expected.network) return { valid: false, reason: 'network_mismatch' };
  if (!result.agentRequestId || !/^[A-Za-z0-9_.:-]{1,256}$/.test(result.agentRequestId)) {
    return { valid: false, reason: 'request_identity_missing_or_malformed' };
  }
  return { valid: true };
}

export interface NeverminedSettlementExpectation {
  payer: string;
  network: string;
  actualAmount: string;
}

export type NeverminedSettlementValidation =
  | { valid: true; result: NeverminedSettlementResult }
  | {
      valid: false;
      reason:
        | 'provider_rejected'
        | 'payer_mismatch'
        | 'network_mismatch'
        | 'amount_mismatch'
        | 'missing_transaction';
    };

/** Settlement cannot advance the lifecycle unless the provider response is
 * successful and bound to the expected public payer, network, and actual
 * measured amount. */
export function validateNeverminedSettlementResult(
  result: NeverminedSettlementResult,
  expected: NeverminedSettlementExpectation
): NeverminedSettlementValidation {
  if (!result.success) return { valid: false, reason: 'provider_rejected' };
  if (!result.payer || result.payer.toLowerCase() !== expected.payer.toLowerCase()) {
    return { valid: false, reason: 'payer_mismatch' };
  }
  if (result.network !== expected.network) return { valid: false, reason: 'network_mismatch' };
  if (!/^\d+$/.test(expected.actualAmount) || result.creditsRedeemed !== expected.actualAmount) {
    return { valid: false, reason: 'amount_mismatch' };
  }
  if (!result.transaction || result.transaction.length > 256) {
    return { valid: false, reason: 'missing_transaction' };
  }
  return { valid: true, result };
}
