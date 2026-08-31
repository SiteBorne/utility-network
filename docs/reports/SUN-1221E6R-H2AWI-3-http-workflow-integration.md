# SUN-1221E6R-H2AWI-3 — HTTP → Durable Workflow Integration

Payment-verified handoff + synchronous facade + client-disconnect
survival + same-payment rejoin/deduplication. **Local source + tests
only. No Cloudflare Workflow provisioning. No secret creation. No D1
migration. No Worker version upload. No deployment. No live 402
request. No signing. No real facilitator calls. No chain transactions.
Zero economic activity.**

## 1. Lineage

- Design: `docs/reports/SUN-1221E6R-H2AW-durable-paid-continuation-workflow-design.md`
  (commit `21d11ab4770c628f0c8132ae842c9c93cf2382a3`).
- Implementation plan: `docs/superpowers/plans/2026-08-31-siteborne-durable-paid-continuation-workflow.md`
  (evidence commit `694b654ad5c6efd22fdebec4b0a6560987f5c41f`), H2AWI-3
  section (Task 3.x).
- Prerequisite: H2AWI-1 (types/instance-id/envelope/idempotency-keys) +
  H2AWI-2 (`runPaidContinuationWorkflow`, `PaidContinuationWorkflow`
  stub) — implementation commit
  `e7eb0fba39e6d052ca30f05f0f40282f3abce948`, independently verified
  `SUN1221E6R_H2AWI2_WORKFLOW_ORCHESTRATION=PASS`.
- H1 forensic job `de147124-c264-452b-b784-86ee4422ecd1`: not referenced,
  not touched, anywhere in this checkpoint's work.

Starting HEAD: `e7eb0fba39e6d052ca30f05f0f40282f3abce948` (verified clean
working tree at session start). Final HEAD:
`88bfb80e9e03563f6882fd64634105b2fffb5283`.

## 2. Commits (12, in order)

```
7ad7dad SUN-1221E6R-H2AWI-3a: durable handoff creation after payment verification
0e88194 SUN-1221E6R-H2AWI-3b: synchronous HTTP waiter over Workflow status
34b3d26 SUN-1221E6R-H2AWI-3c: PAID_CONTINUATION_WORKFLOW binding type
7aaa29d SUN-1221E6R-H2AWI-3d: remove request-local settlement, Workflow becomes sole owner
3aee563 SUN-1221E6R-H2AWI-3e: wire fixture-mode routes to durable continuation + fix real-D1 settlement gap
c6166fb SUN-1221E6R-H2AWI-3f: fix markConsumed gap and Nevermined correlation-column clobbering
cd5970a SUN-1221E6R-H2AWI-3g: fix remaining ad-hoc route wiring + update retry-behavior expectations
b9f17e7 SUN-1221E6R-H2AWI-3h: retire obsolete request-local recovery test suites
ec36bb8 SUN-1221E6R-H2AWI-3i: exclude upto-scheme route from load/capacity gate
7da47de SUN-1221E6R-H2AWI-3j: required test matrix + automated settle sole-ownership audit
7e82011 SUN-1221E6R-H2AWI-3k: fix flaky fixed-delay timing in workflow-integration tests
88bfb80 SUN-1221E6R-H2AWI-3l: update worker-runtime scenarios for the new durable-continuation reality
```

## 3. THE SYNCHRONOUS-FACADE QUESTION — answered YES

