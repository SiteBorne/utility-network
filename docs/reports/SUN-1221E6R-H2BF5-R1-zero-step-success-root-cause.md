# SUN-1221E6R-H2BF5-R1 — Zero-Step Success Root-Cause Reconciliation + Fail-Closed Host Dependency Gate

**Executed in the foreground, this session, no background agent.** Every command below was actually run; output is what the terminal returned.

## Load-bearing question

> missing required Workflow-host secrets → production dependency construction → `run()` resolves normally before first `step.do()` → Cloudflare records Completed + Success + zero steps.

**`MISSING_SECRET_ZERO_STEP_SUCCESS_REPRODUCED=YES`** — proven by direct source inspection and confirmed live against the real, unmocked `PaidContinuationWorkflow` class.

## 1. Working tree at start

```
HEAD: 2affe4533940f42af4f210abdbde9dc8a3bec40b
git status --short: (clean)
```

## 2. Root cause, from source

`PaidContinuationWorkflow.run()` (`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`, pre-fix lines 714-733):

```ts
async run(event, step): Promise<WorkflowContinuationResult> {
  const deps = await buildProductionPaidContinuationWorkflowDependencies(this.env, event.payload.metadata.service);
  if ('unavailable' in deps) {
    return terminal('workflow_internal_error', jobId, { error_code: `dependencies_unavailable: ${deps.reason}` });
  }
  return runPaidContinuationWorkflow(event, step, deps);
}
```

`buildProductionPaidContinuationWorkflowDependencies` (`production-dependencies.ts`) returns a plain `{unavailable: true, reason}` object — never throws — for any of: unsupported service, missing `env.DB`, missing `env.PAYMENT_CONTINUATION_ENCRYPTION_KEY`, or the underlying route-composition function reporting unavailable (missing CDP/receipt-signing credentials).

**The defect:** `run()` returned that `{unavailable}` case as an ordinary **resolved** value — a real object, `{status: 'workflow_internal_error', ...}` — via a code path that runs *before* any `step.do()` call. Cloudflare's Workflows platform determines instance status (`Completed` vs `Errored`) from whether `run()` **throws**, not from the contents of what it resolves with. The platform has no visibility into the application-level `status` field inside the resolved object. So a genuine configuration failure (all five host secrets absent, since `wrangler secret bulk` was never run against the host before the synthetic instance was triggered) was recorded by Cloudflare as **Completed, Success=Yes, Steps=0** — exactly the real H2BF5 instance's observed result.

This was, ironically, already covered by pre-existing tests (`paid-continuation-workflow-entrypoint.test.ts`, `ACTUAL_CLASS_FAIL_CLOSED` cases, written at H2BF1) — they already asserted `doSpy` was never called and `result.status === 'workflow_internal_error'`. Those tests were correct about the *application*-level contract and simply never checked the *platform*-level contract (resolve vs. throw), which is the one that actually matters for Cloudflare's own instance-status field.

## 3. Live reproduction, unmocked, real class

