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

## Authorization A1 — temporary Preview URL enablement safety gate

Date: 2026-09-10

Final A1 result: `PREVIEW_EXPOSURE_UNSAFE`

This section preserves both preceding failures and records the next chronological
checkpoint. Authorization A1 permitted temporary Preview URL enablement only if
the already-production-configured candidate could be exposed safely. The
pre-mutation security gate failed, so Preview URLs were never enabled.

### Repository and live-state integrity

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD_PRE=184ea06f4b59a46cff8dd9a8c550704c17162ac6
WORKING_TREE_PRE=CLEAN
EVIDENCE_COMMIT_EXISTS=YES
EVIDENCE_COMMIT_REACHABLE=YES
WRANGLER_VERSION=4.119.0
RUNTIME_SOURCE_UNCHANGED_SINCE_CANDIDATE=YES
```

Read-only Wrangler calls reconfirmed the candidate and deployments:

```text
CANDIDATE_EXISTS=YES
CANDIDATE_VERSION=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
CANDIDATE_VERSION_NUMBER=60
CANDIDATE_SOURCE_COMMIT=2f947bfe0fa1722158323aaf44496ee6ebf046fd
CANDIDATE_ASSIGNED_TO_CURRENT_DEPLOYMENT=NO

PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
EXISTING_R6_CANDIDATE_VERSION=d3472f58-f578-4a8f-992b-0d0956c9b561
EXISTING_R6_CANDIDATE_TRAFFIC=0%
NEW_CANDIDATE_TRAFFIC=0% / UNASSIGNED

PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
```

### Exact live Preview URL state

The committed configuration remains:

```text
LOCAL_WORKERS_DEV=true
LOCAL_PREVIEW_URLS=false
```

A sanitized, read-only Cloudflare API request using Wrangler's existing
authentication returned HTTP 200 and the exact current subdomain state:

```json
{
  "enabled": true,
  "previews_enabled": false
}
```

```text
PREVIEW_STATE_PRE={"enabled":true,"previews_enabled":false}
LIVE_PREVIEW_URLS_ENABLED_PRE=NO
```

No authentication material or secret value was printed.

### Minimum technical mutation

Current first-party Cloudflare API documentation exposes a script-subdomain
settings resource:

```text
GET  /accounts/{account_id}/workers/scripts/{script_name}/subdomain
POST /accounts/{account_id}/workers/scripts/{script_name}/subdomain
```

The setting-only POST accepts the existing `enabled` value and a
`previews_enabled` boolean. Therefore the minimum reversible operation would
have been a POST preserving `enabled=true` and changing only
`previews_enabled=false -> true`, followed by the exact inverse POST. This is
method B, not `wrangler deploy`; it does not upload code, create a Worker
version, create a deployment, or alter traffic percentages.

- Cloudflare API: <https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/>
- Cloudflare API POST: <https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/>

```text
MINIMUM_PREVIEW_ENABLEMENT_METHOD=B
CREATES_NEW_WORKER_VERSION=NO
CHANGES_ACTIVE_DEPLOYMENT=NO
CHANGES_TRAFFIC=NO
```

No POST was sent because the mandatory exposure gate below failed.

### Existing Access protection

Cloudflare documents three applicable protection scopes: account-level
`all_preview_workers`/`all_workers`, Worker-level `preview_worker`/`worker`, and
hostname-specific Access applications.

- Cloudflare Access for Workers: <https://developers.cloudflare.com/workers/configuration/cloudflare-access/>
- Cloudflare Access applications API: <https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/list>

A sanitized, read-only account Access-application request returned HTTP 403:

```text
access.api.error.not_enabled: Access is not enabled.
```

This is an account-level negative result, not merely an empty application
filter. There can be no inherited account, Worker, or preview-specific Access
application while Access itself is not enabled.

```text
ACCOUNT_OR_WORKER_ACCESS_PROTECTION_ALREADY_PRESENT=NO
PREVIEW_URL_ACCESS_POLICY_ALREADY_PRESENT=NO
TEMPORARY_PREVIEW_PUBLIC_EXPOSURE=YES
```

Cloudflare states that enabled Preview URLs are public unless protected by
Access. No Access policy was created or authorized in A1.

### Production capability exposure

The immutable candidate readback proves all five route activation flags are
true, all four production authorization gates are satisfied, and the candidate
contains real production bindings and secret bindings. Secret values were not
read or exposed.

Relevant candidate state:

```text
PAID_ROUTES_ENABLED=true
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=true
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=true
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=true
PAYMENT_ENVIRONMENT=production
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true

CDP_API_KEY_ID=PRESENT
CDP_API_KEY_SECRET=PRESENT
MODAL_WEBCTX_ENDPOINT_URL=PRESENT
MODAL_WEBCTX_PROXY_KEY=PRESENT
MODAL_WEBCTX_PROXY_SECRET=PRESENT
MODAL_DOCWORKER_ENDPOINT_URL=PRESENT
MODAL_DOCWORKER_PROXY_KEY=PRESENT
MODAL_DOCWORKER_PROXY_SECRET=PRESENT
NVM_API_KEY=PRESENT
PAID_RECEIPT_SIGNING_PRIVATE_KEY=PRESENT
PAYMENT_CONTINUATION_ENCRYPTION_KEY=PRESENT

