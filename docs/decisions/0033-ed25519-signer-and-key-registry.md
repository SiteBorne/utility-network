# SITEBORNE Utility Network — ADR 0033: Ed25519 Signer and Key Registry (SUN-0500)

## Context

`docs/decisions/0007-pcc-canonicalization-and-signing.md` already selected
`@noble/ed25519` as the repo's Ed25519 implementation for TypeScript, and
`packages/pcc-schema/src/index.ts` already implements `signReceipt`/
`verifyReceipt` against the frozen PCC `ReceiptSignaturePreimage` shape.
SUN-0500's receipt preimage (ADR 0032) is a superset of that shape with
different bound fields, so reusing `signReceipt`/`verifyReceipt` verbatim would
either drop SUN-0500's extra fields from the signature or require force-fitting
them into the PCC-specific preimage type. Reimplementing Ed25519 itself would
violate ADR 0007 (one Ed25519 implementation for the whole repo, not several
using different libraries).

## Decision

`packages/verification/src/receipt/signer.ts` calls `@noble/ed25519` directly
(`signAsync`/`verifyAsync`) — the same maintained library ADR 0007 already
selected — rather than either reimplementing Ed25519 or reusing `pcc-schema`'s
PCC-specific preimage-signing wrapper. `canonicalize`/ `hashCanonical` (the
JCS + SHA-256 half of ADR 0007) **are** reused directly from
`@siteborne/pcc-schema` via `packages/verification/src/canonical.ts` — only the
signature-preimage shape differs, not the canonicalization or hashing algorithm.

`generateTestKeypair()` produces ephemeral, in-memory keys for local/test use
only. No key material is ever persisted or committed; each test process
regenerates its own keypair. `KeyRecord.environment: 'test' | 'production'`
exists specifically so a key can never be silently used as production key
material by a code path that only checked `status`, not `environment` — no
`environment: 'production'` key is created, registered, or exercised anywhere in
SUN-0500 (production key custody, HSM/KMS integration, and rotation tooling are
explicitly out of scope for this increment).

`KeyRegistry` (`receipt/key-registry.ts`) enforces: key IDs cannot be reused
once registered (`register` throws on a duplicate `key_id` — key rotation means
a _new_ `key_id`, never overwriting an old one's public key); a retired key
still verifies historical receipts (`canVerifyWith` returns `true` for
`active`/`retiring`/`retired`); a revoked key never verifies anything, including
receipts it legitimately signed before revocation
(`canVerifyWith`/`verifyReceipt` both return `false`/`revoked_key`
unconditionally) — revocation is for compromised keys, where every receipt
signed with that key becomes suspect, unlike routine retirement.

## Status

Accepted (SUN-0500). Production key custody and rotation operations are tracked
as a future increment, not SUN-0500 scope.
