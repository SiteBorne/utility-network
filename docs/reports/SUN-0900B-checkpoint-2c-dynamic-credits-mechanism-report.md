# SUN-0900B Checkpoint 2C — Dedicated Dynamic-Credits Mechanism Audit

`controlled_sandbox_self_test`: independent_customer=false, revenue=false,
open_market_purchase=false, production_ready=false, production_enabled=false.

Checkpoint 2B's differential probe is accepted at `32a2c97`, refined
terminology: **`PAYG_ACTUAL_BELOW_PRICE_UNSUPPORTED_FOR_PROBED_CONFIGURATION`**
— narrower than "all PAYG plans always charge their registered price," scoped
precisely to the `getPayAsYouGoPriceConfig` + `getPayAsYouGoCreditsConfig()`
pairing actually tested.

This turn is **entirely static and read-only with respect to Nevermined** — zero
network calls of any kind, zero live flags, no registration, no delegation, no
token, no verify/settle. Every finding below comes from directly reading the
installed `@nevermined-io/payments@1.10.0` package's `.d.ts`/`.js` source and
executing its pure, side-effect-free config-builder methods locally against a
syntactically-valid-but-fake JWT (the SDK never validates a key against the
network at construction time).

## 1. Installed `getDynamicCreditsConfig` signature (resolves the discrepancy)

Confirmed identically in `dist/plans.d.ts`, `dist/plans.js`, and
`dist/api/plans-api.d.ts`, and via an executed test:

```ts
getDynamicCreditsConfig(
  creditsGranted: bigint,
  minCreditsPerRequest?: bigint, // default 1n
  maxCreditsPerRequest?: bigint  // default 1n
): PlanCreditsConfig
```

**Three parameters** — matching what was recalled as a possible
`(creditsGranted, min, max)` shape, **not** the two-parameter `(min, max)` shown
by the current public docs page. The installed implementation is authoritative
for this project; no SDK upgrade occurred or is proposed.

## 2. The three credits helpers, exact serialized output (executed, not inferred)

| Helper                                     | `isRedemptionAmountFixed` | `amount` | `minAmount` | `maxAmount` |
| ------------------------------------------ | ------------------------- | -------- | ----------- | ----------- |
| `getFixedCreditsConfig(100n)`              | `true`                    | `100n`   | `1n`        | `1n`        |
| `getFixedCreditsConfig(100n, 5n)`          | `true`                    | `100n`   | `5n`        | `5n`        |
| `getPayAsYouGoCreditsConfig()`             | `false`                   | `1n`     | `1n`        | `1n`        |
| `getDynamicCreditsConfig(190n, 12n, 190n)` | `false`                   | `190n`   | `12n`       | `190n`      |

All other fields (`redemptionType: ONLY_SUBSCRIBER`, `onchainMirror: false`,
`durationSecs: 0n`) are identical across all three helpers by default.

**Key structural finding, proven by direct equality assertion**:
`getPayAsYouGoCreditsConfig()` is **byte-identical** to
`getDynamicCreditsConfig(1n, 1n, 1n)`. PAYG is not a distinct mechanism — it is
the degenerate, single-credit special case of the dynamic helper. This directly
explains why Checkpoint 2B's probe (a plan whose credits config had `amount:1n`)
behaved as an all-or-nothing single redemption regardless of the settle-time
`maxAmount` requested: there was structurally only ever one credit to redeem.

A real dynamic document plan would set `creditsGranted`/`minCreditsPerRequest`/
`maxCreditsPerRequest` to genuinely distinct values (e.g.
`getDynamicCreditsConfig(190_000n, 1n, 190_000n)`), which — proven by a direct
inequality assertion — is a structurally different object from the
already-disproven PAYG shape.

## 3. Registration serialization path (traced, no call made)

`PlansAPI.registerPlan(planMetadata, priceConfig, creditsConfig, nonce, accessLimit, publicationOptions)`
is a **thin HTTP client with zero local transformation**:

```js
const body = {
  metadataAttributes: planMetadata,
  priceConfig,
  creditsConfig,
  nonce,
  isTrialPlan: planMetadata.isTrialPlan || false,
  accessLimit,
  ...(priceConfig.currency && { currency: priceConfig.currency }),
};
// POST body directly to Nevermined's backend — no scaling, no conversion.
```

