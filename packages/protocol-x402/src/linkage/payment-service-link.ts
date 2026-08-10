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

export interface PaymentServiceLinkInput {
  payment_identifier: string;
  quote_id: string;
  requirement_id: string;
  service_id: SiteborneServiceId;
  service_version: 'v1';
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

export interface PaymentServiceLink extends PaymentServiceLinkInput {
  link_id: string;
  link_hash: string;
}

function bindingPayload(input: PaymentServiceLinkInput): Record<string, unknown> {
  return {
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
}

export async function buildPaymentServiceLink(
  input: PaymentServiceLinkInput
): Promise<PaymentServiceLink> {
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
  const input: PaymentServiceLinkInput = {
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
  return buildPaymentServiceLink(input);
}
