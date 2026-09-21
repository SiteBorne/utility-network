# Result PCC Wire Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-default `.v3` candidate release whose successful result is a
governed, durable, self-verifying full PCC while preserving all `.v2` behavior
and economics.

**Architecture:** Freeze PCC 2.0.0 and Service Contract 3.0.0 as parallel
immutable candidate artifacts, then derive runtime authority from those
artifacts. Promote the qualified vNext reference model into one shared proof
core; route only `.v3` identities through it; persist the exact PCC with an
explicit record format; keep public-class activation selectable and
buyer-authorized activation blocked pending result authorization.

**Tech Stack:** TypeScript, Vitest, Ajv, RFC 8785/JCS, Ed25519 via
`@noble/ed25519`, Cloudflare Workers/D1/R2 abstractions, JSON Schema, OpenAPI,
Python `rfc8785` cross-checks.

**Spec:** `docs/reports/RESULT-WIRE-BODY-DELIVERY-DESIGN-01.md` plus the
user-supplied `RESULT-PCC-WIRE-CUTOVER-01` checkpoint.

## Global Constraints

- Starting commit is `4a0bb007c160bbf8da7fffc6db679b232b84f1f7`; preserve the
  existing stash without applying, dropping, or overwriting it.
- PCC release is `2.0.0`, Service Contract release is `3.0.0`, and service
  identities are the four `.v3` IDs from the checkpoint.
- Full PCC is the wire root; no outer envelope; proof namespace is
  `net.siteborne.verification-proof.v1`; signing domain is
  `SITEBORNE-PCC-VERIFICATION-PROOF-V1`.
- `.v2` remains default and byte-reproducible; `.v3` requires explicit governed
  release selection.
- No deploy, push, real payment, production D1 write, secret mutation, traffic
  mutation, or historical result synthesis.
- Company and web are public-class; document and verify remain
  activation-blocked without result authorization.

## Review Focus

- Any `.v3` path that can settle before schema validation, proof verification,
  and persistence readiness must fail closed in a pre-settlement test.
- Any buyer-authorized `.v3` result without result-auth enforcement must be
  rejected before execution/replay.
- Any omitted release selector must resolve to existing `.v2` behavior, not
  `.v3`.
- Any tampering with output, verification outcome/score, service identity, proof
  version, receipt identity, or signature must fail verification.
- Any cached/reloaded vNext result must be byte/semantic identical to the
  initial full PCC while a legacy record remains a flat legacy receipt.

---

### Task 1: Freeze candidate release artifacts and validators

**Files:**

- Create: `contracts/releases/3.0.0/**`
- Modify: candidate schema/validator registries under
  `packages/verification/src/` and
  `packages/protocol-mcp/src/frozen-contracts.ts`
- Test: `packages/contracts/src/contracts.test.ts`,
  `packages/pcc-schema/src/pcc-schema.test.ts`, and a new candidate-release test
  beside them

**Interfaces:**

- Produces: immutable PCC 2.0.0 schema hash, Contract 3.0.0 descriptor, four
  `.v3` output validators, and exact per-service schema hashes.
- Consumes: Release 2 immutable bytes for unchanged input/output schemas and
  repository compatibility rules.

- [ ] Add a failing release test that resolves all four `.v3` rows, validates
      their hashes against bytes, requires the governed proof namespace, and
      asserts Release 2 SHA256SUMS are unchanged.
- [ ] Run the focused test and confirm failure because Release 3 and `.v3`
      validators do not exist.
- [ ] Create Release 3 mechanically from Release 2, change only governed
      identity/PCC-proof semantics, recompute actual
      hashes/manifests/SHA256SUMS, and add candidate validator imports without
      changing active Release 2 selection.
- [ ] Run candidate release, compatibility, manifest, schema, and legacy
      release-integrity tests to green.

### Task 2: Promote the shared vNext proof core and `.v3` runtime identity

**Files:**

- Create: `packages/service-runtime/src/pcc/vnext-proof.ts`
- Modify: `packages/service-runtime/src/pcc/finalized-result.ts`,
  `verify-and-sign.ts`, `governed-metadata.ts`, `index.ts`, `types.ts`,
  registry/wiring files, and shared service version types.
- Test: `packages/service-runtime/src/tests/vnext-proof.test.ts` and
  `internal-result-artifact.test.ts`

**Interfaces:**

- Consumes: Task 1 governed release metadata and existing frozen
  `SemanticSnapshot`.
