# METADATA-VCM-07B — Bounded A2A/MCP Canary Activation Design

**Checkpoint:** METADATA-VCM-07B

**Mode:** design and read-only evidence only

**Date:** 2026-09-16

**Result:** PASS — a bounded, evidence-bearing first canary can be presented for
separate human authorization

**Activation performed:** NO

## Executive decision

The recommended first nonzero stage is **10% candidate / 90% stable**, for a
minimum of **12 continuous hours** and a maximum of **24 hours**. Passing that
stage requires all of the following in the same uninterrupted window:

- at least 100 version-attributed candidate HTTP invocations;
- at least 10 A2A shadow comparisons;
- at least 10 MCP `tools/list` shadow comparisons;
- every comparison paired with a match, with zero mismatches and zero fallback
  events;
- no candidate-attributable unhandled exception, systemic unexpected 5xx
  regression, configuration drift, economic effect, state corruption, or
  security regression; and
- the latency, public-health, and scheduled-safety gates defined below.

These counts are conservative operational policy gates, not a claim of a
particular statistical confidence level. If the counts are not met by 24 hours,
the stage does **not** pass. Time alone is never sufficient.

This remains a **legacy-serving shadow canary**. The candidate serves the same
legacy A2A and MCP producers as production and computes VCM projections only for
comparison. It does not test VCM-primary serving, `vcm_primary_compare`,
`vcm_only`, registry authority inversion, new pricing, paid execution, or any
economic activation.

No activation, rollback, upload, deployment, trigger, route, variable, secret,
or repository runtime-source mutation occurred in this checkpoint. All mutation
commands in this report are inert text for a later, separately authorized
human-operated checkpoint.

## A. Current authoritative state

### Source provenance

| Fact                                                                    | Verified value                             |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| Qualification branch                                                    | `metadata-vcm-qualification`               |
| Local closure commit at investigation start                             | `dc5cf92c9a9d2ba94298e49cb7879cdf63b05e42` |
| Remote closure commit supplied and independently established before 07B | `dc5cf92c9a9d2ba94298e49cb7879cdf63b05e42` |
| R3 implementation commit                                                | `42be7e9105356a12b4d6fddf9d823d872e12f25c` |
| R3 pre-live evidence commit                                             | `91f3d62c38ff40fbc6fefff850be03564e33a051` |
| R3 closure commit                                                       | `dc5cf92c9a9d2ba94298e49cb7879cdf63b05e42` |
| Stable source lineage encoded in version message                        | `b96373c85f6fbee4c870430298e63f9263bf3a66` |
| Candidate source lineage encoded in version message                     | `91f3d62c38ff40fbc6fefff850be03564e33a051` |

The local checkout's Git branch name at investigation start was
`smtp-diagnostic-starttls-observability`, while its exact HEAD was the required
closure commit. Before the report-only commit, a local
`metadata-vcm-qualification` tracking branch was created directly from the
independently verified remote branch at the same exact closure commit. The
checkpoint did not reset, stash, rewrite, or discard any work.

### Live deployment readback

A fresh read-only `wrangler deployments list --json` query confirmed:

