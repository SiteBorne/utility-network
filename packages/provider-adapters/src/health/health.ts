import type {
  AdapterHealthResult,
  ProviderManifest,
  InjectedClock,
  InjectedHttpClient,
} from '../types';
import type { AdapterRegistry } from '../registry';

export interface SourceHealthSummary {
  providerId: string;
  state:
    | 'fixture_verified'
    | 'locally_live_verified'
    | 'live_unverified'
    | 'policy_blocked'
    | 'degraded'
    | 'unavailable'
    | 'unknown';
  lastFixtureTest: string | null;
  lastLiveSuccess: string | null;
  lastLiveFailure: string | null;
  fixturePassRate: number | null;
  liveSuccessRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  rateLimitedCount: number;
  schemaDriftCount: number;
  circuitState: 'closed' | 'open' | 'half_open';
  termsStatus: 'verified' | 'pending_review' | 'blocked' | 'unknown';
  adapterVersion: string;
  limitations: string[];
  manifest: ProviderManifest;
}

export class HealthMonitor {
  private registry: AdapterRegistry;
  private healthHistory = new Map<string, AdapterHealthResult[]>();

  constructor(registry: AdapterRegistry) {
    this.registry = registry;
  }

  async checkAllHealth(context: {
    clock: InjectedClock;
    httpClient: InjectedHttpClient;
  }): Promise<SourceHealthSummary[]> {
    const summaries: SourceHealthSummary[] = [];

    for (const providerId of this.registry.listProviders()) {
      const health = await this.registry.checkHealth(providerId, context);
      const manifest = this.registry.getManifest(providerId);

      if (health && manifest) {
        this.recordHealth(providerId, health);

        summaries.push({
          providerId,
          state: health.state,
          lastFixtureTest: health.last_fixture_test || null,
          lastLiveSuccess: health.last_live_success || null,
          lastLiveFailure: health.last_live_failure || null,
          fixturePassRate: health.fixture_pass_rate || null,
          liveSuccessRate: health.live_success_rate || null,
          p50LatencyMs: health.p50_latency_ms || null,
          p95LatencyMs: health.p95_latency_ms || null,
          rateLimitedCount: health.rate_limited_count,
          schemaDriftCount: health.schema_drift_count,
          circuitState: health.circuit_state,
          termsStatus: health.terms_status,
          adapterVersion: health.adapter_version,
          limitations: health.limitations,
          manifest,
        });
      } else {
        const manifest = this.registry.getManifest(providerId);
        if (manifest) {
          summaries.push({
            providerId,
            state: 'unknown',
            lastFixtureTest: null,
            lastLiveSuccess: null,
            lastLiveFailure: null,
            fixturePassRate: null,
            liveSuccessRate: null,
            p50LatencyMs: null,
            p95LatencyMs: null,
            rateLimitedCount: 0,
            schemaDriftCount: 0,
            circuitState: 'closed',
            termsStatus: manifest.terms_review_status,
            adapterVersion: '0.1.0',
            limitations: ['Health check not available'],
            manifest,
          });
        }
      }
    }

    return summaries;
  }

  recordHealth(providerId: string, health: AdapterHealthResult): void {
    if (!this.healthHistory.has(providerId)) {
      this.healthHistory.set(providerId, []);
    }
    const history = this.healthHistory.get(providerId)!;
    history.push(health);
    if (history.length > 100) history.shift();
  }

  getHealthHistory(providerId: string): AdapterHealthResult[] {
    return this.healthHistory.get(providerId) || [];
  }

  getAggregatedHealth(providerId: string): {
    fixturePassRate: number;
    liveSuccessRate: number;
    avgP50Latency: number;
    avgP95Latency: number;
    totalRateLimited: number;
    totalSchemaDrift: number;
  } | null {
    const history = this.healthHistory.get(providerId);
    if (!history || history.length === 0) return null;

    const fixtureTests = history.filter((h) => h.last_fixture_test);
    const liveTests = history.filter((h) => h.last_live_success || h.last_live_failure);

    return {
      fixturePassRate:
        fixtureTests.length > 0
          ? fixtureTests.filter((h) => h.state === 'fixture_verified').length / fixtureTests.length
          : 0,
      liveSuccessRate:
        liveTests.length > 0
          ? liveTests.filter((h) => h.last_live_success).length / liveTests.length
          : 0,
      avgP50Latency: history.reduce((sum, h) => sum + (h.p50_latency_ms || 0), 0) / history.length,
      avgP95Latency: history.reduce((sum, h) => sum + (h.p95_latency_ms || 0), 0) / history.length,
      totalRateLimited: history.reduce((sum, h) => sum + h.rate_limited_count, 0),
      totalSchemaDrift: history.reduce((sum, h) => sum + h.schema_drift_count, 0),
    };
  }

  getProductionReadyProviders(): string[] {
    const ready: string[] = [];
    for (const providerId of this.registry.listProviders()) {
      const manifest = this.registry.getManifest(providerId);
      if (manifest && this.registry.isEnabledForLiveUse(providerId)) {
        ready.push(providerId);
      }
    }
    return ready;
  }

  getBlockedProviders(): string[] {
    const blocked: string[] = [];
    for (const providerId of this.registry.listProviders()) {
      const termsStatus = this.registry.getTermsStatus(providerId);
      if (termsStatus === 'blocked' || termsStatus === 'pending_review') {
        blocked.push(providerId);
      }
    }
    return blocked;
  }
}

export function createHealthMonitor(registry: AdapterRegistry): HealthMonitor {
  return new HealthMonitor(registry);
}
