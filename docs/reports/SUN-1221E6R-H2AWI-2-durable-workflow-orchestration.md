# SUN-1221E6R-H2AWI-2 — Durable Workflow Orchestration

Local source + tests only. Zero Cloudflare Workflow provisioning, zero
resource creation, zero production secrets, zero D1 migration/apply, zero
Worker version upload, zero deployment/traffic change, zero live
402/signing/settlement/chain transaction.

## 1. Lineage

- Architecture design: `docs/reports/SUN-1221E6R-H2AW-durable-paid-continuation-workflow-design.md`, commit `21d11ab4770c628f0c8132ae842c9c93cf2382a3`.
- Implementation plan: `docs/superpowers/plans/2026-08-31-siteborne-durable-paid-continuation-workflow.md`, plan-freeze evidence commit `694b654ad5c6efd22fdebec4b0a6560987f5c41f`.
- H2AWI-1 frozen primitives consumed unmodified: `docs/reports/SUN-1221E6R-H2AWI-1-durable-continuation-primitives.md`, evidence commit `556f493a058d2b447221783a7655b74bd829196f` (this checkpoint's starting HEAD).
- This checkpoint implements plan Tasks 2.1–2.8 (H2AWI-2 scope only).

### Implementation commits

| Commit | Subject |
|---|---|
| `57ab64b1cb54fd9d453b912e2de23f500cb3ccc1` | H2AWI-2e: settlement ambiguity reconciliation (read-only) |
| `88429c5f516043d35756906d9218f7234710f5ec` | H2AWI-2a..2g: step graph + executor/PCC/settlement/expiry/persistence integration |
| `3bfb1063d485cba3d41e2da150826bd0ad541c43` | H2AWI-2h: crash/restart determinism matrix (12 cases) |
| `b2661d1f23d7a15fc88d1802124f1b4a0bbd0d9a` | H2AWI-2i: instance-identity reuse proof + 6-mutation + retry-policy mutation evidence |
| `d91641354811be78182ddea3bbde08dec03e2523` | H2AWI-2j: restart job-state transition bugfix + proof #11/#12 evidence |

Commits were not made in the plan's literal 2.1→2.8 letter order because
Task 2.5 (`settlement-reconciliation.ts`) is a hard dependency of Task 2.4's
settlement step and was built first; Tasks 2.1–2.4/2.6/2.7 share one
tightly interdependent 7-step orchestration function (the steps pass a
single decrypted payload, job id, and settlement outcome between them) and
were built and tested together in one RED→GREEN cycle rather than split
file-by-file — the accompanying test file's `describe` blocks are labeled
per plan task letter so each task's own coverage is still independently
auditable. This granularity choice is disclosed here rather than
overclaiming eight separate isolated RED→GREEN cycles.

### Genuine RED→GREEN evidence (not narrated)

- Empty-module RED confirmed for `settlement-reconciliation.ts` (module not
  found) before implementation; 7/7 GREEN after.
- Empty-module RED confirmed for `paid-continuation-workflow.ts` before
  implementation; multiple real RED iterations during the first GREEN pass
  surfaced genuine defects, all fixed before commit: a UUID-format
  violation in a placeholder `job_id` fixture (state machine's
  `StateEventSchema` correctly rejected it), an `InvalidTransitionError`
  from a job-state chain gap (`LOCKED→REFUND_REQUIRED` attempted directly,
  missing the intermediate `ROUTED`/`EXECUTING`/`VERIFYING`/`SETTLING`
  hops), and a reconciliation-checker call-count assertion that
  incorrectly expected the chain checker to be invoked when no transaction
  reference was ever recorded (fixed by correcting the test, not the
  production code — the "nothing to check" behavior is correct).
- A second genuine defect was found and fixed while writing this
  checkpoint's own crash/restart matrix (Task 2.8): four early test
  assertions incorrectly expected `step.calls` to list only
  non-memoized step names; the real (and correct) behavior is that
  `step.do()` is called for every step on every `run()` invocation
  (memoized steps return without invoking the callback, but the call
  itself is still recorded) — fixed by asserting on callback-invocation
  call counts (executor/settle/persist counters) instead, which is what
  actually proves memoization.
- A third, more serious genuine defect was found while writing proof
  requirement #11's dedicated persistence-failure tests: `transitionJobState()`
  attempted an unconditional `LOCKED→ROUTED→EXECUTING` transition on
  *every* `runPaidContinuationWorkflow()` invocation, including a restart
  where the job had already advanced past that point in a prior
  (partially completed) attempt, throwing `InvalidTransitionError:
  SETTLING -> ROUTED`. Fixed by consulting the real state machine's own
  `getAllowedTransitions()` (never faked) before attempting a transition:
  if the target state isn't a legal transition from the job's current
  state, the job has already progressed past this point in an earlier
  attempt and the call is a safe no-op — the same treatment already given
  to the same-state and already-terminal cases. This is exactly the kind
  of defect TDD against a real crash/restart matrix is supposed to catch,
  and it was caught by writing the test, not narrated after the fact.

## 2. Workflow input/result contracts

Consumed verbatim from H2AWI-1, never redefined: `WorkflowContinuationInput`,
`WorkflowContinuationResult`, `WorkflowTerminalStatus`,
`ContinuationEnvelopeMetadata`, `SettlementReconciliationResult`
(`apps/edge-api/src/control-plane/continuation/types.ts`).

This checkpoint additionally defines (owned by H2AWI-2, not forked into the
frozen `continuation/types.ts`) `DecryptedContinuationPayload` — the shape
the AEAD envelope's `payload: unknown` (H2AWI-1's own intentionally generic
field) must contain for this Workflow's step 0 to consume:

