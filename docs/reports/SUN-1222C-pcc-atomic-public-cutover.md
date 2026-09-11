# SUN-1222C PCC Atomic Public Cutover

Date: 2026-09-11

Checkpoint: `SUN-1222C-PCC-ATOMIC-PUBLIC-CUTOVER-AUTHORIZATION`

Decision: **PASS**

## Scope and authority

Human authorization permitted one atomic production deployment change for
`siteborne-utility-edge`:

```text
FROM
db7054c9-76ee-4830-aabe-8a4542261b6a @100%
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @0%

TO
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @100%
db7054c9-76ee-4830-aabe-8a4542261b6a @0%
```

No mixed-nonzero canary was permitted. The baseline had to remain as the 0%
emergency restoration member, the paid runtime had to remain unchanged, and the
prebuilt quiescence version had to remain unassigned. The checkpoint did not
authorize any version upload, source/configuration mutation, paid-runtime
deployment, intentionally generated payment or provider execution, Workflow
creation, settlement, chain transaction, or mTLS activation.

Cloudflare documents a deployment as a set of Worker versions and percentage
allocations, and documents version overrides as selecting a version already in
the active deployment. Those contracts were used for the atomic deployment and
the final pre-cutover exact-version smoke:

- <https://developers.cloudflare.com/workers/versions-and-deployments/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>
- <https://developers.cloudflare.com/workers/observability/logs/real-time-logs/>

## Repository and source integrity

