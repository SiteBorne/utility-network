# SUN-1222C-R4-D8 — Post-Settlement Recovery & Idempotency Proof

## 0. Authorization

Explicit, standalone, first-person authorization received for
`SUN-1222C-R4-D8-POST-SETTLEMENT-RECOVERY-IDEMPOTENCY`, covering complete
read-only analysis and, conditionally, narrowly scoped remediation only if a
genuine defect was demonstrated. No real economic action, live Workflow
instance, payment/settlement bypass, public API deployment, traffic
mutation, credential change, or schema migration authorized.

```
SUN1222C_R4_D8_AUTHORIZATION=GRANTED
```

## 1. Start-state / drift proof

```
D8_START_HEAD=48b77f37abed7c3d284ec68a52c853c977855adf
D7_EVIDENCE_COMMIT_REACHABLE=YES
WORKING_TREE_RELEASE_CLEAN=YES
D8_PRE_HOST_VERSION_ID=8e10f91c-5654-4943-93f0-3a4bb5d27e10 @ 100% (no drift)
Public API: db7054c9 @ 100% / d3472f58 @ 0% (no drift)
D8_HOST_DRIFT=NONE
D8_PUBLIC_API_DRIFT=NONE
D8_TRAFFIC_DRIFT=NONE
```

No unexplained drift — clean continuation from D7.

## 2. Method

Direct source read of the complete orchestration function
(`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`,
1139 lines, read in full) plus its two settlement helper functions
(`runSettlementStep`, `resolveViaReconciliation`), cross-referenced against:

- the state-machine's transition table (`apps/edge-api/src/control-plane/types/index.ts`)
- the existing dedicated crash/restart test suite
  (`apps/edge-api/tests/paid-continuation-workflow-crash-matrix.test.ts`,
  12 cases, read in full — this file already exists specifically for
  H2AWI-2h's "full restart/replay matrix", predating D8)
- the existing settlement-step and persistence-failure test blocks in
  `apps/edge-api/tests/paid-continuation-workflow.test.ts` (940 lines)
- the D1 settlement-repository CAS methods
  (`apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`)
- the public route's terminal-status → HTTP mapping (`x402-service.ts`)
- the deterministic Workflow-instance-ID derivation (`continuation/instance-id.ts`, via `handoff.ts`)

No live Workflow instance was created; no real 402/payment/settlement was
attempted (§24 preserved).

## 3. Core question

> Once settlement has succeeded, or may already have succeeded, can every
> subsequent retry/replay recover safely without causing a second economic
> action or corrupting Workflow state?

**Answer: YES**, for every window this checkpoint could enumerate, under the
already-existing, already-tested design. No functional defect was found.

## 4. Settlement-duplication guard mechanism (§5)

```
D8_SETTLEMENT_DUPLICATION_GUARD = D1-persisted settlement identity (B) + explicit CAS state guard (C) + deterministic Workflow-instance-ID (platform, additive) + SETTLE step's own zero-retry config (defense-in-depth, not relied upon alone)
D8_GUARD_DEPENDS_ON_RUNTIME=NO — the source's own module doc comment (line 568-586) is explicit: "a 'restart' is simply a second call to this same function with the same durable repository state." The D1 CAS guard (`recordSettlementPending`'s `WHERE`-gated transition, checked via `getSettlementRecoveryRecord` at the TOP of `runSettlementStep`, before any settle() call) is sufficient on its own, independent of whether Cloudflare Workflows' own step.do() memoization is engaged for a given replay. Crash-matrix case 10 (line 311-334) proves this directly: two entirely independent orchestration runs (fresh `step`, no memoization at all) against the SAME durable dependencies still settle exactly once.
D8_GUARD_DEPENDS_ON_D1=YES — this is the primary, sufficient mechanism.
D8_GUARD_DEPENDS_ON_PROVIDER=NO — no reliance on the CDP facilitator exposing its own idempotency key; SITEBORNE's own `payment_identifier`-keyed D1 row is the authority.
```

Cloudflare Workflows' documented step.do() memoization (invoked once per
step name per instance) is an *additional*, not load-bearing, layer — the
crash-matrix suite explicitly tests both with it engaged (cases 8/9, step
memoized) and without it (case 10, two full independent runs), and both are
safe.

