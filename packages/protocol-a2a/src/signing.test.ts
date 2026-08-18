import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUnsignedSiteborneAgentCard } from './card';
import {
  LOCAL_A2A_SIGNING_KEY_ID,
  SITEBORNE_A2A_JWKS_URL,
  createLocalA2aSigningIdentity,
  createConfiguredA2aSigningIdentity,
  InvalidAgentCardSigningKeyError,
  type PrivateEs256Jwk,
} from './index';

afterEach(() => vi.restoreAllMocks());

function suppressSdkInvalidSignatureDebug() {
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
}

function reverseObjectOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectOrder);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reverseObjectOrder(child)])
  );
}

describe('SITEBORNE Agent Card JWS boundary', () => {
  it('signs with a runtime-only ES256 key and verifies through the trusted local JWKS resolver', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signedCard = await identity.sign(buildUnsignedSiteborneAgentCard());

    expect(signedCard.signatures).toHaveLength(1);
    expect(identity.jwks).toEqual({
      keys: [
        expect.objectContaining({
          alg: 'ES256',
          crv: 'P-256',
          kid: LOCAL_A2A_SIGNING_KEY_ID,
          kty: 'EC',
          use: 'sig',
        }),
      ],
    });
    expect(identity.jwks.keys[0]).not.toHaveProperty('d');

    await expect(identity.verify(signedCard)).resolves.toBeUndefined();
  });

  it('fails closed for tampering, an unknown key id, and an untrusted JKU', async () => {
    suppressSdkInvalidSignatureDebug();
    const identity = await createLocalA2aSigningIdentity();
    const signedCard = await identity.sign(buildUnsignedSiteborneAgentCard());
    const tamperedCard = structuredClone(signedCard);
    tamperedCard.description = 'tampered';

    await expect(identity.verify(tamperedCard)).rejects.toThrow();
    await expect(identity.resolvePublicKey('unknown-key', SITEBORNE_A2A_JWKS_URL)).rejects.toThrow(
      'untrusted Agent Card signing key'
    );
    await expect(
      identity.resolvePublicKey(LOCAL_A2A_SIGNING_KEY_ID, 'https://attacker.example/jwks.json')
    ).rejects.toThrow('untrusted Agent Card signing key');
  });

  it('rejects unsigned cards when SITEBORNE signature acceptance is required', async () => {
    const identity = await createLocalA2aSigningIdentity();
    await expect(identity.verify(buildUnsignedSiteborneAgentCard())).rejects.toThrow(
      'No signatures found'
    );
  });

  it('preserves verification across semantic property-order changes', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const reordered = reverseObjectOrder(signed) as typeof signed;

    await expect(identity.verify(reordered)).resolves.toBeUndefined();
  });

  it.each([
    [
      'content',
      (card: ReturnType<typeof buildUnsignedSiteborneAgentCard>) => (card.description += '!'),
    ],
    [
      'skill',
      (card: ReturnType<typeof buildUnsignedSiteborneAgentCard>) => (card.skills[0]!.id = 'wrong'),
    ],
    [
      'endpoint',
      (card: ReturnType<typeof buildUnsignedSiteborneAgentCard>) =>
        (card.supportedInterfaces[0]!.url = 'https://attacker.example/a2a'),
    ],
    [
      'payment capability',
      (card: ReturnType<typeof buildUnsignedSiteborneAgentCard>) =>
        (card.capabilities!.extensions[0]!.required = true),
    ],
    [
      'production status',
      (card: ReturnType<typeof buildUnsignedSiteborneAgentCard>) =>
        ((card.capabilities!.extensions[0]!.params as Record<string, unknown>).productionEnabled =
          true),
    ],
  ])('rejects a signed-card %s mutation', async (_label, mutate) => {
    suppressSdkInvalidSignatureDebug();
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const mutated = structuredClone(signed);
    mutate(mutated);

    await expect(identity.verify(mutated)).rejects.toThrow('No valid signatures');
  });

  it('rejects wrong public keys, malformed JWS, and signature mutation', async () => {
    suppressSdkInvalidSignatureDebug();
    const [identity, wrongIdentity] = await Promise.all([
      createLocalA2aSigningIdentity(),
      createLocalA2aSigningIdentity(),
    ]);
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const malformed = structuredClone(signed);
    malformed.signatures[0]!.protected = 'not-base64url';
    const signatureMutated = structuredClone(signed);
    signatureMutated.signatures[0]!.signature = `${signatureMutated.signatures[0]!.signature}A`;

    await expect(wrongIdentity.verify(signed)).rejects.toThrow('No valid signatures');
    await expect(identity.verify(malformed)).rejects.toThrow('No valid signatures');
    await expect(identity.verify(signatureMutated)).rejects.toThrow('No valid signatures');
  });
});

/**
 * SUN-0800B checkpoint 2 — production signing architecture. Every key pair
 * here is generated ephemerally inside this test run and never stored in
 * repository state, matching the checkpoint's own explicit requirement.
 */
