# SUN-1218 — Payment-Evidence Production Trust Closure + Verify v2/CDP Single-Route Activation: TDD Implementation Plan

Derived from the approved, revised design:
`docs/superpowers/specs/2026-08-23-payment-evidence-production-trust-and-verify-v2-activation-design.md`.

Status: **plan complete, awaiting explicit implementation authorization.**
`RUNTIME_IMPLEMENTATION_STARTED=NO`.

## 0. A correction discovered while planning (disclosed, not hidden)

While tracing exact call sites for Task 1, deeper reading of
`apps/edge-api/src/control-plane/config/production-payment.ts` found that
`buildCdpSellerAddressLookup` and `buildProductionCdpAccountLookupClientFactory`
**already exist, fully implemented and fully tested** (SUN-1200 checkpoints C/D
— `apps/edge-api/tests/production-payment-gate.test.ts`, ~15 existing tests
including an "end-to-end (mocks only)" test proving
`resolveProductionCdpEvidenceProvider` constructs a real
`CdpPaymentEvidenceProvider` when every ADR-0055 gate holds AND a mock CDP
account lookup resolves the configured seller address). The approved design's
§11/§18 proposed _building_ a new `resolveAuthenticatedCdpSellerAddress`
function and modifying `production-payment.ts` — that file does **not** need to
change at all. The only real gap is that
`verify-agent-output-v2-cdp-composition.ts` never wires these two already-tested
functions into `deps.getAuthenticatedSellerAddress`. This **narrows** the
approved file list (strictly smaller blast radius, no architecture change) —
flagged here transparently rather than silently substituted.
`production-payment.ts` is removed from `PROPOSED_FILES_TO_MODIFY`.

## 1. Three-way fail-closed mechanism — final, precise design

The user's CRITICAL FAIL-CLOSED REFINEMENT rejected any
`env.ENVIRONMENT !== 'production' ? fixture : ...`-shaped check (fails open on
missing/unknown values). Independently confirmed this concern is justified:
`env.ENVIRONMENT === 'production'` is **not** a reliable production-vs-local
discriminator in this repository — `wrangler.toml`'s committed `[vars]` sets
`ENVIRONMENT: 'production'` and Phase 0/1 of `scripts/test-worker-runtime.mts`
deliberately test the **exact committed config unmodified**, so
`env.ENVIRONMENT === 'production'` is **also true** during local real-workerd
testing. Using it as the evidence-trust discriminator would have been exactly
the fail-open bug the user flagged.

**The actual reliable, already-governed signal**:
`checkProductionBindingsPresent` (`production-payment.ts`, exported, unmodified,
already required to be called during `resolveProductionCdpEvidenceProvider`'s
own gate #2) checks whether
`SELLER_WALLET_ADDRESS`/`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` are present. These
are real Cloudflare **secrets** (not `[vars]`) — confirmed absent in every
local/`wrangler dev`/qualification run in this repository's history (no test
ever sets them; SUN-1216/1217's own boot logs show them absent from local dev's
binding table) and confirmed present as real, already-provisioned secrets in
real Cloudflare production. Presence/absence of real secret bindings is a hard
fact, not a string comparable to a typo-able literal — there is no
"missing/unknown/invalid" middle state possible.

**New composition-level check** (in `verify-agent-output-v2-cdp-composition.ts`,
wrapping the existing, unmodified `resolveProductionCdpEvidenceProvider` call):

```
resolved evidenceMode !== 'production'
  AND checkProductionBindingsPresent(...).ok === true
    -> real CDP bindings ARE present (this can only be a genuine
       Cloudflare deployment; every local/test run lacks them) yet real
       evidence still could not be established -> FAIL CLOSED,
       {unavailable: true}, never mount a fixture-evidenced route

resolved evidenceMode !== 'production'
  AND checkProductionBindingsPresent(...).ok === false
    -> bindings genuinely absent -> this IS the "explicit test/sandbox"
       context already recognized by repository authority (real secrets
       structurally cannot be present outside real Cloudflare) -> the
       EXISTING fixture fallback continues, completely unchanged
       (required for Phase 6/7's own established real-workerd
       qualification technique and all future local TDD)

resolved evidenceMode === 'production'
    -> real CdpPaymentEvidenceProvider, unchanged, already correct
```

