# ADR 0054: Buyer-surface-specific alternative payment rails

- Status: accepted for SUN-0900A
- Date: 2026-08-11

## Context

SITEBORNE already has accepted CDP-backed Base Sepolia `exact` and `upto`
settlements, authoritative D1 replay, shared service execution, PCC receipts,
and PaymentServiceLink evidence. Nevermined introduces a second buyer
acquisition surface and facilitator protocol. Treating it as another step in a
single stacked payment or as a runtime fallback would create two payment
authorities for one invocation and could invalidate accepted replay and hash
evidence.

Nevermined's `nvm:erc4337` authorization is also not a Coinbase `exact | upto`
payload. The protocols must meet at SITEBORNE's lifecycle boundary without
coercing one wire format into the other.

## Decision

Adopt Model D: the buyer-facing route selects exactly one payment rail before
external verification.

| Buyer surface         | Route family                     | Sole payment rail | Provider identity            |
| --------------------- | -------------------------------- | ----------------- | ---------------------------- |
| Open SITEBORNE x402   | `/v1/{service-route}`            | `cdp`             | `cdp-facilitator@1.55.0`     |
| Nevermined-originated | `/v1/nevermined/{service-route}` | `nevermined`      | `nevermined-payments@1.10.0` |

The rail and provider implementation identity are separate discriminators.
`providerKind: external` and `external_verified` continue to describe evidence
provenance/trust; they do not select a rail.

Hard invariants:

- Exactly one rail is selected from the route before D1 acquisition and external
  verification.
- The selected rail cannot change on retry.
- A failure on either rail fails the invocation; it never invokes the other rail
  as fallback.
- One invocation cannot settle on both rails.
- D1 remains the only replay/lifecycle authority and SITEBORNE
  `Payment-Identifier` remains the logical payment identity.
- Service runtime, PCC generation/verification, receipt signing, UsageResult,
  and consumed-state transitions remain shared and rail-agnostic.
- PaymentServiceLink is rail-aware, while the signed PCC receipt is not
  modified.
- Production readiness and enablement remain false.

## Versioned compatibility

Accepted historical records use binding/link version 1. Omitting the version is
interpreted as version 1, and the original canonical hash payload is preserved
byte-for-byte: no rail/provider keys are introduced into its digest.

All new attempts and links use version 2. Version 2 requires a matching
`payment_rail` and versioned `payment_provider`; Nevermined additionally
requires agent and plan IDs. Those fields participate in the v2 digest. A
cross-rail, cross-provider, cross-agent, or cross-plan retry therefore resolves
to `duplicate_conflict`, not reconstruction.

D1 migration `0005_payment_rail_binding.sql` is additive and nullable for
historical rows. Repository validation, rather than a destructive table rewrite,
requires complete v2 fields before any new insert.

## Payment-Identifier transport

Nevermined access tokens are opaque and potentially reusable. SITEBORNE does not
derive identity from them or persist them. Dedicated Nevermined routes reuse the
accepted `Payment-Identifier` request header adapter and its existing validation
rules. The identifier is bound in D1 to rail, provider, agent, plan, resource,
input, quote/requirement, and authorization maximum before the future provider
call.

This header is a payment identity, not a generic HTTP idempotency key. The two
remain separate fields in the binding model.

## Nevermined response mechanism

The original task phrase "callback verification" is preserved as a security
requirement through authenticated, structurally validated synchronous
`verifyPermissions` and `settlePermissions` responses bound to the selected
request, plan, rail, and payment identity. An inbound webhook becomes required
only if a future adopted Nevermined flow actually sends one to SITEBORNE. The
immutable source directive is unchanged.

## Rejected alternatives

- Model A, a stacked Nevermined-plus-CDP payment for one invocation, fails the
  single-authority, no-double-charge, no-double-settlement, and replay gates.
- Model C, selecting one rail and falling back to the other after verification
  or settlement failure, lets authorization identity change after D1 binding and
  could execute or charge twice. It fails closed-state and deterministic replay
  requirements.

## Consequences

Checkpoint 1 can model declarations, validate official wire structures, and
prove persistence/hash compatibility without credentials or network access. The
official Nevermined SDK is pinned only in `apps/edge-api`; the protocol package
has no environment access or SDK singleton. A real injected provider and mounted
deterministic Nevermined route adapters remain SUN-0900A Checkpoint 2. Account
creation, agent/plan registration, and live sandbox proof remain SUN-0900B.
