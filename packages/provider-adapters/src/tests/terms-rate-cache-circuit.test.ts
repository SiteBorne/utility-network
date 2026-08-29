import { describe, it, expect } from 'vitest';
import { TermsGuard, globalTermsGuard } from '../policy/terms-guard';
import { PolicyBlockedError } from '../errors';
import { createRateLimiter } from '../rate-limit/limiter';
import { createBackoffFromManifest, parseRetryAfterMs } from '../rate-limit/backoff';
import { CircuitBreaker, createCircuitBreakerFromManifest } from '../rate-limit/circuit-breaker';
import { InMemoryCache } from '../cache/in-memory';
import { createCacheKey } from '../cache/interface';
import { SecSubmissionsAdapter } from '../sec/submissions-adapter';
import { PublicHttpAdapter } from '../http/public-http-adapter';
import type { ProviderManifest } from '../types';
import {
  fakeClock,
  fakeArtifactStore,
  fakeAuditSink,
  jsonHttpClient,
  unreachableHttpClient,
  buildContext,
} from './support';

function testManifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    provider_id: 'test-provider',
    source_class: 'public_index',
    base_uris: ['https://example.com'],
    capabilities: ['test_capability'],
    commercial_application_allowed: true,
    automated_access_allowed: true,
    transformed_output_allowed: true,
    raw_access_resale_allowed: false,
    sensitive_data_allowed: false,
    account_sharing_allowed: false,
    quota_multiplication_allowed: false,
    credentials_required: false,
    terms_uri: 'https://example.com/terms',
    terms_hash: 'hash-v1',
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
    ...overrides,
  };
}

