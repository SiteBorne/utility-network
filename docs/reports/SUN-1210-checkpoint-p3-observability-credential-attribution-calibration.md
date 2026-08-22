# SUN-1210 Checkpoint P3 — observability credential and attribution calibration

Date: 2026-08-22

Classification: credential provisioning and known-good attribution calibration;
zero deployment and zero candidate execution

SUN-1210 P3 established an authoritative Cloudflare Workers Observability
attribution channel. Two independent ordinary `GET /health` requests were
correlated by exact Cloudflare Ray ID to the currently serving Worker version:

```text
AUTHORITATIVE_ATTRIBUTION_CHANNEL = AVAILABLE
OBSERVABILITY_KEYS_AUTHORIZED = YES
OBSERVABILITY_QUERY_AUTHORIZED = YES
KNOWN_GOOD_RAY_ATTRIBUTION = PASS
KNOWN_GOOD_RAY_ATTRIBUTION_REPRODUCIBLE = YES
ZERO_TRAFFIC_SMOKE_RETRY_ELIGIBLE = YES
PUBLIC_CANARY_AUTHORIZATION_ELIGIBLE = NO
```

No candidate deployment, version override, candidate request, upload, Worker
configuration mutation, provider invocation, payment, settlement, or economic
activity occurred.

## Prior authorization block

SUN-1210 P2 stopped before deployment because the existing Wrangler OAuth
identity received HTTP 403 from both Workers Observability telemetry endpoints.
That result was an external authorization block, not a candidate failure.

P3 provisioned a user-owned Custom API Token scoped to the exact SITEBORNE
Cloudflare account with one permission:

```text
Workers Observability Write
```

Cloudflare's dashboard renders that permission as
`Workers Observability:Edit`. No additional account, zone, Worker-script,
route, tail, analytics, API-token-management, or storage permission was
granted.

## Credential provisioning and date-boundary recovery

The first token used the reviewed one-day date range. Cloudflare created it
with an authoritative future activation constraint:

```text
not_before = 2026-08-23T00:00:00Z
expires_on = 2026-08-23T23:59:59Z
```

The dashboard accepted one explicitly authorized activation-only edit and
displayed `Token has been updated`, but two bounded verification reads showed
that `not_before` remained unchanged. The token was not rolled, deleted, or
used for telemetry.

The operator then explicitly authorized one additional immediately usable
token. It retained the same account and sole permission, omitted a future start
date, and used the shortest practical same-day expiration:

```text
token name = SITEBORNE SUN-1210 P3 Observability Attribution Immediate
status = active
not_before = absent
expires_on = 2026-08-22T23:59:59Z
Cloudflare verification = This API Token is valid and active
```

The credential value was never printed, logged, hashed, committed, placed in a
command-line argument, or written to a regular file. It was moved from the
one-time dashboard view to each authorized process through a mode-`0600`
one-shot FIFO and existed only in memory while requests ran. The FIFO carried
bytes transiently and was removed after each use. Token values are absent from
this report.

```text
CLOUDFLARE_API_TOKENS_CREATED = 2
CLOUDFLARE_API_TOKENS_EDITED = 1
CLOUDFLARE_API_TOKENS_ROLLED = 0
CLOUDFLARE_API_TOKENS_DELETED = 0
OBSERVABILITY_TOKEN_ACCOUNT_SCOPE = EXPECTED_SITEBORNE_ACCOUNT_ONLY
OBSERVABILITY_TOKEN_PERMISSION = Workers Observability Write
OBSERVABILITY_TOKEN_ADDITIONAL_PERMISSIONS = []
ZONE_PERMISSIONS = NONE
CLIENT_IP_FILTER = NONE
```

The original future-dated token remains unmodified after the ineffective edit.
The immediately usable token is retained only in the approved private
in-memory operator session for the immediately following P4 attempt and expires
at the timestamp above. P4 must reconcile or revoke the temporary credential
after restoration.

The final credential-stripped repository scan covered 1,050 tracked files,
9,353,565 tracked bytes, 167 commits, and the working directory. Both history
and directory scans returned no leaks:

```text
OBSERVABILITY_TOKEN_LEAKS = 0
SECRET_LEAKS = 0
SECRETS_SCAN = PASS
```

## API authorization

The live API authorization results were:

| Endpoint | Method | Result |
| --- | --- | --- |
| `/workers/observability/telemetry/keys` | `POST` | HTTP 2xx; authorized |
| `/workers/observability/telemetry/query` | `POST` | HTTP 2xx; authorized |

One key-discovery request made with the first future-dated token returned HTTP
401 before it became usable. The active replacement then completed the
authorized key discovery successfully. A narrow recent-invocation query also
succeeded; it returned zero recent events and established query authorization
without creating or saving a query object.

```text
OBSERVABILITY_KEYS_API_REACHABLE = YES
OBSERVABILITY_KEYS_AUTHORIZED = YES
OBSERVABILITY_QUERY_API_REACHABLE = YES
OBSERVABILITY_QUERY_AUTHORIZED = YES
```

## Live attribution fields

The telemetry key-discovery endpoint returned 106 current keys. The fields used
for release attribution were recovered from the live response rather than
assumed from documentation:

