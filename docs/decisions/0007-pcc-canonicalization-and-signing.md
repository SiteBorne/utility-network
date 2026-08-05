# ADR-0007: PCC Canonicalization and Signing

## Status

Accepted

## Date

2026-08-05

## Context

PCC receipts must be cryptographically verifiable across different runtimes
(TypeScript, Python, and potentially others). This requires:

1. Deterministic serialization of the document before hashing
2. A signature algorithm with compact signatures and fast verification
3. Clear separation between structural validity and cryptographic receipt
   validity

## Decision

### Canonicalization: JCS (RFC 8785)

Use JSON Canonicalization Scheme (RFC 8785) rather than a custom key-sorting
function. JCS provides:

- Standardized behavior across implementations
- Deterministic number serialization (no scientific notation)
- Unicode-normalized string output
- Rejectable duplicate keys

### Signing: Ed25519

Use Ed25519 (RFC 8032) for receipt signatures:

- 64-byte signatures, base64url-encoded
- Payload: `canonical({ output_hash, policy_hash })`
- Algorithm identifier stored in `receipt.signature_algorithm`

### Key management

- Test fixtures use an explicit non-production keypair
- Production keys are never committed to the repository
- Key identifiers use `kid_<24 alphanum>` format

## Consequences

- Positive: Cross-language canonicalization is verifiable with shared fixtures.
- Positive: Ed25519 signatures are compact and fast to verify.
- Negative: JCS libraries are less common than naive `JSON.stringify` + sort;
  requires explicit dependency.
- Negative: Ed25519 is not natively supported in all WebCrypto implementations;
  `@noble/ed25519` is used for TypeScript.

## Alternatives considered

- **Custom canonicalization (naive sort + stringify)**: Rejected due to edge
  cases with numbers, Unicode, and duplicate keys.
- **ECDSA/secp256k1**: Rejected; Ed25519 has better security properties and
  simpler implementation.
- **RSA**: Rejected; signatures are too large for our receipt format.
