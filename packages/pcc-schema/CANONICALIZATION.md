# PCC Canonicalization Policy

## Version

1.0.0

## Overview

All PCC hashes and signatures use JSON Canonicalization Scheme (JCS) per RFC
8785 for deterministic serialization.

## Algorithm

1. **Parse** JSON input to an infoset (abstract data model)
2. **Sort** object keys lexicographically (Unicode code point order)
3. **Serialize** with deterministic formatting:
   - No whitespace variation (single space after `:`, `,`)
   - No trailing commas
   - Strings in double quotes with minimal escaping
   - Numbers in shortest decimal form (no scientific notation)
   - `null`, `true`, `false` literals
4. **Encode** as UTF-8

## Timestamp Normalization

- All canonical timestamps use **UTC Z suffix** (`Z`, not `+00:00`)
- Fractional seconds are optional but when present use **1–6 digits**
- Leap seconds are **prohibited** (libraries may not handle them consistently)
- Timestamps without fractional seconds are canonical

## Null vs Absent Fields

- `null` values are **included** in canonicalization
- Absent (undefined) fields are **omitted**
- Optional fields that are absent do not appear in the canonical form

## Extension Inclusion

Extensions placed in the `extensions` container are **included** in
canonicalization and output hashing unless explicitly excluded by policy.

## Scope

Applied to:

- `output_hash`: SHA-256 of canonical PCC result (excluding receipt)
- `policy_hash`: SHA-256 of canonical verification policy used
- **Receipt signature payload**: `canonical({ output_hash, policy_hash })`

## Cross-Language Guarantee

TypeScript and Python canonicalization implementations must produce **identical
byte output** for the same input. Cross-language fixtures in `tests/fixtures/`
verify this invariant.

## Example

```json
{ "b": 2, "a": 1 }
```

Canonicalizes to (with sorted keys):

```json
{ "a": 1, "b": 2 }
```
