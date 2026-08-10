/**
 * The canonical x402 V2 402 challenge builder (directive §11). Constructs
 * the official @x402/core `PaymentRequired` shape
 * (`x402Version`/`resource`/`accepts[]`/`extensions`) — validated against
 * @x402/core's own `PaymentRequiredV2Schema` (via `isPaymentRequiredV2`)
 * before being returned, so a malformed challenge can never leave this
 * function. Bazaar-specific metadata (directive §24) is a later
 * checkpoint; `extensions` is accepted here only as a pass-through slot.
 */
import { isPaymentRequiredV2 } from '@x402/core/schemas';
import type { PaymentRequired, PaymentRequirements, ResourceInfo } from '@x402/core/types';
import { SUPPORTED_X402_VERSION } from '../version';

export interface BuildPaymentRequiredInput {
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  error?: string;
  extensions?: Record<string, unknown>;
}

export class InvalidPaymentRequiredInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPaymentRequiredInputError';
  }
}

/** Hard bound on the number of simultaneous payment options a single
 * challenge may advertise — an unbounded `accepts[]` is both a real DoS
 * surface for any client that must evaluate it and a signal something
 * upstream is generating challenges incorrectly. */
export const MAX_ACCEPTS_LENGTH = 8;

/** Fails closed (throws a typed, caller-catchable error) rather than ever
 * returning a `PaymentRequired` object that doesn't validate against the
 * official V2 schema. */
export function buildPaymentRequired(input: BuildPaymentRequiredInput): PaymentRequired {
  if (!Array.isArray(input.accepts) || input.accepts.length === 0) {
    throw new InvalidPaymentRequiredInputError('accepts[] must be a non-empty array');
  }
  if (input.accepts.length > MAX_ACCEPTS_LENGTH) {
    throw new InvalidPaymentRequiredInputError(
      `accepts[] length ${input.accepts.length} exceeds MAX_ACCEPTS_LENGTH (${MAX_ACCEPTS_LENGTH})`
    );
  }
  const seen = new Set<string>();
  for (const req of input.accepts) {
    // Requirement identity for uniqueness purposes: scheme+network+asset+
    // amount+payTo — two accepts entries offering literally the same
    // payment on the same terms is never a legitimate distinct option.
    const key = `${req.scheme}|${req.network}|${req.asset}|${req.amount}|${req.payTo}`;
    if (seen.has(key)) {
      throw new InvalidPaymentRequiredInputError(
        `duplicate payment requirement in accepts[]: ${key}`
      );
    }
    seen.add(key);
  }

  const candidate: PaymentRequired = {
    x402Version: SUPPORTED_X402_VERSION,
    resource: input.resource,
    accepts: input.accepts,
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.extensions !== undefined ? { extensions: input.extensions } : {}),
  };

  if (!isPaymentRequiredV2(candidate)) {
    throw new InvalidPaymentRequiredInputError(
      'constructed PaymentRequired object does not validate against the official V2 schema'
    );
  }

  return candidate;
}