D1_DB=PRESENT
R2_ARTIFACTS=PRESENT
KV_CATALOG=PRESENT
QUEUE_EVENTS=PRESENT
QUEUE_JOBS=PRESENT
AI=PRESENT
BROWSER=PRESENT
PAID_CONTINUATION_WORKFLOW=PRESENT
```

The candidate source matches the current runtime source; only documentation
commits follow source commit `2f947bfe0fa1722158323aaf44496ee6ebf046fd`.
Static source review establishes these public-preview consequences:

1. Anonymous clients could invoke health, discovery, Agent Card, JWKS, A2A, MCP,
   catalog, service metadata, schemas, and OpenAPI surfaces.
2. An anonymous schema-valid unpaid request to an activated paid route would
   create and persist a payment requirement/quote and audit state before
   returning HTTP 402.
3. A request carrying a structurally valid payment payload reaches the real CDP
   payment evidence provider's verification boundary.
4. After successful verification, the route creates D1 job/payment state and
   hands execution and settlement context to `PAID_CONTINUATION_WORKFLOW`.
5. The web-context and company-evidence compositions contain real external
   executor dependencies; the document-evidence composition contains its real
   document-provider and R2 dependencies.
6. `/v2/artifacts/documents` is deliberately outside the payment machinery and
   performs validate/hash/store against real D1/R2 when its two activation flags
   are true.

The code explicitly labels the post-verification span as real economic
execution. Preview hostname obscurity is not an authorization control.

```text
PREVIEW_URL_USES_PRODUCTION_BINDINGS=YES
PUBLIC_PREVIEW_COULD_INVOKE_UNPAID_DISCOVERY=YES
PUBLIC_PREVIEW_COULD_TRIGGER_PAYMENT_REQUIRED=YES
PUBLIC_PREVIEW_COULD_CREATE_UNPAID_D1_STATE=YES
PUBLIC_PREVIEW_COULD_ACCEPT_REAL_PAID_REQUEST=YES
PUBLIC_PREVIEW_COULD_INVOKE_REAL_PROVIDER_EXECUTION=YES
PUBLIC_PREVIEW_COULD_CREATE_WORKFLOW_STATE=YES
PUBLIC_PREVIEW_COULD_PRODUCE_ECONOMIC_SIDE_EFFECTS=YES
TEMPORARY_PUBLIC_PREVIEW_ACCEPTABLE_FOR_BOUNDED_QUALIFICATION=NO
PREVIEW_ENABLEMENT_AUTHORIZATION_SAFE=NO
```

### Mandatory pre-enable stop

Authorization A1 section 7 requires a stop before enablement when a public
Preview URL could accept a real paid request and no existing Access protection
applies. Both conditions are proven. Consequently:

```text
PREVIEW_ENABLE_MUTATIONS=0
PREVIEW_DISABLE_MUTATIONS=0
PREVIEW_STATE_POST={"enabled":true,"previews_enabled":false}
LIVE_PREVIEW_URLS_ENABLED_FINAL=NO
```

No versioned Preview hostname was made routable, constructed for use, or
requested. Candidate runtime qualification therefore did not resume:

```text
VERSIONED_PREVIEW_URL=NOT_RESOLVED_SAFETY_GATE_STOP
PREVIEW_URL_CANDIDATE_ASSOCIATION_PROVEN=NOT_EXECUTED
CANDIDATE_RUNTIME_REACHABLE=NOT_EXECUTED
CANDIDATE_MTLS_ADVERTISED=NOT_EVALUATED
CANDIDATE_A2A_RUNTIME=NOT_EXECUTED
CANDIDATE_MCP_DISCOVERY=NOT_EXECUTED
CANDIDATE_MCP_PROTOCOL=NOT_EXECUTED
CANDIDATE_REST_RUNTIME_REACHABILITY=NOT_EXECUTED
PCC_REST_PREVIEW_RUNTIME_UNPAID_PROOF=NOT_EXECUTED
PCC_MCP_PREVIEW_RUNTIME_UNPAID_PROOF=NOT_EXECUTED
PCC_A2A_PREVIEW_RUNTIME_UNPAID_PROOF=NOT_EXECUTED
AUTHORIZATION_A_REQUIRED_QUALIFICATION_LEVEL=NOT_DETERMINED_AFTER_SECTION_7_STOP
CANDIDATE_QUALIFICATION_RECOVERED=NO
```

The canonical settlement proof was not re-run after the section 7 stop. The
unchanged source and prior accepted evidence continue to record the historical
invariant, without presenting it as a new A1 execution result:

```text
PUBLIC_API_SETTLE_CALLSITES=0 (not re-run after section 7 stop)
MCP_ADAPTER_SETTLE_CALLSITES=0 (not re-run after section 7 stop)
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1 (not re-run after section 7 stop)
TOTAL_PRODUCTION_SETTLE_CALLSITES=1 (not re-run after section 7 stop)
```

### A1 accounting and decision

```text
ADDITIONAL_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENT_MUTATIONS=0
TRAFFIC_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
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
SUN1222C_PCC_AUTHORIZATION_A1_TEMPORARY_PREVIEW_URL_ENABLEMENT=PREVIEW_EXPOSURE_UNSAFE
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-AUTHORIZATION-A2-ZERO-PERCENT-DEPLOYMENT-MEMBERSHIP
```

A1 made no Cloudflare mutation. The required final Preview URL policy is already
restored because it never changed. Exact-candidate qualification now requires
the separately governed A2 deployment-membership path unless a different
protected, non-public Preview mechanism is authorized first.

## A2 — zero-percent deployment membership and zero-write qualification

Date: 2026-09-10 UTC

Authorization A2 rejected the unsafe public Preview URL path documented above
and authorized one narrowly scoped production deployment-composition change:
replace only the active 0% member with immutable candidate version 60. It did
not authorize another upload, non-zero candidate traffic, paid-runtime changes,
Preview URL enablement, variable/secret/binding changes, payment, provider
execution, settlement, or checkpoint-generated persistent state.

### Integrity and immutable source

The A2 session began from the exact authorized evidence commit on clean `main`:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=c47f0d847b79a456a8be71b48038921322dcbc06
WORKING_TREE=CLEAN
EVIDENCE_COMMIT_EXISTS=YES
EVIDENCE_COMMIT_REACHABLE=YES
```

The only changes after candidate source commit
`2f947bfe0fa1722158323aaf44496ee6ebf046fd` were this chronological report.
Candidate version 60 still identified that source commit in its immutable
version-upload annotation. No second version was uploaded.

### Current Cloudflare mechanism and command equivalence

Pinned Wrangler readback was `4.119.0`. Its live help defined the positional
syntax as `<version-id>@<percentage>` and `--yes` as the non-interactive
confirmation flag. Current Cloudflare documentation establishes that a
deployment contains at most two Worker versions, that a version override can
select only a version in the current deployment, and that a version at 0% gets
no percentage-routed traffic but remains selectable by a valid override.

- Version overrides: <https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>
- Versions and deployments: <https://developers.cloudflare.com/workers/versions-and-deployments/>
- Wrangler `versions deploy`: <https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-deploy>

```text
CURRENT_DEPLOYMENT_MAX_VERSIONS=2
VERSION_OVERRIDE_REQUIRES_VERSION_IN_CURRENT_DEPLOYMENT=YES
ZERO_PERCENT_DEPLOYMENT_MEMBER_RECEIVES_NORMAL_PERCENTAGE_TRAFFIC=NO
ZERO_PERCENT_DEPLOYMENT_MEMBER_CAN_BE_SELECTED_BY_VERSION_OVERRIDE=YES
A2_MECHANISM_VALID=YES
```

The exact proposed command was:

```bash
npx wrangler versions deploy 'db7054c9-76ee-4830-aabe-8a4542261b6a@100%' 'd155c9a1-ca3a-49f9-92a3-b35760dc58e6@0%' --name siteborne-utility-edge --message 'SUN-1222C-PCC-AUTHORIZATION-A2: db7054c9 baseline 100%; d155c9a1 exact candidate 0%; d3472f58 retained immutable' --yes
```

A `--dry-run` with otherwise byte-identical arguments selected exactly those
two versions and displayed 100% and 0% respectively. The command only creates
a deployment referencing existing immutable versions; it does not upload a
version or rewrite either version's source/configuration. Triggers and routes
are a separate Wrangler operation.

```text
WOULD_CHANGE_WORKER_SOURCE=NO
WOULD_UPLOAD_NEW_VERSION=NO
WOULD_CHANGE_VARS=NO
WOULD_CHANGE_SECRETS=NO
WOULD_CHANGE_BINDINGS=NO
WOULD_CHANGE_TRIGGERS=NO
WOULD_CHANGE_ROUTES=NO
WOULD_CHANGE_CUSTOM_DOMAIN=NO
WOULD_CHANGE_PAID_RUNTIME=NO
NORMAL_TRAFFIC_TO_D155C9A1=0%
```

Before mutation, the exact inverse was also successfully dry-run:

```bash
npx wrangler versions deploy 'db7054c9-76ee-4830-aabe-8a4542261b6a@100%' 'd3472f58-f578-4a8f-992b-0d0956c9b561@0%' --name siteborne-utility-edge --message 'SUN-1222C-PCC-AUTHORIZATION-A2-RESTORE: db7054c9 baseline 100%; restore d3472f58 governed candidate 0%' --yes
```

```text
ORIGINAL_TOPOLOGY_RESTORABLE=YES
D3472F58_VERSION_RETENTION_AFTER_MEMBERSHIP_REPLACEMENT=YES
```

