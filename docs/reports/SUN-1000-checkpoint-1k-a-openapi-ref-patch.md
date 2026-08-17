# SUN-1000 Checkpoint 1K-A — OpenAPI Invalid-$ref Patch Repair

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`f01344d` (Checkpoint 1J — decision: defect A `PATCH_REPAIR`, defect B
`MAJOR_CONTRACT_RELEASE` not authorized). This checkpoint implements **only**
defect A as a governed `1.0.1` patch release. Defect B (400/402 response-schema
mismatch) is untouched. No `2.0.0`, no service-major `.v2`, no runtime behavior
change, no chaos/load, no OpenTelemetry work.

## 1. Baseline

`git status --short` empty, `HEAD = f01344d`. Guards absent.
`pnpm security:semgrep` PASS. `pnpm security:osv` PASS. `pnpm security:trivy`:
CRITICAL=0, HIGH=3 (unchanged). `pnpm security:schemathesis`: exit 1, 36 cases,
12 findings (unchanged, matching Checkpoint 1J). `pnpm secrets:scan`,
`governance:validate`, `state:validate`, `tasks:validate`, full `pnpm check` —
all as expected.

## 2. Checkpoint 1J decision frozen

Defect A → `PATCH_REPAIR`. Defect B → `MAJOR_CONTRACT_RELEASE`, **out of
scope**, untouched. `StructuredError` response declarations, 400/402 schemas,
and all runtime error responses remain byte-for-byte identical to `1.0.0`.

## 3. Release 1.0.0 preserved

`contracts/releases/1.0.0/` untouched — confirmed by `git status` (never appears
as modified) and by `pnpm contracts:baseline:verify` passing throughout this
checkpoint.

## 4. Canonical component-name source

A deeper investigation than Checkpoint 1J's own (which checked only
`company-evidence`) found the naming disagreement is **not** a clean two-way
split. Each of the 4 services' real schema `title` fields were read directly:

| Schema base                | `title`                           | Prior OpenAPI `$ref`                             | Prior `service-components.json` key |
| -------------------------- | --------------------------------- | ------------------------------------------------ | ----------------------------------- |
| `company-evidence-input`   | "Company Evidence Graph Input"    | `CompanyEvidenceGraphInput` (matched)            | `CompanyEvidenceInput` (outlier)    |
| `web-context-input`        | "Verified Web Context Input"      | `WebContextVerifiedInput` (outlier)              | `WebContextInput` (outlier)         |
| `document-evidence-input`  | "Document Evidence JSON Input"    | `DocumentEvidenceJsonInput` (close, casing only) | `DocumentEvidenceInput` (outlier)   |
| `agent-verification-input` | "Agent Output Verification Input" | `VerifyAgentOutputInput` (outlier)               | `AgentVerificationInput` (outlier)  |

Only 1 of 4 services' broken `$ref` name even approximately matched its own
schema's `title`. **The single authoritative identity is each schema's own
`title` field** — independently confirmed as already authoritative for the
separately-generated Python models (`datamodel-codegen`, unmodified by this
checkpoint), which derive class names from `title` and were never wrong.

## 5. Generator root fix

`packages/pcc-schema/scripts/generate-openapi.ts`:

- Added `titleToPascalCase(title)` and `loadServiceSchemaNameByBase()` — reads
  each of the 8 service schema files' `title` field **once**, producing a single
  `schema-base -> name` map.
