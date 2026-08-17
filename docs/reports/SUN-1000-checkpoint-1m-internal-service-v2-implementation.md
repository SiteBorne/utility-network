# SUN-1000 Checkpoint 1M — Internal Service-v2 / Contract-2 Implementation

**Status:** Phase 1 implementation (credential-independent). Phase 2 (external
provider registration) explicitly **not** authorized or performed.

---

## 1. PCC version-semantics gate (§3 hard gate, resolved before any mutation)

Read `packages/pcc-schema/policy/COMPATIBILITY.md` directly — a **separate,
PCC-specific governing policy** (version `1.0.0`, "frozen at Phase 0... governs
all future schema evolution" of the PCC schema specifically), distinct from
`docs/contracts/COMPATIBILITY_POLICY.md` (the service-contract-release taxonomy,
which does not cover the PCC schema — ADR 0012 confirms the PCC schema is a
separate _dependency_ of the 17-canonical-schema service contract release, not
one of the 17).

- **§1 (Additive Evolution Only):** "New enum values may be added."
- **§4 (Versioning Scheme):** "Minor (1.1.0): Additive changes (new optional
  fields, **new enum values**)." Patch is "bug fixes to schema documentation
  only"; Major is "any breaking change."

This directly resolves the gate:

| Field                              | Value                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CURRENT_PCC_SCHEMA_RELEASE`       | `1.0.1`                                                                                                                                                                                                                                                                                      |
| `CURRENT_PCC_DOCUMENT_VERSION`     | `1.0.0`                                                                                                                                                                                                                                                                                      |
| `CHANGE_CLASSIFICATION`            | **Minor** (per the PCC-specific policy — not "major" the way checkpoint 1L speculatively assumed by importing the wrong policy document)                                                                                                                                                     |
| `REQUIRED_NEXT_SCHEMA_RELEASE`     | **`1.1.0`**                                                                                                                                                                                                                                                                                  |
| `DOCUMENT_VERSION_CHANGE_REQUIRED` | No                                                                                                                                                                                                                                                                                           |
| Governing source                   | `packages/pcc-schema/policy/COMPATIBILITY.md` §1/§4                                                                                                                                                                                                                                          |
| `PCC contradiction found?`         | No — checkpoint 1L's own proposal (`1.0.1 -> 1.0.2`, a _patch_ bump) was internally inconsistent with its own "major" classification; the correct governing policy resolves this cleanly to a self-consistent minor classification/minor bump, once the right policy document is identified. |

**Only after this was resolved did any PCC schema mutation occur.**

## 2. Freeze v1 history

Verified throughout, not just at the start: `contracts/releases/1.0.0` and
`1.0.1` are byte-for-byte unmodified (`git status --short` confirms zero changes
under either directory at every checkpoint). No `.v1` identifier, Nevermined
declaration, D1 row, or accepted report was rewritten or relabeled.

## 3. PCC release — implementation

- `schemas/proof-carrying-context.schema.json`: `service_id` enum gains the 4
  `.v2` members (additive; the 4 `.v1` members unchanged).
- `packages/pcc-schema/package.json`: `1.0.1` → `1.1.0`.
- `packages/pcc-schema/CHANGELOG.md`: new `1.1.0` entry.
- New schema hash:
  `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` (was
  `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5`).
- Regenerated TS/Python PCC models
  (`pnpm --filter @siteborne/pcc-schema generate`); `pcc:generate:check` passes
  (no drift).
- 4 deliberate, disclosed drift-pin updates to the new hash (matching the 1K-A
  precedent for "routine maintenance a real, intentional version bump
  requires"): `compat.property.test.ts`, `pcc-extension-container.test.ts` (TS),
  `test_pcc_extension_container.py` (Python), plus the per-service hash pins
  inside `compat.property.test.ts`'s "service metadata records" test (updated
  again in step 8 below).

## 4. A second, deeper PCC-adjacent discovery: output-schema `const`s

Not anticipated by checkpoint 1L. The 4 output schemas
(`schemas/services/*-output.schema.json`) embed, inside their PCC-contract
validation block, **two** closed `const` constraints:
`contract.service_id: const "X.v1"` and `contract.service_version: const "v1"`.
A v2-generated document — otherwise structurally identical to a v1 one — cannot
validate against these schemas at all without widening both.

Both widened to an `enum` (`["X.v1", "X.v2"]` and `["v1", "v2"]` respectively) —
additive only, every previously-valid v1 instance remains valid. This is exactly
the kind of finding directive §3/§15's "Do NOT mutate... prove it, don't assume"
and "Expected likely representation: v1 + v2 accepted by schema" language
anticipated in spirit, discovered empirically (via a real
cryptographic-receipt-verification failure, not guessed) rather than assumed.

**Consequence:** the shared output schema files' hashes changed (once for each
of the two discoveries — two full propagation passes were required). Propagated
everywhere the live (not frozen-1.0.0/1.0.1) hash is referenced:
`registry/services/*.v1.json` and `*.v2.json`, `paid-services.ts` (8 route
registrations), `contracts/CONTRACT_RELEASE.yaml` +
`contracts/releases/2.0.0/*`, `schemas/MANIFEST.json`,
`compat.property.test.ts`, and the credential-gated
`apps/edge-api/tests/live/*.test.ts` fixture files.
`contracts/releases/1.0.0`/`1.0.1` keep their own frozen copies of the
pre-widening schemas, byte-identical to acceptance, completely unaffected —
confirmed via `baseline:verify` passing continuously.

## 5. Service-ID source of truth — implementation

Extended all 7 hand-maintained enumeration sites identified by checkpoint 1L
with 4 new `.v2` members each, alongside (not replacing) the existing `.v1`
members: `service-runtime`'s `ServiceId`/`ALL_SERVICE_IDS`, `protocol-x402`'s
`SiteborneServiceId`, `protocol-a2a`'s `SITEBORNE_SERVICE_IDS` (additive),
`protocol-mcp`'s `MCP_SERVICE_TOOLS` (remapped — same tool names, forward
execution now targets `.v2`, per checkpoint 1L §16), `protocol-nevermined`'s
`NEVERMINED_ROUTES` (additive, new path strings only), `paid-services.ts`'s
inline route registrations (4 new `createX402ServiceRoute` calls),
`bazaar/registry-source.ts`'s static JSON imports (4 new
`registry/services/*.v2.json` files).

Also fixed the `resolveServiceRoute()` hardcoded-`1.0.0`-path landmine flagged
in 1L §8 item 9: since this module uses static, Worker-safe ES module JSON
imports (no `fs.readFileSync` possible), it now statically imports **both**
`contracts/releases/1.0.1` and `contracts/releases/2.0.0` and merges their route
tables — `.v1` IDs still resolve their real historical `/v1/...` path, `.v2` IDs
resolve from the new document. `frozen-inputs.ts`/`frozen-contracts.ts`
deliberately remain pointed at `1.0.0`/`1.0.1` — their imported request/output
schema _content_ was byte-identical (until §4's discovery required updating
those specific files' hashes; the import path itself did not need to move, since
the same `1.0.1`-frozen files remain the correct historical source for that
content).

**Genuinely widened, not merely inventoried:** every hand-maintained site had a
concrete correctness bug once v2 IDs were added and needed fixing along the way
— `service-runtime`'s `ServiceExecutionResult.service_version` literal type
(`'v1'` → `'v1' | 'v2'`), 4 service classes hardcoding
`service_id`/`service_version` literals in their result/receipt construction
(now derived from `context.service_id`), `dispatcher.ts`'s `closedFailure`
hardcoding `service_version: 'v1'`, `protocol-x402`'s
`PaymentContextBinding.service_version` literal type and 2 hardcoded-literal
construction sites (`bazaar/discovery.ts`, `x402-service.ts` ×7 occurrences),
`protocol-mcp/server.ts`'s quote-tool input/output Zod schemas (hardcoded
4-member enum, `service_version`/`contract_release` literals),
`protocol-nevermined/declarations.ts`'s `FIXED_PRICING_KEYS` (keyed by full
`.v1`-literal strings, generalized to base-name keys), and
`verification/schema-registry.ts`'s `SERVICE_ID_TO_SCHEMA_FILE` (v1-only map,
extended).

## 6. v1/v2 active model

Implemented exactly the frozen `PREPRODUCTION_V2_REPLACEMENT` model: v1
artifacts/code/tests/schemas remain, unmodified, permanently valid and
regression-tested (§11 below). v2 is additive everywhere except MCP's tool →
service mapping (which — per 1L's own explicit design — remaps forward execution
to v2 under the same public tool names, since v1 was never publicly declared
implemented). No v1 route silently executes as v2 — each of the 4 new v2
`createX402ServiceRoute` registrations is a fully distinct registration with its
own `serviceId`, `path`, `contractRelease`, executor closure.

## 7. `/v2` direct service routes

Added: `/v2/company/evidence-graph`, `/v2/web/context`,
`/v2/document/evidence-json`, `/v2/verify/agent-output` — same executor bodies
as their v1 counterparts (identical business logic, per checkpoint 1L §7),
reusing the same `buildFixtureRegistry` instances (§8 below), same fixture/local
mode, deterministic, no external provider dependence.

## 8. `/v2/nevermined` routes — explicit fail-closed

`NEVERMINED_ROUTES` gained the 4 `/v2/nevermined/...` path strings (additive),
and `protocol-nevermined/declarations.ts`'s `NEVERMINED_DECLARATIONS` now
includes local, **unregistered** v2 descriptions (deterministic
`local_agent_id`/`local_plan_id` strings, the same pattern v1 already used —
never a real external registration, never a fabricated live ID). Critically: the
4 new v2 routes in `paid-services.ts` are wired through a dedicated
`v2CdpRoute()` helper that is **always CDP**, bypassing `paymentRoute()`'s
nevermined branch entirely, regardless of the app's configured `rail`. This
means Nevermined-rail v2 is genuinely unreachable this checkpoint — not just
untested — matching directive §8's "must fail closed until Phase 2" requirement
by construction. A dedicated test (`nevermined-service-route.test.ts`) proves
the "nevermined-configured" app still mounts v2 at its CDP paths, never at
`/v2/nevermined/...`.

## 9. Model D preservation

Unchanged. `selectPaymentRail()`'s `OPEN_ROUTES`/`NVM_ROUTES` `Set`s are built
from the (now 8-entry) route maps exactly as before — one authoritative rail per
route, no fallback, no stacking, structural by construction. Verified via the
full existing Model D test suite (all passing, §17 below).

## 10–13. Contract 2.0.0 / 400/402 schemas / StructuredError

`contracts/releases/2.0.0/` created (copied from `1.0.1`'s structure, per 1K-A's
precedent). Request/success-response schemas unchanged (reused, byte-identical
field shapes). Service IDs: `.v2`. `400`: `ValidationError` (new inline OpenAPI
component, matching `jsonError()`'s real `{error, message, details?}` shape).
`402`: `PaymentRequiredChallenge` (new inline component, matching the real
CDP-rail x402 challenge body). `StructuredError` itself is **untouched** and
remains correctly referenced by the `500`/quote-endpoint responses, which were
never part of defect B — confirmed via repository-wide search that no unrelated
response was repointed.

## 14–16. PCC service-id evolution / release artifact / compatibility

Covered in §3–4 above. `contracts/releases/2.0.0/COMPATIBILITY_REPORT.json`
preserves the raw checker's genuine `major`/`fail` classification (88 changes on
the final run) verbatim, plus a `human_review` addendum recording the
`MAJOR_CONTRACT_RELEASE` decision, full rationale, and — disclosed explicitly,
not smoothed over — that the two output-schema `const`-widenings are each
individually additive/minor-shaped but are correctly bundled into this release's
overall major classification because they ride along with the genuinely-major
error-contract fix, not because either widening is itself breaking. Historical
`1.0.0`/`1.0.1` `COMPATIBILITY_REPORT.json` files untouched.

## 17. UsageResult / receipt / PSL

No JSON Schema exists for any of the three (confirmed again, repository-wide
search) — TS-typed only, extending `SiteborneServiceId` (§5) was sufficient. No
receipt signature semantics changed; `verifyReceipt`'s cryptographic
signature/preimage logic is completely untouched — only the _context-match_
input (which `service_id`/`contract_release` the caller expects) is now
correctly derived per-major rather than hardcoded. v1 historical receipts still
verify (proven by the still-passing v1 fixture scenarios); v2 receipts now
verify too (proven by the 4 new v2 fixture scenarios, §11 below).

## 18. D1

Reconfirmed from the actual migration files: zero `CHECK`/enum constraint on any
`service_id` column anywhere. **D1 schema mutation: 0.** No row rewritten.
`pnpm d1:test` passes.

## 19. Cross-major Payment-Identifier semantics

Unchanged, reconfirmed: `idx_payment_attempts_identifier` is a unique index on
`payment_identifier` alone, already global across all services before this
checkpoint. No new test needed to prove "same identifier across majors is a
conflict" — that has always been true and remains true; the x402 regression
suite (155 tests, including the full replay/binding/duplicate matrix) continues
passing unchanged, and none of it distinguishes by major because the underlying
constraint never did.

## 20. Pricing

`SAME_ECONOMICS_NEW_SERVICE_MAJOR` confirmed exactly:
`registry/services/*.v2.json` are byte-identical to their v1 counterparts except
`service_id`/`service_version` (diffed directly — confirmed no economics field
differs). `EXACT_PRICING_KEYS`/
`UPTO_PRICING_KEYS`/`BAZAAR_PAYMENT_POLICY`/Nevermined `FIXED_PRICING_KEYS` all
map v2 to the identical pricing keys as v1.

## 21. Local x402 wiring

Covered in §7–9. All 4 v2 routes tested end-to-end via the real Schemathesis
campaign (§28–29) and the full x402/nevermined regression suites.

## 22. MCP / 23. A2A

MCP: same tool names, `MCP_SERVICE_TOOLS` values remapped to `.v2`, quote tool's
Zod schemas extended, `EXACT_PRICING_KEYS`/`UPTO_PRICING_KEYS`/
`SERVICE_RESOURCES` extended. v1 protocol evidence preserved in
`transport.test.ts`'s own historical assertions (updated to reflect the new live
wiring, since the test's job is verifying _current_ behavior, matching 1L's
design). No npm publication.

A2A: `SITEBORNE_SERVICE_IDS` extended additively; skills/x402-extension
`services[]` regenerate automatically from the same list (no special-casing
needed in `card.ts` itself, confirmed by the passing `card.test.ts`/
`fixtures.test.ts`). `a2a-agent-card-baseline.json` fixture updated with the 4
new v2 skills/payment modes, mirroring the v1 entries exactly. No publication.

## 24–25. Active OpenAPI document / Contract release 2.0.0

The live `packages/contracts/generated/openapi/service-contracts.openapi.json`
now describes **only** the 4 v2 operations (plus the unchanged not-implemented
quote endpoint) — v1 is not duplicated into the active document, consistent with
checkpoint 1L §25's recommendation. `x-implementation-status` for the 4 v2
operations changed from `not_implemented` to `local_fixture_verified` (genuinely
true now — real, tested, fixture-mode HTTP behavior exists),
`x-production-enabled` remains `false`. `contracts/releases/1.0.0`/`1.0.1`
remain the permanent historical record of the v1 contract, untouched.

## 26. Compatibility negative control (synthetic drift, post-2.0.0)

Ran the same bounded synthetic-drift test 1L already validated once, again
against the new current release: temporarily mutated
`packages/contracts/generated/openapi/service-contracts.openapi.json`'s
`info.title`, confirmed `pnpm contracts:compat:check` failed correctly (non-zero
exit, real diff reported against the frozen `2.0.0` snapshot), reverted,
confirmed `pnpm contracts:compat:check` passed cleanly again with
`git status --short` empty. Proves the generalized 1K-A machinery remains a real
enforcement gate after a second release, not just the first.

## 27–30. Schemathesis campaign

Pointed at the real, live, committed `2.0.0`-generated document (no patch, no
workaround). Real campaign against the real local HTTP v2 routes, fixture-mode
payment services, zero provider credentials.

**First run** (before the JSON-canonicalization fix in §31): 4 failures — 2
genuine `Server error` (500s) and 2 `Undocumented Content-Type` (a downstream
symptom of the same 500s). **Root-caused and fixed** (§31), not weakened or
excluded. **Final run: exit code 0, 1512/1512 generated cases passed, 0
failures, 1 informational warning** (schema-constraint-vs-API- validation
strictness mismatch — expected/benign, matches the same warning class already
accepted in prior checkpoints). Both `Coverage` and `Fuzzing` phases fully pass.

## 31. Real, disclosed defect found and fixed (not v2-specific)

Schemathesis's fuzzing phase generated an out-of-JS-safe-integer-range numeric
literal that passed AJV's loose `type: integer` input validation but then
crashed `hashPaymentObject`'s JCS canonicalization
(`packages/pcc-schema/src/index.ts`'s `validateJCSNumbers`) with an **uncaught
exception**, escaping
`apps/edge-api/src/control-plane/routes/ x402-service.ts`'s request handler as
an unhandled 500. This bug is **not** v2-specific — the shared route boundary
(`createX402ServiceRoute`) is used identically by v1, and the bug was latent
there too, simply never exercised by a fuzzing run deep enough to hit it before
now. Fixed narrowly: wrapped the `hashPaymentObject` call in a `try`/`catch`
returning a proper `400 invalid_request`, the same pattern already used one line
above for malformed JSON. No canonicalization/signing logic changed; no check
weakened.

## 32. Schemathesis criterion

**FAIL_INTERNAL → PASS.** Real campaign, real exit code 0, both phases green.
This is the primary SUN-1000 gate this checkpoint targeted.

## 33. v1 regression

All pre-existing v1 fixture scenarios (`company-identity-...`,
`web-direct-mode-success`, `document-native-text-success`,
`agent-standard-pass`, plus every other scenario in
`SERVICE_FIXTURE_MATRIX.yaml`) still pass unchanged. `baseline:verify` against
`1.0.0` passed continuously throughout every step. No v1 Schemathesis campaign
was required or run — v1 is not part of the active OpenAPI document per the
frozen 1L architecture (§24–25).

## 34–36. Contract / payment-protocol regression

`openapi:generate:check`, `pcc:generate:check`, `services:generate:check`
(18/18, no drift), `contracts:baseline:verify` (against `1.0.0`, permanently),
`contracts:release:verify` (against `2.0.0`), `contracts:compat:check` — all
green. `pnpm x402:check`, `pnpm nevermined:check` (155 tests), `pnpm mcp:check`,
`pnpm a2a:check`, `pnpm d1:test`, `pnpm verification:check` — all green. Full
`pnpm test`: **144 files, 1739 passed, 24 skipped** (up from the pre-1M baseline
of 1703 passed — the net growth is the 4 new v2 fixture scenarios plus assorted
new/updated assertions, minus zero regressions).

## 37. Security regression

Semgrep: PASS, 0 findings. OSV: PASS, CRITICAL=0 (57 total, unchanged). Trivy:
unchanged, `BLOCKED_EXTERNAL`, HIGH=3 (the pre-existing OpenTelemetry upstream
blocker from checkpoint 1H — not attempted). Gitleaks: no leaks (both `git`
history and working-tree scans).

## 38. Full regression

`pnpm governance:validate` (77/77), `pnpm state:validate` (30/30),
`pnpm tasks:validate` (252/252, after the `TASKS.yaml` update below),
`pnpm secrets:scan`, and **`pnpm check`** — all exit 0. No production enablement
anywhere; `production_ready`/`production_enabled` remain `false` throughout.

## 39. Provider mutation boundary

Confirmed before finalizing: Nevermined v2 registrations created = 0. Nevermined
v2 plans created = 0. CDP provider mutation = 0. Real payment = 0. Phase
2/checkpoint 1O remains separately authorized, not started.

## 40. Rollback

A `git revert` of this checkpoint's commit fully restores the accepted 1L state
— every change is local, no external mutation occurred anywhere, so rollback is
complete by construction. `contracts/releases/1.0.0`/`1.0.1` were never touched,
so their own rollback-completeness is not even a question.

## Remaining Phase-2 work (not started, not authorized this checkpoint)

Credential rotation (existing open item, now an explicit prerequisite
immediately before Phase 2) → real Nevermined v2 agent/plan registrations → live
v2 sandbox payment-path proof (CDP + Nevermined) → MCP/A2A public wiring →
registry/discoverability. Chaos/load suite construction (still nonexistent
anywhere in the repository) targeting the now-real v2 architecture is the next
fully credential-independent frontier, per checkpoint 1L's own explicit ordering
decision (§27 of that report).
