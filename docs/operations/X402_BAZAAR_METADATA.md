# Bazaar Discovery Metadata (`@siteborne/protocol-x402`, SUN-0700A checkpoint 4)

**Everything in this document is locally validated only. No live facilitator
cataloging occurred. No `/discovery/resources` endpoint was queried. No claim of
a Bazaar listing exists anywhere. `production_ready`/ `production_enabled`
remain `false` throughout.**

## What this checkpoint built

`packages/protocol-x402/src/bazaar/` generates and locally validates a Bazaar
discovery declaration (`declareDiscoveryExtension`, the official
`@x402/extensions/bazaar` API) for each of SITEBORNE's four services:

- `company_evidence_graph.v1` (`exact`)
- `web_context_verified.v1` (`exact`, direct-fetch mode only)
- `document_evidence_json.v1` (`upto`, bound at the service's maximum)
- `verify_agent_output.v1` (`exact`, standard mode only)

## What it does NOT do

- Submit to a facilitator's catalog.
- Query `/discovery/resources` or a Bazaar search endpoint.
- Configure a payment wallet or a real `payTo`.
- Claim a live, reachable production route (every route is
  `x-implementation-status: "not_implemented"` in the accepted OpenAPI source).

## Composition, not duplication

| Field                                      | Sourced from                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title/description/capabilities/limitations | `registry/services/*.json` (`src/bazaar/registry-source.ts`)                                                                                     |
| Input schema + example                     | `contracts/releases/1.0.0/schemas/services/*.schema.json`, locally `$ref`-bundled (`src/bazaar/frozen-inputs.ts`, `src/bazaar/schema-bundle.ts`) |
| Output example                             | Same frozen output schema's own `examples[0]` — the schema itself is not bundled (see below)                                                     |
| Route/method                               | `contracts/releases/1.0.0/openapi/service-contracts.openapi.json`, `x-service-id` extension field (`src/bazaar/routes.ts`)                       |
| Price                                      | `governance/RISK_LIMITS.yaml` via `@siteborne/pricing` (unchanged since ADR 0042)                                                                |
| Payment requirement                        | Checkpoint 1-2's `buildExactPaymentRequirement`/`buildUptoPaymentRequirement`                                                                    |
| Scheme/network support                     | `SITEBORNE_SUPPORTED_X402_SCHEMES` (`src/network/schemes.ts`)                                                                                    |

Nothing above is a second, hand-maintained copy — see
[ADR 0048](../decisions/0048-bazaar-discovery-as-canonical-extension.md).

## The one recorded limitation: output schemas are not bundled

All four output schemas `$ref`
`https://utility.siteborne.net/schemas/proof-carrying-context.schema.json` — a
large, separately-owned, internally-self-referencing (55 `$ref`s) schema.
Bundling it into every service's Bazaar declaration was judged out of scope for
this checkpoint. Only each output schema's own frozen `examples[0]` is embedded
(`output.example`); `output.schema` is omitted — a supported, not invented,
shape (`declareDiscoveryExtension`'s `output` config makes `schema` optional).

## Truthfulness boundary

See [ADR 0049](../decisions/0049-discovery-truthfulness-boundary.md) for the
five separate gates (resource-URL-vs-reachability, payTo-vs-real- wallet,
capability-vs-execution-mode, catalog-status-vs-real-submission,
no-live-network-path) that keep this metadata honest. In short:

- `status: 'not_live'`, `production_enabled: false` are literal type-level
  constants on every declaration — not caller-settable.
- `payTo` is the sentinel `PAYTO_NOT_CONFIGURED` unless a caller explicitly
  supplies a real one (never done anywhere in this checkpoint);
  `payto_configured` reports the truth explicitly.
- `capability_status` never upgrades `local_fixture_verified` to a production
  claim — browser-rendered/Modal/independent-reproduction modes are explicitly
  excluded and their reasons recorded.
- `BazaarCatalogStatus` can only ever be asserted as `'not_submitted'` in this
  checkpoint (`assertCatalogStatusIsEvidenced` throws on every other value).

## Local validation and drift guard

- `validateSiteborneDiscoveryResource` (`src/bazaar/validator.ts`) layers
  SITEBORNE-specific checks over the official `validateDiscoveryExtension`/
  `validateDiscoveryExtensionSpec`. Unknown service IDs fail closed.
- `fixtures/x402-spec-baseline.json`'s `bazaar_extension` entry + the
  `x402:spec:verify` checks it feeds (`scripts/verify-fixtures.ts`) catch a
  future incompatible `@x402/extensions/bazaar` package/type change — the
  upstream extension is explicitly documented as early/evolving.
- `src/bazaar/roundtrip.test.ts` proves an unknown buyer program — using only
  the official `extractDiscoveryInfoFromExtension` and `@x402/core` wire-schema
  functions, never a SITEBORNE-internal type — can discover the schema, choose a
  payment option, and construct a structurally valid request from the
  declaration alone.

## Signed Offers & Receipts

Evaluated and deliberately deferred this checkpoint — see
[ADR 0050](../decisions/0050-signed-offers-and-receipts-decision.md).
