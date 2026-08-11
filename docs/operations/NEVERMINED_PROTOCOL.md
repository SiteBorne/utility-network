# Nevermined protocol boundary

## Installed baseline

- SDK: `@nevermined-io/payments@1.10.0`
- Runtime dependency owner: `apps/edge-api`
- SITEBORNE domain package: `packages/protocol-nevermined`
- Nevermined x402 scheme: `nvm:erc4337`
- Public environment model: `sandbox | live`
- Checkpoint-1 allowed environment: `sandbox` only

The protocol package is credential-independent. It does not import the SDK at
runtime, read environment variables, create singleton client state, execute a
service, persist D1 state, generate PCC, or make a network call. The edge layer
contains a pure compile-checked mapper to the official SDK's
`VerifyPermissionsParams` and `SettlePermissionsParams`; it does not initialize
`Payments` or invoke a facilitator in this checkpoint.

The local spec fixture verifies the installed package version and current type
surface for `X402PaymentRequired`, verify/settle parameter and result types,
PAYG helpers, credit helpers, registration methods, and trial helpers. It also
proves the SDK's older transitive A2A dependency does not replace SITEBORNE's
direct accepted `@a2a-js/sdk@1.0.1` dependency.

## Configuration boundary

| Name                 | Classification           | Checkpoint behavior                           |
| -------------------- | ------------------------ | --------------------------------------------- |
| `NVM_API_KEY`        | secret, canonical        | accepted as the single canonical secret input |
| `NEVERMINED_API_KEY` | secret, deprecated alias | mapped internally when canonical is absent    |
| `NVM_ENVIRONMENT`    | public config            | `sandbox` accepted; `live` rejected           |

If both secret names are set identically, the canonical value is used and the
alias is classified as deprecated. If they differ, configuration fails closed
without returning either value. Resolved secret material is non-enumerable so
ordinary JSON/error serialization cannot disclose it. The protocol package
accepts a supplied config record and never reads `process.env` itself.

`NVM_ENV` and `NEVERMINED_ENVIRONMENT` are not supported aliases.

## Four local declarations

Each service has one local agent identity and one positive-price, non-trial PAYG
plan declaration. No upstream registration is performed.

| Service                     | Semantics           | Gross buyer amount (USDC atomic) | Registration state                  |
| --------------------------- | ------------------- | -------------------------------: | ----------------------------------- |
| `company_evidence_graph.v1` | exact               |                            39000 | locally eligible; not registered    |
| `web_context_verified.v1`   | exact               |                             9000 | locally eligible; not registered    |
| `document_evidence_json.v1` | upto / actual usage |                   190000 maximum | prohibited pending capability proof |
| `verify_agent_output.v1`    | exact               |                            19000 | locally eligible; not registered    |

Amounts are derived through `@siteborne/pricing` from
`governance/RISK_LIMITS.yaml`; they are not independent Nevermined constants.
The amount is the canonical gross buyer amount. Eventual Nevermined provider net
proceeds/platform split is a distinct registration-time concern and is not
invented here.

The document declaration also binds actual modes of 12000/native page, 19000/OCR
page, and 29000/table page. It states
`dynamic_actual_settlement_required: true`,
`sandbox_capability_verified: false`, and `registration_allowed: false`.
Deterministic tests prove a 12000 actual charge is sent to the settlement
adapter under a 190000 authorization ceiling and that over-authorization fails
without settlement. This is a local contract proof, not evidence that the
Nevermined sandbox supports post-execution dynamic settlement.

Free, zero-price, credit-trial, and time-trial declarations fail policy
validation. SITEBORNE does not create a free test plan.

## Request-time boundary

The narrow injected facilitator interface exposes only:

- `verifyPermissions` with the structurally validated official
  `X402PaymentRequired`, opaque access token, and authorized maximum;
- `settlePermissions` with the same requirement/token, measured actual amount,
  and optional stable agent request ID.

Registration methods are represented by a separate interface and are not used at
request time. The future adapter must validate the requirement's x402 version,
route, single `nvm:erc4337` acceptance, network, plan, agent, and POST verb
before verification. Successful settlement must match expected payer, network,
actual amount, and a bounded public transaction reference before the lifecycle
advances.

`Payment-Identifier` travels in the already accepted header. It is acquired by
D1 before the future facilitator call and is not derived from the Nevermined
token.

## Deferred work

SUN-0900A Checkpoint 2 owns the injected SDK provider and deterministic four
route adapters through the shared lifecycle. SUN-0900B owns credentials,
builder/subscriber identities, agent/plan registration, live sandbox
verification/settlement, and proof of document actual-usage capability.
Production and `live` remain disabled.
