import type { ProviderManifest } from '../types';

export interface SourcePolicy {
  version: string;
  defaultTimeoutMs: number;
  defaultMaxResponseBytes: number;
  defaultFreshnessMs: number;
  providerOverrides: Map<string, ProviderSourcePolicy>;
}

export interface ProviderSourcePolicy {
  timeoutMs?: number;
  maxResponseBytes?: number;
  freshnessMs?: number;
  cacheTtlMs?: number;
  negativeCacheTtlMs?: number;
}

export const DEFAULT_SOURCE_POLICY: SourcePolicy = {
  version: '1.0.0',
  defaultTimeoutMs: 30000,
  defaultMaxResponseBytes: 10 * 1024 * 1024,
  defaultFreshnessMs: 24 * 60 * 60 * 1000,
  providerOverrides: new Map(),
};

export function createSourcePolicy(overrides: Partial<SourcePolicy> = {}): SourcePolicy {
  return {
    version: overrides.version || DEFAULT_SOURCE_POLICY.version,
    defaultTimeoutMs: overrides.defaultTimeoutMs || DEFAULT_SOURCE_POLICY.defaultTimeoutMs,
    defaultMaxResponseBytes:
      overrides.defaultMaxResponseBytes || DEFAULT_SOURCE_POLICY.defaultMaxResponseBytes,
    defaultFreshnessMs: overrides.defaultFreshnessMs || DEFAULT_SOURCE_POLICY.defaultFreshnessMs,
    providerOverrides: new Map(overrides.providerOverrides || []),
  };
}

export function getProviderPolicy(policy: SourcePolicy, providerId: string): ProviderSourcePolicy {
  return policy.providerOverrides.get(providerId) || {};
}

export function resolveTimeout(policy: SourcePolicy, providerId: string): number {
  return getProviderPolicy(policy, providerId).timeoutMs || policy.defaultTimeoutMs;
}

export function resolveMaxResponseBytes(policy: SourcePolicy, providerId: string): number {
  return getProviderPolicy(policy, providerId).maxResponseBytes || policy.defaultMaxResponseBytes;
}

export function resolveFreshness(policy: SourcePolicy, providerId: string): number {
  return getProviderPolicy(policy, providerId).freshnessMs || policy.defaultFreshnessMs;
}

export function resolveCacheTtl(policy: SourcePolicy, providerId: string): number {
  return getProviderPolicy(policy, providerId).cacheTtlMs || policy.defaultFreshnessMs;
}

export function resolveNegativeCacheTtl(policy: SourcePolicy, providerId: string): number {
  return (
    getProviderPolicy(policy, providerId).negativeCacheTtlMs ||
    Math.min(policy.defaultFreshnessMs, 60 * 60 * 1000)
  );
}

export function manifestToSourcePolicy(_manifest: ProviderManifest): ProviderSourcePolicy {
  return {
    timeoutMs: 30000,
    maxResponseBytes: 10 * 1024 * 1024,
    freshnessMs: 24 * 60 * 60 * 1000,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    negativeCacheTtlMs: 60 * 60 * 1000,
  };
}
