# METADATA-VCM-07C-R1 — Pre-Cutover Canary Reclassification and Closure

**Checkpoint:** METADATA-VCM-07C-R1

**Mode:** report and evidence only

**Date:** 2026-09-16

**Result:** PASS

**Corrected classification:**
`PRE_CUTOVER_DEPLOYMENT_MECHANICS_AND_SHADOW_RUNTIME_QUALIFICATION`

## Executive conclusion

METADATA-VCM-07C is closed as a successful pre-cutover deployment-mechanics and
shadow-runtime qualification. It is not a completed organic production canary.

The original 12–24 hour observation design assumed that traffic reaching the
public Worker was an established, representative production workload. The
corrected fact is that SITEBORNE has not completed its real production cutover.
Current traffic can include controlled probes, scanners, directories, bots,
health checks, incidental discovery, and other pre-cutover traffic. Waiting for
that population to satisfy production-canary counts would not prove the
post-cutover behavior the gate was intended to measure.

This correction changes the interpretation of the 07C window. It does not
discard its technical evidence. The exact 90/10 split deployed successfully, the
candidate remained legacy-serving and shadow-only, public smoke probes passed,
candidate-attributed fetch and scheduled events completed without exceptions,
and the human-authorized return to 100/0 succeeded. Earlier local, zero-percent,
semantic-parity, configuration, economic, and scheduled-safety proofs remain
authoritative.

The 07B duration and event thresholds are retained as historically coherent
policy choices for the assumption under which they were designed. They are
deferred to a new post-cutover canary design and do not block continued
pre-cutover VCM development. After the actual production cutover, a fresh
baseline and thresholds must be derived from real post-cutover traffic.

No runtime source, Worker version, deployment, traffic, secret, variable, route,
trigger, binding, price, projection mode, handler, or economic behavior was
changed by this report checkpoint.

## A. Original 07C intent

METADATA-VCM-07B designed the first nonzero deployment of the already-qualified
R3 candidate as:

```text
stable    38cbf4dd-52fd-4afc-ad34-626a2e6454d3 @ 90%
candidate 1a3ea07b-5885-49d2-9cd0-d176c4313bd0 @ 10%
```

07C was intended to observe ordinary public routing for 12–24 hours and require
both elapsed time and minimum candidate event counts. The proposed gates were:

```text
MINIMUM_CANARY_DURATION=12_CONTINUOUS_HOURS
MAXIMUM_CANARY_DURATION=24_HOURS
MINIMUM_TOTAL_CANDIDATE_REQUESTS=100
MINIMUM_A2A_COMPARE_COUNT=10
MINIMUM_MCP_COMPARE_COUNT=10
```

The candidate remained in:

```text
A2A_METADATA_PROJECTION_MODE=shadow_compare
MCP_METADATA_PROJECTION_MODE=shadow_compare
PAID_ROUTES_ENABLED=false
```

Legacy A2A content and legacy MCP definitions remained the served producers. VCM
generated only observational shadow projections. The canary never proposed
`vcm_primary_compare` or `vcm_only`.

## B. 07B design assumption and provenance

### Source provenance

| Fact                     | Value                                      |
| ------------------------ | ------------------------------------------ |
| Branch                   | `metadata-vcm-qualification`               |
| 07B report-only commit   | `90c6bcc55251de1523b686de0aeee0bf5f92bae3` |
| Local HEAD before R1     | `90c6bcc55251de1523b686de0aeee0bf5f92bae3` |
| Remote HEAD before R1    | `90c6bcc55251de1523b686de0aeee0bf5f92bae3` |
| Remote 07B provenance    | PASS                                       |
| R3 implementation commit | `42be7e9105356a12b4d6fddf9d823d872e12f25c` |
| R3 evidence source       | `91f3d62c38ff40fbc6fefff850be03564e33a051` |

The 07B design correctly accounted for sparse and bursty traffic by requiring
event counts in addition to elapsed time. Its percentage, count, and duration
logic was coherent if current organic traffic was the relevant production
population.

