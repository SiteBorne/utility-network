# SUN-1212 Checkpoint R — Candidate-Only 100% Runtime Promotion, Paid/Economic Surfaces Still Disabled

## Summary

```
RUNTIME_PROMOTION_GATE = PASS
CANDIDATE_RUNTIME_PROMOTED = YES

FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%

PAID_SERVICES_PRODUCTION_READY = NO
PAID_ROUTES = DISABLED
ECONOMICS = DISABLED
```

The frozen candidate
(`RUNTIME_CANDIDATE_SHA e5d061e2e9c908244f807cf0cf141ab308575496`,
`CANDIDATE_CLOUDFLARE_VERSION_ID f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`) is now
the sole active production Worker version at 100% traffic. Known-good
(`a4ada936-a434-4522-a8af-41c57170f4e4`) is retained as rollback authority but
is not deployed. Paid REST routes and MCP paid-tool execution remain
structurally disabled — this checkpoint promotes only the runtime, not payment
readiness.

## 1. Starting-state reconciliation (§4/§0)

```
SUN1211_REPORT_HEAD (full SHA) = f36d41cdb8b1457a1b3800a9487b2cee92ce612c
WORKING_TREE = CLEAN

CURRENT_PRODUCTION_VERSION (pre-promotion) = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC (pre-promotion) = 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT (pre-promotion) = NO
CANDIDATE_TRAFFIC (pre-promotion) = 0%

GET /health = 200
GET /ready  = 200
GET /mcp    = 405
12/12 paid routes = 404

PREPROMOTION_PRODUCTION_PREFLIGHT = PASS
```

Matched the expected post-SUN-1211-restoration state exactly.

## 2. SUN-1211 evidence reconciliation (§5)

The committed report (not just this prompt) was read directly. Confirmed present
and matching:

```
PUBLIC_CANARY_GATE = PASS
PROMOTION_AUTHORIZATION_ELIGIBLE = YES
NORMAL_CANDIDATE_SAMPLES = 8   (>= 5 required)
CANDIDATE_UNHANDLED_EXCEPTIONS = 0
CANDIDATE_TELEMETRY_ERRORS = 0
CANDIDATE_PAYMENT_EVENTS = 0
CANDIDATE_SETTLEMENT_EVENTS = 0
CANDIDATE_LIVE_PROVIDER_EVENTS = 0
POST_CANARY_RESTORATION_ATTRIBUTION = PASS
POST_CANARY_PRODUCTION_PREFLIGHT = PASS
```

## 3. Candidate identity reconfirmation (§6/§7)

Read via `wrangler versions view f4f20676-... --name siteborne-utility-edge`
(live, authoritative, not assumed from documentation):

```
Compatibility Date:   2026-08-05
Compatibility Flags:  nodejs_compat

Secrets (names only): AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID,
                       CDP_API_KEY_SECRET, NVM_API_KEY   (4/4)

Bindings:  env.CATALOG (KV), env.EVENTS (Queue), env.JOBS (Queue),
           env.DB (D1), env.BROWSER, env.AI

Vars:      AGENT_CARD_SIGNING_KEY_ID, ENVIRONMENT=production,
           LOG_LEVEL=info, NVM_ENVIRONMENT=sandbox, PCC_VERSION=1.0.0,
           SELLER_WALLET_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c69029...
```

Critically, **none** of `PAID_ROUTES_ENABLED`, `PRODUCTION_ENABLED`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
`PAYMENT_ENVIRONMENT`, or `NEVERMINED_ROUTES_ENABLED` appear anywhere in the
candidate's actual bound environment.

```
CANDIDATE_IDENTITY_DRIFT = NONE
PAID_RUNTIME_ACTIVATION_STATE = DISABLED
PAID_SERVICE_CAN_SETTLE = NO
PRODUCTION_FIXTURE_FALLBACK = NONE
```

## 4. Observability plan (§8)

`wrangler tail` (the existing, already-authenticated `wrangler` OAuth session —
not a new API token) provided everything needed: invocation count, outcomes,
HTTP status, exceptions, CPU, wall time. No new temporary Observability token
was created for this checkpoint.

```
TEMP_OBSERVABILITY_TOKEN_CREATED = NO
```

### Pre-promotion attribution baseline

