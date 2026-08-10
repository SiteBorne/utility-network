/**
 * Canonical serialization/hashing for payment-domain artifacts (quotes,
 * payment requirements) — reuses @siteborne/verification's own
 * canonicalize()/contentHash() (RFC 8785-style JCS) rather than a second
 * canonical-JSON implementation. Deterministic hash, key-order
 * independent.
 */
import { canonicalize, contentHash } from '@siteborne/verification';

export { canonicalize, contentHash };

/** Canonically hashes any JSON-serializable payment-domain object. Two
 * structurally identical objects (regardless of key insertion order)
 * always produce the same hash; mutating any bound field changes it. */
export async function hashPaymentObject(value: unknown): Promise<string> {
  return contentHash(canonicalize(value));
}
