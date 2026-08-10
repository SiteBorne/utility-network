# Payment ↔ Service Linkage (`PaymentServiceLink`, SUN-0700A checkpoint 3)

`PaymentServiceLink`
(`packages/protocol-x402/src/linkage/payment-service-link.ts`) is the immutable
record connecting a payment attempt to the SITEBORNE service invocation and
verification receipt it paid for. **Not the same thing as the signed PCC/service
receipt** — this link references that receipt by ID/hash and never modifies it.

## Reconstructable chain

```
payment attempt -> quote/requirement -> service invocation
-> service result -> SITEBORNE verification receipt
```

and, independently, once available:

```
payment attempt -> external verification evidence -> settlement evidence
```

`PaymentServiceLink` connects both branches. See
[ADR 0047](../decisions/0047-upto-two-phase-lifecycle-and-receipt-linkage.md).

## No circular hash dependency

`buildPaymentServiceLink` can be called the moment a service receipt exists —
`settlement_evidence_hash` is optional and typically absent at that point.
Settlement is added **later**, via `extendWithSettlement`, which produces a
**new** link object (a new `link_id`/`link_hash`, since the settlement field
participates in the canonical binding) rather than mutating the original in
place:

```ts
const link = await buildPaymentServiceLink({
  /* service-receipt fields only */
});
// ... later, once settlement evidence is accepted ...
const finalLink = await extendWithSettlement(link, settlementEvidenceHash);
```

The service-receipt branch is fully immutable and hashed first; settlement binds
to it afterward, never the reverse.

## Bound fields

| Field                                                   | Source                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `payment_identifier`                                    | checkpoint 2's Payment-Identifier extension value                                          |
| `quote_id` / `requirement_id`                           | checkpoint 1-2's deterministic quote/requirement identity                                  |
| `service_id` / `service_version`                        | the frozen SITEBORNE service                                                               |
| `request_input_hash`                                    | the frozen PCC-style input hash                                                            |
| `job_id`                                                | the SITEBORNE control-plane job this payment authorized                                    |
| `service_output_hash`                                   | hash of the service's actual output                                                        |
| `verification_receipt_id` / `verification_receipt_hash` | the signed PCC/service receipt (`@siteborne/verification`) — never modified after issuance |
| `usage_result_hash` (upto only)                         | `linkage/usage-result.ts`'s post-execution usage binding                                   |
| `verification_evidence_hash`                            | the accepted `ExternalVerificationEvidence`                                                |
| `settlement_evidence_hash`                              | the accepted `ExternalSettlementEvidence`, added later via `extendWithSettlement`          |

Mutating any bound field changes `link_hash` — proven by both example-based
(`payment-service-link.test.ts`) and property-based (`tests/properties.test.ts`)
tests.

## Relationship to x402's Signed Offers & Receipts extension

SITEBORNE's PCC verification receipt proves the **service result** (the frozen
output, verified against the evidence the service actually gathered). The x402
Signed Offers & Receipts extension — not implemented in this checkpoint,
deliberately deferred — would prove the **payment interaction** (a signed 402
offer, a signed post-delivery receipt), using a signing identity the x402 docs
recommend keeping distinct from the payment address. `PaymentServiceLink` is
designed so the two can **cross-link** once that extension is evaluated, not
merge into one artifact.
