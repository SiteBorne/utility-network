# SUN-1219C — Mainnet Candidate Freeze, Candidate-Only ADR-0055 Activation & Upload

**Date:** 2026-08-24 **Status:** Upload phase complete. Hard-stopped before live
100/0 qualification per directive §18.

## 1. Authoritative human authorization

The operator, in this conversation, explicitly stated (superseding the prior
authorization record):

> This supersedes the current authorization record. I explicitly approve the
> existing CDP credential: `siteborne-x402-facilitator` for SITEBORNE production
> / Base-mainnet qualification. I explicitly authorize one new immutable Worker
> candidate with 0% normal traffic containing exactly these six candidate-only
> activation/authorization vars: `PAID_ROUTES_ENABLED=true`,
> `VERIFY_V2_CDP_ROUTE_ENABLED=true`, `PAYMENT_ENVIRONMENT=production`,
> `PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
> `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`.

This authorization permitted: one candidate dry-run, one candidate freeze, one
non-deploying Worker version upload, post-upload candidate identity/config
reconciliation. It did **not** authorize: 100/0 deployment, version-override
execution, live seller-account lookup, live CDP mainnet request, valid payment
material, payment verification, settlement, transaction, paid service execution,
bound paid signer execution, normal candidate traffic, public activation,
canary, promotion, or Nevermined activation.

## 2. Clean-source lineage

```
START_HEAD=ea4c917a286322a07d12bc2c10402db867e4f90d
WORKING_TREE=clean (before and after this checkpoint)
RUNTIME_SOURCE_DRIFT=NO
CONFIG_SOURCE_DRIFT=NO

TEMPORARY_DIAGNOSTIC_RUNTIME_REACHABILITY=0
DIAGNOSTIC_ROUTE_PRESENT_IN_RUNTIME_SOURCE=NO
DIAGNOSTIC_GATE_PRESENT_IN_RUNTIME_SOURCE=NO
```

Confirmed via `grep -rl` across `apps/` and `packages/` for the diagnostic
route/gate identifiers: zero matches outside historical report files.

## 3. Starting production state

```
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
GET /health = 200
GET /ready  = 200
12/12 paid REST routes = 404
SUN1219C_START_PREFLIGHT=PASS
```

No production mutation occurred in this section.

## 4. Exact candidate-only vars

```
PAID_ROUTES_ENABLED=true
VERIFY_V2_CDP_ROUTE_ENABLED=true
PAYMENT_ENVIRONMENT=production
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true

CANDIDATE_ONLY_AUTHORIZATION_VARS_COUNT=6
```

`NEVERMINED_ROUTES_ENABLED` was not set. No seventh var was added.

## 5. Base configuration preservation

Authoritative read-back (post-upload, `wrangler versions view`) confirms:

```
ENVIRONMENT=production
NVM_ENVIRONMENT=sandbox   (preserved as-is; not reinterpreted as CDP network state)
PCC_VERSION=1.0.0
LOG_LEVEL=info
SELLER_WALLET_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c69029...
AGENT_CARD_SIGNING_KEY_ID=siteborne-agent-card-2026-08

BASE_CONFIGURATION_PRESERVED=YES
```

Bindings preserved: `CATALOG` (KV), `EVENTS`/`JOBS` (Queues), `DB` (D1,
`efe23c42-cbcc-47c2-9b28-922a541bdcdd`, matches production), `BROWSER`, `AI`.

## 6. Secret preservation

```
Secret Name: AGENT_CARD_SIGNING_PRIVATE_KEY
Secret Name: CDP_API_KEY_ID
Secret Name: CDP_API_KEY_SECRET
Secret Name: NVM_API_KEY
Secret Name: PAID_RECEIPT_SIGNING_KEY_ID
Secret Name: PAID_RECEIPT_SIGNING_PRIVATE_KEY

