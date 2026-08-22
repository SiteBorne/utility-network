# SUN-1210 Checkpoint P4 — Authoritatively Attributed Zero-Traffic Edge Smoke

Date: 2026-08-22
Classification: production-edge smoke evidence; no normal candidate traffic; no
economic activity

## Decision

```text
ZERO_TRAFFIC_EDGE_SMOKE_GATE          = PASS
VERSION_OVERRIDE_ATTRIBUTION          = PASS
CANDIDATE_EDGE_SMOKE                  = PASS
PUBLIC_CANARY_AUTHORIZATION_ELIGIBLE  = YES
```

The frozen candidate executed successfully on Cloudflare's production edge under
explicit version override while its normal-traffic allocation remained zero.
Workers Observability uniquely attributed every material sample to the expected
Worker and version. Production was then restored to the known-good version alone
at 100%, and an attributed post-restoration override request proved the
candidate was no longer reachable through the override mechanism.

This decision is technical eligibility for a separately authorized, bounded
public canary only. It does not authorize that canary, paid-route activation,
provider execution, or economic activity.

## Starting containment

```text
START_HEAD                       = 2d5e321d7f0275acbbe14b25bcb046e7c34fe47b
START_WORKING_TREE               = CLEAN
RUNTIME_CANDIDATE_SHA            = e5d061e2e9c908244f807cf0cf141ab308575496
RUNTIME_BUNDLE_SHA256            = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
CANDIDATE_CLOUDFLARE_VERSION_ID  = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
KNOWN_GOOD_VERSION               = a4ada936-a434-4522-a8af-41c57170f4e4
START_DEPLOYMENT_ID              = 5b34c7b2-51f9-48b5-858f-429ba74f316d
START_PRODUCTION_TRAFFIC         = known-good 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT   = NO
CANDIDATE_TRAFFIC                = 0%
CANDIDATE_PREVIEW_ROUTABLE       = NO
CLOUDFLARE_PREVIEWS_ENABLED      = false
PRODUCTION_PREFLIGHT_BEFORE      = PASS
```

The immediate Observability token was active with more than four hours of
remaining validity, exceeding the 60-minute operational floor. A bounded key
discovery succeeded before deployment. Candidate metadata remained frozen:
compatibility date `2026-08-05`, `NVM_ENVIRONMENT=sandbox`, all four required
secret bindings present by name, stale economic activation variables absent, and
preview routing disabled.

Before Deployment A, all 12 paid production routes returned HTTP 404 and
`GET /mcp` returned HTTP 405. No payment headers or provider credentials were
sent.

## Attribution authority

The existing, read-only telemetry channel used the live fields discovered and
calibrated in P3:

| Meaning        | Workers Observability field             |
| -------------- | --------------------------------------- |
| Ray ID         | `$workers.event.request.headers.cf-ray` |
| Worker service | `$metadata.service`                     |
| Worker version | `$workers.scriptVersion.id`             |
| outcome        | `$workers.outcome`                      |
| CPU            | `$workers.cpuTimeMs`                    |
| wall time      | `$workers.wallTimeMs`                   |
| error          | `$metadata.error`                       |

The fail-closed lookup policy remained 12 attempts maximum, a 3-second poll
interval, exactly one invocation match, exact service identity, and exact
expected `scriptVersion.id`.

Fresh P4 pre-deployment calibration:

```text
Ray ID             = a2f45eb59d1a455e
HTTP               = 200
match count        = 1
service            = siteborne-utility-edge
scriptVersion.id   = a4ada936-a434-4522-a8af-41c57170f4e4
outcome            = ok
CPU                = 7 ms
wall               = 8 ms
query attempts     = 5
ingestion latency  = 14396 ms
P4_PREDEPLOY_ATTRIBUTION_CALIBRATION = PASS
```

## Deployment A — 100% known-good / 0% candidate

The exact verified Wrangler 4.119.0 command was executed once:

```bash
pnpm exec wrangler versions deploy \
  a4ada936-a434-4522-a8af-41c57170f4e4@100% \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@0% \
  --config wrangler.toml \
  --name siteborne-utility-edge \
  --message "SUN-1210 P4 attributed zero-traffic candidate smoke" \
  -y
```