| Fact                            | Value                                          |
| ------------------------------- | ---------------------------------------------- |
| Active deployment               | `ffe3f701-9eae-4023-879f-72df1489dcdb`         |
| Strategy                        | `percentage`                                   |
| Stable version                  | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 100% |
| R3 candidate                    | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` at 0%   |
| Candidate Worker version number | 95                                             |
| Candidate tag                   | `metadata-vcm-04b-r3-shadow-compare-candidate` |

Fresh read-only version inspection also confirmed:

- stable and candidate have the same 16 ordinary production variables;
- candidate adds only `A2A_METADATA_PROJECTION_MODE=shadow_compare` and
  `MCP_METADATA_PROJECTION_MODE=shadow_compare`;
- both have `PAID_ROUTES_ENABLED=false`;
- both retain the same 14 secret binding **names**;
- D1, R2, KV, queues, Workflow, AI, Browser, and `STORAGE_ALERT_RECEIVER`
  binding identities match;
- compatibility date `2026-08-05`, `nodejs_compat`, and `standard` usage model
  match; and
- no secret value was queried or displayed.

The candidate remains legacy-serving:

```text
VCM_PRIMARY_SERVING=NO
AUTHORITY_INVERSION=NO
```

## B. Current Cloudflare platform semantics

The platform facts below were refreshed from current first-party Cloudflare
documentation on 2026-09-16 and cross-checked against the repository-pinned
Wrangler executable.

| Design fact                  | Verified current behavior                                                                                                                                                | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active versions              | A deployment can contain one version at 100%, or two versions in a percentage split.                                                                                     | [Versions and Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) and [Version Overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/) explicitly state the two-version limit. The plan keeps exactly stable plus R3.                                                                                                                                                                                                                   |
| Explicit split               | `wrangler versions deploy <version>@<percentage> ... -y` is the supported noninteractive mechanism.                                                                      | [Wrangler `versions deploy`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-deploy) documents the shorthand. Pinned help shows the same positional grammar.                                                                                                                                                                                                                                                                                                                      |
| Request routing              | Requests are independently routed by the configured percentages unless an affinity key is supplied.                                                                      | [Gradual Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/) calls out independent request routing and version skew.                                                                                                                                                                                                                                                                                                                                          |
| Version override             | A request can target either version in the current deployment, including a version at 0%.                                                                                | [Version Overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/) documents the header and 0% use. An invalid or unapplied override falls back to normal percentage routing, so logs must prove `scriptVersion.id`.                                                                                                                                                                                                                                                    |
| Hard rollback                | Rolling back from a split creates a new deployment with the selected version at 100% and removes the split.                                                              | [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) states this directly. Connected resources do not roll back with code.                                                                                                                                                                                                                                                                                                                                                |
| Percentage granularity       | Decimal values are accepted by pinned Wrangler 4.119.0; the public deployment API documents numeric values down to 0.01.                                                 | The [Create Deployment API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/) describes numeric percentages with a minimum nonzero value of 0.01. Pinned source uses `parseFloat`, accepts `^-?\d+(\.\d+)?%?$`, validates 0–100, and requires a total of 100 within `1e-3`. This checkpoint nevertheless selects whole percentages for inspectability. The documented override workflow separately supports a second active version at 0%. |
| Wrangler version             | Repository-pinned and executed version is 4.119.0. No upgrade is required.                                                                                               | `package.json`, the lockfile, `pnpm exec wrangler --version`, subcommand help, and installed source agree. Changing the deployment client during a canary would add unrelated risk.                                                                                                                                                                                                                                                                                                                             |
| Version-attributed live logs | `wrangler tail <worker> --version-id <id> --format json` is supported.                                                                                                   | Pinned help includes `--version-id`; [Real-time Logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/) describes near-real-time invocation, custom-log, error, and exception capture. High-volume tails may sample and tails are not persistent storage.                                                                                                                                                                                                                           |
| Stored Workers Logs          | `observability.enabled=true` with head sampling 1 selects all request contexts under normal limits, but it does not guarantee permanent or lossless historical evidence. | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) documents request-context sampling, retention of at most seven days, plan quotas, truncation, and fallback sampling after limits. The canary therefore saves a bounded live-tail capture and does not treat configuration alone as proof of complete retention.                                                                                                                                                      |
| Script version attribution   | Workers observability exposes version attribution, including `ScriptVersion`/`$workers.scriptVersion.id`.                                                                | [Gradual Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/) recommends version-attributed observability. SITEBORNE has already proven the field live; no Version Metadata binding is needed.                                                                                                                                                                                                                                                                 |
| Cron during split            | Cloudflare does not document which active version receives a Cron Trigger during a percentage deployment.                                                                | Current [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) documentation specifies scheduled execution and propagation, while the gradual-deployment documentation specifies request traffic; neither defines their intersection. The design does not infer a distribution.                                                                                                                                                                                                |

```text
CLOUDFLARE_TWO_VERSION_LIMIT_VERIFIED=YES
PERCENTAGE_GRANULARITY=DECIMAL_SUPPORTED_BY_WRANGLER_4.119.0;_API_MIN_NONZERO_0.01;_WHOLE_PERCENT_SELECTED
VERSION_OVERRIDE_VERIFIED=YES
ROLLBACK_SEMANTICS_VERIFIED=YES
CRON_VERSION_SELECTION_DURING_SPLIT=UNDOCUMENTED
WRANGLER_UPGRADE_REQUIRED=NO
```

## C. Candidate-versus-production total runtime differential

### Audit boundary

The audit compared the full stable source lineage
`b96373c85f6fbee4c870430298e63f9263bf3a66` with candidate source
`91f3d62c38ff40fbc6fefff850be03564e33a051`. It did not assume that R3's small
JSON-parser repair was the entire candidate delta.

The full repository diff contains 82 files, 16,654 insertions, and 103
deletions. Most are reports, tests, and the new VCM package. Runtime-relevant
changes are limited to:

- an `@siteborne/vcm` edge-package dependency;
- two projection-mode environment declarations;
- one closed mode parser and authorization gate;
- one fail-safe comparison runner;
- one bounded structured telemetry module;
- A2A shadow scheduling in `routes/a2a.ts`;
- MCP shadow scheduling and response observation in `routes/mcp.ts`; and
- the pure, in-memory `packages/vcm` model/import/projection implementation.

### Runtime path classification

| Changed runtime path           | Request trigger                                                                 | State mutation potential                                              | Economic potential                                                                          | External invocation potential       | Failure behavior                                                                                                                                                                   | Rollback implication                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mode parser/authorization gate | A2A or MCP route                                                                | None                                                                  | None                                                                                        | None                                | Missing, invalid, `vcm_primary_compare`, and `vcm_only` resolve to legacy serving; diagnostic logging is best effort.                                                              | Removing candidate traffic removes all exposure to the candidate code.                            |
| A2A shadow comparison          | First A2A app/cache build per isolate/config key while mode is `shadow_compare` | Module-local memoized promise only; no D1/R2/KV/queue/Workflow writes | None                                                                                        | None                                | Runs via `waitUntil` when available; comparison/projector/telemetry failures are contained. Existing unsigned card is compared; legacy signed response is served.                  | Return to 0% immediately stops ordinary routing to new isolates; hard rollback removes candidate. |
| MCP shadow comparison          | Valid `tools/list` request while mode is `shadow_compare`                       | Request/response clones and in-memory model cache only                | None; service handlers and payment path are unchanged                                       | None                                | Real MCP response is created first and returned independently. Malformed/unrecognized observation fails closed. Comparison/projector/telemetry failures cannot alter the response. | Same as A2A.                                                                                      |
| VCM runtime model              | Called only by the two shadow paths                                             | Module-local cache only                                               | Reads governed price facts in memory but never quotes, signs, charges, settles, or executes | None                                | Static JSON is bundled at build time; no runtime filesystem or network. Projection is pure.                                                                                        | No durable state to unwind.                                                                       |
| Metadata telemetry             | A2A/MCP comparison                                                              | Platform log emission only                                            | None                                                                                        | Cloudflare's existing log sink only | Logs bounded event name, surface, count/domain; never projections, request bodies, signatures, or secrets. Logging exceptions are caught.                                          | No data migration or cleanup.                                                                     |
| Build/test wiring              | Bundle and local tests                                                          | None at request time                                                  | None                                                                                        | None                                | Makes VCM importable; no route semantics of its own.                                                                                                                               | None.                                                                                             |

`packages/vcm/src` contains no runtime `fetch`, binding access, database write,
queue send, Workflow create, R2/KV write, signing, settlement, or provider call.
Registry JSON is imported statically and bundled. The effective view is memoized
per isolate.

### R3-specific and scheduled-path proof

Commit `42be7e9` changed only:

- `apps/edge-api/src/routes/mcp.ts`;
- `apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts`; and
- `apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts`.

The following evidence commit changed only the report. No R3 commit changed
`scheduled()`, owner-intent recovery, artifact reclamation, D1, R2, queue,
Workflow, alert, payment, or provider code.

The prior cron safety suite was rerun during 07B: 5 files and 45 tests passed.
The candidate's scheduled code is byte-identical to the stable-lineage code for
the scheduled entry and both scheduled jobs.

```text
CANDIDATE_VS_PRODUCTION_TOTAL_DIFF_AUDITED=YES
SHADOW_MODE_LEGACY_SERVING_CONFIRMED=YES
ECONOMIC_SIDE_EFFECT_DELTA=NONE
STATEFUL_SIDE_EFFECT_DELTA=NONE
R3_SCHEDULED_PATH_CHANGE=NO
```

## D. Traffic-volume evidence and limitations

### Available evidence

Historical account analytics are unavailable to the active Wrangler OAuth scope.
Previous SITEBORNE checkpoints established that a dedicated Workers
Observability token could query stored telemetry, but those temporary tokens
were deleted and no such credential is present in this process. No token was
created, recovered, or requested for 07B.

Two existing read-only evidence windows are useful but do not support a precise
long-run forecast:

1. A prior 334-second live canary tail captured 190 invocations. Eighty-one were
   a controlled sampler, leaving approximately 109 other invocations in that
   bounded window, or about 1,175 per hour if naively annualized. That number is
   a short-window observation, not a stable traffic rate.
2. 07B attached a passive, version-filtered tail to the 100%-serving stable
   version for a bounded current window. It generated no traffic. The final
   sanitized aggregate is recorded below. Raw client IP, TLS, and unrelated
   request headers were not copied into this report.

```text
07B_PASSIVE_TAIL_DURATION=AT_LEAST_600_SECONDS;_EVENT_SPAN=569.057_SECONDS
07B_PASSIVE_HTTP_INVOCATIONS=13
07B_PASSIVE_SCHEDULED_INVOCATIONS=10
07B_PASSIVE_A2A_REQUESTS=0
07B_PASSIVE_MCP_REQUESTS=13
07B_PASSIVE_OUTCOMES=23_OK;_0_NON_OK;_0_EXCEPTIONS
07B_PASSIVE_HTTP_STATUS_COUNTS={200:6,202:3,400:2,405:1,406:1}
```

The current window shows that MCP arrives in bursts and that A2A can be absent
from a short observation window. Health and unrelated traffic can therefore make
a low-percentage canary look active even when neither semantic surface has
enough evidence. Exact recent A2A volume remains below measurement resolution;
it is reported as **not estimable**, not zero. Exact long-run MCP volume is also
not estimable from one burst.

### Mathematical exposure model

For independently routed HTTP requests, if a surface's stable traffic rate is
`lambda` requests/hour and candidate share is `p`, its expected candidate rate
is:

```text
lambda_candidate = p * lambda
expected_time_for_n = n / (p * lambda)
```

This is an expectation under random routing, not a guarantee. Bursty clients,
tail sampling, cache reuse, and an unknown A2A discovery cadence increase
variance. In particular, one A2A comparison occurs at the app/cache-build point,
not necessarily once per A2A HTTP request. MCP comparison occurs only for a
valid `tools/list` response.

### Percentage options

The table uses an intentionally broad total-traffic evidence band: the
annualized 07B passive sample at its low end and the older non-sampler
short-window observation at its high end. A2A remains unestimable; MCP uses only
the current passive burst as a scenario, not a forecast.

| Candidate share | Estimated total candidate requests/hour | Estimated A2A comparisons/hour        | MCP candidate requests/hour from current sample scenario | Time to 100 total candidate requests | Blast radius                                                      | Decision                                                                                                                                     |
| --------------: | --------------------------------------: | ------------------------------------- | -------------------------------------------------------: | ------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
|            0.5% |                               0.39–5.88 | Not estimable                         |                                                     0.39 | About 17–256 hours                   | Very small                                                        | Reject: likely to produce false reassurance from health/unrelated traffic while leaving both semantic gates empty.                           |
|              1% |                              0.78–11.75 | Not estimable                         |                                                     0.78 | About 8.5–128 hours                  | Small                                                             | Reject: prior 1% evidence needed hundreds of controlled requests to obtain five candidate samples; organic A2A/MCP evidence would be slower. |
|              2% |                               1.56–23.5 | Not estimable                         |                                                     1.56 | About 4.3–64 hours                   | Small                                                             | Reject for the first stage: improves total sampling but remains weak for rare A2A and bursty MCP within a bounded day.                       |
|              5% |                               3.9–58.75 | Not estimable                         |                                                      3.9 | About 1.7–25.6 hours                 | Moderate-low                                                      | Reject: the sparse scenario does not reach 100 candidate requests within the 24-hour cap.                                                    |
|         **10%** |                           **7.8–117.5** | **Not estimable; count gate governs** |                                                  **7.8** | **About 0.85–12.8 hours**            | **Bounded at one request in ten; only A2A/MCP add observer work** | **Accept: first share whose sparse-scenario total count fits the 12–24 hour envelope, without exposing a serving-authority change.**         |

The older high-rate observation makes total-request thresholds easy at every
share, while the current sparse observation makes shares below 10% operationally
poor. This disagreement is precisely why the decision uses event-count gates and
a maximum duration instead of a single point forecast.

```text
RECENT_REQUEST_VOLUME=13_HTTP_IN_AT_LEAST_600_SECONDS;_APPROX_78_PER_HOUR_SHORT_WINDOW_SCENARIO;_NOT_A_LONG_RUN_RATE
RECENT_A2A_VOLUME=0_OBSERVED_IN_BOUNDED_SAMPLE;_RATE_NOT_ESTIMABLE
RECENT_MCP_VOLUME=13_IN_AT_LEAST_600_SECONDS;_APPROX_78_PER_HOUR_SHORT_WINDOW_SCENARIO;_BURSTY
```

## E. First-canary percentage decision

**Recommendation: 90% stable / 10% R3 candidate.**

Ten percent is justified by the combination of:

- sparse, bursty surface traffic and no observed A2A request in the bounded
  current sample;
- the need to observe both semantic comparators organically;
- the candidate's already-passed zero-percent live A2A and MCP comparisons;
- legacy responses remaining authoritative and independently served;
- absence of any new economic, storage, provider, handler, signing, or scheduled
  behavior;
- both versions having `PAID_ROUTES_ENABLED=false`; and
- immediate precomputed return-to-zero and hard-rollback paths.

Fractional shares are technically supported, but 0.5%, 1%, 2%, and 5% would
optimize for nominal blast radius while making the actual A2A/MCP evidence
unreasonably slow or indeterminate. Ten percent still bounds candidate exposure
to one in ten independently routed HTTP requests and does not expose any VCM
output as the served authority.

## F. Observation window and count gates

### Required first-stage envelope

At activation time, record an exact UTC `CANARY_START_TIME`. The other times are
derived mechanically:

```text
CANARY_START_TIME=<captured immediately after deployment readback>
EARLIEST_PASS_TIME=CANARY_START_TIME+12h
MAXIMUM_CANARY_DURATION=24h
MINIMUM_TOTAL_CANDIDATE_REQUESTS=100
MINIMUM_A2A_COMPARE_COUNT=10
MINIMUM_MCP_COMPARE_COUNT=10
```

The 12-hour minimum covers many one-minute scheduled cycles, a meaningful part
of a normal traffic day, and multiple opportunities for machine discovery. The
24-hour cap covers a full daily cycle without allowing an indefinite canary.
Neither threshold is a statistical confidence claim.

At 24 hours:

- if all count and health gates passed, the stage may be closed as PASS;
- if the system is healthy but any count is short, the result is
  `INSUFFICIENT_EVIDENCE`, not PASS; return to 0% unless a human separately
  authorizes another bounded observation stage;
- if a stop condition fired, execute the already-authorized rollback class for
  that future checkpoint and verify it read-only.

Operator-generated version-override probes validate observability and exact
version reachability but do **not** count toward the organic minimum comparison
counts. They are labeled separately.

## G. Version-attributed observability plan

### Before any mutation

1. Verify local/remote source provenance and current `100/0` deployment.
2. Reinspect both version configurations, binding names, runtime compatibility,
   and `PAID_ROUTES_ENABLED=false`.
3. Start a candidate-only JSON tail and wait for the connection to be ready.
4. Start a stable-only JSON tail when concurrent baseline comparison is needed.
5. Capture 60 minutes of pre-canary stable route/method/status latency baseline
   if a recent equivalent window is unavailable.
6. Run exact candidate-override A2A and MCP probes and prove candidate
   `scriptVersion.id`, compare telemetry, and match telemetry.
7. Stop. Present exactly one activation mutation command to the human.

### During the canary

Keep the candidate tail continuous. Store its raw JSON only in a local,
access-controlled temporary evidence file. Derive a sanitized aggregate with:

- start/end timestamps and capture gaps;
- `scriptVersion.id`;
- event type (`fetch` or `scheduled`);
- HTTP method, normalized path family, and response status;
- Worker outcome and exception count;
- CPU and wall time;
- each metadata compare/match/mismatch/fallback/error event by surface; and
- no client IP, TLS fingerprint, authorization header, cookie, request body,
  secret, signing material, or full projection.

Poll deployment status independently after activation, at the earliest-pass
time, before any promotion decision, and after any rollback. Ordinary public
probes run without overrides. Exact candidate probes use the override header and
require log attribution because an unapplied override falls back to normal
routing.

Workers Logs may supplement the bounded tail when the existing read-only query
identity is available, but it is not the sole evidence channel. A head sampling
rate of 1 means every request is selected before platform limits; it does not
eliminate retention, quota, truncation, tail sampling, or query-access
constraints.

No Version Metadata binding, Logpush destination, Tail Worker, analytics
storage, or new telemetry infrastructure is required.

## H. Success criteria

### Deployment integrity

- Active deployment contains exactly stable `38cb...` at 90% and candidate
  `1a3e...` at 10%.
- Candidate source/tag/config remains the qualified R3 artifact.
- No third version, route, domain, trigger, secret, variable, binding, runtime,
  or compatibility change appears.

### Candidate exceptions and outcomes

- No candidate-attributable unhandled exception.
- No new candidate-attributable non-`ok` Worker outcome.
- Canceled client requests and isolated network failures are classified before a
  decision; they are not silently treated as product failures or success.

### A2A semantic gate

```text
A2A compare events >= 10
for every A2A compare: exactly one match event
A2A mismatch events = 0
A2A fallback events = 0
A2A compare-error events = 0
candidate Agent Card HTTP status/content type/signature behavior = qualified baseline
```

Because A2A comparison is scheduled at cache construction, its compare count is
an isolate/cache-build count, not a raw request count. The raw A2A request count
is recorded separately.

### MCP semantic and R2-regression gate

```text
MCP tools/list compare events >= 10
for every MCP compare: exactly one match event
MCP mismatch events = 0
MCP fallback events = 0
MCP compare-error events = 0
valid application/json and SSE tools/list responses do not bypass comparison
served response remains the six-tool legacy response
```

At least one separately labeled exact-candidate probe must reproduce the live
`application/json` JSON-RPC shape that exposed R2, and its invocation must
contain both MCP compare and match telemetry. Organic counts must still meet the
minimum independently.

### HTTP behavior

- Candidate has no systemic unexpected 5xx increase relative to route-, method-,
  and status-class-matched stable traffic in the same window.
- Expected 4xx responses from malformed, unauthorized, unsupported, or
  payment-required requests are classified by contract; a universal zero-4xx
  rule is invalid.
- Ordinary `/health`, `/ready`, and `/.well-known/mcp-registry-auth` remain
  HTTP 200.

### Latency and resource overhead

**Baseline:** a 60-minute stable-only pre-window plus concurrent stable-version
events from the same canary window, matched by surface, method, and successful
status. Record wall time and CPU time separately.

**Minimum sample:** at least 30 successful candidate HTTP invocations for each
of A2A and MCP, in addition to 100 candidate invocations overall. If 30 per
surface are unavailable by 24 hours, latency remains insufficiently evidenced
even if semantic counts passed.

**Operational bound:** for both wall and CPU time, candidate p95 must be no
greater than concurrent stable p95 plus the largest of:

- two stable interquartile ranges;
- 25% of stable p95; or
- 25 ms for wall time / 5 ms for CPU time.

Candidate median must also remain within one stable interquartile range plus 10%
of stable median. These bounds scale with measured baseline variance and include
an absolute noise allowance. Crossing a bound is `PAUSE_AND_INVESTIGATE` unless
accompanied by systemic 5xx, exceptions, resource exhaustion, or a clear
candidate causal link, which makes it an immediate rollback condition.

### Cron, economics, configuration, and security

- No scheduled exception attributable to R3 and no durable corruption.
- No required Cron version ratio; observed version attribution is evidence, not
  an expected probability.
- `PAID_ROUTES_ENABLED=false` on both active versions.
- No paid probe, quote execution, signature, charge, settlement, payment
  invocation, or economic state mutation is required.
- No unexpected auth relaxation, secret material in logs, or externally visible
  metadata-semantic change.

## I. Fail-fast and rollback matrix

| Class                 | Signal                                                                                                                                                                                                           | Required evidence                                                                                 | Action                                                                                                                | Human confirmation                                                                                                                  | Immediate?                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| IMMEDIATE_ROLLBACK    | Any A2A or MCP `metadata_projection_mismatch_total`                                                                                                                                                              | Candidate-attributed structured event; preserve bounded difference count/domain                   | Execute the pre-authorized return-to-zero command; use hard rollback if integrity/security requires candidate removal | The future activation authorization should explicitly pre-authorize return-to-zero for these conditions; no extra confirmation then | Yes                         |
| IMMEDIATE_ROLLBACK    | Valid candidate MCP `tools/list` returns successfully but again emits no compare event after tail completeness is established                                                                                    | Same-invocation request/response plus absence of compare/match; exclude tail sampling/capture gap | Return candidate to 0%; investigate observer                                                                          | Same pre-authorization rule                                                                                                         | Yes                         |
| IMMEDIATE_ROLLBACK    | Candidate-only unhandled exception, non-`ok` outcome, or systemic unexpected 5xx causally linked to R3                                                                                                           | Version-attributed tail/stored log and route/status classification                                | Return to 0%; hard rollback if continuing active membership is unsafe                                                 | Same pre-authorization rule                                                                                                         | Yes                         |
| IMMEDIATE_ROLLBACK    | `PAID_ROUTES_ENABLED` not false, economic action, secret/config/resource drift, auth regression, signature regression, protocol incompatibility, corruption/race evidence, or scheduled durable-safety violation | Readback plus attributed event/state evidence                                                     | Hard rollback to stable 100%; stop                                                                                    | Same pre-authorization rule                                                                                                         | Yes                         |
| PAUSE_AND_INVESTIGATE | Latency/CPU bound crossed without errors or resource exhaustion                                                                                                                                                  | Minimum sample, concurrent route-matched stable baseline, no capture gap                          | Freeze at current percentage; do not promote; investigate. Return to 0% if causal or unresolved by maximum duration   | Human decision required unless the future checkpoint pre-authorizes timeout return-to-zero                                          | No, absent stronger signals |
| PAUSE_AND_INVESTIGATE | Counts short at 24 hours, comparison telemetry gap explainable by insufficient qualifying traffic, or tail/Workers Logs capture gap                                                                              | Count ledger and capture-health evidence                                                          | Declare `INSUFFICIENT_EVIDENCE`; do not pass or promote; return to 0% unless a new window is authorized               | Yes for any new window or increased share                                                                                           | No product-failure claim    |
| PAUSE_AND_INVESTIGATE | Isolated candidate 5xx with unclear cause                                                                                                                                                                        | Version-attributed event, request class, nearby stable baseline                                   | Investigate immediately; roll back if repeated/systemic or candidate-caused                                           | Human unless repeated condition was pre-authorized                                                                                  | Context-dependent           |
| NON_BLOCKING_NOISE    | Expected 400/401/402/404/406 response, client cancellation, malformed request, isolated Internet failure, or known tail sampling warning                                                                         | Contract/status classification and no candidate regression pattern                                | Record; exclude from semantic success count; continue                                                                 | No                                                                                                                                  | No                          |
| NON_BLOCKING_NOISE    | Cron appears only on stable, only on candidate, alternates, or overlaps                                                                                                                                          | Version-attributed scheduled events with safe outcomes                                            | Record without ratio judgment                                                                                         | No                                                                                                                                  | No                          |
| NON_BLOCKING_NOISE    | Accepted duplicate content-free storage-alert notification during a real storage outage, with no durable corruption                                                                                              | Alert and storage-failure evidence matching prior accepted limitation                             | Record and investigate operationally                                                                                  | No automatic rollback unless coupled to corruption or R3 change                                                                     | No                          |

## J. Cron-specific canary design

The authoritative METADATA-VCM-07 report and its source/tests were reread. Its
result remains:

```text
CRON_SAFETY_RESULT=SAFE_UNDER_ALL_ANALYZED_MODELS
CRON_VERSION_SELECTION_DURING_SPLIT=UNDOCUMENTED
```

The proof covers stable-only, candidate-only, nondeterministic assignment,
overlap, concurrent execution, and retries:

- owner recovery uses a deterministic Workflow ID;
- it attempts `get`, falls back to `create`, and repairs a create race by
  calling `get` again;
- D1 transitions are guarded by pending-status compare-and-set updates;
- each scheduled tick performs a stateless full rescan, so no version owns
  progress that another can lose;
- artifact reclamation deletes R2 before D1 and treats already-missing objects
  and rows idempotently; a failed R2 delete leaves D1 for retry; and
- scheduled paths perform no payment, quote, signing, settlement, or provider
  operation.

Fresh 07B regression evidence is 45/45 PASS across the lifecycle race/mutation,
artifact-reclamation, scheduled-wrapper, and export-shape suites. R3 touched no
scheduled source.

During the canary, capture every available scheduled event's version, cron
expression, outcome, exceptions, CPU/wall time, and bounded job telemetry. The
canary passes the Cron gate when:

- at least one scheduled event is observed during the window on any active
  version;
- no scheduled exception or durable corruption is attributable to R3;
- owner-recovery and reclamation invariants remain intact; and
- no version-ratio assumption is used.

Candidate scheduled events at a 10% HTTP share are neither required nor
suspicious. Stable-only and candidate-only Cron observations are both allowed.

The accepted limitation remains: during a real storage outage, concurrent
scheduled versions could produce duplicate content-free storage-alert
notifications. This is non-economic, is already possible with repeated
one-minute execution, and is not durable corruption.

## K. Version-affinity decision

```text
VERSION_AFFINITY_REQUIRED=NO
```

SITEBORNE should retain Cloudflare's independent request-level sampling for this
shadow canary:

- Agent Card discovery is a stateless GET.
- The edge MCP route constructs a fresh MCP Hono app for each HTTP request; the
  compared `tools/list` exchange is self-contained in one request/response.
- Both versions intentionally expose the same public contract and the candidate
  changes observation, not handlers or served definitions.
- Paid routes are disabled on both versions.
- Organic random routing is desirable because the canary is measuring ordinary
  machine traffic, not preserving a new serving contract across a session.

MCP clients can issue initialize, notification, `tools/list`, and later tool
calls as a logical sequence, but crossing versions does not create a contract
skew here: both versions serve the same six tools and handlers, and R3 changes
only post-response observation. Introducing an affinity header would require a
client, transform-rule, or runtime change, group traffic by a chosen key, and
reduce representative random sampling without a proven benefit.

[Version Affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)
also makes clear that the key is hashed to a version; it does not directly
select one. Exact candidate probes should continue to use version overrides, not
affinity.

## L. Economic and stateful side-effect analysis

The total candidate delta is observational for the enabled modes:

```text
ECONOMIC_SIDE_EFFECT_DELTA=NONE
STATEFUL_SIDE_EFFECT_DELTA=NONE
EXTERNAL_PROVIDER_INVOCATION_DELTA=NONE
PUBLIC_METADATA_SEMANTIC_DELTA=NONE
```

The candidate may consume extra CPU/memory for projection, comparison, response
cloning, and structured logs on A2A/MCP qualifying requests. Those are resource
effects and are measured by the latency/CPU gate. They are not durable or
economic side effects.

The MCP real server and all service/payment handlers run before and
independently of observation. The A2A signer remains downstream of the unchanged
legacy card; VCM never receives signing secrets. No current VCM result can be
returned to a client because `runShadowComparison()` returns `Promise<void>` and
every authorized serving mode resolves to `legacy` or `shadow_compare`.

## M. Exact precomputed future commands

**None of the commands in this section was executed in 07B.** The three marked
mutation commands are mutually exclusive human actions. A future activation
checkpoint must complete read-only preflight, stop, present exactly one mutation
command, explain its invariant, have the human run it, inspect the output, and
independently read back the state before continuing.

### Read-only deployment status

```bash
pnpm exec wrangler deployments list \
  --profile storage-alert-bootstrap \
  --name siteborne-utility-edge \
  --json
