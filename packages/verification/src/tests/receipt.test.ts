import { describe, expect, it, beforeAll } from 'vitest';
import { generateTestKeypair, signBytes, verifyBytes } from '../receipt/signer';
import { KeyRegistry, type KeyRecord } from '../receipt/key-registry';
import { verifyReceipt } from '../receipt/verifier';
import { issueReceipt } from '../receipt/issue';
import { buildContext, createTestClock } from '../context';
import { runMesh } from '../mesh';
import { buildStandardVerifiers } from '../index';
import { validCandidate } from './fixtures';
import type { VerificationReceipt } from '../receipt/models';

const POLICY_HASH = 'sha256:' + '0'.repeat(64);

describe('Ed25519 signer', () => {
  it('signs and verifies a message', async () => {
    const { privateKey, publicKey } = await generateTestKeypair();
    const message = new TextEncoder().encode('hello receipt');
    const sig = await signBytes(message, privateKey);
    expect(await verifyBytes(sig, message, publicKey)).toBe(true);
  });

  it('rejects a signature verified against the wrong public key', async () => {
    const a = await generateTestKeypair('kid_a');
    const b = await generateTestKeypair('kid_b');
    const message = new TextEncoder().encode('hello receipt');
    const sig = await signBytes(message, a.privateKey);
    expect(await verifyBytes(sig, message, b.publicKey)).toBe(false);
  });

  it('never throws on malformed signature bytes — fails closed instead', async () => {
    const { publicKey } = await generateTestKeypair();
    const message = new TextEncoder().encode('hello');
    const garbage = new Uint8Array([1, 2, 3]);
    await expect(verifyBytes(garbage, message, publicKey)).resolves.toBe(false);
  });
});

describe('KeyRegistry', () => {
  function record(overrides: Partial<KeyRecord> = {}): KeyRecord {
    return {
      key_id: 'kid_test',
      algorithm: 'Ed25519',
      public_key: new Uint8Array(32),
      status: 'active',
      valid_from: '2026-01-01T00:00:00Z',
      purpose: 'verification_receipt',
      environment: 'test',
      ...overrides,
    };
  }

  it('rejects re-registering an already-used key_id', () => {
    const registry = new KeyRegistry();
    registry.register(record());
    expect(() => registry.register(record())).toThrowError(/already registered/);
  });

  it('lets a retired key still verify (canVerifyWith), but not a revoked one', () => {
    const registry = new KeyRegistry();
    registry.register(record());
    registry.retire('kid_test', '2026-02-01T00:00:00Z');
    expect(registry.canVerifyWith('kid_test')).toBe(true);
    registry.revoke('kid_test');
    expect(registry.canVerifyWith('kid_test')).toBe(false);
  });

  it('an unknown key_id cannot verify', () => {
    const registry = new KeyRegistry();
    expect(registry.canVerifyWith('kid_never_registered')).toBe(false);
  });
});

describe('issueReceipt + verifyReceipt (end-to-end and tamper-evidence)', () => {
  let receipt: VerificationReceipt;
  let registry: KeyRegistry;
  let signer: { keyId: string; privateKey: Uint8Array };

  beforeAll(async () => {
    const keypair = await generateTestKeypair('kid_receipt_test');
    registry = new KeyRegistry();
    registry.register({
      key_id: keypair.keyId,
      algorithm: 'Ed25519',
      public_key: keypair.publicKey,
      status: 'active',
      valid_from: '2026-01-01T00:00:00Z',
      purpose: 'verification_receipt',
      environment: 'test',
    });
    signer = { keyId: keypair.keyId, privateKey: keypair.privateKey };

    const context = buildContext({ clock: createTestClock(), mode: 'standard' });
    const verdict = await runMesh(buildStandardVerifiers(), validCandidate(), context, {
      policyHash: POLICY_HASH,
    });
    receipt = await issueReceipt(validCandidate(), context, verdict, signer);
  });

  it('produces a receipt that verifies as valid', async () => {
    const result = await verifyReceipt(receipt, registry);
    expect(result.status).toBe('valid');
  });

  it('detects a mutated decision field (tamper-evidence)', async () => {
    const tampered: VerificationReceipt = {
      ...receipt,
      decision: 'pass' === receipt.decision ? 'fail' : 'pass',
    };
    const result = await verifyReceipt(tampered, registry);
    expect(result.status).not.toBe('valid');
    expect(['receipt_id_mismatch', 'invalid_signature']).toContain(result.status);
  });

  it('detects a mutated output_hash (tamper-evidence)', async () => {
    const tampered: VerificationReceipt = { ...receipt, output_hash: 'sha256:' + 'f'.repeat(64) };
    const result = await verifyReceipt(tampered, registry);
    expect(result.status).not.toBe('valid');
  });

  it('detects a forged signature over otherwise-untouched fields', async () => {
    const tampered: VerificationReceipt = {
      ...receipt,
      signature: 'A'.repeat(receipt.signature.length),
    };
    const result = await verifyReceipt(tampered, registry);
    expect(result.status).not.toBe('valid');
  });

  it('rejects an unknown signing key', async () => {
    const tampered: VerificationReceipt = { ...receipt, signing_key_id: 'kid_never_registered' };
    const result = await verifyReceipt(tampered, registry);
    expect(result.status).toBe('unknown_key');
  });

  it('rejects a revoked signing key even with a valid signature', async () => {
    registry.revoke(signer.keyId);
    const result = await verifyReceipt(receipt, registry);
    expect(result.status).toBe('revoked_key');
  });

  it('rejects an unsupported signature algorithm without attempting verification', async () => {
    const tampered = {
      ...receipt,
      signature_algorithm: 'RSA-PSS',
    } as unknown as VerificationReceipt;
    const result = await verifyReceipt(tampered, registry);
    expect(result.status).toBe('unsupported_algorithm');
  });

  it('two receipts for the same verification material (including request_id) produce the same receipt_id', async () => {
    const context = buildContext({
      clock: createTestClock(),
      mode: 'standard',
      request_id: 'req_fixedforidentitytest',
    });
    const verdict = await runMesh(buildStandardVerifiers(), validCandidate(), context, {
      policyHash: POLICY_HASH,
    });
    const firstReceipt = await issueReceipt(validCandidate(), context, verdict, signer);
    const secondReceipt = await issueReceipt(validCandidate(), context, verdict, signer);
    expect(secondReceipt.receipt_id).toBe(firstReceipt.receipt_id);
  });

  it('rejects context_mismatch when the caller expects a different service_id', async () => {
    const freshRegistry = new KeyRegistry();
    freshRegistry.register({
      key_id: signer.keyId,
      algorithm: 'Ed25519',
      public_key: (await generateTestKeypair(signer.keyId)).publicKey, // wrong key on purpose is fine here; context check runs first
      status: 'active',
      valid_from: '2026-01-01T00:00:00Z',
      purpose: 'verification_receipt',
      environment: 'test',
    });
    const result = await verifyReceipt(receipt, freshRegistry, {
      service_id: 'not_the_real_service.v1',
    });
    expect(result.status).toBe('context_mismatch');
  });
});
