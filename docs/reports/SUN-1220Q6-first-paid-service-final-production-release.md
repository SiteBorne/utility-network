# SUN-1220Q6 — Final Production Promotion + Release Closure

**Candidate:** `de70bf98-f304-4d7f-b189-4ae2401041a0` (SUN-1220Q3 ready-truthfulness
qualification candidate, containing the P2 discovery fix and the Q2 `/ready`
truthfulness fix; source HEAD `41fdaccea4ad245fa0dd034740d7577e2cdb650b`)

**Rollback / prior known-good:** `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`

**Authorization:** Explicit standalone human authorization obtained via
`AskUserQuestion` immediately prior to this checkpoint ("Yes, authorize and
proceed" for the full SUN-1220Q6 promotion, hard gates, one unpaid 402 check,
600s observation, rollback-on-failure).

## Lineage

| Checkpoint | Evidence commit |
|---|---|
| Q1 design | `a5a1ea59062f28456bdf5d5b1fda35ec9475222b` |
| Q2 implementation | `41fdaccea4ad245fa0dd034740d7577e2cdb650b` |
| Q3 upload | `60defb81832bf320fc57bd67278a85b20f3c4de6` |
| Q4 zero-traffic qualification | `4c8d0177dbc7c56b78bee3680812231bb99c30da` |
| Q5 (attempt 1, INCOMPLETE) / Q5R (attempt 2, PASS) | `e130039df698a238178c9ede82337673a8691076` |
| **Q6 (this report)** | *(set at commit time, below)* |

## §1 — Pre-promotion reconciliation

- Q5R evidence commit resolved and confirmed at HEAD (`e130039`), tree clean.
- `SUN1220Q5R_PUBLIC_CANARY=PASS`, `SUN1220Q5R_DURATION_SECONDS=364.8`,
  `Q6_FINAL_PRODUCTION_PROMOTION_ELIGIBLE=YES` — all reconfirmed from the
  committed report.
- Pre-promotion production state: single active version,
  `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`. `production:preflight` PASS.