SECRET_ROTATIONS=0
NEW_SECRET_VALUES=0
CDP_SECRET_VALUES_EXPOSED=NO
```

Names only — no value was ever read, printed, or logged. This is the same
`siteborne-x402-facilitator`-backed `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` pair
validated live in SUN-1219B (authentication proven, Base mainnet support
proven).

## 7. Mainnet authorization semantics (literal source proof, re-read fresh)

`packages/protocol-x402/src/network/preproduction.ts`:

```ts
export function isProductionPaymentAuthorized(input: ProductionAuthorizationInput): boolean {
  return (
    input.environment === 'production' &&
    input.productionEnabled === true &&
    input.humanBootstrapAuthorized === true &&
    input.productionCredentialsApproved === true
  );
}

export function resolvePaymentNetwork(input: ProductionAuthorizationInput): Network {
  if (isProductionPaymentAuthorized(input)) {
    return PRODUCTION_NETWORK; // eip155:8453
  }
  ...
}
```

`apps/edge-api/src/control-plane/config/production-payment.ts` maps the four
candidate vars 1:1 onto this input via exact literal string comparisons
(`raw === 'production'`, `raw === 'true'`). With all four candidate vars set as
authorized:

```
isProductionPaymentAuthorized(...) = true
resolvePaymentNetwork(...) → eip155:8453
CANDIDATE_NETWORK=eip155:8453
```

`verify-agent-output-v2-cdp-composition.ts` still enforces, structurally
(re-read fresh this checkpoint):
`PRODUCTION_EVIDENCE_SELECTION = real provider OR unavailable`, never
`synthetic_fixture` — the only fixture path is `explicitTestEvidenceOverride`,
which the production route module never supplies.

```
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY=0
```

## 8. Seller-address lookup lifecycle

Tracing the clean composition: with all four gates authorized,
`resolveProductionCdpEvidenceProvider` passes gate #1 (human authorization) and
gate #2 (binding presence), then invokes `deps.getAuthenticatedSellerAddress()`
— wired since SUN-1218 to
`buildCdpSellerAddressLookup(buildProductionCdpAccountLookupClientFactory(...), SELLER_WALLET_ADDRESS)`,
which calls `CdpClient.evm.getAccount({ address })` — read-only, no signing, no
transaction.

```
SELLER_LOOKUP_REQUIRED_TO_REACH_402=YES
Operation: CdpClient.evm.getAccount(...)
```

This call only fires when the route handler actually processes an HTTP request —
not merely by the candidate existing as an uploaded, undeployed version.
Throughout §§1–17:

```
LIVE_CDP_CALLS=0
LIVE_BASE_MAINNET_CALLS=0
```

## 9. Full local qualification (fresh, sequential)

```
pnpm lint                         → PASS (16/16 cached-clean)
pnpm typecheck                    → PASS (23/23 cached-clean)
pnpm test                         → 2171 passed | 35 skipped (2206), 0 failed
pnpm test:worker-runtime          → 88/88 scenarios passed
pnpm production:preflight         → PASS
pnpm secrets:scan                 → PASS, no leaks
pnpm pricing:check                → PASS
pnpm x402:check                   → PASS
pnpm verification:check           → PASS
pnpm contracts:baseline:verify    → PASS
pnpm contracts:compat:check       → PASS
pnpm contracts:release:verify     → PASS
pnpm migrations:verify            → PASS
```

Note: an earlier same-turn attempt to run `pnpm test` concurrently with other
heavy local processes produced spurious timeout failures (unrelated
property-based/subprocess tests competing for CPU). Per directive §9, that run
was **not** accepted as authoritative; `pnpm test` was re-run in isolation and
returned the clean count above.

## 10. Candidate route truth table

`verify_agent_output.v2 / CDP → governed production composition`: proven via the
existing, already-passing, freshly-re-verified mock-based end-to-end unit test
(`production-payment-gate.test.ts`, "end-to-end (mocks only):
resolveProductionCdpEvidenceProvider constructs a real production evidence
provider only when every gate holds AND the mock CDP account lookup resolves the
exact configured seller address") — this is the exact code path our real
candidate's four authorized gates now take. A new real-workerd run using real
production CDP secrets was deliberately not attempted locally
(unsafe/inappropriate outside the Cloudflare runtime boundary).

`other 11 paid REST routes → 404`: this behavior is structurally independent of
the four ADR-0055 gates (they only affect `verify_agent_output.v2/CDP`'s
internal composition result, never route dispatch for the other 11, which are
unconditional-wildcard 404s) — proven this checkpoint via the fresh Phase 8
(States A–D) `test:worker-runtime` run and via the live production 12-route
check in §3/§17.

```
TWELVE_ROUTE_TRUTH_TABLE=PASS
MAINNET_CANDIDATE_OTHER_11_ROUTES_404=YES
```

Nevermined unchanged (`NEVERMINED_ROUTES_ENABLED` not set).

## 11. Pinned Wrangler semantics (re-proven fresh)

```
$ pnpm exec wrangler --version
4.119.0

