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
import { createBackoffFromManifest } from '../rate-limit/backoff';
import { createCircuitBreakerFromManifest } from '../rate-limit/circuit-breaker';
import { InMemoryCache } from '../cache/in-memory';
import type { CacheEntry } from '../cache/interface';
import { createCacheKey, DEFAULT_CACHE_POLICY } from '../cache/interface';
import { SecureHttpClient, DEFAULT_HTTP_CONFIG } from '../http/client';
import { createSourceObservation, createProvenanceStep } from '../evidence/source-observation';
import { createLocator } from '../evidence/locators';
import { computeContentHash } from '../evidence/source-observation';
import { toAdapterResult, PolicyBlockedError, RateLimitedError } from '../errors';

export interface CrossrefAdapterInput {
  mode: 'doi' | 'title' | 'bibliographic';
  doi?: string;
  title?: string;
  authors?: string[];
  containerTitle?: string;
  year?: number;
  query?: string;
  rows?: number;
  offset?: number;
  freshnessMs?: number;
  contactEmail?: string;
}

export interface CrossrefAdapterResult {
  items: CrossrefItem[];
  message?: string;
  'items-per-page': number;
  query: {
    'start-index': number;
    'search-terms': string;
  };
}

export interface CrossrefItem {
  DOI: string;
  title: string[];
  subtitle?: string[];
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
    sequence?: string;
    ORCID?: string;
    affiliation?: Array<{ name: string }>;
  }>;
  'container-title'?: string[];
  'short-container-title'?: string[];
  publisher?: string;
  published?: { 'date-parts': number[][] };
  'published-print'?: { 'date-parts': number[][] };
  'published-online'?: { 'date-parts': number[][] };
  type?: string;
  'reference-count'?: number;
  reference?: Array<{ DOI?: string; key?: string }>;
  relation?: Record<string, unknown>;
  license?: Array<{ URL: string; start: { 'date-parts': number[][] }; 'delay-in-days': number }>;
  URL?: string;
  archive?: string;
  indexed?: { 'date-parts': number[][] };
  deposited?: { 'date-parts': number[][] };
  created?: { 'date-parts': number[][] };
  'update-policy'?: string;
  source?: string;
  member?: string;
  prefix?: string;
  suffix?: string;
  score?: number;
}

export const CROSSREF_MANIFEST: ProviderManifest = {
  provider_id: 'crossref',
  source_class: 'public_index',
  base_uris: ['https://api.crossref.org'],
  capabilities: ['crossref_doi', 'crossref_title', 'crossref_bibliographic'],
  commercial_application_allowed: true,
  automated_access_allowed: true,
  transformed_output_allowed: true,
  raw_access_resale_allowed: false,
  sensitive_data_allowed: false,
  account_sharing_allowed: false,
  quota_multiplication_allowed: false,
  credentials_required: false,
  terms_uri: 'https://www.crossref.org/terms/',
  terms_hash: null,
  terms_review_status: 'pending_review',
  reviewed_at: null,
  rate_policy: {
    strategy: 'token_bucket',
    maximum_concurrency: 5,
    minimum_interval_ms: 200,
    retry_after_respected: true,
    maximum_retries: 3,
  },
  promotion_state: 'fixture_tested',
};

