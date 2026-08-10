/**
 * Directive §12: exact/upto separation. Proves no accidental cross-scheme
 * acceptance is possible anywhere in the quote -> requirement ->
 * payload-validation path.
 */
import { describe, expect, it } from 'vitest';
import { buildQuote } from '../quote/quote';
import type { QuoteInput } from '../quote/quote';
import { buildExactPaymentRequirement } from '../requirements/exact';
import {
  buildUptoPaymentRequirement,
  UnsupportedSchemeForUptoBuilderError,
} from '../requirements/upto';
import { UnsupportedSchemeForExactBuilderError } from '../requirements/exact';
import { validatePaymentPayloadStructure } from '../payload/parser';
import type { PaymentPayload } from '@x402/core/types';

const RESOURCE_ID = 'https://api.siteborne.dev/v1/document_evidence_json';
const NOW = '2026-08-09T00:01:00.000Z';

function baseQuoteInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    service_id: 'document_evidence_json.v1',
    service_version: 'v1',
    contract_release: '1.0.0',
    input_hash: 'sha256:' + '1'.repeat(64),
    pricing_key: 'document_evidence_json_max_job',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '190000',
    payee: '0xPayee',
    issued_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-09T00:05:00.000Z',
    ...overrides,
  };
}

describe('exact requirement builder rejects upto quotes, and vice versa', () => {
  it('buildExactPaymentRequirement rejects an upto-scheme quote', async () => {
    const quote = await buildQuote(baseQuoteInput({ scheme: 'upto' }));
    await expect(
      buildExactPaymentRequirement({ quote, resource_id: RESOURCE_ID, maxTimeoutSeconds: 60 })
    ).rejects.toThrow(UnsupportedSchemeForExactBuilderError);
  });

  it('buildUptoPaymentRequirement rejects an exact-scheme quote', async () => {
    const quote = await buildQuote(baseQuoteInput({ scheme: 'exact' }));
    await expect(
      buildUptoPaymentRequirement({ quote, resource_id: RESOURCE_ID, maxTimeoutSeconds: 60 })
    ).rejects.toThrow(UnsupportedSchemeForUptoBuilderError);
  });
});

describe('an exact quote and an upto quote for otherwise-identical inputs have different identities', () => {
  it('scheme is bound into quote_id — same everything else, different scheme -> different quote_id', async () => {
    const exactQuote = await buildQuote(baseQuoteInput({ scheme: 'exact' }));
    const uptoQuote = await buildQuote(baseQuoteInput({ scheme: 'upto' }));
    expect(exactQuote.quote_id).not.toBe(uptoQuote.quote_id);
  });
});

describe('payload validation: an exact requirement can never satisfy an upto quote, and vice versa', () => {
  it('an exact-scheme payload against an upto quote is rejected', async () => {
    const uptoQuote = await buildQuote(baseQuoteInput({ scheme: 'upto' }));
    const exactQuote = await buildQuote(baseQuoteInput({ scheme: 'exact' }));
    const { requirement: exactRequirement } = await buildExactPaymentRequirement({
      quote: exactQuote,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 60,
    });
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: { url: RESOURCE_ID },
      accepted: exactRequirement,
      payload: {},
    };
    const result = validatePaymentPayloadStructure(payload, {
      quote: uptoQuote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('requirement_mismatch');
  });

  it('an upto-scheme payload against an exact quote is rejected', async () => {
    const uptoQuote = await buildQuote(baseQuoteInput({ scheme: 'upto' }));
    const exactQuote = await buildQuote(baseQuoteInput({ scheme: 'exact' }));
    const { requirement: uptoRequirement } = await buildUptoPaymentRequirement({
      quote: uptoQuote,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 60,
    });
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: { url: RESOURCE_ID },
      accepted: uptoRequirement,
      payload: {},
    };
    const result = validatePaymentPayloadStructure(payload, {
      quote: exactQuote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('requirement_mismatch');
  });

  it('an exact payload correctly validates against its own exact quote (sanity check the rejection above is scheme-specific, not universal)', async () => {
    const exactQuote = await buildQuote(baseQuoteInput({ scheme: 'exact' }));
    const { requirement } = await buildExactPaymentRequirement({
      quote: exactQuote,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 60,
    });
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: { url: RESOURCE_ID },
      accepted: requirement,
      payload: {},
    };
    const result = validatePaymentPayloadStructure(payload, {
      quote: exactQuote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('valid_structure');
  });

  it('an upto payload correctly validates against its own upto quote', async () => {
    const uptoQuote = await buildQuote(baseQuoteInput({ scheme: 'upto', network: 'eip155:8453' }));
    const { requirement } = await buildUptoPaymentRequirement({
      quote: uptoQuote,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 60,
    });
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: { url: RESOURCE_ID },
      accepted: requirement,
      payload: {},
    };
    const result = validatePaymentPayloadStructure(payload, {
      quote: uptoQuote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('valid_structure');
  });
});