- `generateServiceComponents()` now takes that map as a parameter and uses it
  for its own registered component keys (previously derived independently from
  each schema's _filename_).
- `generateServiceContractsOpenAPI()` now looks up `inputSchemaName`/
  `outputSchemaName`/the `summary` field from the **same** map via a
  `serviceIdToSchemaBase` inverse of the existing `SERVICE_IDS` mapping
  (previously derived independently from each _service ID's own slug_).
- `convertRefs()`'s `https://siteborne.net/schemas/services/...` URL-to-`$ref`
  conversion branch (used for internal cross-schema references, not just
  top-level paths) now also consumes the same map, fails closed (throws) on any
  unrecognized service reference instead of silently falling back to the old
  filename-derived name.

No per-service hardcoded string patch was used — a single source of truth
eliminates the possibility of the OpenAPI `$ref`s and the registered component
keys ever disagreeing again by construction.

**A second instance of the same defect class was found and fixed by this same
mechanism**: `schemas/common/request-envelope.schema.json` contains one internal
`https://siteborne.net/schemas/services/company-evidence-input.schema.json`
reference (inside `RequestEnvelope`'s per-service conditional `input`
validation) — this also resolved to the old, broken filename-derived name before
the fix, and is corrected by the same generalized `convertRefs()` logic, not a
separate patch.

## 6. Generated artifact diff

After `pnpm --filter @siteborne/pcc-schema run generate:openapi` and
`prettier --write` (matching the committed formatting convention):

```
common-components.json:        1 line  (RequestEnvelope's internal $ref)
service-components.json:       16 lines (8 key renames, old -> new)
service-contracts.openapi.json: 38 lines (4 summaries + 6 path $refs +
                                           1 nested $ref + 8 component keys)
```

Reviewed in full (`git diff`): **zero unrelated drift.** Every changed line is
either a component key rename or a `$ref`/`summary` string now pointing
at/describing the correctly-named, unchanged schema.

## 7. $ref resolution proof

Programmatic verification (walking every `$ref` in the generated document): **97
total internal component references, 0 unresolved** (down from 1 unresolved
before this fix — the deeper `RequestEnvelope` reference found in §5 — and 8
unresolved in the original Checkpoint 1I/1J baseline). All 4 operations'
request/response `$ref`s confirmed resolvable by direct lookup. The generator's
own new fail-closed guard (`convertRefs` throws on any unrecognized service
reference) was exercised implicitly — generation completed without throwing,
confirming every reference in the source schemas is now accounted for.

## 8. Semantic-equivalence proof

`git diff` of `service-components.json` shows **only the 8 key lines changing**
— no line within any schema body (properties, required lists, types, enums,
nested structures) differs at all. The schema bodies referenced by the old
(broken) and new (repaired) names are byte-for-byte identical; only the label
pointing at them changed. No service input/output semantic capability changed.

## 9. Release 1.0.1 created

`contracts/releases/1.0.1/` created (copied from `1.0.0`, only the 3
`openapi/*.json` files replaced with the corrected generated output). `diff -rq`
against `1.0.0` confirms **only those 3 files differ** — every schema, example,
metadata, and manifest file is byte-identical.

`contracts/releases/1.0.1/CONTRACT_RELEASE.yaml`: `version: '1.0.1'`,
`parent_release: '1.0.0'`, `classification: 'patch'`, with the full
`PATCH_REPAIR` rationale recorded inline. `contracts/CONTRACT_RELEASE.yaml` (the
top-level active-release pointer) updated identically. `SHA256SUMS` recomputed
using `1.0.0`'s own tracked file list as the template (see §11 for why, not a
blind directory re-scan).

## 10. Compatibility classification — human-reviewed, not weakened

`contracts/releases/1.0.1/COMPATIBILITY_REPORT.json` contains the **complete,
unedited raw output** of `compat.ts`'s structural checker
(`required_version_bump: "major"`, `reference_target_changed`/
`property_removed`+`property_added` entries for every renamed component — the
checker's correct, conservative, mechanical classification for any
`$ref`/component-key structural change), **plus** a `human_review` field
recording the governed override: `decision: "PATCH_REPAIR"`, citing
`COMPATIBILITY_POLICY.md` §3.1 explicitly, with the full evidentiary rationale
(invalid-artifact proof, zero-consumer proof, byte-identical-content proof) and
an explicit `scope_confirmation` noting defect B is unaffected. **The raw
checker output is preserved, not edited or suppressed** — this is an addendum,
not a replacement.

## 11. Real, pre-existing tooling bugs discovered and fixed (disclosed, narrow)

Three genuine defects in `packages/contracts/scripts/compat.ts` surfaced for the
first time only because this is the first real, legitimate change to the active
release descriptor since `1.0.0` was frozen:

1. **`releaseVerify` hard-coded the literal string `'1.0.0'`** as the only
   acceptable release version — by construction unable to verify any subsequent
   release, not just an incorrect one. Fixed to compare the active descriptor's
   declared version against the basename of the frozen directory it was actually
   verified against, plus cross-check the frozen snapshot's own copy of the
   descriptor agrees — a durable, version-agnostic consistency check, not a new
   hard-coded literal.
2. **`main()`'s `compat`/`compat:check` commands also hard-coded the `1.0.0`
   directory as the permanent comparison target** — left as-is, this would have
   made every future `pnpm check` run permanently re-report this checkpoint's
   own now-accepted changes as unresolved drift, forever, even after `1.0.1`
   becomes genuinely current. Fixed to derive the ongoing comparison baseline
   from the active descriptor's own declared `release.version` —
   `baseline:verify` (which must permanently protect the _original_ `1.0.0`
   snapshot specifically) is unaffected, still permanently hard-coded to `1.0.0`
   by design.
3. **`compatCheck`'s per-file diff loop assumed every changed baseline file was
   JSON** and crashed (`JSON.parse` on YAML content) the first time
   `CONTRACT_RELEASE.yaml` itself ever legitimately changed — dormant since day
   one because that file had never actually diverged from its frozen baseline
   copy before. Fixed with an explicit, narrow `.yaml`/`.yml` branch that
   records a single, human-reviewable `annotation_change`/patch-classified entry
   instead of attempting a JSON-Schema diff on release metadata (which was never
   a meaningful operation for this file in the first place).

None of these three changes weakens compatibility enforcement — each either
makes a check that was previously _incapable of running at all_ for any
non-1.0.0 state actually work correctly, or fixes a genuine crash.
`compat:check`'s core guarantee (structural changes require human review,
defaulting to conservative "major") is fully intact and was exercised, not
bypassed, throughout this checkpoint.

