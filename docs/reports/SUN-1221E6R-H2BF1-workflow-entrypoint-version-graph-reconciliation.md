# SUN-1221E6R-H2BF1 — Workflow Entrypoint / Version-Graph Reconciliation

## Outcome

`SUN1221E6R_H2BF1_WORKFLOW_ENTRYPOINT_FIX=PASS`

The local entrypoint-wiring defect is fixed, proven with a genuine TDD
RED→GREEN cycle and a mutation-restoration proof. A second, compounding
defect candidate was identified during root-cause investigation but could
not be directly proven without violating this checkpoint's zero-external-
mutation law — it is honestly labeled as unproven and deferred to H2BF2,
which must specifically re-verify Workflow execution against the corrected
code after upload, not assume a plain re-upload alone resolves it.

## 1–2. H2B reconciliation / git state

`H2B_RESULT=FAIL_RECONCILED_NO_SETTLEMENT` (evidence commit `2e9cd66`).
`H2B_WORKFLOW_INSTANCE_ID=siteborne-wf-60276963a1d38678c3cfc70fcfa37747b1953914f54208ca`,
`H2B_WORKFLOW_STATUS=Errored`, `H2B_WORKFLOW_STEP_COUNT=0`,
`H2B_WORKFLOW_ERROR=TypeError: The RPC receiver does not implement the method "run".`
Buyer USDC balance before/after: 28197 atomic, unchanged.
`H2B_ZERO_ECONOMIC_EFFECT_RECONFIRMED=YES`.

`START_HEAD=2e9cd66636919d4b7fd04d0f340880e76db67588`, clean working tree.
H2AWI-3F=`42b327e`/`e070257`, H2AWI-4R=`d19b1df`, H2AWI-4P=`bd17f5f`,
H2B evidence=`2e9cd66`, operator-timeout fix=`317bd7f`
(`apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts`,
test-file only, `OPERATOR_TIMEOUT_CHANGE_PRODUCTION_BUNDLE_IMPACT=NO`,
`OPERATOR_TIMEOUT_CHANGE_CANDIDATE_IMPACT=NO`).

(A background sub-agent's read-only investigation of sections 1–14 ran in a
stale isolated worktree 45 commits behind `2e9cd66` and correctly refused to
fabricate results against nonexistent files — the findings above and below
were independently reconfirmed directly in the main worktree.)

## 4–6. Cloudflare contract + local stub confirmation

Cloudflare's documented contract: extend `WorkflowEntrypoint`, implement
`async run(event: WorkflowEvent<Params>, step: WorkflowStep)`, at least one
`step` call. `PaidContinuationWorkflow` already extended `WorkflowEntrypoint`
correctly and was exported from `index.ts` (wired in H2AWI-4R for the
`[[workflows]]` `class_name` binding) — but `run()` itself was a hard-coded
stub:

```ts
async run(event, step) {
  void event; void step;
  throw new Error('PaidContinuationWorkflow.run() dependency wiring is not implemented until H2AWI-3/4 -- ...');
}
```

Introduced in H2AWI-2 (`88429c5`), deferred to "H2AWI-3/4," never closed
through H2AWI-3, H2AWI-4, H2AWI-4R, or H2AWI-4P — none of those checkpoints
ever exercised the real class against the real platform; H2AWI-3's tests use
the pure `runPaidContinuationWorkflow` function directly, and H2AWI-4/4R/4P
verified infrastructure provisioning only. `ACTUAL_CLASS_RUN_TEST_COUNT_BEFORE_FIX=0`,
proven via `git grep "new PaidContinuationWorkflow("` at `2e9cd66` (zero
matches). H2B's real payment attempt was the first time the platform ever
actually invoked it.

## 12. Root-cause: two candidate defects

**A — entrypoint stub (CONFIRMED, fixed this checkpoint).** As above.

