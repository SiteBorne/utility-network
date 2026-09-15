import { describe, expect, it } from 'vitest';
import { importOneService } from './import-registry';
import { projectOneService } from './project-registry';
import type { LegacyRegistryServiceFile } from './types';

function validLegacyFile(
  overrides: Partial<LegacyRegistryServiceFile> = {}
): LegacyRegistryServiceFile {
  return {
    service_id: 'company_evidence_graph.v2',
    service_version: 'v2',
    title: 'Company Evidence Graph',
    description: 'Test fixture.',
    capabilities: ['test'],
    input_schema_uri: 'https://siteborne.net/schemas/in.json',
    input_schema_hash: `sha256:${'a'.repeat(64)}`,
    output_schema_uri: 'https://siteborne.net/schemas/out.json',
    output_schema_hash: `sha256:${'b'.repeat(64)}`,
    pcc_version: '1.0.0',
    pricing_schemes: ['exact', 'upto'],
    base_price: { amount: '0.039', currency: 'USD' }, // the real, frozen registry value
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

describe('projectOneService: base_price reconstruction (METADATA-VCM-04 §VII)', () => {
  it(
    'reconstructs the frozen legacy base_price from releaseBasePriceDeclared, NOT from the ' +
      'corrected listPrice -- so a round-trip through VCM continues to emit the original ' +
      'frozen .v2 registry value even though the canonical governed price is now lower',
    () => {
      const legacy = validLegacyFile();
      const service = importOneService(legacy);

      // sanity: the correction is actually in effect for this fixture
      expect(service.economics.listPrice.amount).toBe('0.0312');
      expect(service.economics.releaseBasePriceDeclared.amount).toBe('0.039');
      expect(service.economics.listPrice.amount).not.toBe(
        service.economics.releaseBasePriceDeclared.amount
      );

      const projected = projectOneService(service);

      // the reverse projection must reproduce the ORIGINAL frozen byte,
      // not the corrected canonical listPrice
      expect(projected.base_price.amount).toBe('0.039');
      expect(projected.base_price.amount).toBe(legacy.base_price.amount);
      expect(projected.base_price.amount).not.toBe(service.economics.listPrice.amount);
    }
  );

  it('projects the frozen release declaration even when current MCP code is registered', () => {
    const service = importOneService(validLegacyFile());
    const withCurrentMcpExposure = {
      ...service,
      currentStaticExposures: [
        {
          surface: 'mcp' as const,
          registrationId: 'siteborne_company_evidence_graph',
          operationId: 'evaluate',
          exposureShape: 'standalone_tool' as const,
          provenance: {
            sourcePackage: '@siteborne/protocol-mcp',
            sourceModule: 'src/constants.ts#MCP_SERVICE_TOOLS',
            sourceRegistrationId: 'siteborne_company_evidence_graph',
            runtimeSourceCommit: 'a'.repeat(40) as never,
            derivationMethod: 'typed_export' as const,
          },
        },
      ],
    };

    expect(projectOneService(withCurrentMcpExposure).protocols.mcp).toBe('planned');
  });
});
