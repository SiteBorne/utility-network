# SUN-1222C PCC Feature-Scoped Candidate Remediation

Date: 2026-09-10/11 (America/Chicago)  
Checkpoint authority: `SUN-1222C-PCC-FEATURE-SCOPED-CANDIDATE-REMEDIATION`  
Feature-authorization commit: `8adff17b7741f907f2b851b416443b9125402063`  
Qualified runtime source authority: `8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb`

## Decision

```text
SUN1222C_PCC_FEATURE_SCOPED_CANDIDATE_REMEDIATION=PASS
```

Exactly one immutable public-Worker version was uploaded and exactly one
deployment-composition change replaced only the prior 0% member. The public
baseline remains at 100%, the feature-scoped candidate remains at 0%, and no
canary or cutover was executed.

The resulting candidate contains the already-qualified seller-determinism
runtime and exposes exactly the two capabilities authorized by the R6 feature
decision:

- `verify_agent_output.v2`
- `web_context_verified.v2`

It fails closed for the three blocked capabilities:

- `company_evidence_graph.v2`
- `document_evidence_json.v2`
- `document-artifact-upload`

## Repository and source integrity

Pre-mutation readback was literal:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=8adff17b7741f907f2b851b416443b9125402063
WORKING_TREE=CLEAN
FEATURE_AUTHORIZATION_COMMIT_EXISTS=YES
FEATURE_AUTHORIZATION_COMMIT_REACHABLE=YES
RUNTIME_SOURCE_AUTHORITY_EXISTS=YES
```

The complete `8cc7222..HEAD` diff contained documentation only. Production
source, runtime-affecting configuration, package manifests, and lockfile were
unchanged.

```text
PRODUCTION_SOURCE_DIFF_FROM_8CC7222=EMPTY
PACKAGE_LOCK_RUNTIME_DEPENDENCY_DIFF=EMPTY
WRANGLER_RUNTIME_CONFIG_DIFF=EMPTY
CURRENT_HEAD_CAN_REPRODUCE_8CC_RUNTIME=YES
UPLOAD_REPOSITORY_HEAD=8adff17b7741f907f2b851b416443b9125402063
FEATURE_SCOPED_RUNTIME_SOURCE_AUTHORITY=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb
```

## Pinned tooling and pre-operation topology

Wrangler was pinned at `4.119.0`. Read-only deployment status before the
operation was:

```text
PUBLIC_BASELINE=db7054c9-76ee-4830-aabe-8a4542261b6a @100%
CURRENT_ALL_FIVE_CANDIDATE=f7bf204d-5041-45c0-bb8c-4c3f776d7c9e @0%
PAID_RUNTIME=d62011b9-6219-47e1-8cf9-5006776cfb50 @100%
D155_IMMUTABLE_VERSION_RETAINED=YES
D3472F58_IMMUTABLE_VERSION_RETAINED=YES
```

Cloudflare documents `versions upload` as creating an undeployed version,
`versions deploy` as creating the deployment composition, and version overrides
as selecting only a version in the current deployment. These semantics were
rechecked against the pinned command help and the current first-party Workers
documentation:

- <https://developers.cloudflare.com/workers/wrangler/commands/workers/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>

## Live f7 configuration and exact feature-scoped delta

Live immutable readback of `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` returned
compatibility date `2026-08-05`, compatibility flag `nodejs_compat`, sixteen
ordinary variables, thirteen secret names, and the expected non-secret bindings.
No secret value was printed.

The complete feature-scoped ordinary-variable map is:

```text
AGENT_CARD_SIGNING_KEY_ID=siteborne-agent-card-2026-08
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=false
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=false
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=false
ENVIRONMENT=production
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
LOG_LEVEL=info
NVM_ENVIRONMENT=sandbox
PAID_ROUTES_ENABLED=true
PAYMENT_ENVIRONMENT=production
PCC_VERSION=1.0.0
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
PRODUCTION_ENABLED=true
SELLER_WALLET_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
```

```text
F7_CONFIG_READBACK_COMPLETE=YES
FEATURE_SCOPED_VAR_COUNT=16
FEATURE_SCOPED_VAR_DELTA_FROM_F7=COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true->false; DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true->false; DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true->false
ALL_OTHER_VARS_UNCHANGED=YES
SELLER_WALLET_ADDRESS_CHANGED=NO
PRICE_CONFIGURATION_CHANGED=NO
PAYMENT_ENVIRONMENT_CHANGED=NO
PCC_VERSION_CHANGED=NO
SECRET_NAME_SET_CHANGED=NO
COMPATIBILITY_DATE_CHANGED=NO
COMPATIBILITY_FLAGS_CHANGED=NO
MTLS_PRODUCTION_ACTIVE_TRUE=NO
```

Binding parity was exact: D1 `DB`, R2 `ARTIFACTS`, KV `CATALOG`, Queues `JOBS`
and `EVENTS`, Workers AI `AI`, Browser `BROWSER`, and Workflow
`PAID_CONTINUATION_WORKFLOW` targeting
`siteborne-paid-continuation-runtime/PaidContinuationWorkflow`.

The preserved secret-name set is:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
MODAL_DOCWORKER_ENDPOINT_URL
MODAL_DOCWORKER_PROXY_KEY
MODAL_DOCWORKER_PROXY_SECRET
MODAL_WEBCTX_ENDPOINT_URL
MODAL_WEBCTX_PROXY_KEY
MODAL_WEBCTX_PROXY_SECRET
NVM_API_KEY
PAID_RECEIPT_SIGNING_KEY_ID
PAID_RECEIPT_SIGNING_PRIVATE_KEY
PAYMENT_CONTINUATION_ENCRYPTION_KEY
```

