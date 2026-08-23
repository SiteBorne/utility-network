# SUN-1216 Checkpoint V — Verify v2/CDP Production Bundle Integration Behind Disabled Gate + New Executable Candidate Freeze

Status: implementation complete, source frozen, **upload not yet executed** —
awaiting the separate, explicit action-time authorization this checkpoint's
directive requires before the real Cloudflare candidate upload
(`SUN1216_CANDIDATE_UPLOAD_AUTHORIZED=NO` until granted).

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

## 18. Remaining work (deferred to the authorized upload step, then SUN-1217+)

Execute the real `wrangler versions upload` (no `--dry-run`) only after explicit
action-time authorization; verify exactly one new version created and production
traffic unchanged; record the real candidate's version
ID/number/created-at/message; reconcile secret-name preservation and
activation-var absence against the _uploaded_ candidate (not just the local
dry-run); re-run `pnpm production:preflight` post-upload; merge this worktree
branch into `main`; propose SUN-1217 (0%-traffic edge smoke).

---

## SUN-1216 EXECUTABLE CANDIDATE UPLOAD READY

```
SUN1216_INTEGRATION_GATE=PASS (with 2 disclosed, explained, non-hard-bypass residual findings — see §9)
VERIFY_V2_CDP_PRODUCTION_CODE_IN_BUNDLE=YES
VERIFY_V2_CDP_ROUTE_DEFAULT_ENABLED=NO (404 by default, PAID_ROUTES_ENABLED unset)
VERIFY_V2_CDP_DEFAULT_HTTP_STATUS=404
PRODUCTION_FIXTURE_REACHABILITY=0 (hard-bypass markers; disclosed dead-code/evidence-fallback residual is NOT a bypass, see §9)
ENTRYPOINT_FIXTURE_REINTRODUCTION_CAUGHT=YES
PAID_SIGNING_SECRET_BINDINGS_PRESERVED=NOT_YET_VERIFIED (verified post-upload only, no new secrets introduced)
BOUND_SIGNER_RUNTIME_EXECUTION_PROVEN=NO (proven only with local/test key material under real workerd, per boundary -- real secret never read outside Cloudflare's own bound runtime)
EXECUTABLE_CANDIDATE_CREATED=NO
CANDIDATE_ACTIVATION_VARS_PRESENT=0 (planned, dry-run confirmed)
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
EXECUTABLE_CANDIDATE_READY_FOR_ZERO_TRAFFIC_SMOKE=YES (pending real upload)
PAID_ROUTE_ACTIVATION_ELIGIBLE=NO
PAID_ROUTE_ACTIVATION_EXECUTED=NO
```

**R0 blockers to activation** (unchanged from SUN-1213, still open): none newly
introduced by this checkpoint; the CDP evidence path remains `fixture`-mode only
(`getAuthenticatedSellerAddress` still never supplied anywhere) — genuine
live-evidence wiring remains a distinct future checkpoint's job, as already
documented since SUN-1214.

**R1 (new, this checkpoint)**: the §9 bundle-marker check split is a disclosed,
unresolved classification question — should the "zero fixture markers" release
gate be redefined to exclude dead-code test-helper text and the documented
fixture-labeled evidence fallback, or should `buildServiceContext`'s defaults be
refactored to remove the dead-code residual entirely? Recommend resolving this
explicitly (accept as documented, or scope a small follow-up) rather than
letting it linger silently.

I am ready to execute the real Cloudflare candidate upload
(`wrangler versions upload`, no `--dry-run`, no `--secrets-file`) on your
explicit authorization. Proposing **SUN-1217 — Verify v2/CDP Executable
Candidate 0%-Traffic Edge Smoke & Attribution** as the next checkpoint once the
candidate is created.
