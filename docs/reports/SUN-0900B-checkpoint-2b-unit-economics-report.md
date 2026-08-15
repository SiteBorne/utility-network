# SUN-0900B Checkpoint 2B — Dynamic Unit-Economics Audit, Registration Timeout Reconciliation, and Differential PAYG Probe

`controlled_sandbox_self_test`: independent_customer=false, revenue=false,
open_market_purchase=false, production_ready=false, production_enabled=false.

This report covers two passes. The first (`ffb03dc`) performed zero Nevermined
mutations — a registration-timeout reconciliation and a correction of an earlier
overclaim. The second (this update) performed **exactly one deliberate, real,
controlled sandbox capability probe** — `controlled_sandbox_capability_probe`,
not revenue, not customer activity: one bounded delegation, one ephemeral token,
one `verifyPermissions`, one `settlePermissions`, against the already-accepted
`web_context_verified.v1` plan only, never `document_evidence_json.v1`. No
document registration mutation occurred in either pass.

## 1. Registration-timeout reconciliation

A prior turn's attempt to run
`apps/edge-api/tests/live/nevermined-register-document.test.ts` returned an
immediate permission-classifier denial with no vitest output (no `RUN v2.1.8`
banner, no console lines) — but that could not be taken as proof no mutation
occurred, so this turn re-verified read-only before touching anything else.
Fresh `getPlans`/`getAgents` listing (builder key): **exactly 1 plan, 1 agent,
both the pre-existing, already-accepted `web_context_verified.v1` registration**
(`createdAt: 2026-08-12T07:23:45…`, unchanged). **Classification: `NO_MATCH`** —
no `document_evidence_json.v1` agent or plan exists; the earlier invocation did
not mutate Nevermined.

## 2. The overclaim this turn corrected

An earlier pass in this same checkpoint cited two real, on-chain-confirmed Base
Sepolia transactions
(`0x847a6da0a6a63f1f12838bbe9269b8fd9798997b0680b0146b7147fcb715f417`,
`0x8fec56c49ee6e85a30105d308fd7b1788c9866f8d3780395c8e0f5e549cfd0f2`) as proof
of a general "1 credit = 1 atomic USDC" mapping sufficient to flip
`registration_allowed=true` for the document plan. That was too broad. Both
transactions belong to the **already-registered** `web_context_verified.v1`
plan, and in **both**, the settle-time `maxAmount` equaled the plan's registered
price exactly (`9000 === 9000`). They prove:

- The atomic amount SITEBORNE passes to `settlePermissions({maxAmount})` is
  transferred on-chain exactly, atomic-for-atomic, when `actual === price`.
- The transfer is split with an exact, non-cents-rounded 1% fee (`90` of `9000`)
  — only possible under full atomic-precision arithmetic, not a cents-rounded
  ledger.

They do **not** prove that a settle for `actual < price` is accepted at all, or
that it settles for exactly `actual` rather than being rejected or clamped, for
a plan whose registered price is 190000 but whose per-request settle amount may
be 12000/19000/29000.

## 3. Installed SDK: price and credits are independent, builder-chosen axes

