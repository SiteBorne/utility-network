/**
 * FIRST-PAID-VERIFY-FACILITATOR-SUBCLASSIFICATION-01 — internal-only,
 * classification-only view of a failed facilitator `/verify` call.
 *
 * `cdp-provider.ts` collapses every "no facilitator answer" failure into
 * `facilitator_verify_unavailable`. This module separates the causes without
 * changing any request, credential, JWT claim, retry, or public response. It
 * never returns or retains `Error.message`, headers, JWTs, credentials, or
 * response bodies: the only text it reads is matched against fixed patterns,
 * and only a closed vocabulary plus an integer HTTP status leaves this module.
 */

import { classifyCdpJwtFailure, type CdpJwtSubreason } from './cdp-jwt-failure';

export type FacilitatorVerifySubreason =
  | 'facilitator_jwt_generation_failed'
  | 'facilitator_authentication_rejected'
  | 'facilitator_authorization_rejected'
  | 'facilitator_rate_limited'
  | 'facilitator_http_4xx'
  | 'facilitator_http_5xx'
  | 'facilitator_timeout'
  | 'facilitator_network_unavailable'
  | 'facilitator_response_invalid'
  | 'facilitator_verify_invalid'
  | 'facilitator_unknown_error';

export type FacilitatorRetryability =
  | 'transient'
  | 'operator_action_required'
  | 'non_retryable'
  | 'unknown';

export interface FacilitatorFailureClassification {
  subreason: FacilitatorVerifySubreason;
  /** HTTP status only when the facilitator actually replied. */
  transport_status?: number;
  retryability: FacilitatorRetryability;
  /** Only for `facilitator_jwt_generation_failed`: which JWT-mint stage broke. */
  jwt_subreason?: CdpJwtSubreason;
}

/** Thrown by the provider's auth-header wrapper so that a failure while
 * minting the CDP JWT is distinguishable from a later `fetch` failure. The
 * original error is kept as `cause` for the classifier only; nothing in it is
 * ever persisted. */
export class FacilitatorAuthStageError extends Error {
  readonly stage = 'auth_header_construction' as const;
  constructor(readonly cause: unknown) {
    super('facilitator auth header construction failed');
    this.name = 'FacilitatorAuthStageError';
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;
}

/** `@x402/core` throws a plain `Error("Facilitator verify failed (NNN): <excerpt>")`
 * for a non-2xx reply that has no `isValid` body. Only the three digits are
 * extracted; the excerpt (which may echo a response body) is discarded. */
function statusFromVerifyFailureMessage(error: unknown): number | undefined {
  const message = record(error)?.message;
  if (typeof message !== 'string') return undefined;
  const match = /^Facilitator verify failed \((\d{3})\)/.exec(message);
  if (!match) return undefined;
  const status = Number(match[1]);
  return isHttpStatus(status) ? status : undefined;
}

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isTimeoutLike(error: unknown): boolean {
  const name = record(error)?.name;
  return name === 'FacilitatorTimeoutError' || name === 'TimeoutError' || name === 'AbortError';
}

function isNetworkLike(error: unknown): boolean {
  const rec = record(error);
  if (!rec) return false;
  const code = rec.code ?? record(rec.cause)?.code;
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
  return error instanceof TypeError;
}

function fromStatus(status: number): FacilitatorFailureClassification {
  if (status === 401) {
    return {
      subreason: 'facilitator_authentication_rejected',
      transport_status: status,
      retryability: 'operator_action_required',
    };
  }
  if (status === 403) {
    return {
      subreason: 'facilitator_authorization_rejected',
      transport_status: status,
      retryability: 'operator_action_required',
    };
  }
  if (status === 429) {
    return {
      subreason: 'facilitator_rate_limited',
      transport_status: status,
      retryability: 'transient',
    };
  }
  if (status >= 500) {
    return {
      subreason: 'facilitator_http_5xx',
      transport_status: status,
      retryability: 'transient',
    };
  }
  return {
    subreason: 'facilitator_http_4xx',
    transport_status: status,
    retryability: 'non_retryable',
  };
}

/** Classify an error thrown by `HTTPFacilitatorClient.verify`. Pure; never
 * throws; never returns any part of the error's message or cause. */
export function classifyFacilitatorVerifyFailure(error: unknown): FacilitatorFailureClassification {
  if (error instanceof FacilitatorAuthStageError) {
    return {
      subreason: 'facilitator_jwt_generation_failed',
      retryability: 'operator_action_required',
      jwt_subreason: classifyCdpJwtFailure(error.cause),
    };
  }
  const rec = record(error);
  // The facilitator replied with a structured verify body (`VerifyError`).
  if (rec && rec.name === 'VerifyError' && isHttpStatus(rec.statusCode)) {
    return {
      subreason: 'facilitator_verify_invalid',
      transport_status: rec.statusCode,
      retryability: 'non_retryable',
    };
  }
  if (isTimeoutLike(error)) {
    return { subreason: 'facilitator_timeout', retryability: 'transient' };
  }
  if (rec?.name === 'FacilitatorResponseError') {
    return { subreason: 'facilitator_response_invalid', retryability: 'unknown' };
  }
  const status = statusFromVerifyFailureMessage(error);
  if (status !== undefined) return fromStatus(status);
  if (isNetworkLike(error)) {
    return { subreason: 'facilitator_network_unavailable', retryability: 'transient' };
  }
  return { subreason: 'facilitator_unknown_error', retryability: 'unknown' };
}

/** Subclass recorded when the facilitator answered `isValid:false` on a 2xx. */
export const FACILITATOR_ANSWERED_INVALID: FacilitatorFailureClassification = {
  subreason: 'facilitator_verify_invalid',
  retryability: 'non_retryable',
};
