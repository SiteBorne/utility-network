# SUN-1222C-R4-D4-CONTINUED — Durable Verification-Failure Observability

**Checkpoint class:** repo-only diagnosis + TDD fix. Zero deploy, zero migration, zero payment.
**Lineage:** builds on SUN-1222C-R4-D4 (evidence commit `2a3e29e`), which left `SUN1222C_R4_D4=PARTIAL` with the specific deterministic-failure reason for job `07b7655b-3731-40e2-b376-30302333497c` (payment `pay_285a4c0c94aa4513a2f74c5400ab70b4`) unrecoverable.

## 0. Correction to SUN-1222C-R4-D4's own findings

D4's report claimed:

> "jobs = no corresponding durable row; job_artifacts = empty; job_state_events = empty; payment_attempts.job_id = NULL"

Direct, exact-match re-verification against production D1 in this checkpoint proves **the first and third parts of that claim were diagnostic errors in D4's own tooling, not real defects**:

| D4 claim | Re-verified |
|---|---|
| `jobs` row missing | **FALSE** — `jobs.id = '07b7655b-3731-40e2-b376-30302333497c'` exists, `current_state = 'REJECTED'`, `created_at` matches the payment attempt exactly |
| `job_state_events` empty | **FALSE** — 9 rows exist for this job, one per transition, `RECEIVED→VALIDATED→QUOTED→PAYMENT_CHALLENGED→PAYMENT_VERIFIED→LOCKED→ROUTED→EXECUTING→QUARANTINED→REJECTED`, each with an accurate timestamp and a fixed `TransitionReason` (`EXECUTION_FAILED`, `QUARANTINE_POLICY`, etc.) |
| `payment_attempts.job_id` NULL | **TRUE, but not a defect** — `payment_attempts.job_id` is architecturally never populated for *any* attempt (see §2); correlation instead runs through `jobs.idempotency_key = payment_attempts.payment_identifier`, confirmed exact-match for this job |

Root causes of D4's own errors: an `ORDER BY created_at` clause against `job_state_events` (whose actual timestamp column is `timestamp`, not `created_at`) silently produced an empty/error result the prior turn misread as "no rows exist," and a `payment_attempts.job_id` fuzzy-LIKE query on the wrong fragment likewise produced a false negative. **Durable job identity and the full state-transition history are correctly preserved for every real attempt, including this one.** This is stated plainly, not glossed over, because it changes what this checkpoint's fix actually needed to be.

## 1. The real, narrower root cause

With identity and transition-history durability now proven intact, the only genuine gap is: **the fixed `TransitionReason` enum values durably recorded on each state event (`EXECUTION_FAILED`, `QUARANTINE_POLICY`) carry no information about *why* — the specific, dynamic verifier/executor rejection reason is computed but never durably written anywhere.**

Call-graph proof (`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`):

| Stage | Function | Durable write | Gap |
|---|---|---|---|
| Executor returns `result_class !== 'success'` | `runPaidContinuationWorkflow` (~L757) | — | `deriveErrorDetail(executorOutcome.result)` computed here |
| Job transitioned to QUARANTINED | `transitionJobState(jobId, 'QUARANTINED', 'EXECUTION_FAILED', ...)` (pre-fix, ~L758) | `job_state_events` row, `reason='EXECUTION_FAILED'` (fixed string) | `deriveErrorDetail`'s output discarded |
| Job transitioned to REJECTED | `transitionJobState(jobId, 'REJECTED', 'QUARANTINE_POLICY', ...)` (pre-fix, ~L759) | `job_state_events` row, `reason='QUARANTINE_POLICY'` (fixed string) | same |
| Terminal result built | `terminal('executor_rejected', jobId, { error_code, error_detail })` (~L760) | none (in-memory Workflow return value only) | `error_detail` reaches only the transient `WorkflowContinuationResult`, stripped from the public HTTP response by R4-D3's own (correct, unrelated) security fix, and unrecoverable once the Workflow instance's platform-retained output is truncated/expires |

