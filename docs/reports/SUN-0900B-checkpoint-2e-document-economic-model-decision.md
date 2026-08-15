# SUN-0900B Checkpoint 2E — Document Prepaid-Credit Contract Decision

`controlled_sandbox_self_test`: independent_customer=false, revenue=false,
open_market_purchase=false, production_ready=false, production_enabled=false.

Cross-references: `32a2c97` (Checkpoint 2B —
`PAYG_ACTUAL_BELOW_PRICE_UNSUPPORTED_FOR_PROBED_CONFIGURATION`), `8fa32dd`
(Checkpoint 2C — `DYNAMIC_MODEL_UNPROVEN`), `fa3f60c` (Checkpoint 2D —
`PREPAID_DYNAMIC_CREDITS_SUPPORTED`, proven).

**Zero external mutation this turn.** No registration, no delegation, no token,
no verify, no settle, no capability probe, no live payment. This is a
normative-source reading and product decision only.

## 1–3. Baseline and Checkpoint 2D terminology (frozen, not reopened)

`HEAD=fa3f60c`, tree clean at start. All five live/probe flags confirmed absent.
Checkpoint 2D precisely involved **one** probe registration (a local read-back
bug in the first harness invocation stopped execution before
delegation/token/verify/settle; the second, fixed invocation reconciled to the
same registration and reached delegation/token/verify/settle exactly once).
**Probe registrations total = 1. Capability settlements total = 1.** Not
described as two economic probes.

## 4–5. Normative controlling clauses

### Master directive (`docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md`)

- §4.3 (Document Evidence JSON): "Price: Native page: $0.012, OCR page: $0.019,
  Table-heavy page: $0.029, Maximum launch job: $0.19. **Use x402 upto
  settlement.**" — names the x402 protocol scheme (authorization ceiling vs.
  measured actual usage), not a specific rail-level cash-movement mechanism.
- §15 (Payment implementation): "Bind each payment to: Buyer, Seller, Service
  ID, Service version, Input hash, Schema hash, Quote ID, **Price or maximum
  price**, Nonce, Expiration, Idempotency key." — the binding is to a
  price/ceiling, not a mandated literal per-request cash-transfer amount.
- §19 (Nevermined): "**Create pay-as-you-go plans** for all four services." —
  "pay-as-you-go" is Nevermined's own terminology
  (`getPayAsYouGoPriceConfig`/`getPayAsYouGoCreditsConfig`, and by direct
  structural equivalence proven in Checkpoint 2C, the dynamic-credits family
  too). In common commercial usage (cloud compute credits, API usage credits),
  "pay-as-you-go" billing is routinely realized via a prepaid, drawn-down
  balance — that is not a departure from the phrase, it is one of its most
  standard realizations.

**No clause in the master directive requires literal, immediate, per-request
on-chain cash movement equal to actual usage for every possible rail.** The
controlling promise is usage-proportional pricing (never charged the ceiling by
default) — not a specific cash-flow timing mechanism.

### ADR 0054 (Model D, accepted, `docs/decisions/0054-buyer-surface-specific-payment-rails.md`)

This is the single most decisive source, and it already anticipated exactly this
question:

> "Service runtime, PCC generation/verification, receipt signing, UsageResult,
> and consumed-state transitions **remain shared and rail-agnostic**."
>
> "**PaymentServiceLink is rail-aware**, while the signed PCC receipt is not
> modified."
>
> "D1 remains the only replay/lifecycle authority and SITEBORNE
> `Payment-Identifier` remains the logical payment identity."

Model D was adopted specifically because Nevermined's `nvm:erc4337`
authorization "is also not a Coinbase `exact | upto` payload" — the ADR already
commits to letting rails differ in mechanism while keeping service-usage
evidence (UsageResult/PCC/receipt) identical and rail-aware cash evidence in
PSL. This is, structurally, already **Model C** from this checkpoint's own
framing — decided in advance, not something this turn invents.

### `ExternalSettlementEvidence.actual_amount` (`packages/protocol-x402/src/evidence/types.ts`)

> "Atomic-unit integer string — the amount actually settled. For `exact`, must
> equal the requirement's amount. For `upto`, must satisfy
> `0 <= actual <= authorized_maximum` **and match the accepted usage-result
> binding**."

