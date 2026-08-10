# SITEBORNE Utility Network — ADR 0043: Payment-Identifier Extension and Replay Persistence (SUN-0700A checkpoint 2)

## Context

Directive §6 required using the official x402 Payment-Identifier extension for
external wire-level interoperability rather than inventing a competing
idempotency mechanism, while binding it to SITEBORNE's own stronger,
already-accepted local persistence (SUN-0200's `idempotency_records` D1 table
and `D1IdempotencyRepository`,
`apps/edge-api/src/control-plane/repositories/d1/idempotency.ts`) rather than
creating a second, disconnected idempotency database.

## Decision

**External interoperability layer.** `src/identifier/payment-identifier.ts`
wraps `@x402/extensions/payment-identifier` (the official extension) —
declaration, generation, parsing, and validation all delegate to that package.
Only this one subpath is imported; the parent `@x402/extensions` package's other
subpaths (`sign-in-with-x`, `offer-receipt`, `bazaar`, `builder-code`) depend on
`viem`/`jose`/`tweetnacl`/`@signinwithethereum/siwe`, but `payment-identifier`'s
own compiled chunk imports only `ajv` (verified by inspecting its published
`dist/esm/chunk-*.mjs`) — safe to consume without pulling wallet/crypto code
into this package's actual runtime. `src/tests/no-network.test.ts` statically
asserts no other subpath is ever imported.

The extension's `payment_identifier` string is explicitly treated as **an
idempotency coordinate, not proof of payment** (directive §7) — it is never used
alone as authorization anywhere in this package.

**Internal binding layer.** `src/replay/binding.ts`'s `PaymentAttemptBinding` is
SITEBORNE's own, stronger, typed identity: the external `payment_identifier`
plus quote/requirement/service/
input-hash/resource/scheme/network/asset/amount/payee, and optionally a
`job_id`/`idempotency_key` distinct from the payment identifier itself
(directive §7's "keep these concepts distinct"). `computeBindingDigest`
canonically hashes every one of those fields (reusing
`@siteborne/verification`'s `canonicalize`/`contentHash`); mutating any one of
them changes the digest.

**Persistence.** `src/replay/repository.ts`'s `PaymentAttemptRepository`
interface is modeled directly on the real, already-accepted
`D1IdempotencyRepository` (SUN-0200): an atomic `acquire()` backed by a unique
constraint (the existing `idempotency_records` table already has a unique index
on `idempotency_key` and a `quote_id` column) rather than a separate
SELECT-then-INSERT. This checkpoint does **not** wire a real D1 adapter into
this package — `packages/protocol-x402` intentionally has no
`@cloudflare/workers-types` or D1 runtime dependency, the same
credential-independent/no-facilitator boundary established in ADR 0041 — but the
interface shape means a real D1-backed implementation, whenever a later
checkpoint wires this package into the control-plane HTTP layer, is a thin
adapter over the existing table, not a redesign. No new D1 migration was needed;
the existing schema already models what checkpoint 2 requires.

`InMemoryPaymentAttemptRepository` is the pure, no-network reference
implementation used by every test in this package — a single-threaded critical
section (a chained Promise) around its check-and-insert, providing the same
atomicity guarantee a real unique-constraint INSERT gives under concurrent
callers, proven directly by the concurrency tests in
`src/replay/repository.test.ts` and the corresponding property test in
`src/tests/properties.test.ts` (a payment identifier never acquires two
conflicting owners under concurrent acquisition).

**Classification.** `src/replay/idempotency.ts`'s `acquirePaymentAttempt` is the
one function every caller uses; it returns exactly one of `first_seen` /
`duplicate_same` / `duplicate_conflict` / `already_consumed` / `expired`
(directive §15), derived entirely from comparing binding digests — never from
trusting the external `payment_identifier` alone. Expiry is checked before
duplicate/consumed classification, so an expired identifier is never resurrected
by a later retry that happens to match its old binding (directive §22).

## Consequences

- A real x402 buyer client using the standard `@x402/extensions` client
  utilities (`appendPaymentIdentifierToExtensions`) interoperates with
  SITEBORNE's server-side declaration/parsing out of the box.
- SITEBORNE's own replay protection never depends on the external identifier
  being unique or trustworthy on its own — the full immutable binding is what's
  actually compared.
- Wiring this into the real control plane (a later checkpoint) is additive:
  implement `PaymentAttemptRepository` against `D1IdempotencyRepository` and
  pass real HTTP-derived bindings into `acquirePaymentAttempt` — no redesign of
  the classification logic itself.
- This layer does not, and cannot, claim chain-level nonce or facilitator replay
  guarantees (directive §20) — those remain SUN-0700B's concern.
