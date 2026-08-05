# PCC Signing Policy

## Version

1.0.0

## Overview

PCC receipts are signed using Ed25519 over a deterministic payload derived from
canonical hashes.

## Algorithm

**Ed25519** (Edwards-curve Digital Signature Algorithm, RFC 8032)

## Payload Construction

```
payload = canonical(output_hash || policy_hash)
```

Where:

- `output_hash`: SHA-256 of canonical PCC result (excluding receipt field),
  hex-encoded as `sha256:...`
- `policy_hash`: SHA-256 of canonical verification policy document, hex-encoded
  as `sha256:...`
- `||`: Raw byte concatenation (32 + 32 = 64 bytes)
- `canonical()`: JCS canonicalization (RFC 8785) applied to the concatenated
  bytes represented as a JSON string
  `{"output_hash": "...", "policy_hash": "..."}`

## Signature Format

- Algorithm identifier: `"Ed25519"` (stored in `receipt.signature_algorithm`)
- Signature: 64-byte Ed25519 signature, base64url-encoded (no padding)
- Stored in: `receipt.signature`

## Verification

1. Reconstruct payload from `receipt.output_hash` and `receipt.policy_hash`
2. Verify Ed25519 signature using seller's public key
3. **Deterministic**: A verification failure CANNOT be overridden by any model
   judgment

## Key Management

- Seller's Ed25519 public key published in Agent Card and MCP Registry metadata
- Private key stored in secure enclave / HSM, never in code or config
- Key rotation: New key published 30 days before old key expires; both accepted
  during overlap

## Test Vectors

Ed25519 test vectors from RFC 8032 Section 7 must pass.
