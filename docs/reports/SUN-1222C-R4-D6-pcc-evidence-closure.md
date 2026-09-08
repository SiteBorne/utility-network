# SUN-1222C-R4-D6 — PCC Rejection Durable Evidence Closure

## 0. Authoritative starting state

- `D6_START_HEAD=dde3294c02d1cde9e93defa289a2f179545333e4`
- `D5_EVIDENCE_COMMIT_REACHABLE=YES`
- `WORKING_TREE_RELEASE_CLEAN=YES` (pre-checkpoint)
- Host `05e11cbd-1fd2-415a-bfb6-2c29b571b75d` @ 100% (D5's deploy, no drift)
- Public API `db7054c9` @ 100%, `d3472f58` @ 0% (no drift, unchanged this checkpoint)

## 1. Authorization gate

Explicit, standalone, first-person authorization received for
`SUN-1222C-R4-D6-PCC-EVIDENCE-CLOSURE`, scoped to source/test/evidence-report
mutation plus, conditionally, exactly one `siteborne-paid-continuation-runtime`
deployment if all predeployment gates pass. No public API deployment, traffic
mutation, payment activity, or unrelated infrastructure change authorized.

`SUN1222C_R4_D6_AUTHORIZATION=GRANTED`

## 2. Target defect

D5 closed durable `evidence_ref` persistence for the `executor_rejected` and
`executor_timeout` terminal branches (`deriveErrorDetail()` →
`transitionJobState(..., evidenceRef)` → D1 `state_events.evidence_ref`).

D5 also identified one sibling gap it deliberately left out of scope: the PCC
validation-failure branch, `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`
around line 836 (pre-fix), which called:

```ts
if (!pccResult.valid) {
  await transitionJobState(jobId, 'REJECTED', 'VERIFICATION_FAILED', deps.persistence.job);
  return terminal('pcc_failed', jobId, { error_code: pccResult.reason });
}
```

`pccResult.reason` (e.g. `signature_mismatch`, `missing_receipt`, or the
executor's own `failure.code ?? result_class` for the "PCC still corresponds
to a failed executor run" case in `validateExecutorPcc`) was returned in the
terminal HTTP-facing `WorkflowContinuationResult` but never threaded into the
`transitionJobState` call — so it never reached `state_events.evidence_ref`
and became unrecoverable once Workflow-local scope ended, same failure mode
D5 fixed for the other two branches.

## 3. Fix

One additional argument on the existing `transitionJobState` call, reusing
the exact same `evidenceRef` parameter D5 added (no new parameter, no new
column, no migration):

```ts
if (!pccResult.valid) {
  await transitionJobState(
    jobId,
    'REJECTED',
    'VERIFICATION_FAILED',
    deps.persistence.job,
    boundedDetail(pccResult.reason)
  );
  return terminal('pcc_failed', jobId, { error_code: pccResult.reason });
}
```

`boundedDetail()` (the same ≤500-char bounding function `deriveErrorDetail`
uses) is applied for defense-in-depth consistency, even though
`PccValidationResult['reason']` is always a short, service-authored code in
practice — never raw PCC content, headers, or payment material (confirmed by
reading `PccValidationResult`'s type and `validateExecutorPcc`'s only two
call sites, both of which set `reason` to either a fixed literal
(`'missing_receipt'`) or `executorOutcome.result.failure?.code ??
executorOutcome.result.result_class`).

File touched: `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts` (1 net line changed to 8, all within the existing `if (!pccResult.valid)` block).

## 4. TDD proof

Two new tests added to `apps/edge-api/tests/paid-continuation-workflow.test.ts`,
in the existing `PCC integration (H2AWI-2c)` describe block, modeled directly
on D5's own test pattern for the sibling branches:

1. `persists the specific PCC rejection reason as the REJECTED event's evidence_ref`
2. `PCC evidence_ref stays a plain bounded string, never a serialized object or payment material`

**RED** (pre-fix): both failed exactly as expected —
`expected undefined to be 'signature_mismatch'` and
`expected 'undefined' to be 'string'`. 2 failed, 4 passed, 37 skipped (43 total in file).

**GREEN** (post-fix): 43/43 passed.

**Mutation-proof**: reverted the fix to the pre-fix form, re-ran the same two
tests — identical failure signature reproduced (2 failed, 4 passed). Restored
the fix, reconfirmed 43/43 GREEN.

## 5. Full regression

| Gate | Result |
|---|---|
| Targeted file (`paid-continuation-workflow.test.ts`) | 43/43 PASS |
| `pnpm typecheck` | PASS (23/23 tasks) |
| `pnpm build` | PASS (12/12 tasks) |
| `pnpm lint` | PASS (16/16 tasks) |
| Full repo test suite | 2962/2971 non-skipped tests pass, 78 skipped, 3049 total; 2 flaky files (`workflow-host-precompiled-validators.test.ts`, `worker-bridge.subprocess.test.ts`) — both pre-existing resource-contention timeouts under full-suite parallel load, both reconfirmed 100% passing in isolation |
| `pnpm x402:check` | PASS |
| `pnpm mcp:check` | PASS |
| `pnpm a2a:check` | PASS |
| `pnpm secrets:scan` | 2 pre-existing findings (dated 2026-09-03, unrelated docs files), 0 new; working-tree-only scan confirms 0 findings in the 2 files this checkpoint touched |
| `pnpm production:preflight` | PASS |
| `wrangler deploy --config wrangler.paid-continuation-runtime.toml --dry-run` | PASS — bindings unchanged (Workflow, D1, R2, 4 vars), no traffic mutation |

## 6. §13 — safe non-economic live qualification

D5 established that `PaidContinuationWorkflow` is payment-gated by
architecture and no legitimate non-economic mechanism exists to create a
live instance that reaches any of its terminal rejection branches —
including this one — without a real payment. That finding applies
identically here: `generate-pcc` only executes after a real `executor`
step already ran, which only happens after real payment verification. D6
inherits D5's conclusion unchanged: no live instance was created; the fix's
correctness rests on the RED→GREEN→mutation-proven in-process unit suite
above (same standard D5 itself used for its own sibling fix).

## 7. Deployment

Predeployment gates all passed (§5), so the conditional deployment
authorization applies: exactly one deployment of
`siteborne-paid-continuation-runtime` from this checkpoint's source (`b95a8dc`).

**Executed.** New host version `d930b4bd-40f2-45f8-8464-7b19fef512bd` @ 100%
(supersedes D5's `05e11cbd`). Bindings unchanged (`PAID_CONTINUATION_WORKFLOW`
Workflow, `DB` D1, `ARTIFACTS` R2, `SELLER_WALLET_ADDRESS`,
`PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`, `PRODUCTION_CDP_CREDENTIALS_APPROVED`
— same 8 as D5's readback). Public API confirmed unchanged by the same
`wrangler deployments list` readback: `db7054c9` @ 100%, `d3472f58` @ 0%.

## 8. Scope discipline

- Payment boundary: unchanged (no route, gate, or verification-order edit).
- PCC verification semantics: unchanged (`validateExecutorPcc`'s decision
  logic untouched — this only threads its existing `reason` string one hop
  further into persistence).
- Executor semantics: unchanged.
- Settlement ownership: unchanged (0 public call sites, 1 dedicated
  Workflow call site — same as every prior checkpoint this session).
- Public API: unchanged, 0 deployments.
- Public traffic: unchanged, `db7054c9` @ 100% / `d3472f58` @ 0%.
- Credential inventory / ADR-0055 vars: unchanged, untouched.
- Economic effect: 0.

## Final packet

```
SUN1222C_R4_D6=PASS
SOURCE_MUTATIONS=2 files (paid-continuation-workflow.ts, paid-continuation-workflow.test.ts)
TESTS_RED_CONFIRMED=YES (2/2 new tests, exact expected failure signature)
TESTS_GREEN_CONFIRMED=YES (43/43)
MUTATION_PROOF=PASS
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
FULL_SUITE=2962 passed / 9 failed (2 pre-existing flaky files, reconfirmed 100% passing in isolation) / 78 skipped
X402_CHECK=PASS
MCP_CHECK=PASS
A2A_CHECK=PASS
SECRETS_SCAN=2 pre-existing (unrelated, dated 2026-09-03), 0 new
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS
LIVE_SYNTHETIC_QUALIFICATION=NOT_POSSIBLE (inherited D5 finding: payment-gated architecture, no safe non-economic path — same conclusion, same reasoning)
HOST_DEPLOYMENT_AUTHORIZED=YES (conditional on gates passing — they did)
HOST_DEPLOYMENT_EXECUTED=YES (d930b4bd-40f2-45f8-8464-7b19fef512bd @ 100%, supersedes 05e11cbd)
PUBLIC_API_DEPLOYMENTS=0
PUBLIC_API_UNCHANGED=YES (db7054c9 @ 100% / d3472f58 @ 0%, confirmed via readback)
TRAFFIC_MUTATIONS=0
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
ECONOMIC_EFFECT_USDC=0
PAYMENT_BOUNDARY_CHANGED=NO
PCC_SEMANTICS_CHANGED=NO
SETTLEMENT_OWNERSHIP=0 public / 1 dedicated Workflow (unchanged)
WORKING_TREE=clean
FIX_COMMIT_SHA=b95a8dc
HOST_VERSION_ID=d930b4bd-40f2-45f8-8464-7b19fef512bd
```
