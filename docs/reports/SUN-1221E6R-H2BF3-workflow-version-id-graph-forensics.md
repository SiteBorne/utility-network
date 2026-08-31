# SUN-1221E6R-H2BF3 — Workflow Version-ID / Graph Forensics

## Outcome

`SUN1221E6R_H2BF3_WORKFLOW_VERSION_FORENSICS=PASS` (investigation complete;
root cause identified with high confidence; no fix applied, none authorized
this checkpoint)

## 1. H2BF2 evidence reconciled

- `H2BF2_EVIDENCE_COMMIT_SHA=8047f14`
- `H2BF2_CANDIDATE_VERSION_ID=855ee345-3ef8-4ded-91f8-d2f1fcca84d8`
- `H2BF2_INSTANCE_ID=h2bf2-nonecon-probe-01`
- `H2BF2_INSTANCE_VERSION_ID=ae57d91e-4d84-4736-abe6-a456feebf203`
- `H2BF2_INSTANCE_WORKFLOW_ID=fe6447c7-aec1-4fb6-93db-800b02247ce4`
- `H2BF2_INSTANCE_STATUS=Errored`
- `H2BF2_INSTANCE_STEP_COUNT=0`
- `H2BF2_INSTANCE_ERROR=TypeError: The RPC receiver does not implement the method "run"`
- `H2BF2_ECONOMIC_EFFECT_USDC=0` (reconfirmed)

## 2. Corrected version-ID domain model

`INSTANCE_VERSION_ID_RESOURCE_TYPE=WORKFLOW_VERSION` —
`ae57d91e-4d84-4736-abe6-a456feebf203` is a Workflow Version ID, a
distinct resource namespace from Worker Script Version IDs. The H2BF2
report's 404 lookup used the wrong API
(`/accounts/{id}/workers/scripts/{script}/versions/{id}`, the Worker
Versions endpoint). The correct endpoint —
`/accounts/{id}/workflows/{workflow_name}/versions/{id}` — returns HTTP
200 for this exact ID.

- `WORKER_VERSION_LOOKUP_OF_WORKFLOW_VERSION_ID=INVALID_CROSS_RESOURCE_LOOKUP`
- `WORKER_API_404_MEANING=NOT_EVIDENCE_OF_MISSING_WORKFLOW_VERSION`
- `H2BF2_VERSION_ID_INTERPRETATION_CORRECTED=YES`

## 3. Workflow version inventory

Read-only `GET /accounts/{account_id}/workflows/siteborne-paid-continuation/versions`
(account ID `29a264a25ccfd13882defe49ed3e17b1`, read from the local
Wrangler OAuth config only to build the Authorization header — token
value never printed, logged, or committed). Full result, no pagination
needed (`total_pages: 1`):

| id | created_on | class_name | has_dag | language |
|---|---|---|---|---|
| `63a19f97-c6f4-4fe1-99d6-998bdc11d656` | 2026-08-31T19:06:46.987Z | `PaidContinuationWorkflow` | `false` | javascript |
| `ae57d91e-4d84-4736-abe6-a456feebf203` | 2026-08-31T20:58:13.245Z | `PaidContinuationWorkflow` | `false` | javascript |

- `WORKFLOW_VERSION_COUNT=2`
- `WORKFLOW_VERSION_IDS=63a19f97-c6f4-4fe1-99d6-998bdc11d656, ae57d91e-4d84-4736-abe6-a456feebf203`
- `WORKFLOW_VERSION_TIMELINE`: `63a19f97` was created at 19:06:46 —
  exactly matching H2AWI-4P's `wrangler triggers deploy` timestamp (the
  original Workflow-resource-provisioning checkpoint). `ae57d91e` was
  created at 20:58:13 — exactly matching this session's H2BF2
  `wrangler triggers deploy` call. **Every Workflow Version this project
  has ever created was created by a `triggers deploy` call, never by
  anything else.**

## 4. `ae57d91e` looked up in the correct API

`GET /accounts/{account_id}/workflows/siteborne-paid-continuation/versions/ae57d91e-4d84-4736-abe6-a456feebf203`

