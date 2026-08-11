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
