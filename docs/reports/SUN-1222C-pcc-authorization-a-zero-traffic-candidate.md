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

## Exact-version reachability remediation — Preview URL discovery

Date: 2026-09-10
Remediation result: `PREVIEW_URL_DISABLED`

This section preserves the original failure above. It records the subsequent
read-only remediation checkpoint; it does not reinterpret the production-host
response as candidate evidence.

### Integrity and topology reconfirmation

The remediation began on clean `main` at this report's original evidence
commit:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=ffa458a8c5b088e27da71ef944371c5937b3bb43
WORKING_TREE=CLEAN
EVIDENCE_COMMIT_EXISTS=YES
EVIDENCE_COMMIT_REACHABLE=YES
WRANGLER_VERSION=4.119.0
```

Read-only Wrangler list/view calls reconfirmed version 60:

```text
CANDIDATE_EXISTS=YES
CANDIDATE_VERSION=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
CANDIDATE_VERSION_NUMBER=60
CANDIDATE_SOURCE_COMMIT=2f947bfe0fa1722158323aaf44496ee6ebf046fd
CANDIDATE_TAG=sun1222c-pcc-cutover-candidate
CANDIDATE_METADATA_HAS_PREVIEW=true
CANDIDATE_ASSIGNED_TO_CURRENT_DEPLOYMENT=NO
```

The active public deployment remained:

```text
PUBLIC_DEPLOYMENT_ID=9043050a-3e51-4078-a30a-e4fe819e3efb
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
EXISTING_R6_CANDIDATE_VERSION=d3472f58-f578-4a8f-992b-0d0956c9b561
EXISTING_R6_CANDIDATE_TRAFFIC=0%
NEW_PUBLIC_CANDIDATE_TRAFFIC=0% (unassigned)
```

The paid runtime remained:

```text
PAID_RUNTIME_DEPLOYMENT_ID=0afb9720-73fd-4063-be1d-f09afafc4886
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
```

### Version-override limitation

Current first-party Cloudflare documentation says that a version override can
select only a version contained in the current deployment. If the override is
not applied, routing follows the deployment percentages. Workers supports at
most two versions in one deployment.

- Cloudflare: <https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>
- Cloudflare: <https://developers.cloudflare.com/workers/versions-and-deployments/>

Because `d155c9a1-ca3a-49f9-92a3-b35760dc58e6` is not a member of deployment
`9043050a-3e51-4078-a30a-e4fe819e3efb`, the prior override was legitimately not
applied. Its request consequently followed the current 100%/0% deployment
percentages and reached `db7054c9-76ee-4830-aabe-8a4542261b6a`.

```text
VERSION_OVERRIDE_FAILURE_ROOT_CAUSE=TARGET_VERSION_NOT_IN_CURRENT_DEPLOYMENT
VERSION_OVERRIDE_REQUIRES_VERSION_IN_CURRENT_DEPLOYMENT=YES
VERSION_OVERRIDE_CAN_ADDRESS_UNASSIGNED_UPLOADED_VERSION=NO
EXPECTED_BASELINE_FALLBACK_BEHAVIOR=YES
```

No repeat production-host override request was made.

### Original upload output and Preview URL state

The sanitized Wrangler log for the successful upload is:

```text
/Users/meta4ickal/Library/Preferences/.wrangler/logs/wrangler-2026-09-10_05-20-44_181.log
```

It records the successful upload and candidate ID, then a successful read-only
`GET` of the Worker's `/subdomain` API resource. The literal operator output
ends with the candidate ID and deployment guidance; it contains no
`Version Preview URL` line:

```text
Uploaded siteborne-utility-edge (3.77 sec)
Worker Version ID: d155c9a1-ca3a-49f9-92a3-b35760dc58e6
UPLOAD_RETURNED_PREVIEW_URL=NONE
```

Pinned Wrangler 4.119.0's inspected upload implementation prints a versioned
Preview URL only when all of the following are true: a version ID exists, the
upload API reports `metadata.has_preview`, and the Worker's live subdomain
resource reports `previews_enabled=true`. Here, the first two predicates are
proven true, but no URL was printed after the live subdomain readback.
Therefore the live readback at upload time established
`previews_enabled=false`.

That matches the committed local source of truth:

```text
LOCAL_WORKERS_DEV=true
LOCAL_PREVIEW_URLS=false
LIVE_PREVIEW_URLS_ENABLED=NO
```

Cloudflare documents that disabling Preview URLs disables routing to both
versioned and aliased Preview URLs. It also documents that dashboard state can
be toggled, but any toggle is a settings mutation and is outside this
checkpoint.

- Cloudflare: <https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/>
- Cloudflare Wrangler configuration: <https://developers.cloudflare.com/workers/wrangler/configuration/>

The dashboard was available only at its sign-in screen, so no authenticated UI
state was used. No credentials were entered or exposed. The upload-time live
subdomain readback, pinned Wrangler control flow, exact operator output, and
committed configuration are the evidence for the disabled state.

```text
PREVIEW_URL_ENABLEMENT_MUTATION_REQUIRED=YES
```

### Eligibility distinguished from enablement

The already-collected immutable version metadata reports
`metadata.has_preview=true`, and the candidate's binding readback contains no
Durable Object namespace binding. The public API is a normal named Worker,
rather than a Workers for Platforms user Worker. Its cross-script
`PAID_CONTINUATION_WORKFLOW` binding is a Workflow binding and does not make the
public API Worker a Durable Object implementation.

```text
WORKER_IMPLEMENTS_DURABLE_OBJECT=NO
WORKER_IS_WORKERS_FOR_PLATFORMS_USER_WORKER=NO
PREVIEW_URL_ELIGIBLE=YES
PREVIEW_URLS_ENABLED=NO
```

Eligibility does not override disabled routing.

### Mandatory stop and unexecuted qualification

Section 6 of the remediation authorization required an immediate stop if
Preview URLs were disabled and enabling them required a mutation. Consequently,
no versioned hostname was guessed or requested, no Preview URL association was
claimed, and no candidate runtime qualification was resumed.

```text
VERSIONED_PREVIEW_URL=NONE
PREVIEW_URL_SOURCE=NONE
PREVIEW_URL_CANDIDATE_ASSOCIATION_PROVEN=NO
PREVIEW_URL_TAIL_SUPPORTED=NO (documented limitation; not exercised)
PREVIEW_HEALTH=NOT_EXECUTED_PREVIEW_URL_DISABLED

