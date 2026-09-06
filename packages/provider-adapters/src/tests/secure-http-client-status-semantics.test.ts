import { describe, it, expect } from 'vitest';
import { SecureHttpClient, DEFAULT_HTTP_CONFIG } from '../http/client';
import { fakeClock } from './support';
import type { InjectedHttpClient } from '../types';
import {
  RateLimitedError,
  PermanentFailureError,
  RetryableFailureError,
  NotFoundError,
  AdapterError,
} from '../errors';

/**
 * SUN-1222C2-Q1-R2 section 5's genuine RED (before this file's fix below
 * existed): a 429/403/500/503 with a valid, plausible-provider-shaped JSON
 * body was returned as an ordinary successful `HttpResponse` -- no
 * exception, `result.data` equal to the error body. Captured verbatim in
 * `docs/reports/SUN-1222C2-Q1-R2-sec-policy-closure-and-rate-coordination.md`
 * (this checkpoint's own transcript output), not re-asserted here: a test
 * that permanently asserts the OLD broken behavior would contradict the
 * GREEN contract below the moment both existed side by side. No test in
 * this file makes a real network request; `fixedStatusHttpClient` below is
 * a plain function returning a canned `Response`.
 */

function fixedStatusHttpClient(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): InjectedHttpClient {
  return {
    async fetch() {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    },
  };
}

// A body that would satisfy any of this repo's provider JSON schemas just
// fine at the type level (a plain object with plausible-looking fields) --
// exactly the shape SEC (or any JSON API) could plausibly return alongside
// an error status, which is the entire point of this checkpoint's finding.
const PLAUSIBLE_PROVIDER_SHAPED_BODY = {
  cik: '0000320193',
  entityName: 'Apple Inc.',
  error: 'Too Many Requests',
};

/**
 * Section 9/10 GREEN + mutation-proof target shape -- written now so the
 * same file proves both the RED baseline above and, after the fix, the
 * corrected behavior below. Both describe blocks live in one file
 * deliberately: a reviewer can see the exact before/after in one place.
 */