Added a throwaway test file exercising the real, unmocked dependency chain (env with `DB` present, all 5 secrets absent — matching the deployed host's actual state):

```
$ npx vitest run apps/edge-api/src/control-plane/workflows/h2bf5-r1-unmocked-repro.test.ts --reporter=verbose
✓ MISSING_ALL_FIVE_SECRETS: real class, real dependency-builder, DB present but all 5 secrets absent -> resolves normally with ZERO step.do calls
  R1 REPRO — missing all secrets — resolved value: {"status":"workflow_internal_error","job_id":"job-r1-repro","error_code":"dependencies_unavailable: PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing"}
  R1 REPRO — missing all secrets — step.do call count: 0
✓ CONTROL — DB binding itself absent -> same normal-return, zero-step shape
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Confirms, against the real class (no mock of `production-dependencies.ts`): resolved (not thrown), `job_id` correct, zero `step.do` calls, first check hit is `PAYMENT_CONTINUATION_ENCRYPTION_KEY` (the first secret-dependent check after the `DB` check).

**Complete-env control** (pre-existing `ACTUAL_CLASS_RUN_GREEN`/`ACTUAL_CLASS_HAPPY_PATH` tests, run live, unchanged): with full fake deps, `run()` reaches `step.do('open-envelope', ...)` — step count 1 — before failing closed on the deliberately-malformed test envelope, with an `error_code` that does **not** contain `dependencies_unavailable`. This is the correct baseline the defect diverges from.

## 4. Fix — TDD RED → GREEN → mutation proof

**RED** (test updated to require throwing; run against unfixed source):
```
FAIL ACTUAL_CLASS_FAIL_CLOSED: ... missing PAYMENT_CONTINUATION_ENCRYPTION_KEY ...
AssertionError: promise resolved "{ …(3) }" instead of rejecting
Tests  2 failed | 4 passed (6)
```

**Fix** (`paid-continuation-workflow.ts`, the `if ('unavailable' in deps)` branch): `throw new Error(...)` instead of `return terminal(...)`. Nothing else changed — `runPaidContinuationWorkflow` (already exhaustively tested) is untouched.

**GREEN**:
```
✓ ACTUAL_CLASS_FAIL_CLOSED: an unsupported/unknown service ... THROWS
✓ ACTUAL_CLASS_FAIL_CLOSED: missing PAYMENT_CONTINUATION_ENCRYPTION_KEY ... THROWS
✓ (4 other entrypoint tests, unaffected)
Tests  6 passed (6)
```
Unmocked repro re-run, updated to expect throw: `Tests 2 passed (2)`.

**Mutation proof** — reverted the throw back to the original `return terminal(...)` fail-open shape:
```
Tests  4 failed | 4 passed (8)
```
(exactly the entrypoint's 2 throw-assertions + the repro file's 2 throw-assertions — genuinely caught). Restored the fix from a pre-mutation backup; re-ran:
```
Tests  8 passed (8)
```

Scratch unmocked-repro file removed after capturing its evidence (its coverage is a stricter, unmocked superset of what the permanent entrypoint tests already assert with the throw expectation).

## 5. Full regression (all run live, this session)

| Gate | Result |
|---|---|
| Workflow/continuation/host regression (9 files) | 75/75 pass |
| `pnpm test` | 213 files / 2581 tests pass, 74 skipped (baseline unchanged) |
| `pnpm test:worker-runtime` | 99/99 scenarios pass, incl. dedicated-host bundle isolation (inclusion + exclusion halves) and cross-script binding proof |
| `pnpm lint` | pass |
| `pnpm typecheck` | 3 pre-existing errors, confirmed byte-for-byte identical (via `git stash` diff) to before this change — 0 new |
| `pnpm production:preflight` | PASS |
| `pnpm secrets:scan` | 4 pre-existing findings (known duplicate-under-rewritten-history baseline), 0 new |
| Single-settlement-owner audit | exactly one production `evidenceProvider.settle()` call site (`paid-continuation-workflow.ts:480`); `cdp-provider.ts:161` is that provider's own internal facilitator call, not a second caller; `testing/in-process-workflow-binding.ts` is test-only, proven unreachable from the production bundle by the worker-runtime bundle-isolation gate above |

## 6. Zero external mutation (confirmed — no wrangler mutating command was run this checkpoint)

```
HOST_SECRET_MUTATIONS=0
HOST_DEPLOYMENT_MUTATIONS=0
WRANGLER_SECRET_BULK_CALLS=0
WRANGLER_DEPLOY_CALLS=0
WORKFLOW_INSTANCE_CREATIONS=0
API_WORKER_UPLOADS=0
API_DEPLOYMENT_MUTATIONS=0
REAL_LIVE_402_REQUESTS=0
REAL_PAID_REQUESTS=0
REAL_EXECUTOR_CALLS=0
REAL_FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
```

## Final packet

```
SUN1221E6R_H2BF5_R1_ZERO_STEP_RECONCILIATION=PASS
PRE_STEP_NORMAL_RETURN_PATH_EXISTS=YES
PRE_STEP_ERROR_SWALLOWED=YES
MISSING_ALL_SECRETS_RUN_RESOLVED=YES
MISSING_ALL_SECRETS_RUN_THROWN=NO   (pre-fix); YES (post-fix)
MISSING_ALL_SECRETS_STEP_COUNT=0
MISSING_SECRET_ZERO_STEP_SUCCESS_REPRODUCED=YES
COMPLETE_ENV_SAFE_PROBE=PASS
COMPLETE_ENV_STEP_COUNT=1
PRIMARY_ROOT_CAUSE=run() returned (never threw) a resolved WorkflowContinuationResult before any step.do() call when required host dependencies (secrets or DB binding) were unavailable; Cloudflare's platform status field tracks throw-vs-resolve, not the resolved payload's own status field
SECONDARY_ROOT_CAUSE=H2BF5's own process-sequencing error: the five staged secrets were never provisioned to the host (wrangler secret bulk not yet run) before the synthetic Workflow instance was triggered
ROOT_CAUSE_CONFIDENCE=PROVEN (direct source read + live unmocked reproduction using the real exported class, not inferred)
MISSING_DEPENDENCY_FAIL_CLOSED_RED=YES
MISSING_DEPENDENCY_FAIL_CLOSED_GREEN=PASS
MISSING_SECRET_FAIL_CLOSED_MATRIX=PASS (2 of 5 checks directly reproduced — PAYMENT_CONTINUATION_ENCRYPTION_KEY, DB — remaining 3 share the identical `if (!env.X) return {unavailable}` structural pattern already covered by the fix's single throw point)
FAIL_OPEN_MUTATION_CAUGHT=YES
TESTS=PASS
WORKER_RUNTIME=PASS
LINT=PASS
TYPECHECK=3 pre-existing errors, 0 new
PRODUCTION_PREFLIGHT=PASS
NEW_SECRET_FINDINGS=0
H2BF5_R1_HOST_BUNDLE=PASS (worker-runtime WORKFLOW_HOST_BUNDLE_ISOLATION gate)
HOST_SECRET_MUTATIONS=0
HOST_DEPLOYMENT_MUTATIONS=0
WORKFLOW_INSTANCE_CREATIONS=0
API_WORKER_UPLOADS=0
API_DEPLOYMENT_MUTATIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
SUN1221E6R_H2BF5_C1_CORRECTIVE_HOST_REDEPLOY_ELIGIBLE=YES
SUN1221E6R_H2B2_REAL_PAYMENT_ELIGIBLE=NO
NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R-H2BF5-C1
```
