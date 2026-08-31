import type {
  ContinuationEnvelopeMetadata,
  ContinuationEnvelopeV1,
} from './types';

const AES_GCM = 'AES-GCM';
const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const AAD_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export interface SealInput {
  readonly payload: unknown;
  readonly metadata: ContinuationEnvelopeMetadata;
  readonly keyMaterial: CryptoKey;
  readonly keyId: string;
}

export type EnvelopeOpenErrorCode =
  | 'unsupported_version'
  | 'malformed_encoding'
  | 'decrypt_failed'
  | 'aad_mismatch';

export class EnvelopeOpenError extends Error {
  readonly code: EnvelopeOpenErrorCode;

  constructor(code: EnvelopeOpenErrorCode, message: string) {
    super(message);
    this.name = 'EnvelopeOpenError';
    this.code = code;
  }
}

export interface OpenInput {
  readonly envelope: ContinuationEnvelopeV1;
  readonly expectedMetadata: ContinuationEnvelopeMetadata;
  readonly keyMaterial: CryptoKey;
}

function validateMetadata(metadata: ContinuationEnvelopeMetadata): void {
  if (metadata === null || typeof metadata !== 'object') {
    throw new TypeError('Continuation envelope metadata is invalid');
  }

  const requiredStrings = [
    metadata.job_id,
    metadata.payment_identifier,
    metadata.service,
    metadata.network,
    metadata.asset,
    metadata.pay_to,
    metadata.amount_atomic,
  ];
  if (requiredStrings.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('Continuation envelope metadata is invalid');
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(metadata.amount_atomic)) {
    throw new TypeError('Continuation envelope metadata is invalid');
  }
  if (
    !Number.isSafeInteger(metadata.valid_before_unix) ||
    metadata.valid_before_unix < 0
  ) {
    throw new TypeError('Continuation envelope metadata is invalid');
  }
}

function canonicalAad(metadata: ContinuationEnvelopeMetadata): Uint8Array {
  validateMetadata(metadata);
  return new TextEncoder().encode(
    JSON.stringify({
      amount_atomic: metadata.amount_atomic,
      asset: metadata.asset,
      job_id: metadata.job_id,
      network: metadata.network,
      pay_to: metadata.pay_to,
      payment_identifier: metadata.payment_identifier,
      service: metadata.service,
      valid_before_unix: metadata.valid_before_unix,
    }),
  );
}

function hasAes256Usage(key: unknown, usage: KeyUsage): key is CryptoKey {
  if (key === null || typeof key !== 'object') return false;
  const candidate = key as Partial<CryptoKey>;
  const algorithm = candidate.algorithm as Partial<AesKeyAlgorithm> | undefined;
  return (
    candidate.type === 'secret' &&
    algorithm?.name === AES_GCM &&
    algorithm.length === AES_KEY_BITS &&
    Array.isArray(candidate.usages) &&
    candidate.usages.includes(usage)
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromStrictBase64(value: unknown): Uint8Array | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return undefined;
  }
  try {
    const decoded = Uint8Array.from(atob(value), (character) =>
      character.charCodeAt(0),
    );
    return toBase64(decoded) === value ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function aadFingerprint(aad: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', aad));
}

function serializePayload(payload: unknown): Uint8Array {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) {
      throw new TypeError('Continuation envelope payload is not JSON-serializable');
    }
    return new TextEncoder().encode(serialized);
  } catch {
    throw new TypeError('Continuation envelope payload is not JSON-serializable');
  }
}

export async function sealContinuationEnvelope(
  input: SealInput,
): Promise<ContinuationEnvelopeV1> {
  if (!hasAes256Usage(input?.keyMaterial, 'encrypt')) {
    throw new TypeError('Continuation envelope key must be AES-256-GCM');
  }
  if (typeof input.keyId !== 'string' || input.keyId.length === 0) {
    throw new TypeError('Continuation envelope key ID is invalid');
  }

  const aad = canonicalAad(input.metadata);
  const plaintext = serializePayload(input.payload);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: AES_GCM, iv, additionalData: aad },
      input.keyMaterial,
      plaintext,
    );
  } catch {
    throw new TypeError('Continuation envelope sealing failed');
  }

  return {
    v: 1,
    key_id: input.keyId,
    iv_b64: toBase64(iv),
    ciphertext_b64: toBase64(new Uint8Array(ciphertext)),
    aad_fingerprint: await aadFingerprint(aad),
  };
}

function parseEnvelope(envelope: ContinuationEnvelopeV1): {
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
} {
  if (envelope === null || typeof envelope !== 'object') {
    throw new EnvelopeOpenError(
      'malformed_encoding',
      'Continuation envelope encoding is malformed',
    );
  }
  if (envelope.v !== 1) {
    throw new EnvelopeOpenError(
      'unsupported_version',
      'Continuation envelope version is unsupported',
    );
  }

  const iv = fromStrictBase64(envelope.iv_b64);
  const ciphertext = fromStrictBase64(envelope.ciphertext_b64);
  if (
    typeof envelope.key_id !== 'string' ||
    envelope.key_id.length === 0 ||
    typeof envelope.aad_fingerprint !== 'string' ||
    !AAD_FINGERPRINT_PATTERN.test(envelope.aad_fingerprint) ||
    iv?.length !== GCM_IV_BYTES ||
    ciphertext === undefined ||
    ciphertext.length < GCM_TAG_BYTES
  ) {
    throw new EnvelopeOpenError(
      'malformed_encoding',
      'Continuation envelope encoding is malformed',
    );
  }

  return { iv, ciphertext };
}

export async function openContinuationEnvelope(input: OpenInput): Promise<unknown> {
  const { iv, ciphertext } = parseEnvelope(input?.envelope);
  let aad: Uint8Array;
  try {
    aad = canonicalAad(input.expectedMetadata);
  } catch {
    throw new EnvelopeOpenError(
      'aad_mismatch',
      'Continuation envelope associated data is invalid',
    );
  }

  if (!hasAes256Usage(input.keyMaterial, 'decrypt')) {
    throw new EnvelopeOpenError(
      'decrypt_failed',
      'Continuation envelope decryption failed',
    );
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: AES_GCM, iv, additionalData: aad },
      input.keyMaterial,
      ciphertext,
    );
  } catch {
    throw new EnvelopeOpenError(
      'decrypt_failed',
      'Continuation envelope decryption failed',
    );
  }

  if ((await aadFingerprint(aad)) !== input.envelope.aad_fingerprint) {
    throw new EnvelopeOpenError(
      'aad_mismatch',
      'Continuation envelope associated data does not match',
    );
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  } catch {
    throw new EnvelopeOpenError(
      'decrypt_failed',
      'Continuation envelope decryption failed',
    );
  }
}