describe('SUN-1222C2-Q1-R2: SecureHttpClient HTTP status semantics (post-fix contract)', () => {
  it('GREEN: 429 throws RateLimitedError, never returns the body as data', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(429, PLAUSIBLE_PROVIDER_SHAPED_BODY, { 'retry-after': '30' }),
      fakeClock()
    );
    await expect(
      client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json')
    ).rejects.toThrow(RateLimitedError);
    try {
      await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
      expect.unreachable('must throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitedError);
      expect((e as RateLimitedError).resultClass).toBe('rate_limited');
      expect((e as RateLimitedError).retryAfterMs).toBe(30000);
    }
  });

  it('GREEN: 429 with no Retry-After still throws RateLimitedError, with no fabricated retryAfterMs', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(429, PLAUSIBLE_PROVIDER_SHAPED_BODY),
      fakeClock()
    );
    try {
      await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
      expect.unreachable('must throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitedError);
      expect((e as RateLimitedError).retryAfterMs).toBeUndefined();
    }
  });

  it('GREEN: 403 throws PermanentFailureError, never returns the body as data', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(403, PLAUSIBLE_PROVIDER_SHAPED_BODY),
      fakeClock()
    );
    try {
      await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
      expect.unreachable('must throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PermanentFailureError);
      expect((e as PermanentFailureError).resultClass).toBe('permanent_failure');
    }
  });

  it('GREEN: 401 also throws PermanentFailureError', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(401, PLAUSIBLE_PROVIDER_SHAPED_BODY),
      fakeClock()
    );
    await expect(
      client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json')
    ).rejects.toBeInstanceOf(PermanentFailureError);
  });

  it('GREEN: 404 throws NotFoundError specifically (not a generic PermanentFailureError)', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(404, PLAUSIBLE_PROVIDER_SHAPED_BODY),
      fakeClock()
    );
    await expect(
      client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([500, 502, 503, 504])(
    'GREEN: %d throws RetryableFailureError, never returns the body as data',
    async (status) => {
      const client = new SecureHttpClient(
        DEFAULT_HTTP_CONFIG,
        fixedStatusHttpClient(status, PLAUSIBLE_PROVIDER_SHAPED_BODY),
        fakeClock()
      );
      try {
        await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
        expect.unreachable('must throw');
      } catch (e) {
        expect(e).toBeInstanceOf(RetryableFailureError);
        expect((e as RetryableFailureError).resultClass).toBe('retryable_failure');
      }
    }
  );

  it('GREEN: 503 with Retry-After propagates retryAfterMs on RetryableFailureError', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(503, PLAUSIBLE_PROVIDER_SHAPED_BODY, { 'retry-after': '5' }),
      fakeClock()
    );
    try {
      await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
      expect.unreachable('must throw');
    } catch (e) {
      expect((e as RetryableFailureError).retryAfterMs).toBe(5000);
    }
  });

  it('GREEN: 408 throws RetryableFailureError', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(408, PLAUSIBLE_PROVIDER_SHAPED_BODY),
      fakeClock()
    );
    await expect(
      client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json')
    ).rejects.toBeInstanceOf(RetryableFailureError);
  });

  it.each([400, 409, 425])('GREEN: other 4xx (%d) throws PermanentFailureError', async (status) => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(status, PLAUSIBLE_PROVIDER_SHAPED_BODY),
      fakeClock()
    );
    await expect(
      client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json')
    ).rejects.toBeInstanceOf(PermanentFailureError);
  });

  it('GREEN: 304 Not Modified passes through as a normal successful fetch (PublicHttpAdapter depends on this for conditional GET)', async () => {
    // 304 is a "null body status" per the Fetch spec -- the platform
    // Response constructor rejects a body alongside it, matching what a
    // real conditional-GET response looks like.
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      {
        async fetch() {
          return new Response(null, { status: 304, headers: { 'content-type': 'text/html' } });
        },
      },
      fakeClock()
    );
    const result = await client.fetch('https://example.com/resource');
    expect(result.metadata.status).toBe(304);
  });

  it('GREEN: ordinary 200 is completely unaffected', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(200, PLAUSIBLE_PROVIDER_SHAPED_BODY),
      fakeClock()
    );
    const result = await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
    expect(result.data).toEqual(PLAUSIBLE_PROVIDER_SHAPED_BODY);
  });

  it('every thrown status error is an AdapterError subclass carrying no response body content', async () => {
    const client = new SecureHttpClient(
      DEFAULT_HTTP_CONFIG,
      fixedStatusHttpClient(429, { secret_looking_field: 'should-not-leak-into-error-message' }),
      fakeClock()
    );
    try {
      await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
      expect.unreachable('must throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as Error).message).not.toContain('secret_looking_field');
      expect((e as Error).message).not.toContain('should-not-leak-into-error-message');
    }
  });

  it('Retry-After edge cases: integer seconds, malformed, missing, negative, huge -- fail safely, never throws while parsing', async () => {
    const cases: Array<{ header?: string; expectDefined: boolean }> = [
      { header: '30', expectDefined: true },
      { header: 'not-a-number', expectDefined: false },
      { header: undefined, expectDefined: false },
      // Not digit-only, so parseRetryAfterMs (rate-limit/backoff.ts, unmodified
      // by this checkpoint) falls through to its HTTP-date branch;
      // `Date.parse('-5')` resolves to a past date on this engine, and a
      // past/present date safely means "retry immediately" (0), not
      // "unparseable" -- still bounded, still safe, just not undefined.
      { header: '-5', expectDefined: true },
      { header: '999999999', expectDefined: true }, // huge, but capped by parseRetryAfterMs
    ];
    for (const { header, expectDefined } of cases) {
      const client = new SecureHttpClient(
        DEFAULT_HTTP_CONFIG,
        fixedStatusHttpClient(
          429,
          PLAUSIBLE_PROVIDER_SHAPED_BODY,
          header !== undefined ? { 'retry-after': header } : {}
        ),
        fakeClock()
      );
      try {
        await client.fetchJson('https://data.sec.gov/submissions/CIK0000320193.json');
        expect.unreachable('must throw');
      } catch (e) {
        const retryAfterMs = (e as RateLimitedError).retryAfterMs;
        if (expectDefined) {
          expect(retryAfterMs).toBeDefined();
          expect(retryAfterMs).toBeLessThanOrEqual(300000); // capped, never unbounded
        } else {
          expect(retryAfterMs).toBeUndefined();
        }
      }
    }
  });
});
