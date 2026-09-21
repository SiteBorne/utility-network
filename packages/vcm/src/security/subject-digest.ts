/**
 * SECURITY-AUTHORITY-SA1-RESULT-CONTENT-DIGEST-DESIGN-01 -- SubjectDigest v1.
 *
 * SHADOW / LOCAL PRIMITIVE ONLY. Nothing outside the SA-1 files imports this
 * module. It turns a subject value into the keyed pseudonymous digest that
 * `ResultAuthorizationEnvelopeV1` subject slots carry. A digest is evidence of
 * "the same subject as before"; it is never identity, trust, or permission.
 *
 * Construction: HMAC-SHA-256 (standard Web Crypto; no novel cryptography) over
 * the UTF-8 bytes of the governed (JCS-style) canonical form of
 *   { domain, key_version, subject_type, value }.
 * Canonical JSON is injective over these fields, so the subject type and key
 * version are bound into the MAC input and one type's digest can never be
 * relabelled as another's. Output: 64 lowercase hex characters.
 *
 * Keys: this module NEVER reads a secret, environment, or binding, and holds
 * no key. The caller supplies an already-imported non-extractable-capable
 * HMAC `CryptoKey` plus its version label. Real key provisioning does not exist
 * in Release 1 and is an enforcement prerequisite (see the design report). No
 * key is hard-coded anywhere.
 *
 * Digests are comparable only within one key version. Rotation therefore means
 * recomputing a candidate under the stored version's key; the resolver that
 * supplies old keys is a future prerequisite and is not modelled here.
 *
 * Raw subject values are never returned, logged, or included in errors: every
 * failure is a typed error carrying only a code.
 */
import { canonicalize } from '../canonical';

export const SUBJECT_DIGEST_VERSION = 'subject_digest.v1' as const;
export const SUBJECT_DIGEST_DOMAIN = 'siteborne.subject_digest.v1' as const;

/** Mirrors the envelope's SUBJECT_AXES (asserted equal by a drift-guard test). */
export const SUBJECT_DIGEST_TYPES = [
  'payer_subject',
  'authenticated_caller_subject',
  'request_signer_subject',
] as const;
export type SubjectDigestType = (typeof SUBJECT_DIGEST_TYPES)[number];

export const SUBJECT_DIGEST_ERROR_CODES = [
  'SUBJECT_TYPE_UNSUPPORTED',
  'SUBJECT_VALUE_MALFORMED',
  'SUBJECT_VALUE_WALLET_SHAPED_FOR_NON_PAYER',
  'SUBJECT_VALUE_SECRET_SHAPED',
  'SUBJECT_KEY_VERSION_MALFORMED',
  'SUBJECT_KEY_INVALID',
  'SUBJECT_DIGEST_COMPUTATION_FAILED',
] as const;
export type SubjectDigestErrorCode = (typeof SUBJECT_DIGEST_ERROR_CODES)[number];

export class SubjectDigestError extends Error {
  readonly code: SubjectDigestErrorCode;
  constructor(code: SubjectDigestErrorCode) {
    // Code only: the subject value and key material are never echoed.
    super(code);
    this.name = 'SubjectDigestError';
    this.code = code;
  }
}

/** Same shape the envelope validates for `digest_key_version`. */
const KEY_VERSION = /^[a-z0-9][a-z0-9._-]{0,31}$/;
/** Minimum HMAC key length in bits. */
export const SUBJECT_DIGEST_MIN_KEY_BITS = 256;

export interface SubjectDigestKey {
  readonly version: string;
  /** An imported HMAC/SHA-256 secret key with the `sign` usage. */
  readonly key: CryptoKey;
}

