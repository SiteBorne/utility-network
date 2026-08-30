export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly resultClass: string,
    public readonly details?: unknown,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class PolicyBlockedError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'POLICY_BLOCKED', 'policy_blocked', details);
    this.name = 'PolicyBlockedError';
  }
}

export class RateLimitedError extends AdapterError {
  constructor(message: string, retryAfterMs: number, details?: unknown) {
    super(message, 'RATE_LIMITED', 'rate_limited', details, retryAfterMs);
    this.name = 'RateLimitedError';
  }
}

export class InvalidRequestError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'INVALID_REQUEST', 'invalid_request', details);
    this.name = 'InvalidRequestError';
  }
}

export class NotFoundError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', 'not_found', details);
    this.name = 'NotFoundError';
  }
}

export class RetryableFailureError extends AdapterError {
  constructor(message: string, retryAfterMs?: number, details?: unknown) {
    super(message, 'RETRYABLE_FAILURE', 'retryable_failure', details, retryAfterMs);
    this.name = 'RetryableFailureError';
  }
}

export class PermanentFailureError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'PERMANENT_FAILURE', 'permanent_failure', details);
    this.name = 'PermanentFailureError';
  }
}

export class SourceChangedError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'SOURCE_CHANGED', 'source_changed', details);
    this.name = 'SourceChangedError';
  }
}

export class QuarantinedError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'QUARANTINED', 'quarantined', details);
    this.name = 'QuarantinedError';
  }
}

export class VerifiedAbsentCandidateError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'VERIFIED_ABSENT_CANDIDATE', 'verified_absent_candidate', details);
    this.name = 'VerifiedAbsentCandidateError';
  }
}

export class PartialResultError extends AdapterError {
  constructor(message: string, details?: unknown) {
    super(message, 'PARTIAL', 'partial', details);
    this.name = 'PartialResultError';
  }
}

/**
 * SUN-1221E2D — the fixed, finite set of `WEBCTX_*` diagnostic reason
 * codes `toAdapterResult`'s generic-`Error` fallback can now recover,
 * each backed by a message this codebase's own HTTP layers are proven
 * (by direct source inspection, SUN-1221E2D §3/§4) to throw:
 * `client.ts` (`SecureHttpClient` — redirect policy, media type,
 * response-size bounds, decompression, JSON parsing) and
 * `socket-http-client.ts` (`SafeSocketHttpClient` — DNS resolution via
 * the fixed trusted resolver, malformed HTTP/1.1 protocol framing, and
 * this checkpoint's own new transport-stage wraps — see that file's
 * `WEBCTX_UPSTREAM_CONNECTION_FAILED` / `WEBCTX_REQUEST_WRITE_FAILED` /
 * `WEBCTX_RESPONSE_READ_FAILED` / `WEBCTX_HTTP_PREMATURE_EOF` prefixes).
 * Order matters: more specific
 * patterns are listed before the broader ones they could otherwise be
 * shadowed by.
 *
 * Deliberately NOT exhaustive of every conceivable platform error string
 * (the debugging law this checkpoint operates under forbids guessing
 * platform internals with no supporting evidence) — anything that
 * doesn't match one of these known, sourced patterns falls through to
 * `WEBCTX_UPSTREAM_PROTOCOL_ERROR`, an honest "something in the
 * transport/protocol layer failed in a way we haven't seen and named
 * yet" bucket, never a false claim of precision this code can't back up.
 */
const WEBCTX_DIAGNOSTIC_REASON_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /^WEBCTX_UPSTREAM_CONNECTION_FAILED:/, reason: 'WEBCTX_UPSTREAM_CONNECTION_FAILED' },
  { pattern: /^WEBCTX_REQUEST_WRITE_FAILED:/, reason: 'WEBCTX_REQUEST_WRITE_FAILED' },
  { pattern: /^WEBCTX_RESPONSE_READ_FAILED:/, reason: 'WEBCTX_RESPONSE_READ_FAILED' },
  { pattern: /^WEBCTX_HTTP_PREMATURE_EOF:/, reason: 'WEBCTX_HTTP_PREMATURE_EOF' },
  { pattern: /^WEBCTX_HTTP_INVALID_RESPONSE_STATUS:/, reason: 'WEBCTX_HTTP_INVALID_RESPONSE_STATUS' },
  { pattern: /^DNS resolution failed safety policy/, reason: 'WEBCTX_DNS_RESOLUTION_FAILED' },
  { pattern: /^URL validation failed/, reason: 'WEBCTX_URL_VALIDATION_FAILED' },
  { pattern: /^Redirect without Location header/, reason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
  { pattern: /^Redirect target validation failed/, reason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
  { pattern: /^Redirect chain validation failed/, reason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
  { pattern: /^Maximum redirects exceeded/, reason: 'WEBCTX_REDIRECT_POLICY_BLOCKED' },
  { pattern: /^Media type not allowed/, reason: 'WEBCTX_MEDIA_TYPE_BLOCKED' },
  { pattern: /exceeds? maximum size/, reason: 'WEBCTX_RESPONSE_TOO_LARGE' },
  { pattern: /exceeds limit:/, reason: 'WEBCTX_RESPONSE_TOO_LARGE' },
  { pattern: /^Malformed status line/, reason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
  { pattern: /^Malformed chunk size/, reason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
  { pattern: /^Decompression failed/, reason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
  { pattern: /^JSON parse failed/, reason: 'WEBCTX_RESPONSE_PARSE_FAILED' },
];

/** Exported for direct, isolated unit testing (SUN-1221E2D §5) — also the
 * single function `toAdapterResult`'s generic-`Error` branch below
 * delegates to, so there is exactly one classification rule set, never
 * two that could drift apart. */
export function classifyGenericAdapterErrorReason(error: Error): string {
  if (error.name === 'AbortError' || /\babort/i.test(error.message)) {
    return 'WEBCTX_TIMEOUT';
  }
  for (const { pattern, reason } of WEBCTX_DIAGNOSTIC_REASON_PATTERNS) {
    if (pattern.test(error.message)) return reason;
  }
  return 'WEBCTX_UPSTREAM_PROTOCOL_ERROR';
}

export function toAdapterResult(error: unknown): {
  resultClass: string;
  error: { code: string; message: string; details?: unknown; retryAfterMs?: number };
} {
  if (error instanceof AdapterError) {
    return {
      resultClass: error.resultClass,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        retryAfterMs: error.retryAfterMs,
      },
    };
  }
  if (error instanceof Error) {
    return {
      // `resultClass` stays exactly 'permanent_failure' — SUN-1221E2D §7
      // (EXECUTOR_BEHAVIOR_CHANGED=NO): only `error.code` gains
      // precision, no caller that branches on `resultClass` observes any
      // difference.
      resultClass: 'permanent_failure',
      error: {
        code: classifyGenericAdapterErrorReason(error),
        message: error.message,
      },
    };
  }
  return {
    resultClass: 'permanent_failure',
    error: {
      code: 'UNKNOWN_ERROR',
      message: String(error),
    },
  };
}
