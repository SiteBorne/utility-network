# Payment Replay Protection (`@siteborne/protocol-x402`)

**No settlement occurs anywhere in this document's scope.** Everything here is
credential-independent, local, and offline-testable —
`src/tests/no-network.test.ts` proves it.

## Two identifiers, kept distinct (directive §6)

- **`payment_identifier`** — the official x402
  [Payment-Identifier extension](https://docs.x402.org/extensions/payment-identifier)
  value (`@x402/extensions/payment-identifier`, wrapped by
  `src/identifier/payment-identifier.ts`). This is an **idempotency coordinate
  the buyer supplies, not proof of payment**. It is 16–128 characters,
  `[a-zA-Z0-9_-]+`.
- **SITEBORNE's immutable payment-attempt binding** (`src/replay/binding.ts`'s
  `PaymentAttemptBinding`) — a canonical digest over `payment_identifier` PLUS
  `quote_id`, `requirement_id`, `service_id`, `service_version`,
  `contract_release`, `request_input_hash`, `resource_id`, `scheme`, `network`,
  `asset`, `amount`, `payee`, and optionally `job_id`/`idempotency_key`.

SITEBORNE's replay/idempotency decisions are made **only** by comparing binding
digests — the external `payment_identifier` alone is never trusted as
authorization.

## Classification (directive §15)

`acquirePaymentAttempt()` (`src/replay/idempotency.ts`) returns exactly one of:

| Status               | Meaning                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `first_seen`         | New payment identifier, no prior record.                                                                                                                            |
| `duplicate_same`     | Same identifier + identical immutable binding — a **legitimate retry**.                                                                                             |
| `duplicate_conflict` | Same identifier + ANY changed immutable field — **never** treated as a safe retry.                                                                                  |
| `already_consumed`   | The attempt already fulfilled its logical resource/job.                                                                                                             |
| `expired`            | The record's validity window has passed. Checked before duplicate/consumed classification, so an expired identifier is never resurrected by a later matching retry. |

## Persistence (directive §17-18, §27)

`src/replay/repository.ts`'s `PaymentAttemptRepository` interface is modeled
directly on the real, already-accepted SUN-0200 `D1IdempotencyRepository`
(`apps/edge-api/src/control-plane/repositories/d1/idempotency.ts`): an atomic
`acquire()` backed by a unique constraint (the existing `idempotency_records` D1
table already has a unique index on `idempotency_key` and a `quote_id` column),
not a separate check-then-insert. **No new D1 migration was added** — the
existing schema already models what this checkpoint needs.
`packages/protocol-x402` itself has no D1/Cloudflare Workers runtime dependency
(see
[ADR 0043](../decisions/0043-x402-payment-identifier-and-replay-persistence.md));
`InMemoryPaymentAttemptRepository` is the pure reference implementation every
test in this package uses.

## Concurrency (directive §19)

`InMemoryPaymentAttemptRepository.acquire()` serializes overlapping calls
through a chained-Promise critical section, giving the same atomicity guarantee
a real unique-constraint `INSERT` provides. Proven directly: 20 concurrent
`acquire()` calls for the same new identifier + same binding → exactly 1
`acquired`, 19 `conflict`; concurrent calls with conflicting bindings for the
same identifier → at most one legitimate owner, the rest `duplicate_conflict`. A
property test additionally proves a payment identifier never acquires two
conflicting owners across randomized concurrent attempts.

## Retry semantics (directive §21)

A **legitimate retry** preserves every immutable binding field. Mutable
operational metadata (an HTTP transport request ID, an attempt timestamp,
tracing metadata) is deliberately outside the binding and never affects
classification. A network retry with the same payment ID and the same binding is
`duplicate_same`; any changed business field (amount, service, input hash,
resource, quote, requirement) is `duplicate_conflict`.

## Scope not covered here

This layer does not, and cannot, claim chain-level nonce or facilitator replay
guarantees — that is SUN-0700B's concern once a real facilitator exists.