The field's own controlling definition ties it to the **usage-result binding**,
not to a literal on-chain transfer amount. This is already usage-value-oriented
in its frozen definition — consistent with treating it as
`USAGE_VALUE_ATOMIC_EQUIVALENT`, not `CASH_MOVEMENT_ATOMIC`.

## 5. Central normative question — answered

**Model C — RAIL-SPECIFIC PAYMENT SEMANTICS.** The logical service usage/
pricing (12000/19000/29000/190000, always measured identically regardless of
rail) remains identical; the Nevermined rail realizes payment via a prepaid
credit pool, the CDP rail realizes it via direct on-chain `upto` settlement —
both truthfully represented, neither forced into the other's evidence shape.
This is not chosen for implementation convenience — it is the model ADR 0054
already adopted for exactly this class of problem.

## 6. Model D audit

Model D permits, without modification:

- **CDP document path**: authorize maximum=190000, actual monetary
  settlement=12000/19000/29000/… — unchanged, already accepted (x402 `upto`
  end-to-end tests in `x402-service-route.test.ts`).
- **Nevermined document path**: purchase/top-up a reusable credit balance
  (automatic, per Checkpoint 2D), then burn actual credits=12000/19000/29000/… —
  now proven as a real, exact mechanism.

Both realize **one logical document service** (`document_evidence_json.v1`, one
`UsageResult` shape, one PCC, one receipt format) through two genuinely
different rail mechanics, exactly as Model D's "PaymentServiceLink is
rail-aware, PCC receipt is not modified" line already prescribes. This is a
**compatible rail-specific realization**, not an impermissible divergence — no
stacking, no fallback, no double charge, no double execution; each buyer surface
still selects exactly one rail before D1 acquisition, unchanged.

## 7. Three values, frozen, never conflated

| Concept                         | Meaning                                                                           | Example (native page, first use, zero starting balance) |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `CASH_MOVEMENT_ATOMIC`          | Actual stablecoin movement caused by acquisition/top-up                           | `190000` (or `0` with sufficient existing balance)      |
| `CREDITS_REDEEMED`              | Actual Nevermined credits consumed by this job                                    | `12000`                                                 |
| `USAGE_VALUE_ATOMIC_EQUIVALENT` | Locally authoritative service usage, valued at the plan's exact acquisition ratio | `12000`                                                 |

For the proposed 1:1 document plan (`190000` atomic price ÷ `190000` credits
granted): **credit acquisition value = exactly 1 atomic USDC per credit**
(integer identity, `190000n / 190000n === 1n` — never derived from the backend's
floating `pricePerCredit`, which is corroborative only, per this turn's explicit
instruction).

## 8. Proposed document credit plan (static candidate only — not registered)

```ts
priceConfig: getERC20PriceConfig(190_000n, BASE_SEPOLIA_USDC, SELLER_ADDRESS);
creditsConfig: getDynamicCreditsConfig(190_000n, 12_000n, 190_000n);
// => { isRedemptionAmountFixed: false, amount: 190000n, minAmount: 12000n, maxAmount: 190000n }
accessLimit: 'credits';
```

Integer acquisition-value equation: `190000n / 190000n = 1n` atomic USDC per
credit — exact, no remainder, no floating point.

## 9. Usage tiers (service consumption values — not per-request cash claims)

| Tier    | Credits redeemed | Usage-value atomic equivalent |
| ------- | ---------------- | ----------------------------- |
| native  | 12000            | 12000                         |
| OCR     | 19000            | 19000                         |
| table   | 29000            | 29000                         |
| maximum | 190000           | 190000                        |

These describe service consumption, never a promise that a fresh USDC transfer
of that exact size occurs on every request.

## 10. Zero-balance first-use economics

```
automatic order/top-up:      190000 atomic USDC (irreversible cash movement)
credits acquired:            190000
native job redemption:       12000
remaining balance:           178000 (reusable)
current-job consumed value:  12000 atomic-equivalent
```

**Never described as "buyer paid only 12000"** for first use — that would be
false. The truthful statement is: the buyer's first job establishes a
190000-atomic reusable balance and this job consumes 12000 atomic- equivalent of
value from it, leaving 178000 available for future jobs.

## 11. Existing-balance economics

```
fresh USDC transfer:         0 (sufficient balance already present)
credits redeemed:            12000
usage value consumed:        12000 atomic-equivalent
remaining balance:           previous balance - 12000
```

Never described as a fresh $0.012 monetary settlement — no cash moved.

