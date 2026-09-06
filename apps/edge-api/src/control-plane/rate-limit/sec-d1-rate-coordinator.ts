/**
 * SUN-1222C2-Q1-R2 — the real, D1-backed `RateCoordinator`
 * (`@siteborne/provider-adapters`) for SEC EDGAR's published aggregate
 * fair-access ceiling (`sec.gov/os/accessing-edgar-data`: "no more than
 * 10 requests per second, regardless of the number of machines used").
 *
 * COORDINATION-SCOPE ANALYSIS (SUN-1222C2-Q1-R2 section 14) --
 * candidates considered, for the real production topology (a Cloudflare
 * Worker that can run multiple concurrent isolates, each of which
 * constructs its own independent `SecSubmissionsAdapter` per request --
 * see that class's own constructor doc comment):
 *
 *  1. Process-local singleton (a module-scoped `TokenBucketLimiter`
 *     shared across requests within one isolate): CROSS_ISOLATE=NO --
 *     Cloudflare can and does run multiple isolates for the same Worker
 *     concurrently under load; a singleton scoped to one isolate's module
 *     state provides zero guarantee across them. Rejected outright: this
 *     doesn't even reach the "how atomic is it" question, since it fails
 *     the cross-isolate requirement structurally.
 *
 *  2. Cloudflare's native Workers Rate Limiting binding
 *     (`[[ratelimits]]`): already evaluated and rejected for a
 *     structurally identical problem in this exact codebase
 *     (`document-ingress-admission-control.ts`'s own module doc comment,
 *     SUN-1222C0-R1) for three Cloudflare-documented reasons this
 *     analysis doesn't re-litigate: (a) LOCALITY -- enforced per Cloudflare
 *     colo, not globally; (b) ACCURACY -- Cloudflare's own docs call it
 *     "permissive, eventually consistent, and intentionally designed to
 *     not be used as an accurate accounting system"; (c) WINDOW
 *     GRANULARITY -- minimum period is 10 seconds, incapable of expressing
 *     SEC's 1-second ceiling at all. All three apply here with equal or
 *     greater force (SEC's window is 8x finer than the binding's coarsest
 *     option). Rejected for the same reasons, not a new judgment call.
 *
 *  3. A new Durable Object: CROSS_ISOLATE=YES, ATOMIC=YES (a DO instance
 *     serializes all requests to itself), and would be the textbook
 *     answer for a greenfield design. Rejected FOR THIS CHECKPOINT
 *     specifically, not as a permanently-wrong idea: it requires a new
 *     Cloudflare binding (a `[[durable_objects]]` entry in `wrangler.toml`
 *     plus a migration), which requires an actual deploy to take effect --
 *     explicitly prohibited this checkpoint ("DO NOT DEPLOY. DO NOT MUTATE
 *     CLOUDFLARE."). It also introduces real operational complexity (a new
 *     class of Cloudflare object to provision, monitor, and reason about)
 *     for a ceiling (10 req/s, one call site) that D1 -- already bound,
 *     already used for materially harder concurrency guarantees in this
 *     exact codebase -- already satisfies.
 *
 *  4. D1 lease/sliding-window log (SELECTED): CROSS_ISOLATE=YES (every
 *     isolate shares the same logical D1 database, not per-isolate
 *     state), ATOMIC=YES (SQLite single-writer serialization for the
 *     underlying database -- the exact property
 *     `d1/document-ingress-admission.ts`'s own doc comment already proves
 *     for a structurally identical atomic-admission statement shape),
 *     LATENCY=one D1 round-trip per SEC-bound attempt (tens of ms;
 *     acceptable next to the real Modal-proxied SEC fetch it gates),
 *     FAILURE_MODE=fail closed (`tryAcquire` catches any D1 error and
 *     returns `{ allowed: false, reason: 'coordinator_unavailable' }` --
 *     never falls back to unlimited), REQUEST_BURST_BEHAVIOR=bounded by
 *     construction (a genuine sliding window, not a fixed one -- see
 *     migration 0009's own doc comment for why this avoids the
 *     boundary-doubling failure mode), RETRY_COORDINATION=every retry
 *     re-calls `tryAcquire` (enforced by `SecSubmissionsAdapter`'s own
 *     loop, not by this class), OPERATIONAL_COMPLEXITY=low -- reuses the
 *     already-required `DB` binding, adds one new table, zero new
 *     Cloudflare resources, zero deploy required to exist in the repo and
 *     be fully testable via Miniflare.
 *
 * Uses a fixed, deliberately conservative operational ceiling below SEC's
 * published maximum (see `SEC_OPERATIONAL_CEILING_RPS`'s own doc comment).
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { RateCoordinator, RateCoordinatorDecision } from '@siteborne/provider-adapters';
import type { SecRateWindowRepository } from '../repositories/interfaces';
import { D1SecRateWindowRepository } from '../repositories/d1/sec-rate-window';

/**
 * SUN-1222C2-Q1-R2 section 13: SEC's own published ceiling is exactly 10
 * requests/second (`sec.gov/os/accessing-edgar-data` /
 * `sec.gov/developer`, both reviewed 2026-09-06 -- see the evidence
 * report for the verbatim text). Operating a distributed system exactly
 * AT a hard external ceiling leaves zero margin for: (a) clock skew
 * between this coordinator's `nowMs` source and whatever clock SEC's own
 * edge measures against, (b) the coordinator's own window-boundary
 * granularity, (c) any other legitimate SITEBORNE traffic to SEC this
 * coordinator does not yet account for (there is only one call site
 * today, but the ceiling is provider-scoped, not call-site-scoped, so a
 * future second caller would share this same budget correctly). A 20%
 * headroom cut (10 -> 8) is the same order of margin this codebase's own
 * `DEFAULT_NETWORK_POLICY`/backoff jitter factors already use for
 * comparable safety margins elsewhere, not an arbitrary number.
 */
export const SEC_OPERATIONAL_CEILING_RPS = 8;

const WINDOW_MS = 1000;

export class SecD1RateCoordinator implements RateCoordinator {
  constructor(
    private repo: SecRateWindowRepository,
    private ceilingRps: number = SEC_OPERATIONAL_CEILING_RPS
  ) {}

  async tryAcquire(providerId: string, nowMs: number): Promise<RateCoordinatorDecision> {
    try {
      const windowStartMs = nowMs - WINDOW_MS;
      const result = await this.repo.tryAdmit(providerId, nowMs, windowStartMs, this.ceilingRps);
      if (!result.ok) {
        // SUN-1222C2-Q1-R2 section 16: fail CLOSED, never open, when the
        // coordination mechanism itself cannot be reached.
        return { allowed: false, reason: 'coordinator_unavailable' };
      }
      if (!result.value.admitted) {
        // The window is exactly 1 second wide; the safest bounded
        // suggestion is "try again once this window has fully rolled
        // over" -- never a fabricated shorter value that could produce a
        // tighter retry loop than the window itself permits.
        return { allowed: false, reason: 'rate_limited', retryAfterMs: WINDOW_MS };
      }
      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'coordinator_unavailable' };
    }
  }
}

export function buildSecD1RateCoordinator(db: D1Database): SecD1RateCoordinator {
  return new SecD1RateCoordinator(new D1SecRateWindowRepository(db));
}
