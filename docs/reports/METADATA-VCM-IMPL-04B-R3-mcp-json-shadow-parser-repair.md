# METADATA-VCM-IMPL-04B-R3 — MCP JSON Shadow Parser Repair

**Date:** 2026-09-16  
**Status:** PASS  
**Starting HEAD:** `1668061e6886ffb1dd674a38280dda05e1b20d8c`  
**Implementation commit:** `42be7e9105356a12b4d6fddf9d823d872e12f25c`

## I. Checkpoint result

The live 0%-traffic candidate exposed a response-representation coverage defect
in the MCP shadow observer. The actual MCP endpoint remained correct: the exact
candidate returned HTTP 200, `application/json`, JSON-RPC 2.0, and the governed
six-tool `result.tools` array. The observer only searched for SSE `data:`
frames, so it silently skipped shadow comparison before emitting telemetry.

This checkpoint repairs only that observational boundary. The observer now reads
both legitimate `tools/list` response representations:

- direct JSON-RPC in `application/json` or a structured `+json` media type; and
- JSON-RPC `data:` frames in `text/event-stream`.

The existing MCP response remains the independently served response. Malformed
observations, missing `result.tools`, projector errors, comparator errors, and
telemetry errors cannot replace or fail the caller response.

No Worker version was uploaded or deployed. No traffic, secret, economic,
protocol, registry, governance, contract, projection-mode, route, handler,
scheduled-job, or production state was changed.

## II. Authoritative live finding inherited by this local repair

The checkpoint used the supplied live qualification evidence as its input and
performed no additional Cloudflare operation:

| Role               | Version                                | Traffic |
| ------------------ | -------------------------------------- | ------: |
| Normal production  | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` |    100% |
| Existing candidate | `97b54092-ce5d-43e1-86ff-572b67bbc87c` |      0% |

The supplied candidate evidence established:

- A2A shadow comparison reached the exact candidate and emitted compare and
  match telemetry.
- MCP `POST /mcp`, with `MCP-Protocol-Version: 2026-07-28` and
  `Mcp-Method: tools/list`, reached the exact candidate.
- MCP returned HTTP 200, `Content-Type: application/json`, JSON-RPC 2.0, and
  exactly six tools.
- The six tool names were unchanged:
  - `siteborne_company_evidence_graph`
  - `siteborne_web_context_verified`
  - `siteborne_document_evidence_json`
  - `siteborne_verify_agent_output`
  - `siteborne_get_quote`
  - `siteborne_get_service_health`
- The saved body independently parsed as `result.tools` with a count of six.
- No MCP metadata-projection telemetry appeared.

## III. Root cause confirmation

Before this repair, `extractToolsListFromResponse()` in
`apps/edge-api/src/routes/mcp.ts` iterated response lines and attempted JSON
parsing only for lines beginning with `data:`. A direct JSON-RPC document
therefore returned `undefined` even when `result.tools` was valid.

`scheduleMcpShadowComparison()` intentionally exits when the extractor returns
no tool list. The direct consequence was:

```text
valid application/json tools/list response
  -> extractToolsListFromResponse() returns undefined
  -> scheduleMcpShadowComparison() returns before runShadowComparison()
  -> no compare or match telemetry
```

The MCP server, protocol negotiation, six-tool registration, and VCM semantic
comparison were not defective.

## IV. RED evidence

The live response representation was added as a regression before changing the
extractor:

```text
pnpm exec vitest run apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts

Test Files  1 failed (1)
Tests       1 failed | 5 passed (6)
```

The new test received the mocked HTTP 200 `application/json` response and parsed
all six tools, but its assertion for `metadata_projection_compare_total` failed.
This reproduced the live absence of telemetry at the exact observer boundary.

## V. Minimal implementation

### Production source

`apps/edge-api/src/routes/mcp.ts` now:

1. Reads and normalizes the response media type.
2. Parses direct JSON for `application/json` and structured `+json` media types.
3. Preserves SSE parsing for `text/event-stream`.
4. Accepts a value only when `result` is an object and `result.tools` is an
   array.
5. Ignores a malformed SSE frame while continuing to look for a later valid
   frame.
6. Uses a strict JSON-then-SSE fallback when the media type is missing or
   unfamiliar.
7. Returns `undefined` for malformed or unrecognized observations without
   throwing.

The stale comment that claimed every real response was SSE was replaced with the
verified JSON-or-SSE representation rule.

### Tests

The existing suites were extended:

- `apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts`
  - exact live-shaped `application/json` JSON-RPC response;
  - six tools reaching comparison;
  - compare and match telemetry;
  - byte-preserved served body;
  - existing SSE extraction and comparison;
  - malformed JSON;
  - JSON without `result.tools`;
  - malformed SSE;
  - non-`tools/list` skip behavior.
- `apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts`
  - existing missing-tool mismatch detection and served-response independence;
  - existing throwing projector containment;
  - throwing comparator containment;
  - throwing telemetry-sink containment.

No parallel observer framework or transport rewrite was introduced.

## VI. Safety matrix

| Required case                               | Evidence                                                                       | Result |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| A. JSON `result.tools` extraction           | Live-shaped `application/json` test, six tools, compare + match telemetry      | PASS   |
| B. SSE extraction retained                  | Existing real SSE response, six tools, compare + match telemetry               | PASS   |
| C. Malformed JSON                           | No comparison telemetry; exact status, content type, and body preserved        | PASS   |
| D. JSON without `result.tools`              | No crash or false match; exact response preserved                              | PASS   |
| E. Malformed SSE                            | No crash; exact response preserved                                             | PASS   |
| F. Non-`tools/list` method                  | Comparator remains skipped                                                     | PASS   |
| G. Projection mismatch                      | Mismatch and fallback telemetry remain detectable; six-tool response preserved | PASS   |
| H. Projector/comparator/telemetry exception | Each exception is contained; caller still receives HTTP 200 and six tools      | PASS   |

The semantic comparison and its normalization rules were not changed.

## VII. Qualification evidence

### Focused GREEN evidence

```text
pnpm exec vitest run \
  apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts \
  apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts \
  apps/edge-api/src/control-plane/metadata/shadow-comparison-runner.test.ts