## 12. Auto-top-up boundary at partial balance — unproven, marked as a future live acceptance assertion

Checkpoint 2D's probe only exercised the zero-balance → automatic 190000- unit
top-up case (via the analogous 9000-unit probe plan). Whether a subscriber with,
e.g., `5000` existing credits and a `12000`-credit request triggers a fresh full
top-up of `190000` more credits (leaving `183000`), a smaller top-up sized to
the shortfall, or something else, is **not established by current project
evidence**. Per this turn's own instruction: **do not guess** — this is marked
as an open question, answerable only by a future, separately-authorized live
acceptance test (not attempted this turn).

## 13. PCC decision

**PCC remains unmodified, rail-agnostic** — matching ADR 0054's explicit "PCC
receipt is not modified" line. PCC binds what the service consumed/ performed
(input/output hashes, verification result), never rail-specific cash-flow
timing. No PCC version change.

## 14. UsageResult decision — decisive point, resolved

`UsageResult.actual_amount` means **service economic usage/value**
(`USAGE_VALUE_ATOMIC_EQUIVALENT`), not literal cash transferred by the payment
provider. This is not a new interpretation invented to make the prepaid model
fit — it is already the field's frozen definition
(`ExternalSettlementEvidence.actual_amount`'s own doc comment: "must... match
the accepted usage-result binding," never "must equal the on-chain transfer
amount"), and it is consistent with ADR 0054's rail-agnostic mandate. **No
UsageResult contract change is required.**

## 15. Receipt decision

Existing receipt representation already permits this without schema/ version
change: the receipt attests to service execution/output, not to a specific
cash-flow claim. A receipt must never be worded to assert "settled 12000 atomic
USDC" when Nevermined actually top-topped 190000 and burned 12000 credits — this
is a **wording/content discipline** requirement for whatever narrative text
accompanies a receipt, not a schema change.

## 16. PaymentServiceLink decision

**No version bump.** V2's existing `settlement_evidence_hash` field is a hash
over a SITEBORNE-controlled evidence object (already proven by the existing
`hashPaymentObject({kind: 'nevermined_settlement_recovered', ...})` pattern used
in the accepted recovery path). The smallest additive compatible change is a
**new evidence object shape**, not a new PSL field or version:

```ts
// hashed into settlement_evidence_hash for Nevermined dynamic-credit settlements only
{
  kind: 'nevermined_credits_settlement',
  payment_identifier: string,
  plan_id: string,
  credits_redeemed: string,      // CREDITS_REDEEMED
  usage_value_atomic: string,    // USAGE_VALUE_ATOMIC_EQUIVALENT (must equal credits_redeemed for a 1:1 plan)
  remaining_balance: string | null,     // from settlePermissions' remainingBalance, when present
  cash_movement_atomic: string | null,  // provider-confirmed top-up amount, when a top-up occurred this call; null when none did
  transaction: string,           // settlement transaction reference
}
```

CDP continues to bind `maximum monetary authorization` /
`actual monetary settlement` unchanged — the two rails are never forced into
identical settlement-evidence shapes, matching this turn's own instruction.

## 17. Payment-Identifier / D1 decision

D1's `payment_attempts.amount` column (the only "amount"-named column at the
table level) already holds the authorized ceiling for `upto` — this convention
is unaffected. `actual_amount`/`authorized_maximum` live only inside the JSON
durable draft (`x402_service_results.result_json`), not as separate D1 columns —
so there is no column-name ambiguity to resolve at the schema level. The
smallest additive change (if/when a real dynamic Nevermined lifecycle is built)
is adding `credits_redeemed`/ `remaining_credit_balance`/`cash_movement_atomic`
as **additional JSON fields inside the existing durable draft structure** —
additive, no new migration, following the exact precedent `authorized_maximum`/
`actual_amount` already set. Historical CDP/fixed-PAYG semantics are untouched.

## 18. Buyer-facing language

Truthful language for the Nevermined dynamic document path:

> "Document processing on the Nevermined rail draws from a reusable credit
> balance. Your first request may fund that balance (up to 190000 atomic USDC);
> each job consumes credits according to its actual processing (native pages:
> 12000 credits; OCR pages: 19000 credits; table pages: 29000 credits — 1 credit
> = 1 atomic USDC for this plan). Unused credits remain in your balance for
> future requests. If your balance is insufficient, the rail may automatically
> fund it again before processing."

