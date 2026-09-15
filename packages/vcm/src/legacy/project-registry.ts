/**
 * vcmToLegacyRegistry() (Master Reference Part II §XVIII). The reverse
 * projection needed solely for migration parity -- reproduces today's
 * registry/services/*.json shape exactly, using the legacy-preserved
 * fields (releaseProtocolExposureDeclared, releaseMaximumPriceDeclared,
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
      // Reconstructed from the preserved frozen byte, not from listPrice
      // (METADATA-VCM-04 §VII): listPrice is now sourced from the current
      // governed pricing authority and is no longer byte-identical to the
      // legacy registry's frozen base_price for the four .v2 services.
      amount: service.economics.releaseBasePriceDeclared.amount,
      currency: service.economics.releaseBasePriceDeclared.currency,
    },
    maximum_price: {
      amount: service.economics.releaseMaximumPriceDeclared.amount,
      currency: service.economics.releaseMaximumPriceDeclared.currency,
    },
    execution_mode: primary.executionMode,
    maximum_input_bytes: primary.maximumInputBytes,
    expected_latency_class: primary.expectedLatencyClass,
    authorization_classification: service.authorizationClassification,
    promotion_state: service.lifecycleState.toLowerCase(),
    production_enabled: service.legacyProductionEnabledDeclared,
    declared_limitations: [...service.declaredLimitations],
    protocols: { ...service.releaseProtocolExposureDeclared },
    updated_at: service.legacyUpdatedAt,
  };
}

export function vcmToLegacyRegistry(model: CanonicalStaticModel): LegacyRegistryServiceFile[] {
  return [...model.services]
    .map(projectOneService)
    .sort((a, b) => a.service_id.localeCompare(b.service_id));
}
