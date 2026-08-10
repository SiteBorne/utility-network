# SUN-0700A — Checkpoint 1: x402 V2 Core Protocol

## Status

**Checkpoint 1 of SUN-0700A.** SUN-0700A remains `active`, not `accepted`. No
CDP credentials, wallet, facilitator call, blockchain transaction, or production
payment route exists anywhere in this checkpoint. This report documents exactly
what checkpoint 1 completed and what remains.

## What was built

`packages/protocol-x402` — replacing the SUN-0001 placeholder package (which had
no source, only a `"planned"` `package.json`) — implements:

- **Spec baseline recording** (`fixtures/x402-spec-baseline.json`): the current
  official x402 V2 material was fetched directly
  (`docs.x402.org/core-concepts/http-402`,
  `getting-started/quickstart-for-sellers`, `extensions/payment-identifier`) and
  three npm packages were inspected directly (`npm view`/`npm pack`, reading
  published `.d.ts` files) rather than assumed. `@x402/core@2.21.0` — whose only
  dependency is `zod` — was selected as the wire-type/schema source;
  `x402@1.2.0` and `@coinbase/x402@2.1.0` (which bundle
  viem/wagmi/solana-kit/CDP SDK) were evaluated and explicitly not used. See
  [ADR 0041](../decisions/0041-x402-v2-protocol-boundary.md).
- **Protocol version binding** (`src/version.ts`): `SUPPORTED_X402_VERSION` is
  read from `@x402/core`'s own exported `x402Version` constant; every entry
  point explicitly rejects a schema-valid V1 payload as `unsupported_version`.
- **Canonical types** (`src/types.ts`, `src/canonical.ts`): re-exports
  `@x402/core`'s official V2 types; reuses `@siteborne/verification`'s
  `canonicalize`/`contentHash` rather than a second canonical-JSON
  implementation.
- **`exact` payment requirements** (`src/requirements/exact.ts`): builds the
  official `PaymentRequirements` wire shape bound to a quote + resource;
  validates a candidate against that binding field-by-field
  (amount/asset/network/payee/expiry).
- **`PAYMENT-REQUIRED` challenge builder**
  (`src/challenge/payment-required.ts`): bounded `accepts[]` (≤8, no
  duplicates), validated against `@x402/core`'s own `isPaymentRequiredV2` schema
  guard before ever being returned.
- **All three V2 header codecs** (`src/codec/headers.ts`): bounded (64 KiB
  decoded), prototype-pollution-safe Base64/JSON decode wrapping `@x402/core`'s
  own non-throwing `parsePaymentRequired`/`parsePaymentPayload` safe-parsers —
  `@x402/core`'s own `http` module decoders were inspected in their published
  build and found to throw on bad input, have no size bound, and skip runtime
  schema validation; this module fixes all three. No upstream Zod schema exists
  for `SettleResponse` (`PAYMENT-RESPONSE`) — the one schema this package
  hand-maintains.
- **Payment-payload structural parser** (`src/payload/parser.ts`): version,
  scheme, network, quote, resource, and expiry checks — never claims
  `payment_verified` (that is SUN-0700B).
- **Deterministic quote identity** (`src/quote/quote.ts`): canonical-hash
  `quote_id` over service/version/contract_release/input_hash/pricing_key/
  scheme/network/asset/amount/payee/issued_at/expires_at; mutating any bound
  field changes the ID (proven by property test).
- **Pricing integration** (`src/pricing/mapping.ts`): reads
  `governance/RISK_LIMITS.yaml`'s `max_price_usd_per_service` directly (no
  duplicated price constants); converts through `@siteborne/pricing`'s
  decimal-safe `usdToMicro`, never binary floating point.
- **Scheme/network support matrix** (`src/network/schemes.ts`): `exact` on every
  recognized CAIP-2 namespace (`eip155`, `solana`); `upto` restricted to
  `eip155` only, per the current official documentation's explicit EVM-only
  (Permit2) statement.
- **Closed error taxonomy** (`src/errors.ts`): every public function returns a
  closed result or throws one of a small set of typed error classes — never an
  ordinary uncaught exception for buyer-controlled input.

## Explicitly deferred to later SUN-0700A checkpoints (not silently dropped)

- `upto` requirement construction/validation (only its network restriction is
  enforced so far)
- the `payment-identifier` extension / idempotency integration
- replay-protection persistence
- the settlement-evidence model and validator
- the payment state machine
- linkage to SUN-0500/SUN-0600 verification receipts
- Bazaar discovery metadata
- Signed Offers & Receipts extension evaluation (needs its own ADR)
- any live CDP/facilitator behavior — that is SUN-0700B

## Validation

- `pnpm x402:check` (new root script — format/lint/typecheck/test/
  test:property/fixtures:verify, scoped to what this checkpoint actually
  implements): **106 tests, 11 files, all pass.** Property tests (6),
  adversarial tests (11), and a static no-network/no-credential audit (3) are
  included in that count.
- `pnpm x402:fixtures:verify` (`scripts/verify-fixtures.ts`): confirms
  `fixtures/x402-spec-baseline.json`'s recorded protocol version and
  `@x402/core` version are internally consistent with what is actually
  installed.
- Full root `pnpm check` (format/lint/typecheck/test, contracts, migrations, D1,
  control-plane, adapters, document-worker, verification, services-runtime,
  python tests, governance/state/tasks validate, secrets:scan) passes end to end
  with `packages/protocol-x402` folded in via the existing turborepo task graph
  and root `tsconfig.json`/ `vitest.config.ts` path aliases (both already had a
  `protocol-x402` entry from the original SUN-0001 placeholder). Root
  `pnpm test`: 806 passed, 6 skipped, across 67 files (up from 700/6/56).
- `pnpm x402:check` is **not** folded into the root `pnpm check` chain yet —
  intentionally, so this checkpoint's script name never implies the full
  eventual x402:check acceptance surface (Bazaar validation, replay tests,
  settlement-evidence checks, etc.) is already covered. It is available
  standalone (`pnpm x402:check` or
  `pnpm --filter @siteborne/protocol-x402 run check`) and was run as part of
  this checkpoint's own validation above.

## No stub counted as complete

Every module listed under "What was built" has real logic (not an empty
interface or a function that always returns a fixed value) and real test
coverage exercising both its success and its rejection paths, including the
directive's requested scenarios: wrong amount/asset/network/payee, expired
quote, malformed payTo, canonical serialization, deterministic hash (§8);
Base64/JSON malformed input, oversized payload, prototype pollution, V1
rejection (§12); quote/resource/service mismatch, expiry (§13); Unicode edge
cases, huge/negative amounts, deeply nested JSON (§31); zero fetch calls and
zero `CDP_`-prefixed environment variable references, statically verified (§32).
