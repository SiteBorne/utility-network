import { describe, expect, it } from 'vitest';
import {
  EnvelopeOpenError,
  openContinuationEnvelope,
  sealContinuationEnvelope,
} from '../src/control-plane/continuation/envelope';
import type {
  ContinuationEnvelopeMetadata,
  ContinuationEnvelopeV1,
} from '../src/control-plane/continuation/types';

const SENSITIVE_SIGNATURE = '0xsensitive-eip3009-signature';

function metadata(): ContinuationEnvelopeMetadata {
  return {
    job_id: 'job_1',
    payment_identifier: 'pay_1',
    service: 'web_context_verified.v2',
    network: 'eip155:8453',
    asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    pay_to: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
    amount_atomic: '9000',
    valid_before_unix: 2_000_000_000,
  };
}

function payload(): Record<string, unknown> {
  return {
    authorization: {
      from: '0x516f57e1fb800cceb2e70c42607fb93e2abecb99',
      to: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
      value: '9000',
      validAfter: '0',
      validBefore: '2000000000',
      nonce: '0xnonce',
      signature: SENSITIVE_SIGNATURE,
    },
    requirements: {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '9000',
    },
  };
}

async function generateKey(length = 256): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length },
    false,
    ['encrypt', 'decrypt'],
  ) as Promise<CryptoKey>;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function flipFirstByte(value: string): string {
  const bytes = decodeBase64(value);
  bytes[0] ^= 0x01;
  return encodeBase64(bytes);
}

async function sealedFixture(): Promise<{
  readonly envelope: ContinuationEnvelopeV1;
  readonly key: CryptoKey;
}> {
  const key = await generateKey();
  const envelope = await sealContinuationEnvelope({
    payload: payload(),
    metadata: metadata(),
    keyMaterial: key,
    keyId: 'k1',
  });
  return { envelope, key };
}

async function expectOpenError(
  promise: Promise<unknown>,
  code: EnvelopeOpenError['code'],
): Promise<EnvelopeOpenError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EnvelopeOpenError);
    expect((error as EnvelopeOpenError).code).toBe(code);
    return error as EnvelopeOpenError;
  }
  throw new Error(`Expected EnvelopeOpenError(${code})`);
}

