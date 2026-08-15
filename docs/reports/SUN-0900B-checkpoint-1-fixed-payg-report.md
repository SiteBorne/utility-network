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
(`packages/protocol-x402/src/evidence/provider.ts`),
`NeverminedPaymentEvidenceProvider.verify()`/`settle()`
(`apps/edge-api/src/control-plane/evidence/nevermined-provider.ts`), and the
installed SDK's own `.d.ts` files
(`VerifyPermissionsResult`/`SettlePermissionsResult` in `facilitator-api.d.ts`,
`X402TokenAPI.getX402AccessToken` in `token.d.ts`) — confirmed none of them
carry a delegation reference the seller can read back.
`DelegationAPI.listDelegations`/ `getPurchasingPower` were also checked and
ruled out: they are scoped to "the requesting API key" (the **buyer's**
subscriber key), not the seller's facilitator key, and the seller's HTTP route
never sees the buyer's key.

**Prerequisite check (real, live, read-only).** Before committing to a wire
change, verified directly against the sandbox — using the **seller's**
`NVM_API_KEY` against both real delegations from the earlier checkpoint
(`aafdab51-...`, `6a4979a9-...`, created by the buyer's subscriber key) — that
the seller's own credential CAN read `GET /api/v1/delegation/{id}` and
`GET /api/v1/delegation/{id}/transactions` for a delegation it doesn't own: both
returned HTTP 200 with the expected shape. This closed the "seller credential
can't read anything at all" failure mode before it was designed around.

**Decision (explicit, user-directed):** add a `PAYMENT-DELEGATION-ID` header —
additive, Nevermined-only, never authorization evidence by itself — the buyer
discloses the same delegationId their access token is bound to.

### What was wired into the real route

- **`PAYMENT-DELEGATION-ID` header**
  (`packages/protocol-nevermined/src/delegation-header.ts`, new): parsed and
  structurally validated (bounded token shape) _before_ any provider call, on
  the Nevermined branch only. Missing/malformed →
  `400 malformed_payment_delegation_id`, zero verify/execute/settle calls (route
  test: "requires PAYMENT-DELEGATION-ID before any provider call").
- **Bound into the immutable v2 payment-attempt binding**
  (`packages/protocol-x402/src/replay/binding.ts`): `nevermined_delegation_id`
  is now a _required_ field of every new Nevermined v2 binding (validated by
  `validatePaymentAttemptBinding`, participates in the binding digest). A reused
  Payment-Identifier presented with a different delegationId is
  `duplicate_conflict`, before any provider call — proven at the route level.
  Persisted via the same `nevermined_delegation_id` D1 column migration 0006
  already added (dual role: written at acquire time as part of the binding, and
  again — redundantly, same value — by `recordSettlementPending`'s correlation
  write; no new migration needed).
- **`delegationId` threaded through the authorization context**
  (`packages/protocol-x402/src/evidence/provider.ts`'s
  `NeverminedPaymentAuthorizationContext`): available to `verify()`/`settle()`
  callers for correlation only — never sent to the facilitator, never
  authorization evidence by itself.
- **Durable pre-settle persistence, in the real route**
  (`apps/edge-api/src/control-plane/routes/x402-service.ts`): after execution
  succeeds, for the Nevermined rail, `lifecycle_stage` moves
  `verified -> executed`, the full executor output/receipt/verification-evidence
  is durably written to `x402_service_results` via a new `createPending` (before
  the real `settle()` call), and `recordSettlementPending` commits
  `executed -> settlement_pending` with the delegationId + correlation hashes —
  **all before `evidenceProvider.settle(...)` is ever called**. If that
  persistence write fails, the route returns `500 repository_failure` and
  `settle()` is never reached (route test: "normal success writes
  SETTLEMENT_PENDING durably before the real settle call" + the crash-A test
  below prove the sequencing both ways).
- **Ambiguous vs. explicit-failure, distinguished at the route**: on a rejected
  settle gate, the route now checks
  `settlementEvidence.reason === 'ambiguous_settlement'` (the exact marker the
  prior turn's `normalizeSettlementSuccess` produces). Ambiguous leaves
  `lifecycle_stage` at `settlement_pending` (recoverable later, never
  auto-retried) instead of collapsing into the terminal `settlement_failed` a
  genuine provider rejection uses. Both are proven by dedicated route tests.
- **On confirmed success**: `recordSettledExternal`
  (`settlement_pending -> settled_external`), then
  `settled_external -> link_verified -> settled`, then the pre-existing
  `markConsumed` — reusing exactly the terminal semantics that already existed;
  `lifecycle_stage: 'settled'` remains the single definition of "payment
  complete," `consumed_at` remains the separate, pre-existing idempotency
  mechanism (`markConsumed`, `WHERE consumed_at IS NULL`) — no second competing
  definition introduced. CDP's `verified -> settled` two-hop path is completely
  unchanged (proven by the full, unmodified CDP regression suite passing —
  `x402-service-route.test.ts`, 30/30).
- **Restart recovery, at the real replay entry point**
  (`attemptNeverminedRecovery` in `x402-service.ts`, invoked from the
  pre-existing `duplicate_same` branch, before `reconstructFromJob`/`202`): for
  the Nevermined rail with an optional, injected
  `neverminedReconciliationClient`
  (`X402ServiceRouteConfig.neverminedReconciliationClient`, threaded through
  `paid-services.ts`'s `PaidServicesConfig` too — omitted entirely, behavior is
  byte-identical to before this turn). On a `duplicate_same` retry against a
  payment stuck at `lifecycle_stage: 'settlement_pending'`, reconciles
  externally **first** — before any re-verify/re-execute/re-settle — via
  `reconcileNeverminedSettlementForRecovery`
  (`packages/protocol-nevermined/src/settlement-recovery.ts`, new):
  independently validates the buyer-supplied delegation
  (`validateNeverminedDelegationConsistency` — provider/currency/plan/payer,
  only for fields the backend actually populates, matching the real sandbox data
  where `planId` was observed `null`) _before_ ever trusting its transactions,
  so a real succeeded transaction on some unrelated delegation is never enough
  by itself. `SETTLED` → recovers the durable pre-settle draft from
  `x402_service_results`, rebuilds and verifies the real `PaymentServiceLink`,
  marks consumed, returns the identical `200` a normal synchronous success would
  have produced — **zero** additional verify/execute/settle calls.
  `NOT_SETTLED`/`AMBIGUOUS` → falls through to the pre-existing `202 processing`
  response, the row is left exactly where reconciliation found it; this turn
  does **not** implement the separate, explicitly-invoked retry path a
  `NOT_SETTLED` finding is supposed to eventually unlock (see gaps below).

### New route-level tests (`apps/edge-api/tests/nevermined-route-settlement-recovery.test.ts`, 8 tests)

All exercise the real `createX402ServiceRoute` production code path (never a
parallel implementation) with real D1/Miniflare (`resourcePersistencePath`) and
a fully controllable in-memory `PaymentEvidenceProvider`
(`providerKind: 'external'`, `trust_class: 'external_verified'`, so
`evidenceMode: 'production'`'s real gate evaluates it exactly as it would a real
facilitator) — no network, no credential, no `RUN_LIVE_NEVERMINED` anywhere in
the file.

1. `PAYMENT-DELEGATION-ID` required before any provider call.
2. Same Payment-Identifier + different delegationId → `duplicate_conflict`.
3. Normal success → `SETTLEMENT_PENDING` durably written before the real settle
   call, then `settled`/consumed.
4. Explicit provider failure → terminal `settlement_failed`, never consumed.
5. Ambiguous settlement → stays at `settlement_pending`, never
   `settlement_failed`, never auto-retried.
6. **Crash scenario A** (against the real D1-backed repository directly):
   `recordSettlementPending` on a row that never reached `executed` returns
   `illegal_transition` — the exact condition the route's
   `pending.status !== 'transitioned'` guard relies on to keep `settle()` at
   zero calls.
7. **Crash scenario I**: `SETTLEMENT_PENDING` already committed by one route
   instance; "restart" (fresh route + fresh reconciliation client reporting
   `NOT_SETTLED`, same D1); the retry reconciles first and returns `202` with
   **zero** re-verify/re-execute/re-settle — the core anti-double-charge proof.
8. **Crash-after-provider-commit recovery**: full cross-process proof —
   `dispose()` one Miniflare instance, open a genuinely fresh one at the same
   `resourcePersistencePath`, a fresh route instance with a reconciliation
   client reporting `SETTLED` recovers to `200` with zero additional
   verify/execute/settle, a verified `PaymentServiceLink`, and `consumed_at` set
   — chained with an identical-replay proof (zero additional calls, same
   `link_id`) and a `duplicate_conflict`-after-recovered-consumption proof
   (mutated input, same Payment-Identifier, `409` before any provider call).

### Regression proof

Full, unmodified suites still pass: `x402-service-route.test.ts` (30/30, CDP
untouched), `nevermined-service-route.test.ts` (17/17, updated only to send the
new required header — behavior otherwise unchanged),
`nevermined-settlement-recovery.test.ts` (7/7, the standalone library proof from
the prior turn, unchanged design), `d1-payment-attempts.test.ts` (35/35,
extended with delegation-mismatch conflict + requires-delegation-id cases),
protocol-x402/protocol-nevermined package suites (581 + 151 tests). Targeted
gates: `nevermined:check`, `x402:check`, `control-plane:check` all exit 0. Full
`pnpm run check` (format, lint, typecheck, every test suite, migrations,
governance/state/tasks validation, contracts, secrets:scan) exits 0 with both
`RUN_LIVE_NEVERMINED` and `RUN_LIVE_X402` absent throughout.

### What is still not done (explicit gaps, not silently deferred)

- **`NOT_SETTLED` has no automatic follow-on retry.** Per the directive's own
  requirement ("only a separate, later, explicitly-invoked settlement path may
  ever retry"), a `NOT_SETTLED` recovery finding leaves the row at
  `settlement_pending` rather than auto-transitioning it to a distinct
  "retry-eligible" state or actually re-driving verify/execute/settle. That
  separate retry path is not built this turn.
- **The live test (`nevermined-live-exact.test.ts`) sends the new header but is
  not wired to a real `neverminedReconciliationClient`.** The prerequisite check
  in this turn proved a real raw-fetch client against the seller's `NVM_API_KEY`
  works; wiring an actual `NeverminedDelegationLookupClient` implementation into
  the live test (so the final live run can exercise real restart recovery, not
  just the mocked route tests above) is a small remaining step before that run.
- **No live Nevermined call of any kind was made in this turn** —
  `RUN_LIVE_NEVERMINED` stayed absent throughout, per the directive's own "no
  live payment in this turn" instruction. The prerequisite delegation-read check
  used real, already-existing sandbox delegations from the prior checkpoint's
  real settlements — read-only, no new mutation.
- SUN-0900B remains **not accepted**. The final fixed-PAYG live charge is a
  separate, subsequent, explicitly-authorized turn.

## Final live-harness recovery wiring turn (this turn)

Froze commit `3bbf68f` unchanged — no redesign of the wire contract, D1
settlement states, recovery ordering, or the seller-readability question. Only
wired the live harness onto those accepted mechanisms.

**Real seller-credentialed reconciliation client, implemented**
(`apps/edge-api/src/control-plane/evidence/nevermined-reconciliation-client.ts`,
new): `NeverminedSandboxReconciliationClient`, authenticated with `NVM_API_KEY`
only (never `NVM_SUBSCRIBER_API_KEY`), sandbox-only, gated by the same
`evaluateNeverminedLiveGuard` construction-time pattern
`NeverminedPaymentEvidenceProvider.authenticated` already uses — so with
`RUN_LIVE_NEVERMINED` absent, construction throws immediately and no HTTP call
is structurally reachable. Implements exactly `NeverminedDelegationLookupClient`
(two GET operations — `listDelegationTransactions`, `getDelegation`) with no
mutating method anywhere on the class. A 404 and a 403 on `getDelegation` are
both normalized to `null`, identically, never distinguished — so no caller can
infer anything about a delegation it can't see. Wired into
`apps/edge-api/tests/live/nevermined-live-exact.test.ts`'s `beforeAll` (which
only ever executes when `RUN_LIVE_NEVERMINED==='1'`, via the file's existing
`describe.skipIf(!RUN_LIVE)`) and passed as `neverminedReconciliationClient`
into the real route mount.

**9 new adapter tests**
(`apps/edge-api/tests/nevermined-reconciliation-client.test.ts`): live-guard
construction denial (flag absent; wrong key environment), then `fetch` mocked at
the transport boundary only (never the reconciliation classifier, already proven
standalone) — proves exact request shape (`GET`, sandbox URL, seller bearer
token, `Nevermined-Version: 1.1`), 404/403 normalization, non-2xx surfaced as a
thrown error rather than a silently-empty result, malformed response bodies
rejected rather than guessed at, and that every real call this class can ever
make is `GET` — never a mutating method.

**3 new route-level tests** added to
`nevermined-route-settlement-recovery.test.ts` (now 11): a malformed (but
transport-legal) `PAYMENT-DELEGATION-ID` is rejected before any provider call; a
structurally valid but otherwise arbitrary delegationId does not itself grant
success (a forced explicit settle failure still rejects the payment — the header
is never itself authorization evidence); a CDP-rail request neither requires nor
references the header at all (the field only exists on the Nevermined branch).

**`PaymentServiceLink` delegation-binding decision (explicit, not
retrofitted):** the delegationId is **not** added as a new bound field on the
link itself. Reasoning: `payment_identifier` is already a link-bound field
(`packages/protocol-x402/src/linkage/payment-service-link.ts`), and the
immutable v2 binding already enforces a strict 1:1 relationship between a
Payment-Identifier and its delegationId — a different delegationId under the
same Payment-Identifier is `duplicate_conflict` _before_ any link is ever built,
so two different delegations can never produce a link under the same payment
identity in the first place. The existing, already-passing
`payment-service-link.test.ts` mutation-sensitivity coverage (every bound field,
including `payment_identifier`, changes `link_hash` when mutated) therefore
already covers the cross-delegation-reinterpretation case transitively — no new
PSL test was added since it would duplicate that existing, generic proof rather
than exercise anything new.

**Live persistence directory:** confirmed unchanged —
`$TMPDIR/siteborne-sun-0900b-checkpoint1-live-d1`, stable, never auto-deleted
(from the prior recovery-hardening commit).

**Startup recovery priority:** unchanged from the accepted design — the real
route's `duplicate_same` branch already calls `attemptNeverminedRecovery`
(external reconciliation) _before_ `reconstructFromJob`/the `202` fallback, and
_before_ any possibility of a new delegation/token/verify/execute/settle,
because a `duplicate_same` outcome is only ever reached for an _existing_
Payment-Identifier — a genuinely new payment never enters that branch at all. No
new code was needed for this: the ordering the directive asks for is exactly
what `3bbf68f` already built.

**Live test collection, confirmed:**
`pnpm exec vitest run apps/edge-api/tests/live/nevermined-live-exact.test.ts`
with `RUN_LIVE_NEVERMINED` unset → `1 test | 1 skipped`, zero network activity
(the guarded `beforeAll` body, including the new reconciliation client's
construction, never executes).

**Regression:** `nevermined:check`, `x402:check`, `mcp:check`, `a2a:check`,
`governance:validate`, `state:validate`, `tasks:validate` all exit 0. Full
`pnpm run check` (format, lint, typecheck, every test suite, migrations,
contracts, secrets:scan) exits 0 with both live flags absent throughout.

**Remaining, explicit gap, unchanged from the prior turn:** no automatic
`NOT_SETTLED` retry path exists — a `NOT_SETTLED` recovery finding still leaves
the row at `settlement_pending` rather than transitioning to a distinct
retry-eligible state, per the directive's own "only a separate, later,
explicitly-invoked settlement path may ever retry" requirement.

**Final-live-run readiness (self-assessed against this turn's own precondition
list):** registration existing/reuse-only, zero mutation on resume; seller
reconciliation client wired; delegation header wired and bound into the
immutable binding; durable D1 write-before-settle proven; cross-process crash
recovery proven (route-level, mocked evidence provider); PaymentServiceLink
recovery proven (route-level); identical-replay and `duplicate_conflict` proven
(both pre- and post-recovery); CDP regression unaffected; historical v1 digests
unchanged; live persistence path stable; `production_enabled`/`production_ready`
both `false`. SUN-0900B remains **not accepted**. **Exactly one final fixed-PAYG
live run is assessed as safe to execute** in a separate, subsequent,
explicitly-authorized turn — this turn made zero live Nevermined calls.

## Final fixed-PAYG live acceptance attempt — a THIRD real settlement, again falsely rejected locally

**Outcome: not accepted.** The authorized live run executed for real against the
sandbox and produced a **third real, confirmed external settlement**
(`transactionCount: 1`, `status: "succeeded"`, real
`providerTransactionId: 0x8fec56c49ee6e85a30105d308fd7b1788c9866f8d3780395c8e0f5e549cfd0f2`),
but was **again** locally rejected before reaching `200`/`consumed` —
`{"error":"settlement_rejected","message":"settlement_not_successful"}`, HTTP
`402`. Per the directive's own crash rule, **the live test was not rerun**; all
work below is read-only reconciliation of durable D1 + external Nevermined
state.

**What happened, in order (all real, all confirmed):**

1. Registration reconciled as `existing` (0 mutation) — agent/plan/linkage/
   economics all matched.
2. Balance recheck (read-only Base Sepolia RPC): payer
   `0xCa7DD940B5071Bbcb238901794B900CF9db376E7` held `19,982,000` atomic USDC
   (≈19.98 USDC, comfortably above the required `9000`) and `0` wei native ETH
   (unremarkable for an ERC-4337 smart account using a paymaster — the same
   account completed two prior real settlements under the same condition).
3. Delegation reconciliation (subscriber key, `listDelegations`) found **zero**
   currently accessible delegations — only the two known historical exhausted
   ones — classified `no_match`, matching the live test's own internal
   reconciliation log line
   `delegation reconciliation (sanitized): { state: 'no_match' }`.
4. The live test created exactly one new delegation
   (`eaa3929b-7619-45d4-a858-0d91e47fa55e`), obtained an ephemeral x402 token
   (never logged, never persisted), and drove the real route:
   `verifyPermissions` → `external_verified` → one real service execution
   (`web_context_verified.v1`, fixture-mode adapters) → `SETTLEMENT_PENDING`
   durably persisted (confirmed in D1,
   `settlement_pending_at: 2026-08-12T13:48:59.420Z`) → real `settlePermissions`
   call.
5. The local settlement gate rejected the result with reason
   `settlement_not_successful` — **not** `ambiguous_settlement` — so the row
   correctly, deterministically transitioned
   `settlement_pending → settlement_failed` (the terminal,
   non-recoverable-via-`202` path this turn's design intends for a genuine
   rejection) rather than staying recoverable. Job state: `REFUND_REQUIRED`.
   `consumed_at`: never set.

**Independent, read-only external reconciliation (seller `NVM_API_KEY`,
`GET /api/v1/delegation/{id}` and `.../transactions`) proves the rejection was
false:**

```
delegation eaa3929b-7619-45d4-a858-0d91e47fa55e
  status: Exhausted
  spendingLimitCents: "1"      (matches the expected $0.01 rounded cap for a $0.009 price)
  amountSpentCents: "1"
  transactionCount: 1
  providerPaymentMethodId: 0xCa7DD940B5071Bbcb238901794B900CF9db376E7  (matches expected payer)

transaction 0fac89e8-d202-4132-9417-6b5cc5c29405
  status: succeeded
  providerTransactionId: 0x8fec56c49ee6e85a30105d308fd7b1788c9866f8d3780395c8e0f5e549cfd0f2
  amountCents: "1"
  createdAt: 2026-08-12T13:49:03.097Z
```

Exactly one transaction, `succeeded`, matching delegation/payer/amount — by this
checkpoint's own reconciliation classifier
(`reconcileNeverminedSettlementForRecovery`), this is unambiguously
**`SETTLED`**, not `AMBIGUOUS`. `duplicate_transaction_count` is 1, not >1; the
historical `AMBIGUOUS_PENDING_RECONCILIATION` framing from the first two
incidents does **not** apply here — this one is cleanly, positively confirmed
settled externally, and just as cleanly rejected locally.

**Root-cause hypothesis (not yet confirmed by raw-evidence inspection — the
sanitization design deliberately never persists the raw
`SettlePermissionsResult` anywhere, so this can't be confirmed without a future
live capture under explicit authorization):**
`NeverminedPaymentEvidenceProvider.settle()`'s `transactionValid` check
(`/^0x[0-9a-fA-F]{64}$/.test(result.transaction)`) validates the **synchronous**
`settlePermissions()` HTTP response's `transaction` field — but the SDK's own
type comment documents `transaction` as "empty string if settlement failed",
implying the field may also be empty/unpopulated for a settlement that is still
pending **asynchronous** on-chain confirmation at the moment the HTTP call
returns. The timing is consistent with this: `settlement_pending_at`
(`13:48:59.420Z`) precedes the transaction's own `createdAt` (`13:49:03.097Z`)
by **~3.7 seconds** — a plausible on-chain confirmation delay. If
`result.transaction` was empty/malformed at synchronous-response time,
`transactionValid` is `false`, `success: validation.valid && transactionValid`
becomes `false`, and the reason is `transaction_reference_invalid` — which the
route's ambiguous-vs-explicit- failure branch (added this turn) currently treats
as a **non-ambiguous**, terminal explicit failure, since only the literal string
`'ambiguous_settlement'` is special-cased. This is a plausible, narrow, distinct
defect from the two already-fixed incidents (which were about `.success` being
absent) — a **different** field, in a **different** part of the response,
causing the **same class** of false-rejection. Not fixed in this turn — no code
change was made after the live run, per the "reconcile first, do not blindly
repair and retry" discipline this checkpoint has followed throughout.

**Classification:** `PAID_EXTERNAL_NOT_CONSUMED_LOCAL` /
`LOCAL_ARTIFACTS_UNRECOVERABLE` (durable D1 artifacts for this attempt — output,
receipt, verification evidence — remain intact and reconstructible, but the
route's own terminal `settlement_failed` state does not offer an automatic
recovery path the way `settlement_pending` does; recovering this specific
payment into a served `200` would require either a new, explicitly- authorized
code change to how `transaction_reference_invalid` is classified, or a
manual/administrative decision, neither of which this turn performed). This is
now a **third** occurrence of the same failure family as the first two
historical incidents (`aafdab51-...`, `6a4979a9-...`) — real money (sandbox test
USDC, $0.01 rounded, negligible/no real value) moved for real, three times, and
SITEBORNE's own local validator has now been wrong on the first attempt three
times running, twice already fixed, once newly discovered.

**Not done, deliberately, per the directive's own crash rule:** no second live
run; no attempt to force this payment to `consumed`; no code change proposed or
applied to `transaction_reference_invalid` handling. `RUN_LIVE_NEVERMINED`
confirmed cleared (`MISSING`) immediately after the run, in this shell and in
every persistent location checked (`~/.zshenv`,
`~/.config/siteborne/ nevermined-sandbox.env` — present but contains only
`NVM_ENVIRONMENT=sandbox`, no live flag; not modified by this turn).
**Checkpoint 1B fixed-PAYG live acceptance is not granted.** SUN-0900B remains
active, not accepted. No code change was made this turn — the only change is
this report update, recording the durable D1 state and the external Nevermined
sandbox state captured above; both remain the authoritative record of this
attempt.

## Recovery-defect repair turn: the classification fix is correct and proven — the real third payment's local artifacts were lost before it could be applied

**Root cause, confirmed precisely.**
`NeverminedPaymentEvidenceProvider.settle()`
(`apps/edge-api/src/control-plane/evidence/nevermined-provider.ts`) validates
the synchronous `settlePermissions()` response's `transaction` field against
`/^0x[0-9a-fA-F]{64}$/`. When that check fails on an otherwise
`normalizeSettlementSuccess`-positive response, it returns
`success: false, reason: 'transaction_reference_invalid'` — a real, distinct
code path from the already-fixed `.success`-absent case. The route's own
ambiguous-vs-explicit- failure branch (added in `3bbf68f`, this same checkpoint)
only special-cased the literal string `'ambiguous_settlement'`, so
`'transaction_reference_invalid'` fell through to the terminal
`settlement_failed` transition — exactly what the third live run's D1 row
showed. This is fully consistent with the timing evidence:
`settlement_pending_at` (`13:48:59.420Z`) preceded the real transaction's own
`createdAt` (`13:49:03.097Z`) by ~3.7 seconds, consistent with an async on-chain
confirmation the synchronous HTTP response didn't yet reflect.

**The fix (`apps/edge-api/src/control-plane/routes/x402-service.ts`).** Replaced
the narrow `reason === 'ambiguous_settlement'` check with the rule the third
incident actually demands: once `evidenceProvider.settle(...)` has been invoked,
**only**
`settleGate.reason === 'settlement_not_successful' && settlementEvidence.reason === 'provider_rejected'`
(Nevermined itself returning `result.success === false`) may transition the row
to the terminal `settlement_failed`. Every other rejection reached after the
real call — `ambiguous_settlement`, `transaction_reference_invalid`,
`provider_exception`, a verification-hash mismatch, a structural-validation
failure discovered only at this late gate — is AMBIGUOUS: `lifecycle_stage`
stays at `settlement_pending`, recoverable only through read-only external
reconciliation, never auto-retried. Scoped entirely to the Nevermined rail's
branch of this one route; CDP's unrelated `verified -> settlement_failed` path
is untouched (full CDP suite: 30/30, unmodified).

**Historical `settlement_failed -> settled_external` recovery edge.** A row
already stuck at `settlement_failed` from before this fix existed can still be
recovered — narrowly. `packages/protocol-x402/src/lifecycle/stage.ts` gained one
additive edge, `settlement_failed: ['settled_external']`, documented explicitly
as reachable only through the one evidence-gated caller that ever presents it,
never a general "retry a failed payment" capability. `attemptNeverminedRecovery`
(`x402-service.ts`) now also accepts `lifecycleStage === 'settlement_failed'` as
an eligible entry (previously `settlement_pending` only), gated behind the exact
same requirements: `settlement_pending_at` present, `nevermined_delegation_id`
present, a durable pending draft in `x402_service_results`, and — critically —
the same independently-verified, delegation-consistency-checked `SETTLED`
external reconciliation the normal path requires. `recordSettledExternal`'s CAS
now accepts an explicit, narrowed `fromStages` list (defaulting to
`['settlement_pending']` for every existing caller — zero behavior change
anywhere else) so the recovery caller can pass exactly the one stage it
independently observed the row at, never a blanket allowance.

**Known, accepted, narrow inconsistency:** a row recovered from
`settlement_failed` does _not_ advance its underlying `Job`'s state from
`REFUND_REQUIRED` to `DELIVERED` — the frozen, already-accepted `JobState`
machine (SUN-0200) has no such edge, and adding one was deliberately judged out
of scope for this narrow repair. `payment_attempts.lifecycle_stage` /
`consumed_at` / the recovered `PaymentServiceLink` remain the authoritative
record of "was this payment ultimately settled"; the `Job` record separately,
correctly continues to reflect "a refund was initiated" as a historical fact.
One direct consequence, also discovered and accepted rather than papered over:
**an HTTP replay after this specific kind of recovery cannot reconstruct the
original `200` body** — `reconstructFromJob` requires
`job.current_state === 'DELIVERED'`, which this recovery path never reaches.
Replay is therefore classified `REPLAY_BLOCKED_BY_JOB_STATE_DEPENDENCY`, not
`REPLAY_AVAILABLE_WITH_EXISTING_SAFE_CONTEXT` — but the safety property that
matters still holds: a replay attempt correctly returns `409 already_consumed`
with **zero** additional verify/execute/settle calls, never a re-execution and
never a fabricated/wrong result. `duplicate_conflict` (mutated binding, same
Payment-Identifier) after recovery works exactly as normal — proven, `409`, zero
provider calls, before any provider call. A row recovered from
`settlement_pending` (the normal, non-historical path) is unaffected by any of
this and keeps its full identical-replay behavior exactly as `a1fe444` proved.

**14 tests added/extended**
(`apps/edge-api/tests/nevermined-route-settlement-recovery.test.ts`, 11 → 14;
`packages/protocol-x402/src/lifecycle/stage.test.ts`, +10): a dedicated
`transaction_reference_invalid` case proving it now stays at
`settlement_pending` (never terminal); a full reproduction of the exact
third-incident shape — a row forced to `settlement_failed` (the one place in the
suite that ever takes that edge directly, explicitly to stand in for the
historical pre-fix state) then recovered via `duplicate_same` + a fake
reconciliation client reporting the real transaction's exact shape, reaching
`200`/`consumed` with zero new verify/execute/settle, followed by the
replay/`duplicate_conflict`-after-recovery proofs above; a negative control
proving a _genuine_ explicit-failure row (`reason: 'provider_rejected'`) is
never recoverable this way even with a reconciliation client configured, because
its real delegation never has a succeeded transaction to reconcile against.
`stage.test.ts` gained a dedicated suite proving the new edge is legal, that it
is the _only_ outgoing edge from `settlement_failed`, and that every other
historically-terminal transition remains illegal.

**The real third payment (`pay_254c35be168b489ca5085aef528903fb`) could not
actually be recovered — its local durable state is gone.** Before applying the
fix to the real row, its D1 file
(`$TMPDIR/siteborne-sun-0900b-checkpoint1-live-d1/d1/...sqlite`) was re-located
to confirm it — the directory no longer exists. Two real days passed in this
environment between the live run and this repair turn (the live run logged
`2026-08-12T13:48:59Z`; this turn's host timestamps read `Aug 14`), and the OS's
own temp-directory lifecycle (this path lives under `$TMPDIR`, i.e.
`/var/folders/.../T/`, which macOS periodically reclaims) is the most likely
explanation — nothing in this repository's own code deleted it; the stable-path
design (`c48ff5d`) only ever promised the path stays constant and is never
_auto-deleted by SITEBORNE itself_, not that the host OS won't eventually
reclaim `/tmp`-class storage. Independently reconfirmed, read-only, that the
**external** Nevermined-side evidence is completely unaffected and still exactly
as before:
`GET /api/v1/delegation/eaa3929b-7619-45d4-a858-0d91e47fa55e/transactions` still
returns the same single `succeeded` transaction
(`0x8fec56c49ee6e85a30105d308fd7b1788c9866f8d3780395c8e0f5e549cfd0f2`) — only
SITEBORNE's own local D1 artifacts (the job, the durable pending draft with
output/receipt/hashes, the payment_attempts row itself) are gone, and with them,
the ability to rebuild the exact `PaymentServiceLink` and serve a real `200` for
this specific payment. **Reclassified: `PAID_EXTERNAL_NOT_CONSUMED_LOCAL` /
`LOCAL_ARTIFACTS_UNRECOVERABLE`** — joining the first two historical incidents,
for a different underlying reason (environmental data loss of the recovery
substrate, not absence of a recovery mechanism).

**Production-hardening note (out of scope for this sandbox self-test, worth
recording):** storing the sole durable recovery substrate for a real payment
under a user-scoped OS temp directory is fragile against exactly this failure
mode. A production deployment would need durable state in infrastructure the
operator controls the retention of (a real D1/database binding, not a local
Miniflare `resourcePersistencePath`) — not a defect in this checkpoint's design
(which never claimed OS-temp permanence), but a real, now-materialized risk
worth carrying forward.

**Full regression:** `nevermined:check`, `x402:check`, `mcp:check`, `a2a:check`,
`governance:validate`, `state:validate`, `tasks:validate`, `secrets:scan` all
exit 0. Full `pnpm run check` (format, lint, typecheck, every suite, migrations,
contracts) run in the background this turn — see the commit's own validation
record. Both `RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402` absent throughout; the one
live network activity this turn was a read-only `GET` reconfirming the
still-real external transaction, using the seller's own credential, zero
mutation.

**Outcome: the classification defect is fixed and proven correct against a
faithful reproduction of the exact real incident. Checkpoint 1B fixed-PAYG live
acceptance is still not granted** — the one real payment this repair was meant
to close cannot actually be closed, because its local recovery substrate no
longer exists. Per the directive's own explicit instruction, **no fourth live
payment was made or attempted this turn.** SUN-0900B remains active, not
accepted. Production remains false. The next live run, whenever authorized, now
runs against a fix that is proven correct — this specific failure mode (a
transaction-reference validation gap treated as terminal rather than ambiguous)
should not recur.

## Final credential-free hardening turn: persistent live storage + replay reconstruction repair

Froze `829354f` unchanged (explicit-vs-ambiguous classification, seller-side
reconciliation, `PAYMENT-DELEGATION-ID` binding, `SETTLEMENT_PENDING` ordering,
recovery eligibility rules, CDP semantics) — this turn only adds two
independent, credential-free repairs.

### A. Persistent live D1 storage, outside any OS-temporary root

**Corrected claim.** The prior report stated macOS's tmp-cleanup as the cause of
the third payment's lost local state. That was plausible, not proven. The proven
conclusion, recorded now instead:
`TEMPORARY_STORAGE_INSUFFICIENT_FOR_MULTI_DAY_PAYMENT_RECOVERY` — the location
was under `$TMPDIR`, it is gone, and no further claim about _why_ is made.

**New resolver** (`apps/edge-api/src/control-plane/live-persistence-path.ts`):
`resolveLivePersistencePath` — explicit `SITEBORNE_LIVE_D1_DIR` override, else
`$HOME/.local/share/siteborne/live-d1/sun-0900b-checkpoint1`.
`validateLivePersistencePath` (pure, no filesystem access) rejects: any path
inside a known OS-temp root (`/tmp`, `/var/tmp`, `os.tmpdir()`, `$TMPDIR`),
inside the repository checkout, containing a `node_modules` path segment, `/`
itself, `$HOME` itself, or empty — checked with separator-terminated prefix
comparison so `/tmpfoo` is correctly NOT treated as inside `/tmp`.
`resolveLivePersistencePath` throws `UnsafeLivePersistencePathError` immediately
at call time — before any live external mutation is reachable — never falling
back to a default silently. `ensureLivePersistenceDirectory` creates the
directory (`mkdirSync recursive`) and best-effort restricts it to `0700`. The
resolved path is never secret, never enters any payment hash, PCC, receipt, or
`PaymentServiceLink` — purely operational.

**Wired into the live harness**
(`apps/edge-api/tests/live/nevermined-live-exact.test.ts`): replaced the
`$TMPDIR`-based path with `resolveLivePersistencePath` +
`ensureLivePersistenceDirectory`, called first in `beforeAll` — before
`Payments.getInstance`, before any registration/delegation reconciliation. Logs
the resolved path (safe, no secret) and a sanitized startup count of unfinished
attempts (`settlement_pending`/`settled_external`/`link_verified`) grouped by
stage — counts only, never credential/token contents. Retention policy unchanged
from the prior design: never auto-deleted by this file; an operator recovers a
failed run by rerunning the identical command, or forces a fresh checkpoint DB
by deleting the resolved directory manually.

**16 new unit tests** (`apps/edge-api/tests/live-persistence-path.test.ts`): the
default path accepted; a safe explicit override accepted; every unsafe-path
class rejected (`/tmp/...`, `os.tmpdir()`-based, `/var/tmp/...`, inside the repo
checkout, inside `node_modules` — both under the repo and elsewhere, `/`,
`$HOME` itself, empty); the `/tmpfoo`-is-not-`/tmp` false-positive guard; the
override path throws immediately rather than silently falling back; the resolved
value never contains anything credential-shaped.

### B. `REPLAY_BLOCKED_BY_JOB_STATE_DEPENDENCY` — root-caused and fixed

**Root cause.** `reconstructFromJob` (`x402-service.ts`) required
`job.current_state === 'DELIVERED'` unconditionally. That's correct for a
`duplicate_same` retry (the payment isn't yet known to be consumed, so `Job`
state is the only signal something actually finished) — but the
`already_consumed` branch calls the same helper, and by the time that branch is
reached, `acquirePaymentAttempt`'s own `consumed` check (backed by
`payment_attempts.consumed_at IS NOT NULL`) has ALREADY authoritatively
established the payment is done, independently of `Job` state. A payment
recovered via `attemptNeverminedRecovery`'s
`settlement_failed -> settled_external` edge (`829354f`) is marked consumed but
its `Job` deliberately stays at `REFUND_REQUIRED` forever (no
`REFUND_REQUIRED -> DELIVERED` edge in the frozen JobState machine) — so the
unconditional `DELIVERED` check made an already-paid, already-consumed,
already-linked payment permanently unreplayable. That mismatch between the
payment- idempotency authority (`payment_attempts.consumed_at`) and the
job-execution authority (`Job.current_state`) — two related but not
interchangeable concepts — was the entire defect.

**The fix.** `reconstructFromJob` now takes `{ requireDelivered: boolean }`
(default `true`, preserving the exact prior behavior everywhere it isn't
explicitly overridden). The `already_consumed` branch now calls it with
`{ requireDelivered: false }` — the caller there already independently knows the
payment is consumed, so job state is no longer a gate. The `duplicate_same`
branch is unchanged (`requireDelivered: true` — a payment not yet known to be
consumed still requires `Job.current_state === 'DELIVERED'` before
reconstructing, exactly as before). A second, unrelated safety fix landed
alongside it: `reconstructFromJob` now explicitly rejects a cached
`x402_service_results` row shaped like the pre-settle
`PendingNeverminedSettlementDraft`
(`kind === 'nevermined_settlement_pending_draft'`) rather than risking it being
misinterpreted as a finalized `CachedResult` in the narrow window between
`markConsumed` and `results.finalize`.

**Proof — 2 new/updated tests**
(`apps/edge-api/tests/nevermined-route-settlement-recovery.test.ts`, now 16):
the existing historical-recovery test's replay step, which previously asserted
the (now-understood-to-be-wrong) `409`, now asserts the correct `200` with the
identical `link_id` and zero additional verify/execute/settle. A new, dedicated
**process-restart replay** test (the directive's own hard acceptance gate):
complete a payment through the **normal**, non-crash path to `settled`/consumed,
fully `dispose()` the Miniflare instance, open a genuinely fresh one at the same
`resourcePersistencePath`, issue the byte-identical request against a fresh
route/app instance — `200`, same `link_id`, zero additional
verify/execute/settle. Recovery-path replay and normal-path replay now converge
on the exact same semantics, as required.

**Unaffected, unchanged:** `duplicate_conflict` (mutated binding, same
Payment-Identifier) still fires before any provider call regardless of which
replay path a payment took to reach `consumed` — proven by the existing,
untouched conflict tests continuing to pass. CDP's replay behavior is completely
unchanged (`x402-service-route.test.ts`, 30/30, unmodified) — CDP never enters
the `settlement_pending`/`settlement_failed` intermediate states this fix
concerns, so its `duplicate_same`/`already_consumed` paths were never affected
by the original defect.

### Regression

`nevermined:check`, `x402:check`, `mcp:check`, `a2a:check`,
`governance:validate`, `state:validate`, `tasks:validate`, `secrets:scan` all
exit 0. Full `pnpm run check` (format, lint, typecheck, every suite, migrations,
contracts) run this turn — see the commit's own validation record.
`RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402` absent throughout; zero live Nevermined
calls of any kind this turn (no read-only reconfirmation was even needed this
time, since no new claim about the real third payment's external state was
made).

### Outcome

Both pre-live blockers identified after the third-payment repair turn are now
closed: live D1 state has a durable, non-OS-temporary home with an explicit
safety guard, and an already-consumed payment (whether reached via the normal
happy path or via evidence-gated historical recovery) now correctly reconstructs
its original `200` on replay, with zero additional provider or execution calls.
**SUN-0900B remains active, not accepted — no fourth live payment was made or
attempted this turn**, per the directive's explicit instruction. All three
historical real sandbox settlements remain distinct, documentary-only records:

1. Externally settled, local artifacts unrecoverable (original validator defect,
   fixed in `9d9e102`, but too late to recover payment #1 itself).
2. Externally settled, local artifacts unrecoverable (same defect, same fix, too
   late for payment #2).
3. Externally settled, local artifacts unrecoverable for a different reason —
   the classification defect this repaired (`829354f`) would have recovered it,
   but its local D1 state was gone by the time the fix existed.

The next live run, whenever authorized, is the first to run against every fix
this checkpoint's incidents have produced: correct explicit-vs-ambiguous
settlement classification, durable non-temporary storage, and correct
already-consumed replay reconstruction.

## Payment #4 attempt — new external failure, zero mutation, not accepted

**Outcome: the live run failed before any payment lifecycle began. No
Payment-Identifier was ever acquired; the persistent live D1 directory itself
worked correctly (real proof of the new storage design) but simply has nothing
to recover, because nothing was ever created.**

**Pre-flight (all real, all confirmed, zero mutation):** registration reconciled
`existing` — agent/plan linkage, PAYG, non-trial, `scheme=nvm:erc4337`,
`network=84532`, economics matching exactly (`8910+90=9000`, correct receivers,
correct token) via a direct read of `payments.plans.getPlan`. Payer balance
`19,973,000` atomic USDC (≫ the required `9000`). Persistent live D1 resolved to
`/Users/meta4ickal/.local/share/siteborne/live-d1/sun-0900b-checkpoint1` —
confirmed empty and freshly created (`0700`, first use of this location, zero
prior attempts, zero unfinished/recoverable state by construction). Delegation
reconciliation: zero currently accessible delegations
(`listDelegations({ accessible: true })` → `[]`) — only the three known
historical exhausted ones exist — classified `no_match`, independently confirmed
before the live command and again by the live test's own internal reconciliation
log.

**The failure.** The live test's own delegation-creation step
(`subscriber.delegation.createDelegation({ provider: 'erc4337', ... })`) failed
with `PaymentsError: Failed to create delegation (HTTP 412)`. This happened
entirely inside the test's `beforeAll`, before the `it()` block that drives the
actual PAYMENT-SIGNATURE/D1-acquire/verify/execute/settle HTTP flow ever ran —
so no Payment-Identifier, no `payment_attempts` row, no `Job`, nothing
payment-shaped was ever created locally.

**Correction:** one mutating request (`POST createDelegation`) was genuinely
attempted — the server rejected it before creating anything.
`MUTATION_REQUEST_ATTEMPTED=true`, `SUCCESSFUL_EXTERNAL_MUTATION=0`,
`PAYMENT_LIFECYCLE_STARTED=false`, `REAL_SETTLEMENTS_THIS_ATTEMPT=0`. "Zero
external mutation" (as originally written below) undersold this — the correct
statement is **zero successful external mutation**.

**Confirmed, read-only, that zero successful external mutation occurred:**
`listDelegations({})` immediately afterward still shows exactly the same three
historical delegations (`aafdab51-...`, `6a4979a9-...`, `eaa3929b-...`) — no
fourth delegation exists. `listPaymentMethods`/`getPurchasingPower` confirm the
erc4337 wallet payment method is still `Active`, `totalRemainingBudgetCents: 0`
(no active delegation, consistent with the create having genuinely failed rather
than silently succeeding). The persistent D1 database itself was inspected
directly: `payment_attempts` and `jobs` are both empty (`0` rows); `services` is
correctly seeded (proof migrations + seeding ran successfully against the new
persistent path). This is not a `PAID_EXTERNAL_NOT_CONSUMED_LOCAL` incident like
#1-#3 — there is nothing local to be inconsistent with, because there is nothing
external to reconcile against either. It is a clean, safe, pre-mutation external
API rejection.

**Root cause: not yet diagnosed.** `HTTP 412 Precondition Failed` on
`createDelegation` is a new failure mode, distinct from all three prior
incidents (which all occurred at or after `settlePermissions`, not at delegation
creation). The SDK's own error surfacing includes a `hint` field when the
backend supplies one; none was present here, so the specific failed precondition
is not yet known from this attempt alone. Candidate causes not yet ruled in or
out: a sandbox-side policy change (e.g. a cap on distinct delegations per
wallet, now at 3 exhausted + this attempt), a transient backend issue, a changed
required field/shape in the `createDelegation` payload versus what `1.10.0`
sends, or an unrelated sandbox outage. Diagnosing this further requires either a
Nevermined-side status/support check or a subsequent, separately-authorized live
attempt with response-body capture added — not performed in this turn, per the
explicit "no blind rerun" instruction.

**Per the directive's explicit rule, the live command was not run a second time
this turn.** `RUN_LIVE_NEVERMINED` confirmed cleared (`MISSING`) immediately
after, in this shell and in every persistent location checked (`~/.zshenv`
absent; `~/.config/siteborne/nevermined-sandbox.env` present but unmodified,
contains only `NVM_ENVIRONMENT=sandbox`). Full regression (`nevermined:check`,
`x402:check`, `mcp:check`, `a2a:check`, `governance:validate`, `state:validate`,
`tasks:validate`, `secrets:scan`, full `pnpm check`) all exit 0 with both live
flags absent.

**Checkpoint 1B fixed-PAYG live acceptance is not granted this turn.** Zero new
real settlements were made. SUN-0900B remains active, not accepted. Production
remains false. All three historical incidents (#1-#3) remain exactly as
previously classified, distinct from this attempt. The persistent live D1
location and the replay-reconstruction fix from `cfe3614` remain unexercised by
a real payment lifecycle — this attempt never reached far enough to test either
— so their validity against a real run is still only proven by the
credential-free reproduction tests, not yet by a live payment. The next attempt,
whenever separately authorized, should capture the raw `createDelegation`
response body/status detail before deciding whether a retry, a payload change,
or an operator-side Nevermined check is needed.

## HTTP 412 precondition diagnosis (read-only/local inspection only)

**No `createDelegation` call, no new delegation, no token, no verify, no service
execution, no settlement, no paid HTTP request was made this turn.**
`RUN_LIVE_NEVERMINED` was never set. Everything below is inspection of
already-existing local evidence, the installed SDK's source, read-only
Nevermined GET-shaped calls (`listPaymentMethods`, `getPurchasingPower`,
`listDelegations`), and Nevermined's own public documentation.

**Original 412 response body: `ORIGINAL_412_BODY_NOT_RETAINED`.** The captured
log records only `PaymentsError: Failed to create delegation (HTTP 412)` — the
SDK's own generic default message, not a server-supplied one.

**Installed SDK's non-2xx handling** (`@nevermined-io/payments@1.10.0`'s
`DelegationAPI.fetchJSON`, read directly): on a non-2xx response, it attempts
`response.json()`; if that succeeds AND the body has a `.message` field, that
replaces the generic default; if it has a `.code` field, that becomes
`PaymentsError.code` (a real, accessible property — `this.code = code` in the
`PaymentsError` constructor); if it has `.hint`, that's appended to the message
text. `retryable`/`category`/`correlationId` — fields Nevermined's current
public error catalogue documents as optional envelope fields — are **not**
extracted by this SDK version at all; even a fully-conformant server response
would lose those three at this layer, unconditionally, for every caller.

**Signal from what WAS captured:** the message stayed the generic default
(`"Failed to create delegation"`), not a substituted server message. Per the
SDK's own logic, that only happens when `response.json()` either throws
(non-JSON or empty body) or succeeds with no `.message` field. This is a
genuine, evidentiary reason **not** to treat the legal-consent hypothesis as
confirmed from this log alone: had the server returned Nevermined's documented
`BCK.LEGAL_DOCS.0004` envelope
(`{code, message: "Legal consent is required for the current document versions", hint: "..."}`
— confirmed verbatim from Nevermined's own current public docs,
`nevermined.ai/docs/development-guide/api-errors/codes`), the SDK would very
likely have surfaced that exact message text in the log, and it didn't. It does
**not** rule the hypothesis out either — an intermediate proxy/gateway 412, a
non-JSON error page, or a differently-shaped body would produce the same generic
default regardless of the true underlying cause.

**Credential role check:** confirmed correct.
`apps/edge-api/tests/live/nevermined-live-exact.test.ts` calls
`subscriber.delegation.createDelegation(...)`, where
`subscriber = Payments.getInstance({ nvmApiKey: process.env.NVM_SUBSCRIBER_API_KEY! })`
— never the builder credential (`NVM_API_KEY`). No
`SITEBORNE_ROLE_WIRING_DEFECT`.

**Request-shape comparison against Nevermined's current documented contract**
(`nevermined.ai/docs/api-reference/delegation/create-delegation`): SITEBORNE
sent exactly
`{ provider: 'erc4337', spendingLimitCents: 1, durationSecs: 3600, currency: 'usdc', planId }`
— every field the current docs list as required (`provider`,
`spendingLimitCents`, `durationSecs`, `currency`) plus the documented-optional
`planId` (bind to the authoritative plan). `providerPaymentMethodId` was
correctly omitted (docs: "ignored for erc4337"). Nothing sent falls outside the
current contract — no `REQUEST_CONTRACT_DEFECT` found. This also weighs against
the two documented 400-class delegation-validation codes (`BCK.DELEGATION.0004`
"required input missing", `BCK.DELEGATION.0003` "unknown provider") — both
require a malformed request, which this wasn't, and both are HTTP 400, not 412,
anyway.

**Read-only wallet/purchasing-power reconfirmation (unchanged from the attempt
itself):** `listPaymentMethods({ accessible: true })` still shows exactly one
entry, the erc4337 smart-account wallet, `status: "Active"`.
`getPurchasingPower()` shows `delegations: []`, `totalRemainingBudgetCents: 0`.
`listDelegations({})` still shows exactly the same 3 historical delegations,
`totalResults: 3` — no fourth. No credential-capability restriction is evident
from what's readable here (an OAuth-scope restriction, if present, isn't
distinguishable from this API surface without attempting the mutation again,
which this turn does not do).

**Final primary classification: `F. UNKNOWN_412_BODY_NOT_RETAINED`.** The
legal-consent hypothesis (`BCK.LEGAL_DOCS.0004`) remains
`LEGAL_CONSENT_PLAUSIBLE_NOT_PROVEN` — plausible (412 is the only documented
Nevermined-catalogue code at that status, and it's exactly the kind of
account-level precondition an otherwise-correct, previously-working request
could newly trip), but not confirmed, and the one piece of local evidence
available (the un-substituted generic message) argues mildly against a clean
JSON match rather than for it. `SITEBORNE_ROLE_WIRING_DEFECT` and
`REQUEST_CONTRACT_DEFECT` are both ruled out by direct inspection.

**No SITEBORNE code defect identified.** No operator action is prescribed by
this turn's evidence with certainty — the legal-consent-acceptance step the
operator described (signing into the Nevermined sandbox UI as the subscriber
account and accepting current legal documents) is a reasonable and low-risk
thing to do before the next attempt regardless of whether it turns out to be the
actual cause, since it is not a SITEBORNE-side action and cannot make anything
worse; whether it was in fact the cause will only be provable retroactively (the
next attempt succeeding, or — if the diagnostic hardening below is exercised —
the next attempt's captured `error.code` reading `BCK.LEGAL_DOCS.0004`
explicitly).

**Diagnostic-observability hardening (implemented, credential-safe,
deterministic):** `apps/edge-api/tests/live/nevermined-live-exact.test.ts`'s
`createDelegation` call is now wrapped in a `try/catch` that logs `error.code`
and `error.message` (both Nevermined's own public error-catalogue values,
confirmed never secret) via
`console.error('SUN-0900B live createDelegation failure (sanitized):', { code, message })`
before rethrowing — never touching credentials, authorization headers, tokens,
or JWTs. A future failed attempt at this exact call site will no longer be
`ORIGINAL_412_BODY_NOT_RETAINED`. No new dedicated unit test was added (the
change is a diagnostic log statement inside the credential-gated live test
itself, not independently unit-testable logic); typecheck and the live test's
own collect-and-skip-with-flag-absent behavior were both verified unchanged.

**Regression (code changed — diagnostic logging only):** `nevermined:check`,
`x402:check`, `secrets:scan`, full `pnpm check` all exit 0.

**Outcome: still not accepted.** `LEGAL_CONSENT_CONFIRMED` was not reached —
only `LEGAL_CONSENT_PLAUSIBLE_NOT_PROVEN`. No code fix was applied (none was
warranted — no defect was found). No live retry occurred. SUN-0900B remains
active, not accepted. Production remains false. Recommended next step, unchanged
from the operator's own plan: sign into Nevermined as the subscriber account and
personally accept current legal documents, then authorize exactly one more live
attempt (now with the diagnostic capture in place) behind a fresh read-only
preflight.

## Payment #5 attempt — causal retry after human legal-document acceptance: a new, unrelated local defect, not the 412 hypothesis test

**The human operator personally accepted current Nevermined legal documents
before this attempt** (per the authorizing directive). This attempt did **not**
test the legal-consent hypothesis — it failed for a completely different, purely
local reason, before reaching `createDelegation` (or even registration
reconciliation) at all.

**Pre-flight (all real, all confirmed, zero mutation):** persistent D1 at
`$HOME/.local/share/siteborne/live-d1/sun-0900b-checkpoint1` inspected directly
— `payment_attempts: 0` rows (unchanged from payment #4's attempt, confirming
nothing was left unfinished). Registration reconciled (`agent.registry.plans`
linkage, plan economics/metadata unchanged). Payer balance `19,973,000` atomic
USDC. Delegation reconciliation: `no_match` (zero accessible delegations),
confirmed independently before the live command.

**The failure.** The live command failed inside `beforeAll`, before registration
reconciliation's own log line even printed:

```
Error: D1_EXEC_ERROR: Error in line 1: ALTER TABLE payment_attempts ADD COLUMN
lifecycle_stage TEXT NOT NULL DEFAULT 'acquired': duplicate column name:
lifecycle_stage: SQLITE_ERROR
```

**Root cause, confirmed:** `runMigrations` (this live test's own local copy of a
pattern duplicated across ~9 test files in this repository) blindly re-executes
every statement from every `migrations/*.sql` file on every invocation, with no
migration-tracking mechanism. Every other copy of this helper is safe because
every other caller always opens a **fresh**, ephemeral D1 (a new random tempdir,
or in-memory) — migrations only ever run once per database's lifetime there.
This live test is the **one** caller that opens a genuinely **persistent**,
deliberately-reused D1 (`resolveLivePersistencePath`, `cfe3614`) — and
payment-attempt #4's own migration run had already fully applied the schema to
this exact directory. This second real invocation re-ran the same
`ALTER TABLE payment_attempts ADD COLUMN lifecycle_stage ...` statement
(migration 0003) against a database that already has that column — SQLite's
`ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` form (unlike this repository's
`CREATE TABLE`/ `CREATE INDEX` statements, which already guard themselves), so
it threw. This is a real, newly-discovered gap that the persistent-storage
design introduced by definitionally succeeding at its own job — the DB really
did survive from #4 to #5, and the naive migration runner had never been
exercised against a database that was already migrated.

**Confirmed zero external mutation, zero external read even:** no
registration-reconciliation or delegation-reconciliation log line ever printed —
the failure occurred before any Nevermined API call of any kind was attempted.
`RUN_LIVE_NEVERMINED` cleared immediately after.

**Fix (credential-free, local-only, no live call involved):** `runMigrations` in
`nevermined-live-exact.test.ts` now catches exactly
`duplicate column name`/`already exists`-shaped errors per statement and
continues — a real, different schema error still throws and fails the run.
**Verified empirically**, without touching the real persistent live directory: a
throwaway Miniflare instance at a disposable temp path ran the full migration
set three times in a row (fresh, reopened-and-rerun, reopened-and-rerun-again) —
all three passes succeeded, reproducing and resolving the exact real failure. No
dedicated permanent unit test was added (the fix lives inside the
credential-gated live test's own test-local helper, mirroring the existing
un-tested-in-isolation pattern every other copy of this helper already has in
this repository); typecheck and the live test's own
collect-and-skip-with-flag-absent behavior were both reverified unchanged.

**Per the absolute "no second fresh live attempt this turn" rule, the live
command was not rerun after this fix**, even though the fix is complete and
verified. The causal test of the legal-consent hypothesis remains **not yet
performed** — payment-attempt #5 never reached `createDelegation` at all, so it
provides no evidence either way about `BCK.LEGAL_DOCS.0004`.

**Full regression (code changed):** `nevermined:check`, `x402:check`,
`mcp:check`, `a2a:check`, `governance:validate`, `state:validate`,
`tasks:validate`, `secrets:scan`, full `pnpm check` — all exit 0.

**Outcome: Checkpoint 1B still not accepted.** Zero new real settlements.
`LEGAL_CONSENT_HYPOTHESIS_SUPPORTED_BY_BEHAVIORAL_CHANGE` does not apply —
delegation creation was never reached this attempt, so no behavioral change was
observed at all. SUN-0900B remains active. Production remains false. The
persistent-storage design is now proven robust against the exact failure mode a
second real reuse exposed. The next attempt, whenever separately authorized, is
the first one positioned to actually test the legal-consent hypothesis: local
defect fixed, persistent D1 confirmed empty and ready, diagnostic error capture
in place from the prior turn.

## Migration-safety upgrade (`b893555`) and the post-legal-consent causal retry: real settlement #4 (unconsumed, recoverable) — a genuine milestone with one newly-surfaced gap

**Terminology, corrected per operator direction throughout this section:** the
project has three confirmed real historical Nevermined settlements (#1–#3, all
`PAID_EXTERNAL_NOT_CONSUMED_LOCAL`). The live-harness invocations that never
reached `createDelegation` (the `423073b` and `e855a1a` attempts) were
`LIVE_TEST_INVOCATION`s with `PAYMENT_LIFECYCLE_STARTED=false` and
`createDelegation calls=0` — never counted as payments. This section's live
invocation is the first successful `createDelegation` since, and produces **real
settlement #4**.

### Migration-safety audit (before any live call)

`e855a1a`'s fix was audited against this turn's own requirement and found to be
**model C (broad error-message suppression)** — forbidden. Replaced in `b893555`
with genuine schema introspection: `columnExists` reads the database's own real
state via `PRAGMA table_info(<table>)` before deciding whether to run an
`ALTER TABLE ... ADD COLUMN` statement (the one statement shape SQLite has no
native `IF NOT EXISTS` form for); every other statement runs completely
unconditionally, with zero error suppression anywhere. Proven with both required
controls: two positive controls (fresh migration; a real Miniflare
dispose+reopen cycle, twice, against the same persistent path — the exact
scenario that failed before) both pass; two negative controls (a migration
referencing a nonexistent table; a migration mixing one correctly-skipped
already-applied statement with one genuinely broken one) both correctly throw.
**Broad-error- suppression present: no.**

### The live retry

Pre-flight (all real, all confirmed, zero mutation): persistent D1 inspected
directly — `payment_attempts: 0` rows. Registration reconciled unchanged. Payer
balance `19,973,000` atomic USDC. Delegation reconciliation: `no_match`,
confirmed independently.

**`createDelegation` succeeded** — no `HTTP 412`. This is real, observed
behavioral change after the human operator's legal-document acceptance.
Classified **`LEGAL_CONSENT_HYPOTHESIS_SUPPORTED_BY_BEHAVIORAL_CHANGE`** — not
rewritten as proof the original 412 body was `BCK.LEGAL_DOCS.0004` (it was never
recovered), but the removal of the one account-level prerequisite the operator
identified, followed immediately by success on the very next attempt, is real
supporting evidence.

New delegation: `f2c64337-3bb7-4109-a99a-bb3642addffb`. Real `verifyPermissions`
succeeded (`external_verified`). Real service execution ran exactly once.
`SETTLEMENT_PENDING` was durably persisted
(`settlement_pending_at: 2026-08-15T04:34:08.854Z`) before the real
`settlePermissions` call. That call was made exactly once. The local gate again
returned
`{"error":"settlement_rejected","message": "settlement_not_successful"}`, HTTP
`402` — but this time, **`829354f`'s repair worked exactly as designed**:
independently confirmed in D1,
`payment_attempts.lifecycle_stage = 'settlement_pending'` (never the terminal
`settlement_failed`) — the false-rejection-family defect no longer misclassifies
an ambiguous post-settle response as definitive failure.

**Independent, read-only external reconciliation (seller `NVM_API_KEY`) proves
this was a real, clean, matching settlement:**

```
delegation f2c64337-3bb7-4109-a99a-bb3642addffb
  status: Exhausted, spendingLimitCents: "1", transactionCount: 1
  providerPaymentMethodId: 0xCa7DD940B5071Bbcb238901794B900CF9db376E7 (expected payer)

transaction 700573f9-66fe-459d-a356-07f60bee8d70
  status: succeeded
  providerTransactionId: 0x847a6da0a6a63f1f12838bbe9269b8fd9798997b0680b0146b7147fcb715f417
  amountCents: "1"
  createdAt: 2026-08-15T04:34:11.972Z
```

Exactly one transaction, `succeeded`, matching delegation/payer — by this
checkpoint's own classifier, unambiguously `SETTLED`. **Real settlement #4,
confirmed.**

### The newly-surfaced gap: no "resume a specific pending payment" entry point in the live harness itself

Per the turn's absolute no-second-live-command rule, the live command was
**not** rerun. On reflection this also revealed something worth recording
honestly rather than assumed away:
`apps/edge-api/tests/live/ nevermined-live-exact.test.ts`, as currently written,
has no mechanism to resume a _specific_ prior Payment-Identifier/delegation. Its
`beforeAll` always re-reconciles delegations (excluding the now-`Exhausted`
`f2c64337-...` from `accessible: true`, exactly like all four prior delegations)
and its `it()` block always mints a brand-new `Payment-Identifier` via
`generateSiteborneePaymentId()`. A bare re- invocation of this exact test file
would not retry `pay_7858b2f7de124dce98395a973eed2208` — it would create a
**fifth** distinct delegation and attempt a **fifth** distinct payment, leaving
real settlement #4 exactly where it is: `SETTLED` externally, durably
`settlement_pending` locally, fully evidenced, not yet consumed. The
`attemptNeverminedRecovery` mechanism this checkpoint built (`3bbf68f`, proven
correct in `829354f`'s route-level reproduction tests) is real and correct — but
reaching it for _this specific_ payment requires either a small, purpose-built
resume path in the live harness, or a separate one-off recovery invocation
against the persistent D1 using the known `Payment-Identifier`/delegation —
neither of which this turn performed, since doing so was outside this turn's
specific one-attempt authorization.

### Regression, live-flag cleanup

`RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402` confirmed `MISSING` immediately after, in
this shell and every persistent location checked. No code changed as a result of
this specific live attempt (the migration-safety fix that made it possible was
committed separately, before the attempt). `nevermined:check`, `x402:check`,
`mcp:check`, `a2a:check`, `governance:validate`, `state:validate`,
`tasks:validate`, `secrets:scan`, full `pnpm check` — all exit 0.

### Outcome

**Checkpoint 1B still not accepted** — real settlement #4 exists, externally
confirmed, but is not yet locally consumed, so it cannot yet serve as the
accepted fixed-PAYG lifecycle evidence (which requires
`SETTLED_EXTERNAL → PaymentServiceLink → consumed`, not merely `SETTLED`
externally with a durable, safely-recoverable local record). Real settlements
#1–#3 remain `PAID_EXTERNAL_NOT_CONSUMED_LOCAL`/
`LOCAL_ARTIFACTS_UNRECOVERABLE`. Real settlement #4 is **not**
`LOCAL_ARTIFACTS_UNRECOVERABLE` — its local artifacts (job, durable pending
draft with output/receipt/hashes, delegation correlation) are fully intact in
the persistent D1
(`$HOME/.local/share/siteborne/live-d1/ sun-0900b-checkpoint1`) and remain
recoverable in principle; only the _mechanism to reach that recovery for this
specific identifier_ is missing from the live harness today. SUN-0900B remains
active. Production remains false. No new fresh live payment is needed to close
Checkpoint 1B — the next step is building the narrow resume path (or running a
one-off, credential-free-until-the-actual-reconciliation-call recovery script)
for real settlement #4 specifically, not authorizing a fifth external mutation.
