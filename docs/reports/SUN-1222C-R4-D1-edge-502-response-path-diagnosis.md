# SUN-1222C-R4-D1 — Edge HTTP 502 / clean Workflow completion: exact response-path root cause

Read-only + repo-only. Zero deploys, zero traffic mutations, zero 402s, zero payment
authorizations, zero signing, zero paid POSTs, zero settlement attempts, zero chain
transactions, zero production D1 writes.

## 0. Current authoritative state (unchanged this checkpoint)

`CURRENT_ACTIVE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a` @ 100%.
`CURRENT_CANDIDATE=a064477f-7b74-46c5-a5b6-799df114b252` @ 0%. No third version.
Repo `HEAD=81f0517`, working tree clean before this checkpoint's evidence commit.

## 1. Exact R3 attempt identity

| Field | Value |
|---|---|
| `R3_PAYMENT_IDENTIFIER` | `pay_1be0e6752e094e2aa5ae6eb2c9d54bbc` |
| `R3_JOB_ID` | `d6563fbb-71ba-4509-8c01-a9e674cba52d` |
| `R3_WORKFLOW_INSTANCE_ID` | `siteborne-wf-c57bdaf57173fd4c345921de1ad0e17ff091157f9109a0c9` |
| `R3_WORKFLOW/HOST_VERSION` | `453dd8f7-2fa0-44d6-9541-6a79c7fbc80a` |
| `R3_API_VERSION` | `db7054c9` (public edge, unchanged) |
| `R3_REQUEST_TIMESTAMP` | `2026-09-07T23:38:33.935Z` |
| `R3_CLIENT_HTTP_STATUS` | `502` |
| `R3_CLIENT_RESPONSE_BODY_CLASS` | `{"ok":false,...,"submission_result":"ambiguous","http_status":502}` (no `error`/`message` shown — proven in §10 to be a harness artifact, not an empty server body) |

## 2. Workflow completion semantics (reconfirmed, not re-derived)

Live `wrangler tail` captured for this exact attempt (from R3's own evidence,
re-verified): `outcome: "ok"`, `wallTime: 5670`, `exceptions: []`, `entrypoint:
"PaidContinuationWorkflow"`, `rpcMethod: "run"`. `WORKFLOW_COMPLETED_CLEANLY=YES`.
The Workflow's `run()` returned normally — this is not a crash, not a platform
error, not an uncaught exception. `WORKFLOW_SETTLEMENT_REACHED=NO` (zero
`x402_service_results` rows, zero settlement attempts, D1 confirms job terminal
state `REJECTED`).

## 3. Economic reconciliation of R3

