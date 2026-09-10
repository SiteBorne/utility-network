# SUN-1222C PCC Authorization A — Zero-Traffic Candidate Evidence

Date: 2026-09-10  
Final checkpoint result: `CANDIDATE_QUALIFICATION_FAILED`  
Required next checkpoint: `SUN-1222C-PCC-CANDIDATE-FAILURE-REMEDIATION`

## Authorization boundary

This checkpoint authorized exactly one immutable version upload for
`siteborne-utility-edge`. It did not authorize a deployment, traffic change,
paid-runtime deployment, provider call, payment, facilitator verification,
settlement, D1 write, secret mutation, or mTLS provisioning.

```text
TRAFFIC_PROMOTION_AUTHORIZED=NO
PAID_RUNTIME_DEPLOY_AUTHORIZED=NO
MTLS_PROVISIONING_AUTHORIZED=NO
PUBLIC_API_VERSION_UPLOADS_MAX=1
```

## Precommand gate

Immediately before the upload:

```text
SOURCE_HEAD=2f947bfe0fa1722158323aaf44496ee6ebf046fd
WORKING_TREE=CLEAN
PINNED_WRANGLER_VERSION=4.119.0
```

The public deployment was:

```text
PUBLIC_DEPLOYMENT_ID=9043050a-3e51-4078-a30a-e4fe819e3efb
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC_PRE=100%
EXISTING_R6_CANDIDATE_VERSION=d3472f58-f578-4a8f-992b-0d0956c9b561
EXISTING_R6_CANDIDATE_TRAFFIC_PRE=0%
```

The paid continuation runtime was:

```text
PAID_RUNTIME_DEPLOYMENT_ID=0afb9720-73fd-4063-be1d-f09afafc4886
PAID_RUNTIME_PRE_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_PRE_TRAFFIC=100%
```

## Authorized mutation and result

The following was the literal authorized command. The wallet address is an
ordinary Worker variable, not secret material. No secret values are present.

```sh
test "$(git rev-parse HEAD)" = \
"2f947bfe0fa1722158323aaf44496ee6ebf046fd" &&

test -z "$(git status --porcelain)" &&

test "$(npx wrangler --version 2>/dev/null)" = "4.119.0" &&

npx wrangler versions upload \
  --name siteborne-utility-edge \
  --tag sun1222c-pcc-cutover-candidate \
  --message "SUN-1222C PCC cutover candidate: HEAD 2f947bfe0fa1722158323aaf44496ee6ebf046fd + R6 frozen 10-var activation set + matching R6 seller wallet; 0% traffic; production unchanged" \
  --var PAID_ROUTES_ENABLED:true \
  --var PRODUCTION_ENABLED:true \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
  --var PAYMENT_ENVIRONMENT:production \
  --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true \
  --var COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true \
  --var SELLER_WALLET_ADDRESS:0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
```

Wrangler exited successfully and returned:

```text
UPLOAD_EXIT_CODE=0
NEW_PUBLIC_CANDIDATE_VERSION=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
NEW_PUBLIC_CANDIDATE_VERSION_NUMBER=60
PRODUCTION_VERSION_UPLOADS=1
```

No second upload was attempted or authorized.

## Immutable version readback

Wrangler's live version readback reported:

```text
NEW_PUBLIC_CANDIDATE_VERSION=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
NEW_PUBLIC_CANDIDATE_VERSION_NUMBER=60
CREATED_ON=2026-09-10T05:20:47.673843Z
SOURCE=wrangler
TRIGGERED_BY=version_upload
NEW_CANDIDATE_TAG=sun1222c-pcc-cutover-candidate
NEW_CANDIDATE_MESSAGE=SUN-1222C PCC cutover candidate: HEAD 2f947bfe0fa1722158323aaf44496ee6ebf046fd + R6 frozen 10-var activation set + matching R6 seller wallet; 0% traffic; production unchanged
COMPATIBILITY_DATE=2026-08-05
COMPATIBILITY_FLAGS=nodejs_compat
```

