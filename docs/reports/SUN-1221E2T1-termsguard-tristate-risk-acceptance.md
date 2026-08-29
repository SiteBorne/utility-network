# SUN-1221E2T1 — TermsGuard tri-state correctness: explicit operator-risk-acceptance semantics

## Why this checkpoint exists

SUN-1221E2T successfully recorded the operator's already-authorized
`direct-public-http` risk-acceptance review and proved the real workerd
canonical fetch succeeded past `globalTermsGuard`. In doing so it also
surfaced a separate, latent defect: `TermsGuard.checkAccess`'s three
`ProviderManifest` permission checks used `if (!manifest.some_flag)`, but
those flags are typed `boolean | 'unknown'`. Since the string `'unknown'`
is JS-truthy, `!'unknown'` is `false`, so the check silently passed for
`'unknown'` exactly as it would for an explicit `true`. `direct-public-http`
happened to pass the terms gate only because of this bug, not because of a
correct, intentional code path -- the capability must not rely on that.

## Root-cause reproduction (§3)

Standalone script against the unmodified `TermsGuard`:

```
BUG CONFIRMED: checkAccess did NOT throw for commercial_application_allowed=unknown
(should fail closed, but unknown is JS-truthy)
```

`UNKNOWN_TRUTHINESS_BUG_REPRODUCED=YES`.

Confirmed at the type level: `packages/provider-adapters/src/types.ts` declares
`commercial_application_allowed: z.union([z.boolean(), z.literal('unknown')])`
(and the same for `automated_access_allowed`, `transformed_output_allowed`,
`raw_access_resale_allowed`) -- a genuine tri-state, not a boolean.

## Two distinct governance modes (§4)

Added an explicit, required `reviewBasis` field to `TermsReview`:

- **`provider_terms_review`**: SITEBORNE asserts permissions derived from a
  named provider's own reviewable Terms of Service. All three permission
  flags must be the literal boolean `true` -- `false` *and* `'unknown'*` both
  fail closed (`isExplicitlyAllowed()`).
- **`operator_risk_acceptance`**: there is no single reviewable ToS for this
  capability (e.g. `direct-public-http`, where every buyer-supplied URL
  carries its own, unreviewed terms). The SITEBORNE operator has explicitly
  accepted the bounded operational risk for this exact capability. The
  permission flags are not asserted and may legitimately remain `'unknown'`
  (`isCapabilityRiskAccepted()`).

`REVIEW_BASIS_SCHEMA_REQUIRED=YES` -- the existing schema (providerId,
termsUri, termsHash, reviewedAt, status, reviewer, notes) had no field
capable of representing this distinction; `reviewBasis` was the smallest
addition that does.

An unrecognized or missing `reviewBasis` (e.g. a review object built outside
the type system) structurally falls through to the strict
`provider_terms_review` path -- fail-closed is the default, never the
permissive mode by accident (§11, proven by a dedicated test).

## TDD (§6-§14)

