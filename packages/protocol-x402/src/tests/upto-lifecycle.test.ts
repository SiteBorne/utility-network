/**
 * Directive §24 — the upto synthetic end-to-end fixture lifecycle. Upto
 * quote -> max authorization -> payment identifier -> fixture
 * verification evidence -> "authorized/verified" -> document fixture
 * executes (SUN-0400A metrics, via document-usage.ts, the same real
 * per-page pricing calculation checkpoint 2 built) -> synthetic service
 * result/receipt -> usage_result_hash -> actual amount -> fixture
 * settlement evidence -> settled -> PaymentServiceLink. A synthetic
 * protocol fixture, never a real payment.
 */
import { describe, expect, it } from 'vitest';
import { buildQuote } from '../quote/quote';
import { buildUptoPaymentRequirement } from '../requirements/upto';
import { validatePaymentPayloadStructure } from '../payload/parser';
import { InMemoryPaymentAttemptRepository } from '../replay/repository';
import { acquirePaymentAttempt } from '../replay/idempotency';
import type { PaymentAttemptBinding } from '../replay/binding';
import { calculateDocumentUsage, documentUsageToAtomicUnits } from '../pricing/document-usage';
import type { DocumentPageUsageMetrics } from '../pricing/document-usage';
import {
  syntheticVerificationEvidenceSuccess,
  syntheticSettlementEvidenceSuccess,
} from '../evidence/fixtures';
import { canAdvanceToVerified } from '../evidence/verification';
import { canAdvanceToSettled } from '../evidence/settlement';
import { buildUsageResult } from '../linkage/usage-result';
import { buildPaymentServiceLink, extendWithSettlement } from '../linkage/payment-service-link';
import { hashPaymentObject } from '../canonical';
import type { PaymentEvidenceContext } from '../evidence/types';
import type { PaymentPayload } from '@x402/core/types';

const RESOURCE_ID = 'https://api.siteborne.dev/v1/document_evidence_json';
const NOW = '2026-08-09T00:01:00.000Z';

