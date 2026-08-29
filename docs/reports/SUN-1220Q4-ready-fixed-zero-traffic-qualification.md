# SUN-1220Q4 — Ready-Fixed Candidate Zero-Traffic Live Qualification

## §0 Purpose and scope

Live-qualify Worker version `de70bf98-f304-4d7f-b189-4ae2401041a0` (the
Q2/Q3 `/ready`-truthfulness-fixed candidate) under a temporary 100/0 traffic
split against real production infrastructure, before any public canary or
promotion is attempted. Scope: `/ready`, discovery, cross-surface coherence,
other-route/Nevermined isolation, and exactly one unpaid `402` challenge on
the selected paid route. No payment, no signing, no promotion.

## §1 Human authorization

The pasted SUN-1220Q4 checkpoint specification is a procedure document, not
itself an authorization statement per its own §Hard Human Authorization
Precondition. A standalone confirmation was solicited and given:

```
FRESH_SUN1220Q4_ZERO_TRAFFIC_QUALIFICATION_AUTHORIZATION=YES
```

Deploy `f4f20676@100%`/`de70bf98@0%`, run discovery/isolation/coherence
checks, send exactly one unpaid `POST` to `/v2/verify/agent-output`, decode
the `402`, then mandatory restoration to `f4f20676@100%`. No payment, no
signing, no promotion.

## §2 Evidence lineage reconciled

| Checkpoint | Commit SHA |
|---|---|
| Q1 design | `a5a1ea59062f28456bdf5d5b1fda35ec9475222b` |
| Q2 implementation | `41fdaccea4ad245fa0dd034740d7577e2cdb650b` |
| Q3 evidence | `60defb81832bf320fc57bd67278a85b20f3c4de6` |

`git rev-parse 60defb8` and `git rev-parse HEAD` both resolved to
`60defb81832bf320fc57bd67278a85b20f3c4de6` with a clean working tree at
checkpoint start. Q3's report confirms: candidate ID exact, source traces to
Q2, Q2's `/ready` fix included, P2 discovery fix included, all six
qualification vars exact, six required Worker secrets present,
`CDP_WALLET_SECRET` absent, candidate not deployed, economic execution path
unchanged.

`CORRUPTED_HISTORICAL_P3_REPORT_BLOCKS_Q4=NO` — no Q4-required fact depends
on the unrelated, separately-flagged corrupted P3 artifact.

## §3 Production precondition

Before mutation: `wrangler deployments list` showed a single active version,
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`, candidate absent.
`pnpm production:preflight` → `PREFLIGHT RESULT: PASS`.

## §4 Candidate immutability

`wrangler versions view de70bf98-f304-4d7f-b189-4ae2401041a0` reconfirmed all
six qualification vars unchanged since Q3:

```
PAID_ROUTES_ENABLED=true
VERIFY_V2_CDP_ROUTE_ENABLED=true
PAYMENT_ENVIRONMENT=production
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
```

No other paid-route enable flags present; `NVM_ENVIRONMENT=sandbox`;
`CDP_WALLET_SECRET` absent. `CANDIDATE_IMMUTABILITY_RECONCILED=YES`.

## §5 Q4-owned attribution session

A dedicated `wrangler tail --format json` process was started for this
checkpoint (PID chain `10458→10482→10488`), independent of three
pre-existing stale tail processes from earlier checkpoints (left untouched
throughout, per instruction).

## §6 Exact 100/0 deployment

```
wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  de70bf98-f304-4d7f-b189-4ae2401041a0@0 --yes
```

Read-back: `ACTIVE_DEPLOYMENT_VERSION_COUNT=2`,
`KNOWN_GOOD_TRAFFIC_PERCENT=100`, `CANDIDATE_TRAFFIC_PERCENT=0`,
`CANDIDATE_IN_ACTIVE_DEPLOYMENT=YES`. **`Q4_100_0_DEPLOYMENT_READBACK=PASS`**

## §7 Ordinary routing control

`GET /health` and `GET /catalog`, no override header. Tail attribution for
both: `scriptVersion.id=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`, `outcome=ok`.
**`ORDINARY_ROUTING_REMAINS_KNOWN_GOOD=PASS`**

## §8 Candidate override control

`GET /health` with
`Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="de70bf98-f304-4d7f-b189-4ae2401041a0"`.
HTTP 200; tail attribution `scriptVersion.id=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`outcome=ok`. **`Q4_CANDIDATE_OVERRIDE_ATTRIBUTION=PASS`**

