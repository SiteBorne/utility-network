/**
 * PaymentServiceLink (directive §21-22) — the immutable record connecting
 * a payment attempt to the SITEBORNE service invocation and verification
 * receipt it paid for. Deliberately separate from the signed PCC/service
 * receipt itself (@siteborne/verification's `VerificationReceipt`) — this
 * link never modifies an already-issued receipt; it only references it by
 * ID/hash.
 *
 * Reconstructable chain (directive §22):
 *
 *   payment attempt -> quote/requirement -> service invocation
 *   -> service result -> SITEBORNE verification receipt
 *
 * and later, independently:
 *
 *   payment attempt -> external verification evidence -> settlement evidence
 *
 * with this link connecting both branches. The service-receipt branch can
 * be built and hashed *before* settlement evidence exists (settlement
 * evidence fields are optional here) — settlement later binds to the
 * already-immutable receipt, never the other way around, so there is no
 * circular hash dependency.
 */
import { hashPaymentObject } from '../canonical';
import { deterministicId } from '../ids';
import type { SiteborneServiceId } from '../types';
import type { PaymentProviderIdentity, PaymentRail } from '../payment/rail';
import { providerMatchesRail } from '../payment/rail';

interface PaymentServiceLinkInputBase {
  payment_identifier: string;
  quote_id: string;
  requirement_id: string;
  service_id: SiteborneServiceId;
  service_version: 'v1' | 'v2';
  request_input_hash: string;
  job_id: string;
  service_output_hash: string;
  verification_receipt_id: string;
  verification_receipt_hash: string;
  /** `upto` only — present once usage has been calculated. */
  usage_result_hash?: string;
  /** Present once external verification evidence has been accepted. */
  verification_evidence_hash?: string;
  /** Present only once settlement evidence has been accepted — always
   * added in a *separate, later* call to `buildPaymentServiceLink`, never
   * retrofitted into an already-hashed link (see `extendWithSettlement`
   * below, which makes that explicit rather than allowing silent
   * in-place mutation). */
  settlement_evidence_hash?: string;
}

export interface PaymentServiceLinkInput extends PaymentServiceLinkInputBase {
  link_version?: 1 | 2;
  payment_rail?: PaymentRail;
  payment_provider?: PaymentProviderIdentity;
  nevermined_agent_id?: string;
  nevermined_plan_id?: string;
}

export interface PaymentServiceLink extends PaymentServiceLinkInput {
  link_id: string;
  link_hash: string;
}

function validateLinkInput(input: PaymentServiceLinkInput): void {
  if (input.link_version === undefined || input.link_version === 1) {
    if (
      input.payment_rail !== undefined ||
      input.payment_provider !== undefined ||
      input.nevermined_agent_id !== undefined ||
      input.nevermined_plan_id !== undefined
    ) {
      throw new Error('legacy v1 PaymentServiceLink cannot carry rail fields');
    }
    return;
  }
  if (!input.payment_rail || !input.payment_provider) {
    throw new Error('v2 PaymentServiceLink requires payment rail and provider');
  }
  if (!providerMatchesRail(input.payment_rail, input.payment_provider)) {
    throw new Error('PaymentServiceLink provider does not match selected rail');
  }
  if (input.payment_rail === 'nevermined') {
    if (!input.nevermined_agent_id || !input.nevermined_plan_id) {
      throw new Error('Nevermined PaymentServiceLink requires agent and plan identifiers');
    }
  } else if (input.nevermined_agent_id || input.nevermined_plan_id) {
    throw new Error('CDP PaymentServiceLink cannot carry Nevermined identifiers');
  }
}

