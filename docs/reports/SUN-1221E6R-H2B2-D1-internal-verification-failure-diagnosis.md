# SUN-1221E6R-H2B2-D1 — exact `internal_verification_failed` root-cause diagnosis

## Summary

**ROOT_CAUSE_PROVEN=YES.** The H2B2-R1 real payment's `internal_verification_failed`
verdict is caused by a contract-drift bug: `ModalSafeEgressClient`
(`packages/provider-adapters/src/http/modal-safe-egress-client.ts`) sends
`max_response_bytes: 10 * 1024 * 1024` (10,485,760, binary-MiB-based) on
every call by default, but the Python executor's own Pydantic schema
(`services/webctx-safe-egress/src/webctx_safe_egress/schemas.py`,
`WebctxFetchRequest.max_response_bytes`) enforces `le=10_000_000`
(decimal). The TS default *unconditionally* exceeds the Python bound by
485,760 bytes on every single request — deterministic, 100% reproducible,
not transient. Modal's executor correctly rejects the malformed request
with HTTP 400 per its own schema validation; `ModalSafeEgressClient`
parses that as a structured failure and throws; `PublicHttpAdapter`
classifies the resulting fetch as non-`success`; `WebContextVerifiedService`
sets `result_class: internal_verification_failed` — all before any PCC/
settlement logic runs. This is a clean, non-payment-affecting service
defect, not an infrastructure or credential problem.

## 1–2. Failed attempt identity

- `H2B2_R1_JOB_ID` = `3898e160-edd7-4bbf-adcb-80ac4b75f301` (D1 `jobs.id`) /
  `job_88582ce8b78f8cf635740622` (executor-internal job id in the receipt)
- `H2B2_R1_PAYMENT_IDENTIFIER` = `pay_eb8417f8666e4ff088b93d7359c88a0f`
- `H2B2_R1_WORKFLOW_INSTANCE_ID` = `siteborne-wf-8c6272229787e3b8903b76e3a4bbc682dac87d96723de45d`
- `H2B2_R1_WORKFLOW_VERSION_ID` = `caa7b4b7-4fe3-434d-9839-2e6e5f864286`
- `H2B2_R1_HOST_VERSION_ID` = `45c99a30-89f4-49cd-9a1b-91467b0617dc`

D1 confirms: `jobs.current_state = REJECTED`, created/updated 9s apart
(13:10:06 → 13:10:15 UTC); `payment_attempts.lifecycle_stage = verified`,
`settlement_transaction_reference = NULL`; no `x402_service_results` row
exists for this payment_identifier (only written on real settlement).

## 3. Result-class producer matrix (`internal_verification_failed`)

| File | Function | Condition | Downstream |
|---|---|---|---|
| `service-runtime/src/services/web-context/service.ts:88-91` | `WebContextVerifiedService.execute` | `result.resultClass !== 'success' \|\| !result.observations?.length` | `resultClass = internal_verification_failed` (or `source_changed`) |
| `service-runtime/src/services/web-context/service.ts:240` | same | `!verdictFailed && !httpFetchFailed ? resultClass : 'internal_verification_failed'` | final `result_class` |
| `service-runtime/src/dispatcher.ts:99` | dispatcher fallback | `failure.code !== 'unknown_service'` | unrelated dispatch-level fallback, not this path |
| `agent-verification/service.ts:237`, `document-evidence/service.ts:256`, `company-evidence/service.ts:458-463` | other services | N/A | different service (`web_context_verified.v2` only reaches `web-context/service.ts`) |

Only `web-context/service.ts` is reachable for this job's `service_id`.
`INTERNAL_VERIFICATION_FAILED_CALLSITE_COUNT=2` relevant production
call sites in that one file (lines 91 and 240), both in the same function.

## 4. Real executor verification chain (confirmed by source + real output)

```
Workflow invoke-executor-1
→ buildWebContextV2ProductionExecutor (web-context-v2-production-executor.ts)
→ executeLocalService → WebContextVerifiedService.execute
→ this.deps.publicHttp.execute({url: target_url, ...})  [PublicHttpAdapter]
→ this.httpClient.fetch(...)  [ModalSafeEgressClient, injected by
  buildWebContextV2CdpProductionRouteConfig via
  buildWebContextV2ModalSafeEgressClient]
→ POST to MODAL_WEBCTX_ENDPOINT_URL with JSON body incl. max_response_bytes
→ Modal's WebctxFetchRequest Pydantic validation REJECTS (le=10_000_000
  violated) → HTTP 400
→ ModalSafeEgressClient parses 400 as WebctxFetchFailureBody, throws
  "<reason_code>: <message>"
→ PublicHttpAdapter catches, maps to non-success resultClass
→ WebContextVerifiedService: httpFetchFailed=true, verdictFailed=false
  (verifyAndSign still runs and succeeds on the empty-content draft)
→ result_class: internal_verification_failed, receipt/pcc_hash PRESENT
→ paid-continuation-workflow.ts's post-step logic sees non-success
  result_class → transitions QUARANTINED/EXECUTION_FAILED → REJECTED,
  never calls evidenceProvider.settle()
```

