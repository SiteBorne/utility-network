# SUN-1221D — `web_context_verified.v2` Qualification Candidate Upload (Phase D of SUN-1221CD)

Upload only. No deployment, no traffic shift, no live requests, no payment.

## Evidence chain

```
SUN1221B_DESIGN_EVIDENCE_COMMIT_SHA  = b0426d467eb23379e2264ef1fb88de3f57067d13
SUN1221C_IMPLEMENTATION_COMMIT_SHA   = 7b5064cbbaa8635fc6331baab9ccfae149d55b00
SOURCE_HEAD_SHA (at upload)          = 7b5064cbbaa8635fc6331baab9ccfae149d55b00
BUNDLE_HASH (pre-upload dry-run)     = 520b39d3b63b26f19fffa1b1ec6777e6df17f05f92c622a07ba61c22dde6a392
```

Working tree confirmed clean at exactly `7b5064c` before building/uploading
(`git status --short` empty).

## §35 — Current production, before upload (read-only)

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

`ACTIVE_DEPLOYMENT_VERSION_COUNT=1`, unchanged from every checkpoint since
SUN-1220Q6.

## §37 — Secret/binding boundary, before upload (read-only)

```
$ wrangler secret list
AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET,
NVM_API_KEY, PAID_RECEIPT_SIGNING_KEY_ID, PAID_RECEIPT_SIGNING_PRIVATE_KEY
```

Exactly the 6 pre-existing secrets — matches SUN-1221B §13's own prediction
(`NEW_WORKER_SECRETS_REQUIRED=none`, `NEW_BINDINGS_REQUIRED=none`). The
dry-run bundle's bindings table (below) confirms no new binding was added.

## §38 — Exactly one non-deploying upload

```
$ wrangler versions upload --message "SUN-1221CD web-context-v2 qualification candidate" \
    --var AGENT_CARD_SIGNING_KEY_ID:"siteborne-agent-card-2026-08" \
    --var ENVIRONMENT:"production" \
    --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:"true" \
    --var LOG_LEVEL:"info" \
    --var NVM_ENVIRONMENT:"sandbox" \
    --var PAID_ROUTES_ENABLED:"true" \
    --var PAYMENT_ENVIRONMENT:"production" \
    --var PCC_VERSION:"1.0.0" \
    --var PRODUCTION_CDP_CREDENTIALS_APPROVED:"true" \
    --var PRODUCTION_ENABLED:"true" \
    --var SELLER_WALLET_ADDRESS:"0x7f44a2dd237938F18632d4CcA40f4c690295E6E1" \
    --var VERIFY_V2_CDP_ROUTE_ENABLED:"true" \
    --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:"true"

Total Upload: 6327.37 KiB / gzip: 1037.30 KiB
Worker Startup Time: 273 ms
Your Worker has access to the following bindings:
  env.CATALOG (KV), env.JOBS (Queue), env.EVENTS (Queue), env.DB (D1),
  env.BROWSER, env.AI, plus the 13 environment variables above (values
  hidden by wrangler at upload time) -- no binding beyond what production
  already has.

Uploaded siteborne-utility-edge (3.63 sec)
Worker Version ID: 2044d898-0e42-4d3a-b7c1-d080b463e91e
```

`WORKER_VERSION_UPLOADS=1`.

## §39 — Authoritative version read-back

```
$ wrangler versions view 2044d898-0e42-4d3a-b7c1-d080b463e91e
Version ID:  2044d898-0e42-4d3a-b7c1-d080b463e91e
Created:     2026-08-29T12:27:46.935Z
Message:     SUN-1221CD web-context-v2 qualification candidate

Secrets: AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET,
         NVM_API_KEY, PAID_RECEIPT_SIGNING_KEY_ID, PAID_RECEIPT_SIGNING_PRIVATE_KEY

env.AGENT_CARD_SIGNING_KEY_ID ("siteborne-agent-card-2026-08")
env.ENVIRONMENT ("production")
env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP ("true")
env.LOG_LEVEL ("info")
env.NVM_ENVIRONMENT ("sandbox")
env.PAID_ROUTES_ENABLED ("true")
env.PAYMENT_ENVIRONMENT ("production")
env.PCC_VERSION ("1.0.0")
env.PRODUCTION_CDP_CREDENTIALS_APPROVED ("true")
env.PRODUCTION_ENABLED ("true")
env.SELLER_WALLET_ADDRESS ("0x7f44a2dd237938F18632d4CcA40f4c69029...")
env.VERIFY_V2_CDP_ROUTE_ENABLED ("true")
env.WEB_CONTEXT_V2_CDP_ROUTE_ENABLED ("true")
```

