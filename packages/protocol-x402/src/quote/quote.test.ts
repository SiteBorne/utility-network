import { describe, expect, it } from 'vitest';
import { buildQuote, isQuoteExpired, quoteBindingMatches } from './quote';
import type { QuoteInput } from './quote';

function baseInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
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

describe('buildQuote', () => {
  it('produces a `qte_` prefixed deterministic ID', async () => {
    const quote = await buildQuote(baseInput());
    expect(quote.quote_id).toMatch(/^qte_[a-f0-9]{24}$/);
  });

  it('is deterministic: identical input always produces the identical quote_id', async () => {
    const a = await buildQuote(baseInput());
    const b = await buildQuote(baseInput());
    expect(a.quote_id).toBe(b.quote_id);
    expect(a.binding_hash).toBe(b.binding_hash);
  });

  it('is key-order independent (canonical JSON, not raw JSON.stringify)', async () => {
    const a = await buildQuote(baseInput());
    // Same logical object, but constructed with keys in a different order.
    const input2: QuoteInput = {
      expires_at: baseInput().expires_at,
      issued_at: baseInput().issued_at,
      payee: baseInput().payee,
      amount: baseInput().amount,
      asset: baseInput().asset,
      network: baseInput().network,
      scheme: baseInput().scheme,
      pricing_key: baseInput().pricing_key,
      input_hash: baseInput().input_hash,
      contract_release: baseInput().contract_release,
      service_version: baseInput().service_version,
      service_id: baseInput().service_id,
    };
    const b = await buildQuote(input2);
    expect(a.quote_id).toBe(b.quote_id);
  });

  it.each([
    ['x402_version', 3],
    ['service_id', 'web_context_verified.v1'],
    ['contract_release', '2.0.0'],
    ['input_hash', 'sha256:' + '2'.repeat(64)],
    ['pricing_key', 'other_key'],
    ['pricing_source_version', '2.0.0'],
    ['scheme', 'upto'],
    ['network', 'eip155:1'],
    ['asset', '0xOtherAsset'],
    ['amount', '99999'],
    ['payee', '0xOtherPayee'],
    ['issued_at', '2026-08-09T01:00:00.000Z'],
    ['expires_at', '2026-08-09T02:00:00.000Z'],
  ] as const)('mutating bound field %s changes the quote_id', async (field, value) => {
    const original = await buildQuote(baseInput());
    const mutated = await buildQuote(baseInput({ [field]: value } as Partial<QuoteInput>));
    expect(mutated.quote_id).not.toBe(original.quote_id);
  });

  it('binds x402_version even when omitted (defaults to SUPPORTED_X402_VERSION, still part of the hash)', async () => {
    const implicit = await buildQuote(baseInput());
    const explicit = await buildQuote(baseInput({ x402_version: 2 }));
    expect(implicit.quote_id).toBe(explicit.quote_id);
  });

  it('directive §3 regression: same resource URL context, different request input -> different quote_id', async () => {
    const a = await buildQuote(baseInput({ input_hash: 'sha256:' + 'a'.repeat(64) }));
    const b = await buildQuote(baseInput({ input_hash: 'sha256:' + 'b'.repeat(64) }));
    expect(a.quote_id).not.toBe(b.quote_id);
  });

  it('directive §3 regression: same input, different service -> different quote_id', async () => {
    const a = await buildQuote(baseInput({ service_id: 'company_evidence_graph.v1' }));
    const b = await buildQuote(baseInput({ service_id: 'web_context_verified.v1' }));
    expect(a.quote_id).not.toBe(b.quote_id);
  });

  it('directive §3 regression: same input/service, different contract_release -> different quote_id', async () => {
    const a = await buildQuote(baseInput({ contract_release: '1.0.0' }));
    const b = await buildQuote(baseInput({ contract_release: '1.1.0' }));
    expect(a.quote_id).not.toBe(b.quote_id);
  });
});

describe('quoteBindingMatches', () => {
  it('is true for the same logical binding', async () => {
    const quote = await buildQuote(baseInput());
    expect(quoteBindingMatches(quote, baseInput())).toBe(true);
  });

  it('is false when any bound field differs', async () => {
    const quote = await buildQuote(baseInput());
    expect(quoteBindingMatches(quote, baseInput({ amount: '1' }))).toBe(false);
  });
});

describe('isQuoteExpired', () => {
  it('is false before expiry', async () => {
    const quote = await buildQuote(baseInput());
    expect(isQuoteExpired(quote, '2026-08-09T00:04:59.000Z')).toBe(false);
  });

  it('is true exactly at expiry (inclusive)', async () => {
    const quote = await buildQuote(baseInput());
    expect(isQuoteExpired(quote, '2026-08-09T00:05:00.000Z')).toBe(true);
  });

  it('is true after expiry', async () => {
    const quote = await buildQuote(baseInput());
    expect(isQuoteExpired(quote, '2026-08-09T00:06:00.000Z')).toBe(true);
  });
});