Test Files  3 passed (3)
Tests       19 passed (19)
```

### Complete relevant local qualification

| Gate                                         | Result                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| VCM tests                                    | **135/135 PASS**, 16 files, via repository-root Vitest invocation                                        |
| A2A metadata shadow suites                   | **7/7 PASS**, 2 files                                                                                    |
| `a2a:check`                                  | **67/67 PASS** across protocol, property, fixture, edge route, and baseline checks                       |
| MCP focused shadow/adversarial/runner suites | **19/19 PASS**, 3 files                                                                                  |
| `mcp:check`                                  | **164/164 PASS** across protocol, property, edge route, stdio, metadata, and packed-install verification |
| `x402:check` including Bazaar                | **532/532 PASS**: 512 unit + 20 property tests; fixture baseline PASS                                    |
| Edge API full suite, single worker           | **1557/1557 PASS**, 134 files; 72 tests and 22 live/credentialed files skipped by design                 |
| Repository typecheck                         | **25/25 tasks PASS**                                                                                     |
| Repository lint                              | **17/17 tasks PASS**                                                                                     |
| Changed-file Prettier check                  | **PASS**, all three implementation/test files                                                            |
| `git diff --check`                           | **PASS**                                                                                                 |
| Secret scan                                  | **PASS**: 836 commits, 1,584 tracked/working-tree files, zero leaks                                      |
| OpenAPI drift                                | **PASS**, 3/3 generated files match                                                                      |
| Service-model drift                          | **PASS**, 18/18 generated models match                                                                   |
| Embedded pricing drift                       | **PASS**, 15 governed keys match                                                                         |
| Registry pricing drift                       | **PASS**, 8/8 service entries match                                                                      |
| Governance                                   | **77/77 PASS**                                                                                           |
| Generated schema validators                  | **PASS**, input and output validators current                                                            |
| Contract baseline                            | **PASS**                                                                                                 |
| Contract release                             | **PASS**                                                                                                 |
| Contract compatibility                       | **PASS**                                                                                                 |
| Project state                                | **30/30 PASS**                                                                                           |
| Task governance                              | **252/252 PASS**                                                                                         |

### Classified non-regressions

Two results required explicit classification rather than dismissal:

1. The first concurrent edge-suite run passed 1,555 tests but timed out one new
   MCP adversarial test and one unchanged production-CDP full-stack test at
   their fixed five-second limits while Miniflare and load suites ran
   concurrently. Each exact file passed immediately in isolation. The full
   156-file edge suite was then rerun with one worker and passed completely: 134
   files and 1,557 tests passed, with the expected live/credentialed skips. A
   post-commit audit also ran the focused MCP suite in parallel with the full
   history and working-tree secret scan; the same adversarial test crossed its
   five-second limit while the other 18 focused tests and the secret scan
   passed. Its immediate single-worker rerun passed all 19 focused tests, with
   the previously timing-out case completing in 1.98 seconds. This is repeatable
   host-contention evidence, not a deterministic product failure.
2. Repository-wide `pnpm format:check` reports 269 pre-existing formatting
   violations outside the three changed files. None of this checkpoint's files
   appeared in that list. The required scoped check over all changed files and
   `git diff --check` both pass. The checkpoint did not rewrite 269 unrelated
   files.

The package-local command `pnpm --filter @siteborne/vcm test` also has an
existing working-directory/glob discovery defect and exits with
`No test files found`. The same governed VCM suite was run from the repository
root, where its configured paths resolve, and all 135 tests passed. No VCM code
or test wiring was changed by this checkpoint.

## VIII. Provenance and blast radius

Implementation diff:

```text
apps/edge-api/src/routes/mcp.ts                    |  63 ++++++++--
apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts | 42 +++++++
apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts     | 139 ++++++++++++++++++---
3 files changed, 216 insertions(+), 28 deletions(-)
```

Implementation boundaries:

```text
MCP_TOOL_DEFINITION_CHANGES = 0
MCP_HANDLER_CHANGES = 0
MCP_TRANSPORT_CHANGES = 0
VCM_SEMANTIC_CHANGES = 0
PROJECTION_MODE_CHANGES = 0
REGISTRY_MUTATIONS = 0
GOVERNANCE_MUTATIONS = 0
CONTRACT_MUTATIONS = 0
ECONOMIC_MUTATIONS = 0
RUNTIME_MUTATIONS = 0
PRODUCTION_MUTATIONS = 0
```

## IX. Closure

```text
METADATA_VCM_IMPL_04B_R3 = PASS
ROOT_CAUSE_CONFIRMED = YES
JSON_RESPONSE_EXTRACTION = PASS
SSE_RESPONSE_EXTRACTION = PASS
MCP_SHADOW_JSON_REGRESSION = PASS
MCP_SHADOW_SSE_REGRESSION = PASS
MCP_MISMATCH_DETECTION = PASS
LEGACY_RESPONSE_INDEPENDENCE = PASS
PRODUCTION_MUTATIONS = 0
CANDIDATE_TRAFFIC = 0%
SAFE_TO_BUILD_REPLACEMENT_ZERO_PERCENT_CANDIDATE = YES
```

This is local build-readiness evidence only. It does not authorize a Worker
upload, deployment, version override, traffic change, or any other Cloudflare
mutation. Human authorization is required before the next Cloudflare mutation.

## X. Live zero-percent qualification and closure

This section freezes the independently supplied live qualification evidence for
the repaired R3 candidate. It records the already-completed qualification; this
report-only closure performed no Cloudflare read or mutation, did not upload a
Worker, and did not change traffic, configuration, secrets, routes, triggers,
bindings, pricing, protocol behavior, metadata modes, or economic behavior.

### X.1 Source provenance

| Provenance fact                           | Verified value                             |
| ----------------------------------------- | ------------------------------------------ |
| Implementation commit                     | `42be7e9105356a12b4d6fddf9d823d872e12f25c` |
| Pre-live evidence commit                  | `91f3d62c38ff40fbc6fefff850be03564e33a051` |
| Remote qualification branch               | `metadata-vcm-qualification`               |
| Independently verified remote HEAD        | `91f3d62c38ff40fbc6fefff850be03564e33a051` |
| Implementation reachable from remote HEAD | YES                                        |

The R3 Worker version message encoded the pre-live evidence commit exactly. The
implementation commit is reachable from that commit, so the qualified Worker has
a reviewable source lineage through both the parser repair and its local
evidence.

```text
SOURCE_PROVENANCE = PASS
```

### X.2 Candidate history and repaired defect

The original R2 zero-percent candidate was:

```text
R2_CANDIDATE_VERSION = 97b54092-ce5d-43e1-86ff-572b67bbc87c
```

R2 exposed a real observer defect. Its MCP endpoint correctly served HTTP 200,
`application/json`, JSON-RPC 2.0, and an array containing all six expected tools
at `result.tools`. The MCP shadow observer nevertheless searched only for SSE
`data:` frames. It returned before `runShadowComparison()` and therefore emitted
no MCP comparison telemetry.

R3 changed only that observational parser. It did not change the MCP endpoint,
transport, tool definitions, handlers, protocol negotiation, VCM comparison
semantics, pricing, or economic behavior. The live R3 evidence below proves that
the JSON response now reaches the unchanged comparison path.

### X.3 Repaired R3 candidate and active deployment

| Deployment fact                 | Verified value                                 |
| ------------------------------- | ---------------------------------------------- |
| Candidate version               | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0`         |
| Worker version number           | `95`                                           |
| Version-message source commit   | `91f3d62c38ff40fbc6fefff850be03564e33a051`     |
| Tag                             | `metadata-vcm-04b-r3-shadow-compare-candidate` |
| Deployment ID                   | `ffe3f701-9eae-4023-879f-72df1489dcdb`         |
| Deployment strategy             | `percentage`                                   |
| Production baseline             | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 100% |
| R3 candidate                    | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` at 0%   |
| Normal traffic reaching R3      | 0%                                             |
| R2 present in active deployment | NO                                             |

The candidate configuration was independently inspected before deployment. It
retained the production resources, bindings, runtime compatibility, handlers, 14
secret binding names, and 16 ordinary production variables. It added only:

```text
A2A_METADATA_PROJECTION_MODE = shadow_compare
MCP_METADATA_PROJECTION_MODE = shadow_compare
```

`PAID_ROUTES_ENABLED` remained `false`. No unrelated candidate configuration
drift was observed. No secret value is included in this report.

### X.4 Live A2A zero-percent qualification

The version override targeted only:

```text
1a3ea07b-5885-49d2-9cd0-d176c4313bd0
```

Request and response evidence:

| Fact                    | Observed value                         |
| ----------------------- | -------------------------------------- |
| Endpoint                | `GET /.well-known/agent-card.json`     |
| HTTP status             | `200`                                  |
| Content type            | `application/a2a+json`                 |
| Response size           | `10998` bytes                          |
| Tail outcome            | `ok`                                   |
| Tail response status    | `200`                                  |
| Tail `scriptVersion.id` | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` |

