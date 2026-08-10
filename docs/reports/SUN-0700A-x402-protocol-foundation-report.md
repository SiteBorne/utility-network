# SUN-0700A — Checkpoints 2, 3 & 4: Upto Authorization, Payment Lifecycle Evidence, and Bazaar Discovery

## Checkpoint 4: Bazaar Discovery Metadata + Signed Offers & Receipts Decision

Builds on checkpoints 1-3 (`0256f34`, `8ac329f`, `e6e2fc4`, `c518106`).
SUN-0700A remains `active`, not `accepted`. No facilitator was contacted, no
live Bazaar was queried, no listing was published, no payment wallet was
configured, no payment was settled, no chain RPC occurred, and no live
middleware/route was implemented anywhere in this checkpoint.

### Part A (mandatory): Bazaar discovery metadata

Existing accepted state was inspected first (directive requirement): the
installed `@x402/core`/`@x402/extensions` baseline (both pinned `2.21.0`), the
`@x402/extensions/bazaar` subpath's compiled implementation (narrow runtime
imports — `ajv/dist/2020.js`, `@x402/core/server`, `url` — verified directly,
matching the `payment-identifier` narrow-import discipline from checkpoint 1-2),
`registry/services/*.json`, `contracts/releases/1.0.0/schemas/...` (frozen
contract schemas), and
`contracts/releases/1.0.0/openapi/ service-contracts.openapi.json` (the real
planned route/method per service, `x-implementation-status: "not_implemented"`
on every path today).

`packages/protocol-x402/src/bazaar/` (new):

- `schema-bundle.ts` — `bundleLocalRefs`, a generic local-`$ref` inliner (fails
  closed on any unresolvable ref); `frozen-inputs.ts` statically imports the
  four frozen input/output schemas plus the two common schemas they `$ref`
  (`money.schema.json`, `authorized-artifact-reference.schema.json`) and bundles
  them — proven identical-modulo-refs to the frozen source and ajv-valid against
  the frozen schema's own `examples[0]` (`frozen-inputs.test.ts`, 20 tests).
  Output schemas are deliberately **not** bundled — all four `$ref` a large
  (55-internal-`$ref`), separately-owned PCC schema; only each output schema's
  own frozen `examples[0]` is used (`output.example`, no `output.schema` — a
  supported, not invented, shape).
- `registry-source.ts`, `routes.ts`, `capability.ts` — statically import
  `registry/services/*.json` and the OpenAPI document; no second manually
  maintained list of service metadata/routes exists.
- `discovery.ts` — `buildSiteborneDiscoveryDeclaration` composes checkpoint
  1-2's
  `buildQuote`/`buildExactPaymentRequirement`/`buildUptoPaymentRequirement` with
  the official `declareDiscoveryExtension`. `document_evidence_json.v1` uses
  `upto` bound at the governance maximum; the other three use `exact` — never
  silently swapped (property-tested). `PAYTO_NOT_CONFIGURED` is a deliberately
  non-address-shaped sentinel (directive §12: no fake wallet presented as
  production-ready); `status: 'not_live'`/`production_enabled: false` are
  literal constants, not caller-settable.
- `validator.ts` — `validateSiteborneDiscoveryResource` layers SITEBORNE
  truthfulness checks over the official `validateDiscoveryExtension`/
  `validateDiscoveryExtensionSpec`; unknown service fails closed.
- `catalog-status.ts` — `BazaarCatalogStatus` type only (directive: no D1 table
  added without genuine need); SUN-0700A can only ever assert `'not_submitted'`
  (`assertCatalogStatusIsEvidenced` throws otherwise).

**Results**: all four services build a valid, locally-validated discovery
declaration (`discovery.test.ts`, 10 tests); 15 adversarial cases fail closed
(`validator.test.ts`); a machine-discovery round trip (`roundtrip.test.ts`, 4
tests) proves an unknown buyer program — using only the official
`extractDiscoveryInfoFromExtension` and `@x402/core` wire-schema functions, zero
SITEBORNE-specific hardcoding — can discover the schema, choose a payment
option, and build a structurally valid request from the declaration alone. 4 new
deterministic-identity property tests (`src/tests/properties.test.ts`) and 2 new
no-network assertions (`src/tests/no-network.test.ts`) extend existing coverage
rather than duplicating it. `fixtures/x402-spec-baseline.json` gained a
`bazaar_extension` entry (package/version/extension-key/dependency baseline)
feeding a new `x402:spec:verify` drift-guard check — the upstream Bazaar
extension is documented as early/evolving, so this check exists specifically to
catch a future incompatible package/type change rather than discovering it
silently. See
[ADR 0048](../decisions/0048-bazaar-discovery-as-canonical-extension.md),
[ADR 0049](../decisions/0049-discovery-truthfulness-boundary.md), and
[X402_BAZAAR_METADATA.md](../operations/X402_BAZAAR_METADATA.md).

