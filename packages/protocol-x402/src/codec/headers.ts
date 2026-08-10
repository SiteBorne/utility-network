/**
 * Deterministic, bounded, prototype-pollution-safe codecs for the three
 * x402 V2 headers (directive §12): `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`,
 * `PAYMENT-RESPONSE` — Base64-encoded UTF-8 JSON per the current official
 * spec (docs.x402.org/core-concepts/http-402).
 *
 * @x402/core exports encode/decode functions for the first two, but its
 * decoders (a) throw rather than returning a closed result, (b) call
 * `JSON.parse` with no size bound, and (c) return the parsed value
 * type-asserted without runtime schema validation (verified by inspecting
 * its published dist/esm/chunk-*.mjs — see
 * docs/decisions/0041-x402-v2-protocol-boundary.md). This module wraps
 * those primitives — reusing @x402/core's own Zod-backed
 * `parsePaymentRequired`/`parsePaymentPayload` safe-parsers for the actual
 * V2 shape validation, never a second hand-maintained schema for those two
 * — with our own bounded, pollution-safe decode step first, and converts
 * every failure into a closed `HeaderDecodeResult`, never an exception.
 *
 * `PAYMENT-RESPONSE` (`SettleResponse`) has no exported Zod schema from
 * @x402/core at all (only a plain TS type) — this module defines the one
 * schema needed for it, kept intentionally minimal and structurally
 * identical to the official `SettleResponse` type recorded in
 * fixtures/x402-spec-baseline.json.
 */
import { z } from 'zod';
import { parsePaymentPayload, parsePaymentRequired } from '@x402/core/schemas';
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types';
import type { HeaderCodecFailureReason, HeaderDecodeResult } from '../errors';

/** No single x402 header value may decode to more than this many bytes of
 * JSON — a defensive bound @x402/core's own decoders do not enforce.
 * Generous enough for any realistic payment payload (accepts[] is itself
 * separately bounded to MAX_ACCEPTS_LENGTH), small enough to make a
 * memory-exhaustion payload rejected before JSON.parse ever runs. */
export const MAX_DECODED_HEADER_BYTES = 64 * 1024;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A JSON.parse `reviver` that rejects prototype-pollution-shaped keys
 * outright rather than silently stripping them — a payload that contains
 * one of these keys is `unsafe_object_shape`, not quietly sanitized. This
 * throws from inside JSON.parse, which safeJsonParse below catches. */
function pollutionGuardReviver(key: string, value: unknown): unknown {
  if (DANGEROUS_KEYS.has(key)) {
    throw new PollutionGuardError(key);
  }
  return value;
}

class PollutionGuardError extends Error {
  constructor(public readonly key: string) {
    super(`refusing to parse JSON containing dangerous key "${key}"`);
  }
}

function fail(reason: HeaderCodecFailureReason, detail?: string): HeaderDecodeResult<never> {
  return { ok: false, reason, detail };
}

/** Bounded, pollution-safe Base64 → JSON decode shared by all three
 * header decoders below. */
function decodeBoundedJson(headerValue: string): HeaderDecodeResult<unknown> {
  if (typeof headerValue !== 'string' || headerValue.length === 0) {
    return fail('malformed_base64', 'empty or non-string header value');
  }
  if (!BASE64_PATTERN.test(headerValue)) {
    return fail('malformed_base64', 'value does not match the Base64 alphabet');
  }

  let decodedBytes: Buffer;
  try {
    decodedBytes = Buffer.from(headerValue, 'base64');
  } catch (err) {
    return fail('malformed_base64', String(err));
  }
  if (decodedBytes.length > MAX_DECODED_HEADER_BYTES) {
    return fail(
      'oversized_payload',
      `decoded length ${decodedBytes.length} exceeds MAX_DECODED_HEADER_BYTES (${MAX_DECODED_HEADER_BYTES})`
    );
  }

  const text = decodedBytes.toString('utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, pollutionGuardReviver);
  } catch (err) {
    if (err instanceof PollutionGuardError) {
      return fail('unsafe_object_shape', err.message);
    }
    return fail('malformed_json', String(err));
  }
  return { ok: true, value: parsed };
}

/** @x402/core's `parsePaymentRequired` validates the V1|V2 union shape —
 * a structurally valid V1 payload passes it. This wrapper additionally
 * enforces the version binding (version.ts): a schema-valid V1 payload is
 * `unsupported_version`, never silently accepted as V2. */
export function decodePaymentRequiredHeaderSafe(
  headerValue: string
): HeaderDecodeResult<PaymentRequired> {
  const decoded = decodeBoundedJson(headerValue);
  if (!decoded.ok) return decoded;
  const result = parsePaymentRequired(decoded.value);
  if (!result.success) {
    return fail('schema_invalid', result.error.message);
  }
  if (result.data.x402Version !== 2) {
    return fail('unsupported_version', `x402Version ${result.data.x402Version} is not supported`);
  }
  return { ok: true, value: result.data as unknown as PaymentRequired };
}

/** Same version-binding enforcement as decodePaymentRequiredHeaderSafe
 * above, for the buyer-supplied payment payload. */
export function decodePaymentSignatureHeaderSafe(
  headerValue: string
): HeaderDecodeResult<PaymentPayload> {
  const decoded = decodeBoundedJson(headerValue);
  if (!decoded.ok) return decoded;
  const result = parsePaymentPayload(decoded.value);
  if (!result.success) {
    return fail('schema_invalid', result.error.message);
  }
  if (result.data.x402Version !== 2) {
    return fail('unsupported_version', `x402Version ${result.data.x402Version} is not supported`);
  }
  return { ok: true, value: result.data as unknown as PaymentPayload };
}

/** @x402/core exports no Zod schema for `SettleResponse` (only a plain TS
 * type) — this is the one schema this package hand-maintains, kept
 * structurally identical to the official type recorded in
 * fixtures/x402-spec-baseline.json. Revisit if a future @x402/core
 * release exports one. */
const SettleResponseSchema = z.object({
  success: z.boolean(),
  errorReason: z.string().optional(),
  errorMessage: z.string().optional(),
  payer: z.string().optional(),
  transaction: z.string(),
  network: z.string(),
  amount: z.string().optional(),
  extensions: z.record(z.unknown()).optional(),
  extra: z.record(z.unknown()).optional(),
});

export function decodePaymentResponseHeaderSafe(
  headerValue: string
): HeaderDecodeResult<SettleResponse> {
  const decoded = decodeBoundedJson(headerValue);
  if (!decoded.ok) return decoded;
  const result = SettleResponseSchema.safeParse(decoded.value);
  if (!result.success) {
    return fail('schema_invalid', result.error.message);
  }
  // `network` is validated structurally as a non-empty string by the
  // schema above (CAIP-2 well-formedness is a separate, explicit check —
  // see network/schemes.ts's parseCaip2Network, deliberately not
  // duplicated as a zod refinement here); the official `Network` type's
  // template-literal shape is a compile-time-only distinction.
  return { ok: true, value: result.data as SettleResponse };
}

/** Encoding never fails at this package's boundary — the input is already
 * a well-typed, previously-validated object, and Base64/JSON encoding of a
 * well-formed object cannot throw. Provided for round-trip symmetry with
 * the decoders above. */
export function encodePaymentRequiredHeaderSafe(value: PaymentRequired): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}
export function encodePaymentSignatureHeaderSafe(value: PaymentPayload): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}
export function encodePaymentResponseHeaderSafe(value: SettleResponse): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}