Candidate-only telemetry contained:

```text
metadata_projection_compare_total surface=a2a
metadata_projection_match_total surface=a2a
```

The exact candidate version therefore served the response and completed a
matching A2A shadow comparison.

```text
A2A_CANDIDATE_VERSION_PROVEN = YES
A2A_LIVE_SHADOW_COMPARE = PASS
A2A_COMPARE_RESULT = MATCH
```

### X.5 Live MCP zero-percent qualification

The version override targeted only:

```text
1a3ea07b-5885-49d2-9cd0-d176c4313bd0
```

Request and response evidence:

| Fact                    | Observed value                         |
| ----------------------- | -------------------------------------- |
| Endpoint                | `POST /mcp`                            |
| MCP protocol version    | `2026-07-28`                           |
| MCP method              | `tools/list`                           |
| HTTP status             | `200`                                  |
| Content type            | `application/json`                     |
| Response size           | `133807` bytes                         |
| Tail outcome            | `ok`                                   |
| Tail response status    | `200`                                  |
| Tail `scriptVersion.id` | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` |

Candidate-only telemetry contained:

```text
metadata_projection_compare_total surface=mcp
metadata_projection_match_total surface=mcp
```

The exact R3 candidate therefore parsed the live JSON-RPC representation,
reached the unchanged semantic comparator, and recorded a match. This is the
live proof that the R2 JSON-observer defect was repaired.

```text
MCP_CANDIDATE_VERSION_PROVEN = YES
MCP_LIVE_SHADOW_COMPARE = PASS
MCP_COMPARE_RESULT = MATCH
R2_JSON_OBSERVER_DEFECT_REPAIRED_LIVE = YES
```

### X.6 Public production non-regression

The following probes used no version override and continued to reach ordinary
production routing:

| Public endpoint                                       | Result                               |
| ----------------------------------------------------- | ------------------------------------ |
| `https://utility.siteborne.net/health`                | HTTP 200, `application/json`         |
| `https://utility.siteborne.net/ready`                 | HTTP 200, `application/json`         |
| `https://siteborne.net/.well-known/mcp-registry-auth` | HTTP 200, `text/plain;charset=UTF-8` |

