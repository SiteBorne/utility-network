# SUN-1220Q2 — `/ready` Production-Service-State Runtime Truthfulness (Implementation)

TDD implementation only. No D1 write, no Worker upload, no deployment, no
traffic shift, no live requests, no 402, no payment, no canary, no
promotion, no process cleanup.

## Evidence chain

```
SUN1220Q_FAILURE_EVIDENCE_COMMIT_SHA  = 09a7862ec2285629adbe04e7fae6ae400534d127
SUN1220Q1_DESIGN_EVIDENCE_COMMIT_SHA  = a5a1ea59062f28456bdf5d5b1fda35ec9475222b
WORKING_TREE_CLEAN (before implementation) = YES
```

## §2: actual implementation identified

```
READY_HANDLER_FUNCTION            = readinessRoute.get('/', ...) in apps/edge-api/src/routes/readiness.ts
READY_RESPONSE_TYPE               = ReadinessResponse / ReadinessResponseSchema (packages/contracts/src/index.ts)
P2_EFFECTIVE_DISCOVERY_RESOLVER    = resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus (apps/edge-api/src/control-plane/config/production-payment.ts)
P2_RUNTIME_GATE_AUTHORITY          = isVerifyAgentOutputV2CdpRouteFlagEnabled + isProductionPaymentAuthorized(resolveProductionAuthorizationInput(env)) + PAID_RECEIPT_SIGNING_{PRIVATE_KEY,KEY_ID} presence + checkProductionBindingsPresent(env).ok + hasDb
```

Confirmed by direct read before editing: the original `readiness.ts` handler
never referenced `c.env` at all — every field was a compile-time-constant
object literal. `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`'s
exact signature is `(env: VerifyAgentOutputV2CdpDiscoveryEnv, hasDb: boolean)
=> boolean` — identical to how `catalog.ts`'s `overlayEffectiveDiscoveryStatus`
already calls it.

## §3: schema frozen

`ReadinessResponseSchema` (unchanged): `status: enum('ready'|'not_ready')`,
`phase: string`, `production_services_enabled: boolean`, `blocked_external:
string[]`, `reason: string`. All 5 fields, all types, unchanged.

```
READY_RESPONSE_SCHEMA_CHANGED = NO
```

## §5–§10: RED tests

New file: `apps/edge-api/tests/readiness-truthfulness.test.ts` (18 tests),
harness mirrors `discovery-truthfulness.test.ts` (real `app` from
`../src/index`, `app.request('/ready', {}, env)`, known-good-equivalent vs
candidate-equivalent env fixtures, a fake D1 satisfying
`D1ServicesRepository` for the cross-surface `/catalog` check).

Run against the **unmodified** source:

```
$ npx vitest run apps/edge-api/tests/readiness-truthfulness.test.ts
 Test Files  1 failed (1)
      Tests  5 failed | 13 passed (18)
```

The 5 failures were exactly the ones demonstrating the real defect:

- `CASE B (fully qualified candidate-equivalent): production_services_enabled=true` — expected `true`, got `false`
- `no longer lists the three Q1-proven-stale blockers (known-good env)` — still contained `cloudflare_account_configuration`
- `no longer lists the three Q1-proven-stale blockers (candidate env)` — same
- `blocked_external contains exactly the 3 unproven items, nothing else` — contained all 6 original items
- `qualified: catalog selected-service active AND ready.production_services_enabled=true` — cross-surface: catalog correctly `true`, ready incorrectly `false`

The 13 passes were gate-off permutations (CASE C–I, I2) that already
correctly returned `false` under the old hardcoded-`false` source — expected
per §6 (protective tests, not the primary RED) — plus the status/phase/reason
preservation tests and the known-good cross-surface test (both sides already
`false`).

```
READY_PRODUCTION_SERVICES_TDD_RED_PROVEN = YES
READY_STALE_BLOCKERS_TDD_RED_PROVEN       = YES
READY_CROSS_SURFACE_TDD_RED_PROVEN        = YES
```