export class CrossrefAdapter
  implements ProviderAdapter<CrossrefAdapterInput, CrossrefAdapterResult>
{
  readonly providerId = 'crossref';
  readonly capabilities = ['crossref_doi', 'crossref_title', 'crossref_bibliographic'] as const;
  readonly manifest = CROSSREF_MANIFEST;

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
    input: CrossrefAdapterInput,
    context: AdapterExecutionContext
  ): Promise<AdapterResult<CrossrefAdapterResult>> {
    const cacheKey = createCacheKey({
      providerId: this.providerId,
      capability: `crossref_${input.mode}`,
      canonicalInput: JSON.stringify(input),
      sourcePolicyVersion: '1.0.0',
      adapterVersion: '0.1.0',
      normalizationVersion: '1.0.0',
    });

    if (context.cache_policy !== 'bypass') {
      const cached = await this.cache.get<CacheEntry<CrossrefAdapterResult>>(cacheKey);
      if (cached && !isExpired(cached, context.injected_clock.nowMs())) {
        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: `crossref_${input.mode}`,
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
          capability: `crossref_${input.mode}`,
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

        const limitations = [
          ...result.limitations,
          'Live access not verified',
          'Contact email not configured for polite pool',
        ];
        const observation = createCrossrefObservation(
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

        const cacheEntry: CacheEntry<CrossrefAdapterResult> = {
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
          capability: `crossref_${input.mode}`,
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
            capability: `crossref_${input.mode}`,
            cache_status: 'miss',
            freshness_status: 'unknown',
            warnings: [],
            limitations: [],
            error: { code: 'POLICY_BLOCKED', message: error.message, details: error.details },
          };
        }

        if (error instanceof RateLimitedError) {
          // SUN-1222C2-Q1-R2: SecureHttpClient now throws RateLimitedError
          // for a real 429 (it previously never threw Response at all --
          // this branch was unreachable dead code). retryAfterMs is
          // already parsed and bounded by classifyTerminalHttpStatus.
          const retryAfterMs = error.retryAfterMs;
          if (this.backoff.canRetry()) {
            await this.backoff.wait(retryAfterMs);
            continue;
          }
          return {
            resultClass: 'rate_limited',
            provider_id: this.providerId,
            capability: `crossref_${input.mode}`,
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
      capability: `crossref_${input.mode}`,
      cache_status: 'miss',
      freshness_status: 'unknown',
      warnings: [],
      limitations: [],
      error,
    };
  }

  private buildUrl(input: CrossrefAdapterInput): string {
    const base = 'https://api.crossref.org';
    const params = new URLSearchParams();

    if (input.rows) params.set('rows', String(input.rows));
    if (input.offset) params.set('offset', String(input.offset));
    if (input.contactEmail) params.set('mailto', input.contactEmail);

    let path = '';
    switch (input.mode) {
      case 'doi':
        if (!input.doi) throw new Error('DOI required for doi mode');
        path = `/works/${encodeURIComponent(input.doi)}`;
        break;
      case 'title':
        if (!input.title) throw new Error('Title required for title mode');
        path = '/works';
        params.set('query.title', input.title);
        break;
      case 'bibliographic':
        path = '/works';
        if (input.title) params.set('query.title', input.title);
        if (input.authors?.length) params.set('query.author', input.authors.join(' '));
        if (input.containerTitle) params.set('query.container-title', input.containerTitle);
        if (input.year)
          params.set(
            'filter',
            `from-pub-date:${input.year}-01-01,until-pub-date:${input.year}-12-31`
          );
        if (input.query) params.set('query', input.query);
        break;
    }

    return `${base}${path}?${params.toString()}`;
  }

  private async fetchAndNormalize(
    input: CrossrefAdapterInput,
    _context: AdapterExecutionContext
  ): Promise<
    CrossrefAdapterResult & { contentHash: string; warnings: string[]; limitations: string[] }
  > {
    const url = this.buildUrl(input);
    const response = await this.httpClient.fetchJson<CrossrefAdapterResult>(url);

    const warnings: string[] = [];
    const limitations: string[] = [];

    if (response.truncated) {
      warnings.push('Response was truncated due to size limits');
    }

    let items: CrossrefItem[] = [];
    if (input.mode === 'doi' && response.data.items && response.data.items[0]?.DOI) {
      items = response.data.items;
    } else if (response.data.items && response.data.items[0]?.DOI) {
      items = response.data.items;
    } else if ('DOI' in response.data) {
      items = [response.data as unknown as CrossrefItem];
    } else if (response.data.items) {
      items = response.data.items;
    }

    if (items.length === 0) {
      limitations.push('No results found');
    }

    const contentHash = await computeContentHash(JSON.stringify(response.data));

    return { ...response.data, items, contentHash, warnings, limitations };
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
      limitations: [
        'Live access not verified',
        'Terms review pending',
        'Contact email not configured for polite pool',
      ],
    };
  }
}

function createCrossrefObservation(
  result: CrossrefAdapterResult & { contentHash: string },
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
    createLocator('json_pointer', '/items', sourceUrl),
    createLocator('json_pointer', '/message', sourceUrl),
  ];

  for (let i = 0; i < Math.min(result.items.length, 5); i++) {
    locators.push(
      createLocator('json_pointer', `/items/${i}/DOI`, sourceUrl),
      createLocator('json_pointer', `/items/${i}/title`, sourceUrl)
    );
  }

  const transformationHistory = [
    createProvenanceStep('fetch_crossref', adapterVersion),
    createProvenanceStep('normalize_results', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'crossref',
    capability: 'crossref_doi',
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
