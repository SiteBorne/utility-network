/**
 * Local/test Ed25519 signer, using @noble/ed25519 directly — the same
 * maintained implementation already selected for TypeScript in
 * docs/decisions/0007-pcc-canonicalization-and-signing.md. No production
 * secret storage is implemented here (out of SUN-0500 scope); this is
 * explicitly test/local key material.
 */

export interface EphemeralTestKeypair {
  keyId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Generates a fresh, in-memory Ed25519 keypair for local/test use.
 * Never persisted, never committed — regenerated per test process. Cannot
 * be mistaken for a production key because it carries no `environment:
 * production` classification anywhere and is never registered with that
 * status in KeyRegistry. */
export async function generateTestKeypair(
  keyId = 'kid_test_ephemeral'
): Promise<EphemeralTestKeypair> {
  const ed = await import('@noble/ed25519');
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { keyId, publicKey, privateKey };
}

export async function signBytes(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  const { signAsync } = await import('@noble/ed25519');
  return signAsync(message, privateKey);
}

export async function verifyBytes(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  const { verifyAsync } = await import('@noble/ed25519');
  try {
    return await verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}