```
GET /health -> HTTP 200, cf-ray a2f6391b48b33110
service: siteborne-utility-edge
scriptVersion.id: a4ada936-a434-4522-a8af-41c57170f4e4  (known-good, correct baseline)
outcome: ok

PREPROMOTION_ATTRIBUTION = PASS
```

## 5. Dry-run and action-time authorization (§11/§12)

`wrangler versions deploy --help` was checked to confirm current pinned syntax.
`--dry-run` of the exact intended command confirmed candidate
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` (tagged
`SUN-1209 frozen candidate e5d061e2`) at 100%. This agent then stopped and
requested explicit action-time authorization before executing any
traffic-changing command, per the checkpoint's own §12. The operator granted
explicit authorization in chat, itemizing exactly what was and was not
authorized (100% promotion of the existing candidate version only; no new
upload, no paid-route/economic activation, no secret/binding/config changes;
rollback pre-authorized if any threshold trips).

## 6. Promotion execution (§13/§14)

```bash
wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  --name siteborne-utility-edge \
  --message "SUN-1212 candidate runtime promotion paid services disabled" \
  -y
```

Unlike both SUN-1211 deployments (which were blocked at the Bash tool permission
layer and had to be run by the operator directly), this identical class of
command was allowed through and executed directly by this agent.

```
PROMOTION_CREATED_AT = 2026-08-23T01:09:26.951Z
PROMOTION_RESULT = SUCCESS

ACTIVE_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CANDIDATE_TRAFFIC = 100%
KNOWN_GOOD_TRAFFIC = 0%
KNOWN_GOOD_IN_ACTIVE_DEPLOYMENT = NO

CANDIDATE_100_PERCENT_DEPLOYMENT_VERIFIED = YES
```

## 7. Immediate post-promotion gates (§15-§17)

### Public surfaces

```
GET /health                          200
GET /ready                           200 -- {"status":"not_ready","phase":"foundation",
                                              "production_services_enabled":false,
                                              "blocked_external":[...],"reason":"..."}
GET /                                200
GET /.well-known/agent-card.json     200
GET /.well-known/jwks.json           200
GET /catalog                         200
GET /openapi.json                    200
GET /mcp                             405

IMMEDIATE_POSTPROMOTION_PUBLIC_SURFACES = PASS
```

`/ready`'s truthful preproduction payload is the expected, governed state -- not
a rollback condition.

### Paid-route boundary

All 12 ordinary paid REST paths, no payment material:

```
404/404/404/404/404/404/404/404/404/404/404/404

POSTPROMOTION_PAID_ROUTES_DISABLED = 12/12
POSTPROMOTION_PAYMENT_CHALLENGES = 0
```

### MCP boundary

`GET /mcp` returned 405 as expected. A raw hand-rolled JSON-RPC `initialize`
probe returned 400 with `Unsupported protocol version` -- not itself a
regression signal, since it matched the server's own protocol-version
negotiation logic correctly rejecting an under-specified request. Rather than
guess the exact wire framing, valid discovery was proven using the repository's
own official MCP SDK client (`@modelcontextprotocol/client`), configured exactly
as this repo's own `transport.test.ts` configures it
(`versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } }`), run from inside
`packages/protocol-mcp` against the live production `/mcp` endpoint:

```
CONNECT_OK = true
TOOL_COUNT = 6
TOOL_NAMES = siteborne_company_evidence_graph, siteborne_document_evidence_json,
             siteborne_get_quote, siteborne_get_service_health,
             siteborne_verify_agent_output, siteborne_web_context_verified