This satisfies the exact three-way split requested: explicit test/sandbox
(bindings absent, recognized structurally, not by a mutable string) → fixture
allowed; production (bindings present, evidence resolves) → real provider
required; missing/unknown/invalid anything else (bindings present but evidence
still unavailable) → fail closed. No new env var. No new parameter threaded
through call sites. No dependency on `env.ENVIRONMENT` at all.

## 2. Task sequence (TDD: red → minimal green → commit, each task independently revertable)

### Task 1 — Wire the already-existing, already-tested seller-address lookup

**File**:
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts`
(modify only).

**Red test** (new file:
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.production-evidence.test.ts`):
supply every ADR-0055 gate true + real-shaped bindings + a mock
`getAuthenticatedSellerAddress` (injected via a new, narrow seam — see below)
that resolves the configured seller address → expect
`config.evidenceMode === 'production'`. This test fails today because the
composition never calls `buildCdpSellerAddressLookup` at all — the field is
always omitted, so `resolveProductionCdpEvidenceProvider` always falls back to
fixture regardless of the other three gates.

**Expected failure reason** (must be this exact reason, not an unrelated
failure): `expect(config.evidenceMode).toBe('production')` receives `'fixture'`.

**Minimal implementation**: import `buildCdpSellerAddressLookup`,
`buildProductionCdpAccountLookupClientFactory` from
`../config/production-payment` (already exported, already tested); inside
`buildVerifyAgentOutputV2CdpProductionRouteConfig`, construct
`getAuthenticatedSellerAddress: buildCdpSellerAddressLookup(buildProductionCdpAccountLookupClientFactory(env), env.SELLER_WALLET_ADDRESS ?? '')`
and pass it into the existing `resolveProductionCdpEvidenceProvider(...)` call's
third argument (replacing the current omission). No change to
`production-payment.ts` (already correct, already tested).

Since this makes a **real CDP SDK call** the moment `SELLER_WALLET_ADDRESS` is a
real-shaped address and the lookup is actually invoked, and the directive
requires **zero live CDP calls** in SUN-1218's own tests, this task's test must
supply the mock account-lookup client shape the existing
`buildCdpSellerAddressLookup` already accepts
(`createClient: () => CdpAccountLookupClient`) — achieved by having the
composition accept `getAuthenticatedSellerAddress` as an **already-supported,
already-optional field** on `ProductionCdpProviderDependencies` (unchanged type)
and testing the composition indirectly through
`resolveProductionCdpEvidenceProvider`'s own existing mock-based test coverage,
plus one new composition-level test that mocks
`buildProductionCdpAccountLookupClientFactory`'s return value via dependency
substitution at the module boundary (vitest `vi.mock` on the
`../config/production-payment` import, mocking only
`buildProductionCdpAccountLookupClientFactory`'s return, never touching the real
`@coinbase/cdp-sdk` import).

**Neighboring regression**: the existing 6 tests in
`verify-agent-output-v2-cdp-composition.test.ts` must continue to pass
unmodified (they never set the ADR-0055 gates true, so they still resolve
`evidenceMode: 'fixture'` exactly as before — proving this wiring is additive,
not behavior-changing for every existing scenario).

**Commit**:
`feat(edge-api): SUN-1218 wire existing CDP seller-address lookup into verify-v2 composition`

### Task 2 — Composition-level fail-closed check (the core R0 closure)

**File**: same file, same function, extend.

