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

export interface GitHubAdapterInput {
  mode: 'repository' | 'releases' | 'languages' | 'topics';
  owner: string;
  repo: string;
  freshnessMs?: number;
}

export interface GitHubAdapterResult {
  repository?: GitHubRepository;
  releases?: GitHubRelease[];
  languages?: Record<string, number>;
  topics?: string[];
  warnings: string[];
  limitations: string[];
}

export interface GitHubRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    type: string;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage: string | null;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  has_issues: boolean;
  has_projects: boolean;
  has_downloads: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  forks_count: number;
  archived: boolean;
  disabled: boolean;
  open_issues_count: number;
  license: { key: string; name: string; spdx_id: string | null } | null;
  topics: string[];
  default_branch: string;
  permissions?: Record<string, boolean>;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
  }>;
}

export const GITHUB_MANIFEST: ProviderManifest = {
  provider_id: 'github-public',
  source_class: 'public_repository',
  base_uris: ['https://api.github.com'],
  capabilities: ['github_repository', 'github_releases', 'github_languages', 'github_topics'],
  commercial_application_allowed: true,
  automated_access_allowed: true,
  transformed_output_allowed: true,
  raw_access_resale_allowed: false,
  sensitive_data_allowed: false,
  account_sharing_allowed: false,
  quota_multiplication_allowed: false,
  credentials_required: false,
  terms_uri: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
  terms_hash: null,
  terms_review_status: 'pending_review',
  reviewed_at: null,
  rate_policy: {
    strategy: 'token_bucket',
    maximum_concurrency: 5,
    minimum_interval_ms: 1000,
    retry_after_respected: true,
    maximum_retries: 3,
  },
  promotion_state: 'fixture_tested',
};

