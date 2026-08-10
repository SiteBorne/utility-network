/**
 * Pure structural parser/validator for a buyer-supplied payment payload
 * (directive §13). This is NOT settlement verification and NEVER reports
 * `payment_verified` — cryptographic signature checking and onchain
 * verification belong to SUN-0700B. This module only answers: does the
 * payload's shape and declared binding (version, scheme, network,
 * requirement, quote, resource, expiry) match what SITEBORNE actually
 * offered?
 */
import type { PaymentPayload } from '@x402/core/types';
import { checkSupportedVersion, SUPPORTED_X402_VERSION } from '../version';
import { isSchemeSupportedOnNetwork, isSupportedScheme } from '../network/schemes';
import { validateExactRequirementBinding } from '../requirements/exact';
import { isQuoteExpired } from '../quote/quote';
import type { Quote } from '../quote/quote';
import type { PaymentPayloadValidationResult, PaymentPayloadValidationStatus } from '../errors';

export interface PaymentPayloadValidationContext {
  quote: Quote;
  /** The canonical resource identity the request being served actually
   * has (see docs/decisions/0041 for what "canonical" means here) —
   * compared against `payload.resource.url` when the buyer supplied one. */
  resource_id: string;
  now_iso: string;
}

function result(
  status: PaymentPayloadValidationStatus,
  detail?: string
): PaymentPayloadValidationResult {
  return { status, detail };
}

/** Every branch below returns a closed result — nothing in this function
 * throws for buyer-controlled input, including a payload that isn't even
 * shaped like an object (the caller is expected to have already run it
 * through codec/headers.ts's decodePaymentSignatureHeaderSafe, which
 * already guarantees @x402/core's own schema-valid shape; this function
 * adds the SITEBORNE-specific binding checks that schema validation alone
 * cannot express). */
export function validatePaymentPayloadStructure(
  payload: PaymentPayload,
  context: PaymentPayloadValidationContext
): PaymentPayloadValidationResult {
  const versionCheck = checkSupportedVersion(payload.x402Version);
  if (!versionCheck.supported) {
    return result(
      'unsupported_version',
      `expected x402Version ${SUPPORTED_X402_VERSION}, got ${String(payload.x402Version)}`
    );
  }

  const accepted = payload.accepted;
  if (!accepted || !isSupportedScheme(accepted.scheme)) {
    return result('unsupported_scheme', `scheme "${String(accepted?.scheme)}" is not supported`);
  }

  const networkSupport = isSchemeSupportedOnNetwork(accepted.scheme, accepted.network);
  if (!networkSupport.supported) {
    return result('unsupported_network', networkSupport.reason);
  }

  if (accepted.scheme !== context.quote.scheme) {
    return result(
      'requirement_mismatch',
      `payload scheme "${accepted.scheme}" does not match quote scheme "${context.quote.scheme}"`
    );
  }

  const quoteIdInPayload = accepted.extra?.['quote_id'];
  if (quoteIdInPayload !== context.quote.quote_id) {
    return result(
      'quote_mismatch',
      `payload accepted.extra.quote_id "${String(quoteIdInPayload)}" does not match expected quote "${context.quote.quote_id}"`
    );
  }

  if (payload.resource?.url !== undefined && payload.resource.url !== context.resource_id) {
    return result(
      'resource_mismatch',
      `payload resource.url "${payload.resource.url}" does not match expected resource "${context.resource_id}"`
    );
  }

  if (isQuoteExpired(context.quote, context.now_iso)) {
    return result(
      'expired',
      `quote ${context.quote.quote_id} expired at ${context.quote.expires_at}`
    );
  }

  if (context.quote.scheme === 'exact') {
    const binding = validateExactRequirementBinding(accepted, context.quote, context.now_iso);
    if (!binding.valid) {
      if (binding.failures.includes('quote_expired')) {
        return result('expired', binding.failures.join(','));
      }
      return result('requirement_mismatch', binding.failures.join(','));
    }
  }
  // 'upto' binding validation is a later checkpoint (directive §9) — this
  // checkpoint's quote/requirement layer only builds and validates
  // `exact`.

  return result('valid_structure');
}
