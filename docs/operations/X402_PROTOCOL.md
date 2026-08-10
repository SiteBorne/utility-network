# x402 Protocol (`@siteborne/protocol-x402`)

SITEBORNE's credential-independent x402 V2 payment protocol foundation
(SUN-0700A). No facilitator client, no wallet, no settlement, no CDP credentials
exist anywhere in this package — see `src/tests/no-network.test.ts` for the
standing proof. Real facilitator verification/settlement is SUN-0700B's
exclusive concern.

## Spec baseline

Targets x402 **V2** (`PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE`/`PAYMENT-RESPONSE`
headers). Built on the official `@x402/core` (wire types/schemas) and
`@x402/extensions` (`payment-identifier` idempotency extension, `bazaar`
discovery extension) packages — never a hand-maintained reimplementation where
an official type exists. See `fixtures/x402-spec-baseline.json` and
[ADR 0041](../decisions/0041-x402-v2-protocol-boundary.md) for exactly which
upstream packages/versions this is pinned against and why the heavier
`x402`/`@coinbase/x402` packages (and the `offer-receipt` subpath — see
ADR 0050) were not used.

## Checkpoints (all credential-independent; SUN-0700A remains `active`, not `accepted`)

| Checkpoint | Commit            | What it built                                                                                                                                                        |
| ---------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | `0256f34`         | Core V2 types, `exact` requirements, header codecs, payload structural validation, deterministic quotes.                                                             |
| 2          | `8ac329f`         | `upto` authorization, official Payment-Identifier extension, replay/idempotency classification (in-memory).                                                          |
| 2 closure  | `e6e2fc4`         | Real D1-backed payment-attempt replay persistence, proving the checkpoint-2 semantics hold under real concurrency.                                                   |
| 3          | `c518106`         | Payment lifecycle evidence gates (verification vs. settlement, never collapsed), usage-result and `PaymentServiceLink` binding, real D1 lifecycle-stage persistence. |
| 4          | (this checkpoint) | Local Bazaar discovery metadata for all four services (mandatory); Signed Offers & Receipts evaluated and deliberately deferred (decision-gated).                    |

## Where to read more

- [PAYMENT_QUOTES.md](PAYMENT_QUOTES.md) — deterministic quote/requirement
  identity and pricing integration.
- [PAYMENT_REPLAY_PROTECTION.md](PAYMENT_REPLAY_PROTECTION.md) —
  Payment-Identifier, immutable binding digests, `first_seen`/
  `duplicate_same`/`duplicate_conflict`/`already_consumed`/`expired`
  classification, D1 persistence and concurrency.
- [PAYMENT_LIFECYCLE.md](PAYMENT_LIFECYCLE.md) — the state authority (existing
  `JobState`, SUN-0200), the structural/verification/settlement distinction,
  evidence trust classes, exact and upto ordering.
- [PAYMENT_SERVICE_LINKAGE.md](PAYMENT_SERVICE_LINKAGE.md) —
  `PaymentServiceLink`, the immutable payment-attempt ↔ service-receipt chain.
- [X402_BAZAAR_METADATA.md](X402_BAZAAR_METADATA.md) — local Bazaar discovery
  declarations, truthfulness boundary, drift guard.
- [SUN-0700A-checkpoint-1-report.md](../reports/SUN-0700A-checkpoint-1-report.md),
  [SUN-0700A-x402-protocol-foundation-report.md](../reports/SUN-0700A-x402-protocol-foundation-report.md)
  — detailed per-checkpoint acceptance evidence.

## Explicitly not yet implemented

Bazaar _facilitator cataloging_ (only local declaration + local validation exist
— see [ADR 0049](../decisions/0049-discovery-truthfulness-boundary.md)), the
Signed Offers & Receipts extension (evaluated and deferred — see
[ADR 0050](../decisions/0050-signed-offers-and-receipts-decision.md)), live
facilitator verification/settlement, wallet configuration, and any
production-enabled paid HTTP route. `production_ready`/`production_enabled`
remain `false` throughout.
