import { describe, expect, it } from 'vitest';
import { isPaymentRequiredV2 } from '@x402/core/schemas';
import { buildQuote } from '../quote/quote';
import { buildExactPaymentRequirement } from '../requirements/exact';
import {
  buildPaymentRequired,
  InvalidPaymentRequiredInputError,
  MAX_ACCEPTS_LENGTH,
} from './payment-required';

async function exactAccept(overrides: Partial<Parameters<typeof buildQuote>[0]> = {}) {
  const q = await buildQuote({
    service_id: 'web_context_verified.v1',
    service_version: 'v1',
    contract_release: '1.0.0',
    input_hash: 'sha256:' + '1'.repeat(64),
    pricing_key: 'web_context_verified_direct',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '9000',
    payee: '0xPayee',
    issued_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-09T00:05:00.000Z',
    ...overrides,
  });
  const { requirement } = await buildExactPaymentRequirement({
    quote: q,
    resource_id: 'https://api.siteborne.dev/v1/web_context_verified',
    maxTimeoutSeconds: 60,
  });
  return requirement;
}

describe('buildPaymentRequired', () => {
  it('constructs a challenge that validates against the official V2 schema', async () => {
    const accept = await exactAccept();
    const challenge = buildPaymentRequired({
      resource: { url: 'https://api.siteborne.dev/v1/web_context_verified' },
      accepts: [accept],
    });
    expect(challenge.x402Version).toBe(2);
    expect(isPaymentRequiredV2(challenge)).toBe(true);
  });

  it('rejects an empty accepts[]', async () => {
    expect(() => buildPaymentRequired({ resource: { url: 'https://x' }, accepts: [] })).toThrow(
      InvalidPaymentRequiredInputError
    );
  });

  it('rejects an accepts[] exceeding MAX_ACCEPTS_LENGTH', async () => {
    const accept = await exactAccept();
    const accepts = Array.from({ length: MAX_ACCEPTS_LENGTH + 1 }, (_, i) => ({
      ...accept,
      amount: String(i + 1),
    }));
    expect(() => buildPaymentRequired({ resource: { url: 'https://x' }, accepts })).toThrow(
      InvalidPaymentRequiredInputError
    );
  });

  it('rejects a duplicate payment requirement within accepts[]', async () => {
    const accept = await exactAccept();
    expect(() =>
      buildPaymentRequired({ resource: { url: 'https://x' }, accepts: [accept, accept] })
    ).toThrow(InvalidPaymentRequiredInputError);
  });

  it('allows exact and upto to coexist when both are supplied explicitly', async () => {
    const exact = await exactAccept();
    const uptoAccept = { ...exact, scheme: 'upto' as const, amount: '190000' };
    const challenge = buildPaymentRequired({
      resource: { url: 'https://api.siteborne.dev/v1/document_evidence_json' },
      accepts: [exact, uptoAccept],
    });
    expect(challenge.accepts).toHaveLength(2);
  });

  it('carries through an optional error and extensions', async () => {
    const accept = await exactAccept();
    const challenge = buildPaymentRequired({
      resource: { url: 'https://x' },
      accepts: [accept],
      error: 'payment required',
      extensions: { foo: 'bar' },
    });
    expect(challenge.error).toBe('payment required');
    expect(challenge.extensions).toEqual({ foo: 'bar' });
  });
});