The assumption subsequently corrected was:

```text
traffic presently reaching the public Worker
  = established representative post-cutover production workload
```

That equality is false because the production cutover has not occurred. The
invalidated assumption is about the population being sampled, not about
Cloudflare routing, the candidate, the shadow comparators, or the rollback
mechanics.

## C. Exact 90/10 activation deployment

Cloudflare deployment history was reread during R1. It independently contains
the human-authorized activation:

| Fact          | Verified value                                                                     |
| ------------- | ---------------------------------------------------------------------------------- |
| Deployment ID | `3f031378-bd8f-4c6a-82e2-d695cac83571`                                             |
| Created       | `2026-09-16T21:03:19.371655Z`                                                      |
| Strategy      | `percentage`                                                                       |
| Message       | `METADATA-VCM-07C: human-authorized 90/10 legacy-serving shadow canary activation` |
| Stable        | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 90%                                      |
| Candidate     | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` at 10%                                      |

The split was read back after deployment. No new Worker version was uploaded.
The deployed candidate was the already-qualified immutable R3 version 95.

```text
NINETY_TEN_ACTIVATION_VERIFIED=YES
VCM_PRIMARY_SERVING_DURING_ACTIVATION=NO
AUTHORITY_INVERSION_DURING_ACTIVATION=NO
PAID_ROUTES_ENABLED_DURING_ACTIVATION=false
```

## D. Immediate public smoke evidence

Immediately after activation, ordinary public requests without a version
override returned:

| Endpoint                                              | Result                               |   Single observed wall time |
| ----------------------------------------------------- | ------------------------------------ | --------------------------: |
| `https://utility.siteborne.net/health`                | HTTP 200, `application/json`         | approximately 0.502 seconds |
| `https://utility.siteborne.net/ready`                 | HTTP 200, `application/json`         | approximately 0.498 seconds |
| `https://siteborne.net/.well-known/mcp-registry-auth` | HTTP 200, `text/plain;charset=UTF-8` | approximately 0.463 seconds |

These three values prove immediate endpoint availability after the split. They
are individual observations, not a statistical latency distribution and not a
post-cutover load qualification.

```text
IMMEDIATE_PUBLIC_SMOKE=PASS
STATISTICAL_LATENCY_QUALIFICATION=NO
```

## E. Candidate observation-pipeline evidence

### Initial snapshot

A candidate-only read-only tail was attached using version ID:

```text
1a3ea07b-5885-49d2-9cd0-d176c4313bd0
```

Its output was persisted locally at:

```text
/tmp/siteborne-vcm-07c-candidate-tail.log
```

The Wrangler tail and local `tee` processes were independently shown alive. The
initial snapshot was correctly classified:

```text
CAPTURE_EXISTS=True
CAPTURE_BYTES=0
CANDIDATE_EVENTS=0
A2A_COMPARE=0
A2A_MATCH=0
A2A_MISMATCH=0
MCP_COMPARE=0
MCP_MATCH=0
MCP_MISMATCH=0
SCHEDULED_EVENTS=0
NON_OK_OUTCOMES=0

CANARY_STATE=IN_PROGRESS
PASS=NO
FAIL=NO
EVIDENCE_STATUS=INSUFFICIENT_SO_FAR
```

Zero initial events was not a product failure.

### Sanitized closure aggregate

R1 parsed the accumulated local capture without printing or copying client IP,
TLS, authorization, cookie, body, or other sensitive diagnostic fields. The
capture contains 22 events attributed to the exact R3 candidate between
`2026-09-16T21:18:32.972Z` and `2026-09-16T22:14:38.923Z`, entirely within the
90/10 deployment window:

