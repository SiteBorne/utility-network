/**
 * The shared receipt-verification boundary's own closed-failure-mode
 * coverage — every case must fail closed, and no cryptographic exception
 * may escape as an ordinary caller error.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  KeyRegistry,
  generateTestKeypair,
  type VerificationReceipt,
  type Signer,
} from '@siteborne/verification';
import { verifyServiceReceipt } from './receipt-verification';
import { buildDraftDocument, defaultProvenance } from './builder';
import { verifyAndSign } from './verify-and-sign';
import { deterministicId } from './ids';
import { createFixtureSigner } from './test-signer';
import { buildServiceContext } from '../context';

async function buildSampleReceipt(
  signer: Signer,
  keyRegistry: KeyRegistry
): Promise<VerificationReceipt> {
  const context = buildServiceContext('web_context_verified.v1');
  const draft = buildDraftDocument({
    seed: 'receipt-verification-test',
    serviceId: 'web_context_verified.v1',
    serviceVersion: 'v1',
    inputHash: 'sha256:' + '1'.repeat(64),
    inputSchemaHash: 'sha256:' + '2'.repeat(64),
    outputSchemaHash: 'sha256:' + '3'.repeat(64),
    contractMode: 'offline_verification',
    freshnessSeconds: 3600,
    issuedAtIso: new Date(context.clock.nowMs()).toISOString(),
    expiresAtIso: new Date(context.clock.nowMs() + 3_600_000).toISOString(),
    subject: { type: 'webpage', canonical_name: 'https://acme.example/' },
    claims: [],
    evidence: [],
    completeness: {
      requested_fields: 0,
      populated_fields: 0,
      supported_fields: 0,
      score: 1,
      missing_fields: [],
      unsupported_fields: [],
      stale_fields: [],
      vector: [],
    },
    provenance: defaultProvenance('test', '0.1.0'),
    extensionKey: 'net.siteborne.web-context.v1',
    extensionPayload: {},
  });
  const signed = await verifyAndSign({ draft, context, signer, keyRegistry });
  return signed.receipt;
}

describe('verifyServiceReceipt — closed failure modes', () => {
  let signer: Signer;
  let registry: KeyRegistry;
  let receipt: VerificationReceipt;

  beforeAll(async () => {
    ({ signer, registry } = await createFixtureSigner());
    receipt = await buildSampleReceipt(signer, registry);
  });

  it('a genuinely valid receipt verifies', async () => {
    const result = await verifyServiceReceipt({
      receipt,
      keyRegistry: registry,
      expectedServiceId: 'web_context_verified.v1',
    });
    expect(result.valid).toBe(true);
  });

  it('an invalid signature fails closed', async () => {
    const tampered = { ...receipt, signature: 'A'.repeat(receipt.signature.length) };
    const result = await verifyServiceReceipt({ receipt: tampered, keyRegistry: registry });
    expect(result.valid).toBe(false);
  });

  it('an altered signed payload field fails closed', async () => {
    const tampered = { ...receipt, evidence_hash: 'sha256:' + 'e'.repeat(64) };
    const result = await verifyServiceReceipt({ receipt: tampered, keyRegistry: registry });
    expect(result.valid).toBe(false);
  });

  it('an output_hash mismatch (against caller-expected value) fails closed', async () => {
    const result = await verifyServiceReceipt({
      receipt,
      keyRegistry: registry,
      expectedOutputHash: 'sha256:' + '0'.repeat(64),
    });
    expect(result.valid).toBe(false);
  });

  it('a wrong expected service_id fails closed', async () => {
    const result = await verifyServiceReceipt({
      receipt,
      keyRegistry: registry,
      expectedServiceId: 'company_evidence_graph.v1',
    });
    expect(result.valid).toBe(false);
  });

  it('a wrong expected contract_release fails closed', async () => {
    const result = await verifyServiceReceipt({
      receipt,
      keyRegistry: registry,
      expectedContractRelease: '9.9.9',
    });
    expect(result.valid).toBe(false);
  });

  it('an unknown signing key fails closed', async () => {
    const emptyRegistry = new KeyRegistry();
    const result = await verifyServiceReceipt({ receipt, keyRegistry: emptyRegistry });
    expect(result.valid).toBe(false);
    expect(result.status).toBe('unknown_key');
  });

  it('a revoked key fails closed even for a receipt it legitimately signed', async () => {
    const revocableRegistry = new KeyRegistry();
    const keypair = await generateTestKeypair(
      deterministicId('kid', 'receipt-verification-revoke-test')
    );
    revocableRegistry.register({
      key_id: keypair.keyId,
      algorithm: 'Ed25519',
      public_key: keypair.publicKey,
      status: 'active',
      valid_from: '2026-01-01T00:00:00Z',
      purpose: 'test',
      environment: 'test',
    });
    const revokableSigner: Signer = { keyId: keypair.keyId, privateKey: keypair.privateKey };
    // Built against a registry where the key is still active, so
    // verifyAndSign's own runtime self-check succeeds at issuance time —
    // this test is specifically about verifyServiceReceipt (the boundary),
    // not the runtime enforcement path, and revokes the key only afterward.
    const revocableReceipt = await buildSampleReceipt(revokableSigner, revocableRegistry);

    revocableRegistry.revoke(keypair.keyId);
    const result = await verifyServiceReceipt({
      receipt: revocableReceipt,
      keyRegistry: revocableRegistry,
    });
    expect(result.valid).toBe(false);
    expect(result.status).toBe('revoked_key');
  });

  it('a malformed receipt (missing signature) fails closed rather than throwing', async () => {
    const malformed = { ...receipt, signature: '' };
    await expect(
      verifyServiceReceipt({ receipt: malformed, keyRegistry: registry })
    ).resolves.toMatchObject({ valid: false });
  });
});
