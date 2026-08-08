import type {
  ProviderAdapter,
  ProviderManifest,
  AdapterExecutionContext,
  AdapterHealthContext,
  AdapterHealthResult,
  AdapterResult,
  AdapterResultClass,
} from '../types';
import type { SecCompanyFactsAdapterInput, SecCompanyFactsAdapterResult } from './normalizers';
import type {
  InjectedHttpClient,
  InjectedClock,
  RateLimiter,
  ArtifactStore,
  AuditEventSink,
} from '../context';
import { globalTermsGuard } from '../policy/terms-guard';
import { createRateLimiter } from '../rate-limit/limiter';
import { createBackoffFromManifest, parseRetryAfterMs } from '../rate-limit/backoff';
import { createCircuitBreakerFromManifest } from '../rate-limit/circuit-breaker';
import { InMemoryCache } from '../cache/in-memory';
import type { CacheEntry } from '../cache/interface';
import { createCacheKey, DEFAULT_CACHE_POLICY } from '../cache/interface';
import { SecureHttpClient, DEFAULT_HTTP_CONFIG } from '../http/client';
import type { SecCompanyFactsResponse } from './company-facts';
import { buildCompanyFactsUrl, normalizeCompanyFacts, detectAmendedFilings } from './company-facts';
import { createSecCompanyFactsObservation, SEC_ADAPTER_VERSION } from './normalizers';
import { toAdapterResult, PolicyBlockedError } from '../errors';
import { computeContentHash } from '../evidence/source-observation';

export const SEC_EDGAR_MANIFEST: ProviderManifest = {
  provider_id: 'sec-edgar',
  source_class: 'authoritative',
  base_uris: ['https://data.sec.gov', 'https://www.sec.gov'],
  capabilities: ['company_submissions', 'company_facts'],
  commercial_application_allowed: true,
  automated_access_allowed: true,
  transformed_output_allowed: true,
  raw_access_resale_allowed: false,
  sensitive_data_allowed: false,
  account_sharing_allowed: false,
  quota_multiplication_allowed: false,
  credentials_required: false,
  terms_uri: 'https://www.sec.gov/os/accessing-edgar-data',
  terms_hash: null,
  terms_review_status: 'pending_review',
  reviewed_at: null,
  rate_policy: {
    strategy: 'token_bucket',
    maximum_concurrency: 10,
    minimum_interval_ms: 100,
    retry_after_respected: true,
    maximum_retries: 3,
  },
  promotion_state: 'fixture_tested',
};