```ts
interface DecryptedContinuationPayload {
  executorInput: unknown;                            // forwarded verbatim to ServiceExecutor
  settlementContext: PaymentSettlementContext;        // @siteborne/protocol-x402, reused exactly
  verificationEvidence: ExternalVerificationEvidence; // the facilitator's own already-accepted VERIFY response
  actualAmount: string;
}
```

The caller that seals the envelope (H2AWI-3's future HTTP handoff) is
responsible for assembling exactly this shape from the same logic
`x402-service.ts` already uses at its own (soon-to-be-removed) direct
settle call site — this Workflow never reconstructs or re-derives it.

`WORKFLOW_INPUT_CONTAINS_RAW_SIGNATURE=NO` — only the encrypted continuation
envelope plus safe clear metadata reaches `WorkflowContinuationInput`; the
signed EIP-3009 authorization only ever exists as ciphertext until
`openContinuationEnvelope` (H2AWI-1, unmodified) decrypts it inside step 0,
after which it lives only in this function's closure for the remainder of
the run — never logged, never persisted, never part of the returned
`WorkflowContinuationResult`.

## 3. Step graph

`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`,
`runPaidContinuationWorkflow(event, step, deps)` — the pure orchestration
function every test in this checkpoint calls directly. `PaidContinuationWorkflow
extends WorkflowEntrypoint<Env, WorkflowContinuationInput>` is the thin real
entrypoint class (unwired, throws if actually invoked — dependency
resolution from `env` is explicitly H2AWI-3/4 scope).

| # | STEP_NAME | SIDE EFFECT | ON FAILURE |
|---|---|---|---|
| 0 | `open-envelope` | `openContinuationEnvelope` (H2AWI-1, unmodified) | `workflow_internal_error` |
| 1 | `check-authorization-expiry` | pure, reads injected clock | → `authorization_expired` if expired |
| 2 | `invoke-executor` | real `ServiceExecutor` call (injected) | thrown → `executor_timeout`; resolved-unsuccessful → `executor_rejected` |
| 3 | `generate-pcc` | validates `ExecutorOutcome.result.verification` (injected validator) | → `pcc_failed` |
| 4 | `settle` | `evidenceProvider.settle()` — **the sole production settle() call site this Workflow introduces** | rejected → `settlement_rejected`; ambiguous → `settlement_ambiguous` |
| 5 | `persist-result` | idempotent UPSERT result write | throw → `persistence_failed_after_settlement` |
| 6 | `persist-receipt-and-finalize` | idempotent UPSERT receipt write + terminal state transition (`createStateEvent`/`isTerminal`, real, unfaked) | throw → `persistence_failed_after_settlement` |

Job-state advancement mirrors `x402-service.ts`'s own existing chain
(`LOCKED → ROUTED → EXECUTING → VERIFYING → SETTLING → DELIVERED`), driven
by this Workflow via the real, unfaked `createStateEvent`/`getAllowedTransitions`/
`isTerminal` — never a second, competing state machine.

## 4. Retry policy table

Every step declares `retries` and `timeout` explicitly; none inherits an
implicit platform default (proven — §12).

| STEP | RETRIES | TIMEOUT | RATIONALE |
|---|---|---|---|
| `open-envelope` | 0 | 10s | decrypt failure is never transient |
| `check-authorization-expiry` | 0 | 5s | pure, but retrying doesn't change a time comparison already past |
| `invoke-executor` | 2, exponential | 40s | Modal's own 35s function timeout + margin |
| `generate-pcc` | 1 | 10s | deterministic given step 2's memoized output |
| `settle` | **0 (frozen invariant)** | 20s | zero blind retries on the financial step |
| `persist-result` | 3, exponential | 10s | safe — settlement already confirmed, write is idempotent UPSERT |
| `persist-receipt-and-finalize` | 3, exponential | 10s | same reasoning |

## 5. Sole-settlement-owner proof

`apps/edge-api/tests/paid-continuation-workflow.test.ts`, `'is the sole
production settle() call site introduced by this Workflow (static source
proof)'`: reads the module's own source text and asserts exactly one
occurrence of `.evidenceProvider.settle(`. This is the same static-scan
technique H2AWI-1 used for bundle isolation, applied here to prove a
structural economic invariant, not merely narrated. Mutation 4 (§12) and
mutation 5 (§12) each independently confirm this test fails the moment a
second call site is introduced anywhere in the file.

`HTTP_SETTLE_CALL_COUNT_MAX` is out of this checkpoint's scope entirely —
no route file was touched (§16); that invariant is H2AWI-3's Task 3.2.

## 6. Authorization-expiry gate

Step 1, immediately before step 2 ever runs. Fail-closed boundary:
`expired = clock() >= valid_before_unix` — `now === validBefore` is treated
as **expired**, matching the plan's explicit fail-closed requirement.
Three dedicated tests (`now < validBefore`, `now === validBefore`,
`now > validBefore`) using a fully injected fake clock, no real wall time
anywhere. Mutation 3 (§12) confirms the check is load-bearing.

## 7. Failure-path proofs (mission §30 / plan requirement map)

| Path | Test | Assertion |
|---|---|---|
| Executor failure (resolved-unsuccessful) | `executor integration` describe block | `executor_rejected`, zero PCC/settle calls |
| Executor timeout (thrown) | same block + crash-matrix case 11 | `executor_timeout`, deterministic, no real wait, zero settle calls |
| PCC failure | `PCC integration` describe block | `pcc_failed`, zero settle calls |
| Settlement rejected (definitive) | `settlement step` block + crash-matrix case 12 | `settlement_rejected`, settle called exactly once, draft resolved to `settlement_failed` (never left dangling at `settlement_pending`) |
| Settlement transport ambiguity | `settlement step` block + crash-matrix cases 5/6 | settle() throws → reconciliation ABSTRACTION invoked, never retried; chain checker itself only reached when a candidate tx ref is on record (nothing to check otherwise) |

## 8. Settlement ambiguity — reconciliation

`apps/edge-api/src/control-plane/continuation/settlement-reconciliation.ts`,
`reconcileAmbiguousSettlement(paymentIdentifier, deps)` — read-only,
bounded retries (default 5, dedicated test proves exactly 5 checker calls
on persistent `STILL_UNKNOWN`, never unbounded). Consumes only
`D1PaymentAttemptRepository.getSettlementRecoveryRecord` (via a narrow,
structurally-typed `ReconciliationRepository` interface) and the real
`cdpChainReceiptChecker` function type
(`../evidence/chain-receipt-checker.ts`, reused by type, not reimplemented).
**No `settle()` method exists anywhere in this module's dependency
signature** — proven by a dedicated structural test
(`'settle' in deps === false`), not merely by absence of a call.

Outcome mapping: `SETTLED` → `confirmed`; `FAILED` → `not_found`; no
candidate transaction reference ever recorded → `inconclusive` without
ever invoking the checker (there is nothing to check).

## 9. Crash-after-transmission behavior

Step 4's settlement logic (`runSettlementStep`) checks the **existing**
D1 settlement record BEFORE ever calling `evidenceProvider.settle()`:

```
existing = repository.getSettlementRecoveryRecord(paymentIdentifier)
if existing.lifecycleStage === 'settlement_pending':
    → resolve via reconciliation ONLY, settle() never called
if existing.lifecycleStage === 'settled_external':
    → return confirmed directly, settle() never called (defensive re-entry)
if existing.lifecycleStage === 'settlement_failed':
    → return rejected directly, settle() never called
otherwise:
    → write the pre-settle draft, THEN call settle() exactly once
```

A "restart" is simulated by a second `runPaidContinuationWorkflow()`
invocation reusing the SAME (durable, shared) settlement repository a real
restart would still observe. Crash-matrix cases 5, 6, 7, and 8 each prove a
distinct crash origin (before the draft write, during the `settle()` call,
after `settle()` returned but before the write completed, after settlement
confirmed but before persistence) all converge on this one safe path,
never a second `evidenceProvider.settle()` call.

## 10. Idempotency proofs

- **Settlement idempotency guard (proof #3):** `'pre-existing unresolved
  draft (idempotency guard) with a known tx ref: routes directly to
  reconciliation, settle() never reached at all'` — the D1 CAS-shaped
  check happens strictly before the facilitator call.
- **Result/receipt/terminal-event idempotency (proof #12):**
  `'result/receipt/terminal-event idempotency: repeated persistence never
  creates a second logical record'` — directly re-invokes the persistence
  port with an identical identity and confirms the underlying store still
  holds exactly one logical result and one logical receipt. Crash-matrix
  cases 8/9 additionally prove this holds across a simulated platform
  restart (memoized steps never re-invoked; non-memoized steps land on
  idempotent UPSERT semantics).
- **Settled-then-persistence-failure, all three points separately (proof
  #11):** three dedicated tests —
  `'settled-then-result-persistence-failure'`,
  `'settled-then-receipt-persistence-failure'`,
  `'settled-then-terminal-state-persistence-failure'` — each forces a
  distinct persistence-port failure AFTER settlement is already confirmed,
  asserts `settle()` is called exactly once (never again), and then
  performs a simulated idempotent-retry restart proving the eventual
  `settled` outcome is reached without any second settlement.

## 11. Deterministic instance identity (proof #13)

This checkpoint does not create Workflow instances itself (H2AWI-3's
`createOrJoinPaidContinuation` job) and does not reimplement instance
identity derivation. Three dedicated tests prove: (a) `deriveWorkflowInstanceId`
(H2AWI-1, unmodified) is deterministic for the same `payment_identifier`;
(b) different identifiers produce different ids; (c) a static source-scan
proves this module neither defines its own instance-id/hash helper nor
even imports `deriveWorkflowInstanceId` — that call belongs to H2AWI-3
alone.

## 12. Restart matrix (12 cases) — per-case classification table

Simulated via a second `FakeWorkflowStep` pre-seeded with exactly the step
results a real Workflow would have durably memoized before the crash
point, run against the SAME shared, durable settlement/job/result-receipt
persistence fakes a real restart would still observe.

| # | Crash point | Executor calls (this restart) | Settle calls (this restart) | Result write | Receipt write | Terminal event | Economic classification |
|---|---|---|---|---|---|---|---|
| 1 | Before step 0 | 1 | 1 | 1 | 1 | 1 | settled — full fresh run, safe |
| 2 | During step 2 (executor) | 1 (re-invoked) | 1 | 1 | 1 | 1 | settled — re-fetch acceptable, no economic action yet |
| 3 | During step 3 (PCC) | 0 (stays memoized) | 1 | 1 | 1 | 1 | settled — deterministic given memoized executor output |
| 4 | Before step 4's draft write | 0 | 1 | 1 | 1 | 1 | settled — draft not yet written, safe fresh settle |
| 5 | After draft write, before settle() (no tx ref known) | 0 | **0** | 0 | 0 | 0 | settlement_ambiguous — reconciliation invoked, nothing to check, resolved non-terminally |
| 6 | During settle() call itself, tx ref became known | 0 | **0** | 1 | 1 | 1 | settled — reconciliation confirms via chain checker, no re-settle |
| 7 | After settle() returned confirmed, before step 4 returns | 0 | **0** | 1 | 1 | 1 | settled — identical safe path to case 6, different origin |
| 8 | During step 5 (persist-result), settlement confirmed | 0 | **0** | 1 (re-invoked) | 1 | 1 | settled — step 4 stays memoized |
| 9 | During step 6 (persist-receipt), result already persisted | 0 | **0** | 0 (stays memoized) | 1 (re-invoked) | 1 | settled — steps 4/5 stay memoized |
| 10 | Duplicate Workflow instance (two independent full runs, same input) | 2 (one per run) | **1 total across both runs** | 2 (idempotent) | 2 (idempotent) | 1 logical | settled — D1 at-most-one backstop holds even if platform dedup somehow failed |
| 11 | Executor timeout at declared boundary | 1 (throws) | 0 | 0 | 0 | 0 | executor_timeout — deterministic, no real wait |
| 12 | Settlement rejected pre-broadcast | 1 | 1 | 0 | 0 | 0 | settlement_rejected — draft resolved to `settlement_failed`, never left dangling |

`SETTLE_CALL_COUNT` is bolded in every crash-adjacent row (5–10) because
it is the single most economically load-bearing number in this table:
**it never exceeds the number of genuinely distinct settlement attempts
across the entire matrix, and is exactly 0 in every row where a prior
attempt already durably claimed the settlement.**

## 13. Mutation proof results (requirement #15 — six, plus retry-policy #16)

Each mutation was applied to the exact file committed in H2AWI-2a..2g/2j,
observed to cause the expected test failure(s), then reverted; `diff`
against the committed file confirmed byte-identical restoration before
moving to the next mutation. The full pass was performed twice — once
against the initial H2AWI-2a..2g commit, and once more in full after the
H2AWI-2j bugfix, since the source changed in between.

| # | Mutation | Tests caught (final pass, post-bugfix) |
|---|---|---|
| 1 | Settlement retry count 0→1 | `'settle step has zero retries'` |
| 2 | Settlement idempotency guard removed (pre-existing-draft check bypassed) | 3 tests (crash-matrix case 6, case 7, `'pre-existing unresolved draft'` settlement-step test) |
| 3 | Authorization expiry check removed (always valid) | both `now===validBefore` and `now>validBefore` expiry tests |
| 4 | Ambiguous settlement incorrectly retried (catch-block re-calls settle() instead of reconciling) | 3 tests, including the sole-settle-callsite static source-scan test (now 2 occurrences) |
| 5 | Post-settlement persistence-recovery calls settle() again (a "double confirm" after reconciliation already confirmed) | 4 tests |
| 6 | Same payment_identifier creates a second economic pipeline (the `settled_external` defensive re-entry guard removed) | 2 tests (case 10's duplicate-instance backstop, the repeated-finalize idempotency test) — degrades to `settlement_ambiguous` rather than a literal double-settle only because the D1 CAS layer (`recordSettlementPending`'s own `'executed'`-only guard) is a SECOND, independent backstop; the primary application-level guard mutation is still caught by both tests observing the wrong resulting status |
| 16 | Retry-policy mutation: `SETTLE` step's `retries` key removed entirely (implicit platform default) rather than set to a wrong value | both `'declares an explicit retry policy on every step'` and `'settle step has zero retries'` |

All seven mutations were caught by an already-existing test — no new test
had to be written to catch any of them, mirroring H2AWI-1's own mutation
proof discipline.

## 14. Runtime/bundle compatibility

- `cloudflare:workers`'s `WorkflowEntrypoint` is imported as a real value
  (needed for `extends`). `@cloudflare/workers-types`' own global ambient
  declaration for this module does not merge into this program the way
  named-type imports from it do (confirmed directly: `tsc` reported
  `Cannot find module 'cloudflare:workers'` before this fix) — matching
  the exact, already-established reason `types/cloudflare-sockets.d.ts`
  exists (SUN-1221C). `apps/edge-api/src/types/cloudflare-workers.d.ts`
  adds the same narrow, locally-scoped ambient declaration
  (`WorkflowEntrypoint` only).
- The default Node vitest pool cannot resolve `cloudflare:workers` at
  runtime (no such module under Node). `apps/edge-api/tests/support/cloudflare-workers-shim.ts`
  + a `vitest.config.ts` alias (`'cloudflare:workers' -> ` the shim)
  mirrors the exact, already-accepted `cloudflare:sockets` shim precedent.
  Unlike that shim (a deliberate throw-on-use stub), this one is a genuine
  structural stand-in — extending it and never invoking the platform-only
  `run()` dispatch performs no I/O, and every test in this checkpoint
  exercises the pure `runPaidContinuationWorkflow` function directly, never
  `new PaidContinuationWorkflow(...)`.
- Wrangler/esbuild's real production bundling never consults the vitest
  alias map and resolves the real platform module natively — confirmed
  directly: `npx wrangler deploy --dry-run` bundle output was grepped for
  `runPaidContinuationWorkflow`/`reconcileAmbiguousSettlement`/`PaidContinuationWorkflow`
  and contains zero occurrences (§16).
- `pnpm test:worker-runtime`: 94/94 scenarios passed, unchanged from
  H2AWI-1's own baseline (this checkpoint's new modules are still inert in
  the real production bundle).

## 15. Confirmation: HTTP integration remains inactive

`grep -rn "paid-continuation-workflow\|settlement-reconciliation"
apps/edge-api/src` (excluding the two new files' own content and doc-comment
mentions inside `continuation/types.ts`) returns zero results. No route
file, `wrangler.toml`, or `config/env.ts` was touched this checkpoint. The
new `workflows/` and `continuation/settlement-reconciliation.ts` modules
are imported by nothing except their own test files — proven both by
static grep and by the real `wrangler deploy --dry-run` bundle scan (§14).

## 16. Confirmation: waiter-timeout decision remains deferred

This checkpoint makes no decision about what the public HTTP response
looks like if a future HTTP waiter (H2AWI-3) times out while its Workflow
keeps running — unchanged from H2AWI-1's own explicit deferral.
`WAITER_TIMEOUT_PUBLIC_BEHAVIOR_DECIDED_IN_H2AWI2=NO`,
`WAITER_TIMEOUT_PUBLIC_BEHAVIOR_DEFERRED_TO=H2AWI-3`.

## 17. Full regression results

| Gate | Result |
|---|---|
| Targeted H2AWI-2 suite (`paid-continuation-workflow.test.ts` + `paid-continuation-workflow-crash-matrix.test.ts` + `settlement-reconciliation.test.ts`) | **46/46 passed** (27 + 12 + 7) |
| Targeted H2AWI-1 + H2AWI-2 combined | **100/100 passed** |
| `pnpm test` (full monorepo suite) | **2563 passed**, 41 skipped (226 files, 206 passed / 20 skipped) — up from H2AWI-1's own baseline of 2517 passed / 203 files passed by exactly the 46 new tests across 3 new test files |
| `pnpm test:worker-runtime` | **94/94 scenarios passed** — unchanged from baseline |
| `pnpm lint` | **16/16 tasks PASS** |
| `pnpm typecheck` (whole repo) | 22/23 tasks pass; `@siteborne/edge-api` fails with exactly the same two pre-existing baseline errors documented in H2AWI-1's own report (`tests/live/web-context-first-paid-e2e-local.test.ts` lines 540/623) — confirmed byte-identical error text, no new error |
| Source-only edge-api typecheck (`tsc --project tsconfig.json`) | **PASS**, exit 0 |
| `pnpm production:preflight` | **PASS** |
| `pnpm secrets:scan` | 4 findings, all 4 matching the established pre-existing baseline documented in H2AWI-1's own report (2 unique findings × old/rewritten commit SHA each); **0 new** |

`MODAL_TESTS=NOT_REQUIRED` — no Python/Modal source changed this checkpoint.

## 18. Scope audit

```
$ git diff 556f493a058d2b447221783a7655b74bd829196f..HEAD --stat
 .../continuation/settlement-reconciliation.ts      | 106 ++++
 .../workflows/paid-continuation-workflow.ts        | 618 +++++++++++++++++++++
 apps/edge-api/src/types/cloudflare-workers.d.ts    |  36 ++
 ...paid-continuation-workflow-crash-matrix.test.ts | 368 ++++++++++++
 .../tests/paid-continuation-workflow.test.ts       | 476 ++++++++++++++++
 .../tests/settlement-reconciliation.test.ts        | 192 +++++++
 .../tests/support/cloudflare-workers-shim.ts       |  48 ++
 apps/edge-api/tests/support/fake-workflow-step.ts  |  61 ++
 .../support/paid-continuation-workflow-fixtures.ts | 489 ++++++++++++++++
 vitest.config.ts                                   |  11 +
 10 files changed, 2405 insertions(+)
```

Every changed file is in H2AWI-2 scope: `continuation/` and `workflows/`
production modules plus their tests, and exactly two supporting files
(`types/cloudflare-workers.d.ts`, `vitest.config.ts`'s alias addition),
both directly precedented by H2AWI-1's own `scripts/test-worker-runtime.mts`
touch and the pre-existing `cloudflare:sockets` shim/alias pattern
respectively, and both documented in full in §14. Zero diff on
`x402-service.ts`, `cdp-provider.ts`, `wrangler.toml`, or `config/env.ts`.
`H2AWI2_SCOPE_VIOLATIONS=0`.

## 19. Zero external / economic effect

`WORKFLOW_DEPLOYMENTS=0`, `WORKFLOW_RESOURCE_CREATIONS=0`,
`WORKER_VERSION_UPLOADS=0`, `SECRET_MUTATIONS=0`,
`PRODUCTION_CONTINUATION_KEYS_CREATED=0`, `D1_MUTATIONS=0`,
`DEPLOYMENT_MUTATIONS=0`, `TRAFFIC_MUTATIONS=0`, `LIVE_402_REQUESTS=0`,
`EIP3009_AUTHORIZATIONS_CREATED=0`, `SIGNER_CALLS=0`,
`PAYMENT_SIGNATURES_CREATED=0`, `PAID_REQUESTS=0`,
`FACILITATOR_VERIFY_CALLS=0`, `FACILITATOR_SETTLE_CALLS=0`,
`SETTLEMENTS=0`, `CHAIN_TRANSACTIONS=0`, `H1_JOB_MUTATIONS=0`. Every
`settle()`/reconciliation call in every test in this checkpoint is a fake
in-memory double (`vi.fn()`, `FakeSettlementRepository`,
`FakeResultReceiptPersistence`, `FakeJobStatePersistence`) — none of them
performs I/O of any kind. Production remains untouched: `git diff` against
`x402-service.ts`, `cdp-provider.ts`, `wrangler.toml` is empty (§18).