Source provenance is the fail-closed precommand chain: the checkout was clean at
`2f947bfe0fa1722158323aaf44496ee6ebf046fd`, and the upload command was guarded
by exact HEAD, clean-tree, and Wrangler-version tests. The Worker version
metadata also records `wrangler`, `version_upload`, and the authorized source SHA
in the immutable message.

```text
NEW_CANDIDATE_SOURCE_COMMIT=2f947bfe0fa1722158323aaf44496ee6ebf046fd
NEW_CANDIDATE_SOURCE_MATCH=YES
```

### Ordinary variables

The complete live readback contained 16 ordinary variables:

```text
AGENT_CARD_SIGNING_KEY_ID=siteborne-agent-card-2026-08
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=true
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=true
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=true
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
NEW_CANDIDATE_VAR_COUNT=16
NEW_CANDIDATE_VAR_FREEZE_MATCH=YES
NEW_CANDIDATE_MISSING_VARS=NONE
NEW_CANDIDATE_UNEXPECTED_VARS=NONE
NEW_CANDIDATE_VALUE_MISMATCHES=NONE
MTLS_PRODUCTION_ACTIVE_PRESENT=NO
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
```

### Non-secret bindings

```text
D1: DB -> efe23c42-cbcc-47c2-9b28-922a541bdcdd (siteborne-utility)
R2: ARTIFACTS -> siteborne-artifacts
KV: CATALOG -> 59dc955c3ebf4208a882f82d8d8fab30
QUEUE: EVENTS -> siteborne-events
QUEUE: JOBS -> siteborne-jobs
AI: AI
BROWSER: BROWSER (version 2)
WORKFLOW: PAID_CONTINUATION_WORKFLOW -> workflow_name=siteborne-paid-continuation, class_name=PaidContinuationWorkflow, script_name=siteborne-paid-continuation-runtime
```

Secret values were neither requested nor exposed. Live readback confirmed only
these secret binding names:

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

```text
NEW_CANDIDATE_BINDING_PARITY=YES
SECRET_VALUES_DISCLOSED=NO
```

## Traffic safety readback

Immediately after upload and again at the terminal checkpoint, public
deployment `9043050a-3e51-4078-a30a-e4fe819e3efb` remained unchanged:

```text
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC_POST=100%
EXISTING_R6_CANDIDATE_VERSION=d3472f58-f578-4a8f-992b-0d0956c9b561
EXISTING_R6_CANDIDATE_TRAFFIC_POST=0%
NEW_PUBLIC_CANDIDATE_VERSION=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
NEW_PUBLIC_CANDIDATE_TRAFFIC=0% (unassigned; absent from the active deployment)
TRAFFIC_MUTATIONS=0
TRAFFIC_SAFETY_VIOLATION=NO
```

Paid runtime deployment `0afb9720-73fd-4063-be1d-f09afafc4886` also remained
unchanged:

```text
PAID_RUNTIME_POST_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_POST_TRAFFIC=100%
PAID_RUNTIME_DEPLOYMENTS=0
```

## Exact-version qualification gate

The previously proven R6 mechanism uses the
`Cloudflare-Workers-Version-Overrides` request header. The new candidate is not
a member of the active deployment, because this checkpoint did not authorize a
deployment or traffic mutation.

