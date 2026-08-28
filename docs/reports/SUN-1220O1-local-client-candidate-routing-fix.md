# SUN-1220O1 — Local Client Candidate-Routing Fix

Scope: TDD + regression + commit only. No live 402, no signing, no payment
material, no deployment, no traffic shift, no settlement. See attempt-1
evidence and root-cause finding in
[`SUN-1220O-first-real-paid-e2e.md`](./SUN-1220O-first-real-paid-e2e.md).

## 0. Evidence-integrity correction

The checkpoint that opened this work stated the root cause as the
`Cloudflare-Workers-Version-Overrides` header being entirely absent from
the SUN-1220J local client. Source inspection (`git show
09d41ef:apps/edge-api/tests/live/first-paid-e2e-local.test.ts`) proves that
premise false — the header was present on both requests from the original
SUN-1220J commit onward. The actual defect, confirmed by grepping every
prior live proof of this mechanism, was a missing pair of quotes around the
version-id token in the header **value** (`key=id` instead of the proven
`key="id"`), which Cloudflare's RFC-8941 structured-field-value parser
silently drops, falling through to ordinary 100%-traffic routing. Full
detail in §"Root cause" of the SUN-1220O report linked above. This
checkpoint proceeded against the corrected, narrower root cause.

## 1. Evidence trail

```
SUN1220O_ATTEMPT_1_CLOSED_PRE_ECONOMIC = YES
ATTEMPT_1_AUTHORIZATION_CONSUMED       = YES
ATTEMPT_1_REAL_ECONOMIC_EFFECT_USDC    = 0
```

## 2. Proven version-override mechanism

```
VERSION_OVERRIDE_HEADER_NAME         = Cloudflare-Workers-Version-Overrides
VERSION_OVERRIDE_HEADER_VALUE_SHAPE  = <script-name>="<version-id>"
VERSION_OVERRIDE_CONSTRUCTION_HELPER = none
```

No shared TS helper for this header exists anywhere in the repository;
every prior proof (SUN-1210 P/P2/P3/P4, SUN-1211 Q, SUN-1219C, SUN-1220N)
constructed it as a literal curl `-H` string. `grep -h "Version-Overrides"
docs/reports/*.md` returns 8 occurrences across 6 independent checkpoints,
8/8 quoted, 0/8 unquoted — the fix below reuses that exact, unanimous
shape rather than inventing new header syntax.

## 3. Design

Both the fresh unpaid-challenge request and the single paid-submission
request already targeted the same `TARGET_URL` and already carried
`VERSION_OVERRIDE_HEADER_VALUE` on the same module constant (one shared
value, not two independently constructed ones) — so "both requests use the
identical override" was already structurally guaranteed by the existing
code shape. Only the value's format needed correction.

```
CANDIDATE_VERSION_ARBITRARY_INPUT_POSSIBLE = NO
```

`CANDIDATE_VERSION_ID` is a private module `const`, never read from
`process.env`, `process.argv`, or any function parameter — confirmed by
existing tests AB/AC/AD (unchanged) plus the new inspection in this
checkpoint. No environment/config override path exists, so there is
nothing to "hard-bind" beyond what the module constant already enforces
(Approach A, already in place).

## 4. TDD

**RED** — added test `S/T. the unpaid and paid requests carry the
identical, exact proven Cloudflare-Workers-Version-Overrides value
(SUN-1220O1)` asserting `headers[VERSION_OVERRIDE_HEADER]` equals the
quoted proven shape on both calls. Run against the pre-fix source:

```
AssertionError: expected 'siteborne-utility-edge=a0055146-d358-…' to be 'siteborne-utility-edge="a0055146-d358…'
Tests  1 failed | 1 passed | 27 skipped (29)
```

**Minimal implementation** — one line, `apps/edge-api/tests/live/first-paid-e2e-local.test.ts`:

```diff
-const VERSION_OVERRIDE_HEADER_VALUE = `${WORKER_SCRIPT_NAME}=${CANDIDATE_VERSION_ID}`;
+const VERSION_OVERRIDE_HEADER_VALUE = `${WORKER_SCRIPT_NAME}="${CANDIDATE_VERSION_ID}"`;
```

**GREEN**:

```
Tests  28 passed | 1 skipped (29)
```

```
UNPAID_REQUEST_TARGETS_FROZEN_CANDIDATE     = YES
VERSION_OVERRIDE_PRESENT_ON_UNPAID_REQUEST  = YES
PAID_REQUEST_TARGETS_FROZEN_CANDIDATE       = YES
VERSION_OVERRIDE_PRESENT_ON_PAID_REQUEST    = YES
UNPAID_AND_PAID_REQUEST_CANDIDATE_ID_EQUAL  = YES
```