This exactly explains the observed symptom that was initially
counter-intuitive: a **valid receipt/pcc_hash present** alongside
`result_class: internal_verification_failed` — `verifyAndSign` signs
the (empty) draft document regardless of whether the underlying fetch
succeeded; only the `result_class`/`failure` fields reflect the fetch
outcome.

## 5. Failure domain

**A_TRANSPORT** (transport-layer request malformation caught by the
executor's own input-schema validation) — not B (HTTP status from the
*target site*), not E (output schema), not H (uncaught runtime
exception — this is a handled, expected failure path).

## 6. D1 diagnostic fields

- `D1_DIAGNOSTIC_FIELDS_AVAILABLE`: `jobs.current_state`,
  `payment_attempts.lifecycle_stage`, `payment_attempts.settlement_transaction_reference`
- `D1_DIAGNOSTIC_FIELDS_POPULATED`: yes, but none carry the executor's
  specific failure reason/message — that detail is not persisted to D1
  by design (only pass/fail state transitions are)
- `D1_EXACT_FAILURE_CODE` / `D1_EXACT_FAILURE_DETAIL` = `NOT_PERSISTED`

## 7–8. Wrangler output-truncation investigation

Read `wrangler-dist/cli.js` (installed 4.119.0): the only client-side
truncation is `output.substring(0, args.truncateOutputLimit) +
"[...output truncated]"` (`--truncate-output-limit`, default 5000).
Empirically retested at `50` (visibly shorter — flag is read correctly),
`50000`, and `999999` (**identical truncation point in all three**,
~1150-1200 chars, same `[...output truncated]` marker). This proves the
underlying `step.output` string wrangler receives from the Cloudflare
API is *already* capped at roughly that length before the client-side
flag ever applies — the limiting factor is server-side (API payload
cap for step-output fields in the describe/list response), not the CLI.

- `WRANGLER_FULL_STEP_OUTPUT_SUPPORTED=NO`
- `TRUNCATION_IMPLEMENTATION_LOCATION=API`
- `TRUNCATION_IS_CLIENT_SIDE=NO`

No auth tokens were extracted or used outside Wrangler's own commands.

## 9. Read-only Modal observability

`modal app logs ap-Fpf9jp27SCcWMV533bUCsz` (both plain and `--since 3h`)
returned exactly 2 recent entries: `POST / -> 400 Bad Request` (x2,
duration ~4-4.7s, execution ~140-150ms) — consistent in shape with a
Pydantic-validation-rejected `WebctxFetchRequest` (fast rejection before
any real target fetch is attempted) and with the ~5s `invoke-executor-1`
step duration observed on real infrastructure. No historical log
retention reaches back to the exact 13:10 UTC timestamp with
correlation-id-level detail; this is corroborating, not the sole,
evidence — the source-level contract comparison in §3-4/§12 below is
decisive on its own.

