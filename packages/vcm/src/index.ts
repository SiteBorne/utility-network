/**
 * @siteborne/vcm public API. Shadow implementation only (Master Reference
 * Part II implementation checkpoint 1 / METADATA-VCM-IMPL-01) -- no
 * existing metadata consumer (Agent Card, MCP, OpenAPI, x402, Bazaar,
 * Nevermined, catalog, PCC generation) imports this package yet.
 */
export { VCM_BASELINE } from './baseline';

export * from './sentinels';
export * from './primitives';
export * from './versions';
export * from './service-id';
export * from './types';
export * from './evidence';
export * from './runtime-overlay';
export * from './current-exposure';
export * from './current-authority-inputs';
export * from './effective-view';
export * from './digests';
export * from './validators';
export { canonicalize, hashCanonical } from './canonical';

export type { LegacyRegistryServiceFile } from './legacy/types';
export { primaryPricingKey } from './legacy/pricing-map';
export { contractMapFor } from './legacy/contract-map';
export { legacyRegistryToVCM, importOneService, LegacyImportError } from './legacy/import-registry';
export { vcmToLegacyRegistry, projectOneService } from './legacy/project-registry';
export { checkRegistryParity } from './legacy/parity';
export type { ParityResult } from './legacy/parity';
