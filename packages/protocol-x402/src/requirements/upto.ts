/**
 * `upto` (usage-based) payment requirements (directive §8). Semantics:
 * the buyer authorizes a *maximum*; the amount actually charged (measured
 * after the SITEBORNE service executes) may be anywhere in
 * `0 <= actual <= maximum`. This module builds and validates the
 * **authorization** — the buyer-facing maximum, bound to a quote before
 * execution. Actual usage measurement lives in
 * `src/pricing/document-usage.ts`; the two are deliberately two different
 * bindings (directive §26) — the pre-execution authorization can never
 * depend on a not-yet-known final usage number.
 *
 * `upto` is currently EVM-only in the official x402 implementation
 * (Permit2) — see network/schemes.ts. This module never builds an `upto`
 * requirement on a non-EVM network.
 */
import type { PaymentRequirements } from '@x402/core/types';
import { hashPaymentObject } from '../canonical';
import { deterministicId } from '../ids';
import {
  isSchemeSupportedOnNetwork,
  UnsupportedSchemeNetworkCombinationError,
} from '../network/schemes';
import type { Quote } from '../quote/quote';
import type { RequirementValidationFailureReason } from '../errors';

export interface BuildUptoRequirementInput {
  quote: Quote;
  resource_id: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown> | null;
}

export interface UptoRequirement {
  requirement_id: string;
  requirement: PaymentRequirements;
  binding_hash: string;
}

export class UnsupportedSchemeForUptoBuilderError extends Error {
  constructor(scheme: string) {
    super(`buildUptoPaymentRequirement called with quote.scheme "${scheme}", expected "upto"`);
    this.name = 'UnsupportedSchemeForUptoBuilderError';
  }
}

function bindingPayload(requirement: PaymentRequirements, resourceId: string, quoteId: string) {
  return {
    quote_id: quoteId,
    resource_id: resourceId,
    scheme: requirement.scheme,
    network: requirement.network,
    amount: requirement.amount,
    asset: requirement.asset,
    payTo: requirement.payTo,
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
  };
}

/** Fails closed (throws a typed error) if the quote's scheme isn't
 * `upto`, or if `upto` is not supported on the quote's network (i.e. the
 * network is not EVM). `requirement.amount` here is the **authorized
 * maximum**, not an actual charge. */
export async function buildUptoPaymentRequirement(
  input: BuildUptoRequirementInput
): Promise<UptoRequirement> {
  const { quote } = input;
  if (quote.scheme !== 'upto') {
    throw new UnsupportedSchemeForUptoBuilderError(quote.scheme);
  }
  const support = isSchemeSupportedOnNetwork('upto', quote.network);
  if (!support.supported) {
    throw new UnsupportedSchemeNetworkCombinationError('upto', quote.network, support.reason);
  }

  const requirement: PaymentRequirements = {
    scheme: 'upto',
    network: quote.network,
    asset: quote.asset,
    amount: quote.amount, // the authorized maximum, per PaymentRequirements' single `amount` field
    payTo: quote.payee,
    maxTimeoutSeconds: input.maxTimeoutSeconds,
    extra: { ...(input.extra ?? {}), quote_id: quote.quote_id },
  };

  const binding_hash = await hashPaymentObject(
    bindingPayload(requirement, input.resource_id, quote.quote_id)
  );
  const requirement_id = deterministicId('req', binding_hash);
  return { requirement_id, requirement, binding_hash };
}

export interface UptoRequirementValidationResult {
  valid: boolean;
  failures: RequirementValidationFailureReason[];
}

/** Validates a candidate `PaymentRequirements` (the buyer-echoed
 * authorization) against the quote it must have come from — the same
 * field-by-field discipline as `validateExactRequirementBinding`, except
 * `amount` here means the authorized *maximum*, so this checks
 * `candidate.amount === quote.amount` (the maximum), never an actual
 * charge (that binding is separate — see `validateUptoAuthorization` in
 * this module, and `src/pricing/document-usage.ts`). */