## 5. Settlement call-site proof (§6)

```
PUBLIC_API_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
D8_SETTLE_CALLSITE_COUNT_UNCHANGED=YES
```

Reconfirmed by direct grep across `apps/edge-api/src`: the sole
`evidenceProvider.settle(...)` invocation is
`paid-continuation-workflow.ts:644`, inside `runSettlementStep`.
`x402-service.ts` carries three comments explicitly documenting it no
longer calls `.settle()` at all (that call was removed when this Workflow
was introduced). No new or hidden production settlement owner exists.

Preconditions enforced before this call site is ever reached:
1. `getSettlementRecoveryRecord` read — if `lifecycleStage` is
   `settlement_pending` (unresolved prior attempt) → routed to
   `resolveViaReconciliation`, settle() never reached.
2. If `settled_external` → returns `confirmed` from the existing record,
   settle() never reached.
3. If `settlement_failed` → returns `rejected` from the existing record,
   settle() never reached.
4. Fresh authorization-expiry recheck (`deps.clock() >= validBeforeUnix`) —
   fails closed to `authorization_expired`, settle() never reached.
5. `recordSettlementPending`'s own D1 CAS write must return `status:
   'transitioned'` — if the CAS itself is lost/contended,
   `ambiguous_unresolved` is returned and settle() is never reached.

Only after all five preconditions pass does line 644 execute.

## 6. Post-settlement failure-window enumeration (§4/§26)

"Economic action already possible" = TRUE from the moment
`recordSettlementPending`'s CAS durably transitions the row (precondition 5
above), since a crash after that point cannot be distinguished, on retry,
from a crash after `settle()` itself returned — both leave the row at
`settlement_pending`, and both are handled identically (reconciliation
only, never re-settle).

| Window ID | Economic action already possible? | State before failure | Failing operation | Retry entry state | How prior settlement is recognized | Could settle() execute again? |
|---|---|---|---|---|---|---|
| W1 | No | pre-CAS | crash before `recordSettlementPending` completes | `verified`/`executed` (no draft row) | N/A — no draft exists | N/A — settle() never called; a fresh attempt starts cleanly |
| W2 | Possible (ambiguous) | CAS committed, `settlement_pending`, no tx ref | crash/throw during the `settle()` network call itself | `settlement_pending`, no tx ref | `getSettlementRecoveryRecord` → `settlement_pending` | **No** — routes to `resolveViaReconciliation`; no candidate tx ref means the chain checker has nothing to check, resolves `not_found`/`ambiguous_unresolved`, never re-calls settle() |
| W3 | Possible (ambiguous, partial) | CAS committed, `settlement_pending`, candidate tx ref surfaced out-of-band | crash between `settle()` transmitting and its response being received | `settlement_pending`, tx ref known | same | **No** — `resolveViaReconciliation` checks the known tx ref on-chain directly |
| W4 | Yes (settle() returned `confirmed`) | `settlement_pending`, tx ref known internally | `recordSettledExternal` / `incrementCdpSuccessfulSettlementCount` / `markConsumed` throws (unguarded, no surrounding try/catch) before `runSettlementStep` returns | `settlement_pending` (row never advanced past the pre-settle draft) | same | **No** — identical row shape to W3 from a restart's point of view; `resolveViaReconciliation` positively confirms the known reference, never re-settles |
| W5 | Yes (settle() returned a definitive rejection) | `settlement_pending` | `recordCdpSettlementOutcome` throws before `runSettlementStep` returns | `settlement_pending` — **not yet** advanced to `settlement_failed` | `getSettlementRecoveryRecord` → still `settlement_pending` | **No** — routes to reconciliation, which itself performs a `not_found`/on-chain check rather than blindly re-settling; worst case resolves `ambiguous_unresolved` again, never calls settle() |
| W6 | Yes (settle() returned `confirmed`, D1 writes completed) | `settled_external` | none — step 4 already returned `confirmed` cleanly | `settled_external` | `existing.lifecycleStage === 'settled_external'` (line 602) | **No** — short-circuits to a `confirmed` outcome built entirely from the existing record, settle() never reached (defensive re-entry only; step memoization already makes this unreachable in practice) |
| W7 | Yes (confirmed) | `settled_external`, `job.current_state = SETTLING` | link/receipt derivation (`buildPaymentServiceLink`/`verifyPaymentServiceLink`/`hashPaymentObject`) or the four sibling checks throws or reports invalid, all *outside* any `step.do` | `settled_external` unchanged; job stays `SETTLING` (`RetryableState`) | same | **No** — this code runs entirely after `step.do('settle',...)` already returned; a restart re-executes these pure/deterministic derivations from the memoized `confirmed` value, never re-touching settlement |
| W8 | Yes (confirmed) | `settled_external`, link/receipt valid | `persistResult` throws inside `step.do('persist-result', ...)` (retries: 3) | `settled_external`; job stays `SETTLING` | same | **No** — `step.do('settle',...)` is memoized; step-level retry (limit 3) or a full restart both leave settle() untouched |
| W9 | Yes (confirmed) | result persisted | `persistReceipt` or `finalizeTerminalState` throws inside `step.do('persist-receipt-and-finalize', ...)` (retries: 3) | `settled_external`; job stays `SETTLING`, receipt possibly already durably written (idempotent UPSERT) | same | **No** — same reasoning as W8 |
| W10 | Yes (confirmed, fully finalized) | `DELIVERED`, receipt written | hypothetical failure between the last successful `step.do` return and the platform's own instance-completion acknowledgment (undocumented platform internals, F8) | `DELIVERED` (all 7 steps already memoized) | `finalizeTerminalState`'s own `isTerminal()` guard (line 480) | **No** — even in the worst case where the entire `run()` were somehow re-invoked, every step replays its memoized value identically, `finalizeTerminalState` no-ops on an already-terminal job, and the returned `WorkflowContinuationResult` is byte-identical |

```
D8_POST_SETTLEMENT_WINDOWS_TOTAL=10
D8_RETRYABLE_WINDOWS=10
D8_AMBIGUOUS_WINDOWS=3 (W2, W3, W5 — resolved via reconciliation, never left to blind retry)
D8_POTENTIAL_DUPLICATE_SETTLEMENT_WINDOWS=0
D8_UNCLASSIFIED_RECOVERY_WINDOWS=0
```

W4 is the one window not previously named explicitly by its exact
mechanism (a throw inside the three post-`settle()` D1 writes,
specifically) — but it is **directly, explicitly tested**: crash-matrix
case 7 (`paid-continuation-workflow-crash-matrix.test.ts:190-222`)'s own
comment reads: *"the crash landed between that [settle()] return and
`recordSettledExternal` completing"* — i.e., this is exactly W4, already
proven safe by existing test, not a missing scenario.

## 7. Crash/failure matrix (§7)

| Failure | Expected state | Economic effect known? | Retry allowed? | May settle again? | Recovery mechanism | Expected eventual state |
|---|---|---|---|---|---|---|
| F1: failure immediately before settle() | pre-CAS or `settlement_pending` (draft only) | No | Yes | No (W1: nothing to recognize; or blocked by the CAS guard on any subsequent attempt) | fresh attempt from clean state, or reconciliation | `settled` or a clean rejection |
| F2: settle() rejects definitively | `settlement_pending` → `settlement_failed` (once `recordCdpSettlementOutcome` completes) | Yes (no) | Yes, but never re-settles | No — `existing.lifecycleStage === 'settlement_failed'` short-circuits to `rejected` (line 619-621) | reuse of the durably recorded rejection reason | `settlement_rejected` |
| F3: settle() throws before a known response | `settlement_pending`, no tx ref | Unknown | Yes | No — resolved via reconciliation only (never retried, `STEP_CONFIG.SETTLE.retries.limit=0`) | `resolveViaReconciliation` | `settled` (if later found on-chain) or `settlement_ambiguous`/`settlement_rejected` |
| F4: settle() may have succeeded but response is ambiguous | `settlement_pending`, tx ref may be known | Unknown | Yes | No | reconciliation | same as F3 |
| F5: settle() succeeds, persistence of settlement result fails (W4) | `settlement_pending` (D1 write never completed) | Yes | Yes | No — identical row shape to F4 on restart | reconciliation | `settled` |
| F6: settlement result persists, receipt persistence fails (W9 upstream: `persistResult` succeeds, `persistReceipt` fails) | `settled_external`, result written, receipt not yet | Yes | Yes (step-level retry, limit 3) | No — `step.do('settle',...)` memoized | idempotent UPSERT retry | `settled`/`DELIVERED` |
| F7: receipt persists, final job-state persistence fails (W9, `finalizeTerminalState` fails) | `settled_external`, receipt written, job still `SETTLING` | Yes | Yes | No | idempotent retry; `finalizeTerminalState`'s `isTerminal()` guard | `DELIVERED` |
| F8: terminal state persists but outer Workflow return/ack fails (W10) | `DELIVERED` | Yes | Yes (hypothetically) | No — every step already memoized | full replay returns an identical memoized result; `isTerminal()` guard prevents any duplicate transition | `DELIVERED` (unchanged) |
| F9: retry occurs after each of F4-F8 | (see each row above) | — | Yes | **No, in every case** | as above | correct terminal state reached in every case |

No row is unexplained.

## 8. Required safety invariants (§8)

- **Invariant A (no duplicate settlement)**: PROVEN. Across every window in
  §6/§7, `settle()` is reached at most once per `payment_identifier`.
  Crash-matrix case 10 proves this even across two fully independent
  orchestration runs with zero shared step memoization — `deps.settle`
  called exactly once total. `paid-continuation-workflow.test.ts:711-721`
  ("never calls settle() a second time... under any injected failure
  sequence") is a dedicated mutation-sensitive test for this exact
  invariant.
- **Invariant B (ambiguous ≠ unpaid)**: PROVEN. `settlement_ambiguous`
  never triggers a new settle() attempt — see §9 (ambiguity audit) below.
  The public HTTP mapping (`x402-service.ts:1244-1251`) folds
  `settlement_ambiguous` into the same `402 settlement_rejected` response
  family as an explicit rejection — this is a pre-existing, unchanged
  design choice (not modified by D8) that puts the resolution burden on
  ops/human reconciliation, exactly as the source's own comment states
  (line 883-885).
- **Invariant C (local persistence failure ≠ stranded delivery)**: PROVEN.
  `SETTLING → DELIVERED` remains a legal transition
  (`AllowedTransitions.SETTLING` includes `'DELIVERED'`); `SETTLING` is
  itself declared `RetryableState`; D7's finding that forcing
  `REFUND_REQUIRED` here would be unsafe is independently confirmed at the
  state-machine schema level: `AllowedTransitions.REFUND_REQUIRED =
  ['REJECTED', 'TOMBSTONED']` — **no path back to `DELIVERED` exists at
  all**, not merely by convention.
- **Invariant D (no unnecessary duplicate executor side effect)**: PROVEN
  for the post-settlement recovery windows this checkpoint covers — once
  `executorOutcome` is captured, it is reused unchanged through to the end
  of that same call; on a restart, `step.do('invoke-executor', ...)` stays
  memoized (crash-matrix case 3: "step 2 stayed memoized, never
  re-invoked") for every window at or after step 3. (A restart landing
  during step 2 itself, case 2, does re-invoke the executor — explicitly
  documented as acceptable since no economic action has occurred yet at
  that point.)
- **Invariant E (no contradictory terminal states)**: PROVEN at the schema
  level — `DELIVERED` and `TOMBSTONED` are the only two states with `[]`
  allowed transitions (true terminal sinks); nothing transitions into
  `REFUND_REQUIRED` from `DELIVERED` or vice versa; `isTerminal()` is
  checked before every `transitionJobState`/`finalizeTerminalState` call.
- **Invariant F (economic proof precedes irreversible local claims)**:
  PROVEN — `canAdvanceToSettled` (unchanged by D8) is the sole gate that
  converts a facilitator response into a `confirmed` outcome; a
  structurally-mismatched "successful-looking" response is rejected, not
  advanced (existing test, `paid-continuation-workflow.test.ts:620-637`).

## 9. Existing test inventory (§9)

| Scenario | Classification | Location |
|---|---|---|
| settled-then-terminal-state-persistence-failure | DIRECT | `paid-continuation-workflow.test.ts:825-861` |
| settled-then-result-persistence-failure | DIRECT | `paid-continuation-workflow.test.ts:760-790` |
| settled-then-receipt-persistence-failure | DIRECT | `paid-continuation-workflow.test.ts:792-823` |
| settlement_ambiguous (transport throw, no tx ref) | DIRECT | `paid-continuation-workflow.test.ts:639-658` |
| settlement_rejected (explicit + structural-mismatch) | DIRECT | `paid-continuation-workflow.test.ts:498-515, 605-618, 620-637` |
| settlement retry / never-twice mutation guard | DIRECT | `paid-continuation-workflow.test.ts:711-721` |
| pre-existing unresolved draft routes to reconciliation | DIRECT | `paid-continuation-workflow.test.ts:660-685` |
| expired authorization + pending draft still reconciles | DIRECT | `paid-continuation-workflow.test.ts:687-709` |
| full 12-case crash/restart matrix (W2-W9 equivalents) | DIRECT | `paid-continuation-workflow-crash-matrix.test.ts` (entire file) |
| duplicate Workflow instance (two full independent runs) | DIRECT | `paid-continuation-workflow-crash-matrix.test.ts:311-334` |
| Workflow step retry semantics (declared policy, no implicit default) | DIRECT | `paid-continuation-workflow.test.ts:61-95` |
| receipt/result persistence idempotency (UPSERT, no dup record) | DIRECT | `paid-continuation-workflow.test.ts:890-940` |
| settled-then-pcc-undefined fail-closed | DIRECT | `paid-continuation-workflow.test.ts:863-888` |
| finalize-called-twice no-op | DIRECT | `paid-continuation-workflow.test.ts:733-758` |
| W4 exact mechanism (throw between settle() return and `recordSettledExternal`) | DIRECT | `paid-continuation-workflow-crash-matrix.test.ts:190-222` (case 7) |

```
D8_EXISTING_DIRECT_TESTS=15 (scenario groups; underlying `it()` count higher)
D8_PARTIAL_TESTS=0
D8_MISSING_SCENARIOS=0
```

No genuine safety gap was found, so §10's test-first-defect rule does not
apply — no new regression test was required or written.

## 10. Settlement-ambiguity deep audit (§14)

```
D8_SETTLEMENT_AMBIGUITY_CLASS=C — requires reconciliation before retry, and the reconciliation gate provably exists and is unconditionally reached first
```

Trace: `settlement_ambiguous` is reached exactly two ways —
(a) `recordSettlementPending`'s own CAS returns `status !== 'transitioned'`
(settle() never called at all — trivially safe), or
(b) `resolveViaReconciliation`'s final fallthrough (line 565) when the
bounded chain-receipt-checker polling (`maxAttempts`/`delayMs`) still
cannot resolve `SETTLED`/`FAILED`.

For (b): the row remains at `settlement_pending` (neither
`recordSettledExternal` nor `recordCdpSettlementOutcome` is called on that
path). Any subsequent attempt to settle this same `payment_identifier` —
whether a platform-level retry of the same instance or an entirely new
Workflow instance — re-enters `runSettlementStep`, reads
`getSettlementRecoveryRecord`, finds `settlement_pending` again, and is
**unconditionally routed back through `resolveViaReconciliation`** before
any possibility of reaching line 644 a second time. There is no code path
that reads `ambiguous_unresolved` and independently decides to call
`settle()` directly. Class D (duplicate-economic-effect risk) is
disproven by this unconditional gate.

One pre-existing, unchanged, already-documented design property worth
recording explicitly (not a D8 defect — the source's own comment at line
883-885 already states it): once `runPaidContinuationWorkflow` itself
returns `settlement_ambiguous`, that Workflow instance's `run()` completes
normally (not an error) with `job.current_state` left at `SETTLING`. There
is no scheduled reconciliation sweep or admin endpoint in the current
codebase that automatically re-triggers this same job later — the
in-workflow reconciliation gate above only fires on a **subsequent
invocation**, which today only happens via (i) a platform-level retry of
an *errored* instance (not applicable here, since `ambiguous_unresolved`
is a clean return, not a throw) or (ii) an operator manually re-driving
recovery out-of-band. This is an intentional "ops/human reconciliation"
design (per the source comment), not a gap this checkpoint is scoped to
fix — building an automated reconciliation-sweep mechanism would be new
functionality, not a "smallest design" fix, and would fall under §18's
"do not redesign the Workflow" boundary. Flagged here for visibility only.

## 11. Durable recovery data audit (§15)

```
D8_DURABLE_SETTLEMENT_IDENTITY=YES — payment_attempts row keyed by payment_identifier, lifecycle_stage, settlement_transaction_reference (D1)
D8_DURABLE_RECEIPT_IDENTITY=YES — result_receipt persistence port, idempotent UPSERT keyed by (jobId, paymentIdentifier)
D8_DURABLE_EXECUTOR_RESULT_IDENTITY=NOT_REQUIRED — executor output is only ever consumed within the single call that produced it or a step-memoized replay of that exact call; it is not independently re-fetched from a separate durable store, and re-invoking the executor before settlement is explicitly documented as acceptable (Invariant D)
D8_RECOVERY_REQUIRES_TRANSIENT_LOGS=NO
```

No new durable identifier is required. No schema change is implicated.

## 12. State-machine validity (§16)

```
D8_POST_SETTLEMENT_RECOVERY_TRANSITIONS=PASS
D8_ILLEGAL_TRANSITION_DEPENDENCIES=0
```

Confirmed directly from `AllowedTransitions`
(`apps/edge-api/src/control-plane/types/index.ts:64-82`):
- `SETTLING: ['DELIVERED', 'REFUND_REQUIRED', 'RETRYABLE']` — `SETTLING →
  DELIVERED` is legal, confirming D7's finding at the schema level, not
  merely by test.
- `REFUND_REQUIRED: ['REJECTED', 'TOMBSTONED']` — **no** transition to
  `DELIVERED` exists. D6/D7's rejected `REFUND_REQUIRED`-forcing "fix"
  would have created exactly the illegal dependency this section checks
  for; it does not exist in the merged source.
- `SETTLING` is itself listed in `RetryableStates` — the state machine's
  own schema agrees a job may legitimately dwell there pending retry.
- `DELIVERED` and `TOMBSTONED` both have `[]` — true terminal sinks; no
  code path transitions out of either.

## 13. No "fix that destroys retryability" (§17)

No change was proposed or made. The five `persistence_failed_after_settlement`
Class E branches and the `settlement_ambiguous` branch remain exactly as
D5-D7 left them — retryable, without a forced-terminal durable transition.
D8's own analysis (§6-§12 above) independently re-derives, from source and
schema rather than from D7's prior conclusion alone, that this is correct.

## 14. Remediation boundary (§18)

```
D8_REMEDIATION_REQUIRED=NO
FUNCTIONAL_SOURCE_MUTATIONS=0
HOST_DEPLOYMENTS=0
```

No genuine post-settlement recovery or duplicate-economic-effect defect was
found. No change was made merely to produce a deployable artifact.

## 15. Schema / migration rule (§19)

```
D8_SCHEMA_CHANGE_REQUIRED=NO
D8_MIGRATION_REQUIRED=NO
```

## 16. Regression gates (§20)

Not applicable — no source changed. (Repeating D7's already-passing gates
against an unchanged tree would not constitute new evidence.)

## 17. Secrets / configuration (§21)

```
D8_SECRETS_SCAN_NEW=0 (no scan re-run; no file touched)
```

Credential inventory, CDP credential placement, ADR-0055 frozen variables,
Workflow binding, and public routing: all untouched.

## 18. Predeployment readback (§22) / Deployment boundary (§23)

Not applicable — `D8_REMEDIATION_REQUIRED=NO`, so no deployment occurs per
§23 ("Do not redeploy an unchanged host merely to create a checkpoint
artifact").

## 19. No live economic qualification (§24)

```
D8_SAFE_WORKFLOW_INSTANCES=0
D8_LIVE_INSTANCE_QUALIFICATION=NOT_ATTEMPTED
```

D5-D7's finding stands unchanged: `PaidContinuationWorkflow` remains
production payment-gated; no non-economic live-instance path exists. All
qualification in this checkpoint used the existing controlled in-process
fakes (`FakeWorkflowStep`, `buildTestDependencies`, the settlement
repository test double) already established by prior checkpoints — no new
test infrastructure was needed since the crash-matrix suite already
existed.

## 20. Required D8 recovery matrix (§26)

See §6 (windows table) and §7 (failure matrix) above — combined, every
post-settlement failure window appears exactly once, with
`D8_UNCLASSIFIED_RECOVERY_WINDOWS=0`.

## 21. Economic accounting (§25)

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
EXECUTOR_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
TEST_DOUBLE_SETTLE_CALLS=0 (no new test run this checkpoint — existing suite's own test-double counts, e.g. "settle() called exactly once", are read from source, not re-executed, since no source changed)
```