describe('continuation envelope V1 (SUN-1221E6R-H2AWI-1c crypto vectors)', () => {
  it('round-trips the signed payment payload with identical trusted metadata', async () => {
    const { envelope, key } = await sealedFixture();

    await expect(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
    ).resolves.toEqual(payload());
  });

  it('uses a fresh 12-byte IV for each seal under the same key', async () => {
    const key = await generateKey();
    const first = await sealContinuationEnvelope({
      payload: payload(),
      metadata: metadata(),
      keyMaterial: key,
      keyId: 'k1',
    });
    const second = await sealContinuationEnvelope({
      payload: payload(),
      metadata: metadata(),
      keyMaterial: key,
      keyId: 'k1',
    });

    expect(decodeBase64(first.iv_b64)).toHaveLength(12);
    expect(decodeBase64(second.iv_b64)).toHaveLength(12);
    expect(second.iv_b64).not.toBe(first.iv_b64);
    expect(second.ciphertext_b64).not.toBe(first.ciphertext_b64);
  });

  it('survives JSON envelope serialization without exposing the signed payload', async () => {
    const { envelope, key } = await sealedFixture();
    const serialized = JSON.stringify(envelope);
    const restored = JSON.parse(serialized) as ContinuationEnvelopeV1;

    expect(serialized).not.toContain(SENSITIVE_SIGNATURE);
    await expect(
      openContinuationEnvelope({
        envelope: restored,
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
    ).resolves.toEqual(payload());
  });

  it('rejects a different valid AES-256-GCM key as decrypt_failed', async () => {
    const { envelope } = await sealedFixture();

    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: metadata(),
        keyMaterial: await generateKey(),
      }),
      'decrypt_failed',
    );
  });

  it('rejects tampered ciphertext as decrypt_failed', async () => {
    const { envelope, key } = await sealedFixture();

    await expectOpenError(
      openContinuationEnvelope({
        envelope: {
          ...envelope,
          ciphertext_b64: flipFirstByte(envelope.ciphertext_b64),
        },
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('rejects ciphertext truncated below the GCM tag length as malformed_encoding', async () => {
    const { envelope, key } = await sealedFixture();

    await expectOpenError(
      openContinuationEnvelope({
        envelope: {
          ...envelope,
          ciphertext_b64: encodeBase64(new Uint8Array(15)),
        },
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'malformed_encoding',
    );
  });

  it('rejects a tampered IV as decrypt_failed', async () => {
    const { envelope, key } = await sealedFixture();

    await expectOpenError(
      openContinuationEnvelope({
        envelope: { ...envelope, iv_b64: flipFirstByte(envelope.iv_b64) },
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds job_id into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...metadata(), job_id: 'job_2' },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds payment_identifier into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...metadata(), payment_identifier: 'pay_2' },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds service into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...metadata(), service: 'verify_agent_output.v2' },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds network into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...metadata(), network: 'eip155:1' },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds asset into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: {
          ...metadata(),
          asset: '0x0000000000000000000000000000000000000001',
        },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds pay_to into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: {
          ...metadata(),
          pay_to: '0x0000000000000000000000000000000000000001',
        },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds amount_atomic into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...metadata(), amount_atomic: '9001' },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('binds valid_before_unix into authenticated associated data', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...metadata(), valid_before_unix: 2_000_000_001 },
        keyMaterial: key,
      }),
      'decrypt_failed',
    );
  });

  it('rejects an unsupported envelope version without attempting downgrade', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope: { ...envelope, v: 2 } as unknown as ContinuationEnvelopeV1,
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'unsupported_version',
    );
  });

  it('rejects non-base64 ciphertext as malformed_encoding', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope: { ...envelope, ciphertext_b64: '%%%not-base64%%%' },
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'malformed_encoding',
    );
  });

  it('rejects a wrong-length IV as malformed_encoding', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope: { ...envelope, iv_b64: encodeBase64(new Uint8Array(11)) },
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'malformed_encoding',
    );
  });

  it('rejects a missing key at seal time without serializing payload data into the error', async () => {
    const promise = sealContinuationEnvelope({
      payload: payload(),
      metadata: metadata(),
      // @ts-expect-error -- runtime guard must fail closed when JS bypasses the type system
      keyMaterial: undefined,
      keyId: 'k1',
    });

    await expect(promise).rejects.toThrow(TypeError);
    await expect(promise).rejects.not.toThrow(SENSITIVE_SIGNATURE);
  });

  it('rejects an AES-128-GCM key at seal time', async () => {
    await expect(
      sealContinuationEnvelope({
        payload: payload(),
        metadata: metadata(),
        keyMaterial: await generateKey(128),
        keyId: 'k1',
      }),
    ).rejects.toThrow(TypeError);
  });

  it('rejects a missing key at open time as a redacted decrypt_failed error', async () => {
    const { envelope } = await sealedFixture();
    const error = await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: metadata(),
        // @ts-expect-error -- runtime guard must fail closed when JS bypasses the type system
        keyMaterial: undefined,
      }),
      'decrypt_failed',
    );

    expect(error.message).not.toContain(SENSITIVE_SIGNATURE);
    expect(error.message).not.toContain(envelope.ciphertext_b64);
  });

  it('rejects an AES-128-GCM key at open time as decrypt_failed', async () => {
    const { envelope } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: metadata(),
        keyMaterial: await generateKey(128),
      }),
      'decrypt_failed',
    );
  });

  it('rejects malformed clear metadata at seal time', async () => {
    await expect(
      sealContinuationEnvelope({
        payload: payload(),
        metadata: { ...metadata(), job_id: '' },
        keyMaterial: await generateKey(),
        keyId: 'k1',
      }),
    ).rejects.toThrow(TypeError);
  });

  it('rejects malformed expected metadata at open time as aad_mismatch', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...metadata(), amount_atomic: '' },
        keyMaterial: key,
      }),
      'aad_mismatch',
    );
  });

  it('rejects an empty key_id as malformed_encoding', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope: { ...envelope, key_id: '' },
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'malformed_encoding',
    );
  });

  it('rejects a tampered AAD fingerprint as aad_mismatch after authenticated decrypt', async () => {
    const { envelope, key } = await sealedFixture();
    await expectOpenError(
      openContinuationEnvelope({
        envelope: { ...envelope, aad_fingerprint: '0'.repeat(64) },
        expectedMetadata: metadata(),
        keyMaterial: key,
      }),
      'aad_mismatch',
    );
  });

  it('uses only static redacted text for cryptographic authentication failures', async () => {
    const { envelope } = await sealedFixture();
    const error = await expectOpenError(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: metadata(),
        keyMaterial: await generateKey(),
      }),
      'decrypt_failed',
    );

    expect(error.message).toBe('Continuation envelope decryption failed');
    expect(error.message).not.toContain(SENSITIVE_SIGNATURE);
    expect(error.message).not.toContain(envelope.iv_b64);
    expect(error.message).not.toContain(envelope.ciphertext_b64);
  });
});
