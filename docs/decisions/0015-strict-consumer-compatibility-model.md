# ADR 0015: Strict Consumer Compatibility Model

**Status:** Accepted **Date:** 2026-08-05 **Decision Makers:** Architect
**Consulted:** Governance validation

## Context

SUN-0102 requires a defined consumer compatibility model to prevent unsafe
claims that optional properties or enum expansions are universally backward
compatible. The default enforcement must assume strict machine consumers unless
a contract explicitly states otherwise.

## Decision

We define four distinct compatibility modes and enforce strict-consumer as
default:

```yaml
compatibility_modes:
  schema_strict_consumer:
    unknown_properties: reject
    unknown_enum_values: reject
    default_for_enforcement: true

  tolerant_consumer:
    unknown_properties: ignore_when_allowed
    unknown_enum_values: preserve_or_fail_safely

  existing_producer:
    sends_only_baseline_fields: true

  new_producer:
    may_send_new_optional_fields: version_dependent
```

### Implications for Change Classification

| Change                        | Tolerant Consumer | Strict Consumer (Default)                     |
| ----------------------------- | ----------------- | --------------------------------------------- |
| New optional property         | Compatible        | **Breaking if `additionalProperties: false`** |
| New enum value in closed enum | Compatible        | **Breaking**                                  |
| New enum value in open enum   | Compatible        | Compatible                                    |
| New optional response field   | Compatible        | Compatible (consumer ignores)                 |
| New optional request field    | Compatible        | **Breaking if consumer validates requests**   |

### Default Enforcement Rules

1. **All contracts default to `schema_strict_consumer`** unless explicitly
   annotated otherwise
2. **Closed enum expansion is major** — strict consumers reject unknown values
3. **Optional property addition is minor-candidate** — requires human review to
   verify `additionalProperties: true` or consumer tolerance
4. **Compatibility report must state which mode was evaluated**

### Service-Specific Applications

- **Company Evidence Graph**: Field groups are enum-constrained; new field
  groups = major
- **Verified Web Context**: Retrieval/output modes are closed enums; new modes =
  major
- **Document Evidence JSON**: Media types, page limits, price limits are
  constrained; changes = classified explicitly
- **Agent Output Verification**: Verification modes, deterministic failure rules
  are frozen; weakening = major

## Rationale

- Autonomous buyers are machine consumers that validate schemas strictly
- Assuming tolerant consumers leads to silent breaks when strict consumers exist
- Explicit opt-in for tolerant mode forces deliberate design decisions
- Default strict mode aligns with "machine-native utility network" mission

## Consequences

- More changes classified as major than traditional semver
- Human review required for all optional property additions
- Service contracts must explicitly declare if they support tolerant consumers
- Compatibility fixtures test both strict and tolerant modes

## Revisit Condition

If a contract explicitly requires tolerant consumer mode, or if production
evidence shows strict mode is too restrictive for a specific service.
