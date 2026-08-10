# SITEBORNE Utility Network — ADR 0049: Discovery Truthfulness / Production-Status Boundary (SUN-0700A checkpoint 4)

## Context

Directive §8, §10, §12, §13, §16, §21 all converge on one requirement: Bazaar
discovery metadata may describe SITEBORNE's _planned_ production identity, but
must never claim that identity is currently live, cataloged, or backed by real
payment infrastructure. This ADR records where that boundary is actually
enforced, not just stated in prose.

## Decision — five separate truthfulness gates

1. **Resource URL vs. reachability.** `resourceUrl` is built from the accepted
   canonical production origin (`utility.siteborne.net`,
   `docs/decisions/0001-product-and-domain-identity.md`) plus the real planned
   route from the accepted OpenAPI source
   (`contracts/releases/1.0.0/openapi/service-contracts.openapi.json`,
   `x-implementation-status: "not_implemented"` on every path today) — but every
   `SiteborneDiscoveryResource` carries `status: 'not_live'` and
   `production_enabled: false` as **literal type-level constants**, not booleans
   a caller could accidentally flip (`src/bazaar/discovery.ts`).

2. **payTo vs. a real wallet.** SUN-0700A has no production wallet (directive
   §12 explicitly forbids inserting a fake address and presenting it as
   production-ready). `PAYTO_NOT_CONFIGURED` is a deliberately
   non-address-shaped sentinel (`'siteborne-fixture:payto-not-configured'`) — it
   can never be mistaken for a real payee, and `payto_configured: boolean` on
   the returned resource reports the truth explicitly rather than requiring a
   caller to inspect the string.

3. **Capability vs. execution mode.** `src/bazaar/capability.ts`'s
   `SERVICE_CAPABILITY_STATUS` hardcodes `production_capability: 'not_verified'`
   for all four services and records exactly which modes are excluded and why
   (browser-rendered `web_context_verified`, Modal-backed
   `document_evidence_json`, `independent_reproduction` verification) —
   mirroring `@siteborne/service-runtime`'s own
   `'local_fixture_verified' | 'not_implemented'` `implementationStatus` by
   convention (directive §10). `local_fixture_verified` is never upgraded to a
   production claim anywhere in this module.

4. **Catalog status vs. a real facilitator submission.**
   `src/bazaar/catalog-status.ts` types `BazaarCatalogStatus` as a closed
   five-value union but SUN-0700A can only ever produce `'not_submitted'` —
   `assertCatalogStatusIsEvidenced` throws on every other value, since no
   facilitator call exists anywhere to back it (directive §21: "Do not set
   `cataloged` without real facilitator evidence").

5. **No live network path exists to violate any of the above accidentally.**
   `src/tests/no-network.test.ts` extends its `fetch` spy and static source
   audit to the entire Bazaar path: building and validating all four
   declarations performs zero `fetch` calls, and no source file calls
   `withBazaar`/`.listResources(`/`extensions.bazaar. search(` — the
   facilitator-query functions the official package itself exports for a
   _different_ use case (a buyer client querying a live catalog) that SUN-0700A
   never reaches.

## Consequences

- A caller cannot construct a "this is live" discovery resource through this
  package's public API — `status`/`production_enabled` are not caller-settable
  fields of `BuildDiscoveryDeclarationInput`.
- `validateSiteborneDiscoveryResource` independently re-checks
  `status`/`production_enabled` (`production_falsely_claimed_live`/
  `production_falsely_enabled` failure reasons) rather than trusting that
  `buildSiteborneDiscoveryDeclaration` was the only code path that ever produced
  the resource — defense in depth against a future hand-constructed resource
  object.
- Promoting any of these five gates past `not_verified`/`not_submitted`/
  `not_live` is exclusively SUN-0700B's (or a later, explicitly
  wallet/facilitator-provisioning) scope, never a silent SUN-0700A change.