export class SecCompanyFactsAdapter
  implements ProviderAdapter<SecCompanyFactsAdapterInput, SecCompanyFactsAdapterResult>
{
  readonly providerId = 'sec-edgar';
  readonly capabilities = ['company_facts'] as const;
  readonly manifest = SEC_EDGAR_MANIFEST;

  private httpClient: SecureHttpClient;
  private rateLimiter: RateLimiter;
  private backoff: ReturnType<typeof createBackoffFromManifest>;
  private circuitBreaker: ReturnType<typeof createCircuitBreakerFromManifest>;
  private cache: InMemoryCache;

  constructor(
    httpClient: InjectedHttpClient,
    clock: InjectedClock,
    _artifactStore: ArtifactStore,
    _auditSink: AuditEventSink
  ) {
    this.httpClient = new SecureHttpClient(DEFAULT_HTTP_CONFIG, httpClient, clock);
    this.rateLimiter = createRateLimiter(
      {
        strategy: 'token_bucket',
        maximumConcurrency: this.manifest.rate_policy.maximum_concurrency,
        minimumIntervalMs: this.manifest.rate_policy.minimum_interval_ms,
        maximumTokens: this.manifest.rate_policy.maximum_concurrency * 2,
        refillRatePerSecond: 1000 / Math.max(1, this.manifest.rate_policy.minimum_interval_ms),
      },
      clock
    );
    this.backoff = createBackoffFromManifest(this.manifest, clock);
    this.circuitBreaker = createCircuitBreakerFromManifest(this.manifest, clock);
    this.cache = new InMemoryCache(clock, DEFAULT_CACHE_POLICY);
  }

  async execute(
    input: SecCompanyFactsAdapterInput,
    context: AdapterExecutionContext
  ): Promise<AdapterResult<SecCompanyFactsAdapterResult>> {
    const cacheKey = createCacheKey({
      providerId: this.providerId,
      capability: 'company_facts',
      canonicalInput: JSON.stringify({
        cik: input.cik,
        taxonomies: input.taxonomies,
        concepts: input.concepts,
        forms: input.forms,
        startDate: input.startDate,
        endDate: input.endDate,
        maxFacts: input.maxFacts,
      }),
      sourcePolicyVersion: '1.0.0',
      adapterVersion: SEC_ADAPTER_VERSION,
      normalizationVersion: '1.0.0',
    });

    if (context.cache_policy !== 'bypass') {
      const cached = await this.cache.get<CacheEntry<SecCompanyFactsAdapterResult>>(cacheKey);
      if (cached && !isExpired(cached, context.injected_clock.nowMs())) {
        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: 'company_facts',
          observations: cached.observations,
          cache_status: 'hit',
          freshness_status: getFreshnessStatus(cached, context.injected_clock.nowMs()),
          warnings: [],
          limitations: [],
        };
      }
    }

    try {
      globalTermsGuard.checkAccess(this.manifest, context.execution_mode);
    } catch (e) {
      if (e instanceof PolicyBlockedError) {
        return {
          resultClass: 'policy_blocked',
          provider_id: this.providerId,
          capability: 'company_facts',
          cache_status: 'miss',
          freshness_status: 'unknown',
          warnings: [],
          limitations: [],
          error: { code: 'POLICY_BLOCKED', message: e.message, details: e.details },
        };
      }
      throw e;
    }

    await this.rateLimiter.acquire();

    let lastError: Error | null = null;

    while (true) {
      try {
        const result = await this.circuitBreaker.execute(async () => {
          return await this.fetchAndNormalize(input, context);
        });

        this.rateLimiter.release();
        this.backoff.reset();

        const observation = createSecCompanyFactsObservation(
          result.facts,
          buildCompanyFactsUrl(input.cik),
          result.contentHash,
          SEC_ADAPTER_VERSION,
          '1.0.0',
          'miss',
          'fresh',
          result.warnings,
          result.limitations
        );

        const cacheEntry: CacheEntry<SecCompanyFactsAdapterResult> = {
          key: cacheKey,
          resultClass: 'success',
          observations: [observation],
          storedAt: context.injected_clock.nowMs(),
          expiresAt: context.injected_clock.nowMs() + DEFAULT_CACHE_POLICY.ttlMs,
          accessCount: 0,
          lastAccessedAt: context.injected_clock.nowMs(),
          contentHash: result.contentHash,
        };

        await this.cache.set(cacheKey, cacheEntry);

        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: 'company_facts',
          observations: [observation],
          cache_status: 'miss',
          freshness_status: 'fresh',
          warnings: result.warnings,
          limitations: result.limitations,
        };
      } catch (error) {
        this.rateLimiter.release();
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof PolicyBlockedError) {
          return {
            resultClass: 'policy_blocked',
            provider_id: this.providerId,
            capability: 'company_facts',
            cache_status: 'miss',
            freshness_status: 'unknown',
            warnings: [],
            limitations: [],
            error: { code: 'POLICY_BLOCKED', message: error.message, details: error.details },
          };
        }

        if (error instanceof Response && error.status === 429) {
          const retryAfter = error.headers.get('retry-after');
          const retryAfterMs = parseRetryAfterMs(retryAfter, context.injected_clock.nowMs());
          if (this.backoff.canRetry()) {
            await this.backoff.wait(retryAfterMs);
            continue;
          }
          return {
            resultClass: 'rate_limited',
            provider_id: this.providerId,
            capability: 'company_facts',
            cache_status: 'miss',
            freshness_status: 'unknown',
            warnings: [],
            limitations: [],
            error: { code: 'RATE_LIMITED', message: 'Rate limited', retry_after_ms: retryAfterMs },
          };
        }

        if (this.backoff.canRetry() && this.isRetryableError(error)) {
          await this.backoff.wait();
          continue;
        }

        break;
      }
    }

    const { resultClass, error } = toAdapterResult(lastError);
    return {
      resultClass: resultClass as AdapterResultClass,
      provider_id: this.providerId,
      capability: 'company_facts',
      cache_status: 'miss',
      freshness_status: 'unknown',
      warnings: [],
      limitations: [],
      error,
    };
  }

  private async fetchAndNormalize(
    input: SecCompanyFactsAdapterInput,
    _context: AdapterExecutionContext
  ): Promise<SecCompanyFactsAdapterResult & { contentHash: string }> {
    const url = buildCompanyFactsUrl(input.cik);
    const response = await this.httpClient.fetchJson<SecCompanyFactsResponse>(url);

    let facts = normalizeCompanyFacts(response.data, input);
    facts = detectAmendedFilings(facts);

    const warnings: string[] = [];
    const limitations: string[] = [];

    if (response.truncated) {
      warnings.push('Response was truncated due to size limits');
    }

    if (facts.length === 0) {
      limitations.push('No facts found matching criteria');
    }

    if (facts.length >= (input.maxFacts || 10000)) {
      warnings.push(`Fact limit reached (${facts.length})`);
    }

    const contentHash = await computeContentHash(JSON.stringify(response.data));

    return { facts, warnings, limitations, contentHash };
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('socket hang up')
      );
    }
    return false;
  }

  async health(_context: AdapterHealthContext): Promise<AdapterHealthResult> {
    return {
      provider_id: this.providerId,
      state: 'fixture_verified',
      last_fixture_test: new Date().toISOString(),
      rate_limited_count: 0,
      schema_drift_count: 0,
      circuit_state: this.circuitBreaker.getState().state,
      terms_status: this.manifest.terms_review_status,
      adapter_version: SEC_ADAPTER_VERSION,
      limitations: ['Live access not verified', 'Terms review pending'],
    };
  }
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return now >= entry.expiresAt;
}

function getFreshnessStatus(entry: CacheEntry, now: number): 'fresh' | 'stale' | 'unknown' {
  if (now >= entry.expiresAt) return 'stale';
  return 'fresh';
}
