/**
 * Directive §23 — the exact synthetic end-to-end fixture lifecycle. A
 * synthetic protocol fixture, never a real payment: exact quote ->
 * requirement -> payment payload -> payment-identifier acquisition ->
 * fixture verification evidence accepted in fixture mode -> synthetic
 * "service execution" (this package does not depend on
 * @siteborne/service-runtime — the service output/receipt are modeled as
 * deterministic hashes/IDs, the same modeling discipline already used for
 * verification/settlement evidence) -> fixture settlement evidence
 * accepted -> PaymentServiceLink -> consumed.
 */
import { describe, expect, it } from 'vitest';
import { buildQuote } from '../quote/quote';
import { buildExactPaymentRequirement } from '../requirements/exact';
import { validatePaymentPayloadStructure } from '../payload/parser';
import { InMemoryPaymentAttemptRepository } from '../replay/repository';
import { acquirePaymentAttempt } from '../replay/idempotency';
import type { PaymentAttemptBinding } from '../replay/binding';
import {
  syntheticVerificationEvidenceSuccess,
  syntheticSettlementEvidenceSuccess,
} from '../evidence/fixtures';
import { canAdvanceToVerified } from '../evidence/verification';
import { canAdvanceToSettled } from '../evidence/settlement';
import { buildPaymentServiceLink, extendWithSettlement } from '../linkage/payment-service-link';
import { hashPaymentObject } from '../canonical';
import type { PaymentEvidenceContext } from '../evidence/types';
import type { PaymentPayload } from '@x402/core/types';

const RESOURCE_ID = 'https://api.siteborne.dev/v1/company_evidence_graph';
const NOW = '2026-08-09T00:01:00.000Z';

describe('exact synthetic end-to-end lifecycle (directive §23)', () => {
  it('every identity/binding lines up from quote through consumed', async () => {
    // 1. Quote + exact requirement.
    const quote = await buildQuote({
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      contract_release: '1.0.0',
      input_hash: 'sha256:' + '1'.repeat(64),
      pricing_key: 'company_evidence_graph',
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0xUSDC',
      amount: '39000',
      payee: '0xPayee',
      issued_at: '2026-08-09T00:00:00.000Z',
      expires_at: '2026-08-09T00:10:00.000Z',
    });
    const { requirement, requirement_id } = await buildExactPaymentRequirement({
      quote,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 60,
    });

    // 2. Buyer payment payload, structurally validated.
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: { url: RESOURCE_ID },
      accepted: requirement,
      payload: { signature: '0xsynthetic' },
    };
    const structural = validatePaymentPayloadStructure(payload, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(structural.status).toBe('valid_structure');

    // 3. Payment-identifier / replay acquisition (checkpoint 2).
    const paymentIdentifier = 'pay_' + 'e'.repeat(28);
    const binding: PaymentAttemptBinding = {
      payment_identifier: paymentIdentifier,
      quote_id: quote.quote_id,
      requirement_id,
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      contract_release: quote.contract_release,
      request_input_hash: quote.input_hash,
      resource_id: RESOURCE_ID,
      scheme: 'exact',
      network: quote.network,
      asset: quote.asset,
      amount: quote.amount,
      payee: quote.payee,
    };
    const repo = new InMemoryPaymentAttemptRepository();
    const acquisition = await acquirePaymentAttempt(repo, {
      binding,
      nowIso: NOW,
      ttlMs: 5 * 60 * 1000,
    });
    expect(acquisition.status).toBe('first_seen');

    // 4. Fixture verification evidence, accepted only in fixture mode.
    const evidenceContext: PaymentEvidenceContext = {
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      scheme: 'exact',
      network: quote.network,
      asset: quote.asset,
      payee: quote.payee,
      quote_id: quote.quote_id,
      requirement_id,
      payment_identifier: paymentIdentifier,
      amount: quote.amount,
      nowIso: NOW,
      expiresAt: quote.expires_at,
    };
    const verificationEvidence = await syntheticVerificationEvidenceSuccess(evidenceContext);
    const verifiedGate = canAdvanceToVerified(verificationEvidence, evidenceContext, 'fixture');
    expect(verifiedGate).toEqual({ allowed: true });

    // 5. Synthetic "service execution": this package does not depend on
    // @siteborne/service-runtime — output/receipt are modeled hashes/IDs,
    // matching the same evidence-modeling discipline used above.
    const jobId = 'job_' + 'f'.repeat(24);
    const serviceOutputHash = await hashPaymentObject({ synthetic_output: true, jobId });
    const verificationReceiptId = 'rcpt_' + '1'.repeat(24);
    const verificationReceiptHash = await hashPaymentObject({ synthetic_receipt: true, jobId });

    // 6. Fixture settlement evidence, bound to the verification evidence.
    const verificationEvidenceHash = await hashPaymentObject(verificationEvidence);
    const settlementEvidence = await syntheticSettlementEvidenceSuccess(
      evidenceContext,
      verificationEvidenceHash,
      quote.amount
    );
    const settledGate = canAdvanceToSettled(
      settlementEvidence,
      evidenceContext,
      'fixture',
      verificationEvidenceHash
    );
    expect(settledGate).toEqual({ allowed: true });

    // 7. PaymentServiceLink — built with the immutable receipt fields,
    // then extended with settlement, never mutated in place.
    const link = await buildPaymentServiceLink({
      payment_identifier: paymentIdentifier,
      quote_id: quote.quote_id,
      requirement_id: evidenceContext.requirement_id,
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      request_input_hash: quote.input_hash,
      job_id: jobId,
      service_output_hash: serviceOutputHash,
      verification_receipt_id: verificationReceiptId,
      verification_receipt_hash: verificationReceiptHash,
      verification_evidence_hash: verificationEvidenceHash,
    });
    const settlementEvidenceHash = await hashPaymentObject(settlementEvidence);
    const finalLink = await extendWithSettlement(link, settlementEvidenceHash);
    expect(finalLink.settlement_evidence_hash).toBe(settlementEvidenceHash);
    expect(finalLink.payment_identifier).toBe(paymentIdentifier);
    expect(finalLink.quote_id).toBe(quote.quote_id);

    // 8. Consumed.
    await repo.markConsumed(paymentIdentifier);
    const consumedOutcome = await acquirePaymentAttempt(repo, {
      binding,
      nowIso: '2026-08-09T00:02:00.000Z',
      ttlMs: 5 * 60 * 1000,
    });
    expect(consumedOutcome.status).toBe('already_consumed');
  });
});
