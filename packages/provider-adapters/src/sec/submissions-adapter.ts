import type {
  ProviderAdapter,
  ProviderManifest,
  AdapterExecutionContext,
  AdapterHealthContext,
  AdapterHealthResult,
  AdapterResult,
  AdapterResultClass,
} from '../types';
import type { SecSubmissionsAdapterInput, SecSubmissionsAdapterResult } from './normalizers';
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
import type { SecSubmissionsResponse } from './submissions';
import {
  buildSubmissionsUrl,
  normalizeEntity,
  normalizeFilings,
  filterFilings,
} from './submissions';
import {
  validateEntityMatch,
  createSecSubmissionsObservation,
  SEC_ADAPTER_VERSION,
} from './normalizers';
import { toAdapterResult, PolicyBlockedError } from '../errors';
import { computeContentHash } from '../evidence/source-observation';

/**
 * SUN-1222C2-Q1-R1: SEC's Fair Access guidance
 * (https://www.sec.gov/os/accessing-edgar-data,
 * https://www.sec.gov/developer -- both reviewed 2026-09-06) asks automated
 * clients to declare a User-Agent identifying the requesting organization
 * and an administrative contact, sample format "Sample Company Name
 * AdminContact@<sample company domain>.com". No source in this repository's
 * own tracked files (source, docs, config) records an administrative
 * contact email -- but `git log --format='%an <%ae>'` shows `SiteBorne
 * <hello@siteborne.com>` as the sole author identity across this
 * repository's entire real commit history, pushed to the public
 * `github.com/SiteBorne/utility-network`. That address is therefore already
 * public (visible to anyone viewing the repository's commit history) and is
 * SITEBORNE's own canonical identity, not a value this checkpoint invented.
 * The organization name matches the same one already published verbatim in
 * the production Agent Card (`packages/protocol-a2a/src/card.ts`:
 * `provider: { organization: 'SITEBORNE', url: 'https://siteborne.com' }`).
 * Duplicated as a literal here rather than imported: `provider-adapters`
 * intentionally has no runtime dependency on `protocol-a2a` (see this
 * package's own `package.json` -- zero `@siteborne/*` dependencies), and
 * this string is small enough that adding a cross-package coupling for it
 * would cost more than it saves.
 */
export const SEC_EDGAR_DECLARED_USER_AGENT = 'SITEBORNE hello@siteborne.com';

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

export class SecSubmissionsAdapter
  implements ProviderAdapter<SecSubmissionsAdapterInput, SecSubmissionsAdapterResult>
{
  readonly providerId = 'sec-edgar';
  readonly capabilities = ['company_submissions'] as const;
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
    input: SecSubmissionsAdapterInput,
    context: AdapterExecutionContext
  ): Promise<AdapterResult<SecSubmissionsAdapterResult>> {
    const cacheKey = createCacheKey({
      providerId: this.providerId,
      capability: 'company_submissions',
      canonicalInput: JSON.stringify({
        cik: input.cik,
        forms: input.forms,
        maxFilings: input.maxFilings,
      }),
      sourcePolicyVersion: '1.0.0',
      adapterVersion: SEC_ADAPTER_VERSION,
      normalizationVersion: '1.0.0',
    });

    if (context.cache_policy !== 'bypass') {
      const cached = await this.cache.get<CacheEntry<SecSubmissionsAdapterResult>>(cacheKey);
      if (cached && !isExpired(cached, context.injected_clock.nowMs())) {
        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: 'company_submissions',
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
          capability: 'company_submissions',
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

        const observation = createSecSubmissionsObservation(
          result.entity,
          result.filings,
          buildSubmissionsUrl(input.cik),
          result.contentHash,
          SEC_ADAPTER_VERSION,
          '1.0.0',
          'miss',
          'fresh',
          result.warnings,
          result.limitations
        );

        const cacheEntry: CacheEntry<SecSubmissionsAdapterResult> = {
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
          capability: 'company_submissions',
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
            capability: 'company_submissions',
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
            capability: 'company_submissions',
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
      capability: 'company_submissions',
      cache_status: 'miss',
      freshness_status: 'unknown',
      warnings: [],
      limitations: [],
      error,
    };
  }

  private async fetchAndNormalize(
    input: SecSubmissionsAdapterInput,
    _context: AdapterExecutionContext
  ): Promise<SecSubmissionsAdapterResult & { contentHash: string }> {
    const url = buildSubmissionsUrl(input.cik);
    const response = await this.httpClient.fetchJson<SecSubmissionsResponse>(url, {
      headers: { 'User-Agent': SEC_EDGAR_DECLARED_USER_AGENT },
    });

    const entity = normalizeEntity(response.data);
    let filings = normalizeFilings(response.data);

    filings = filterFilings(filings, {
      forms: input.forms,
      maxCount: input.maxFilings,
    });

    const match = validateEntityMatch(entity, input.expectedName, input.expectedTicker);
    const warnings = [...match.warnings];
    const limitations: string[] = [];

    if (response.truncated) {
      warnings.push('Response was truncated due to size limits');
    }

    if (filings.length === 0) {
      limitations.push('No filings found matching criteria');
    }

    const contentHash = await computeContentHash(JSON.stringify(response.data));

    return { entity, filings, warnings, limitations, contentHash };
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
