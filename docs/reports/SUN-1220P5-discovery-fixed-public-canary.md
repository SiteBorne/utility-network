# SUN-1220P5 — Discovery-Fixed Candidate Public Canary

Bounded exact 99/1 public exposure of the discovery-fixed candidate
(`8a1cdfe1-2e68-4dd9-b604-07dc3a666963`). No agent-initiated payment. No
promotion. Mandatory restoration to known-good regardless of outcome.

## Evidence chain

```
SUN1220P4_EVIDENCE_COMMIT_SHA (short 4017207, resolved) = 4017207b78535a23d8b066acc478cae59af55e5b
HEAD at time of P5                                       = 4017207b78535a23d8b066acc478cae59af55e5b
SOURCE_HEAD_SHA (unchanged since P3/P4)                  = a14910ec001afcadcb7d9b329561c786950e5726
P1 design commit                                         = 664427d0ceb16af000052e85bf0aeb3ed4c044c4
P2 discovery implementation commit                       = 83d7e2d31bc1322edce69e1d97f4638e5b20e0ec
```

`git rev-parse 4017207` resolved successfully and matches `HEAD` at the time
this checkpoint began — no drift since P4.

## §1 Reconcile P4 evidence

The committed P4 report ([`SUN-1220P4-discovery-fixed-candidate-live-qualification.md`](SUN-1220P4-discovery-fixed-candidate-live-qualification.md))
records, for candidate `8a1cdfe1-2e68-4dd9-b604-07dc3a666963`:

- discovery fix live-proven (agent-card / catalog / service-detail truthful
  under candidate override)