MCP_DISCOVERY = PASS
MCP_PROVIDER_CALLS = 0   (only listTools was called, no tool invocation)
MCP_LIVE_SERVICE_EXECUTION = 0
SETTLEMENTS = 0
```

## 8. Observation window (§18-§20, §23)

`wrangler tail --format json` captured the live production stream (now 100%
candidate) alongside bounded synthetic traffic (`GET /health`/`GET /ready`
alternating, no version override, 1 request/second, capped at 600 requests / 30
minutes) and a continuous real-time safety monitor (zero alerts fired
throughout).

```
Threshold met at elapsed=601s (just past the 10-minute floor)
CANDIDATE_INVOCATIONS_OBSERVED = 572 at threshold check, 585 at final capture stop
MINIMUM_CANDIDATE_INVOCATIONS required = 20  -- far exceeded
```

Synthetic traffic generation was stopped immediately once the threshold was met
(well under the 600-request/30-minute cap).

### Mid-window recheck (§23, ~5 minutes in)

```
404  /v1/company/evidence-graph
404  /v2/company/evidence-graph
404  /v2/nevermined/company/evidence-graph
```

No payment/provider/settlement telemetry observed at any point.

### Full-window telemetry inspection (§20)

Across all 585 captured events (585 candidate, 0 other version -- 100%
attribution to the promoted candidate, consistent with 100% traffic):

```
outcomes                = {ok: 585}          (100%)
statuses                = {200: 581, 404: 3, 400: 1}
  (the 404s and 400 are this agent's own probe/discovery-negotiation
  checks captured in-window, not anomalies)
exceptions_total        = 0
cpu   median=0ms  max=9ms
wall  median=1ms  max=9ms

CANDIDATE_UNHANDLED_EXCEPTIONS = 0
CANDIDATE_TELEMETRY_ERRORS = 0
CANDIDATE_REQUEST_RUNTIME_EVAL_FAILURES = 0
CANDIDATE_PAYMENT_EVENTS = 0
CANDIDATE_SETTLEMENT_EVENTS = 0
CANDIDATE_TRANSACTIONS = 0
CANDIDATE_LIVE_PROVIDER_EVENTS = 0
CANDIDATE_FIXTURE_MARKERS = 0
```

### Performance (§22)

```
Candidate (this window): CPU median 0ms/max 9ms | wall median 1ms/max 9ms
Candidate (SUN-1211 canary window, for reference): CPU median 8.5ms/max 11ms | wall median 9ms/max 12ms

RUNTIME_PROMOTION_PERFORMANCE = PASS
```

(The lower this-window latency is plausibly explained by this window being
dominated by pure `/health`/`/ready` synthetic traffic and edge caching effects;
both windows are far under the 100ms/1000ms emergency thresholds and no
comparison beyond that sanity check is claimed.)

## 9. End-of-window checks (§24/§25)

```
GET /health = 200
GET /ready  = 200
GET /mcp    = 405
12/12 paid routes = 404

POSTPROMOTION_PRODUCTION_PREFLIGHT = PASS  (pnpm production:preflight)
```

## 10. Disposition (§26)

No rollback threshold ever tripped. Per §3/§26, promotion success does **not**
trigger automatic restoration -- the candidate remains the sole active
production version.

```
RUNTIME_PROMOTION_GATE = PASS
CANDIDATE_RUNTIME_PROMOTED = YES

FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%

KNOWN_GOOD_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
KNOWN_GOOD_STATUS = ROLLBACK AUTHORITY / NOT ACTIVE

PAID_SERVICES_PRODUCTION_READY = NO
PAID_ROUTE_ACTIVATION_ELIGIBLE = SEPARATE_CHECKPOINT_REQUIRED
```

## 11. Credential and artifact cleanup (§30/§31)

```
TEMP_OBSERVABILITY_TOKEN_CREATED = NO   (dashboard/wrangler-OAuth-based observability was sufficient; see §4)
```

All temporary tail captures, traffic-generator scripts/logs/pid files, and
wait-condition scripts were removed. Working tree confirmed clean.

```
TEMP_RELEASE_ARTIFACTS_REMOVED = YES
```

## 12. Mutation accounting (§32)

```
VERSION_UPLOADS = 0
WORKER_VERSIONS_CREATED = 0
WORKER_SECRET_CHANGES = 0

PROMOTION_DEPLOYMENTS = 1
ROLLBACK_DEPLOYMENTS = 0

FINAL_CANDIDATE_TRAFFIC_PERCENT = 100
MAX_CANDIDATE_TRAFFIC_PERCENT = 100

PAID_ROUTE_CHANGES = 0
PREVIEW_CONFIG_CHANGES = 0
BINDING_CHANGES = 0
PRODUCTION_MIGRATIONS = 0

PRODUCTION_D1_WRITES = 0
PRODUCTION_KV_WRITES = 0
PRODUCTION_R2_WRITES = 0
PRODUCTION_QUEUE_WRITES = 0

PAYMENT_SIGNATURES = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_NEVERMINED_ECONOMIC_EFFECTS = 0
LIVE_PROVIDER_CALLS_PERFORMED = 0

