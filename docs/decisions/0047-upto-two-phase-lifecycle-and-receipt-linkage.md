# SITEBORNE Utility Network — ADR 0047: Upto Two-Phase Lifecycle and SITEBORNE Receipt Linkage (SUN-0700A checkpoint 3)

## Context

`upto` needs two structurally distinct bindings (formalized conceptually in ADR
0044, implemented here): a pre-execution buyer authorization and a
post-execution measured usage. Directive §19-22 required this to be made
explicit end-to-end, plus an immutable link between a payment attempt and the
SITEBORNE verification receipt it paid for.

## Decision — upto two-phase lifecycle

**Phase 1 — authorization** (before execution): `quote` (bound at the service's
declared maximum) → `buildUptoPaymentRequirement` → buyer payment payload →
`ExternalVerificationEvidence` → `canAdvanceToVerified`. The authorized maximum
is the only amount known at this point.

**Phase 2 — usage/settlement** (after execution): the service performs bounded
work (e.g. `document_evidence_json.v1`'s per-page calculation,
`src/pricing/document-usage.ts`, unchanged from checkpoint 2) → actual usage is
calculated → `buildUsageResult` (`src/linkage/usage-result.ts`) binds the actual
amount to the service output/receipt, **throwing
`UsageExceedsAuthorizationError` if the actual amount would exceed the
authorization** — the bounded-resource-policy stop-before-exceeding-max
requirement is enforced at construction time, not checked after the fact →
`ExternalSettlementEvidence` carries the resulting actual amount →
`canAdvanceToSettled`.

The authorization amount and the actual-usage amount are never the same field,
never the same binding, and a usage result can structurally not be built if it
would overcharge the buyer.

## Decision — SITEBORNE verification receipt linkage

`PaymentServiceLink` (`src/linkage/payment-service-link.ts`) is **separate
from** the signed PCC/service receipt (`@siteborne/verification`'s
`VerificationReceipt`, issued by `@siteborne/service-runtime`) — it references
the receipt by `verification_receipt_id`/`verification_receipt_hash`, and never
modifies an already-issued receipt.

Reconstructable chain (directive §22):

```
payment attempt -> quote/requirement -> service invocation
-> service result -> SITEBORNE verification receipt
```

and, independently:

```
payment attempt -> external verification evidence -> settlement evidence
```

`buildPaymentServiceLink` can be called the moment a service receipt exists —
before any settlement evidence is available (`settlement_evidence_hash` is
optional). `extendWithSettlement` produces a **new** link object (a new
`link_id`/`link_hash`, since the settlement field participates in the binding)
rather than mutating the original — there is no circular hash dependency: the
receipt branch is fully immutable and hashed first, settlement binds to it
afterward, never the reverse.

This deliberately mirrors the x402 Signed Offers & Receipts extension's own
separation of concerns (a signed payment-flow receipt, evaluated in a later
checkpoint) without adopting or depending on it yet — SITEBORNE's PCC
verification receipt proves the _service result_; a future x402 signed receipt
would prove the _payment interaction_. They are designed to cross-link, not
merge, when that extension is evaluated.

## Consequences

- A future settlement-evidence update never needs to touch or re-derive the
  service-receipt portion of the link.
- Mutating any bound field (service output, receipt ID/hash, usage result,
  verification evidence) is detectable via a changed
  `link_hash`/`usage_result_hash` (property-tested).
- No live facilitator, wallet, or blockchain RPC exists anywhere in this
  decision — both phases of `upto` and the full link chain are proven with
  synthetic fixture evidence only (`src/tests/upto-lifecycle.test.ts`).