`@nevermined-io/payments@1.10.0`'s `PlansAPI.registerPlan`/`registerCreditsPlan`
doc comment states a Payment Plan defines two separate things: "1. What a
subscriber needs to pay to get the plan... 2. What the subscriber gets in
return... (i.e. 100 credits...)." Its own worked example pairs
`getNativeTokenPriceConfig(100n, builderAddress)` with
`getFixedCreditsConfig(100n)` — the matching `100n`/`100n` is illustrative, not
an SDK-enforced rule; `PlanPriceConfig` (`amounts`, `receivers`, `tokenAddress`)
and `PlanCreditsConfig` (`amount`, `minAmount`, `maxAmount`,
`isRedemptionAmountFixed`) are structurally independent objects with no
conversion function between them anywhere in the SDK's public surface. The SDK
additionally exposes `getDynamicCreditsConfig(creditsGranted, min, max)` — a
genuinely different, range-bounded "credits" helper SITEBORNE's proposed
document registration does **not** use. The proposed registration instead reuses
`getPayAsYouGoPriceConfig` plus `getPayAsYouGoCreditsConfig()`, the exact pair
already proven on-chain for the fixed plan. This narrows the open question but
does not close it: the `getPayAsYouGoCreditsConfig()` object's
`amount`/`minAmount`/`maxAmount` are hardcoded `1n`/`1n`/`1n` ("required for
validation only" per the SDK's own comment) — whether that placeholder is
genuinely unenforced at settle time for `actual < price`, or silently
constrains/rejects it, has never been tested.

## 4. Classification

**`DYNAMIC_UNIT_MAPPING_UNPROVEN`** (not `PROVEN`, not `UNSUPPORTED` — no
negative evidence exists either; the specific `actual < price` case is simply
untested).

`registration_allowed` for `document_evidence_json.v1` is **reverted to
`false`** in `packages/protocol-nevermined/src/declarations.ts`
(`sandbox_capability_verified` was already, and remains, `false`).
`packages/protocol-nevermined/fixtures/declarations-baseline.json` and
`packages/protocol-nevermined/src/declarations.test.ts` updated to match. Net
diff against `658c559` for `registration_allowed` is zero — it went
`false → true → false` within this checkpoint and was never committed at `true`.

## 5. Harness timeout defect (independent of the mutation question)

`reconcileNeverminedRegistration`'s default backoff schedule
(`DEFAULT_NEVERMINED_RECONCILIATION_BACKOFF_MS`) is
`[0, 2000, 5000, 10000, 20000, 30000]` — summing to **67 seconds** before even
accounting for per-request network latency. The registration-only test's
original `60_000`ms Vitest timeout was strictly less than that budget, so the
test could time out on reconciliation alone, before ever reaching registration
or read-back. **Classification: `HARNESS_TIMEOUT_TOO_SHORT`.** Fixed by raising
the test's own timeout to `120_000`ms (comfortably above the 67s worst case plus
registration/read-back overhead, and below the `180_000`ms precedent
`nevermined-live-exact.test.ts` uses for its much larger full-lifecycle test).
No change to the reconciliation backoff schedule itself, and no additional
registration call was made or is made by this fix.

## 6. Duplicate-safety proof (already existing, unmodified)

`reconcileNeverminedRegistration`'s own test suite
(`packages/protocol-nevermined/src/registry-reconciliation.test.ts`) already
proves, credential-free:

- **A**: immediate reads fail, a later attempt succeeds by known IDs →
  `existing`, never registers.
- **H**: timeout after the full backoff schedule → fails closed, no registration
  performed by the reconciliation module itself.
- **I**: `absent` is reported only after the full schedule proves it, never from
  a single empty listing.

The registration-only script (`nevermined-register-document.test.ts`) calls this
exact function before ever considering `registerAgentAndPlan`, so this existing
coverage directly backs its duplicate-safety property; no new test was needed.

## 7. Files changed this reconciliation turn

- `packages/protocol-nevermined/src/declarations.ts` — `registration_allowed`
  reverted to `false` for the document plan; comment rewritten to state the
  precise, narrower classification and cite this report.
- `packages/protocol-nevermined/src/declarations.test.ts` — document-plan
  assertion reverted to `registration_allowed: false`; two validator tests
  adjusted to correctly exercise the narrowed `upto`/`registration_allowed` rule
  (one hypothetical-allow case, one still-reject case).
- `packages/protocol-nevermined/fixtures/declarations-baseline.json` — reverted
  to `registration_allowed: false` (net zero diff vs `658c559`).
- `apps/edge-api/tests/live/nevermined-register-document.test.ts` — header
  comment corrected to state the unproven claim precisely; test timeout raised
  `60_000ms → 120_000ms`; a real `string | bigint` reduce type error fixed.
  File's own first assertion now correctly refuses to proceed
  (`registration_allowed` must be `true`, and it is `false`).
- `docs/reports/SUN-0900B-checkpoint-2b-unit-economics-report.md` (this file,
  new).

## 8. Regression

Credential-free: `nevermined:check`, `x402:check`, `governance:validate`,
`state:validate`, `tasks:validate`, `secrets:scan` — all exit 0. Targeted:
`declarations.test.ts` (10 tests), `fixtures.test.ts` (1),
`registry-reconciliation.test.ts` (9), `nevermined-register-document.test.ts`
(1, correctly skipped — env var absent) — all pass. Full `pnpm check` — exit 0.
Both `RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402` absent throughout;
`NEVERMINED_REGISTER_DOCUMENT` never set.

## Outcome (as of the timeout-reconciliation pass)

Registration state was positively known (`NO_MATCH`, zero mutation that
checkpoint). Dynamic unit economics were conservatively classified
`DYNAMIC_UNIT_MAPPING_UNPROVEN` and `registration_allowed` reflected that
honestly. The harness timeout defect was fixed without weakening reconciliation
safety or issuing a second registration call.