```text
SMOKE_DEPLOYMENT_ID                    = 6df1522f-1d8e-4f43-8ba8-b6f73a5c381e
SMOKE_DEPLOYMENT_CREATED_AT            = 2026-08-22T19:45:32.958571Z
KNOWN_GOOD_TRAFFIC                     = 100%
CANDIDATE_TRAFFIC                      = 0%
DEPLOYMENT_A_PERCENTAGES_VERIFIED      = YES
NORMAL_TRAFFIC_SHIFT_TO_CANDIDATE      = 0
MAX_NORMAL_CANDIDATE_TRAFFIC_PERCENT   = 0
```

Wrangler reported synchronization of the already-existing non-versioned
observability settings (`enabled=true`, sampling rate `1`) and `logpush=false`.
No setting was changed by P4, and the subsequent authoritative read-back
remained consistent with the starting Cloudflare state.

## Candidate attribution and smoke

The first and only request before the attribution hard gate was
version-overridden `GET /health`. Ray `a2f464b12fc7c158` resolved uniquely to
candidate version `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`, with `outcome=ok` and
no telemetry error. Only then did the rest of the matrix proceed.

An ordinary request without the override produced Ray `a2f465aacad91dc5` and
resolved uniquely to known-good version `a4ada936-a434-4522-a8af-41c57170f4e4`.
Therefore configured 100%/0% routing and observed ordinary routing agreed.

### Materially attributed requests

