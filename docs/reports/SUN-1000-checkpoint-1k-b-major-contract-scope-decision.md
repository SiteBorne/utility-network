# SUN-1000 Checkpoint 1K-B — Defect-B Major Contract Release Scope Decision

**Status:** Analysis only. No contract mutation, no `2.0.0`, no `.v2` service
IDs, no chaos, no load. **HEAD at start and end:** `9156aa2` (unchanged — this
checkpoint made zero commits to contract, generator, or runtime files; only this
report and `TASKS.yaml` evidence were added).

---

## 1. Question

Defect B (the `StructuredError` 400/402 response-schema mismatch, classified
`MAJOR_CONTRACT_RELEASE` in Checkpoint 1J and left explicitly unresolved) is
authorized only as an _analysis_ target this checkpoint. The specific question:
does the frozen `error_contract_changed` / major classification require **only**
a new Service Contract Release (`2.0.0`), or **also** new Service API major
identities (`.v2`) for the affected services?

Two candidate outcomes, as specified in the directive:

- **A — `CONTRACT_2_ONLY_SERVICE_V1_STABLE`**
- **B — `CONTRACT_2_AND_SERVICE_V2_REQUIRED`**

---

## 2. What defect B actually is

Verified directly against the runtime and the generated OpenAPI artifact at
`HEAD 9156aa2`:

- Every one of the 4 service operations' `400` and `402` responses in
  `packages/contracts/generated/openapi/service-contracts.openapi.json`
  reference the **same shared common schema**,
  `#/components/schemas/StructuredError`
  (`schemas/common/structured-error.schema.json`) — required fields `error_id`,
  `error_code`, `category`, `message`, `retryable`, `request_id`, `service_id`,
  `occurred_at`.
- The actual runtime (`apps/edge-api/src/control-plane/routes/x402-service.ts`,
  the single shared route builder `createX402ServiceRoute` mounted identically
  for all 4 services) never emits that shape:
  - `400` responses use `jsonError()`: `{ error, message, details? }`.
  - `402` responses (the x402 payment-required challenge) use:
    `{ error: 'payment_required', x402_version, quote_id, requirement_id }`.
- This has been true since the routes were first built — not a regression
  introduced by 1K-A or any prior checkpoint. Both shapes are completely
  different from `StructuredError`: different required fields, different field
  count, different semantics.
- Because `createX402ServiceRoute` is one shared function mounted for all 4
  services, and `StructuredError` is one shared common-schema `$ref` used by all
  4 services' `400`/`402` responses identically, this is not an isolated
  per-service defect — it is a single shared error-contract declaration, wrong
  identically across the entire service surface.

## 3. Applying the frozen policy literally

Per the explicit instruction not to assume an outcome, I read the governing text
directly rather than inferring from Checkpoint 1J's classification alone.

- **`docs/contracts/COMPATIBILITY_POLICY.md` §4 (Change Taxonomy):**
  `error_contract_changed` → Default Compatibility: `major`. Min Bump: `major`.
  Human Review: `Yes`. **Parallel Major: `Yes`.**
- **§3.3 (Major Changes):** "Required-field additions... Field renames...
  Semantic reinterpretation... Changed service identity" are all listed as
  requiring major. Crucially: **"A major service change must use a new public
  service-major identifier (`.v2`)."** This sentence is unconditional — it is
  not qualified by "only if the service's own behavior changes," and the
  taxonomy table's own `Parallel Major` column exists specifically to flag which
  major-classified change types carry this consequence.
- **§12 (Human Approval Requirements table):** the row for "Major (all others)"
  — which is exactly where `error_contract_changed` falls, since it isn't
  `default_changed` (the one Patch row requiring only human review) — states:
  **"Human approval required + new service major identity."** This is the single
  most decisive line in the policy for this question: it does not say "new
  service major identity if the service's request/response body content itself
  changed for that consumer" or carve out documentation-only major changes. It
  universally pairs major approval with a new service-major identity.
- **§7.3 (Errors, Common Contract Freeze Rules):** flags "field removal" as
  compatibility-sensitive without qualification — again no carve-out for "the
  field was never actually true in practice."
- **§11 (Deprecation/Retirement):** confirms `.v1` and `.v2` are meant to
  coexist and that `.v1` "cannot be silently repointed to `.v2`" — reinforcing
  that a major service-identity change is a deliberate, explicit, additive act,
  not something the same `.v1` identifier can absorb.

**No clause anywhere in the policy grants defect B the kind of carve-out
Checkpoint 1J correctly found for defect A.** Defect A qualified for
`PATCH_REPAIR` specifically because §3.1 lists "generator bug fixes producing
semantically identical models" and "correction of invalid examples without
changing valid instance semantics" as explicitly patch-compatible, _and_ because
the old `$ref`s were provably never resolvable by any standards- compliant
consumer. Defect B has no equivalent textual carve-out: `StructuredError` **is**
a real, resolvable schema (Checkpoint 1J's §10 already established this
distinction), so the "never validly relied upon" argument does not extend to it.
The policy's taxonomy table classification is not merely a "conservative default
requiring human review" here the way it can be for some other findings — its own
explicit `Parallel Major: Yes` column, its own §3.3 sentence, and its own §12
approval-table row all independently and consistently point the same direction,
with no countervailing text.

## 4. Scope of the required `.v2` (why "also" and not "only one service")

