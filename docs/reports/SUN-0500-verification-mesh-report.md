# SUN-0500 — Verification Mesh and Receipt Signing Foundation: Acceptance Report

## Summary

Implements a deterministic, dependency-aware, fail-closed verification mesh
(`packages/verification`) and Ed25519 receipt signing over its verdicts. Nine
verifiers are implemented: exactly the eight named in the master directive §21
("Schema verifier" through "Prompt-injection verifier"), plus
`reproduction_verifier`, derived from and only mandatory under the frozen
`independent_reproduction` contract mode / `governance/VERIFICATION_POLICY.yaml`
policy — not invented to pad a count (see
[ADR 0030](../decisions/0030-verification-mesh-boundary.md)). The mesh is
explicitly not a voting system: any mandatory verifier's blocking failure (or
absence) forces the decision away from `pass` regardless of how many other
verifiers passed (see
[ADR 0031](../decisions/0031-mesh-non-voting-fail-closed-aggregation.md)),
verified by both example-based and fast-check property tests.

## What was built

- **Types & mesh core** (`src/types.ts`, `src/graph.ts`, `src/mesh.ts`,
  `src/failures.ts`, `src/context.ts`): closed `VerificationResult` union,
  dependency topological sort with deterministic (lexicographic) tie-break and
  cycle/missing-dependency detection, wave-based parallel execution,
  per-verifier timeout enforcement, and fail-closed exception handling — nothing
  escapes `runMesh` as a raw throw.
- **Nine verifiers** (`src/verifiers/*.ts`): schema, evidence-accessibility,
  claim-evidence, freshness, completeness, cross-source, provenance,
  prompt-injection (reuses `@siteborne/provider-adapters`'s injection-signal
  detector), and reproduction (mode-gated, ADR 0034).
- **Schema registry** (`src/schema-registry.ts`): validates against the actual
  frozen `schemas/**` artifacts via Ajv 2020-12, including a fix registering the
  draft-07 meta-schema so the frozen `proof-carrying-context.schema.json`
  ($schema: draft-07) can still be
  `$ref`'d from the 2020-12 service output
  schemas within one Ajv instance.
- **Policy** (`src/policy.ts`, `governance/VERIFICATION_POLICY.yaml`):
  Zod-validated, hashed via the reused JCS canonicalizer, and cross-checked
  against the actual verifier code by `scripts/verify-policy.ts` so the policy
  document and code can never silently diverge.
- **Receipt signing** (`src/receipt/*.ts`): canonical receipt preimage binding
  job/service/contract identity plus verifier-set and evidence-set hashes (ADR
  0032), Ed25519 signing via `@noble/ed25519` directly (ADR 0033), a
  `KeyRegistry` with active/retiring/retired/revoked lifecycle, and a pure local
  `verifyReceipt` with a closed status union covering every tamper/misuse case
  (unknown key, revoked key, receipt-id mismatch, context mismatch, malformed
  receipt, unsupported algorithm, invalid signature).
- **Fixture corpus** (`fixtures/`): 5 candidate JSON fixtures generated from a
  shared, schema-valid builder, each with a documented expected decision in
  `FIXTURE_MATRIX.yaml`, checked by `scripts/verify-fixtures.ts` as a behavioral
  regression gate (not a file-existence check).
- **Tests**: 76 example-based tests across 15 files (one per verifier, plus
  graph, mesh non-voting guarantees, receipt/signing/tamper-evidence, policy,
  canonical), plus 3 fast-check property tests — one sweeping all 2⁸
  pass/blocking-fail combinations across the 8 mandatory standard-mode
  verifiers, asserting the decision is `pass` iff zero of them failed; another
  confirming a numeric majority (up to 7 of 8 passing) can never produce `pass`.
- **Documentation**: 6 ADRs (0030–0035) and 4 operations guides
  (`VERIFICATION_MESH.md`, `VERIFICATION_RECEIPTS.md`, `KEY_ROTATION.md`,
  `INDEPENDENT_REPRODUCTION.md`).
