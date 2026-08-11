# SUN-0900A Checkpoint 2 — deterministic alternative-rail runtime

## Outcome

SUN-0900A Checkpoint 2 implements the credential-independent Nevermined
request-time boundary without contacting Nevermined. Exactly four additive
Nevermined-only Hono routes now exercise the same D1, job-state,
service-runtime, PCC receipt, UsageResult, settlement-gate, PaymentServiceLink
v2, persistence, and replay path as the accepted CDP routes. There is no second
service implementation, replay authority, or payment lifecycle.

This report is deterministic evidence only. No Nevermined account, API key,
agent, plan, subscription, registration, network verification, or settlement was
created or used. Authenticated external trust is not claimed. Production
readiness and production enablement remain false.

## Provider and SDK boundary

The Edge integration is
`apps/edge-api/src/control-plane/evidence/nevermined-provider.ts`.
`NeverminedPaymentEvidenceProvider` has a private constructor and two sealed
construction paths:

- `fixture(client)` accepts the credential-independent narrow client and always
  declares `providerKind: fixture`; accepted client results remain
  `synthetic_fixture` evidence.
- `authenticated(options)` is the only external-trust path. It requires the
  explicit future live guard to allow `RUN_LIVE_NEVERMINED=1`, sandbox
  environment, and a sandbox-classified key before it lazily calls the official
  `Payments.getInstance`. Importing the module does not initialize the SDK.

The concrete adapter exposes only `verifyPermissions` and `settlePermissions`.
It is compiled against the installed SDK's exact `X402PaymentRequired`,
parameter, verification-result, and settlement-result types. Provider responses
are projected to bounded public fields. API keys, opaque payment-signature
tokens, raw provider responses, authorization headers, free-form diagnostic
messages, and stacks are excluded from evidence, hashes, persistence, audit
records, response bodies, and errors.

The SDK declares Express as a runtime peer through its top-level entrypoint.
`express@4.21.2` is therefore installed only in `apps/edge-api`, alongside the
existing exact-pinned `@nevermined-io/payments@1.10.0`. No SDK or runtime peer
was added to `packages/protocol-nevermined` or `packages/protocol-x402`.

## Transport and deterministic requirements

Nevermined routes accept only:

- the official `payment-signature` access-token header; and
- the accepted SITEBORNE `Payment-Identifier` header.

There are no aliases. The access token is checked only for bounded opaque
carrier shape and is never decoded. The server-issued `PAYMENT-REQUIRED` header
uses the official SDK requirement builder, then the credential-independent
SITEBORNE codec and extension boundary binds the single `nvm:erc4337` acceptance
to the route, service, local declaration agent/plan, quote, requirement,
rail/provider, network, canonical amount or maximum, expiry, Payment-Identifier
requirement, and `production_enabled: false`.

The identifiers in these declarations remain explicit local placeholders, not
claims of registered Nevermined resources.

## Mounted route family

The explicit local builder mounts exactly:

- `POST /v1/nevermined/company/evidence-graph`
- `POST /v1/nevermined/web/context`
- `POST /v1/nevermined/document/evidence-json`
- `POST /v1/nevermined/verify/agent-output`

The four accepted open paths remain CDP-only. The route family is selected from
the path/configuration before authorization handling; credentials never select a
rail. Rejection or exception on one rail is terminal and cannot fall back to the
other.

The normal application does not mount useful Nevermined execution by default.
When its additive Nevermined gate is absent, the path is 404. Setting the gate
without an authenticated provider returns bounded HTTP 503
`nevermined_provider_not_configured`; it does not mount fixtures, call CDP, or
execute a service. An explicit fixture provider is rejected by the existing
production evidence-provider resolver before route construction.

## Shared lifecycle evidence

The Nevermined branch performs:

```text
input schema and opaque transport validation
  -> exact persisted quote/requirement binding recovery
  -> complete PaymentAttemptBinding v2
  -> authoritative D1 acquire
  -> selected Nevermined provider verify
  -> unchanged evidence trust/lifecycle gate
  -> existing service executor exactly once
  -> PCC result and signed self-verified SITEBORNE receipt
  -> UsageResult for document work
  -> selected Nevermined provider settle with actual amount
  -> unchanged settlement gate
  -> PaymentServiceLink v2 with rail/agent/plan/evidence bindings
  -> D1 settled and consumed
  -> persisted reconstruction result
  -> bounded Nevermined PAYMENT-RESPONSE
```

Structural failures and D1 conflicts occur before provider verification.
Consumed replay reconstructs the same receipt/link/result with zero additional
provider calls, service executions, settlements, or jobs.

## Pricing and deterministic settlement

All amounts are derived through accepted pricing keys:

| Service                     | Semantics  | Authorized amount |      Deterministic actual |
| --------------------------- | ---------- | ----------------: | ------------------------: |
| `company_evidence_graph.v1` | exact PAYG |             39000 |                     39000 |
| `web_context_verified.v1`   | exact PAYG |              9000 |                      9000 |
| `verify_agent_output.v1`    | exact PAYG |             19000 |                     19000 |
| `document_evidence_json.v1` | upto       |    190000 maximum | 12000 native-page fixture |

The document executor uses the accepted worker fixture and real pricing
calculation. The UsageResult binds measured resource metrics, input/output,
receipt, pricing source, 190000 authorization, and 12000 actual amount.
Settlement receives 12000, and the Nevermined payment response reports 12000.
The code rejects `actual > maximum` before provider settlement; it never clips,
charges the maximum as fallback, marks consumed, or emits a success header.

This local proof does not establish that the Nevermined sandbox product supports
post-execution dynamic settlement. The declaration remains
`sandbox_capability_verified: false` and `registration_allowed: false`.

## Fail-closed and compatibility evidence

Deterministic coverage proves:

- missing/malformed access token and missing/malformed Payment-Identifier fail
  before verification;
- route/plan/agent/quote/amount/expiry/provider/rail extension mutations fail at
  codec, requirement, binding, or D1 authority boundaries;
- same-rail and cross-rail immutable binding changes are conflicts without
  prior-result leakage;
- verification rejection and exception execute and settle zero times;
- settlement rejection and exception return no successful HTTP result or
  PAYMENT-RESPONSE and leave D1 unconsumed;
- payer, network, redeemed amount, transaction reference, and stable request
  identity mismatches fail closed;
- fixture transactions and authenticated public transaction references have
  distinct accepted shapes;
- access tokens do not appear in D1 audit or cached-result records;
- fixture trust never becomes external trust;
- local route execution requires explicit fixture injection and all four plans
  remain positive PAYG with no free/trial alternative;
- the entire fixture route flow makes zero ambient network calls;
- Nevermined SDK A2A/MCP features are not started and do not replace
  `@siteborne/protocol-a2a` or `@siteborne/protocol-mcp`;
- frozen v1 binding and PaymentServiceLink digests remain unchanged, while v2
  rail/provider/agent/plan/evidence/usage mutations change their hashes.

## Acceptance boundary

Checkpoint 2 completes SUN-0900A only after the full repository validation and
governance acceptance update pass on the committed implementation. SUN-0900B
remains the sole blocked external frontier for sandbox builder/subscriber
credentials, real agent/plan registration, authenticated verification and
settlement, and dynamic document capability proof. It is not started here.
