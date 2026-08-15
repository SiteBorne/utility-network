# SUN-0900B Checkpoint 2A — Dynamic Document Capability + Registration

`controlled_sandbox_self_test`: independent_customer=false, revenue=false,
open_market_purchase=false, production_ready=false, production_enabled=false.

Fixed-PAYG Checkpoint 1B is **ACCEPTED** at `021c280`
(`feat(nevermined): recover fixed payg sandbox settlement`). This report does
not reopen it; see
[SUN-0900B-checkpoint-1-fixed-payg-report.md](./SUN-0900B-checkpoint-1-fixed-payg-report.md)
for that evidence. One purely mechanical `prettier --write` pass was applied to
that file this turn (markdown prose-wrap reflow only, zero content change) so
`pnpm check` stays green — not a reopening of its findings or acceptance.

This turn performed **no live Nevermined payment-flow operation** —
`RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402` were `MISSING` throughout, and no
`createDelegation`/x402 token/`verifyPermissions`/service execution/
`settlePermissions` call for the document service was made. One read-only,
GET-only Nevermined API call was made (registration discovery, §14) using the
builder `NVM_API_KEY`.

## 1. Baseline

`HEAD=021c280`, tree clean at start. `RUN_LIVE_NEVERMINED=MISSING`,
`RUN_LIVE_X402=MISSING`. `NVM_API_KEY`/`NVM_SUBSCRIBER_API_KEY` present (values
never printed), `NVM_ENVIRONMENT=sandbox`. Pre-check suite (`nevermined:check`,
`x402:check`, `state:validate`, `tasks:validate`, `governance:validate`,
`secrets:scan`) all exit 0.

## 2. Target dynamic economics (frozen)

```
service:               document_evidence_json.v1
maximum_authorized_atomic: 190000   (registry maximum_price, $0.19)
actual_usage_atomic (fixture): 12000   (registry base_price, $0.012)
required_final_settlement_atomic: 12000
```

`settlement_atomic === actual_usage_atomic`, always — there is no third,
independently-settable value. `maximum_authorized_atomic` protects provider
capacity only; it is never the amount charged. The unused 178000 atomic is never
charged in the 12000 fixture case.

## 3. Dynamic SDK mechanism — installed `@nevermined-io/payments@1.10.0`

Read directly from the installed package's own type declarations and
implementation (never inferred from names alone):

- **`VerifyPermissionsParams.maxAmount?: bigint`** —
  `dist/x402/facilitator-api.d.ts`: "Maximum credits to verify (optional)". This
  is the authorization **ceiling**, checked at verify time.
- **`SettlePermissionsParams.maxAmount?: bigint`** — same file: "Number of
  credits to burn (optional)". This is the **actual amount charged** at settle
  time — a distinct, separately-supplied value, not derived from the verify-time
  ceiling.
- `SettlePermissionsParams.marginPercent?: number` — an alternative,
  percentage-based dynamic-pricing mode, "mutually exclusive with maxAmount when
  agentRequestId provided." Not used by SITEBORNE's model; SITEBORNE supplies an
  exact atomic `maxAmount` (the measured actual usage) at settle time instead.
- **`PlanCreditsConfig.isRedemptionAmountFixed: boolean`** —
  `dist/common/types.d.ts`: "Whether the redemption amount is fixed (true) or
  dynamic (false)." `PlanCreditsConfig` also carries `amount` (credits granted
  on purchase), `minAmount`/`maxAmount` (redemption bounds per use).
- **`getPayAsYouGoCreditsConfig()`** (`dist/plans.js`, the exact helper
  `apps/edge-api/tests/live/nevermined-live-exact.test.ts` already calls for the
  accepted Checkpoint 1A/1B registration) returns, verbatim:
  ```js
  {
    isRedemptionAmountFixed: false,
    redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
    onchainMirror: false,
    durationSecs: 0n,
    amount: 1n,
    minAmount: 1n,
    maxAmount: 1n,
  }
  ```
  with the doc comment "Credits are not minted upfront; these values are
  required for validation only." **This means the plan/credits configuration
  already used for the accepted, real, four-times-settled fixed-PAYG
  registration is structurally `isRedemptionAmountFixed: false` — dynamic by the
  SDK's own default, not something Checkpoint 2A would be introducing for the
  first time.** The actual atomic amount enforced per request is controlled
  entirely at request time via
  `verifyPermissions({maxAmount})`/`settlePermissions({maxAmount})`, both
  already wired generically (scheme-agnostic) in
  `apps/edge-api/src/control-plane/evidence/nevermined-provider.ts`
  (`OfficialNeverminedSdkAdapter.settlePermissions` already passes
  `maxAmount: BigInt(input.actualAmount)`, never the authorized maximum).
