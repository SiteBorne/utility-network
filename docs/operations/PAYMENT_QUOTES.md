# Payment Quotes (`@siteborne/protocol-x402`)

A **quote** (`src/quote/quote.ts`) is the deterministic identity every x402
payment requirement and payload validation is checked against. It binds:

| Field                      | Meaning                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `x402_version`             | Defaults to `SUPPORTED_X402_VERSION`; a future protocol major bump changes it.          |
| `service_id`               | One of the four frozen SITEBORNE v1 service IDs.                                        |
| `service_version`          | Currently always `'v1'`.                                                                |
| `contract_release`         | The frozen service contract release this quote was priced against.                      |
| `input_hash`               | The `sha256:<hex>` hash of the specific request this quote prices.                      |
| `pricing_key`              | Which `governance/RISK_LIMITS.yaml` price entry (via `@siteborne/pricing`) priced it.   |
| `pricing_source_version`   | The governance pricing document's own `version` field, when supplied.                   |
| `scheme`                   | `'exact'` or `'upto'`.                                                                  |
| `network`                  | CAIP-2 network identifier (e.g. `eip155:8453`).                                         |
| `asset`                    | The payment asset's contract/mint address.                                              |
| `amount`                   | Atomic-unit integer string — the exact amount (`exact`) or authorized maximum (`upto`). |
| `payee`                    | The `payTo` address.                                                                    |
| `issued_at` / `expires_at` | The quote's validity window.                                                            |

## Identity

`buildQuote()` computes a canonical (key-order-independent) SHA-256 digest over
every bound field and derives `quote_id` (`qte_<24 hex chars>`) from it —
mirroring the same deterministic-ID convention already used by
`@siteborne/service-runtime` and `@siteborne/verification`. Two quotes with
identical bound field values always produce the identical `quote_id`, regardless
of construction order; mutating any single bound field changes it. This is
proven by both example-based (`quote.test.ts`) and property-based
(`tests/properties.test.ts`) tests, including the specific regressions directive
§3 required: same resource, different request input → different quote; same
input, different service → different quote; same input/service, different
contract release → different quote.

## Resource and requirement binding

`PaymentRequirements` (the official x402 wire object) carries no resource
identity field. SITEBORNE binds resource identity into the **requirement**, not
the quote: `buildExactPaymentRequirement`/ `buildUptoPaymentRequirement` hash
`(quote_id, resource_id, scheme, network, amount, asset, payTo, maxTimeoutSeconds)`
into a `requirement_id`. The quote's own `quote_id` also rides inside the wire
requirement's `extra.quote_id` field (the spec's own extensibility slot), so a
buyer-returned requirement's quote binding is independently checkable by
`payload/parser.ts`, not merely inferred from field-by-field equality.

## Pricing

Quotes never duplicate price constants. `src/pricing/mapping.ts` re-exports
`@siteborne/pricing`'s `resolveServiceMaxPriceUsd`,
`resolvePricingSourceVersion`, and `usdToAtomicUnits` — the single authoritative
path from `governance/RISK_LIMITS.yaml` to an atomic-unit amount (see
[ADR 0042](../decisions/0042-x402-pricing-boundary-correction.md)).