```text
OBSERVABILITY_RAY_ID_FIELD = $workers.event.request.headers.cf-ray
OBSERVABILITY_SERVICE_FIELD = $metadata.service
OBSERVABILITY_SCRIPT_VERSION_FIELD = $workers.scriptVersion.id
OBSERVABILITY_OUTCOME_FIELD = $workers.outcome
OBSERVABILITY_CPU_FIELD = $workers.cpuTimeMs
OBSERVABILITY_WALL_FIELD = $workers.wallTimeMs
OBSERVABILITY_ERROR_FIELD = $metadata.error
OBSERVABILITY_STATUS_FIELD = unavailable in the discovered recent key set
```

The bounded helper fails closed for zero matches, multiple ambiguous matches,
wrong service, missing ScriptVersion, or a wrong version. It sends only
read-only ad-hoc key/query operations and never creates a saved query,
destination, tail, log configuration, or observability configuration.

## Ingestion policy

Calibration used a maximum of 12 telemetry-query attempts per Ray ID with a
three-second interval and a nominal 33-second inter-attempt wait ceiling. API
round-trip time is additional. Polling stopped immediately when one exact
match appeared.

```text
ATTRIBUTION_MAX_QUERY_ATTEMPTS = 12
ATTRIBUTION_POLL_INTERVAL_MS = 3000
ATTRIBUTION_MAX_INTER_ATTEMPT_WAIT_MS = 33000
```

## Calibration 1

```text
request = GET https://utility.siteborne.net/health
HTTP status = 200
Ray ID = a2f44dc0da03813a
telemetry match count = 1
service = siteborne-utility-edge
scriptVersion.id = a4ada936-a434-4522-a8af-41c57170f4e4
outcome = ok
CPU time = 6 ms
wall time = 6 ms
query attempts = 6
ingestion latency = 17724 ms
KNOWN_GOOD_RAY_ATTRIBUTION_1 = PASS
```

## Calibration 2

```text
request = GET https://utility.siteborne.net/health
HTTP status = 200
Ray ID = a2f44f9d4d83bd59
telemetry match count = 1
service = siteborne-utility-edge
scriptVersion.id = a4ada936-a434-4522-a8af-41c57170f4e4
outcome = ok
CPU time = 12 ms
wall time = 12 ms
query attempts = 7
ingestion latency = 21225 ms
KNOWN_GOOD_RAY_ATTRIBUTION_2 = PASS
```

The two Ray IDs are distinct. Each independently returned one unambiguous
invocation for the expected Worker service and the same known-good version.
No timing, response-body similarity, deployment percentage, or tail-session
identity was substituted for `scriptVersion.id` evidence.

## Production reconciliation

Wrangler's existing operator identity was refreshed through a read-only
deployment listing. Final Cloudflare reconciliation returned:

```text
CURRENT_DEPLOYMENT_ID = 5b34c7b2-51f9-48b5-858f-429ba74f316d
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%

CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC = 0
CANDIDATE_PREVIEW_ROUTABLE = NO

workers_dev = true
Cloudflare previews_enabled = false
candidate compatibility_date = 2026-08-05
candidate NVM_ENVIRONMENT = sandbox
candidate required secret bindings = 4/4 present by name
```

Required Worker secret names remained present. No value was retrieved:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
NVM_API_KEY
```

The final bounded production probes returned:

```text
12/12 paid routes = HTTP 404
GET /mcp = HTTP 405
PRODUCTION_PREFLIGHT = PASS
```

One initial local route-probe loop reused zsh's read-only `status` parameter
and stopped after the first harmless paid-route GET. The complete matrix was
then rerun with task-specific variable names and produced the results above.
No request carried payment, authorization, provider, or settlement material.

## Request and mutation accounting

The local helper counter includes three pre-network transport attempts and the
two key-discovery endpoint responses described above. Confirmed Cloudflare
Observability request accounting is recorded separately:

```text
TELEMETRY_HELPER_KEY_DISCOVERY_ATTEMPTS = 5
OBSERVABILITY_KEY_DISCOVERY_HTTP_RESPONSES = 2
OBSERVABILITY_KEY_DISCOVERY_SUCCESSFUL = 1
OBSERVABILITY_QUERIES = 14
CALIBRATION_REQUESTS = 2
ATTRIBUTED_KNOWN_GOOD_REQUESTS = 2
CANDIDATE_REQUESTS = 0
VERSION_OVERRIDE_REQUESTS = 0

VERSION_UPLOADS = 0
WORKER_VERSIONS_CREATED = 0
SECRET_CREATES_OR_UPDATES = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
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

API-token creation and the one activation-only token edit are the only
Cloudflare security mutations in P3. They are intentionally counted separately
from Worker secrets and Worker/runtime mutations.

## Final P3 classification

```text
AUTHORITATIVE_ATTRIBUTION_CHANNEL = AVAILABLE
OBSERVABILITY_QUERY_AUTHORIZED = YES
OBSERVABILITY_KEYS_AUTHORIZED = YES
KNOWN_GOOD_RAY_ATTRIBUTION = PASS
KNOWN_GOOD_RAY_ATTRIBUTION_REPRODUCIBLE = YES
ZERO_TRAFFIC_SMOKE_RETRY_ELIGIBLE = YES
PUBLIC_CANARY_AUTHORIZATION_ELIGIBLE = NO
```

P3 does not establish candidate safety and does not authorize a public canary.
The exact next checkpoint is SUN-1210 P4: temporarily place the frozen candidate
in a 100% known-good / 0% candidate deployment, attribute every material
version-override request through the proven Ray-ID telemetry channel, restore
known-good-only 100% regardless of outcome, and reconcile/revoke the temporary
observability credential after restoration.
