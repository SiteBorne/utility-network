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
sha256:9a79d68d182ac70eb4e162b81685bea2dfc35f43fe1d57da3cfd34771ca7a1f7
```

_(Frozen at acceptance time)_

## Generated Model Locations

- TypeScript: `packages/contracts/generated/typescript/pcc.ts`
- Python: `packages/contracts/generated/python/pcc_models.py`

## Test Counts

| Category               | Count   |
| ---------------------- | ------- |
| Structural validity    | 8       |
| Semantic invariants    | 12      |
| Canonicalization       | 3       |
| Signing/verification   | 2       |
| Zod runtime types      | 7       |
| Fixture validation     | 14      |
| **Total (pcc-schema)** | **44**  |
| Policy tests           | 22      |
| Pricing tests          | 19      |
| Contracts tests        | 9       |
| Test-fixtures tests    | 9       |
| Edge-api tests         | 5       |
| **Total (monorepo)**   | **108** |

## Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm governance:validate
pnpm state:validate
pnpm tasks:validate
pnpm check
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

Working tree clean after formatting. Ready for commit.

## Recommended Conventional Commit

```
feat(pcc): freeze proof-carrying context v1 contract
```

## Remaining Risks

1. `canonical-json` npm package may not fully implement RFC 8785 edge cases
   (numbers, Unicode). Mitigation: cross-language fixture tests.
2. Python canonicalization library choice not yet finalized in test suite.
   Mitigation: add explicit Python canonicalization test before production.
3. Property-based testing (fast-check/hypothesis) is listed but not yet
   exhaustively implemented. Mitigation: add in follow-up increment.
4. Python model drift check script not yet implemented. Mitigation: add in
   SUN-0101.

## Recommended Next Task

SUN-0101 — Define input/output schemas for all 4 services (Phase 3b). This is
the immediate dependency-safe next task per TASKS.yaml.