## Dependency closure and evidence inheritance

The three feature flags are checked independently before their respective
production composition or artifact-ingress logic. Neither verify nor web reads
any of the disabled flags. The shared discovery registry resolves each service's
effective status independently; the MCP adapter delegates to the same REST-owned
boundary and preserves the service-specific disabled result.

```text
VERIFY_PATH_DEPENDS_ON_ANY_DISABLED_FLAG=NO
WEB_PATH_DEPENDS_ON_ANY_DISABLED_FLAG=NO
SHARED_REGISTRY_SIDE_EFFECT_ON_ENABLED_PAYMENT_PATH=NO
F7_ENABLED_SERVICE_RUNTIME_PAYMENT_EVIDENCE_INHERITABLE=YES
BOUNDED_PAYMENT_BOUNDARY_REQUALIFICATION_REQUIRED=NO
```

| Prior exact-f7 evidence                        | Inherited for verify/web | Reason                                                         |
| ---------------------------------------------- | ------------------------ | -------------------------------------------------------------- |
| Deterministic local seller resolution          | YES                      | identical source, seller var, and enabled-service route config |
| Pre-402 authenticated CDP calls = 0            | YES                      | provider/seller composition unchanged                          |
| Pre-402 analytics = 0 and retries = 0          | YES                      | same remediated source path                                    |
| MCP to shared REST payment boundary            | YES                      | adapter and enabled REST mappings unchanged                    |
| One quote and one audit maximum                | YES                      | same shared x402 handler                                       |
| Payment attempts before authorization = 0      | YES                      | payment handler unchanged                                      |
| Workflow/provider execution before payment = 0 | YES                      | dispatch boundary unchanged                                    |
| Settlement ownership                           | YES                      | dedicated Workflow remains the sole owner                      |
| Company/document/artifact runtime enablement   | NO                       | deliberately replaced by fresh disabled-state proof below      |

```text
INHERITED_PAYMENT_EVIDENCE_VALID=YES
VERIFY_PAYMENT_BOUNDARY_EVIDENCE=INHERITED_FROM_F7_BY_SOURCE_AND_CONFIG_DEPENDENCY_EQUIVALENCE
WEB_PAYMENT_BOUNDARY_EVIDENCE=INHERITED_FROM_F7_BY_SOURCE_AND_CONFIG_DEPENDENCY_EQUIVALENCE
```

## Feature-disablement contract

| Feature                     | REST behavior              | Catalog behavior                                    | Agent Card/A2A behavior                                               | MCP behavior                                                                                                                   | `production_enabled` | Persistent state possible |
| --------------------------- | -------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------- |
| `company_evidence_graph.v2` | 404 before composition     | listed, `production_enabled=false`, `preproduction` | skill remains declared; x402 extension says `productionEnabled=false` | tool remains discoverable; read-only MCP health says `production_disabled`; calls fail through the same disabled REST boundary | false                | NO                        |
| `document_evidence_json.v2` | 404 before composition     | listed, `production_enabled=false`, `preproduction` | skill remains declared; x402 extension says `productionEnabled=false` | tool remains discoverable; read-only MCP health says `production_disabled`; calls fail through the same disabled REST boundary | false                | NO                        |
| `document-artifact-upload`  | 404 before admission logic | absent (not a catalog paid-service entry)           | absent                                                                | absent                                                                                                                         | N/A                  | NO                        |