function bindingPayload(input: PaymentServiceLinkInput): Record<string, unknown> {
  const common = {
    payment_identifier: input.payment_identifier,
    quote_id: input.quote_id,
    requirement_id: input.requirement_id,
    service_id: input.service_id,
    service_version: input.service_version,
    request_input_hash: input.request_input_hash,
    job_id: input.job_id,
    service_output_hash: input.service_output_hash,
    verification_receipt_id: input.verification_receipt_id,
    verification_receipt_hash: input.verification_receipt_hash,
    usage_result_hash: input.usage_result_hash ?? null,
    verification_evidence_hash: input.verification_evidence_hash ?? null,
    settlement_evidence_hash: input.settlement_evidence_hash ?? null,
  };
  if (input.link_version === 2) {
    return {
      link_version: 2,
      payment_rail: input.payment_rail,
      payment_provider: input.payment_provider,
      nevermined_agent_id: input.nevermined_agent_id ?? null,
      nevermined_plan_id: input.nevermined_plan_id ?? null,
      ...common,
    };
  }
  return common;
}

export async function buildPaymentServiceLink(
  input: PaymentServiceLinkInput
): Promise<PaymentServiceLink> {
  validateLinkInput(input);
  const link_hash = await hashPaymentObject(bindingPayload(input));
  const link_id = deterministicId('lnk', link_hash);
  return { ...input, link_id, link_hash };
}

/** Explicit, one-directional extension: takes an existing link (whose
 * service-receipt fields are already immutable) and produces a NEW link
 * object with settlement evidence added — never mutates the original.
 * The new link's `link_id`/`link_hash` necessarily differ, since the
 * settlement field is part of the binding; callers that need "the same
 * logical link, now with settlement" should treat this as the
 * authoritative successor record, not an in-place update. */
export async function extendWithSettlement(
  link: PaymentServiceLink,
  settlementEvidenceHash: string
): Promise<PaymentServiceLink> {
  const common = {
    payment_identifier: link.payment_identifier,
    quote_id: link.quote_id,
    requirement_id: link.requirement_id,
    service_id: link.service_id,
    service_version: link.service_version,
    request_input_hash: link.request_input_hash,
    job_id: link.job_id,
    service_output_hash: link.service_output_hash,
    verification_receipt_id: link.verification_receipt_id,
    verification_receipt_hash: link.verification_receipt_hash,
    usage_result_hash: link.usage_result_hash,
    verification_evidence_hash: link.verification_evidence_hash,
    settlement_evidence_hash: settlementEvidenceHash,
  };
  const input: PaymentServiceLinkInput =
    link.link_version === 2
      ? {
          ...common,
          link_version: 2,
          payment_rail: link.payment_rail,
          payment_provider: link.payment_provider,
          ...(link.nevermined_agent_id ? { nevermined_agent_id: link.nevermined_agent_id } : {}),
          ...(link.nevermined_plan_id ? { nevermined_plan_id: link.nevermined_plan_id } : {}),
        }
      : common;
  return buildPaymentServiceLink(input);
}

export type PaymentServiceLinkVerification =
  | { valid: true }
  | { valid: false; reason: 'MALFORMED_LINK' | 'LINK_HASH_MISMATCH' | 'LINK_ID_MISMATCH' };

/**
 * Recomputes a PaymentServiceLink from its bound public fields and compares
 * both its hash and deterministic ID. Callers use this after settlement
 * evidence is appended and before a payment is marked consumed; possession of
 * a link-shaped object is never treated as cryptographic self-verification.
 */
export async function verifyPaymentServiceLink(
  link: PaymentServiceLink
): Promise<PaymentServiceLinkVerification> {
  const { link_id, link_hash, ...input } = link;
  let rebuilt: PaymentServiceLink;
  try {
    rebuilt = await buildPaymentServiceLink(input);
  } catch {
    return { valid: false, reason: 'MALFORMED_LINK' };
  }
  if (rebuilt.link_hash !== link_hash) {
    return { valid: false, reason: 'LINK_HASH_MISMATCH' };
  }
  if (rebuilt.link_id !== link_id) {
    return { valid: false, reason: 'LINK_ID_MISMATCH' };
  }
  return { valid: true };
}
