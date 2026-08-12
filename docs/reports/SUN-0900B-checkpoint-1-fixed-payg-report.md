# SUN-0900B Checkpoint 1 — controlled sandbox self-test, partial state

## Classification

`controlled_sandbox_self_test`. `independent_customer=false`, `revenue=false`,
`open_market_purchase=false`, `production_ready=false`,
`production_enabled=false`. This is a SITEBORNE-operator-controlled transaction
against the Nevermined **sandbox**, never mainnet, never an unknown external
buyer.

## Outcome so far

Registration for exactly one service (`web_context_verified.v1`, `exact` scheme)
is committed and independently reconciled read-only against the live Nevermined
sandbox. Delegation, x402 authorization, verification, service execution, and
settlement have **not** been started.

```
funding                    PASS  (20 USDC on the subscriber smart account,
                                   independently verified via a public
                                   Base Sepolia RPC eth_call)
registration                COMMITTED
registration sync           eventual_consistency_confirmed
delegation                  NOT STARTED
authorization (x402 token)  NOT STARTED
verification                NOT STARTED
service execution           NOT STARTED
settlement                  NOT STARTED
replay proof                NOT STARTED
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

## What was not done in this checkpoint

No delegation was created. No x402 access token was obtained. No
`verifyPermissions` or `settlePermissions` call was made. No paid service
execution occurred. `RUN_LIVE_NEVERMINED` was not set during this repair turn.
SUN-0900B is not accepted.
