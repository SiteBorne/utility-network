# SUN-1222C2 — Deterministic Version-Override Targeting Reconciliation

Date: 2026-09-03

Repository start HEAD: `5ebbd3f13f7a307de86d8ad67d82b4091da0203f`

Worker: `siteborne-utility-edge`

Production hostname: `https://utility.siteborne.net`

## Result

Cloudflare Version Overrides provide deterministic targeting of the existing
0%-normal-traffic candidate on the production custom domain. The mechanism was
proven with an ordinary control request and bounded, non-economic candidate
requests whose response Ray IDs were matched to fresh Cloudflare trace events.
Those events identify the executing Worker through both `scriptName` and
`scriptVersion.id`.

The targeting mechanism therefore passes. A separate material finding blocks
the requested Q1 handoff: the live candidate's discovery surfaces advertise the
older four-service prices rather than the repository-frozen S3 prices. No paid
request was made to determine whether PaymentRequirements share that drift.

```text
SUN1222C2_DETERMINISTIC_TARGETING=PASS
CANDIDATE_DISCOVERY_ECONOMICS_COHERENT=NO
Q1_ELIGIBLE=NO
```

## Prior C2 stop

The prior report at
`docs/reports/SUN-1222C2-four-service-paid-qualification.md` correctly stopped
before money because deterministic targeting had not been proven. Its analysis
that a preview alias cannot be retroactively added to the existing version was
correct as far as preview URLs went. The conclusion that no other deterministic
mechanism existed was incomplete: it did not consider Cloudflare Workers
Version Overrides. This reconciliation corrects that omission without
rewriting the historical safety decision as irrational.

## Official feature contract

Cloudflare's current Version Overrides documentation establishes the following:

- `Cloudflare-Workers-Version-Overrides` uses a Structured Fields dictionary
  whose key is the Worker name and whose quoted value is the version UUID.
- The selected version must be included in the current deployment.
- A version included at 0% can be explicitly targeted.
- The header is sent to the Worker's normal URL; a preview URL is not required.
- Using the header does not change deployment membership or traffic weights.
- An invalid or non-member override falls back to the deployment's percentage
  routing, so authoritative version attribution remains mandatory.

The installed Wrangler version was `4.119.0`. Repository configuration
authoritatively names the Worker `siteborne-utility-edge`, retains
`workers_dev = true`, and sets `preview_urls = false`.

```text
VERSION_OVERRIDE_FEATURE_AVAILABLE=YES
VERSION_OVERRIDE_SUPPORTS_ZERO_PERCENT_VERSION=YES
VERSION_OVERRIDE_REQUIRES_CURRENT_DEPLOYMENT_MEMBER=YES
VERSION_OVERRIDE_REQUIRES_PREVIEW_URL=NO
```

## Current deployment and candidate identity

A read-only `wrangler deployments list --name siteborne-utility-edge --json`
readback immediately before testing showed deployment
`62ef6314-daf2-4e54-8961-0f4d84ba0b7d` with exactly two versions:

| Version | Normal traffic |
|---|---:|
| `db7054c9-76ee-4830-aabe-8a4542261b6a` | 100% |
| `8ce8cb66-f388-4fcc-b3e6-9c14b4919a93` | 0% |

The full candidate version ID is
`8ce8cb66-f388-4fcc-b3e6-9c14b4919a93` (version number 55, created
`2026-09-03T20:53:00.276642Z`). There was no unexpected third version.

The exact non-secret request header was:

```http
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="8ce8cb66-f388-4fcc-b3e6-9c14b4919a93"
```

## Authoritative attribution

One fresh, unfiltered `wrangler tail siteborne-utility-edge --format json`
process was used only for read-only request attribution. A request was counted
only when its response `cf-ray` value matched the event request's `cf-ray`, the
event `scriptName` was `siteborne-utility-edge`, and the event exposed the
expected `scriptVersion.id`. This avoids inferring version identity from a 200
response or from a version-filtered tail session.

The ordinary control request had no override:

| Request | HTTP | Ray ID | Executing version | Outcome |
|---|---:|---|---|---|
| `GET /health` | 200 | `a358abd49cf69613` | `db7054c9-76ee-4830-aabe-8a4542261b6a` | `ok`; no exceptions |

The initial candidate override probe proved deterministic targeting:

| Request | HTTP | Ray ID | Executing version | Outcome |
|---|---:|---|---|---|
| `GET /health` | 200 | `a358ac4f5c6af2ac` | `8ce8cb66-f388-4fcc-b3e6-9c14b4919a93` | `ok`; no exceptions |

Both requests used `https://utility.siteborne.net`, and the trace event retained
`host: utility.siteborne.net`. No `workers.dev` or preview URL was involved.

```text
CONTROL_HEALTH=PASS
CONTROL_HANDLING_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
DETERMINISTIC_CANDIDATE_HEALTH_TARGETING=PASS
OVERRIDE_REQUEST_VERSION_ATTRIBUTION=AUTHORITATIVE_CLOUDFLARE_RAY_MATCHED_TRACE_EVENT
OVERRIDE_REQUEST_HANDLED_BY_8CE8=YES
OVERRIDE_USES_PRODUCTION_CUSTOM_DOMAIN=YES
```

## Bounded safe-surface proof

All counted candidate requests were non-economic. No paid service route was
requested. The candidate returned HTTP 200 on every counted surface, and each
representative Ray ID resolved to `8ce8cb66-f388-4fcc-b3e6-9c14b4919a93`.