New file `packages/provider-adapters/src/tests/termsguard-tri-state.test.ts`
(23 tests): unit tests for both new exported helpers, full permission-gate
matrix for `provider_terms_review` (true/false/`'unknown'`/missing-basis),
and full matrix for `operator_risk_acceptance` (exact match, wrong provider,
wildcard id, browser id, rejected/blocked review, no review at all, and a
proof the manifest's own tri-state data is never silently coerced to `true`).

**RED** (genuine): source (`terms-guard.ts`) and its two existing fixture
files stashed via `git stash push -- <3 files>`, keeping the new test file
present against the *pre-fix* source:

```
Test Files  1 failed (1)
     Tests  12 failed | 11 passed (23)
```

All 12 failures accounted for: 8 from the two new exported helpers
(`isExplicitlyAllowed`, `isCapabilityRiskAccepted`) not existing yet, 4 from
the exact bug-reproduction assertions (`'unknown'` incorrectly passing under
`provider_terms_review`, and the missing-basis fallthrough).
`PROVIDER_UNKNOWN_FAIL_CLOSED_TDD_RED=YES`, `OPERATOR_RISK_ACCEPTANCE_TDD_RED=YES`
(the acceptance-mode tests themselves passed under old code -- for the wrong
reason, the very bug being fixed -- which is the expected/correct RED
signature for that half of the matrix).

**GREEN** after `git stash pop` (source + fixtures restored, `reviewBasis`
added to all 7 existing fixture construction sites across
`direct-public-http-terms-review.test.ts` and
`terms-rate-cache-circuit.test.ts`):

```
✓ src/tests/termsguard-tri-state.test.ts (23 tests)
✓ src/tests/direct-public-http-terms-review.test.ts (13 tests)
✓ src/tests/terms-rate-cache-circuit.test.ts (33 tests)
Test Files  3 passed (3)
     Tests  69 passed (69)
```

`TERMSGUARD_TRI_STATE_SEMANTICS=PASS`.

## `direct-public-http` review record (§13)

`DIRECT_PUBLIC_HTTP_TERMS_REVIEW` now explicitly declares
`reviewBasis: 'operator_risk_acceptance'`. Reviewer/notes/date/scope/
restrictions are unchanged from SUN-1221E2T (verbatim operator text).
`DIRECT_PUBLIC_HTTP_MANIFEST`'s three permission flags remain `'unknown'` --
never fabricated as `true` to make the fix "work"; confirmed directly against
source post-fix:

```
commercial_application_allowed: 'unknown',
automated_access_allowed: 'unknown',
transformed_output_allowed: 'unknown',
raw_access_resale_allowed: 'unknown',
```

`DIRECT_PUBLIC_HTTP_REVIEW_BASIS=operator_risk_acceptance`,
`DIRECT_PUBLIC_HTTP_PERMISSION_FLAGS=unknown`.

## Canonical worker-runtime proof (§15)

PHASE 10 (real `workerd`, real `cloudflare:sockets`, real production
composition, canonical `https://example.com/` target -- the same phase
SUN-1221E2D used to reproduce the original 502) rerun with the fix applied:

```
✓ PHASE 10 (1): unsigned request -> real 402, expected=9000 actual=9000
✓ PHASE 10 (2): real socket fetch to https://example.com/ passes the terms
  gate and succeeds -- status=200 result_class=success receipt_id_present=true
```

`WORKER_RUNTIME_CANONICAL_FETCH=SUCCESS`. Because the manifest flags are
confirmed still `'unknown'` (above), the only code path that can let this
request through post-fix is `isCapabilityRiskAccepted` returning `true` --
`WORKER_RUNTIME_RISK_ACCEPTANCE_PATH_USED=YES`, proven by construction, not
merely asserted.

## Security / economic / discovery non-regression (§16-§18)

`public-http-adapter.ts` (where SSRF/DNS-rebinding protection lives) was not
touched by this checkpoint (`git diff --stat` empty). Full
`packages/provider-adapters` suite: 255 passed, 6 skipped, 0 failed --
including `dns-rebinding.test.ts` and `http-ssrf.test.ts` in full.
`DNS_REBINDING_PROTECTION=PASS`.

Economics frozen and unchanged: PHASE 6 verify/CDP = 19000 atomic, PHASE 10
web-context/CDP = 9000 atomic, both reconfirmed in this run.
`WEB_CONTEXT_ECONOMICS_CHANGED=NO`, `VERIFY_ECONOMICS_CHANGED=NO`,
`PAYMENT_ORDER_CHANGED=NO`. PHASE 9 (MCP/REST cross-surface coherence)
unaffected -- this checkpoint touched no discovery code.
`MCP_CROSS_SURFACE_COHERENCE=PASS`.

## Mutation proof (§19)

`scripts/test-termsguard-tristate-mutation-caught.mts` (new): 10 deliberate
mutations against `terms-guard.ts`, each proven caught, file restored
byte-for-byte:

```
CAUGHT: 1. unknown accepted under provider_terms_review
CAUGHT: 2. false accepted
CAUGHT: 3. true rejected
CAUGHT: 4. operator acceptance removed
CAUGHT: 5. operator acceptance applied to wrong capability
CAUGHT: 6. wildcard risk acceptance
CAUGHT: 7. browser implicitly approved
CAUGHT: 8. review basis ignored
CAUGHT: 9. notes alone treated as approval
CAUGHT: 10. direct-public-http relies on unknown truthiness
10/10 caught, 0 skipped. File restored byte-for-byte.
```

Mutations 11 (SSRF weakened) and 12 (economics changed) are out of this
mutation script's scope by construction -- this checkpoint touched neither
SSRF code nor economics code -- and remain covered by the pre-existing,
untouched `dns-rebinding.test.ts`/`http-ssrf.test.ts` suites and PHASE 6/10's
own amount assertions, all reconfirmed PASS above.

`TERMSGUARD_SEMANTICS_MUTATION_PROOF=PASS`.

## Full regression (§20)

- `pnpm lint`: PASS (all 16 packages)
- `pnpm typecheck`: edge-api's **main** project (`tsconfig.json`) PASS with
  zero errors. Its separate `tsconfig.live-tests.json` project fails on two
  **pre-existing, unrelated** type errors in
  `apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts`
  (branded-type mismatches, `0x${string}` / `${string}:${string}`), a file
  from SUN-1221E2 not touched by this checkpoint (`git status` confirms
  clean). Flagged as a separate background task rather than fixed inline
  (out of TDD scope for a TermsGuard checkpoint).
- `pnpm test`: 2387 passed, 38 skipped, 0 failed
- `pnpm test:worker-runtime` (incl. `RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true`
  for PHASE 10): 92/92 scenarios passed
- `pnpm production:preflight`: PASS (both pre- and post-upload)
- `pnpm secrets:scan`: 2 findings, both pre-existing false positives (a
  public BaseScan contract address; a D1 `payment_attempts` row identifier
  for an already-retired, non-reusable authorization from SUN-1221E2R) --
  neither originates from this checkpoint's changes. `NEW_SECRET_FINDINGS=0`.

## Old E2T candidate retirement (§22)

`3742ef22-c6f6-4641-b569-2cb554ac9a22` (SUN-1221E2T's candidate) carries the
pre-fix source and must not be used for E3. `OLD_E2T_CANDIDATE_REUSE_ELIGIBLE=NO`.

## New candidate upload (§23-§25)

Exactly one non-deploying Worker version uploaded, with the same 13
qualification `--var` flags as every prior candidate in this release train
(recovered from the committed SUN-1221E1 upload report, not re-derived):

```
Worker Version ID: 54d87b77-e3fd-44da-a012-a817c23f1953
```

Authoritative read-back (`wrangler versions view`): all 13/13 vars exact
match (`AGENT_CARD_SIGNING_KEY_ID`, `ENVIRONMENT=production`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`, `LOG_LEVEL=info`,
`NVM_ENVIRONMENT=sandbox`, `PAID_ROUTES_ENABLED=true`,
`PAYMENT_ENVIRONMENT=production`, `PCC_VERSION=1.0.0`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED=true`, `PRODUCTION_ENABLED=true`,
`SELLER_WALLET_ADDRESS=0x7f44...E6E1`, `VERIFY_V2_CDP_ROUTE_ENABLED=true`,
`WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true`); 6/6 required secrets present
(`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
`PAID_RECEIPT_SIGNING_PRIVATE_KEY`); `CDP_WALLET_SECRET` absent.
`PREUPLOAD_QUALIFICATION_VAR_MANIFEST_COMPLETE=YES`, `WORKER_VERSION_UPLOADS=1`,
`E3_CANDIDATE_CONFIG_READBACK=PASS`, `E3_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`.

## Final production containment (§26-§27)

`wrangler deployments list` before and after every step in this checkpoint:
unchanged, single version `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`.
`pnpm production:preflight`: PASS before upload and after upload.

Zero economic actions throughout: `LIVE_CANDIDATE_REQUESTS=0`,
`LIVE_402_REQUESTS=0`, `BUYER_BALANCE_QUERIES=0`, `SIGN_TYPED_DATA_CALLS=0`,
`EIP3009_AUTHORIZATIONS_CREATED=0`, `PAYMENT_SIGNATURES_CREATED=0`,
`PAID_REQUESTS=0`, `SETTLEMENTS=0`, `TRANSACTIONS=0`,
`REAL_ECONOMIC_EFFECT_USDC=0`. (PHASE 10's "real socket fetch" and
"succeeds" language refers to the isolated, local `wrangler dev` test
harness using the existing synthetic-payment fixture mechanism already used
throughout `test-worker-runtime.mts` -- not the live Cloudflare production
candidate, and not a real x402/CDP/mainnet transaction.)
`CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE`.

## Final stop packet

```
SUN1221E2T1_TERMSGUARD_FIX=PASS
SUN1221E2T_IMPLEMENTATION_COMMIT_SHA=2343f2a7de8f8bc6b5b98aa44bb6071ab9a88290
SUN1221E2T_EVIDENCE_COMMIT_SHA=04156e179a6a4c1e64d7326c322058229748507e
SUN1221E2T1_IMPLEMENTATION_COMMIT_SHA=dd9943e (see git log for full SHA)
SUN1221E2T1_EVIDENCE_COMMIT_SHA=<set at commit time, below>

UNKNOWN_TRUTHINESS_BUG_REPRODUCED=YES
REVIEW_BASIS_SCHEMA_REQUIRED=YES
PROVIDER_UNKNOWN_FAIL_CLOSED_TDD_RED=YES
OPERATOR_RISK_ACCEPTANCE_TDD_RED=YES
TERMSGUARD_TRI_STATE_SEMANTICS=PASS
DIRECT_PUBLIC_HTTP_REVIEW_BASIS=operator_risk_acceptance
DIRECT_PUBLIC_HTTP_PERMISSION_FLAGS=unknown
RISK_ACCEPTANCE_SCOPE_ISOLATION=PASS
WORKER_RUNTIME_RISK_ACCEPTANCE_PATH_USED=YES
WORKER_RUNTIME_CANONICAL_FETCH=SUCCESS
DNS_REBINDING_PROTECTION=PASS
MCP_CROSS_SURFACE_COHERENCE=PASS
WEB_CONTEXT_ECONOMICS_CHANGED=NO
VERIFY_ECONOMICS_CHANGED=NO
TERMSGUARD_SEMANTICS_MUTATION_PROOF=PASS
TESTS=2387 passed, 38 skipped, 0 failed
WORKER_RUNTIME=92/92
OLD_E2T_CANDIDATE=3742ef22-c6f6-4641-b569-2cb554ac9a22
OLD_E2T_CANDIDATE_REUSE_ELIGIBLE=NO
PREUPLOAD_QUALIFICATION_VAR_MANIFEST_COMPLETE=YES
WORKER_VERSION_UPLOADS=1
E3_CANDIDATE_VERSION_ID=54d87b77-e3fd-44da-a012-a817c23f1953
E3_CANDIDATE_CONFIG_READBACK=PASS
E3_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_PRODUCTION_PREFLIGHT=PASS
LIVE_402_REQUESTS=0
BUYER_BALANCE_QUERIES=0
SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE
SUN1221E3_REAL_PAID_RETRY_ELIGIBLE=YES
```

Then STOP. No deployment of the E3 candidate. No live invocation. No 402. No
signing. No payment. No F. No promotion.