## 5. Test matrix coverage (A–T)

Items A, C–E, G–W, Y–AD were already covered by the pre-existing SUN-1220J
suite (unchanged by this checkpoint — re-verified GREEN in the same run).
B/F/S/T are exercised by the new test added in §4, which additionally
proves the override can never coincide with the known-good production
version id. Full 28-test run below.

## 6. Regression

```
lint             16/16 PASS
typecheck        23/23 PASS
test             2212/2212 passed, 37 skipped (was 2211 before this checkpoint's +1 test)
test:worker-runtime  88/88 scenarios passed
production:preflight PASS (12/12 paid routes structurally unavailable; 6/6 secrets present)
secrets:scan      PASS (gitleaks: 227 commits scanned, no leaks; working-tree scan, no leaks)
LIVE_PAYMENT_NETWORK_CALLS = 0
LIVE_PAYMENT_TEST_SKIPPED_BY_DEFAULT = YES
```

## 7. Worker isolation

```
PRODUCTION_WORKER_SOURCE_CHANGED = NO
WORKER_ROUTING_CHANGED           = NO
WRANGLER_CONFIG_CHANGED          = NO
PAID_ROUTE_COMPOSITION_CHANGED   = NO
SUN1220J_LOCAL_CLIENT_ONLY_CHANGE = YES
```

Only `apps/edge-api/tests/live/first-paid-e2e-local.test.ts` changed (a file
under `apps/edge-api/tests/`, structurally unreachable from
`wrangler.toml`'s `main` entrypoint — proven by this file's own tests Z/AA,
re-run GREEN in §6).

## 8. Production containment (read-only)

```
FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%
```

`wrangler deployments status`: unchanged since SUN-1220N's restoration —
single deployment, `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` @ 100%. No
candidate active. No new deployment created by this checkpoint.

## 9. Mutation accounting

```
WORKER_VERSIONS_CREATED=0  DEPLOYMENTS=0        TRAFFIC_SHIFTS=0
CANDIDATE_REQUESTS=0       LIVE_402_REQUESTS=0   LIVE_CDP_CALLS=0
LIVE_SIGN_TYPED_DATA_CALLS=0  EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_PAYLOADS_CREATED=0  PAYMENT_SIGNATURES_CREATED=0  LIVE_PAID_REQUESTS=0
SETTLEMENTS=0  TRANSACTIONS=0  REAL_ECONOMIC_EFFECTS=0
```

## 10. Final stop packet

```
SUN1220O1_CANDIDATE_ROUTING_FIX             = PASS
SUN1220O1_IMPLEMENTATION_COMMIT_SHA         = <recorded post-commit below>
ATTEMPT_1_CLOSED                            = YES
ATTEMPT_1_AUTHORIZATION_CONSUMED            = YES
ATTEMPT_1_REAL_ECONOMIC_EFFECT_USDC         = 0
ROOT_CAUSE_FIXED                            = YES
VERSION_OVERRIDE_HEADER_NAME                = Cloudflare-Workers-Version-Overrides
FROZEN_CANDIDATE_VERSION_ID                 = a0055146-d358-40d4-b0af-52eccc56c8ef
VERSION_OVERRIDE_PRESENT_ON_UNPAID_REQUEST  = YES
VERSION_OVERRIDE_PRESENT_ON_PAID_REQUEST    = YES
UNPAID_AND_PAID_REQUEST_CANDIDATE_ID_EQUAL  = YES
CANDIDATE_VERSION_ARBITRARY_INPUT_POSSIBLE  = NO
ECONOMIC_CONTRACT_CHANGED                   = NO
AUTOMATIC_RETRY_AFTER_PAYMENT_MATERIAL_CREATED = NO
AUTOMATIC_RETRY_AFTER_PAID_SUBMISSION       = NO
PRODUCTION_WORKER_REACHABILITY              = 0
LIVE_PAYMENT_TEST_SKIPPED_BY_DEFAULT        = YES
TESTS                                       = 2212 passed, 37 skipped
WORKER_RUNTIME                              = 88/88
PRODUCTION_PREFLIGHT                        = PASS
SECRETS_SCAN                                = PASS
WORKER_VERSIONS_CREATED=0  DEPLOYMENTS=0  TRAFFIC_SHIFTS=0
LIVE_402_REQUESTS=0  LIVE_SIGN_TYPED_DATA_CALLS=0  PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0  SETTLEMENTS=0  TRANSACTIONS=0  REAL_ECONOMIC_EFFECTS=0
FOLLOWUP_REAL_PAID_E2E_ELIGIBLE             = YES
```

STOP. The follow-up real payment attempt is not performed in this
checkpoint.
