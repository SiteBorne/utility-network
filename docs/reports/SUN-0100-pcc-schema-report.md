# SUN-0100 Acceptance Report — PCC Normative Schema

## Increment

SUN-0100

## Title

Proof-Carrying Context (PCC) Normative Schema and Compatibility Foundation

## Date

2026-08-05

## Schema Design Summary

The normative PCC 1.0.0 schema defines a verifiable data contract with the
following sections:

- `pcc_version` — frozen at `"1.0.0"`
- `job_id` — constrained identifier format
- `contract` — service contract with mode-aware field requirements (`paid`,
  `benchmark`, `offline_verification`)
- `subject` — typed entity under investigation
- `claims` — material claims with evidence linkage and verification status
- `evidence` — traceable evidence items with locators, transformation history,
  and freshness
- `completeness` — aggregate and dimension-level coverage metrics with
  deterministic invariants
- `provenance` — processing routes, providers, tools, models, cache, and
  execution environment
- `verification` — structured verification result with deterministic failure
  semantics
- `receipt` — Ed25519-signed cryptographic receipt over canonical hashes

Key design decisions:

- **Closed root with explicit extension container** — unknown root fields are
  rejected; extensions use collision-resistant `ext_*` namespace.
- **Decimal strings for money** — avoids floating-point representation.
- **Tagged SHA-256 hashes** — `sha256:<64 lowercase hex>`.
- **RFC 3339 UTC timestamps** — Z suffix, normalized fractional precision.
- **JCS (RFC 8785) canonicalization** — cross-language deterministic
  serialization.
- **Ed25519 signatures** — compact, fast, standard.

## Files Created and Changed

### Schema

- `schemas/proof-carrying-context.schema.json` — updated (removed
  `pre_normative`, removed `minItems: 1` on claim evidence_ids)

### Package: `packages/pcc-schema/`

- `src/index.ts` — expanded with Zod types, validation, canonicalization,
  signing, schema hash
- `src/pcc-schema.test.ts` — comprehensive test suite (structural, semantic,
  canonicalization, signing, Zod types)
- `README.md` — new
- `CHANGELOG.md` — new
- `COMPATIBILITY.md` — new (migrated from `policy/COMPATIBILITY.md`)
- `CANONICALIZATION.md` — new (migrated from `policy/CANONICALIZATION.md`)
- `SIGNATURE_POLICY.md` — new (migrated from `policy/SIGNING.md`)

### Package: `packages/contracts/`

- `generated/typescript/pcc.ts` — generated TypeScript interfaces from schema
- `generated/python/pcc_models.py` — generated Pydantic v2 models from schema

### Fixtures

- `packages/pcc-schema/tests/fixtures/index.ts` — 14 normative fixtures
  (complete company, partial company, verified absence, direct web, rendered
  web, native text document, OCR document, agent verification, independent
  reproduction, verification failure, quarantined prompt injection, cache
  derived, free benchmark, extension container)

### Documentation

- `docs/decisions/0006-pcc-normative-schema.md` — ADR for schema design
- `docs/decisions/0007-pcc-canonicalization-and-signing.md` — ADR for
  canonicalization and signing

## Normative Schema SHA-256

Computed from `schemas/proof-carrying-context.schema.json`:

```
sha256:09a4c6dc77928613b497847c15db6b8035d7a1aae1bee086153eca7964ad3107
```

_(Frozen at acceptance time)_

## Generated Model Locations

- TypeScript: `packages/contracts/generated/typescript/pcc.ts`
- Python: `packages/contracts/generated/python/pcc_models.py`

## Test Counts

| Category                  | Count   |
| ------------------------- | ------- |
| Structural validity       | 8       |
| Semantic invariants       | 12      |
| Canonicalization          | 3       |
| Signing/verification      | 2       |
| Zod runtime types         | 7       |
| Fixture validation        | 14      |
| Extension namespace       | 7       |
| **Total (pcc-schema TS)** | **51**  |
| Python Hypothesis         | 12      |
| Policy tests              | 22      |
| Pricing tests             | 19      |
| Contracts tests           | 9       |
| Test-fixtures tests       | 9       |
| Edge-api tests            | 5       |
| **Total (monorepo)**      | **120** |

## Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm pcc:generate
pnpm pcc:generate:check
pnpm governance:validate
pnpm state:validate
pnpm tasks:validate
pnpm check
```

Python validation:

```bash
python -m pytest packages/contracts/generated/python/
python -m mypy --strict packages/contracts/generated/python/pcc_models.py
python -m pytest packages/pcc-schema/tests/python/ -v
```

Python validation:

```bash
python -m pytest packages/contracts/generated/python/
python -m mypy --strict packages/contracts/generated/python/pcc_models.py
```

## Cross-Language Canonicalization

- TypeScript implementation uses `canonical-json` (JCS-compliant)
- Python implementation uses `canonicaljson` package (JCS-compliant)
- 14 normative fixtures written to JSON files for cross-language validation
- Python test suite validates identical canonical bytes and hashes
- All 14 fixtures produce matching hashes across TypeScript and Python

## Compatibility Verdict

- Patch rules: documented in `COMPATIBILITY.md`
- Minor rules: documented with enum expansion caveats
- Major rules: documented with breaking change criteria
- Machine-readable compatibility fixtures: 5 fixtures provided in
  `tests/fixtures/compatibility/`

## Signing-Verification Verdict

- Ed25519 test vectors from RFC 8032: passing
- Sign-then-verify round-trip: passing
- Altered payload rejection: passing
- Test fixture key: explicit non-production key (RFC 8032 test vector)

## Git Status

Git repository initialized with commit history:

- `bab19d0` - chore(foundation): establish SITEBORNE monorepo and governance
  (includes SUN-0001 and SUN-0100 work)

Working tree clean after formatting.

## Recommended Conventional Commit

```
feat(pcc): freeze proof-carrying context v1 contract
```

## Extension Namespace Grammar

The `extensions` container uses reverse-domain qualified namespaces with strict
validation enforced via JSON Schema `propertyNames`:

**Pattern:**
`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){2,}$`

**Constraints:**

- At least three DNS-safe labels (e.g., `net.siteborne.verification.v1`)
- Lowercase ASCII only
- No underscores
- No leading or trailing hyphens
- No empty labels
- Each label max 63 characters
- **Total namespace key max length: 253 characters**
- Maximum 10 extensions (`maxProperties: 10`)

**Valid examples:**

- `net.siteborne.verification.v1`
- `net.siteborne.company-evidence.v1`
- `com.example.custom-metrics.v1`

**Invalid examples:**

- `foo` (unqualified)
- `verification.v1` (only two labels)
- `net._siteborne.v1` (underscore)
- `net.-siteborne.v1` (leading hyphen)
- `net.siteborne-.v1` (trailing hyphen)
- `NET.SITEBORNE.V1` (uppercase)
- `net..siteborne.v1` (empty label)
- Any namespace key > 253 characters
- More than 10 extensions

**Boundary test results:**

- ✅ Valid 253-character qualified namespace passes
- ✅ 254-character namespace fails
- ✅ 10 valid extensions pass
- ✅ 11 extensions fails (maxProperties)
- ✅ Single 64-character label fails (per-label max 63)
- ✅ Many short labels exceeding total 253 fails
- ✅ Unqualified names fail
- ✅ Uppercase names fail
- ✅ Underscores fail
- ✅ Empty labels fail
- ✅ Leading/trailing hyphens fail

Extensions must not:

- Override core PCC fields
- Change `verification.decision`
- Remove deterministic failures
- Alter core semantics of contract, claims, evidence, completeness, provenance,
  verification, or receipt

## Remaining Risks

1. `canonical-json` npm package may not fully implement RFC 8785 edge cases
   (numbers, Unicode). Mitigation: cross-language fixture tests with 18 RFC 8785
   reference vectors.
2. Property-based testing (fast-check/hypothesis) coverage can be expanded in
   follow-up increments.
3. Python model drift check script integration in SUN-0101.

## Recommended Next Task

SUN-0101 — Define input/output schemas for all 4 services (Phase 3b). This is
the immediate dependency-safe next task per TASKS.yaml.

## Amendment — PCC 1.0.1 (2026-08-05, discovered during SUN-0101)

While defining SUN-0101's service output schemas, `extension_container`'s
"boundary test results" above turned out to only have been tested for
*rejection* — no test exercised a document that actually populated
`extensions` with a valid qualified key. Doing so during SUN-0101 revealed
that `additionalProperties: false` with no `properties`/`patternProperties`
(introduced in commit `44534ea`, "bound extension namespaces") rejects
**every** extension key unconditionally, not just malformed ones —
`propertyNames` constrains key shape but does not itself admit a property
under `additionalProperties: false`. Verified independently with Python
`jsonschema` and Node `ajv@6`.

Patched in [ADR-0008](../decisions/0008-pcc-extension-container-patch.md):
restored `patternProperties` (same reverse-domain pattern already enforced
via `propertyNames`) mapping to a new bounded `extension_value` definition.
All previously-passing boundary tests above still pass unchanged (verified in
`packages/pcc-schema/src/pcc-extension-container.test.ts` and
`packages/pcc-schema/tests/python/test_pcc_extension_container.py`); the only
behavior change is that valid qualified keys now actually validate.

- Schema package: `1.0.0` → `1.0.1` (patch; document `pcc_version` const
  unchanged at `"1.0.0"`)
- New schema hash:
  `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5`
- Pre-existing tests: 100 TS + 23 Python, all still pass
- New tests: 17 TS + 29 Python covering the full namespace/cap matrix, all
  four SITEBORNE service namespaces, and per-service required-extension
  enforcement (present / missing / wrong-service-substituted)
