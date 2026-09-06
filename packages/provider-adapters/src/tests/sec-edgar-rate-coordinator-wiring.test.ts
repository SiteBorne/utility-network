import { describe, it, expect } from 'vitest';
import { SecSubmissionsAdapter } from '../sec/submissions-adapter';
import {
  fakeClock,
  fakeArtifactStore,
  fakeAuditSink,
  buildContext,
  jsonHttpClient,
} from './support';
import type { RateCoordinator, RateCoordinatorDecision } from '../rate-limit/aggregate-coordinator';

/**
 * SUN-1222C2-Q1-R2 section 18: proves `SecSubmissionsAdapter` actually
 * calls the injected `RateCoordinator` (not merely that the constructor
 * accepts one) and correctly honors both outcomes, using a fake
 * coordinator -- the real D1-backed implementation's own concurrency
 * proof lives in apps/edge-api (Miniflare-backed, real SQLite semantics).
 */

function callCountingCoordinator(
  decisions: RateCoordinatorDecision[]
): RateCoordinator & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async tryAcquire() {
      const decision = decisions[Math.min(calls, decisions.length - 1)];
      calls++;
      return decision;
    },
  };
}

describe('SUN-1222C2-Q1-R2: SecSubmissionsAdapter rate-coordinator wiring', () => {
  it('calls the coordinator before the real fetch and proceeds normally when admitted', async () => {
    const clock = fakeClock();
    const httpClient = jsonHttpClient({
      cik: '0000320193',
      entityName: 'Apple Inc.',
      filings: { recent: { accessionNumber: [], filingDate: [], form: [] } },
    });
    const coordinator = callCountingCoordinator([{ allowed: true }]);
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink(),
      coordinator
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });

    const result = await adapter.execute({ cik: '0000320193', forms: [], maxFilings: 10 }, context);

    expect(coordinator.calls).toBe(1);
    expect(result.resultClass).toBe('success');
    expect(httpClient.callCount).toBe(1);
  });

  it('denies the fetch entirely when the coordinator says no -- no network call is ever made', async () => {
    const clock = fakeClock();
    const httpClient = jsonHttpClient({ should: 'never be reached' });
    // Exhausts backoff quickly for a deterministic, fast test: every
    // attempt is denied, so this proves the terminal branch, not the
    // retry branch (already proven generically by
    // secure-http-client-cross-adapter-status-regression.test.ts).
    const coordinator = callCountingCoordinator([
      { allowed: false, reason: 'rate_limited', retryAfterMs: 1000 },
    ]);
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink(),
      coordinator
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });

    let settled = false;
    const resultPromise = adapter.execute(
      { cik: '0000320193', forms: [], maxFilings: 10 },
      context
    );
    resultPromise.then(() => (settled = true));
    for (let i = 0; i < 20 && !settled; i++) {
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(120000);
    }
    const result = await resultPromise;

    expect(result.resultClass).toBe('rate_limited');
    expect(httpClient.callCount).toBe(0);
    expect(coordinator.calls).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('fails closed (denies, never allows) when the coordinator itself is unavailable', async () => {
    const clock = fakeClock();
    const httpClient = jsonHttpClient({ should: 'never be reached' });
    const coordinator = callCountingCoordinator([
      { allowed: false, reason: 'coordinator_unavailable' },
    ]);
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink(),
      coordinator
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });

    let settled = false;
    const resultPromise = adapter.execute(
      { cik: '0000320193', forms: [], maxFilings: 10 },
      context
    );
    resultPromise.then(() => (settled = true));
    for (let i = 0; i < 20 && !settled; i++) {
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(120000);
    }
    const result = await resultPromise;

    expect(result.resultClass).toBe('rate_limited');
    expect(httpClient.callCount).toBe(0);
  }, 15000);

  it('re-checks the coordinator on every retry attempt, not only the first', async () => {
    const clock = fakeClock();
    const httpClient = jsonHttpClient({
      cik: '0000320193',
      entityName: 'Apple Inc.',
      filings: { recent: { accessionNumber: [], filingDate: [], form: [] } },
    });
    // Denied once, then admitted -- proves the SECOND attempt (a retry)
    // genuinely re-invokes tryAcquire rather than caching the first
    // decision.
    const coordinator = callCountingCoordinator([
      { allowed: false, reason: 'rate_limited', retryAfterMs: 10 },
      { allowed: true },
    ]);
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink(),
      coordinator
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });

    let settled = false;
    const resultPromise = adapter.execute(
      { cik: '0000320193', forms: [], maxFilings: 10 },
      context
    );
    resultPromise.then(() => (settled = true));
    for (let i = 0; i < 20 && !settled; i++) {
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(120000);
    }
    const result = await resultPromise;

    expect(coordinator.calls).toBe(2);
    expect(result.resultClass).toBe('success');
    expect(httpClient.callCount).toBe(1);
  }, 15000);
});