export function validateUptoRequirementBinding(
  candidate: PaymentRequirements,
  quote: Quote,
  nowIso: string
): UptoRequirementValidationResult {
  const failures: RequirementValidationFailureReason[] = [];

  if (candidate.amount !== quote.amount) failures.push('amount_mismatch');
  if (candidate.asset !== quote.asset) failures.push('asset_mismatch');
  if (candidate.network !== quote.network) failures.push('network_mismatch');
  if (!isValidPayee(candidate.payTo)) failures.push('payee_malformed');
  else if (candidate.payTo !== quote.payee) failures.push('payee_mismatch');
  if (new Date(nowIso).getTime() >= new Date(quote.expires_at).getTime()) {
    failures.push('quote_expired');
  }

  return { valid: failures.length === 0, failures };
}

function isValidPayee(payTo: string): boolean {
  return typeof payTo === 'string' && payTo.length > 0 && !/\s/.test(payTo);
}

export type UptoAuthorizationOutcome =
  | 'valid'
  | 'actual_exceeds_maximum'
  | 'requirement_mismatch'
  | 'quote_mismatch'
  | 'resource_mismatch'
  | 'unsupported_network'
  | 'invalid_amount'
  | 'expired';

export interface ValidateUptoAuthorizationInput {
  requirement: PaymentRequirements;
  /** Atomic-unit integer string — the amount that would actually be
   * charged. Never a JS `number`; see canonical/actual-amount parsing
   * below (never implicit `Number()` conversion — scientific notation,
   * leading `+`, and non-integer strings are all rejected). */
  actualAmount: string;
  quote: Quote;
  /** The canonical resource identity of the request actually being
   * served, and (optionally) the resource identity the payload itself
   * declared it was for — compared directly here, since `resourceId` is
   * this function's own caller-supplied context, not a field of
   * `PaymentRequirements` (which carries no resource identity at all; see
   * `requirements/exact.ts`'s equivalent note). Pass the same value for
   * both when the caller has no separate payload-declared resource to
   * check (mirrors how `payload/parser.ts` treats an absent
   * `payload.resource` as "not independently checkable"). */
  resourceId: string;
  payloadResourceId?: string;
  nowIso: string;
}

/** Pure, closed validation of an `upto` authorization against a proposed
 * actual charge (directive §11). This does **not** mean the payment was
 * cryptographically verified or settled — it only proves the proposed
 * actual amount is structurally consistent with what was authorized.
 * Real settlement/verification is SUN-0700B's concern. */
export function validateUptoAuthorization(
  input: ValidateUptoAuthorizationInput
): UptoAuthorizationOutcome {
  const { requirement, actualAmount, quote, resourceId, payloadResourceId, nowIso } = input;

  if (requirement.scheme !== 'upto') return 'requirement_mismatch';

  const networkSupport = isSchemeSupportedOnNetwork('upto', requirement.network);
  if (!networkSupport.supported) return 'unsupported_network';

  const quoteIdInRequirement = requirement.extra?.['quote_id'];
  if (quoteIdInRequirement !== quote.quote_id) return 'quote_mismatch';

  if (payloadResourceId !== undefined && payloadResourceId !== resourceId) {
    return 'resource_mismatch';
  }

  if (new Date(nowIso).getTime() >= new Date(quote.expires_at).getTime()) return 'expired';

  const binding = validateUptoRequirementBinding(requirement, quote, nowIso);
  if (!binding.valid) {
    if (binding.failures.includes('quote_expired')) return 'expired';
    return 'requirement_mismatch';
  }

  if (!isCanonicalAtomicAmount(actualAmount)) return 'invalid_amount';
  if (!isCanonicalAtomicAmount(requirement.amount)) return 'invalid_amount';

  if (BigInt(actualAmount) > BigInt(requirement.amount)) return 'actual_exceeds_maximum';

  return 'valid';
}

/** A canonical atomic-unit amount is a non-negative base-10 integer
 * string — no sign, no decimal point, no scientific notation, no leading
 * zeros beyond a single `0`, no empty string. Never parsed via `Number()`
 * (which would silently accept `"1e5"` or lose precision on very large
 * integers). */
export function isCanonicalAtomicAmount(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value === '0') return true;
  return /^[1-9][0-9]*$/.test(value);
}