describe('createConfiguredA2aSigningIdentity (production signing architecture)', () => {
  const CONFIGURED_KEY_ID = 'siteborne-a2a-es256-test-2026-01';

  async function generateTestPrivateJwk(): Promise<PrivateEs256Jwk> {
    const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const exported = (await crypto.subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey;
    return exported as PrivateEs256Jwk;
  }

  it('canonical Agent Card payload -> sign -> AgentCardSignature -> JWKS public key -> independent verification succeeds', async () => {
    const privateKeyJwk = await generateTestPrivateJwk();
    const identity = await createConfiguredA2aSigningIdentity({
      privateKeyJwk,
      keyId: CONFIGURED_KEY_ID,
    });

    expect(identity.jwks).toEqual({
      keys: [
        expect.objectContaining({
          alg: 'ES256',
          crv: 'P-256',
          kid: CONFIGURED_KEY_ID,
          kty: 'EC',
          use: 'sig',
        }),
      ],
    });
    // The private scalar must never appear in the derived public JWKS.
    expect(identity.jwks.keys[0]).not.toHaveProperty('d');

    const signedCard = await identity.sign(buildUnsignedSiteborneAgentCard());
    expect(signedCard.signatures).toHaveLength(1);
    const decodedHeader = JSON.parse(
      Buffer.from(signedCard.signatures[0]!.protected, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    expect(decodedHeader).toMatchObject({
      alg: 'ES256',
      typ: 'JOSE',
      kid: CONFIGURED_KEY_ID,
      jku: SITEBORNE_A2A_JWKS_URL,
    });

    await expect(identity.verify(signedCard)).resolves.toBeUndefined();
  });

  it('tamper negative control: a changed signed field fails verification', async () => {
    suppressSdkInvalidSignatureDebug();
    const privateKeyJwk = await generateTestPrivateJwk();
    const identity = await createConfiguredA2aSigningIdentity({
      privateKeyJwk,
      keyId: CONFIGURED_KEY_ID,
    });
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const tampered = structuredClone(signed);
    tampered.description = 'tampered';

    await expect(identity.verify(tampered)).rejects.toThrow();
  });

  it('wrong-key negative control: a different key pair cannot verify', async () => {
    suppressSdkInvalidSignatureDebug();
    const [privateKeyJwkA, privateKeyJwkB] = await Promise.all([
      generateTestPrivateJwk(),
      generateTestPrivateJwk(),
    ]);
    const identityA = await createConfiguredA2aSigningIdentity({
      privateKeyJwk: privateKeyJwkA,
      keyId: CONFIGURED_KEY_ID,
    });
    const identityB = await createConfiguredA2aSigningIdentity({
      privateKeyJwk: privateKeyJwkB,
      keyId: CONFIGURED_KEY_ID,
    });
    const signed = await identityA.sign(buildUnsignedSiteborneAgentCard());

    await expect(identityB.verify(signed)).rejects.toThrow('No valid signatures');
  });

  it('private JWK material never leaks into the public jwks, even under property-name collision attempts', async () => {
    const privateKeyJwk = await generateTestPrivateJwk();
    const identity = await createConfiguredA2aSigningIdentity({
      privateKeyJwk,
      keyId: CONFIGURED_KEY_ID,
    });
    expect(JSON.stringify(identity.jwks)).not.toContain(privateKeyJwk.d);
    expect(Object.keys(identity.jwks.keys[0]!)).not.toContain('d');
  });

  it.each([
    ['wrong kty', { kty: 'RSA' as const }],
    ['wrong curve', { crv: 'P-384' }],
    ['missing private d', { d: undefined }],
  ])('fails closed at construction for %s', async (_label, overrides) => {
    const base = await generateTestPrivateJwk();
    const malformed = { ...base, ...overrides } as PrivateEs256Jwk;
    await expect(
      createConfiguredA2aSigningIdentity({ privateKeyJwk: malformed, keyId: CONFIGURED_KEY_ID })
    ).rejects.toThrow(InvalidAgentCardSigningKeyError);
  });

  it('fails closed for an empty keyId', async () => {
    const privateKeyJwk = await generateTestPrivateJwk();
    await expect(createConfiguredA2aSigningIdentity({ privateKeyJwk, keyId: '' })).rejects.toThrow(
      InvalidAgentCardSigningKeyError
    );
  });

  it('unsupported alg: a JWK claiming a non-ES256 algorithm is still validated by kty/crv, not the alg field (which this function always overwrites to ES256)', async () => {
    const privateKeyJwk = await generateTestPrivateJwk();
    const identity = await createConfiguredA2aSigningIdentity({
      privateKeyJwk: { ...privateKeyJwk, alg: 'RS256' } as unknown as PrivateEs256Jwk,
      keyId: CONFIGURED_KEY_ID,
    });
    expect(identity.jwks.keys[0]!.alg).toBe('ES256');
  });

  it('resolvePublicKey rejects an unknown kid or untrusted jku (JWKS "missing key" / malformed protected header analogue)', async () => {
    const privateKeyJwk = await generateTestPrivateJwk();
    const identity = await createConfiguredA2aSigningIdentity({
      privateKeyJwk,
      keyId: CONFIGURED_KEY_ID,
    });
    await expect(identity.resolvePublicKey('unknown-kid', SITEBORNE_A2A_JWKS_URL)).rejects.toThrow(
      'untrusted Agent Card signing key'
    );
    await expect(
      identity.resolvePublicKey(CONFIGURED_KEY_ID, 'https://attacker.example/jwks.json')
    ).rejects.toThrow('untrusted Agent Card signing key');
  });
});
