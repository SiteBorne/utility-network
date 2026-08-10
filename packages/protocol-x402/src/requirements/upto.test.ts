import { describe, expect, it } from 'vitest';
import { buildQuote } from '../quote/quote';
import type { QuoteInput, Quote } from '../quote/quote';
import {
  buildUptoPaymentRequirement,
  validateUptoRequirementBinding,
  validateUptoAuthorization,
  isCanonicalAtomicAmount,
  UnsupportedSchemeForUptoBuilderError,
} from './upto';
import { UnsupportedSchemeNetworkCombinationError } from '../network/schemes';

const RESOURCE_ID = 'https://api.siteborne.dev/v1/document_evidence_json';

function baseQuoteInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    service_id: 'document_evidence_json.v1',
    service_version: 'v1',
    contract_release: '1.0.0',
    input_hash: 'sha256:' + '1'.repeat(64),
    pricing_key: 'document_evidence_json_max_job',
    scheme: 'upto',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '190000', // authorized maximum
    payee: '0xPayee',
    issued_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-09T00:05:00.000Z',
    ...overrides,
  };
}

async function quote(overrides: Partial<QuoteInput> = {}): Promise<Quote> {
  return buildQuote(baseQuoteInput(overrides));
}

const NOW = '2026-08-09T00:01:00.000Z';

describe('buildUptoPaymentRequirement', () => {
  it('builds a requirement whose amount is the authorized maximum', async () => {
    const q = await quote();
    const { requirement, requirement_id } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    expect(requirement.scheme).toBe('upto');
    expect(requirement.amount).toBe(q.amount); // maximum, not an actual charge
    expect(requirement.extra?.['quote_id']).toBe(q.quote_id);
    expect(requirement_id).toMatch(/^req_[a-f0-9]{24}$/);
  });

  it('throws for a quote whose scheme is not upto', async () => {
    const q = await quote({ scheme: 'exact' });
    await expect(
      buildUptoPaymentRequirement({ quote: q, resource_id: RESOURCE_ID, maxTimeoutSeconds: 120 })
    ).rejects.toThrow(UnsupportedSchemeForUptoBuilderError);
  });

  it('throws when upto is requested on a Solana network (EVM-only)', async () => {
    const q = await quote({ network: 'solana:mainnet' });
    await expect(
      buildUptoPaymentRequirement({ quote: q, resource_id: RESOURCE_ID, maxTimeoutSeconds: 120 })
    ).rejects.toThrow(UnsupportedSchemeNetworkCombinationError);
  });
});

describe('validateUptoRequirementBinding', () => {
  it('is valid for a requirement built from the same quote', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    expect(validateUptoRequirementBinding(requirement, q, NOW)).toEqual({
      valid: true,
      failures: [],
    });
  });

  it('detects a tampered maximum amount', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const result = validateUptoRequirementBinding({ ...requirement, amount: '1' }, q, NOW);
    expect(result.failures).toContain('amount_mismatch');
  });
});

describe('isCanonicalAtomicAmount', () => {
  it.each(['0', '1', '39000', '999999999999999999'])('accepts %s', (v) => {
    expect(isCanonicalAtomicAmount(v)).toBe(true);
  });

  it.each(['-1', '1.5', '1e5', '+1', '', '01', 'abc', ' 1', '1 '])('rejects %s', (v) => {
    expect(isCanonicalAtomicAmount(v)).toBe(false);
  });
});

describe('validateUptoAuthorization', () => {
  it('is valid when actual < maximum', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '100000',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('valid');
  });

  it('is valid when actual == maximum', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: requirement.amount,
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('valid');
  });

  it('rejects actual > maximum', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '999999999',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('actual_exceeds_maximum');
  });

  it('rejects a zero actual amount as valid (zero usage is a legitimate outcome)', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '0',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('valid');
  });

  it('rejects a negative actual amount as invalid_amount', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '-5',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('invalid_amount');
  });

  it('rejects a non-integer actual amount as invalid_amount', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '100.5',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('invalid_amount');
  });

  it('rejects scientific-notation actual amount as invalid_amount (never Number()-parsed)', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '1e5',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('invalid_amount');
  });

  it('rejects a wrong quote binding as quote_mismatch', async () => {
    const q = await quote();
    const other = await quote({ input_hash: 'sha256:' + '2'.repeat(64) });
    const { requirement } = await buildUptoPaymentRequirement({
      quote: other,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '1',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('quote_mismatch');
  });

  it('rejects an unsupported network (Solana) even if the requirement claims upto', async () => {
    const q = await quote({ network: 'eip155:8453' });
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const tampered = { ...requirement, network: 'solana:mainnet' as const };
    const outcome = validateUptoAuthorization({
      requirement: tampered,
      actualAmount: '1',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('unsupported_network');
  });

  it('rejects an expired quote', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '1',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: '2026-08-09T00:05:00.000Z',
    });
    expect(outcome).toBe('expired');
  });

  it('rejects a resource mismatch when the payload declared a different resource', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const outcome = validateUptoAuthorization({
      requirement,
      actualAmount: '1',
      quote: q,
      resourceId: RESOURCE_ID,
      payloadResourceId: 'https://api.siteborne.dev/v1/other',
      nowIso: NOW,
    });
    expect(outcome).toBe('resource_mismatch');
  });

  it('rejects an exact-scheme requirement passed into upto validation', async () => {
    const q = await quote();
    const { requirement } = await buildUptoPaymentRequirement({
      quote: q,
      resource_id: RESOURCE_ID,
      maxTimeoutSeconds: 120,
    });
    const asExact = { ...requirement, scheme: 'exact' as const };
    const outcome = validateUptoAuthorization({
      requirement: asExact,
      actualAmount: '1',
      quote: q,
      resourceId: RESOURCE_ID,
      nowIso: NOW,
    });
    expect(outcome).toBe('requirement_mismatch');
  });
});