- `MODAL_EXECUTION_FOUND=YES` (indirect, via access-log shape correlation)
- `MODAL_TRANSPORT_SUCCESS=YES` (reached the executor; 400 is Modal's own answer)
- `MODAL_HTTP_STATUS=400`
- `MODAL_DIAGNOSTIC_ERROR_CLASS=request_schema_validation_failure` (inferred from source, not printed from logs — no message body was retained)

## 10. Executor success vs. SITEBORNE verification success

- `SAFE_EGRESS_REQUEST_COMPLETED=YES` (transport reached Modal)
- `SAFE_EGRESS_RESPONSE_RECEIVED=YES` (400, structured)
- `SAFE_EGRESS_RESPONSE_PARSEABLE=YES`
- `EXECUTOR_BUSINESS_RESULT_SUCCESS=NO` (Modal correctly rejected an
  invalid request — this is the *executor* working as designed against
  a malformed caller, not an executor bug)
- `SITEBORNE_POST_EXECUTOR_VERIFICATION_SUCCESS=NO`

The word "executor failed" does not apply here — the defect is entirely
on the **caller** (`ModalSafeEgressClient`)'s outgoing default, not the
target site, not Modal's own code, not SITEBORNE's post-fetch
verification logic.

## 11. Real executor output shape recovered

`REAL_EXECUTOR_OUTPUT_RECOVERED=YES` (partial, from the real Workflow
instance's truncated-but-sufficient `invoke-executor-1` output):
`result_class`, `service_id`, `service_version`, `job_id`, `input_hash`,
`output_hash`, `pcc_hash`, `receipt_id`, `receipt.*` (all present, no
credentials/payment material). The `failure`/`limitations` fields
(later in the JSON) fall past the ~1200-char server-side cap and were
not recoverable — not needed given the direct source-level proof below.

## 12. Validator-selection proof (re-confirms this is NOT the R1/H2B2-R1 defect recurring)

`SELECTED_OUTPUT_VALIDATOR_ID` / `SELECTED_OUTPUT_SCHEMA_ID`: precompiled
validators registered via `setPrecompiledOutputValidators()` at module
load in `workflow-host-entrypoint.ts` (fixed in H2B2-R1, evidence
`e13a255`). `PRECOMPILED_VALIDATOR_SELECTED=YES`,
`RUNTIME_AJV_COMPILE_ATTEMPTED=NO` — confirmed: no `EvalError` occurred
this run; `invoke-executor-1` reached a real result. This is a distinct,
new defect, not the old one recurring.

## 13-14. Reproduction / branch elimination

Direct executor re-invocation is forbidden by this checkpoint. Root
cause is instead proven by elimination + exact contract comparison
(Standard B/C):

- `verifyAndSign` succeeded (receipt/pcc_hash present) → rules out any
  signing/key-registry/receipt-identity defect.
- `open-envelope-1` and `check-authorization-expiry-1` both succeeded →
  rules out the R1 (precompiled validator) and continuation-key defects.
- The only remaining branch that produces `internal_verification_failed`
  with a valid receipt is `httpFetchFailed=true` from a non-`success`
  `PublicHttpAdapter` result — and the *only* injected `httpClient` on
  this path is `ModalSafeEgressClient`, whose one and only fixed,
  input-independent default (`max_response_bytes`) is provably out of
  bounds against the executor's own schema.

`SURVIVING_FAILURE_BRANCHES=["ModalSafeEgressClient.max_response_bytes default exceeds WebctxFetchRequest.max_response_bytes le=10_000_000"]`
— exactly one. `ROOT_CAUSE_UNIQUE_BY_ELIMINATION=YES`.

## 15. Schema drift

`EXECUTOR_SCHEMA_DRIFT_FOUND=YES` — exactly one field:

| Field | TS client default | Python schema bound | Violation |
|---|---|---|---|
| `max_response_bytes` | `10 * 1024 * 1024` = `10,485,760` | `le=10_000_000` | exceeds by `485,760` |

`deadline_ms` (`25_000` default vs. Python `le=30_000`) is within bounds
— not implicated.

## 16. Registry drift

Not applicable to this defect — the failure occurs before any output
schema/validator is reached (`WebContextVerifiedService` never gets a
successful fetch to validate). `HOST_API_VALIDATOR_DRIFT=NO`.

## 17-19. Internal exceptions / Cloudflare-only hazards / worker-runtime reproduction

The failure is a normal, caught `throw` inside `ModalSafeEgressClient.fetch`
(line 164 of that file), not an uncaught runtime exception and not a
Cloudflare-Workers-specific incompatibility — it reproduces identically
in any JS runtime given the same numeric mismatch. `WORKER_RUNTIME_FAILURE_REPRODUCED=NOT_POSSIBLE`
without a live Modal call (forbidden this checkpoint); not needed —
the numeric contract violation is unconditional and environment-independent.

## 20-21. Root cause

- `ROOT_CAUSE_PROVEN=YES` (Standard B + C jointly: direct source
  comparison of the exact numeric contract, corroborated by real Modal
  access-log entries matching the expected failure shape)
- `PRIMARY_ROOT_CAUSE`: `ModalSafeEgressClient`'s default `max_response_bytes`
  (10,485,760, MiB-based) exceeds the Modal executor's Pydantic
  `WebctxFetchRequest.max_response_bytes` bound (`le=10_000_000`,
  decimal-based) on every call, causing the executor to reject every
  request with HTTP 400.
- `EXACT_FILE`: `packages/provider-adapters/src/http/modal-safe-egress-client.ts`
- `EXACT_FUNCTION`: `DEFAULT_MAX_RESPONSE_BYTES` constant / `ModalSafeEgressClient.fetch`
- `EXACT_BRANCH`: line 59 constant flowing into line 114's request body
- `EXACT_TRIGGER`: every request where the caller does not explicitly
  override `maxResponseBytes` below 10,000,000 — true for every current
  caller (`buildWebContextV2ModalSafeEgressClient` never overrides it)
- `FAILURE_DOMAIN`: A_TRANSPORT
- `ROOT_CAUSE_PROOF_METHOD`: direct source-level contract comparison
  (TS constant vs. Python `Field(le=...)`) + corroborating real Modal
  access logs
- `ROOT_CAUSE_CONFIDENCE`: high — deterministic, unconditional, exact
  numeric proof, not a heuristic inference

## 22. Remediation classification

`REMEDIATION_CLASS=C_SCHEMA_CONTRACT_DRIFT`

## 23. Minimal remediation design (design only, not implemented here)

- File: `packages/provider-adapters/src/http/modal-safe-egress-client.ts`
  — change `DEFAULT_MAX_RESPONSE_BYTES` from `10 * 1024 * 1024` to
  `10_000_000` (or any value `<= 10_000_000`), matching the Python
  schema's decimal-based bound exactly.
- Test required: a unit test asserting the constructed request body's
  `max_response_bytes` never exceeds `10_000_000` (both the pure
  default case and any explicit override), plus (already existing)
  `modal-safe-egress-client.test.ts` gets a new case for this bound.
- No Modal (Python) deployment required — the fix is entirely on the
  TypeScript side; the Python schema is already correct and does not
  need to change.
- No Workflow-host deployment strictly required for correctness, but a
  deployment IS required to ship the fix to the running dedicated host
  (`siteborne-paid-continuation-runtime`) before any future real
  payment can succeed.
- No API candidate change, no traffic change, no economics change.

`REMEDIATION_MUTATION_PLAN`: one-line constant fix + one new test case
+ regression + one host redeploy (same pattern as H2B2-R1) + one fresh
H2B2-class real-payment qualification retry, under fresh authorization.

## 24. Next combined checkpoint scope

One combined checkpoint (not executed here): TDD fix of the
`DEFAULT_MAX_RESPONSE_BYTES` constant → full regression → one host
redeploy → one fresh H2B2 real-payment qualification retry →
reconciliation. Same shape as H2B2-R1.

## 26. Final packet

```
SUN1221E6R_H2B2_D1=PASS
ROOT_CAUSE_PROVEN=YES
H2B2_R1_JOB_ID=3898e160-edd7-4bbf-adcb-80ac4b75f301
H2B2_R1_WORKFLOW_INSTANCE_ID=siteborne-wf-8c6272229787e3b8903b76e3a4bbc682dac87d96723de45d
INTERNAL_VERIFICATION_FAILED_CALLSITE_COUNT=2
D1_EXACT_FAILURE_CODE=NOT_PERSISTED
D1_EXACT_FAILURE_DETAIL=NOT_PERSISTED
WRANGLER_FULL_STEP_OUTPUT_SUPPORTED=NO
WRANGLER_OUTPUT_TRUNCATION_LOCATION=API
MODAL_EXECUTION_FOUND=YES
SAFE_EGRESS_REQUEST_COMPLETED=YES
SAFE_EGRESS_RESPONSE_RECEIVED=YES
EXECUTOR_BUSINESS_RESULT_SUCCESS=NO
SITEBORNE_POST_EXECUTOR_VERIFICATION_SUCCESS=NO
REAL_EXECUTOR_OUTPUT_RECOVERED=YES
PRECOMPILED_VALIDATOR_SELECTED=YES
RUNTIME_AJV_COMPILE_ATTEMPTED=NO
REAL_OUTPUT_LOCAL_REPRODUCED=NO
SURVIVING_FAILURE_BRANCHES=["max_response_bytes contract drift"]
EXECUTOR_SCHEMA_DRIFT_FOUND=YES
HOST_API_VALIDATOR_DRIFT=NO
WORKER_RUNTIME_FAILURE_REPRODUCED=NOT_POSSIBLE
PRIMARY_ROOT_CAUSE=ModalSafeEgressClient default max_response_bytes (10,485,760) exceeds WebctxFetchRequest.max_response_bytes le=10,000,000
FAILURE_DOMAIN=A_TRANSPORT
REMEDIATION_CLASS=C_SCHEMA_CONTRACT_DRIFT

HOST_DEPLOYMENTS=0
API_DEPLOYMENT_MUTATIONS=0
WORKFLOW_INSTANCE_CREATIONS=0
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNER_CALLS=0
PAID_POSTS=0
REAL_SETTLEMENTS=0
REAL_ECONOMIC_EFFECT_USDC=0

SUN1221F_CANARY_ELIGIBLE=NO
NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R-H2B2-R2-COMBINED
```
