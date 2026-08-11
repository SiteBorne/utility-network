import type { NeverminedPaymentRequired, NeverminedPaymentResponse } from './client';

export const NEVERMINED_MAX_DECODED_HEADER_BYTES = 64 * 1024;
export const NEVERMINED_MAX_ACCESS_TOKEN_BYTES = 8192;

type DecodeFailureReason =
  | 'malformed_base64'
  | 'oversized_payload'
  | 'malformed_json'
  | 'unsafe_object_shape'
  | 'schema_invalid';

export type NeverminedHeaderDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: DecodeFailureReason };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const TOKEN = /^[A-Za-z0-9+/_=-]+$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class UnsafeObjectShapeError extends Error {}

function decodeJson(value: string): NeverminedHeaderDecodeResult<unknown> {
  if (!value || !BASE64.test(value)) return { ok: false, reason: 'malformed_base64' };
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength > NEVERMINED_MAX_DECODED_HEADER_BYTES) {
    return { ok: false, reason: 'oversized_payload' };
  }
  try {
    return {
      ok: true,
      value: JSON.parse(decoded.toString('utf8'), (key, item) => {
        if (DANGEROUS_KEYS.has(key)) throw new UnsafeObjectShapeError();
        return item;
      }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof UnsafeObjectShapeError ? 'unsafe_object_shape' : 'malformed_json',
    };
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function decodeNeverminedPaymentRequiredHeaderSafe(
  value: string
): NeverminedHeaderDecodeResult<NeverminedPaymentRequired> {
  const decoded = decodeJson(value);
  if (!decoded.ok) return decoded;
  const required = record(decoded.value);
  if (
    !required ||
    required.x402Version !== 2 ||
    !record(required.resource) ||
    !Array.isArray(required.accepts) ||
    !record(required.extensions)
  ) {
    return { ok: false, reason: 'schema_invalid' };
  }
  return { ok: true, value: decoded.value as NeverminedPaymentRequired };
}

export function decodeNeverminedPaymentResponseHeaderSafe(
  value: string
): NeverminedHeaderDecodeResult<NeverminedPaymentResponse> {
  const decoded = decodeJson(value);
  if (!decoded.ok) return decoded;
  const response = record(decoded.value);
  if (
    !response ||
    typeof response.success !== 'boolean' ||
    typeof response.transaction !== 'string' ||
    typeof response.network !== 'string' ||
    (response.creditsRedeemed !== undefined &&
      (typeof response.creditsRedeemed !== 'string' || !/^\d+$/.test(response.creditsRedeemed)))
  ) {
    return { ok: false, reason: 'schema_invalid' };
  }
  return { ok: true, value: decoded.value as NeverminedPaymentResponse };
}

export function encodeNeverminedPaymentRequiredHeaderSafe(
  value: NeverminedPaymentRequired
): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function encodeNeverminedPaymentResponseHeaderSafe(
  value: NeverminedPaymentResponse
): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function validateNeverminedAccessToken(value: string | undefined): {
  status: 'valid' | 'missing' | 'malformed' | 'oversized';
} {
  if (!value) return { status: 'missing' };
  if (Buffer.byteLength(value, 'utf8') > NEVERMINED_MAX_ACCESS_TOKEN_BYTES) {
    return { status: 'oversized' };
  }
  if (!TOKEN.test(value)) return { status: 'malformed' };
  return { status: 'valid' };
}
