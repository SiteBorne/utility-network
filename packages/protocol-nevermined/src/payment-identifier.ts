import { isValidPaymentId } from '@siteborne/protocol-x402';

/** Nevermined's opaque access token cannot carry the official x402 extension,
 * so the dedicated transport carries the same SITEBORNE logical identity in
 * this one explicit header. It is not a generic Idempotency-Key. */
export const PAYMENT_IDENTIFIER_HEADER = 'Payment-Identifier' as const;

export type NeverminedPaymentIdentifierResult =
  | { status: 'present'; id: string }
  | { status: 'missing' }
  | { status: 'malformed' };

export function parseNeverminedPaymentIdentifier(
  headerValue: string | undefined,
  _accessTokenMustNotBeUsed?: string
): NeverminedPaymentIdentifierResult {
  if (headerValue === undefined || headerValue.length === 0) return { status: 'missing' };
  return isValidPaymentId(headerValue)
    ? { status: 'present', id: headerValue }
    : { status: 'malformed' };
}

export function serializeNeverminedPaymentIdentifier(id: string): {
  name: typeof PAYMENT_IDENTIFIER_HEADER;
  value: string;
} {
  if (!isValidPaymentId(id)) throw new Error('invalid SITEBORNE Payment-Identifier');
  return { name: PAYMENT_IDENTIFIER_HEADER, value: id };
}
