# SUN-1210 Checkpoint P2 — observability attribution and zero-traffic smoke

Date: 2026-08-22

Classification: pre-deployment attribution block; production remained contained

SUN-1210 P2 stopped at its mandatory pre-deployment authorization gate. The
Cloudflare Workers Observability telemetry endpoints were reachable, but the
existing Wrangler OAuth identity was not authorized to query them. No
calibration request was accepted as attributable evidence, no temporary
two-version deployment was created, and no candidate request was sent.

```text
AUTHORITATIVE_ATTRIBUTION_CHANNEL = UNAVAILABLE
ZERO_TRAFFIC_EDGE_SMOKE_GATE = ATTRIBUTION_BLOCK
VERSION_OVERRIDE_ATTRIBUTION = NOT_ATTEMPTED
CANDIDATE_EDGE_SMOKE = NOT_ATTEMPTED
PUBLIC_CANARY_AUTHORIZATION_ELIGIBLE = NO

CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC = 0
CANDIDATE_PREVIEW_ROUTABLE = NO

PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
PRODUCTION_TRAFFIC = 100%
```

This result does not establish a candidate runtime failure. It establishes that
the required Ray-ID-to-`scriptVersion.id` evidence cannot be obtained with the
currently authorized operator identity. The successful SUN-1208 source
qualification and SUN-1209 upload chain of custody remain frozen and unchanged.

## Starting authority

```text
START_HEAD = 2b147800e43f51ffc18e4d6bb5803ebb77e701c6
START_WORKING_TREE = CLEAN
DISK_FREE = 44 GiB
WRANGLER_VERSION = 4.119.0

RUNTIME_CANDIDATE_SHA = e5d061e2e9c908244f807cf0cf141ab308575496
RUNTIME_BUNDLE_SHA256 = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

CURRENT_DEPLOYMENT_ID = 5b34c7b2-51f9-48b5-858f-429ba74f316d
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%
```

Read-only Cloudflare reconciliation returned a one-version active deployment:

| Version                                | Normal traffic | Active deployment status |
| -------------------------------------- | -------------: | ------------------------ |
| `a4ada936-a434-4522-a8af-41c57170f4e4` |           100% | included                 |
| `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` |             0% | not included             |

The Worker subdomain remained enabled while versioned and aliased previews
remained disabled:

```text
workers_dev = true
preview_urls = false
Cloudflare previews_enabled = false
```

Candidate metadata remained exact and read-only:

```text
candidate version number = 21
compatibility_date = 2026-08-05
compatibility_flags = nodejs_compat
NVM_ENVIRONMENT = sandbox
required secret bindings = 4/4 present by name
stale economic activation vars = absent
CANDIDATE_IDENTITY_DRIFT = NONE
```

Required secret names remained present. No value was retrieved, displayed,
hashed, compared, or persisted:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
NVM_API_KEY
```

All live, registration, payment, probe, partial-balance, and recovery guards
checked for this checkpoint were absent. Production preflight passed before the
observability authorization test. Bounded, credential-free production probes
returned:

```text
12/12 paid routes = HTTP 404
GET /mcp = HTTP 405
PRODUCTION_PREFLIGHT_BEFORE = PASS
```

One initial local route-probe shell invocation used zsh's read-only special
parameter name `status` and failed before producing usable loop output. The
complete bounded matrix was then run with a safe variable name and produced the
results above. No request carried payment, authorization, provider, or
settlement material.

## Prior failure

SUN-1210 P stopped because two candidate-override `GET /health` responses were
healthy but could not be attributed to the candidate. A
`wrangler tail --version-id` session did not provide a trustworthy
version-isolation guarantee for that workflow. P2 therefore did not assume that
the override failed and did not change candidate code. Its first hard gate was
to establish an independent, authoritative Ray-ID lookup channel.

## Intended attribution mechanism

Cloudflare documents the temporary telemetry query endpoint as:

```text
POST /accounts/{account_id}/workers/observability/telemetry/query
view = invocations
```

The documented invocation shape can expose:

```text
$metadata.rayId
$metadata.service
$metadata.statusCode
$workers.scriptVersion.id
$workers.outcome
$workers.cpuTimeMs
$workers.wallTimeMs
```

The companion key-discovery endpoint is:

```text
POST /accounts/{account_id}/workers/observability/telemetry/keys
```

Official authority used for the query design:

- <https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/>
- <https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/keys/>
- <https://developers.cloudflare.com/workers/observability/query-builder/>

A disposable local helper read the existing Wrangler OAuth credential only in
memory, sent the two read-only API requests, printed no credential or raw event
payload, and retained only non-secret counters. It did not mutate Cloudflare or
the repository.

## Authorization result

The endpoint itself was reachable. Both permitted read-only attempts were
rejected before telemetry data was returned:

| Attempt                          | Endpoint                                 | HTTP result | Cloudflare result      |
| -------------------------------- | ---------------------------------------- | ----------: | ---------------------- |
| key discovery                    | `/workers/observability/telemetry/keys`  |         403 | `Authentication error` |
| harmless recent invocation query | `/workers/observability/telemetry/query` |         403 | `Authentication error` |

```text
OBSERVABILITY_QUERY_API_REACHABLE = YES
OBSERVABILITY_QUERY_AUTHORIZED = NO
OBSERVABILITY_KEYS_API_REACHABLE = YES
OBSERVABILITY_KEYS_AUTHORIZED = NO