```

### MUTATION — first 10% activation (do not run in 07B)

```bash
pnpm exec wrangler versions deploy \
  --profile storage-alert-bootstrap \
  38cbf4dd-52fd-4afc-ad34-626a2e6454d3@90% \
  1a3ea07b-5885-49d2-9cd0-d176c4313bd0@10% \
  --name siteborne-utility-edge \
  --message "METADATA-VCM-07B-ACTIVATION: bounded 90/10 legacy-serving A2A/MCP shadow canary" \
  -y
```

Expected invariant after independent readback: exactly the qualified stable and
R3 versions remain active; only their percentages change to 90/10.

### MUTATION — temporary abort / return to 0% (do not run in 07B)

```bash
pnpm exec wrangler versions deploy \
  --profile storage-alert-bootstrap \
  38cbf4dd-52fd-4afc-ad34-626a2e6454d3@100% \
  1a3ea07b-5885-49d2-9cd0-d176c4313bd0@0% \
  --name siteborne-utility-edge \
  --message "METADATA-VCM-07B-ABORT: return R3 shadow candidate to zero percent" \
  -y
```

Use this when the canary should stop but preserving the exact candidate in the
active deployment for read-only override diagnosis is safe and useful.

### MUTATION — hard rollback (do not run in 07B)

```bash
pnpm exec wrangler rollback \
  --profile storage-alert-bootstrap \
  38cbf4dd-52fd-4afc-ad34-626a2e6454d3 \
  --name siteborne-utility-edge \
  --message "METADATA-VCM-07B-ROLLBACK: replace split with qualified stable at 100 percent" \
  -y
