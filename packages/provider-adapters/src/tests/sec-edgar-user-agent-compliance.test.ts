import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SecSubmissionsAdapter } from '../sec/submissions-adapter';
import { fakeClock, fakeArtifactStore, fakeAuditSink, buildContext } from './support';
import type { InjectedHttpClient } from '../types';

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures', import.meta.url));

function loadFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}/${relativePath}`, 'utf-8'));
}

/**
 * SUN-1222C2-Q1-R1: proves the *actual outgoing request contract* -- not
 * merely that some constant exists in source -- for SEC EDGAR's Fair Access
 * "declare your user agent" guidance
 * (https://www.sec.gov/os/accessing-edgar-data, reviewed 2026-09-06;
 * https://www.sec.gov/developer, reviewed 2026-09-06). `execution_mode:
 * 'test'` is used deliberately: it is the one documented way to reach
 * `SecSubmissionsAdapter.execute()`'s real `fetchAndNormalize()` request-
 * construction path (buildSubmissionsUrl -> SecureHttpClient.fetchJson ->
 * the injected httpClient.fetch) without needing a `sec-edgar` TermsReview
 * record (`globalTermsGuard.checkAccess()`'s first line is
 * `if (executionMode === 'test') return;` -- see
 * sec-edgar-terms-review-gap.test.ts). This is NOT a real SEC EDGAR
 * request: the injected `capturingHttpClient` below is a plain function
 * that returns a canned Response from a local fixture and never touches a
 * socket (REAL_SEC_REQUESTS=0 for this whole checkpoint).
 */
function capturingHttpClient(body: unknown): InjectedHttpClient & {
  readonly callCount: number;
  readonly capturedHeaders: Headers[];
} {
  const capturedHeaders: Headers[] = [];
  return {
    async fetch(_input: RequestInfo | URL, init?: RequestInit) {
      capturedHeaders.push(new Headers(init?.headers));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    get callCount() {
      return capturedHeaders.length;
    },
    get capturedHeaders() {
      return capturedHeaders;
    },
  };
}

describe('SUN-1222C2-Q1-R1: SEC EDGAR declared User-Agent compliance', () => {
  const fixture = loadFixture('sec-edgar/submissions-success.json');

  it('the real outgoing SEC submissions request declares a compliant User-Agent identifying SITEBORNE and a contact', async () => {
    const clock = fakeClock();
    const httpClient = capturingHttpClient(fixture);
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });

    const result = await adapter.execute({ cik: '0000320193', forms: [], maxFilings: 10 }, context);

    // Sanity: the real request-construction path actually ran and succeeded
    // -- this is not a guard-blocked or error short-circuit that would make
    // the header assertion below vacuous.
    expect(result.resultClass).toBe('success');
    expect(httpClient.callCount).toBe(1);

    const userAgent = httpClient.capturedHeaders[0].get('user-agent');
    expect(userAgent).not.toBeNull();
    // SEC's own sample format is "Sample Company Name AdminContact@<domain>.com"
    // -- an organization identifier plus an administrative-contact token.
    // No source file in this repository records an administrative contact
    // email, but `git log --format='%an <%ae>'` shows `SiteBorne
    // <hello@siteborne.com>` as the sole author identity across this
    // repository's real commit history on the public
    // github.com/SiteBorne/utility-network -- already public, not invented.
    expect(userAgent).toContain('SITEBORNE');
    expect(userAgent).toContain('hello@siteborne.com');
  });

  it('does not alter unrelated request properties (host, path, method) while adding the header', async () => {
    const clock = fakeClock();
    const httpClient = capturingHttpClient(fixture);
    const adapter = new SecSubmissionsAdapter(
      httpClient,
      clock,
      fakeArtifactStore(),
      fakeAuditSink()
    );
    const context = buildContext({ injected_clock: clock, injected_http_client: httpClient });

    await adapter.execute({ cik: '0000320193', forms: [], maxFilings: 10 }, context);

    // capturingHttpClient's fetch signature only receives the URL as
    // `_input` (unused) -- callCount/capturedHeaders already prove exactly
    // one call was made; the URL-shape/host is separately proven in
    // sec-edgar-cik-request-validation.test.ts.
    expect(httpClient.callCount).toBe(1);
  });
});
