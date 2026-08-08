# SITEBORNE Utility Network - ADR 0005: Source-Shape Drift and Quarantine

## Context

An authoritative source can change its response shape without warning (renamed
field, changed type, new wrapper object, changed pagination). If an adapter
silently accepts a changed shape, it risks either fabricating normalized values
from fields that no longer mean what they used to, or silently dropping data.
Drift detection exists to catch this before it reaches a normalized
`SourceObservation`.

## Decision

`packages/provider-adapters/src/drift/` (`types.ts`, `shape.ts`, `compare.ts`,
`classify.ts`, `index.ts`) implements `inferSchema()` + `detectDrift()`,
returning a closed `DriftResult`:

```
{ provider_id, capability, expected_shape_hash, observed_shape_hash,
  changes[], classification, safe_to_continue, result_class,
  review_required, audit_event }
```

Detected change types include: `optional_field_added`, `required_field_missing`,
`field_type_changed`, `object_array_shape_changed` (array vs. object),
`enum_like_value_changed`, `pagination_shape_changed`,
`identifier_format_changed`, `timestamp_format_changed`, `unexpected_wrapper` /
`wrapper_removed`, `content_type_changed`, `excessive_nesting`, and
`result_item_shape_changed`.

Enforced invariants (see `src/drift/drift.test.ts` and
`src/drift/provider-drift.test.ts` for per-provider cases across SEC
submissions, SEC company facts, OpenAlex, Crossref, GitHub, and Federal
Register):

- A missing required field always classifies as `source_changed`.
- Drift is **never** classified as `not_found` — an absent source and a source
  that changed shape are different failure modes and must not be conflated.
- Drift is **never** classified as `verified_absent_candidate` — drift is
  evidence of a possible upstream change, not evidence of absence.
- Unsafe type/wrapper changes classify as `source_changed` or `quarantined`; a
  safe optional addition may continue only when policy explicitly permits it
  (`allowOptionalAdditions`).
- Fixtures and adapter source code are never rewritten automatically in response
  to detected drift — every drift event is `review_required` and produces an
  `audit_event`.
- Adapter health results (`AdapterHealthResult.schema_drift_count`) are updated
  explicitly, not inferred.

## Status

Accepted

## Consequences

- A provider changing its response shape degrades gracefully to
  `source_changed`/`quarantined` with an audit trail, instead of either a hard
  crash or silently-wrong normalized data.
- Because drift classification never automatically rewrites fixtures or source,
  catching drift in CI (via the fixture matrix's drift-category rows) requires a
  human to review and intentionally update the expected shape — this is a
  deliberate friction point, not a gap to be automated away.
