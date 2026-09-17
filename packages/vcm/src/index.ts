/**
 * @siteborne/vcm public API. Shadow implementation only (Master Reference
 * Part II implementation checkpoint 1 / METADATA-VCM-IMPL-01) -- no
 * existing metadata consumer's SERVED output (Agent Card, MCP, OpenAPI,
 * x402, Bazaar, Nevermined, catalog, PCC generation) is produced by this
 * package yet. METADATA-VCM-IMPL-04A adds compare-only runtime integration
 * (legacy remains the served authority in every state defined so far) --
 * see `runtime-model.ts` and `projections/*-real-context.ts`.
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

export * from './comparator';
export type * from './projections/types';
export { projectA2aFromVcm } from './projections/a2a-shadow';
export { projectMcpToolsFromVcm } from './projections/mcp-shadow';
export { buildRealA2aShadowContext } from './projections/a2a-real-context';
export {
  buildCurrentMcpProjectionContext,
  buildRealMcpShadowContext,
} from './projections/mcp-real-context';
export {
  getRuntimeEffectiveView,
  resetRuntimeEffectiveViewCacheForTests,
  VCM_SCHEMA_VERSION,
  VCM_RELEASE_VERSION,
} from './runtime-model';

export type { LegacyRegistryServiceFile } from './legacy/types';
export { primaryPricingKey } from './legacy/pricing-map';
export { contractMapFor } from './legacy/contract-map';
export { legacyRegistryToVCM, importOneService, LegacyImportError } from './legacy/import-registry';
export { vcmToLegacyRegistry, projectOneService } from './legacy/project-registry';
export { checkRegistryParity } from './legacy/parity';
export type { ParityResult } from './legacy/parity';