**Never** describe the Nevermined dynamic document path as "authorize up to
$0.19 and pay only actual usage" unless that is literally true for the cash-flow
event (it is not, on first use, or whenever a top-up occurs) — that phrase may
continue to describe the **CDP `upto` rail**, where it is literally true.

## 19. Product decision

**A — `NEVERMINED_PREPAID_DYNAMIC_ACCEPTED`.**

The frozen master directive (usage-proportional pricing, "pay-as-you-go" plans)
and ADR 0054 (rail-agnostic UsageResult/PCC/receipt, rail-aware PSL, Model D)
already permit rail-specific prepaid credits. The existing v2 evidence schema
can truthfully represent them via a new, Nevermined-specific evidence-object
_shape_ hashed into the existing `settlement_evidence_hash` field — no PSL
version bump, no PCC/UsageResult contract change, no D1 migration.

## 20. Registration gate (per decision A)

`registration_allowed=true` **may** be set once the registration validator and
its tests exist and pass — **not done this turn** (no external mutation
authorized). The exact validator requirements, to implement in a future turn:

- price: `190000` atomic, Base Sepolia USDC
  (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`), receiver = SITEBORNE seller
  address exactly.
- credits: `amount=190000`, `minAmount=12000`, `maxAmount=190000`,
  `isRedemptionAmountFixed=false`.
- `accessLimit='credits'`, `isTrialPlan=false`, no free/zero-price, no
  fixed/time-based plan.
- Reject: the already-disproven PAYG 1/1/1 shape; `getFixedCreditsConfig`; any
  price/granted/min/max mismatch; wrong asset/receiver; trial; free; time-based
  (`durationSecs != 0`).

`sandbox_capability_verified=false` and `dynamic_live_allowed=false` **remain
false** until the real document plan/lifecycle is actually tested live — this
decision alone does not prove that.

**No registration was performed this turn.**

## 21–22. Not applicable

Decision is A, not B or C — no normative-change proposal or permanent block is
recorded.

## 23. Accepted fixed-PAYG unaffected

`company_evidence_graph.v1`, `web_context_verified.v1`, `verify_agent_output.v1`
fixed Nevermined economics, and the accepted fixed-PAYG recovery evidence
(`021c280`), are untouched by this decision. Dynamic-document semantics are
scoped exclusively to `document_evidence_json.v1`.

## 24. External mutation count this turn

Registration mutations = 0. Delegation mutations = 0. Token creations = 0.
Verify calls = 0. Settle calls = 0. Monetary mutations = 0. All Nevermined-
related work this turn was normative-source reading only; no network call of any
kind was made.

## 25. Tests

No new tests added this turn. Per §20, the registration-validator implementation
and its tests (exact plan-shape acceptance/rejection,
`12000`/`19000`/`29000`/`190000` burn valuations, the
`CASH_MOVEMENT_ATOMIC != USAGE_VALUE_ATOMIC_EQUIVALENT` distinction,
PAYG-1/1/1-rejected-for-document, fixed-PAYG/CDP-upto-unaffected) are scoped to
the _next_ checkpoint, where `registration_allowed` is actually flipped —
keeping this turn's diff limited to the decision itself, exactly matching its
"no external mutation, decision only" framing.

## 26. Regression

`nevermined:check`, `x402:check`, `mcp:check`, `a2a:check`,
`governance:validate`, `state:validate`, `tasks:validate`, `secrets:scan`, full
`pnpm check` — all exit 0 (baseline, unmodified — this turn added no code). All
live/probe flags absent throughout.

## Outcome

**Product decision: A — `NEVERMINED_PREPAID_DYNAMIC_ACCEPTED`.** The
prepaid-credit model proven in Checkpoint 2D is normatively compatible with
SITEBORNE's frozen document service contract and Model D, via the existing
rail-agnostic/rail-aware architectural split ADR 0054 already established. No
schema/version change is required for UsageResult, PCC, receipt, or
PaymentServiceLink — only a new, additive, Nevermined-specific evidence-object
shape and (for a future turn) a registration validator. `registration_allowed`
remains `false` this turn — the decision authorizes building the validator and
gate in the _next_ checkpoint, not registering the document plan now.
`sandbox_capability_verified`/`dynamic_live_allowed` remain `false` until a real
document lifecycle is live-tested. SUN-0900B remains `active`;
`production_ready=false`; `production_enabled=false`.