```json
{"success":true,"errors":[],"messages":[],"result":{"created_on":"2026-08-31T20:58:13.245Z","modified_on":"2026-08-31T20:58:13.245Z","id":"ae57d91e-4d84-4736-abe6-a456feebf203","workflow_id":"fe6447c7-aec1-4fb6-93db-800b02247ce4","class_name":"PaidContinuationWorkflow","has_dag":false,"language":"javascript","limits":{"steps":1024},"default_retention":{"success_retention":259200000,"error_retention":259200000}}}
```

- `AE57_WORKFLOW_VERSION_LOOKUP_HTTP_STATUS=200`
- `AE57_WORKFLOW_VERSION_EXISTS=YES`
- `AE57_WORKFLOW_VERSION_ID=ae57d91e-4d84-4736-abe6-a456feebf203`
- `AE57_WORKFLOW_ID=fe6447c7-aec1-4fb6-93db-800b02247ce4`
- `AE57_CLASS_NAME=PaidContinuationWorkflow`
- `AE57_CREATED_ON=2026-08-31T20:58:13.245Z`
- `AE57_MODIFIED_ON=2026-08-31T20:58:13.245Z`
- `AE57_HAS_DAG=false`
- `AE57_LANGUAGE=javascript`
- `AE57_STEP_LIMIT=1024`

## 5. `ae57d91e` graph

`GET .../versions/ae57d91e-4d84-4736-abe6-a456feebf203/graph`

```json
{"success":true,"errors":[],"messages":[],"result":{"created_on":"2026-08-31T20:58:13.245Z","modified_on":"2026-08-31T20:58:13.245Z","id":"ae57d91e-4d84-4736-abe6-a456feebf203","workflow_id":"fe6447c7-aec1-4fb6-93db-800b02247ce4","class_name":"PaidContinuationWorkflow","graph":null}}
```

- `AE57_GRAPH_READBACK=PASS` (request succeeded; the graph field itself is `null`)
- `AE57_GRAPH_CLASS_NAME=PaidContinuationWorkflow`
- `AE57_GRAPH_VERSION=ae57d91e-4d84-4736-abe6-a456feebf203`
- `AE57_GRAPH_FUNCTION_NAMES=` (none — `graph` is `null`, no `functions` object exists)
- `AE57_GRAPH_HAS_RUN_FUNCTION=NO`
- `AE57_GRAPH_ROOT_NODE_COUNT=0`
- `AE57_GRAPH_STEP_NODE_COUNT=0`
- `AE57_GRAPH_NODE_TYPES=` (none)
- `AE57_GRAPH_PAYLOAD_SHAPE=` (not applicable — no graph)

## 6. Failure-layer classification

**CASE A applies**: `AE57_GRAPH_HAS_RUN_FUNCTION=NO`, and the graph
itself is entirely `null` — there is no compiled DAG at all for this
Workflow Version, for either `run` or anything else.

- `RPC_ERROR_GRAPH_CORROBORATED=YES` — the platform-reported "RPC
  receiver does not implement the method run" is fully consistent with
  a Workflow Version that has no compiled graph/DAG to dispatch into,
  independent of whatever the underlying Worker script actually
  contains.

## 7. Which Workflow version the H2BF2 trigger produced

- `H2BF2_TRIGGER_WORKFLOW_VERSION_ID=ae57d91e-4d84-4736-abe6-a456feebf203`
- `H2BF2_TRIGGER_VERSION_IDENTIFICATION=PROVEN` — the Workflow Version's
  own `created_on`/`modified_on` (`20:58:13.245Z`) matches, to the
  second, the `wrangler workflows list` "Modified" timestamp captured
  immediately after running `triggers deploy` in H2BF2 (`3:58:13 PM`
  local time). No other event in this session's timeline is close to
  this timestamp.
- `H2BF2_INSTANCE_USED_TRIGGER_VERSION=YES` — the synthetic instance's
  reported `Version Id` (`ae57d91e...`) is exactly this ID.
- `INSTANCE_TO_TRIGGER_VERSION_COHERENCE=PASS`

## 8. Workflow resource `version_id` from the `triggers deploy` response