Immediately before the Cloudflare mutation:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=9f2ac4ebba92dd4a6d84b436aacc998e00eb5e2d
WORKING_TREE=CLEAN
PRIOR_EVIDENCE_COMMIT_EXISTS=YES
PRIOR_EVIDENCE_COMMIT_REACHABLE=YES
RUNTIME_SOURCE_AUTHORITY_EXISTS=YES
```

The prior evidence commit was `9f2ac4ebba92dd4a6d84b436aacc998e00eb5e2d`. The
qualified runtime source authority was
`8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb`. Changes from the runtime authority
through the pre-cutover HEAD were documentation-only; public runtime source,
dependencies, lockfiles, build inputs, schemas/contracts, and Wrangler
configuration had no drift.

Pinned Wrangler was `4.119.0`.

## Final pre-cutover state and gates

The immediately preceding public deployment was
`12f9c2c5-b275-4cfb-87ba-dcdbcae8e76e`:

```text
db7054c9-76ee-4830-aabe-8a4542261b6a @100%
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @0%
```

The paid runtime was and remained:

```text
d62011b9-6219-47e1-8cf9-5006776cfb50 @100%
```

The settlement-alert Worker was and remained:

```text
8fe32c69-d906-4369-9c0a-49b2cc406e8e @100%
```

The immutable quiescence version `d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1`
(version 63) existed and was not a member of the deployment. Preview URLs
remained disabled.

Immutable b6 readback reconfirmed the exact feature-scoped configuration:

```text
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=false
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=false
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=false
PAID_ROUTES_ENABLED=true
PRODUCTION_ENABLED=true
PAYMENT_ENVIRONMENT=production
MTLS_PRODUCTION_ACTIVE=absent/effective false
B6_IMMUTABLE_CONFIG_DRIFT=NO
```

The final exact-version b6 smoke passed. An authoritative JSON Tail correlated
each relevant `cf-ray` to b6. Health returned 200. Readiness returned the
schema-valid governed foundation response, with
`production_services_enabled=true` and only the known informational blockers
`ionos_dns_migration`, `nevermined_credentials`, and `registry_publication`.
Agent Card, JWKS, and JWS cryptographic verification passed; the public JWKS
contained one P-256/ES256 public key and no private scalar; mTLS was not
advertised. Catalog, MCP initialize/list, A2A discovery and the closed in-memory
no-free-use liveness path all passed. Company, document, and artifact ingress
returned 404 before state.

Fresh focused tests passed: five files and 44 tests covering settlement sole
ownership, seller identity determinism, paid-route mounting, A2A, and MCP.
Settlement ownership remained exactly:

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

Compatibility was reconfirmed from the accepted prior evidence:

```text
FEATURE_SCOPED_NEW_PUBLIC_PLUS_OLD_PAID=SAFE
ATOMIC_PUBLIC_CUTOVER_WITH_OLD_PAID_SAFE=YES
PRE_CUTOVER_BASELINE_QUOTE_SURVIVES_ATOMIC_CUTOVER=YES
NO_PRICE_RECALCULATION_ON_EXISTING_QUOTE=YES
NO_DUPLICATE_PAYMENT_OWNERSHIP_CHANGE=YES
EXISTING_BASELINE_MCP_SESSION_SURVIVES_ATOMIC_CUTOVER=YES
EXISTING_BASELINE_A2A_CLIENT_SURVIVES_ATOMIC_CUTOVER=YES
PRE_PAID_RUNTIME_ATOMIC_ROLLBACK_SAFE=YES
PERCENTAGE_CANARY_RETIRED=YES
```

## Pre-cutover observability and state

The D1 snapshot immediately before cutover was:

| Evidence           | Count | Latest timestamp           |
| ------------------ | ----: | -------------------------- |
| `payment_attempts` |    18 | `2026-09-08T13:05:49.043Z` |
| `x402_quotes`      |    73 | `2026-09-11T00:34:57.377Z` |
| `audit_events`     |   171 | `2026-09-11T00:34:57.424Z` |
| `jobs`             |    18 | `2026-09-08T13:05:49.043Z` |
| `job_state_events` |   158 | `2026-09-08T13:05:58.530Z` |
| `queue_dispatches` |     0 | none                       |

```text
PRE_ATOMIC_INFLIGHT_BY_STAGE={verified:16,settled_external:1}
PRE_ATOMIC_INFLIGHT_TOTAL=17
```

Cloudflare account analytics for historical request/4xx/5xx rates was not
available to the active OAuth scope, so those historical values are reported as
`UNAVAILABLE`, not zero. Critical rollback observability was nevertheless
complete: live JSON Tail supplied response, exception, `cf-ray`, and version
attribution; D1 supplied payment/Workflow/economic state; the settlement-alert
Worker supplied the governed settlement alert surface. The frozen restoration
command was already dry-run proven before mutation.

```text
PRE_ATOMIC_REQUEST_VOLUME=UNAVAILABLE
PRE_ATOMIC_BASELINE_5XX_RATE=UNAVAILABLE
PRE_ATOMIC_BASELINE_4XX_RATE=UNAVAILABLE
PRE_ATOMIC_RUNTIME_EXCEPTIONS=UNAVAILABLE
PRE_ATOMIC_MCP_FAILURES=UNAVAILABLE
PRE_ATOMIC_A2A_FAILURES=UNAVAILABLE
PRE_ATOMIC_PAYMENT_REQUIRED_VOLUME=1 (trailing-24h D1 audit evidence)
PRE_ATOMIC_PAYMENT_ATTEMPTS=18 total; 0 created in trailing 24h
PRE_ATOMIC_WORKFLOW_FAILURES=UNAVAILABLE
PRE_ATOMIC_PROVIDER_FAILURES=UNAVAILABLE
PRE_ATOMIC_SETTLEMENT_FAILURES=0 newly observed in tracked D1 window
PRE_ATOMIC_SETTLEMENT_ALERTS=UNAVAILABLE
ATOMIC_CUTOVER_CRITICAL_OBSERVABILITY_COMPLETE=YES
```

## Exact deployment and restoration commands

Both literal commands passed Wrangler 4.119.0 `--dry-run` before mutation.

Executed exactly once:

```bash
npx wrangler versions deploy \
  'b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@100%' \
  'db7054c9-76ee-4830-aabe-8a4542261b6a@0%' \
  --name siteborne-utility-edge \
  --message 'SUN-1222C atomic public cutover: qualified feature-scoped b6b7477f 100%; retain baseline db7054c9 0% for immediate pre-paid-runtime restore; percentage canary retired' \
  --yes
```

Prevalidated but not executed:

```bash
npx wrangler versions deploy \
  'db7054c9-76ee-4830-aabe-8a4542261b6a@100%' \
  'b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@0%' \
  --name siteborne-utility-edge \
  --message 'SUN-1222C atomic public restore: db7054c9 100%; b6b7477f 0%' \
  --yes