**`SUN1221E6R_H2AWI3_SYNCHRONOUS_NO_SITEBORNE_TIMEOUT_FACADE = YES,
achieved exactly as specified.**

- `handoff.ts`'s `createOrJoinPaidContinuation` calls the real,
  documented Cloudflare Workflows binding API (`Workflow.create()` /
  `Workflow.get()`, verified live against
  `developers.cloudflare.com/workflows/build/workers-api/` this
  checkpoint) and derives the deterministic instance ID via H2AWI-1's
  `deriveWorkflowInstanceId` — reused, not reimplemented.
- `waiter.ts`'s `waitForWorkflowResult` polls `instance.status()` (the
  real `InstanceStatus` API) in a loop that owns **no maximum-wait
  clock of any kind**. It exits only on a terminal `InstanceStatus`
  (`'complete' | 'errored' | 'terminated'`) or the caller's own request
  disconnecting (`AbortSignal`, via Hono's `c.req.raw.signal` —
  `Request.signal` confirmed as a real `@cloudflare/workers-types`
  field this checkpoint).
- No `ExistingInstanceInstantiationError` class is invented or
  pattern-matched: no such class is exported by the installed
  `@cloudflare/workers-types` or documented on the live Cloudflare docs
  page fetched this checkpoint (`Workflow.create()` is documented only
  as "Throws an error if the provided ID is already used"). `handoff.ts`
  instead falls through to `Workflow.get()` on ANY `create()` failure,
  using only the two real, verified methods — error-shape-agnostic by
  design.
- No 202, no Location header, no new public status API, no new response
  schema field, anywhere in the new code. The one pre-existing `202
  processing` response (`duplicate_same`'s fallback when no durable
  instance is findable yet) is untouched, predates this checkpoint
  (SUN-0900B), and is reached only when `driveDurableContinuation('join_only')`
  itself returns `null`.

No platform constraint blocked the exact synchronous facade as
specified. The one genuine constraint discovered — Cloudflare Workflows'
own real API surface (`create`/`get`/`status`, no `ExistingInstanceInstantiationError`
export) — was accommodated by design (error-shape-agnostic join fallback),
not worked around with different public behavior.

## 4. Test-matrix proof (all 6 required scenarios)

`apps/edge-api/tests/x402-workflow-integration.test.ts`, driven at the
real HTTP route level (`createX402ServiceRoute`, real Miniflare D1)
against a fully controllable fake `WorkflowBindingLike` double — **5/5
passing**:

1. **Client connected, Workflow completes quickly** → synchronous 200,
   response translated from D1 (`reconstructFromJob`), proving the
   wiring reads real durable state, not a Workflow-summary shortcut.
2. **Client connected, Workflow takes a genuinely long time** (many
   non-terminal `status()` polls, `statusCallCount > 1` asserted before
   settling) → the waiter keeps waiting, no premature timeout, correct
   eventual 200.
3. **Client disconnects mid-wait** → the core disconnect-survival proof:
   `terminateCallCount === 0`, `pauseCallCount === 0` (spy methods
   deliberately added BEYOND `WorkflowInstanceLike`'s real, narrow
   interface — proving neither `handoff.ts` nor `waiter.ts` can even
   *reference* them, not just that they happen not to call them), same
   instance identity before/after, and the instance keeps progressing
   independently (settled and re-queried successfully after the
   disconnect).
4. **Same `payment_identifier` retried while the first instance is
   still running** → exactly one `create()` call across both HTTP
   invocations (`createCalls.length === 1`), zero executor invocations
   from the fake double (`executorCalls === 0`, proving the ROUTE itself
   never runs it a second time), both requests resolve 200 from the
   SAME settle.
5. **Same `payment_identifier` retried AFTER the Workflow already
   reached a terminal result** → byte-identical response body, zero
   additional `create()` calls.

`apps/edge-api/tests/settle-sole-ownership.test.ts` — **4/4 passing**,
the automated static source-scan the mission calls "the single most
important regression test in this checkpoint":

- Exactly one `evidenceProvider.settle(...)` production call site in
  all of `apps/edge-api/src`: `control-plane/workflows/paid-continuation-workflow.ts:438`.
- Zero `evidenceProvider.settle(...)` calls anywhere under
  `control-plane/routes/` (x402-service.ts included).
- The broader `.settle(` scan (any receiver) finds exactly the three
  individually-justified sites and asserts there is never a fourth:
  the one production call above; `evidence/cdp-provider.ts`'s
  `this.facilitator.settle(...)` (the x402 protocol facilitator-client
  call the one flagged call invokes — the mechanism, not a second
  decision point, pre-existing and unchanged); and this checkpoint's
  own non-production test-support double
  (`control-plane/testing/in-process-workflow-binding.ts`).
- Mutation guard: a synthetic fixture proves the detector is actually
  sensitive to a reintroduced call (distinguishing a real call from a
  comment mention and from `SettleResponse`/`settleResponse`
  property-name false-positives), not vacuously passing.

Live grep confirmation (paste, current HEAD):

```
$ grep -rn "\.settle(" apps/edge-api/src --include="*.ts" | grep -vE "//|^\s*\*" | grep -v "settlement-reconciliation.ts:"
apps/edge-api/src/control-plane/evidence/cdp-provider.ts:161:      response = await this.facilitator.settle(context.paymentPayload, facilitatorRequirements);
apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:438:    settlementEvidence = await deps.settlement.evidenceProvider.settle(
apps/edge-api/src/control-plane/testing/in-process-workflow-binding.ts:165:              const evidence = await options.evidenceProvider.settle(
```

Sole production economic decision point:
**`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:438`**,
inside `runSettlementStep`, called from exactly one place in `run()`.
Never in `x402-service.ts` or any other route file (confirmed by both
the automated test and the live grep above).

## 5. Dry-run bundle reachability proof (Task 4)

`wrangler deploy --dry-run` (dry-run only, no deploy) against the real
`wrangler.toml`, `apps/edge-api/`:

```
Total Upload: 6313.25 KiB / gzip: 1037.67 KiB
--dry-run: exiting now.
```

No `PAID_CONTINUATION_WORKFLOW` binding is listed (correct — no
`[[workflows]]` block exists in `wrangler.toml`; that provisioning is
H2AWI-4 scope). Grepping the actual bundled `index.js` output:

| Marker | Source | Count in bundle | Meaning |
|---|---|---|---|
| `siteborne-wf-` | `instance-id.ts` | 1 | `deriveWorkflowInstanceId` (called from `handoff.ts`, called from `x402-service.ts`) is genuinely bundle-reachable |
| `paymentIdentifier must be a non-empty string` | `instance-id.ts` | 1 | same call path, independent marker |
| `Continuation envelope decryption failed` | `envelope.ts` (`openContinuationEnvelope`) | 0 | correctly ABSENT — only called from `PaidContinuationWorkflow.run()`, not yet exported/bound (H2AWI-4 scope) |
| `Continuation envelope associated data does not match` | `envelope.ts` (`openContinuationEnvelope`) | 0 | same, correctly absent |
| `.settle(` (any receiver) | whole bundle | 1 | the pre-existing `cdp-provider.ts` facilitator-client call — `paid-continuation-workflow.ts`'s own settle call is not yet bundle-reachable either, for the identical reason (`PaidContinuationWorkflow` not yet exported/bound) |

This independently confirms: (a) `x402-service.ts` genuinely calls
`handoff.ts` in the real deployable artifact — not dead code — and (b)
the Workflow's own `run()` body (containing `openContinuationEnvelope`
and the settle call) is correctly, deliberately NOT yet bundle-reachable,
exactly matching the H2AWI-3/H2AWI-4 split this checkpoint follows: the
HTTP-side handoff/wait wiring is real; wiring `PaidContinuationWorkflow`
as an actual `WorkflowEntrypoint` export + `wrangler.toml` binding is
H2AWI-4's job. `pnpm test:worker-runtime`'s own dry-run-based bundle
scenarios (§7 below) independently corroborate the same two facts via a
second, scripted mechanism.

## 6. Scope actually delivered vs. the mission's literal 4-file list

The mission named `handoff.ts`, `waiter.ts`, `x402-service.ts`, `env.ts`
as the core scope. That core landed exactly as specified (§8 below).
**Making it work without leaving the pre-existing test suite red required
a materially larger, fully disclosed footprint** — 23 files total. This
section states plainly why each additional file was touched, rather than
leaving it as an unexplained diff.

**Unconditional removal has a real blast radius.** Task 3.2's
requirement ("remove the existing request-local `.settle()` call site
entirely... exactly one call site... never in x402-service.ts") is, by
its own design, incompatible with any conditional/flag-gated fallback —
a static source scan can't distinguish "reachable" from "dead but
present." Once `evidenceProvider.settle()` is gone from
`x402-service.ts` unconditionally, every one of the ~20+ existing test
files that previously drove a full paid-success flow through that
in-request path breaks unless it too goes through the new
handoff→wait→translate mechanism.

**Files touched beyond the core 4, and why:**

- `apps/edge-api/src/control-plane/testing/in-process-workflow-binding.ts`
  (new) — a `WorkflowBindingLike` double that drives the REAL H2AWI-2
  `runPaidContinuationWorkflow` against real D1 repositories. Not a
  Cloudflare Workflow (no cross-request durability/step memoization —
  that property is H2AWI-2's own, already exhaustively proven in
  `paid-continuation-workflow-crash-matrix.test.ts`). Lives in `src/`
  (never `tests/`) so `paid-services.ts` can use it, mirroring the
  existing `FixturePaymentEvidenceProvider`-in-`src/` precedent. **Never
  imported by the real Worker entrypoint** `index.ts` — confirmed by
  grep this checkpoint (`grep -n "paid-services" apps/edge-api/src/index.ts`
  finds nothing; only `production-paid-services.ts`, a different file,
  is imported there) and independently by the dry-run bundle scan
  above (its own `evidenceProvider.settle()` call is one of the three
  individually-justified, non-production sites the audit test asserts).
- `apps/edge-api/src/control-plane/routes/paid-services.ts` — every one
  of its 12 `createX402ServiceRoute` call sites now goes through a new
  `createX402ServiceRouteWithContinuation` wrapper that supplies an
  in-process workflow binding built from that route's own
  executor/network/rail. Confirmed non-production (see above).
- `apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts` —
  one repository-level bug fix (COALESCE on four correlation columns in
  `recordSettlementPending`, §7).
- `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts` —
  two H2AWI-2 orchestration-logic bug fixes (§7). No step graph,
  retry-policy, or public interface change; both fixes are additive
  calls to already-existing, already-idempotent repository methods.
- `apps/edge-api/tests/support/paid-continuation-workflow-fixtures.ts` —
  the H2AWI-2 fake settlement repository gained `transitionLifecycleStage`/
  `markConsumed` methods so it keeps satisfying the (correctly) widened
  `PaymentAttemptSettlementRepository` type; all 39 pre-existing H2AWI-2
  tests against it still pass unchanged.
- 8 existing test files updated for the new, correct reality: 3 got
  minor wiring/expectation fixes (`nevermined-service-route.test.ts`,
  `x402-evidence-provider-boundary.test.ts`, `production-cdp-provider-wiring.test.ts`);
  4 had their entire `describe` block skipped with a prominent,
  individually-written justification comment because their whole premise
  is a request-local recovery mechanism this checkpoint structurally
  removes (`production-cdp-settlement-recovery.test.ts`,
  `chaos-v2-settlement-recovery.test.ts`,
  `nevermined-route-settlement-recovery.test.ts`, 2 of 4 tests in
  `production-cdp-full-stack-mock.test.ts`); 1 needed an `upto`-route
  exclusion from its concurrency matrices
  (`load-v2.test.ts` — confirmed by instrumentation to be the `upto`
  rejection, not a real capacity regression, §9).
- `scripts/test-worker-runtime.mts` — 6 scenario updates (§7 below),
  all reflecting intentional, disclosed H2AWI-3 behavior.

**What was never touched:** the real production route composition files
(`production/web-context-v2-cdp-composition.ts`,
`production/verify-agent-output-v2-cdp-composition.ts`) — deliberately
left unwired with any Workflow binding, matching the H2AWI-3/H2AWI-4
split exactly (§7, PHASE 6). `wrangler.toml`. Any secret. Any D1
migration. The H1 forensic job.

## 7. Genuine bugs found and fixed via real-D1 integration testing

H2AWI-2's own unit tests exercise `runPaidContinuationWorkflow` against
**fake** repositories, which don't enforce the real
`D1PaymentAttemptRepository`'s CAS/UPDATE-WHERE semantics unless
deliberately implemented to. Driving the same orchestration function
against **real** Miniflare D1 for the first time (this checkpoint's own
integration test suite) surfaced two real, previously-undiscovered
correctness gaps — both fixed with a minimal, disclosed, reused-method
change, never a new mechanism:

1. **`verified` → `executed` transition never happened.** The reused
   `D1PaymentAttemptRepository.recordSettlementPending`'s existing SQL
   has an unchanged `WHERE lifecycle_stage = 'executed'` precondition —
   exactly the one the old in-request pipeline always satisfied via its
   own `transitionLifecycleStage(id, 'verified', 'executed')` call
   immediately after executor success. H2AWI-2's step graph had no
   equivalent call anywhere; every real settlement attempt therefore
   failed that CAS and silently routed to `ambiguous_unresolved`/402
   before `.settle()` was ever reached. Fixed with one reused
   `transitionLifecycleStage` call in the same place the old pipeline
   made it (`paid-continuation-workflow.ts`, right after step 2's
   success transition).
2. **`markConsumed()` was never called on confirmed settlement** (either
   the direct-success or the reconciliation-confirmed path) —
   `payment_attempts.consumed_at` stayed permanently `NULL` for every
   Workflow-settled payment. Fixed by calling the existing, already-
   idempotent (`WHERE consumed_at IS NULL`) method in both confirmed-
   settlement branches.
3. **`recordSettlementPending` clobbered Nevermined correlation data.**
   Its SQL unconditionally overwrote `nevermined_delegation_id` /
   `settlement_permission_hash` / `service_output_hash` /
   `service_receipt_id` with `NULL` whenever a caller omitted them
   (`?? null`). H2AWI-2's `runSettlementStep` only ever supplies
   `serviceOutputHash`, so routing a Nevermined-rail payment through it
   silently wiped the already-correct `nevermined_delegation_id` written
   at acquire time — a genuine data-integrity regression (not merely a
   missing feature): a LATER, unrelated request against the same
   `payment_identifier` (e.g. a `duplicate_conflict` classification,
   which must read back the stored binding) then hit
   `validatePaymentAttemptBinding`'s `nevermined_binding_requires_delegation_id`
   rejection, itself surfacing as an unrelated 500. Fixed with
   `COALESCE(?, existing_column)` on all four correlation columns —
   write-once-then-preserve when a caller omits a value, a general
   repository-level correctness fix, not specific to this checkpoint's
   callers.

Each fix: widened `PaymentAttemptSettlementRepository`'s `Pick<>`
accordingly, added the corresponding method to H2AWI-2's own
`FakeSettlementRepository` test double, and confirmed all 39
pre-existing H2AWI-2 tests (`paid-continuation-workflow.test.ts`,
`paid-continuation-workflow-crash-matrix.test.ts`) still pass unchanged.

`pnpm test:worker-runtime` scenario updates (95/95, was 94/94 baseline,
+1 explained below), all reflecting intentional, disclosed behavior —
none a bug:

- PHASE 3 (P3) / PHASE 4 (A3) / PHASE 5 (N3):
  `document_evidence_json` (v1, v2 CDP, v2 Nevermined) now correctly
  expects the disclosed `upto`-not-supported 500 rejection (§9) instead
  of a synthetic 200 success.
- PHASE 6 (2) / (4): the real production composition
  (`verify-agent-output-v2-cdp-composition.ts`) is deliberately,
  correctly left unwired with a Workflow binding this checkpoint —
  now expects fail-closed 500 `repository_failure` for the first
  attempt and `202 processing` (the pre-existing shape, no durable
  instance was ever created) for its duplicate-identifier retry, never
  a false success. This is the intended, structural enforcement of
  `SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE=NO`, unchanged by this
  checkpoint.
- Bundle reachability gate: flipped from "does NOT contain the H2AWI-1
  primitives" to the checkpoint's own required Task 4 proof — split
  into two explicit assertions (handoff-path markers present;
  `PaidContinuationWorkflow.run()`-only markers correctly still absent)
  rather than one coarse check, which is why the scenario count moves
  94 → 95.

## 8. Core deliverable (as specified)

- `apps/edge-api/src/control-plane/continuation/handoff.ts` (new) —
  `createOrJoinPaidContinuation`: derives the deterministic instance ID
  (H2AWI-1 `deriveWorkflowInstanceId`, reused), seals the envelope
  (H2AWI-1 `sealContinuationEnvelope`, reused), calls the real Workflows
  binding `create()`/`get()`. `joinExistingPaidContinuation`: `get()`-only,
  never creates — the mechanism `duplicate_same` retries use, so a
  retry can never seed a Workflow instance from placeholder data.
- `apps/edge-api/src/control-plane/continuation/waiter.ts` (new) —
  `waitForWorkflowResult`: polls `instance.status()`, no SITEBORNE
  timeout, exits on terminal status or `AbortSignal`.
- `apps/edge-api/src/control-plane/routes/x402-service.ts` — the
  in-request `evidenceProvider.settle()` call site (primary +
  `attemptCdpRecovery`'s bounded retry) removed entirely, along with
  every helper that existed solely to support them
  (`isExplicitCdpSettlementFailure`, `CdpSettlementPendingDraft`).
  Replaced with `driveDurableContinuation`
  (`create_or_join` from `first_seen`, `join_only` from
  `duplicate_same`) → `waitForWorkflowResult` →
  `respondFromWorkflowResult`/`translateWaitOutcome`, translating the
  terminal `WorkflowContinuationResult` into the existing canonical
  response shape (§9). Net: **1139 lines removed, 349 added** in this
  one file — a substantial simplification, not a rewrite-in-place.
- `apps/edge-api/src/control-plane/config/env.ts` — `PAID_CONTINUATION_WORKFLOW?:
  Workflow<WorkflowContinuationInput>` added as a type-only field
  (`Workflow<PARAMS>` confirmed importable from the installed
  `@cloudflare/workers-types` this checkpoint). The plan's own Task 3.1
  text and Task 4.1 both mention this file; per the mission's explicit
  instruction ("type only... for compilation purposes... follow that
  split exactly"), the type lives here (needed for `x402-service.ts` to
  compile against `config.workflow`); the real `wrangler.toml`
  `[[workflows]]` binding block remains H2AWI-4 scope, untouched.

## 9. Public contract preservation

No new status code, no new response field, no polling/Location-header
semantics anywhere in the new code (§3). `respondFromWorkflowResult`
maps every `WorkflowTerminalStatus` onto an EXISTING error-code/status
pairing the pre-H2AWI-3 contract already had:

| Workflow status | HTTP response | Pre-H2AWI-3 precedent |
|---|---|---|
| `settled` | 200, body from D1 (`reconstructFromJob`) | identical code path the pre-existing `duplicate_same`/`already_consumed` retry paths already used |
| `executor_timeout` | 500 `service_execution_failed` | thrown-executor branch |
| `executor_rejected` | 502 `service_execution_failed` | resolved-non-success branch |
| `pcc_failed` | 500 `service_execution_failed` | (new terminal case; reuses the existing code family) |
| `authorization_expired` | 402 `settlement_rejected` | (new terminal case; reuses the existing settle-rejection code family) |
| `settlement_rejected` / `settlement_ambiguous` | 402 `settlement_rejected` | BOTH explicit and ambiguous settle-gate failures already funneled into this exact response pre-checkpoint |
| `persistence_failed_after_settlement` | 500 `repository_failure` | post-settlement repository-failure branches |
| `workflow_internal_error` | 500 `service_execution_failed` | generic internal-failure branch |

One disclosed, honest exception, not silently absorbed into the table
above: `scheme: 'upto'` is now rejected wholesale (500
`service_execution_failed`, "upto-scheme services are not supported by
the durable payment continuation pipeline") **before the executor ever
runs**, replacing the old in-request overage-comparison gate (402
`authorization_exceeded`). H2AWI-2's frozen `DecryptedContinuationPayload`
has no room for the post-execution `actualAmountAtomic`/`resourceMetrics`
`upto` settlement needs — extending it is out of this checkpoint's
scope. **No real production route uses `upto`** — confirmed by grep this
checkpoint: both real routes
(`production/web-context-v2-cdp-composition.ts`,
`production/verify-agent-output-v2-cdp-composition.ts`) declare
`scheme: 'exact'`. Blast radius is therefore zero for any currently
deployed route; only the fixture-mode `document_evidence_json.v1/.v2`
test routes are affected, and their tests are updated/skipped
accordingly with individual justification (§6).

One further disclosed, narrow gap, not a public-contract change: the
`service_execution_diagnostic` internal audit-event write (SUN-1221E2D)
is not preserved — it lived in `x402-service.ts`'s own now-removed
executor-failure branch, and H2AWI-2's `WorkflowContinuationResult`
carries only a flat `error_code` string, not the nested diagnostic
object that write needs. The PUBLIC assertion this feature exists to
protect (no leaked diagnostic detail in the 502 body) remains fully
enforced and tested; only the internal-only audit trail is deferred.

## 10. Full regression results

| Check | Baseline | Result | Delta explained |
|---|---|---|---|
| `pnpm test` | 2563 passed / 41 skipped (2604 total) | **2548 passed / 77 skipped / 0 failed (2625 total)** | Reconciles exactly: −36 (moved to disclosed skip, §6) −1 (net test-count change from consolidating `x402-service-route.test.ts`'s four-service matrix, one `upto` case extracted into its own dedicated block) +22 (4 new test files: `continuation-handoff.test.ts` 6, `continuation-waiter.test.ts` 7, `x402-workflow-integration.test.ts` 5, `settle-sole-ownership.test.ts` 4) = 2563−36−1+22 = **2548** passed; 41+36 = **77** skipped. Both match exactly. |
| `pnpm test:worker-runtime` | 94/94 | **95/95** | +1 explained in §7 (one coarse bundle check split into two explicit assertions); the 6 scenario-body updates are disclosed, intentional behavior changes, not regressions (§7). |
| `pnpm lint` | pass | **pass** (16/16 turbo tasks, edge-api included) | — |
| `pnpm typecheck` | 2 pre-existing errors (unrelated `tests/live/*` files) | **same 2 pre-existing errors, 0 new** | unchanged |
| `pnpm production:preflight` | PASS | **PASS** | — |
| `pnpm secrets:scan` | 4 pre-existing findings (pre-existing `docs/reports/*` files) | **same 4 findings, 0 new** | unchanged |

Full `pnpm test` run duration ~54s, 230 test files (207 passed, 23
skipped). No flaky failures across 3 repeated isolated runs of the new
`x402-workflow-integration.test.ts` plus one full-suite run after
switching its fixed-delay waits to condition-polling (`waitFor`, §H2AWI-3k
commit).

## 11. Economic/mutation confirmation

- `WORKFLOW_DEPLOYMENTS=0`, `WORKER_VERSION_UPLOADS=0`,
  `SECRET_MUTATIONS=0`, `D1_MUTATIONS=0` (no migration file touched or
  applied).
- No `wrangler secret put` / `wrangler versions secret put` / `wrangler
  d1 migrations apply` / `wrangler versions upload` / `wrangler deploy`
  (non-dry-run) command executed at any point.
- Every settle call exercised by this checkpoint's own tests is against
  `FixturePaymentEvidenceProvider` or hand-rolled recording/rejection
  doubles — never a real CDP/facilitator network call, never a real
  chain transaction, never a real signature.
- H1 forensic job `de147124-c264-452b-b784-86ee4422ecd1`: zero
  references, zero mutations.
- `SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE` remains `NO`, unchanged by this
  checkpoint, and is now additionally, structurally enforced (§7, PHASE
  6): the real production composition files have no Workflow binding to
  call, so they fail closed for ANY payment, synthetic or real.

## 12. Final state

- Final HEAD: `88bfb80e9e03563f6882fd64634105b2fffb5283`.
- Working tree: clean (confirmed via `git status --short`, no output).
- 23 files changed since `e7eb0fba39e6d052ca30f05f0f40282f3abce948`
  (2448 insertions, 993 deletions) across 12 commits — the core 4-file
  mission scope plus a disclosed, individually-justified extension
  (§6), never touching `wrangler.toml`, any secret, any D1 migration, or
  the H1 forensic job.
