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
now contains the Checkpoint-2 provider and concrete adapter compiled against the
official SDK's `VerifyPermissionsParams` and `SettlePermissionsParams`.
Importing the provider does not initialize `Payments`; authenticated SDK
construction is isolated behind the explicit future sandbox live guard.

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
plan declaration. Declarations themselves perform no upstream registration; the
registration state below records separately authorized sandbox checkpoints.

| Service                     | Semantics               | Gross buyer amount (USDC atomic) | Frozen agent ID                                                                  | Frozen plan ID                                                                   |
| --------------------------- | ----------------------- | -------------------------------: | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `company_evidence_graph.v1` | fixed PAYG              |                            39000 | `63058244394774357835944659628164807563769006924765007721830897155339294179447`  | `61176543225966665382887590264143689398477975837289843272089835781341158489584`  |
| `web_context_verified.v1`   | fixed PAYG              |                             9000 | `37714377069519076502259354421538507339628407587207707299869594618861814144272`  | `94523930722525068656272128894334430057768353189467518442660086462546695282012`  |
| `document_evidence_json.v1` | prepaid dynamic credits |                      190000 pool | `109760621961288696094411057321700210583752765344624386042713081041578011828571` | `64977106381472769302826211192910538031161833107493020584806963732279386695975`  |
| `verify_agent_output.v1`    | fixed PAYG              |                            19000 | `75096875289866166059253207097165867959384005104090226106621988801798698661167`  | `106105151389083481380363516765690985250481102170794631056207896452064676707220` |

Amounts are derived through `@siteborne/pricing` from
`governance/RISK_LIMITS.yaml`; they are not independent Nevermined constants.
The amount is the canonical gross buyer amount. Eventual Nevermined provider net
proceeds/platform split is a distinct registration-time concern and is not
invented here.

The final Checkpoint 2L builder-only audit exhaustively paginated the published
objects and found exactly five agent/plan pairs: one exact canonical pair for
each service and one clearly segregated dynamic-capability probe. All four
frozen pairs passed the accepted authoritative read-back validators and
reconciled `EXACT_EXISTING`; there are no duplicate canonical registrations.

## Four v2 registrations (SUN-1000 checkpoint 1O-B)

Real Nevermined sandbox registrations, same economics as v1
(`SAME_ECONOMICS_NEW_SERVICE_MAJOR`, checkpoint 1L section 9), created after
checkpoint 1O-B discovered and fixed a real agent-name collision: v1 and v2
declarations previously derived the identical plain registry title (e.g. both
"Company Evidence Graph"), so the registration harness's name-based lookup
always matched the _existing_ v1 agent — correctly refused by the endpoint-aware
validator (`WRONG_SERVICE_ENDPOINT`) rather than silently registering, but this
meant v2 could never reach a clean `NO_MATCH` through that same lookup. Fixed by
`deriveNeverminedAgentDisplayName`/ `deriveNeverminedPlanDisplayName`
(`packages/protocol-nevermined/src/ declarations.ts`): v1 names are preserved
byte-for-byte; v2 (and any future major) disambiguates by appending the
canonical service-major identity itself.

Each of the four was independently confirmed `NO_MATCH` after the naming fix,
registered one at a time, and confirmed `EXACT_EXISTING` via authoritative GET
read-back before proceeding to the next. Zero economic side effects:
`delegation_creations=0 token_creations=0 verify_calls=0 service_executions=0 settle_calls=0 payment_identifiers=0 jobs=0 payment_transactions=0`
across all four registrations.

