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

export interface FederalRegisterAdapterInput {
  mode: 'document' | 'search' | 'agency';
  documentNumber?: string;
  agency?: string;
  searchTerm?: string;
  startDate?: string;
  endDate?: string;
  perPage?: number;
  page?: number;
  freshnessMs?: number;
}

export interface FederalRegisterAdapterResult {
  results: FederalRegisterDocument[];
  meta: {
    count: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}

export interface FederalRegisterDocument {
  document_number: string;
  title: string;
  type: string;
  abstract: string | null;
  html_url: string;
  pdf_url: string | null;
  publication_date: string;
  effective_date: string | null;
  agencies: Array<{ name: string; id: number; url: string }>;
  action: string | null;
  docket_ids: string[];
  regulatory_plan: string | null;
  citations: Array<{ type: string; citation: string }>;
  significant: boolean;
  presidential_document_type: string | null;
  president: string | null;
  excerpt: string | null;
  comments_close_on: string | null;
  correction_of: string | null;
  corrections: string[];
  volume: number;
  page: number;
  toc_doc: string | null;
  toc_subject: string | null;
}

export const FEDERAL_REGISTER_MANIFEST: ProviderManifest = {
  provider_id: 'federal-register',
  source_class: 'authoritative',
  base_uris: ['https://www.federalregister.gov'],
  capabilities: ['federal_register_document', 'federal_register_search', 'federal_register_agency'],
  commercial_application_allowed: true,
  automated_access_allowed: true,
  transformed_output_allowed: true,
  raw_access_resale_allowed: false,
  sensitive_data_allowed: false,
  account_sharing_allowed: false,
  quota_multiplication_allowed: false,
  credentials_required: false,
  terms_uri: 'https://www.federalregister.gov/about/developers',
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

export class FederalRegisterAdapter
  implements ProviderAdapter<FederalRegisterAdapterInput, FederalRegisterAdapterResult>
{
  readonly providerId = 'federal-register';
  readonly capabilities = [
    'federal_register_document',
    'federal_register_search',
    'federal_register_agency',
  ] as const;
  readonly manifest = FEDERAL_REGISTER_MANIFEST;

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
    input: FederalRegisterAdapterInput,
    context: AdapterExecutionContext
  ): Promise<AdapterResult<FederalRegisterAdapterResult>> {
    const cacheKey = createCacheKey({
      providerId: this.providerId,
      capability: `federal_register_${input.mode}`,
      canonicalInput: JSON.stringify(input),
      sourcePolicyVersion: '1.0.0',
      adapterVersion: '0.1.0',
      normalizationVersion: '1.0.0',
    });

    if (context.cache_policy !== 'bypass') {
      const cached = await this.cache.get<CacheEntry<FederalRegisterAdapterResult>>(cacheKey);
      if (cached && !isExpired(cached, context.injected_clock.nowMs())) {
        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: `federal_register_${input.mode}`,
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
          capability: `federal_register_${input.mode}`,
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
        const observation = createFederalRegisterObservation(
          result,
          this.buildUrl(input),
          result.contentHash,
          '0.1.0',
          '1.0.0',
          'miss',
          'fresh',
          [],
          limitations
        );

        const cacheEntry: CacheEntry<FederalRegisterAdapterResult> = {
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
          capability: `federal_register_${input.mode}`,
          observations: [observation],
          cache_status: 'miss',
          freshness_status: 'fresh',
          warnings: [],
          limitations,
        };
      } catch (error) {
        this.rateLimiter.release();
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof PolicyBlockedError) {
          return {
            resultClass: 'policy_blocked',
            provider_id: this.providerId,
            capability: `federal_register_${input.mode}`,
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
            capability: `federal_register_${input.mode}`,
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
      capability: `federal_register_${input.mode}`,
      cache_status: 'miss',
      freshness_status: 'unknown',
      warnings: [],
      limitations: [],
      error,
    };
  }

  private buildUrl(input: FederalRegisterAdapterInput): string {
    const base = 'https://www.federalregister.gov/api/v1';
    const params = new URLSearchParams();

    if (input.perPage) params.set('per_page', String(input.perPage));
    if (input.page) params.set('page', String(input.page));

    let path = '';
    switch (input.mode) {
      case 'document':
        if (!input.documentNumber) throw new Error('Document number required for document mode');
        path = `/documents/${encodeURIComponent(input.documentNumber)}`;
        break;
      case 'search':
        path = '/documents';
        if (input.searchTerm) params.set('conditions[term]', input.searchTerm);
        if (input.agency) params.set('conditions[agencies][]', input.agency);
        if (input.startDate) params.set('conditions[publication_date][gte]', input.startDate);
        if (input.endDate) params.set('conditions[publication_date][lte]', input.endDate);
        params.set('order', 'newest');
        break;
      case 'agency':
        if (!input.agency) throw new Error('Agency required for agency mode');
        path = '/documents';
        params.set('conditions[agencies][]', input.agency);
        params.set('order', 'newest');
        break;
    }

    return `${base}${path}?${params.toString()}`;
  }

  private async fetchAndNormalize(
    input: FederalRegisterAdapterInput,
    _context: AdapterExecutionContext
  ): Promise<FederalRegisterAdapterResult & { contentHash: string; limitations: string[] }> {
    const url = this.buildUrl(input);

    let results: FederalRegisterDocument[];
    let meta: { count: number; page: number; per_page: number; total_pages: number };

    if (input.mode === 'document') {
      const response = await this.httpClient.fetchJson<FederalRegisterDocument>(url);
      results = [response.data];
      meta = { count: 1, page: 1, per_page: 1, total_pages: 1 };
    } else {
      const response = await this.httpClient.fetchJson<FederalRegisterAdapterResult>(url);
      results = response.data.results || [];
      meta = response.data.meta || {
        count: results.length,
        page: 1,
        per_page: results.length,
        total_pages: 1,
      };
    }

    const limitations: string[] = [];

    if (results.length === 0) {
      limitations.push('No documents found matching criteria');
    }

    if (input.mode !== 'document') {
      limitations.push('Search results do not imply enforcement or adverse regulatory events');
      limitations.push('Organization mentions require context analysis');
    }

    const contentHash = await computeContentHash(JSON.stringify({ results, meta }));

    return {
      results,
      meta,
      contentHash,
      limitations,
    };
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

function createFederalRegisterObservation(
  result: FederalRegisterAdapterResult & { contentHash: string },
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
      createLocator('json_pointer', `/results/${i}/document_number`, sourceUrl),
      createLocator('json_pointer', `/results/${i}/title`, sourceUrl),
      createLocator('json_pointer', `/results/${i}/agencies`, sourceUrl)
    );
  }

  const transformationHistory = [
    createProvenanceStep('fetch_federal_register', adapterVersion),
    createProvenanceStep('normalize_results', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'federal-register',
    capability: 'federal_register_document',
    sourceUri: sourceUrl,
    sourceType: 'authoritative',
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
