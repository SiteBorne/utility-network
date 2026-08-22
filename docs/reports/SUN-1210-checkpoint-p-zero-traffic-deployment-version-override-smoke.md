# SUN-1210 Checkpoint P — zero-traffic deployment and version-override smoke

Date: 2026-08-22

Classification: controlled production-edge smoke attempt; fail-closed before
candidate service probing

SUN-1210 created the two explicitly authorized deployment configurations and
ended safely restored to the known-good version. The candidate returned two
healthy HTTP responses while a version-override header was present, but
Cloudflare version attribution was not proven. The candidate smoke matrix was
therefore stopped before readiness, metadata, paid-route, MCP, error-boundary,
provider, or economic requests were sent to the candidate.

```text
ZERO_TRAFFIC_EDGE_SMOKE_GATE = FAIL
CANDIDATE_EDGE_SMOKE = FAIL
PUBLIC_CANARY_AUTHORIZATION_ELIGIBLE = NO

VERSION_OVERRIDE_ATTRIBUTION = NOT_PROVEN
CANDIDATE_REMOTE_PAID_ROUTES = NOT_TESTED
CANDIDATE_MCP_BOUNDARY = NOT_TESTED

CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC = 0
CANDIDATE_PREVIEW_ROUTABLE = NO

PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
PRODUCTION_TRAFFIC = 100%
```

The result does not reopen SUN-1208 source qualification or SUN-1209 upload
chain of custody. It does block any public canary because the required edge
execution evidence is incomplete.

## Starting state

```text
SUN1210_START_HEAD = bc164a06a3e9a681315884a04bbb922f29aaf651
RUNTIME_CANDIDATE_SHA = e5d061e2e9c908244f807cf0cf141ab308575496
RUNTIME_BUNDLE_SHA256 = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

START_DEPLOYMENT_ID = a85d3b6c-8cc2-4e6e-baf0-a81158a80be6
KNOWN_GOOD_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
START_PRODUCTION_TRAFFIC = 100%

WORKING_TREE = CLEAN
DISK_FREE = 45 GiB
WRANGLER_VERSION = 4.119.0
```

The pinned Wrangler help accepted the non-interactive deployment syntax:

```text
wrangler versions deploy <version>@<percentage>% ... -y
```

Current Cloudflare documentation independently states that a deployment may
contain two versions, that a version may receive zero percent of ordinary
traffic, and that a version override applies only to a version included in the
active deployment:

- <https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/>
- <https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-deploy>

### Candidate identity

Read-only candidate metadata remained exact:

```text
version = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
version number = 21
compatibility_date = 2026-08-05
compatibility_flags = nodejs_compat
NVM_ENVIRONMENT = sandbox
required secrets = 4/4 present by name
stale economic activation vars = absent
candidate preview = HTTP 404
CANDIDATE_IDENTITY_DRIFT = NONE
```

The required secret-name inventory was unchanged. No value was retrieved:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
NVM_API_KEY
```

Cloudflare reported 21 Worker versions, `workers_dev` enabled, and version and
alias previews disabled. Production preflight passed. All 12 paid routes
returned HTTP 404 and `GET /mcp` returned HTTP 405.

## Baseline

A bounded known-good comparison used the canonical MCP protocol version
`2026-07-28` recovered from repository source:

| Request          |                                       Status | Client elapsed |
| ---------------- | -------------------------------------------: | -------------: |
| `GET /health`    |                                          200 |      77.056 ms |
| `GET /ready`     | 200 (`not_ready`, governed foundation state) |      22.185 ms |
| MCP `tools/list` |                      200, six governed tools |      53.092 ms |

An earlier disposable baseline request used the superseded protocol string
`2025-06-18`. Production rejected it with HTTP 400 and an explicit supported
version of `2026-07-28`. The request performed no service, provider, storage,
payment, or economic work. The local harness was corrected before Deployment A;
the repository was not changed.

```text
PRE_SMOKE_BASELINE = PASS
PRODUCTION_PREFLIGHT_BEFORE = PASS
PRE_SMOKE_PAID_ROUTES = 12/12 HTTP 404
PRE_SMOKE_MCP_GET = HTTP 405
```

## Deployment A

Exactly one temporary two-version deployment command was executed:

```bash
pnpm exec wrangler versions deploy \
  a4ada936-a434-4522-a8af-41c57170f4e4@100% \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@0% \
  --name siteborne-utility-edge \
  --message "SUN-1210 zero-traffic candidate smoke" \
  -y
```

Wrangler reported success. Immediate authoritative read-back returned:

```text
SMOKE_DEPLOYMENT_RESULT = SUCCESS
SMOKE_DEPLOYMENT_ID = 9ed7c312-17b2-45b5-ae15-8f3fc71fcb25

a4ada936-a434-4522-a8af-41c57170f4e4 = 100%
f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce = 0%

