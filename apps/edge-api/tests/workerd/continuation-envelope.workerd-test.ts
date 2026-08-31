import { describe, expect, it } from 'vitest';
import {
  EnvelopeOpenError,
  openContinuationEnvelope,
  sealContinuationEnvelope,
} from '../../src/control-plane/continuation/envelope';
import type { ContinuationEnvelopeMetadata } from '../../src/control-plane/continuation/types';

const METADATA: ContinuationEnvelopeMetadata = {
  job_id: 'job_workerd',
  payment_identifier: 'pay_workerd',
  service: 'web_context_verified.v2',
  network: 'eip155:8453',
  asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  pay_to: '0x7f44a2dd237938f18632d4cca40f4c690295e6e1',
  amount_atomic: '9000',
  valid_before_unix: 2_000_000_000,
};

describe('continuation envelope under real workerd WebCrypto', () => {
  it('seals and opens AES-256-GCM payloads inside the Worker runtime', async () => {
    const key = (await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )) as CryptoKey;
    const payload = { signature: 'local-workerd-test-signature' };

    const envelope = await sealContinuationEnvelope({
      payload,
      metadata: METADATA,
      keyMaterial: key,
      keyId: 'test-k1',
    });

    expect(envelope.v).toBe(1);
    expect(envelope.iv_b64).not.toContain(payload.signature);
    expect(envelope.ciphertext_b64).not.toContain(payload.signature);
    await expect(
      openContinuationEnvelope({
        envelope,
        expectedMetadata: METADATA,
        keyMaterial: key,
      }),
    ).resolves.toEqual(payload);
  });

  it('rejects AAD substitution inside the Worker runtime', async () => {
    const key = (await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )) as CryptoKey;
    const envelope = await sealContinuationEnvelope({
      payload: { signature: 'local-workerd-test-signature' },
      metadata: METADATA,
      keyMaterial: key,
      keyId: 'test-k1',
    });

    try {
      await openContinuationEnvelope({
        envelope,
        expectedMetadata: { ...METADATA, amount_atomic: '9001' },
        keyMaterial: key,
      });
      throw new Error('expected AAD substitution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeOpenError);
      expect((error as EnvelopeOpenError).code).toBe('decrypt_failed');
    }
  });
});
