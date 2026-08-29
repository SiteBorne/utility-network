# SUN-1221E1 — MCP-Fixed Replacement Candidate Upload

Non-deploying evidence report for SUN-1221E1 §25–36: uploading a fresh
immutable Cloudflare Worker version carrying the MCP discovery-truthfulness
fix, to replace the historical failed SUN-1221E candidate.

## §25 — Old candidate retirement

```
HISTORICAL_FAILED_CANDIDATE=2044d898-0e42-4d3a-b7c1-d080b463e91e
HISTORICAL_FAILED_CANDIDATE_REUSE_ELIGIBLE=NO
```

Reason: runtime source changed (MCP discovery fix, commit `cae0b24`) after
that candidate was created. Not deleted, not deployed — left as-is.

## §26 — Pre-upload production containment

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

`ACTIVE_DEPLOYMENT_VERSION_COUNT=1`, `CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`CURRENT_PRODUCTION_TRAFFIC=100%` — matches expected.

```
$ pnpm production:preflight
[production:preflight] PREFLIGHT RESULT: PASS
```

`PRE_UPLOAD_PRODUCTION_PREFLIGHT=PASS`.

## §27 — Build/source identity

`SOURCE_HEAD_SHA=cae0b2437769632c0103b992cbc6a2a072ff184c` (working tree was
clean at upload time; no changes since the E1 implementation commit).

## §29 — Upload attempt 1 (defective — self-caught mistake)

First upload omitted the `--var` flags entirely:

```
$ wrangler versions upload --message "SUN-1221E1: MCP-fixed replacement candidate ..."
Worker Version ID: de69268c-81b7-4683-a760-a471931f5458
```

Read-back showed **zero** of the 13 required `[vars]` (`PAID_ROUTES_ENABLED`,
`VERIFY_V2_CDP_ROUTE_ENABLED`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`,
`PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED`, etc.) present — I had forgotten these
are passed as ephemeral `--var` flags at upload time (per SUN-1221D §38),
not read from `wrangler.toml`. This candidate would fail every production
gate and is **not usable**. Caught via authoritative read-back before
proceeding, per the evidence-integrity law — not deployed, not reused.

```
HISTORICAL_DEFECTIVE_CANDIDATE=de69268c-81b7-4683-a760-a471931f5458
HISTORICAL_DEFECTIVE_CANDIDATE_REUSE_ELIGIBLE=NO
HISTORICAL_DEFECTIVE_CANDIDATE_REASON=missing all 13 qualification --var flags at upload
```

## §29 — Upload attempt 2 (corrected)

```
$ wrangler versions upload --message "SUN-1221E1: MCP-fixed replacement candidate (verify_agent_output.v2 + web_context_verified.v2)" \
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

Uploaded siteborne-utility-edge (3.08 sec)
Worker Version ID: 915be949-b46f-464b-a4d6-17b74539ce55
```

```
REPLACEMENT_CANDIDATE_VERSION_ID=915be949-b46f-464b-a4d6-17b74539ce55
REPLACEMENT_CANDIDATE_CREATED_AT=2026-08-29T16:55:43.063Z
WORKER_VERSION_UPLOADS=2 (1 defective/self-caught, 1 corrected — see above)
```

## §30 — Authoritative replacement candidate read-back

```
$ wrangler versions view 915be949-b46f-464b-a4d6-17b74539ce55
Secrets:
  AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET,
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

Matches SUN-1221D's config exactly (verify + web-context both active,
remaining 10 paid configurations and Nevermined inactive by flag absence,
same 6 secrets, `CDP_WALLET_SECRET` absent).

```
REPLACEMENT_CANDIDATE_CONFIG_READBACK=PASS
VERIFY_AGENT_OUTPUT_V2_CDP_CANDIDATE_ACTIVE=YES
WEB_CONTEXT_VERIFIED_V2_CDP_CANDIDATE_ACTIVE=YES
REMAINING_10_PAID_SERVICES_CANDIDATE_ACTIVE=NO
NEVERMINED_CANDIDATE_ACTIVE=NO
CDP_WALLET_SECRET_WORKER_BINDING_PRESENT=NO
```

## §31 — Prove new candidate not deployed

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

Unchanged from §26. `ACTIVE_DEPLOYMENT_VERSION_COUNT=1`,
`FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`FINAL_PRODUCTION_TRAFFIC=100%`, `REPLACEMENT_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`.
No version-override request was sent; no candidate request of any kind.

## §32 — No economic actions

All zero, by construction (no live request of any kind was sent against
either replacement candidate in this checkpoint):

```
LIVE_WEB_CONTEXT_POSTS=0
LIVE_402_REQUESTS=0
BUYER_BALANCE_QUERIES=0
CDP_BUYER_SIGNING_CALLS=0
SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_PAYLOADS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE
```

## §35 — Final production check

```
$ pnpm production:preflight
[production:preflight] PREFLIGHT RESULT: PASS
```

`FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`FINAL_PRODUCTION_TRAFFIC=100%`, `ACTIVE_DEPLOYMENT_VERSION_COUNT=1`,
`FINAL_PRODUCTION_PREFLIGHT=PASS`.

## §36 — Mutation accounting

```
ACTIVE_DEPLOYMENT_MUTATIONS=0
TRAFFIC_SHIFTS=0
WORKER_VERSION_UPLOADS=2 (1 defective/discarded, 1 usable)
WORKER_VERSIONS_CREATED=2
LIVE_CANDIDATE_REQUESTS=0
LIVE_VERSION_OVERRIDE_REQUESTS=0
LIVE_WEB_CONTEXT_POSTS=0
LIVE_402_REQUESTS=0
BUYER_BALANCE_QUERIES=0
SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
D1_WRITES=0
```

## Eligibility

`SUN1221E2_ZERO_TRAFFIC_REQUALIFICATION_ELIGIBLE=YES` against
`915be949-b46f-464b-a4d6-17b74539ce55` — requires its own fresh, standalone
authorization. No deployment, version override, 402 request, buyer query,
signing, or payment was performed in this checkpoint.
