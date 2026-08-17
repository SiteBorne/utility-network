# SUN-1000 Checkpoint 1J — OpenAPI Contract Correction / Versioning Decision

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`0f07f09` (Checkpoint 1I — Schemathesis `FAIL_INTERNAL`, 12 real, triaged
`OPENAPI_DEFECT` findings; Trivy `BLOCKED_EXTERNAL`). **This checkpoint is
versioning/governance/compatibility analysis only.** Zero mutation to the
canonical OpenAPI artifact, generator, `contracts/releases/*`, release version,
service-major IDs, or runtime behavior. No chaos/load, no OpenTelemetry work, no
production action.

## 1. Baseline

`git status --short` empty, `HEAD = 0f07f09`. Guards absent.
`pnpm security:semgrep` PASS. `pnpm security:osv` PASS. `pnpm security:trivy`:
CRITICAL=0, HIGH=3 (unchanged, matching Checkpoint 1I).
`pnpm security:schemathesis`: exit 1, real campaign, same 12 findings
(unchanged). `pnpm secrets:scan`, `governance:validate`, `state:validate`,
`tasks:validate`, full `pnpm check` — all as expected. `security:release` not
required to pass (Trivy/Schemathesis both genuinely still failing/blocked).

## 2. Checkpoint 1I findings frozen, not reopened

Real HTTP server, fixture payment mode, 0 provider calls, 0 settlements, 4/4
implemented in-spec operations exercised, 36 generated cases, 0 unexpected 5xx,
12 response/schema failures, 2 root OpenAPI defects, 0 application defects. The
in-memory `$ref` patch used by the harness remains explicitly test-only
evidence, not a proposed permanent fix.

## 3. Governing sources read in full

`docs/decisions/0012-service-contract-release-versioning.md`,
`docs/decisions/0013-contract-compatibility-classification.md`,
`docs/decisions/0014-frozen-baseline-and-change-enforcement.md`,
`docs/decisions/0015-strict-consumer-compatibility-model.md`,
`docs/contracts/COMPATIBILITY_POLICY.md` (the normative policy document,
effective 2026-08-05), `contracts/releases/1.0.0/`,
`packages/contracts/scripts/compat.ts`,
`packages/pcc-schema/scripts/drift-check-openapi.ts`. The master directive
itself contains no contract-versioning policy text — the authority lives
entirely in the ADRs and `COMPATIBILITY_POLICY.md`.

## 4. The three version axes are explicitly independent

Confirmed directly from ADR 0012 and `COMPATIBILITY_POLICY.md` §2:

1. **PCC Schema Release** (currently `1.0.1`) — the PCC package/schema version.
2. **Service Contract Release** (currently `1.0.0`) — covers all 17 canonical
   schemas, generated models, OpenAPI artifacts, metadata.
3. **Service API Versions** (`.v1`) — the stable public per-service identifiers.

Verbatim, load-bearing: **"Release version `1.0.0` may receive compatible
patch/minor releases within service major `v1`. A breaking change requires a new
service-major identifier (`.v2`)."** These are genuinely separate axes — a
contract-release version bump does **not** automatically require a service-major
bump; only a change independently classified as _breaking to a specific service_
requires `.v2` for that service.

## 5. Defect A — `$ref` naming mismatch — reproduced and root-caused

**Confirmed invalid, not merely "wrong": a standards-compliant OpenAPI resolver
cannot resolve these references at all** (proven by direct execution —
Schemathesis's own real error:
`"Reference: #/components/schemas/CompanyEvidenceGraphInput. Component does not exist in the schema."`,
for all 4 operations' request and response schemas — 8 unresolvable `$ref`s
total).

**Root cause, more precisely characterized than in Checkpoint 1I**: this is a
**three-way naming disagreement**, not a simple two-way typo. Each affected JSON
Schema source file (e.g. `schemas/services/company-evidence-input.schema.json`)
has its own `title` field (`"Company Evidence Graph Input"`) distinct from its
filename (`company-evidence-input`). Three independent generators each derive a
name differently:

