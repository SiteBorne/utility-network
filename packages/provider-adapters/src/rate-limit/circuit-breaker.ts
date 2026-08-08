import type { InjectedClock } from '../context';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxRequests: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 30000,
  halfOpenMaxRequests: 3,
};

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number;
  lastStateChangeAt: number;
  halfOpenRequests: number;
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private clock: InjectedClock;
  private state: CircuitBreakerState;
  private onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(
    config: CircuitBreakerConfig,
    clock: InjectedClock,
    onStateChange?: (from: CircuitState, to: CircuitState) => void
  ) {
    this.config = config;
    this.clock = clock;
    this.onStateChange = onStateChange;
    this.state = {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      lastStateChangeAt: clock.nowMs(),
      halfOpenRequests: 0,
    };
  }

  private transition(to: CircuitState): void {
    const from = this.state.state;
    if (from !== to) {
      this.state.state = to;
      this.state.lastStateChangeAt = this.clock.nowMs();
      if (this.onStateChange) {
        this.onStateChange(from, to);
      }
    }
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state.state === 'open') {
      if (this.clock.nowMs() - this.state.lastStateChangeAt >= this.config.timeoutMs) {
        this.transition('half_open');
        this.state.halfOpenRequests = 0;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    if (this.state.state === 'half_open') {
      if (this.state.halfOpenRequests >= this.config.halfOpenMaxRequests) {
        throw new Error('Circuit breaker half-open request limit exceeded');
      }
      this.state.halfOpenRequests++;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state.failures = 0;

    if (this.state.state === 'half_open') {
      this.state.successes++;
      if (this.state.successes >= this.config.successThreshold) {
        this.transition('closed');
        this.state.successes = 0;
      }
    }
  }

  private onFailure(): void {
    this.state.failures++;
    this.state.lastFailureAt = this.clock.nowMs();

    if (this.state.state === 'half_open') {
      this.transition('open');
      this.state.successes = 0;
    } else if (
      this.state.state === 'closed' &&
      this.state.failures >= this.config.failureThreshold
    ) {
      this.transition('open');
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  isAvailable(): boolean {
    if (this.state.state === 'closed') return true;
    if (this.state.state === 'open') {
      return this.clock.nowMs() - this.state.lastStateChangeAt >= this.config.timeoutMs;
    }
    return this.state.halfOpenRequests < this.config.halfOpenMaxRequests;
  }

  forceOpen(): void {
    this.transition('open');
  }

  forceClosed(): void {
    this.transition('closed');
    this.state.failures = 0;
    this.state.successes = 0;
  }

  reset(): void {
    this.state = {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      lastStateChangeAt: this.clock.nowMs(),
      halfOpenRequests: 0,
    };
  }
}

export function createCircuitBreakerFromManifest(
  manifest: { rate_policy: { maximum_retries: number } },
  clock: InjectedClock
): CircuitBreaker {
  const config: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeoutMs: 30000,
    halfOpenMaxRequests: 3,
  };
  return new CircuitBreaker(config, clock);
}
