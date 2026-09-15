import { describe, expect, it } from 'vitest';
import { importOneService, LegacyImportError } from './import-registry';
import type { LegacyRegistryServiceFile } from './types';

function validLegacyFile(
  overrides: Partial<LegacyRegistryServiceFile> = {}
): LegacyRegistryServiceFile {
  return {
    service_id: 'company_evidence_graph.v1',
    service_version: 'v1',
    title: 'Company Evidence Graph',
    description: 'Test fixture.',
    capabilities: ['test'],
    input_schema_uri: 'https://siteborne.net/schemas/in.json',
    input_schema_hash: `sha256:${'a'.repeat(64)}`,
    output_schema_uri: 'https://siteborne.net/schemas/out.json',
    output_schema_hash: `sha256:${'b'.repeat(64)}`,
    pcc_version: '1.0.0',
    pricing_schemes: ['exact', 'upto'],
    base_price: { amount: '0.039', currency: 'USD' },
    maximum_price: { amount: '0.19', currency: 'USD' },
    execution_mode: 'async',
    maximum_input_bytes: 1048576,
    expected_latency_class: 'slow',
    authorization_classification: 'public',
    promotion_state: 'executable_candidate',
    production_enabled: false,
    declared_limitations: [],
    protocols: {
      x402: 'planned',
      mcp: 'planned',
      a2a: 'planned',
      nevermined: 'planned',
      agentverse: 'planned',
      coinbase_bazaar: 'planned',
      mcp_registry: 'planned',
    },
    updated_at: '2026-08-05T22:00:00Z',
    ...overrides,
  };
}

describe('importOneService', () => {
  it('RED->GREEN: imports a well-formed legacy file', () => {
    const service = importOneService(validLegacyFile());
    expect(service.id).toEqual({ family: 'company_evidence_graph', generation: 'v1' });
  });

  it('rejects a malformed service id (unknown family)', () => {
    expect(() => importOneService(validLegacyFile({ service_id: 'not_a_family.v1' }))).toThrow();
  });

  it('rejects a malformed service id (no generation suffix)', () => {
    expect(() =>
      importOneService(validLegacyFile({ service_id: 'company_evidence_graph' }))
    ).toThrow();
  });

  it('rejects a family/generation mismatch between service_id and service_version', () => {
    expect(() =>
      importOneService(
        validLegacyFile({ service_id: 'company_evidence_graph.v1', service_version: 'v2' })
      )
    ).toThrow(LegacyImportError);
  });

  it('rejects an unknown promotion_state', () => {
    expect(() =>
      importOneService(validLegacyFile({ promotion_state: 'not_a_real_state' }))
    ).toThrow(LegacyImportError);
  });

  it('rejects an unknown expected_latency_class', () => {
    expect(() => importOneService(validLegacyFile({ expected_latency_class: 'fast' }))).toThrow(
      LegacyImportError
    );
  });

  it('preserves the exact legacy protocol declaration verbatim (all "planned")', () => {
    const service = importOneService(validLegacyFile());
    expect(service.legacyProtocolExposureDeclared.mcp).toBe('planned');
    expect(service.protocolExposure.find((p) => p.surface === 'mcp')?.protocolExposed).toBe(false);
  });

  it('resolves the governed max price from the real governance source for a v2 family/tier', () => {
    const service = importOneService(
      validLegacyFile({ service_id: 'company_evidence_graph.v2', service_version: 'v2' })
    );
    expect(service.economics.governedMaxPrice.amount).toBe('0.0312');
  });

  // METADATA-VCM-IMPL-02 (METADATA-VCM-04 §VII): listPrice must be sourced
  // from the current governed pricing authority, never from the frozen
  // legacy registry base_price. RED before the fix: the pre-correction
  // importer set listPrice from legacy.base_price ('0.039'), so this
  // assertion failed (listPrice.amount was '0.039', not '0.0312') -- the
  // exact same real mismatch validators.test.ts's systemic-violation test
  // independently discovered via validateEconomicConstraints.
  it('sources listPrice from the governed pricing authority, not the frozen legacy base_price, for a v2 tier where they differ', () => {
    const service = importOneService(
      validLegacyFile({
        service_id: 'company_evidence_graph.v2',
        service_version: 'v2',
        base_price: { amount: '0.039', currency: 'USD' }, // the real, frozen registry value
      })
    );
    expect(service.economics.listPrice.amount).toBe('0.0312'); // governed, not 0.039
    expect(service.economics.governedMaxPrice.amount).toBe('0.0312');
    expect(service.economics.legacyBasePriceDeclared.amount).toBe('0.039'); // frozen byte, preserved
  });

  it('legacyBasePriceDeclared preserves the frozen legacy base_price verbatim even when it equals the governed price (v1)', () => {
    const service = importOneService(validLegacyFile()); // v1: base_price '0.039' == governed '0.039'
    expect(service.economics.legacyBasePriceDeclared.amount).toBe('0.039');
    expect(service.economics.listPrice.amount).toBe('0.039');
    expect(service.economics.governedMaxPrice.amount).toBe('0.039');
  });
});

describe('authority separation: legacy base_price vs. governed listPrice', () => {
  it('changing only the frozen legacy base_price changes legacyBasePriceDeclared but NOT listPrice/governedMaxPrice', () => {
    const a = importOneService(
      validLegacyFile({
        service_id: 'company_evidence_graph.v2',
        service_version: 'v2',
        base_price: { amount: '0.039', currency: 'USD' },
      })
    );
    const b = importOneService(
      validLegacyFile({
        service_id: 'company_evidence_graph.v2',
        service_version: 'v2',
        base_price: { amount: '0.050', currency: 'USD' }, // only this differs
      })
    );
    expect(a.economics.legacyBasePriceDeclared.amount).toBe('0.039');
    expect(b.economics.legacyBasePriceDeclared.amount).toBe('0.050');
    expect(a.economics.legacyBasePriceDeclared.amount).not.toBe(
      b.economics.legacyBasePriceDeclared.amount
    );
    // the governed facts are completely unaffected by the frozen byte change
    expect(a.economics.listPrice).toEqual(b.economics.listPrice);
    expect(a.economics.governedMaxPrice).toEqual(b.economics.governedMaxPrice);
  });

  it('changing the governed pricing tier (v1 -> v2, same frozen base_price forced) changes listPrice/governedMaxPrice but NOT legacyBasePriceDeclared', () => {
    const v1 = importOneService(
      validLegacyFile({
        service_id: 'company_evidence_graph.v1',
        service_version: 'v1',
        base_price: { amount: '0.039', currency: 'USD' }, // forced identical on both
      })
    );
    const v2 = importOneService(
      validLegacyFile({
        service_id: 'company_evidence_graph.v2',
        service_version: 'v2',
        base_price: { amount: '0.039', currency: 'USD' }, // forced identical on both
      })
    );
    // the frozen byte is identical by construction
    expect(v1.economics.legacyBasePriceDeclared.amount).toBe('0.039');
    expect(v2.economics.legacyBasePriceDeclared.amount).toBe('0.039');
    expect(v1.economics.legacyBasePriceDeclared.amount).toBe(
      v2.economics.legacyBasePriceDeclared.amount
    );
    // but the governed authority differs per generation, and listPrice follows it
    expect(v1.economics.listPrice.amount).toBe('0.039');
    expect(v2.economics.listPrice.amount).toBe('0.0312');
    expect(v1.economics.listPrice.amount).not.toBe(v2.economics.listPrice.amount);
    expect(v1.economics.governedMaxPrice.amount).not.toBe(v2.economics.governedMaxPrice.amount);
  });
});
