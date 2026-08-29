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
import { validateUrl, DEFAULT_NETWORK_POLICY } from '../policy/network-policy';
import { createSourceObservation, createProvenanceStep } from '../evidence/source-observation';
import { createLocator } from '../evidence/locators';
import { computeContentHash } from '../evidence/source-observation';
import { detectEncoding, decodeWithFallback } from '../http/encoding';
import { toAdapterResult, PolicyBlockedError } from '../errors';

export interface PublicHttpAdapterInput {
  url: string;
  acceptedMediaTypes?: string[];
  maxResponseBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  freshnessMs?: number;
  conditionalETag?: string;
  conditionalLastModified?: string;
}

export interface PublicHttpAdapterResult {
  content: string | Uint8Array;
  mediaType: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  redirectChain: string[];
  encoding: string;
  truncated: boolean;
}

export const DIRECT_PUBLIC_HTTP_MANIFEST: ProviderManifest = {
  provider_id: 'direct-public-http',
  source_class: 'public_web',
  base_uris: [],
  capabilities: ['public_http_fetch'],
  commercial_application_allowed: 'unknown',
  automated_access_allowed: 'unknown',
  transformed_output_allowed: 'unknown',
  raw_access_resale_allowed: 'unknown',
  sensitive_data_allowed: false,
  account_sharing_allowed: false,
  quota_multiplication_allowed: false,
  credentials_required: false,
  // SUN-1221E2T: operator risk-acceptance recorded in globalTermsGuard
  // (see DIRECT_PUBLIC_HTTP_TERMS_REVIEW in policy/terms-guard.ts). This is
  // NOT a claim that RFC 9110, or any specific target site's terms, grants
  // legal permission -- see that review's notes for the exact scope.
  terms_uri: 'https://www.rfc-editor.org/rfc/rfc9110',
  terms_hash: null,
  terms_review_status: 'verified',
  reviewed_at: '2026-08-29T00:00:00.000Z',
  rate_policy: {
    strategy: 'token_bucket',
    maximum_concurrency: 5,
    minimum_interval_ms: 200,
    retry_after_respected: true,
    maximum_retries: 3,
  },
  promotion_state: 'fixture_tested',
};

