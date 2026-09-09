# SUN-1222C-PCC-WIRE-RESULT-GOVERNANCE-DECISION

Read-only governance-tracing checkpoint. No implementation, no deployment, no economic effect.

## The governance question is answered unambiguously: Class A

`contracts/releases/2.0.0/schemas/services/web-context-output.schema.json` (and the sibling company/document/verify-output schemas) states its intent in plain text:

> "Must be a valid PCC 1.0.0 document with required net.siteborne.web-context.v1 extension."

Its `allOf` directly references `proof-carrying-context.schema.json` at the schema's own top level (not nested under a wrapper key), meaning **the entire wire response object itself must be a full PCC document** — not the business payload alone, and not the business payload plus a few extra fields.

The base schema (`contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json`) requires these top-level fields: `pcc_version, job_id, contract, subject, claims, evidence, completeness, provenance, verification, receipt` (plus `extensions`). The business payload (e.g. `requested_url`, `canonical_text`) belongs *nested inside* `extensions["net.siteborne.web-context.v1"]`, not at the top level.

`packages/service-runtime/src/pcc/document-types.ts`'s `PccDocument<TExtensionKey, TExtension>` TypeScript interface matches this exact required field list, field for field:

```ts
export interface PccDocument<TExtensionKey extends string, TExtension> {
  pcc_version: string;
  job_id: string;
  contract: PccContract;
  subject: PccSubject;
  claims: PccClaim[];
  evidence: PccEvidenceItem[];
  completeness: PccCompleteness;
  provenance: PccProvenance;
  verification: PccVerificationBlock;
  receipt: PccReceiptBlock;
  extensions: { [K in TExtensionKey]: TExtension };
}
```

`paid-continuation-workflow.ts`'s `durableEvidence.pcc` field (populated from `verificationReceipt`, the real PCC document `verify-and-sign.ts` already builds and signs for every payment) is exactly this shape. No second PCC construction is needed anywhere -- the correct object already exists in memory at the moment the wire response is built. It is simply never attached to it.

## Current vs. governed wire representation

`paid-continuation-workflow.ts:1020-1044` constructs the exact single shared object every REST/A2A/MCP caller ultimately receives (via `x402-service.ts:799`'s verbatim `c.json(cached.body, ...)`):

```ts
const cachedResult: DurableCachedResult = {
  status: 200,
  body: {
    service_id: decrypted.settlementContext.service_id,
    result_class: executorOutcome.result.result_class,
    output: executorOutcome.result.output,        // <- what callers get today
    receipt_id: verificationReceiptId,
    link_id: paymentServiceLink.link_id,
    link_hash: paymentServiceLink.link_hash,
  },
  settleResponse: { ... },
  durableEvidence: {
    pcc: verificationReceipt,                       // <- the real PCC document, never wired
    receipt: executorOutcome.result.receipt,
    settlement_evidence: settleOutcome.settlementEvidence,
    payment_service_link: paymentServiceLink,
  },
};
```

```
CURRENT_WIRE_REPRESENTATION = body.output alone (raw business payload, no PCC envelope)
GOVERNED_WIRE_REPRESENTATION = the full PCC document (durableEvidence.pcc / verificationReceipt), with the business
                                payload nested at extensions["net.siteborne.<service>.v1"]
CURRENT_VS_GOVERNED_DIFF = missing pcc_version, job_id, contract{service_id,service_version,output_schema_hash},
                            subject, claims, evidence, completeness, provenance, verification, receipt at top level;
                            business payload sits at the wrong nesting depth (top level instead of under extensions)
CURRENT_WIRE_STATUS = IMPLEMENTATION_BUG
```

This is classified `IMPLEMENTATION_BUG`, not `LEGACY_ACCEPTED_CONTRACT`: the schema's intent has been explicit and unchanged since 1.0.0 ("must be a valid PCC document"); nothing in the repository shows a deliberate decision to ship business-payload-only instead. It only went unnoticed because -- as the prior diagnosis checkpoint established -- no real payment attempt anywhere in this engagement's history had ever previously reached a genuine `fulfilled` outcome to exercise this path against the schema.

## Backward compatibility: no external consumer exists to break

Searched the repository for anything that would depend on the current (non-conformant) shape: no SDK directory, no examples directory, no OpenAPI spec, no published client. Combined with the proven fact that no real payment has ever reached `fulfilled` before this diagnostic work, no accepted external client has ever received or parsed the current business-payload-only shape.

```
WIRE_COMPATIBILITY_IMPACT = NONE
```

## Recommended remediation (design only -- not implemented here)

Attach the already-built `durableEvidence.pcc` (`verificationReceipt`) as the governed v2 result at the single shared construction point in `paid-continuation-workflow.ts` (`cachedResult.body`, lines 1020-1044) that every REST/A2A/MCP caller already reads from via the same `DurableCachedResult`. No second PCC is built, no new settlement owner, no new schema, no new secret -- purely a wiring change at the one place all three transports already converge. `service_id`/`result_class`/`receipt_id`/`link_id`/`link_hash` (useful reference metadata not part of the PCC schema) can remain as siblings or fold into `contract`/`receipt` as the implementation checkpoint decides; the schema-bearing requirement is that the response validates as a complete PCC document.

```
EARLIEST_SHARED_FIX_BOUNDARY = paid-continuation-workflow.ts: DurableCachedResult.body construction (~line 1022)
EXPECTED_TRANSPORT_SPECIFIC_CHANGES = NONE (REST, A2A, and MCP all read the same cached.body through x402-service.ts's
                                       c.json(cached.body, ...) passthrough and the MCP adapter's body.output selector;
                                       fixing the shared boundary fixes all three without per-transport changes)
PCC_BUILDERS_TO_ADD = 0
```

## Economic invariants (reconfirmed)

```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

The recommended remediation touches only result-construction code after settlement has already completed; it does not add, move, or duplicate settlement authority.

## Human decision required

```
PCC_WIRE_GOVERNANCE_DECISION=READY_FOR_IMPLEMENTATION_APPROVAL
```

**Exact approval needed:** "Approve remediation to make the existing accepted v2 result representation (the already-built PCC document) the authoritative wire result across REST, A2A and MCP, using the already-built PCC and preserving the sole existing settlement owner."

## Zero-effect accounting

```
PRODUCTION_SOURCE_CHANGES=0
PRODUCTION_MUTATIONS=0
PRODUCTION_DEPLOYMENTS=0
PRODUCTION_D1_WRITES=0
LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0
REAL_SIGNING=0
PAID_REQUESTS=0
REAL_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
```