`registerCreditsPlan` (what SITEBORNE would call) adds exactly two
**synchronous, pre-network guard clauses** before delegating to `registerPlan` —
both confirmed by directly invoking them and asserting the thrown error, never
reaching `fetch`:

1. `creditsConfig.durationSecs` must be `0n` (non-expirable) — throws
   `"The creditsConfig.durationSecs must be 0 for credits plans (non-expirable)"`.
2. `creditsConfig.minAmount` must not exceed `creditsConfig.maxAmount` — throws
   `"The creditsConfig.minAmount can not be more than creditsConfig.maxAmount"`.

**`priceConfig` and `creditsConfig` travel to the backend as two entirely
separate objects, with no SDK-side linkage between them at all.** Whatever
formula relates "credits redeemed" to "atomic USDC charged" is enforced
exclusively by Nevermined's backend/contracts — not visible in this SDK.

## 4. The boundary of local static evidence

This is the honest limit of what can be resolved without either an authoritative
Nevermined backend/contract source (not available locally) or another live
experiment (forbidden this turn). The SDK is, by design, a pure transport +
local-validation layer; every question about the _actual_ meaning of
`settlePermissions({maxAmount})` for a `getDynamicCreditsConfig` plan — direct
ERC-20 transfer, prepaid-credit-pool burn, or something else — is decided
entirely server-side.

One additional, suggestive (not conclusive) local data point: the installed
package's bundled `README.md` documents a **separate, MCP-specific credits
abstraction** (`payments.mcp.registerTool(..., { credits: 1n })`,
`{ credits: (ctx) => ... }`) where "credits" are consistently small, human-scale
abstract integers (`1n`, `2n`, `5n`), not atomic currency units — reinforcing
that "credits" is Nevermined's own abstract unit, economically priced at the
_plan_ level (their own worked example: "100 credits for 10 USDC"), not a
currency amount in itself. This is consistent with — but does not prove — a
**prepaid-credit-pool** model.

## 5. Critical economic question, answered narrowly

**What Checkpoint 2B proved**: for the specific `getPayAsYouGoPriceConfig` +
`getPayAsYouGoCreditsConfig()` pairing, `settlePermissions({maxAmount})` did not
control the actual on-chain charge — the plan's registered price did, regardless
of the requested settle amount.

**What remains genuinely unproven**: whether `getDynamicCreditsConfig` (a
structurally different credits config, never tested) behaves the same way,
differently, or according to some derivable currency-per-credit formula. No
local evidence — types, implementation, or bundled docs — states this explicitly
or lets it be computed with certainty.

## 6. Architecture classification

**`E. DYNAMIC_MODEL_UNPROVEN`** (not `A`, not `B`, not `C`, not `D` — the
categories are not collapsed). The evidence leans toward `B`
(`PREPAID_DYNAMIC_CREDITS_SUPPORTED`) as the more plausible real-world model
given the README's credits abstraction and Checkpoint 2B's price-dominant
behavior, but "plausible" is explicitly not "proven," and this report does not
treat it as proven.

Consequently:

- 12000 / 19000 / 29000 / 190000 atomic-USDC economic results: **not computed**
  — no confirmed formula exists to compute them from.
- Unused-credit economics, delegation interaction specifics for a dynamic plan,
  and buyer-facing prepayment truth-in-advertising all remain open pending that
  formula.
- `registration_allowed`: **`false`** (unchanged).
- `sandbox_capability_verified`: **`false`** (unchanged).
- `dynamic_live_allowed`: **`false`**.

## 7. Registration-validator rule (structural, unchanged this turn)

`validateNeverminedDeclaration`'s narrowed rule from Checkpoint 2A/2B (`upto` +
`registration_allowed` requires `dynamic_actual_settlement_required`) remains
structurally correct but is explicitly **not** an economic-formula validator —
it cannot and does not check whether a proposed `creditsConfig` actually
produces truthful buyer economics. That check can only happen once §6's formula
question is resolved; noting this gap honestly rather than building an unfounded
check now.

## 8. Credential-free tests added