```

```text
ATOMIC_CUTOVER_DRY_RUN=PASS
ATOMIC_RESTORE_DRY_RUN=PASS
ATOMIC_CUTOVER_EXIT_CODE=0
WOULD_UPLOAD_NEW_VERSION=NO
WOULD_CHANGE_VARS=NO
WOULD_CHANGE_BINDINGS=NO
WOULD_CHANGE_SECRETS=NO
WOULD_CHANGE_ROUTES=NO
WOULD_CHANGE_CUSTOM_DOMAIN=NO
WOULD_CHANGE_PAID_RUNTIME=NO
```

The resulting deployment was:

```text
ATOMIC_PUBLIC_DEPLOYMENT_ID=037ae834-3b1e-4eae-b5c0-7befa09856c1
DEPLOYMENT_CREATED_AT=2026-09-11T11:58:11.996898Z
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @100%
db7054c9-76ee-4830-aabe-8a4542261b6a @0%
```

Immediate deployment readback was exact. The first post-deployment Tail sample
already showed b6, so no transitional baseline-serving edge was captured;
`PROPAGATION_WINDOW_OBSERVED=NO`. Repeated normal public requests proved the
eventual state. No normal request was attributed to baseline after propagation.

## Immediate normal-public contract smoke

Without any version-override header, the following all passed and were
tail-attributed to b6:

- `/health` returned HTTP 200;
- `/ready` returned HTTP 200 with the truthful known-blocker response;
- Agent Card and JWKS returned HTTP 200 and JWS verification passed;
- no `mutualTLS` scheme was advertised;
- `/catalog` reported verify and web enabled/ready at `0.017` and `0.008` USD;
- MCP initialize negotiated `2025-11-25` and tools/list returned six tools;
- A2A returned the governed closed `INPUT_REQUIRED/payment_required` result;
- company and document v2 execution routes returned 404; and
- document-artifact ingress returned 404.

The normal-public contract was:

```text
verify_agent_output.v2.price_atomic=17000
web_context_verified.v2.price_atomic=8000
scheme=exact
network=eip155:8453
asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
payTo=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
NORMAL_PUBLIC_PRICE_CONTRACT=PASS
COMPANY_FEATURE_LEAK=NO
DOCUMENT_FEATURE_LEAK=NO
ARTIFACT_FEATURE_LEAK=NO
```

No PaymentRequired state was created merely to re-prove prices; immutable b6
configuration, catalog/Agent Card metadata, source constants, and accepted
composition tests supplied the complete contract evidence.

## Governed stabilization

The required floors were frozen before mutation:

```text
ATOMIC_STABILIZATION_MIN_DURATION=60_MINUTES
ATOMIC_STABILIZATION_MIN_REQUESTS=1000_CANDIDATE_ATTRIBUTABLE_NORMAL_REQUESTS
```

The duration probe began with the deployment at `2026-09-11T11:58:11.996898Z`
and completed at `2026-09-11T12:58:30.071Z`:

```text
ATOMIC_STABILIZATION_ELAPSED=60_MINUTES_18.075_SECONDS
DURATION_MONITOR_REQUESTS=42
DURATION_MONITOR_HTTP_200=42
DURATION_MONITOR_NON_200=0
DURATION_MONITOR_NETWORK_ERRORS=0
```

The normal public sampler issued 1,275 additional requests across health,
readiness, catalog, Agent Card, OpenAPI, and MCP discovery surfaces. All 1,275
returned their expected status, with zero client-visible failures. Together with
the independent 42-request duration monitor, the window contained 1,317 normal
public client requests.

JSON Tail delivery was sampled conservatively. It delivered 1,075 complete
normal-request events during the governed interval. Every delivered event was
attributed to b6; none was attributed to baseline or another version. Those
1,075 events satisfy the candidate-attributable request floor without assuming
that undelivered sampled events succeeded.

```text
NORMAL_PUBLIC_REQUESTS_TOTAL=1317
B6_ATTRIBUTABLE_NORMAL_REQUESTS=1075
BASELINE_ATTRIBUTABLE_NORMAL_REQUESTS_AFTER_PROPAGATION=0
B6_STABILIZATION_REQUESTS=1075
B6_STABILIZATION_5XX=0
B6_STABILIZATION_5XX_RATE=0%
B6_RUNTIME_EXCEPTIONS=0
NORMAL_PUBLIC_REQUEST_ATTRIBUTED_TO_B6=YES
BASELINE_NORMAL_TRAFFIC_AFTER_PROPAGATION=0%
```

No hard failure condition fired during the required window. In particular, there
was no health, readiness, Agent Card, JWKS/JWS, mTLS, price, MCP, A2A,
feature-scope, topology, 5xx, runtime-exception, economic, Workflow, provider,
settlement, or observability hard failure.

An extended best-effort Tail was accidentally left attached beyond the required
interval. At `14:04:20Z` and twice at `16:38:50Z`, it delivered three organic
`/mcp` events from `node` clients with one exception each. All three were
b6-attributed with Worker `outcome=ok`; no HTTP 5xx was present. These were
outside the governed stabilization window and were not counted as successful
stabilization traffic. They were not hidden or promoted into an unsupported
claim. A bounded classification sent 20 valid initialize and 20 valid tools/list
requests: all 40 returned HTTP 200, were b6-attributed, and produced zero
exceptions. Final MCP initialize/list also passed. Thus no supported MCP
protocol regression, negotiation failure, or repeatable candidate-specific 5xx
was reproduced, and the prevalidated restoration threshold was not met.

## Final state and economic accounting

Final D1 readback exactly matched the pre-cutover aggregate snapshot:

| Evidence           | Before | After | Delta |
| ------------------ | -----: | ----: | ----: |
| `payment_attempts` |     18 |    18 |     0 |
| `x402_quotes`      |     73 |    73 |     0 |
| `audit_events`     |    171 |   171 |     0 |
| `jobs`             |     18 |    18 |     0 |
| `job_state_events` |    158 |   158 |     0 |
| `queue_dispatches` |      0 |     0 |     0 |

```text
POST_ATOMIC_INFLIGHT_BY_STAGE={verified:16,settled_external:1}
POST_ATOMIC_INFLIGHT_TOTAL=17