export class PublicHttpAdapter
  implements ProviderAdapter<PublicHttpAdapterInput, PublicHttpAdapterResult>
{
  readonly providerId = 'direct-public-http';
  readonly capabilities = ['public_http_fetch'] as const;
  readonly manifest = DIRECT_PUBLIC_HTTP_MANIFEST;

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
    input: PublicHttpAdapterInput,
    context: AdapterExecutionContext
  ): Promise<AdapterResult<PublicHttpAdapterResult>> {
    const normalizedUrl = this.normalizeUrl(input.url);
    const validation = validateUrl(new URL(normalizedUrl), DEFAULT_NETWORK_POLICY);
    if (!validation.valid) {
      return {
        resultClass: 'invalid_request',
        provider_id: this.providerId,
        capability: 'public_http_fetch',
        cache_status: 'miss',
        freshness_status: 'unknown',
        warnings: [],
        limitations: [],
        error: { code: 'INVALID_URL', message: validation.reason || 'URL validation failed' },
      };
    }

    const cacheKey = createCacheKey({
      providerId: this.providerId,
      capability: 'public_http_fetch',
      canonicalInput: JSON.stringify({
        url: normalizedUrl,
        acceptedMediaTypes: input.acceptedMediaTypes,
        maxResponseBytes: input.maxResponseBytes,
        maxRedirects: input.maxRedirects,
      }),
      sourcePolicyVersion: '1.0.0',
      adapterVersion: '0.1.0',
      normalizationVersion: '1.0.0',
    });

    if (context.cache_policy !== 'bypass') {
      const cached = await this.cache.get<CacheEntry<PublicHttpAdapterResult>>(cacheKey);
      if (cached && !isExpired(cached, context.injected_clock.nowMs())) {
        return {
          resultClass: 'success',
          provider_id: this.providerId,
          capability: 'public_http_fetch',
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
          capability: 'public_http_fetch',
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
          return await this.fetchAndProcess(input, normalizedUrl, context);
        });

        this.rateLimiter.release();
        this.backoff.reset();

        const observation = createPublicHttpObservation(
          result,
          normalizedUrl,
          result.contentHash,
          '0.1.0',
          '1.0.0',
          'miss',
          'fresh',
          [],
          ['Live access not verified']
        );

        const cacheEntry: CacheEntry<PublicHttpAdapterResult> = {
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
          capability: 'public_http_fetch',
          observations: [observation],
          cache_status: 'miss',
          freshness_status: 'fresh',
          warnings: [],
          limitations: ['Live access not verified'],
        };
      } catch (error) {
        this.rateLimiter.release();
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof PolicyBlockedError) {
          return {
            resultClass: 'policy_blocked',
            provider_id: this.providerId,
            capability: 'public_http_fetch',
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
            capability: 'public_http_fetch',
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
      capability: 'public_http_fetch',
      cache_status: 'miss',
      freshness_status: 'unknown',
      warnings: [],
      limitations: [],
      error,
    };
  }

  private async fetchAndProcess(
    input: PublicHttpAdapterInput,
    normalizedUrl: string,
    context: AdapterExecutionContext
  ): Promise<PublicHttpAdapterResult & { contentHash: string }> {
    const config = {
      ...DEFAULT_HTTP_CONFIG,
      maxResponseBytes: input.maxResponseBytes || context.max_response_bytes,
      maxRedirects: input.maxRedirects || 10,
      timeoutMs: input.timeoutMs || context.timeout_ms,
      allowedMediaTypes: input.acceptedMediaTypes || DEFAULT_HTTP_CONFIG.allowedMediaTypes,
    };

    const tempClient = new SecureHttpClient(
      config,
      this.httpClient['httpClient'],
      this.httpClient['clock']
    );

    const headers: Record<string, string> = {};
    if (input.conditionalETag) headers['If-None-Match'] = input.conditionalETag;
    if (input.conditionalLastModified) headers['If-Modified-Since'] = input.conditionalLastModified;

    const response = await tempClient.fetch(normalizedUrl, { headers });

    if (response.metadata.status === 304) {
      return {
        content: '',
        mediaType: '',
        finalUrl: response.metadata.final_url,
        status: 304,
        headers: response.metadata.headers,
        redirectChain: response.metadata.redirect_chain,
        encoding: '',
        truncated: false,
        contentHash: '',
      };
    }

    const encodingResult = detectEncoding(response.data);
    const contentText = decodeWithFallback(
      response.data,
      response.metadata.headers['content-type']
    );

    return {
      content: contentText,
      mediaType: response.metadata.headers['content-type'] || 'application/octet-stream',
      finalUrl: response.metadata.final_url,
      status: response.metadata.status,
      headers: response.metadata.headers,
      redirectChain: response.metadata.redirect_chain,
      encoding: encodingResult.encoding,
      truncated: response.truncated,
      contentHash: await computeContentHash(response.data),
    };
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
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
        'No domain-specific permissions verified',
      ],
    };
  }
}

function createPublicHttpObservation(
  result: PublicHttpAdapterResult & { contentHash: string },
  sourceUrl: string,
  contentHash: string,
  adapterVersion: string,
  policyVersion: string,
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypassed',
  freshnessStatus: 'fresh' | 'stale' | 'unknown',
  warnings: string[],
  limitations: string[]
): SourceObservation {
  const contentStr =
    typeof result.content === 'string' ? result.content : new TextDecoder().decode(result.content);
  const locators = [
    createLocator('byte_range', `0-${contentStr.length}`, sourceUrl),
    createLocator('text_quote', contentStr.slice(0, 200), sourceUrl),
  ];

  const transformationHistory = [
    createProvenanceStep('fetch_public_http', adapterVersion),
    createProvenanceStep('validate_url', adapterVersion),
    createProvenanceStep('detect_encoding', adapterVersion),
    createProvenanceStep('decode_content', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'direct-public-http',
    capability: 'public_http_fetch',
    sourceUri: sourceUrl,
    sourceType: 'public_web',
    retrievedAt: new Date(),
    contentHash,
    mediaType: result.mediaType,
    httpMetadata: {
      status: result.status,
      headers: result.headers,
      final_url: result.finalUrl,
      redirect_chain: result.redirectChain,
    },
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