- route isolation held (only `verify_agent_output.v2` active)
- one source-proven unpaid POST returned HTTP 402
- 402 economic fields matched the historical paid E2E (`eip155:8453`, USDC
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, amount `19000`, payTo
  `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, `extra.name="USD Coin"`,
  `extra.version="2"`)
- zero signing/payment/settlement occurred
- restoration to `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100%` passed

All required facts present. `SUN1220P5_PRECONDITION=PASS`.

## §2 Pre-canary production precondition

Before any mutation: single active deployed version,
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100%`, candidate absent.
`pnpm production:preflight` → `PREFLIGHT RESULT: PASS`.

## §3 Candidate immutability

`8a1cdfe1-2e68-4dd9-b604-07dc3a666963` unchanged since P3/P4 (content-addressed
Worker version; no re-upload occurred between P4 and P5).
`CANDIDATE_DRIFT_SINCE_P4=NO`.

## §4–§10 Phase A — pre-canary zero-traffic safety gate

| Gate | Result |
|---|---|
| `PRECANARY_100_0_DEPLOYMENT` | PASS — exact `f4f20676@100 / 8a1cdfe1@0`, read-back confirmed 2 active versions |
| `ORDINARY_ROUTING_REMAINS_KNOWN_GOOD` | PASS — unoverridden `/health`, `/catalog` attributed to `f4f20676` |
| `PRECANARY_CANDIDATE_OVERRIDE_CONTROL` | PASS — override-targeted `/health` → HTTP 200, `scriptVersion.id=8a1cdfe1-…` |
| `PRECANARY_DISCOVERY_RECONFIRMATION` | PASS — catalog/agent-card/service-detail truthful under override |
| `OTHER_11_PAID_ROUTES_ACTIVE` | NO |
| `NEVERMINED_ACTIVE` | NO |
| Agent-created economic actions | 0 |

`SUN1220P5_PRECANARY_GATE=PASS`.

## §11 Phase B — exact 99/1 deployment

```
$ pnpm exec wrangler versions deploy f4f20676-…@99 8a1cdfe1-…@1 --yes \
    --message "SUN-1220P5 Phase B: exact 99/1 public canary of discovery-fixed candidate"
SUCCESS  Deployed siteborne-utility-edge (99%) f4f20676-…, (1%) 8a1cdfe1-… at 2026-08-29T00:21:04.231Z
```

Read-back (`wrangler deployments status`) confirmed exactly:

```
(99%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
(1%)  8a1cdfe1-2e68-4dd9-b604-07dc3a666963
```

`PUBLIC_CANARY_DEPLOYMENT_READBACK=PASS`.

## §12–§13 Bounded safe sampling and observation window

Controlled non-economic GET sampling only (`/health`, `/catalog`, `/schemas`,
`/openapi.json`, `/.well-known/agent-card.json`), no version-override header,
no paid-route POST. Attribution captured via `wrangler tail --format json`.

```
CANARY_START_TIME  = 2026-08-29T00:21:04Z (deployment created)
CANARY_END_TIME    = 2026-08-29T00:28:11Z (restoration deployed)
CANARY_DURATION_SECONDS   ≈ 427 (tail-observed span)
TOTAL_OBSERVED_REQUESTS   = 497
KNOWN_GOOD_ATTRIBUTED_REQUESTS = 485
CANDIDATE_ATTRIBUTED_REQUESTS  = 12
CONTROLLED_CANDIDATE_SAFE_SAMPLES = 12  (>= 8 required)
ORGANIC_CANDIDATE_REQUESTS = 0 (all 12 candidate-attributed requests originated
  from the single controlled-sampler client IP; no other client IP appeared
  in candidate-attributed traffic)
```

Candidate-attributed path/method/status breakdown (12 total):

```
/health                          GET  200  x1
/catalog                         GET  200  x4
/.well-known/agent-card.json     GET  200  x2
/services/verify_agent_output.v2 GET  200  x1
/openapi.json                    GET  200  x4
```

## §14 Candidate runtime health

```
CANDIDATE_HTTP_STATUS_DISTRIBUTION = {200: 12}
CANDIDATE_UNHANDLED_EXCEPTIONS     = 0
CANDIDATE_RUNTIME_EVAL_FAILURES    = 0
CANDIDATE_UNEXPECTED_5XX           = 0
CANDIDATE_D1_ERRORS                = 0
CANDIDATE_PROVIDER_ERRORS          = 0
CANDIDATE_RECEIPT_SIGNER_ERRORS    = 0
CPU_TIME_MAX_MS  = 53   (avg 10.8)
WALL_TIME_MAX_MS = 55   (avg 18.3)
```

All zero-tolerance runtime requirements satisfied.

## §15 Discovery truthfulness under normal (non-override) canary routing

From the candidate-attributed normal-routing samples:

- `/catalog` (x4, HTTP 200) — `NORMAL_ROUTING_CANDIDATE_CATALOG_TRUTHFUL=YES`
  (status-level confirmation; content-level truthfulness already exhaustively
  proven under override control in §8 and in P4, with the same immutable
  candidate version serving both override and normal traffic)
- `/.well-known/agent-card.json` (x2, HTTP 200) —
  `NORMAL_ROUTING_CANDIDATE_AGENT_CARD_TRUTHFUL=YES`
- `/services/verify_agent_output.v2` (x1, HTTP 200) —
  `NORMAL_ROUTING_CANDIDATE_SERVICE_DETAIL_TRUTHFUL=YES`

`wrangler tail` captures request/response metadata (status, scriptVersion,
timing, exceptions) but not response bodies, so body-level truthfulness
under normal routing rests on (a) these HTTP 200s against the exact same
immutable candidate version whose body content was directly inspected under
override control in §8/P4, and (b) the absence of any code path that
distinguishes override-routed from normally-routed requests in the P2
discovery-overlay implementation. No contradiction observed.

## §16 Agent-initiated economic actions — hard zero

```
AGENT_LIVE_SELECTED_ROUTE_POSTS       = 0
AGENT_CDP_BUYER_LOOKUPS               = 0
AGENT_SIGN_TYPED_DATA_CALLS           = 0
AGENT_EIP3009_AUTHORIZATIONS_CREATED  = 0
AGENT_PAYMENT_PAYLOADS_CREATED        = 0
AGENT_PAYMENT_SIGNATURES_CREATED      = 0
AGENT_PAID_REQUEST_SUBMISSIONS        = 0
AGENT_SETTLEMENTS                     = 0
AGENT_TRANSACTIONS                    = 0
AGENT_REAL_ECONOMIC_EFFECT_USDC       = 0
```

## §17 External paid activity

Across the full 497-event tail capture, the only client IP ever attributed to
the candidate version was the controlled sampler's own IP
(`207.68.238.67`), generating only the 12 non-economic GETs listed in §12.
No request to any paid route (`/v2/verify/agent-output` or otherwise) was
observed against the candidate during the canary window.

```
EXTERNAL_PAID_REQUESTS_OBSERVED       = 0
EXTERNAL_SETTLEMENTS_OBSERVED         = 0
EXTERNAL_SERVICE_EXECUTIONS_OBSERVED  = 0
EXTERNAL_PROVIDER_ERRORS              = 0
EXTERNAL_DUPLICATE_SETTLEMENT_PATTERN = NO
```

## §18 Canary pass gate

All required conditions satisfied:

- fresh human authorization: YES (explicit checkpoint specification with
  named versions/percentages, provided as the standalone human message)
- pre-canary gate: PASS
- 99/1 deployment: exact, read-back confirmed
- controlled candidate safe samples: 12 (≥ 8)
- bounded observation: completed (~427s)
- candidate discovery: truthful under normal routing
- candidate unhandled exceptions / eval failures / unexpected 5xx / D1 /
  provider / receipt-signer errors: all 0
- other 11 paid routes: inactive; Nevermined: inactive
- agent-created economic actions: all 0
- no duplicate/abnormal external settlement evidence: none observed

`SUN1220P5_PUBLIC_CANARY=PASS`.

## §19 Mandatory restoration

```
$ pnpm exec wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 --yes \
    --message "SUN-1220P5: mandatory restoration to known-good after 99/1 canary"
SUCCESS  Deployed siteborne-utility-edge version f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce at 100% (1.44 sec)
```

Read-back (`wrangler deployments status`):

```
Version(s): (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

`ACTIVE_DEPLOYMENT_VERSION_COUNT=1`, candidate absent from active deployment.
`SUN1220P5_RESTORATION=PASS`.

## §20 Post-restoration verification

```
GET /health → HTTP/2 200
$ pnpm production:preflight
[production:preflight] PREFLIGHT RESULT: PASS
```

`POST_RESTORATION_HEALTH=PASS`, `POST_RESTORATION_PRODUCTION_PREFLIGHT=PASS`.

## §21 Historical paid-E2E status

```
HISTORICAL_REAL_PAID_E2E_TX = 0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID = YES
NEW_REAL_PAID_E2E_EXECUTED_BY_AGENT    = NO
REAL_PAID_E2E_REPEAT_REQUIRED          = NO
```

No canary evidence contradicts P2/P4's economic-equivalence proofs.

## §23 Secrets scan

```
$ pnpm secrets:scan
Secret-scan scope OK: 1108 tracked files, 8 required classes, 9 redacted detector probes
Finding: BASESCAN_TOKEN_CONTRACT (generic-api-key heuristic) — docs/reports/SUN-1220O-first-real-paid-e2e.md:159
  (known recurring historical public-address heuristic finding, pre-existing since SUN-1220O)
```

No new secret findings beyond the known recurring heuristic match on a public
contract address already present in a prior committed report.
`NEW_SECRET_FINDINGS=0`.

## §24 Mutation accounting

```
PRECANARY_DEPLOYMENT_MUTATIONS     = 1
PUBLIC_CANARY_DEPLOYMENT_MUTATIONS = 1
RESTORATION_DEPLOYMENT_MUTATIONS   = 1
WORKER_VERSIONS_CREATED            = 0
D1_WRITES                          = 0
MAX_CANDIDATE_NORMAL_TRAFFIC_PERCENT = 1
AGENT_LIVE_SELECTED_ROUTE_POSTS      = 0
AGENT_SIGN_TYPED_DATA_CALLS          = 0
AGENT_EIP3009_AUTHORIZATIONS_CREATED = 0
AGENT_PAYMENT_PAYLOADS_CREATED       = 0
AGENT_PAYMENT_SIGNATURES_CREATED     = 0
AGENT_PAID_REQUEST_SUBMISSIONS       = 0
AGENT_SETTLEMENTS                    = 0
AGENT_TRANSACTIONS                   = 0
AGENT_REAL_ECONOMIC_EFFECT_USDC      = 0
```

## §25 Final stop packet

```
SUN1220P5_PUBLIC_CANARY = PASS
SUN1220P4_EVIDENCE_COMMIT_SHA = 4017207b78535a23d8b066acc478cae59af55e5b
SUN1220P5_EVIDENCE_COMMIT_SHA = <recorded after commit, see below>
FRESH_SUN1220P5_PUBLIC_CANARY_AUTHORIZATION = YES
NEW_DISCOVERY_FIXED_CANDIDATE_VERSION_ID = 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
CANDIDATE_DRIFT_SINCE_P4 = NO
PRECANARY_100_0_DEPLOYMENT = PASS
ORDINARY_ROUTING_REMAINS_KNOWN_GOOD = PASS
PRECANARY_CANDIDATE_OVERRIDE_CONTROL = PASS
PRECANARY_DISCOVERY_RECONFIRMATION = PASS
SUN1220P5_PRECANARY_GATE = PASS
PUBLIC_CANARY_DEPLOYMENT_READBACK = PASS
PUBLIC_CANARY_PERCENT = 1
CANARY_DURATION_SECONDS = 427
CONTROLLED_CANDIDATE_SAFE_SAMPLES = 12
CANDIDATE_ATTRIBUTED_REQUESTS = 12
NORMAL_ROUTING_CANDIDATE_CATALOG_TRUTHFUL = YES
NORMAL_ROUTING_CANDIDATE_AGENT_CARD_TRUTHFUL = YES
NORMAL_ROUTING_CANDIDATE_SERVICE_DETAIL_TRUTHFUL = YES
CANDIDATE_HTTP_STATUS_DISTRIBUTION = {200: 12}
CANDIDATE_UNHANDLED_EXCEPTIONS = 0
CANDIDATE_RUNTIME_EVAL_FAILURES = 0
CANDIDATE_UNEXPECTED_5XX = 0
CANDIDATE_D1_ERRORS = 0
CANDIDATE_PROVIDER_ERRORS = 0
CANDIDATE_RECEIPT_SIGNER_ERRORS = 0
OTHER_11_PAID_ROUTES_ACTIVE = NO
NEVERMINED_ACTIVE = NO
AGENT_LIVE_SELECTED_ROUTE_POSTS = 0
AGENT_SIGN_TYPED_DATA_CALLS = 0
AGENT_EIP3009_AUTHORIZATIONS_CREATED = 0
AGENT_PAYMENT_SIGNATURES_CREATED = 0
AGENT_PAID_REQUEST_SUBMISSIONS = 0
AGENT_SETTLEMENTS = 0
AGENT_REAL_ECONOMIC_EFFECT_USDC = 0
EXTERNAL_PAID_REQUESTS_OBSERVED = 0
EXTERNAL_SETTLEMENTS_OBSERVED = 0
EXTERNAL_DUPLICATE_SETTLEMENT_PATTERN = NO
SUN1220P5_RESTORATION = PASS
FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%
POST_RESTORATION_PRODUCTION_PREFLIGHT = PASS
NEW_SECRET_FINDINGS = 0
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID = YES
REAL_PAID_E2E_REPEAT_REQUIRED = NO
FULL_PROMOTION_ELIGIBLE = NO
```

`FULL_PROMOTION_ELIGIBLE=NO`: this checkpoint proves the discovery fix holds
under real public 1% exposure with zero anomalies, but promotion to 100% is a
separate, larger-blast-radius decision this checkpoint does not authorize and
was explicitly told not to make (`Do not promote to 100%`). No further
mutation was performed after §19 restoration.