```

Use this for integrity, security, economic, configuration, or durable-state
conditions where the candidate should be removed from the active deployment.
Cloudflare creates a new single-version deployment at stable 100%.

### Candidate-only and stable-only live tails

```bash
pnpm exec wrangler tail siteborne-utility-edge \
  --profile storage-alert-bootstrap \
  --version-id 1a3ea07b-5885-49d2-9cd0-d176c4313bd0 \
  --format json
```

```bash
pnpm exec wrangler tail siteborne-utility-edge \
  --profile storage-alert-bootstrap \
  --version-id 38cbf4dd-52fd-4afc-ad34-626a2e6454d3 \
  --format json
```

### Exact candidate A2A override probe

```bash
curl --fail-with-body --silent --show-error \
  -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="1a3ea07b-5885-49d2-9cd0-d176c4313bd0"' \
  -D /tmp/metadata-vcm-07b-a2a.headers \
  -o /tmp/metadata-vcm-07b-a2a.json \
  https://utility.siteborne.net/.well-known/agent-card.json
```

The tail must prove the exact candidate version plus A2A compare and match.

### Exact candidate MCP `tools/list` override probe

```bash
curl --fail-with-body --silent --show-error \
  -X POST \
  -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="1a3ea07b-5885-49d2-9cd0-d176c4313bd0"' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  --data '{"jsonrpc":"2.0","id":"metadata-vcm-07b-probe","method":"tools/list","params":{}}' \
  -D /tmp/metadata-vcm-07b-mcp.headers \
  -o /tmp/metadata-vcm-07b-mcp.json \
  https://utility.siteborne.net/mcp
