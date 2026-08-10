/**
 * Deterministic `exact` (fixed-price) payment requirements — directive §8.
 * Builds the official @x402/core `PaymentRequirements` wire shape
 * (scheme/network/amount/asset/payTo/maxTimeoutSeconds/extra) bound to a
 * specific quote + resource, and validates a candidate requirement against
 * that binding. Never a second wire schema — this module only adds the
 * SITEBORNE-side binding and validation on top of the official type.
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

export interface BuildExactRequirementInput {
  quote: Quote;
  /** The canonical resource identity this requirement is for — see
   * docs/decisions/0041 for what "canonical" means here (service +
   * normalized request, not a volatile field). */
  resource_id: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown> | null;
}

export interface ExactRequirement {
  requirement_id: string;
  requirement: PaymentRequirements;
  binding_hash: string;
}

export class UnsupportedSchemeForExactBuilderError extends Error {
  constructor(scheme: string) {
    super(`buildExactPaymentRequirement called with quote.scheme "${scheme}", expected "exact"`);
    this.name = 'UnsupportedSchemeForExactBuilderError';
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

/** Fails closed (throws a typed error, never builds a silently-wrong
 * requirement) if the quote's scheme isn't `exact`, or if `exact` is not
 * supported on the quote's network. */
export async function buildExactPaymentRequirement(
  input: BuildExactRequirementInput
): Promise<ExactRequirement> {
  const { quote } = input;
  if (quote.scheme !== 'exact') {
    throw new UnsupportedSchemeForExactBuilderError(quote.scheme);
  }
  const support = isSchemeSupportedOnNetwork('exact', quote.network);
  if (!support.supported) {
    throw new UnsupportedSchemeNetworkCombinationError('exact', quote.network, support.reason);
  }

  const requirement: PaymentRequirements = {
    scheme: 'exact',
    network: quote.network,
    asset: quote.asset,
    amount: quote.amount,
    payTo: quote.payee,
    maxTimeoutSeconds: input.maxTimeoutSeconds,
    // `extra` is the spec's own extensibility slot — quote_id rides here
    // so a returned PaymentPayload.accepted.extra.quote_id can be checked
    // against the quote it must have come from (payload/parser.ts's
    // 'quote_mismatch'), independent of the field-by-field amount/asset/
    // network/payTo checks in validateExactRequirementBinding below.
    extra: { ...(input.extra ?? {}), quote_id: quote.quote_id },
  };

  const binding_hash = await hashPaymentObject(
    bindingPayload(requirement, input.resource_id, quote.quote_id)
  );
  const requirement_id = deterministicId('req', binding_hash);
  return { requirement_id, requirement, binding_hash };
}

export interface ExactRequirementValidationResult {
  valid: boolean;
  failures: RequirementValidationFailureReason[];
}

/** Validates a candidate `PaymentRequirements` (e.g. the `accepted` field
 * of a buyer-supplied PaymentPayload) against the quote it must have come
 * from. Reports every mismatch found, not just the first — directive §8's
 * test matrix exercises each field independently. Resource identity is
 * checked separately at the payload-parsing layer (see payload/parser.ts),
 * since `PaymentRequirements` itself carries no resource field. */
export function validateExactRequirementBinding(
  candidate: PaymentRequirements,
  quote: Quote,
  nowIso: string
): ExactRequirementValidationResult {
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
