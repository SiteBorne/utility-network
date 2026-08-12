# SUN-0900B Checkpoint 1 — controlled sandbox self-test, partial state

## Classification

`controlled_sandbox_self_test`. `independent_customer=false`, `revenue=false`,
`open_market_purchase=false`, `production_ready=false`,
`production_enabled=false`. This is a SITEBORNE-operator-controlled transaction
against the Nevermined **sandbox**, never mainnet, never an unknown external
buyer.

## Outcome so far (Checkpoint 1B)

Registration (1A), delegation, real verification, and real service execution are
all confirmed. **Two real sandbox settlements have externally occurred**
(confirmed via the strongest available evidence —
`GET /delegation/{id}/transactions` returning `status: "succeeded"` for both),
but neither reached a local HTTP 200 / `PaymentServiceLink` / D1 `consumed`
state, because SITEBORNE's own settlement validator falsely rejected both real
successes. That validator defect and a separate D1 cross-process persistence
defect it exposed are both fixed and regression-tested (prior repair, commit
`9d9e102`). **This pass adds the durable settlement-recovery state machine and
crash-recovery proof** those two fixes made possible — see "Durable
settlement-recovery lifecycle" below. It is built and thoroughly tested as a
standalone library; wiring it into the actual live HTTP route
(`createX402ServiceRoute`) is the next, and final, integration step before
authorizing the checkpoint-closing live run.

```
funding                     PASS (20 USDC on the subscriber smart account)
registration                COMMITTED, reconciled
delegation                  2 delegations created and exhausted (see below)
authorization (x402 token)  obtained twice, in-memory only, never persisted
verification                CONFIRMED real (external_verified) on both attempts
service execution           executed on both attempts (fixture-mode adapters)
settlement (external)       SETTLED x2 — confirmed via GET /delegation/{id}/transactions
settlement (local HTTP)     REJECTED x2 — SITEBORNE validator defect, now fixed
PaymentServiceLink / D1     never reached consumed on either attempt
replay proof                NOT YET RE-ATTEMPTED
```

## Authoritative registration (frozen — never to be re-registered)

Recorded in `packages/protocol-nevermined/src/checkpoint-fixture.ts`'s
`SUN_0900B_CHECKPOINT_1_REGISTRATION`. Public sandbox identifiers only — an
agentId/planId are not secret.

| Field         | Value                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| service       | `web_context_verified.v1`                                                       |
| environment   | `sandbox`                                                                       |
| network       | `eip155:84532` (Base Sepolia)                                                   |
| scheme        | `nvm:erc4337`                                                                   |
| agentId       | `37714377069519076502259354421538507339628407587207707299869594618861814144272` |
| planId        | `94523930722525068656272128894334430057768353189467518442660086462546695282012` |
| agent name    | `Verified Web Context`                                                          |
| plan name     | `Verified Web Context — PAYG plan`                                              |
| billing model | `pay-as-you-go`                                                                 |
| trial         | `false`                                                                         |

## Independently verified persisted plan economics

Read back from `payments.plans.getPlan(planId)` (authenticated, builder key,
read-only) — not merely assumed from the registration request. The persisted
plan's `registry.price` carries the buyer-paid amount as **two** components,
which were summed and kept distinct rather than treated as one undifferentiated
number:

