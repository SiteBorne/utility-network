/**
 * SUN-1221E2D — closes the first of the two silent-diagnostic branches
 * SUN-1221E2R traced: `toAdapterResult`'s generic-`Error` fallback
 * (`errors.ts`) collapsed every non-`AdapterError` failure -- DNS,
 * connect/TLS, write, read, redirect-policy, media-type, size-bound,
 * decompression, JSON-parse, and genuinely unknown platform errors alike
 * -- into one indistinguishable `resultClass: 'permanent_failure'` /
 * `code: 'INTERNAL_ERROR'` bucket, with nothing logged anywhere. A real
 * live failure (SUN-1221E2, HTTP 502) left no way to tell which of those
 * classes actually happened.
 *
 * These tests prove the classifier now recovers a specific, stable
 * `WEBCTX_*` reason code from every message this codebase's own HTTP
 * layers (`client.ts`, `socket-http-client.ts`) are proven to throw --
 * enumerated from direct source inspection (SUN-1221E2D §3/§4), never
 * invented -- while `resultClass` itself stays `'permanent_failure'`
 * (zero behavior change, SUN-1221E2D §7).
 */
import { describe, it, expect } from 'vitest';
import { toAdapterResult, classifyGenericAdapterErrorReason } from '../errors';

describe('SUN-1221E2D — toAdapterResult recovers a specific WEBCTX_* reason code from generic Errors', () => {
  const cases: Array<{ message: string; name?: string; expectedReason: string }> = [
    // socket-http-client.ts (DNS + raw HTTP protocol layer)
    { message: 'DNS resolution failed safety policy: prohibited_or_mixed_dns_answer', expectedReason: 'WEBCTX_DNS_RESOLUTION_FAILED' },
    { message: 'URL validation failed: private IPv4 address', expectedReason: 'WEBCTX_URL_VALIDATION_FAILED' },
    { message: 'Malformed status line: garbage', expectedReason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
    { message: 'Malformed chunk size: zz', expectedReason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
    { message: 'Response headers exceed maximum size', expectedReason: 'WEBCTX_RESPONSE_TOO_LARGE' },
    { message: 'Response exceeds maximum size: 999 > 100', expectedReason: 'WEBCTX_RESPONSE_TOO_LARGE' },
    { message: 'Response body exceeds maximum size during streaming', expectedReason: 'WEBCTX_RESPONSE_TOO_LARGE' },
    // client.ts (SecureHttpClient layer)
    { message: 'Redirect without Location header', expectedReason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
    { message: 'Redirect target validation failed: private IPv4 address', expectedReason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
    { message: 'Maximum redirects exceeded', expectedReason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
    { message: 'Redirect chain validation failed: too many hops', expectedReason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
    { message: 'Media type not allowed: application/zip', expectedReason: 'WEBCTX_MEDIA_TYPE_BLOCKED' },
    { message: 'Decompression failed: unsupported', expectedReason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
    { message: 'Decompressed response exceeds limit: 999 > 100', expectedReason: 'WEBCTX_RESPONSE_TOO_LARGE' },
    { message: 'JSON parse failed: unexpected token', expectedReason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
    // SUN-1221E2D's own new instrumentation (socket-http-client.ts transport wrap)
    { message: 'WEBCTX_UPSTREAM_CONNECTION_FAILED: connection refused', expectedReason: 'WEBCTX_UPSTREAM_CONNECTION_FAILED' },
    { message: 'WEBCTX_REQUEST_WRITE_FAILED: socket closed', expectedReason: 'WEBCTX_REQUEST_WRITE_FAILED' },
    // AbortController-driven timeout (client.ts's own 30s bound)
    { message: 'The operation was aborted', name: 'AbortError', expectedReason: 'WEBCTX_TIMEOUT' },
  ];

  it.each(cases)('classifies "$message" as $expectedReason', ({ message, name, expectedReason }) => {
    const error = new Error(message);
    if (name) error.name = name;
    expect(classifyGenericAdapterErrorReason(error)).toBe(expectedReason);
  });

  it('falls back to WEBCTX_UPSTREAM_PROTOCOL_ERROR for a genuinely unrecognized message', () => {
    const error = new Error('some completely novel platform error text never seen before');
    expect(classifyGenericAdapterErrorReason(error)).toBe('WEBCTX_UPSTREAM_PROTOCOL_ERROR');
  });

  it('toAdapterResult still returns resultClass "permanent_failure" for a generic Error (unchanged, SUN-1221E2D §7)', () => {
    const { resultClass } = toAdapterResult(new Error('DNS resolution failed safety policy: unknown'));
    expect(resultClass).toBe('permanent_failure');
  });

  it('toAdapterResult now sets error.code to the specific WEBCTX_* reason, not the generic INTERNAL_ERROR', () => {
    const { error } = toAdapterResult(new Error('DNS resolution failed safety policy: unknown'));
    expect(error.code).toBe('WEBCTX_DNS_RESOLUTION_FAILED');
  });

  it('toAdapterResult preserves the original message text verbatim alongside the reason code', () => {
    const { error } = toAdapterResult(new Error('Media type not allowed: application/zip'));
    expect(error.message).toBe('Media type not allowed: application/zip');
    expect(error.code).toBe('WEBCTX_MEDIA_TYPE_BLOCKED');
  });

  it('toAdapterResult leaves AdapterError subclasses (e.g. PolicyBlockedError) completely untouched', async () => {
    const { PolicyBlockedError } = await import('../errors');
    const { resultClass, error } = toAdapterResult(new PolicyBlockedError('blocked by policy'));
    expect(resultClass).toBe('policy_blocked');
    expect(error.code).toBe('POLICY_BLOCKED');
  });

  it('toAdapterResult leaves a non-Error thrown value classified as UNKNOWN_ERROR, unchanged', () => {
    const { resultClass, error } = toAdapterResult('a plain string throw');
    expect(resultClass).toBe('permanent_failure');
    expect(error.code).toBe('UNKNOWN_ERROR');
  });
});
