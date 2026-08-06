# SUN-0101 Acceptance Report — Service Input/Output Schemas

## Increment

SUN-0101

## Title

Define input/output schemas for all services (Phase 3b)

## Date

2026-08-05

## Summary

Defines the 17 canonical schemas for SITEBORNE's four services — 9 shared
common/envelope schemas plus 8 service input/output schemas (one input, one
output per service: `company_evidence_graph.v1`, `web_context_verified.v1`,
`document_evidence_json.v1`, `verify_agent_output.v1`) — with structural
validation, generated TypeScript/Python models, content-hashed manifest,
validated fixtures, drift enforcement, and semantic (cross-field/policy)
validators, plus a scoped correction to the frozen PCC 1.0.0 schema
(→ 1.0.1) discovered along the way.

## Canonical Schema Inventory (17 + PCC)

**Common (9)** — `schemas/common/`: `money`, `request-envelope`,
`quote-request`, `quote-response`, `structured-error`, `service-metadata`,
`async-job`, `pagination`, `authorized-artifact-reference`.

**Service input/output (8)** — `schemas/services/`: `company-evidence-input`
/ `-output`, `web-context-input` / `-output`, `document-evidence-input` /
`-output`, `agent-verification-input` / `-output`.

Full inventory with content hashes: `schemas/MANIFEST.json` (generated via
`pnpm --filter @siteborne/pcc-schema manifest:generate`, verified via
`manifest:check`). PCC schema hash (post-1.0.1 patch):
`f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5`.

## Defects found and fixed during this increment

Structural validation (validating each schema's own bundled `examples`
against itself, with full `$id`-based cross-schema `$ref` resolution) is
what surfaced all of the following — none were caught by schema-shape
validation alone (`Draft202012Validator.check_schema`), which only confirms
a document is a *well-formed* JSON Schema, not that any real document can
ever satisfy it.

1. **Dangling `$ref` to PCC.** All 4 output schemas referenced
   `https://siteborne.net/schemas/proof-carrying-context.schema.json`, but
   PCC's actual `$id` is `https://utility.siteborne.net/schemas/...`. Fixed
   in all 4 files and in the two schema-prep scripts that resolve local
   paths from `$ref` URLs.

2. **Unsatisfiable `allOf` composition (all 4 output schemas).** Each
   output schema's service-specific `allOf` branch set
   `additionalProperties: false` while only declaring `contract` and
   `extensions` in its own `properties` — which, under `allOf` intersection,
   simultaneously required and forbade PCC's own required fields (`subject`,
   `claims`, `evidence`, `contract.input_hash`, etc.). No document could
   ever satisfy any of the 4 schemas. Fixed by removing
   `additionalProperties: false` from the service branch's root and its
   nested `contract` narrowing object (the branch now only *narrows*,
   never *closes*, consistent with how `allOf` composition actually works).

3. **PCC 1.0.1 — `extension_container` rejected every extension key
   unconditionally**, independent of anything a service schema declared.
   This was in the frozen PCC 1.0.0 schema itself (SUN-0100), not fixable
   from the service side. See
   [ADR-0008](../decisions/0008-pcc-extension-container-patch.md) for the
   full analysis, fix, and version handling. New PCC hash:
   `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5`
   (1.0.0 → 1.0.1, `pcc_version` document-content field unchanged at
   `"1.0.0"`).

4. **`service_id` pattern didn't match the canonical service IDs, in 6
   common schemas.** `request-envelope`, `quote-request`, `quote-response`,
   `structured-error`, `service-metadata`, and `async-job` all constrained
   `service_id` with `^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$` (three dot-separated
   segments) while every actual canonical ID (`company_evidence_graph.v1`,
   etc.) and the accompanying `enum` are two segments
   (`^[a-z0-9_]+\.v[0-9]+$`). Combined with `enum`, this made `service_id`
   unsatisfiable by any real value in those 6 schemas. Fixed the pattern;
   also fixed the identical duplicated regex in
   `packages/contracts/src/semantic/validators.ts` /`.py`.

5. **Broken example fixtures** (9 examples across 8 files): fake IDs
   containing non-hex characters (`01h9k3v7...`) that matched neither the
   UUIDv4 nor ULID branch of the ID pattern; a 62-character `output_schema_hash`
   (needs exactly 64 hex chars) in `quote-request`/`quote-response`; a
   14-character `idempotency_key` in `request-envelope` (needs ≥16);
   `service-metadata` missing its required `maximum_price`; and the 4 output
   schemas' examples were PCC-document fragments (only `contract` +
   `extensions`), not complete documents. All fixed; every one of the 17
   schemas' `examples` now validates against itself with zero errors
   (`packages/pcc-schema/tests/python/test_schema_examples.py`).