## 9. Differential PAYG settlement-unit probe (definitive, this turn)

A controlled sandbox capability probe
(`apps/edge-api/tests/live/nevermined-differential-payg-probe.test.ts`,
`NEVERMINED_PROBE_PAYG_DIFFERENTIAL=1`, never `RUN_LIVE_NEVERMINED`) closed the
remaining `actual < price` question directly, by experiment, using the
already-accepted `web_context_verified.v1` plan — never the document plan, never
`createX402ServiceRoute`, never a PCC or SITEBORNE job.

**Experiment**: one bounded delegation (`spendingLimitCents: 1`,
`durationSecs: 3600`, `erc4337`/`usdc`, scoped to `planId`
`94523930722525068656272128894334430057768353189467518442660086462546695282012`),
one ephemeral x402 token, one real `verifyPermissions({maxAmount: 9000n})` (the
plan's own control ceiling — succeeded, `isValid: true`), then one real,
deliberate `settlePermissions({maxAmount: 1000n})` — strictly less than both the
verified ceiling and the plan's registered price. Executed exactly once; never
rerun.

**Immediate response**: `success: true`,
`transaction: 0x59a8bd0b7567e7cf3cc2489c539e41083ba424bd87d1b2920d539eebcd9669d7`,
`creditsRedeemed: '0'`, `remainingBalance: '0'` — neither numeric field
correlates cleanly with either `1000` or `9000`, reinforcing that these response
fields are not a reliable read of the actual charge for this credits-config
shape.

**Read-only external reconciliation** (seller key, `GET /delegation/{id}` and
`.../transactions`): delegation status `Exhausted`, exactly one `succeeded`
transaction, `providerTransactionId` matching the response `transaction` field,
`amountCents: '1'`.

**On-chain ground truth** (public Base Sepolia lookup, same method as the prior
two settlements):

```
9000 atomic USDC:  buyer → proxy (0x47A72d70…)
  8910 atomic USDC: proxy → seller (0x7f44a2dd…)   [99%]
    90 atomic USDC: proxy → platform fee address    [1%, exact]
```

**Byte-identical to the two prior `actual === price` settlements.** The
requested `1000` was not transferred — the actual on-chain gross was **`9000`**,
the plan's registered price, regardless of the settle-time `maxAmount`
requested.

### Classification: `PAYG_SETTLES_PLAN_PRICE` (matrix item B)

Not `A` (`1000 → 1000`), not `C` (some other transformed value), not `D` (a
positive rejection) — the plan's registered price silently dominates the actual
settlement for this `getPayAsYouGoPriceConfig` + `getPayAsYouGoCreditsConfig()`
shape. This is definitive: `maxAmount` at settle time does **not** control the
actual on-chain charge here.

### Why this matters beyond the probe

This is a **hard incompatibility**, not merely a remaining gap. Registering a
document plan with this exact helper pair at a 190000 price would charge 190000
on every settlement, unconditionally — never 12000, 19000, or 29000, regardless
of measured actual usage. That is exactly the economic misrepresentation this
whole checkpoint exists to prevent. The already- accepted fixed-PAYG
registrations (`web_context_verified.v1` and by extension
`company_evidence_graph.v1`/`verify_agent_output.v1`) are unaffected and remain
correctly accepted: every real settlement for those plans has always requested
`actual === price` by construction (`exact` scheme), so this newly-discovered
behavior never manifested as a defect there and does not change their
acceptance.

A real dynamic plan for `document_evidence_json.v1` would need the SDK's
structurally separate `getDynamicCreditsConfig(creditsGranted, min, max)` helper
together with `registerCreditsPlan`/`registerPlan` — entirely untested by
SITEBORNE. That is a new, separate capability question, not something this
probe's evidence can extend to by inference.

### Declaration update

`packages/protocol-nevermined/src/declarations.ts`: `registration_allowed` stays
`false` for the document plan — now backed by a definitive negative result
rather than an open question. Comment rewritten with the exact on-chain evidence
and reasoning above.

## Outcome

**No document registration has occurred. `registration_allowed=false`,
definitively, for the `getPayAsYouGoPriceConfig`/`getPayAsYouGoCreditsConfig`
helper pair.** `sandbox_capability_verified` remains `false`. Registration under
this specific helper pair should not be retried — it is now disproven, not
merely unproven. The path forward, if pursued, is a separate capability
investigation of `getDynamicCreditsConfig`/ `registerCreditsPlan`, starting from
the same disciplined static-inspection step before any further live mutation.