| Surface | Method | Representative Ray ID | Semantic result |
|---|---|---|---|
| `/health` | GET | `a358ac4f5c6af2ac` | healthy |
| `/ready` | GET | `a358ad6a2a394589` | governed `not_ready` state; response valid |
| `/catalog` | GET | `a358b2674d871978` | four v2 services shown production-enabled |
| `/.well-known/agent-card.json` | GET | `a358ad7abf82f780` | valid Agent Card |
| `/services/company_evidence_graph.v2` | GET | `a358ad7f08f9bd4d` | service detail returned |
| `/services/web_context_verified.v2` | GET | `a358b0767f49c17a` | service detail returned |
| `/services/document_evidence_json.v2` | GET | `a358b0f9f863f142` | service detail returned |
| `/services/verify_agent_output.v2` | GET | `a358b1679fa25e69` | service detail returned |
| `/openapi.json` | GET | `a358b1d598a87314` | OpenAPI 3.0.3; six paths |
| `/mcp` (`tools/list`) | POST | `a358afa26cc9b82c` | JSON-RPC discovery response; six tools |

The MCP request was discovery-only and contained no service invocation,
payment header, credential, or authorization. The fresh tail process was
stopped after attribution.

```text
OVERRIDE_SAFE_SURFACE_PROBES=10
OVERRIDE_SAFE_SURFACE_PASS_COUNT=10
OVERRIDE_SAFE_SURFACE_WRONG_VERSION_COUNT=0
```

## Discovery economics mismatch

The frozen S3 economics supplied to this checkpoint were:

| Service | Frozen display price | Frozen atomic amount |
|---|---:|---:|
| `company_evidence_graph.v2` | 0.0312 | 31200 |
| `web_context_verified.v2` | 0.008 | 8000 |
| `document_evidence_json.v2` | 0.0098 | 9800 |
| `verify_agent_output.v2` | 0.017 | 17000 |

The candidate-attributed `/catalog` response at Ray
`a358b2674d871978` instead returned:

| Service | Candidate discovery price | Display-equivalent atomic amount |
|---|---:|---:|
| `company_evidence_graph.v2` | 0.039 | 39000 |
| `web_context_verified.v2` | 0.009 | 9000 |
| `document_evidence_json.v2` | 0.012 | 12000 |
| `verify_agent_output.v2` | 0.019 | 19000 |

The four corresponding service-detail GETs repeated those older prices and
reported `production_enabled=true`, `production_ready=true`, and
`protocol_status=production`. Therefore the mismatch is live candidate evidence,
not a routing-attribution ambiguity.

No PaymentRequirements or 402 was requested, so this checkpoint makes no claim
about the candidate's actual settlement amounts. Q1 must not begin until the
discovery/economic authority is reconciled and a qualified immutable candidate
advertises the intended prices.

```text
CANDIDATE_DISCOVERY_ECONOMICS_COHERENT=NO
DISCOVERY_EXPECTED_TOTAL_ATOMIC=66000
DISCOVERY_OBSERVED_TOTAL_ATOMIC=79000
DISCOVERY_TOTAL_DELTA_ATOMIC=13000
```

## Workflow binding and candidate configuration

Read-only candidate version metadata showed:

```text
PAID_CONTINUATION_WORKFLOW
  type=workflow
  workflow_name=siteborne-paid-continuation
  script_name=siteborne-paid-continuation-runtime
  class_name=PaidContinuationWorkflow
```

The four v2 route-enable variables and the global production/payment gates were
present as `true`. This was a metadata read only; no Workflow instance was
created and no binding, variable, secret, or D1 record was changed.

```text
CANDIDATE_WORKFLOW_BINDING=PASS
```

## Exposure and preview-plan reconciliation

An unauthenticated public client supplied the override header on the production
custom domain and reached the candidate. Thus 0% normal traffic does not make a
current-deployment version unreachable. This fact is now recorded in
`docs/operations/PRODUCTION_CUTOVER_RUNBOOK.md`.

The proposed `SUN-1222C2-TARGETING-WINDOW` byte-identical preview upload is not
needed to solve deterministic targeting. Preview aliases remain unnecessary and
`preview_urls=false` remains unchanged. The existing `8ce8…` version is retained
as the artifact whose targeting behavior was proven, but its separate discovery
economics mismatch prevents paid qualification.

```text
ZERO_PERCENT_VERSION_EXTERNALLY_TARGETABLE_BY_OVERRIDE=YES
NEW_VERSION_UPLOAD_REQUIRED=NO_FOR_TARGETING
PREVIEW_ALIAS_REQUIRED=NO
8CE8_IMMUTABLE_CANDIDATE_RETAINED=YES
```

## Final readback and mutation accounting

The final read-only deployment query returned the same deployment and version
mix: `db7054c9…` at 100% and `8ce8cb66…` at 0%, with no third version.

```text
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_CANDIDATE_TRAFFIC=0%
NEW_WORKER_VERSIONS_CREATED=0
CLOUDFLARE_MUTATIONS=0

REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_NONCES_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
EXECUTOR_CALLS_FROM_PAID_ROUTES=0
SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

## Final classification

Deterministic targeting itself passes every required targeting invariant.
However, this checkpoint's complete requested reconciliation is classified
`FAIL` because the candidate's non-economic discovery economics contradict the
frozen commercial authority. This is not a failure of Cloudflare Version
Overrides and is not evidence of a paid execution failure.

```text
SUN1222C2_TARGETING_RECONCILIATION=FAIL
SUN1222C2_DETERMINISTIC_TARGETING=PASS
NEXT_REQUIRED_CHECKPOINT=SUN-1222C2-CANDIDATE-DISCOVERY-ECONOMICS-RECONCILIATION
```

Do not start Q1 from this candidate state.
