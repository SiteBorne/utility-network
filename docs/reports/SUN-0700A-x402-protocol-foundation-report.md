# SUN-0700A — Checkpoint 2: Upto Authorization + Payment-Identifier + Replay/Idempotency Foundation

## Status

Checkpoint 2 of SUN-0700A. SUN-0700A remains `active`, not `accepted`. No CDP
credentials, wallet, facilitator call, blockchain transaction, or production
payment route exists anywhere in this checkpoint. See
[the checkpoint 1 report](SUN-0700A-checkpoint-1-report.md) for the core
protocol foundation this builds on.

## Checkpoint-1 corrections made first (directive §2-4)

1. **Pricing boundary**
   ([ADR 0042](../decisions/0042-x402-pricing-boundary-correction.md)):
   `packages/protocol-x402` no longer reads `governance/RISK_LIMITS.yaml`
   directly. `@siteborne/pricing/src/service-prices.ts` is now the single place
   that owns that file (`resolveServiceMaxPriceUsd`,
   `resolvePricingSourceVersion`, `usdToAtomicUnits`, `PricingKey`, moved
   verbatim, unchanged in behavior). `protocol-x402/src/pricing/mapping.ts` is a
   thin re-export. A regression test (`src/pricing/mapping.test.ts`) asserts the
   re-exported functions are the exact same function objects
   `@siteborne/pricing` exports (`toBe`), and that a real x402 quote's `amount`
   equals `@siteborne/pricing`'s own canonical conversion. A static source audit
   (`src/tests/no-network.test.ts`) asserts no file in this package ever calls
   `readFileSync`/`new URL` against `RISK_LIMITS`.
2. **Quote-binding audit** (directive §3): the checkpoint-1 quote binding was
   missing `x402_version` entirely. Fixed — `QuoteInput.x402_version` defaults
   to `SUPPORTED_X402_VERSION` and is always part of the binding hash. Added
   `pricing_source_version` (the governance document's own `version` field) as
   an optional additional bound field. All of directive §3's required
   regressions are now explicit tests: same resource + different input →
   different quote; same input + different service → different quote; same
   input/service + different contract release → different quote.
3. **SITEBORNE network-subset terminology** (directive §4):
   `src/network/schemes.ts` now explicitly documents and exposes
   `SITEBORNE_SUPPORTED_X402_SCHEMES` as SITEBORNE's own launch-scoped subset —
   `exact` on `eip155`/`solana` is a **SITEBORNE product decision**, not a
   description of upstream x402's full capability surface (upstream supports
   substantially more network families, docs.x402.org/schemes/exact). `upto`'s
   EVM-only restriction remains documented as a real upstream constraint, not a
   SITEBORNE narrowing.

## What was built (checkpoint 2 objective, directive §5)

- **Real `upto` protocol-domain support** (`src/requirements/upto.ts`):
  `buildUptoPaymentRequirement` builds the official `PaymentRequirements` wire
  shape whose `amount` is the **authorized maximum**;
  `validateUptoRequirementBinding` validates a candidate against its quote;
  `validateUptoAuthorization` bridges an authorization to a proposed actual
  charge, returning a closed structural outcome (`valid` /
  `actual_exceeds_maximum` / `requirement_mismatch` / `quote_mismatch` /
  `resource_mismatch` / `unsupported_network` / `invalid_amount` / `expired`) —
  never claiming cryptographic/settlement verification.
  `isCanonicalAtomicAmount` rejects any non-canonical amount string (negative,
  decimal, scientific notation, leading `+`, leading zero) — amounts are never
  parsed via `Number()`.
- **Payment-Identifier extension integration**
  (`src/identifier/payment-identifier.ts`): wraps the official
  `@x402/extensions/payment-identifier` — declaration, generation, parsing,
  validation. Only this one subpath is imported (verified to import just `ajv`
  at runtime, not the parent package's viem/jose/tweetnacl/siwe dependencies
  used by other subpaths).
- **Deterministic payment idempotency** (`src/replay/binding.ts`,
  `src/replay/idempotency.ts`): a typed `PaymentAttemptBinding` distinct from
  the bare `payment_identifier` (directive §7); `acquirePaymentAttempt`
  classifies every attempt as `first_seen` / `duplicate_same` /
  `duplicate_conflict` / `already_consumed` / `expired`.
- **Replay detection**: proven across service/input/quote/amount/resource
  mutation (directive §20), and specifically regression-tested through
  checkpoint 1's exact requirements (directive §24) and a full upto replay
  matrix (directive §25).
- **Authoritative local persistence/concurrency** (`src/replay/repository.ts`):
  `PaymentAttemptRepository` modeled on the real SUN-0200
  `D1IdempotencyRepository`; `InMemoryPaymentAttemptRepository` reference
  implementation with a proven atomic `acquire()` under concurrent callers. No
  new D1 migration — the existing `idempotency_records` schema already had what
  was needed.
- **Document service usage mapping** (`src/pricing/document-usage.ts`): maps
  `document_evidence_json.v1`'s per-page pricing modes (native/OCR/table, capped
  at `document_evidence_json_max_job`) into a deterministic usage calculation
  from page metrics, through `@siteborne/pricing` — never duplicating price
  constants, never settling anything.
- **Authorization vs. usage binding**
  ([ADR 0044](../decisions/0044-upto-authorization-vs-usage-binding.md)): the
  pre-execution buyer authorization (bound to the authorized maximum) and the
  post-execution measured usage are explicitly two different bindings — the
  authorization can never depend on a not-yet-known final usage number.
- **Exact/upto separation** (`src/tests/exact-upto-separation.test.ts`,
  directive §12): an exact requirement builder rejects upto quotes and vice
  versa; an exact payload against an upto quote (and vice versa) is rejected by
  `validatePaymentPayloadStructure`; scheme is bound into `quote_id` so a quote
  cannot silently migrate between schemes.

## Explicitly not implemented in this checkpoint

Facilitator verification, settlement, settlement evidence, a payment state
machine beyond the replay/idempotency states needed here, Bazaar, Signed
Offers/Receipts, production HTTP payment middleware. These remain later
SUN-0700A checkpoints or SUN-0700B.

## Validation

- `pnpm x402:check`: **223 tests, 18 files, all pass** (up from 106/11).
  Includes property tests (11), adversarial tests (17 in the dedicated file plus
  scheme/upto/replay-specific adversarial coverage across module test files),
  and the no-network/no-credential static audit (5 assertions, including a new
  check that only `@x402/extensions/payment-identifier` is ever imported).
- `pnpm x402:fixtures:verify`: confirms the updated spec baseline
  (`@x402/extensions` entry added) is internally consistent with what is
  installed.
- Full root `pnpm check` (format/lint/typecheck/test, contracts, migrations, D1,
  control-plane, adapters, document-worker, verification, services-runtime,
  python tests, governance/state/tasks validate, secrets:scan) passes end to
  end.
- `pnpm migrations:verify` / `pnpm d1:test` pass unchanged — no migration was
  added or modified.

## No stub counted as complete

Every module has real logic and real test coverage exercising both success and
rejection paths, including: upto's `actual < max` / `actual == max` /
`actual > max` boundary; payment-identifier required/absent/malformed/oversized
cases; first_seen/duplicate_same/ duplicate_conflict/already_consumed/expired
for both exact and upto replay; 20-way and mixed-binding concurrency; document
usage across native/OCR/table-heavy/multi-page/max-job-ceiling scenarios;
prototype pollution and huge-atomic-amount adversarial inputs.