- **Root wiring**:
  `verification:{test,test:property,fixtures:verify, policy:verify,benchmark,check}`
  scripts, folded into root `pnpm check`; `@siteborne/verification` added to the
  root/package-local Vitest cross-package aliases and `tsconfig.base.json` path
  map (already present); CI updated with a "Verification mesh checks" step.

## Fixed along the way

- `packages/verification/tsconfig.json` initially set an explicit `rootDir` that
  conflicted with cross-package source imports pulled in via path mapping
  (`@siteborne/provider-adapters`); resolved by dropping the override, matching
  `apps/edge-api/tsconfig.json`'s working pattern.
- Vite (used by Vitest) resolves `node_modules` packages by
  `package.json`/`exports`, not by TypeScript `paths` — `@siteborne/pcc-schema`
  and `@siteborne/provider-adapters` needed explicit `alias` entries in both
  `vitest.config.ts` (root) and `packages/verification/vitest*.config.ts`.
- `@siteborne/pcc-schema`'s synchronous `canonicalize()` requires
  `loadCanonicalJson()` to have completed first;
  `packages/verification/src/canonical.ts` now does this once via top-level
  `await` so every consumer can call `canonicalize()` synchronously without
  knowing about the async init step.
- The frozen PCC schema declares `$schema: draft-07` while every other schema in
  the repo declares 2020-12; a single Ajv2020 instance throws on `addSchema` for
  the draft-07 document unless the draft-07 meta-schema is also registered —
  fixed via `ajv.addMetaSchema(draft07MetaSchema)` in `schema-registry.ts`.

## Explicitly out of scope (per directive)

- SUN-0400B (Modal deployment) was not started.
- No payments, x402, settlement, refunds, MCP, A2A, Nevermined, marketplace
  publication, or production activation.
- No production signing key was created, registered, or used anywhere — every
  key in tests/fixtures is `environment: 'test'`, ephemeral, and never persisted
  (see ADR 0033).
- No live reproduction execution — `reproduction_verifier`'s contract is
  implemented and tested; supplying a real, non-null `ReproductionInput` from an
  actual second execution is future scope (see ADR 0034).
- Production key custody, HSM/KMS integration, and an operational rotation
  procedure are documented as non-blocking follow-ups
  (`docs/operations/KEY_ROTATION.md`), not implemented here.

## Validation performed

All from repo root unless noted:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` — pass (14/14 turbo
  packages, including the new `@siteborne/verification`).
- `pnpm test` — 612 tests passed, 6 skipped (live-gate opt-ins), 0 failed,
  across 42 test files including all 15 new `packages/verification` files.
- `pnpm verification:check` — format/lint/typecheck/test/test:property/
  fixtures:verify/policy:verify, all pass (76 unit/integration tests + 3
  property tests + 5 fixture-matrix checks + policy/code cross-check).
- `pnpm pcc:generate:check`, `pnpm services:generate:check`,
  `pnpm openapi:generate:check` — no drift.
- `pnpm governance:validate` (77/77), `pnpm state:validate` (28/28),
  `pnpm tasks:validate` (221/221) — all pass.
- `pnpm contracts:baseline:verify`, `contracts:compat:check`,
  `contracts:release:verify`, `migrations:verify`, `d1:test`,
  `control-plane:test`, `control-plane:check` — all pass (pre-existing,
  unaffected by this change; re-run as part of full `pnpm check`).
- `pnpm adapters:check` — 103/103 fixture-matrix rows, all pass (pre-existing,
  unaffected; re-run as part of full `pnpm check`).
- `pnpm document-worker:check`, `document-worker:fixtures:verify` — ruff, mypy,
  81 pytest tests, Modal-import isolation check, fixture manifest — all pass
  (pre-existing, unaffected; re-run as part of full `pnpm check`).
- `pnpm secrets:scan` (gitleaks) — no leaks found (~643 MB scanned).
- Full `pnpm check` (root, all of the above end to end) — **passes**.

## Status

Accepted. `TASKS.yaml` SUN-0500 status updated to `accepted` with this commit's
ref; `PROJECT_STATE.yaml` `last_completed_increment` advanced to `SUN-0500`.
