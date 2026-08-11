# SUN-0900A Checkpoint 1 — Alternative-rail foundation report

## Outcome

SUN-0900 was decomposed truthfully into credential-independent SUN-0900A and
externally blocked SUN-0900B. The governance correction is commit `d6e75a8`
(`chore(tasks): split nevermined foundation from sandbox verification`).
SUN-0900A remains active because its real injected provider and four shared-
lifecycle route adapters are Checkpoint 2. SUN-0900B remains blocked on genuine
sandbox prerequisites.

Checkpoint 1 establishes Model D: open SITEBORNE routes select CDP only;
dedicated Nevermined routes select Nevermined only. There is no stacking,
fallback, second replay authority, second service implementation, credential,
account, registration, or external call. Production remains false.

## Versioned persistence and linkage

- Canonical rails: `cdp | nevermined`
- Provider identities: versioned, rail-constrained CDP/Nevermined identifiers
- New payment-attempt binding version: 2
- New PaymentServiceLink version: 2
- Historical interpretation: omitted version or explicit version 1
- D1 migration: `0005_payment_rail_binding.sql`, additive nullable columns
- New-row enforcement: repository validation before insert
- Nevermined binding: requires agent and plan IDs
- CDP binding: rejects Nevermined IDs

Frozen historical vectors prove that the legacy binding digest remains
`sha256:fae6c47100b04a2485b192607a05bea1824b788978034ab4b7f903da5ecdbba5` and
the legacy PaymentServiceLink hash remains
`sha256:f5a66c7bcaeb536613a540b79633de7d6affc3a1119c50307932d2188c5b72f1`. The
v1 payload never receives v2 keys. New open-route CDP attempts are written as
v2. Cross-rail/provider/agent/plan retries conflict and cannot reconstruct or
leak a prior result.

## Nevermined model

`packages/protocol-nevermined` is now a real credential-independent package. It
owns local declarations, route policy, configuration migration, requirement and
settlement validation, Payment-Identifier transport adaptation, dynamic
actual-usage preparation, sanitized evidence projection, fixtures, no-network
tests, and installed-type drift checks.

The official `@nevermined-io/payments@1.10.0` dependency is exact-pinned only in
`apps/edge-api`. A pure edge mapper is compile-checked against the official SDK
parameter types. The package is not instantiated and neither `verifyPermissions`
nor `settlePermissions` is invoked. The older A2A package inside the SDK
dependency graph does not replace SITEBORNE's direct accepted
`@a2a-js/sdk@1.0.1`.

Exactly four agent/plan declarations are derived from the frozen registry and
canonical pricing. All are positive-price PAYG and non-trial. Fixed amounts are
39000 (company), 9000 (web direct), and 19000 (verify standard). Document
authorizes at most 190000 and models actual native/OCR/table tiers of
12000/19000/29000. Its registration remains disabled and sandbox capability
unverified.

## Security and lifecycle boundaries

- Canonical secret name: `NVM_API_KEY`
- Deprecated alias: `NEVERMINED_API_KEY`
- Differing dual values: fail closed without disclosure
- Public environment: `NVM_ENVIRONMENT`; only `sandbox` accepted now
- Opaque access tokens: excluded from persistence, evidence, hashes, fixtures,
  logs, and reports
- External trust class: unchanged; fixture evidence cannot become
  `external_verified`
- Payment-Identifier: accepted header/validation reused; never token-derived
- D1: sole authoritative acquisition/replay/consumed store
- PCC: shared and rail-agnostic
- PaymentServiceLink: shared and rail-aware at v2

The package proves the intended common lifecycle architecture and exact rail
selection policy. It does not mount or execute the future Nevermined provider;
that is deliberately Checkpoint 2.

## Deterministic evidence

The dedicated gate covers configuration, four declarations, canonical pricing,
PAYG/trial policy, official requirement and settlement response validation,
Payment-Identifier transport, no-fallback route selection, sanitized evidence,
dynamic actual-vs-maximum settlement, no-network execution, D1 v1/v2
persistence, replay conflicts, PaymentServiceLink v1/v2 hashes, and existing CDP
route regression.

The final validation run is recorded in the task stop report. It includes the
full root TypeScript/Vitest, migration/D1, contracts, adapters, document worker,
verification, service runtime, x402, MCP, A2A, Python, governance/state/task,
secret-scan, and root `pnpm check` gates.

## Deferred checkpoint

SUN-0900A Checkpoint 2 is exactly: injected Nevermined provider, four
Nevermined-only deterministic route adapters, structural authorization and D1
acquisition before simulated verify, shared service/PCC/UsageResult/linkage
lifecycle, simulated fixed PAYG and document actual-usage settlement, replay and
fail-closed negatives, then SUN-0900A acceptance. It must remain credential-free
and network-free. SUN-0900B must not begin.
