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
      resultClass: 'permanent_failure',
      error: {
        code: 'INTERNAL_ERROR',
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