| Service                     | Semantics               | Gross buyer amount (USDC atomic) | Agent ID                                                                        | Plan ID                                                                         |
| --------------------------- | ----------------------- | -------------------------------: | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `company_evidence_graph.v2` | fixed PAYG              |                            39000 | `8945215415179810337511916177281451484220450532075244586308753062965582716389`  | `10268032069987826322514735824876788768903142706079143267509577311063526800318` |
| `web_context_verified.v2`   | fixed PAYG              |                             9000 | `9613264351721376847099143451964490409753221634691266039731516778743818115758`  | `24941537770422129588835488161631149735480385285064676886916949896840067329220` |
| `document_evidence_json.v2` | prepaid dynamic credits |                      190000 pool | `23983377566340233303092237571868603328491815288742632945599286374009053451142` | `47055935846533104006091411392563929683665104827998139102920975407519466945495` |
| `verify_agent_output.v2`    | fixed PAYG              |                            19000 | `27131786432933344978515576530029108070322716902860955144259896627611005129186` | `91900896406434535132462316750130087602675645111856542980525216829631168048994` |

The post-registration account census found exactly nine agents: the five
historical v1/probe pairs (confirmed byte-for-byte unchanged — same IDs, names,
endpoints, linked plan IDs) plus these four new v2 pairs. No duplicate canonical
resources exist for any service.

**These v2 registrations exist as real external state, but are not yet bound to
any executable route.** `NEVERMINED_ROUTES['*.v2']` remains an unmounted
route-string declaration only (`paid-services.ts`'s `v2CdpRoute()` is the only
live v2 wiring); no code path can reach a Nevermined-rail v2 settlement today.
Route binding is separately authorized future work.

**Process-gate deviation, recorded honestly:** these four registrations were
created while
`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_BEFORE_NEXT_PROVIDER_ MUTATION=true`
remained open (the CDP credential exposure from checkpoint 1D was not yet
rotated). The exposed CDP credentials were never used for these Nevermined
mutations — Nevermined authenticates via its own, separate `NVM_API_KEY` sandbox
credential, confirmed present and sandbox-scoped by the SDK's own key-prefix
detection — so the registrations' validity is unaffected. But the frozen "rotate
before next provider mutation" sequencing rule was not followed procedurally,
and this is disclosed as a genuine deviation, not silently treated as satisfied.
**No further provider or payment mutation (Nevermined or CDP) is authorized
until the CDP credential rotation is actually completed.**

The document declaration binds usage-value modes of 12000/native page, 19000/OCR
page, and 29000/table page. The accepted plan acquires 190000 reusable credits
for 190000 atomic USDC and permits variable 12000..190000 redemption. Checkpoint
2H proved zero-balance acquisition followed by a 12000-credit burn and durable
same-payment recovery. Checkpoint 2I proved positive-insufficient behavior is
`FULL_BUNDLE_TOPUP`: 178000 starting + 190000 acquired - 190000 redeemed =
178000 remaining. Therefore `sandbox_capability_verified: true` and
`dynamic_live_allowed: true` are truthful for this bounded sandbox capability.
They do not enable production.

The accepted real web lifecycle is the shared fixed-PAYG provider-mechanism
proof for company, web, and verify: all three use the same SDK/provider,
`nvm:erc4337` scheme, 1/1/1 credits helper, verification/settlement adapter, D1
lifecycle, PCC/receipt path, and PaymentServiceLink v2; only identity, endpoint,
and fixed amount vary. The normative SUN-0900B criteria do not require a
separate controlled payment for every fixed service.

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

## Deterministic route runtime

The four Nevermined-only Hono routes are implemented through the existing shared
paid-service lifecycle. Their server challenge is built with the official SDK
helper and the SITEBORNE binding extension. The opaque `payment-signature` and
separate `Payment-Identifier` are structurally checked, then D1 acquires the
complete v2 rail binding before `verifyPermissions`.

Explicit fixture injection may exercise the lifecycle under fixture evidence
policy. That provider always emits `synthetic_fixture`; only the sealed
authenticated SDK factory can produce evidence eligible for `external_verified`.
Default paths are absent, or return provider-unavailable when explicitly enabled
without authenticated configuration. They never fall back to CDP.

SUN-0900B is accepted as controlled sandbox infrastructure. Its registrations,
fixed-PAYG settlement/recovery proof, document dynamic-credit proof, and
historical evidence are frozen. Controlled self-tests are not revenue,
independent-customer evidence, or production evidence. Production and the
Nevermined `live` environment remain disabled.
