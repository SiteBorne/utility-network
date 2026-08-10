/**
 * Closed error/result taxonomy for SUN-0700A checkpoint 1 (protocol
 * construction and structural validation only — never settlement, never
 * cryptographic/onchain payment verification; that is SUN-0700B). Mirrors
 * the closed-result-union pattern already used in provider-adapters,
 * document-worker, verification, and service-runtime — nothing thrown
 * across a public boundary here either.
 */

/** Why a payment payload failed structural validation. Deliberately does
 * NOT include `payment_verified` or any "verified"/"settled" outcome —
 * this package never claims cryptographic or onchain authenticity. */
export type PaymentPayloadValidationStatus =
  | 'valid_structure'
  | 'invalid_structure'
  | 'unsupported_version'
  | 'unsupported_scheme'
  | 'unsupported_network'
  | 'requirement_mismatch'
  | 'resource_mismatch'
  | 'service_mismatch'
  | 'quote_mismatch'
  | 'expired';

export interface PaymentPayloadValidationResult {
  status: PaymentPayloadValidationStatus;
  detail?: string;
}

/** Why a header codec operation failed. Every codec failure is one of
 * these — never an uncaught exception. */
export type HeaderCodecFailureReason =
  | 'malformed_base64'
  | 'oversized_payload'
  | 'malformed_json'
  | 'unsafe_object_shape'
  | 'schema_invalid'
  | 'unsupported_version';

export interface HeaderDecodeFailure {
  ok: false;
  reason: HeaderCodecFailureReason;
  detail?: string;
}

export interface HeaderDecodeSuccess<T> {
  ok: true;
  value: T;
}

export type HeaderDecodeResult<T> = HeaderDecodeSuccess<T> | HeaderDecodeFailure;

/** Why a payment-requirements (exact) construction/validation call was
 * rejected. Resource identity is not itself a field of the x402
 * `PaymentRequirements` wire object — a resource mismatch is detected at
 * the payload-parsing layer instead (`PaymentPayloadValidationStatus`
 * above), where `PaymentPayload.resource` is actually present. */
export type RequirementValidationFailureReason =
  | 'amount_mismatch'
  | 'payee_mismatch'
  | 'quote_expired'
  | 'asset_mismatch'
  | 'network_mismatch'
  | 'payee_malformed';

export class X402ProtocolError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'X402ProtocolError';
  }
}