## 12. Verification suite — all pass

```
pnpm contracts:baseline:verify   PASS (1.0.0 confirmed untouched)
pnpm contracts:release:verify    PASS (1.0.1 descriptor self-consistent)
pnpm contracts:compat:check      PASS (current state == 1.0.1 exactly, 0 diff)
```

**A fourth, independent instance of the same hard-coded-`1.0.0` landmine was
found during full regression**, not during the deliberate audit in §11:
`packages/contracts/src/compat/compat.property.test.ts` — a Vitest property-test
suite independently mirroring `compat.ts`'s own baseline-comparison logic, run
as part of the ordinary `pnpm test` (and therefore `pnpm check`). It also
hard-coded `contracts/releases/1.0.0` as its permanent ongoing comparison
target, and hard-coded the literal string `"version: '1.0.0'"` in one assertion.
Fixed with the identical, disclosed pattern already applied in §11:
`baselinePath` now derives from the active descriptor's own declared version
(read once via the same `yaml` parser this package already depends on); the
version-string assertion was updated to `1.0.1` — this specific one **is**
exactly the routine maintenance a real, intentional version bump requires
(unlike the other three landmines, which broke ordinary, version-unrelated
`pnpm check` runs with no version change involved at all). All 10 tests in that
file re-verified passing. A subsequent repository-wide search for any other
`'1.0.0'` literal in `packages/contracts/src`, `packages/contracts/scripts`, or
`packages/pcc-schema/scripts` found only two remaining hits: `compat.ts`'s own
intentional, permanent `baseline:verify` target (correct, by design), and
`validators.ts`'s `pcc_version: z.literal('1.0.0')` — the unrelated PCC
_document_ version axis (per ADR 0012, correctly unchanged).

## 13. Test-time $ref patch removed

`scripts/security/run-schemathesis.ts`'s `KNOWN_REF_NAME_MISMATCHES` map and
`patchKnownRefMismatches()` function (and its 3 dedicated unit tests) are fully
removed. The orchestrator now points the pinned Schemathesis CLI directly at
`packages/contracts/generated/openapi/service-contracts.openapi.json` — no
ephemeral copy, no patching step.

## 14. Schemathesis — before/after

