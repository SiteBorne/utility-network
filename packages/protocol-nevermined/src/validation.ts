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
  // The official SDK's own VerifyPermissionsResult declares `network` as
  // optional (unlike SettlePermissionsResult, where it's required) — the
  // real sandbox facilitator's verifyPermissions response was observed
  // (SUN-0900B checkpoint 1B live run) to omit it entirely on an
  // otherwise-valid verification. Absence is therefore not itself a
  // mismatch; a *present* value that disagrees with the expected network
  // is still rejected — the network is already established out-of-band
  // by the plan's own registered network and the request's own
  // `paymentRequired.accepts[].network`, so this remains a genuine
  // cross-check whenever the facilitator actually supplies a value.
  if (result.network !== undefined && result.network !== expected.network) {
    return { valid: false, reason: 'network_mismatch' };
  }
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
        | 'ambiguous_settlement'
        | 'payer_mismatch'
        | 'network_mismatch'
        | 'amount_mismatch'
        | 'missing_transaction';
    };

/** A settlement-scheme-scoped (provider `nevermined-payments@1.10.0`,
 * scheme `nvm:erc4337`) positive-success normalizer — never a generic
 * "missing means success" rule.
 *
 * `result.success` is declared non-optional on the official SDK's
 * `SettlePermissionsResult` type, but two independently, authoritatively
 * confirmed real ERC-4337 sandbox settlements (SUN-0900B checkpoint 1B —
 * both later verified `status: "succeeded"` via the read-only
 * `GET /delegation/{id}/transactions` endpoint, with matching
 * `providerTransactionId`s and amounts) both arrived with `success`
 * absent at runtime. Nevermined's own official TypeScript integration
 * guide exhibits the same trust boundary: it never reads
 * `settlement.success` at all, treating a resolved `settlePermissions()`
 * call plus a real `settlement.txHash` as sufficient to build its own
 * receipt. This function encodes that exact, evidence-backed contract —
 * not a permissive fallback:
 *
 * - `result.success === false` → EXPLICIT_FAILURE, always rejected,
 *   regardless of any other field (an explicit failure is authoritative
 *   over everything else).
 * - `result.success === true` → POSITIVE_SUCCESS (unchanged from before).
 * - `result.success === undefined` → POSITIVE_SUCCESS only when a real,
 *   bounded, non-empty `transaction` reference is present; otherwise
 *   AMBIGUOUS.
 * - `result.success` present but neither `true` nor `false` (some other
 *   value) → AMBIGUOUS; never guessed.
 */
export function normalizeSettlementSuccess(
  result: NeverminedSettlementResult
): 'positive_success' | 'explicit_failure' | 'ambiguous' {
  if (result.success === false) return 'explicit_failure';
  if (result.success === true) return 'positive_success';
  if (result.success !== undefined) return 'ambiguous'; // present, not a plain boolean — never guessed
  const hasRealTransaction =
    typeof result.transaction === 'string' &&
    result.transaction.length > 0 &&
    result.transaction.length <= 256;
  return hasRealTransaction ? 'positive_success' : 'ambiguous';
}

/** Settlement cannot advance the lifecycle unless the provider response
 * carries positive success evidence (see `normalizeSettlementSuccess`)
 * and is bound to the expected public payer, network, and actual
 * measured amount. */
export function validateNeverminedSettlementResult(
  result: NeverminedSettlementResult,
  expected: NeverminedSettlementExpectation
): NeverminedSettlementValidation {
  const success = normalizeSettlementSuccess(result);
  if (success === 'explicit_failure') return { valid: false, reason: 'provider_rejected' };
  if (success === 'ambiguous') return { valid: false, reason: 'ambiguous_settlement' };
  // Both `payer` and `network` are declared optional on the official
  // SDK's SettlePermissionsResult (same as VerifyPermissionsResult —
  // see validateNeverminedVerificationResult above) and were observed
  // absent on an otherwise-genuine, independently-confirmed real
  // settlement against the sandbox facilitator (SUN-0900B checkpoint
  // 1B: delegation transactionCount/amountSpentCents/status all
  // confirmed the charge occurred for real, read-only, after this
  // exact rejection). Absence is not itself a mismatch; a *present*
  // value that disagrees with the expected one is still rejected. The
  // actual authorization boundary here is the facilitator accepting
  // the signed, delegation-bound x402 access token in the first
  // place — these fields are an audit/evidence nicety, not the
  // security gate.
  if (result.payer !== undefined && result.payer.toLowerCase() !== expected.payer.toLowerCase()) {
    return { valid: false, reason: 'payer_mismatch' };
  }
  if (result.network !== undefined && result.network !== expected.network) {
    return { valid: false, reason: 'network_mismatch' };
  }
  if (!/^\d+$/.test(expected.actualAmount)) {
    return { valid: false, reason: 'amount_mismatch' };
  }
  // `creditsRedeemed` is likewise optional on the SDK type and was
  // absent alongside payer/network on the same real settlement above —
  // absence alone doesn't invalidate it. A *present* value that
  // disagrees with the amount SITEBORNE itself requested (never a
  // facilitator-supplied value) is still rejected. The evidence this
  // function's caller records always uses the caller-supplied
  // `actualAmount`, never `result.creditsRedeemed` — see
  // apps/edge-api/src/control-plane/evidence/nevermined-provider.ts's
  // `settle()` — so this relaxation cannot let a facilitator claim a
  // different settled amount than the one SITEBORNE's own already-
  // validated usage/pricing logic computed.
  if (result.creditsRedeemed !== undefined && result.creditsRedeemed !== expected.actualAmount) {
    return { valid: false, reason: 'amount_mismatch' };
  }
  if (!result.transaction || result.transaction.length > 256) {
    return { valid: false, reason: 'missing_transaction' };
  }
  return { valid: true, result };
}
