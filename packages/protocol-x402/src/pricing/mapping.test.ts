/**
 * Proves protocol-x402's pricing re-export is identical to
 * @siteborne/pricing's own canonical values — not a second, potentially
 * divergent pricing source. protocol-x402 owns no YAML/filesystem access
 * of its own (see docs/decisions/0042).
 */
import { describe, expect, it } from 'vitest';
import * as siteborneePricing from '@siteborne/pricing';
import {
  resolveServiceMaxPriceUsd,
  resolvePricingSourceVersion,
  usdToAtomicUnits,
} from './mapping';
import { buildQuote } from '../quote/quote';

describe('protocol-x402 pricing re-export == @siteborne/pricing canonical values', () => {
  it('resolveServiceMaxPriceUsd is the exact same function object as @siteborne/pricing exports', () => {
    expect(resolveServiceMaxPriceUsd).toBe(siteborneePricing.resolveServiceMaxPriceUsd);
  });

  it('usdToAtomicUnits is the exact same function object as @siteborne/pricing exports', () => {
    expect(usdToAtomicUnits).toBe(siteborneePricing.usdToAtomicUnits);
  });

  it('every pricing key resolves to the identical value through both import paths', () => {
    const keys = [
      'company_evidence_graph',
      'web_context_verified_direct',
      'web_context_verified_rendered',
      'document_evidence_json_native',
      'document_evidence_json_ocr',
      'document_evidence_json_table',
      'document_evidence_json_max_job',
      'verify_agent_output_standard',
      'verify_agent_output_reproduction',
    ] as const;
    for (const key of keys) {
      expect(resolveServiceMaxPriceUsd(key)).toBe(siteborneePricing.resolveServiceMaxPriceUsd(key));
    }
  });

  it('an x402 quote built from a resolved price carries the canonical pricing package amount, not a duplicated constant', async () => {
    const priceUsd = resolveServiceMaxPriceUsd('company_evidence_graph');
    const canonicalPriceUsd = siteborneePricing.resolveServiceMaxPriceUsd('company_evidence_graph');
    expect(priceUsd).toBe(canonicalPriceUsd);

    const amount = usdToAtomicUnits(priceUsd, 6);
    const pricingSourceVersion = resolvePricingSourceVersion();
    const quote = await buildQuote({
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      contract_release: '1.0.0',
      input_hash: 'sha256:' + '1'.repeat(64),
      pricing_key: 'company_evidence_graph',
      pricing_source_version: pricingSourceVersion,
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0xUSDC',
      amount,
      payee: '0xPayee',
      issued_at: '2026-08-09T00:00:00.000Z',
      expires_at: '2026-08-09T00:05:00.000Z',
    });
    expect(quote.amount).toBe(siteborneePricing.usdToAtomicUnits(canonicalPriceUsd, 6));
    expect(quote.pricing_source_version).toBe(siteborneePricing.resolvePricingSourceVersion());
  });
});
