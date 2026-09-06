import { describe, it, expect } from 'vitest';
import { SecSubmissionsAdapter } from '../sec/submissions-adapter';
import { SecCompanyFactsAdapter } from '../sec/company-facts-adapter';
import { CrossrefAdapter } from '../crossref/crossref-adapter';
import { OpenAlexAdapter } from '../openalex/openalex-adapter';
import { GitHubAdapter } from '../github/github-adapter';
import { FederalRegisterAdapter } from '../federal-register/federal-register-adapter';
import { PublicHttpAdapter } from '../http/public-http-adapter';
import { fakeClock, fakeArtifactStore, fakeAuditSink, buildContext } from './support';
import type { InjectedHttpClient } from '../types';

/**
 * SUN-1222C2-Q1-R2 section 11: cross-adapter regression. Every one of
 * these six adapters (plus SecSubmissionsAdapter, covered by
 * sec-edgar-user-agent-compliance.test.ts and adapter-execution.test.ts)
 * shares `SecureHttpClient` and had an identical dead
 * `error instanceof Response && error.status === 429` (github-adapter.ts
 * also had 403/404) branch that could never fire. This file exercises
 * each adapter's REAL `execute()` through the REAL `SecureHttpClient`
 * against a fixed-status fake transport -- no mocking below the transport
 * boundary -- proving the fix (and each adapter's own now-reachable
 * catch-block) actually works end to end, not just at the client level.
 *
 * `fakeClock()`'s `setTimeout` never auto-fires (only `.advance()` moves
 * it forward), and a repeatedly-429'd/500'd adapter retries through its
 * own bounded backoff before giving up -- each `backoff.wait()` call
 * awaits a timer that would otherwise never resolve. `resolveWithClockAdvance`
 * drains those timers by alternating a microtask flush with a clock jump
 * larger than any single bounded backoff interval, until the adapter's own
 * promise settles.
 */
async function resolveWithClockAdvance<T>(
  promise: Promise<T>,
  clock: ReturnType<typeof fakeClock>
): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  for (let i = 0; i < 20 && !settled; i++) {
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(120000);
  }
  return promise;
}

function fixedStatusHttpClient(
  status: number,
  headers: Record<string, string> = {}
): InjectedHttpClient {
  return {
    async fetch() {
      return new Response(JSON.stringify({ message: 'error body, never real provider data' }), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    },
  };
}

describe('SUN-1222C2-Q1-R2: cross-adapter HTTP-status regression', () => {
  it('SecSubmissionsAdapter: 429 -> rate_limited, never success (the exact service in the paid company_evidence_graph.v2 path)', async () => {
    const clock = fakeClock();
    const httpClient = fixedStatusHttpClient(429, { 'retry-after': '20' });
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const result = await resolveWithClockAdvance(
      adapter.execute({ cik: '0000320193', forms: [], maxFilings: 10 }, context),
      clock
    );
    expect(result.resultClass).toBe('rate_limited');
  }, 15000);

  it('SecCompanyFactsAdapter: 429 -> rate_limited, never success', async () => {
    const clock = fakeClock();
    const httpClient = fixedStatusHttpClient(429, { 'retry-after': '10' });
    const adapter = new SecCompanyFactsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const result = await resolveWithClockAdvance(
      adapter.execute(
        { cik: '0000320193', taxonomies: [], concepts: [], forms: [], maxFacts: 100 },
        context
      ),
      clock
    );
    expect(result.resultClass).toBe('rate_limited');
  }, 15000);

  it('CrossrefAdapter: 429 -> rate_limited, never success', async () => {
    const clock = fakeClock();
    const httpClient = fixedStatusHttpClient(429);
    const adapter = new CrossrefAdapter(httpClient, clock, fakeArtifactStore(), fakeAuditSink());
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const result = await resolveWithClockAdvance(
      adapter.execute({ mode: 'doi', doi: '10.1038/s41586-023-05874-3' }, context),
      clock
    );
    expect(result.resultClass).toBe('rate_limited');
  }, 15000);

  it('OpenAlexAdapter: 429 -> rate_limited, never success', async () => {
    const clock = fakeClock();
    const httpClient = fixedStatusHttpClient(429);
    const adapter = new OpenAlexAdapter(httpClient, clock, fakeArtifactStore(), fakeAuditSink());
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const result = await resolveWithClockAdvance(
      adapter.execute({ mode: 'work', identifier: 'W2741809807' }, context),
      clock
    );
    expect(result.resultClass).toBe('rate_limited');
  }, 15000);

  it('FederalRegisterAdapter: 429 -> rate_limited, never success', async () => {
    const clock = fakeClock();
    const httpClient = fixedStatusHttpClient(429);
    const adapter = new FederalRegisterAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const result = await resolveWithClockAdvance(
      adapter.execute({ mode: 'document', documentNumber: '2024-01234' }, context),
      clock
    );
    expect(result.resultClass).toBe('rate_limited');
  }, 15000);

  it('PublicHttpAdapter: 429 -> rate_limited, never success', async () => {
    const clock = fakeClock();
    const httpClient = fixedStatusHttpClient(429);
    const adapter = new PublicHttpAdapter(httpClient, clock, fakeArtifactStore(), fakeAuditSink());
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const result = await resolveWithClockAdvance(
      adapter.execute({ url: 'https://example.com/' }, context),
      clock
    );
    expect(result.resultClass).toBe('rate_limited');
  }, 15000);

  it('GitHubAdapter: 429 -> rate_limited, 403 -> permanent_failure, 404 -> not_found -- never success', async () => {
    const clock = fakeClock();

    const httpClient429 = fixedStatusHttpClient(429);
    const adapter429 = new GitHubAdapter(
      httpClient429,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context429 = buildContext({ injected_clock: clock, injected_http_client: httpClient429 });
    const result429 = await resolveWithClockAdvance(
      adapter429.execute(
        { mode: 'repository', owner: 'siteborne', repo: 'siteborne-utility-network' },
        context429
      ),
      clock
    );
    expect(result429.resultClass).toBe('rate_limited');

    const httpClient403 = fixedStatusHttpClient(403);
    const adapter403 = new GitHubAdapter(
      httpClient403,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context403 = buildContext({ injected_clock: clock, injected_http_client: httpClient403 });
    const result403 = await resolveWithClockAdvance(
      adapter403.execute(
        { mode: 'repository', owner: 'siteborne', repo: 'siteborne-utility-network' },
        context403
      ),
      clock
    );
    expect(result403.resultClass).toBe('permanent_failure');

    const httpClient404 = fixedStatusHttpClient(404);
    const adapter404 = new GitHubAdapter(
      httpClient404,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context404 = buildContext({ injected_clock: clock, injected_http_client: httpClient404 });
    const result404 = await resolveWithClockAdvance(
      adapter404.execute(
        { mode: 'repository', owner: 'siteborne', repo: 'siteborne-utility-network' },
        context404
      ),
      clock
    );
    expect(result404.resultClass).toBe('not_found');
  }, 15000);

  it('SecCompanyFactsAdapter: 500 never returns a fabricated success result', async () => {
    const clock = fakeClock();
    const httpClient = fixedStatusHttpClient(500);
    const adapter = new SecCompanyFactsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });
    const result = await resolveWithClockAdvance(
      adapter.execute(
        { cik: '0000320193', taxonomies: [], concepts: [], forms: [], maxFacts: 100 },
        context
      ),
      clock
    );
    expect(result.resultClass).not.toBe('success');
  }, 15000);
});