A fresh tail was started before a single safe `GET /health` request carrying:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="d155c9a1-ca3a-49f9-92a3-b35760dc58e6"
```

The response was HTTP 200 with body status `ok` and Cloudflare Ray
`a38bfebf0f673e8f-ATL`. The matching fresh tail event authoritatively reported:

```text
scriptName=siteborne-utility-edge
scriptVersion.id=db7054c9-76ee-4830-aabe-8a4542261b6a
request.cloudflare-workers-version-overrides=siteborne-utility-edge="d155c9a1-ca3a-49f9-92a3-b35760dc58e6"
```

The request therefore reached the 100% production baseline, not version
`d155c9a1-ca3a-49f9-92a3-b35760dc58e6`. The public hostname is not an exact
candidate endpoint, and no candidate endpoint was proven. In accordance with
the mandatory section 8 stop instruction, qualification stopped immediately.

```text
ZERO_TRAFFIC_CANDIDATE_QUALIFICATION_ENDPOINT=NONE_PROVEN
QUALIFICATION_ENDPOINT_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
EXPECTED_QUALIFICATION_ENDPOINT_VERSION=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
EXACT_VERSION_REACHABILITY=FAIL
```

An unrelated organic MCP request appeared in the tail after the checkpoint
probe. It was attributed to `db7054c9-76ee-4830-aabe-8a4542261b6a` and is not
counted as a checkpoint-generated request or action.

## Qualification results after mandatory stop

The health response above is not candidate evidence. No further candidate
runtime requests were made. Consequently, the following gates are explicitly
not executed, rather than inferred from the production baseline:

```text
CANDIDATE_HEALTH=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
CANDIDATE_READINESS=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
CANDIDATE_AGENT_CARD_VALID=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
CANDIDATE_JWKS_VALID=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
CANDIDATE_JWS_CRYPTOGRAPHICALLY_VERIFIED=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
CANDIDATE_MTLS_ADVERTISED=NOT_EVALUATED_EXACT_VERSION_UNREACHABLE
CANDIDATE_A2A_LIVENESS=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
CANDIDATE_MCP_DISCOVERY=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
CANDIDATE_MCP_PROTOCOL=NOT_EXECUTED_EXACT_VERSION_UNREACHABLE
PCC_REST_CANDIDATE_STRUCTURAL_PROOF=NOT_EXECUTED_AFTER_SECTION_8_STOP
PCC_MCP_CANDIDATE_STRUCTURAL_PROOF=NOT_EXECUTED_AFTER_SECTION_8_STOP
PCC_A2A_CANDIDATE_STRUCTURAL_PROOF=NOT_EXECUTED_AFTER_SECTION_8_STOP
LIVE_FULFILLED_PCC_RESULT_VERIFIED=NO
```

The settlement semantic proof was not re-run after the section 8 stop. The
authorized pre-checkpoint invariant remains recorded, but is not presented as a
new post-upload execution result:

```text
PUBLIC_API_SETTLE_CALLSITES=0 (authorized pre-checkpoint baseline; not re-run)
MCP_ADAPTER_SETTLE_CALLSITES=0 (authorized pre-checkpoint baseline; not re-run)
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1 (authorized pre-checkpoint baseline; not re-run)
TOTAL_PRODUCTION_SETTLE_CALLSITES=1 (authorized pre-checkpoint baseline; not re-run)
```

## Economic and mutation accounting

```text
PRODUCTION_VERSION_UPLOADS=1
TRAFFIC_MUTATIONS=0
VAR_MUTATIONS_TO_EXISTING_VERSIONS=0
SECRET_MUTATIONS=0
D1_WRITES=0
REAL_TEST_PAYMENTS=0
REAL_PAYMENT_SIGNING_ACTIONS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
REAL_TEST_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_TEST_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

The only checkpoint-generated network request after upload was the unpaid safe
health reachability probe, which was served by the production baseline and did
not invoke a paid service.

## Final decision

The immutable candidate exists, its frozen ordinary-variable map and binding
topology match the authorized R6 candidate, and it has no assigned traffic.
However, the exact immutable candidate could not be reached by the permitted R6
mechanism while remaining outside the active deployment. Runtime qualification
of that candidate is therefore not established.

```text
SUN1222C_PCC_AUTHORIZATION_A_ZERO_TRAFFIC_CANDIDATE=CANDIDATE_QUALIFICATION_FAILED
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-CANDIDATE-FAILURE-REMEDIATION
```

No replacement candidate, deployment, promotion, paid-runtime mutation,
payment, settlement, or mTLS provisioning is authorized by this report.