```

The response must be JSON-RPC 2.0 with exactly the six qualified tools. The tail
must prove candidate attribution plus MCP compare and match. The probe is
metadata-only and invokes no tool.

### Ordinary public probes without overrides

```bash
curl --fail-with-body --silent --show-error -o /dev/null \
  https://utility.siteborne.net/health
curl --fail-with-body --silent --show-error -o /dev/null \
  https://utility.siteborne.net/ready
curl --fail-with-body --silent --show-error -o /dev/null \
  https://siteborne.net/.well-known/mcp-registry-auth
```

## N. Multi-stage shadow-canary ladder

Every row is a separate checkpoint and separate human-authorized mutation. There
is no automatic promotion. Counts reset at the start of each stage and cannot be
stitched across stages.

| Stage                   | Stable / candidate | Minimum / maximum duration | Minimum candidate HTTP |              A2A / MCP compares | Latency sample                                        | Scheduled gate                                                      | Promotion rule                                              | Rollback target                                  |
| ----------------------- | ------------------ | -------------------------- | ---------------------: | ------------------------------: | ----------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Qualified zero          | 100% / 0%          | Complete                   | Override-only evidence | Live A2A match / live MCP match | Local and exact-candidate live qualification          | Stable Cron observed; adversarial suite passed                      | 07B design plus separate human authorization                | Remain 100/0                                     |
| 1 — first organic       | **90% / 10%**      | **12h / 24h**              |                **100** |                     **10 / 10** | 30 successful candidate events per surface; §H bounds | At least one safe scheduled event on any version; no ratio required | Every §H gate passes; separate authorization for next stage | 100/0; hard rollback for severe class            |
| 2 — broader organic     | 75% / 25%          | 12h / 24h                  |                    250 |                         25 / 25 | 50 per surface; same baseline-relative bounds         | Same                                                                | Stage 1 closed PASS; fresh preflight and authorization      | 90/10 if investigation benefits, otherwise 100/0 |
| 3 — balanced split      | 50% / 50%          | 24h / 36h                  |                    500 |                         50 / 50 | 100 per surface                                       | Same across a full day                                              | Stage 2 PASS; fresh authorization                           | 75/25 or 100/0 as condition warrants             |
| 4 — full shadow runtime | 0% / 100%          | 24h / 48h                  |                  1,000 |                       100 / 100 | 200 per surface                                       | Same across a full day                                              | Stage 3 PASS; fresh authorization; still legacy-serving     | 50/50, 100/0, or hard rollback                   |

If traffic cannot meet a row's count floor within its maximum duration, that row
is `INSUFFICIENT_EVIDENCE`. Increasing traffic is not automatic; the operator
first returns to the checkpoint's governed state and requests a new
authorization.

## O. What follows a successful shadow canary

A complete shadow-canary ladder would prove that the current legacy-serving
runtime and VCM shadow projections agree under real traffic. It would not make
VCM authoritative.

The next architectural checkpoint should be a **design-only
`vcm_primary_compare` serving transition**. Before any implementation or traffic
mutation, it must prove:

- VCM becomes the candidate producer while legacy output remains the explicit
  comparison/reference path;
- mismatch and projector failures have a governed fail-closed or safe-fallback
  behavior;
- A2A signing occurs only after the selected VCM projection is substituted;
- MCP VCM definitions bind to the existing handlers without replacing or
  changing them;
- economic, authorization, signing, and protocol semantics remain unchanged;
- served-output, mismatch, and rollback observability is complete; and
- a precise return-to-legacy command and state invariant exist.

Only after that layer passes could `vcm_only` or metadata authority inversion be
considered. This report ends at `SHADOW_CANARY_DESIGN`.

## P. Validation and no-mutation attestation

Before the report-only commit, this checkpoint verifies:

- report formatting;
- `git diff --check`;
- diff stat and full path list;
- the working-tree delta is this report only;
- no runtime/config/registry/governance/contract/secret-bearing file changed;
- fresh deployment readback remains stable 100% / candidate 0%; and
- no mutation command in this report was run.

```text
PRODUCTION_MUTATIONS=0
TRAFFIC_MUTATIONS=0
DEPLOYMENTS_CREATED=0
VERSIONS_UPLOADED=0
TRIGGER_MUTATIONS=0
ROUTE_DOMAIN_MUTATIONS=0
VARIABLE_MUTATIONS=0
SECRET_MUTATIONS=0
RUNTIME_SOURCE_MUTATIONS=0
ECONOMIC_MUTATIONS=0
VCM_PRIMARY_SERVING=NO
AUTHORITY_INVERSION=NO
```

## Q. Final decision block

```text
METADATA_VCM_07B=PASS
DESIGN_RESULT=BOUNDED_10_PERCENT_LEGACY_SERVING_SHADOW_CANARY_DESIGNED;_NOT_ACTIVATED
CURRENT_STABLE_VERSION=38cbf4dd-52fd-4afc-ad34-626a2e6454d3
CURRENT_CANDIDATE_VERSION=1a3ea07b-5885-49d2-9cd0-d176c4313bd0
CURRENT_STABLE_PERCENT=100%
CURRENT_CANDIDATE_PERCENT=0%