| Request                                | HTTP | Ray ID             | `scriptVersion.id`                     | Outcome | CPU ms | Wall ms | HTTP latency ms |
| -------------------------------------- | ---: | ------------------ | -------------------------------------- | ------- | -----: | ------: | --------------: |
| candidate `GET /health`                |  200 | `a2f464b12fc7c158` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |      9 |       9 |             597 |
| ordinary `GET /health`                 |  200 | `a2f465aacad91dc5` | `a4ada936-a434-4522-a8af-41c57170f4e4` | ok      |      4 |       5 |             208 |
| candidate `GET /ready`                 |  200 | `a2f469395d3d0c1f` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |      4 |       5 |             476 |
| candidate agent card                   |  200 | `a2f469a9faeb7d4e` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |      8 |      10 |              32 |
| candidate v1 CDP disabled route        |  404 | `a2f46a37981cbf77` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |      1 |       1 |              28 |
| candidate v2 CDP disabled route        |  404 | `a2f46ad52a736333` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |      0 |       0 |              32 |
| candidate v2 Nevermined disabled route |  404 | `a2f46b498da38dfe` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |      0 |       1 |              26 |
| candidate MCP discovery                |  200 | `a2f46ba7e92269b1` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |     26 |      27 |              50 |
| candidate malformed MCP JSON           |  400 | `a2f46c2ebb55bd67` | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` | ok      |      2 |       4 |              26 |

Every attributed lookup returned exactly one invocation for
`siteborne-utility-edge`, the expected version, and `outcome=ok`.

### Readiness and public metadata

`GET /ready` returned HTTP 200 with the truthful preproduction body
`status=not_ready` and `production_services_enabled=false`. This is the governed
current state, not a runtime failure. `/`, the agent card, JWKS, `/catalog`, and
`/openapi.json` each returned HTTP 200 and their expected content shapes.

```text
CANDIDATE_HEALTH          = PASS
CANDIDATE_READINESS       = PASS
CANDIDATE_PUBLIC_METADATA = PASS
```

### Paid-route disablement

All 12 version-overridden candidate paid routes returned HTTP 404 using a
minimal JSON request and no payment material:

| Rail family   | Routes tested | Result       | Attributed representative |
| ------------- | ------------: | ------------ | ------------------------- |
| v1 CDP/x402   |             4 | 4/4 HTTP 404 | yes                       |
| v2 CDP/x402   |             4 | 4/4 HTTP 404 | yes                       |
| v2 Nevermined |             4 | 4/4 HTTP 404 | yes                       |

```text
CANDIDATE_REMOTE_PAID_ROUTES_DISABLED = 12/12
CANDIDATE_REMOTE_PAYMENT_CHALLENGES    = 0
CANDIDATE_REMOTE_PROVIDER_CALLS        = 0
```

### MCP and error boundaries

| Case                                   | Result                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| `GET /mcp`                             | HTTP 405, governed method-not-allowed                    |
| valid tool discovery                   | HTTP 200, governed six-tool result; candidate-attributed |
| unknown MCP method                     | HTTP 404 and JSON-RPC `-32601`                           |
| unpaid paid-tool invocation            | HTTP 200 with `payment_required`; no execution           |
| malformed JSON-RPC                     | HTTP 400 `Invalid JSON`; candidate-attributed            |
| unknown path                           | HTTP 404                                                 |
| invalid MCP content type               | HTTP 415 `UNSUPPORTED_MEDIA_TYPE`                        |
| measured request above 1 MiB MCP bound | HTTP 413 `PAYLOAD_TOO_LARGE`                             |

```text
CANDIDATE_MCP_BOUNDARY                     = PASS
CANDIDATE_MCP_UNAUTH_PROVIDER_CALL_RISK    = NONE
CANDIDATE_MCP_UNAUTH_LIVE_SERVICE_EXECUTION = NONE
CANDIDATE_EDGE_ERROR_BOUNDARIES             = PASS
```

### Runtime and performance assessment

No positively attributed candidate invocation contained an error. All outcomes
were `ok`. No request-time EvalError, fixture marker, settlement event, live
provider event, or unexpected storage activity was observed. Candidate health,
readiness, and MCP discovery completed within bounded edge latency; telemetry
CPU/wall observations were respectively `9/9`, `4/5`, and `26/27` ms. The
ordinary known-good health comparison was `4/5` ms. The HTTP-level variance was
normal for isolated edge requests and showed no timeout, CPU amplification, or
repeated failure.

```text
CANDIDATE_UNHANDLED_EXCEPTIONS            = 0
CANDIDATE_REQUEST_RUNTIME_EVAL_FAILURES   = 0
CANDIDATE_FIXTURE_EXECUTION_MARKERS       = 0
CANDIDATE_PAYMENT_SETTLEMENT_EVENTS       = 0
CANDIDATE_LIVE_PROVIDER_EVENTS            = 0
CANDIDATE_SMOKE_PERFORMANCE               = PASS
NORMAL_REQUESTS_REACHED_CANDIDATE         = 0
```

## Economics

No valid payment or provider credential was sent. Paid REST routes never reached
a 402 challenge, and the unpaid MCP tool stopped at the governed
`payment_required` boundary.

```text
PAYMENT_CHALLENGES                   = 0
PAYMENT_SIGNATURES                   = 0
SETTLEMENTS                          = 0
TRANSACTIONS                         = 0
REAL_NEVERMINED_ECONOMIC_EFFECTS     = 0
LIVE_PROVIDER_CALLS_PERFORMED        = 0
LIVE_SERVICE_EXECUTIONS              = 0
```

## Deployment B — mandatory restoration

The restoration command was executed once regardless of the successful smoke:

```bash
pnpm exec wrangler versions deploy \
  a4ada936-a434-4522-a8af-41c57170f4e4@100% \
  --config wrangler.toml \
  --name siteborne-utility-edge \
  --message "SUN-1210 P4 restore known-good after attributed smoke" \
  -y