| Component               | Atomic USDC | Receiver                                                                 |
| ----------------------- | ----------: | ------------------------------------------------------------------------ |
| Seller net proceeds     |      `8910` | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` (SITEBORNE)                 |
| Nevermined platform fee |        `90` | `0x2020949c1B565421AC21b76e70340266c4CA9A90` (Nevermined, not SITEBORNE) |
| **Gross buyer total**   |  **`9000`** | —                                                                        |

`9000` atomic matches the canonical SITEBORNE price for
`web_context_verified.v1` (`governance/RISK_LIMITS.yaml` →
`web_context_verified_direct: 0.009` USD → `9000` atomic at 6 decimals) exactly.
Token address `0x036CbD53842c5426634e7929541eC2318f3dCF7e` matches Circle's Base
Sepolia USDC exactly. `isTrialPlan: false`, `billingModel: "pay-as-you-go"`,
`accessLimit: "credits"` confirmed on the persisted object.

Seller net proceeds (`8910`) is never conflated with the canonical gross buyer
amount (`9000`) anywhere in this repository — the platform fee is a
Nevermined-side deduction, not a SITEBORNE pricing decision.

## Registration synchronization root cause

The first live attempt's `registerAgentAndPlan(...)` call succeeded (both
`agentId`/`planId` were non-empty and asserted truthy), but an immediate
`getAgent(agentId)` call in the same `beforeAll` raced ahead of Nevermined's own
indexing and returned `Agent not found`. A later, independent read-only
reconciliation pass (`getAgents`/`getPlans`/`getAgent`/`getPlan`/
`getAgentPlans`, builder key only) found exactly one matching agent and exactly
one matching, linked plan, both reading back successfully — **root cause:
eventual consistency**, not a failed or partial registration.

## Harness repair: idempotent, duplicate-safe live registration

`packages/protocol-nevermined/src/registry-reconciliation.ts` adds
`reconcileNeverminedRegistration` — a pure, credential-independent, bounded
(default backoff `[0, 2s, 5s, 10s, 20s, 30s]`), read-only state machine. Its
`NeverminedRegistryClient` input interface deliberately has **no**
registration-shaped method at all, so the type itself — not just convention —
keeps this module from ever mutating anything.

`apps/edge-api/tests/live/nevermined-live-exact.test.ts`'s `beforeAll` now
always reconciles first (PHASE A) against the frozen checkpoint fixture's known
IDs before ever considering `registerAgentAndPlan`, which is reachable only when
reconciliation reports `state: 'absent'` — positively proven across the full
backoff schedule, never inferred from one failed read. Any other outcome
(`partial`, `conflicting`, `timeout`) throws rather than guessing. The live
test's phases are now explicit in its own comments: A registration
reconciliation, B subscriber delegation, C ephemeral x402 authorization, D-F
real verify/execute/settle, G replay/duplicate_conflict — so a future partial
failure mid-lifecycle (e.g. delegation succeeds but the next read fails) can be
diagnosed and resumed by phase, not by rerunning the whole test from scratch.

Nine credential-free regression tests
(`packages/protocol-nevermined/src/registry-reconciliation.test.ts`) prove the
reconciliation invariants without any network call:

- A/B/C: existing registration (found by known ID or by listing) is reused,
  never re-registered.
- D/E: agent-without-plan or plan-without-agent fails closed as `partial`.
- F: multiple exact-name candidates fail closed as `conflicting`.
- G: known IDs that resolve to differently-named objects fail closed as
  `conflicting` — a stale/foreign ID can never be silently accepted.
- H: perpetual non-linkage times out and fails closed after the full bounded
  schedule, with zero mutation.
- I: `absent` is only ever returned after the _entire_ backoff schedule proves
  it (asserted via exact call counts) — never from one empty listing.

## Governance

SUN-0900B was already transitioned `blocked_external → active` in a prior commit
(`9f3737d`) once the external registration mutation had occurred, recording that
the checkpoint's registration exists as evidence while the remaining fixed-PAYG
proof (delegation → authorization → verify → execute → settle → replay) stays
outstanding. `document_evidence_json.v1` remains `registration_allowed: false`;
`sandbox_capability_verified: false` is unchanged. Production remains disabled
and not ready.

## Two confirmed real settlements — historical incidents, not proof of end-to-end success

| #   | delegationId                           | providerTransactionId                                                | amountCents | status      |
| --- | -------------------------------------- | -------------------------------------------------------------------- | ----------- | ----------- |
| 1   | `aafdab51-57a2-44d2-8765-579b8a5f9c19` | `0xdbd5109b7d7dc10763573f59923d98056068cc3a78f5cba06408ed87779d96fe` | 1           | `succeeded` |
| 2   | `6a4979a9-a69e-4c21-ba7f-e679c276f1ca` | `0x3b2b1ddfd1ef917e607951400c5bccb23a0e89c66795f2eb0e88171901f3a541` | 1           | `succeeded` |

Confirmed read-only, subscriber key, via
`GET /api/v1/delegation/{delegationId}/transactions` (the strongest available
evidence tier — an explicit per-transaction `status`, not inferred from
delegation-level `Exhausted`/`amountSpentCents`, though both delegations also
independently corroborate this: `status: Exhausted`, `amountSpentCents: "1"`,
`transactionCount: 1` each). `transactionCount` from `listDelegations()` matched
`totalResults` from the transactions endpoint exactly for both — no
duplicate-settlement risk, no reconciliation inconsistency.

**Classification: `PAID_EXTERNAL_NOT_CONSUMED_LOCAL` for both.** Local artifacts
(Payment-Identifier, job, attempt, PCC, receipt, verification evidence) from
both attempts are **`LOCAL_ARTIFACTS_UNRECOVERABLE`** — not merely because the
test process exited, but because of the D1 durability defect below: they were
never durably persisted to begin with. These two incidents prove Nevermined
sandbox external settlement capability. They do **not** prove end-to-end paid
HTTP success, `PaymentServiceLink`, D1 `consumed`, or replay protection — those
remain to be demonstrated by a future, successful live run.

## Settlement validator defect (root cause of both false rejections)

`NeverminedSettlementResult` declares `success: boolean` (non-optional) after
the official `@nevermined-io/payments@1.10.0` SDK's own type — but
`facilitator-api.js`'s `settlePermissions()` does **zero response
normalization** (`return await response.json();`, a raw passthrough), so that
type is a compile-time-only annotation, not a runtime guarantee. Both real
settlements above arrived with `success` absent, alongside `payer`/`network`/
`creditsRedeemed` (already found optional-and-absent in the first fixed-PAYG
diagnostic pass). `packages/protocol-nevermined/src/validation.ts`'s
`validateNeverminedSettlementResult` required `result.success` truthy as its
first, unconditional gate — so both real successes were rejected before any
other field was even checked.

**Fix — `normalizeSettlementSuccess`, a scheme-scoped positive-success
normalizer** (provider `nevermined-payments@1.10.0`, scheme `nvm:erc4337`),
never a generic "missing means success" rule:

- `success === false` → `explicit_failure`, always rejected — authoritative over
  every other field, including a present, valid transaction reference.
- `success === true` → `positive_success` (unchanged prior behavior).
- `success === undefined` → `positive_success` **only** when a real, bounded,
  non-empty `transaction` reference is present; otherwise `ambiguous`.
- `success` present but neither `true` nor `false` → `ambiguous` — never
  guessed.

This matches Nevermined's own official TypeScript integration guide, which never
inspects `settlement.success` at all — it treats a resolved
`settlePermissions()` call plus a real `settlement.txHash` as sufficient to
build its own receipt. `ambiguous_settlement` is a new, distinct rejection
reason (previously collapsed into `provider_rejected`) so a genuinely
unrecognized response shape is never silently treated as either success or an
ordinary provider rejection. The same normalizer is reused in `evidence.ts`'s
`sanitizeNeverminedSettlement` so the sanitized audit record can never disagree
with the actual pass/fail gate.

14 new regression tests (`packages/protocol-nevermined/src/validation.test.ts`)
cover the full matrix: canonical REST shape, installed-SDK-observed shape
(success absent + real transaction), explicit failure (with and without a valid
transaction present — failure is always authoritative), no positive evidence at
all, malformed transaction, and an unrecognized `success` shape — all fail
closed except genuine positive evidence.

## D1 cross-process persistence defect (found while investigating the above)

`d1Persist: <file path>` — used in all seven of this repository's D1-backed
Hono/Miniflare test files — is **not a recognized option** on the installed
Miniflare version (`5.20260801.0-alpha`); it was silently ignored. Every
`siteborne-d1-*-live-*` tempdir left behind by real live runs was confirmed
empty. This means the two paid-external-not-consumed incidents above have no
recoverable local trace, and any future crash-recovery design would have nothing
to reconcile against.

**Fix:** the current option is the shared, top-level `resourcePersistencePath` —
a directory Miniflare itself manages (D1/R2/KV/DO all persist under it), not a
single sqlite file path. Fixed in all seven files. A new regression test,
`apps/edge-api/tests/d1-cross-instance-durability.test.ts`, proves both halves:
the old option name genuinely writes nothing to disk, and the fixed option
genuinely survives a full Miniflare instance dispose + fresh-instance cycle at
the same path (the same guarantee a real process crash-and-restart needs — not
merely reusing the same in-memory instance, which a different, already- accepted
test proves a different thing about).

## Durable settlement-recovery lifecycle (recovery hardening pass)

Smallest additive extension to the already-accepted `payment_attempts` table
(checkpoint 2) and its `lifecycle_stage` summary state (checkpoint 3, ADR 0046)
— not a parallel lifecycle. `packages/protocol-x402/src/lifecycle/ stage.ts`'s
`PaymentLifecycleStage` gains four new stages, inserted between the pre-existing
`verified` and `settled`/`settlement_failed` terminals:

```
verified -> executed -> settlement_pending -> settled_external -> link_verified -> settled
                \-> settlement_failed          \-> settlement_failed