## §11–§13: minimal implementation

`apps/edge-api/src/routes/readiness.ts`:

- `readinessRoute` retyped `new Hono<{ Bindings: Env }>()` (was untyped
  `new Hono()`), matching `catalogRoute`'s existing pattern.
- Handler now computes `hasDb = Boolean(c.env?.DB)` and calls the **same**
  `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus(c.env, hasDb)`
  `/catalog` already uses — zero gate logic duplicated.
- `blocked_external` literal reduced from 6 items to the 3 Q1 could not
  prove resolved: `ionos_dns_migration`, `nevermined_credentials`,
  `registry_publication`.
- `status`, `phase`, `reason` untouched.

```
READY_DUPLICATES_PAID_GATE_LOGIC        = NO
P2_EFFECTIVE_DISCOVERY_RESOLVER_REUSED  = YES
STALE_BLOCKERS_REMOVED_COUNT            = 3
UNPROVEN_BLOCKERS_REMOVED_COUNT         = 0
D1_SCHEMA_CHANGE = NO, D1_WRITE_PATH_CHANGED = NO, D1_WRITES = 0
SHARED_RUNTIME_TOGGLE_ADDED = NO
READY_EFFECTIVE_STATE_VERSION_LOCAL = YES
```

## §18: GREEN

```
$ npx vitest run apps/edge-api/tests/readiness-truthfulness.test.ts
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

```
READY_PRODUCTION_SERVICES_TDD_GREEN = YES
READY_STALE_BLOCKERS_TDD_GREEN       = YES
READY_CROSS_SURFACE_TDD_GREEN        = YES
ALL_READY_TRUTH_TABLE_TESTS          = PASS
```

No assertion was weakened to reach green — the 5 RED failures above became
5 passes; all 13 already-passing assertions remained unchanged and still
pass.

## §19: mutation proof

New script: `scripts/test-readiness-truthfulness-mutation-caught.mts`,
mirroring the existing `test-discovery-truthfulness-mutation-caught.mts`
pattern (apply mutation → require the target test file FAILS → restore
byte-for-byte via SHA-256 verification in a `finally` block → re-run full
suite once more at the end on fully-restored source).

16 mutations, covering: `production_services_enabled` hardcoded false/true,
each of the 7 gate/binding checks ignored (master flag, route flag,
`PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED`, required-binding presence), each of
the 3 stale blockers reintroduced, the one unproven blocker accidentally
dropped, `hasDb` ignored at both the readiness-local and shared-resolver
layer, and an economic-metadata-drift mutation caught by the existing
domain-metadata suite (proving Q2 neither touched nor weakened it).

```
$ npx tsx scripts/test-readiness-truthfulness-mutation-caught.mts
[readiness-mutation-proof] 16/16 caught, 0 skipped, 0 NOT CAUGHT
[readiness-mutation-proof] PASS
```

```
READY_TRUTHFULNESS_MUTATION_PROOF = PASS
READY_MUTATIONS_CAUGHT            = 16/16
```

## §20: source-scope classification

```
$ git status --short
 M apps/edge-api/src/routes/readiness.ts        -- READY_HANDLER
 M apps/edge-api/tests/routes.test.ts            -- READY_TEST (existing test correction, see below)