| Evidence                          |     Count |
| --------------------------------- | --------: |
| Total candidate events            |        22 |
| Fetch events                      |        17 |
| Scheduled events                  |         5 |
| `/mcp` fetches                    |        16 |
| `/.well-known/glama.json` fetches |         1 |
| HTTP 200 / 202                    |     2 / 6 |
| HTTP 400 / 404 / 405              | 4 / 1 / 4 |
| Worker `outcome=ok`               |        22 |
| Non-`ok` outcomes                 |         0 |
| Unhandled exceptions              |         0 |
| A2A compare / match / mismatch    | 0 / 0 / 0 |
| MCP compare / match / mismatch    | 0 / 0 / 0 |

The status mix is not treated as failure: the capture includes arbitrary
pre-cutover MCP traffic, and Worker outcomes remained `ok`. The capture does not
establish that any `/mcp` request was a valid `tools/list` exchange, so the
absence of MCP comparison telemetry is neither a semantic match nor proof that
the R3 observer skipped a supported response. There was no captured A2A Agent
Card request.

This aggregate proves candidate routing, ordinary handler execution, and
candidate scheduled execution during the split without an exception. It does not
satisfy the old A2A/MCP semantic event gates and is not representative
production-workload evidence.

```text
CANDIDATE_OBSERVATION_PIPELINE=PASS
CANDIDATE_EVENTS_CAPTURED=22
CANDIDATE_FETCH_OUTCOMES=17_OK
CANDIDATE_SCHEDULED_OUTCOMES=5_OK
CANDIDATE_UNHANDLED_EXCEPTIONS=0
OLD_A2A_EVENT_GATE_SATISFIED=NO
OLD_MCP_EVENT_GATE_SATISFIED=NO
ORGANIC_PRODUCTION_WORKLOAD_PROVEN=NO
```

## F. Corrected production-cutover fact

The governing correction is:

```text
REAL_PRODUCTION_CUTOVER=NO
ORGANIC_PRODUCTION_TRAFFIC_ESTABLISHED=NO
```

Traffic currently reaching SITEBORNE may contain:

- controlled probes;
- public scanners;
- protocol directories;
- bots;
- health checks;
- incidental machine discovery; and
- pre-cutover external traffic.

It must not be represented as an established population of post-cutover
customers or agents.

### Precise invalidation boundary

```text
INVALIDATED_ASSUMPTION=CURRENT_SPARSE_PUBLIC_TRAFFIC_IS_REPRESENTATIVE_POST_CUTOVER_PRODUCTION_DEMAND
```

This invalidates only the interpretation that accumulating 12–24 hours and the
07B event counts from the current traffic population would qualify real
post-cutover production behavior. It does not invalidate:

- the correctness of the candidate;
- exact version attribution;
- zero-percent semantic-parity results;
- Cloudflare percentage-deployment behavior;
- health during the split;
- scheduled-path safety;
- return-to-zero behavior; or
- any local/adversarial qualification result.

## G. Valid technical evidence preserved

All of the following remains authoritative:

1. Exhaustive R3 local qualification passed:
   - VCM 135/135;
   - A2A shadow 7/7 and A2A check 67/67;
   - focused MCP 19/19 and MCP check 164/164;
   - x402/Bazaar 532/532;
   - edge API 1557/1557;
   - typecheck 25/25;
   - lint 17/17;
   - changed-file formatting, diff, secret, and drift checks passed.
2. The two concurrent local timeouts were host-contention artifacts: both passed
   in isolation and the full edge suite passed single-worker.
3. Immutable R3 candidate construction, source provenance, bindings, runtime,
   secret-name inventory, and ordinary-variable parity passed.
4. Exact-candidate Cloudflare version overrides worked while the candidate was
   at 0% ordinary traffic.
5. Live A2A zero-percent comparison emitted candidate-attributed compare and
   match telemetry.
6. Live MCP zero-percent `tools/list` returned the governed six tools and
   emitted candidate-attributed compare and match telemetry.
7. R2 revealed a real observer representation defect: valid JSON-RPC
   `application/json` was served correctly but the observer parsed only SSE.
8. R3 repaired both JSON and SSE observation without changing the served MCP
   response, handlers, comparison semantics, or public tool definitions.