HOSTNAME_SENSITIVE_SURFACES=NOT_INSPECTED_AFTER_SECTION_6_STOP
CANDIDATE_AGENT_CARD_GENERATION=BLOCKED_PREVIEW_URL_DISABLED
CANDIDATE_JWKS_RUNTIME_ON_PREVIEW=BLOCKED_PREVIEW_URL_DISABLED
CANDIDATE_JWS_CRYPTOGRAPHIC_VERIFICATION=BLOCKED_PREVIEW_URL_DISABLED
CANONICAL_PRODUCTION_JWKS_UNCHANGED=YES
CANDIDATE_MTLS_ADVERTISED=NOT_EVALUATED_PREVIEW_URL_DISABLED

A2A_PREVIEW_REQUEST_STAYS_ON_CANDIDATE=NOT_EVALUATED_PREVIEW_URL_DISABLED
CANDIDATE_A2A_RUNTIME=BLOCKED_PREVIEW_URL_DISABLED
MCP_PREVIEW_REQUESTS_STAY_ON_CANDIDATE=NOT_EVALUATED_PREVIEW_URL_DISABLED
CANDIDATE_MCP_DISCOVERY=BLOCKED_PREVIEW_URL_DISABLED
CANDIDATE_MCP_PROTOCOL=BLOCKED_PREVIEW_URL_DISABLED
CANDIDATE_REST_RUNTIME_REACHABILITY=BLOCKED_PREVIEW_URL_DISABLED
DOCUMENT_ARTIFACT_PREVIEW_PROOF=BLOCKED

PCC_REST_LOCAL_STRUCTURAL_PROOF=NOT_RE_RUN_AFTER_SECTION_6_STOP
PCC_MCP_LOCAL_STRUCTURAL_PROOF=NOT_RE_RUN_AFTER_SECTION_6_STOP
PCC_A2A_LOCAL_STRUCTURAL_PROOF=NOT_RE_RUN_AFTER_SECTION_6_STOP
PCC_REST_PREVIEW_RUNTIME_UNPAID_PROOF=BLOCKED_PREVIEW_URL_DISABLED
PCC_MCP_PREVIEW_RUNTIME_UNPAID_PROOF=BLOCKED_PREVIEW_URL_DISABLED
PCC_A2A_PREVIEW_RUNTIME_UNPAID_PROOF=BLOCKED_PREVIEW_URL_DISABLED
LIVE_FULFILLED_PCC_RESULT_VERIFIED=NO
```

Because candidate qualification did not resume, the source-level settlement
proof was not re-run. The existing authorized invariant remains historical
evidence only:

```text
PUBLIC_API_SETTLE_CALLSITES=0 (not re-run after section 6 stop)
MCP_ADAPTER_SETTLE_CALLSITES=0 (not re-run after section 6 stop)
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1 (not re-run after section 6 stop)
TOTAL_PRODUCTION_SETTLE_CALLSITES=1 (not re-run after section 6 stop)
```

Authorization A's required qualification level and Preview URL sufficiency
cannot be decided from candidate runtime evidence because the already-disabled
Preview URL route prevented Level-1 testing. A production-host exact-version
test would require deployment membership, but that path was not reached or
authorized in this checkpoint.

```text
AUTHORIZATION_A_REQUIRED_QUALIFICATION_LEVEL=NOT_DETERMINED_AFTER_SECTION_6_STOP
CANDIDATE_QUALIFICATION_RECOVERED=NO
PRODUCTION_DEPLOYMENT_COMPOSITION_CHANGE_REQUIRED=NOT_DETERMINED_AFTER_SECTION_6_STOP
D3472F58_IMMUTABLE_VERSION_CAN_REMAIN_RETAINED=YES
D3472F58_ACTIVE_DEPLOYMENT_MEMBERSHIP_CHANGE_AUTHORIZED=NO
```

### Remediation accounting and decision

```text
ADDITIONAL_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENT_MUTATIONS=0
TRAFFIC_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0
REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
REAL_TEST_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_TEST_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
```

```text
SUN1222C_PCC_CANDIDATE_FAILURE_REMEDIATION_EXACT_VERSION_REACHABILITY=PREVIEW_URL_DISABLED
NEXT_REQUIRED_CHECKPOINT=BLOCKER_CHECKPOINT
```

The blocker checkpoint must choose and separately authorize an exact-version
mechanism. The least invasive candidate is explicit Preview URL enablement,
subject to governance review of the repository's deliberate
`preview_urls=false` containment policy. If governance instead requires
production-host proof, the alternative is the separately authorized A2
deployment-membership checkpoint. Neither mutation is authorized here.