### Part B (decision-gated): Signed Offers & Receipts

Formally evaluated against a full rubric (interoperability, implementation
complexity, Cloudflare Workers runtime compatibility, key-isolation quality,
key-rotation story, external verification, domain/service identity binding,
secret-management burden, dependency weight, production deployment dependencies,
PCC overlap, actual value to autonomous buyers today) — **decision C, defer
entirely**: no live route, wallet, facilitator, or deployed `did:web` document
exists yet to make a real offer/receipt meaningful; implementing it now would
only exercise the upstream package's own crypto, not a real SITEBORNE
integration. JWS/Ed25519/`did:web` is recorded as the leading candidate for a
future revisit (aligns with SITEBORNE's existing Ed25519 verification-signer
infrastructure, gives a domain-bound identity explicitly distinct from a payment
wallet, matching the official recommendation) — EIP-712's heavier
`viem`/`secp256k1` surface and lack of a domain-identity story make it the
weaker default. The `offer-receipt` subpath
(`jose`/`viem`/`@noble/curves`/`@scure/base`) is never imported anywhere —
proven by both a static source-grep and a `no-network.test.ts` assertion. The
three receipt classes (x402 settlement/payment response; x402 Signed Offer &
Receipt; SITEBORNE PCC verification receipt) are kept explicitly distinct in
naming and documentation, never merged into one type. See
[ADR 0050](../decisions/0050-signed-offers-and-receipts-decision.md).

### Validation

`packages/protocol-x402` test count: **384** (up from 317; +67 across
`schema-bundle.test.ts`, `frozen-inputs.test.ts`, `discovery.test.ts`,
`validator.test.ts`, `roundtrip.test.ts`, `catalog-status.test.ts`, plus
extensions to `properties.test.ts`/`no-network.test.ts`). `pnpm x402:check`,
`pnpm x402:test:property`, `pnpm x402:fixtures:verify`, `pnpm x402:spec:verify`,
and the full root `pnpm check` all pass with zero regressions. Secret scan
clean. Tree clean at commit time. SUN-0700A remains `active`; SUN-0700B remains
`blocked_external`. Checkpoint 4 is complete; no HTTP route wiring or live
facilitator work was started.

## Checkpoint 3: Payment Lifecycle + External Evidence + SITEBORNE Receipt Linkage

Builds on checkpoints 1-2 and their D1 closure (`0256f34`, `8ac329f`,
`e6e2fc4`). SUN-0700A remains `active`, not `accepted`. No facilitator was
called, no wallet was configured, no blockchain RPC occurred, no real payment
was verified or settled, and no production payment route exists anywhere in this
checkpoint.

### State authority (directive §3, §6)

Before writing any new code, existing control-plane state was inspected and
found to already implement the required payment lifecycle:
`apps/edge-api/src/control-plane/state-machine`'s `JobState` (SUN-0200, already
accepted) already has `PAYMENT_CHALLENGED` / `PAYMENT_VERIFIED` /
`PAYMENT_FAILED` / `SETTLING` / `DELIVERED` / `REFUND_REQUIRED`. **No second,
competing payment state machine was created.** `JobState` remains the sole
authority; SUN-0700A adds gates a caller consults before invoking an existing
`JobState` transition. Full mapping and rationale:
[ADR 0046](../decisions/0046-payment-lifecycle-authority-and-evidence-distinction.md).

### What was built

- **Three-way distinction, never collapsed** (directive §4):
  `src/evidence/verification.ts`'s `canAdvanceToVerified` and
  `src/evidence/settlement.ts`'s `canAdvanceToSettled` — neither ever advances
  merely because a caller set `verified`/`success: true`. Both additionally
  require structural/binding validity and an allowed evidence trust class
  (`src/evidence/policy.ts`); settlement additionally requires its
  `verification_evidence_hash` to match an already-accepted verification
  (settlement-before-verification always fails).