```

Authoritative read-back:

```text
RESTORATION_DEPLOYMENT_ID       = 2c220471-c2dd-49c3-bc7e-660456b49a72
RESTORATION_CREATED_AT          = 2026-08-22T19:53:46.507505Z
CURRENT_PRODUCTION_VERSION      = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC      = 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT  = NO
CANDIDATE_TRAFFIC               = 0%
```

### Post-restoration override attribution

A harmless `GET /health` still carrying the candidate override generated Ray
`a2f46dc4ec2250bc`. Workers Observability returned exactly one invocation for
`siteborne-utility-edge`, but its `scriptVersion.id` was the known-good version
`a4ada936-a434-4522-a8af-41c57170f4e4`, with `outcome=ok`, CPU 1 ms, and wall
time 1 ms.

```text
CANDIDATE_OVERRIDE_REACHABLE_AFTER_RESTORE = NO
POST_RESTORE_ATTRIBUTION                   = PASS
```

## Final production state

Read-only reconciliation after restoration established:

```text
FINAL_ACTIVE_DEPLOYMENT_ID             = 2c220471-c2dd-49c3-bc7e-660456b49a72
FINAL_PRODUCTION_VERSION               = a4ada936-a434-4522-a8af-41c57170f4e4
FINAL_PRODUCTION_TRAFFIC               = 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT         = NO
CANDIDATE_TRAFFIC                      = 0%
CANDIDATE_PREVIEW_ROUTABLE             = NO
CLOUDFLARE_PREVIEWS_ENABLED            = false
VERSION_PREVIEW_ROUTING                = DISABLED
ALIAS_PREVIEW_ROUTING                  = DISABLED
FINAL_PAID_ROUTE_STATE                 = 12/12 DISABLED (HTTP 404)
FINAL_MCP_ROUTE_STATE                  = GOVERNED (GET HTTP 405)
FINAL_HEALTH                           = HTTP 200
FINAL_READINESS                        = HTTP 200
CURRENT_PRODUCTION_CUSTOMER_EXPOSURE   = KNOWN_GOOD_ONLY
POST_SMOKE_PRODUCTION_PREFLIGHT        = PASS
```

All four required production secret names remained present. No values were read
or logged.

## Temporary Observability-token cleanup

Only after restoration, post-restoration attribution, preview reconciliation,
surface probes, and preflight had all passed, the authenticated Cloudflare
dashboard was used to delete both scoped P3 tokens:

1. `SITEBORNE SUN-1210 P3 Observability Attribution Immediate`
2. `SITEBORNE SUN-1210 P3 Observability Attribution`

The unrelated pre-existing `siteborneutility` token remained untouched. After
both deletions the dashboard showed neither P3 token. One bounded telemetry
query using the still-memory-held immediate token returned HTTP 401
`Authentication error`, proving invalidation. The value was then cleared from
the persistent private process state, and the FIFO, helpers, and counters in
`/private/tmp` were removed.

```text
TEMP_OBSERVABILITY_TOKENS_EXPECTED          = 2
TEMP_OBSERVABILITY_TOKENS_DELETED           = 2
IMMEDIATE_TOKEN_POST_DELETE_AUTHORIZED      = NO
TEMP_OBSERVABILITY_CREDENTIAL_EXPOSURE      = CLOSED
TEMP_ATTRIBUTION_ARTIFACTS_REMOVED           = YES
CLOUDFLARE_API_TOKENS_CREATED_P4            = 0
CLOUDFLARE_API_TOKENS_EDITED_P4             = 0
```

No token value, authorization header, hash, account identifier, or other secret
material was written to this repository or report.

## Inherited frozen qualification

The candidate source/configuration and Cloudflare version did not change, and
edge observations agreed with the frozen evidence. Per the checkpoint scope, the
full source/security suite was not rerun.

```text
SUN1208_FULL_REGRESSION   = PASS
SUN1208_WORKER_RUNTIME    = 66/66 PASS
SUN1208_SECURITY_RELEASE  = PASS
SUN1209_UPLOAD_GATE       = PASS
```

## Final blocker and risk ledger

```text
R0_BLOCKERS        = []
EXTERNAL_BLOCKERS  = []
```

Carried release risks:

1. Candidate `/ready` truthfully remains `not_ready` with paid production
   services disabled. A public canary may assess only the already-public,
   non-economic surfaces unless separately authorized.
2. The candidate remains undeployed after restoration and is not reachable by
   preview or version override. A future canary is a new customer-exposure
   boundary and requires explicit authorization and rollback thresholds.
3. Both temporary Observability tokens were deleted. A future checkpoint that
   requires the same per-Ray attribution channel must separately provision an
   equivalent short-lived least-privilege credential or use another approved
   existing read-only authority.
4. No live paid-service, provider, settlement, or revenue behavior was tested in
   P4; those capabilities remain outside this gate.

## Mutation and request accounting

```text
VERSION_UPLOADS                            = 0
WORKER_VERSIONS_CREATED                    = 0
SECRET_CREATES_OR_UPDATES                  = 0
DEPLOYMENTS                                = 2

