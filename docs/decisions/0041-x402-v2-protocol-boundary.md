# SITEBORNE Utility Network — ADR 0041: x402 V2 Protocol Boundary (SUN-0700A checkpoint 1)

## Context

SUN-0700A implements x402 payment protocol logic that is credential-independent
and locally testable, deferring live CDP facilitator settlement to SUN-0700B.
The directive targets **x402 V2** specifically (`PAYMENT-REQUIRED` /
`PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers), not the legacy V1 shape.

Before writing any protocol code, the current official x402 material was
inspected directly rather than assumed:

- `docs.x402.org/core-concepts/http-402`,
  `getting-started/quickstart-for-sellers`, and `extensions/payment-identifier`
  were fetched to confirm header names, encoding, scheme semantics, and the
  payment-identifier extension shape (see `fixtures/x402-spec-baseline.json` for
  the recorded summary and retrieval dates).
- Three npm packages were inspected directly (`npm view`, `npm pack`, and
  reading their published `.d.ts` files) rather than trusted by name alone:
  - `x402@1.2.0` — bundles `viem`, `wagmi`, `@solana/kit`, `@wallet-standard/*`.
    Not used.
  - `@coinbase/x402@2.1.0` — bundles `@coinbase/cdp-sdk` and `viem`. Not used.
  - `@x402/core@2.21.0` — its **only** dependency is `zod`. It exports
    `x402Version = 2`, full V1/V2 Zod schemas (`@x402/core/schemas`), plain TS
    types (`@x402/core/types`), and Base64/JSON header codec primitives
    (`@x402/core/http`), with no facilitator or wallet code in the imported
    subpaths.

## Decision

`packages/protocol-x402` depends on `@x402/core@^2.21.0` for the official V2
wire types and Zod schemas — never a second, hand-maintained schema for
`PaymentRequirements`/`PaymentRequired`/`PaymentPayload`. The one documented
exception: `@x402/core` exports no Zod schema for `SettleResponse` (the
`PAYMENT-RESPONSE` payload) at all, only a plain TS type —
`src/codec/headers.ts` defines the one schema this package hand-maintains, kept
structurally identical to the recorded official type.

`SUPPORTED_X402_VERSION` (`src/version.ts`) is read directly from `@x402/core`'s
own exported `x402Version` constant, not a SITEBORNE-local literal — a future
upstream major bump becomes visible here rather than silently drifting. Every
entry point in this package (header decoders, the payload structural parser)
explicitly rejects a schema-valid **V1** payload as `unsupported_version` — V1
is never silently treated as V2, even though `@x402/core`'s own
`parsePaymentRequired`/`parsePaymentPayload` validate the V1|V2 union
structurally.

**No facilitator client belongs in this package.** `@x402/core/facilitator` and
`@x402/core/client` are never imported; `src/tests/no-network.test.ts`
statically greps every non-test source file in this package for
`@x402/core/facilitator`, `viem`, `wagmi`, and any `CDP_`-prefixed environment
variable reference, failing the suite if any appear.

`@x402/core`'s own header-decode functions (`decodePaymentRequiredHeader` etc.,
from `@x402/core/http`) were inspected in their published `dist/esm/chunk-*.mjs`
and found to (a) throw on invalid input rather than return a closed result, (b)
call `JSON.parse` with no byte-size bound, and (c) return the parsed value
type-asserted without runtime schema validation. `src/codec/headers.ts` wraps
`@x402/core`'s own safe, non-throwing
`parsePaymentRequired`/`parsePaymentPayload` parsers with an additional bounded,
prototype-pollution-safe Base64/JSON decode step and converts every failure into
a closed `HeaderDecodeResult` — never an exception.

**Scheme/network matrix**: `exact` is accepted on every CAIP-2 namespace this
package recognizes (`eip155`, `solana`, at this checkpoint); `upto` is
restricted to `eip155` (EVM) only, matching the current official documentation's
explicit statement that `upto` is "currently available on EVM networks only
(Permit2)". `src/network/schemes.ts::isSchemeSupportedOnNetwork` is the single
function every other module calls before accepting a scheme+network combination
— this restriction is data, not a comment someone has to remember to honor.

**Pricing**: `src/pricing/mapping.ts` reads `governance/RISK_LIMITS.yaml`'s
`max_price_usd_per_service` directly (the same source
`scripts/validate-governance.ts` already validates) rather than duplicating
price constants, and converts through `@siteborne/pricing`'s decimal-safe
`usdToMicro` — never binary floating point — before rescaling to the payment
asset's atomic-unit integer string.

**Quote/requirement/resource binding**: `src/quote/quote.ts` builds a
deterministic `quote_id` from a canonical hash (reusing
`@siteborne/verification`'s `canonicalize`/`contentHash`, never a second
canonical-JSON implementation) over every bound field — service, pricing key,
scheme, network, asset, amount, payee, and validity window. Resource identity is
bound into the `exact` requirement's `requirement_id` and, independently,
checked against the payload's own `resource.url` field at the payload-parsing
layer (`src/payload/parser.ts`), since resource identity is not itself a field
of the wire `PaymentRequirements` object. `quote_id` is threaded through
`PaymentRequirements.extra.quote_id` — the spec's own extensibility slot — so a
payload's declared quote binding is independently checkable, not merely inferred
from field equality.

## Scope of this checkpoint (checkpoint 1 of SUN-0700A)

Implemented: protocol version binding, canonical types, `exact` payment
requirements, the `PAYMENT-REQUIRED` challenge builder, all three header codecs,
structural (non-cryptographic) payment-payload validation, deterministic quote
identity, service/request/resource binding, pricing integration, expiration
validation, and a closed error taxonomy.

**Explicitly not implemented in this checkpoint** — mandatory subsequent
checkpoints of the same SUN-0700A task, not silently dropped:

- `upto` requirement construction/validation (only its network restriction is
  enforced so far)
- the `payment-identifier` extension / idempotency integration
- replay-protection persistence
- the settlement-evidence model and validator
- the payment state machine
- linkage to SUN-0500/SUN-0600 verification receipts
- Bazaar discovery metadata
- Signed Offers & Receipts extension evaluation
- any live CDP/facilitator behavior (that is SUN-0700B, not SUN-0700A)

## Consequences

- Correctness of the wire shapes is anchored to an upstream-maintained,
  independently-tested package rather than this repo's own interpretation of the
  spec prose — a future upstream V2 minor revision that changes a field name is
  a `pnpm --filter @siteborne/protocol-x402 install` + typecheck failure, not a
  silent drift.
- `scripts/verify-fixtures.ts` is a regression gate over
  `fixtures/x402-spec-baseline.json`, asserting the recorded baseline is
  internally consistent with what is actually installed.
- This package cannot itself construct, submit, or verify a real payment — it
  has no facilitator client, no wallet, and never claims `payment_verified` or
  `settled`. Those are reserved for SUN-0700B and are proven absent by
  `src/tests/no-network.test.ts`.