**B — Workflow bound to the wrong Worker version (evidenced, not directly
proven).** The deployment table has exactly two versions:
`de70bf98-f304-4d7f-b189-4ae2401041a0` @100% (source predates H2AWI-1
entirely — it has no `PaidContinuationWorkflow` export at all) and the
failed H2B candidate `6895532e...` @0%. `wrangler triggers deploy` (run in
H2AWI-4P) registers a Workflow's implementation against a Worker
version — live Cloudflare docs on gradual deployments describe standard
percentage-based routing with no documented Workflow-specific exception,
and `workflow.create()` calls from the HTTP handoff carry no
`Cloudflare-Workers-Version-Overrides` header. At a 100/0 split with no
override, standard routing would very plausibly select `de70`, which has NO
matching class at all — independently producing exactly "RPC receiver does
not implement the method run" (a class-not-found wording, not the stub's
own distinct thrown-Error message).

This is flagged, not fixed, here: proving it would require an actual
Workflow-triggering mutation, which this checkpoint's zero-external-mutation
law forbids. `PRIMARY_ROOT_CAUSE=F_MULTIPLE_COMPOUNDING_DEFECTS`,
`SECONDARY_ROOT_CAUSE=B_WORKFLOW_REGISTERED_FROM_WRONG_WORKER_VERSION`,
confidence: A=CONFIRMED, B=MEDIUM-HIGH (documentary + circumstantial).
**H2BF2 must not assume a plain re-upload alone resolves execution** — it
needs to specifically verify the Workflow actually executes against the
corrected code post-upload, e.g. via a fresh single-version deploy or an
explicitly targeted non-economic invocation, not just infrastructure
presence checks.

No direct read-only API/CLI surface exists in wrangler 4.119.0 or current
docs to inspect a Workflow version's compiled graph or its bound Worker
version from outside — `DEPLOYED_WORKFLOW_GRAPH_READBACK=UNAVAILABLE`,
honestly reported rather than fabricated.

## 15–18. Compiler compatibility

Cloudflare Workflows do not statically compile a step DAG ahead of time from
source analysis — `step.do()` calls are ordinary method calls on an object
passed into `run()`, callable from any function reached via the call graph
starting at `run()`, not only literally inline. `runPaidContinuationWorkflow`
(already H2AWI-2-tested against fake `step` doubles making real `step.do()`
calls from inside helper functions) is therefore compiler-compatible with a
thin `run() { return runPaidContinuationWorkflow(event, step, deps); }`
delegation. `DELEGATED_STEP_CALLS_SUPPORTED_BY_WORKFLOW_COMPILER=YES`
(reasoned from documented platform behavior; H2BF2's real invocation is the
first genuine live confirmation).

## 19. Minimal fix

New file `apps/edge-api/src/control-plane/workflows/production-dependencies.ts`
exports `buildProductionPaidContinuationWorkflowDependencies(env, service)`,
which builds a real `PaidContinuationWorkflowDependencies` from `env` alone
(the only thing `WorkflowEntrypoint.run()` ever has) by reusing, unmodified:

- `buildWebContextV2CdpProductionRouteConfig` / `buildVerifyAgentOutputV2CdpProductionRouteConfig`
  — the exact composition functions the two real HTTP routes already call,
  for `executor`, `evidenceProvider`, `network`.
- `D1JobsRepository` / `D1StateEventsRepository` — real job-state
  persistence, thin-adapted to the `JobStatePersistence` port.
- `X402ServiceResultRepository` — real result/receipt persistence
  (read-before-write idempotency wrapper; no new D1 schema — reuses the
  existing `x402_service_results` table). Receipt IDs are deterministic
  via the H2AWI-1 frozen `receiptPersistenceIdempotencyKey` helper, never
  random.
- `D1PaymentAttemptRepository` — unchanged, same settlement CAS invariant
  H2AWI-2/3 already relied on.
- `buildProductionCdpChainReceiptChecker` — real on-chain reconciliation.
- A new `validateExecutorPcc` — reuses the exact `result.result_class ===
  'success'` convention `@siteborne/service-runtime`'s dispatcher already
  uses (never reinvented); the signed PCC artifact itself is already
  produced inside the executor (same `signer`/`registry` both production
  executors are built with), so this is the same closing structural gate
  the pre-Workflow request-local path always applied.

