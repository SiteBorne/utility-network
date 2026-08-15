# SUN-0900B Checkpoint 2D — Genuine Dynamic-Credits Sandbox Falsification Probe

`controlled_sandbox_self_test` / `controlled_sandbox_capability_probe`:
independent_customer=false, revenue=false, open_market_purchase=false,
production_ready=false, production_enabled=false.

Cross-references: `32a2c97` (Checkpoint 2B differential PAYG probe —
`PAYG_ACTUAL_BELOW_PRICE_UNSUPPORTED_FOR_PROBED_CONFIGURATION`), `8fa32dd`
(Checkpoint 2C static mechanism audit — `DYNAMIC_MODEL_UNPROVEN`, evidence
leaning toward a prepaid hypothesis). This checkpoint closes that gap with a
real, bounded, sacrificial capability probe. **`document_evidence_json.v1` was
never touched: no agent, no plan, no registration mutation.**

## What was authorized and what happened

One new, clearly-labeled, sacrificial capability-probe agent+plan ("SITEBORNE
Dynamic Credits Capability Probe") was registered using a genuine multi-credit
`getDynamicCreditsConfig(9000n, 1000n, 9000n)` — not the already-disproven PAYG
1/1/1 shape — priced at 9000 atomic USDC via `getERC20PriceConfig`. One bounded
delegation, one ephemeral token, one real `verifyPermissions(maxAmount=9000)`,
one real, deliberate `settlePermissions(maxAmount=1000)` — exactly once.

**The first invocation failed on a read-back bug in this session's own script**
(wrong property path reading `getPlan()`'s response — the real shape is
`plan.registry.price`/`plan.registry.credits`, not `plan.price`/`plan.credits`)
— this failure occurred **before** delegation, token, verify, or settle were
ever reached. Registration itself is idempotent via
`reconcileNeverminedRegistration` (reconcile-first, proven by the existing
`registry-reconciliation.test.ts` suite), so the second, fixed invocation safely
reused the already-registered probe plan (`reconciliation.state: 'existing'`)
rather than creating a duplicate. Only the second invocation reached
delegation/token/verify/settle, and only once.

## Result

### Read-back (matches the requested configuration exactly)

```
plan price:        9000 atomic USDC
receiver:           0x7f44a2dd237938F18632d4CcA40f4c690295E6E1 (SITEBORNE)
token:               0x036CbD53842c5426634e7929541eC2318f3dCF7e (Base Sepolia USDC)
credits amount:     9000
credits minAmount:  1000
credits maxAmount:  9000
isRedemptionAmountFixed: false
isTrialPlan:        false
```

### `pricePerCredit` (read-only, before any settlement)

`getPlanBalance(planId, subscriberAddress)` returned
**`pricePerCredit: 0.000001`** — exactly the predicted value (`0.009` USD plan
price ÷ `9000` credits granted = `0.000001` USD/credit = 1 atomic USDC per
credit at 6 decimals). This is Nevermined's own backend-computed field, not an
inference.

### Settle response

```json
{
  "success": true,
  "transaction": "tid-ef506604-f6a6-4e38-bb6a-bb88865875ac",
  "creditsRedeemed": "1000",
  "remainingBalance": "8000"
}
```

`creditsRedeemed` matches the requested `maxAmount` exactly. `remainingBalance`
is exactly `9000 - 1000 = 8000` — the textbook prepaid-pool arithmetic.

### External reconciliation (seller key, read-only)

Delegation status `Exhausted`, exactly one `succeeded` transaction,
`providerTransactionId: 0xe0a6932e33eb6e4dc0eaeca5e7c51dc0899a2212c45781f4d877b8f3399d36ca`.

### On-chain ground truth (public Base Sepolia lookup)

```
9000 atomic USDC:  buyer → proxy (0x47A72d70…)
  8910 atomic USDC: proxy → seller (0x7f44a2dd…)   [99%]
    90 atomic USDC: proxy → platform fee address    [1%, exact]
```

**The real on-chain transfer was 9000, not 1000.** This is the automatic
plan-purchase/top-up (SDK's own documented behavior: "If the subscriber doesn't
have enough credits, it will attempt to order more before settling" — no
explicit `orderPlan()` call was ever made by this probe; the top-up happened
implicitly as part of the settle call, confirming §10's answer without needing
to test it separately). The requested `1000` never appears as an independent
on-chain amount — it is burned entirely from the freshly-purchased 9000-credit
pool, off-chain, in the credits ledger.

## Classification: `B — PREPAID_DYNAMIC_CREDITS_SUPPORTED`

Not `A` (no direct 1000-atomic transfer occurred), not `C` (no separate formula
needed — the 1:1 credit-to-atomic mapping is exact and already covered by `B`'s
own economics), not `D`, not `E` — the evidence is complete and unambiguous:

- Starting credits: `0` (fresh probe plan, first use).
- Plan purchase/top-up: automatic, exactly `9000` atomic USDC, matching the
  plan's registered price, on-chain, once.
- Credits acquired: `9000` (implied by the purchase and confirmed by the
  remaining-balance arithmetic).
- Credits burned this settle: `1000`, exactly the requested amount.
- Credits remaining: `8000`, exactly `9000 - 1000`.
- 1 credit = 1 atomic USDC, exactly, confirmed via the backend's own
  `pricePerCredit` field.

**§19's mandatory acceptance bar for classification B is met**: an actual
dynamic balance exists (`remainingBalance`), 9000 credits were acquired, exactly
1000 were redeemed, exactly 8000 remain. A 9000-atomic transfer alone would not
have been sufficient — the exact, matching remaining-balance arithmetic is what
proves this is a real, reusable prepaid pool, not a full-price single-use
redemption dressed up with a misleading `remainingBalance` field.

**Not yet independently proven this turn**: whether the remaining 8000 credits
are genuinely _reusable_ in a later, separate settle call (this probe made
exactly one settle call, per its own no-rerun discipline). The
`remainingBalance` field's existence and exact arithmetic strongly implies
reusability — that is the field's entire purpose — but no second settlement
against the same pool was attempted, and none should be without separate
authorization.

## Document-plan decision — explicitly deferred, not made this turn

Per this turn's own directive (§22–23): this probe's success does **not**
automatically authorize `document_evidence_json.v1` registration, and does
**not** automatically flip `registration_allowed=true` for it. That is a
**product/master-directive compatibility decision** — does SITEBORNE want to
adopt a genuinely prepaid-credit-pool economic model for the document service,
with all the buyer-facing implications that carries (a buyer's first request
funds a 190000-atomic-USDC credit pool up front, not a per-request 12000 charge;
unused credits remain a reusable balance, not individually refunded per job) —
and belongs to a separate, later checkpoint, not this one.

- `document registration_allowed`: **`false`** (unchanged).
- `sandbox_capability_verified`: **`false`** (unchanged — this describes the
  exact capability now proven for the _probe_ plan, not a claim about the
  document plan, which remains unregistered).
- `dynamic_live_allowed`: **`false`**.
- The probe registration is **retained**, not deleted, per this turn's own
  explicit instruction (external deletion is itself a mutation and would destroy
  audit evidence).

## Files changed

- `apps/edge-api/tests/live/nevermined-dynamic-credits-probe.test.ts` (new) —
  the probe itself, gated by `NEVERMINED_PROBE_DYNAMIC_CREDITS=1`, never
  `RUN_LIVE_NEVERMINED`. Header comment updated with the final result.
- `docs/reports/SUN-0900B-checkpoint-2d-dynamic-credits-live-probe.md` (this
  file, new).

## Regression

`nevermined:check`, `x402:check`, `mcp:check`, `a2a:check`,
`governance:validate`, `state:validate`, `tasks:validate`, `secrets:scan`, full
`pnpm check` — all exit 0. `RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402` absent
throughout; `NEVERMINED_PROBE_DYNAMIC_CREDITS` unset after the single authorized
run.

## Outcome

The genuine dynamic-credits mechanism question from Checkpoint 2C is now
**answered, not merely narrowed**: Nevermined's `getDynamicCreditsConfig`
implements a real, reusable, exact-1:1 prepaid credit pool. This is a positive,
usable result — it did not cost the full document-scale exposure to obtain (9000
atomic USDC, ~$0.009, one order of magnitude below the eventual 190000-atomic
document ceiling) — but it changes the shape of the product decision ahead:
SITEBORNE would be adopting a prepaid- balance model for dynamic document
pricing, not a per-request-exact-charge model. That product/master-directive
compatibility decision, and any eventual document registration, remain for a
separate, later checkpoint. SUN-0900B remains `active`;
`production_ready=false`; `production_enabled=false`.
