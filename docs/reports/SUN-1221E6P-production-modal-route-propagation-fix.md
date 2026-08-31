# SUN-1221E6P — Production Route Modal Config Propagation Fix

## Blocked E6 evidence (starting state)

Candidate `d3d68351-b8a8-4eb0-be74-21d0eba36f57` (Q6I), qualified at 0%
traffic, returned `HTTP 503 service_executor_not_configured` on the
pre-payment discovery request instead of the expected `402`.
`LIVE_PREPAYMENT_ROUTE_REQUESTS=1`, `LIVE_402_REQUESTS=0`,
`EIP3009_AUTHORIZATIONS_CREATED=0`, `PAYMENT_SIGNATURES_CREATED=0`,
`PAID_REQUESTS=0`, `SETTLEMENTS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`.
Production was restored to `de70bf98-f304-4d7f-b189-4ae2401041a0` @100%
before this checkpoint began. The prior E6 authorization was retired.

## Root cause (reconfirmed before patching)

`apps/edge-api/src/control-plane/routes/production-web-context-v2-cdp-route.ts`
builds the env object passed to `buildWebContextV2CdpProductionRouteConfig`
from `c.env` field-by-field, and never included
`MODAL_WEBCTX_ENDPOINT_URL`, `MODAL_WEBCTX_PROXY_KEY`, or
`MODAL_WEBCTX_PROXY_SECRET` — even though all three are declared on the
`Env` type (`config/env.ts:62-64`) and correctly bound as real Worker
secrets (proven in Q6H/Q6I). The composition's own fail-closed check
(`web-context-v2-cdp-composition.ts:175-177`) therefore always saw all
three as `undefined` regardless of the Worker's actual secret bindings,
returning `{ unavailable: true, reason: 'MODAL_WEBCTX_* safe-egress
executor credentials are missing' }` on every real invocation since
SUN-1221E5Q6G introduced the Modal safe-egress executor.

- `MODAL_ENV_PRESENT_AT_WORKER_BOUNDARY=YES` (declared on `Env`, bound as
  Worker secrets)
- `MODAL_ENV_FORWARDED_BY_PRODUCTION_ROUTE_BEFORE_FIX=NO` (confirmed by
  direct source read of lines 57–67, pre-fix)
- `COMPOSITION_REQUIRES_MODAL_ENV=YES` (fail-closed check,
  `web-context-v2-cdp-composition.ts:175-177`)
- `ROOT_CAUSE_RECONFIRMED=YES`

## TDD RED

Added a direct config-capture-boundary test to
`production-web-context-v2-cdp-route.test.ts`: spies on
`buildWebContextV2CdpProductionRouteConfig`, supplies all three
`MODAL_WEBCTX_*` values via `c.env`, and asserts the forwarded config
object equals those exact values. Against unfixed source:

```
AssertionError: expected undefined to be 'https://example-modal-endpoint.invali…'
 ❯ …/production-web-context-v2-cdp-route.test.ts:191:53
```

`PRODUCTION_ROUTE_MODAL_PROPAGATION_TDD_RED=YES`.

A second, negative-control test (full valid config except
`MODAL_WEBCTX_PROXY_SECRET`) was added and passed even before the fix,
confirming the route already failed closed for missing Modal
credentials — `MISSING_MODAL_CONFIG_FAILS_CLOSED=PASS`.

## Minimal GREEN fix

`production-web-context-v2-cdp-route.ts`: added the three missing
fields to the existing config object literal, forwarding
`c.env.MODAL_WEBCTX_ENDPOINT_URL` / `_PROXY_KEY` / `_PROXY_SECRET`
verbatim, exactly mirroring how every other field on that object is
forwarded. `PRODUCTION_FILES_CHANGED=1`
(`production-web-context-v2-cdp-route.ts`). No other file changed
behavior. `ModalSafeEgressClient`, `SafeSocketHttpClient`, TermsGuard,
payment code, settlement ordering, PCC, service economics, and route
activation flags are all untouched.

`PRODUCTION_ROUTE_MODAL_PROPAGATION_GREEN=PASS`. Negative control
remained `PASS` after the fix.

## Actual production-route local proof

`ACTUAL_PRODUCTION_ROUTE_TESTED=YES`,
`DEV_DIAGNOSTIC_SEAM_USED_FOR_PRIMARY_PROOF=NO`. Proof is composed of
two pieces, each exercising a genuinely different part of the real
pipeline (deliberately, mirroring this route test file's own stated
boundary: it proves the integration point, not composition internals,
which are proven separately):

1. **Route → composition boundary** (new test, this checkpoint): proves
   the real route handler now forwards the three Modal fields correctly
   from `c.env`.