?? apps/edge-api/tests/readiness-truthfulness.test.ts   -- READY_TEST
?? scripts/test-readiness-truthfulness-mutation-caught.mts -- MUTATION_PROOF
```

`apps/edge-api/tests/routes.test.ts` was not anticipated by this
checkpoint's plan. Running the full suite (`pnpm test`) after the RED→GREEN
cycle surfaced one pre-existing test
(`Health and Readiness Routes > GET /ready returns not_ready with correct
phase`) that asserted the **old, stale** behavior — `blocked_external`
containing `cloudflare_account_configuration` — as the expected value. This
is the exact class of test the §0 TDD law warns about in reverse: the test
encoded the defect itself as "correct." It was updated to assert
`ionos_dns_migration` (one of the 3 items Q1 proved still unresolved)
instead, with a comment citing Q1/Q2. No other file was touched. No
settlement, payment-provider, receipt-signer, executor, route-composition,
D1 migration/write path, or buyer-client file appears in this diff.

## §15/§16/§17: coherence, isolation, economic non-change

`READY_CATALOG_OVERLAP_COHERENCE = PASS` — proven directly by the two
cross-surface tests in §5–§10 (known-good: both `false`; qualified: both
`true`).

Other-11-route and Nevermined isolation: unaffected by inspection (no file
touched outside `readiness.ts`/tests/mutation-proof) and confirmed by the
full `pnpm test:worker-runtime` run (§21) still showing all 4
non-Nevermined-verify routes and the other-7-non-Nevermined routes exactly
as before (Phase 7/8, 12/12 structurally unavailable pre-economics) and all
Nevermined runtime tests unchanged.

```
OTHER_11_PAID_ROUTES_RUNTIME_CHANGED   = NO
OTHER_11_PAID_ROUTES_DISCOVERY_CHANGED = NO
NEVERMINED_RUNTIME_CHANGED             = NO
NEVERMINED_DISCOVERY_CHANGED           = NO
```

Economic path: no file under settlement/payment-provider/receipt-signer/
service-executor/route-composition/buyer-client was touched. The
domain-metadata test suite (`verify-agent-output-v2-cdp-composition.
domain-metadata.test.ts`, 6 tests) passes unchanged, and mutation #16 above
proves that suite would independently catch any drift in
`resolvePaymentAsset`.

```
ECONOMIC_EXECUTION_PATH_CHANGED = NO
PAID_ROUTE_COMPOSITION_CHANGED  = NO
BUYER_CLIENT_CHANGED            = NO
```

## §21: full regression

```
$ pnpm lint            -- 16/16 tasks successful
$ pnpm typecheck        -- 23/23 tasks successful (edge-api cache-miss, ran clean)
$ pnpm test             -- 184 files passed, 19 skipped (live tests) | 2245 tests passed, 37 skipped
$ pnpm test:worker-runtime  -- 88/88 scenarios passed
$ pnpm production:preflight -- PREFLIGHT RESULT: PASS
$ pnpm secrets:scan      -- 1 finding: BASESCAN_TOKEN_CONTRACT (known, pre-existing, same fingerprint
                             as every prior checkpoint since SUN-1220O), 238 commits scanned