- **OpenAPI path `$ref`s** (`generateServiceContractsOpenAPI`, prior to
  Checkpoint 1G's later per-service-ID string derivation) →
  `CompanyEvidenceGraphInput` (service-ID-slug-derived).
- **Python generated models** (`datamodel-codegen`, driven by the schema's own
  `title` field) → class `CompanyEvidenceGraphInput` — **agrees with the OpenAPI
  `$ref`**.
- **`service-components.json`'s own registered key**
  (`generateServiceComponents()`, filename-derived) → `CompanyEvidenceInput` —
  **the outlier**, agreeing with neither of the other two.

**This changes the most consistent fix direction from what Checkpoint 1I
assumed**: 1I's ephemeral patch moved the `$ref` _down_ to match
`service-components.json`'s filename-derived key. The more internally-consistent
repair (§17) is the reverse: rename `service-components.json`'s registered keys
to the title-derived form, matching the OpenAPI `$ref`s **and** the
already-independently-correct Python models. Either direction produces a valid,
resolvable document; this does not change the semver analysis (§7 below), since
the underlying JSON Schema _content_ is identical either way — only which string
labels it.

**Answer to the load-bearing §5 question**: **B — a generator/artifact defect
that never described a valid resolvable schema.** Not A (not an intended
historical contract) — confirmed by direct, standards-based resolution failure,
not by preference.

## 6. Defect B — 400/402 response schema mismatch — reproduced and root-caused

For all 4 operations, the OpenAPI document declares `400` and `402` responses as
`#/components/schemas/StructuredError` (the canonical, fully-featured error
envelope: `error_id`, `error_code`, `category`, `message`, `retryable`,
`request_id`, `service_id`, `occurred_at`, all required,
`additionalProperties: false`).

**Real deterministic runtime response** (confirmed via direct `curl` against the
live fixture-mode server in Checkpoint 1I, and via the real Schemathesis
campaign's captured bodies):

- `400`:
  `{"error": "invalid_request", "message": "...", "details": {"errors": [...]}}`
  — a simpler, ad-hoc validation-error shape.
- `402`:
  `{"error": "payment_required", "x402_version": 2, "quote_id": "...", "requirement_id": "..."}`
  — the genuine x402 protocol `PaymentRequired` challenge shape, already
  independently specified and extensively tested elsewhere
  (`@siteborne/protocol-x402`, `packages/protocol-x402/src/replay/`, SUN-0700A's
  own deep test suite).

`StructuredError` **is a real, existing, resolvable schema** — unlike defect A,
there is no "this never validly resolved" argument available here.

## 7. Canonical side, per defect

- **Defect A: neither side is "canonical" in the compatibility sense — the
  reference was simply broken.** Repairing it changes nothing about what any
  consumer could ever have validly done. Not a
  `RUNTIME_IS_CANONICAL`/`CONTRACT_IS_CANONICAL` question at all.
- **Defect B: `RUNTIME_IS_CANONICAL`.** The 402 x402 challenge shape is a
  separately, independently specified and already-frozen protocol contract
  (`@siteborne/protocol-x402`) — the OpenAPI document's `StructuredError`
  declaration for 400/402 was never accurate and does not reflect any
  intentional, tested behavior. Correcting the document to describe the real
  shape is the right direction; changing the runtime to match `StructuredError`
  instead would be the wrong direction (it would require rewriting the
  already-tested x402 challenge/validation-error format, a materially larger and
  riskier change touching real protocol code, not just documentation).

## 8. Why the compatibility verifier flags "major"

Reproduced directly: applying the (reverted) `$ref` fix from Checkpoint 1I
against the frozen `1.0.0` baseline, `contracts:compat:check` classifies both
the `$ref` changes and the (hypothetical) response-schema changes as
`reference_target_changed` — per `COMPATIBILITY_POLICY.md` §4's taxonomy table,
`reference_target_changed` has **default compatibility: major, min bump: major,
human review: yes**. **The verifier is a generic, mechanical
JSON-structural-diff classifier** — it detects "the string at this JSON pointer
changed" and applies the table's default rule; it has no semantic capability to
distinguish "this reference previously pointed at a different valid schema" (a
genuine breaking retarget) from "this reference never resolved to anything at
all" (an invalid-artifact repair). **This is not a bug in the verifier** —
`COMPATIBILITY_POLICY.md` §12 explicitly requires **human review for every
major/minor classification**; the table's "default compatibility" is a
conservative starting point for that review, not a final, unconditional verdict.
This checkpoint's analysis **is** that required human review.

## 9. Invalid-baseline repair policy — found, explicit, decisive

**Yes, explicit project policy exists** (not a governance gap).
`COMPATIBILITY_POLICY.md` §3.1 lists, as an **allowed patch-compatible change**:
**"Generator bug fixes producing semantically identical models"** and
**"Correction of invalid examples without changing valid instance semantics."**
Applied to defect A: the underlying JSON Schema content (properties, required
fields, types) referenced by both the broken and the repaired `$ref` is
**byte-for-byte identical** — only the `$ref` string pointer changes, from one
that never resolved to one that does, pointing at the same, unchanged schema
body. This is squarely "a generator bug fix producing a semantically identical
model." **Answer: fixing an invalid `$ref` does not require a major version — it
may be repaired in a patch release, because the previous reference could never
successfully resolve and therefore no consumer could ever have validly depended
on its specific (broken) target.**

## 10. Response-schema (400/402) compatibility analysis — separate from defect A

Evaluated independently, per this checkpoint's own explicit instruction not to
bundle the two defects semantically:

- **Narrows or widens accepted response shape?** Narrows: the corrected schema
  requires _fewer_ fields than `StructuredError` did (no
  `error_id`/`category`/`retryable`/etc.), replacing them with the real,
  different field set.
- **Changes required properties?** Yes — a completely different required-field
  set.
- **Changes discriminators/types?** The response is a genuinely different schema
  shape, not a narrower/wider version of the same one.
- **Changes only documentation?** No — the _declared_ schema changes materially,
  even though the _runtime_ behavior does not.
- **Changes actual runtime behavior?** No.

This is `error_contract_changed` per the taxonomy table — **explicitly major,
human review yes, parallel major required yes** — and **does not** benefit from
defect A's "never validly resolved" exception, because `StructuredError` **is**
a real, resolvable schema; a hypothetical strict consumer _could_ have been
built to validate against exactly that declared (if never-actually-deliverable)
shape.

## 11. Client impact

Searched the full repository for consumers of the broken names and the
`StructuredError` 400/402 declaration:

- `CompanyEvidenceGraphInput`/etc. (the broken OpenAPI names) appear only in:
  `contracts/releases/1.0.0/openapi/` (the frozen baseline itself),
  `packages/contracts/generated/openapi/` (the current, drift-checked artifact),
  `packages/contracts/generated/python/services/*.py` (Python codegen — using
  this name **independently**, not by resolving the OpenAPI `$ref`), and this
  checkpoint's own Schemathesis wrapper files. **No generated TypeScript client,
  no runtime code, no test file imports or resolves the OpenAPI `$ref` target at
  all** — the real server-side validation (`packages/protocol-x402`,
  `apps/edge-api/src/control-plane/routes/x402-service.ts`) uses its own
  independently-maintained input schemas (`BUNDLED_SERVICE_INPUT_SCHEMAS`),
  never the OpenAPI document's `$ref` graph.
- No generated OpenAPI client SDK exists anywhere in the repository.
- `grep` across `protocol-x402`, `protocol-nevermined`, `verification`,
  `protocol-mcp`, `protocol-a2a`, `mcp-server` for any reference to the broken
  names or `StructuredError`'s use on these specific paths: **0 matches** — the
  OpenAPI document is not itself consumed by any other part of this repository's
  runtime or protocol code.

## 12. Publication status

**Not publicly published.** All 4 affected operations (and
`/quotes/{service_id}`) are explicitly marked `'x-production-enabled': false` /
`'x-implementation-status': 'not_implemented'` directly in the OpenAPI document
itself — this is the document's own honest, self-declared status, not an
inference. No `publication_id`/`published_at` field exists in any of the 4
service metadata records under `contracts/releases/1.0.0/metadata/`. This is a
**repository-frozen release baseline only**, never distributed as a supported
external contract. This does not change the formal semver rules (§9's policy
applies regardless of publication), but it materially lowers real-world
compatibility risk for any correction.

## 13–14. Semver options and service-major impact

Both defects were evaluated against the six defined options independently (not
forced into one bucket):

**Defect A ($ref repair): `A. PATCH_REPAIR`.** Per §9's explicit policy
carve-out. No service-major bump implied — `COMPATIBILITY_POLICY.md` §2.3
requires `.v2` only for changes independently classified as breaking to that
specific service; a patch-classified change never triggers it.

**Defect B (400/402 correction): `C. MAJOR_CONTRACT_RELEASE`** per the literal,
unambiguous `error_contract_changed` table entry (§10), with
**`Parallel Major Required: Yes`** in the same table row — meaning the policy's
literal text does imply a service-major (`.v2`) requirement for the 4 affected
services if this correction proceeds under the strict reading. **This is
flagged, not silently applied or silently overridden** (§28): given (a) zero
evidenced consumers (§11), (b) the operations are explicitly
not-production/not-implemented (§12), and (c) no runtime behavior is changing at
all — only a previously-inaccurate document is being corrected to match
already-existing, already-tested runtime behavior — there is a genuine,
good-faith argument that this specific instance of `error_contract_changed` is
closer in _effect_ to "documentation clarification with no schema effect [on
runtime]" than to a true breaking change to a live, depended-upon contract.
**This checkpoint does not resolve that tension unilaterally** — it is presented
as an explicit architect decision point in §25/§28, not smuggled into either a
forced-major or forced-patch conclusion.

## 15. Payment/x402/Nevermined/PCC/receipt/PSL/D1 impact

**Zero impact, confirmed by direct search, not assumed.** `grep` for
`CompanyEvidenceGraphInput`/`CompanyEvidenceInput`/`StructuredError` across
`packages/protocol-x402/src`, `packages/protocol-nevermined/src`,
`packages/verification/src`: **0 matches** in all three. Pricing,
`Payment-Identifier`, x402 semantics, Nevermined semantics, `UsageResult`, PCC,
receipts, `PaymentServiceLink`, and D1 lifecycle code do not read, generate, or
depend on either the broken `$ref` names or the `StructuredError` 400/402
declaration in any way. No payment behavior change is smuggled into either
proposed correction.

## 16. MCP/A2A impact

**Zero impact, confirmed by direct search.** `grep` for the same terms across
`packages/protocol-mcp/src`, `packages/protocol-a2a/src`,
`packages/mcp-server/src`: **0 matches**. MCP service metadata and A2A Agent
Card/schemas are governed by their own separate, independent contract systems
(`mcp:spec:verify`, `a2a:spec:verify`) confirmed already in Checkpoint 1I §5 —
no generated/shared source relationship with this OpenAPI document exists.
`SUN-0800B` is not started.

## 17. Generator root-fix design (defect A) — not implemented

**Confirmed durable design**: derive every component name from a single
authoritative source used consistently by _all_ generators, rather than each
generator (OpenAPI paths, `service-components.json`, Python/TypeScript codegen)
independently re-deriving a name from a different input (service-ID slug vs.
filename vs. schema `title`). Given Python codegen already independently
converges on the `title`-derived form, and the OpenAPI `$ref`s already
(accidentally) use that same form, the **most internally-consistent fix is to
rename `generateServiceComponents()`'s registered keys to the title-derived
form** (the reverse of Checkpoint 1I's ephemeral $ref-lowering patch),
eliminating the three-way disagreement at its actual source rather than patching
one of the three independently-arrived-at names to match another. **Not
implemented this checkpoint.**

## 18. Response-schema root-fix design (defect B) — not implemented

**Confirmed durable design**: do not hand-author a second, disconnected
error-response schema inside `generate-openapi.ts`. The real x402
`PaymentRequired`/validation-error shapes are already formally defined in
`@siteborne/protocol-x402` (`packages/protocol-x402/src/`) — the generator
should reference (or generate a matching OpenAPI schema component from) that
existing, already-canonical source, rather than continuing to declare the
unrelated `StructuredError` envelope for these specific status codes. **Not
implemented this checkpoint.**

## 19. Expected artifact diff (modeled, not committed)

- `service-components.json`: 8 key renames (`CompanyEvidenceInput` →
  `CompanyEvidenceGraphInput`, etc.) — same schema bodies, new keys.
- `service-contracts.openapi.json`: 4 `summary` fields corrected (defect A's
  second-order effect, already isolated in Checkpoint 1I); 8 `$ref`s become
  resolvable automatically once the component keys above are renamed (no `$ref`
  string edit needed if §17's direction is chosen); 8 response-schema entries
  (400×4, 402×4) replaced with new, accurate schema components for defect B.
- New OpenAPI components required for defect B: a `ValidationError`- style 400
  schema and the real x402 `PaymentRequired` challenge schema (both currently
  undocumented in this file).
- **No unrelated generated drift expected** — `common-components.json` and all
  non-affected paths/schemas remain untouched, matching the precedent already
  proven in Checkpoint 1I's reverted, verified fix (which produced a 12-line,
  fully-isolated diff).

## 20. Future implementation test impact

`pnpm openapi:generate:check`, `pnpm contracts:baseline:verify`,
`pnpm contracts:compat:check` (against whichever baseline is authorized — see
§22), `pnpm security:schemathesis` (the decisive re-verification),
`pnpm x402:check` (defect B touches x402-adjacent schema description, though not
x402 code itself), full `pnpm check`. **Not** affected and not required:
Nevermined, service-runtime, MCP, A2A, PCC, receipt/PSL suites (confirmed
zero-impact in §15–§16).

## 21. Schemathesis expected effect

Fixing both defects is expected to eliminate all 12 currently-known findings:
defect A's fix resolves the schema-loading failure itself (the precondition for
any campaign to run against the _unpatched_ canonical file); defect B's fix
should make the 12 `response_schema_conformance` violations disappear, since the
corrected schemas would describe the real, already-observed response bodies.
**Not claimed as PASS until a real, future campaign against the corrected,
committed artifact proves it** — per this checkpoint's own explicit instruction.
**The temporary in-memory `$ref` patch (`patchKnownRefMismatches` in
`scripts/security/run-schemathesis.ts`) must be removed** once the canonical
artifact is corrected — expected outcome: yes, confirmed.

## 22. Contract baseline strategy (if C is authorized)

`contracts/releases/1.0.0/` must be preserved exactly as-is —
`COMPATIBILITY_POLICY.md` §13 requires it remain read-only after acceptance. A
new release directory, **`contracts/releases/2.0.0/`** (if the major path is
authorized) or **`contracts/releases/1.0.1/`** (if defect A is shipped alone as
a patch, independent of defect B), would be created following the existing
generation/acceptance process — not overwriting `1.0.0/`. Not created this
checkpoint.

## 23. Compatibility verifier strategy

**`NO_CHANGE`.** The verifier is functioning exactly as designed — it correctly
flagged the change for human review per its own governing policy (§8, §12). No
bug fix, no new baseline-only exemption, no policy rule change is needed to
_correctly classify_ the defects; what was missing was the human-review step
this checkpoint now performs. Compatibility enforcement is not weakened in any
way.

## 24. Migration/rollback design (for the future implementation checkpoint)

One isolated commit per defect (or one combined commit if both proceed together
under the same release), touching only:
`packages/pcc-schema/scripts/generate-openapi.ts`,
`packages/contracts/generated/openapi/*.json`,
`packages/contracts/generated/{typescript,python}/**` (regenerated, not
hand-edited), a new `contracts/releases/<version>/` directory, and
`scripts/security/run-schemathesis.ts` (removing the now-unnecessary in-memory
patch). Touches no payment rail, no production configuration, no service
execution behavior (confirmed §15–§16) — a clean `git revert` of that one commit
fully undoes it.

## Decision

**Two independent decisions, not one bundled verdict — this is the checkpoint's
central, load-bearing finding:**

- **Defect A ($ref naming): `A. PATCH_REPAIR`** (`1.0.0 → 1.0.1`), supported
  directly by `COMPATIBILITY_POLICY.md` §3.1's explicit "generator bug fixes
  producing semantically identical models" / "invalid artifact" carve-out. High
  confidence.
- **Defect B (400/402 response schema): `C. MAJOR_CONTRACT_RELEASE`** per the
  taxonomy table's literal, unambiguous `error_contract_changed` classification
  — **with an explicitly flagged, unresolved tension** (§14) between the
  policy's strict letter and this specific instance's practical characteristics
  (zero consumers, not-production, documentation-only in effect). This tension
  is **not resolved unilaterally by this checkpoint** — it is the one open
  question requiring an explicit architect decision before Checkpoint 1K can
  proceed on defect B specifically.

**If shipped together** (both defects corrected in the same release), the
aggregate release classification is **major** (semver takes the strictest
classification present in a release) — but this checkpoint's analysis makes
clear that is driven entirely by defect B, not defect A, and the two **can be
shipped separately**: defect A alone as `1.0.1` now, with defect B deferred to
its own deliberate `2.0.0` decision (or resolved as patch too, if the architect
accepts this checkpoint's practical-impact argument in §14).

## Checkpoint 1K definition (not executed)

**Two independently-authorizable implementation paths**, either or both may be
selected:

- **1K-A (defect A only, PATCH_REPAIR, immediately actionable)**: rename
  `service-components.json`'s 8 keys to the title-derived form (§17); regenerate
  `packages/contracts/generated/{openapi,typescript, python}/**`; create
  `contracts/releases/1.0.1/`; confirm
  `pnpm openapi:generate:check`/`contracts:baseline:verify`/
  `contracts:compat:check` all pass against the new baseline; remove the
  now-unnecessary in-memory patch from `run-schemathesis.ts`; run a real
  Schemathesis campaign (expect 8 of 12 findings resolved, the schema-loading
  failure itself gone); full regression per §20.
- **1K-B (defect B, requires an explicit prior architect decision on §14's
  tension)**: only proceed once the architect has explicitly chosen either
  `PATCH_REPAIR` (accepting this checkpoint's practical- impact argument) or
  `MAJOR_CONTRACT_RELEASE` (`2.0.0`, accepting the taxonomy table's literal
  text) for the 400/402 correction specifically. If major: create the
  appropriate `2.0.0` (or later) release directory instead of `1.0.1`; determine
  whether `.v2` service- major identifiers are actually required per
  `COMPATIBILITY_POLICY.md` §2.3, service-by-service (all 4 affected services
  share this defect identically). Add the real
  `PaymentRequired`/validation-error schema components (§18); regenerate;
  confirm the same gates; run the decisive Schemathesis campaign (expect all 12
  findings resolved if both 1K-A and 1K-B are completed).

Neither is executed in this checkpoint.

## SUN-1000 status (unchanged)

```
PASS               8 / 12
FAIL_INTERNAL       3 / 12   (Schemathesis remains here — real
                               findings, correctly not forced to PASS;
                               chaos, load unchanged)
BLOCKED_EXTERNAL    1 / 12   (Trivy, unchanged)
```

`SUN-1000` remains `active`. `production_ready=false`,
`production_enabled=false`, unchanged. Zero external mutation. CDP sandbox
credential-rotation tracking item unaffected, still open.

## Next checkpoint

Either **1K-A** (the immediately-actionable, low-risk `$ref` patch repair,
requiring no further architect decision) or a return to **chaos** (fully
independent of both open contract questions) are both legitimate next steps.
**1K-B is explicitly blocked pending an architect decision** on the flagged
tension in §14 — this checkpoint does not select a semver policy silently on
that specific point.
