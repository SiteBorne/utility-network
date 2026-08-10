# Payment Lifecycle (`@siteborne/protocol-x402`, SUN-0700A checkpoint 3)

**All verification/settlement evidence in this document's scope is
synthetic/local. No facilitator was called. No payment was made. No transaction
was settled. No revenue exists from this checkpoint. SUN-0700B owns live
verification and settlement.**

## One state authority, not two

`apps/edge-api/src/control-plane/state-machine`'s `JobState` (SUN-0200, already
accepted) is the **sole authority** over job/payment execution state. SUN-0700A
does not add a second, competing state machine — it adds **gates** a caller
consults before invoking an existing `JobState` transition. See
[ADR 0046](../decisions/0046-payment-lifecycle-authority-and-evidence-distinction.md)
for the full stage-name mapping and the rationale.

## Three distinct concepts

| Concept                      | Answers                                                                 | Implementation                                            |
| ---------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| **A. Structural validity**   | Does this V2 payload structurally match this requirement?               | `payload/parser.ts`, `requirements/*.ts` (checkpoint 1-2) |
| **B. External verification** | Has a trusted verifier confirmed the payload satisfies the requirement? | `evidence/verification.ts`'s `canAdvanceToVerified`       |
| **C. Settlement**            | Has the payment actually been executed and confirmed?                   | `evidence/settlement.ts`'s `canAdvanceToSettled`          |

None of these ever collapse into one boolean or one name. In particular,
`canAdvanceToVerified` never returns `allowed: true` merely because a caller set
`evidence.verified = true` — it also requires structural validity and an allowed
evidence trust class. `canAdvanceToSettled` additionally requires the settlement
evidence's `verification_evidence_hash` to match an already-accepted
verification — **settlement before verification always fails**.

## Evidence trust classes (`evidence/policy.ts`)

| Trust class                      | SUN-0700A may produce it?      | Accepted in `fixture` mode? | Accepted in `production` mode? |
| -------------------------------- | ------------------------------ | --------------------------- | ------------------------------ |
| `synthetic_fixture`              | Yes                            | Yes                         | No                             |
| `locally_derived_structure_only` | Yes                            | Yes                         | No                             |
| `external_unverified`            | No                             | No                          | No                             |
| `external_verified`              | **Never** (requires SUN-0700B) | No                          | Yes                            |

`production_enabled` is globally `false` throughout SITEBORNE — this distinction
exists now so no future code can accidentally let fixture evidence satisfy a
production gate.

## Exact: verify-before-execute, settle-after-execute

Already encoded by the existing `JobState` graph: `PAYMENT_VERIFIED` precedes
`LOCKED`/`ROUTED`/`EXECUTING`; `SETTLING` follows `EXECUTING`/`VERIFYING`. See
ADR 0046.

## Upto: two phases, never one binding

**Phase 1 (authorization, pre-execution):** quote at the service's maximum →
`upto` requirement → verification evidence → verified. Only the authorized
maximum is known.

**Phase 2 (usage/settlement, post-execution):** bounded service work → real
per-page usage calculation (`pricing/document-usage.ts`) →
`linkage/usage-result.ts`'s `buildUsageResult` (throws
`UsageExceedsAuthorizationError` if the actual amount would exceed the
authorization — enforced at construction, not after the fact) → settlement
evidence carries the actual amount → settled. See
[ADR 0044](../decisions/0044-upto-authorization-vs-usage-binding.md) and
[ADR 0047](../decisions/0047-upto-two-phase-lifecycle-and-receipt-linkage.md).

## `payment_attempts.lifecycle_stage` (D1)

A summary stage on top of checkpoint 2's `payment_attempts` table
(`migrations/0003_payment_lifecycle_stage.sql`) — tracks a payment attempt's own
progress (`acquired -> verified -> settled`, or a failure branch) independent of
which job it links to. Guarded atomically at the database layer
(`D1PaymentAttemptRepository.transitionLifecycleStage`,
`UPDATE ... WHERE lifecycle_stage = ?`) — proven with real D1/Miniflare in
`apps/edge-api/tests/d1-payment-attempts.test.ts`, including illegal transitions
(rejected, state unchanged) and concurrent racing transitions (exactly one
wins).

## Synthetic end-to-end fixtures

`src/tests/exact-lifecycle.test.ts` and `src/tests/upto-lifecycle.test.ts` walk
the full chain — quote → requirement → payload → payment-identifier acquisition
→ verification evidence → (upto: usage calculation → usage-result) → settlement
evidence → `PaymentServiceLink` → consumed — proving every identity/binding
lines up. These are synthetic protocol fixtures, never real payments.
