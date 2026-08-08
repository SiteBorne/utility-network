export type {
  AdapterResultClass,
  AdapterResultClassSchema,
  AdapterResult,
  AdapterResultSchema,
  AdapterExecutionContext,
  AdapterExecutionContextSchema,
  AdapterHealthContext,
  AdapterHealthContextSchema,
  AdapterHealthResult,
  AdapterHealthResultSchema,
  CacheStatus,
  CacheStatusSchema,
  FreshnessStatus,
  FreshnessStatusSchema,
  AuthorizationClassification,
  AuthorizationClassificationSchema,
  EvidenceLocator,
  EvidenceLocatorSchema,
  EvidenceLocatorType,
  EvidenceLocatorTypeSchema,
  ProviderAdapter,
  ProviderManifest,
  ProviderManifestSchema,
  SourceClass,
  SourceClassSchema,
  SourceObservation,
  SourceObservationSchema,
  HTTPMetadata,
  HTTPMetadataSchema,
  ProvenanceStep,
  ProvenanceStepSchema,
  ArtifactStore,
  RateLimiter,
  InjectedClock,
  InjectedHttpClient,
  AuditEventSink,
} from './types';

export * from './errors';
export {
  createExecutionContext,
  createHealthContext,
  createTestClock,
  createTestHttpClient,
  createTestAuditSink,
} from './context';
export * from './registry';
export * from './policy/terms-guard';
export * from './policy/network-policy';
export * from './policy/source-policy';
export * from './rate-limit/limiter';
export * from './rate-limit/backoff';
export * from './rate-limit/circuit-breaker';
export * from './cache/interface';
export * from './cache/in-memory';
export * from './evidence/source-observation';
export * from './evidence/locators';
export * from './evidence/provenance';
export * from './http/client';
export * from './http/redirect-policy';
export * from './http/response-bounds';
export * from './http/encoding';
export * from './sec/identifiers';
export * from './sec/submissions';
export * from './sec/company-facts';
export * from './sec/normalizers';
export * from './sec/submissions-adapter';
export * from './sec/company-facts-adapter';
export * from './http/public-http-adapter';
export * from './html/normalize';
export * from './html/extract';
export * from './html/injection-signals';
export * from './openalex/openalex-adapter';
export * from './crossref/crossref-adapter';
export * from './github/github-adapter';
export * from './federal-register/federal-register-adapter';
export * from './health/health';
export * from './drift';

import { SEC_EDGAR_MANIFEST } from './sec/submissions-adapter';
import { DIRECT_PUBLIC_HTTP_MANIFEST } from './http/public-http-adapter';
import { OPENALEX_MANIFEST } from './openalex/openalex-adapter';
import { CROSSREF_MANIFEST } from './crossref/crossref-adapter';
import { GITHUB_MANIFEST } from './github/github-adapter';
import { FEDERAL_REGISTER_MANIFEST } from './federal-register/federal-register-adapter';

export {
  SEC_EDGAR_MANIFEST,
  DIRECT_PUBLIC_HTTP_MANIFEST,
  OPENALEX_MANIFEST,
  CROSSREF_MANIFEST,
  GITHUB_MANIFEST,
  FEDERAL_REGISTER_MANIFEST,
};

export const ALL_MANIFESTS = {
  'sec-edgar': SEC_EDGAR_MANIFEST,
  'direct-public-http': DIRECT_PUBLIC_HTTP_MANIFEST,
  openalex: OPENALEX_MANIFEST,
  crossref: CROSSREF_MANIFEST,
  'github-public': GITHUB_MANIFEST,
  'federal-register': FEDERAL_REGISTER_MANIFEST,
};

export { globalRegistry } from './registry';
export { globalTermsGuard } from './policy/terms-guard';
export { createHealthMonitor } from './health/health';