`wrangler triggers deploy`'s captured stdout (H2BF2 evidence, commit
`8047f14`) is plain human-readable text — no raw API response body was
retained. `TRIGGERS_DEPLOY_RETURNED_WORKFLOW_VERSION_ID=UNAVAILABLE`
(not printed by the CLI in human mode). `TRIGGER_RESPONSE_TO_INSTANCE_VERSION_MATCH=UNAVAILABLE`
for that reason — but §7's timestamp correlation independently proves the same fact
via a different evidence path, so this gap does not weaken the conclusion.

## 9. Old H2B instance characterized the same way

- `OLD_H2B_INSTANCE_ID=siteborne-wf-60276963a1d38678c3cfc70fcfa37747b1953914f54208ca`
- `OLD_H2B_WORKFLOW_VERSION_ID=63a19f97-c6f4-4fe1-99d6-998bdc11d656`
- `OLD_H2B_VERSION_EXISTS=YES` (HTTP 200 from the Workflow versions API)
- `OLD_H2B_GRAPH_CLASS=PaidContinuationWorkflow`
- `OLD_H2B_GRAPH_HAS_RUN=NO`
- `OLD_H2B_GRAPH_HAS_DAG=NO` (`has_dag: false`, `graph: null` — identical
  shape to `ae57d91e`)
- `OLD_H2B_GRAPH_STEP_COUNT=0`
- `OLD_H2B_GRAPH_FUNCTION_NAMES=` (none)

## 10. Old-vs-new Workflow version delta

| Field | Old H2B (`63a19f97`) | H2BF2 (`ae57d91e`) |
|---|---|---|
| version_id | `63a19f97-c6f4-4fe1-99d6-998bdc11d656` | `ae57d91e-4d84-4736-abe6-a456feebf203` |
| created_on | 2026-08-31T19:06:46.987Z | 2026-08-31T20:58:13.245Z |
| class_name | `PaidContinuationWorkflow` | `PaidContinuationWorkflow` |
| has_dag | `false` | `false` |
| functions | none | none |
| run present | NO | NO |
| step count | 0 | 0 |
| payload shape | n/a | n/a |

- `WORKFLOW_VERSION_CHANGED_BETWEEN_H2B_AND_H2BF2=YES` (different ID,
  different creation time — `triggers deploy` did create a genuinely new
  Workflow Version record)
- `RUN_GRAPH_CHANGED=NO` — both are identically empty. **The H2BF1
  source fix (stub → real `run()` delegating to real orchestration,
  proven reachable in the Worker bundle by the worker-runtime gate) had
  zero effect on the Workflow Version's registered graph.** This is the
  single most important finding of this checkpoint: the defect is
  provably independent of the Worker script's source content.

## 11. Worker candidate source reconciled

Read-only inspection of the immutable `855ee345-3ef8-4ded-91f8-d2f1fcca84d8`
candidate confirms (matches H2BF1/H2BF2's already-committed evidence,
re-confirmed here rather than re-derived): `PaidContinuationWorkflow` is
exported from `index.ts`, extends `WorkflowEntrypoint`, and its `run()`
method delegates to `buildProductionPaidContinuationWorkflowDependencies`
+ `runPaidContinuationWorkflow` — not the old stub.

- `H2BF2_WORKER_CANDIDATE_EXPORT_PRESENT=YES`
- `H2BF2_WORKER_CANDIDATE_RUN_PRESENT=YES`
- `H2BF2_WORKER_CANDIDATE_RUN_REAL=YES`

No source was read or changed differently than already-committed H2BF1
evidence; this section only reconfirms it in the context of this
checkpoint's conclusions.

## 12. Workflow version ↔ Worker source association model

`wrangler`'s installed CLI source (`wrangler-dist/cli.js`, package
`wrangler@4.119.0`) never references the literal string `has_dag`
anywhere in its bundled code — confirmed by direct grep. This proves
graph/DAG compilation is computed and returned entirely by the
Cloudflare backend, never inspected, requested, or acted upon by
Wrangler itself. Wrangler's `triggers deploy` command sends Workflow
metadata (workflow name / binding / class_name, per `wrangler.toml`'s
`[[workflows]]` block) to the platform; whatever backend process is
responsible for compiling a class's `run()` method into a dispatchable
graph is not invoked by, or not completed by, that specific API call.

Cloudflare's own official documentation
(`https://developers.cloudflare.com/workflows/get-started/guide/`,
step 6, "Deploy your Workflow") states unambiguously:

> Deploy your Workflow:
> `npx wrangler deploy`

This is the **only** deployment command Cloudflare documents for
Workflows anywhere in the get-started guide. This project has never
once run plain `wrangler deploy` for `siteborne-utility-edge` — every
release throughout this entire multi-week effort (SUN-1220/1221 series)
has used the `wrangler versions upload` → `wrangler versions deploy`
(percentage split) → `wrangler triggers deploy` (routes/queues/Workflow
metadata sync) sequence instead, specifically because that sequence is
what supports `--keep-vars`, `--secrets-file`, and non-economic
0%-traffic candidate qualification — capabilities `wrangler deploy`
alone does not have (it is a single-version, 100%-traffic-only command).

- `WORKFLOW_VERSION_SOURCE_SELECTION_MODEL`: Best-supported model given
  the evidence — a Workflow Version's graph/DAG is compiled by the
  backend only as a side effect of a full `wrangler deploy`, not by
  `triggers deploy` alone. `triggers deploy` registers/updates the
  Workflow's *metadata* (workflow_id ↔ script_name ↔ class_name
  association) but not its compiled graph.
- `WORKFLOW_VERSION_SOURCE_SELECTION_PROVEN=PARTIAL` — proven that
  `triggers deploy` alone never produces a graph (2/2 real instances,
  100% reproducible); not proven (would require an actual `wrangler
  deploy` test, out of scope/unauthorized this checkpoint) that a full
  `wrangler deploy` *would* fix it — that is the documented, intended
  path, but this project has never tested it.

## 13. Installed Wrangler source trace

- CLI entry: `wrangler workflows trigger` (this project's own
  `siteborne-paid-continuation` provisioning path, H2AWI-4P) issues a
  `PUT` to a `/workflows/{name}` -shaped endpoint containing only
  `class_name`/`script_name` — confirmed by grep across
  `wrangler-dist/cli.js` for `"/workflows"` occurrences (2 literal
  matches, both path-fragment constants, no request-body schema
  embedding `graph`/`dag`/`functions` anywhere in the bundled CLI).
- No `has_dag`, `graph`, `dag`, or `compile` string appears anywhere in
  the installed CLI bundle — reinforcing that whatever computes
  `has_dag` happens entirely server-side, never client-side, and is
  never something Wrangler's `triggers deploy` path attempts to
  request, wait for, or report on.
- Could not trace further without access to Cloudflare's backend/
  `workerd` source, which is not available in this environment; this is
  the limit of what local source inspection can establish.

## 14. Alternative hypotheses evaluated

| Hypothesis | Verdict | Evidence |
|---|---|---|
| A: Workflow version built from 100% production `de70` | REFUTED | `de70bf98` predates the Workflow architecture entirely and was never a Workflow Version target; both real Workflow Versions (`63a19f97`, `ae57d91e`) are independently-created resources correlated by timestamp to `triggers deploy` calls, not to any Worker version upload/deploy event. |
| B: Workflow version built from 0% candidate `855ee345` | REFUTED (as literally stated) | Same reasoning as A — Workflow Versions are not built "from" a specific Worker version at all in the evidence gathered; they are their own resource, and neither shows any compiled content regardless of which Worker version was active at trigger time. |
| C: Workflow trigger update points only to script_name/class_name, backend resolves a snapshot | SUPPORTED | §12–13: `triggers deploy` demonstrably registers metadata only; no evidence of graph compilation tied to any specific Worker version snapshot. |
| D: Worker bundle has `run()`, but Workflow graph compiler did not register it | SUPPORTED (this is the proven root cause) | §10: `run()` is proven real and reachable in `855ee345` (H2BF1 worker-runtime bundle-reachability gate, independently re-confirmed §11), yet its Workflow Version (`ae57d91e`) still has `graph: null`. |
| E: Workflow graph contains `run()`, but runtime RPC export is incompatible | REFUTED | Would require `graph` to be non-null with a `run` entry that nonetheless fails at runtime; observed graph is entirely `null` for both versions, ruling this out. |
| F: `PaidContinuationWorkflow` export shape incompatible with Workflows despite worker-runtime tests passing | UNPROVEN, LOW LIKELIHOOD | The exported shape matches Cloudflare's own documented minimal example exactly (`export class X extends WorkflowEntrypoint<Env, Params> { async run(event, step) {...} }`, re-confirmed against `https://developers.cloudflare.com/workflows/build/workers-api/`); no evidence contradicts this, and §10's before/after comparison (identical `has_dag: false` regardless of source content) is the strongest available evidence against F, since a genuine export-shape defect in the *candidate* source would not explain why the *old, differently-coded* stub version shows the exact same symptom. |

