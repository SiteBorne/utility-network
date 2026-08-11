/**
 * The immutable payment-attempt binding (directive §7, §16) — a typed
 * internal payment-attempt identity distinct from the external
 * `payment_identifier` (an idempotency *coordinate*, not proof of
 * payment). Every replay/idempotency decision in this package is made by
 * comparing binding digests, never by trusting `payment_identifier` alone.
 */
import { hashPaymentObject } from '../canonical';
import type { SiteborneServiceId } from '../types';
import type { Network } from '@x402/core/types';
import {
  CDP_PAYMENT_PROVIDER,
  NEVERMINED_PAYMENT_PROVIDER,
  providerMatchesRail,
  type PaymentProviderIdentity,
  type PaymentRail,
} from '../payment/rail';

interface PaymentAttemptBindingBase {
  payment_identifier: string;
  quote_id: string;
  requirement_id: string;
  service_id: SiteborneServiceId;
  service_version: 'v1';
  contract_release: string;
  /** The frozen PCC-style `sha256:<hex>` input hash of the request this
   * payment attempt is for. */
  request_input_hash: string;
  resource_id: string;
  scheme: 'exact' | 'upto';
  network: Network;
  asset: string;
  /** For `exact`: the exact amount. For `upto`: the authorized maximum.
   * Never the post-execution actual usage amount — that is a separate,
   * later binding (directive §26; see requirements/upto.ts). */
  amount: string;
  payee: string;
  /** Optional — present when this payment attempt is tied to a specific
   * SITEBORNE job. */
  job_id?: string;
  /** Optional — an HTTP-request-level idempotency key, if the caller has
   * one distinct from the payment identifier itself (directive §6: "Keep
   * these concepts distinct"). */
  idempotency_key?: string;
}

/** Version 1 is the accepted historical shape; version 2 is rail-aware.
 * The fields remain optional at this storage boundary so legacy rows can be
 * represented exactly, while `validatePaymentAttemptBinding` enforces the
 * discriminated v2 invariants before any new row is written. */
export interface PaymentAttemptBinding extends PaymentAttemptBindingBase {
  binding_version?: 1 | 2;
  payment_rail?: PaymentRail;
  payment_provider?: PaymentProviderIdentity;
  nevermined_agent_id?: string;
  nevermined_plan_id?: string;
}

export type PaymentAttemptBindingValidation =
  | { valid: true; version: 1 | 2 }
  | { valid: false; reason: string };

export function validatePaymentAttemptBinding(
  binding: PaymentAttemptBinding
): PaymentAttemptBindingValidation {
  if (binding.binding_version === undefined || binding.binding_version === 1) {
    if (
      binding.payment_rail !== undefined ||
      binding.payment_provider !== undefined ||
      binding.nevermined_agent_id !== undefined ||
      binding.nevermined_plan_id !== undefined
    ) {
      return { valid: false, reason: 'legacy_v1_binding_cannot_carry_rail_fields' };
    }
    return { valid: true, version: 1 };
  }
  if (binding.binding_version !== 2) {
    return { valid: false, reason: 'unsupported_binding_version' };
  }
  if (!binding.payment_rail || !binding.payment_provider) {
    return { valid: false, reason: 'v2_binding_requires_rail_and_provider' };
  }
  if (!providerMatchesRail(binding.payment_rail, binding.payment_provider)) {
    return { valid: false, reason: 'payment_provider_does_not_match_rail' };
  }
  if (binding.payment_rail === 'nevermined') {
    if (!binding.nevermined_agent_id || !binding.nevermined_plan_id) {
      return { valid: false, reason: 'nevermined_binding_requires_agent_and_plan' };
    }
  } else if (binding.nevermined_agent_id || binding.nevermined_plan_id) {
    return { valid: false, reason: 'cdp_binding_cannot_carry_nevermined_identifiers' };
  }
  return { valid: true, version: 2 };
}

export class InvalidPaymentAttemptBindingError extends Error {
  constructor(public readonly reason: string) {
    super(`invalid payment-attempt binding: ${reason}`);
    this.name = 'InvalidPaymentAttemptBindingError';
  }
}

/** Every field that participates in the immutable binding digest.
 * `job_id`/`idempotency_key` are deliberately included when present
 * (mutable operational metadata like a transport request ID or a
 * timestamp is never part of this — see replay/retry.ts) but normalized
 * to `null` when absent, so an omitted vs. explicitly-null field never
 * silently changes the digest in a way callers can't reason about. */
function digestPayload(binding: PaymentAttemptBinding): Record<string, unknown> {
  const common = {
    payment_identifier: binding.payment_identifier,
    quote_id: binding.quote_id,
    requirement_id: binding.requirement_id,
    service_id: binding.service_id,
    service_version: binding.service_version,
    contract_release: binding.contract_release,
    request_input_hash: binding.request_input_hash,
    resource_id: binding.resource_id,
    scheme: binding.scheme,
    network: binding.network,
    asset: binding.asset,
    amount: binding.amount,
    payee: binding.payee,
    job_id: binding.job_id ?? null,
    idempotency_key: binding.idempotency_key ?? null,
  };
  if (binding.binding_version === 2) {
    return {
      binding_version: 2,
      payment_rail: binding.payment_rail,
      payment_provider: binding.payment_provider,
      nevermined_agent_id: binding.nevermined_agent_id ?? null,
      nevermined_plan_id: binding.nevermined_plan_id ?? null,
      ...common,
    };
  }
  return common;
}

/** Canonical, key-order-independent digest of a payment attempt's
 * immutable binding. Two bindings with the same logical field values
 * (regardless of construction order) always produce the same digest;
 * mutating any bound field changes it (proven by property test). */
export async function computeBindingDigest(binding: PaymentAttemptBinding): Promise<string> {
  const validation = validatePaymentAttemptBinding(binding);
  if (!validation.valid) throw new InvalidPaymentAttemptBindingError(validation.reason);
  return hashPaymentObject(digestPayload(binding));
}

/** True only when every immutable field matches exactly — the retry vs.
 * conflict distinction (directive §21) is built entirely on this. */
export function bindingsAreIdentical(a: PaymentAttemptBinding, b: PaymentAttemptBinding): boolean {
  if (!validatePaymentAttemptBinding(a).valid || !validatePaymentAttemptBinding(b).valid) {
    return false;
  }
  const da = digestPayload(a);
  const db = digestPayload(b);
  const keys = new Set([...Object.keys(da), ...Object.keys(db)]);
  return [...keys].every((key) => da[key] === db[key]);
}

export {
  CDP_PAYMENT_PROVIDER,
  NEVERMINED_PAYMENT_PROVIDER,
  type PaymentProviderIdentity,
  type PaymentRail,
};