### Pre-mutation topology

The last-moment scripted assertions required an exact match before allowing the
mutation:

```text
PRE_DEPLOYMENT_ID=9043050a-3e51-4078-a30a-e4fe819e3efb
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_NORMAL_TRAFFIC_PRE=100%
EXISTING_R6_VERSION=d3472f58-f578-4a8f-992b-0d0956c9b561
EXISTING_R6_NORMAL_TRAFFIC_PRE=0%
NEW_CANDIDATE_VERSION=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
NEW_CANDIDATE_VERSION_NUMBER=60
NEW_CANDIDATE_NORMAL_TRAFFIC_PRE=0%/UNASSIGNED
PAID_RUNTIME_VERSION_PRE=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC_PRE=100%
PRE_MUTATION_TOPOLOGY_ASSERTIONS=PASS
```

### Persistent-state safety classification

The following table is based on the exact candidate source. “Provider” includes
the production CDP authenticated-seller lookup that can occur while a paid
route's per-isolate composition is first constructed; it is conservatively
classified as an external provider call even though it is not useful service
execution. A2 did not rely on an already-warm isolate.

| Probe | Endpoint | Request class | Expected status | D1 write possible | R2 write possible | Queue write possible | Workflow creation possible | Provider call possible | Payment verify possible | Settlement possible | Safe under A2 |
|---|---|---|---:|---|---|---|---|---|---|---|---|
| Health | `/health` | GET/read-only | 200 | No | No | No | No | No | No | No | Yes |
| Readiness | `/ready` | GET/read-only | 200 | No | No | No | No | No | No | No | Yes |
| Agent Card | `/.well-known/agent-card.json` | GET/read-only | 200 | No | No | No | No | No | No | No | Yes |
| JWKS | `/.well-known/jwks.json` | GET/read-only | 200 | No | No | No | No | No | No | No | Yes |
| A2A discovery | Agent Card then `/a2a` resolution | GET/read-only | 200 | No | No | No | No | No | No | No | Yes |
| A2A `SendMessage` | `/a2a` | schema-valid, no payment; closed default boundary and per-request in-memory task store | 200 task/input-required | No | No | No | No | No | No | No | Yes |
| MCP initialize | `/mcp` | discovery | 200 | No | No | No | No | No | No | No | Yes |
| MCP tools/list | `/mcp` | discovery | 200 | No | No | No | No | No | No | No | Yes |
| MCP malformed tools/call | `/mcp` | non-object params, rejected before tool boundary | 400 | No | No | No | No | No | No | No | Yes |
| MCP schema-valid unpaid paid-tool call | `/mcp` to real REST adapter | valid tool input without payment | 402 if completed | Yes, quote + audit | No | No | No | Yes on cold composition | No | No | No |
| REST malformed paid request | four active `/v2/...` routes | malformed JSON, but route composition precedes body parsing on a cold isolate | 400 if composition completes | No from malformed-body branch | No | No | No | Yes on cold composition | No | No | No |
| REST schema-valid unpaid request | four active `/v2/...` routes | valid input without payment | 402 | Yes, quote + audit | No | No | No | Yes on cold composition | No | No | No |
| Document upload malformed | `/v2/artifacts/documents` | generic malformed request | 4xx | Yes for variants reaching distributed ingress admission; declared-oversize alone rejects earlier | No before storage | No | No | No | No | No | Only the declared-oversize subtype is statically safe |
| Document upload valid | `/v2/artifacts/documents` | valid upload | 201 | Yes | Yes | No | No | No | No | No | No |

```text
A2_SAFE_PROBES=/health; /ready; Agent Card; JWKS; A2A discovery; A2A SendMessage through the closed in-memory boundary; MCP initialize; MCP tools/list; MCP malformed tools/call; GET /catalog; declared-oversize document rejection (structurally safe but not executed)
A2_STATE_WRITING_PROBES=MCP schema-valid unpaid paid-tool call; REST schema-valid unpaid paid request; generic document-upload malformed variants that reach distributed admission; valid document upload
REST_MALFORMED_PAID_REQUEST=BLOCKED_REQUIRES_BOUNDED_STATE_WRITE_AUTHORIZATION_OR_EXTERNAL_PROVIDER_CALL_AUTHORIZATION
```

No write-capable probe was run. Before the deployment, 73 targeted tests passed
across the settlement-ownership, A2A, MCP transport, and document-upload safety
suites.

```text
ZERO_WRITE_EXACT_RUNTIME_QUALIFICATION_SUFFICIENT=YES
CHECKPOINT_D1_WRITES_MAX=0
CHECKPOINT_R2_WRITES_MAX=0
CHECKPOINT_QUEUE_WRITES_MAX=0
CHECKPOINT_WORKFLOW_CREATIONS_MAX=0
CHECKPOINT_PROVIDER_CALLS_MAX=0
CHECKPOINT_PAYMENT_VERIFY_CALLS_MAX=0
CHECKPOINT_SETTLEMENTS_MAX=0
```

This means the candidate's exact version, read-only public runtime, signed
identity, service discovery, and closed no-free-use protocol behavior could be
meaningfully qualified. It does not mean the state-creating 402 or paid
execution lifecycle was qualified.

### Authorized membership mutation and post-state

The exact command above exited 0. Wrangler reported:

```text
SUCCESS Deployed siteborne-utility-edge version db7054c9-76ee-4830-aabe-8a4542261b6a at 100% and version d155c9a1-ca3a-49f9-92a3-b35760dc58e6 at 0%
A2_DEPLOYMENT_COMMAND_EXIT_CODE=0
A2_NEW_DEPLOYMENT_ID=f5c536de-53d6-4ea9-acd1-3f8d006b8ca7
```

Wrangler's deployment output also listed a sync of already-identical
non-versioned observability state: `logpush=false`, observability enabled, and
head sampling rate 1. It reported no source, route, trigger, variable, secret,
binding, or percentage change outside the authorized membership composition.

Immediate readback was exact:

```text
POST_DEPLOYMENT_ID=f5c536de-53d6-4ea9-acd1-3f8d006b8ca7
PUBLIC_BASELINE_TRAFFIC_POST=100%
NEW_CANDIDATE_NORMAL_TRAFFIC_POST=0%
D3472F58_CURRENT_DEPLOYMENT_MEMBER=NO
D3472F58_IMMUTABLE_VERSION_RETAINED=YES
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
PAID_RUNTIME_DEPLOYMENTS=0
```

`wrangler versions list` still returned d3472f58 as immutable version 59 and
d155c9a1 as immutable version 60. No restoration deployment was required.

### Exact-version override and normal-traffic control