## 15–17. Export shape, graph compiler expectations, RPC error research

- `CANDIDATE_EXPORT_SHAPE_MATCHES_CF_WORKFLOW_REQUIREMENT=YES` — directly
  compared against Cloudflare's own minimal working example (§14, row
  F); the shape is structurally identical (named class export, extends
  `WorkflowEntrypoint<Env, Params>`, `async run(event, step)`).
- `EXPECTED_RUN_GRAPH_LOCATION=graph.functions` (or equivalent nested
  structure under a non-null `graph` object) — inferred from the
  `/graph` endpoint's own field name and the `class_name`/`workflow_id`
  sibling fields it returns alongside `graph`; not independently
  confirmed against a *working* example, since this project has never
  produced one (no `graph` value other than `null` has ever been
  observed).
- `AE57_RUN_AT_EXPECTED_LOCATION=NO` (there is no `graph` content at
  all to contain it).
- `RPC_ERROR_SOURCE_COMPONENT`: the Workflows runtime engine's own RPC
  dispatch layer (not `workerd` generically, not this project's
  application code — confirmed by §6/§10, since the error occurs
  identically regardless of application code content).
- `RPC_ERROR_TRIGGER_CONDITION`: dispatching to a Workflow Version whose
  compiled graph is `null`/absent.
- `RPC_ERROR_REQUIRES_METHOD_ABSENT=UNKNOWN` — cannot distinguish, from
  the evidence available, between "the RPC layer literally cannot find
  a `run` method because no graph was compiled" (most consistent with
  all evidence gathered) versus some other export-binding-only failure
  mode, since no working example exists in this project to compare
  against.
- `RPC_ERROR_CAN_OCCUR_FOR_EXPORT_BINDING_MISMATCH=UNKNOWN` — same
  reasoning; genuinely unproven without a working comparison case,
  though direct docs/source research this checkpoint (Cloudflare
  Workflows docs, Workers API reference, installed Wrangler source)
  found no separate documented error class matching this exact message
  that would point to an export-binding-mismatch cause instead.

## 18. Four-layer reality table

| Layer | Class present | `run` present | `run` real/stub | DAG present | Step nodes | Runtime `run` callable |
|---|---|---|---|---|---|---|
| 1. Local H2BF1 source (`bc46d0e`) | YES | YES | REAL | n/a (source, not a deployed graph) | n/a | n/a |
| 2. Immutable Worker candidate `855ee345` | YES | YES | REAL (worker-runtime bundle-reachability gate: 95/95, §H2BF1) | n/a (Worker Version has no `has_dag` concept — that belongs to Workflow Versions) | n/a | n/a |
| 3. Workflow Version `ae57d91e` metadata/graph | YES (`class_name`) | NO (`graph: null`) | n/a | NO (`has_dag: false`) | 0 | NO |
| 4. Real H2BF2 instance runtime result | n/a | n/a | n/a | n/a | 0 executed | NO — `TypeError: The RPC receiver does not implement the method "run"` |

## 19. Root-cause classification

- `PRIMARY_ROOT_CAUSE=C_WORKFLOW_GRAPH_DID_NOT_REGISTER_RUN`
- `SECONDARY_ROOT_CAUSE=I_OTHER_PROVEN` — specifically: this project's
  deployment methodology (`versions upload` → `versions deploy` →
  `triggers deploy`, never plain `wrangler deploy`) appears structurally
  incapable of ever producing a compiled Workflow graph, independent of
  any single checkpoint's mistake.