KNOWN_GOOD_TRAFFIC = 100%
CANDIDATE_TRAFFIC = 0%
CANDIDATE_IN_ACTIVE_DEPLOYMENT = YES
NORMAL_TRAFFIC_SHIFT = 0
```

The command synchronized the already-governed observability settings
(`enabled=true`, head sampling rate `1`) as part of the deployment. It created
no Worker version and changed no secret, binding, route, preview policy, or
economic flag.

## Attribution attempt

Two `wrangler tail` sessions were opened, one requested with candidate version
ID `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` and one with known-good version ID
`a4ada936-a434-4522-a8af-41c57170f4e4`. A first attempt to pass
`--sampling-rate 1` was rejected locally by Wrangler before a connection was
opened; omitting the flag opened both tails without mutation.

The exact version override header was:

```http
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce"
```

Only two pre-restoration override requests were sent, both harmless
`GET /health` calls:

| Attempt | HTTP | Client elapsed | Cloudflare Ray     | Candidate `ScriptVersion.id` observed? |
| ------- | ---: | -------------: | ------------------ | -------------------------------------- |
| 1       |  200 |     752.366 ms | `a2f3dd3c8d33b019` | no                                     |
| 2       |  200 |     528.115 ms | `a2f3de72fc219948` | no                                     |

Both responses contained a valid health body. Neither is accepted as candidate
evidence because response content alone does not identify the executing Worker
version.

No candidate event appeared in either tail within the bounded attribution
window. Post-restoration evidence then demonstrated that the requested CLI
version filter could not be treated as an isolation guarantee: the tail opened
with the candidate `--version-id` emitted the same post-restoration event as the
known-good tail, and the event itself authoritatively identified:

```text
scriptVersion.id = a4ada936-a434-4522-a8af-41c57170f4e4
outcome = ok
exceptions = 0
cpuTime = 6 ms
wallTime = 8 ms
```

The event also retained the candidate override header, proving that after
restoration the header was received but ignored because the candidate was no
longer in the active deployment. This matches Cloudflare's documented override
contract. It does not retrospectively attribute either pre-restoration health
response.

```text
VERSION_OVERRIDE_ATTRIBUTION = NOT_PROVEN
CANDIDATE_HEALTH_RESPONSE = 2/2 HTTP 200, UNATTRIBUTED
```

The directive required positive candidate attribution before continuing.
Restoration therefore began immediately. No candidate readiness, metadata,
paid-route, MCP, malformed-input, oversized-input, provider, or economic request
was sent.

## Candidate smoke disposition

| Area                       | Result          | Reason                                                |
| -------------------------- | --------------- | ----------------------------------------------------- |
| candidate health           | unaccepted      | two healthy responses, but version attribution absent |
| candidate readiness        | not tested      | stop boundary reached                                 |
| candidate public metadata  | not tested      | stop boundary reached                                 |
| 12 candidate paid routes   | not tested      | stop boundary reached before any paid path            |
| candidate MCP              | not tested      | stop boundary reached                                 |
| candidate error boundaries | not tested      | stop boundary reached                                 |
| candidate logs/exceptions  | not established | no positively attributed candidate event              |
| candidate performance      | not assessed    | timings were unattributed                             |

```text
CANDIDATE_REMOTE_PAID_ROUTES_DISABLED = NOT_PROVEN_REMOTELY
CANDIDATE_REMOTE_PAYMENT_CHALLENGES = 0
CANDIDATE_REMOTE_PROVIDER_CALLS = 0
CANDIDATE_MCP_UNAUTH_PROVIDER_CALL_RISK = NOT_RETESTED_REMOTELY
CANDIDATE_MCP_UNAUTH_LIVE_SERVICE_EXECUTION = NOT_RETESTED_REMOTELY
CANDIDATE_EDGE_ERROR_BOUNDARIES = NOT_TESTED
CANDIDATE_SMOKE_PERFORMANCE = NOT_ASSESSED
```

The accepted local frozen evidence remains unchanged:

```text
SUN1208_FULL_REGRESSION = PASS
SUN1208_WORKER_RUNTIME = 66/66 PASS
SUN1208_SECURITY_RELEASE = PASS
SUN1209_UPLOAD_GATE = PASS
```

Those results are not substituted for the missing SUN-1210 edge evidence.

## Deployment B — mandatory restoration

The already-authorized restoration was executed immediately after attribution
failed:

```bash
pnpm exec wrangler versions deploy \
  a4ada936-a434-4522-a8af-41c57170f4e4@100% \
  --name siteborne-utility-edge \
  --message "SUN-1210 restore known-good after zero-traffic smoke" \
  -y
```

Wrangler succeeded and authoritative deployment read-back returned:

```text
RESTORATION_DEPLOYMENT_ID = 5b34c7b2-51f9-48b5-858f-429ba74f316d

a4ada936-a434-4522-a8af-41c57170f4e4 = 100%
candidate version = absent from active deployment

CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC = 0
CURRENT_PRODUCTION_TRAFFIC = 100%
```

## Post-restoration containment

One harmless post-restoration `GET /health` carried the candidate override
header. It returned HTTP 200 and the real-time event identified the executing
version as the known-good version, not the candidate:

```text
Cloudflare Ray = a2f3dfebb9f8529e
scriptVersion.id = a4ada936-a434-4522-a8af-41c57170f4e4
CANDIDATE_OVERRIDE_REACHABLE_AFTER_RESTORE = NO
```

Final Cloudflare state:

```text
CURRENT_DEPLOYMENT_ID = 5b34c7b2-51f9-48b5-858f-429ba74f316d
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%

CANDIDATE_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CANDIDATE_DISPOSITION = UPLOADED / NOT_IN_ACTIVE_DEPLOYMENT / TRAFFIC_0

WORKER_VERSION_TOTAL = 21
WORKER_VERSIONS_CREATED_THIS_CHECKPOINT = 0

Cloudflare previews_enabled = false
CANDIDATE_PREVIEW_HEALTH = HTTP 404
CANDIDATE_PREVIEW_ROUTABLE = NO
VERSION_PREVIEW_ROUTING = DISABLED
ALIAS_PREVIEW_ROUTING = DISABLED
```

Final bounded production checks:

```text
GET /health = 200
GET /ready = 200
GET /mcp = 405
12/12 paid routes = 404

FINAL_PAID_ROUTE_STATE = 12/12 DISABLED
FINAL_MCP_ROUTE_STATE = GOVERNED
CURRENT_PRODUCTION_CUSTOMER_EXPOSURE = KNOWN_GOOD_ONLY
POST_SMOKE_PRODUCTION_PREFLIGHT = PASS
```

Preflight again proved required `DB`, required committed vars, fail-closed
economic switches, disabled previews, zero fixture service reachability, 12/12
paid routes unavailable before economics, and all four required secret names.

## Economics and provider activity

Only `/health` was requested with a version override during Deployment A. No
payment header, Nevermined credential, paid request body, MCP invocation,
provider request, service execution, settlement, or transaction was sent.

```text
PAYMENT_SIGNATURES = 0
PAYMENT_CHALLENGES_ON_CANDIDATE = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_NEVERMINED_ECONOMIC_EFFECTS = 0
LIVE_PROVIDER_CALLS_PERFORMED = 0
CANDIDATE_PAID_ROUTE_REQUESTS = 0
CANDIDATE_MCP_REQUESTS = 0
```

## Mutation accounting

```text
VERSION_UPLOADS = 0
WORKER_VERSIONS_CREATED = 0
SECRET_CREATES_OR_UPDATES = 0

DEPLOYMENTS = 2

DEPLOYMENT_A:
  known-good = 100%
  candidate = 0%

DEPLOYMENT_B:
  known-good = 100%
  candidate = removed

NORMAL_TRAFFIC_SHIFTS_TO_CANDIDATE = 0
MAX_NORMAL_CANDIDATE_TRAFFIC_PERCENT = 0

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
LIVE_PROVIDER_CALLS_PERFORMED = 0

CANDIDATE_OVERRIDE_SMOKE_REQUESTS = 3
  during Deployment A = 2 harmless /health requests
  after Deployment B = 1 harmless containment /health request
```

## Repository evidence verification

Only this closure report changed. No runtime source, candidate configuration,
lockfile, migration, contract, or pricing artifact moved. The checkpoint did not
repeat SUN-1208's full deterministic/security qualification because the frozen
source candidate was unchanged and the edge smoke stopped on attribution rather
than a source contradiction.

The report-specific verification passed:

```text
REPORT_PRETTIER = PASS
SECRET_SCAN = PASS
tracked-scope verification = PASS
required risk classes = 8
redacted detector probes = 9
Git history = 165 commits / no leaks
working directory = no leaks
```

## Final gate and next safe boundary

```text
ZERO_TRAFFIC_EDGE_SMOKE_GATE = FAIL

CANDIDATE_EDGE_SMOKE = FAIL
CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC = 0
CANDIDATE_PREVIEW_ROUTABLE = NO

PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
PRODUCTION_TRAFFIC = 100%

PUBLIC_CANARY_AUTHORIZATION_ELIGIBLE = NO
```

The smallest next safe checkpoint is not a 1% public canary. It is a new,
separately authorized zero-traffic smoke retry that first proves an attribution
mechanism against known-good traffic—preferably a bounded Workers Observability
query keyed by Cloudflare Ray ID or another authoritative `ScriptVersion.id`
source—before opening another 100%/0% deployment. Only after positive candidate
attribution should the remaining health, readiness, metadata, paid-route, MCP,
and request-boundary matrix run, followed by the same mandatory restoration.

No such retry, canary, upload, secret change, route activation, or economic
operation is authorized or started by this report.