## §9 Live `/ready` — primary Q4 gate

Candidate-overridden `GET /ready`:

```json
{
  "status": "not_ready",
  "phase": "foundation",
  "production_services_enabled": true,
  "blocked_external": [
    "ionos_dns_migration",
    "nevermined_credentials",
    "registry_publication"
  ],
  "reason": "Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available."
}
```

- `LIVE_READY_PRODUCTION_SERVICES_ENABLED=true`
- `LIVE_READY_STALE_BLOCKERS_PRESENT=NO` (`cloudflare_account_configuration`,
  `seller_wallet`, `cdp_credentials` all absent)
- `LIVE_READY_UNPROVEN_BLOCKERS_PRESERVED=YES` (all three retained verbatim)
- `LIVE_READY_GLOBAL_SEMANTICS_PRESERVED=YES` (`status`/`phase`/`reason`
  unchanged from the pre-fix platform-wide narrative, per Q2's literal
  preservation contract)

Tail attribution: `scriptVersion.id=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`outcome=ok`, zero exceptions. **`LIVE_READY_TRUTHFULNESS=PASS`**

## §10 Catalog / service-detail / agent-card

All three fetched under candidate override:

- `/catalog` → `verify_agent_output.v2`: `production_enabled=true`,
  `production_ready=true`, `protocol_status="production"`.
- `/services/verify_agent_output.v2` → same fields, same values.
- `/.well-known/agent-card.json` → x402 extension per-service entry for
  `verify_agent_output.v2`: `productionEnabled=true` (the top-level
  extension-wide `productionEnabled=false` is the same platform-scope flag
  established as correct at P4/P5 — unchanged here).

All three tail-attributed to `de70bf98-f304-4d7f-b189-4ae2401041a0`,
`outcome=ok`. **`LIVE_CATALOG_TRUTHFULNESS=PASS`**,
**`LIVE_AGENT_CARD_TRUTHFULNESS=PASS`**,
**`LIVE_SERVICE_DETAIL_TRUTHFULNESS=PASS`**

## §11 Cross-surface coherence

Selected service active identically across `/ready`, `/catalog`, service
detail, and agent-card, while `/ready`'s global `status`/`phase` narrative
remains separately scoped. **`READY_CATALOG_OVERLAP_COHERENCE=PASS`**,
**`CATALOG_AGENT_CARD_SERVICE_DETAIL_COHERENCE=PASS`**

## §12 Other public surfaces

`/openapi.json` documents only generic meta-endpoints (`/health`, `/ready`,
`/catalog`, `/schemas`, `/benchmarks`, `/services/{service_id}`) — no
per-service availability claims exist there to contradict.
`OPENAPI_RUNTIME_AVAILABILITY_CONTRADICTION=NO`. No MCP-specific discovery
surface beyond the ones already checked is established in prior checkpoints
for this candidate; `MCP_RUNTIME_AVAILABILITY_CONTRADICTION=NO`.

## §13 Other-route / Nevermined discovery isolation

`/catalog` under candidate override lists exactly one
`production_enabled=true` service: `verify_agent_output.v2`.
**`OTHER_11_PAID_ROUTES_DISCOVERY_ACTIVE=NO`**,
**`NEVERMINED_DISCOVERY_ACTIVE=NO`**

## §14 Other-route / Nevermined runtime isolation

Candidate-overridden probes, no payment material, against every other
service resource path from the agent-card and four Nevermined-shaped paths:

| Path | HTTP |
|---|---|
| `/v1/company/evidence-graph` | 404 |
| `/v1/web/context` | 404 |
| `/v1/document/evidence-json` | 404 |
| `/v1/verify/agent-output` | 404 |
| `/v2/company/evidence-graph` | 404 |
| `/v2/web/context` | 404 |
| `/v2/document/evidence-json` | 404 |
| `/nevermined` | 404 |
| `/nvm` | 404 |
| `/nevermined/status` | 404 |
| `/.well-known/nevermined` | 404 |

All match the frozen expected contract. **`OTHER_11_PAID_ROUTES_RUNTIME_ACTIVE=NO`**,
**`NEVERMINED_RUNTIME_ACTIVE=NO`**

## §15 Offline request-body provenance

`CANONICAL_REQUEST_BODY` read directly from
`apps/edge-api/tests/live/first-paid-e2e-local.test.ts` (lines 122–130,
`Object.freeze`d, not CLI-overridable, sourced from `load-v2.test.ts`'s
`V2_ROUTES.verify.input`):

```json
{
  "verification_contract": {
    "claims": [{"claim_id": "total", "predicate": "equals", "expected_value": 42}],
    "deterministic_requirements": []
  },
  "candidate_output": {"total": 42},
  "required_schema": {},
  "verification_mode": "standard"
}
```

Byte-identical to the body this checkpoint sent live, and to the body that
P4 previously proved live against the discovery-fixed candidate.
**`VALID_REQUEST_BODY_PROVEN_FROM_COMMITTED_SOURCE=YES`**,
**`OFFLINE_PRE_ECONOMIC_BODY_VALIDATION=PASS`**

## §16 The single unpaid selected-route POST

`POST /v2/verify/agent-output`, candidate override, no
`PAYMENT-SIGNATURE`, exactly once (`Q4_SELECTED_ROUTE_UNPAID_POSTS=1`):

- HTTP `402`
- Body: `{"error":"payment_required","x402_version":2,"quote_id":"qte_6b9fc35ffedec45f50ff0afa","requirement_id":"req_54809dc070210954ae9830fd"}`
- Tail attribution: `scriptVersion.id=de70bf98-f304-4d7f-b189-4ae2401041a0`,
  `outcome=ok`, `exceptions=[]`, `cpuTime=40ms`, `wallTime=231ms`

**`Q4_SELECTED_ROUTE_HTTP_STATUS=402`**,
**`Q4_SELECTED_ROUTE_CANDIDATE_ATTRIBUTION=PASS`**

## §17 Canonical `402` decode

`PAYMENT-REQUIRED` header base64-decoded via the repository's canonical
scheme:

```json
{
  "x402Version": 2,
  "resource": {"url": "https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output"},
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "19000",
    "payTo": "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1",
    "maxTimeoutSeconds": 60,
    "extra": {"name": "USD Coin", "version": "2", "quote_id": "qte_6b9fc35ffedec45f50ff0afa"}
  }],
  "extensions": {"payment-identifier": {"info": {"required": true}, "schema": {"...": "..."}}}
}
```

| Field | Expected | Observed | Match |
|---|---|---|---|
| network | `eip155:8453` | `eip155:8453` | ✅ |
| asset | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | same | ✅ |
| amount | `19000` | `"19000"` | ✅ |
| payTo | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` | same | ✅ |
| scheme | `exact` | `exact` | ✅ |
| extra.name | `USD Coin` | `USD Coin` | ✅ |
| extra.version | `2` | `"2"` | ✅ |
| quote_id | present | `qte_6b9fc35ffedec45f50ff0afa` | ✅ |