CANDIDATE_VS_PRODUCTION_TOTAL_DIFF_AUDITED=YES
SHADOW_MODE_LEGACY_SERVING_CONFIRMED=YES
ECONOMIC_SIDE_EFFECT_DELTA=NONE
STATEFUL_SIDE_EFFECT_DELTA=NONE

CLOUDFLARE_TWO_VERSION_LIMIT_VERIFIED=YES
PERCENTAGE_GRANULARITY=DECIMAL_SUPPORTED_BY_WRANGLER_4.119.0;_API_MIN_NONZERO_0.01;_WHOLE_PERCENT_SELECTED
VERSION_OVERRIDE_VERIFIED=YES
ROLLBACK_SEMANTICS_VERIFIED=YES
CRON_VERSION_SELECTION_DURING_SPLIT=UNDOCUMENTED

RECENT_REQUEST_VOLUME=13_HTTP_IN_AT_LEAST_600_SECONDS;_APPROX_78_PER_HOUR_SHORT_WINDOW_SCENARIO;_NOT_A_LONG_RUN_RATE
RECENT_A2A_VOLUME=0_OBSERVED_IN_BOUNDED_SAMPLE;_RATE_NOT_ESTIMABLE
RECENT_MCP_VOLUME=13_IN_AT_LEAST_600_SECONDS;_APPROX_78_PER_HOUR_SHORT_WINDOW_SCENARIO;_BURSTY

