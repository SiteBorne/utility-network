import type {
  ProviderAdapter,
  ProviderManifest,
  AdapterHealthResult,
  InjectedClock,
  InjectedHttpClient,
} from './types';

export class AdapterRegistry {
  private adapters = new Map<string, ProviderAdapter<unknown, unknown>>();
  private manifestCache = new Map<string, ProviderManifest>();
  private healthCache = new Map<string, AdapterHealthResult>();

  register(adapter: ProviderAdapter<unknown, unknown>): void {
    const id = adapter.providerId;
    if (this.adapters.has(id)) {
      throw new Error(`Duplicate provider ID: ${id}`);
    }
    this.adapters.set(id, adapter);
    this.manifestCache.set(id, adapter.manifest);
  }

  get<TInput, TOutput>(providerId: string): ProviderAdapter<TInput, TOutput> | undefined {
    return this.adapters.get(providerId) as ProviderAdapter<TInput, TOutput> | undefined;
  }

  getByCapability(capability: string): ProviderAdapter<unknown, unknown>[] {
    const results: ProviderAdapter<unknown, unknown>[] = [];
    for (const adapter of this.adapters.values()) {
      if (adapter.capabilities.includes(capability)) {
        results.push(adapter);
      }
    }
    return results;
  }

  getManifest(providerId: string): ProviderManifest | undefined {
    return this.manifestCache.get(providerId);
  }

  hasProvider(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }

  listCapabilities(): string[] {
    const caps = new Set<string>();
    for (const adapter of this.adapters.values()) {
      for (const cap of adapter.capabilities) {
        caps.add(cap);
      }
    }
    return Array.from(caps);
  }

  isEnabledForLiveUse(providerId: string): boolean {
    const manifest = this.manifestCache.get(providerId);
    if (!manifest) return false;
    return (
      manifest.terms_review_status === 'verified' &&
      manifest.promotion_state === 'EXECUTABLE_VERIFIED'
    );
  }

  getTermsStatus(providerId: string): 'verified' | 'pending_review' | 'blocked' | 'unknown' {
    const manifest = this.manifestCache.get(providerId);
    if (!manifest) return 'unknown';
    return manifest.terms_review_status;
  }

  getPromotionState(providerId: string): string | undefined {
    const manifest = this.manifestCache.get(providerId);
    return manifest?.promotion_state;
  }

  async checkHealth(
    providerId: string,
    context: { clock: InjectedClock; httpClient: InjectedHttpClient }
  ): Promise<AdapterHealthResult | undefined> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) return undefined;
    const health = await adapter.health({
      request_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      injected_clock: context.clock,
      injected_http_client: context.httpClient,
    });
    this.healthCache.set(providerId, health);
    return health;
  }

  getCachedHealth(providerId: string): AdapterHealthResult | undefined {
    return this.healthCache.get(providerId);
  }

  clearHealthCache(): void {
    this.healthCache.clear();
  }

  validateAll(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const seenIds = new Set<string>();
    for (const [id, adapter] of this.adapters.entries()) {
      if (seenIds.has(id)) {
        errors.push(`Duplicate provider ID: ${id}`);
      }
      seenIds.add(id);
      if (adapter.providerId !== id) {
        errors.push(
          `Provider ID mismatch: registry key ${id} vs adapter.providerId ${adapter.providerId}`
        );
      }
      if (!adapter.manifest) {
        errors.push(`Provider ${id} missing manifest`);
      }
      if (!adapter.capabilities || adapter.capabilities.length === 0) {
        errors.push(`Provider ${id} has no capabilities`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
}

export const globalRegistry = new AdapterRegistry();