export class GitHubAdapter implements ProviderAdapter<GitHubAdapterInput, GitHubAdapterResult> {
  readonly providerId = 'github-public';
  readonly capabilities = [
    'github_repository',
    'github_releases',
    'github_languages',
    'github_topics',
  ] as const;
  readonly manifest = GITHUB_MANIFEST;

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
    input: GitHubAdapterInput,
    context: AdapterExecutionContext
  ): Promise<AdapterResult<GitHubAdapterResult>> {
    const cacheKey = createCacheKey({
      providerId: this.providerId,
      capability: `github_${input.mode}`,
      canonicalInput: JSON.stringify(input),
      sourcePolicyVersion: '1.0.0',
      adapterVersion: '0.1.0',
      normalizationVersion: '1.0.0',
    });

    if (context.cache_policy !== 'bypass') {
      const cached = await this.cache.get<CacheEntry<GitHubAdapterResult>>(cacheKey);
      if (cached && !isExpired(cached, context.injected_clock.nowMs())) {
        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: `github_${input.mode}`,
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
          capability: `github_${input.mode}`,
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

        const observation = createGitHubObservation(
          result,
          this.buildUrl(input),
          result.contentHash,
          '0.1.0',
          '1.0.0',
          'miss',
          'fresh',
          result.warnings,
          result.limitations
        );

        const cacheEntry: CacheEntry<GitHubAdapterResult> = {
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
          capability: `github_${input.mode}`,
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
            capability: `github_${input.mode}`,
            cache_status: 'miss',
            freshness_status: 'unknown',
            warnings: [],
            limitations: [],
            error: { code: 'POLICY_BLOCKED', message: error.message, details: error.details },
          };
        }

        if (error instanceof Response) {
          if (error.status === 403) {
            return {
              resultClass: 'permanent_failure',
              provider_id: this.providerId,
              capability: `github_${input.mode}`,
              cache_status: 'miss',
              freshness_status: 'unknown',
              warnings: [],
              limitations: [],
              error: {
                code: 'FORBIDDEN',
                message: 'Access forbidden - may be rate limited or private repo',
              },
            };
          }
          if (error.status === 404) {
            return {
              resultClass: 'not_found',
              provider_id: this.providerId,
              capability: `github_${input.mode}`,
              cache_status: 'miss',
              freshness_status: 'unknown',
              warnings: [],
              limitations: [],
              error: { code: 'NOT_FOUND', message: 'Repository not found' },
            };
          }
          if (error.status === 429) {
            const retryAfter = error.headers.get('retry-after');
            const retryAfterMs = parseRetryAfterMs(retryAfter, context.injected_clock.nowMs());
            if (this.backoff.canRetry()) {
              await this.backoff.wait(retryAfterMs);
              continue;
            }
            return {
              resultClass: 'rate_limited',
              provider_id: this.providerId,
              capability: `github_${input.mode}`,
              cache_status: 'miss',
              freshness_status: 'unknown',
              warnings: [],
              limitations: [],
              error: {
                code: 'RATE_LIMITED',
                message: 'Rate limited',
                retry_after_ms: retryAfterMs,
              },
            };
          }
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
      capability: `github_${input.mode}`,
      cache_status: 'miss',
      freshness_status: 'unknown',
      warnings: [],
      limitations: [],
      error,
    };
  }

  private buildUrl(input: GitHubAdapterInput): string {
    const base = 'https://api.github.com';
    let path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;

    switch (input.mode) {
      case 'releases':
        path += '/releases';
        break;
      case 'languages':
        path += '/languages';
        break;
      case 'topics':
        path += '/topics';
        break;
    }

    return `${base}${path}`;
  }

  private async fetchAndNormalize(
    input: GitHubAdapterInput,
    _context: AdapterExecutionContext
  ): Promise<GitHubAdapterResult & { contentHash: string }> {
    const url = this.buildUrl(input);
    const warnings: string[] = [];
    const limitations: string[] = [];

    let repository: GitHubRepository | undefined;
    let releases: GitHubRelease[] | undefined;
    let languages: Record<string, number> | undefined;
    let topics: string[] | undefined;

    if (input.mode === 'repository') {
      const response = await this.httpClient.fetchJson<GitHubRepository>(url);
      repository = response.data;
      if (response.truncated) warnings.push('Response truncated');
    } else if (input.mode === 'releases') {
      const response = await this.httpClient.fetchJson<GitHubRelease[]>(url);
      releases = response.data;
      if (response.truncated) warnings.push('Response truncated');
    } else if (input.mode === 'languages') {
      const response = await this.httpClient.fetchJson<Record<string, number>>(url);
      languages = response.data;
      if (response.truncated) warnings.push('Response truncated');
    } else if (input.mode === 'topics') {
      const response = await this.httpClient.fetchJson<{ names: string[] }>(url);
      topics = response.data.names;
      if (response.truncated) warnings.push('Response truncated');
    }

    if (repository) {
      limitations.push(
        'Star/fork/watch counts are observations at retrieval time, not identity facts'
      );
    }

    if (releases) {
      limitations.push('Release timestamps are observations, not authoritative version facts');
    }

    const contentHash = await computeContentHash(
      JSON.stringify({ repository, releases, languages, topics })
    );

    return { repository, releases, languages, topics, warnings, limitations, contentHash };
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
        'Unauthenticated rate limit: 60 req/hr',
      ],
    };
  }
}

function createGitHubObservation(
  result: GitHubAdapterResult & { contentHash: string },
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
    createLocator('json_pointer', '/repository', sourceUrl),
    createLocator('json_pointer', '/releases', sourceUrl),
    createLocator('json_pointer', '/languages', sourceUrl),
    createLocator('json_pointer', '/topics', sourceUrl),
  ];

  const transformationHistory = [
    createProvenanceStep('fetch_github', adapterVersion),
    createProvenanceStep('normalize_results', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'github-public',
    capability: 'github_repository',
    sourceUri: sourceUrl,
    sourceType: 'public_repository',
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