**Red test**: mock `resolveProductionCdpEvidenceProvider` (via the composition's
own already-injectable seam, or a targeted `vi.mock`) to return
`{evidenceMode: 'fixture'}` while `checkProductionBindingsPresent` would report
`ok: true` for the supplied env (i.e., simulate "real bindings present but
evidence still unavailable") → expect `'unavailable' in config === true`. Fails
today: the composition currently mounts fixture-evidenced routes unconditionally
whenever `evidenceMode !== 'production'`, regardless of binding presence.

**Expected failure reason**: the assertion `'unavailable' in config` receives
`false` — the route mounts when it must not.

**Minimal implementation**: exactly the three-way check from §1 above, inserted
immediately after the existing `resolveProductionCdpEvidenceProvider` call,
before `buildVerifyAgentOutputV2ProductionExecutor` is constructed (so the
executor/signer are never even built in the fail-closed branch — matches the
existing pattern of every other early-return in this function).

**Negative control test**: bindings genuinely absent (the exact shape every
existing test in this file already uses) + `evidenceMode: 'fixture'` → still
mounts (fixture fallback unchanged) — proves the new check does not regress
local/test behavior.

**Positive control test**: bindings present + `evidenceMode: 'production'` (from
Task 1's real resolution) → still mounts, real provider, unaffected by the new
check.

**Commit**:
`feat(edge-api): SUN-1218 fail closed when real CDP bindings are present but production evidence cannot be established`

### Task 3 — Route-specific activation gate

**Files**: `apps/edge-api/src/control-plane/config/env.ts` (add
`VERIFY_V2_CDP_ROUTE_ENABLED?: string`),
`apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts` (add
the second gate check).

**Red tests** (extend `production-verify-v2-cdp-route.test.ts`):

- global=true, route-specific absent → 404 (currently 503 or reachable, since
  only the global flag is checked today).
- global=true, route-specific=`'true'`, dependencies invalid → existing governed
  503 (unchanged branch, now reached only with both gates true).
- global=false, route-specific=`'true'` → 404 (global remains the first-checked,
  unconditional kill switch).

**Minimal implementation**:
`if (c.env?.PAID_ROUTES_ENABLED !== 'true') return c.notFound(); if (c.env?.VERIFY_V2_CDP_ROUTE_ENABLED !== 'true') return c.notFound();`
— two sequential checks, global first (preserves "global false → 404
unconditionally, before even reading the route-specific flag" per the approved
design's master-kill-switch requirement).

**Commit**:
`feat(edge-api): SUN-1218 add VERIFY_V2_CDP_ROUTE_ENABLED route-specific activation gate`

### Task 4 — Decouple the unsupported wildcard fallbacks from `PAID_ROUTES_ENABLED`

**File**: `apps/edge-api/src/index.ts` (modify only the two wildcard handlers;
`/v1/nevermined/*` and `/v2/nevermined/*` untouched).

**Red test** (new file: `apps/edge-api/src/index.wildcard-decoupling.test.ts`):
for each of the 7 affected routes (`/v1/company/evidence-graph`,
`/v1/web/context`, `/v1/document/evidence-json`, `/v1/verify/agent-output`,
`/v2/company/evidence-graph`, `/v2/web/context`, `/v2/document/evidence-json`),
assert 404 with `PAID_ROUTES_ENABLED: 'true'` — fails today (they return 503).

**Minimal implementation**:

```ts
app.all('/v1/*', (c) => c.notFound());
app.all('/v2/*', (c) => c.notFound());
```

`productionServiceExecutorUnavailable` import stays (still used inside
`production-verify-v2-cdp-route.ts`'s own dependency-unavailable branch);
`/v1/nevermined/*`/`/v2/nevermined/*` handlers are not touched, byte-for-byte.

**Regression**: the existing `index.test.ts` (25 tests, SUN-1216) must continue
to pass — re-verify each of its "other 11 routes" assertions against the new
unconditional-404 behavior (some of its existing "enabled → 503" assertions for
`/v1/*`/`/v2/*` members will need updating to "enabled → 404" to match the
corrected, intentional behavior — this is an intentional, disclosed
test-expectation change, not a weakened assertion, since the underlying behavior
itself is what changed by design).

**Commit**:
`fix(edge-api): SUN-1218 unsupported /v1/* and /v2/* routes stay 404 regardless of PAID_ROUTES_ENABLED`

### Task 5 — Synthetic evidence reintroduction mutation proof (Proof D)

**File**: `scripts/test-production-fixture-reintroduction-caught.mts` (extend
with `runProofD()`).

Mutates `verify-agent-output-v2-cdp-composition.ts` to bypass the new §2
fail-closed check (e.g., commenting out the `checkProductionBindingsPresent`
branch, or hard-coding `evidenceMode` acceptance) — requires the new Task 2
structural/behavioral test to catch it via a real `vitest run` subprocess,
restores byte-for-byte (hash-verified), matching Proofs A/B/C's established
pattern exactly.

```
PRODUCTION_SYNTHETIC_EVIDENCE_REINTRODUCTION_CAUGHT=YES
```

**Commit**:
`test(edge-api): SUN-1218 Proof D — synthetic evidence reintroduction into production-mode path is caught`

### Task 6 — Real-workerd qualification (new Phase 8, controlled doubles only)

**File**: `scripts/test-worker-runtime.mts` (extend).

Per the directive's explicit boundary: **no live CDP call**. New Phase 8 runs
the REAL production entrypoint (`wrangler.toml`/`index.ts`, matching Phase 7's
own pattern) with:

- `PAID_ROUTES_ENABLED=true`, `VERIFY_V2_CDP_ROUTE_ENABLED=true` (both
  new/existing flags true).
- The two paid-signing vars (local/test key, exactly as Phase 7 already does —
  never the real SUN-1215 secret).
- **No** `SELLER_WALLET_ADDRESS`/`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` overrides
  — `wrangler.toml`'s committed `[vars]` supplies `SELLER_WALLET_ADDRESS`
  (non-secret), and the two CDP secrets remain genuinely absent in this local
  run (exactly as every prior phase), which is precisely what keeps this test on
  the safe, `checkProductionBindingsPresent().ok === false` side of Task 2's
  fail-closed check — proving the _existing_ fixture qualification path (real
  signer, real receipt, real x402 lifecycle, fixture-mode payment evidence)
  continues to work end-to-end through the now-double-gated route, without ever
  attempting a live CDP call.

Required scenarios, mirroring Phase 7 exactly but through both new gates:

- global=false/route=false → 404 (all 12 routes, including verify).
- global=true/route=false → 404 (all 12, including verify — the new regression
  Phase 7 itself could not prove, since the route-specific gate didn't exist
  yet).
- global=false/route=true → 404 (all 12).
- global=true/route=true, valid local config → real 402 → real post-settlement
  success (mirrors Phase 7's existing (1)/(2) exactly, now reached through two
  gates instead of one).
- global=true/route=true, dependency invalid (e.g. missing signing key var) →
  governed 503, never a payment challenge.
- toggling global back to false after a success mid-session → immediate 404
  (kill-switch-still-works regression).
- the other 11 routes stay 404 in every one of the above states (re-verified
  fresh under the new wildcard-decoupled behavior).

**Commit**:
`test(edge-api): SUN-1218 Phase 8 — real-workerd two-gate activation qualification, controlled doubles only`

### Task 7 — Bundle-inclusion / bundle-isolation proof

**File**: `scripts/test-worker-runtime.mts`'s `runBundleIsolationCheck()`
(extend).

Assert the real production dry-run bundle contains
`buildCdpSellerAddressLookup`/`buildProductionCdpAccountLookupClientFactory`
(now genuinely reachable, since Task 1 wires them into the reachable
composition) and still contains zero hard-bypass fixture markers (unchanged
check from SUN-1216 §9/§18b) and zero reachable live-CDP-call markers beyond
what's already proven inert (the facilitator client factory closure, already
present and already proven never eagerly invoked, per SUN-1214's own established
proof).

**Commit**:
`test(edge-api): SUN-1218 bundle proof — production evidence + route-gate code confirmed in the real bundle`

### Task 8 — Full regression + evidence report

Run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:worker-runtime`, all
four fixture-reintroduction proofs (A/B/C/D), `pnpm pricing:check`,
`pnpm x402:check`, `pnpm verification:check`, `pnpm services-runtime:check`,
`pnpm mcp:check`, `pnpm a2a:check`, `pnpm nevermined:check`,
`pnpm contracts:baseline:verify`/`compat:check`/`release:verify`,
`pnpm migrations:verify`, `pnpm production:preflight`, `pnpm format:check`,
`pnpm secrets:scan`. Live production containment re-verified before and after
(read-only checks only — no deployment, per the absolute boundary).

Write
`docs/reports/SUN-1218-checkpoint-x-payment-evidence-production-trust-closure.md`
per the directive's required §31 report sections.

**Commit**: `docs(reports): SUN-1218 checkpoint X closure report`

## 3. Mandatory TDD properties — mapped to tasks

| Required property                                                                 | Task                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| production cannot select synthetic_fixture                                        | 2                                                                                         |
| explicit test/sandbox mode can use synthetic evidence only where contract permits | 2 (negative control)                                                                      |
| missing/unknown ENVIRONMENT fails closed rather than selecting fixture            | 2 (mechanism doesn't read `ENVIRONMENT` at all — structurally impossible to be ambiguous) |
| real production mode selects CdpPaymentEvidenceProvider                           | 1                                                                                         |
| seller-address resolution failure is pre-economic                                 | 1 (existing, unmodified `resolveProductionCdpEvidenceProvider` try/catch, already proven) |
| provider construction failure is pre-economic                                     | 2                                                                                         |
| synthetic evidence reintroduction is caught permanently                           | 5                                                                                         |
| global=false/route=false → 12/12 404                                              | 3, 4, 6                                                                                   |
| global=true/route=false → 12/12 404                                               | 3, 4, 6                                                                                   |
| global=false/route=true → 12/12 404                                               | 3, 4, 6                                                                                   |
| global=true/route=true → verify governed, other 11 404                            | 3, 4, 6                                                                                   |
| qualified verify with missing dependency → verify 503, other 11 404               | 3, 6                                                                                      |
| turning master flag back off → immediate 404                                      | 6                                                                                         |
| Nevermined behavior unchanged                                                     | 4 (untouched files, regression-tested)                                                    |
| real workerd exercises the production composition, controlled seams               | 6                                                                                         |
| no fixture/test evidence provider reachable from production mode                  | 2, 5                                                                                      |
| bundle reachability matches intended production graph                             | 7                                                                                         |

## 4. Task sequence

```
TASK_SEQUENCE=[
  "Task 1: wire existing buildCdpSellerAddressLookup/buildProductionCdpAccountLookupClientFactory into the composition",
  "Task 2: composition-level fail-closed check (bindings-present-but-evidence-unavailable -> unavailable)",
  "Task 3: VERIFY_V2_CDP_ROUTE_ENABLED route-specific gate",
  "Task 4: decouple /v1/* and /v2/* wildcards from PAID_ROUTES_ENABLED (unconditional 404)",
  "Task 5: Proof D -- synthetic evidence reintroduction mutation proof",
  "Task 6: real-workerd Phase 8 -- two-gate qualification, controlled doubles only, zero live CDP calls",
  "Task 7: bundle-inclusion proof for the new production evidence + route-gate code",
  "Task 8: full regression + evidence report"
]
```

## 5. Commit sequence

```
COMMIT_SEQUENCE=[
  "feat(edge-api): SUN-1218 wire existing CDP seller-address lookup into verify-v2 composition",
  "feat(edge-api): SUN-1218 fail closed when real CDP bindings are present but production evidence cannot be established",
  "feat(edge-api): SUN-1218 add VERIFY_V2_CDP_ROUTE_ENABLED route-specific activation gate",
  "fix(edge-api): SUN-1218 unsupported /v1/* and /v2/* routes stay 404 regardless of PAID_ROUTES_ENABLED",
  "test(edge-api): SUN-1218 Proof D -- synthetic evidence reintroduction into production-mode path is caught",
  "test(edge-api): SUN-1218 Phase 8 -- real-workerd two-gate activation qualification, controlled doubles only",
  "test(edge-api): SUN-1218 bundle proof -- production evidence + route-gate code confirmed in the real bundle",
  "docs(reports): SUN-1218 checkpoint X closure report"
]
```

Each commit is independently revertable; no commit depends on a later one's
tests to pass (standard TDD red→green→commit discipline, matching every prior
checkpoint's established practice in this repository).

## 6. Boundaries reaffirmed for implementation

No Cloudflare mutation of any kind (`WORKER_VERSIONS_CREATED=0`,
`DEPLOYMENTS=0`, `TRAFFIC_SHIFTS=0`, `PRODUCTION_SECRET_CHANGES=0`,
`PRODUCTION_BINDING_CHANGES=0`, `PRODUCTION_MIGRATIONS=0`). No live CDP provider
call anywhere in this checkpoint's tests (`LIVE_CDP_PROVIDER_CALLS=0`) — every
test uses the existing, already-proven mock-based seams
(`CdpAccountLookupClient` mocks, `HTTPFacilitatorClient` mocks) that
`production-payment-gate.test.ts` already established. `x402-service.ts`,
`VerifyAgentOutputService`, Profile 1 validation, receipt format, D1 schema, and
pricing remain untouched. Nevermined remains untouched. No new caching subsystem
— the existing route-level successful-sub-app cache
(`production-verify-v2-cdp-route.ts`, unmodified) already provides the
per-isolate reuse property the approval message accepted as sufficient.

---

## SUN-1218 IMPLEMENTATION PLAN COMPLETE

```
SUN1218_IMPLEMENTATION_PLAN=COMPLETE
TASK_SEQUENCE=[Task 1..Task 8, see §4]
COMMIT_SEQUENCE=[8 commits, see §5]
RUNTIME_IMPLEMENTATION_STARTED=NO
```

**Requesting implementation authorization.**
