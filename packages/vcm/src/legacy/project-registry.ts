/**
 * vcmToLegacyRegistry() (Master Reference Part II §XVIII). The reverse
 * projection needed solely for migration parity -- reproduces today's
 * registry/services/*.json shape exactly, using the legacy-preserved
 * fields (legacyProtocolExposureDeclared, legacyMaximumPriceDeclared,
 * legacyProductionEnabledDeclared, legacyUpdatedAt), never the
 * VCM-native/corrected values. No protocol adapter beyond this legacy
 * registry projection is authorized in this checkpoint.
 */
import { toServiceIdValue } from '../service-id';
import type { CanonicalService, CanonicalStaticModel } from '../types';
import type { LegacyRegistryServiceFile } from './types';

function primaryInteraction(service: CanonicalService) {
  const primary = service.interactions.find((i) => i.kind === 'primary_service_call');
  if (!primary) {
    throw new Error(
      `vcmToLegacyRegistry: service "${toServiceIdValue(service.id)}" has no primary_service_call interaction to project`
    );
  }
  return primary;
}

export function projectOneService(service: CanonicalService): LegacyRegistryServiceFile {
  const primary = primaryInteraction(service);
  return {
    service_id: toServiceIdValue(service.id),
    service_version: service.id.generation,
    title: service.title,
    description: service.description,
    capabilities: [...service.capabilities],
    input_schema_uri: service.contract.inputSchema.uri,
    input_schema_hash: service.contract.inputSchema.digest,
    output_schema_uri: service.contract.outputSchema.uri,
    output_schema_hash: service.contract.outputSchema.digest,
    pcc_version: service.contract.pcc.wireVersion.raw,
    pricing_schemes: service.economics.supportedSchemes.map((s) => s.scheme),
    base_price: {
      amount: service.economics.listPrice.amount,
      currency: service.economics.listPrice.currency,
    },
    maximum_price: {
      amount: service.economics.legacyMaximumPriceDeclared.amount,
      currency: service.economics.legacyMaximumPriceDeclared.currency,
    },
    execution_mode: primary.executionMode,
    maximum_input_bytes: primary.maximumInputBytes,
    expected_latency_class: primary.expectedLatencyClass,
    authorization_classification: service.authorizationClassification,
    promotion_state: service.lifecycleState.toLowerCase(),
    production_enabled: service.legacyProductionEnabledDeclared,
    declared_limitations: [...service.declaredLimitations],
    protocols: { ...service.legacyProtocolExposureDeclared },
    updated_at: service.legacyUpdatedAt,
  };
}

export function vcmToLegacyRegistry(model: CanonicalStaticModel): LegacyRegistryServiceFile[] {
  return [...model.services]
    .map(projectOneService)
    .sort((a, b) => a.service_id.localeCompare(b.service_id));
}