`apps/edge-api/tests/nevermined-credits-config-mechanism.test.ts` (7 tests, all
executed against the real installed SDK, zero network):

1. `getFixedCreditsConfig` exact shape (default and explicit
   `creditsPerRequest`).
2. `getPayAsYouGoCreditsConfig()` exact fixed 1/1/1 shape.
3. `getDynamicCreditsConfig`'s installed 3-parameter signature, exact output.
4. `getPayAsYouGoCreditsConfig()` byte-identical to
   `getDynamicCreditsConfig(1n, 1n, 1n)`.
5. A proposed document dynamic config is structurally distinct from PAYG.
6. `registerCreditsPlan` throws synchronously (pre-network) on
   `minAmount > maxAmount`.
7. `registerCreditsPlan` throws synchronously (pre-network) on
   `durationSecs !== 0`.

## 9. Next falsification probe (designed, NOT run)

The cheapest experiment that would directly falsify or confirm the leading `B`
hypothesis, isolating exactly the one remaining uncertain variable:

- **Plan**: register ONE new, minimal, real dynamic-credits document-style plan
  — `getERC20PriceConfig(190_000n, sellerAddress, usdcAddress)` +
  `getDynamicCreditsConfig(190_000n, 1n, 190_000n)`, `accessLimit: 'credits'`.
  This is itself a real registration mutation, bigger than Checkpoint 2B's probe
  — not authorized this turn.
- **Buyer funding**: whatever the resulting plan requires to acquire access (a
  real question this experiment would also answer — does funding happen at
  delegation-creation, or is a separate "buy credits" call required first?).
- **Delegation**: one bounded `erc4337`/`usdc` delegation scoped to the new
  plan.
- **Verify**: `maxAmount = 190_000n` (the ceiling).
- **Actual (settle)**: `maxAmount = 12_000n` (deliberately far below the
  ceiling, matching the real native-page tier).
- **Expected result if `B` (prepaid pool)**: on-chain transfer at
  plan-acquisition time (up to 190000, once), then settle burns 12000 _credits_
  from the pool with **no further on-chain transfer** per settle call.
- **Expected result if `A` (direct dynamic settlement)**: on-chain transfer of
  exactly 12000 at settle time, nothing transferred at acquisition beyond that.
- **Maximum sandbox downside**: bounded by the new plan's registered price
  (190000 atomic USDC ≈ $0.19) — one order of magnitude larger than Checkpoint
  2B's probe, still de minimis sandbox risk, but real enough to warrant
  separate, explicit authorization.
- **Reconciliation**: identical method to Checkpoints 1B/2B — seller-key GET
  `/delegation/{id}` and `.../transactions`, plus a public Base Sepolia on-chain
  lookup for ground truth.

This probe is **designed only**. It is not executed, and registering the new
plan it requires is not authorized this turn.

## 10. Installed-SDK vs. current-doc drift (recorded)

|                                     | Current public docs        | Installed `1.10.0`                 |
| ----------------------------------- | -------------------------- | ---------------------------------- |
| `getDynamicCreditsConfig` signature | `(min, max)` (as observed) | `(creditsGranted, min=1n, max=1n)` |

No other drift identified in this pass. Installed implementation wins for all
SITEBORNE behavior; no SDK version change proposed or made.

## Outcome

No document registration mutation occurred. `registration_allowed=false`,
`sandbox_capability_verified=false`, `dynamic_live_allowed=false` — all
unchanged from Checkpoint 2B. The dynamic-credits mechanism is now substantially
better understood structurally (3-parameter signature, byte-identical
PAYG-as-degenerate-dynamic-case finding, confirmed zero-transformation
registration path, two real pre-network guards) but remains
**`DYNAMIC_MODEL_UNPROVEN`** for the specific economic question that matters:
whether `getDynamicCreditsConfig` produces the required exact
`actual → atomic USDC charged` mapping. SUN-0900B remains `active`;
`production_ready=false`; `production_enabled=false`. The next concrete step, if
pursued, is the separately-authorized differential probe in §9 — not the full
`190000 → 12000` document lifecycle, and not a document registration on the
unproven `getPayAsYouGoPriceConfig`/ `getPayAsYouGoCreditsConfig()` pairing.