Both services' route flags are `"true"` on this exact immutable version —
this is the first candidate in the SUN-1221 lineage to carry two
simultaneously-active real paid services. All four ADR-0055 gates true.
`NVM_ENVIRONMENT="sandbox"` (not `"production"`) — Nevermined inactive, no
Nevermined-specific flag set. No other route-family flag present —
consistent with the remaining 10 nominal paid routes staying inactive by
absence, exactly as SUN-1221C's own regression proved.

```
NEW_CANDIDATE_CONFIGURATION_READBACK = PASS
VERIFY_AGENT_OUTPUT_V2_CDP_CANDIDATE_ACTIVE = YES
WEB_CONTEXT_VERIFIED_V2_CDP_CANDIDATE_ACTIVE = YES
REMAINING_10_PAID_SERVICES_CANDIDATE_ACTIVE = NO
CDP_WALLET_SECRET_WORKER_BINDING_PRESENT = NO
```

Frozen economics carried onto this candidate (from SUN-1221C's own local
proof, unchanged — this checkpoint performed no economic-path source
changes):

```
verify_agent_output.v2:   19000 atomic USDC (unchanged since SUN-1220O's real settlement)
web_context_verified.v2:   9000 atomic USDC (SUN-1221B's frozen contract, never invented)
```

## §40 — Prove not deployed (read-only, after upload)

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

Identical to the pre-upload read-back in §35 — the upload created an
immutable version object only; it did not touch the active deployment.

```
ACTIVE_DEPLOYMENT_VERSION_COUNT = 1
FINAL_PRODUCTION_VERSION = de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC = 100%
NEW_WEB_CONTEXT_V2_CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
NEW_WEB_CONTEXT_V2_CANDIDATE_NORMAL_TRAFFIC_PERCENT = 0
```

## §41/§42 — No live qualification, no real payment

```
LIVE_CANDIDATE_REQUESTS = 0
LIVE_VERSION_OVERRIDE_REQUESTS = 0
LIVE_WEB_CONTEXT_V2_POSTS = 0
LIVE_402_REQUESTS = 0
LIVE_PAID_REQUESTS = 0
CURRENT_REAL_PAYMENT_AUTHORIZATION = NONE
NEW_WEB_CONTEXT_V2_REAL_PAID_E2E_EXECUTED = NO
```

True by construction: no request of any kind was sent to
`2044d898-0e42-4d3a-b7c1-d080b463e91e`, live or version-overridden, this
checkpoint. Live qualification (candidate `/health`/`/ready`/`/catalog`
under a temporary 0%-traffic deployment, one unpaid 402 check) is
SUN-1221E's job, not this one.

Historical buyer/seller identities (recorded for continuity only — no
standing authorization to use either economically exists from this
checkpoint):

```
Historical buyer:  0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
Historical seller: 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
```

## §45 — Final production containment

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0

$ pnpm production:preflight
[production:preflight] PREFLIGHT RESULT: PASS
```

`FINAL_PRODUCTION_PREFLIGHT = PASS`.

## Summary

```
SUN1221D_CANDIDATE_UPLOAD = PASS
```

Exactly one new, non-deploying Worker version uploaded
(`2044d898-0e42-4d3a-b7c1-d080b463e91e`), carrying SUN-1221C's DNS-rebinding
fix and the second real paid service (`web_context_verified.v2`/CDP),
authoritatively confirmed to have the correct qualification configuration
and to be entirely absent from the active deployment. Production remains
`de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`, unchanged throughout both
Phase C and Phase D. Zero live requests, zero economic actions.

`SUN1221E_LIVE_QUALIFICATION_ELIGIBLE = YES`. STOP — this checkpoint does
not authorize a temporary deployment, a version-overridden request, an
unpaid 402 check, a public canary, or promotion; each requires its own
fresh, explicit authorization.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