This metadata contract is intentionally not universal: company and document
remain discoverable with an explicit disabled state; artifact ingress is not a
paid catalog/A2A/MCP service and is absent from those surfaces. No disabled
feature appears execution-available.

Static source trace proved the company and document flags return before seller
composition, quote/audit persistence, payment verification, provider dispatch,
Workflow handoff, or settlement. The artifact flag returns before admission
window mutation/housekeeping, body processing, D1 lookup/insert, or R2 access.

```text
COMPANY_DISABLED_REJECTION_PRE_STATE=YES
DOCUMENT_DISABLED_REJECTION_PRE_STATE=YES
ARTIFACT_DISABLED_REJECTION_PRE_STATE=YES
```

## Local verification and upload equivalence

The focused feature-scope suite passed 118 tests across 13 files. It covered the
two enabled routes, all three disabled paths, catalog, Agent Card, MCP, A2A,
seller determinism, PCC wire behavior, and settlement ownership.

```text
TARGETED_FEATURE_SCOPE_TESTS=PASS (13 files; 118 tests)
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
PRODUCTION_PREFLIGHT=PASS
PROTOCOL_X402=PASS
PROTOCOL_MCP=PASS
PROTOCOL_A2A=PASS
SELLER_DETERMINISM=PASS
SETTLEMENT_OWNERSHIP=PASS
FEATURE_SCOPED_WRANGLER_DRY_RUN=PASS
EXACT_UPLOAD_DRY_RUN=PASS
DRY_RUN_VAR_DELTA_EXACTLY_THREE=YES
DRY_RUN_BINDING_PARITY_WITH_F7=YES
DRY_RUN_SECRET_SET_EXPECTED_PRESERVED=YES
DRY_RUN_MTLS_TRUE=NO
```

The exact emergency restoration command was also dry-run successfully:

```sh
npx wrangler versions deploy \
  db7054c9-76ee-4830-aabe-8a4542261b6a@100% \
  f7bf204d-5041-45c0-bb8c-4c3f776d7c9e@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C emergency restore: baseline db7054c9 100%; f7bf204d 0%; no cutover" \
  -y
```

```text
ORIGINAL_TOPOLOGY_RESTORABLE=YES
```

## Version upload and immutable readback

The one authorized upload completed without retry:

```text
NEW_FEATURE_SCOPED_CANDIDATE_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
NEW_FEATURE_SCOPED_CANDIDATE_VERSION_NUMBER=62
NEW_FEATURE_SCOPED_CANDIDATE_TAG=sun1222c-pcc-feature-scoped-candidate
FEATURE_SCOPED_VERSION_UPLOADS=1
```

Immutable readback confirmed all sixteen vars, the exact three-value delta, the
same compatibility settings, every non-secret binding, and all thirteen secret
names.

```text
NEW_FEATURE_SCOPED_VAR_COUNT=16
NEW_FEATURE_SCOPED_CONFIG_PARITY_WITH_F7_EXCEPT_3_FLAGS=YES
NEW_FEATURE_SCOPED_BINDING_PARITY_WITH_F7=YES
NEW_FEATURE_SCOPED_SECRET_NAME_PARITY_WITH_F7=YES
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
```

## 0% deployment-membership replacement

The exact replacement command was dry-run before execution and created
deployment `12f9c2c5-b275-4cfb-87ba-dcdbcae8e76e`:

```sh
npx wrangler versions deploy \
  db7054c9-76ee-4830-aabe-8a4542261b6a@100% \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C feature-scoped A2: retain db7054c9 at 100%; replace only f7bf204d 0% member with b6b7477f 0%; no canary" \
  -y
```

Immediate readback was exact:

```text
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
CURRENT_ZERO_PERCENT_CANDIDATE=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
CURRENT_ZERO_PERCENT_CANDIDATE_TRAFFIC=0%
F7_CURRENT_DEPLOYMENT_MEMBER=NO
F7_IMMUTABLE_VERSION_RETAINED=YES
D155_IMMUTABLE_VERSION_RETAINED=YES
D3472F58_IMMUTABLE_VERSION_RETAINED=YES
DEPLOYMENT_COMPOSITION_MUTATIONS=1
NORMAL_TRAFFIC_PERCENTAGE_MUTATIONS=0
```

The emergency restoration was not needed.

## Exact-version runtime qualification