No signature created, no `PaymentPayload` constructed. **`Q4_402_CONTRACT_MATCH=YES`**

## §18 Live coherence hard gate

All of §§9–17 held simultaneously: `/ready` truthful, catalog/agent-card/
service-detail truthful, cross-surface overlap coherent, other-route and
Nevermined discovery+runtime inactive, selected route's `402` exact-matches
the frozen economic contract, D1 writes = 0.

**`Q4_LIVE_READY_DISCOVERY_RUNTIME_COHERENCE=PASS`**

## §19 Zero economic action

`LIVE_CDP_BUYER_LOOKUPS=0`, `LIVE_SIGN_TYPED_DATA_CALLS=0`,
`EIP3009_AUTHORIZATIONS_CREATED=0`, `PAYMENT_PAYLOADS_CREATED=0`,
`PAYMENT_SIGNATURES_CREATED=0`, `LIVE_PAID_REQUESTS=0`, `SETTLEMENTS=0`,
`TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`.

## §20 Mandatory restoration

Immediately after §17:

```
wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 --yes
```

Read-back: `ACTIVE_DEPLOYMENT_VERSION_COUNT=1`,
`FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`,
`FINAL_PRODUCTION_TRAFFIC=100%`, `NEW_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`.
**`SUN1220Q4_RESTORATION=PASS`**

## §21 Post-restoration check

`pnpm production:preflight` → `PREFLIGHT RESULT: PASS`.
**`POST_RESTORATION_PRODUCTION_PREFLIGHT=PASS`**

## §22 Historical economic-evidence transfer

Q4's `402` matches the frozen economic contract exactly and Q2's source
scope remains readiness-only (no economic-path file touched).
`HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES`,
`REAL_PAID_E2E_REPEAT_REQUIRED=NO`. Historical tx:
`0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2`. No real
payment authorized or performed in this checkpoint.

## §23 Secrets scan