describe('upto synthetic end-to-end lifecycle (directive §24)', () => {
  it('actual usage never exceeds the authorized maximum, and every identity/binding lines up', async () => {
    // 1. Quote at the max-job ceiling (an upto authorization is always
    // quoted at the service's declared maximum, per ADR 0044).
    const quote = await buildQuote({
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      contract_release: '1.0.0',
      input_hash: 'sha256:' + '1'.repeat(64),
      pricing_key: 'document_evidence_json_max_job',
      scheme: 'upto',
      network: 'eip155:8453',
      asset: '0xUSDC',
      amount: '190000',
      payee: '0xPayee',
      issued_at: '2026-08-09T00:00:00.000Z',
      expires_at: '2026-08-09T00:10:00.000Z',
    });
    const { requirement, requirement_id } = await buildUptoPaymentRequirement({
      quote,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });

    // 2. Buyer payment payload (authorization), structurally validated.
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

    // 3. Payment-identifier / replay acquisition.
    const paymentIdentifier = 'pay_' + 'd'.repeat(28);
    const binding: PaymentAttemptBinding = {
      payment_identifier: paymentIdentifier,
      quote_id: quote.quote_id,
      requirement_id,
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      contract_release: quote.contract_release,
      request_input_hash: quote.input_hash,
      resource_id: RESOURCE_ID,
      scheme: 'upto',
      network: quote.network,
      asset: quote.asset,
      amount: quote.amount, // the authorized maximum
      payee: quote.payee,
    };
    const repo = new InMemoryPaymentAttemptRepository();
    const acquisition = await acquirePaymentAttempt(repo, {
      binding,
      nowIso: NOW,
      ttlMs: 5 * 60 * 1000,
    });
    expect(acquisition.status).toBe('first_seen');

    // 4. Fixture verification evidence — the buyer's authorization is
    // "verified" before execution; the actual amount is not yet known.
    const evidenceContext: PaymentEvidenceContext = {
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      scheme: 'upto',
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

    // 5. Document fixture "executes" — real per-page pricing calculation
    // (checkpoint 2's document-usage.ts), bounded work only.
    const pages: DocumentPageUsageMetrics[] = [
      { page_number: 1, ocr_used: false, table_count: 0 }, // native
      { page_number: 2, ocr_used: true, table_count: 0 }, // ocr
      { page_number: 3, ocr_used: false, table_count: 1 }, // table
    ];
    const usageCalculation = calculateDocumentUsage(pages);
    const actualAmount = documentUsageToAtomicUnits(usageCalculation, 6);
    expect(BigInt(actualAmount)).toBeLessThanOrEqual(BigInt(quote.amount));

    // 6. Synthetic service result/receipt.
    const jobId = 'job_' + 'a'.repeat(24);
    const serviceOutputHash = await hashPaymentObject({ synthetic_output: true, jobId, pages });
    const verificationReceiptId = 'rcpt_' + '2'.repeat(24);
    const verificationReceiptHash = await hashPaymentObject({ synthetic_receipt: true, jobId });
    const resourceMetricsHash = await hashPaymentObject(usageCalculation);

    // 7. usage_result_hash binds actual usage to the receipt/output —
    // never exceeds the authorized maximum (buildUsageResult throws
    // otherwise, proven separately in linkage/usage-result.test.ts).
    const usageResult = await buildUsageResult({
      quote_id: quote.quote_id,
      requirement_id,
      payment_identifier: paymentIdentifier,
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      request_input_hash: quote.input_hash,
      service_output_hash: serviceOutputHash,
      verification_receipt_id: verificationReceiptId,
      resource_metrics_hash: resourceMetricsHash,
      pricing_source_version: '1.0.0',
      actual_amount: actualAmount,
      authorized_maximum: quote.amount,
    });
    expect(BigInt(usageResult.actual_amount)).toBeLessThanOrEqual(
      BigInt(usageResult.authorized_maximum)
    );

    // 8. Fixture settlement evidence — actual amount from the usage
    // result, bound to the verification evidence.
    const verificationEvidenceHash = await hashPaymentObject(verificationEvidence);
    const settlementEvidence = await syntheticSettlementEvidenceSuccess(
      evidenceContext,
      verificationEvidenceHash,
      usageResult.actual_amount,
      { usage_result_hash: usageResult.usage_result_hash, authorized_maximum: quote.amount }
    );
    const settledGate = canAdvanceToSettled(
      settlementEvidence,
      evidenceContext,
      'fixture',
      verificationEvidenceHash
    );
    expect(settledGate).toEqual({ allowed: true });

    // 9. PaymentServiceLink, extended with settlement.
    const link = await buildPaymentServiceLink({
      payment_identifier: paymentIdentifier,
      quote_id: quote.quote_id,
      requirement_id,
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      request_input_hash: quote.input_hash,
      job_id: jobId,
      service_output_hash: serviceOutputHash,
      verification_receipt_id: verificationReceiptId,
      verification_receipt_hash: verificationReceiptHash,
      usage_result_hash: usageResult.usage_result_hash,
      verification_evidence_hash: verificationEvidenceHash,
    });
    const settlementEvidenceHash = await hashPaymentObject(settlementEvidence);
    const finalLink = await extendWithSettlement(link, settlementEvidenceHash);
    expect(finalLink.usage_result_hash).toBe(usageResult.usage_result_hash);
    expect(finalLink.settlement_evidence_hash).toBe(settlementEvidenceHash);
  });

  it('mutating usage metrics after the fact changes the usage_result_hash, breaking link/settlement consistency', async () => {
    const pagesA: DocumentPageUsageMetrics[] = [
      { page_number: 1, ocr_used: false, table_count: 0 },
    ];
    const pagesB: DocumentPageUsageMetrics[] = [{ page_number: 1, ocr_used: true, table_count: 0 }];
    const calcA = calculateDocumentUsage(pagesA);
    const calcB = calculateDocumentUsage(pagesB);
    const hashA = await hashPaymentObject(calcA);
    const hashB = await hashPaymentObject(calcB);
    expect(hashA).not.toBe(hashB);

    const usageResultA = await buildUsageResult({
      quote_id: 'qte_' + '1'.repeat(24),
      requirement_id: 'req_' + '1'.repeat(24),
      payment_identifier: 'pay_' + '1'.repeat(28),
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      request_input_hash: 'sha256:' + '1'.repeat(64),
      service_output_hash: 'sha256:' + '2'.repeat(64),
      verification_receipt_id: 'rcpt_' + '1'.repeat(24),
      resource_metrics_hash: hashA,
      actual_amount: '10000',
      authorized_maximum: '190000',
    });
    const usageResultB = await buildUsageResult({
      quote_id: 'qte_' + '1'.repeat(24),
      requirement_id: 'req_' + '1'.repeat(24),
      payment_identifier: 'pay_' + '1'.repeat(28),
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      request_input_hash: 'sha256:' + '1'.repeat(64),
      service_output_hash: 'sha256:' + '2'.repeat(64),
      verification_receipt_id: 'rcpt_' + '1'.repeat(24),
      resource_metrics_hash: hashB,
      actual_amount: '10000',
      authorized_maximum: '190000',
    });
    expect(usageResultA.usage_result_hash).not.toBe(usageResultB.usage_result_hash);
  });
});
