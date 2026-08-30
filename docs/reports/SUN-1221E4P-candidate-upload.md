# SUN-1221E4P — candidate upload evidence

Companion to [`SUN-1221E4P-direct-public-http-protocol-forensics.md`](./SUN-1221E4P-direct-public-http-protocol-forensics.md). No traffic shift, no live candidate request, no 402, no payment.

## Candidate decision

Worker source changed (`packages/provider-adapters/src/http/socket-http-client.ts`, `packages/provider-adapters/src/errors.ts` — both reachable from the real production bundle via `PublicHttpAdapter`). Diagnostic-only change: two new failure-branch classifications, zero behavioral change to any successful path.

```
OLD_E4_CANDIDATE=a088632e-b93c-4953-b0fc-411a2005e57c
OLD_E4_CANDIDATE_REUSE_ELIGIBLE=NO
NEW_E5_CANDIDATE_REQUIRED=YES
E5_CANDIDATE_JUSTIFICATION=PATH_A (diagnostic-only; no proven bug, no behavioral fix;
  E3/E4's specific failure branch remains unproven at the exact-cause level, but the
  next real invocation now distinguishes WEBCTX_HTTP_PREMATURE_EOF /
  WEBCTX_HTTP_INVALID_RESPONSE_STATUS from the generic WEBCTX_UPSTREAM_PROTOCOL_ERROR
  bucket, and WEBCTX_RESPONSE_READ_FAILED remains available to rule out raw
  socket-read rejection, already ruled out once in E4)
```

## Preupload qualification manifest

Read back from the last web-context-carrying candidate (`a088632e-...`, `wrangler versions view`) and replicated exactly — 13 vars, identical values:

`ENVIRONMENT=production`, `LOG_LEVEL=info`, `PCC_VERSION=1.0.0`, `AGENT_CARD_SIGNING_KEY_ID=siteborne-agent-card-2026-08`, `NVM_ENVIRONMENT=sandbox`, `PAID_ROUTES_ENABLED=true`, `VERIFY_V2_CDP_ROUTE_ENABLED=true`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true`, `PAYMENT_ENVIRONMENT=production`, `PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`, `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`, `SELLER_WALLET_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`.

(Note: current *production* version `de70bf98-...` carries only 12 vars — it predates the web-context second-service work and never received `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`. The correct qualification source for a web-context-carrying candidate is the prior web-context candidate lineage, not `de70bf98` directly.)

```
PREUPLOAD_QUALIFICATION_VAR_MANIFEST_COMPLETE=YES
PREUPLOAD_REQUIRED_VAR_COUNT=13
```

## Upload

```
E5_CANDIDATE_VERSION_ID=090a4bc4-64e4-4152-8ce9-d41977238162
E5_CANDIDATE_CREATED_AT=2026-08-30T00:53:59.368Z
WORKER_VERSION_UPLOADS=1
```

## Authoritative candidate read-back

`wrangler versions view 090a4bc4-64e4-4152-8ce9-d41977238162` — exact match to the preupload manifest, all 13/13 vars identical. 6/6 required Worker secrets present (`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`); `CDP_WALLET_SECRET` absent. D1 binding `efe23c42-cbcc-47c2-9b28-922a541bdcdd` (the real shared production database) — correct.

`wrangler deploy --dry-run` bundle contains 3 occurrences of `WEBCTX_HTTP_PREMATURE_EOF` and 2 of `WEBCTX_HTTP_INVALID_RESPONSE_STATUS` — the diagnostic fix is present in the bundle that would ship if this candidate were ever deployed.

```
E5_CANDIDATE_CONFIG_READBACK=PASS
E5_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
```

## Final production containment

```
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
```

`pnpm production:preflight` → `FINAL_PRODUCTION_PREFLIGHT=PASS`.

## Zero economic actions

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

## E5 eligibility

All preconditions met: E4 fully reconciled (E4R), old E4 authorization retired, protocol forensics complete (this checkpoint, PATH A), diagnostic candidate technically justified, mutation-proof 7/7 caught, full regression PASS (2416 tests, 92/92 worker-runtime scenarios, lint, production typecheck), security/payment-ordering/economics/MCP/discovery unchanged, candidate config read-back PASS, candidate not deployed, production known-good @ 100%, zero new economic action this checkpoint.

```
SUN1221E5_REAL_PAID_RETRY_ELIGIBLE=YES
```