export interface SubjectDigestResult {
  /** 64 lowercase hex. The only subject-derived output. */
  readonly subject_digest: string;
  readonly digest_key_version: string;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** 32-byte hex: shaped like a private key, a transaction hash, or a digest. */
const HEX32 = /^(?:0x)?[0-9a-fA-F]{64}$/;
/** JWT-shaped credential: `eyJ...` header, dot-separated segments. */
const JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
/** Opaque principal / signer identifier. Same shape as the envelope's ids. */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Per-type canonical value. Defense in depth only: the shape checks cannot
 * distinguish an identifier from a credential of identifier-like shape, so
 * whatever supplies a subject MUST supply a principal identifier and never a
 * credential.
 *
 * - payer_subject: an EVM wallet address, lowercased (case is not identity).
 * - authenticated_caller_subject / request_signer_subject: an opaque identifier
 *   exactly as issued (no case folding, no Unicode normalization). A wallet-
 *   shaped value is refused: wallet identity is NOT caller identity.
 * - all types: 32-byte-hex and JWT-shaped values are refused as secret-shaped.
 */
function canonicalSubjectValue(type: SubjectDigestType, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SubjectDigestError('SUBJECT_VALUE_MALFORMED');
  }
  if (HEX32.test(value) || JWT.test(value)) {
    throw new SubjectDigestError('SUBJECT_VALUE_SECRET_SHAPED');
  }
  if (type === 'payer_subject') {
    if (!EVM_ADDRESS.test(value)) throw new SubjectDigestError('SUBJECT_VALUE_MALFORMED');
    return value.toLowerCase();
  }
  if (EVM_ADDRESS.test(value)) {
    throw new SubjectDigestError('SUBJECT_VALUE_WALLET_SHAPED_FOR_NON_PAYER');
  }
  if (!OPAQUE_ID.test(value)) throw new SubjectDigestError('SUBJECT_VALUE_MALFORMED');
  return value;
}

interface HmacLikeKeyAlgorithm {
  readonly name?: unknown;
  readonly length?: unknown;
  readonly hash?: { readonly name?: unknown };
}

function assertUsableKey(keyRef: SubjectDigestKey): void {
  if (typeof keyRef.version !== 'string' || !KEY_VERSION.test(keyRef.version)) {
    throw new SubjectDigestError('SUBJECT_KEY_VERSION_MALFORMED');
  }
  const key = keyRef.key as CryptoKey | undefined;
  const algorithm = key?.algorithm as HmacLikeKeyAlgorithm | undefined;
  if (
    !key ||
    key.type !== 'secret' ||
    algorithm?.name !== 'HMAC' ||
    algorithm.hash?.name !== 'SHA-256' ||
    typeof algorithm.length !== 'number' ||
    algorithm.length < SUBJECT_DIGEST_MIN_KEY_BITS ||
    !key.usages.includes('sign')
  ) {
    throw new SubjectDigestError('SUBJECT_KEY_INVALID');
  }
}

function toHex(bytes: ArrayBuffer): string {
  let out = '';
  for (const b of new Uint8Array(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Deterministic for a fixed (type, canonical value, key, key version).
 * Changing the value, the type, the key, or the key version changes the digest.
 */
export async function computeSubjectDigest(
  type: SubjectDigestType,
  value: unknown,
  keyRef: SubjectDigestKey
): Promise<SubjectDigestResult> {
  if (!(SUBJECT_DIGEST_TYPES as readonly string[]).includes(type)) {
    throw new SubjectDigestError('SUBJECT_TYPE_UNSUPPORTED');
  }
  assertUsableKey(keyRef);
  const canonicalValue = canonicalSubjectValue(type, value);

  const message = new TextEncoder().encode(
    canonicalize({
      domain: SUBJECT_DIGEST_DOMAIN,
      key_version: keyRef.version,
      subject_type: type,
      value: canonicalValue,
    })
  );
  let mac: ArrayBuffer;
  try {
    mac = await crypto.subtle.sign('HMAC', keyRef.key, message);
  } catch {
    throw new SubjectDigestError('SUBJECT_DIGEST_COMPUTATION_FAILED');
  }
  return { subject_digest: toHex(mac), digest_key_version: keyRef.version };
}