9. The R3 repair was proven live on the exact zero-percent candidate.
10. Public production non-regression probes passed after zero-percent
    qualification and immediately after 90/10 activation.
11. Economic/configuration invariants passed; both versions retained
    `PAID_ROUTES_ENABLED=false`, and no paid probe or economic action was
    required.
12. Multiversion scheduled-path safety was proven under stable-only,
    candidate-only, nondeterministic, concurrent, retry, and overlapping models
    using deterministic Workflow IDs, create-race repair, D1 compare-and-set,
    stateless rescans, and idempotent R2/D1 deletion ordering.
13. Real stable-version Cron execution was observed with `cron="* * * * *"` and
    `outcome="ok"`.
14. A real Cloudflare 90/10 percentage deployment was created and independently
    read back.
15. Public endpoints remained healthy immediately after activation.
16. The candidate received fetch and scheduled events during the split with 22
    `ok` outcomes and zero exceptions.
17. The human-authorized return-to-zero deployment was created and independently
    read back.

```text
VALID_07C_EVIDENCE_PRESERVED=YES
```

The known repository-wide Prettier baseline remains 269 unrelated, pre-existing
red files. It was not an R3 regression and is not rewritten by this report.

## H. Corrected classification

```text
ORIGINAL_CANARY_CLASSIFICATION=BOUNDED_ORGANIC_PRODUCTION_SHADOW_CANARY
CORRECTED_CANARY_CLASSIFICATION=PRE_CUTOVER_DEPLOYMENT_MECHANICS_AND_SHADOW_RUNTIME_QUALIFICATION
```

### What 07C demonstrated

- Cloudflare percentage deployment works for these exact versions.
- Stable and candidate can coexist in one active deployment.
- Human-authorized 90/10 activation and independent readback work.
- The candidate receives ordinary HTTP and scheduled invocations during a split.
- Public smoke surfaces remain healthy immediately after activation.
- The candidate remains legacy-serving.
- VCM remains observational and shadow-only.
- The candidate showed no unhandled exception in the captured split window.
- Return-to-zero works and preserves the candidate for zero-percent override
  inspection.
- No metadata authority inversion occurred.

### What 07C did not demonstrate

- sustained post-cutover production load;
- a representative customer or agent workload;
- real post-cutover A2A request frequency;
- real post-cutover MCP method distribution;
- a production latency or CPU distribution;
- economic workload under the actual production cutover;
- statistical behavior of organic production traffic; or
- satisfaction of the old A2A/MCP comparison-count gates.

The absence of those claims is a classification correction, not a product
failure.

## I. Human-authorized return to pre-cutover posture

Cloudflare deployment history and the current active-state readback both
confirm:

| Fact          | Verified value                                                                         |
| ------------- | -------------------------------------------------------------------------------------- |
| Deployment ID | `97a76f46-a580-4529-8c76-36e9ac35383f`                                                 |
| Created       | `2026-09-16T22:17:15.897858Z`                                                          |
| Strategy      | `percentage`                                                                           |
| Message       | `METADATA-VCM-07C-R1: restore pre-cutover 100/0 posture after canary reclassification` |
| Stable        | `38cbf4dd-52fd-4afc-ad34-626a2e6454d3` at 100%                                         |
| Candidate     | `1a3ea07b-5885-49d2-9cd0-d176c4313bd0` at 0%                                           |

```text
RETURN_TO_ZERO_VERIFIED=YES
PRE_CUTOVER_POSTURE_RESTORED=YES
```

The return deployment changed only the two percentages. It uploaded no version
and changed no code, secret, ordinary variable, route, domain, Cron Trigger,
binding, price, protocol behavior, projection mode, handler, or economic gate.

This report checkpoint performed no Cloudflare mutation. It only read the
already-completed activation and return deployments.

## J. Disposition of the old event gates

The 07B thresholds are retained in §A to preserve their rationale and history.
They are not retroactively labeled defective. They were conservative and
coherent for a representative production-traffic population.

Their current disposition is:

