# ADR 0013: Contract Compatibility Classification

**Status:** Accepted **Date:** 2026-08-05 **Decision Makers:** Architect
**Consulted:** Governance validation

## Context

SUN-0102 requires deterministic classification of changes to service contracts.
We need a machine-readable change taxonomy that maps every change type to a
default compatibility classification, minimum required version bump, and review
requirements.

## Decision

We define a comprehensive change taxonomy with 31 change types, each with:

- **Default compatibility classification**: patch, minor_candidate, or major
- **Minimum required version bump**: patch, minor, or major
- **Human review requirement**: boolean
- **Runtime migration requirement**: boolean
- **Parallel major version required**: boolean

Key classification rules:

### Patch (1.0.0 → 1.0.1)

- `documentation_only`, `example_only`, `annotation_change`
- Generator bug fixes producing semantically identical models
- Validator corrections enforcing already documented behavior
- Non-semantic metadata corrections
- Security hardening rejecting already-forbidden behavior

### Minor Candidate (1.0.0 → 1.1.0) — Requires strict-consumer evaluation

- `optional_property_added` — evaluated under strict-consumer mode; may be
  breaking if `additionalProperties: false` or closed enum
- `minimum_decreased`, `maximum_increased` — widening bounds
- New optional extension namespaces, metadata fields, capabilities

### Major (1.0.0 → 2.0.0 / .v2) — Requires new service major identifier

- `required_property_added`, `property_removed`, `property_renamed`,
  `property_type_changed`
- `enum_value_added` — breaking under strict-consumer unless contract requires
  unknown-value handling
- `enum_value_removed`, `minimum_increased`, `maximum_decreased`
- `pattern_changed`, `format_changed`, `additional_properties_changed`
- `required_list_changed`, `one_of_changed`, `any_of_changed`, `all_of_changed`
- `reference_target_changed`, `identifier_changed`, `service_version_changed`
- `pcc_dependency_changed`, `semantic_validator_changed`
- `openapi_operation_changed`, `error_contract_changed`
- `pricing_semantics_changed`, `signature_binding_changed`

**Unknown change types fail closed.**

## Rationale

- Closed-enum expansion is NOT automatically backward compatible — strict
  consumers reject unknown enum values
- Adding optional properties to objects with `additionalProperties: false` can
  break consumers using older schemas
- Default to strict-consumer mode unless contract explicitly states otherwise
- Every change type has explicit mapping preventing ambiguous classifications

## Consequences

- Compatibility tooling must classify every detected change
- Human review required for all minor and major classifications
- Patch classifications for documentation-only changes can be automated
- Major changes require new `.v{N+1}` service identity

## Revisit Condition

If a classification proves incorrect in production, or if new change types are
discovered that don't fit the taxonomy.
