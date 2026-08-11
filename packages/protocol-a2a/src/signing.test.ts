import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUnsignedSiteborneAgentCard } from './card';
import {
  LOCAL_A2A_SIGNING_KEY_ID,
  SITEBORNE_A2A_JWKS_URL,
  createLocalA2aSigningIdentity,
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