```text
OLD_EVENT_THRESHOLDS_STATUS=DEFERRED_TO_POST_CUTOVER_CANARY_REDESIGN
TWELVE_HOUR_WAIT_REQUIRED=NO
TWENTY_FOUR_HOUR_WAIT_REQUIRED=NO
POST_CUTOVER_THRESHOLDS_MUST_BE_RECALCULATED=YES
```

The thresholds no longer block pre-cutover VCM development. They also cannot be
automatically reused later. A genuine post-cutover canary must derive its
percentage, duration, total-request floor, A2A count, MCP count, error bounds,
and latency/CPU bounds from measured post-cutover traffic.

## K. Corrected release sequence

### Phase A — pre-cutover qualification

Completed evidence includes:

- exhaustive local and adversarial qualification;
- immutable candidate qualification;
- exact version-override testing;
- zero-percent live A2A/MCP semantic testing;
- bounded gradual-deployment mechanics testing;
- return-to-zero proof;
- economic and configuration invariant proof; and
- multiversion scheduled-path safety proof.

### Phase B — continue VCM development now

Proceed to `METADATA-VCM-08`, VCM Primary-Compare Architecture and
Implementation Design. No 12-hour or 24-hour wait applies.

### Phase C — actual SITEBORNE production cutover

When the larger core release is otherwise ready:

1. complete the independently governed production cutover;
2. establish a real post-cutover baseline;
3. measure actual total request volume;
4. measure A2A frequency and MCP method distribution;
5. measure real HTTP outcomes and runtime exceptions;
6. measure latency and CPU distributions; and
7. classify actual machine traffic separately from probes, scanners, health
   checks, directories, and bots.

### Phase D — genuine post-cutover canary

Design a fresh, bounded canary from the Phase C measurements. Do not
automatically reuse the 10% share, 12–24 hour window, or the 100/10/10 event
thresholds from 07B.

```text
POST_CUTOVER_CANARY_REQUIRED=YES
```

## L. Authority, security, and economic boundary

At closure:

```text
VCM_PRIMARY_SERVING=NO
AUTHORITY_INVERSION=NO
ECONOMIC_MUTATION=NO
RUNTIME_SOURCE_MUTATION=NO
```

A2A continues to serve the legacy Agent Card producer and shadow-compare the VCM
projection before the independent signing boundary. MCP continues to serve the
legacy six-tool registration definitions and shadow-compare the VCM projection.
Existing handlers, service boundary, quote behavior, payment behavior,
authorization, signing, and scheduled paths remain unchanged.

This closure does not approve `vcm_primary_compare`, `vcm_only`, a metadata
authority inversion, an economic activation, a production cutover, or a new
traffic split.

## M. Handoff to METADATA-VCM-08

The recommended next checkpoint is:

```text
METADATA-VCM-08
VCM Primary-Compare Architecture and Implementation Design
```

`vcm_primary_compare` would be an experimental candidate mode in which VCM is
the candidate content/definition producer and the legacy producer becomes the
independent reference. It is not `vcm_only` and is not, by itself, approval for
authority inversion.

### A2A design obligations

- VCM projection becomes candidate content producer.
- Agent Card signing remains after final projected-content construction.
- Signing key/config behavior remains unchanged.
- Legacy builder remains an independent comparator/reference.
- Mismatch and projector-failure behavior are explicit and fail safe.
- Signing bypass is structurally impossible.
- Rollback to legacy serving is immediate and precomputed.

### MCP design obligations

- VCM tool definitions become the registration-definition producer.
- Executable handlers remain exactly the existing handlers.
- VCM cannot supply, replace, or select executable handlers.
- Invocation, quote, and service-boundary behavior remain unchanged.
- Legacy definitions remain an independent comparator/reference.
- Mismatch and producer-failure behavior are explicit and fail safe.
- Rollback to legacy definitions is immediate and precomputed.

### Cross-cutting obligations

