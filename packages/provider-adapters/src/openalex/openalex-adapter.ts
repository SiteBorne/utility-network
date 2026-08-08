import type {
  ProviderAdapter,
  ProviderManifest,
  AdapterExecutionContext,
  AdapterHealthContext,
  AdapterHealthResult,
  AdapterResult,
  AdapterResultClass,
  SourceObservation,
} from '../types';
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
import { createSourceObservation, createProvenanceStep } from '../evidence/source-observation';
import { createLocator } from '../evidence/locators';
import { computeContentHash } from '../evidence/source-observation';
import { toAdapterResult, PolicyBlockedError } from '../errors';

export interface OpenAlexAdapterInput {
  mode: 'work' | 'author' | 'institution' | 'source' | 'concept';
  identifier?: string;
  doi?: string;
  title?: string;
  filter?: Record<string, string>;
  perPage?: number;
  page?: number;
  freshnessMs?: number;
}

export interface OpenAlexAdapterResult {
  results: OpenAlexWork[];
  meta: {
    count: number;
    page: number;
    per_page: number;
    next_cursor?: string;
  };
}

export interface OpenAlexWork {
  id: string;
  doi: string | null;
  title: string;
  publication_year: number | null;
  publication_date: string | null;
  type: string;
  cited_by_count: number;
  is_retracted: boolean;
  is_paratext: boolean;
  authorships: Array<{
    author: { id: string; display_name: string; orcid: string | null };
    institutions: Array<{ id: string; display_name: string; ror: string | null }>;
    raw_author_name: string;
  }>;
  primary_location: {
    source: { id: string; display_name: string; issn_l: string | null; issn: string[] } | null;
    landing_page_url: string | null;
    pdf_url: string | null;
    is_oa: boolean;
    version: string | null;
    license: string | null;
  } | null;
  locations: Array<{
    source: { id: string; display_name: string; issn_l: string | null; issn: string[] } | null;
    landing_page_url: string | null;
    pdf_url: string | null;
    is_oa: boolean;
    version: string | null;
    license: string | null;
  }>;
  best_oa_location: {
    source: { id: string; display_name: string; issn_l: string | null; issn: string[] } | null;
    landing_page_url: string | null;
    pdf_url: string | null;
    is_oa: boolean;
    version: string | null;
    license: string | null;
  } | null;
  concepts: Array<{ id: string; display_name: string; level: number; score: number }>;
  mesh: Array<{
    descriptor_ui: string;
    descriptor_name: string;
    qualifier_ui: string | null;
    qualifier_name: string | null;
    is_major_topic: boolean;
  }>;
  open_access: { is_oa: boolean; oa_status: string; oa_url: string | null };
  referenced_works: string[];
  related_works: string[];
  abstract_inverted_index: Record<string, number[]> | null;
  language: string | null;
  updated_date: string;
  created_date: string;
}

export const OPENALEX_MANIFEST: ProviderManifest = {
  provider_id: 'openalex',
  source_class: 'public_index',
  base_uris: ['https://api.openalex.org'],
  capabilities: [
    'openalex_work',
    'openalex_author',
    'openalex_institution',
    'openalex_source',
    'openalex_concept',
  ],
  commercial_application_allowed: true,
  automated_access_allowed: true,
  transformed_output_allowed: true,
  raw_access_resale_allowed: false,
  sensitive_data_allowed: false,
  account_sharing_allowed: false,
  quota_multiplication_allowed: false,
  credentials_required: false,
  terms_uri: 'https://openalex.org/terms',
  terms_hash: null,
  terms_review_status: 'pending_review',
  reviewed_at: null,
  rate_policy: {
    strategy: 'token_bucket',
    maximum_concurrency: 5,
    minimum_interval_ms: 100,
    retry_after_respected: true,
    maximum_retries: 3,
  },
  promotion_state: 'fixture_tested',
};