DEPLOYMENT_A                               = known-good 100% / candidate 0%
DEPLOYMENT_B                               = known-good 100% / candidate removed
NORMAL_TRAFFIC_SHIFTS_TO_CANDIDATE         = 0
MAX_NORMAL_CANDIDATE_TRAFFIC_PERCENT       = 0

PREVIEW_CONFIG_CHANGES                     = 0
PAID_ROUTE_CHANGES                         = 0
BINDING_CHANGES                            = 0
PRODUCTION_MIGRATIONS                      = 0
PRODUCTION_D1_WRITES                       = 0
PRODUCTION_KV_WRITES                       = 0
PRODUCTION_R2_WRITES                       = 0
PRODUCTION_QUEUE_WRITES                    = 0

PAYMENT_SIGNATURES                         = 0
SETTLEMENTS                                = 0
TRANSACTIONS                               = 0
REAL_NEVERMINED_ECONOMIC_EFFECTS           = 0
LIVE_PROVIDER_CALLS_PERFORMED              = 0

CLOUDFLARE_API_TOKENS_CREATED_P4           = 0
CLOUDFLARE_API_TOKENS_EDITED_P4            = 0
TEMP_OBSERVABILITY_TOKENS_DELETED           = 2

OBSERVABILITY_KEY_DISCOVERY_REQUESTS_P4    = 1
OBSERVABILITY_QUERIES_P4                   = 68
CANDIDATE_OVERRIDE_SMOKE_REQUESTS           = 28
ATTRIBUTED_CANDIDATE_REQUESTS               = 8
ATTRIBUTED_KNOWN_GOOD_REQUESTS              = 3
CANDIDATE_PAID_ROUTE_REQUESTS               = 12
```

The 68 read-only telemetry queries include bounded eventual-consistency polls
for the pre-deployment calibration, material candidate samples, ordinary traffic
proof, post-restoration proof, and the single expected-failure query after token
deletion.

## Human canary authorization packet

```text
RUNTIME_CANDIDATE_SHA               = e5d061e2e9c908244f807cf0cf141ab308575496
RUNTIME_BUNDLE_SHA256               = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
CANDIDATE_CLOUDFLARE_VERSION_ID     = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

ATTRIBUTION_AUTHORITY               = Workers Observability Ray ID to scriptVersion.id
VERSION_OVERRIDE_ATTRIBUTION        = PASS
CANDIDATE_HEALTH                    = PASS
CANDIDATE_READINESS                 = PASS
CANDIDATE_PUBLIC_METADATA           = PASS
CANDIDATE_REMOTE_PAID_ROUTES        = 12/12 HTTP 404
CANDIDATE_MCP_BOUNDARY              = PASS
CANDIDATE_EDGE_ERROR_BOUNDARIES     = PASS
CANDIDATE_EXCEPTIONS                = 0
CANDIDATE_SMOKE_PERFORMANCE         = PASS
NORMAL_REQUESTS_REACHED_CANDIDATE   = 0

PAYMENT_SIGNATURES                  = 0
SETTLEMENTS                         = 0
TRANSACTIONS                        = 0
LIVE_PROVIDER_CALLS                 = 0

FINAL_PRODUCTION_VERSION            = a4ada936-a434-4522-a8af-41c57170f4e4
FINAL_ACTIVE_DEPLOYMENT_ID          = 2c220471-c2dd-49c3-bc7e-660456b49a72
FINAL_PRODUCTION_TRAFFIC            = known-good 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT      = NO
CANDIDATE_TRAFFIC                   = 0%
CANDIDATE_PREVIEW_ROUTABLE          = NO
TEMP_OBSERVABILITY_TOKENS_DELETED   = 2

SUN1208_FULL_REGRESSION             = PASS
SUN1208_SECURITY_RELEASE            = PASS
SUN1209_UPLOAD_GATE                 = PASS
POST_SMOKE_PREFLIGHT                = PASS

R0_BLOCKERS                         = []
EXTERNAL_BLOCKERS                   = []
R1_RELEASE_RISKS                    = 4 carried items above
```

Proposed next boundary, not authorized here: SUN-1211 may consider a bounded 1%
public canary (`known-good 99% / candidate 1%`) while paid routes and economic
activity remain disabled, with predefined observation and mandatory rollback
thresholds. P4 does not execute or authorize that operation.
