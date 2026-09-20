/**
 * FIRST-PAID-VERIFY-JWT-RUNTIME-VS-BOUND-SECRET-DIAGNOSTIC-01 — pure,
 * enum-only shape classification of a CDP API key id / secret. Shared by the
 * offline operator validator and the Worker-side diagnostic so both report the
 * same vocabulary. Reads a value only to derive an enum; the value, its length,
 * prefix, suffix and any digest never leave these functions.
 */

export type IdShape = 'EMPTY' | 'UUID' | 'ORG_PATH' | 'OTHER';
export type SecretShape =
  | 'EMPTY'
  | 'PEM_MULTILINE'
  | 'PEM_ESCAPED_NEWLINES'
  | 'PEM_SINGLE_LINE'
  | 'BASE64_64_BYTES'
  | 'BASE64_OTHER_LENGTH'
  | 'OTHER';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_PATH = /^organizations\/[^/\s]+\/apiKeys\/[^/\s]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isQuoted(value: string): boolean {
  const t = value.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0];
}

export function classifyIdShape(id: string): IdShape {
  if (id.length === 0) return 'EMPTY';
  if (UUID.test(id)) return 'UUID';
  if (ORG_PATH.test(id)) return 'ORG_PATH';
  return 'OTHER';
}

export function classifySecretShape(secret: string): SecretShape {
  if (secret.length === 0) return 'EMPTY';
  if (secret.includes('-----BEGIN')) {
    if (/[\r\n]/.test(secret)) return 'PEM_MULTILINE';
    return secret.includes('\\n') ? 'PEM_ESCAPED_NEWLINES' : 'PEM_SINGLE_LINE';
  }
  if (BASE64.test(secret)) {
    return Buffer.from(secret, 'base64').length === 64 ? 'BASE64_64_BYTES' : 'BASE64_OTHER_LENGTH';
  }
  return 'OTHER';
}
