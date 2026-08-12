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
successes. That validator defect, and a separate D1 cross-process persistence
defect it exposed, are both fixed and regression-tested below. Full crash-
recovery state-machine hardening (durable `SETTLEMENT_PENDING` state, external-
settlement reconciliation before allowing a retry) is **not yet implemented** —
see "What remains before another live run" below.

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

## What remains before another live run

This checkpoint fixes the two defects that caused the false rejections and the
unrecoverable local state. It does **not** yet implement the durable
`SETTLEMENT_PENDING` → `SETTLED_EXTERNAL` → `CONSUMED` payment state machine
requested for full crash-recovery hardening (write settlement-correlation data
before calling `settlePermissions`, reconcile against external transaction
records on resume, never re-settle when external evidence already proves
`SETTLED`). Building that correctly is a real, separate undertaking touching
`x402-service.ts`'s route lifecycle itself, not just the Nevermined validator/
persistence layer, and doing it hastily in the same pass as the two fixes above
risked under-testing something whose entire purpose is financial correctness.
Recommended as the next concrete step before authorizing another live charge.

## What was not done in this checkpoint (1B repair turn)

No delegation was created. No x402 access token was obtained. No
`verifyPermissions` or `settlePermissions` call was made. No paid service
execution occurred. `RUN_LIVE_NEVERMINED` was not set during this repair turn.
SUN-0900B is not accepted.