- **Verification/settlement evidence models** (`src/evidence/types.ts`):
  `ExternalVerificationEvidence`/`ExternalSettlementEvidence`, bound to x402
  version/scheme/network/quote/requirement/payment-identifier/payee, with a
  closed `EvidenceTrustClass` (`synthetic_fixture` /
  `locally_derived_structure_only` / `external_unverified` /
  `external_verified`) — SUN-0700A may only ever produce/consume the first two.
- **Exact ordering, confirmed not invented**: verify-before-execute,
  settle-after-execute — already encoded by the existing `JobState` graph (ADR
  0046).
- **Upto two-phase lifecycle**
  ([ADR 0047](../decisions/0047-upto-two-phase-lifecycle-and-receipt-linkage.md)):
  `src/linkage/usage-result.ts`'s `buildUsageResult` throws
  `UsageExceedsAuthorizationError` if actual usage would exceed the
  pre-execution authorization — enforced at construction, never checked after
  the fact.
- **SITEBORNE receipt linkage**: `src/linkage/payment-service-link.ts`'s
  `PaymentServiceLink`, separate from the signed PCC/service receipt,
  referencing it by ID/hash only. `buildPaymentServiceLink` can be called before
  settlement evidence exists; `extendWithSettlement` produces a new link object
  rather than mutating the original — no circular hash dependency.
- **Real D1 lifecycle-stage persistence** (directive §18, §25-28):
  `migrations/0003_payment_lifecycle_stage.sql` adds one `lifecycle_stage`
  column to checkpoint-2's `payment_attempts` table (chosen over a new
  event-sourcing table or reusing `JobState` directly — see ADR 0046's dedicated
  section). `D1PaymentAttemptRepository.transitionLifecycleStage` guards every
  transition at the database layer (`UPDATE ... WHERE lifecycle_stage = ?`,
  checking `meta.changes`) — proven with real Miniflare-backed D1 in
  `apps/edge-api/tests/d1-payment-attempts.test.ts`: illegal transitions
  rejected with state unchanged, and concurrent racing transitions
  (verified→settled ×2; settled vs. settlement_failed) resolve to exactly one
  coherent winner.
- **Synthetic end-to-end lifecycles** (directive §23-24):
  `src/tests/exact-lifecycle.test.ts` and `src/tests/upto-lifecycle.test.ts`
  walk quote → requirement → payload → payment-identifier acquisition →
  verification evidence → (upto: real per-page usage calculation → usage-result)
  → settlement evidence → `PaymentServiceLink` → consumed, proving every
  identity/binding lines up. Synthetic protocol fixtures, never real payments.

### Explicitly not implemented in this checkpoint

Bazaar discovery metadata, the Signed Offers & Receipts extension, any live
facilitator call, wallet configuration, blockchain RPC, or a production-enabled
paid HTTP route. These remain later SUN-0700A checkpoints or SUN-0700B.

### Validation

- `packages/protocol-x402`: **317 tests, 26 files, all pass** (up from 223/18).
  `pnpm x402:check` and `pnpm x402:fixtures:verify` (now 28 scenario-matrix
  rows, including one pointing at the new D1 test file) pass.
- `apps/edge-api/tests/d1-payment-attempts.test.ts`: **27 tests** (up from 19) —
  8 new real-D1 lifecycle-stage tests.
- `migrations:verify` / `d1:test` pass with the new migration applied; the
  existing `payment_attempts` UNIQUE-constraint test and all pre-existing D1
  constraint/transaction/concurrency tests are unaffected.
- Full root `pnpm check` (format/lint/typecheck/test, contracts, migrations, D1,
  control-plane, adapters, document-worker, verification, services-runtime,
  python tests, governance/state/tasks validate, secrets:scan) passes end to
  end.

### No stub counted as complete

Every guard/validator has both an acceptance and a rejection path tested,
including: settlement bound to no verification, or to the wrong verification
hash (both fail); exact under/overpayment; upto exceeding its authorized maximum
(both at the settlement-evidence layer and at `buildUsageResult`'s
construction-time throw); every binding mismatch
(quote/requirement/payment-identifier/scheme/network/asset/payee) for both
evidence types; fixture evidence rejected under `production` mode; illegal
lifecycle-stage transitions and racing concurrent transitions against real D1.

---

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
