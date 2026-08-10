import { describe, expect, it } from 'vitest';
import { buildQuote } from '../quote/quote';
import type { QuoteInput, Quote } from '../quote/quote';
import { buildExactPaymentRequirement } from '../requirements/exact';
import { validatePaymentPayloadStructure } from './parser';
import type { PaymentPayload } from '@x402/core/types';

const RESOURCE_ID = 'https://api.siteborne.dev/v1/company_evidence_graph';

function baseQuoteInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
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
    expires_at: '2026-08-09T00:05:00.000Z',
    ...overrides,
  };
}

async function setup(quoteOverrides: Partial<QuoteInput> = {}) {
  const quote: Quote = await buildQuote(baseQuoteInput(quoteOverrides));
  const { requirement } = await buildExactPaymentRequirement({
    quote,
    resource_id: RESOURCE_ID,
    maxTimeoutSeconds: 60,
  });
  const validPayload: PaymentPayload = {
    x402Version: 2,
    resource: { url: RESOURCE_ID },
    accepted: requirement,
    payload: { signature: '0xdeadbeef' },
  };
  return { quote, requirement, validPayload };
}

const NOW = '2026-08-09T00:01:00.000Z';

describe('validatePaymentPayloadStructure', () => {
  it('accepts a genuinely valid payload', async () => {
    const { quote, validPayload } = await setup();
    const result = validatePaymentPayloadStructure(validPayload, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result).toEqual({ status: 'valid_structure', detail: undefined });
  });

  it('rejects a V1-shaped x402Version', async () => {
    const { quote, validPayload } = await setup();
    const tampered = { ...validPayload, x402Version: 1 };
    const result = validatePaymentPayloadStructure(tampered, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('unsupported_version');
  });

  it('rejects an unsupported scheme', async () => {
    const { quote, validPayload } = await setup();
    const tampered = {
      ...validPayload,
      accepted: { ...validPayload.accepted, scheme: 'batch-settlement' },
    };
    const result = validatePaymentPayloadStructure(tampered, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('unsupported_scheme');
  });

  it('rejects upto on a Solana network (unsupported_network) — checked before scheme/quote binding, using a manually-constructed payload since this checkpoint only builds exact requirements', async () => {
    const quote = await buildQuote(baseQuoteInput({ scheme: 'upto', network: 'solana:mainnet' }));
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: { url: RESOURCE_ID },
      accepted: {
        scheme: 'upto',
        network: 'solana:mainnet',
        amount: '39000',
        asset: '0xUSDC',
        payTo: '0xPayee',
        maxTimeoutSeconds: 60,
        extra: { quote_id: quote.quote_id },
      },
      payload: { signature: '0xdeadbeef' },
    };
    const result = validatePaymentPayloadStructure(payload, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('unsupported_network');
  });

  it('rejects a quote_id mismatch (payload built against a different quote)', async () => {
    const { quote, validPayload } = await setup();
    const other = await setup({ input_hash: 'sha256:' + '2'.repeat(64) });
    const tampered = { ...validPayload, accepted: other.requirement };
    const result = validatePaymentPayloadStructure(tampered, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('quote_mismatch');
  });

  it('rejects a resource mismatch', async () => {
    const { quote, validPayload } = await setup();
    const tampered = { ...validPayload, resource: { url: 'https://api.siteborne.dev/v1/other' } };
    const result = validatePaymentPayloadStructure(tampered, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('resource_mismatch');
  });

  it('rejects an expired quote', async () => {
    const { quote, validPayload } = await setup();
    const result = validatePaymentPayloadStructure(validPayload, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: '2026-08-09T00:05:00.000Z',
    });
    expect(result.status).toBe('expired');
  });

  it('rejects a requirement whose amount was altered (requirement_mismatch)', async () => {
    const { quote, validPayload } = await setup();
    const tampered = {
      ...validPayload,
      accepted: { ...validPayload.accepted, amount: '1' },
    };
    const result = validatePaymentPayloadStructure(tampered, {
      quote,
      resource_id: RESOURCE_ID,
      now_iso: NOW,
    });
    expect(result.status).toBe('requirement_mismatch');
  });

  it('never throws for a structurally-odd but type-shaped payload', async () => {
    const { quote } = await setup();
    const odd = {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: '',
        amount: '',
        asset: '',
        payTo: '',
        maxTimeoutSeconds: 0,
        extra: {},
      },
      payload: {},
    } as unknown as PaymentPayload;
    expect(() =>
      validatePaymentPayloadStructure(odd, { quote, resource_id: RESOURCE_ID, now_iso: NOW })
    ).not.toThrow();
  });
});