A bounded Wrangler tail session was running before the probes. The candidate
health request carried the exact documented structured header:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="d155c9a1-ca3a-49f9-92a3-b35760dc58e6"
```

It returned HTTP 200 with `status: ok`; tail correlated Cloudflare Ray
`a38e3bc71c0be3da-ATL` to script `siteborne-utility-edge` and
`scriptVersion.id=d155c9a1-ca3a-49f9-92a3-b35760dc58e6`.

A separate no-header `/health` control returned HTTP 200; tail correlated Ray
`a38e3c148af9b229-ATL` to
`scriptVersion.id=db7054c9-76ee-4830-aabe-8a4542261b6a`.

```text
EXACT_VERSION_OVERRIDE_REACHABILITY=PASS
NORMAL_TRAFFIC_REMAINS_BASELINE=YES
```

### Candidate read-only runtime results

Every candidate request below carried the version override. Tail correlation
used the response Ray ID and attributed every listed request to d155c9a1.

- `/ready`: HTTP 200; `production_services_enabled=true`.
- Agent Card: HTTP 200; one signed card with all eight service identities, the
  four v2 services marked `productionEnabled=true`, the four v1 services false,
  and the canonical `/a2a` interface.
- JWKS: HTTP 200; exactly one public P-256/ES256 key, no private `d` member.
- Local verification passed using `verifyAgentCardAgainstTrustedJwks` with the
  explicitly fetched candidate card and candidate JWKS. The verifier followed
  no network URL.
- Agent Card `securitySchemes` resolved to `{}` and root
  `securityRequirements` to `[]`; no mutual TLS capability was advertised.
- A guarded A2A SDK fetch injector rejected any origin other than
  `https://utility.siteborne.net` and added the override to both requests.
  Discovery and `POST /a2a` were each HTTP 200 and candidate-attributed. The
  schema-valid `SendMessage` returned an in-memory `payment_required` Task,
  `productionEnabled=false`, and zero artifacts.
- MCP initialize returned HTTP 200 and negotiated protocol `2025-11-25` with
  server `net.siteborne/utility` 0.1.0.
- MCP tools/list returned HTTP 200 and six tools: the four v2 service tools,
  each explicitly payment-required, plus read-only quote and health helpers.
- MCP malformed `tools/call` with non-object params returned HTTP 400 before
  service-boundary dispatch.
- `/catalog`: HTTP 200; exactly eight services, with the four v2 services true
  for `production_enabled` and all four v1 services false.

```text
CANDIDATE_AGENT_CARD_RUNTIME=PASS
CANDIDATE_JWKS_RUNTIME=PASS
CANDIDATE_JWS_CRYPTOGRAPHICALLY_VERIFIED=YES
CANDIDATE_MTLS_ADVERTISED=NO
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
A2A_ALL_REQUESTS_ATTRIBUTED_TO_D155C9A1=YES
CANDIDATE_A2A_ZERO_WRITE_RUNTIME_PROOF=PASS
MCP_ALL_REQUESTS_ATTRIBUTED_TO_D155C9A1=YES
CANDIDATE_MCP_INITIALIZE=PASS
CANDIDATE_MCP_DISCOVERY=PASS
```

REST family accounting is deliberately scoped:

| Service ID | Activation visible | Malformed rejection runtime proof | Schema-valid unpaid 402 proof |
|---|---|---|---|
| `verify_agent_output.v2` | YES — Agent Card, MCP, catalog | NOT_EXECUTED — cold-composition provider-call risk | NOT_EXECUTED — state-writing |
| `web_context_verified.v2` | YES — Agent Card, MCP, catalog | NOT_EXECUTED — cold-composition provider-call risk | NOT_EXECUTED — state-writing |
| `company_evidence_graph.v2` | YES — Agent Card, MCP, catalog | NOT_EXECUTED — cold-composition provider-call risk | NOT_EXECUTED — state-writing |
| `document_evidence_json.v2` | YES — Agent Card, MCP, catalog | NOT_EXECUTED — cold-composition provider-call risk | NOT_EXECUTED — state-writing |
| `document-artifact-upload` | YES — immutable var/binding readback and local structural route proof | NOT_EXECUTED — generic malformed variants may write admission state | NOT_EXECUTED — valid upload writes D1/R2 |

```text
VALID_DOCUMENT_ARTIFACT_UPLOAD_EXECUTED=NO
CHECKPOINT_R2_WRITES=0
PCC_REST_RUNTIME_EVIDENCE_CLASS=CANDIDATE_RUNTIME_READ_ONLY + LOCAL_STRUCTURAL; paid-route rejection/402 blocked
PCC_MCP_RUNTIME_EVIDENCE_CLASS=CANDIDATE_RUNTIME_READ_ONLY + CANDIDATE_RUNTIME_PRE_WRITE_REJECTION + LOCAL_STRUCTURAL
PCC_A2A_RUNTIME_EVIDENCE_CLASS=CANDIDATE_RUNTIME_READ_ONLY + closed in-memory no-free-use SendMessage + LOCAL_STRUCTURAL
LIVE_FULFILLED_PCC_RESULT_VERIFIED=NO
```

### Fresh settlement ownership proof

The canonical source guard was re-run during A2 and all four tests passed:

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

This is fresh source/semantic evidence, not a live settlement and not a paid
request.

### Qualification, exposure, and retention policy

All executed candidate runtime probes passed and no candidate defect was found.
Qualification remains partial only because A2's deliberate no-write/no-provider
boundary excludes the four REST 400/402 paths, schema-valid paid MCP tool calls,
and the document upload lifecycle.

```text
CANDIDATE_ZERO_WRITE_RUNTIME_QUALIFICATION=PARTIAL
STATE_WRITING_QUALIFICATION_GAPS=four REST malformed/402 runtime proofs; MCP schema-valid paid-tool 402; document-artifact malformed admission path and valid D1/R2 upload; all live fulfilled paid/PCC execution
CANDIDATE_RUNTIME_DEFECT_FOUND=NO
ZERO_WRITE_EVIDENCE_GAP_DEPLOYMENT_POLICY=A
D155C9A1_CURRENT_ZERO_PERCENT_CANDIDATE=YES
D3472F58_STATUS=SUPERSEDED_BUT_IMMUTABLE_RETAINED
```

Policy A is safer and matches the purpose of A2: exact-version read-only
qualification succeeded; the baseline remains 100%; restoring the former 0%
member would remove exact override reachability without curing any candidate
defect. The remaining proof requires its own bounded state/provider authority.

Before A2, d3472f58 was already public-override-addressable and carried the
same production secrets, bindings, and activated REST routes. d155c9a1 adds a
payment-aware MCP adapter to the same REST-owned payment lifecycle and full PCC
wire results. That is a broader protocol entry path, but not a new exposure
class: both states expose a 0%-traffic, explicit-override-only candidate with
production bindings and payment-gated useful execution.

```text
D155C9A1_OVERRIDE_ADDRESSABLE_PUBLICLY=YES
D3472F58_WAS_OVERRIDE_ADDRESSABLE_PUBLICLY=YES
A2_CREATES_NEW_EXPOSURE_CLASS=NO
A2_CHANGES_WHICH_CANDIDATE_IS_OVERRIDE_ADDRESSABLE=YES
MATERIALLY_BROADER_CANDIDATE_CAPABILITY=payment-aware MCP calls can enter the existing REST payment boundary; still payment-gated and not exercised in A2
```

### A2 accounting and decision

```text
NORMAL_TRAFFIC_BASELINE_PRE=100%
NORMAL_TRAFFIC_BASELINE_POST=100%
NORMAL_TRAFFIC_D155_PRE=0%/UNASSIGNED
NORMAL_TRAFFIC_D155_POST=0%
NORMAL_TRAFFIC_PERCENTAGE_MUTATIONS=0
PRODUCTION_DEPLOYMENT_MUTATIONS=1
DEPLOYMENT_MEMBERSHIP_MUTATIONS=1
VERSION_OVERRIDE_ROUTABILITY_CHANGED=YES

ADDITIONAL_VERSION_UPLOADS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0

CHECKPOINT_D1_WRITES=0
CHECKPOINT_R2_WRITES=0
CHECKPOINT_QUEUE_WRITES=0
CHECKPOINT_WORKFLOW_CREATIONS=0
CHECKPOINT_PROVIDER_CALLS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_TEST_PAYMENTS=0
REAL_TEST_PROVIDER_CALLS=0
REAL_TEST_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0

TRAFFIC_CUTOVER_AUTHORIZED=NO
FEATURE_CUTOVER_AUTHORIZED=NO
PAID_RUNTIME_DEPLOY_AUTHORIZED=NO
MTLS_PROVISIONING_AUTHORIZED=NO
```