```

`verified -> settled` and `verified -> settlement_failed` remain legal directly,
unchanged — the durable-recovery path is additive, never mandatory; the existing
accepted CDP/fixture-mode flow is untouched. There is no separate `consumed`
stage: `link_verified -> settled` reuses the pre-existing terminal value and the
pre-existing `markConsumed`/`consumed_at` mechanism exactly as before.

**`SETTLEMENT_PENDING` precedes the external call, always.** Migration
`0006_settlement_recovery.sql` adds six nullable, additive columns to
`payment_attempts`: `nevermined_delegation_id`, `settlement_permission_hash`,
`service_output_hash`, `service_receipt_id`, `settlement_transaction_reference`,
`settlement_pending_at`.
`D1PaymentAttemptRepository.recordSettlementPending(paymentIdentifier, correlation)`
writes exactly these non-secret fields and atomically transitions
`executed -> settlement_pending` in the same statement — no access token, API
key, authorization header, or other secret can be expressed by this method's own
type signature, let alone persisted by it. `recordSettledExternal` records the
settlement transaction reference and transitions
`settlement_pending -> settled_external` once external evidence (or a normal
synchronous response) confirms success.

**Read-only external reconciliation.**
`packages/protocol-nevermined/src/settlement-recovery.ts`'s
`reconcileNeverminedSettlement` classifies
`GET /delegation/{delegationId}/transactions` evidence into exactly `SETTLED` /
`NOT_SETTLED` / `AMBIGUOUS` — zero transactions is `NOT_SETTLED`; a single
transaction with a recognized failure status is `NOT_SETTLED`; a single
transaction with `status: "succeeded"` is `SETTLED`; **more than one transaction
for what should be a single-use delegation is always `AMBIGUOUS`**
(duplicate/external-inconsistency), never silently accepted as settled even if
every one of them individually looks successful; a read failure or an
unrecognized status string is also `AMBIGUOUS`, never guessed either way.
`AMBIGUOUS` must never trigger an automatic retry.

**13 new tests** prove the invariants deterministically:
`settlement-recovery.test.ts` (7, the classifier alone, no D1) and
`nevermined-settlement-recovery.test.ts` (7, credential-free, real D1/ Miniflare
with `resourcePersistencePath`, `dispose()` + fresh-instance cycles for genuine
cross-process proof — never merely reusing the same in-memory instance):

- B: `SETTLEMENT_PENDING` persisted, external reconciliation finds nothing
  (`NOT_SETTLED`) — safe to retry per existing idempotency policy, no duplicate
  execution.
- C/D: provider settles for real but the local process never processes the
  response — read-only reconciliation still proves `SETTLED`.
- E/F: recovered `SETTLED` state completes
  `link_verified -> settled -> consumed` exactly once after a real process
  restart (fresh Miniflare instance, same persistence path), reusing the durable
  receipt/output — `markConsumed` remains idempotent (a second call is a no-op).
- G: explicit settlement failure — never consumed, stays distinguishable from
  ambiguity.
- H: reconciliation read itself fails (timeout/transport loss) — `AMBIGUOUS`,
  local state stays at `settlement_pending`, never auto-transitions either way.
- J: more than one recorded transaction for the same delegation — fails closed
  as `AMBIGUOUS`, matching the classifier's own duplicate guard.
- **Principal acceptance test:** "process A" writes `SETTLEMENT_PENDING` then
  fully disposes; "process B" (fresh Miniflare instance, same
  `resourcePersistencePath`) recovers the durable correlation data, runs
  read-only reconciliation (`SETTLED`), completes
  `settled_external -> link_verified -> settled -> consumed`, and a subsequent
  replay with the identical binding reconstructs the already-`settled` result
  via the existing `already_consumed` idempotency path — zero re-execution, zero
  re-settlement.

**Live harness prepared, not yet wired.**
`apps/edge-api/tests/live/nevermined-live-exact.test.ts` now opens D1 at a
stable, deterministic path (`$TMPDIR/siteborne-sun-0900b-checkpoint1-live-d1`,
never a fresh random `mkdtempSync` directory) and never auto-deletes it, so an
operator can resume a failed final live run by re-running the exact same command
instead of starting over. **The durable settlement-recovery primitives
themselves are not yet called from this live test or from the real
`createX402ServiceRoute` HTTP route** — they are built and proven standalone.
Wiring them into the actual route (so a real live run benefits from them) is the
next, final integration step before the checkpoint-closing live charge.

## What was not done in this checkpoint (1B repair + recovery-hardening turns)

No delegation was created. No x402 access token was obtained. No
`verifyPermissions` or `settlePermissions` call was made. No paid service
execution occurred. `RUN_LIVE_NEVERMINED` was not set during either turn.
SUN-0900B is not accepted.

## Route-recovery wiring turn (this turn): a real architectural blocker, resolved with an additive wire-contract change

**The blocker, found before any code was written.** The recovery design above
needs a `delegationId` to reconcile against
(`GET /delegation/{delegationId}/transactions`). Tracing every place one could
reach the real seller-side route — `PaymentVerificationContext`/
`PaymentSettlementContext`'s Nevermined `authorizationContext`
(`packages/protocol-x402/src/evidence/provider.ts`), `NeverminedPaymentEvidenceProvider.verify()`/`settle()`
(`apps/edge-api/src/control-plane/evidence/nevermined-provider.ts`), and the
installed SDK's own `.d.ts` files
(`VerifyPermissionsResult`/`SettlePermissionsResult` in `facilitator-api.d.ts`,
`X402TokenAPI.getX402AccessToken` in `token.d.ts`) — confirmed none of them
carry a delegation reference the seller can read back. `DelegationAPI.listDelegations`/
`getPurchasingPower` were also checked and ruled out: they are scoped to "the
requesting API key" (the **buyer's** subscriber key), not the seller's
facilitator key, and the seller's HTTP route never sees the buyer's key.

**Prerequisite check (real, live, read-only).** Before committing to a wire
change, verified directly against the sandbox — using the **seller's**
`NVM_API_KEY` against both real delegations from the earlier checkpoint
(`aafdab51-...`, `6a4979a9-...`, created by the buyer's subscriber key) — that
the seller's own credential CAN read `GET /api/v1/delegation/{id}` and
`GET /api/v1/delegation/{id}/transactions` for a delegation it doesn't own:
both returned HTTP 200 with the expected shape. This closed the "seller
credential can't read anything at all" failure mode before it was designed
around.

**Decision (explicit, user-directed):** add a `PAYMENT-DELEGATION-ID` header —
additive, Nevermined-only, never authorization evidence by itself — the buyer
discloses the same delegationId their access token is bound to.

### What was wired into the real route

- **`PAYMENT-DELEGATION-ID` header** (`packages/protocol-nevermined/src/delegation-header.ts`,
  new): parsed and structurally validated (bounded token shape) *before* any
  provider call, on the Nevermined branch only. Missing/malformed → `400
  malformed_payment_delegation_id`, zero verify/execute/settle calls (route
  test: "requires PAYMENT-DELEGATION-ID before any provider call").
- **Bound into the immutable v2 payment-attempt binding**
  (`packages/protocol-x402/src/replay/binding.ts`): `nevermined_delegation_id`
  is now a *required* field of every new Nevermined v2 binding (validated by
  `validatePaymentAttemptBinding`, participates in the binding digest). A
  reused Payment-Identifier presented with a different delegationId is
  `duplicate_conflict`, before any provider call — proven at the route level.
  Persisted via the same `nevermined_delegation_id` D1 column migration 0006
  already added (dual role: written at acquire time as part of the binding,
  and again — redundantly, same value — by `recordSettlementPending`'s
  correlation write; no new migration needed).
- **`delegationId` threaded through the authorization context**
  (`packages/protocol-x402/src/evidence/provider.ts`'s
  `NeverminedPaymentAuthorizationContext`): available to `verify()`/`settle()`
  callers for correlation only — never sent to the facilitator, never
  authorization evidence by itself.
- **Durable pre-settle persistence, in the real route**
  (`apps/edge-api/src/control-plane/routes/x402-service.ts`): after execution
  succeeds, for the Nevermined rail, `lifecycle_stage` moves `verified ->
  executed`, the full executor output/receipt/verification-evidence is
  durably written to `x402_service_results` via a new `createPending`
  (before the real `settle()` call), and `recordSettlementPending` commits
  `executed -> settlement_pending` with the delegationId + correlation
  hashes — **all before `evidenceProvider.settle(...)` is ever called**. If
  that persistence write fails, the route returns `500 repository_failure`
  and `settle()` is never reached (route test: "normal success writes
  SETTLEMENT_PENDING durably before the real settle call" + the crash-A test
  below prove the sequencing both ways).
- **Ambiguous vs. explicit-failure, distinguished at the route**: on a
  rejected settle gate, the route now checks
  `settlementEvidence.reason === 'ambiguous_settlement'` (the exact marker the
  prior turn's `normalizeSettlementSuccess` produces). Ambiguous leaves
  `lifecycle_stage` at `settlement_pending` (recoverable later, never
  auto-retried) instead of collapsing into the terminal `settlement_failed` a
  genuine provider rejection uses. Both are proven by dedicated route tests.
- **On confirmed success**: `recordSettledExternal` (`settlement_pending ->
  settled_external`), then `settled_external -> link_verified -> settled`,
  then the pre-existing `markConsumed` — reusing exactly the terminal
  semantics that already existed; `lifecycle_stage: 'settled'` remains the
  single definition of "payment complete," `consumed_at` remains the separate,
  pre-existing idempotency mechanism (`markConsumed`, `WHERE consumed_at IS
  NULL`) — no second competing definition introduced. CDP's `verified ->
  settled` two-hop path is completely unchanged (proven by the full,
  unmodified CDP regression suite passing — `x402-service-route.test.ts`,
  30/30).
- **Restart recovery, at the real replay entry point**
  (`attemptNeverminedRecovery` in `x402-service.ts`, invoked from the
  pre-existing `duplicate_same` branch, before `reconstructFromJob`/`202`):
  for the Nevermined rail with an optional, injected
  `neverminedReconciliationClient` (`X402ServiceRouteConfig.neverminedReconciliationClient`,
  threaded through `paid-services.ts`'s `PaidServicesConfig` too — omitted
  entirely, behavior is byte-identical to before this turn). On a
  `duplicate_same` retry against a payment stuck at `lifecycle_stage:
  'settlement_pending'`, reconciles externally **first** — before any
  re-verify/re-execute/re-settle — via
  `reconcileNeverminedSettlementForRecovery`
  (`packages/protocol-nevermined/src/settlement-recovery.ts`, new):
  independently validates the buyer-supplied delegation
  (`validateNeverminedDelegationConsistency` — provider/currency/plan/payer,
  only for fields the backend actually populates, matching the real sandbox
  data where `planId` was observed `null`) *before* ever trusting its
  transactions, so a real succeeded transaction on some unrelated delegation
  is never enough by itself. `SETTLED` → recovers the durable pre-settle draft
  from `x402_service_results`, rebuilds and verifies the real
  `PaymentServiceLink`, marks consumed, returns the identical `200` a normal
  synchronous success would have produced — **zero** additional
  verify/execute/settle calls. `NOT_SETTLED`/`AMBIGUOUS` → falls through to
  the pre-existing `202 processing` response, the row is left exactly where
  reconciliation found it; this turn does **not** implement the separate,
  explicitly-invoked retry path a `NOT_SETTLED` finding is supposed to
  eventually unlock (see gaps below).

### New route-level tests (`apps/edge-api/tests/nevermined-route-settlement-recovery.test.ts`, 8 tests)

All exercise the real `createX402ServiceRoute` production code path (never a
parallel implementation) with real D1/Miniflare (`resourcePersistencePath`)
and a fully controllable in-memory `PaymentEvidenceProvider`
(`providerKind: 'external'`, `trust_class: 'external_verified'`, so
`evidenceMode: 'production'`'s real gate evaluates it exactly as it would a
real facilitator) — no network, no credential, no `RUN_LIVE_NEVERMINED`
anywhere in the file.

1. `PAYMENT-DELEGATION-ID` required before any provider call.
2. Same Payment-Identifier + different delegationId → `duplicate_conflict`.
3. Normal success → `SETTLEMENT_PENDING` durably written before the real
   settle call, then `settled`/consumed.
4. Explicit provider failure → terminal `settlement_failed`, never consumed.
5. Ambiguous settlement → stays at `settlement_pending`, never
   `settlement_failed`, never auto-retried.
6. **Crash scenario A** (against the real D1-backed repository directly):
   `recordSettlementPending` on a row that never reached `executed` returns
   `illegal_transition` — the exact condition the route's `pending.status !==
   'transitioned'` guard relies on to keep `settle()` at zero calls.
7. **Crash scenario I**: `SETTLEMENT_PENDING` already committed by one route
   instance; "restart" (fresh route + fresh reconciliation client reporting
   `NOT_SETTLED`, same D1); the retry reconciles first and returns `202` with
   **zero** re-verify/re-execute/re-settle — the core anti-double-charge
   proof.
8. **Crash-after-provider-commit recovery**: full cross-process proof —
   `dispose()` one Miniflare instance, open a genuinely fresh one at the same
   `resourcePersistencePath`, a fresh route instance with a reconciliation
   client reporting `SETTLED` recovers to `200` with zero additional
   verify/execute/settle, a verified `PaymentServiceLink`, and `consumed_at`
   set — chained with an identical-replay proof (zero additional calls, same
   `link_id`) and a `duplicate_conflict`-after-recovered-consumption proof
   (mutated input, same Payment-Identifier, `409` before any provider call).

### Regression proof

Full, unmodified suites still pass: `x402-service-route.test.ts` (30/30, CDP
untouched), `nevermined-service-route.test.ts` (17/17, updated only to send
the new required header — behavior otherwise unchanged),
`nevermined-settlement-recovery.test.ts` (7/7, the standalone library proof
from the prior turn, unchanged design), `d1-payment-attempts.test.ts` (35/35,
extended with delegation-mismatch conflict + requires-delegation-id cases),
protocol-x402/protocol-nevermined package suites (581 + 151 tests). Targeted
gates: `nevermined:check`, `x402:check`, `control-plane:check` all exit 0.
Full `pnpm run check` (format, lint, typecheck, every test suite, migrations,
governance/state/tasks validation, contracts, secrets:scan) exits 0 with both
`RUN_LIVE_NEVERMINED` and `RUN_LIVE_X402` absent throughout.

### What is still not done (explicit gaps, not silently deferred)

- **`NOT_SETTLED` has no automatic follow-on retry.** Per the directive's own
  requirement ("only a separate, later, explicitly-invoked settlement path may
  ever retry"), a `NOT_SETTLED` recovery finding leaves the row at
  `settlement_pending` rather than auto-transitioning it to a distinct
  "retry-eligible" state or actually re-driving verify/execute/settle. That
  separate retry path is not built this turn.
- **The live test (`nevermined-live-exact.test.ts`) sends the new header but
  is not wired to a real `neverminedReconciliationClient`.** The prerequisite
  check in this turn proved a real raw-fetch client against the seller's
  `NVM_API_KEY` works; wiring an actual `NeverminedDelegationLookupClient`
  implementation into the live test (so the final live run can exercise real
  restart recovery, not just the mocked route tests above) is a small
  remaining step before that run.
- **No live Nevermined call of any kind was made in this turn** —
  `RUN_LIVE_NEVERMINED` stayed absent throughout, per the directive's own "no
  live payment in this turn" instruction. The prerequisite delegation-read
  check used real, already-existing sandbox delegations from the prior
  checkpoint's real settlements — read-only, no new mutation.
- SUN-0900B remains **not accepted**. The final fixed-PAYG live charge is a
  separate, subsequent, explicitly-authorized turn.
