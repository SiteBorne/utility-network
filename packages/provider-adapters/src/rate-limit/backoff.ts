import type { InjectedClock } from '../context';

export interface BackoffConfig {
  initialIntervalMs: number;
  maxIntervalMs: number;
  multiplier: number;
  maxRetries: number;
  jitterFactor: number;
  retryAfterCapMs?: number;
}

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  initialIntervalMs: 1000,
  maxIntervalMs: 60000,
  multiplier: 2,
  maxRetries: 3,
  jitterFactor: 0.1,
  retryAfterCapMs: 300000,
};

export interface BackoffState {
  attempt: number;
  nextRetryAt: number;
  lastIntervalMs: number;
}

export class ExponentialBackoff {
  private config: BackoffConfig;
  private clock: InjectedClock;
  private state: BackoffState;

  constructor(config: BackoffConfig, clock: InjectedClock) {
    this.config = config;
    this.clock = clock;
    this.state = {
      attempt: 0,
      nextRetryAt: 0,
      lastIntervalMs: config.initialIntervalMs,
    };
  }

  calculateNextInterval(retryAfterMs?: number): number {
    if (retryAfterMs !== undefined && retryAfterMs >= 0) {
      const capped = this.config.retryAfterCapMs
        ? Math.min(retryAfterMs, this.config.retryAfterCapMs)
        : retryAfterMs;
      this.state.lastIntervalMs = capped;
      return capped;
    }

    const baseInterval =
      this.config.initialIntervalMs * Math.pow(this.config.multiplier, this.state.attempt);
    const cappedInterval = Math.min(baseInterval, this.config.maxIntervalMs);

    const jitter = cappedInterval * this.config.jitterFactor * (Math.random() * 2 - 1);
    const interval = Math.max(0, Math.floor(cappedInterval + jitter));

    this.state.lastIntervalMs = interval;
    return interval;
  }

  async wait(retryAfterMs?: number): Promise<void> {
    const interval = this.calculateNextInterval(retryAfterMs);
    this.state.attempt++;
    this.state.nextRetryAt = this.clock.nowMs() + interval;

    await new Promise<void>((resolve) => {
      this.clock.setTimeout(resolve, interval);
    });
  }

  canRetry(): boolean {
    return this.state.attempt < this.config.maxRetries;
  }

  getState(): BackoffState {
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      attempt: 0,
      nextRetryAt: 0,
      lastIntervalMs: this.config.initialIntervalMs,
    };
  }

  getAttempt(): number {
    return this.state.attempt;
  }

  getMaxRetries(): number {
    return this.config.maxRetries;
  }
}

/**
 * Parses an HTTP `Retry-After` header value per RFC 7231 §7.1.3, supporting
 * both the delta-seconds form ("120") and the HTTP-date form
 * ("Wed, 21 Oct 2015 07:28:00 GMT"). Uses the injected clock's current time
 * (not `Date.now()`) so behavior is deterministic under a fake clock.
 *
 * - Delta-seconds: returned directly (capped at `maxMs`).
 * - A future HTTP-date: converted to a delay relative to `nowMs` (capped).
 * - A past or present HTTP-date: returns 0 (retry immediately).
 * - Malformed input (neither form parses): returns `undefined`, signaling
 *   "no explicit Retry-After" so the caller falls back to its own bounded
 *   exponential backoff rather than growing unbounded.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs: number,
  maxMs = 300000
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.min(seconds * 1000, maxMs);
  }

  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isNaN(parsedDateMs)) {
    const deltaMs = parsedDateMs - nowMs;
    if (deltaMs <= 0) return 0;
    return Math.min(deltaMs, maxMs);
  }

  return undefined;
}

export function createBackoffFromManifest(
  manifest: { rate_policy: { maximum_retries: number; minimum_interval_ms: number } },
  clock: InjectedClock
): ExponentialBackoff {
  const config: BackoffConfig = {
    initialIntervalMs: manifest.rate_policy.minimum_interval_ms || 1000,
    maxIntervalMs: 60000,
    multiplier: 2,
    maxRetries: manifest.rate_policy.maximum_retries,
    jitterFactor: 0.1,
    retryAfterCapMs: 300000,
  };
  return new ExponentialBackoff(config, clock);
}
