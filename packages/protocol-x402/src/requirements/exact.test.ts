import { describe, expect, it } from 'vitest';
import { buildQuote } from '../quote/quote';
import type { QuoteInput, Quote } from '../quote/quote';
import {
  buildExactPaymentRequirement,
  validateExactRequirementBinding,
  UnsupportedSchemeForExactBuilderError,
  UnsupportedSchemeNetworkCombinationError,
} from './exact';

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

async function quote(overrides: Partial<QuoteInput> = {}): Promise<Quote> {
  return buildQuote(baseQuoteInput(overrides));
}

describe('buildExactPaymentRequirement', () => {
  it('builds a requirement whose wire fields mirror the quote', async () => {
    const q = await quote();
    const { requirement, requirement_id } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'https://api.siteborne.dev/v1/company_evidence_graph',
      maxTimeoutSeconds: 60,
    });
    expect(requirement.scheme).toBe('exact');
    expect(requirement.network).toBe(q.network);
    expect(requirement.asset).toBe(q.asset);
    expect(requirement.amount).toBe(q.amount);
    expect(requirement.payTo).toBe(q.payee);
    expect(requirement.extra?.['quote_id']).toBe(q.quote_id);
    expect(requirement_id).toMatch(/^req_[a-f0-9]{24}$/);
  });

  it('is deterministic for the same quote + resource', async () => {
    const q = await quote();
    const a = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'https://api.siteborne.dev/v1/x',
      maxTimeoutSeconds: 60,
    });
    const b = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'https://api.siteborne.dev/v1/x',
      maxTimeoutSeconds: 60,
    });
    expect(a.requirement_id).toBe(b.requirement_id);
  });

  it('produces a different requirement_id for a different resource_id (same quote)', async () => {
    const q = await quote();
    const a = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'https://api.siteborne.dev/v1/x',
      maxTimeoutSeconds: 60,
    });
    const b = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'https://api.siteborne.dev/v1/y',
      maxTimeoutSeconds: 60,
    });
    expect(a.requirement_id).not.toBe(b.requirement_id);
  });

  it('throws for a quote whose scheme is not exact', async () => {
    const q = await quote({ scheme: 'upto' });
    await expect(
      buildExactPaymentRequirement({ quote: q, resource_id: 'r', maxTimeoutSeconds: 60 })
    ).rejects.toThrow(UnsupportedSchemeForExactBuilderError);
  });

  it('throws when exact is requested on an unrecognized network', async () => {
    const q = await quote({ network: 'cosmos:cosmoshub-4' });
    await expect(
      buildExactPaymentRequirement({ quote: q, resource_id: 'r', maxTimeoutSeconds: 60 })
    ).rejects.toThrow(UnsupportedSchemeNetworkCombinationError);
  });
});

describe('validateExactRequirementBinding', () => {
  it('is valid for a requirement built from the same quote, checked before expiry', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const result = validateExactRequirementBinding(requirement, q, '2026-08-09T00:01:00.000Z');
    expect(result).toEqual({ valid: true, failures: [] });
  });

  it('detects a wrong amount', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const tampered = { ...requirement, amount: '1' };
    const result = validateExactRequirementBinding(tampered, q, '2026-08-09T00:01:00.000Z');
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('amount_mismatch');
  });

  it('detects a wrong asset', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const result = validateExactRequirementBinding(
      { ...requirement, asset: '0xWrongAsset' },
      q,
      '2026-08-09T00:01:00.000Z'
    );
    expect(result.failures).toContain('asset_mismatch');
  });

  it('detects a wrong network', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const result = validateExactRequirementBinding(
      { ...requirement, network: 'eip155:1' },
      q,
      '2026-08-09T00:01:00.000Z'
    );
    expect(result.failures).toContain('network_mismatch');
  });

  it('detects a wrong payee (payee_mismatch)', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const result = validateExactRequirementBinding(
      { ...requirement, payTo: '0xSomeoneElse' },
      q,
      '2026-08-09T00:01:00.000Z'
    );
    expect(result.failures).toContain('payee_mismatch');
  });

  it('detects a malformed payTo distinctly from a merely-different one', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const result = validateExactRequirementBinding(
      { ...requirement, payTo: 'has whitespace' },
      q,
      '2026-08-09T00:01:00.000Z'
    );
    expect(result.failures).toContain('payee_malformed');
    expect(result.failures).not.toContain('payee_mismatch');
  });

  it('detects an expired quote', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const result = validateExactRequirementBinding(requirement, q, '2026-08-09T00:05:00.000Z');
    expect(result.failures).toContain('quote_expired');
  });

  it('reports every independent failure, not just the first', async () => {
    const q = await quote();
    const { requirement } = await buildExactPaymentRequirement({
      quote: q,
      resource_id: 'r',
      maxTimeoutSeconds: 60,
    });
    const tampered = { ...requirement, amount: '1', asset: '0xWrong' };
    const result = validateExactRequirementBinding(tampered, q, '2026-08-09T00:01:00.000Z');
    expect(result.failures).toEqual(expect.arrayContaining(['amount_mismatch', 'asset_mismatch']));
  });
});