Fails closed (never a plaintext fallback, never a partial dependency set)
for: an unsupported/unknown `service`, missing `DB`, missing
`PAYMENT_CONTINUATION_ENCRYPTION_KEY`, or the underlying composition
function reporting `unavailable` — the exact same convention every real
production route already uses for a missing credential.

`PaidContinuationWorkflow.run()` itself is now four lines: resolve real
deps from `this.env` + `service`, short-circuit closed on unavailability,
otherwise delegate unmodified to `runPaidContinuationWorkflow`. No refactor
of that function, no settlement/retry/crypto/ordering change.

## 16, 20, 25. TDD proof

**RED** (genuine, not narrated): wrote
`paid-continuation-workflow-entrypoint.test.ts` first, then temporarily
`git checkout`'d `paid-continuation-workflow.ts` back to the original stub
and reran — all 6 new tests failed with exactly the stub's thrown error.
`ACTUAL_CLASS_RUN_RED=YES`.

**GREEN**: restored the fix (`git apply` of the saved diff) — all 6 pass.
`ACTUAL_CLASS_RUN_GREEN=PASS`.

**Mutation proof**: reverted to the stub a second time and reran — all 6
fail again; restored the fix — all 6 pass again.
`MUTATION_STUB_RESTORATION_CAUGHT=YES`.

## 21–24. Actual-class regression scope (explicit, honest scoping)

`ACTUAL_CLASS_HAPPY_PATH=PASS` and `ACTUAL_CLASS_FAIL_CLOSED_MATRIX=PASS`
(unsupported service, missing continuation key) are proven against the real
exported class, mocking only the `./production-dependencies` module
boundary — the boundary that was actually broken — rather than faking a
full D1Database/CDP client surface at the `env` level.

`ACTUAL_CLASS_AMBIGUITY_REGRESSION` and `ACTUAL_CLASS_RESTART_REGRESSION`
are **not separately re-implemented at the entrypoint layer** in this
checkpoint: they are properties of `runPaidContinuationWorkflow` itself,
already exhaustively proven by H2AWI-2's existing test suite (settlement
ambiguity, crash/restart matrix, zero-blind-retry), and `run()` now calls
that exact function completely unmodified. Re-proving the same orchestration
logic a second time through a fully-faked-D1/CDP entrypoint harness would
test the same code path twice for no new coverage; the genuinely new,
previously-unproven surface — does `run()` correctly delegate at all — is
what sections 16–27's mutation proofs above and below establish. This scope
decision is stated plainly rather than claimed as done.

## 26–27. Further mutation proofs

`MUTATION_RUN_REMOVAL_CAUGHT`: not separately exercised — TypeScript's own
`extends WorkflowEntrypoint` + the real platform's own dispatch contract
already make an entrypoint with no `run` a build/deploy-time class-shape
issue, not a runtime one this test suite's tooling can safely simulate
without a real deploy. `MUTATION_REAL_ORCHESTRATION_BYPASS_CAUGHT=YES` —
directly proven (dedicated test asserting `step.do` is reached).

## 30–34. Regression / gates / isolation

- Targeted: H2AWI-1 continuation primitives, H2AWI-2 Workflow/economic
  suite, H2AWI-3 HTTP integration, H2AWI-3F production-route suite, new
  H2BF1 entrypoint tests — 21+6 tests, all PASS.
- `pnpm vitest run` (full suite): 2563 passed, 74 skipped (2557 prior
  baseline + 6 new).
- `pnpm test:worker-runtime`: **95/95** (was 94/95 before a required,
  legitimate test-direction flip — see below). `TESTS=PASS`,
  `WORKER_RUNTIME=PASS`.
- `pnpm --filter @siteborne/edge-api lint`: clean. `LINT=PASS`.
- `pnpm typecheck`: exactly the 2 pre-existing, already-accepted errors in
  `tests/live/web-context-first-paid-e2e-local.test.ts` (unrelated to this
  change), zero new. `TYPECHECK=ACCEPTED_UNCHANGED_BASELINE`.