$ pnpm exec wrangler versions upload --help
... --var  A key-value pair to be injected into the script as a variable [array] ...
```

Only the non-deploying `wrangler versions upload` path was used.
`wrangler deploy` and `wrangler secret put` were not invoked.

## 12. Candidate dry run

```
$ wrangler versions upload --dry-run --var PAID_ROUTES_ENABLED:true \
    --var VERIFY_V2_CDP_ROUTE_ENABLED:true --var PAYMENT_ENVIRONMENT:production \
    --var PRODUCTION_ENABLED:true --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
    --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true --message "..."

Total Upload: 6251.74 KiB / gzip: 1018.42 KiB
env.PAID_ROUTES_ENABLED ("hidden")                  Environment Variable
env.VERIFY_V2_CDP_ROUTE_ENABLED ("hidden")           Environment Variable
env.PAYMENT_ENVIRONMENT ("hidden")                   Environment Variable
env.PRODUCTION_ENABLED ("hidden")                    Environment Variable
env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP ("hidden") Environment Variable
env.PRODUCTION_CDP_CREDENTIALS_APPROVED ("hidden")   Environment Variable
--dry-run: exiting now.
```

`NEVERMINED_ROUTES_ENABLED` absent; base vars, DB binding, and all other
bindings present as listed in §5. `compatibility_date = "2026-08-05"`,
`compatibility_flags = ["nodejs_compat"]`, `preview_urls = false` confirmed
directly from the unmodified `wrangler.toml`.

```
MAINNET_CANDIDATE_DRY_RUN=PASS
```

## 13. Preview containment

```
preview_urls=false            (wrangler.toml, unmodified this checkpoint)
```

Confirmed again via `production:preflight`'s independent check ("PASS: versioned
and aliased Worker preview URLs are explicitly disabled") both before and after
upload.

```
MAINNET_CANDIDATE_PREVIEW_CONTAINMENT=PASS
```

## 14. Freeze candidate identity

Computed immediately before upload, with zero edits before or after:

```
RUNTIME_CANDIDATE_SHA=ea4c917a286322a07d12bc2c10402db867e4f90d
GIT_TREE_SHA=d629cc357a9b6cd44f253a6558e958246a83505f
BUNDLE_SHA256=0c29f76e4f0e1d4d64c0513378a2653743471115182a31eb183f810ffe7d0e89
WRANGLER_CONFIG_SHA256=10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387
LOCKFILE_SHA256=b95d04c58768f6e047edc5717cc03ccd82865240083767984683eda7eb1d923d
```

`BUNDLE_SHA256` is identical to the original SUN-1219 candidate's bundle hash
(frozen at `2ccb7610`) — expected and consistent, since `--var` values are
runtime bindings, not compile-time substitutions, and the application source is
textually identical to that earlier state (the temporary diagnostic detour was
fully added and then fully reverted). `git status --short` was empty and
`git rev-parse HEAD` was re-checked immediately before the real upload;
`CANDIDATE_FREEZE_INVALIDATED=NO`.

## 15. Exactly one authorized upload

```
$ wrangler versions upload --var PAID_ROUTES_ENABLED:true ... --message \
    "SUN-1219C mainnet unpaid-402 qualification candidate"