## 22. Final packet

```
SUN1222C_R4_D8_POST_SETTLEMENT_RECOVERY_IDEMPOTENCY=PASS
SUN1222C_R4_D8_AUTHORIZATION=GRANTED
D8_START_HEAD=48b77f37abed7c3d284ec68a52c853c977855adf
D7_EVIDENCE_COMMIT_REACHABLE=YES
WORKING_TREE_RELEASE_CLEAN=YES
D8_PRE_HOST_VERSION_ID=8e10f91c-5654-4943-93f0-3a4bb5d27e10
D8_HOST_DRIFT=NONE
D8_PUBLIC_API_DRIFT=NONE
D8_TRAFFIC_DRIFT=NONE
D8_POST_SETTLEMENT_WINDOWS_TOTAL=10
D8_RETRYABLE_WINDOWS=10
D8_AMBIGUOUS_WINDOWS=3
D8_POTENTIAL_DUPLICATE_SETTLEMENT_WINDOWS=0
D8_UNCLASSIFIED_RECOVERY_WINDOWS=0
D8_SETTLEMENT_DUPLICATION_GUARD=D1 CAS (primary) + deterministic instance ID (additive) + zero-retry step config (defense-in-depth)
D8_GUARD_DEPENDS_ON_RUNTIME=NO
D8_GUARD_DEPENDS_ON_D1=YES
D8_GUARD_DEPENDS_ON_PROVIDER=NO
D8_SETTLE_CALLSITE_COUNT_UNCHANGED=YES
D8_EXISTING_DIRECT_TESTS=15
D8_PARTIAL_TESTS=0
D8_MISSING_SCENARIOS=0
D8_SETTLEMENT_AMBIGUITY_CLASS=C
D8_DURABLE_SETTLEMENT_IDENTITY=YES
D8_DURABLE_RECEIPT_IDENTITY=YES
D8_DURABLE_EXECUTOR_RESULT_IDENTITY=NOT_REQUIRED
D8_RECOVERY_REQUIRES_TRANSIENT_LOGS=NO
D8_POST_SETTLEMENT_RECOVERY_TRANSITIONS=PASS
D8_ILLEGAL_TRANSITION_DEPENDENCIES=0
D8_DUPLICATE_SETTLEMENT_MUTATION_PROOF=N/A (already proven by existing test, no new test written)
D8_RECOVERY_MUTATION_PROOF=N/A
D8_AMBIGUITY_MUTATION_PROOF=N/A
D8_REMEDIATION_REQUIRED=NO
D8_SCHEMA_CHANGE_REQUIRED=NO
D8_MIGRATION_REQUIRED=NO
D8_SECRETS_SCAN_NEW=0
D8_SAFE_WORKFLOW_INSTANCES=0
D8_LIVE_INSTANCE_QUALIFICATION=NOT_ATTEMPTED
FUNCTIONAL_SOURCE_MUTATIONS=0
HOST_DEPLOYMENTS=0
PUBLIC_API_DEPLOYMENTS=0
D8_TRAFFIC_MUTATIONS=0
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
EXECUTOR_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
TEST_DOUBLE_SETTLE_CALLS=0
WORKING_TREE=clean
EVIDENCE_COMMIT_SHA=(this commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R4-D9 (or, if the settlement_ambiguous/ops-reconciliation gap noted in §10 is to be addressed, a dedicated future checkpoint scoped specifically to that — out of D8's boundary)
```

Do not begin D9 automatically.