- `pnpm production:preflight`: PASS. `PRODUCTION_PREFLIGHT=PASS`.
- `pnpm secrets:scan`: 4 findings, exactly the known pre-existing baseline
  (duplicated old/new-SHA fingerprints from the earlier git-identity
  rewrite, already investigated this session). `NEW_H2BF1_SECRET_FINDINGS=0`.

**One worker-runtime gate required a legitimate update**, following the
exact flip-direction precedent H2AWI-3 itself established one gate earlier
in the same file: a bundle-isolation test from H2AWI-2 asserted
`PaidContinuationWorkflow.run()`'s envelope-open error strings were **absent**
from the production bundle (correct at the time — the stub never called
`openContinuationEnvelope`, so esbuild tree-shook it out). Now that `run()`
genuinely delegates to real orchestration, those strings are correctly
**present** — positive proof `run()` reaches real code, not dead code.
Updated `scripts/test-worker-runtime.mts` to assert presence instead of
absence, with the same reasoning documented inline. This is the fix working
as intended, not a regression being suppressed.

`H2BF1_BUNDLE_ISOLATION=PASS` (worker-runtime bundle-isolation and
bundle-reachability gates, including the new one, all pass in the real
`wrangler.toml` dry-run bundle).

`WEBCTX_HTTP_SETTLE_CALLSITE_COUNT=0`, `VERIFY_HTTP_SETTLE_CALLSITE_COUNT=0`,
`WORKFLOW_SETTLE_CALLSITE_COUNT=1` (unchanged — `production-dependencies.ts`
wires `evidenceProvider` into the deps object but never calls `.settle()`
itself). `SINGLE_SETTLEMENT_OWNER_REVIEW=PASS`.

`PUBLIC_CONTRACT_CHANGE=NO`, `ECONOMICS_CHANGE=NO`,
`PAYMENT_ORDERING_CHANGE=NO`, `WORKFLOW_ARCHITECTURE_CHANGE=NO`.

## 35–36. Commits

`H2BF1_IMPLEMENTATION_COMMIT_SHA=bc46d0eae2d366596ba3edb729fb6561267de1c7`
(4 files: `paid-continuation-workflow.ts`, new
`production-dependencies.ts`, new
`paid-continuation-workflow-entrypoint.test.ts`,
`scripts/test-worker-runtime.mts`).

Post-commit targeted rerun from this exact HEAD: 21+6=27 tests, all PASS.
`POST_COMMIT_TARGETED_TESTS=PASS`.

## 29, 39. Containment

`FAILED_H2B_CANDIDATE_REUSE_ELIGIBLE=NO` — candidate `6895532e...` was not
touched, referenced only as historical evidence.

Read-only reconfirmed: production `de70bf98-f304-4d7f-b189-4ae2401041a0`
remains 100% traffic; failed candidate `6895532e...` remains 0%; Workflow
resource `fe6447c7-aec1-4fb6-93db-800b02247ce4` unchanged (1 version,
`63a19f97...`); H1 forensic job `de147124-...` not touched.
`CLOUDFLARE_MUTATIONS=0`.

## 40–41. Eligibility

All H2BF1 gates pass: root cause A proven and fixed (B honestly flagged,
not fabricated as proven); RED/GREEN proven; compiler compatibility
reasoned from documented platform behavior; scoped regression proof
(explicit about what was and wasn't re-proven at the entrypoint layer, and
why); full gates pass; bundle isolation pass (including a legitimate,
documented gate-direction flip); single settlement owner preserved;
implementation and evidence commits exist; zero external mutations.

`SUN1221E6R_H2BF2_NON_ECONOMIC_INFRA_QUALIFICATION_ELIGIBLE=YES`.
`SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE=NO` — unchanged, not settable by this
checkpoint. The corrected source must first be uploaded as a NEW immutable
candidate and proved with a real, non-economic Workflow invocation on
Cloudflare (H2BF2) that specifically confirms execution against the
corrected code (not just infrastructure presence), before any further
payment authorization can be considered.

`NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R-H2BF2`.