- no price-authority drift;
- no economic activation;
- no authorization or security weakening;
- no protocol-semantic drift;
- no scheduled-path change;
- no new durable side effect;
- safe behavior under producer/comparator/telemetry failure;
- `vcm_only` remains prohibited; and
- registry and metadata authority inversion remain prohibited.

METADATA-VCM-08 must be designed and qualified separately. This closure does not
implement it.

## N. Validation and no-mutation attestation

Before the report-only commit, R1 verifies:

- local and remote 07B provenance are the same exact commit;
- both historical deployment records exist with the supplied IDs, timestamps,
  messages, versions, and percentages;
- the current active deployment is the return-to-zero deployment;
- the accumulated candidate tail is parsed only into a sanitized aggregate;
- report formatting passes;
- `git diff --check` passes;
- the staged delta contains only this report;
- no runtime, configuration, registry, governance, contract, protocol,
  secret-bearing, or deployment file changes; and
- the working tree is clean after the report-only commit.

```text
PRODUCTION_MUTATIONS_BY_R1=0
TRAFFIC_MUTATIONS_BY_R1=0
WORKER_UPLOADS_BY_R1=0
DEPLOYMENTS_BY_R1=0
SECRET_MUTATIONS_BY_R1=0
VARIABLE_MUTATIONS_BY_R1=0
ROUTE_DOMAIN_MUTATIONS_BY_R1=0
TRIGGER_CRON_MUTATIONS_BY_R1=0
BINDING_MUTATIONS_BY_R1=0
ECONOMIC_MUTATIONS_BY_R1=0
RUNTIME_SOURCE_MUTATIONS_BY_R1=0
```

## O. Final decision block

```text
METADATA_VCM_07C_R1=PASS
ORIGINAL_CANARY_CLASSIFICATION=BOUNDED_ORGANIC_PRODUCTION_SHADOW_CANARY
CORRECTED_CANARY_CLASSIFICATION=PRE_CUTOVER_DEPLOYMENT_MECHANICS_AND_SHADOW_RUNTIME_QUALIFICATION

REAL_PRODUCTION_CUTOVER=NO
ORGANIC_PRODUCTION_TRAFFIC_ESTABLISHED=NO

VALID_07C_EVIDENCE_PRESERVED=YES
INVALIDATED_ASSUMPTION=CURRENT_SPARSE_PUBLIC_TRAFFIC_IS_REPRESENTATIVE_POST_CUTOVER_PRODUCTION_DEMAND

TWELVE_HOUR_WAIT_REQUIRED=NO
TWENTY_FOUR_HOUR_WAIT_REQUIRED=NO

STABLE_VERSION=38cbf4dd-52fd-4afc-ad34-626a2e6454d3
CANDIDATE_VERSION=1a3ea07b-5885-49d2-9cd0-d176c4313bd0
FINAL_STABLE_PERCENT=100%
FINAL_CANDIDATE_PERCENT=0%
FINAL_DEPLOYMENT_ID=97a76f46-a580-4529-8c76-36e9ac35383f
RETURN_TO_ZERO_VERIFIED=YES

VCM_PRIMARY_SERVING=NO
AUTHORITY_INVERSION=NO
ECONOMIC_MUTATION=NO
RUNTIME_SOURCE_MUTATION=NO

POST_CUTOVER_CANARY_REQUIRED=YES
OLD_EVENT_THRESHOLDS_DEFERRED=YES
POST_CUTOVER_THRESHOLDS_MUST_BE_RECALCULATED=YES

REPORT_PATH=docs/reports/METADATA-VCM-07C-pre-cutover-canary-reclassification-and-closure.md
REPORT_ONLY_COMMIT=THE_GIT_COMMIT_CONTAINING_THIS_REPORT;_SHA_RETURNED_BY_CHECKPOINT
WORKING_TREE=CLEAN_AFTER_REPORT_ONLY_COMMIT

SAFE_TO_CONTINUE_PRE_CUTOVER_DEVELOPMENT=YES
NEXT_CHECKPOINT_RECOMMENDATION=METADATA-VCM-08
```
