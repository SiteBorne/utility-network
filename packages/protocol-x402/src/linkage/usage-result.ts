/**
 * The post-execution usage-result binding (directive §20) — the second
 * half of the authorization/usage split established in ADR 0044. Bound
 * *after* a service actually executes; never confused with the
 * pre-execution `upto` authorization (`requirements/upto.ts`'s
 * `PaymentAttemptBinding.amount`, always the authorized maximum).
 */
import { hashPaymentObject } from '../canonical';
import { deterministicId } from '../ids';
import type { SiteborneServiceId } from '../types';

export interface UsageResultInput {
  quote_id: string;
  requirement_id: string;
  payment_identifier: string;
  service_id: SiteborneServiceId;
  service_version: 'v1';
  request_input_hash: string;
  service_output_hash: string;
  /** The SITEBORNE PCC verification receipt's own `receipt_id` (from
   * @siteborne/verification / @siteborne/service-runtime) — never
   * modified retroactively (directive §21). */
  verification_receipt_id: string;
  /** Canonical hash of the immutable signed SITEBORNE receipt. */
  verification_receipt_hash: string;
  /** Canonical hash of whatever resource metrics produced the actual
   * amount (e.g. src/pricing/document-usage.ts's per-page metrics) —
   * never the raw metrics object itself. */
  resource_metrics_hash: string;
  pricing_source_version?: string;
  /** Atomic-unit integer string. */
  actual_amount: string;
  /** Atomic-unit integer string — the authorized maximum this usage must
   * never exceed. */
  authorized_maximum: string;
}

export interface UsageResult extends UsageResultInput {
  usage_result_id: string;
  usage_result_hash: string;
}

function bindingPayload(input: UsageResultInput): Record<string, unknown> {
  return {
    quote_id: input.quote_id,
    requirement_id: input.requirement_id,
    payment_identifier: input.payment_identifier,
    service_id: input.service_id,
    service_version: input.service_version,
    request_input_hash: input.request_input_hash,
    service_output_hash: input.service_output_hash,
    verification_receipt_id: input.verification_receipt_id,
    verification_receipt_hash: input.verification_receipt_hash,
    resource_metrics_hash: input.resource_metrics_hash,
    pricing_source_version: input.pricing_source_version ?? null,
    actual_amount: input.actual_amount,
    authorized_maximum: input.authorized_maximum,
  };
}

export class UsageExceedsAuthorizationError extends Error {
  constructor(actualAmount: string, authorizedMaximum: string) {
    super(
      `usage-result actual_amount (${actualAmount}) exceeds authorized_maximum (${authorizedMaximum})`
    );
    this.name = 'UsageExceedsAuthorizationError';
  }
}

/** Fails closed (throws) if the actual amount exceeds the authorization —
 * a usage result that would overcharge the buyer can never be
 * constructed, let alone bound (directive §19: "If execution would
 * exceed authorization: fail/stop... before exceeding max"). */
export async function buildUsageResult(input: UsageResultInput): Promise<UsageResult> {
  if (BigInt(input.actual_amount) > BigInt(input.authorized_maximum)) {
    throw new UsageExceedsAuthorizationError(input.actual_amount, input.authorized_maximum);
  }
  const usage_result_hash = await hashPaymentObject(bindingPayload(input));
  const usage_result_id = deterministicId('usg', usage_result_hash);
  return { ...input, usage_result_id, usage_result_hash };
}