ORGANIC_ATOMIC_PAYMENT_AUTHORIZATIONS=UNKNOWN
ORGANIC_ATOMIC_PAYMENT_ATTEMPTS=0
ORGANIC_ATOMIC_WORKFLOW_CREATIONS=0
ORGANIC_ATOMIC_PROVIDER_EXECUTIONS=0
ORGANIC_ATOMIC_SETTLEMENTS=0

NO_DUPLICATE_PAYMENT_OWNERSHIP=YES
NO_DUPLICATE_PROVIDER_EXECUTION=YES
NO_SETTLEMENT_BEFORE_PROVIDER_SUCCESS=YES
NO_UNOWNED_SETTLEMENT=YES
ATOMIC_WINDOW_SETTLEMENT_ALERT_ANOMALIES=UNKNOWN
```

The organic state-changing counts are zero because every tracked payment, quote,
audit, Workflow/job, state-event, and dispatch aggregate and latest timestamp
remained identical; they are not inferred merely from an absence of HTTP errors.
The number of authorization headers submitted by unrelated callers and the
number of settlement-alert notifications emitted were not available to the
active read scope, so those two values remain `UNKNOWN`.

Final Cloudflare readback:

```text
PUBLIC_NORMAL_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
PUBLIC_NORMAL_TRAFFIC=100%
PUBLIC_ROLLBACK_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_ROLLBACK_TRAFFIC=0%
PAID_RUNTIME=d62011b9-6219-47e1-8cf9-5006776cfb50 @100%
SETTLEMENT_ALERT_WORKER=8fe32c69-d906-4369-9c0a-49b2cc406e8e @100%
QUIESCENCE_VERSION=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
QUIESCENCE_VERSION_STATUS=UNASSIGNED
LIVE_PREVIEW_URLS_ENABLED=NO
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
```

Mutation and checkpoint-generated economic accounting:

```text
PRODUCTION_DEPLOYMENT_MUTATIONS=1
TRAFFIC_PERCENTAGE_MUTATIONS=1
VERSION_UPLOADS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
CUSTOM_DOMAIN_MUTATIONS=0
DNS_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
QUIESCENCE_VERSION_DEPLOYMENT_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0

CHECKPOINT_GENERATED_REAL_PAYMENTS=0
CHECKPOINT_GENERATED_PAYMENT_AUTHORIZATIONS=0
CHECKPOINT_GENERATED_USEFUL_PROVIDER_EXECUTIONS=0
CHECKPOINT_GENERATED_WORKFLOW_CREATIONS=0
CHECKPOINT_GENERATED_SETTLEMENTS=0
CHECKPOINT_GENERATED_CHAIN_TRANSACTIONS=0
CHECKPOINT_GENERATED_ECONOMIC_EFFECT_USDC=0
```

The emergency restore command was not executed. The 17 governed nonterminal rows
do not invalidate the public-only cutover, but they continue to prohibit a
paid-runtime deployment. The paid runtime remains unauthorized for deployment.

## Decision

```text
SUN1222C_PCC_ATOMIC_PUBLIC_CUTOVER_AUTHORIZATION=PASS
CANDIDATE_QUALIFICATION_AND_STABILIZATION=PASS
ATOMIC_PUBLIC_RESTORE_EXECUTED=NO
PAID_RUNTIME_DEPLOY_AUTHORIZED=NO
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-QUIESCENCE-QUALIFY-PROMOTE-AND-DRAIN
```

This decision authorizes no next-stage mutation. The next checkpoint must
separately authorize replacing the 0% baseline member with quiescence at 0%,
exact-version qualification, quiescence promotion, and a zero-inflight drain.
Only after those steps could a paid-runtime deployment be considered.