- Candidate immutability confirmed via `wrangler versions view`: all six
  qualification vars unchanged (`PAID_ROUTES_ENABLED=true`,
  `VERIFY_V2_CDP_ROUTE_ENABLED=true`, `PAYMENT_ENVIRONMENT=production`,
  `PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
  `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`); 6/6 required Worker secrets
  present; `CDP_WALLET_SECRET` absent. `CANDIDATE_DRIFT_SINCE_Q5R=NO`.
- Economic-path source reconciliation: `git diff --stat` from the Q2 source
  HEAD to current HEAD touches only `readiness.ts` and its tests — zero
  economic-path files changed. `ECONOMIC_EXECUTION_PATH_CHANGED=NO`,
  `PAID_ROUTE_COMPOSITION_CHANGED=NO`, `BUYER_CLIENT_CHANGED=NO`.

## §2 — Promotion mutation

Deployed with `wrangler versions deploy de70bf98-...@100 --yes`, message
`"SUN-1220Q6: final production release -- ready-fixed candidate to 100%"`.

Authoritative read-back (`wrangler deployments list`):

```
Created:     2026-08-29T03:25:43.517Z
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

`SUN1220Q6_PROMOTION_READBACK=PASS`. `ACTIVE_DEPLOYMENT_VERSION_COUNT=1`.

## §3 — Normal-routing hard gates (no override header)

All checks performed against production with **no** version-override header,
confirming genuine normal-traffic behavior on the newly promoted candidate.

- `GET /health` → `200`, tail-attributed `scriptVersion.id = de70bf98-...`.
  `NORMAL_PRODUCTION_ATTRIBUTION=PASS`.
- `GET /ready` → `200`:
  ```json
  {"status":"not_ready","phase":"foundation","production_services_enabled":true,
   "blocked_external":["ionos_dns_migration","nevermined_credentials","registry_publication"],
   "reason":"Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available."}
  ```
  `production_services_enabled=true`; the three Q1-proven-stale blockers
  (`cloudflare_account_configuration`, `seller_wallet`, `cdp_credentials`) are
  absent; the three unproven blockers are preserved verbatim; `status`/`phase`/
  `reason` semantics unchanged from pre-fix behavior. `FINAL_PRODUCTION_READY_TRUTHFULNESS=PASS`.
- `GET /catalog`: only `verify_agent_output.v2` has `production_enabled: true,
  production_ready: true, protocol_status: "production"`; all 7 other listed
  services (including `verify_agent_output.v1`) are `false`. `FINAL_CATALOG_TRUTHFUL=YES`.
- `GET /services/verify_agent_output.v2`: matches catalog exactly.
- `GET /.well-known/agent-card.json`: extension-level `verify_agent_output.v2`
  → `productionEnabled: true`; `verify_agent_output.v1` and the four other
  listed services → `false`; top-level `productionEnabled: false` (platform-scope
  flag, established as intentional in Q4). `FINAL_AGENT_CARD_TRUTHFUL=YES`.
- `GET /openapi.json`: only generic discovery paths are enumerated
  (`/health`, `/ready`, `/catalog`, `/schemas`, `/benchmarks`,
  `/services/{service_id}`); no per-service runtime-availability claim is made
  there, so no contradiction is possible. `OPENAPI_RUNTIME_AVAILABILITY_CONTRADICTION=NO`.

## §4 — Isolation (other 11 paid routes + Nevermined)

Discovery: `/catalog` shows `production_enabled: false` for all services
except `verify_agent_output.v2`; no Nevermined mention. `OTHER_ROUTES_DISCOVERY_ACTIVE=NO`,
`NEVERMINED_DISCOVERY_ACTIVE=NO`.

Runtime: POST probes against all other route paths and Nevermined endpoints —
`v1/company/evidence-graph`, `v2/company/evidence-graph`, `v1/web/context`,
`v2/web/context`, `v1/document/evidence-json`, `v2/document/evidence-json`,
`v1/verify/agent-output`, `v1/nevermined/plans`, `/nevermined` — all returned
`404`. `OTHER_11_PAID_ROUTES_RUNTIME_ACTIVE=NO`, `NEVERMINED_RUNTIME_ACTIVE=NO`.

## §5 — Exactly one unpaid 402 challenge

Request body was the `CANONICAL_REQUEST_BODY` extracted verbatim from the
committed test file (`apps/edge-api/tests/live/first-paid-e2e-local.test.ts`):

```json
{"verification_contract":{"claims":[{"claim_id":"total","predicate":"equals","expected_value":42}],"deterministic_requirements":[]},"candidate_output":{"total":42},"required_schema":{},"verification_mode":"standard"}
```

`POST /v2/verify/agent-output` (no override header) → **HTTP 402**, body
`{"error":"payment_required","x402_version":2,"quote_id":"qte_daf5df8b75fb45caf2cb10db","requirement_id":"req_889b8245615ef50d03f28e68"}`.

Decoded `PAYMENT-REQUIRED` header:

```json
{
  "x402Version": 2,
  "resource": {"url": "https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output"},
  "accepts": [{
    "scheme": "exact", "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "19000",
    "payTo": "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1",
    "maxTimeoutSeconds": 60,
    "extra": {"name": "USD Coin", "version": "2", "quote_id": "qte_daf5df8b75fb45caf2cb10db"}
  }],
  "extensions": {"payment-identifier": {"info": {"required": true}, "schema": {...}}}
}
```

Exact match to the frozen historical economic contract (network, asset,
amount, payTo) and the P4/Q4 domain-metadata fix (`extra.name`, `extra.version`
present). `FINAL_UNPAID_402_CHALLENGE=PASS`. No signing, no payment material,
no settlement. `LIVE_402_REQUESTS=1`, `LIVE_PAID_REQUESTS=0`,
`PAYMENT_SIGNATURES_CREATED=0`, `LIVE_SIGN_TYPED_DATA_CALLS=0`.

## §6 — Post-promotion observation window

A Q6-owned `wrangler tail --format json` process (PID `17639`) captured all
production traffic from the moment of promotion. Due to a session pause
between turns, the natural observation window extended well beyond the
required 600 seconds:

- **Window:** first→last captured event spans **3980.9 seconds** (~66.3 min),
  starting at the promotion timestamp `2026-08-29T03:25:43.517Z`.
- **Total events:** 93. **Script version attribution:** 100% —
  every single event attributes to `de70bf98-f304-4d7f-b189-4ae2401041a0`
  (no drift, no residual known-good traffic).
- **HTTP status distribution:** `{200: 29, 400: 34, 403: 1, 404: 22, 402: 1, 202: 6}`
  — **zero 5xx**, **zero uncaught exceptions**.
- **Paid-route hits:** exactly one — the single authorized unpaid 402 check
  above (`POST /v2/verify/agent-output` → `402`). No other request touched the
  paid route. `EXTERNAL_PAID_REQUESTS_OBSERVED=0`, `EXTERNAL_SETTLEMENTS_OBSERVED=0`,
  `EXTERNAL_DUPLICATE_SETTLEMENT_PATTERN=NO`.
- Observed traffic included genuine third-party MCP client activity against
  `utility.siteborne.net/mcp` (mixed `200/202/400/404`, consistent with normal
  protocol negotiation/error responses from real external clients) and normal
  crawler/browser noise (`favicon.ico`, `robots.txt`, etc.) — none of it
  economic, all attributed cleanly to the new candidate version.

`AGENT_REAL_ECONOMIC_EFFECT_USDC=0` throughout.

## §7 — Final state confirmation

- Fresh (non-tail) re-check after the observation window: `GET /health` →
  `200 {"status":"ok",...}`; `GET /ready` → identical truthful payload as §3.
- `wrangler deployments list`: still exactly one active version,
  `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`, promoted at
  `2026-08-29T03:25:43.517Z` — no drift, no accidental rollback.
- `pnpm production:preflight` → **PASS** (post-promotion).
- Secrets scan (`gitleaks`, full-history): 1 finding, the same pre-existing
  `BASESCAN_TOKEN_CONTRACT` false positive (a public contract address) in
  `docs/reports/SUN-1220O-first-real-paid-e2e.md:159`, already known from
  prior checkpoints. `NEW_SECRET_FINDINGS=0`.
- Q6-owned tail process (PID `17639`) stopped by exact PID; confirmed dead.
  `SUN1220Q6_OWN_TAIL_STOPPED=YES`.
- Pre-existing stale `wrangler tail` processes from earlier checkpoints
  (7 process pairs, PIDs `19976/19982`, `20173/20179`, `20279/20285`,
  `20356/20362`, `20414/20420`, `80209/80216`, `83145/83152`) were observed
  but **not** touched, per this checkpoint's scope restriction.
  `PREEXISTING_STALE_WRANGLER_TAIL_PROCESSES=YES`,
  `BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED=NO`.

## Final packet

```
SUN1220Q6_FINAL_PRODUCTION_RELEASE=PASS
PRODUCTION_PUBLIC_DISCOVERY_TRUTHFULNESS=PASS
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
ROLLBACK_TARGET=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
ROLLBACK_PERFORMED=NO (not required -- all gates PASS)
OTHER_11_PAID_SERVICES_PRODUCTION_ACTIVE=NO
NEVERMINED_PRODUCTION_ACTIVE=NO
REAL_PAID_E2E_PREVIOUSLY_PROVEN=YES
REAL_PAID_E2E_REPEAT_REQUIRED=NO
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES
LIVE_402_REQUESTS=1
LIVE_PAID_REQUESTS=0
PAYMENT_SIGNATURES_CREATED=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
POST_PROMOTION_OBSERVATION_WINDOW_SECONDS=3980.9
POST_PROMOTION_EXCEPTIONS=0
POST_PROMOTION_UNEXPECTED_5XX=0
NEW_SECRET_FINDINGS=0
SUN1220Q6_OWN_TAIL_STOPPED=YES
PREEXISTING_STALE_WRANGLER_TAIL_PROCESSES=YES
BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED=NO
SITEBORNE_FIRST_PAID_SERVICE_RELEASE=COMPLETE
```

**STOP.** No further deployment, no repeat of the paid E2E, no additional
paid-route activation, no unrelated background-process cleanup performed in
this checkpoint.