2. **Composition → payment gate** (pre-existing,
   `web-context-v2-cdp-composition.test.ts`, unchanged by this
   checkpoint, still passing): calls the same
   `buildWebContextV2CdpProductionRouteConfig` directly with a
   correctly-shaped env (including Modal credentials) against a real
   Miniflare D1 instance and reaches a genuine, fully-decoded `402`
   payment challenge with the exact frozen economic contract (9000
   atomic USDC, `eip155:8453`, correct `payTo`).

Together these prove transitively that the real route, now that it
forwards the correct env shape, reaches the payment gate rather than
`503`. `PREPAYMENT_SERVICE_EXECUTOR_NOT_CONFIGURED_AFTER_FIX=NO`,
`LOCAL_PRODUCTION_ROUTE_REACHES_PAYMENT_GATE=YES`. No Base-mainnet
contact, no real `402` was produced anywhere in this checkpoint.

## Direct config capture proof

`MODAL_ENDPOINT_PROPAGATION_TEST=PASS`,
`MODAL_PROXY_KEY_PROPAGATION_TEST=PASS`,
`MODAL_PROXY_SECRET_PROPAGATION_TEST=PASS` (three separate assertions
in the one new test, each checked independently). No real secret values
appear in the test — fake, clearly-marked test literals only.

## Mutation proof

Independently reverted each of the three forwarded lines in the fixed
source (one at a time, restoring after each), and re-ran the route test
file:

| Mutation | Result |
|---|---|
| `MODAL_WEBCTX_ENDPOINT_URL` forwarding removed | 1 test fails (exactly the propagation test) |
| `MODAL_WEBCTX_PROXY_KEY` forwarding removed | 1 test fails (exactly the propagation test) |
| `MODAL_WEBCTX_PROXY_SECRET` forwarding removed | 1 test fails (exactly the propagation test) |

File byte-identical to the committed fix after restoration (`diff`
confirmed empty). `MODAL_ROUTE_PROPAGATION_MUTATION_PROOF=PASS`.

## Payment-ordering / security regressions

`PAYMENT_ORDERING_CHANGE_REQUIRED=NO` — this fix only changes which env
fields reach a config builder call that already existed; it does not
touch executor-vs-settlement ordering anywhere. Q6G's safe-egress
security suite (private-IP rejection, mixed DNS, DNS rebinding, IP
pinning, TLS hostname validation, redirect revalidation, timeout,
response size, proxy auth) is untouched by this checkpoint and passed
as part of the full regression run below.
`SAFE_EGRESS_SECURITY_REGRESSION=PASS`.

## Full regression