```text
PUBLIC_PRODUCTION_NON_REGRESSION = PASS
```

### X.7 Production economic and binding baseline

The serving production version was re-inspected after candidate qualification:

```text
SERVING_PRODUCTION_VERSION = 38cbf4dd-52fd-4afc-ad34-626a2e6454d3
```

The confirmed ordinary economic and route-control variables included:

```text
PAID_ROUTES_ENABLED = false
PRODUCTION_ENABLED = true
PAYMENT_ENVIRONMENT = production
PRODUCTION_CDP_CREDENTIALS_APPROVED = true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP = true

VERIFY_V2_CDP_ROUTE_ENABLED = true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED = true
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED = false
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED = false
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED = false
```

Production retained 16 plaintext variables and 14 secret binding names. No
secret value was read into or copied into this report.

The verified production resources and bindings remained:

- D1
- R2
- KV
- `JOBS` queue
- `EVENTS` queue
- `PaidContinuationWorkflow`
- AI
- Browser
- `STORAGE_ALERT_RECEIVER` service binding

The runtime remained:

```text
compatibility_date = 2026-08-05
compatibility_flags = nodejs_compat
usage_model = standard
```

```text
PRODUCTION_ECONOMIC_BASELINE = PASS
PRODUCTION_BINDING_BASELINE = PASS
ECONOMIC_CONFIG_DRIFT = 0
```

### X.8 Production cron invariant

A candidate-independent tail attached specifically to serving production version
`38cbf4dd-52fd-4afc-ad34-626a2e6454d3` captured a real scheduled event:

```text
cron = * * * * *
outcome = ok
scriptVersion.id = 38cbf4dd-52fd-4afc-ad34-626a2e6454d3
```

No trigger deployment or cron mutation occurred.

```text
SCHEDULED_HANDLER_EXECUTING = YES
CRON_EXPRESSION = * * * * *
CRON_OUTCOME = ok
PRODUCTION_CRON_VERSION_PROVEN = YES
TRIGGER_MUTATION = NO
```

### X.9 Authority and traffic boundary

This qualification proves only that the existing legacy-serving runtime and the
VCM shadow projections agree live for A2A and MCP on an exact 0%-traffic
candidate. The legacy runtime remains the serving producer. VCM remains a
compare-only shadow. No current or future traffic canary is approved by this
evidence.

```text
NORMAL_TRAFFIC_TO_CANDIDATE = 0%
VCM_PRIMARY_SERVING = NO
AUTHORITY_INVERSION = NO
TRAFFIC_CANARY_APPROVED = NO
```

### X.10 Final R3 closure

```text
METADATA_VCM_IMPL_04B_R3_LIVE = PASS
SOURCE_PROVENANCE = PASS
LOCAL_QUALIFICATION = PASS
A2A_ZERO_PERCENT_SHADOW = PASS
A2A_COMPARE = MATCH
MCP_ZERO_PERCENT_SHADOW = PASS
MCP_COMPARE = MATCH
R2_DEFECT_REPAIRED_LIVE = YES
PUBLIC_PRODUCTION_NON_REGRESSION = PASS
PRODUCTION_ECONOMIC_BASELINE = PASS
PRODUCTION_BINDING_BASELINE = PASS
PRODUCTION_CRON_INVARIANT = PASS
NORMAL_TRAFFIC_TO_CANDIDATE = 0%
VCM_PRIMARY_SERVING = NO
AUTHORITY_INVERSION = NO
SAFE_TO_CLOSE_04B_R3 = YES
```

The recommended next step is a separate, explicitly human-authorized decision
checkpoint before any traffic canary, promotion, or other Cloudflare mutation.
This closure itself authorizes none of those actions.
