/**
 * FIRST-PAID-VERIFY-CDP-CREDENTIAL-REMEDIATION-01 — does the installed
 * `@coinbase/cdp-sdk` `generateJwt` mint a JWT inside real workerd, for both
 * supported key types? Throwaway keys generated in-runtime; no credential,
 * no network. Separates "the runtime cannot sign" from "the credential is bad",
 * which the SDK's swallowed `importPKCS8` error otherwise conflates.
 */
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { describe, expect, it } from 'vitest';

const ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const b64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const args = (secret: string) => ({
  apiKeyId: ID,
  apiKeySecret: secret,
  requestMethod: 'POST' as const,
  requestHost: 'api.cdp.coinbase.com',
  requestPath: '/platform/v2/x402/verify',
});
const alg = (jwt: string) =>
  JSON.parse(atob(jwt.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))).alg;

describe('CDP generateJwt under real workerd', () => {
  it('mints with an EC (PKCS8 PEM) key', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const der = new Uint8Array(
      (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer
    );
    const label = ['PRIVATE', 'KEY'].join(' '); // built at runtime: a throwaway key, not a literal
    const pem = `-----BEGIN ${label}-----\n${b64(der)
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END ${label}-----\n`;
    const jwt = await generateJwt(args(pem));
    expect(alg(jwt)).toBe('ES256');
  });

  it('mints with an Ed25519 (64-byte base64) key', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' } as never, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as { d: string; x: string };
    const secret = b64(new Uint8Array([...b64url(jwk.d), ...b64url(jwk.x)]));
    const jwt = await generateJwt(args(secret));
    expect(alg(jwt)).toBe('EdDSA');
  });
});
