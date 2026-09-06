/**
 * SUN-1222C2-Q1-R2 sections 12-18 — the aggregate, cross-isolate rate
 * coordination boundary.
 *
 * `provider-adapters` intentionally has zero dependency on any concrete
 * storage layer (D1, Durable Objects, ...) -- see this package's own
 * `package.json` (zero `@siteborne/*` dependencies) and how
 * `ArtifactStore`/`AuditEventSink`/`InjectedHttpClient`/`InjectedClock`
 * are already injected as generic interfaces rather than concrete
 * bindings. This file follows the exact same shape: it defines the
 * interface a caller (`SecSubmissionsAdapter`) depends on, never a real
 * implementation. The real, D1-backed implementation lives in
 * `apps/edge-api/src/control-plane/rate-limit/sec-d1-rate-coordinator.ts`
 * (paired with `apps/edge-api/src/control-plane/repositories/d1/sec-rate-
 * window.ts`), where a `D1Database` type is actually available -- adding
 * a `@cloudflare/workers-types`/D1 dependency to this package would break
 * its deliberate storage-agnostic boundary for every other adapter that
 * doesn't need it.
 *
 * WHY THIS EXISTS: the real production executor
 * (`company-evidence-graph-v2-production-executor.ts`) constructs a brand
 * new `SecSubmissionsAdapter` -- and therefore a brand new, fully-tokened
 * `TokenBucketLimiter` -- on every single invocation (a new adapter per
 * job, not a module-scoped singleton). Two concurrently-executing paid
 * jobs are two completely independent limiter instances with no shared
 * state, so the existing per-instance limiter provides zero real
 * aggregate guarantee against SEC's published fair-access ceiling
 * (`sec.gov/os/accessing-edgar-data`: "no more than 10 requests per
 * second, regardless of the number of machines used"). Proven
 * concretely, not just asserted, in
 * `sec-edgar-aggregate-rate-red.test.ts`.
 */

export interface RateCoordinatorDecision {
  allowed: boolean;
  /** Present only when `allowed` is false and a caller-usable wait time
   * is known (e.g. "try again once this trailing window has room"). Never
   * fabricated -- absent rather than guessed when unknown. */
  retryAfterMs?: number;
  /** `rate_limited`: the aggregate ceiling is genuinely at capacity right
   * now. `coordinator_unavailable`: the coordination mechanism itself
   * could not be reached (e.g. a D1 error) -- see `NullRateCoordinator`'s
   * doc comment and every real implementation's own contract: this case
   * MUST still resolve `allowed: false` (fail closed), never `true`. */
  reason?: 'rate_limited' | 'coordinator_unavailable';
}

export interface RateCoordinator {
  /**
   * Attempts to admit exactly one request for `providerId` at `nowMs`.
   * Implementations must fail CLOSED if the underlying coordination
   * mechanism is itself unavailable -- returning `allowed: true` when the
   * mechanism couldn't actually check anything would silently reopen the
   * exact unbounded-concurrency hole this interface exists to close
   * (SUN-1222C2-Q1-R2 section 16: `COORDINATOR_FAILURE_ALLOWS_UNLIMITED_
   * SEC_REQUESTS=NO`).
   */
  tryAcquire(providerId: string, nowMs: number): Promise<RateCoordinatorDecision>;
}

/**
 * The default coordinator: always admits, fail-OPEN. This is correct and
 * safe for every current caller EXCEPT the one real SEC production call
 * site, because every other `RateCoordinator`-typed constructor parameter
 * defaults to this so existing tests and non-SEC adapters need no changes
 * (`provider-adapters` has no other capability with a published aggregate
 * fair-access ceiling to enforce today). Deliberately named so a reader
 * auditing a call site can never mistake this for a real safety
 * mechanism -- "Null" reads as "no-op", not "default-safe".
 */
export class NullRateCoordinator implements RateCoordinator {
  async tryAcquire(): Promise<RateCoordinatorDecision> {
    return { allowed: true };
  }
}
