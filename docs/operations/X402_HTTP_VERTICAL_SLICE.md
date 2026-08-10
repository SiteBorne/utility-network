# x402 HTTP Vertical Slice (`apps/edge-api`, SUN-0700A checkpoint 5)

**Everything in this document is a synthetic, credential-independent protocol
exercise. No facilitator was called, no wallet was configured, no chain RPC
occurred, no real payment was settled, and no revenue exists from this
checkpoint. `production_ready`/`production_enabled` remain `false` throughout.
SUN-0700B owns live verification and settlement.**

## What this checkpoint built

`apps/edge-api/src/control-plane/routes/x402-service.ts`'s
`createX402ServiceRoute` — one reusable route boundary — wires the
already-accepted x402 protocol (checkpoints 1-2), replay/lifecycle persistence
(checkpoints 2-3), Bazaar discovery (checkpoint 4), and
`@siteborne/service-runtime`'s fixture-mode services through a real Hono HTTP
surface, exercised against real D1/Miniflare
(`apps/edge-api/tests/x402-service-route.test.ts`).
`apps/edge-api/src/control-plane/routes/paid-services.ts` wires all four frozen
services onto it, at their real accepted OpenAPI paths.

See [ADR 0051](../decisions/0051-http-vertical-slice-architecture.md) for the
architecture and the `@x402/hono` decision (not used — its resource server
intrinsically requires a facilitator client).

## The full synthetic flow

```
POST /v1/<service>              (no PAYMENT-SIGNATURE)
  -> input validated against the frozen contract schema
  -> quote + payment requirement built and persisted (x402_quotes)
  -> 402, PAYMENT-REQUIRED header, Payment-Identifier extension declared

POST /v1/<service>              (PAYMENT-SIGNATURE echoing accepts[0])
  -> decoded, structurally validated against the persisted quote
  -> Payment-Identifier extracted, acquired against real D1
     (D1PaymentAttemptRepository — first_seen / duplicate_same /
     duplicate_conflict / already_consumed / expired / repository_error)
  -> [first_seen only] one logical `jobs` row created
     (idempotency_key = payment identifier), driven through the existing
     JobState transition graph (SUN-0200) — never a second state machine
  -> FixturePaymentEvidenceProvider.verify() -> canAdvanceToVerified gate
  -> executeLocalService() (SUN-0600's own boundary, never bypassed)
  -> [upto only] real per-page usage calculation -> buildUsageResult
     (throws UsageExceedsAuthorizationError if it would exceed the
     authorized maximum)
  -> FixturePaymentEvidenceProvider.settle() -> canAdvanceToSettled gate
  -> PaymentServiceLink built, extended with settlement evidence
  -> result persisted (X402ServiceResultRepository) for retry
     reconstruction, payment attempt marked consumed
  -> 200, PAYMENT-RESPONSE header, service output + receipt_id + link_id
```

## Mounting: opt-in only

`/v1/*` is mounted in `apps/edge-api/src/index.ts` behind an explicit
`PAID_ROUTES_ENABLED === 'true'` gate (an additive, optional `Env` field — unset
everywhere today). Absent that flag, `/v1/*` is a plain 404 — no default
configuration exposes it. `evidenceMode` is hardcoded `'fixture'` in that
wiring; `resolvePaymentEvidenceProvider('production', ...)` always throws
regardless of what a caller supplies (checkpoint's own
`FixturePaymentEvidenceProvider` cannot satisfy production mode by
construction).

## Fixture-mode service wiring

Each service's `ServiceExecutor` closure uses the exact same canned adapter
fixtures `packages/service-runtime/scripts/verify-fixtures.ts` already uses for
its own accepted `*-success` scenarios (real SEC EDGAR JSON for
`company_evidence_graph.v1`, a canned HTML page for `web_context_verified.v1`,
the real `native-text-success.json` `WorkerResult` for
`document_evidence_json.v1`, no adapter needed for `verify_agent_output.v1`) —
never a hand-rolled approximation. This checkpoint proves the
payment/lifecycle/linkage boundary drives real service execution correctly, not
that these four services can process arbitrary live buyer input (that remains
each service's own existing, independently-proven fixture-mode behavior).

`document_evidence_json.v1`'s route therefore only reaches
`result_class: 'success'` for the one pre-seeded fixture artifact reference
(`artifact_id: 'doc/native-fixture.pdf'`).

## What survives real D1/repository recreation

`payment_attempts` (checkpoint 2), `jobs`/`job_state_events` (SUN-0200),
`x402_quotes` and `x402_service_results` (this checkpoint, migration 0004) are
all real D1 tables — proven by tests that build a brand-new
`buildPaidServicesApp` instance sharing the same D1 database and confirm a
payment already consumed by the first instance is recognized
(`already_consumed`) and its exact original result reconstructed, never
re-executed.

## Two real defects this checkpoint's D1 integration surfaced and fixed

Both were pre-existing SUN-0200-era code paths that had never actually been
exercised via a real loader/typechecker before this checkpoint (the package's
`typecheck` script is a documented no-op):

1. Every file in `apps/edge-api/src/control-plane/repositories/d1/` imported
   `../interfaces`/`../types` using paths one directory level too shallow
   (`./interfaces`/`../types`) — a real, silent module resolution bug, invisible
   until something actually loaded these modules. Fixed by correcting the
   relative depth in every affected file.
2. `D1ServicesRepository.create` and `D1JobsRepository.create` only detected a
   UNIQUE-constraint violation on the `result.success === false` path — but real
   D1/Miniflare throws a JS exception on that violation instead (the same defect
   class ADR 0045 already documented and fixed for
   `D1PaymentAttemptRepository`). Fixed by adding the same detection to each
   `catch` block.

## Explicitly not this checkpoint

A live facilitator, a real wallet, chain RPC, real settlement, revenue, Bazaar
catalog submission, or Signed Offers & Receipts. See
[X402_PROTOCOL.md](X402_PROTOCOL.md) for the full checkpoint history.