**`OBSERVABILITY_ROOT_CAUSE_PROVEN=YES`**, precisely stated: *`deriveErrorDetail`'s output is computed exactly once per rejected attempt but is written to zero durable stores; the only durable artifact of the same event carries a fixed, non-specific enum reason.*

## 2. Durable attempt correlation — architecture confirmed correct as-is

`payment-attempts.ts`'s own doc comment (L15): *"attempt is authoritatively acquired *before* a job exists"* — `payment_attempts.acquire()` runs at 402-issuance time, before `jobId = crypto.randomUUID()` is ever generated, and no code path anywhere in the repository issues `UPDATE payment_attempts SET job_id = ...` afterward (`job_id` stays null for every attempt, by design, not by omission). The join back to a job instead goes through `jobs.idempotency_key = payment_attempts.payment_identifier` — confirmed exact-match for this job. **`DURABLE_ATTEMPT_CORRELATION_REQUIRED=NO`** as a *new* requirement — it already holds, via a different column than the one D4 assumed.

**`DURABLE_IDENTITY_LOSS_ROOT_CAUSE=UNPROVEN`** (no defect found; D4's claim was a diagnostic-tooling error, corrected in §0).
**`DETERMINISTIC_FAILURE_LOSS_ROOT_CAUSE=PROVEN`** (§1).

## 3. Verification mesh — enumerated (unchanged from D4, re-confirmed)

`STANDARD_VERIFIER_COUNT=8`, `VERIFICATION_MODE=standard`, `REPRODUCTION_MODE_VERIFIER_PRESENT=NO` — single callsite `packages/service-runtime/src/pcc/verify-and-sign.ts:123`, unchanged this checkpoint.

## 4. Safe diagnostic schema — reused, not invented

`deriveErrorDetail` (`paid-continuation-workflow.ts`, pre-existing from R4-D3) already returns a bounded (`ERROR_DETAIL_MAX_LENGTH = 500`, `boundedDetail()`), service-authored string sourced only from `failure.message` or the last `limitations` entry — R4-D3's own comment: *"these are already sanitized, service-authored strings ... never raw upstream response bodies, headers, or credentials."* No new derivation, no new redaction logic — this fix reuses that exact string unchanged.

`SAFE_DURABLE_FAILURE_SCHEMA` = the existing `StateEvent.evidence_ref?: string` field (`apps/edge-api/src/control-plane/types/index.ts:121`, `z.string().optional()`), backed by the existing `job_state_events.evidence_ref` D1 column (already nullable, already part of every `INSERT INTO job_state_events`). **No schema change. No migration.**

`SELECTED_DURABLE_FAILURE_STORAGE=job_state_events.evidence_ref` — semantic fit is exact (a per-transition free-text reference field), already correlated (via `job_id`), already sized appropriately for a bounded 500-char string, already indexed by the existing `getByJobId` query path, already idempotency-safe (see §7).

`MIGRATION_REQUIRED=NO`.

## 5. Fix

`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`:

1. `transitionJobState(jobId, toState, reason, persistence, evidenceRef?)` — new optional 5th parameter, threaded straight into the existing `createStateEvent(..., evidenceRef)` call (that function already accepted this parameter; it was simply never passed).
2. At the `executor_rejected` branch: `deriveErrorDetail(executorOutcome.result)` is now computed **once** and reused for both the terminal `WorkflowContinuationResult.error_detail` (unchanged behavior) and the two `transitionJobState(...)` calls (QUARANTINED, REJECTED) — the exact same string in both places, never two independent derivations.
3. At the `executor_timeout` (thrown-error) branch: the caught error's own message, bounded through the same `boundedDetail()` helper, is passed the same way — closing the analogous gap for a thrown/transport failure, not just a resolved-rejected one.

Every other call site of `transitionJobState` (§1's `expiryCheck`, the happy-path `ROUTED`/`EXECUTING`/`VERIFYING` transitions) is untouched — the parameter is optional and additive.

## 6. RED → GREEN → mutation proof

New tests in `apps/edge-api/tests/paid-continuation-workflow.test.ts`, describe block *"durable rejection-detail capture (SUN-1222C-R4-D4-CONTINUED)"*:

- persists the specific reason (limitations-only shape) as both QUARANTINED's and REJECTED's `evidence_ref`
- persists the specific reason (`failure.message` shape) too
- leaves `evidence_ref` undefined (not a stray value) when `deriveErrorDetail` has nothing to report
- persists a bounded reason for the `executor_timeout` (thrown-error) branch too
- proves nothing beyond the one derived string (no payment/signature/header material) ever reaches `evidence_ref`
- idempotency: re-running an already-terminal transition never appends a second event
- a D1 write failure on the REJECTED event's `appendStateEvent` propagates (fails closed) rather than being silently swallowed, with zero settlement calls

`DURABLE_FAILURE_CAPTURE_RED=YES` (4 of the above genuinely failed pre-fix — `expected undefined to be '...'`).
`DURABLE_FAILURE_CAPTURE_GREEN=PASS` (all pass post-fix, 41/41 in the file).
`DURABLE_CORRELATION_RED=NOT_APPLICABLE` (§2 proved no correlation defect exists to fix).
`DIAGNOSTIC_REDACTION_TEST_RED=NO` (this is a defense-in-depth assertion on already-correct behavior, not a RED-first regression — R4-D3 already established the sanitization boundary; this test only proves nothing *else* leaks alongside it).
`OBSERVABILITY_MUTATION_PROOF=PASS` — temporarily stripping `evidenceRef` from the two REJECTED-transition call sites reproduced the exact same 4 failures as pre-fix RED; restored, re-confirmed 41/41 GREEN.
`FAILURE_DIAGNOSTIC_IDEMPOTENCY=PASS`.
`DIAGNOSTIC_WRITE_FAILURE_SETTLEMENT_COUNT=0` (propagates uncaught; `deps.settle` never invoked).
`POST_HOC_DIAGNOSIS_FROM_DURABLE_STATE=PASS` — every assertion above reads `deps.jobPersistence.events` (the fake's own durable store), never an in-memory function return value.

## 7. All-verifier / non-regression scope

This fix touches only the *terminal write path* after an executor result is already classified — it does not touch verifier logic, `runMesh`, PCC generation, or the settlement decision. The happy-path tests (`'runs the 7 frozen steps in exact order'`, `'settle step has zero retries'`, `'is the sole production settle() call site'`) all still pass unchanged, proving zero drift into the success path.

## 8. Full regression

- `paid-continuation-workflow.test.ts`: **41/41 PASS** (34 pre-existing + 7 new)
- All 4 Workflow-related test files together: **64/64 PASS**
- Full repo suite: **2963/3047 PASS**, 78 intentional skips, 6 failures — all 6 reconfirmed **PASS in isolation** (resource-contention timeouts under full-parallel load: `nevermined-live-migration-idempotency.test.ts`, `production-cdp-full-stack-mock.test.ts`, `production-route-continuation-wiring.test.ts`, `worker-bridge.subprocess.test.ts` — none touch the changed file)
- `TYPECHECK=PASS` (`tsc --noEmit -p apps/edge-api`)
- `BUILD=PASS` (12/12 turbo tasks)
- `LINT=PASS` (changed files clean)
- `x402:check=PASS`, `mcp:check=PASS`, `a2a:check=PASS`
- `SECRETS_SCAN`: 2 pre-existing findings, both in historical `docs/reports/` commits dated 2026-09-03/2026-09-06 (before this checkpoint), 0 new findings from this diff
- `PRODUCTION_PREFLIGHT=PASS`
- `WRANGLER_DRY_RUN=PASS` (both public API and paid-continuation-runtime host targets build and bundle cleanly)

## 9. No economic semantic drift

`PUBLIC_API_SETTLE_CALLSITES=0`, `DEDICATED_WORKFLOW_SETTLE_CALLSITES=1` (`paid-continuation-workflow.ts:644`, unchanged), `TOTAL_PRODUCTION_SETTLE_CALLSITES=1`. No new `.verify()`/`.settle()`/executor invocation/economic retry path introduced.

## 10. Original D4 attempt

`ORIGINAL_D4_DETERMINISTIC_FAILURES=UNRECOVERABLE` — not fabricated. This checkpoint's D1-truncation finding (platform/API-side, not CLI rendering) still stands for that specific historical attempt's *exact verifier-level* reasons; what §0 recovers is only that the job identity, correlation, and transition history were never actually lost. The fix is prospective, applying to every attempt from here forward.

## 11. Final packet

```
SUN1222C_R4_D4_CONTINUED_DIAGNOSIS=PASS
DURABLE_IDENTITY_LOSS_ROOT_CAUSE=UNPROVEN
DETERMINISTIC_FAILURE_LOSS_ROOT_CAUSE=PROVEN
OBSERVABILITY_ROOT_CAUSE_PROVEN=YES
DURABLE_ATTEMPT_CORRELATION_REQUIRED=NO (already holds via jobs.idempotency_key)
STANDARD_VERIFIER_COUNT=8
VERIFICATION_MODE=standard
REPRODUCTION_MODE_VERIFIER_PRESENT=NO
SELECTED_DURABLE_FAILURE_STORAGE=job_state_events.evidence_ref (existing column)
MIGRATION_REQUIRED=NO
SAFE_DURABLE_FAILURE_SCHEMA=StateEvent.evidence_ref (existing, bounded ≤500 chars via deriveErrorDetail/boundedDetail)
DURABLE_FAILURE_CAPTURE_RED=YES
DURABLE_CORRELATION_RED=NOT_APPLICABLE
DIAGNOSTIC_REDACTION_TEST_RED=NO
DURABLE_FAILURE_CAPTURE_GREEN=PASS
DURABLE_CORRELATION_GREEN=NOT_APPLICABLE
DIAGNOSTIC_REDACTION_GREEN=PASS
FAILURE_DIAGNOSTIC_IDEMPOTENCY=PASS
OBSERVABILITY_MUTATION_PROOF=PASS
DIAGNOSTIC_WRITE_FAILURE_SETTLEMENT_COUNT=0
POST_HOC_DIAGNOSIS_FROM_DURABLE_STATE=PASS
ORIGINAL_D4_DETERMINISTIC_FAILURES=UNRECOVERABLE
PUBLIC_API_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
TEST_FILES=4 (workflow-scoped), 244 (full repo)
TESTS_PASS=2963/3047 full repo (6 reconfirmed-isolated flakes), 64/64 workflow-scoped
TESTS_SKIPPED=78 (intentional)
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
WORKER_RUNTIME=not separately re-run this checkpoint (no worker-runtime-relevant code touched; wrangler dry-run both targets PASS)
SECRETS_SCAN=2 pre-existing (dated before this checkpoint), 0 new
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS
PRODUCTION_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
FIX_COMMIT_SHA=(this commit)
EVIDENCE_COMMIT_SHA=(this commit)
WORKING_TREE=clean after commit
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R4-D5-OBSERVABILITY-DEPLOYMENT
```

## 12. Deployment plan — design only, not executed

If/when authorized:

A. One deployment of `siteborne-paid-continuation-runtime` (the sole runtime this fix touches — confirmed by the same static-import trace method used in prior R4 deployment checkpoints: `paid-continuation-workflow.ts` is not imported by the public API Worker's bundle).
B. No migration (§4/§10 — none required).
C. Authoritative version/lineage readback.
D. A bounded non-economic proof if one is safely constructible (e.g. a synthetic rejection path through the real deployed Workflow, if such a harness exists without requiring real payment material).
E. Only then decide whether a further real controlled paid qualification is necessary — requiring its own fresh standalone financial authorization; **none exists from this checkpoint.**

No deployment, migration, or payment action was taken in this checkpoint.
