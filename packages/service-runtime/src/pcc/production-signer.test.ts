/**
 * SUN-1214 checkpoint T — dedicated production paid-receipt signer.
 *
 * Distinct from `test-signer.ts`'s `createFixtureSigner`: this module
 * turns real key material (destined to arrive as a Cloudflare secret,
 * never provisioned by this checkpoint) into the same `{signer,
 * registry}` shape, using the repository's existing Ed25519
 * `signBytes`/`verifyBytes` primitives unchanged -- no new cryptographic
 * format, no repurposed Agent Card key, no fixture fallback.
 */
import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { signBytes, verifyBytes } from '@siteborne/verification';
import { buildProductionSigner, ProductionSignerConfigurationError } from './production-signer';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const VALID_KEY_ID = 'kid_prod0123456789abcdefghij';

describe('buildProductionSigner', () => {
  it('round-trips a real Ed25519 keypair through the existing sign/verify primitives', async () => {
    const privateKey = ed.utils.randomPrivateKey();
    const expectedPublicKey = await ed.getPublicKeyAsync(privateKey);

    const { signer, registry } = await buildProductionSigner(toHex(privateKey), VALID_KEY_ID);

    expect(signer.keyId).toBe(VALID_KEY_ID);

    const message = new TextEncoder().encode('sun-1214-known-vector');
    const signature = await signBytes(message, signer.privateKey);
    const verified = await verifyBytes(signature, message, expectedPublicKey);
    expect(verified).toBe(true);

    const record = registry.get(VALID_KEY_ID);
    expect(record).toBeDefined();
    expect(record?.environment).toBe('production');
    expect(record?.purpose).toBe('paid_service_receipt');
    expect(record?.algorithm).toBe('Ed25519');
    expect(record?.status).toBe('active');
    expect(toHex(record?.public_key ?? new Uint8Array())).toBe(toHex(expectedPublicKey));
  });

  it('fails closed on an empty private key', async () => {
    await expect(buildProductionSigner('', VALID_KEY_ID)).rejects.toBeInstanceOf(
      ProductionSignerConfigurationError
    );
  });

  it('fails closed on a wrong-length private key', async () => {
    const shortKey = toHex(ed.utils.randomPrivateKey().slice(0, 16));
    await expect(buildProductionSigner(shortKey, VALID_KEY_ID)).rejects.toBeInstanceOf(
      ProductionSignerConfigurationError
    );
  });

  it('fails closed on malformed (non-hex) key material', async () => {
    await expect(buildProductionSigner('not-hex-at-all-zzzz', VALID_KEY_ID)).rejects.toBeInstanceOf(
      ProductionSignerConfigurationError
    );
  });

  it('fails closed on a key ID that does not match the frozen kid_ pattern', async () => {
    const privateKey = toHex(ed.utils.randomPrivateKey());
    await expect(buildProductionSigner(privateKey, 'not-a-valid-key-id')).rejects.toBeInstanceOf(
      ProductionSignerConfigurationError
    );
  });

  it('never imports the fixture signer -- checks import statements only, not prose', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(import.meta.dirname, 'production-signer.ts'), 'utf-8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    expect(importLines).not.toMatch(/test-signer/);
    expect(importLines).not.toMatch(/createFixtureSigner/);
    expect(importLines).not.toMatch(/generateTestKeypair/);
  });
});