```text
SUN1222C_PCC_AUTHORIZATION_A2_ZERO_PERCENT_DEPLOYMENT_MEMBERSHIP=PASS_WITH_STATE_WRITE_QUALIFICATION_GAPS
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-BOUNDED-QUALIFICATION-STATE-WRITE-AUTHORIZATION
```

Chronology is preserved: the candidate upload succeeded; the first
production-host override attempt failed safely because the candidate was not a
current deployment member; remediation identified the documented override
requirement; A1 rejected unprotected Preview URLs; A2 then made the minimum
authorized 0%-membership change, recovered exact-version read-only runtime
qualification, and stopped before any persistent-state or economic probe.

## SUN-1222C-PCC-BOUNDED-QUALIFICATION-STATE-WRITE-AUTHORIZATION

**Executed 2026-09-10. Decision: `EXTERNAL_PROVIDER_BOUNDARY_BLOCKED`.** This
checkpoint authorized narrowly attributable, non-economic qualification writes
only if the complete write set was known in advance, external-provider network
calls remained zero, and no unrelated production record was changed or
deleted. The static and live preflight gates found two independent blockers, so
no state-writing request was issued. This is not evidence of a candidate
runtime defect.

### Integrity, topology, and exact-version selection

The inherited evidence commit
`be7a09ac8c407c6b215988d32325b560e5afcda8` existed and was reachable from
clean `main`. Candidate source remained
`2f947bfe0fa1722158323aaf44496ee6ebf046fd`; the only source-to-HEAD delta was
this chronological evidence report.

Read-only Wrangler 4.119.0 readback before and after the checkpoint returned
the same deployment topology:

```text
PUBLIC_DEPLOYMENT_ID=f5c536de-53d6-4ea9-acd1-3f8d006b8ca7
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
CURRENT_ZERO_PERCENT_CANDIDATE=d155c9a1-ca3a-49f9-92a3-b35760dc58e6
CURRENT_ZERO_PERCENT_CANDIDATE_TRAFFIC=0%
D3472F58_IMMUTABLE_VERSION_RETAINED=YES
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
PUBLIC_DEPLOYMENT_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
```