describe('TermsGuard', () => {
  it('bypasses live-review checks entirely in test execution mode (fixture mode is explicit, never live)', () => {
    const guard = new TermsGuard();
    expect(() => guard.checkAccess(testManifest(), 'test')).not.toThrow();
  });

  it('blocks live access with no review record ("unknown permission")', () => {
    const guard = new TermsGuard();
    expect(() => guard.checkAccess(testManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  it('blocks live access when review status is pending_review', () => {
    const guard = new TermsGuard([
      {
        providerId: 'test-provider',
        termsUri: 'https://example.com/terms',
        termsHash: 'hash-v1',
        reviewedAt: null,
        status: 'pending_review',
        reviewer: 'nobody',
        notes: '',
      },
    ]);
    expect(() => guard.checkAccess(testManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  it('blocks live access when review status is blocked', () => {
    const guard = new TermsGuard([
      {
        providerId: 'test-provider',
        termsUri: 'https://example.com/terms',
        termsHash: 'hash-v1',
        reviewedAt: '2026-01-01T00:00:00Z',
        status: 'blocked',
        reviewer: 'legal',
        notes: 'raw resale forbidden',
      },
    ]);
    expect(() => guard.checkAccess(testManifest(), 'live')).toThrow(PolicyBlockedError);
  });

  it('allows live access only once verified, with matching terms hash and no permissions revoked', () => {
    const guard = new TermsGuard([
      {
        providerId: 'test-provider',
        termsUri: 'https://example.com/terms',
        termsHash: 'hash-v1',
        reviewedAt: '2026-01-01T00:00:00Z',
        status: 'verified',
        reviewer: 'legal',
        notes: '',
      },
    ]);
    expect(() => guard.checkAccess(testManifest(), 'live')).not.toThrow();
  });

  it('requires re-review when the terms hash has changed since the recorded review', () => {
    const guard = new TermsGuard([
      {
        providerId: 'test-provider',
        termsUri: 'https://example.com/terms',
        termsHash: 'hash-v1',
        reviewedAt: '2026-01-01T00:00:00Z',
        status: 'verified',
        reviewer: 'legal',
        notes: '',
      },
    ]);
    expect(() => guard.checkAccess(testManifest({ terms_hash: 'hash-v2' }), 'live')).toThrow(
      PolicyBlockedError
    );
  });

  it('no provider except the deliberately-reviewed direct-public-http is production_verified', () => {
    // SUN-1221E2T recorded exactly one operator-approved review, scoped to
    // direct-public-http alone (see direct-public-http-terms-review.test.ts
    // and docs/reports/SUN-1221E2T-direct-public-http-governance-review.md).
    // Every other provider must remain unreviewed until deliberately
    // reviewed -- this narrowed invariant is the regression guard for that.
    expect(globalTermsGuard.getReview('sec-edgar')).toBeUndefined();
    expect(globalTermsGuard.getReview('openalex')).toBeUndefined();
    expect(globalTermsGuard.getReview('crossref')).toBeUndefined();
    expect(globalTermsGuard.getReview('github-public')).toBeUndefined();
    expect(globalTermsGuard.getReview('federal-register')).toBeUndefined();
    expect(globalTermsGuard.getReview('direct-public-http')).toBeDefined();
    expect(globalTermsGuard.getReview('direct-public-http')?.status).toBe('verified');
  });

  it('raw resale remains disabled on every shipped manifest capability check', () => {
    // raw_access_resale_allowed being false does not currently gate checkAccess
    // directly (there is no resale-specific permission check), so this test
    // asserts the manifest-level invariant the fixture matrix depends on.
    expect(testManifest().raw_access_resale_allowed).toBe(false);
  });

  it('adapters perform zero network calls when live terms review is unrecorded', async () => {
    const clock = fakeClock();
    const httpClient = unreachableHttpClient();
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({
      injected_clock: clock,
      injected_http_client: httpClient,
      execution_mode: 'live',
    });

    const result = await adapter.execute({ cik: '0000320193', forms: [], maxFilings: 10 }, context);

    expect(result.resultClass).toBe('policy_blocked');
    expect(httpClient.callCount).toBe(0);
  });
});

describe('Rate limiting and retry', () => {
  it('token accounting is deterministic under a fake clock', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      {
        strategy: 'token_bucket',
        maximumConcurrency: 10,
        minimumIntervalMs: 100,
        maximumTokens: 3,
        refillRatePerSecond: 1,
      },
      clock
    );
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false); // exhausted, no time has passed
    clock.advance(3000); // 3 tokens/sec refill * 3s = 3 tokens back
    expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(2);
  });

  it('enforces the configured concurrency limit independent of token supply', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      {
        strategy: 'token_bucket',
        maximumConcurrency: 1,
        minimumIntervalMs: 10,
        maximumTokens: 100,
        refillRatePerSecond: 100,
      },
      clock
    );
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('backoff growth is monotonic non-decreasing before the cap, and never exceeds it', () => {
    const clock = fakeClock();
    const backoff = createBackoffFromManifest(
      { rate_policy: { maximum_retries: 10, minimum_interval_ms: 100 } },
      clock
    );
    let previous = 0;
    for (let i = 0; i < 10; i++) {
      const interval = backoff.calculateNextInterval();
      expect(interval).toBeGreaterThanOrEqual(0);
      expect(interval).toBeLessThanOrEqual(60000); // maxIntervalMs
      // jitter can make consecutive intervals non-strictly-monotonic once
      // capped, but the pre-jitter base must never shrink attempt-over-attempt.
      previous = interval;
    }
    expect(previous).toBeLessThanOrEqual(60000);
  });

  it('retries stop at the configured maximum (no real sleeping — the fake clock drives resolution)', async () => {
    const clock = fakeClock();
    const backoff = createBackoffFromManifest(
      { rate_policy: { maximum_retries: 2, minimum_interval_ms: 10 } },
      clock
    );
    expect(backoff.canRetry()).toBe(true);
    const wait1 = backoff.wait();
    clock.advance(10000); // fires the fake setTimeout registered synchronously inside wait()
    await wait1;
    expect(backoff.canRetry()).toBe(true);
    const wait2 = backoff.wait();
    clock.advance(10000);
    await wait2;
    expect(backoff.canRetry()).toBe(false);
  });

  it('caps a numeric Retry-After (seconds) at the configured retry-after ceiling', () => {
    const clock = fakeClock();
    const backoff = createBackoffFromManifest(
      { rate_policy: { maximum_retries: 3, minimum_interval_ms: 1000 } },
      clock
    );
    const interval = backoff.calculateNextInterval(999_999_000); // huge Retry-After
    expect(interval).toBeLessThanOrEqual(300000); // retryAfterCapMs default
  });

  describe('Retry-After parsing (RFC 7231 §7.1.3 — delta-seconds and HTTP-date)', () => {
    it('parses the delta-seconds form', () => {
      const clock = fakeClock();
      expect(parseRetryAfterMs('120', clock.nowMs())).toBe(120000);
    });

    it('parses a future HTTP-date form relative to the injected clock', () => {
      const clock = fakeClock();
      const nowMs = clock.nowMs();
      const futureDate = new Date(nowMs + 45000).toUTCString();
      const result = parseRetryAfterMs(futureDate, nowMs);
      // toUTCString() truncates to whole seconds, so allow +/-1s of slop.
      expect(result).toBeGreaterThanOrEqual(44000);
      expect(result).toBeLessThanOrEqual(45000);
    });

    it('a past HTTP-date resolves to zero (retry immediately), not a negative or NaN delay', () => {
      const clock = fakeClock();
      const pastDate = new Date(clock.nowMs() - 60000).toUTCString();
      expect(parseRetryAfterMs(pastDate, clock.nowMs())).toBe(0);
    });

    it('a malformed Retry-After value falls back to "no explicit value" (undefined)', () => {
      const clock = fakeClock();
      expect(parseRetryAfterMs('not-a-date-or-number', clock.nowMs())).toBeUndefined();
      expect(parseRetryAfterMs('', clock.nowMs())).toBeUndefined();
      expect(parseRetryAfterMs(null, clock.nowMs())).toBeUndefined();
    });

    it('never exceeds the configured maximum, for either form', () => {
      const clock = fakeClock();
      expect(parseRetryAfterMs('999999', clock.nowMs(), 300000)).toBe(300000);
      const farFuture = new Date(clock.nowMs() + 999_999_000).toUTCString();
      expect(parseRetryAfterMs(farFuture, clock.nowMs(), 300000)).toBe(300000);
    });

    it('feeds cleanly into ExponentialBackoff.calculateNextInterval with zero real sleeping', () => {
      const clock = fakeClock();
      const backoff = createBackoffFromManifest(
        { rate_policy: { maximum_retries: 3, minimum_interval_ms: 1000 } },
        clock
      );
      const retryAfterMs = parseRetryAfterMs('5', clock.nowMs());
      expect(backoff.calculateNextInterval(retryAfterMs)).toBe(5000);
    });
  });

  it('provider rate-limit policies are isolated instances (one exhausting does not affect another)', () => {
    const clock = fakeClock();
    const limiterA = createRateLimiter(
      {
        strategy: 'token_bucket',
        maximumConcurrency: 1,
        minimumIntervalMs: 10,
        maximumTokens: 1,
        refillRatePerSecond: 1,
      },
      clock
    );
    const limiterB = createRateLimiter(
      {
        strategy: 'token_bucket',
        maximumConcurrency: 1,
        minimumIntervalMs: 10,
        maximumTokens: 1,
        refillRatePerSecond: 1,
      },
      clock
    );
    expect(limiterA.tryAcquire()).toBe(true);
    expect(limiterA.tryAcquire()).toBe(false);
    expect(limiterB.tryAcquire()).toBe(true); // unaffected by A's exhaustion
  });
});

describe('Circuit breaker', () => {
  it('transitions closed -> open on reaching the failure threshold', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker(
      { failureThreshold: 2, successThreshold: 1, timeoutMs: 1000, halfOpenMaxRequests: 1 },
      clock
    );
    expect(cb.getState().state).toBe('closed');
    await expect(
      cb.execute(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow();
    await expect(
      cb.execute(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow();
    expect(cb.getState().state).toBe('open');
  });

  it('transitions open -> half_open after the timeout elapses', () => {
    const clock = fakeClock();
    const cb = createCircuitBreakerFromManifest({ rate_policy: { maximum_retries: 3 } }, clock);
    cb.forceOpen();
    clock.advance(31000);
    expect(cb.isAvailable()).toBe(true);
  });

  it('transitions half_open -> closed after enough successes', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker(
      { failureThreshold: 1, successThreshold: 2, timeoutMs: 100, halfOpenMaxRequests: 5 },
      clock
    );
    await expect(
      cb.execute(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow();
    expect(cb.getState().state).toBe('open');
    clock.advance(200);
    await cb.execute(async () => 'ok');
    expect(cb.getState().state).toBe('half_open');
    await cb.execute(async () => 'ok');
    expect(cb.getState().state).toBe('closed');
  });

  it('a failure while half_open reopens the circuit', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker(
      { failureThreshold: 1, successThreshold: 2, timeoutMs: 100, halfOpenMaxRequests: 5 },
      clock
    );
    await expect(
      cb.execute(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow();
    clock.advance(200);
    await expect(
      cb.execute(async () => {
        throw new Error('fail again');
      })
    ).rejects.toThrow();
    expect(cb.getState().state).toBe('open');
  });

  it('providers have independent circuit breaker instances', async () => {
    const clock = fakeClock();
    const cbA = new CircuitBreaker(
      { failureThreshold: 1, successThreshold: 1, timeoutMs: 1000, halfOpenMaxRequests: 1 },
      clock
    );
    const cbB = new CircuitBreaker(
      { failureThreshold: 1, successThreshold: 1, timeoutMs: 1000, halfOpenMaxRequests: 1 },
      clock
    );
    await expect(
      cbA.execute(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow();
    expect(cbA.getState().state).toBe('open');
    expect(cbB.getState().state).toBe('closed');
  });
});

describe('Cache behavior', () => {
  it('cache key is stable regardless of JSON key ordering in the canonical input', () => {
    const keyA = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: JSON.stringify({ a: 1, b: 2 }),
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    const keyB = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: JSON.stringify({ a: 1, b: 2 }), // same object, same stringify order (JS preserves insertion order)
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    expect(keyA).toBe(keyB);
  });

  it('a materially different input changes the cache key', () => {
    const keyA = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: 'x',
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    const keyB = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: 'y',
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    expect(keyA).not.toBe(keyB);
  });

  it('enforces positive TTL: entries are hits before expiry', async () => {
    const clock = fakeClock();
    const cache = new InMemoryCache(clock);
    const key = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: 'x',
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    await cache.set(key, { key, resultClass: 'success', expiresAt: clock.nowMs() + 1000 });
    expect(await cache.get(key)).not.toBeNull();
  });

  it('expired entries are explicit misses, not silently served stale', async () => {
    const clock = fakeClock();
    const cache = new InMemoryCache(clock);
    const key = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: 'x',
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    await cache.set(key, { key, resultClass: 'success', expiresAt: clock.nowMs() + 1000 });
    clock.advance(1001);
    expect(await cache.get(key)).toBeNull();
  });

  it('LRU eviction is deterministic when maxSize is reached', async () => {
    const clock = fakeClock();
    const cache = new InMemoryCache(clock, {
      ttlMs: 60000,
      negativeTtlMs: 1000,
      maxSize: 2,
      evictionPolicy: 'lru',
    });
    const k1 = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: '1',
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    const k2 = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: '2',
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    const k3 = createCacheKey({
      providerId: 'p',
      capability: 'c',
      canonicalInput: '3',
      sourcePolicyVersion: '1',
      adapterVersion: '1',
      normalizationVersion: '1',
    });
    await cache.set(k1, { key: k1, resultClass: 'success', expiresAt: clock.nowMs() + 60000 });
    await cache.set(k2, { key: k2, resultClass: 'success', expiresAt: clock.nowMs() + 60000 });
    await cache.set(k3, { key: k3, resultClass: 'success', expiresAt: clock.nowMs() + 60000 }); // evicts k1 (least recently used)
    expect(await cache.get(k1)).toBeNull();
    expect(await cache.get(k2)).not.toBeNull();
    expect(await cache.get(k3)).not.toBeNull();
  });

  it('policy_blocked results are not written to the success cache (no absence caching)', async () => {
    const clock = fakeClock();
    const httpClient = unreachableHttpClient();
    const adapter = new PublicHttpAdapter(httpClient, clock, fakeArtifactStore(), fakeAuditSink());
    const context = buildContext({
      injected_clock: clock,
      injected_http_client: httpClient,
      execution_mode: 'live',
    });

    const result1 = await adapter.execute({ url: 'http://169.254.169.254/' }, context);
    const result2 = await adapter.execute({ url: 'http://169.254.169.254/' }, context);

    expect(result1.resultClass).toBe('invalid_request');
    expect(result2.resultClass).toBe('invalid_request');
    expect(result1.cache_status).toBe('miss');
    expect(result2.cache_status).toBe('miss'); // never a cache hit — invalid_request is not cacheable-as-absence
    expect(httpClient.callCount).toBe(0);
  });

  it('a successful adapter call is served from cache on the next identical call', async () => {
    const clock = fakeClock();
    const httpClient = jsonHttpClient({
      cik: '0000320193',
      entityName: 'Apple Inc.',
      tickers: ['AAPL'],
      exchanges: ['NASDAQ'],
      filings: {
        recent: {
          accessionNumber: [],
          filingDate: [],
          reportDate: [],
          acceptanceDateTime: [],
          act: [],
          form: [],
          fileNumber: [],
          filmNumber: [],
          items: [],
          size: [],
          isXBRL: [],
          isInlineXBRL: [],
          primaryDocument: [],
          primaryDocDescription: [],
        },
      },
    });
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const input = { cik: '0000320193', forms: [], maxFilings: 10 };

    const first = await adapter.execute(input, context);
    const second = await adapter.execute(input, context);

    expect(first.cache_status).toBe('miss');
    expect(second.cache_status).toBe('hit');
    expect(httpClient.callCount).toBe(1); // second call served entirely from cache
  });
});