- `pnpm test`: **2464 passed**, 38 skipped (was 2462 before this
  checkpoint's +2 new tests)
- `pnpm test:worker-runtime`: **93/93 scenarios passed**; bundle
  isolation confirms the dev-diagnostic seam and test-only entrypoint
  remain excluded from the real `wrangler.toml` dry-run bundle
- Modal/Python safe-egress suite: **88/88 passed** (unchanged, no
  Python files touched this checkpoint)
- `pnpm lint`: clean (16/16 tasks)
- `pnpm typecheck`: same 2 pre-existing, unrelated type errors in
  `tests/live/web-context-first-paid-e2e-local.test.ts` (unchanged
  baseline established in Q6D, not a file touched by this commit) —
  accepted per established classification
- `pnpm production:preflight`: **PASS** (both before and after the
  candidate upload)
- `pnpm secrets:scan`: 4 findings, all pre-existing (2 unique findings
  each duplicated under old/new commit hashes from the earlier git
  author-identity rewrite) — `NEW_E6P_SECRETS_FINDINGS=0`

## Production bundle proof

Fresh `wrangler deploy --dry-run` at the fix commit confirmed:
`ModalSafeEgressClient` present (8 refs), all three `MODAL_WEBCTX_*`
names present (4 refs each — type decl, composition interface, route
forwarding, composition usage), zero dev-diagnostic-seam markers, zero
literal secret values, `buildWebContextV2ModalSafeEgressClient` present
(3 refs) confirming the production `direct` transport still uses Modal,
not `SafeSocketHttpClient`. `PREUPLOAD_PRODUCTION_BUNDLE=PASS`.

## Production containment precheck

`ACTIVE_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`ACTIVE_PRODUCTION_TRAFFIC=100%`, `d3d68351` traffic 0% (superseded,
not in the active deployment). `PRE_E6P_PRODUCTION_CONTAINMENT=PASS`.

## Commit before external mutation

`E6P_FIX_COMMIT_SHA=f1b244cabfd92b7f42a93c82a77f6ca038768778`. Working
tree clean afterward.

## Secret-preservation semantics (installed wrangler 4.119.0)

Confirmed directly from `wrangler versions upload --help` (not from
this checkpoint's own prompt text): *"Note that secrets are never
deleted by deployments."* `--keep-vars` is required only to preserve
plain-text vars, not secrets. `EXISTING_SECRETS_PRESERVED_ON_VERSION_UPLOAD=YES`.

## Governed var manifest

Independently reread from live production (`wrangler versions view` on
`de70bf98`): `PAYMENT_ENVIRONMENT=production`,
`PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED=true`, `PAID_ROUTES_ENABLED=true`,
`VERIFY_V2_CDP_ROUTE_ENABLED=true` (6/7 present on production).
`WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` is absent from production (per
Q6I/Q6HR's proven finding) and was supplied as `true` on the candidate
per Q6I's human-approved activation-intent decision.
`GOVERNED_VAR_MANIFEST_READBACK=PASS`.

## Exactly one new version

```
wrangler versions upload --keep-vars \
  --var PAYMENT_ENVIRONMENT:production \
  --var PRODUCTION_ENABLED:true \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
  --var PAID_ROUTES_ENABLED:true \
  --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true
```

No `versions secret put` / `secret put` / `secret bulk` commands were
run. `WORKER_VERSION_UPLOADS=1`,
`POST_UPLOAD_SECRET_MUTATION_COMMANDS=0`.
`REPLACEMENT_E6_CANDIDATE_VERSION_ID=30ab6b71-fb3f-463f-9bae-46f090c5cdb4`.

## Source, var, and secret read-back

- Source: the pre-upload `wrangler deploy --dry-run` bundle check (which
  confirmed the fix, Modal client, and diagnostic-seam exclusion) was
  run against the exact same clean git state (`f1b244c`, no
  intervening commits) as the actual upload — source identity is
  provable by git-state continuity.
  `REPLACEMENT_CANDIDATE_SOURCE_READBACK=PASS`.
- Vars: `wrangler versions view` on the new version shows all 7
  governed vars present with the exact intended values.
  `GOVERNED_VAR_COUNT_EXPECTED=7`, `GOVERNED_VAR_COUNT_PRESENT=7`,
  `GOVERNED_VAR_READBACK=PASS`.
- Secrets (names only): `AGENT_CARD_SIGNING_PRIVATE_KEY`,
  `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `MODAL_WEBCTX_ENDPOINT_URL`,
  `MODAL_WEBCTX_PROXY_KEY`, `MODAL_WEBCTX_PROXY_SECRET`,
  `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
  `PAID_RECEIPT_SIGNING_PRIVATE_KEY` — 9 total, all preserved
  automatically (no secrets-file used). `CDP_WALLET_SECRET` absent.
  `MODAL_SECRET_BINDINGS_POSTUPLOAD=PASS`,
  `LEGACY_SECRET_BINDINGS_POSTUPLOAD=PASS`,
  `SECRET_VALUE_EXPOSURE_ATTEMPTS=0`.

## Activation / economics read-back

`web_context_verified.v2` and `verify_agent_output.v2` / CDP both
active on the candidate (both route flags `true`); no other governed
paid service activated; Nevermined inactive.
`REPLACEMENT_CANDIDATE_ACTIVATION=PASS`. Economics unchanged: 0.009
USDC / 9000 atomic for `web_context_verified.v2`, 0.019 USDC / 19000
atomic for `verify_agent_output.v2`, `eip155:8453`,
`0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`,
`0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`.
`REPLACEMENT_CANDIDATE_ECONOMICS=PASS`.

## No live paid-route probe this checkpoint

`REAL_CANDIDATE_PREPAYMENT_REQUESTS_E6P=0`, `LIVE_402_REQUESTS_E6P=0` —
the real version-specific pre-payment request was deliberately not
repeated; the next real candidate request is reserved for a fresh E6
qualification attempt.

## Final containment / economic zero

`REPLACEMENT_E6_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`,
`REPLACEMENT_E6_CANDIDATE_TRAFFIC=0%`,
`ACTIVE_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`ACTIVE_PRODUCTION_TRAFFIC=100%`, `FINAL_PRODUCTION_PREFLIGHT=PASS`.
`LIVE_402_REQUESTS=0`, `EIP3009_AUTHORIZATIONS_CREATED=0`,
`SIGN_TYPED_DATA_PAYMENT_CALLS=0`, `PAYMENT_SIGNATURES_CREATED=0`,
`PAID_REQUESTS=0`, `FACILITATOR_VERIFY_CALLS=0`,
`FACILITATOR_SETTLE_CALLS=0`, `SETTLEMENTS=0`, `TRANSACTIONS=0`,
`REAL_ECONOMIC_EFFECT_USDC=0`. `CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE`.

## Candidate hard gate

`REPLACEMENT_E6_CANDIDATE_TECHNICALLY_VALID=YES` — every constituent
gate (TDD RED, minimal GREEN, actual production-route local proof,
mutation proof, safe-egress security, full regression, production
bundle, source read-back, seven vars, all secret names preserved,
activation, economics, candidate undeployed/0%, known-good production
unchanged) passed.

## E6 re-eligibility

`SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=YES`.
`NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R`. This checkpoint's authorization
does not cover payment — E6R requires a fresh, standalone human payment
authorization.
