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
   - Numbers in shortest decimal form
   - `null`, `true`, `false` literals
4. **Encode** as UTF-8

## Scope

Applied to:

- `output_hash`: SHA-256 of canonical PCC result (excluding receipt)
- `policy_hash`: SHA-256 of canonical verification policy used
- **Receipt signature payload**: `canonical(output_hash || policy_hash)`
  concatenated as raw bytes

## Implementation Notes

- Use a JCS-compliant library (e.g., `canonical-json`, `json-canonicalize`)
- Test vectors from RFC 8785 Appendix A must pass
- Canonicalization must be pure (no side effects, deterministic)

## Example

```json
{ "b": 2, "a": 1 }
```

Canonicalizes to (with sorted keys):

```json
{ "a": 1, "b": 2 }
```