- Produces: `buildSelfVerifyingPcc`, `verifySelfVerifyingPcc`, exact full-PCC
  `wireBody`, typed vNext receipt, and `.v3` registry entries reusing existing
  business logic.

- [ ] Add failing tests for all four `.v3` services plus verify pass/non-pass,
      proof reconstruction, Ed25519 verification, placeholder rejection, tamper
      matrix, and unchanged `.v2` flat receipts.
- [ ] Run focused tests and confirm missing `.v3` identities/proof functions
      fail.
- [ ] Promote the reference model into production code using the existing
      canonicalizer, Unicode guard, code vocabulary, signer, and one signing
      implementation; gate it solely on governed `.v3` metadata.
- [ ] Add `.v3` types and registry entries sharing the existing service classes,
      with truthful Contract 3/PCC 2/schema/policy metadata and unchanged
      prices.
- [ ] Run service-runtime focused and affected suites to green, including
      TypeScript/Python byte-vector equivalence.

### Task 3: Persist and replay the exact full PCC safely

**Files:**

- Modify: D1 result repository/migrations, paid continuation workflow, finalized
  outcome/persistence boundaries, and cache readers under
  `apps/edge-api/src/control-plane/`.
- Test: workflow, persistence, replay, lifecycle, and in-flight compatibility
  tests under `apps/edge-api/tests/`.

**Interfaces:**

- Consumes: Task 2 frozen full PCC and typed link-evidence inputs.
- Produces: explicit `LEGACY_RECEIPT_ONLY | SELF_VERIFYING_PCC_VNEXT` record
  format and lossless exact-PCC storage/reference.

- [ ] Add failing tests that require pre-settlement schema/crypto/persistence
      readiness, exact initial/cached equality, explicit legacy branching, and
      fail-closed handling of cached pre-artifact workflow steps.
- [ ] Run them and confirm the current receipt-only record path fails.
- [ ] Implement the smallest existing-storage-compatible representation that
      covers measured maximum PCC size; record whether D1 inline JSON or
      existing R2 artifact reference is selected and make post-settlement
      persistence failure explicit/recoverable.
- [ ] Run D1, workflow, replay, continuation, and size qualification tests to
      green without production writes.

### Task 4: Wire candidate protocols and activation gates

**Files:**

- Modify: service registries, pricing/contract/schema lookups, MCP, OpenAPI,
  A2A, catalog, Bazaar metadata, descriptors, and production dependency routing.
- Test: protocol MCP SDK, OpenAPI, A2A, catalog, pricing, replay binding,
  privacy projection, and default-selection tests.

**Interfaces:**

- Consumes: Task 1 candidate schemas and Task 3 durable result reader.
- Produces: explicit `.v3` candidate surfaces returning the same full PCC;
  public-class readiness and buyer-authorized activation denial.

- [ ] Add failing cross-surface tests for all four `.v3` identities, real MCP
      SDK structured-content acceptance, identical schema descriptions, `.v2`
      default selection, unchanged normalized economics/bindings, and
      buyer-authorized activation rejection.
- [ ] Run focused tests and confirm `.v3` surfaces are absent.
- [ ] Add shared `.v3` routing and metadata without copying business logic or
      changing prices, payment requirements, settlement amounts, replay fields,
      or `.v2` defaults.
- [ ] Run protocol and surface suites to green and scan public PCCs for the
      private-IP denylist.

### Task 5: Qualify, review, report, and commit locally

**Files:**

- Create: `docs/reports/RESULT-PCC-WIRE-CUTOVER-01.md`
- Modify: deterministic fixtures/goldens required by prior tasks.

**Interfaces:**

- Consumes: all preceding task evidence.
- Produces: final result block, bounded next checkpoint, independent review
  findings, and one or more local commits with a clean tree.

- [ ] Run focused tests, affected suites, typechecks, ESLint, Prettier, secret
      scan, release verification, and baseline comparisons for any broad-suite
      timeouts; do not count credential-gated skips.
- [ ] Dispatch an independent whole-branch reviewer against starting HEAD and
      fix every Critical/Important finding with RED-to-GREEN coverage.
- [ ] Write the report with exact evidence, storage/size/cutover/failure models,
      cloud mutation counters, and honest PASS/FINDING/BLOCKED fields.
- [ ] Re-run final verification, confirm the stash is preserved, commit locally,
      and do not push.
