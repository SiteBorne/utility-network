# PCC Compatibility Policy

## Version

1.0.0

## Overview

This document defines the compatibility policy for the Proof-Carrying Context
(PCC) schema. The policy is frozen at foundation phase and governs all future
schema evolution.

## Semantic Versioning Rules

### Patch (1.0.1)

- Clarifications to documentation
- Fixture corrections
- Non-semantic documentation changes
- Validator bug fixes that enforce already-documented behavior

### Minor (1.1.0)

- Backward-compatible optional fields
- New extension namespaces
- New enum values only where consumers are required to handle unknown values
  safely

### Major (2.0.0)

- Required-field changes
- Semantic reinterpretation of existing fields
- Field removal
- Incompatible canonicalization changes
- Incompatible signature input changes
- Closed-enum expansion where old consumers would reject it

## Important Note on JSON Schema Enums

JSON Schema enum expansion is **not** automatically backward compatible for
strict consumers. Adding a new enum value may cause a strict validator to reject
the document. Therefore, enum expansion is treated as:

- **Minor** if the consuming code is required to handle unknown values safely
  (e.g., via a `default` case or fallback logic)
- **Major** if old consumers would fail validation upon encountering the new
  value

## Compatibility Fixtures

The following machine-readable fixtures are maintained:

1. `valid-1.0.0.json` — Complete valid document
2. `oldest-supported-1.x.json` — Oldest 1.x document that must still validate
3. `future-compatible-extension.json` — Valid extension use
4. `incompatible-major.json` — Example of a breaking change (must fail
   validation)
5. `malformed-version.json` — Invalid version strings

## Validation Gate

All schema changes must pass compatibility tests before the schema can be
promoted to `EXECUTABLE_VERIFIED`.