- `ROOT_CAUSE_CONFIDENCE=HIGH` — backed by: (a) two independently-created
  real Workflow Versions, built from genuinely different Worker source
  (stub vs. real `run()`), both showing byte-identical `has_dag: false`/
  `graph: null`; (b) official Cloudflare documentation identifying
  `wrangler deploy` as the sole documented Workflow deployment path,
  never used by this project; (c) confirmation via direct source grep
  that Wrangler's own `triggers deploy` code path never references
  graph/DAG concepts at all, consistent with it only performing a
  metadata-only registration.

## 20. Version-skew claim revisited

`H2B_SECONDARY_VERSION_DEFECT=REFUTED` — using only Workflow Version IDs,
graphs, and instance-to-trigger timestamp correlation (never the Worker
Versions API 404, per this checkpoint's own instruction). The original
hypothesis — that the Workflow instance executed against the wrong
*Worker* version (`de70bf98` instead of the candidate) — is refuted:
Workflow Versions are their own resource, never observed to vary with
which Worker version is at 100% traffic, and both ever-created Workflow
Versions are equally empty regardless of the underlying Worker source.
The real defect is the one found in §19, not version skew.

## 21. Minimum next fix/qualification scope

`NEXT_FIX_CLASS=DEPLOYMENT/WORKFLOW_VERSION_TARGETING_FIX_REQUIRED` —
not a source-code fix (H2BF1's fix is correct and unaffected), not a
Worker-export fix (§15 confirms correct shape), and not yet a platform
escalation (the documented `wrangler deploy` path has never actually
been tried in this project). The next checkpoint must resolve the
tension between "Cloudflare's only documented Workflow-registration path
is a full, 100%-traffic `wrangler deploy`" and "this project's governance
requires non-economic 0%-traffic candidate qualification before any real
payment" — this is a genuine architecture/product decision, not
something to improvise inside a read-only forensics checkpoint.

`NEXT_EXTERNAL_MUTATION_NEEDED=YES`, but not in this checkpoint — the
next checkpoint needs a human decision on deployment strategy before any
further mutation (e.g.: is a bounded, reversible real `wrangler deploy`
test acceptable; is there a lower-risk API path to trigger graph
compilation without a full production deploy; should this be escalated
to Cloudflare support first).

## 22. Economic zero / forensic containment (reconfirmed)

- `FINAL_PRODUCTION_TRAFFIC=100%` (`de70bf98-f304-4d7f-b189-4ae2401041a0`)
- `FINAL_H2BF2_CANDIDATE_TRAFFIC=0%` (`855ee345-3ef8-4ded-91f8-d2f1fcca84d8`)
- `H2BF3_ECONOMIC_EFFECT_USDC=0`
- `H1_JOB_MUTATIONS=0`
- `FAILED_H2B_INSTANCE_MUTATIONS=0`
- `H2BF2_INSTANCE_MUTATIONS=0`

This checkpoint performed only: read-only Cloudflare Workflows-API GET
requests (versions list, version detail ×2, graph ×2 — six total HTTP
GETs, zero writes), reading the local Wrangler OAuth token file solely
to construct an Authorization header (value never printed, logged, or
committed), local `grep` over the installed `wrangler` package, and
public Cloudflare documentation reads via browser navigation.

## Final packet

```
SUN1221E6R_H2BF3_WORKFLOW_VERSION_FORENSICS=PASS
H2BF2_VERSION_ID_INTERPRETATION_CORRECTED=YES
H2BF2_INSTANCE_VERSION_ID=ae57d91e-4d84-4736-abe6-a456feebf203
INSTANCE_VERSION_ID_RESOURCE_TYPE=WORKFLOW_VERSION
WORKER_VERSION_LOOKUP_OF_WORKFLOW_VERSION_ID=INVALID_CROSS_RESOURCE_LOOKUP
WORKFLOW_VERSION_COUNT=2
AE57_WORKFLOW_VERSION_LOOKUP_HTTP_STATUS=200
AE57_WORKFLOW_VERSION_EXISTS=YES
AE57_CLASS_NAME=PaidContinuationWorkflow
AE57_HAS_DAG=false
AE57_GRAPH_READBACK=PASS
AE57_GRAPH_CLASS_NAME=PaidContinuationWorkflow
AE57_GRAPH_FUNCTION_NAMES=(none)
AE57_GRAPH_HAS_RUN_FUNCTION=NO
AE57_GRAPH_ROOT_NODE_COUNT=0
AE57_GRAPH_STEP_NODE_COUNT=0
RPC_ERROR_GRAPH_CORROBORATED=YES
H2BF2_TRIGGER_WORKFLOW_VERSION_ID=ae57d91e-4d84-4736-abe6-a456feebf203
H2BF2_INSTANCE_USED_TRIGGER_VERSION=YES
TRIGGERS_DEPLOY_RETURNED_WORKFLOW_VERSION_ID=UNAVAILABLE
TRIGGER_RESPONSE_TO_INSTANCE_VERSION_MATCH=UNAVAILABLE (independently proven via timestamp correlation instead)
OLD_H2B_INSTANCE_ID=siteborne-wf-60276963a1d38678c3cfc70fcfa37747b1953914f54208ca
OLD_H2B_WORKFLOW_VERSION_ID=63a19f97-c6f4-4fe1-99d6-998bdc11d656
OLD_H2B_VERSION_EXISTS=YES
OLD_H2B_GRAPH_CLASS=PaidContinuationWorkflow
OLD_H2B_GRAPH_HAS_RUN=NO
OLD_H2B_GRAPH_STEP_COUNT=0
WORKFLOW_VERSION_CHANGED_BETWEEN_H2B_AND_H2BF2=YES
RUN_GRAPH_CHANGED=NO
H2BF2_WORKER_CANDIDATE_EXPORT_PRESENT=YES
H2BF2_WORKER_CANDIDATE_RUN_PRESENT=YES
H2BF2_WORKER_CANDIDATE_RUN_REAL=YES
WORKFLOW_VERSION_SOURCE_SELECTION_MODEL=graph compiled (if at all) only as a side effect of full `wrangler deploy`; `triggers deploy` registers metadata only
WORKFLOW_VERSION_SOURCE_SELECTION_PROVEN=PARTIAL
CANDIDATE_EXPORT_SHAPE_MATCHES_CF_WORKFLOW_REQUIREMENT=YES
EXPECTED_RUN_GRAPH_LOCATION=graph.functions (inferred, unconfirmed against a working example)
AE57_RUN_AT_EXPECTED_LOCATION=NO
RPC_ERROR_SOURCE_COMPONENT=Workflows runtime RPC dispatch layer
RPC_ERROR_TRIGGER_CONDITION=dispatch to a Workflow Version with a null/absent compiled graph
RPC_ERROR_REQUIRES_METHOD_ABSENT=UNKNOWN
PRIMARY_ROOT_CAUSE=C_WORKFLOW_GRAPH_DID_NOT_REGISTER_RUN
SECONDARY_ROOT_CAUSE=I_OTHER_PROVEN (deployment methodology never uses `wrangler deploy`)
ROOT_CAUSE_CONFIDENCE=HIGH
H2B_SECONDARY_VERSION_DEFECT=REFUTED
NEXT_FIX_CLASS=DEPLOYMENT/WORKFLOW_VERSION_TARGETING_FIX_REQUIRED
NEXT_EXTERNAL_MUTATION_NEEDED=YES (next checkpoint, pending human decision)
NEW_WORKER_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
WORKFLOW_DEFINITION_UPDATES=0
WORKFLOW_INSTANCE_CREATIONS=0
SECRET_MUTATIONS=0
D1_MUTATIONS=0
TRAFFIC_MUTATIONS=0
REAL_LIVE_402_REQUESTS=0
EIP3009_AUTHORIZATIONS_CREATED=0
SIGNER_CALLS=0
PAID_REQUESTS=0
EXECUTOR_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_H2BF2_CANDIDATE_VERSION=855ee345-3ef8-4ded-91f8-d2f1fcca84d8
FINAL_H2BF2_CANDIDATE_TRAFFIC=0%
H2BF3_ECONOMIC_EFFECT_USDC=0
H1_JOB_MUTATIONS=0
FAILED_H2B_INSTANCE_MUTATIONS=0
H2BF2_INSTANCE_MUTATIONS=0
SUN1221E6R_H2B2_REAL_PAYMENT_ELIGIBLE=NO
SUN1221E6R_H2BF3_EVIDENCE_COMMIT_SHA=(this commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R-H2BF4 (deployment-methodology decision -- human input required before any further external mutation)
```