```

`pnpm test` includes (by inclusion in the same run): the new Q2 `/ready`
truth-table tests (18), the Q2 mutation proof (run separately, §19), the
existing P2 discovery-truthfulness tests (15, unchanged, all pass), the P2
mutation proof (not re-run in this checkpoint — no P2-scope file was
touched), the 12-route activation/isolation truth table
(`test:worker-runtime` Phase 8, States A–D), SUN-1220L domain-metadata
tests (6, unchanged, pass), and the fixture-isolation/bundle proofs
(`test:worker-runtime`'s bundle-inclusion/bundle-isolation checks).

```
LINT = PASS
TYPECHECK = PASS
TESTS = 2245 passed, 0 failed, 37 skipped (live-only)
WORKER_RUNTIME = 88/88 PASS
PRODUCTION_PREFLIGHT = PASS
SECRETS_SCAN = FAIL_WITH_KNOWN_FALSE_POSITIVE (gitleaks process exit 1 on the one known finding; scan itself surfaced 0 new)
NEW_SECRET_FINDINGS = 0
```

## §22: Worker bundle safety

```
$ npx wrangler deploy --dry-run --outdir /tmp/sun1220q2-bundle
Total Upload: 6254.70 KiB / gzip: 1020.34 KiB
```

Confirmed directly in the emitted bundle (`grep`, then deleted):

- `blocked_external: ["ionos_dns_migration", "nevermined_credentials", "registry_publication"]` — the corrected array literal, present exactly once, exactly as written.
- `cloudflare_account_configuration` appears exactly once in the whole bundle — inside the doc comment explaining the removal, never inside the served array or any other executable string.
- `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus` present in the bundle (the reused resolver, not a duplicate).

`test:worker-runtime`'s own bundle-safety assertions (unaffected by this
checkpoint's diff, re-confirmed by the same run cited in §21):
`hardBypassMarkers=0`, both disclosed findings proven unreachable/fail-closed,
no fixture service executor in the real bundle, no test-only entrypoint
chunk in the real bundle.

```
READY_FIX_PRESENT_IN_BUNDLE = YES
BUYER_SIGNING_CODE_REACHABILITY = 0
CDP_WALLET_SECRET_RUNTIME_REACHABILITY = 0
PRODUCTION_FIXTURE_REACHABILITY = 0
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY = 0
```

No new Worker secret was introduced (readiness.ts reads only the same
non-secret + secret-presence-only fields `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`
already required — no new binding, no new secret name).

## §23: read-only production containment

```
$ npx wrangler deployments status
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
$ pnpm production:preflight
[production:preflight] PREFLIGHT RESULT: PASS
```

```
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
ACTIVE_DEPLOYMENT_VERSION_COUNT = 1
```

No live HTTP request was made against production in this checkpoint (the
bundle check used `--dry-run`, which performs no network deploy).

## §24: historical evidence transfer

This checkpoint's diff is readiness-only: no file under the economic
execution path was changed (§17). The historical real paid E2E therefore
remains valid.

```
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID = YES
REAL_PAID_E2E_REPEAT_REQUIRED = NO
P4_ECONOMIC_EQUIVALENCE_EVIDENCE_REMAINS_VALID = YES
P5_CANARY_EVIDENCE_REMAINS_HISTORICALLY_VALID = YES
HISTORICAL_Q_CANDIDATE = 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
HISTORICAL_Q_CANDIDATE_REUSABLE_FOR_PROMOTION = NO
NEW_CANDIDATE_REQUIRED = YES
NEW_ZERO_TRAFFIC_QUALIFICATION_REQUIRED = YES
NEW_PUBLIC_CANARY_REQUIRED = YES
```

The Worker source has changed since `8a1cdfe1` was built; any future
promotion must be against a freshly uploaded candidate built from this
commit, taken through the same zero-traffic qualification and public-canary
sequence P3–P5 already established as the required path — not authorized
by this checkpoint.

## §27: stale wrangler tails

```
PREEXISTING_STALE_WRANGLER_TAIL_PROCESSES = YES
BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED = NO
```

Out of scope for this checkpoint; not touched.

## §28: mutation accounting

```
D1_SCHEMA_CHANGES=0  D1_WRITES=0  WORKER_VERSIONS_CREATED=0  DEPLOYMENTS=0
TRAFFIC_SHIFTS=0  LIVE_REQUESTS=0  LIVE_CANDIDATE_REQUESTS=0  LIVE_402_REQUESTS=0
LIVE_CDP_CALLS=0  LIVE_SIGN_TYPED_DATA_CALLS=0  EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_PAYLOADS_CREATED=0  PAYMENT_SIGNATURES_CREATED=0  LIVE_PAID_REQUESTS=0
SETTLEMENTS=0  TRANSACTIONS=0  REAL_ECONOMIC_EFFECTS=0  PROCESS_TERMINATIONS=0
```

## Summary

`SUN1220Q2_READY_TRUTHFULNESS_IMPLEMENTATION = PASS`. `/ready`'s
`production_services_enabled` now reuses the exact same version-local
resolver `/catalog` already uses (zero duplicated gate logic), its
`blocked_external` snapshot no longer lists the 3 items Q1 proved stale
while still carrying forward the 3 it could not prove resolved, and
`status`/`phase`/`reason` are unchanged. Full regression, mutation proof,
and bundle-safety checks all pass; production is untouched throughout. A
new candidate build, zero-traffic qualification, and public canary are
required before this fix can ever reach production — none of which is
authorized by this checkpoint.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