```
Before (Checkpoint 1I/1J, via the now-removed ephemeral patch):
  36 cases generated, 12 unique failures, 0 unexpected 5xx

After (Checkpoint 1K-A, against the real, corrected, unpatched artifact):
  Schema loads directly — no "component does not exist" resolution
  error (confirmed: the original, unpatched pre-1K-A artifact could not
  even be loaded by Schemathesis at all — this is a genuine capability
  restored, not merely a cosmetic change).
  36 cases generated, 12 unique failures, 0 unexpected 5xx
```

**Finding count is unchanged (12) — expected and correct.** All 12 findings were
already, exclusively, defect-B `response_schema_ conformance` violations (8×
400, 4× 402 body-shape mismatches against `StructuredError`) — defect A never
contributed a distinct finding of its own; it prevented the campaign from
running against the _real_ committed file at all. **Remaining root cause:
exclusively defect B**, untouched, exactly as authorized.

## 15. Payment/evidence regression

`pnpm nevermined:check` (7 files, 155 tests), `pnpm x402:check` (includes
spec-baseline consistency), `pnpm d1:test`, `pnpm verification:check` — all
PASS. No price declaration, `Payment-Identifier` logic, `UsageResult`, PCC,
receipt, PSL, x402, or Nevermined code was touched — confirmed by `git status`
showing zero files under `packages/protocol-x402/src`,
`packages/protocol-nevermined/src`, `packages/verification/src`, or
`apps/edge-api/src/control-plane/`.

## 16. MCP/A2A regression

`pnpm mcp:check` (6 tools, health/quote verified, offline install),
`pnpm a2a:check` — both PASS. No public metadata publication.

## 17. Security regression

`pnpm security:semgrep`: PASS, 0 findings. `pnpm security:osv`: PASS,
CRITICAL=0. `pnpm security:trivy`: **CRITICAL=0, HIGH=3, unchanged** —
`BLOCKED_EXTERNAL` classification (Checkpoint 1I) untouched. No OpenTelemetry
dependency work.

## 18. Full contract regression

`pnpm pcc:generate:check` (TypeScript + Python models match committed version,
no drift), `pnpm services:generate:check` (18/18 models match),
`pnpm openapi:generate:check` (3/3 files match, no drift),
`pnpm python:test:pcc` (91 passed) — all PASS, confirming the TypeScript/Python
model generators (never touched) remain fully consistent with the corrected
OpenAPI artifact's underlying (unchanged) source schemas.

## 19. Full repository regression

`pnpm governance:validate`, `pnpm state:validate`, `pnpm tasks:validate`,
`pnpm secrets:scan` — all PASS. Full `pnpm check` — see stop report for exact
result.

## 20. Service-major stability

All four service IDs confirmed unchanged in the regenerated document:
`company_evidence_graph.v1`, `web_context_verified.v1`,
`document_evidence_json.v1`, `verify_agent_output.v1`. No `.v2`. No new service
registration. No route changes — `SERVICE_PATHS` untouched.

## Schemathesis criterion decision

**Remains `FAIL_INTERNAL`.** Not marked PASS merely because defect A is
repaired, per this checkpoint's own explicit instruction. 12 findings remain,
now unambiguously attributable **only** to defect B.

## Tally after this checkpoint

```
PASS               8 / 12
FAIL_INTERNAL       3 / 12   (Schemathesis remains here, defect-B-only; chaos, load unchanged)
BLOCKED_EXTERNAL    1 / 12   (Trivy, unchanged)
```

## Outcome

`SUN-1000` remains `active`. `production_ready=false`,
`production_enabled=false`, unchanged. Zero external mutation. CDP sandbox
credential-rotation tracking item unaffected, still open.

## Remaining work

Defect B (400/402 response-schema mismatch) remains open, requiring the explicit
architect decision on the tension flagged in Checkpoint 1J's §14 before any
implementation (`PATCH_REPAIR` accepting the practical- impact argument, or
`MAJOR_CONTRACT_RELEASE`/`2.0.0` per the taxonomy table's literal text) —
genuinely unresolved by this checkpoint, not decided here. Chaos and load remain
the two fully independent, internally-executable SUN-1000 gaps.
