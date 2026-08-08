import type { InjectedClock } from '../context';

export interface RateLimitConfig {
  strategy: 'token_bucket' | 'fixed_window' | 'sliding_window';
  maximumConcurrency: number;
  minimumIntervalMs: number;
  maximumTokens: number;
  refillRatePerSecond: number;
}

export interface RateLimitState {
  tokens: number;
  lastRefill: number;
  activeRequests: number;
  queuedRequests: number;
}

export class TokenBucketLimiter {
  private state: RateLimitState;
  private config: RateLimitConfig;
  private clock: InjectedClock;

  constructor(config: RateLimitConfig, clock: InjectedClock) {
    this.config = config;
    this.clock = clock;
    this.state = {
      tokens: config.maximumTokens,
      lastRefill: clock.nowMs(),
      activeRequests: 0,
      queuedRequests: 0,
    };
  }

  private refill(): void {
    const now = this.clock.nowMs();
    const elapsed = (now - this.state.lastRefill) / 1000;
    const newTokens = Math.min(
      this.config.maximumTokens,
      this.state.tokens + elapsed * this.config.refillRatePerSecond
    );
    this.state.tokens = newTokens;
    this.state.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.state.activeRequests >= this.config.maximumConcurrency) {
      this.state.queuedRequests++;
      await new Promise<void>((resolve) => {
        const check = () => {
          this.refill();
          if (
            this.state.activeRequests < this.config.maximumConcurrency &&
            this.state.tokens >= 1
          ) {
            this.state.queuedRequests--;
            this.state.activeRequests++;
            this.state.tokens--;
            resolve();
          } else {
            this.clock.setTimeout(check, this.config.minimumIntervalMs);
          }
        };
        check();
      });
      return;
    }

    if (this.state.tokens < 1) {
      this.state.queuedRequests++;
      await new Promise<void>((resolve) => {
        const check = () => {
          this.refill();
          if (this.state.tokens >= 1) {
            this.state.queuedRequests--;
            this.state.activeRequests++;
            this.state.tokens--;
            resolve();
          } else {
            this.clock.setTimeout(check, this.config.minimumIntervalMs);
          }
        };
        check();
      });
      return;
    }

    this.state.activeRequests++;
    this.state.tokens--;
  }

  release(): void {
    this.state.activeRequests = Math.max(0, this.state.activeRequests - 1);
  }

  getState(): RateLimitState {
    this.refill();
    return { ...this.state };
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.state.activeRequests >= this.config.maximumConcurrency) {
      return false;
    }
    if (this.state.tokens < 1) {
      return false;
    }
    this.state.activeRequests++;
    this.state.tokens--;
    return true;
  }

  getAvailableTokens(): number {
    this.refill();
    return this.state.tokens;
  }
}

export class FixedWindowLimiter implements RateLimiter {
  private windows = new Map<number, number>();
  private config: RateLimitConfig;
  private clock: InjectedClock;

  constructor(config: RateLimitConfig, clock: InjectedClock) {
    this.config = config;
    this.clock = clock;
  }

  private getCurrentWindow(): number {
    return Math.floor(this.clock.nowMs() / 1000);
  }

  async acquire(): Promise<void> {
    const window = this.getCurrentWindow();
    const count = this.windows.get(window) || 0;

    if (count >= this.config.refillRatePerSecond) {
      await new Promise<void>((resolve) => {
        const check = () => {
          const newWindow = this.getCurrentWindow();
          if (newWindow !== window) {
            resolve();
          } else {
            this.clock.setTimeout(check, this.config.minimumIntervalMs);
          }
        };
        check();
      });
      return this.acquire();
    }

    this.windows.set(window, count + 1);
    this.cleanup();
  }

  release(): void {
    // Fixed window doesn't track active requests, no-op
  }

  tryAcquire(): boolean {
    const window = this.getCurrentWindow();
    const count = this.windows.get(window) || 0;

    if (count >= this.config.refillRatePerSecond) {
      return false;
    }

    this.windows.set(window, count + 1);
    this.cleanup();
    return true;
  }

  getState(): RateLimitState {
    const window = this.getCurrentWindow();
    return {
      tokens: this.config.refillRatePerSecond - (this.windows.get(window) || 0),
      lastRefill: this.clock.nowMs(),
      activeRequests: 0,
      queuedRequests: 0,
    };
  }

  getAvailableTokens(): number {
    const window = this.getCurrentWindow();
    return Math.max(0, this.config.refillRatePerSecond - (this.windows.get(window) || 0));
  }

  private cleanup(): void {
    const currentWindow = this.getCurrentWindow();
    for (const window of this.windows.keys()) {
      if (window < currentWindow - 1) {
        this.windows.delete(window);
      }
    }
  }
}

export interface RateLimiter {
  acquire(): Promise<void>;
  release(): void;
  tryAcquire(): boolean;
  getState(): RateLimitState;
  getAvailableTokens(): number;
}

export function createRateLimiter(config: RateLimitConfig, clock: InjectedClock): RateLimiter {
  switch (config.strategy) {
    case 'token_bucket':
      return new TokenBucketLimiter(config, clock);
    case 'fixed_window':
      return new FixedWindowLimiter(config, clock);
    case 'sliding_window':
      return new TokenBucketLimiter(config, clock);
    default:
      return new TokenBucketLimiter(config, clock);
  }
}

export function createManifestRateLimiter(
  manifest: {
    rate_policy: {
      strategy: string;
      maximum_concurrency: number;
      minimum_interval_ms: number;
      maximum_retries: number;
    };
  },
  clock: InjectedClock
): RateLimiter {
  const config: RateLimitConfig = {
    strategy: manifest.rate_policy.strategy as RateLimitConfig['strategy'],
    maximumConcurrency: manifest.rate_policy.maximum_concurrency,
    minimumIntervalMs: manifest.rate_policy.minimum_interval_ms,
    maximumTokens: manifest.rate_policy.maximum_concurrency * 2,
    refillRatePerSecond: 1000 / Math.max(1, manifest.rate_policy.minimum_interval_ms),
  };
  return createRateLimiter(config, clock);
}
