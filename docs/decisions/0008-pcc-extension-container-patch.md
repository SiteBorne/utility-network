# ADR-0008: PCC 1.0.1 — extension_container structural correction

## Status

Accepted

## Date

2026-08-05

## Context

While defining the four service input/output schemas for SUN-0101, every output
schema (`company-evidence`, `web-context`, `document-evidence`,
`agent-verification`) failed structural validation against its own bundled
example. After fixing an unrelated `$ref` host mismatch and an
`additionalProperties`/`allOf` intersection conflict local to the service
schemas, one error remained on all four:

```
Additional properties are not allowed ('net.siteborne.<service>.v1' was unexpected) @ ['extensions']
```

Isolating PCC's `definitions.extension_container` and validating it on its own
(independent of any service schema) showed the defect was entirely inside PCC
1.0.0, frozen in SUN-0100 (commit `44534ea`, schema hash
`345ba43338193b44e6c7f6bd2b1eb347f5cbcfb19e54a4193798a2abe8e3e374`):

```json
{
  "type": "object",
  "additionalProperties": false,
  "maxProperties": 10,
  "propertyNames": { "pattern": "..." }
}
```

`additionalProperties: false` with no `properties` or `patternProperties`
forbids every property unconditionally — `propertyNames` only constrains the
_shape_ of a key, it does not, by itself, make that key an allowed property. In
isolation this schema accepts only `{}`. Verified independently with two
implementations:

- Python `jsonschema` (`Draft7Validator`) — `{"net.siteborne.x.v1": {}}` → 1
  error, `additionalProperties`.
- Node `ajv@6` (draft-07) — same input, same single `additionalProperties`
  error.

Because JSON Schema `allOf` branches only ever _narrow_ what siblings allow
(intersection, never union), no service-schema branch can reopen a `false`
closed by another branch in the same `allOf`. This made it structurally
impossible for any document to carry a populated `extensions` object,
contradicting PCC's own documented intent (`docs/decisions/0006` and the
`extension_container` description itself: "Controlled extension container [...]
Maximum 10 extensions").

Git history shows this was introduced in `44534ea` ("bound extension
namespaces"), which replaced a working `patternProperties`-based rule with
`propertyNames`-only, apparently intending `propertyNames` to also gate which
keys are structurally accepted. It does not.

## Decision

Patch PCC to 1.0.1 (patch-level per `COMPATIBILITY_POLICY`: "validator bug fixes
that enforce already-documented behavior"):

- Restore `patternProperties` on `extension_container`, keyed by the same
  reverse-domain pattern already enforced via `propertyNames`, mapping to a new
  `#/definitions/extension_value`.
- `extension_value` is bounded JSON data (`type: object`, `maxProperties: 200`,
  `additionalProperties: true`) — deliberately generic; individual services
  narrow their own namespace's payload shape via their own `allOf` branch
  (unaffected by this patch).
- `additionalProperties: false`, `maxProperties: 10`, and `propertyNames`
  (grammar, length) on `extension_container` are unchanged — namespace
  validation, the 10-extension cap, and rejection of unqualified/malformed keys
  all continue to be enforced exactly as before.
- `pcc_version` (the document content-compatibility field, `const: "1.0.0"`) is
  unchanged — this is a schema/validator correction, not a document semantics
  change. Only the schema package version (`packages/pcc-schema/package.json`)
  and schema hash move to 1.0.1.
- New schema hash (SHA-256 of `schemas/proof-carrying-context.schema.json`):
  `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5`.

Separately, the four service output schemas' own `allOf` branches were corrected
(independent of this patch, but discovered alongside it): removed
`additionalProperties: false` from the branch that composes with PCC at the
document root and from the nested `contract` narrowing object, since a sibling
`additionalProperties: false` there also rejected PCC's own required fields
(`subject`, `claims`, `evidence`, `contract.input_hash`, etc.) that aren't
re-listed locally. The `extensions` narrowing sub-schema in each service branch
was likewise left open (no `additionalProperties: false`) so other qualified PCC
extensions remain permitted alongside the required one, per the service branch
only requiring and typing its own namespace.

## Consequences

- Positive: service output documents can now structurally validate with a
  populated `extensions` object; the SUN-0101 output schemas' own stated
  contract ("Must be a valid PCC 1.0.0 document with required extension") is now
  actually satisfiable.
- Positive: all pre-existing PCC tests pass unchanged (100 TS —
  `pcc-schema.test.ts` + `conformance-conformance.test.ts` — and 23 Python); 46
  new tests (17 TS in `pcc-extension-container.test.ts`, 29 Python in
  `test_pcc_extension_container.py`) cover the namespace grammar matrix, the
  10-extension cap, unqualified/malformed keys, all four SITEBORNE service
  namespaces, required-extension enforcement per service output schema, and
  cross-language (TS/Python) agreement.
- Negative: this reopens a schema that SUN-0100 recorded as frozen/accepted. Any
  consumer that pinned to schema hash `345ba433...` must move to `f664208...` —
  there are none yet (SUN-0101 is the first and only consumer of the extension
  mechanism), so no external migration is needed.
- Negative: SUN-0100's evidence trail now includes an amendment record
  (`TASKS.yaml` → `SUN-0100.amendment`) rather than being purely immutable; this
  is the intended, narrow mechanism for post-freeze corrections per
  `COMPATIBILITY_POLICY`'s patch tier.

## Alternatives considered

- **Work around it in SUN-0101 only (leave PCC frozen)**: rejected — proven
  impossible. No `allOf` sibling can reopen a property closed by
  `additionalProperties: false` elsewhere in the same `allOf`; this is standard
  JSON Schema draft 07/2020-12 semantics, not a generator limitation. Confirmed
  with two independent validators.
- **Move service-specific output data outside PCC's `extensions` container**:
  rejected — contradicts each output schema's own stated invariant that the
  document must be a valid PCC document, and would duplicate/diverge from the
  documented extension mechanism in `docs/decisions/0006`.
- **Semantic-validator-only enforcement (skip structural validation of
  `extensions` entirely)**: rejected — would leave the schema's own stated
  contract unsatisfiable and mask the defect rather than fix it; not what PCC's
  `extension_container` was documented to do.
