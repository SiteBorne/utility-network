# Verification Receipts (SUN-0500)

## What a receipt is

A cryptographically signed, tamper-evident record of a mesh run's decision,
binding job/service/contract identity, the exact verifier-result set, and the
evidence set. See [ADR 0032](../decisions/0032-receipt-canonical-binding.md) for
the exact field binding and
[ADR 0035](../decisions/0035-verifier-result-binding-hash-list-not-merkle.md)
for why a sorted canonical hash list, not a Merkle tree, is used to bind the
verifier/evidence sets.

## Issuing a receipt

```ts
import { issueReceipt, generateTestKeypair } from '@siteborne/verification';

const keypair = await generateTestKeypair('kid_my_test_key');
const receipt = await issueReceipt(candidate, context, verdict, {
  keyId: keypair.keyId,
  privateKey: keypair.privateKey,
});
```

`issueReceipt` computes `output_hash`, `evidence_hash` (canonical hash of the
sorted evidence content-hash list), `verifier_set_hash` (canonical hash of the
sorted per-verifier result hashes), then `receipt_id` (a stable digest over
every bound field except `signature`), signs the canonical preimage with Ed25519
(`@noble/ed25519`, per
[ADR 0033](../decisions/0033-ed25519-signer-and-key-registry.md)), and emits
`receipt_created`/`receipt_signed` audit events.

## Verifying a receipt

```ts
import { verifyReceipt } from '@siteborne/verification';

const result = await verifyReceipt(receipt, keyRegistry, {
  service_id: 'document_evidence_json.v1', // optional expected-context checks
});
// result.status: 'valid' | 'invalid_signature' | 'unknown_key' | 'revoked_key'
//   | 'expired_key_policy_failure' | 'receipt_id_mismatch' | 'context_mismatch'
//   | 'malformed_receipt' | 'unsupported_algorithm'
```

`verifyReceipt` is pure and local — no network access. It checks, in order:
signature algorithm support, structural completeness, key lookup/validity in the
supplied `KeyRegistry`, `receipt_id` recomputation (tamper-evidence for every
bound field), optional caller-supplied expected-context fields, and finally the
Ed25519 signature itself. A mismatch at any earlier check returns immediately
without attempting the (comparatively expensive) signature verification.

## Tamper-evidence guarantees

Mutating any bound field of an issued receipt — `decision`, `output_hash`,
`evidence_hash`, `verifier_set_hash`, `completeness`, `verification_mode`,
`signing_key_id`, etc. — either changes the recomputed `receipt_id` (caught as
`receipt_id_mismatch`) or invalidates the Ed25519 signature over the canonical
preimage (`invalid_signature`), or both. See `src/tests/receipt.test.ts` for the
concrete tamper-evidence test matrix.
