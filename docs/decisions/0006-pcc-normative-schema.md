# ADR-0006: PCC Normative Schema

## Status

Accepted

## Date

2026-08-05

## Context

The SITEBORNE Utility Network requires a stable, verifiable data contract for
Proof-Carrying Context (PCC) documents. Without a normative schema, consumers
cannot reliably validate outputs, verify signatures, or maintain compatibility
across versions. The schema must support:

- Service contracts with optional payment fields
- Material claims with evidence linkage
- Completeness tracking at aggregate and dimension levels
- Provenance including deterministic vs. model-based routes
- Verification results with deterministic failure semantics
- Cryptographic receipts using Ed25519

## Decision

Adopt a single canonical JSON Schema (Draft 07) as the normative PCC 1.0.0
contract. All generated TypeScript and Python models derive from this schema.

### Key choices

1. **JSON Schema Draft 07** — Mature, widely supported, sufficient expressive
   power for our constraints.
2. **Closed root with explicit extension container** — Unknown root fields are
   rejected; extensions live under `extensions` with `ext_*` namespace keys.
3. **Decimal strings for money** — Avoid floating-point representation; use
   canonical decimal strings with explicit pattern validation.
4. **Tagged hashes** — `sha256:<64 lowercase hex>`; reject uppercase, untagged,
   or malformed hashes.
5. **RFC 3339 UTC with Z suffix** — Normalized timestamps; leap seconds
   prohibited.
6. **Semantic validation separate from structural** — JSON Schema handles
   structure; TypeScript and Python code enforce business invariants
   (completeness counts, deterministic failures, contract mode constraints).

## Consequences

- Positive: Consumers have a single source of truth for validation.
- Positive: Cross-language compatibility is testable and enforced.
- Negative: JSON Schema Draft 07 lacks some newer features; acceptable for
  current needs.
- Negative: Schema evolution requires disciplined compatibility policy.

## Alternatives considered

- **OpenAPI / protobuf**: Overly complex for current scope; may be revisited for
  transport layer.
- **Custom DSL**: Would require building and maintaining tooling; rejected in
  favor of existing standards.
