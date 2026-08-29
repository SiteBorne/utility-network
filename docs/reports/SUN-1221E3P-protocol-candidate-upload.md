# SUN-1221E3P — protocol candidate upload evidence

Companion to [`SUN-1221E3P-direct-public-http-protocol-root-cause.md`](./SUN-1221E3P-direct-public-http-protocol-root-cause.md). No traffic shift, no live candidate request, no 402, no payment.

## Candidate decision (§28–29)

Worker source changed (`packages/provider-adapters/src/http/socket-http-client.ts`, `packages/provider-adapters/src/errors.ts` — both reachable from the real production bundle via `PublicHttpAdapter`).

```
OLD_E3_CANDIDATE=54d87b77-e3fd-44da-a012-a817c23f1953
OLD_E3_CANDIDATE_REUSE_ELIGIBLE=NO
NEW_E4_CANDIDATE_REQUIRED=YES
E4_CANDIDATE_TECHNICALLY_JUSTIFIED=YES  (path B: root cause unresolved, but diagnostic
  resolution materially improved -- a future one-shot invocation now distinguishes
  "still the generic bucket" from "confirmed WEBCTX_RESPONSE_READ_FAILED")
```

## Preupload qualification manifest (§30)

Read back from the last qualified candidate (`54d87b77-...`, `wrangler versions view`) and replicated exactly — 13 vars, identical values:

`ENVIRONMENT=production`, `LOG_LEVEL=info`, `PCC_VERSION=1.0.0`, `AGENT_CARD_SIGNING_KEY_ID=siteborne-agent-card-2026-08`, `NVM_ENVIRONMENT=sandbox`, `PAID_ROUTES_ENABLED=true`, `VERIFY_V2_CDP_ROUTE_ENABLED=true`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true`, `PAYMENT_ENVIRONMENT=production`, `PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`, `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`, `SELLER_WALLET_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`.

```
PREUPLOAD_QUALIFICATION_VAR_MANIFEST_COMPLETE=YES
PREUPLOAD_REQUIRED_VAR_COUNT=13
```

## Upload (§31)

```
E4_CANDIDATE_VERSION_ID=a088632e-b93c-4953-b0fc-411a2005e57c
E4_CANDIDATE_CREATED_AT=2026-08-29T23:13:35.653Z
WORKER_VERSION_UPLOADS=1
```

## Authoritative candidate read-back (§32)

`wrangler versions view a088632e-b93c-4953-b0fc-411a2005e57c` — exact match to the preupload manifest, all 13/13 vars identical. 6/6 required Worker secrets present (`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`); `CDP_WALLET_SECRET` absent. D1 binding `efe23c42-cbcc-47c2-9b28-922a541bdcdd` (the real shared production database) — correct.

`wrangler deploy --dry-run` bundle contains 2 occurrences of `WEBCTX_RESPONSE_READ_FAILED` (the `errors.ts` pattern registration + the `socket-http-client.ts` template literal) — the fix is present in the bundle that would ship if this candidate were ever deployed.

```
E4_CANDIDATE_CONFIG_READBACK=PASS
E4_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
```

## Final production containment (§33)

```
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
```

`pnpm production:preflight` → `FINAL_PRODUCTION_PREFLIGHT=PASS`.

## Zero economic actions (§34)

```
LIVE_PRODUCTION_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
BUYER_BALANCE_QUERIES=0
SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE
```

## E4 eligibility (§35)

All preconditions met: E3 fully reconciled (E3R), old E3 authorization retired, protocol investigation complete (this checkpoint), E4 candidate technically justified, all relevant tests PASS, security/payment-ordering/economics/MCP unchanged, candidate config read-back PASS, candidate not deployed, production known-good @ 100%, zero new economic action this checkpoint.

```
SUN1221E4_REAL_PAID_RETRY_ELIGIBLE=YES
```

A fresh, standalone human payment authorization remains mandatory before any E4 attempt — none is given or implied by this checkpoint.