Uploaded siteborne-utility-edge (3.91 sec)
Worker Version ID: 9a18898a-f08b-4543-8e00-8bccf2dfc52a
```

No deploy command was run.

```
WORKER_VERSIONS_CREATED=1
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
```

## 16. Candidate identity reconciliation (authoritative read-back)

```
MAINNET_CANDIDATE_VERSION_ID=9a18898a-f08b-4543-8e00-8bccf2dfc52a
MAINNET_CANDIDATE_CREATED_AT=2026-08-24T18:50:07.297Z

$ wrangler deployments status
Version(s): (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

The candidate does not appear in the active deployment.

```
MAINNET_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
MAINNET_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
```

`wrangler versions view 9a18898a-...` confirms, exactly:

```
Compatibility Date:  2026-08-05
Compatibility Flags: nodejs_compat
Secrets: AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET, NVM_API_KEY,
         PAID_RECEIPT_SIGNING_KEY_ID, PAID_RECEIPT_SIGNING_PRIVATE_KEY  (names only)
env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP ("true")
env.PAID_ROUTES_ENABLED ("true")
env.PAYMENT_ENVIRONMENT ("production")
env.PRODUCTION_CDP_CREDENTIALS_APPROVED ("true")
env.PRODUCTION_ENABLED ("true")
env.VERIFY_V2_CDP_ROUTE_ENABLED ("true")
```

`NEVERMINED_ROUTES_ENABLED` absent. All base vars/bindings intact (§5).

```
CANDIDATE_SOURCE_IDENTITY=PASS   (compatibility date/flags match; bundle identity rests on the
                                   unbroken freeze chain in §14 — no independent live-bundle
                                   digest is exposed by the platform for an already-uploaded
                                   version, so none is claimed)
CANDIDATE_CONFIG_IDENTITY=PASS   (exact values confirmed by authoritative read-back above)
CANDIDATE_SECRET_BINDING_IDENTITY=PASS
```

## 17. Post-upload production containment

```
GET /health = 200
12/12 paid REST routes = 404 (live)
POSTUPLOAD_PRODUCTION_PREFLIGHT=PASS
LIVE_CDP_CALLS=0
LIVE_BASE_MAINNET_CALLS=0
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
```

## 18. Hard stop

This checkpoint stops here, as directed. No 100/0 deployment, no
version-override request, no invocation of `/v2/verify/agent-output`, no
seller-account lookup, no live CDP call, no payment material was sent or
attempted.

```
SUN1219C_MAINNET_CANDIDATE_UPLOAD=PASS

MAINNET_CANDIDATE_VERSION_ID=9a18898a-f08b-4543-8e00-8bccf2dfc52a
MAINNET_CANDIDATE_CREATED_AT=2026-08-24T18:50:07.297Z
AUTHORIZED_SOURCE_HEAD=ea4c917a286322a07d12bc2c10402db867e4f90d

CANDIDATE_SOURCE_IDENTITY=PASS
CANDIDATE_CONFIG_IDENTITY=PASS
CANDIDATE_SECRET_BINDING_IDENTITY=PASS

CANDIDATE_NETWORK=eip155:8453
SELECTED_PRODUCTION_CDP_KEY=siteborne-x402-facilitator
CANDIDATE_ONLY_AUTHORIZATION_VARS_COUNT=6

MAINNET_CANDIDATE_OTHER_11_ROUTES_404=YES
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY=0

SELLER_LOOKUP_REQUIRED_TO_REACH_402=YES
PROPOSED_LIVE_CDP_SELLER_LOOKUPS=1

CDP_SECRET_VALUES_EXPOSED=NO

WORKER_VERSIONS_CREATED=1
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0

LIVE_CDP_CALLS=0
LIVE_BASE_MAINNET_CALLS=0

REAL_PAYMENT_MATERIAL_SENT=NO
PAYMENT_SIGNATURES=0
SERVICE_EXECUTIONS=0
BOUND_SIGNER_EXECUTIONS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0

CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%

LIVE_100_0_QUALIFICATION_AUTHORIZED=NO
```

**Next question for the operator:** Authorize one temporary 100% known-good / 0%
mainnet-candidate deployment, authoritative version-override qualification, at
most one read-only `CdpClient.evm.getAccount(...)` seller lookup if required,
exactly one unpaid verify-v2/CDP request with no valid payment material,
11-route isolation verification, and mandatory restoration? This authorization
is not inferred from the candidate-upload authorization above and must be given
separately.

---

## 19. Live bounded qualification — explicit authorization received

The operator, in this conversation, explicitly authorized exactly the bounded
action set the previous section asked about, naming both version IDs
(`9a18898a-f08b-4543-8e00-8bccf2dfc52a` candidate, `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
known-good), the exact step sequence, explicit non-authorizations (no payment
material, no settlement, no transaction signing, no service execution, no
candidate normal traffic, no public activation, no promotion), numeric limits
(`MAX_LIVE_CDP_SELLER_LOOKUPS=1`, all payment/settlement/transaction/execution
counters fixed at `0`), and mandatory restoration regardless of outcome. This
section records that live execution, real command output only, per the
Permanent evidence rule (COMMAND → ACTUAL OUTPUT → AUTHORITATIVE READ-BACK →
narration).

## 20. Pre-mutation state (re-verified live, this checkpoint)

```
git status --short  = ?? docs/reports/SUN-1219C-...md   (only the in-progress report)
git rev-parse HEAD   = ea4c917a286322a07d12bc2c10402db867e4f90d
wrangler deployments status -> (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
wrangler versions view 9a18898a-... -> confirmed present, exactly the 6
  candidate-only vars from §4/§16, all base vars/bindings/secret names intact
```

## 21. Baseline ordinary routing (before any mutation)

```
GET /health, no override -> 200, ray a304e5a01e21bd19
GET /ready,  no override -> 200, ray a304e5a5e980d1b6
  body: production_services_enabled=false,
  blocked_external includes seller_wallet, cdp_credentials (expected on
  known-good -- ADR-0055 vars are candidate-only)
```

`wrangler tail siteborne-utility-edge --format json` started and confirmed
live (existing OAuth session, no new credential) before any further action.

## 22. Temporary 100/0 deployment (real)

```bash
wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100% \
  9a18898a-f08b-4543-8e00-8bccf2dfc52a@0% \
  --name siteborne-utility-edge \
  --message "SUN-1219C zero-traffic mainnet candidate qualification (ADR-0055 gates set, expected unpaid 402)" \
  -y
```

```
SUCCESS  Deployed siteborne-utility-edge version f4f20676-... at 100% and
         version 9a18898a-... at 0% (1.02 sec)
```

Authoritative read-back (`wrangler deployments status`):

```
(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
(0%)   9a18898a-f08b-4543-8e00-8bccf2dfc52a

ZERO_TRAFFIC_MAINNET_DEPLOYMENT_VERIFIED=YES
```

## 23. Ordinary routing after the split, before any override

```
GET /health, no override -> 200, ray a304e82fafbd20b3 -> scriptVersion.id f4f20676-...
GET /ready,  no override -> 200, ray a304e8345969675f -> scriptVersion.id f4f20676-...

ORDINARY_ROUTING_DURING_ZERO_PERCENT=KNOWN_GOOD
```

Both confirmed via `wrangler tail` JSON attribution, not merely response body.

## 24. Candidate attribution (one request)

```
GET /health, header
  Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="9a18898a-f08b-4543-8e00-8bccf2dfc52a"
-> 200, ray a304e8fe38053ce4 -> scriptVersion.id 9a18898a-... -> outcome ok -> exceptions []

CANDIDATE_OVERRIDE_ATTRIBUTION=PASS
```

## 25. The governed unpaid verify call (exactly one, real)

Request body used the frozen `agent-verification-input.schema.json`'s own
published example verbatim (structurally valid, `required_schema` built only
from Profile-1-supported keywords: `type`/`properties`/`required`) — no
`PAYMENT-SIGNATURE` header, no payment material of any kind:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="9a18898a-f08b-4543-8e00-8bccf2dfc52a"' \
  --data @verify_body.json \
  https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output
```

Result:

```
HTTP 402, ray a304eb852a0a6c95
body: {"error":"payment_required","x402_version":2,
       "quote_id":"qte_4464e5401ddc2cbd7573067b",
       "requirement_id":"req_750b02554fa8eb69e54d17c3"}
```

`wrangler tail` attribution for this exact ray: `scriptVersion.id
9a18898a-f08b-4543-8e00-8bccf2dfc52a`, `outcome: "ok"`, `exceptions: []`,
`wallTime: 724ms`, `cpuTime: 110ms`. The ~614ms gap between wall and CPU time
is consistent with one external network round trip (the read-only
`CdpClient.evm.getAccount(...)` seller-address lookup that
`buildVerifyAgentOutputV2CdpProductionRouteConfig` invokes, on this isolate's
first request to the route, before evidence-mode resolution) — structurally,
this HTTP 402 (the quote/challenge path, reached only after
`resolveProductionCdpEvidenceProvider` resolves `evidenceMode: 'production'`,
never `'unavailable'`) could not have been produced unless that lookup
succeeded; the code path fails closed to a 503 (`service_executor_not_configured`,
observed and documented in SUN-1219 Checkpoint Y §12) on any lookup
failure/misconfiguration. No log line in the tail capture names the CDP call
directly — this module does not log it — so this call is inferred from the
structural code path plus the timing signature, not asserted as directly
observed network I/O.

```
CANDIDATE_UNPAID_X402_BOUNDARY=PASS
SELLER_LOOKUP_REQUIRED_BY_CODE_PATH=YES
LIVE_CDP_SELLER_LOOKUPS=INFERRED_1
LIVE_CDP_SELLER_LOOKUPS_DIRECTLY_OBSERVED=NO
DIRECT_PROVIDER_HTTP_REQUEST_COUNT_OBSERVED=NO
REAL_PAYMENT_MATERIAL_SENT=NO
PAYMENT_SIGNATURES=0
SETTLEMENTS=0
TRANSACTIONS=0
SERVICE_EXECUTIONS=0
BOUND_SIGNER_EXECUTIONS=0
REAL_ECONOMIC_EFFECTS=0
```

## 26. Other 11 paid routes, candidate-attributed (real, live)

All 11 issued as `POST .../<path>` with body `{}` and the same candidate
override header:

```
/v1/company/evidence-graph              -> 404
/v1/web/context                         -> 404
/v1/document/evidence-json              -> 404
/v1/verify/agent-output                 -> 404
/v2/company/evidence-graph              -> 404
/v2/web/context                         -> 404
/v2/document/evidence-json              -> 404
/v2/nevermined/company/evidence-graph   -> 404
/v2/nevermined/web/context              -> 404
/v2/nevermined/document/evidence-json   -> 404
/v2/nevermined/verify/agent-output      -> 404

MAINNET_CANDIDATE_OTHER_11_ROUTES_404=YES
```

## 27. Bounded candidate telemetry (real, parsed from `wrangler tail` capture)

```
candidate-attributed events captured = 13
status distribution: 200x1, 402x1, 404x11
outcome distribution: ok x13
exceptions total = 0
wallTime: min 1ms, max 724ms (max = the single verify call, §25)
cpuTime:  min 0ms, max 110ms
```

```
CANDIDATE_UNHANDLED_EXCEPTIONS=0
CANDIDATE_TELEMETRY_ERRORS=0
```

Well under any reasonable request-volume bound; every candidate-attributed
request accounted for above (1 health-attribution + 1 verify + 11 route
checks = 13).

## 28. Mandatory restoration (real, executed once)

```bash
wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100% \
  --name siteborne-utility-edge \
  --message "SUN-1219C restore known-good after zero-traffic mainnet candidate qualification (governed 402 boundary proven)" \
  -y
```

```
SUCCESS  Deployed siteborne-utility-edge version f4f20676-... at 100% (0.89 sec)
```

Authoritative read-back:

```
(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce   -- candidate absent

SUN1219C_RESTORATION=PASS
```

## 29. Post-restoration containment proof

```
GET /health, no override            -> 200, ray a304ee323ea51365 -> scriptVersion.id f4f20676-...
GET /health, STALE candidate override (header still sent)
                                     -> 200, ray a304ee32d99d674c -> scriptVersion.id f4f20676-...
                                        (override no longer executes the candidate once it
                                         leaves the active deployment)

CANDIDATE_OVERRIDE_REACHABLE_AFTER_RESTORE=NO
POST_MAINNET_QUALIFICATION_ATTRIBUTION=PASS
```

All 12 paid routes, no override, live production:

```
/v1/company/evidence-graph, /v1/web/context, /v1/document/evidence-json,
/v1/verify/agent-output, /v2/company/evidence-graph, /v2/web/context,
/v2/document/evidence-json, /v2/verify/agent-output,
/v2/nevermined/company/evidence-graph, /v2/nevermined/web/context,
/v2/nevermined/document/evidence-json, /v2/nevermined/verify/agent-output
  -> all 404
```

`pnpm production:preflight` re-run fresh, post-restoration:

```
PASS: required binding(s) present -- DB.
PASS: required [vars] present -- SELLER_WALLET_ADDRESS, AGENT_CARD_SIGNING_KEY_ID, NVM_ENVIRONMENT.
PASS: economic/cutover vars are absent or fail-closed in the pre-upload candidate.
PASS: versioned and aliased Worker preview URLs are explicitly disabled.
PRODUCTION_CONFIG_DRIFT_CHECK: PASS
PASS: 12/12 paid routes are structurally unavailable before economics.
PASS: all required real secret names are present.
PREFLIGHT RESULT: PASS
```

`git status --short` / `git rev-parse HEAD` re-checked: identical to §20
(only this report file untracked; `HEAD` unchanged at `ea4c917`).

```
SUN1219C_FINAL_PREFLIGHT=PASS
```

`wrangler tail` process terminated after evidence capture completed.

## 30. Final mutation and request accounting

```
WORKER_VERSIONS_CREATED=0            (candidate was already uploaded in §15; no new upload)
DEPLOYMENTS=2
  temporary 100/0 (2026-08-24T19:53:37.786Z)
  mandatory restoration (2026-08-24T19:57:42.599Z)

MAX_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
FINAL_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0

SECRET_ROTATIONS=0
NEW_SECRET_VALUES=0
PRODUCTION_BINDING_CHANGES=0

REAL_PAYMENT_MATERIAL_SENT=NO
PAYMENT_SIGNATURES=0
VERIFY_CALLS_WITH_VALID_PAYMENT=0
SETTLE_CALLS=0
SETTLEMENTS=0
TRANSACTIONS=0
SERVICE_EXECUTIONS=0
BOUND_SIGNER_EXECUTIONS=0
REAL_ECONOMIC_EFFECTS=0

SELLER_LOOKUP_REQUIRED_BY_CODE_PATH=YES
LIVE_CDP_SELLER_LOOKUPS=INFERRED_1
LIVE_CDP_SELLER_LOOKUPS_DIRECTLY_OBSERVED=NO
DIRECT_PROVIDER_HTTP_REQUEST_COUNT_OBSERVED=NO
(bounded by construction regardless: exactly one verify request was sent)
```

## 31. Final classification

```
SUN1219C_MAINNET_CANDIDATE_GATE=PASS
CANDIDATE_UNPAID_X402_BOUNDARY=PASS
MAINNET_CANDIDATE_OTHER_11_ROUTES_404=YES
SUN1219C_RESTORATION=PASS
POST_MAINNET_QUALIFICATION_ATTRIBUTION=PASS
SUN1219C_FINAL_PREFLIGHT=PASS

FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%

REAL_PAID_E2E_ELIGIBLE=YES
PUBLIC_PAID_ACTIVATION_ELIGIBLE=NO
```

Per the operator's explicit directive, this checkpoint stops here. SUN-1220
was not begun automatically.
