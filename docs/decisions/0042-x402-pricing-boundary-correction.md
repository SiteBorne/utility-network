# SITEBORNE Utility Network — ADR 0042: x402 Pricing Boundary Correction (SUN-0700A checkpoint 2)

## Context

Checkpoint 1 of SUN-0700A (`packages/protocol-x402/src/pricing/mapping.ts`) read
`governance/RISK_LIMITS.yaml` directly via `node:fs` — a payment protocol
package owning filesystem/YAML access to a governance file is not the intended
architecture. `packages/pricing` — whose whole purpose is decimal-safe pricing
calculation for this project — had no service-price resolution API at all; it
was purely a generic cost/margin calculator (`usdToMicro`,
`computeMinimumPriceUsd`, `applyScarcityMultiplier`, etc.), so checkpoint 1
could not have used it as-is.

## Decision

The dependency direction is now:

```
governance/RISK_LIMITS.yaml -> @siteborne/pricing -> @siteborne/protocol-x402
```

`@siteborne/pricing/src/service-prices.ts` is the one place that reads
`governance/RISK_LIMITS.yaml` (`resolveServiceMaxPriceUsd`, `usdToAtomicUnits`,
the `PricingKey` union, and a `__setRiskLimitsForTesting` test seam — all moved
verbatim from checkpoint 1's `protocol-x402` module, unchanged in behavior).
`@siteborne/pricing` gained a `yaml` dependency for this.

`packages/protocol-x402/src/pricing/mapping.ts` is now a thin re-export of those
four names from `@siteborne/pricing` — no YAML parsing, no filesystem access, no
duplicated price constants. A static source-file audit
(`src/tests/no-network.test.ts`) asserts no file in this package calls
`readFileSync`/`new URL` against `RISK_LIMITS`, and a regression test
(`src/pricing/mapping.test.ts`) asserts protocol-x402's re-exported functions
are the exact same function objects `@siteborne/pricing` exports (`toBe`, not
merely `toEqual`), and that a real x402 quote's `amount` field equals
`@siteborne/pricing`'s own canonical conversion — proving there is no second,
potentially divergent pricing path.

## Consequences

- Any future package that needs SITEBORNE's accepted service prices (Bazaar
  metadata generation, a future control-plane payment route, etc.) has one
  obvious place to get them from — `@siteborne/pricing` — rather than
  re-deriving governance-YAML access independently.
- `governance/RISK_LIMITS.yaml` remains the single ultimate source of truth;
  this change only moves _which package_ is allowed to open it.
- No behavior changed for any already-passing checkpoint-1 test — the values,
  key names, and conversion arithmetic are byte-identical to checkpoint 1's
  implementation, just relocated.
