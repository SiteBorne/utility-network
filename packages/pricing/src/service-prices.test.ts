import { describe, expect, it, afterEach } from 'vitest';
import {
  resolveServiceMaxPriceUsd,
  resolvePricingSourceVersion,
  usdToAtomicUnits,
  UnknownPricingKeyError,
  __setRiskLimitsForTesting,
} from './service-prices';

describe('resolvePricingSourceVersion', () => {
  afterEach(() => {
    __setRiskLimitsForTesting(undefined);
  });

  it('resolves the real governance document version', () => {
    expect(resolvePricingSourceVersion()).toBe('1.0.0');
  });

  it('reads from an injected synthetic document', () => {
    __setRiskLimitsForTesting({
      version: '2.5.0',
      financial_limits: { max_price_usd_per_service: {} },
    });
    expect(resolvePricingSourceVersion()).toBe('2.5.0');
  });
});

describe('resolveServiceMaxPriceUsd', () => {
  afterEach(() => {
    __setRiskLimitsForTesting(undefined); // restore real governance file for other tests
  });

  it('resolves company_evidence_graph against the real governance/RISK_LIMITS.yaml source of truth', () => {
    // Not hardcoded here — this assertion documents the currently-accepted
    // value so a real governance change is caught, not silently absorbed.
    expect(resolveServiceMaxPriceUsd('company_evidence_graph')).toBe('0.039');
  });

  it('resolves all nine pricing keys the current governance file defines', () => {
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
      expect(() => resolveServiceMaxPriceUsd(key)).not.toThrow();
      expect(typeof resolveServiceMaxPriceUsd(key)).toBe('string');
    }
  });

  it('throws UnknownPricingKeyError for a key not present in the loaded document, rather than fabricating a price', () => {
    __setRiskLimitsForTesting({
      version: '1.0.0',
      financial_limits: { max_price_usd_per_service: {} },
    });
    expect(() => resolveServiceMaxPriceUsd('company_evidence_graph')).toThrow(
      UnknownPricingKeyError
    );
  });

  it('reads from an injected synthetic document when substituted for testing', () => {
    __setRiskLimitsForTesting({
      version: '1.0.0',
      financial_limits: { max_price_usd_per_service: { company_evidence_graph: 0.5 } },
    });
    expect(resolveServiceMaxPriceUsd('company_evidence_graph')).toBe('0.5');
  });
});

describe('usdToAtomicUnits', () => {
  it('converts to 6-decimal atomic units (USDC) without floating-point corruption', () => {
    expect(usdToAtomicUnits('0.01', 6)).toBe('10000');
    expect(usdToAtomicUnits('0.019', 6)).toBe('19000');
    expect(usdToAtomicUnits('0.029', 6)).toBe('29000');
    expect(usdToAtomicUnits('0.039', 6)).toBe('39000');
    expect(usdToAtomicUnits('0.049', 6)).toBe('49000');
  });

  it('converts to 18-decimal atomic units (e.g. an 18-decimal ERC-20)', () => {
    expect(usdToAtomicUnits('0.01', 18)).toBe(String(10000n * 10n ** 12n));
  });

  it('converts to fewer-than-6-decimal atomic units by flooring, never overstating the amount', () => {
    // 0.019 USD == 19000 micro-USD; at 2 decimals that's 1.9 units, floored to 1.
    expect(usdToAtomicUnits('0.019', 2)).toBe('1');
  });

  it('is deterministic: repeated conversion of the same input is byte-identical', () => {
    const a = usdToAtomicUnits('0.039', 6);
    const b = usdToAtomicUnits('0.039', 6);
    expect(a).toBe(b);
  });
});
