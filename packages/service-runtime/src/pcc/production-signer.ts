/**
 * SUN-1214 checkpoint T — dedicated production paid-receipt signer.
 *
 * Turns real Ed25519 key material into the same `{signer, registry}`
 * shape `test-signer.ts`'s `createFixtureSigner` returns, using this
 * repository's existing, already Worker-compatible signing primitives
 * (`@siteborne/verification`'s `signBytes`/`verifyBytes`, backed by
 * `@noble/ed25519`) completely unchanged. No new cryptographic format.
 * No repurposing of `AGENT_CARD_SIGNING_PRIVATE_KEY` (a different key,
 * a different algorithm family -- ES256 -- and a different trust
 * domain -- A2A Agent Card identity, not paid-service receipts). No
 * fixture fallback: every failure path throws
 * `ProductionSignerConfigurationError` rather than degrading to
 * `createFixtureSigner` or any other non-production key source.
 *
 * This module does not provision, store, or read any Cloudflare secret
 * itself -- it is handed raw key material by its caller (a future
 * production route-composition module) and only ever validates/derives
 * from what it's given. SUN-1214 provisions no real production secret;
 * this module is exercised only with local/test key material during
 * this checkpoint.
 */
import * as ed from '@noble/ed25519';
import { KeyRegistry, type Signer } from '@siteborne/verification';

/** Matches the frozen PCC receipt block's `signing_key_id` pattern
 * (`^kid_[a-z0-9]{24}$`) -- the same requirement `test-signer.ts`'s own
 * doc comment cites. A key ID that doesn't match would make every
 * service output schema-invalid, so this is checked here rather than
 * discovered later as a receipt-construction failure. */
const KEY_ID_PATTERN = /^kid_[a-z0-9]{24}$/;

const ED25519_PRIVATE_KEY_BYTE_LENGTH = 32;

export class ProductionSignerConfigurationError extends Error {
  constructor(message: string) {
    super(`production_signer_configuration_error: ${message}`);
    this.name = 'ProductionSignerConfigurationError';
  }
}

function decodeHexPrivateKey(rawPrivateKeyHex: string): Uint8Array {
  if (!rawPrivateKeyHex) {
    throw new ProductionSignerConfigurationError('private key material is missing/empty');
  }
  if (!/^[0-9a-fA-F]+$/.test(rawPrivateKeyHex)) {
    throw new ProductionSignerConfigurationError('private key material is not valid hex');
  }
  if (rawPrivateKeyHex.length !== ED25519_PRIVATE_KEY_BYTE_LENGTH * 2) {
    throw new ProductionSignerConfigurationError(
      `private key material must decode to exactly ${ED25519_PRIVATE_KEY_BYTE_LENGTH} bytes`
    );
  }
  const bytes = new Uint8Array(ED25519_PRIVATE_KEY_BYTE_LENGTH);
  for (let i = 0; i < ED25519_PRIVATE_KEY_BYTE_LENGTH; i++) {
    bytes[i] = parseInt(rawPrivateKeyHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Builds the dedicated production paid-receipt signer/registry pair.
 * Fails closed (throws `ProductionSignerConfigurationError`) on any
 * missing, malformed, or wrong-length key material, or a key ID that
 * doesn't match the frozen receipt schema's pattern -- never falls back
 * to a fixture/test key.
 */
export async function buildProductionSigner(
  rawPrivateKeyHex: string,
  keyId: string
): Promise<{ signer: Signer; registry: KeyRegistry }> {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new ProductionSignerConfigurationError(
      `key ID "${keyId}" does not match the required pattern ${KEY_ID_PATTERN}`
    );
  }
  const privateKey = decodeHexPrivateKey(rawPrivateKeyHex);
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  const registry = new KeyRegistry();
  registry.register({
    key_id: keyId,
    algorithm: 'Ed25519',
    public_key: publicKey,
    status: 'active',
    valid_from: new Date().toISOString(),
    purpose: 'paid_service_receipt',
    environment: 'production',
  });

  return {
    signer: { keyId, privateKey },
    registry,
  };
}