`R3_SETTLEMENT_ATTEMPT_COUNT=0`, `R3_MATCHING_CHAIN_TRANSFER_COUNT=0`,
`R3_SETTLEMENT_TX_HASH=`(none), `R3_ECONOMIC_EFFECT_ATOMIC=0`. Buyer/seller
balances unchanged (79,727 / 28,000 atomic before and after — reconfirmed by
dual-RPC in R3's own evidence). No inference of economic failure from HTTP 502
was made; this is read directly from `payment_attempts`/chain state.

## 4. Public route call graph (paid POST → Response)

`apps/edge-api/src/control-plane/routes/x402-service.ts`, `createX402ServiceRoute`:

1. `c.req.json()` → validate → hash → quote lookup → `acquirePaymentAttempt`
   (`first_seen` for a fresh payment identifier).
2. Job created (`RECEIVED`→`VALIDATED`→`QUOTED`→`PAYMENT_CHALLENGED`).
3. `evidenceProvider.verify()` → `PAYMENT_VERIFIED`.
4. `driveDurableContinuation('create_or_join')` → `createOrJoinPaidContinuation`
   (`handoff.ts`) → durable Workflow instance created/joined.
5. `waitForWorkflowResult(instance, { signal: c.req.raw.signal })`
   (`continuation/waiter.ts`) — polls `instance.status()` every 250ms, **no
   maximum-wait timeout** (explicit, documented product decision — see the
   module's own header comment, SUN-1221E6R-H2AWI-3). Returns only on a terminal
   `InstanceStatus` or the caller's own disconnect.
6. On `{ kind: 'complete', output }` → the `output` (a `WorkflowContinuationResult`)
   is passed to `respondFromWorkflowResult(result)`.
7. `respondFromWorkflowResult` switches on `result.status` and constructs the
   final `Response`.

`WAIT_LOOP_FUNCTION=waitForWorkflowResult`. `POLL_SOURCE=instance.status()`.
`POLL_INTERVAL=250ms`. `TERMINAL_STATES=complete|errored|terminated` (plus the
caller's own `disconnected`, never a Workflow-side terminal state).
`REJOIN_KEY=paymentIdentifier` (via `joinExistingPaidContinuation`).
`MAX_WAIT_PRESENT=NO`. `SERVER_TIMEOUT_PRESENT=NO`.
`CLIENT_ABORT_HANDLING`: `c.req.raw.signal` stops only this HTTP invocation's
poll loop. `WORKFLOW_CONTINUES_AFTER_DISCONNECT=YES` (the durable handoff
already happened in step 4, before the poll loop starts; the waiter never calls
`.terminate()`/`.pause()`).

## 5. Every source of HTTP 502 in the paid response path

Located in `respondFromWorkflowResult` (`x402-service.ts`, `case
'executor_rejected'`):

```ts
case 'executor_rejected':
  // Matches the pre-H2AWI-3 contract's resolved-but-unsuccessful
  // executor branch (502 service_execution_failed).
  return jsonError(
    c,
    502,
    'service_execution_failed',
    result.error_code ?? 'executor_rejected'
  );
```

| File | Function | Condition | Body shape | Could match R3 |
|---|---|---|---|---|
| `x402-service.ts` | `respondFromWorkflowResult` | `result.status === 'executor_rejected'` | `{error:'service_execution_failed', message: result.error_code}` | **YES** |
| `x402-service.ts` | `respondFromWorkflowResult` | `'executor_timeout'` | `{error:'service_execution_failed', message: result.error_code ?? 'executor_timeout'}`, status 500 | NO (not this status) |
| `x402-service.ts` | `respondFromWorkflowResult` | `'pcc_failed'` | status 500 | NO |
| `x402-service.ts` | `respondFromWorkflowResult` | `'settlement_rejected'`/`'settlement_ambiguous'`/`'authorization_expired'` | status 402 | NO |
| `x402-service.ts` | top-level catch (repository errors) | D1/repo failure | status 500 | NO |

No Cloudflare-platform-generated 502, no upstream-proxy 502, and no generic
uncaught-exception handler exists anywhere in this call graph that could
produce a 502. **This is the only 502-producing branch in the entire route.**

## 6. 502 origin classification — the load-bearing finding

`R3_502_ORIGIN=APPLICATION_GENERATED_502`.

This is proven by elimination + exact precondition match (proof standard C,
§25): job `d6563fbb`'s terminal state is `REJECTED` with
`payment.lifecycle_stage='verified'` and zero settlement — the only
`WorkflowContinuationResult.status` value consistent with "payment verified,
Workflow completed cleanly, no settlement, job REJECTED" is
`'executor_rejected'` (set by the Workflow at
`paid-continuation-workflow.ts:722`, reached when the real
`company_evidence_graph.v2` executor resolves without throwing but with a
non-success `result_class` — exactly SEC EDGAR's `permanent_failure`
rejection, confirmed in R5/R8's own diagnosis chain). `executor_rejected` maps
**deliberately and only** to HTTP 502 in `x402-service.ts` — this is
documented, intentional application behavior ("Matches the pre-H2AWI-3
contract's resolved-but-unsuccessful executor branch"), not a bug, not a
platform artifact, not an upstream proxy failure.

**The system has been working exactly as designed for all six attempts.** The
mystery was never "why does the server return a bad gateway" — it was
"why does the client-side tooling describe a deliberate, informative
business-rejection response as an unexplained ambiguous gateway error."
That question is answered in full in §7–§10.

## 7. Why the client sees "ambiguous" instead of the real reason

Traced `executor_rejected`'s `error_code` back one more layer, into the
Workflow itself (`paid-continuation-workflow.ts:722-723`):

```ts
return terminal('executor_rejected', jobId, {
  error_code: executorOutcome.result.failure?.code ?? executorOutcome.result.result_class,
});
```

And into `CompanyEvidenceGraphService` (`packages/service-runtime/src/services/
company-evidence/service.ts:462-520`): for our exact case, the verification
mesh's own `decision` is `'pass'` (the service ran correctly and validated its
own output — SEC's rejection is a data-completeness problem, not a
verification failure), so `result_class = 'partial'`, and — critically —
`failure` is **only populated when `decision !== 'pass'`** (line 511-519). For
a `'partial'` result, `failure = undefined`.

Therefore: `error_code = undefined ?? 'partial' = 'partial'`. The specific,
human-readable SEC rejection detail (`"sec-edgar company_submissions returned
permanent_failure for CIK 0000320193"`) lives only in the service result's
`limitations` array (`service.ts:496`) — a field `PaidContinuationWorkflow`'s
`executor_rejected` terminal mapping never reads. **Even in the best case, the
real client-visible 502 body would have been `{"error":"service_execution_
failed","message":"partial"}`** — generic, but not empty, and not literally
"ambiguous".

## 8. And the harness discards even that

`apps/edge-api/tests/live/company-evidence-first-paid-e2e-local.test.ts`:

```ts
export function classifySubmissionOutcome(httpStatus: number): SubmissionResult {
  if (httpStatus === 200) return 'success';
  if (httpStatus === 402) return 'rejected';
  if (httpStatus >= 500) return 'ambiguous';
  return 'ambiguous';
}
```

Any `httpStatus >= 500` — including the deliberate, informative `502
service_execution_failed` — collapses into the single label `'ambiguous'`.
Worse: the harness *does* fetch and parse the JSON response body
(`responseBody = await paidRes.clone().json()`, line 410), but only reads
fields out of it **inside the `if (submissionResult === 'success')` branch**
(lines 415-429). For every one of the six real attempts —
all classified `'ambiguous'`, none `'success'` — `responseBody` was fetched
over the wire and then silently thrown away. The final printed result object
(lines 433-450) never includes `error`/`message` for a non-success outcome.
This exactly reproduces the observed client output across all six attempts:
`{"submission_result":"ambiguous","http_status":502}`, with no further detail
— not because the server sent nothing, but because the harness never looked.

## 9. R10's fix does not close this gap

R10 (commit `39b97f1`) correctly fixed `CompanyEvidenceGraphService` to
preserve `adapter.error.code`/`.message` — but it appends them to
`limitations` (a `string[]`), the same field already used for this purpose
since before R10. `limitations` was never dropped from the *service* result;
it is dropped one layer up, at the `executor_rejected` terminal-state mapping
in `paid-continuation-workflow.ts:723`, which only ever reads
`failure?.code ?? result_class` — a field R10 did not touch. R10's fix is real
and correct for its own stated purpose (post-settlement `x402_service_results`
persistence), but is architecturally unable to reach the pre-settlement,
client-visible 502 path this checkpoint investigates. This was not previously
understood — R3's evidence report (§4) noted R10's detail "never lands
anywhere durable" but did not yet trace the parallel, independent gap in the
`executor_rejected` terminal-state mapping itself.

## 10. Result-shape / response-shape contract

`WORKFLOW_ACTUAL_TERMINAL_SHAPE = { status: 'executor_rejected', job_id,
error_code: 'partial' }` (per §7). `HTTP_WAITER_EXPECTED_SHAPE` (i.e. what
`respondFromWorkflowResult` reads): `result.status`, `result.error_code`. No
field-name drift exists between the two — `WORKFLOW_HTTP_RESULT_SHAPE_DRIFT=NO`.
The gap is a *fidelity* loss (a specific classified string collapsed into a
generic `result_class` fallback), not a shape mismatch.

## 11-13. Serialization / stream lifetime / request-lifetime audit

`respondFromWorkflowResult`'s `executor_rejected` branch returns a plain
`{error, message}` object via Hono's `c.json()` — no `BigInt`, no
`undefined` (the `error_code ?? 'executor_rejected'` fallback guarantees a
string), no circular structure, no `Response`/`Headers`/`Error`/`Uint8Array`/
`CryptoKey` object anywhere in the body. `R3_RESPONSE_SERIALIZATION=PASS`.
No response body is read twice, no stream is closed early, no `Response`
crosses a durable/RPC boundary (the Workflow returns a plain serializable
`WorkflowContinuationResult` object, consumed once by `instance.status()`'s
`output` field). `RESPONSE_STREAM_LIFETIME_DEFECT=NO`. The waiter has no
maximum-duration clock and does not depend on `waitUntil`, request lifetime,
or any other Cloudflare execution-context lifetime beyond the connected
client's own HTTP request — which, per the live tail, was still active when
the Workflow completed in 5.67s (well inside any plausible connection
budget). `REQUEST_LIFETIME_DEFECT=NO`.

## 14-15. Client disconnect and rejoin semantics

Both paths are implemented (traced, not exercised — no live attempt was
authorized or made this checkpoint): a connected client polling to completion
resolves through `respondFromWorkflowResult` (§4 step 6-7, exactly what
happened in R3). A disconnected client's Workflow continues durably (§4 step 5
comment; `handoff.ts`'s create-or-join already completed before the poll
loop starts). `REJOIN_PATH_EXISTS=YES` — `acquireOutcome.status ===
'duplicate_same'` → `driveDurableContinuation('join_only')` joins the *same*
Workflow instance via `joinExistingPaidContinuation` (get-only, never creates
a second instance). `REJOIN_CAN_SETTLE_AGAIN=NO` (settlement lives exclusively
inside the one Workflow instance; joining only re-polls its status).
`REJOIN_CAN_CREATE_DUPLICATE_JOB=NO` (`acquirePaymentAttempt`'s
`duplicate_same`/`already_consumed`/`duplicate_conflict` gating, unchanged by
this diagnosis, prevents a second job for the same payment identifier).
`REJOIN_TERMINAL_RESULT_HTTP_STATUS`: same as the original resolution — 502
for `executor_rejected`, reconstructed via `reconstructFromJob` when settled.

## 16. Route error-catch boundaries

No `catch { return 502 }` exists anywhere in this route. Every catch block in
`x402-service.ts` maps to 400 (malformed input/signature) or 500
(`repository_failure`) — never 502. The single 502 is the explicit,
intentional `executor_rejected` case in the switch statement (§5), not a
caught exception being misclassified.

## 17-19. D1/Workflow visibility races, clock/poll edge conditions

Not applicable to this failure: the 502 is not a result of a missing or
not-yet-visible row — `respondFromWorkflowResult` acts directly on the
Workflow's own `output` (returned synchronously by `instance.status()`), with
no intermediate D1 read for the `executor_rejected` branch at all (D1 is only
read in the `'settled'` branch, via `reconstructFromJob`). No race exists in
the path actually taken. `WORKFLOW_D1_VISIBILITY_RACE=NO`,
`WORKFLOW_OUTPUT_VISIBILITY_RACE=NO`, `WAITER_DEADLINE_RACE=NO` (no deadline
exists to race).

## 20. Explicit timeout inventory

Searched the entire public paid-response path
(`x402-service.ts`, `waiter.ts`, `handoff.ts`) for `5_000`, `10_000`, `30_000`,
`60_000`, `120_000`, `AbortSignal.timeout`, `setTimeout`, `Promise.race`,
`deadline`, `timeout`, `maxWait`: none exist in the response-construction
path. The only `setTimeout` is `waiter.ts`'s own `defaultSleep` (the 250ms
poll cadence), explicitly documented as "NOT a correctness bound".
`HIDDEN_RESPONSE_TIMEOUT_FOUND=NO`.

## 21. Local reproduction

Reconstructed `respondFromWorkflowResult`'s `executor_rejected` branch inline
against `{ status: 'executor_rejected', job_id: 'd6563fbb...', error_code:
'partial' }` (R3's exact terminal shape per §7): produces `Response(502,
{error:'service_execution_failed', message:'partial'})`.
`LOCAL_R3_RESPONSE_REPRODUCTION=502_REPRODUCED`. This matches R3's observed
`http_status:502` exactly. (No real provider or payment call was made or
needed — the reproduction is a pure function of the already-known terminal
state.)

## 22. Worker-runtime reproduction

Not performed as a separate step: `jsonError`/`c.json()` is plain Hono/Web
`Response` construction with no Workers-specific API involved in this branch
(no `env` binding, no `ExecutionContext`, no Workflows binding call) — the
Node-level reproduction in §21 is exhaustive for this exact branch. No
Node-vs-Workers behavioral difference exists to compare for a plain object
literal passed to `c.json()`.

## 23. Actual response expectation

`R3_EXPECTED_HTTP_STATUS=502` (the actual R3 economic state: execution
resolved without throwing, non-success `result_class`, no settlement —
exactly the `executor_rejected` contract). `R3_EXPECTED_RESPONSE_CLASS=
service_execution_failed` (deliberate business-rejection response, not an
infrastructure error). The 502 status code choice itself is a
pre-existing, already-accepted contract decision (H2AWI-3, retained from the
pre-durable design) — changing it is out of this checkpoint's scope and not
required to close the actual gap, which is purely about **error-detail
fidelity reaching the operator**, not the status code.

## 24. Root-cause branch elimination

| Domain | Classification |
|---|---|
| EXECUTOR | EXCLUDED (R5/R8 already proved: real SEC call, real rejection, zero exception) |
| OUTPUT_VALIDATION | EXCLUDED (verification mesh `decision: 'pass'`) |
| PCC | EXCLUDED (not reached — no `pcc_failed` status) |
| WORKFLOW_ORCHESTRATION | EXCLUDED (clean completion, `outcome: "ok"`) |
| D1_VISIBILITY | EXCLUDED (§17-19; not read in this branch) |
| WORKFLOW_OUTPUT_VISIBILITY | EXCLUDED (synchronous `instance.status().output`) |
| RESPONSE_SERIALIZATION | EXCLUDED (§11, PASS) |
| WAITER_STATE_MAPPING | **PROVEN** — `executor_rejected` → 502 is deliberate and correct; the defect is one layer further, in *error-detail propagation* into `error_code` (§7) and in the *test harness's* classification/body-handling (§8) |
| REQUEST_LIFETIME | EXCLUDED (§13) |
| PLATFORM_502 | EXCLUDED (§5-6: no platform-level 502 producer exists in this path; the 502 is application-generated) |

## 25. Root-cause proof standard

`R3_502_ROOT_CAUSE_PROVEN=YES`, satisfying standard (C): a unique branch
(`executor_rejected` → 502, `x402-service.ts:1211-1216`) proven by
elimination, whose preconditions (payment verified, Workflow completed
cleanly, non-success `result_class`, zero settlement) exactly match R3's
authoritative state (§1-3), combined with a second, independently-traced gap
(§7-9) that explains the *specific symptom* under investigation — why the
client saw an uninformative "ambiguous" instead of a classified reason — and
a third (§8) in the harness itself. All three are proven from source, not
inferred from narration.

**ROOT_CAUSE:** The system is not broken. `company_evidence_graph.v2`'s real
SEC EDGAR request has been legitimately rejected by SEC on every one of the
six real attempts (external, business-side, previously diagnosed in
R5/R8/R9A). The server correctly, deliberately reports this as `HTTP 502
service_execution_failed`. The information gap this checkpoint closes is
purely observational: (1) `PaidContinuationWorkflow`'s `executor_rejected`
terminal mapping discards the service's specific `limitations` detail,
falling back to the generic `result_class` string `'partial'`; (2) the
one-shot operator test harness further discards even that generic string by
only inspecting the response body on a `'success'` outcome, and coarsely
labels every `5xx` as `'ambiguous'`. Fixing either (1) or (2) — ideally both —
is required before a human operator can see *why* SEC is rejecting the
request from the harness's own output, without resorting to production log
archaeology every time.

## 26-27. Local fix

Not implemented this checkpoint — per the diagnosis-only scope (§0) and
because the checkpoint text explicitly permits but does not require a
same-checkpoint fix, and a fix here touches two files
(`paid-continuation-workflow.ts`'s `executor_rejected` terminal mapping, and
the test harness's `classifySubmissionOutcome`/result-construction) that
deserve their own RED→GREEN→mutation cycle and non-regression matrix (§27 of
the checkpoint text) rather than being rushed into an already-long diagnostic
turn. `LOCAL_FIX_IMPLEMENTED=NO`, `GENUINE_RED=NOT_EXECUTED`,
`GREEN=NOT_EXECUTED`, `MUTATION_PROOF=NOT_EXECUTED`.

## 28. No payment as a diagnostic tool

No new 402, payment authorization, signature, or paid POST was created or
requested this checkpoint. All findings above are derived from R3's existing
evidence, current repository source, and local (non-network) reasoning.

## 29. Next checkpoint design

`FIX_RELEASE_PLANE=WORKFLOW_HOST_ONLY` for the `error_code` propagation fix
(`paid-continuation-workflow.ts` runs on `siteborne-paid-continuation-runtime`
only); the harness fix is a local repo/script change with **no deployment
plane** at all (it is never deployed — it runs on the human operator's own
machine). Recommend `SUN-1222C-R4-FIX`: implement both fixes with TDD
(RED→GREEN→mutation), full regression, then `SUN-1222C-R4-COMBINED` for the
minimum deployment (Workflow-host redeploy only, no candidate upload, no
public-edge change) plus exactly one fresh, separately-authorized
`company_evidence_graph.v2` qualification payment to observe the real,
specific SEC rejection reason end-to-end for the first time.

## 30. Financial authorization boundary

No standing payment authorization exists. Confirmed unchanged: `service=
company_evidence_graph.v2`, `price=0.0312 USDC`, `amount=31200 atomic`,
`network=eip155:8453`. Any future real qualification requires its own fresh
402/nonce/signature/paid-POST, never reusing prior payment material, and the
coding agent will not perform the wallet signing step.

## 32. Final packet

```
SUN1222C_R4_D1=PASS
CURRENT_ACTIVE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
CURRENT_ACTIVE_TRAFFIC=100%
CURRENT_CANDIDATE=a064477f-7b74-46c5-a5b6-799df114b252
CURRENT_CANDIDATE_TRAFFIC=0%
R3_PAYMENT_IDENTIFIER=pay_1be0e6752e094e2aa5ae6eb2c9d54bbc
R3_JOB_ID=d6563fbb-71ba-4509-8c01-a9e674cba52d
R3_WORKFLOW_INSTANCE_ID=siteborne-wf-c57bdaf57173fd4c345921de1ad0e17ff091157f9109a0c9
R3_CLIENT_HTTP_STATUS=502
R3_502_ORIGIN=APPLICATION_GENERATED_502
WORKFLOW_FINAL_STATUS=executor_rejected
WORKFLOW_COMPLETED_CLEANLY=YES
R3_SETTLEMENT_ATTEMPT_COUNT=0
R3_MATCHING_CHAIN_TRANSFER_COUNT=0
R3_ECONOMIC_EFFECT_ATOMIC=0
WAIT_LOOP_FUNCTION=waitForWorkflowResult
SERVER_TIMEOUT_PRESENT=NO
WORKFLOW_CONTINUES_AFTER_DISCONNECT=YES
WORKFLOW_HTTP_RESULT_SHAPE_DRIFT=NO
R3_RESPONSE_SERIALIZATION=PASS
RESPONSE_STREAM_LIFETIME_DEFECT=NO
REQUEST_LIFETIME_DEFECT=NO
REJOIN_PATH_EXISTS=YES
REJOIN_CAN_SETTLE_AGAIN=NO
WORKFLOW_D1_VISIBILITY_RACE=NO
WORKFLOW_OUTPUT_VISIBILITY_RACE=NO
WAITER_DEADLINE_RACE=NO
HIDDEN_RESPONSE_TIMEOUT_FOUND=NO
LOCAL_R3_RESPONSE_REPRODUCTION=502_REPRODUCED
WORKER_RUNTIME_R3_RESPONSE_REPRODUCTION=NOT_SEPARATELY_APPLICABLE (§22)
R3_EXPECTED_HTTP_STATUS=502
R3_EXPECTED_RESPONSE_CLASS=service_execution_failed
R3_502_ROOT_CAUSE_PROVEN=YES
ROOT_CAUSE=deliberate executor_rejected->502 response is correct; error-detail
  fidelity is lost twice (Workflow's error_code fallback to generic
  result_class, then harness's success-only body inspection + coarse >=500
  ambiguous bucketing) — the system was never broken, the operator just
  couldn't see why
RESPONSE_PATH_FIX_REQUIRED=YES
FIX_RELEASE_PLANE=WORKFLOW_HOST_ONLY (+ non-deployed harness fix)
LOCAL_FIX_IMPLEMENTED=NO
GENUINE_RED=NOT_EXECUTED
GREEN=NOT_EXECUTED
MUTATION_PROOF=NOT_EXECUTED
DEPLOYS=0
TRAFFIC_MUTATIONS=0
402_REQUESTS=0
PAYMENT_AUTHORIZATIONS=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS_CREATED_BY_D1=0
CHAIN_TRANSACTIONS_CREATED_BY_D1=0
EVIDENCE_COMMIT_SHA=<set at commit time>
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R4-FIX
```

`DO NOT DEPLOY. DO NOT CREATE ANOTHER PAYMENT. DO NOT START ANOTHER
QUALIFICATION.`