OBSERVATION_WINDOW_SECONDS = 601
CANDIDATE_INVOCATIONS_OBSERVED = 585
SYNTHETIC_REQUESTS = ~572 (bounded generator, stopped early once threshold met; well under the 600 cap)
OBSERVABILITY_QUERIES = 2 wrangler tail sessions (pre-promotion baseline, promotion-window capture) via the pre-existing OAuth session; 0 new API-token-based queries
```

## 13. Deviations and notable findings, called out honestly

1. **Direct deployment execution was allowed this time**, unlike both SUN-1211
   deployments which were blocked at the Bash permission layer. No explanation
   for the difference is available to this agent; noted for transparency, not
   treated as evidence either way about the classifier's exact rules.
2. **Raw JSON-RPC MCP discovery probing initially failed** with a confusing
   "Unsupported protocol version: 2026-07-28 / supported: [2026-07-28]" response
   from a hand-typed request, and the official SDK client's own default protocol
   version also failed for a different reason (SDK default `2025-11-25` vs the
   server's `2026-07-28`). Both were investigated by reading the actual
   server/package source (`packages/protocol-mcp/dist/index.js`,
   `transport.test.ts`) rather than guessed at repeatedly; the correct fix (pin
   `versionNegotiation.mode.pin` to `MCP_PROTOCOL_VERSION`, matching the repo's
   own established test pattern) produced a clean, genuine PASS. Recorded here
   so a future checkpoint doesn't have to rediscover this.

## 14. Human paid-activation readiness packet (§34)

```
RUNTIME_CANDIDATE_SHA        = e5d061e2e9c908244f807cf0cf141ab308575496
RUNTIME_BUNDLE_SHA256        = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

PROMOTION_DEPLOYMENT_CREATED_AT = 2026-08-23T01:09:26.951Z
FINAL_PRODUCTION_VERSION     = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC     = 100%

OBSERVATION_WINDOW           = 601 seconds
CANDIDATE_INVOCATIONS        = 585

CANDIDATE_OUTCOMES           = {ok: 585} (100%)
CANDIDATE_ERRORS             = 0
CANDIDATE_EXCEPTIONS         = 0
CANDIDATE_CPU                = median 0ms / max 9ms
CANDIDATE_WALL                = median 1ms / max 9ms

HEALTH                       = PASS (200)
READINESS                    = PASS (200, truthfully not_ready/production_services_enabled=false)
PUBLIC_METADATA               = PASS (/, agent-card, jwks, /catalog, /openapi.json all 200)
MCP                          = PASS (discovery via official SDK client, 6 tools, 0 provider calls)

PAID_ROUTES                  = 12/12 disabled

PAYMENT_SIGNATURES           = 0
SETTLEMENTS                  = 0
TRANSACTIONS                 = 0
LIVE_PROVIDER_CALLS          = 0

POSTPROMOTION_PREFLIGHT      = PASS

KNOWN_GOOD_ROLLBACK_VERSION  = a4ada936-a434-4522-a8af-41c57170f4e4
ROLLBACK_VERIFICATION_STATUS = AUTHORITY RETAINED, NOT EXERCISED (not needed -- no threshold tripped)

R0_BLOCKERS                  = NONE
EXTERNAL_BLOCKERS            = NONE newly introduced by this checkpoint
R1_RELEASE_RISKS             = none of runtime-promotion scope; the pre-existing, already-documented
                                absence of a production paid-service executor (per SUN-1206) remains
                                the governing reason paid routes stay disabled -- unchanged by this
                                checkpoint, not a new finding

PAID_SERVICES_PRODUCTION_READY = NO
```

This is evidence for deciding what must happen next -- **not** a paid-activation
authorization packet. Per §35/§36 of the governing directive, the next
checkpoint (not performed here) must begin with a read-only, service-by-service
production capability inventory across all four service families (company
evidence graph, web context, document evidence, verify agent output) before any
paid-route activation flag is even considered.

## 15. Final classification

```
RUNTIME_PROMOTION_GATE = PASS
CANDIDATE_RUNTIME_PROMOTED = YES
FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%
PAID_SERVICES_PRODUCTION_READY = NO
PAID_ROUTES = DISABLED
ECONOMICS = DISABLED
```
