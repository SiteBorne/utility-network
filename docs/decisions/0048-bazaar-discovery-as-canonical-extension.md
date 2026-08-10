# SITEBORNE Utility Network — ADR 0048: Bazaar Discovery as the Canonical x402 Discovery Extension (SUN-0700A checkpoint 4)

## Context

SUN-0700A checkpoint 4 required local Bazaar discovery metadata for SITEBORNE's
four services. The official x402 V2 extension surface offers exactly one
discovery mechanism — the Bazaar extension (`@x402/extensions/bazaar`,
`docs.x402.org/extensions/bazaar`) — declared at the resource-server layer and
(later, by a supporting facilitator) cataloged for machine-readable search.
Directive §5 required using the official declaration API rather than inventing a
competing envelope.

## Decision

`@x402/extensions/bazaar`'s `declareDiscoveryExtension` is the sole mechanism
SITEBORNE uses to produce discovery metadata
(`packages/protocol-x402/src/bazaar/discovery.ts`). No SITEBORNE-specific
discovery envelope exists anywhere in this package. SITEBORNE-specific data
(`capability_status`, `payto_configured`) lives strictly outside the
`extensions.bazaar` object the official extension owns — never merged into or
mutating the official shape (directive §16's "respect upstream validation
constraints").

## Why the `bazaar` subpath specifically (dependency-weight discipline)

Inspecting the compiled package
(`node_modules/@x402/extensions/dist/cjs/ bazaar/index.js`) shows the `bazaar`
subpath's own compiled chunk imports only `ajv/dist/2020.js`,
`@x402/core/server`, and Node's built-in `url` — none of
`viem`/`jose`/`@noble/curves`/`@scure/base`/`tweetnacl`/`siwe`, which the
_sibling_ subpaths (`offer-receipt`, `sign-in-with-x`) pull in. This mirrors
checkpoint 1-2's `payment-identifier` narrow-subpath discipline exactly (ADR
0041/0043) — see `fixtures/x402-spec-baseline.json`'s `bazaar_extension` entry
and `src/tests/no-network.test.ts`'s static source audit, which now allows
exactly `payment-identifier` and `bazaar`, nothing else.

## Composition, not duplication (directive §6)

`src/bazaar/discovery.ts` composes, never re-derives:

- `registry/services/*.json` (title/description/capabilities/declared
  limitations/pricing schemes) — statically imported, never manually re-typed
  (`src/bazaar/registry-source.ts`).
- `contracts/releases/1.0.0/schemas/services/*.schema.json` (frozen input
  schemas, including their own `examples[0]`) — statically imported and locally
  `$ref`-bundled (`src/bazaar/frozen-inputs.ts`, `src/bazaar/schema-bundle.ts`),
  never a simplified copy.
- `contracts/releases/1.0.0/openapi/service-contracts.openapi.json`
  (`x-service-id`/`x-implementation-status` extension fields) — the real planned
  route/method per service, never assumed (`src/bazaar/routes.ts`).
- `governance/RISK_LIMITS.yaml` via `@siteborne/pricing` (`../pricing/mapping`,
  unchanged from ADR 0042) — never a second pricing source.
- Checkpoint 1-2's `buildQuote`/`buildExactPaymentRequirement`/
  `buildUptoPaymentRequirement` — the exact same quote/requirement identity
  machinery every other payment path uses, never a parallel Bazaar-only quoting
  path.

## One structural gap, deliberately not bundled: output schemas

All four output schemas `$ref` `proof-carrying-context.schema.json`, a large (55
internal `$ref`s), separately-owned contract schema. Bundling it recursively
into every service's Bazaar declaration was judged out of scope for this
checkpoint (directive §13's "record the limitation" instruction, applied here by
analogy): only each output schema's own frozen `examples[0]` is embedded
(`output.example`, no `output.schema`) — the official
`declareDiscoveryExtension` config treats `output.schema` as optional, so this
omission is a supported, not an invented, shape. See
`docs/operations/X402_BAZAAR_METADATA.md`.

## Consequences

- Every discovery declaration is machine-consumable via the official
  `extractDiscoveryInfoFromExtension`/`validateDiscoveryExtension` functions —
  proven end-to-end by an unknown-buyer simulation with zero SITEBORNE-specific
  hardcoding (`src/bazaar/roundtrip.test.ts`).
- A future Bazaar package upgrade that changes the declaration shape, extension
  key, or dependency surface is caught by `x402:spec:verify`'s new
  `bazaar_extension` checks, not discovered silently in production.
- No live facilitator cataloging, `/discovery/resources` query, or Bazaar search
  exists anywhere in this checkpoint — see
  `docs/decisions/0049-discovery-truthfulness-boundary.md`.