Since `StructuredError` is one shared common schema referenced identically
across all 4 service operations' `400`/`402` responses (§2 above), correcting it
changes the declared error contract of **all 4 services simultaneously**, not
one. There is no basis in the policy or in the artifact structure to scope the
required new service-major identity to fewer than all 4 currently- affected
services: `company_evidence_graph`, `web_context_verified`,
`document_evidence_json`, `verify_agent_output`.

## 5. Synthetic compatibility test (proving the 1K-A machinery still catches real drift)

Before relying on `compat:check`/`release:verify` for anything in this analysis,
I verified directly that Checkpoint 1K-A's generalization (deriving the ongoing
comparison baseline from the active descriptor's own declared version, rather
than a permanent hardcoded `1.0.0`) did not accidentally create a tautology
where the live tree is compared against a snapshot of itself and always
trivially passes.

**Test:** temporarily mutated
`packages/contracts/generated/openapi/service-contracts.openapi.json`'s
`info.title` (appended `" SYNTHETIC-DRIFT-TEST"`), leaving
`contracts/CONTRACT_RELEASE.yaml` and the frozen `contracts/releases/1.0.1/`
snapshot untouched, then ran `pnpm contracts:compat:check`.

**Result:** failed correctly —

```json
{
  "baseline_version": "1.0.1",
  "candidate_version": "1.0.1",
  "compatible": false,
  "required_version_bump": "major",
  "changes": [
    {
      "affected_file": "openapi/service-contracts.openapi.json",
      "affected_schema_path": "info.title",
      "classified_change_type": "property_type_changed",
      "compatibility_direction": "incompatible",
      "required_version_bump": "major",
      "human_review_required": true
    }
  ],
  "verdict": "fail"
}
```

Command exited non-zero. The check correctly diffs the **live working tree**
against the **frozen, read-only** `contracts/releases/1.0.1/` snapshot directory
— not against another live-tree copy of itself — so an unauthorized change to
the live generated artifacts is still caught even though the ongoing baseline
path is now dynamically derived. Reverted the file immediately after (`cp` from
a pre-test backup); confirmed `git status --short` returned empty and
`pnpm contracts:compat:check` passed cleanly again afterward. No residual change
from this test survives in the tree.

This satisfies the directive's requirement to prove the generalized 1K-A
machinery still functions as a real enforcement gate before basing any further
decision on its output.

## 6. Cascade risk if `.v2` is required (why this matters more than chaos right now)

Confirmed by direct repository search — all of the following key on the literal
`.v1`-suffixed service ID string and would need explicit, coordinated handling
if `.v2` identities are introduced:

- **x402 routing:** `apps/edge-api/src/control-plane/routes/x402-service.ts`,
  `paid-services.ts` — `service_id`/`service_version: 'v1'` embedded directly in
  quote construction and payment-requirement binding.
- **Nevermined:** `packages/protocol-nevermined/src/declarations.ts` and its
  registration/settlement tests key plan and agent declarations off these same
  service IDs.
- **D1 bindings / fixtures:**
  `packages/service-runtime/fixtures/SERVICE_FIXTURE_MATRIX.yaml`, cross-service
  tests, and D1-backed payment-attempt/result repositories all reference the
  `.v1` IDs as literal keys.
- **MCP server:** `packages/mcp-server` (including its packed/dist build)
  registers tools against these same service identities.
- **Registry metadata:** `registry/services/*.v1.json` — the 4 frozen service
  metadata records this checkpoint's own compat tooling already treats as part
  of the release.

None of this was touched or needs to be touched in 1K-B — it is analysis
evidence for why, if branch B applies, the next step must be a **coordinated
migration plan**, not an immediate in-place edit.

## 7. Decision

**Branch B: `CONTRACT_2_AND_SERVICE_V2_REQUIRED`.**

The frozen policy's own text — the `error_contract_changed` taxonomy row's
`Parallel Major: Yes`, §3.3's unconditional "a major service change must use a
new public service-major identifier," and §12's approval-table pairing of every
non-`default_changed` major classification with "new service major identity" —
leaves no textual basis for scoping this to contract-release-only. Unlike defect
A, defect B has no "never validly resolvable" carve-out: the declared schema is
real and resolvable, just never true, and the policy treats "field
removal"/error-shape changes as compatibility-sensitive without a
not-yet-relied-upon exception. The required identity change applies to all 4
currently-affected services, since all 4 share the single incorrect
`StructuredError` `$ref`.

Per the directive: **this is a stop, not a start.** Branch B requires a
coordinated migration plan — touching already-accepted x402, Nevermined, D1,
MCP/A2A, and future discovery/publication architecture — before any
implementation, not an immediate in-place edit alongside a `2.0.0` bump.

## 8. What did NOT happen this checkpoint

- No `2.0.0` contract release created.
- No `.v2` service IDs created anywhere (x402, Nevermined, D1, MCP, A2A,
  registry metadata).
- No schema, generator, runtime, or compat-tooling file modified (the
  synthetic-drift-test edit in §5 was reverted before this report was written;
  `git status --short` is empty).
- No chaos or load testing started.
- `contracts/releases/1.0.1` (Checkpoint 1K-A's accepted patch release) remains
  the current, unmodified active release.

## 9. Recommended next step

A dedicated migration-planning checkpoint (not implementation) that maps: the
full `.v1`→`.v2` blast radius identified in §6, whether `.v2` services can be
introduced as a **parallel, additive** surface alongside `.v1` (per §11's
explicit coexistence model — `.v1` is not retired, just no longer the sole
current identity) rather than a replacement, and whether the `2.0.0` contract
release should bundle only defect B or also formally document the
now-two-major-version service surface. Only after that plan is accepted should
implementation begin.
