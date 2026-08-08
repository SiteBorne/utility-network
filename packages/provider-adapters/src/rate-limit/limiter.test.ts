import { describe, it, expect } from 'vitest';
import { InMemoryCache, createCacheKey } from '../index';
import { createRateLimiter } from './limiter';
import { createBackoffFromManifest } from './backoff';
import { createCircuitBreakerFromManifest } from './circuit-breaker';

const testClock = {
  nowMs: () => Date.now(),
  now: () => new Date(),
  setTimeout: (cb: () => void, delay: number) => setTimeout(cb, delay),
  clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
  advance: () => {},
  getCurrentTime: () => Date.now(),
  setTime: () => {},
};

describe('Cache', () => {
  it('should store and retrieve entries', async () => {
    const cache = new InMemoryCache(testClock);
    const key = createCacheKey({
      providerId: 'test',
      capability: 'test',
      canonicalInput: 'input',
      sourcePolicyVersion: '1.0',
      adapterVersion: '1.0',
      normalizationVersion: '1.0',
    });

    await cache.set(key, {
      key,
      resultClass: 'success',
      expiresAt: Date.now() + 60000,
    });

    const entry = await cache.get(key);
    expect(entry).not.toBeNull();
    expect(entry?.resultClass).toBe('success');
  });

  it('should return null for expired entries', async () => {
    const cache = new InMemoryCache(testClock);
    const key = createCacheKey({
      providerId: 'test',
      capability: 'test',
      canonicalInput: 'input',
      sourcePolicyVersion: '1.0',
      adapterVersion: '1.0',
      normalizationVersion: '1.0',
    });

    await cache.set(key, {
      key,
      resultClass: 'success',
      expiresAt: Date.now() - 60000, // Expired 60 seconds ago
    });

    const entry = await cache.get(key);
    expect(entry).toBeNull();
  });

  it('should track hits and misses', async () => {
    const cache = new InMemoryCache(testClock);
    const key = createCacheKey({
      providerId: 'test',
      capability: 'test',
      canonicalInput: 'input',
      sourcePolicyVersion: '1.0',
      adapterVersion: '1.0',
      normalizationVersion: '1.0',
    });

    await cache.get(key); // miss
    await cache.set(key, {
      key,
      resultClass: 'success',
      expiresAt: Date.now() + 60000,
    });
    await cache.get(key); // hit

    const stats = await cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
  });
});

describe('Rate Limiter', () => {
  it('should allow requests within limit', async () => {
    const limiter = createRateLimiter(
      {
        strategy: 'token_bucket',
        maximumConcurrency: 5,
        minimumIntervalMs: 10,
        maximumTokens: 10,
        refillRatePerSecond: 100,
      },
      testClock
    );

    const result = limiter.tryAcquire();
    expect(result).toBe(true);
  });

  it('should respect concurrency limit', async () => {
    const limiter = createRateLimiter(
      {
        strategy: 'token_bucket',
        maximumConcurrency: 1,
        minimumIntervalMs: 10,
        maximumTokens: 2,
        refillRatePerSecond: 100,
      },
      testClock
    );

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });
});

describe('Backoff', () => {
  it('should calculate exponential backoff', async () => {
    const backoff = createBackoffFromManifest(
      {
        rate_policy: { maximum_retries: 3, minimum_interval_ms: 1000 },
      },
      testClock
    );

    expect(backoff.getAttempt()).toBe(0);
    expect(backoff.canRetry()).toBe(true);
  });

  it('should respect max retries', async () => {
    // Use a fake clock whose setTimeout resolves immediately (synchronously
    // fires on the next tick) so this test does not perform real sleeping.
    const immediateClock = {
      ...testClock,
      setTimeout: (cb: () => void) => {
        queueMicrotask(cb);
        return null;
      },
      clearTimeout: () => {},
    };
    const backoff = createBackoffFromManifest(
      {
        rate_policy: { maximum_retries: 2, minimum_interval_ms: 1000 },
      },
      immediateClock
    );

    backoff.reset();
    await backoff.wait();
    await backoff.wait();
    expect(backoff.canRetry()).toBe(false);
  });
});

describe('Circuit Breaker', () => {
  it('should start in closed state', async () => {
    const cb = createCircuitBreakerFromManifest(
      {
        rate_policy: { maximum_retries: 3 },
      },
      testClock
    );

    expect(cb.getState().state).toBe('closed');
    expect(cb.isAvailable()).toBe(true);
  });

  it('should open after failures', async () => {
    const cb = createCircuitBreakerFromManifest(
      {
        rate_policy: { maximum_retries: 3 },
      },
      testClock
    );

    // Force open
    cb.forceOpen();
    expect(cb.getState().state).toBe('open');
    expect(cb.isAvailable()).toBe(false);
  });

  it('should transition to half-open after timeout', async () => {
    const clock = {
      ...testClock,
      currentTime: Date.now(),
      nowMs() {
        return this.currentTime;
      },
      advance(ms: number) {
        this.currentTime += ms;
      },
    };

    const cb = createCircuitBreakerFromManifest(
      {
        rate_policy: { maximum_retries: 3 },
      },
      clock
    );

    cb.forceOpen();
    clock.advance(35000); // Past the 30s timeout
    expect(cb.isAvailable()).toBe(true);
  });
});