OBSERVABILITY_RAY_ID_FIELD = NOT_DISCOVERED_LIVE
OBSERVABILITY_SERVICE_FIELD = NOT_DISCOVERED_LIVE
OBSERVABILITY_SCRIPT_VERSION_FIELD = NOT_DISCOVERED_LIVE
```

The field names listed in the previous section are Cloudflare's documented
schema, not a claim that this operator observed them in a live response.

`wrangler whoami` confirmed that the authenticated identity targets the correct
account and Worker account. It uses an OAuth token and exposes Worker, script,
tail, route, D1, queue, and other scopes, but it does not expose a Workers
Observability scope. Cloudflare's current telemetry endpoint documentation
identifies `Workers Observability Write` as the accepted permission for these
requests.

No alternate Cloudflare token, key, or email credential was present in the
process environment under the conventional Wrangler/Cloudflare variable names.
No token value was printed or copied.

```text
EXTERNAL_ATTRIBUTION_PREREQUISITE = an approved Cloudflare operator credential
  for account 29a264a25ccfd13882defe49ed3e17b1 with Workers Observability Write
  permission, usable for the telemetry keys/query endpoints
```

Creating a token, changing OAuth permissions, enabling telemetry, adding a
version-metadata binding, or deploying observability configuration was not
authorized by P2 and was not performed.

## Calibration

The directive required both telemetry reachability and authorization before
issuing the known-good calibration requests. Because authorization failed:

```text
CALIBRATION_REQUESTS = 0
CALIBRATION_RAY_IDS = NONE
KNOWN_GOOD_RAY_ATTRIBUTION = NOT_ATTEMPTED
KNOWN_GOOD_RAY_ATTRIBUTION_REPRODUCIBLE = NOT_ATTEMPTED
TELEMETRY_INGESTION_LATENCY = NOT_MEASURED
```

No timing, body, deployment percentage, tail session, or upload timestamp was
substituted for authoritative attribution.

## Deployment and candidate smoke disposition

The hard gate failed before Deployment A. Therefore the two-version deployment
was not recreated and mandatory restoration was not needed: production was
already and remained in the restored, known-good-only state.

| Area                            | P2 result     | Reason                                    |
| ------------------------------- | ------------- | ----------------------------------------- |
| Deployment A                    | not executed  | attribution query unauthorized            |
| candidate `/health`             | not requested | deployment gate not opened                |
| ordinary-traffic attribution    | not requested | deployment gate not opened                |
| candidate readiness             | not tested    | attribution block                         |
| candidate public metadata       | not tested    | attribution block                         |
| 12 candidate paid routes        | not tested    | attribution block                         |
| candidate MCP                   | not tested    | attribution block                         |
| candidate error boundaries      | not tested    | attribution block                         |
| candidate telemetry/performance | not assessed  | no attributable invocation                |
| Deployment B                    | not required  | candidate never entered active deployment |
| post-restoration override       | not requested | no P2 deployment occurred                 |

```text
VERSION_OVERRIDE_ATTRIBUTION = NOT_ATTEMPTED
CANDIDATE_REMOTE_PAID_ROUTES_DISABLED = NOT_RETESTED_REMOTELY
CANDIDATE_REMOTE_PAYMENT_CHALLENGES = 0
CANDIDATE_REMOTE_PROVIDER_CALLS = 0
CANDIDATE_MCP_BOUNDARY = NOT_RETESTED_REMOTELY
CANDIDATE_EDGE_ERROR_BOUNDARIES = NOT_TESTED
CANDIDATE_SMOKE_PERFORMANCE = NOT_ASSESSED
```

## Production containment

The checkpoint stopped without changing Cloudflare state:

```text
CURRENT_DEPLOYMENT_ID = 5b34c7b2-51f9-48b5-858f-429ba74f316d
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%

CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC = 0
CANDIDATE_PREVIEW_ROUTABLE = NO

VERSION_PREVIEW_ROUTING = DISABLED
ALIAS_PREVIEW_ROUTING = DISABLED
FINAL_PAID_ROUTE_STATE = 12/12 DISABLED
FINAL_MCP_ROUTE_STATE = GOVERNED
```

The inherited release evidence remains unchanged:

```text
SUN1208_FULL_REGRESSION = PASS
SUN1208_WORKER_RUNTIME = 66/66 PASS
SUN1208_SECURITY_RELEASE = PASS
SUN1209_UPLOAD_GATE = PASS
POSTUPLOAD_PREFLIGHT = PASS
```

## Mutation and request accounting

```text
OBSERVABILITY_KEY_DISCOVERY_REQUESTS = 1
OBSERVABILITY_QUERIES = 1
CALIBRATION_REQUESTS = 0
CANDIDATE_OVERRIDE_SMOKE_REQUESTS = 0
ATTRIBUTED_CANDIDATE_REQUESTS = 0
ATTRIBUTED_KNOWN_GOOD_REQUESTS = 0

VERSION_UPLOADS = 0
WORKER_VERSIONS_CREATED = 0
SECRET_CREATES_OR_UPDATES = 0
DEPLOYMENTS = 0
NORMAL_TRAFFIC_SHIFTS_TO_CANDIDATE = 0
MAX_NORMAL_CANDIDATE_TRAFFIC_PERCENT = 0
PREVIEW_CONFIG_CHANGES = 0
PAID_ROUTE_CHANGES = 0
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
```

## Final gate and exact next prerequisite

```text
AUTHORITATIVE_ATTRIBUTION_CHANNEL = UNAVAILABLE
ZERO_TRAFFIC_EDGE_SMOKE_GATE = ATTRIBUTION_BLOCK
PUBLIC_CANARY_AUTHORIZATION_ELIGIBLE = NO
```

The smallest next action is external authorization/provisioning only: provide an
approved operator credential for the correct Cloudflare account with the
permission required to execute Workers Observability telemetry key and query
requests. After that credential is available, rerun P2 from calibration; do not
skip directly to Deployment A or a public canary.

P2 does not authorize creating that credential or changing its permissions.
