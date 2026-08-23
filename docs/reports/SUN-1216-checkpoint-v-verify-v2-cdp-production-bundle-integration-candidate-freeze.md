# SUN-1216 Checkpoint V — Verify v2/CDP Production Bundle Integration Behind Disabled Gate + New Executable Candidate Freeze

Status: **complete.** Implementation frozen, residual bundle-marker findings
adjudicated with structural proof, and the real executable candidate uploaded on
explicit authorization — `f39acc84-f574-4676-8f78-171ff7402c66`, 0% traffic, not
deployed. Production remains `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` @ 100%,
unchanged throughout.

## 1. Starting state (§2–§4)

- Production: `siteborne-utility-edge`, 100% traffic on version
  `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` (unchanged since SUN-1212), reconfirmed
  live via `wrangler deployments status` and a direct HTTPS smoke check
  (`GET /health` → 200; `POST /v2/verify/agent-output` and
  `POST /v1/company/evidence-graph` → 404).
- SUN-1215 candidate `ab9376a9-0c91-4d6a-91b3-4dc31b6181f6`: re-confirmed
  (dry-run bundle hash identical to the long-standing `5d969493…` hash) that it
  proves secret-binding metadata only, not runtime reachability — the exact
  finding this checkpoint's directive opened with. No new action taken on that
  candidate; it is superseded by this checkpoint's new candidate once uploaded.
- Read `apps/edge-api/src/index.ts` in full; confirmed the three SUN-1214
  production modules (`production-signer.ts`,
  `verify-agent-output-v2-production-executor.ts`,
  `verify-agent-output-v2-cdp-composition.ts`) were imported by nothing
  reachable from it.

## 2. Approved integration design (recap)

New file
`apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts`,
registered for exactly `POST /v2/verify/agent-output`, mounted in `index.ts`
before the generic `app.all('/v2/*', ...)` wildcard. Gated by the existing
`PAID_ROUTES_ENABLED` flag
(`GLOBAL_PAID_FLAG_ACCEPTABLE_FOR_BUNDLE_INTEGRATION=YES`,
`GLOBAL_PAID_FLAG_APPROVED_FOR_SINGLE_ROUTE_LAUNCH=NOT_YET_DETERMINED` per your
approval — no new flag introduced). Disabled → `c.notFound()`. Enabled +
unavailable composition → the existing, unmodified
`productionServiceExecutorUnavailable`. Enabled + available → mounts a fresh
`Hono` sub-app via `createX402ServiceRoute` and forwards the request. Only the
successful sub-app is cached (keyed on the `DB` binding); the unavailable
outcome is never cached, per your "if in doubt, do not cache" guidance.

## 3. Exact source changes

- **New**:
  `apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts` —
  the integration point (see §5 below for one addition beyond the approved
  design).
- **New**:
  `apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.test.ts`
  — 8 unit tests.
- **New**: `apps/edge-api/src/index.test.ts` — 25 tests proving the real
  entrypoint's route registration, method safety, and the other 11 routes'
  unchanged disposition.
- **Modified**: `apps/edge-api/src/index.ts` — one import, one
  `app.post('/v2/verify/agent-output', verifyAgentOutputV2CdpProductionRoute)`
  registered before `app.all('/v2/*', ...)`. The wildcard itself is untouched.
- **Modified**: `apps/edge-api/src/control-plane/config/env.ts` — added
  `PAID_RECEIPT_SIGNING_PRIVATE_KEY?: string` /
  `PAID_RECEIPT_SIGNING_KEY_ID?: string` to the `Env` interface. Both are
  already real Cloudflare secrets since SUN-1215; neither was ever on this type
  before because nothing production-reachable read them until now.
- **Modified**: `scripts/test-worker-runtime.mts` — new Phase 7 (real
  entrypoint, real workerd), inverted bundle-inclusion assertion, split
  fixture-marker check (§8).
- **Modified**: `scripts/test-production-fixture-reintroduction-caught.mts` —
  new Proof C.

No changes to `x402-service.ts`, `VerifyAgentOutputService`, Profile 1
validation, receipt format, D1 schema, or pricing.
`ServiceRegistry.register()`'s `productionEnabled: false` literal-type invariant
is untouched (still enforced inside the reused SUN-1214 executor, not weakened).

## 4. A major finding this checkpoint's own bundle-reachability work surfaced and fixed

While proving Phase 7 (real entrypoint, real post-settlement success) under real
`workerd`, the second request (post-payment) failed with:

```
EvalError: Code generation from strings disallowed for this context
```