6. **Broken semantic-validator scaffolding** (uncommitted, from prior
   session): `packages/contracts/src/semantic/validators.py` used Pydantic
   v1 syntax (`Field(regex=...)`, `@validator('*')`, `Field(const=False)`)
   against a Pydantic v2.13 environment — the module didn't import at all.
   Rewrote to v2 idioms (`pattern=`, `@model_validator(mode='after')`,
   `Literal[False]`). `drift-check-services.ts` had every helper function
   declared twice (duplicate-declaration syntax error, wouldn't run at all)
   and, once deduplicated, used a divergent from-scratch regeneration path
   instead of the actual `generate-service-models.ts` pipeline — rewritten
   to regenerate through the exact same scripts the committed output comes
   from, so drift detection is meaningful. `create-ts-schemas.ts` didn't
   copy common schemas into its scratch directory, so
   `document-evidence-output` (which `$ref`s `common/money.schema.json`
   from inside its extension payload) failed TypeScript generation.

## Codegen pipeline

`packages/pcc-schema/scripts/`:

- `create-combined-schemas.ts` — inlines all `$ref`s into flat per-schema
  files (`.temp-combined-schemas/`, gitignored) for Python generation.
- `create-ts-schemas.ts` — rewrites external `$ref` URLs to local paths and
  copies PCC + common schemas (`.temp-ts-schemas/`, gitignored) for
  TypeScript generation via quicktype.
- `generate-service-models.ts` — generates `packages/contracts/generated/{typescript,python}/{common,services}/*` for all 17 schemas plus `pcc.{ts,py}`.
- `drift-check-services.ts` — regenerates through the same pipeline into a
  scratch copy and diffs against the committed `generated/` output; exits
  non-zero on any mismatch. Current status: **0 drift across all 18
  models** (17 canonical + PCC).
- `generate-manifest.ts` — writes/verifies `schemas/MANIFEST.json` (content
  hash, `$id`, title, generated output paths for all 18 schemas).

pnpm scripts (in `packages/pcc-schema/package.json`):
`generate:services` (prep + generate), `generate:services:check` (drift),
`manifest:generate`, `manifest:check`.

## Semantic validators (`packages/contracts/src/semantic/`)

Cross-field/policy invariants that JSON Schema structural validation can't
express cleanly, mirrored in TypeScript (`validators.ts`, zod) and Python
(`validators.py`, Pydantic v2), covering every schema named in the
directive:

- **request envelope, quote request, quote response, structured error,
  async job, service metadata** — zod schemas / Pydantic models with the
  full field-level constraint set, plus standalone invariant functions:
  `validateHashPairing`, `validateServicePairing`, `validateQuoteExactUpto`
  (exact ⇔ `price` present ⇔ `maximum_authorized_price` absent, and vice
  versa for `upto`), `validateTimestampOrdering`, `validateCompleteness`
  (`supported_fields ≤ populated_fields ≤ requested_fields`, score ∈ [0,1]),
  `validateDeterministicFailures` (`decision: pass` ⇒ no deterministic
  failures).
- **All 8 service input/output schemas** — `SERVICE_EXTENSION_NAMESPACE`
  registry + `validateServiceOutputDocument(doc, expectedServiceId)`
  (service/version pairing, contract hash triple, its own extension present
  and *no other service's* extension present, timestamp ordering,
  completeness/decision consistency) covering all 4 output schemas
  generically; `validateDocumentEvidenceInputMode` and
  `validateCompanyEvidenceInputHasIdentifier` re-check the two inputs'
  `oneOf`/`anyOf` structural invariants at the application layer.

## Test results

| Suite | Count | Status |
|---|---|---|
| TS: `pcc-schema.test.ts` + `conformance-conformance.test.ts` (pre-existing, SUN-0100) | 100 | ✅ pass |
| TS: `pcc-extension-container.test.ts` (PCC 1.0.1 patch) | 17 | ✅ pass |
| TS: `contracts.test.ts` (pre-existing) | 9 | ✅ pass |
| TS: `semantic/validators.test.ts` (SUN-0101) | 29 | ✅ pass |
| **TS total** | **155** | ✅ |
| Python: `test_pcc_hypothesis.py` (pre-existing, SUN-0100) | 23 | ✅ pass |
| Python: `test_pcc_extension_container.py` (PCC 1.0.1 patch) | 29 | ✅ pass |
| Python: `test_schema_examples.py` (SUN-0101 fixtures) | 39 | ✅ pass |
| Python: `semantic/test_validators.py` (SUN-0101) | 38 | ✅ pass |
| **Python total** | **129** | ✅ |
| **Grand total** | **284** | ✅ |

Drift check (`generate:services:check`): 0 drift, 18/18 models match.
Manifest check (`manifest:check`): current, 18/18 schemas.

## Scope not covered here

- OpenAPI drift test (listed in `TASKS.yaml` acceptance criteria) — no
  OpenAPI spec exists yet in this repo; deferred, not part of the schema
  layer this increment delivers.
- Runtime service implementations (edge-api routes, Modal workers) —
  out of scope for a contracts-only increment.

## Related

- [ADR-0008](../decisions/0008-pcc-extension-container-patch.md) — PCC 1.0.1
  extension_container patch.
- [SUN-0100 report](SUN-0100-pcc-schema-report.md) (amended).
- `schemas/MANIFEST.json` — canonical hash/inventory source of truth.

## Recommended Next Task

SUN-0102 — Freeze contracts version 1.0.0 (Phase 3c). Note: SUN-0102's
acceptance criteria ("no breaking changes without version bump enforced")
should account for the PCC 1.0.1 patch landing during SUN-0101 — the freeze
should target PCC 1.0.1 and the 17 canonical schemas as defined here, not
the pre-patch PCC 1.0.0.