- **`getPayAsYouGoPriceConfig(amount, receiver, tokenAddress)`** — "Builds a
  Pay-As-You-Go price configuration"; `PlanPriceConfig.amounts: bigint[]` is
  documented as "The amounts to be paid for the plan." This is the price a
  subscriber pays to **acquire/fund** the plan's credit balance — a separate
  concept from the per-request settle ceiling. The existing Checkpoint 1
  registration passed `AMOUNT = '9000'` here, matching that service's single
  fixed price exactly. **What value this field should carry for a plan whose
  per-request settle amount is meant to vary between 12000 and 190000 is not
  resolved by static inspection alone** — see §6.

## 4. Capability classification

**`DYNAMIC_PAYG_REQUIRES_CONTROLLED_SANDBOX_PROOF`** (unchanged from the prior
accepted classification; not upgraded to `DYNAMIC_PAYG_CONFIRMED_SUPPORTED`).

This turn found strong, direct, primary-source evidence (§3) that the SDK's type
surface and its own official registration helper already model dynamic,
ceiling-vs-actual redemption, and that SITEBORNE's existing code already calls
`settlePermissions` with the measured actual amount, not the ceiling. That is
real, new, positive evidence — but it remains evidence "from static types" (the
SDK's own documentation and default helper output, not an executed live call).
No live call has ever exercised `settle(actual) < verify(max)` against the real
sandbox backend — real settlement #1–#4 were all exact-scheme,
`actual === maximum`. Per this turn's own directive, that gap keeps the
classification at `REQUIRES_CONTROLLED_SANDBOX_PROOF` rather than
`CONFIRMED_SUPPORTED`.

## 5. Economic model representation

- **Maximum authorization**: `payment_attempts.amount` (existing column,
  unmodified) — for `upto` scheme this already holds the authorized ceiling
  (190000), exactly as it does today for `document_evidence_json.v1` under CDP.
- **Actual usage**: `x402_service_results.result_json.actual_amount` — already
  present, written by `x402-service.ts`
  (`nevermined_settlement_pending_draft.actual_amount`) **before** any settle
  call, from the deterministic local
  `calculateDocumentUsage`/`documentUsageToAtomicUnits` calculation
  (`packages/pricing/src/document-usage.ts`), never from the provider.
- **Settlement amount**: identically `actual_amount` — there is no separate
  third value; `NeverminedSettlePermissionsInput.actualAmount` (already typed in
  `packages/protocol-nevermined/src/client.ts`) is passed straight through to
  the SDK's settle-time `maxAmount`.

## 6. D1 schema audit (§10)

**No new migration is needed.** The additive schema built for Checkpoint 1B's
settlement-recovery hardening (`migrations/0006_settlement_recovery.sql`) plus
the pre-existing durable draft shape in `x402_service_results` already
distinguish, additively, without overloading fixed PAYG:

- `payment_attempts.amount` — authorized maximum (upto) / exact amount (exact);
  unchanged since migration 0002.
- `x402_service_results.result_json`
  (`kind: 'nevermined_settlement_pending_ draft'`) — carries both
  `authorized_maximum` and `actual_amount` as separate string fields
  (`apps/edge-api/src/control-plane/routes/x402-service.ts` lines ~199-202),
  written durably at `SETTLEMENT_PENDING` time, **before** `settlePermissions`
  is ever called (line ~1075 builds the draft; the live settle call happens
  after).

For `exact`-scheme fixed PAYG these two fields naturally converge
(`authorized_maximum === actual_amount`, as observed on all four real
settlements to date); the schema does not need — and does not have — a
scheme-conditional branch to keep that unambiguous.

## 7. Settlement ordering (§11) — already frozen, unchanged this turn

`x402-service.ts`'s existing order (unmodified, generic across schemes): D1
acquire → verify (ceiling) → execute exactly once → calculate actual usage
(`upto` only) → persist output/PCC/receipt/`UsageResult` draft
(`SETTLEMENT_PENDING`, `actual_amount` durable) → **only then** call
`settlePermissions(actualAmount)`. Verified by the new test in §9 below, which
shows the durable draft already exists with `actual_amount: '12000'` even when
the subsequent settle call is rejected.

## 8. Recovery semantics (§12)

Reuses the accepted Checkpoint 1B architecture unmodified — `x402-service.ts`'s
`attemptNeverminedRecovery` and
`packages/protocol-x402/src/lifecycle/ stage.ts`'s
`settlement_pending`/`settlement_failed → settled_external` edges are
scheme-agnostic; they read `draft.actual_amount` from the durable row and never
recompute it. This was exercised for a real `exact`-scheme payment in Checkpoint
1B's recovery (`021c280`); this turn added a credential-free test (§9) proving
the same durability-before-settle property holds for the `upto`/dynamic document
case specifically.

## 9. Credential-free dynamic acceptance matrix (§20)

| Item | Requirement                                                                                     | Status                                                                               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | max 190000 / actual 12000 → settle 12000                                                        | ✅ existing + reinforced                                                             | `apps/edge-api/tests/nevermined-service-route.test.ts` "authorizes document maximum 190000 but calculates and settles actual usage 12000"; `packages/pricing/src/document-usage.test.ts` new single-native-page test                                                                                                                                                                                                                                                                  |
| B    | max 190000 / actual 19000 → settle 19000                                                        | ✅ new                                                                               | `document-usage.test.ts`: single OCR page → exactly `19000`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| C    | max 190000 / actual 29000 → settle 29000                                                        | ✅ new                                                                               | `document-usage.test.ts`: single table page → exactly `29000`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D    | actual >190000 → fail before settlement                                                         | ✅ existing (scheme-generic)                                                         | `UsageExceedsAuthorizationError` (`packages/protocol-x402/src/linkage/usage-result.ts`); `usage-result.test.ts`; `x402-service-route.test.ts` "authorization_exceeded" test; `document-usage.test.ts` "caps measured usage at the canonical maximum"                                                                                                                                                                                                                                  |
| E    | actual missing → fail before settlement                                                         | ✅ existing (scheme-generic)                                                         | `x402-service.ts` line ~976-985 throws `upto executor did not report actualAmountAtomic`, unconditionally for any `upto` service including document                                                                                                                                                                                                                                                                                                                                   |
| F    | tampered UsageResult → fail before settlement                                                   | ✅ by architecture, not a signature check                                            | `actual_amount` is never externally supplied at settle time — it is read from the durable value the trusted local process wrote at execution time, never recomputed or accepted from an external party. `usage-result.test.ts`'s parametrized hash-mutation test proves any field change (including `actual_amount`) changes `usage_result_hash`, so a mutated durable row is cryptographically detectable via the `PaymentServiceLink` chain (§10 of the checkpoint-1 report family) |
| G    | crash after actual persisted, before settle → resume same 12000                                 | ✅ new                                                                               | New test in `nevermined-service-route.test.ts` (§ below): durable draft carries `actual_amount: '12000'` even when the subsequent settle call is rejected — proving a resume reads this value, never recomputes                                                                                                                                                                                                                                                                       |
| H    | external settle succeeds, then process dies → recovery does not re-execute/recalculate/resettle | ✅ existing architecture (scheme-agnostic), proven live for `exact` in Checkpoint 1B | `attemptNeverminedRecovery`/`reconstructFromJob` never call the executor or settle again; real settlement #4's recovery (`021c280`) is the live proof of this mechanism, applicable unmodified to `upto`                                                                                                                                                                                                                                                                              |
| I    | replay after consumed → zero new provider/work calls                                            | ✅ existing                                                                          | "reconstructs replay from D1 with no second verify, settle, job, or result"                                                                                                                                                                                                                                                                                                                                                                                                           |
| J    | changed immutable dynamic binding → `duplicate_conflict`                                        | ✅ existing (scheme-generic)                                                         | "same Payment-Identifier with changed input is a conflict and leaks no prior result"; `x402-service-route.test.ts`'s `replay_conflict` test                                                                                                                                                                                                                                                                                                                                           |
| K    | CDP fixed/exact/upto unchanged                                                                  | ✅                                                                                   | Full `x402-service-route.test.ts` (149 tests) unmodified and passing                                                                                                                                                                                                                                                                                                                                                                                                                  |

New tests added this turn (all credential-free, zero network, zero
`RUN_LIVE_*`):

- `packages/pricing/src/document-usage.test.ts`: three new tests — single
  native/OCR/table page → exactly 12000/19000/29000 atomic.
- `apps/edge-api/tests/nevermined-service-route.test.ts`: one new test —
  "dynamic `actual_amount` (12000) is durably persisted BEFORE
  `settlePermissions` is called, and survives a rejected/ambiguous settle
  unchanged — never recomputed" (items G/H), asserting directly against the
  `x402_service_results.result_json` row.

## 10. PaymentServiceLink (§21)

No version bump. The existing v2 `PaymentServiceLink`
(`packages/protocol-x402/ src/linkage/payment-service-link.ts`) already carries
`usage_result_hash` as part of its hashed binding payload, distinct from
`verification_evidence_hash`/`settlement_evidence_hash`. Combined with the
durable draft's separate `authorized_maximum`/`actual_amount` fields (§6), it is
already structurally impossible for the accepted chain to claim "authorized
190000, settled 12000" while the durable `UsageResult` says something else — the
link hash would not match. No structural change was required or made.

## 11. Document Nevermined agent/plan discovery (§14)

Read-only, GET-only, builder `NVM_API_KEY`, no `RUN_LIVE_NEVERMINED` (same
precedent as Checkpoint 1B's recovery-only reconciliation — genuinely read-only
calls are not gated behind the live-payment-flow flag).

```
Total plans found: 1
- 94523930722525068656272128894334430057768353189467518442660086462546695282012 | Verified Web Context — PAYG plan
Total agents found: 1
- 37714377069519076502259354421538507339628407587207707299869594618861814144272 | Verified Web Context
```

Both entries are the already-known, already-accepted Checkpoint 1A/1B
`web_context_verified.v1` registration. **No `document_evidence_json.v1` agent
or plan exists.** Classification: **`NO_MATCH`** (unambiguous — one total plan,
one total agent, both accounted for).

## 12. Registration capability gate (§15) and decision (§16)

The plan-config **redemption** side is positively established as dynamic
(`isRedemptionAmountFixed: false`, §3) — no ambiguity there. The remaining open
question is the plan's **price/funding** configuration
(`getPayAsYouGoPriceConfig`'s `amount`): whether it should be registered at the
190000 ceiling, at a nominal/base value, or via some other documented structure,
without implying to a real subscriber that they will always be charged that
registered amount. Static inspection of the installed SDK does not resolve this
by itself (the type/doc comments describe the field as "the amounts to be paid
for the plan" generically, not specifically for a ceiling-vs-actual dynamic
model) and no authoritative confirmation of the correct value was obtained this
turn.

Registering a real agent/plan is an external, hard-to-reverse mutation with a
real economic-misrepresentation risk explicitly called out by this turn's own
directive (§15: "Do not register a fixed 190000 plan if that would cause
customers to actually pay 190000 for the 12000 fixture... Do not encode 12000 as
the universal price if the service legitimately needs a 190000 authorization
ceiling"). Given that risk and the unresolved question:

**`registration_allowed = false`** this turn. No agent or plan was created. This
is consistent with keeping the capability classification at
`DYNAMIC_PAYG_REQUIRES_CONTROLLED_SANDBOX_PROOF` rather than upgrading it from
static evidence alone.

## 13. Live-harness readiness (§19) — prepared, not executed, not yet buildable end-to-end

No agent/plan ID exists yet for the document offering (§12), so a full,
executable live-harness test file (mirroring
`apps/edge-api/tests/live/ nevermined-live-exact.test.ts`) cannot yet be
meaningfully parameterized — writing one now would either hardcode a plan ID
that doesn't exist or silently reintroduce the registration question this report
just deferred. Prepared instead:

- **Persistent path convention** (decided, not yet created): a distinct
  checkpoint subdirectory,
  `$HOME/.local/share/siteborne/live-d1/ sun-0900b-document-dynamic`, never OS
  temp storage — same pattern as `resolveLivePersistencePath`'s existing
  fixed-PAYG default, kept separate to avoid state collision with the accepted
  Checkpoint 1B D1.
- **Required flow** (documented, to be implemented once registration is
  resolved): one bounded delegation → max authorization 190000 → one document
  execution → actual usage 12000 → one settlement for 12000 → PSL → consumed →
  replay → `duplicate_conflict` — the exact shape already proven
  scheme-generically in `nevermined-live-exact.test.ts` and
  `nevermined-service-route.test.ts`, applied to the dynamic case.
- **Explicitly not built this turn**: the live-gated test file itself, and no
  live call of any kind was made beyond the read-only discovery in §11.

## 14. Regression

`nevermined:check`, `x402:check`, `mcp:check`, `a2a:check`,
`governance:validate`, `state:validate`, `tasks:validate`, `secrets:scan`, full
`pnpm check` — all exit 0, both live flags `MISSING` throughout. CDP
fixed/exact/upto regression (`x402-service-route.test.ts`, 149 tests) unmodified
and passing (item K).

## Outcome

Dynamic document architecture and its credential-free proof are now in place:
the plan-config mechanism is confirmed dynamic by the SDK's own default, the
ceiling/actual/settlement distinction is proven correctly represented end-to-end
in D1 without a new migration, the 12000/19000/29000 fixture economics are
individually proven, and the durability-before-settle crash-recovery property is
proven for the dynamic case specifically. No document agent/plan was registered
(`registration_allowed=false`, an unresolved plan-price-field question, not a
capability failure). No live document payment was executed or authorized.

**SUN-0900B Checkpoint 2A (dynamic document capability + registration):
architecture and credential-free proof complete; registration and the live
dynamic settlement proof remain outstanding.** SUN-0900B remains `active`
overall; `production_ready=false`; `production_enabled=false`. The dynamic
document proof itself (max=190000 → actual=12000 → settled=12000, live) is
**not** accepted this turn and was not attempted.
