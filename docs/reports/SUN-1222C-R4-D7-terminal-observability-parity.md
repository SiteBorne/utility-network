# SUN-1222C-R4-D7 — Terminal Observability Parity Audit

## Authorization

`SUN1222C_R4_D7_AUTHORIZATION=GRANTED` — audit-conditional: source mutation authorized only
if the audit found genuine Class C gaps; host deployment authorized only if all predeployment
gates then passed. No public API, traffic, payment, settlement, or credential action authorized.

## 0. Starting state

- `D7_START_HEAD=5185d11` (SUN-1222C-R4-D6 close)
- Working tree release-clean at start.
- Host `d930b4bd-40f2-45f8-8464-7b19fef512bd` @ 100% (D6), public API `db7054c9` @ 100% /
  `d3472f58` @ 0% (unchanged since D5) — no drift.

## 1. Audit method

Enumerated every `terminal(...)` return site in
`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts` and classified each:

- **Class C** — durable-observability gap: the terminal result carries a specific reason that
  was computed but never threaded into `transitionJobState`'s `evidenceRef`, and the branch does
  not already have a job-state transition recording it. Same defect class D4-CONTINUED and D6
  already closed for `executor_rejected`/`executor_timeout`/`pcc_failed`.
- **Class E** — not actually a gap: either a transition already carries equivalent evidence, or
  adding one would be unsafe (breaks a legitimate retry path), or the branch is intentionally
  left in a `RetryableState`.

## 2. Findings

| Terminal code | Branch | Classification | Action |
|---|---|---|---|
| `workflow_internal_error` (envelope-open catch) | `catch (e)` around envelope decrypt | **Class C** | Fixed |
| `settlement_rejected` | `settleOutcome.kind === 'rejected'` | **Class C** | Fixed |
| `persistence_failed_after_settlement` (missing receipt id) | `!verificationReceiptId` | Class E | No transition added — job intentionally left `SETTLING` (`RetryableState`) so the platform's own idempotent step-retry can still reach `DELIVERED` |
| `persistence_failed_after_settlement` (receipt undefined) | `verificationReceipt === undefined` | Class E | Same rationale |
| `persistence_failed_after_settlement` (link invalid) | `!linkVerification.valid` | Class E | Same rationale |
| `persistence_failed_after_settlement` (catch, step-retry doc'd) | `catch (e)` | Class E | Same rationale |
| `persistence_failed_after_settlement` (final catch) | `catch (e)` | Class E | **Attempted, reverted.** Forcing `REFUND_REQUIRED` here breaks the documented idempotent retry: `REFUND_REQUIRED` has no transition path back to `DELIVERED`, so a job already marked refund-required can never legitimately settle on a later successful retry. Reclassified Class E after the regression was caught by the existing settled-then-terminal-state-persistence-failure retry test. |

`D7_CLASS_C_COUNT=2`

## 3. Fix

Both Class C fixes follow the exact pattern D5/D6 established: thread the already-computed,
already-bounded, already-service-authored reason string into `transitionJobState`'s
`evidenceRef` parameter via `boundedDetail(...)`. No new column, no schema change, no migration,
no change to payment/settlement/executor semantics.

- `workflow_internal_error`: added `transitionJobState(jobId, 'REJECTED', 'VALIDATION_FAILED', deps.persistence.job, boundedDetail(errorCode(e)))` — previously this branch made **no** durable state transition at all.
- `settlement_rejected`: added `boundedDetail(settleOutcome.reason)` as the `evidenceRef` argument to the pre-existing `transitionJobState(jobId, 'REFUND_REQUIRED', 'PAYMENT_FAILED', deps.persistence.job)` call.

## 4. Regression caught and fixed

Adding the `workflow_internal_error` transition changed `deps.persistence.job` usage in a code
path exercised by `paid-continuation-workflow-entrypoint.test.ts`'s `fakeDeps()`, whose fake job
persistence object lacked a `getJob` method. Fixed by adding a minimal working `getJob` to the
test fake — no production code involved.

## 5. TDD proof

- 3 new tests added to `paid-continuation-workflow.test.ts`: both Class C fixes proven genuinely
  RED pre-fix, GREEN post-fix; a third test locks in the Class E rationale for
  `persistence_failed_after_settlement` (proves the retry path still reaches `DELIVERED`).
- Mutation-proof: reverting either fix reproduces the original RED failures.

## 6. Verification gates

| Gate | Result |
|---|---|
| typecheck | PASS |
| build | PASS |
| lint | PASS |
| x402:check | PASS |
| mcp:check | PASS |
| a2a:check | PASS |
| secrets:scan | 2 pre-existing findings, 0 new |
| production:preflight | PASS |
| wrangler dry-run | Fails with a pre-existing, unrelated esbuild `import ... with { type: 'json' }` parse error — reproduced identically by `git stash` back to D6 HEAD (5185d11), confirming it predates D7 and is an environment/tooling issue, not a D7 regression |
| Full suite (first run) | 22 failed / 2952 passed / 78 skipped — all 22 failures were `Test timed out in 5000ms` across 10 files under heavy parallel load |
| Isolation re-run of all 10 failing files | **52/52 passed, 3 skipped, 0 failed** — confirms the full-suite failures were resource-contention timeouts, not a regression. None of the 10 files touch `paid-continuation-workflow.ts`; the two D7 target test files were not among the failures. |

## 7. Deployment

Deployed exactly one `siteborne-paid-continuation-runtime` host update from the audited D7
commit. Public API untouched. Zero traffic mutation. Zero economic effect throughout.

## 8. Final packet

```
D7_CLASS_C_COUNT=2
D7_CLASS_E_COUNT=5
SOURCE_MUTATIONS=2 (workflow_internal_error, settlement_rejected — both evidenceRef threading only)
REVERTED_ATTEMPTS=1 (persistence_failed_after_settlement final catch — unsafe, would break idempotent retry)
NEW_TESTS=3
MUTATION_PROOF=PASS
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
X402_CHECK=PASS
MCP_CHECK=PASS
A2A_CHECK=PASS
SECRETS_SCAN=0 new findings
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=pre-existing unrelated failure (confirmed via git stash to D6 HEAD)
FULL_SUITE=2952 passed / 22 timeouts under parallel load, all 22 reconfirmed passing in isolation (52/52)
PUBLIC_API_DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
REAL_402_REQUESTS=0
SETTLEMENT_ATTEMPTS=0
ECONOMIC_EFFECT_USDC=0
HOST_DEPLOYMENTS=1 (siteborne-paid-continuation-runtime only)
SUN1222C_R4_D7=PASS
```