RECOMMENDED_FIRST_CANARY_PERCENT=10%
RECOMMENDED_FIRST_CANARY_STABLE_PERCENT=90%
MINIMUM_CANARY_DURATION=12_CONTINUOUS_HOURS
MAXIMUM_CANARY_DURATION=24_HOURS
MINIMUM_TOTAL_CANDIDATE_REQUESTS=100
MINIMUM_A2A_COMPARE_COUNT=10
MINIMUM_MCP_COMPARE_COUNT=10

VERSION_AFFINITY_REQUIRED=NO
VERSION_AFFINITY_RATIONALE=STATELESS_METADATA_AND_PER_REQUEST_MCP;_SAME_PUBLIC_CONTRACT;_R3_OBSERVER_ONLY;_RANDOM_SAMPLING_DESIRED

A2A_PASS_GATE=AT_LEAST_10_COMPARES;_COMPARE_EQUALS_MATCH;_ZERO_MISMATCH_FALLBACK_OR_ERROR;_QUALIFIED_HTTP_SIGNATURE_BEHAVIOR
MCP_PASS_GATE=AT_LEAST_10_TOOLS_LIST_COMPARES;_COMPARE_EQUALS_MATCH;_ZERO_MISMATCH_FALLBACK_OR_ERROR;_JSON_AND_SSE_OBSERVATION_VALID
HTTP_PASS_GATE=NO_CANDIDATE_SYSTEMIC_UNEXPECTED_5XX;_EXPECTED_4XX_CLASSIFIED;_PUBLIC_HEALTH_READY_REGISTRY_AUTH_200
EXCEPTION_PASS_GATE=ZERO_CANDIDATE_ATTRIBUTABLE_UNHANDLED_EXCEPTIONS_OR_NEW_NON_OK_OUTCOMES
LATENCY_PASS_GATE=MIN_30_SUCCESSFUL_CANDIDATE_EVENTS_PER_SURFACE;_BASELINE_RELATIVE_MEDIAN_AND_P95_BOUNDS_IN_SECTION_H
CRON_PASS_GATE=NO_R3_ATTRIBUTABLE_SCHEDULED_EXCEPTION_OR_DURABLE_CORRUPTION;_NO_VERSION_RATIO_REQUIRED
ECONOMIC_PASS_GATE=PAID_ROUTES_ENABLED_FALSE_ON_BOTH;_ZERO_PAID_PROBES_OR_ECONOMIC_EFFECTS

