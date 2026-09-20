/**
 * FIRST-PAID-VERIFY-CDP-CREDENTIAL-REMEDIATION-01 — internal-only,
 * classification-only view of a failure while minting the CDP API JWT.
 *
 * `@coinbase/cdp-sdk`'s `generateJwt` is the only thing that touches the API
 * key secret. Its failures are plain `Error`/`UserInputValidationError`s that
 * differ only by message. This module reduces them to a finite enum. It never
 * returns, stores, or logs `Error.message`, `cause`, `stack`, or any input;
 * the message is only matched against fixed patterns of the installed SDK
 * (1.55.0) and discarded.
 *
 * Known SDK limitation, deliberately not papered over: `generateJwt` swallows
 * the underlying `importPKCS8` error while probing for an EC key, so a bad
 * PEM (escaped newlines, quotes, truncation) and a runtime that cannot import
 * a valid PEM are both reported as `cdp_key_format_invalid`. Only a run of the
 * same SDK against the operator's own key can tell those apart.
 */

export type CdpJwtSubreason =
  | 'cdp_key_id_missing'
  | 'cdp_key_secret_missing'
  | 'cdp_key_format_invalid'
  | 'cdp_key_parse_failed'
  | 'cdp_jwt_signing_failed'
  | 'cdp_jwt_unknown_failure';

export const CDP_JWT_SUBREASONS: readonly CdpJwtSubreason[] = [
  'cdp_key_id_missing',
  'cdp_key_secret_missing',
  'cdp_key_format_invalid',
  'cdp_key_parse_failed',
  'cdp_jwt_signing_failed',
  'cdp_jwt_unknown_failure',
];

function messageOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

/** Pure; never throws; returns only a member of {@link CdpJwtSubreason}. */
export function classifyCdpJwtFailure(error: unknown): CdpJwtSubreason {
  const message = messageOf(error);
  if (message === 'Key name is required') return 'cdp_key_id_missing';
  if (message === 'Private key is required') return 'cdp_key_secret_missing';
  if (
    message.startsWith('Invalid key format') ||
    /^Failed to generate Ed25519 JWT: Invalid Ed25519 key length/.test(message)
  ) {
    return 'cdp_key_format_invalid';
  }
  const wrapped = /^Failed to generate (?:EC|Ed25519) JWT: (.*)$/s.exec(message);
  if (wrapped) {
    // `importJWK`/`importPKCS8` rejections mean the bytes are the right shape
    // but not a usable key; anything else came from `SignJWT.sign`.
    return /Invalid keyData|Invalid or unsupported|Invalid key|JWK|keyData|PKCS8|pkcs8/.test(
      wrapped[1] ?? ''
    )
      ? 'cdp_key_parse_failed'
      : 'cdp_jwt_signing_failed';
  }
  return 'cdp_jwt_unknown_failure';
}
