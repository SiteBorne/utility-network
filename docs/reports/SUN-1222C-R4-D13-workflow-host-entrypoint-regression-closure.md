# SUN-1222C-R4-D13 — Workflow Host Entrypoint Regression Closure

## Context

D12 (`siteborne-settlement-alert`, commit `6e9403b`) discovered one
deterministic, pre-existing baseline test failure while running full-suite
qualification: `apps/edge-api/src/workflow-host-entrypoint.test.ts` failed
with

```
TypeError: persistence.getJob is not a function
  at transitionJobState (paid-continuation-workflow.ts:469)
  at runPaidContinuationWorkflow (paid-continuation-workflow.ts:762)
```

The failure was reproduced against the clean pre-D12 repository state with
all D12 tracked/untracked work absent, proving it was **not** a D12
regression and **not** caused by `siteborne-settlement-alert`. It is a
genuinely pre-existing defect: D7 (`SUN-1222C-R4-D7`) added a
`transitionJobState(...)` call inside the `open-envelope` step's error
handler in `paid-continuation-workflow.ts`, and that call requires
`persistence.job.getJob()` to exist. The sibling test file
`paid-continuation-workflow-entrypoint.test.ts` was updated with a matching
fixture at that time; `workflow-host-entrypoint.test.ts` was missed.

**Note on process:** an earlier attempt at this checkpoint reported this fix
as applied and committed, but that report was incorrect — the working
directory had been silently switched to an unrelated worktree
(`.claude/worktrees/h2bf4-manual-1788212158`) with no relationship to this
repository's `main` branch, and no commit was ever made to the authoritative
repository. This redo was performed after independently re-verifying the
authoritative repository root, branch, and HEAD, confirming the D13 commit
was **not** reachable from `main`, and confirming the stale fixture and
deterministic failure still existed in the real repository before any
correction was reapplied.

## Root cause

`fakeDeps()` in `workflow-host-entrypoint.test.ts` (line ~70) initialized:

```ts
persistence: { job: {} as never, resultReceipt: {} as never },
```

`{}` has no `getJob` method, so the D7-era `transitionJobState()` call
(reached only via the `open-envelope` catch path exercised by this test's
`ACTUAL_WORKFLOW_CLASS_GREEN` case) threw a `TypeError` rather than
resolving. This is a **Class B — stale/incorrect test fixture** defect, not
a production code defect: `paid-continuation-workflow.ts` behaves correctly
and identically to how the already-passing sibling entrypoint test exercises
it.

## Fix

One-line fixture correction, matching the already-proven sibling precedent
in `paid-continuation-workflow-entrypoint.test.ts`:

```ts
persistence: {
  job: { getJob: async () => undefined } as never,
  resultReceipt: {} as never,
},
```

`getJob` resolving to `undefined` reaches the existing early-return branch in
`transitionJobState` (`if (!job) return;` — line 470), which is the correct,
already-tested behavior for "no job record wired yet."

No production source file was modified.

## TDD proof

| Step | Result |
|---|---|
| RED (stale fixture, reproduced live in authoritative repo) | `TypeError: persistence.getJob is not a function` — 1 failed / 4 passed |
| GREEN (fixture corrected) | 5/5 passed |
| Mutation-proof (fix reverted) | Identical RED signature returns — 1 failed / 4 passed |
| Restore (fix reapplied) | 5/5 passed |

## Regression matrix

Targeted suite (workflow-host entrypoint, sibling entrypoint, full workflow
suite, D12 alert-sweep/webhook/unresolved-settlements suites):

```
Test Files  6 passed (6)
     Tests  80 passed (80)
```

Full repository suite:

```
Test Files  248 passed | 22 skipped (270)
     Tests  3002 passed | 78 skipped (3080)
```

Zero failures. All skips are intentional (live/credential-gated tests).

**Out-of-scope observation (not acted on):** `settlement-alert-worker-entrypoint.ts`
(D12) has no dedicated test file in the current repository, despite prior
reporting claiming 7 entrypoint tests existed. Flagged for a future
checkpoint; D13's authorization is strictly scoped to the one fixture file
and does not cover this.

## Repository gates

| Gate | Result |
|---|---|
| `typecheck` | PASS (no output) |
| `build` | PASS |
| `lint` | PASS (0 errors/warnings) |
| `production:preflight` | PASS |
| `wrangler deploy --dry-run` (public API, `wrangler.toml`) | PASS |
| `wrangler deploy --dry-run --config wrangler.paid-continuation-runtime.toml` | PASS |
| `wrangler deploy --dry-run --config wrangler.settlement-alert-worker.toml` | PASS |
| secrets-scan (`scan-working-tree-secrets.ts` / gitleaks) | 2 pre-existing findings, both in `docs/reports/*.md` files outside this diff (Cloudflare version-ID false positives on `generic-api-key`, entropy 3.69); 0 new findings |

## Settlement / payment invariant recheck

- Production `evidenceProvider.settle()` call sites: exactly 1
  (`paid-continuation-workflow.ts:673`, inside the dedicated Workflow only).
- Public API (`x402-service.ts`) call sites: 0 (confirmed by grep and
  in-source comments explicitly documenting the absence).
- Workflow payment gating: unchanged (no production source touched).
- D12 alert Worker (`siteborne-settlement-alert`): source untouched,
  **not deployed** (confirmed via `git status` — only the one test file is
  modified).

## Scope audit

```
$ git diff --stat
 apps/edge-api/src/workflow-host-entrypoint.test.ts | 5 ++++-
 1 file changed, 4 insertions(+), 1 deletion(-)
```

Exactly one file, test-only.

## Deployment / economic counters

```
HOST_DEPLOYMENTS=0
PUBLIC_API_DEPLOYMENTS=0
D12_ALERT_WORKER_DEPLOYMENTS=0
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

## Result

```
SUN1222C_R4_D13=PASS
D13_FIX_CLASS=TEST_ONLY
```

The repository baseline is fully explained and green with no unresolved
pre-existing failures. `siteborne-settlement-alert` (D12) remains
implementation-ready, undeployed, pending separate webhook-secret
provisioning and D14 activation authorization.
