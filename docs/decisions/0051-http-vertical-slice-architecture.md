# SITEBORNE Utility Network — ADR 0051: HTTP Vertical Slice Architecture and the `@x402/hono` Decision (SUN-0700A checkpoint 5)

## Context

Checkpoint 5 required wiring the already-accepted x402 protocol,
replay/lifecycle persistence, service-runtime, and PCC verification through a
real Hono HTTP boundary, exercised locally against real D1 — without a
facilitator, wallet, or live payment. Directive §3/§34 required inspecting
`@x402/hono` first and recording whether it was used.

## `@x402/hono` — inspected, not used

`@x402/hono@2.21.0` was pulled and its type declarations inspected directly
(`npm pack`). Its only entry points —
`paymentMiddleware`/`paymentMiddlewareFromHTTPServer`/
`paymentMiddlewareFromConfig` — each require either a pre-built
`x402ResourceServer` (whose constructor takes a `FacilitatorClient`) or a
`facilitatorClients` argument directly, and default
`syncFacilitatorOnStart: true` (a startup-time facilitator sync call). There is
no code path through this package's public API that produces
verification/settlement without a facilitator client object — injecting a
fixture-only substitute would mean either implementing a fake
`FacilitatorClient` (functionally identical to building our own boundary, but
wrapped in a shape designed around a real one) or fighting the package's own
coupling.

**Decision: do not use `@x402/hono`.** SITEBORNE's thin Hono route boundary
(`apps/edge-api/src/control-plane/routes/x402-service.ts`) is built directly
over `@x402/core`'s wire types and `@siteborne/protocol-x402`'s own
codecs/builders — the same official wire formats `@x402/hono` itself uses
underneath, never a second hand-rolled format. This matches directive §34's
explicit fallback instruction.

## One reusable route boundary, not four handlers

`createX402ServiceRoute(config)` is the single factory every one of the four
paid routes is built from (directive §4). Per-service variation (scheme, pricing
key, input schema, and — critically — how to actually execute the underlying
service, since the four services have entirely different adapter/fixture wiring)
is captured in a small `ServiceExecutor` callback each route supplies; the
factory owns everything else: input validation, quote/requirement construction,
the 402 challenge, PAYMENT-SIGNATURE decoding, Payment-Identifier acquisition
against real D1, the verification/settlement evidence gates, the existing
`JobState` lifecycle transitions, `PaymentServiceLink` construction, and the
PAYMENT-RESPONSE.

## Quote persistence: a new `x402_quotes` table

A quote/requirement minted at 402-issue time must survive to the buyer's later
retry. Cloudflare Workers are stateless per request, so this cannot live in
memory. The pre-existing `payment_quotes` table (migration 0001) is not reused —
see `migrations/0004_x402_quotes.sql`'s header comment for the two reasons (a
`job_id NOT NULL` FK incompatible with pre-job quote issuance, and a column
shape modeling a different, never-wired-up CDP-facilitator-era concept).
`x402_quotes` stores the exact canonical `Quote`/`PaymentRequirements` JSON
`buildQuote`/ `buildExactPaymentRequirement`/`buildUptoPaymentRequirement`
produced — never a re-derived approximation.

## Logical job / exactly-once execution: reusing `JobsRepository`/`JobState`, not replacing it

Each first-seen payment attempt creates exactly one `jobs` row (SUN-0200,
already accepted), using the payment identifier as the job's `idempotency_key` —
`D1JobsRepository.create` already enforces a UNIQUE constraint on that column,
so job creation itself is a second, independent enforcement of "exactly one job
per payment identifier" beneath `payment_attempts`' own D1 UNIQUE constraint
(checkpoint 2 closure). The route boundary drives the job through the existing
`JobState` transition graph
(`RECEIVED → VALIDATED → QUOTED → PAYMENT_CHALLENGED → PAYMENT_VERIFIED → LOCKED → ROUTED → EXECUTING → VERIFYING → SETTLING → DELIVERED`,
or a failure branch) using the already-accepted
`createStateEvent`/`isValidTransition` — no new state machine, no shortcut
around `AllowedTransitions`.

Service execution goes through service-runtime's already-accepted
`executeLocalService(registry, serviceId, input, context)` — never a direct call
to a service's `execute()` method, preserving the SUN-0600
timeout/audit/closed-result boundary.

## Retry reconstruction: the existing `ArtifactsRepository`, not a new cache

A successful execution's output/receipt/link summary is persisted via
`ArtifactsRepository.create` (SUN-0200, already accepted), keyed by `job_id`. A
retry with the same Payment-Identifier and identical binding (`duplicate_same`)
or an already-`consumed` attempt looks up the job by `payment_attempts.job_id`,
and — if `DELIVERED` — reconstructs the original response from that artifact,
rather than re-executing the service or introducing a process-local cache
(directive §14).

## Consequences

- No facilitator client, wallet, chain RPC, or live Bazaar/DID call exists
  anywhere in the route boundary — proven by an extended no-network test.
- `production_enabled` stays `false` at every layer: the route module itself
  refuses to mount if asked to enable payment execution without
  `PAID_ROUTES_ENABLED` explicitly set, and `resolvePaymentEvidenceProvider`
  (`packages/protocol-x402/src/evidence/provider.ts`) refuses `production`
  evidence mode unconditionally (no production provider exists to satisfy it).
- All exactly-once, replay, and lifecycle invariants this checkpoint depends on
  were already proven independently by real D1 tests in checkpoints 2-3; this
  checkpoint's own tests prove the HTTP boundary _drives_ those primitives
  correctly, not that the primitives themselves are newly correct.