export class OpenAlexAdapter
  implements ProviderAdapter<OpenAlexAdapterInput, OpenAlexAdapterResult>
{
  readonly providerId = 'openalex';
  readonly capabilities = [
    'openalex_work',
    'openalex_author',
    'openalex_institution',
    'openalex_source',
    'openalex_concept',
  ] as const;
  readonly manifest = OPENALEX_MANIFEST;

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
    input: OpenAlexAdapterInput,
    context: AdapterExecutionContext
  ): Promise<AdapterResult<OpenAlexAdapterResult>> {
    const cacheKey = createCacheKey({
      providerId: this.providerId,
      capability: `openalex_${input.mode}`,
      canonicalInput: JSON.stringify(input),
      sourcePolicyVersion: '1.0.0',
      adapterVersion: '0.1.0',
      normalizationVersion: '1.0.0',
    });

    if (context.cache_policy !== 'bypass') {
      const cached = await this.cache.get<CacheEntry<OpenAlexAdapterResult>>(cacheKey);
      if (cached && !isExpired(cached, context.injected_clock.nowMs())) {
        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: `openalex_${input.mode}`,
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
          capability: `openalex_${input.mode}`,
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

        const limitations = [...result.limitations, 'Live access not verified'];
        const observation = createOpenAlexObservation(
          result,
          this.buildUrl(input),
          result.contentHash,
          '0.1.0',
          '1.0.0',
          'miss',
          'fresh',
          result.warnings,
          limitations
        );

        const cacheEntry: CacheEntry<OpenAlexAdapterResult> = {
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
          capability: `openalex_${input.mode}`,
          observations: [observation],
          cache_status: 'miss',
          freshness_status: 'fresh',
          warnings: result.warnings,
          limitations,
        };
      } catch (error) {
        this.rateLimiter.release();
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof PolicyBlockedError) {
          return {
            resultClass: 'policy_blocked',
            provider_id: this.providerId,
            capability: `openalex_${input.mode}`,
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
            capability: `openalex_${input.mode}`,
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
      capability: `openalex_${input.mode}`,
      cache_status: 'miss',
      freshness_status: 'unknown',
      warnings: [],
      limitations: [],
      error,
    };
  }

  private buildUrl(input: OpenAlexAdapterInput): string {
    const base = 'https://api.openalex.org';
    const params = new URLSearchParams();

    if (input.perPage) params.set('per-page', String(input.perPage));
    if (input.page) params.set('page', String(input.page));

    if (input.filter) {
      for (const [key, value] of Object.entries(input.filter)) {
        params.set(`filter[${key}]`, value);
      }
    }

    let path = '';
    switch (input.mode) {
      case 'work':
        path = input.identifier ? `/works/${input.identifier}` : '/works';
        break;
      case 'author':
        path = input.identifier ? `/authors/${input.identifier}` : '/authors';
        break;
      case 'institution':
        path = input.identifier ? `/institutions/${input.identifier}` : '/institutions';
        break;
      case 'source':
        path = input.identifier ? `/sources/${input.identifier}` : '/sources';
        break;
      case 'concept':
        path = input.identifier ? `/concepts/${input.identifier}` : '/concepts';
        break;
    }

    if (input.doi && input.mode === 'work') {
      path = `/works/https://doi.org/${encodeURIComponent(input.doi)}`;
    }

    return `${base}${path}?${params.toString()}`;
  }

  private async fetchAndNormalize(
    input: OpenAlexAdapterInput,
    _context: AdapterExecutionContext
  ): Promise<
    OpenAlexAdapterResult & { contentHash: string; warnings: string[]; limitations: string[] }
  > {
    const url = this.buildUrl(input);
    const response = await this.httpClient.fetchJson<OpenAlexAdapterResult>(url);

    const warnings: string[] = [];
    const limitations: string[] = [];

    if (response.truncated) {
      warnings.push('Response was truncated due to size limits');
    }

    if (response.data.results.length === 0) {
      limitations.push('No results found');
    }

    if (input.mode === 'work' && response.data.results.length > 0) {
      for (const work of response.data.results) {
        if (work.cited_by_count > 0) {
          limitations.push('Citation counts are observations at retrieval time, not stable facts');
          break;
        }
      }
    }

    const contentHash = await computeContentHash(JSON.stringify(response.data));

    return { ...response.data, contentHash, warnings, limitations };
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
      adapter_version: '0.1.0',
      limitations: ['Live access not verified', 'Terms review pending'],
    };
  }
}

function createOpenAlexObservation(
  result: OpenAlexAdapterResult & { contentHash: string },
  sourceUrl: string,
  contentHash: string,
  adapterVersion: string,
  policyVersion: string,
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypassed',
  freshnessStatus: 'fresh' | 'stale' | 'unknown',
  warnings: string[],
  limitations: string[]
): SourceObservation {
  const locators = [
    createLocator('json_pointer', '/results', sourceUrl),
    createLocator('json_pointer', '/meta', sourceUrl),
  ];

  for (let i = 0; i < Math.min(result.results.length, 5); i++) {
    locators.push(
      createLocator('json_pointer', `/results/${i}/id`, sourceUrl),
      createLocator('json_pointer', `/results/${i}/doi`, sourceUrl),
      createLocator('json_pointer', `/results/${i}/title`, sourceUrl)
    );
  }

  const transformationHistory = [
    createProvenanceStep('fetch_openalex', adapterVersion),
    createProvenanceStep('normalize_results', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'openalex',
    capability: 'openalex_work',
    sourceUri: sourceUrl,
    sourceType: 'public_index',
    retrievedAt: new Date(),
    contentHash,
    mediaType: 'application/json',
    evidenceLocators: locators,
    normalizedValue: result,
    rawValueHash: contentHash,
    adapterVersion,
    policyVersion,
    cacheStatus,
    freshnessStatus,
    authorizationClassification: 'public',
    limitations,
    warnings,
    transformationHistory,
  });
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return now >= entry.expiresAt;
}

function getFreshnessStatus(entry: CacheEntry, now: number): 'fresh' | 'stale' | 'unknown' {
  if (now >= entry.expiresAt) return 'stale';
  return 'fresh';
}
