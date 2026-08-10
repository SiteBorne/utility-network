# 0052 — `PaymentEvidenceProvider` widened to carry real facilitator inputs

**Status:** accepted **Context:** SUN-0700B checkpoint 1 preflight closure
(credential-independent architecture correction). SUN-0700B itself remains
`blocked_external`; this ADR does **not** activate it.

## Context

SUN-0700A checkpoint 5 ([ADR 0051](0051-http-vertical-slice-architecture.md))
introduced `PaymentEvidenceProvider` as the seam a paid HTTP route calls through
for verification/settlement evidence, and `PaymentEvidenceContext` as its input
— bare identity/binding metadata (`quote_id`, `requirement_id`,
`payment_identifier`, `scheme`, `network`, `asset`, `payee`, `amount`,
timestamps). That was sufficient for `FixturePaymentEvidenceProvider`, which
never inspects a real payload at all.

The SUN-0700B checkpoint 1 read-only preflight (credential/config inspection
only, no network call) found this insufficient for a _real_ provider: a real
facilitator's `/verify` and `/settle` operations require the official
`VerifyRequest`/`SettleRequest` shape —
`{ x402Version, paymentPayload, paymentRequirements }` (`@x402/core`'s own
types, already re-exported by `@siteborne/protocol-x402`'s `types.ts`). Neither
the signed `PaymentPayload` the buyer echoed back nor the exact
`PaymentRequirements` it was checked against ever reached the provider boundary
— `apps/edge-api`'s `x402-service.ts` decoded/built both internally and then
discarded them before calling `evidenceProvider.verify()`.

This is exactly the kind of defect to fix while still credential-independent: no
real provider can be built against the old interface no matter what credentials
or facilitator client it wraps, so widening the interface first — proven with
local test doubles, no network, no CDP — keeps the architectural correction
separable from live external debugging (SUN-0700B's own next checkpoint).

## Decision

1. **`PaymentVerificationContext`/`PaymentSettlementContext`** (new, additive)
   extend `PaymentEvidenceContext` with `paymentPayload: PaymentPayload` and
   `paymentRequirements: PaymentRequirements` — `PaymentSettlementContext`
   additionally carries an optional `usageResult: UsageResult` for `upto`-scheme
   settlements. `PaymentEvidenceProvider.verify()` /`.settle()` now take these
   instead of the bare context. `PaymentEvidenceContext` itself is unchanged and
   still the type `canAdvanceToVerified`/`canAdvanceToSettled` (the trust-class
   state guards) consume — this ADR only widens what the _provider_ sees, not
   the state-machine gates.

2. **Object identity, not reconstruction.**
   `apps/edge-api/src/control-plane/ routes/x402-service.ts` now passes the
   _exact_ `payload` (decoded by `decodePaymentSignatureHeaderSafe`) and
   `payload.accepted` — the precise object `validatePaymentPayloadStructure`
   already checked field-by-field against the stored quote — into both contexts.
   Never a second decode, never a `stored.requirement`-based reconstruction that
   could silently diverge from what the buyer actually sent. Proven by an
   HTTP-level regression
   (`apps/edge-api/tests/x402-evidence-provider-boundary.test.ts`) using a local
   recording provider double, for both `exact` and `upto` routes — no network,
   no facilitator.

3. **Ephemeral payload discipline.** `paymentPayload` carries signed payment
   authorization material. Nothing in `@siteborne/protocol-x402` or
   `apps/edge-api` persists it to D1, folds it into `PaymentServiceLink`, writes
   it to an audit event, a fixture, a report, or an error — only the
   pre-existing hash/id fields those artifacts already bind to
   (`raw_evidence_hash`, `verification_evidence_hash`, etc.). A caller wiring a
   real provider is responsible for the same discipline inside that provider;
   this package can widen the seam but cannot enforce what a future
   implementation does with the reference once handed to it.

4. **`providerKind` replaces `instanceof` for provider selection.**
   `PaymentEvidenceProvider` now declares
   `readonly providerKind: 'fixture' | 'external'`.
   `FixturePaymentEvidenceProvider.providerKind = 'fixture'`.
   `resolvePaymentEvidenceProvider(mode, provider?)`:

   - `mode: 'fixture'` → returns the supplied provider, or a fresh
     `FixturePaymentEvidenceProvider` if none was given (unchanged behavior).
   - `mode: 'production'` → throws
     `ProductionEvidenceProviderNotConfiguredError` unless
     `provider.providerKind === 'external'`.

   Selecting an `'external'` provider is **necessary but not sufficient** for a
   payment to advance state: the evidence it returns must still separately pass
   the existing trust-class gate (`canAdvanceToVerified`/`canAdvanceToSettled`
   via `isTrustClassAllowed`,
   [ADR 0046](0046-payment-lifecycle-authority-and-evidence-distinction.md)),
   unchanged by this ADR. `packages/protocol-x402/src/evidence/provider.test.ts`
   proves the composition explicitly: an `'external'`-kinded provider that
   (mis)produces `synthetic_fixture`, `locally_derived_structure_only`, or
   `external_unverified` evidence is still rejected by the production trust
   gate; only `external_verified` evidence from an `'external'` provider passes
   both layers.
   `resolvePaymentEvidenceProvider('production', new FixturePaymentEvidenceProvider())`
   still throws — a fixture provider can never satisfy production no matter how
   it's wrapped.

## What this ADR does **not** do

- Does not implement `@coinbase/cdp-sdk`, a `CdpPaymentEvidenceProvider`, or any
  facilitator client. No new runtime dependency was added.
- Does not call `/supported`, `/verify`, or `/settle` against any real endpoint.
  No network I/O occurred anywhere in this change.
- Does not read, use, or require any CDP credential. `CDP_API_KEY_ID`/
  `CDP_API_KEY_SECRET`/`CDP_WALLET_SECRET` remain absent from this repository
  and from the agent execution environment that authored this change.
- Does not activate SUN-0700B, change `production_enabled`/ `production_ready`,
  or claim any live settlement occurred.

## Consequences

- A future `CdpPaymentEvidenceProvider` (SUN-0700B's own next checkpoint) can be
  built against this interface without another breaking change to it — it
  receives everything a real `VerifyRequest`/`SettleRequest` needs and declares
  `providerKind: 'external'` to become eligible for `production` mode selection.
- All SUN-0700A HTTP/lifecycle/replay/linkage behavior is unchanged;
  `FixturePaymentEvidenceProvider` still only ever produces `synthetic_fixture`
  evidence and still cannot satisfy `production` mode.
