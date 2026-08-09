import { generateTestKeypair, KeyRegistry, type Signer } from '@siteborne/verification';
import { deterministicId } from './ids';

/**
 * A fixture-only Ed25519 signer + registry pair, shared by every service's
 * tests and by scripts/verify-fixtures.ts. Never persisted, never a
 * production key (see @siteborne/verification ADR 0033) — this package
 * does not implement production key custody either (directive: "no
 * production destination/binding," and this increment implements no
 * signing beyond local/fixture use).
 */
export async function createFixtureSigner(): Promise<{ signer: Signer; registry: KeyRegistry }> {
  // signing_key_id is embedded in the frozen PCC receipt block, which
  // requires the `^kid_[a-z0-9]{24}$` pattern — a free-text key ID would
  // make every service output schema-invalid.
  const keypair = await generateTestKeypair(
    deterministicId('kid', 'service-runtime-fixture-signer')
  );
  const registry = new KeyRegistry();
  registry.register({
    key_id: keypair.keyId,
    algorithm: 'Ed25519',
    public_key: keypair.publicKey,
    status: 'active',
    valid_from: '2026-01-01T00:00:00Z',
    purpose: 'service_runtime_fixture_receipt',
    environment: 'test',
  });
  return { signer: { keyId: keypair.keyId, privateKey: keypair.privateKey }, registry };
}
