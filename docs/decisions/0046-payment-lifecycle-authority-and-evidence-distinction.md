# SITEBORNE Utility Network — ADR 0046: Payment Lifecycle Authority, Evidence Distinction, and Exact Ordering (SUN-0700A checkpoint 3)

## Context

Directive §3 required inspecting existing control-plane state before designing
anything new, and explicitly warned against creating a competing second payment
lifecycle. That inspection found one already exists, already accepted:
`apps/edge-api/src/control-plane/state-machine` (SUN-0200) defines `JobState`
with exactly the lifecycle stages the checkpoint 3 directive asks for, under
different but semantically equivalent names.

## Decision — state authority

**`JobState` (SUN-0200, already accepted) remains the sole authority over
job/payment lifecycle state.** SUN-0700A does not add a second state machine.
The mapping:

| Directive §5 stage             | Existing `JobState`                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `payment_required`             | `QUOTED` (the 402 challenge is issued from here)                                                           |
| `payment_payload_received`     | trigger for the `PAYMENT_CHALLENGED` evaluation (not a distinct persisted state)                           |
| `payment_structure_valid`      | precondition, checked by checkpoint 1's `validatePaymentPayloadStructure` before evaluating the transition |
| `payment_replay_acquired`      | checkpoint 2's `payment_attempts` (`first_seen`) — tracked separately, not a `JobState` value              |
| `payment_verification_pending` | the job remains `PAYMENT_CHALLENGED` while evidence is evaluated                                           |
| `payment_verified`             | `PAYMENT_VERIFIED`                                                                                         |
| `settlement_pending`           | `SETTLING`                                                                                                 |
| `settled`                      | `DELIVERED`                                                                                                |
| `settlement_failed`            | `REFUND_REQUIRED` (or `RETRYABLE`, per existing `AllowedTransitions`)                                      |
| `verification_failed`          | `PAYMENT_FAILED`                                                                                           |
| `replay_rejected`              | `REJECTED` (job side) / `duplicate_conflict` (payment_attempts side, checkpoint 2)                         |
| `expired`                      | existing job `expires_at` handling / checkpoint 2's `expired`                                              |
| `consumed`                     | checkpoint 2's `markConsumed` on `payment_attempts`                                                        |

SUN-0700A's own contribution (`packages/protocol-x402/src/evidence/`,
`src/linkage/`, `src/lifecycle/stage.ts`) is a **gate a caller consults before
invoking an existing `JobState` transition** — never a value that itself owns or
replaces job state. `payment_attempts.lifecycle_stage` (migration
`0003_payment_lifecycle_stage.sql`) tracks a payment attempt's own progress
independent of which job it links to (a payment can, in principle, be verified
before a job even exists) — it is a summary convenience column, not a competing
authority over job execution state.

## Decision — three distinct concepts, never collapsed (directive §4)

**A. Structural validity** — "does this V2 payload structurally correspond to
this requirement?" Answered entirely by checkpoint 1/2's `payload/parser.ts` and
`requirements/*.ts`.

**B. External verification** — "has a trusted verifier determined the payload
satisfies the requirement?" `ExternalVerificationEvidence`
(`src/evidence/types.ts`) + `canAdvanceToVerified`
(`src/evidence/verification.ts`). Requires structural validity AND
`verified: true` AND an allowed trust class — never advances merely because a
caller set `verified: true`.

**C. Settlement** — "has the payment actually been executed and confirmed?"
`ExternalSettlementEvidence` + `canAdvanceToSettled`
(`src/evidence/settlement.ts`). Requires structural/binding validity AND
`success: true` AND an allowed trust class AND that the settlement's
`verification_evidence_hash` matches an already-accepted verification (directive
§32: "settlement before verification" must fail — enforced by requiring the
caller to pass the accepted verification hash explicitly).

SUN-0700A may only ever produce/consume `synthetic_fixture` or
`locally_derived_structure_only` trust-classed evidence
(`src/evidence/policy.ts`'s `isTrustClassAllowed`) — never `external_verified`,
which requires a real facilitator (SUN-0700B).

## Decision — exact service-execution/settlement ordering

**Verify-before-execute, settle-after-execute.** This was not a new decision to
make — it is what the existing, already-accepted `JobState` graph already
encodes: `PAYMENT_VERIFIED` precedes `LOCKED` / `ROUTED` / `EXECUTING`;
`SETTLING` follows `EXECUTING` / `VERIFYING`. SUN-0700A's evidence gates
preserve this ordering rather than silently assuming an alternative —
`canAdvanceToSettled` structurally requires an accepted verification evidence
hash, making settle-before-verify unrepresentable.

## Decision — D1 persistence (directive §25-26)

Three options were considered for tracking payment-attempt lifecycle progress in
D1:

1. Extend `payment_attempts` (checkpoint 2, already accepted) with a
   `lifecycle_stage` column.
2. A separate `payment_events` event-sourcing table.
3. Reuse `JobState`/`job_state_events` directly for payment-attempt progress.

**Chosen: option 1** — `migrations/0003_payment_lifecycle_stage.sql` adds one
`lifecycle_stage TEXT NOT NULL DEFAULT 'acquired'` column (plus a supporting
index) to the existing `payment_attempts` table. Rejected option 2 as
unnecessary architecture the repo does not otherwise use (directive §17: "Do not
create an event-sourcing architecture if the repo does not use one"). Rejected
option 3 because a payment attempt can be acquired and verified before any
`jobs` row exists at all (directive §15's sequencing) — `JobState` remains the
authority once a job exists, but has nothing to say about a payment attempt's
progress before that point.

`PAYMENT_LIFECYCLE_TRANSITIONS`
(`packages/protocol-x402/src/lifecycle/stage.ts`) is a closed graph —
`acquired -> {verified, verification_failed}`,
`verified -> {settled, settlement_failed}`, all three of
`verification_failed`/`settled`/`settlement_failed` terminal — mirroring the
same `Record<State, State[]>` shape `JobState`'s own `AllowedTransitions`
already uses, not a new pattern.
`D1PaymentAttemptRepository.transitionLifecycleStage` guards every transition at
the database layer itself (`UPDATE ... WHERE lifecycle_stage = ?`, checking
`meta.changes`), the same discipline as checkpoint 2's `acquire()` — never a
separate read-then-write race.

## Consequences

- No existing accepted code (`JobState`, `AllowedTransitions`,
  `D1IdempotencyRepository`, `payment_quotes`) was altered by this checkpoint.
- A later checkpoint that wires this into the real control-plane HTTP layer
  calls `canAdvanceToVerified`/`canAdvanceToSettled` immediately before invoking
  the existing `createStateEvent(...)` machinery for the corresponding
  `JobState` edge — an additive integration, not a redesign.
- `payment_attempts.lifecycle_stage`'s own guarded transitions
  (`D1PaymentAttemptRepository.transitionLifecycleStage`) are proven
  independently real-D1-atomic (directive §27-28) without touching the
  `jobs`/`job_state_events` tables at all.
