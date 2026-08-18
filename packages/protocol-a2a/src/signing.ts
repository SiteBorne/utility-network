import { generateAgentCardSignature, verifyAgentCardSignature, type AgentCard } from '@a2a-js/sdk';
import { SITEBORNE_A2A_JWKS_URL } from './constants';

export const LOCAL_A2A_SIGNING_KEY_ID = 'siteborne-a2a-local-es256-v1';

export interface PublicJwk extends JsonWebKey {
  alg: 'ES256';
  kid: string;
  use: 'sig';
}

export interface SiteborneA2aSigningIdentity {
  /** Public keys only. The runtime private key remains inside the signer closure. */
  readonly jwks: Readonly<{ keys: readonly PublicJwk[] }>;
  sign(card: AgentCard): Promise<AgentCard>;
  verify(card: AgentCard): Promise<void>;
  resolvePublicKey(kid: string, jku?: string): Promise<CryptoKey>;
}

export interface PublicJwks {
  readonly keys: readonly PublicJwk[];
}

/**
 * Verifies a fetched Agent Card against an already-trusted, locally supplied
 * JWKS. This helper never follows `jku`; it requires the protected URL to match
 * the configured trusted URL and selects the matching public `kid` locally.
 */
export async function verifyAgentCardAgainstTrustedJwks(
  card: AgentCard,
  jwks: PublicJwks,
  trustedJwksUrl = SITEBORNE_A2A_JWKS_URL
): Promise<void> {
  const verify = verifyAgentCardSignature(async (kid, jku) => {
    if (jku !== trustedJwksUrl) throw new Error('untrusted Agent Card JWKS URL');
    const key = jwks.keys.find((candidate) => candidate.kid === kid);
    if (!key || key.use !== 'sig' || key.alg !== 'ES256') {
      throw new Error('untrusted Agent Card signing key');
    }
    return crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ]);
  });
  await verify(card);
}

/**
 * Creates an ephemeral local/test signing identity. This is deliberately not a
 * production key-loading mechanism: the private key is generated in memory,
 * never exported, and never returned by this API.
 */
export async function createLocalA2aSigningIdentity(): Promise<SiteborneA2aSigningIdentity> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const exportedPublicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const publicJwk: PublicJwk = {
    ...exportedPublicKey,
    alg: 'ES256',
    kid: LOCAL_A2A_SIGNING_KEY_ID,
    use: 'sig',
  };
  const jwks = Object.freeze({ keys: Object.freeze([Object.freeze(publicJwk)]) });

  async function resolvePublicKey(kid: string, jku?: string): Promise<CryptoKey> {
    if (kid !== LOCAL_A2A_SIGNING_KEY_ID || jku !== SITEBORNE_A2A_JWKS_URL) {
      throw new Error('untrusted Agent Card signing key');
    }
    return keyPair.publicKey;
  }

  const sign = generateAgentCardSignature(keyPair.privateKey, {
    alg: 'ES256',
    kid: LOCAL_A2A_SIGNING_KEY_ID,
    typ: 'JOSE',
    jku: SITEBORNE_A2A_JWKS_URL,
  });
  const verify = verifyAgentCardSignature(resolvePublicKey);

  return { jwks, sign, verify, resolvePublicKey };
}

/** A private ES256 JWK, structurally validated by
 * {@link createConfiguredA2aSigningIdentity} before use. Never logged. */
export interface PrivateEs256Jwk extends JsonWebKey {
  kty: 'EC';
  crv: 'P-256';
  /** The private scalar. Presence is what makes this a private key. */
  d: string;
}

/** Thrown when configured key material fails structural validation. Never
 * includes the key value itself. */
export class InvalidAgentCardSigningKeyError extends Error {
  constructor(reason: string) {
    super(`invalid Agent Card signing key configuration: ${reason}`);
    this.name = 'InvalidAgentCardSigningKeyError';
  }
}