Every candidate request carried:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca"
```

An authoritative JSON tail correlated candidate health ray
`a393d9ccdac3810c-ATL` to version 62. A no-header control ray
`a393d9cf8efbaa0a-ATL` was attributed to baseline `db7054c9...`.

```text
EXACT_FEATURE_SCOPED_VERSION_REACHABILITY=PASS
NORMAL_TRAFFIC_REMAINS_BASELINE=YES
CANDIDATE_HEALTH=PASS
```

Candidate `/ready`, Agent Card, JWKS, `/catalog`, MCP initialize, MCP
tools/list, and MCP health all returned HTTP 200. The Agent Card's single ES256
signature verified locally against the exact fetched JWKS; the JWKS exposed only
public P-256 material. The card advertised no mTLS scheme.

```text
CANDIDATE_READY=PASS (truthful foundation not_ready response with production_services_enabled=true and named external blockers)
CANDIDATE_AGENT_CARD=PASS
CANDIDATE_JWKS=PASS
CANDIDATE_JWS_CRYPTOGRAPHICALLY_VERIFIED=YES
CANDIDATE_MTLS_ADVERTISED=NO
```

Catalog readback showed:

```text
verify_agent_output.v2: production_enabled=true, production_ready=true, price_usd=0.017
web_context_verified.v2: production_enabled=true, production_ready=true, price_usd=0.008
company_evidence_graph.v2: production_enabled=false, production_ready=false
document_evidence_json.v2: production_enabled=false, production_ready=false
document-artifact-upload: absent/unavailable by contract
CATALOG_FEATURE_SCOPE_TRUTHFUL=YES
```

MCP initialize negotiated `2025-11-25`; tools/list returned six tools. The
read-only `siteborne_get_service_health` response explicitly classified verify
and web as `production_enabled`/`configured`, and company and document as
`production_disabled`/`not_live`. The latter tools remain discoverable for
contract visibility but cannot cross their disabled REST boundary. Artifact
ingress has no MCP tool. The Agent Card's x402 service extension independently
reported the same per-service booleans; artifact ingress has no A2A skill.

```text
VERIFY_V2_RUNTIME_ENABLED=YES
WEB_CONTEXT_V2_RUNTIME_ENABLED=YES
MCP_FEATURE_SCOPE_TRUTHFUL=YES
A2A_FEATURE_SCOPE_TRUTHFUL=YES
```

## Disabled-route live proof and state accounting

After static early-rejection proof, exactly one minimal request was sent to each
disabled route. All were tail-attributed to version 62:

| Capability               | Ray                    | Expected | Actual |
| ------------------------ | ---------------------- | -------: | -----: |
| company evidence v2      | `a393dcb88d8e45aa-ATL` |      404 |    404 |
| document evidence v2     | `a393dcb8fbf95f08-ATL` |      404 |    404 |
| document artifact upload | `a393dcb97933f4bb-ATL` |      404 |    404 |

The tightly scoped D1 pre- and post-snapshots were identical:

| Table                                | Before | After | Delta |
| ------------------------------------ | -----: | ----: | ----: |
| `x402_quotes`                        |     73 |    73 |     0 |
| `audit_events`                       |    171 |   171 |     0 |
| `payment_attempts`                   |     18 |    18 |     0 |
| `document_ingress_admission_windows` |      2 |     2 |     0 |
| `job_artifacts`                      |      2 |     2 |     0 |

Artifact R2 writes are zero by both the source-order proof and the live 404: the
false flag returns before the `ARTIFACTS` binding or any body-derived key can be
accessed. No provider, payment-verification, Workflow, or settlement boundary is
reachable from any of the three requests.

```text
COMPANY_RUNTIME_DISABLED=PASS
DOCUMENT_RUNTIME_DISABLED=PASS
ARTIFACT_RUNTIME_DISABLED=PASS
COMPANY_DISABLED_PROBE_D1_WRITES=0
DOCUMENT_DISABLED_PROBE_D1_WRITES=0
ARTIFACT_DISABLED_PROBE_D1_WRITES=0
ARTIFACT_DISABLED_PROBE_R2_WRITES=0
UNATTRIBUTED_D1_WRITES=0
UNATTRIBUTED_R2_WRITES=0
```

No additional quote-producing request was issued because dependency closure
proved the exact f7 payment evidence inheritable.

## Economics, compatibility, observability, and future stages

The enabled-service price and payment configuration remain exact:

```text
verify_agent_output.v2: scheme=exact, price_atomic=17000
web_context_verified.v2: scheme=exact, price_atomic=8000
network=eip155:8453
asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
payTo=unchanged governed SELLER_WALLET_ADDRESS
ENABLED_FEATURE_PRICE_DRIFT=NO
SELLER_ADDRESS_DRIFT=NO
```

The runtime source is identical, so PCC wire shape, x402 requirement schema,
payment verification, provider execution, Workflow handoff, MCP payment wire,
and settlement logic are unchanged.

```text
PCC_WIRE_RESULT_CHANGED=NO
PAYMENT_REQUIREMENT_SCHEMA_CHANGED=NO
PAYMENT_VERIFY_LOGIC_CHANGED=NO
PROVIDER_EXECUTION_LOGIC_CHANGED=NO
WORKFLOW_HANDOFF_LOGIC_CHANGED=NO
SETTLEMENT_LOGIC_CHANGED=NO
MCP_PAYMENT_WIRE_CHANGED=NO
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