`pnpm secrets:scan` reported exactly one finding: the previously-known
recurring public-address heuristic match (`BASESCAN_TOKEN_CONTRACT` in
`docs/reports/SUN-1220O-first-real-paid-e2e.md:159`), identical to prior
checkpoints. **`NEW_SECRET_FINDINGS=0`**

## §24 Tail cleanup

Only this checkpoint's own tail process (PID chain
`10458→10482→10488`) was stopped. The three pre-existing stale
`wrangler tail` processes (PIDs `91559`, `74556`, `67007`, predating this
checkpoint) were left untouched, per instruction.
**`SUN1220Q4_OWN_TAIL_STOPPED=YES`**, `BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED=NO`

## §25 Mutation accounting

```
WORKER_VERSIONS_CREATED=0
QUALIFICATION_DEPLOYMENT_MUTATIONS=1
RESTORATION_DEPLOYMENT_MUTATIONS=1
MAX_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
D1_WRITES=0
Q4_SELECTED_ROUTE_UNPAID_POSTS=1
LIVE_SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_PAYLOADS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
```

## §26 Final stop packet

```
SUN1220Q4_ZERO_TRAFFIC_QUALIFICATION=PASS
SUN1220Q4_EVIDENCE_COMMIT_SHA=<set at commit time, below>
FRESH_SUN1220Q4_ZERO_TRAFFIC_QUALIFICATION_AUTHORIZATION=YES
NEW_READY_FIXED_CANDIDATE_VERSION_ID=de70bf98-f304-4d7f-b189-4ae2401041a0
CORRUPTED_HISTORICAL_P3_REPORT_BLOCKS_Q4=NO
CANDIDATE_IMMUTABILITY_RECONCILED=YES
Q4_100_0_DEPLOYMENT_READBACK=PASS
ORDINARY_ROUTING_REMAINS_KNOWN_GOOD=PASS
Q4_CANDIDATE_OVERRIDE_ATTRIBUTION=PASS
LIVE_READY_PRODUCTION_SERVICES_ENABLED=true
LIVE_READY_STALE_BLOCKERS_PRESENT=NO
LIVE_READY_UNPROVEN_BLOCKERS_PRESERVED=YES
LIVE_READY_GLOBAL_SEMANTICS_PRESERVED=YES
LIVE_READY_TRUTHFULNESS=PASS
LIVE_CATALOG_TRUTHFULNESS=PASS
LIVE_AGENT_CARD_TRUTHFULNESS=PASS
LIVE_SERVICE_DETAIL_TRUTHFULNESS=PASS
READY_CATALOG_OVERLAP_COHERENCE=PASS
CATALOG_AGENT_CARD_SERVICE_DETAIL_COHERENCE=PASS
OPENAPI_RUNTIME_AVAILABILITY_CONTRADICTION=NO
MCP_RUNTIME_AVAILABILITY_CONTRADICTION=NO
OTHER_11_PAID_ROUTES_DISCOVERY_ACTIVE=NO
OTHER_11_PAID_ROUTES_RUNTIME_ACTIVE=NO
NEVERMINED_DISCOVERY_ACTIVE=NO
NEVERMINED_RUNTIME_ACTIVE=NO
VALID_REQUEST_BODY_PROVEN_FROM_COMMITTED_SOURCE=YES
OFFLINE_PRE_ECONOMIC_BODY_VALIDATION=PASS
Q4_SELECTED_ROUTE_UNPAID_POSTS=1
Q4_SELECTED_ROUTE_HTTP_STATUS=402
Q4_SELECTED_ROUTE_CANDIDATE_ATTRIBUTION=PASS
Q4_402_NETWORK=eip155:8453
Q4_402_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Q4_402_AMOUNT=19000
Q4_402_PAYTO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
Q4_402_EXTRA_NAME=USD Coin
Q4_402_EXTRA_VERSION=2
Q4_402_CONTRACT_MATCH=YES
Q4_LIVE_READY_DISCOVERY_RUNTIME_COHERENCE=PASS
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES
REAL_PAID_E2E_REPEAT_REQUIRED=NO
LIVE_SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
SUN1220Q4_RESTORATION=PASS
FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%
POST_RESTORATION_PRODUCTION_PREFLIGHT=PASS
NEW_SECRET_FINDINGS=0
SUN1220Q4_OWN_TAIL_STOPPED=YES
SUN1220Q5_PUBLIC_CANARY_ELIGIBLE=YES
```

STOP. No Q5 started in this checkpoint. No real payment made. No promotion
performed. Unrelated historical P3 report not repaired.
