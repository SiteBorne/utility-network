# SUN-0900B Checkpoint 2B — Dynamic Unit-Economics Audit + Registration Timeout Reconciliation

`controlled_sandbox_self_test`: independent_customer=false, revenue=false,
open_market_purchase=false, production_ready=false, production_enabled=false.

Committed baseline going into this turn: `658c559` (Checkpoint 2A). This turn
performed **zero Nevermined mutations** — `registerAgentAndPlan`/
`registerCreditsPlan`/`registerPlan` were never called. Two read-only GET
listings (builder key) and two public, unauthenticated on-chain lookups (Base
Sepolia block explorer) were made.

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

## Outcome

Registration state is now positively known (`NO_MATCH`, zero mutation this
checkpoint). Dynamic unit economics are conservatively classified
`DYNAMIC_UNIT_MAPPING_UNPROVEN` and `registration_allowed` reflects that
honestly. The harness timeout defect is fixed without weakening reconciliation
safety or issuing a second registration call. **No document registration has
occurred. `registration_allowed=false`. Not safe to retry registration in this
turn or the next without new positive evidence closing the `actual < price`
gap** — most directly obtainable either by inspecting an authoritative
Nevermined source (backend/contract) for how a below-price settle is handled
under this credits-config shape, or by a live-gated proof explicitly scoped to
that single question, separately authorized.