Exactly one read-only health request carried:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="d155c9a1-ca3a-49f9-92a3-b35760dc58e6"
```

`GET /health?qualification=sun1222c-state-write-reconfirm` returned HTTP 200.
Tail correlated response Ray `a38e6356fc373110-ATL` with
`scriptVersion.id=d155c9a1-ca3a-49f9-92a3-b35760dc58e6`.

```text
EXACT_VERSION_OVERRIDE_REACHABILITY_RECONFIRMED=YES
```

### Qualification identity and planned attribution

```text
QUALIFICATION_RUN_ID=sun1222c-pcc-q-9e626a8f73daa2b2cdce0a5c2eabc89a27ecedc82a5671ad
```

The artifact route accepts no caller-controlled filename, request ID, or
metadata field. Its planned deterministic synthetic body was therefore the
68-byte `application/pdf` magic-prefix fixture containing the qualification ID.
The locally computed identity was:

```text
FIXTURE_SIZE_BYTES=68
FIXTURE_SHA256=sha256:fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef
PLANNED_R2_KEY=artifacts/fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef
```

Had the probe passed every gate, attribution would have combined the unique
body/hash and content-addressed key, returned `upload_id`, exact D1 metadata
row, current source/global admission window, response Ray, candidate tail
attribution, and exact pre/post diff. The REST and MCP routes likewise expose
no safe caller correlation field before payment; their generated quote and
requirement IDs plus Ray and time window would have been used. No contract
shape was altered to insert the qualification ID.

```text
QUALIFICATION_ATTRIBUTION_STRATEGY=unique synthetic bytes and SHA-256/R2 key; returned upload_id; exact D1 row; source/global window deltas; Ray/tail; for blocked payment routes, generated quote/requirement IDs plus Ray/time window
```

### Pre-write D1 and R2 snapshot

The only potentially written D1 tables for the three proposed probes were
`x402_quotes`, `audit_events`, `document_ingress_admission_windows`, and
`job_artifacts`. `payment_attempts` would not be written by a payment-absent
request but was included in the control snapshot; `queue_dispatches` was also
included as a zero-write control. The only potentially written R2 bucket was
`siteborne-artifacts`.

| Table | `ROW_COUNT_PRE` | `MAX_TIMESTAMP_PRE` / maximum window | Relevant pre-state |
|---|---:|---|---|
| `x402_quotes` | 72 | `2026-09-08T13:05:48.509Z` | v2 counts: company 22, document 8, verify 15, web 27 |
| `audit_events` | 170 | `2026-09-08T13:05:49.839Z` | no checkpoint correlation; historical v2 events only |
| `payment_attempts` | 18 | `2026-09-08T13:05:49.043Z` | control table; no payment-absent write expected |
| `job_artifacts` | 1 | `2026-09-02T13:52:11.064Z` | fixture-hash rows: 0 |
| `document_ingress_admission_windows` | 2 | window start `1788393600000` (`2026-09-03T00:00:00Z`) | one source row and one global row, each count 4; no current-window row |
| `queue_dispatches` | 0 | `NULL` | zero-write control |

The exact planned R2 key did not exist: Wrangler's read-only object fetch
returned `The specified key does not exist.` No unrelated row payload and no
credential was read or recorded.

```text
POTENTIALLY_WRITTEN_D1_TABLES=x402_quotes,audit_events,document_ingress_admission_windows,job_artifacts
POTENTIALLY_WRITTEN_R2_BUCKETS=siteborne-artifacts
```

### Static side-effect trace — REST unpaid 402

All four activated service families use the same production composition and
the same x402 route lifecycle. Each production route first checks the global
and service flag, then builds its production route configuration. That builder
calls `resolveProductionCdpEvidenceProvider`; with the candidate's authorized
production gates and credentials, it invokes
`getAuthenticatedSellerAddress`, implemented by
`buildCdpSellerAddressLookup`. That closure constructs a real CDP client and
awaits `client.evm.getAccount({address: SELLER_WALLET_ADDRESS})`. This is a real
authenticated external network request (classification B), not client-only
construction. It happens before `createX402ServiceRoute` mounts the handler and
therefore before request JSON validation or the unpaid 402 branch.

Only after that call succeeds would the shared handler parse and validate the
body, compute its canonical input hash, build a quote/requirement, insert one
`x402_quotes` row, insert one `payment_required_created` `audit_events` row,
and return HTTP 402. With no payment signature it would create no
`payment_attempts`, job, queue entry, Workflow, provider execution,
facilitator-verify call, settlement, or chain transaction.

| Service ID | Route | Seller lookup classification | Quote | Audit | Payment attempt | Queue | Workflow | Useful provider | Verify | Settle | Safe under zero-external-call cap |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `verify_agent_output.v2` | `/v2/verify/agent-output` | B: authenticated CDP `evm.getAccount` | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | NO |
| `web_context_verified.v2` | `/v2/web/context` | B: authenticated CDP `evm.getAccount` | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | NO |
| `company_evidence_graph.v2` | `/v2/company/evidence-graph` | B: authenticated CDP `evm.getAccount` | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | NO |
| `document_evidence_json.v2` | `/v2/document/evidence-json` | B: authenticated CDP `evm.getAccount` | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | NO |

`REST_402_SAFE_WITHOUT_EXTERNAL_PROVIDER_CALL=NO` for every service. The
representative REST probe was not executed; repeating it across four services
would not change the shared pre-handler boundary.

### Static side-effect trace — MCP paid tool

The exact chain is: MCP `tools/call` -> protocol-MCP service tool ->
`createMcpX402ServiceBoundary.execute` -> map service to its `/v2/*` path ->
construct a payment-absent internal request -> invoke the same production REST
route in a one-route Hono sub-app -> build the same production composition ->
authenticated CDP `evm.getAccount` -> shared x402 route -> translate REST 402
into MCP `payment_required`.

The adapter itself imports no repository, facilitator, Workflow, or settlement
implementation and performs no write. If the external lookup were separately
authorized and succeeded, the REST boundary would insert the same one quote
and one audit event. No Workflow, facilitator verification, or settlement is
possible on the payment-absent branch.

```text
MCP_ITSELF_WRITES_STATE=NO
REST_BOUNDARY_WRITES_STATE=YES (one quote plus one audit event, only after route construction)
EXTERNAL_PROVIDER_CALL_BEFORE_402=YES
WORKFLOW_CREATED_BEFORE_PAYMENT=NO
FACILITATOR_VERIFY_BEFORE_PAYMENT=NO
SETTLEMENT_POSSIBLE=NO
```

The MCP paid-tool probe was not executed because it would cross the same
forbidden external-provider boundary and would duplicate the REST quote state.

### Static side-effect trace — document artifact admission/storage

For `POST /v2/artifacts/documents`, an oversized declared Content-Length above
10,485,760 bytes returns 413 before admission and writes nothing. Other
structural failures under the byte cap consume admission state before body
validation, but create no artifact metadata or R2 object. A valid upload runs
in this order: two-axis D1 admission, bounded body read, exact content-type and
magic-signature validation, SHA-256, D1 content-hash lookup, R2 head/put, then
one `job_artifacts` insert. The route imports no payment, facilitator,
provider-executor, Workflow, or settlement path and emits no queue event.

```text
MINIMAL_VALID_ARTIFACT_REQUEST_EXISTS=YES
MINIMAL_ARTIFACT_CAN_USE_SYNTHETIC_NON_SENSITIVE_FIXTURE=YES
MINIMAL_ARTIFACT_MAX_BYTES=10485760
EXTERNAL_PROVIDER_CALLS_FOR_ARTIFACT_UPLOAD=0
PAYMENT_CALLS_FOR_ARTIFACT_UPLOAD=0
WORKFLOW_CREATIONS_FOR_ARTIFACT_UPLOAD=0
SETTLEMENT_CALLS_FOR_ARTIFACT_UPLOAD=0
```

The admission code also invokes `deleteWindowsOlderThan` after each admitted
axis. For the current window `1788998400000` (`2026-09-10T00:00:00Z`), the
cleanup cutoff is `1788825600000` (`2026-09-08T00:00:00Z`). Both existing
September 3 rows are older than that cutoff. Therefore a single valid upload
would deterministically insert two current-window rows, delete those two
unrelated expired production admission rows, create one R2 object, and insert
one artifact metadata row. The checkpoint expressly prohibited modification
or deletion of unrelated production records. The artifact request was thus
not authorized, even though its economic/external-call boundary itself is
safe.

### Probe matrix and hard caps

| Probe | Surface/service | Expected status | D1 inserts max | D1 updates max | D1 deletes | R2 objects max | Queue | Workflow | External provider calls | Payment verify | Settlement | Authorized |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| REST-1 | REST representative v2 service | 402 | 2 | 0 | 0 | 0 | 0 | 0 | 1 CDP lookup | 0 | 0 | NO |
| MCP-1 | MCP representative paid tool -> REST | MCP `payment_required` | 2 | 0 | 0 | 0 | 0 | 0 | 1 CDP lookup | 0 | 0 | NO |
| ART-1 | document artifact upload | 201 | 3 | 0 | 2 unrelated expired windows | 1 | 0 | 0 | 0 | 0 | 0 | NO |

One artifact request would have been the minimum to prove its runtime storage
path; one representative payment request would have sufficed for the four
statically equivalent REST services, and MCP would have been an additional
transport proof. No finite set of those requests can satisfy the authorization
as written because each proposed request violates at least one hard boundary.
The executable cap was narrowed from the default three requests to zero:

```text
MINIMUM_SUFFICIENT_STATE_WRITING_REQUEST_COUNT=0
CHECKPOINT_STATE_WRITING_HTTP_REQUESTS_MAX=0
CHECKPOINT_D1_NEW_ROWS_MAX=0
CHECKPOINT_D1_UPDATED_ROWS_MAX=0
CHECKPOINT_D1_DELETED_ROWS_MAX=0
CHECKPOINT_R2_NEW_OBJECTS_MAX=0
CHECKPOINT_QUEUE_WRITES_MAX=0
CHECKPOINT_WORKFLOW_CREATIONS_MAX=0
CHECKPOINT_EXTERNAL_PROVIDER_NETWORK_CALLS_MAX=0
CHECKPOINT_PAYMENT_VERIFY_CALLS_MAX=0
CHECKPOINT_SETTLEMENT_CALLS_MAX=0
CHECKPOINT_CHAIN_TRANSACTIONS_MAX=0
```

### Cleanup and retention policy

No checkpoint row or object was created, so no cleanup mutation was needed.
The source-supported policies that would apply are:

| State | Policy | Reason |
|---|---|---|
| `x402_quotes` | `RETAIN_AS_QUALIFICATION_EVIDENCE` | durable server-issued requirement needed for a later payment retry; no narrow immediate public cleanup path |
| `audit_events` | `RETAIN_AS_QUALIFICATION_EVIDENCE` | append-only governance evidence |
| `payment_attempts` | `DO_NOT_TOUCH` | no payment-absent write; payment idempotency authority |
| `document_ingress_admission_windows` | `DO_NOT_TOUCH` | shared source/global quota counters; literal deletion could weaken production admission policy |
| `job_artifacts` | `RETAIN_AS_QUALIFICATION_EVIDENCE` | buyer upload record is ephemeral and repository reclamation is age-gated to 24 hours, not immediate |
| `siteborne-artifacts` object | `RETAIN_AS_QUALIFICATION_EVIDENCE` | repository-supported reclamation deletes R2 before D1 only after the same 24-hour age gate |
| queue/workflow state | `DO_NOT_TOUCH` | no write is permitted or expected |

```text
RETAINED_QUALIFICATION_ROWS=NONE
DELETED_QUALIFICATION_ROWS=NONE
RETAINED_R2_OBJECTS=NONE
DELETED_R2_OBJECTS=NONE
```

### Post-state reconciliation and economic boundary

The read-only post snapshot was byte-for-byte equivalent at the reported
aggregate level: x402 quotes 72, audit events 170, payment attempts 18, job
artifacts 1, admission windows 2, queue dispatches 0, and fixture-hash artifact
rows 0. The planned R2 key was absent before and no request capable of creating
it was sent.

```text
CHECKPOINT_HTTP_STATE_WRITING_REQUESTS=0
CHECKPOINT_D1_ROWS_CREATED=0
CHECKPOINT_D1_ROWS_UPDATED=0
CHECKPOINT_D1_ROWS_DELETED=0
CHECKPOINT_R2_OBJECTS_CREATED=0
CHECKPOINT_R2_OBJECTS_DELETED=0
CHECKPOINT_QUEUE_WRITES=0
CHECKPOINT_WORKFLOW_CREATIONS=0
ALL_CHECKPOINT_STATE_ACCOUNTED_FOR=YES
UNATTRIBUTED_D1_WRITES=0
UNATTRIBUTED_R2_WRITES=0
REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_TEST_PROVIDER_CALLS=0
REAL_TEST_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

### Fresh settlement ownership and evidence classification

The canonical ownership scan and MCP adapter guard were re-run together: 13
tests passed across two test files.

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
PCC_REST_RUNTIME_EVIDENCE=BLOCKED
PCC_MCP_RUNTIME_EVIDENCE=BLOCKED
PCC_A2A_RUNTIME_EVIDENCE=PASS (inherited exact-candidate runtime proof; no additional write required)
DOCUMENT_ARTIFACT_RUNTIME_EVIDENCE=BLOCKED
LIVE_FULFILLED_PCC_RESULT_VERIFIED=NO
```

No candidate runtime defect was found. The pre-feature-cutover gaps are the
exact-candidate REST unpaid-402 and MCP paid-tool-to-402 proofs, which require
separate authority for one authenticated, read-only CDP seller lookup, plus the
artifact admission/storage proof, whose current route necessarily deletes two
unrelated expired admission rows. A fulfilled paid PCC remains a different
class of evidence. It is structurally impossible while the old paid runtime is
the producer, and the verified compatibility matrix allows the new public
consumer to run with that old producer. It therefore need not precede public
cutover, but must be performed as bounded live-paid acceptance only after a
compatible NEW-public/NEW-paid pair exists and is separately authorized.

```text
FULFILLED_PCC_PROOF_PRE_CUTOVER_POSSIBLE=NO
FULFILLED_PCC_PROOF_REQUIRED_BEFORE_PUBLIC_CUTOVER=NO
CANDIDATE_RUNTIME_DEFECT_FOUND=NO
REMAINING_QUALIFICATION_GAPS=REST schema-valid unpaid 402 and MCP paid-tool-to-402 exact-candidate runtime proof blocked by authenticated CDP lookup; document artifact runtime proof blocked by unrelated admission-window deletion; fulfilled paid PCC deferred to separately authorized NEW/NEW live-paid acceptance
```

### Feature and future quiescence boundary

Promoting d155c9a1 to 100% would make these candidate-only families normally
production-accessible and remains a separate explicit decision:

```text
FEATURES_REQUIRING_100_PERCENT_CUTOVER_AUTHORIZATION=verify_agent_output.v2,web_context_verified.v2,company_evidence_graph.v2,document_evidence_json.v2,document-artifact-upload
TRAFFIC_CUTOVER_AUTHORIZED=NO
FEATURE_CUTOVER_AUTHORIZED=NO
```

The existing quiescence design remains technically valid but is not a
configuration toggle on an immutable version. It requires uploading a new
immutable public Worker version from source identical to the then-live public
version, with the complete authorized configuration preserved except
`PAID_ROUTES_ENABLED=false`, and deploying that new quiesced version at 100%.
This necessarily introduces another version/config artifact and a production
traffic deployment. Restoring admission can redeploy the already-qualified
non-quiesced version ID; no second restoration upload is needed.

```text
QUIESCENCE_IMPLEMENTATION_MECHANISM=future versions upload of identical public source/config with only PAID_ROUTES_ENABLED=false, then versions deploy that quiesced version at 100%; later redeploy the existing non-quiesced version to restore admission
QUIESCENCE_REQUIRES_NEW_PUBLIC_VERSION=YES
QUIESCENCE_REQUIRES_TRAFFIC_DEPLOYMENT=YES
```

### Checkpoint decision and mutation accounting

```text
SUN1222C_PCC_BOUNDED_QUALIFICATION_STATE_WRITE_AUTHORIZATION=EXTERNAL_PROVIDER_BOUNDARY_BLOCKED
REST_UNPAID_402_RUNTIME_PROOF=BLOCKED
REST_STATE_ATTRIBUTION_PROVEN=NO (no authorized runtime write)
MCP_PAID_TOOL_RESULT=BLOCKED
MCP_TO_REST_PAYMENT_BOUNDARY_PROVEN=NO (runtime blocked; static path proven)
DOCUMENT_ARTIFACT_RUNTIME_PROOF=BLOCKED
DOCUMENT_ARTIFACT_HASH_MATCH=NOT_EXECUTED

ADDITIONAL_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0

PUBLIC_BASELINE_TRAFFIC=100%
CURRENT_ZERO_PERCENT_CANDIDATE_TRAFFIC=0%
PAID_RUNTIME_TRAFFIC=100%
NEXT_REQUIRED_CHECKPOINT=BLOCKER_CHECKPOINT
```

Chronology is preserved: A2 recovered exact-version read-only qualification;
this successor checkpoint reconfirmed exact selection, evaluated the newly
authorized write paths, and stopped before each path's independently proven
boundary violation. It did not rewrite prior gaps as passes and did not issue a
payment, provider, artifact, deployment, traffic, version, variable, secret,
queue, Workflow, settlement, or chain mutation.

## 2026-09-10 — qualification-boundary exception stopped before one-shot probes

The human-approved qualification-boundary exception authorized at most one
authenticated Coinbase CDP seller-identity lookup and expressly required both
the outer MCP client and the executing client library to perform no automatic
retry. It also conditionally authorized the already-understood two-row
admission-window housekeeping case and one deterministic synthetic artifact.
This entry records the pre-execution result without rewriting the earlier safe
stops.

### Integrity, topology, and exact-version health

The checkpoint began on clean `main` at
`7e2dbd0fb7e243ed43b44b4bf61254a9946364fb`; that prior evidence commit exists
and is reachable. Candidate source commit
`2f947bfe0fa1722158323aaf44496ee6ebf046fd` remains immutable. Read-only
Wrangler 4.119.0 inspection reconfirmed public deployment
`f5c536de-53d6-4ea9-acd1-3f8d006b8ca7`: baseline
`db7054c9-76ee-4830-aabe-8a4542261b6a` at 100% and candidate
`d155c9a1-ca3a-49f9-92a3-b35760dc58e6` at 0%. Version
`d3472f58-f578-4a8f-992b-0d0956c9b561` remains retained. Paid runtime
`d62011b9-6219-47e1-8cf9-5006776cfb50` remains at 100%.

Fresh qualification run ID:
`sun1222c-pcc-boundary-3b929d3e7d145e90fa03c5febef5a4e69e46dce721989789`.
A read-only `/health` request carrying the exact candidate version override
returned HTTP 200 (Cloudflare Ray `a38f11ee49d8a38b-ATL`), and authoritative
tail attribution reported
`scriptVersion.id=d155c9a1-ca3a-49f9-92a3-b35760dc58e6`.

```text
PUBLIC_DEPLOYMENT_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
EXACT_VERSION_OVERRIDE_REACHABILITY_RECONFIRMED=YES
```

### Fresh state and housekeeping prechecks

The pre-event D1 snapshot was: 72 `x402_quotes`, 170 `audit_events`, 18
`payment_attempts`, two `document_ingress_admission_windows`, one
`job_artifacts` row, and zero `queue_dispatches`. No candidate-correlated
quote or audit record existed after checkpoint start. The planned artifact
hash had no D1 artifact row, and exact R2 key
`artifacts/fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef`
did not exist.

The only admission rows before the route-derived cleanup cutoff
`1788825600000` were freshly read as:

| Primary key | Scope | Window start | Count | Expired by route logic |
|---|---|---:|---:|---|
| `global:global:1788393600000` | `global` | 1788393600000 | 4 | YES |
| `source:207.68.238.67:1788393600000` | `source` | 1788393600000 | 4 | YES |

Schema and source inspection reconfirmed that this table has no foreign keys
or dependent payment, job, artifact, audit, or settlement lifecycle. The
route's normal housekeeping predicate is exactly
`WHERE window_start_ms < ?`, with the bound value calculated as the current
window start minus two 86,400,000-millisecond days. The two rows were therefore
eligible for the conditionally authorized route-owned cleanup. This did not,
however, authorize bypassing the later CDP-call cap gate.

### CDP API semantics versus installed SDK execution envelope

Coinbase documents seller account retrieval as authenticated `GET
/v2/evm/accounts/{address}`. The installed `@coinbase/cdp-sdk` 1.55.0 source
confirms that `client.evm.getAccount({address})` delegates to that GET; the
method itself cannot transfer assets, sign or broadcast transactions, mutate
the wallet, or trigger settlement. This matches Coinbase's separation of
account retrieval from signing, sending, updating, and other write operations:

- https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-accounts/get-evm-account-by-address
- https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-accounts/evm-accounts

The immutable candidate's installed execution envelope nevertheless violates
the stricter one-call qualification cap before a request can safely be made:

1. `EvmClient.getAccount` calls `Analytics.trackAction` before the account
   GET. With no `DISABLE_CDP_USAGE_TRACKING=true` binding in candidate version
   60, that code starts a separate unauthenticated POST to
   `https://cca-lite.coinbase.com/amp`.
2. `CdpOpenApiClient.configure` installs `axios-retry` without overriding its
   retry count. Installed `axios-retry` 4.5.0 therefore applies its default
   three retries to retryable network/idempotent-request failures. The account
   GET can consequently make up to four authenticated attempts rather than the
   authorized maximum of one.
3. Repository production construction supplies only the CDP API key ID and
   secret to `new CdpClient(...)`; it provides neither a retry-zero option nor
   a usage-tracking disable override. Candidate version 60 contains no ordinary
   or secret binding named `DISABLE_CDP_USAGE_TRACKING`.

The vendor endpoint is read-only, but the checkpoint required a maximum of one
authenticated call and explicitly prohibited automatic retry in the client
library. A successful first attempt might happen to yield one authenticated
GET, but that outcome cannot be guaranteed before spending the one-shot probe,
and the analytics POST is an additional network call in either case. Section
11 therefore predicts values above the authorized caps and requires STOP.

```text
CDP_LOOKUP_OPERATION=READ_ONLY_ACCOUNT_LOOKUP
CDP_LOOKUP_CAN_TRANSFER_ASSETS=NO
CDP_LOOKUP_CAN_SIGN_TRANSACTION=NO
CDP_LOOKUP_CAN_BROADCAST_TRANSACTION=NO
CDP_LOOKUP_CAN_MUTATE_WALLET=NO
CDP_LOOKUP_CAN_TRIGGER_SETTLEMENT=NO
CDP_SDK_AUTOMATIC_RETRIES_MAX=3
CDP_AUTHENTICATED_GET_ATTEMPTS_POSSIBLE_MAX=4
CDP_SDK_USAGE_ANALYTICS_POST_PREDICTED=YES
CHECKPOINT_CAPS_PROVEN_SAFE=NO
```

### Safe stop, state accounting, and disposition

The live tail was stopped. No MCP `tools/call`, direct REST paid-route request,
or document-artifact request was issued. Because the governing text says to
STOP when source predicts a value above any Section 11 cap, the independently
safe artifact exception was not spent after this blocker was found. The two
expired admission rows remain untouched, and the deterministic artifact remains
absent. No quote or audit ID exists for this run.

The canonical settlement-ownership and MCP-adapter semantic tests were rerun
after the safe stop: 13 tests passed across two test files. They reconfirmed
zero public-API settlement callsites, zero MCP-adapter settlement callsites,
one dedicated-Workflow settlement callsite, and one total production
settlement callsite.

```text
SUN1222C_PCC_QUALIFICATION_BOUNDARY_EXCEPTION_AUTHORIZATION=BLOCKED
AUTHORIZED_READ_ONLY_CDP_IDENTITY_LOOKUPS=0
MCP_REQUEST_COUNT=0
DIRECT_REST_RUNTIME_REQUEST_EXECUTED=NO
DOCUMENT_ARTIFACT_REQUESTS=0
CHECKPOINT_X402_QUOTES_CREATED=0
CHECKPOINT_AUDIT_EVENTS_CREATED=0
CHECKPOINT_PAYMENT_ATTEMPTS_CREATED=0
CHECKPOINT_ADMISSION_ROWS_CREATED=0
CHECKPOINT_ADMISSION_ROWS_DELETED=0
CHECKPOINT_JOB_ARTIFACT_ROWS_CREATED=0
CHECKPOINT_R2_OBJECTS_CREATED=0
CHECKPOINT_QUEUE_WRITES=0
CHECKPOINT_WORKFLOW_CREATIONS=0
ALL_CHECKPOINT_STATE_ACCOUNTED_FOR=YES
UNATTRIBUTED_D1_WRITES=0
UNATTRIBUTED_D1_DELETIONS=0
UNATTRIBUTED_R2_WRITES=0
REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
REAL_TEST_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

This is a qualification-envelope blocker, not evidence that the read-only CDP
account endpoint mutates state and not evidence of a candidate runtime failure.
A successor governance decision must either authorize the precisely disclosed
analytics/retry envelope or authorize candidate remediation that disables SDK
usage tracking and guarantees one attempt. No cutover, deployment, upload,
traffic, variable, secret, paid-runtime, payment, provider-execution, Workflow,
settlement, chain, or mTLS action is authorized by this report.

### Seller-identity determinism remediation continuation

The source-only continuation is recorded in
[`SUN-1222C-cdp-seller-identity-determinism-remediation.md`](./SUN-1222C-cdp-seller-identity-determinism-remediation.md).
It preserves this safe failure chronology, removes the SDK account lookup and
its telemetry/retry fan-out from normal pre-402 handling, retains authenticated
membership comparison only as a separately authorized qualification primitive,
and requires a new immutable candidate under a future checkpoint. It does not
rewrite or retroactively pass the immutable `d155c9a1` qualification attempt.

### Remediated candidate continuation

The authorized successor upload, 0%-membership replacement, and exact-version
qualification are recorded in
[`SUN-1222C-pcc-remediated-candidate-upload-and-a2-replacement.md`](./SUN-1222C-pcc-remediated-candidate-upload-and-a2-replacement.md).
That report preserves every failure above, identifies immutable version
`f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` as the remediated successor, and
contains the bounded MCP/REST and document-artifact state accounting.