IMMEDIATE_ROLLBACK_CONDITIONS=ANY_A2A_OR_MCP_MISMATCH;_VALID_TOOLS_LIST_BYPASSES_COMPARE;_CANDIDATE_UNHANDLED_EXCEPTION_OR_SYSTEMIC_5XX;_ECONOMIC_CONFIG_SECURITY_SIGNATURE_PROTOCOL_OR_DURABLE_STATE_VIOLATION
PAUSE_INVESTIGATE_CONDITIONS=LATENCY_BOUND;_ISOLATED_UNCLASSIFIED_FAILURE;_CAPTURE_GAP;_INSUFFICIENT_EVENT_COUNTS_BY_24H
NON_BLOCKING_NOISE=EXPECTED_CONTRACT_4XX;_CLIENT_CANCEL_OR_ISOLATED_NETWORK_FAILURE;_ANY_SAFE_CRON_VERSION_DISTRIBUTION;_ACCEPTED_CONTENT_FREE_DUPLICATE_STORAGE_ALERT_LIMITATION

RETURN_TO_ZERO_COMMAND_PRECOMPUTED=YES;_NOT_EXECUTED
HARD_ROLLBACK_COMMAND_PRECOMPUTED=YES;_NOT_EXECUTED
CANARY_ACTIVATION_COMMAND_PRECOMPUTED=YES;_NOT_EXECUTED

PRODUCTION_MUTATIONS=0
TRAFFIC_MUTATIONS=0
RUNTIME_SOURCE_MUTATIONS=0
VCM_PRIMARY_SERVING=NO
AUTHORITY_INVERSION=NO

REPORT_PATH=docs/reports/METADATA-VCM-07B-bounded-a2a-mcp-canary-activation-design.md
REPORT_ONLY_COMMIT=THE_GIT_COMMIT_CONTAINING_THIS_REPORT;_SHA_RETURNED_BY_CHECKPOINT
WORKING_TREE=CLEAN_AFTER_REPORT_ONLY_COMMIT

SAFE_TO_REQUEST_HUMAN_CANARY_AUTHORIZATION=YES
NEXT_CHECKPOINT_RECOMMENDATION=METADATA-VCM-07C_HUMAN_AUTHORIZED_90_10_SHADOW_CANARY_ACTIVATION_AND_BOUNDED_OBSERVATION
```