/**
 * Creates a signing identity from EXTERNALLY SUPPLIED key material (SUN-1000
 * checkpoint SUN-0800B-2 -- production signing architecture). This package
 * never reads environment variables, files, or secret stores itself: the
 * caller (edge-api) is responsible for resolving `privateKeyJwk` from real
 * deployment secret configuration and passing it here already-parsed. The
 * private key material is imported into a non-extractable `CryptoKey`
 * immediately and never re-exported, logged, or returned by this function --
 * only the derived PUBLIC key ever leaves this function, via `.jwks`.
 *
 * `keyId` is the caller's own stable, versioned identifier (e.g.
 * `siteborne-a2a-es256-2026-01`) -- distinct from the ephemeral local
 * identity's hardcoded `LOCAL_A2A_SIGNING_KEY_ID`, so a real deployment can
 * rotate keys by minting a new `kid` without colliding with the dev/test
 * identity.
 *
 * Fails closed (throws {@link InvalidAgentCardSigningKeyError}) on any
 * structurally invalid input -- wrong `kty`/`crv`, missing the private `d`
 * parameter, or a key `crypto.subtle` itself rejects as malformed -- rather
 * than silently falling back to an ephemeral key or a degraded state.
 */
export async function createConfiguredA2aSigningIdentity(options: {
  privateKeyJwk: PrivateEs256Jwk;
  keyId: string;
  jwksUrl?: string;
}): Promise<SiteborneA2aSigningIdentity> {
  const { privateKeyJwk, keyId } = options;
  const jwksUrl = options.jwksUrl ?? SITEBORNE_A2A_JWKS_URL;
  if (!keyId || keyId.trim().length === 0) {
    throw new InvalidAgentCardSigningKeyError('keyId must be a non-empty string');
  }
  if (privateKeyJwk?.kty !== 'EC' || privateKeyJwk?.crv !== 'P-256') {
    throw new InvalidAgentCardSigningKeyError('expected an EC P-256 (ES256) key');
  }
  if (typeof privateKeyJwk.d !== 'string' || privateKeyJwk.d.length === 0) {
    throw new InvalidAgentCardSigningKeyError(
      'missing private key material (the "d" parameter) -- a public-only JWK cannot sign'
    );
  }

  // This function always signs with ES256 (WebCrypto's own `algorithm`
  // parameter below is authoritative), regardless of what the input JWK's
  // own `alg` member claims -- a foreign `alg` value would otherwise be
  // rejected by `crypto.subtle.importKey` as a mismatch even though the
  // key's actual curve (already validated above) is what determines the
  // real algorithm.
  const privateKeyImportFields: JsonWebKey = { ...privateKeyJwk };
  delete privateKeyImportFields.alg;

  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      'jwk',
      privateKeyImportFields,
      { name: 'ECDSA', namedCurve: 'P-256' },
      // Non-extractable: once imported, the private scalar can never be
      // read back out of this CryptoKey by any code in this process.
      false,
      ['sign']
    );
  } catch (error) {
    throw new InvalidAgentCardSigningKeyError(
      `the key material was rejected by the platform's own key-import validation: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }

  // Derive the public key independently from the same JWK (never from the
  // imported private CryptoKey, which is intentionally non-extractable) --
  // strip the private `d` parameter and any other private-only members
  // before this ever leaves the function. Only the standard EC public
  // components (kty/crv/x/y) are used for the internal re-import: the
  // source JWK's own `key_ops`/`alg`/`ext` (typically `key_ops: ["sign"]`
  // and possibly a foreign `alg` on an exported PRIVATE key) would
  // otherwise conflict with `crypto.subtle.importKey`'s own requested
  // usage/algorithm and be rejected as a "Key operations and usage
  // mismatch" or "alg does not match" error.
  const publicKeyComponents = {
    kty: privateKeyJwk.kty,
    crv: privateKeyJwk.crv,
    x: privateKeyJwk.x,
    y: privateKeyJwk.y,
  };
  const publicJwk: PublicJwk = {
    ...publicKeyComponents,
    alg: 'ES256',
    kid: keyId,
    use: 'sig',
  };
  const jwks = Object.freeze({ keys: Object.freeze([Object.freeze(publicJwk)]) });

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyComponents,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );

  async function resolvePublicKey(kid: string, jku?: string): Promise<CryptoKey> {
    if (kid !== keyId || jku !== jwksUrl) {
      throw new Error('untrusted Agent Card signing key');
    }
    return publicKey;
  }

  const sign = generateAgentCardSignature(privateKey, {
    alg: 'ES256',
    kid: keyId,
    typ: 'JOSE',
    jku: jwksUrl,
  });
  const verify = verifyAgentCardSignature(resolvePublicKey);

  return { jwks, sign, verify, resolvePublicKey };
}