The sole critical observability blocker in the R6 decision was artifact
abuse/storage/reclamation health. That feature is now unreachable. For the
enabled two-service set, D1 lifecycle/audit state, durable job state, Workflow
state, and settlement alerting cover the critical failures identified by the
governance review.

```text
CRITICAL_FAILURE_MODE_UNOBSERVABLE_FOR_ENABLED_SET=NO
FEATURE_SCOPED_CANDIDATE_AUTHORIZED_FEATURE_SET=verify_agent_output.v2,web_context_verified.v2
FEATURE_SCOPED_CANDIDATE_BLOCKED_FEATURE_SET=company_evidence_graph.v2,document_evidence_json.v2,document-artifact-upload
FEATURE_SCOPE_MATCHES_GOVERNANCE=YES
```

Fresh read-only D1 lifecycle state remained:

```text
verified=16
settled_external=1
CURRENT_INFLIGHT_PAID_JOBS_TOTAL=17
```

This does not block 0% candidate membership, but it still blocks any paid
runtime transition until the separately governed drain condition is met.

The compatibility matrix remains:

```text
OLD_PUBLIC + OLD_PAID=SAFE
FEATURE_SCOPED_NEW_PUBLIC + OLD_PAID=SAFE
OLD_PUBLIC + NEW_PAID=INCOMPATIBLE
FEATURE_SCOPED_NEW_PUBLIC + NEW_PAID=SAFE
FEATURE_SCOPED_CANDIDATE_COMPATIBILITY=PASS
```

The feature-scoped candidate is technically ready for the already-designed
5%/25%/50%/100% stages, each requiring at least 30 minutes and 500
candidate-attributable requests plus a separate human execution authorization.
No stage was started here.

```text
FEATURE_SCOPED_PUBLIC_CANARY_READY=YES
TRAFFIC_CUTOVER_EXECUTION_AUTHORIZED=NO
NORMAL_TRAFFIC_TO_FEATURE_SCOPED_CANDIDATE=0%
```

The future quiescence derivative is frozen as the exact version-62 config with
one and only one additional delta:

```text
FUTURE_QUIESCED_DERIVATIVE_CONFIG_FREEZE=runtime_source_authority 8cc7222; all 16 feature-scoped vars, compatibility settings, bindings, and secret names identical to b6b7477f; only PAID_ROUTES_ENABLED:true->false
```

Relative to f7 this is four changes: the three disabled feature flags plus
`PAID_ROUTES_ENABLED:true->false`. Strategy A is safer: upload that derivative
unassigned under a later checkpoint and defer exact runtime qualification until
the feature-scoped normal version is at 100%, when the quiesced derivative can
occupy the 0% slot without extra pre-canary membership churn.

```text
RECOMMENDED_QUIESCENCE_PREBUILD_STRATEGY=A
EVIDENCE_ONLY_GAP_MEMBERSHIP_POLICY=KEEP_FEATURE_SCOPED_AT_0
```

## Final mutation and economic accounting

```text
FEATURE_SCOPED_VERSION_UPLOADS=1
DEPLOYMENT_COMPOSITION_MUTATIONS=1
NORMAL_TRAFFIC_PERCENTAGE_MUTATIONS=0
PRODUCTION_TRAFFIC_TO_NEW_CANDIDATE=0%
VAR_MUTATIONS_TO_EXISTING_VERSIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
CUSTOM_DOMAIN_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0
CHECKPOINT_D1_WRITES=0
CHECKPOINT_R2_WRITES=0
CHECKPOINT_QUEUE_WRITES=0
CHECKPOINT_WORKFLOW_CREATIONS=0
REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
PAID_RUNTIME_DEPLOY_AUTHORIZED=NO
MTLS_PROVISIONING_AUTHORIZED=NO
```

The safe next boundary is a separate public-canary execution authorization. This
report does not authorize the 5% stage.

```text
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-PUBLIC-CANARY-EXECUTION-AUTHORIZATION
```