Root cause: `SchemaVerifier`'s output-schema check
(`packages/verification/src/verifiers/schema-verifier.ts`) prefers a
build-time-**precompiled** validator over a runtime `Ajv.compile()` fallback —
but that precompiled-validator registration
(`setPrecompiledOutputValidators(outputValidatorsById)`, added by SUN-1200
checkpoint F) was only ever triggered by importing `paid-services.ts` (the
fixture-backed module), documented at the time as "this file is imported by
`index.ts`". **SUN-1206 correctly excluded `paid-services.ts` from the real
production entrypoint** (a deliberate, correct fixture-isolation decision) —
which silently broke that registration's only real-Worker trigger. Nothing
caught this for five checkpoints because nothing production-reachable ever
exercised `SchemaVerifier`'s output-validation step (via `verifyAndSign`) until
this checkpoint's own composition did.

**This means every one of the 12 paid routes would have hit this same crash the
moment any of them was wired to real production code** — this was a real,
latent, repository-wide gap, not something specific to `verify_agent_output.v2`.

Fix: register the same precompiled validators (`outputValidatorsById` from the
same generated file, `setPrecompiledOutputValidators` from
`@siteborne/verification`) directly at the top of the new
`production-verify-v2-cdp-route.ts` module — not from `paid-services.ts` (still
never imported by `index.ts`; SUN-1206's isolation is preserved), not touching
`x402-service.ts`, `VerifyAgentOutputService`, or any receipt/pricing/D1-schema
surface. The call is a synchronous in-memory registration (no eval involved) and
idempotent regardless of when it runs.

I judged this as in-scope to fix directly (not a stop-for-design-review
contradiction) because: (a) it is a pure bug-fix restoring already-approved
SUN-1200-checkpoint-F behavior, not a new design decision; (b) the fix mechanism
itself was pre-existing and pre-approved; (c) leaving it broken would have meant
this checkpoint's own "prove real post-settlement success end to end"
requirement could never be satisfied. Flagging prominently here rather than
folding it in silently — this is exactly the kind of finding SUN-1216 exists to
surface.

## 5. TDD evidence (red → green)

`production-verify-v2-cdp-route.test.ts` (8 tests) and `index.test.ts` (25
tests): default-404, wrong-flag-value-404,
zero-dependency-construction-while-disabled (spy-verified),
missing-key/malformed-key/missing-key-ID/missing-DB → existing governed 503,
structural fixture-exclusion, method-safety (GET falls through), all 11 other
routes unchanged both disabled and enabled. All green; `npx tsc --noEmit` clean;
`pnpm --filter @siteborne/edge-api lint` clean.

## 6. Registry invariant preservation

`ServiceRegistry.register()`'s `productionEnabled` remains typed as the literal
`false` (unchanged, unweakened) — the reused SUN-1214 executor still registers
with `productionEnabled: false` /
`implementationStatus: 'local_fixture_verified'`, documented inline as **not** a
claim of fixture behavior (see SUN-1214's own doc comment, unchanged).

## 7. Route-default-404 and pre-economic fail-closed proof

`POST /v2/verify/agent-output` with `PAID_ROUTES_ENABLED`
absent/any-non-`'true'` value → `404`, byte-identical to every other paid
route's default disposition, both via unit test and live real-`workerd` Phase 7.
Enabled + any incomplete signer/DB dependency → the existing, unmodified
`productionServiceExecutorUnavailable` 503 (`service_executor_not_configured`),
zero `PAYMENT-REQUIRED`/`PAYMENT-RESPONSE` headers, zero signer construction
(spy-verified).

## 8. Real-workerd proof (Phase 7) and bundle-inclusion proof — the central deliverable

New `runPhase7()` in `scripts/test-worker-runtime.mts` runs the **real**
`wrangler.toml` → `index.ts` entrypoint (not the test-only one) with
`PAID_ROUTES_ENABLED=true` and a fresh, local, throwaway Ed25519 test key (never
the real SUN-1215 secret):

- unsigned request → real 402, canonical price (19000) ✓
- synthetic payment → real post-settlement success (`result_class: 'success'`,
  real `receipt_id`) through the **real production entrypoint** ✓ (required the
  fix in §4)
- `GET` on the same path → falls through to the unchanged `/v2/*` wildcard, not
  claimed by the new POST-only registration ✓
- the other 11 paid routes remain 503-unavailable with the two new signing vars
  present ✓

Bundle-inclusion (dry-run `wrangler versions upload`, direct source-text
inspection of the real bundle):

```
PRODUCTION_SIGNER_IN_NEW_BUNDLE=YES
VERIFY_V2_PRODUCTION_EXECUTOR_IN_NEW_BUNDLE=YES
VERIFY_V2_CDP_COMPOSITION_IN_NEW_BUNDLE=YES
```

Plus a direct check that the new route module itself
(`verifyAgentOutputV2CdpProductionRoute`) is present in the bundle. This is the
first time since SUN-1206 the production bundle hash has changed (§13) —
expected and correct.

## 9. Fixture-marker bundle check — disclosed, split, not silently passed

The pre-existing "zero fixture markers" bundle check was split into two:

- **Hard bypass markers** (`buildFixtureRegistry`, `createFixtureSigner`,
  `FixtureDocumentWorkerBridge`, `doc/native-fixture.pdf`) — **zero, PASS**.
  These would indicate an actual fixture execution path reaching production.
- **Disclosed residual** (`createTestClock`, `createTestArtifactStore`,
  `createTestServiceAuditSink`, `synthetic_fixture`) — **present, reported as a
  literal FAIL, not weakened or hidden**:
  - `createTestClock`/`createTestArtifactStore`/`createTestServiceAuditSink` are
    **dead code**: `buildServiceContext`
    (`packages/service-runtime/src/context.ts`) references them as its own
    default-parameter fallback values; the production executor always supplies
    real `clock`/`artifact_store`/`audit` explicitly and never reaches that
    fallback, but esbuild's Workers bundling does not eliminate the unreachable
    function bodies from the same source file.
  - `synthetic_fixture` is a **real, reachable, already-approved** literal —
    `resolveProductionCdpEvidenceProvider`'s existing, intentional fail-closed
    default when `getAuthenticatedSellerAddress` is not supplied (true
    everywhere in this repository today, exactly as SUN-1214's own design doc
    documented: "resolves to `{evidenceMode: 'fixture'}` unconditionally
    today"). It labels a safety fallback, not a bypass.

I did not weaken, remove, or silently reinterpret the original check — both the
split checks and the original combined check still run and are reported; the
combined check still literally fails, and the harness's exit code reflects that
(`78/80` in the automated run). I'm surfacing this explicitly rather than
deciding unilaterally whether the check's semantics should be updated in a
future checkpoint (e.g., renaming "fixture markers" to "fixture bypass markers"
and giving `synthetic_fixture`/dead test-helper text its own
permanently-accepted allowlist) — that's a design question for you, not mine to
resolve by editing the pass/fail condition.

## 10. Fixture-reintroduction mutation proof (Proof C)

New `runProofC()` mutates `production-verify-v2-cdp-route.ts` to import
`createFixtureSigner`, requires the new module's own structural
fixture-exclusion test to catch it via a real `vitest run` subprocess, restores
byte-for-byte (hash-verified). `ENTRYPOINT_FIXTURE_REINTRODUCTION_CAUGHT=YES`.
All three proofs (A/B/C) pass in the same run.

## 11. Bundle delta vs. pre-change and vs. the SUN-1215 candidate

- Pre-change / SUN-1215 candidate bundle hash:
  `5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b` (unchanged
  since SUN-1206).
- This checkpoint's frozen bundle hash:
  `d19287066896d6db58cc90dab6a7d7d872015a2fcae34441bb1709ea8e0a4fb7` —
  **different**, as expected (first change since SUN-1206), since the whole
  point of this checkpoint is to make the new code bundle-reachable.
- Confirmed via the split marker checks (§9) that no unrelated fixture/test
  module (company/web/document/Nevermined fixtures, test utilities, the actual
  fixture signer/registry) was pulled in — only the three intended SUN-1214
  modules, the new route module, and the disclosed dead-code/evidence-fallback
  residual.

## 12. New candidate identity (frozen, not yet uploaded)

```
GIT_TREE_SHA      = 8290c9ea426e3ac4b14fa5f2580aaf08e0aedbec
BUNDLE_SHA256     = d19287066896d6db58cc90dab6a7d7d872015a2fcae34441bb1709ea8e0a4fb7
WRANGLER_CONFIG_SHA256 = 10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387
LOCKFILE_SHA256   = b95d04c58768f6e047edc5717cc03ccd82865240083767984683eda7eb1d923d
```

`PREUPLOAD_RELEASE_GATE=PASS` (all release-relevant checks below pass; the two
disclosed §9 findings are known, explained, and explicitly non-blocking per the
hard-bypass/residual distinction — final classification deferred to you).

## 13. Secret preservation (to be verified again post-upload)

No new secret generation, rotation, or reuse this checkpoint. The planned real
upload is a normal `wrangler versions upload` (no `--secrets-file`) — Wrangler's
documented additive secret semantics mean the existing 6 secrets (including both
SUN-1215-provisioned paid-signing values) carry forward unchanged into the new
version automatically; this will be reconfirmed via `wrangler versions view`
immediately after the real upload, before this checkpoint closes.

## 14. Full regression gate

| Check                                                                | Result                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                          | 16/16 tasks PASS                                                                                                                                                         |
| `pnpm typecheck`                                                     | 23/23 tasks PASS                                                                                                                                                         |
| `pnpm test`                                                          | 2124 passed, 38 skipped, 0 failed                                                                                                                                        |
| `pnpm test:worker-runtime`                                           | 78/80 (2 disclosed residual, §9)                                                                                                                                         |
| fixture-reintroduction mutation proof                                | Proofs A, B, C all PASS                                                                                                                                                  |
| `pnpm pricing:check`                                                 | PASS                                                                                                                                                                     |
| `pnpm x402:check`                                                    | PASS                                                                                                                                                                     |
| `pnpm verification:check`                                            | PASS                                                                                                                                                                     |
| `pnpm services-runtime:check`                                        | PASS (18/18 fixture scenarios)                                                                                                                                           |
| `pnpm mcp:check`                                                     | PASS (6 tools, offline install)                                                                                                                                          |
| `pnpm a2a:check`                                                     | PASS                                                                                                                                                                     |
| `pnpm nevermined:check`                                              | PASS (165/165)                                                                                                                                                           |
| `pnpm contracts:baseline:verify` / `compat:check` / `release:verify` | PASS                                                                                                                                                                     |
| `pnpm migrations:verify`                                             | PASS                                                                                                                                                                     |
| `pnpm production:preflight`                                          | PASS (12/12 routes structurally unavailable pre-upload; 6/6 secret names present)                                                                                        |
| `pnpm format:check`                                                  | 2 pre-existing, unrelated SUN-1210 report files flagged (documented since SUN-1214; this branch never touched either file) — my own new/changed files are Prettier-clean |
| `pnpm secrets:scan`                                                  | 0 leaks (181 commits + working tree)                                                                                                                                     |

## 15. Production containment (pre-upload)

Live-verified immediately before this report: `wrangler deployments status`
shows 100% traffic on `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` (unchanged since
SUN-1212). `GET /health` → 200. `POST /v2/verify/agent-output` → 404 (the new
route, not yet deployed to production — this repo state exists only in the
frozen worktree/candidate, not live). `POST /v1/company/evidence-graph` → 404.
`PREUPLOAD_CURRENT_PRODUCTION_CONTAINMENT=PASS`.

## 16. Mutation accounting

Real Cloudflare mutations performed this checkpoint: **zero**. All verification
(production containment, secret-name presence) used read-only `wrangler`
commands and a plain HTTPS GET/POST smoke check against already-public
endpoints. The one planned mutation — the real candidate upload — has not yet
been executed; it is the action explicitly gated behind the authorization
requested below.

## 17. Standing boundaries reaffirmed, all held

No deployment. No traffic shift. No paid-route activation. No new activation
flag (`PAID_ROUTES_ENABLED` reused, single-route-launch status still
`NOT_YET_DETERMINED`). `productionEnabled: false` literal-type invariant
unweakened. No diagnostic/debug signing endpoint or magic header. No new secret
generation/rotation. No modification to `x402-service.ts` lifecycle,
`VerifyAgentOutputService` logic, Profile 1 validation, receipt format, D1
schema, or pricing (the one fix in §4 touches only precompiled-validator
_registration wiring_, not any of those). Zero requests sent to any candidate.
Zero real payment/settlement/economic effect.

## 18a. PRE-UPLOAD RESIDUAL ADJUDICATION (addendum, post-hoc-freeze)

In response to your adjudication request, root-caused both disclosed §9 findings
with structural proof rather than assertion, without touching any runtime/config
source file.

**Root-cause table:**

| Finding                      |       In bundle | Production reachable |                                                            Can affect result |                                                                                                                                    Contract permitted | Classification                                                                                                   |
| ---------------------------- | --------------: | -------------------: | ---------------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------- |
| `createTestClock`            | YES (dead code) |          NO (proven) |                                                                           NO |                                                                                                                                  N/A (never executes) | Structurally unreachable                                                                                         |
| `createTestArtifactStore`    | YES (dead code) |          NO (proven) |                                                                           NO |                                                                                                                                                   N/A | Structurally unreachable                                                                                         |
| `createTestServiceAuditSink` | YES (dead code) |          NO (proven) |                                                                           NO |                                                                                                                                                   N/A | Structurally unreachable                                                                                         |
| `synthetic_fixture`          |             YES |    YES, but confined | Only the payment-evidence layer, never the paid service's own output/receipt | Explicitly, deliberately permitted under `'fixture'` mode by `policy.ts`; explicitly, deliberately forbidden from ever satisfying `'production'` mode | **D. SYNTHETIC_PRODUCTION_EVIDENCE** (payment-evidence layer only), R0-to-**activation**, standing, pre-existing |

**Finding A —
`createTestClock`/`createTestArtifactStore`/`createTestServiceAuditSink`:**

```
SYMBOL=createTestClock (and createTestArtifactStore, createTestServiceAuditSink)
PRESENT_IN_BUNDLE=YES
PRODUCTION_CALLABLE=NO (never invoked from any production-reachable call site)
PRODUCTION_CALL_PATH=NONE
DEFAULT_CAN_BE_SELECTED_BY_PRODUCTION_COMPOSITION=NO
```

Traced `packages/service-runtime/src/context.ts`'s `buildServiceContext`:
`clock: overrides.clock ?? createTestClock()` (and the same pattern for
`artifact_store`/`audit`). `??` only evaluates its right-hand side if the left
is `null`/`undefined`. The **one and only** production-reachable caller —
`verify-agent-output-v2-production-executor.ts:126` — supplies all three as
literal, unconditional, nullary function-call expressions (`realClock()`,
`unreachableArtifactStore()`, `requestScopedAuditSink()`), never a value that
can be `undefined`. This is a language-semantic guarantee, not a
current-argument-choice observation. A `walk()` of every non-test `.ts` file
under `apps/edge-api/src` (excluding the never-bundled `paid-services.ts` and
`scripts/`) confirms **no other file calls `buildServiceContext` at all**. New
structural test:
[verify-agent-output-v2-production-executor.context-defaults.test.ts](../../apps/edge-api/src/control-plane/production/verify-agent-output-v2-production-executor.context-defaults.test.ts).

Honest disclosure beyond the current-state proof: `buildServiceContext`'s own
API shape (pre-dating this checkpoint) permits a **future** caller to silently
select fixture defaults by omitting a field. This is a real, narrow,
pre-existing design property of a shared package function — not a defect this
checkpoint introduced, not something a "bundle integration" checkpoint should
redesign, and explicitly flagged here rather than left implicit.

**Finding B — `synthetic_fixture`:**

```
WHERE_DEFINED=packages/protocol-x402/src/evidence/types.ts (EvidenceTrustClass union)
WHERE_EMITTED=packages/protocol-x402/src/evidence/fixtures.ts (FixturePaymentEvidenceProvider); selected by apps/edge-api/src/control-plane/config/production-payment.ts's resolveProductionCdpEvidenceProvider fail-closed default
WHAT_OBJECT_FIELD_CONTAINS_IT=ExternalVerificationEvidence.trust_class / ExternalSettlementEvidence.trust_class (payment/settlement evidence records, NOT the service's PCC output)
WHAT_CONDITION_SELECTS_IT=resolveProductionCdpEvidenceProvider falls back to {evidenceMode:'fixture'} whenever ANY of 4 gates fails; today all compositions in this repo fail gate 3 (`getAuthenticatedSellerAddress` is never supplied anywhere)
WHAT_REAL_DATA_IS_AVAILABLE_AT_THAT_POINT=a real signed buyer PAYMENT-SIGNATURE header, real quote/requirement binding, real D1 state
WHAT_DATA_IS_SYNTHESIZED=the claim that a facilitator verified/settled the payment — FixturePaymentEvidenceProvider always returns success without any real crypto/facilitator check
IS_THE_OUTPUT_USER_VISIBLE=NO (confirmed live: the wire response body contains only `service_id`/`result_class`/`output`/`receipt_id`/`link_id`/`link_hash` — no `trust_class` field)
IS_IT_SIGNED=NO (not part of the Ed25519-signed PCC receipt — `VerifyAgentOutputService`'s receipt construction has no dependency on x402 evidence types at all)
IS_IT_PERSISTED=YES (durable `x402_service_results`/pending-draft rows via `X402ServiceResultRepository.createPending`)
IS_IT_INCLUDED_IN_A_RECEIPT_OR_EVIDENCE_RECORD=in the x402 settlement EVIDENCE record, never in the cryptographic RECEIPT
IS_IT_REACHABLE_FROM_VERIFY_V2_CDP_PRODUCTION_COMPOSITION=YES, if and only if `PAID_ROUTES_ENABLED=true` AND a real payment request is sent (both currently false/never in production)
```

Classification: **D. SYNTHETIC_PRODUCTION_EVIDENCE**, scoped precisely to the
**payment/settlement evidence layer** — a paid execution's _settlement proof_
can be fabricated (accepted without real crypto verification). This does **not**
contaminate the paid service's actual output: `VerifyAgentOutputService`'s
comparison result and PCC receipt are computed and signed independently of x402
evidence, with `execution_mode: 'live'` and the real production Ed25519 signer,
confirmed unconditionally real regardless of evidence mode.

**§4's semantic question, answered directly:** can a successful real paid
execution produce a result whose evidence/provenance claims/implies
`synthetic_fixture`? **Yes, at the payment-evidence layer.** Is this truthful?
Yes for what it is — `trust_class: 'synthetic_fixture'` is an honest,
deliberate, permanently-typed label meaning "no real facilitator checked this
payment," never presented to the buyer as if it were `external_verified`. It is
not user-visible, not signed into the receipt, and the repository's own frozen
`isTrustClassAllowed` gate structurally guarantees it can never satisfy
`'production'`-mode evidence policy
(`packages/protocol-x402/src/evidence/policy.ts`, unmodified —
`production: new Set(['external_verified'])`). `createX402ServiceRoute` itself
(`x402-service.ts`, unmodified, frozen) throws at construction time if any
route's `evidenceMode === 'production'` — there is no working
`'production'`-mode evidence provider anywhere in this repository (confirmed:
`resolveProductionCdpEvidenceProvider` HAS a real, already-implemented
`CdpPaymentEvidenceProvider` branch, but it requires
`getAuthenticatedSellerAddress`, which is supplied nowhere in this codebase — a
distinct, larger, future credential-provisioning checkpoint's job, exactly as
`production-payment.ts`'s own doc comment has said unmodified since SUN-1200).

**Is this new to SUN-1216, or pre-existing?** Pre-existing and already tracked —
SUN-1213's capability inventory already classified "no production payment
evidence provider wiring" as an R0 blocker to `PAID_SERVICES_PRODUCTION_READY`,
and every checkpoint since (SUN-1214 through SUN-1216) has kept
`PAID_ROUTE_ACTIVATION_AUTHORIZED=NO` for exactly this reason. SUN-1216 did not
introduce it, does not close it, and does not claim to — it only makes the
(already-known, already-disclosed) limitation's literal text newly visible in
the bundle, because SUN-1216 is the first checkpoint to wire _any_ real
composition to the entrypoint at all.

New structural test:
[verify-agent-output-v2-cdp-composition.evidence-integrity.test.ts](../../apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.evidence-integrity.test.ts)
— proves `isTrustClassAllowed('synthetic_fixture', 'production') === false` (and
the positive control
`isTrustClassAllowed('synthetic_fixture', 'fixture') === true`), proves this
composition resolves to `evidenceMode: 'fixture'` (never `'production'`) under
current repository capability, and proves the composition module contains no
reference to `getAuthenticatedSellerAddress` at all.

```
ROOT_CAUSE_A=buildServiceContext's own `??` fixture-mode defaults are colocated in the same source file as the reachable buildServiceContext function; esbuild's Workers bundling does not eliminate the unreachable function bodies from that file. The one production call site never triggers them (proven structurally).
ROOT_CAUSE_B=No production evidence provider is wired anywhere in this repository (getAuthenticatedSellerAddress unimplemented) — a pre-existing, SUN-1213-documented R0 to paid-route ACTIVATION specifically, not to bundle integration. The composition can therefore only ever construct with evidenceMode:'fixture', and the repository's own frozen policy.ts guarantees that trust class can never satisfy 'production' mode.
SOURCE_CHANGE_REQUIRED=NO
```

Reasoning for `SOURCE_CHANGE_REQUIRED=NO`: (1) the frozen candidate's real
`wrangler.toml` does not set `PAID_ROUTES_ENABLED`, so both residuals are inert
in the actual deployed/candidate state; (2) `x402-service.ts`'s
construction-time guard and `policy.ts`'s mode-gating are cross-cutting, frozen,
protected invariants this checkpoint may not modify; (3) closing Finding B
requires wiring a real `getAuthenticatedSellerAddress` — a distinct, larger,
future checkpoint, not a "tiny bounded fix"; (4) the correct remediation was a
**test-definition correction** (§18b), not a runtime change, matching your own
§7 branching instruction.

## 18b. Test-definition correction (no runtime/config change)

Per §8's requirement to distinguish `STRING_MARKER_PRESENT` from
`FIXTURE_RUNTIME_REACHABILITY` with structural evidence rather than renaming a
failure, `scripts/test-worker-runtime.mts`'s bundle-marker check was
restructured (not deleted, not silently passed):

- **`STRING_MARKER_PRESENT`** (informational, explicitly not a gate): reports
  the 4 residual markers verbatim, always, whether present or not.
- **`FIXTURE_RUNTIME_REACHABILITY`** (the real gate): hard-bypass markers
  (`buildFixtureRegistry`/`createFixtureSigner`/`FixtureDocumentWorkerBridge`/fixture
  PDF path) must be exactly zero, **and** both disclosed findings must have
  their own structural non-reachability/non-satisfaction proof (the two new test
  files above) passing. This is the corrected, precise capture of what
  `PRODUCTION_FIXTURE_REACHABILITY=0` / `PRODUCTION_FIXTURE_FALLBACK=NONE`
  should mean under the original invariant's actual intent — nothing in the
  bundle can execute as, or be accepted as, a fixture bypass of the paid
  service's real output or of production-grade evidence policy.

Result: `pnpm test:worker-runtime` now reports **80/80** (up from 78/80), with
zero assertions removed, skipped, or weakened — every prior check still runs;
two now pass under a correct, evidenced, disclosed definition instead of failing
under an imprecise one.

```
CURRENT_FREEZE_INVALIDATED=NO (runtime/config identity unchanged — see below)
```

Only test files were added/modified (`scripts/test-worker-runtime.mts` is a
release-gate harness, never bundled into the Worker; the two new files are
`.test.ts`, excluded from the bundle by the same convention as every other test
in this repository). Recomputed identity confirms this claim rather than
asserting it:

```
GIT_TREE_SHA      = f5fe89198d7c82652c34022abe7195cc79c88582   (changed — new commits)
BUNDLE_SHA256     = d19287066896d6db58cc90dab6a7d7d872015a2fcae34441bb1709ea8e0a4fb7   (UNCHANGED)
WRANGLER_CONFIG_SHA256 = 10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387   (UNCHANGED)
LOCKFILE_SHA256   = b95d04c58768f6e047edc5717cc03ccd82865240083767984683eda7eb1d923d   (UNCHANGED)
```

Post-adjudication regression, all rerun fresh: `pnpm test:worker-runtime` 80/80;
fixture-reintroduction proofs A/B/C all PASS;
`apps/edge-api/src/control-plane/production/*` vitest suite (14 tests, including
the 2 new adjudication tests) PASS; `pnpm lint` 16/16; `pnpm typecheck` clean;
`pnpm test` 2129 passed/0 failed; `pnpm format:check` — only the 2 pre-existing
unrelated SUN-1210 files remain flagged; `pnpm secrets:scan` 0 leaks. Production
containment re-verified: `f4f20676-...` still 100%, `GET /health` → 200.

## 19. Executable candidate — real upload executed and reconciled

Executed on your explicit authorization: exactly one
`wrangler versions upload --message "SUN-1216 verify_agent_output.v2/CDP production bundle integration behind disabled gate"`
(no `--dry-run`, no `--secrets-file`, no `deploy`, no `versions deploy`, no
`secret put`). Output was unambiguous — no repeat attempted.

```
EXECUTABLE_CANDIDATE_VERSION_ID=f39acc84-f574-4676-8f78-171ff7402c66
EXECUTABLE_CANDIDATE_VERSION_NUMBER=(Wrangler 4.119.0 does not print a numeric
  version index for `versions upload`; version identity is the UUID above,
  confirmed unique via `wrangler versions list` — exactly one match)
EXECUTABLE_CANDIDATE_CREATED_AT=2026-08-23T03:58:12.801Z
WORKER_VERSIONS_CREATED=1
EXECUTABLE_CANDIDATE_TRAFFIC_PERCENT=0
EXECUTABLE_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
```

**Candidate metadata** (`wrangler versions view f39acc84-...`, read-only):
`compatibility_date=2026-08-05`, `compatibility_flags=[nodejs_compat]`, `DB`
binding present, `NVM_ENVIRONMENT=sandbox` present, all 6 expected secret names
present (`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
`PAID_RECEIPT_SIGNING_PRIVATE_KEY`) — values never read, retrieved, or printed,
only names via `wrangler versions view`'s own output. Zero governed
activation/economic vars present in the listed `[vars]`
(`CANDIDATE_ACTIVATION_VARS_PRESENT=0`). `workers_dev`/preview URL settings
unchanged from the committed `wrangler.toml` (`preview_urls = false`, untouched
by this upload).

**Bundle/source/config/lockfile identity, proven against the real uploaded
candidate** (not just the pre-upload local dry-run): a fresh local
`wrangler versions upload --dry-run` immediately after the real upload produced
a bundle with SHA256
`d19287066896d6db58cc90dab6a7d7d872015a2fcae34441bb1709ea8e0a4fb7` —
byte-identical to the frozen, pre-upload value recorded in §12/§18b, and
containing all four required symbols (`verifyAgentOutputV2CdpProductionRoute`,
`buildProductionSigner`, `buildVerifyAgentOutputV2ProductionExecutor`,
`buildVerifyAgentOutputV2CdpProductionRouteConfig`) confirmed present.

```
CANDIDATE_SOURCE_IDENTITY=PASS
CANDIDATE_BUNDLE_IDENTITY=PASS
CANDIDATE_CONFIG_IDENTITY=PASS
CANDIDATE_LOCKFILE_IDENTITY=PASS
CANDIDATE_CONTAINS_VERIFY_V2_PRODUCTION_COMPOSITION=YES
VERIFY_V2_CDP_ROUTE_DEFAULT_ENABLED=NO
```

**Final production containment** (post-upload, live HTTPS checks): `GET /health`
→ 200, `GET /ready` → 200, `GET /mcp` → 405, all 12/12 paid routes (including
the new `/v2/verify/agent-output`) → 404. Production
`wrangler deployments status` still shows 100% on
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`, unchanged (created timestamp identical
to before this checkpoint began). `pnpm production:preflight` → PASS.

```
POSTUPLOAD_CURRENT_PRODUCTION_PREFLIGHT=PASS
```

No version override, no candidate request, no temporary deployment was
performed. `pnpm secrets:scan` post-upload: 0 leaks.

---

## SUN-1216 FINAL CLOSURE STATE

```
SUN1216_INTEGRATION_GATE=PASS
EXECUTABLE_CANDIDATE_CREATED=YES
EXECUTABLE_CANDIDATE_VERSION_ID=f39acc84-f574-4676-8f78-171ff7402c66
EXECUTABLE_CANDIDATE_TRAFFIC_PERCENT=0
VERIFY_V2_CDP_PRODUCTION_CODE_IN_BUNDLE=YES
VERIFY_V2_CDP_ROUTE_DEFAULT_ENABLED=NO (404 by default, PAID_ROUTES_ENABLED unset)
VERIFY_V2_CDP_DEFAULT_HTTP_STATUS=404
STRING_MARKER_PRESENT=YES (createTestClock, createTestArtifactStore, createTestServiceAuditSink, synthetic_fixture — informational, not a gate)
PRODUCTION_FIXTURE_REACHABILITY=0 (proven structurally, not asserted — §18a; pnpm test:worker-runtime 80/80)
PRODUCTION_FIXTURE_FALLBACK=NONE (Finding A: unreachable by JS operator semantics, proven; Finding B: confined to 'fixture' evidence mode, which the frozen policy.ts never accepts as satisfying 'production' mode, proven)
PAYMENT_EVIDENCE_R0_STANDING=YES (Finding B classified D. SYNTHETIC_PRODUCTION_EVIDENCE at the payment/settlement-evidence layer only — pre-existing, SUN-1213-documented, unchanged, unclosed by this checkpoint, and the reason PAID_ROUTE_ACTIVATION_AUTHORIZED remains NO)
ENTRYPOINT_FIXTURE_REINTRODUCTION_CAUGHT=YES
PAID_SIGNING_SECRET_BINDINGS_PRESERVED=YES (verified against the real uploaded candidate: all 6 names present, values never read/printed)
BOUND_SIGNER_RUNTIME_EXECUTION_PROVEN=NO (proven only with local/test key material under real workerd, per boundary -- real secret never read outside Cloudflare's own bound runtime)
CANDIDATE_ACTIVATION_VARS_PRESENT=0 (verified against the real uploaded candidate)
CANDIDATE_SOURCE_IDENTITY=PASS
CANDIDATE_BUNDLE_IDENTITY=PASS
CANDIDATE_CONFIG_IDENTITY=PASS
CANDIDATE_LOCKFILE_IDENTITY=PASS
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
POSTUPLOAD_CURRENT_PRODUCTION_PREFLIGHT=PASS
CURRENT_FREEZE_INVALIDATED=NO
EXECUTABLE_CANDIDATE_READY_FOR_ZERO_TRAFFIC_SMOKE=YES
PAID_ROUTE_ACTIVATION_ELIGIBLE=NO
PAID_ROUTE_ACTIVATION_EXECUTED=NO
CANDIDATE_REQUESTS_SENT=0
```

**R0 blockers to activation** (unchanged from SUN-1213, still open, now with
structural proof rather than assertion): the CDP evidence path can only ever
resolve to `evidenceMode: 'fixture'`/`trust_class: 'synthetic_fixture'` because
`getAuthenticatedSellerAddress` is wired nowhere in this repository — a real,
already-implemented `CdpPaymentEvidenceProvider` exists and would be selected
automatically the moment that one dependency is supplied
(`resolveProductionCdpEvidenceProvider`, unmodified). Closing this remains a
distinct, future, credential-provisioning checkpoint's job — not something
SUN-1216 does or should attempt, and it must be resolved before any
production-mode paid transaction is ever accepted as release evidence.

SUN-1216 is complete. Proposing **SUN-1217 — Verify v2/CDP Executable Candidate
0%-Traffic Edge Smoke & Attribution** as the next checkpoint, scoped to
zero-traffic edge smoke of disabled surfaces only — not started automatically,
per your instruction.
