# SUN-1222C PCC remediated candidate upload and A2 replacement

Date: 2026-09-10 (America/Chicago)

Decision: `PASS`

Source commit: `8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb`

## Scope and outcome

This checkpoint uploaded exactly one immutable public-Worker version carrying
the accepted seller-identity determinism remediation, replaced only the existing
0%-traffic deployment member, and qualified the new candidate through
Cloudflare's exact version-override mechanism. The 100% baseline did not change.
The new candidate received no normal traffic. The paid runtime did not change.

The bounded state-writing probes also passed. One payment-absent MCP paid-tool
request traversed the shared REST 402 boundary and created exactly one quote and
one matching audit event. One synthetic 68-byte document artifact request
performed only the previously authorized housekeeping and storage writes. No
payment, payment authorization, facilitator call, provider execution, Workflow,
settlement, or chain transaction occurred.

## Preserved chronology

1. Immutable version `d155c9a1-ca3a-49f9-92a3-b35760dc58e6` uploaded
   successfully.
2. Its first production-host version-override qualification failed safely while
   the version was not a member of the current deployment.
3. Public Preview URL exposure was rejected because the candidate carried
   production bindings and no applicable Cloudflare Access protection.
4. A2 placed `d155c9a1` in the deployment at 0% and recovered exact-version
   read-only qualification.
5. Bounded state-write qualification stopped safely when the old source was
   proven capable of a CDP SDK analytics request and automatic account-lookup
   retries before 402.
6. Seller-identity determinism remediation passed at
   `8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb`.
7. This checkpoint uploaded one remediated immutable version.
8. It replaced only the 0% deployment member.
9. Exact-candidate zero-write, MCP-to-REST unpaid, and document-artifact
   qualification passed with complete state attribution.

The earlier failures remain valid evidence. Nothing in this report rewrites them
as successes by hindsight.

## Repository integrity and release gates

The checkpoint started from the exact authorized, clean source:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb
WORKING_TREE_PRE=CLEAN
REMEDIATION_COMMIT_EXISTS=YES
REMEDIATION_COMMIT_REACHABLE=YES
PINNED_WRANGLER_VERSION=4.119.0
```

The remediation-specific tests passed 20/20 before upload. Typecheck, build,
lint, production preflight, the public Worker Wrangler dry run, and the
repository secret scan all passed. The scan covered 776 commits and the working
tree and found no leak. The previously documented 249-file historical format
debt was not reformatted and the aggregate `pnpm check` was not used as an
additional gate.

After runtime qualification, a fresh focused run passed 41/41 tests across:

- `seller-identity-determinism.test.ts`;
- `settle-sole-ownership.test.ts`;
- `x402-mcp-adapter.test.ts`;
- `mcp-four-service-acceptance.test.ts`.

```text
SELLER_DETERMINISM_TESTS=PASS
POST_FIX_PRE_402_AUTHENTICATED_CDP_NETWORK_CALLS_MAX=0
POST_FIX_PRE_402_ANALYTICS_REQUESTS=0
POST_FIX_PRE_402_AUTOMATIC_RETRIES=0
REST_USES_DETERMINISTIC_SELLER_PATH=YES
MCP_USES_SAME_DETERMINISTIC_SELLER_PATH=YES
FOUR_SERVICE_SELLER_PATH_EQUIVALENCE=PASS
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
PRODUCTION_PREFLIGHT=PASS
PUBLIC_API_WRANGLER_DRY_RUN=PASS
NEW_SECRET_FINDINGS=0
```

## Exact candidate configuration equivalence

Pinned Wrangler 4.119.0 documentation and help were checked before mutation.
`versions upload` creates a version without deploying it. With `--keep-vars`
absent (default false), local `[vars]` and explicit CLI `--var` arguments form
the uploaded ordinary-variable set; existing secret bindings are preserved.

- Cloudflare Wrangler commands:
  <https://developers.cloudflare.com/workers/wrangler/commands/workers/>
- Cloudflare Versions and Deployments:
  <https://developers.cloudflare.com/workers/versions-and-deployments/>

The literal upload command supplied eleven explicit variables. Together with the
six local `[vars]` entries, with overlaps resolved by CLI precedence, the result
was the following exact 16-variable map read from `d155c9a1`:

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

The exact 13 preserved secret binding names were:

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

Non-secret binding parity was exact: Workers AI `AI`; Browser v2 `BROWSER`; D1
`DB` (`efe23c42-cbcc-47c2-9b28-922a541bdcdd`); KV `CATALOG`
(`59dc955c3ebf4208a882f82d8d8fab30`); Queues `EVENTS` and `JOBS`; R2
`ARTIFACTS`; and Workflow `PAID_CONTINUATION_WORKFLOW` targeting
`siteborne-paid-continuation-runtime` / `siteborne-paid-continuation` /
`PaidContinuationWorkflow`.

```text
PROPOSED_CANDIDATE_VAR_DELTA_FROM_D155=NONE
PROPOSED_CANDIDATE_SECRET_NAME_DELTA_FROM_D155=NONE
PROPOSED_CANDIDATE_BINDING_DELTA_FROM_D155=NONE
SELLER_WALLET_ADDRESS_MATCHES_D155=YES
PAID_ROUTES_ENABLED_MATCHES_D155=YES
PRODUCTION_ENABLED_MATCHES_D155=YES
PAYMENT_ENVIRONMENT_MATCHES_D155=YES
ALL_ROUTE_ACTIVATION_VALUES_MATCH_D155=YES
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
WOULD_DROP_AUTHORIZED_D155_VAR=NO
WOULD_ADD_UNAUTHORIZED_VAR=NO
WOULD_CHANGE_ACTIVATION_VALUE=NO
WOULD_DROP_REQUIRED_BINDING=NO
WOULD_CHANGE_SECRET=NO
```

The exact command shape was first executed with `--dry-run`. Its bundle,
ordinary variables, secret names, and non-secret bindings matched the modeled
result. The source was still the exact authorized HEAD.

```text
EXACT_UPLOAD_DRY_RUN=PASS
DRY_RUN_SOURCE_MATCHES_HEAD=YES
DRY_RUN_VARS_MATCH_D155=YES
DRY_RUN_BINDINGS_MATCH_D155=YES
DRY_RUN_SECRETS_EXPECTED_TO_BE_PRESERVED=YES
DRY_RUN_MTLC_ACTIVATION_TRUE=NO
```

## One immutable upload

The literal non-dry command executed exactly once was:

```sh
npx wrangler versions upload \
  --name siteborne-utility-edge \
  --tag sun1222c-pcc-seller-determinism-remediated-candidate \
  --message 'source_commit=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb supersedes=d155c9a1-ca3a-49f9-92a3-b35760dc58e6 reason=pre-402-seller-identity-determinism' \
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

Wrangler returned:

```text
NEW_REMEDIATED_CANDIDATE_VERSION=f7bf204d-5041-45c0-bb8c-4c3f776d7c9e
NEW_REMEDIATED_CANDIDATE_VERSION_NUMBER=61
NEW_REMEDIATED_CANDIDATE_SOURCE_COMMIT=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb
NEW_REMEDIATED_CANDIDATE_TAG=sun1222c-pcc-seller-determinism-remediated-candidate
NEW_REMEDIATED_CANDIDATE_ASSIGNED_TO_DEPLOYMENT_PRE_A2=NO
NEW_REMEDIATED_CANDIDATE_NORMAL_TRAFFIC_PRE_A2=0%/UNASSIGNED
CHECKPOINT_VERSION_UPLOADS=1
NEW_CANDIDATE_CONFIG_PARITY_WITH_D155=YES
NEW_CANDIDATE_BINDING_PARITY_WITH_D155=YES
NEW_CANDIDATE_SOURCE_MATCHES_REMEDIATION_COMMIT=YES
```

No retry was issued.

## A2 membership replacement

The complete replacement command, proven first with Wrangler's deployment dry
run, was:

```sh
npx wrangler versions deploy \
  db7054c9-76ee-4830-aabe-8a4542261b6a@100% \
  f7bf204d-5041-45c0-bb8c-4c3f776d7c9e@0% \
  --name siteborne-utility-edge \
  --message 'SUN-1222C PCC remediated A2: retain db7054c9 at 100%; replace only d155c9a1 0% member with f7bf204d 0%; no cutover' \
  --yes
```

The precomputed, unused emergency restoration command was:

```sh
npx wrangler versions deploy \
  db7054c9-76ee-4830-aabe-8a4542261b6a@100% \
  d155c9a1-ca3a-49f9-92a3-b35760dc58e6@0% \
  --name siteborne-utility-edge \
  --message 'SUN-1222C emergency restore: db7054c9 100%; restore d155c9a1 0% membership' \
  --yes
```

Exactly one replacement executed and created deployment
`bea168df-631e-4974-abd1-25b2bd3fcaeb`. Immediate and final readback both
reported `db7054c9` at 100% and `f7bf204d` at 0%. The emergency command was not
needed.

```text
REPLACEMENT_UPLOADS_SOURCE=NO
REPLACEMENT_CHANGES_BASELINE_VERSION=NO
REPLACEMENT_CHANGES_BASELINE_TRAFFIC=NO
REPLACEMENT_GIVES_NEW_CANDIDATE_NORMAL_TRAFFIC=NO
REPLACEMENT_CHANGES_PAID_RUNTIME=NO
REPLACEMENT_CHANGES_ROUTES_OR_DOMAINS=NO
ORIGINAL_TOPOLOGY_RESTORABLE=YES
CHECKPOINT_DEPLOYMENT_COMPOSITION_MUTATIONS=1
CHECKPOINT_TRAFFIC_PERCENTAGE_MUTATIONS=0
```

## Exact-version reachability and zero-write runtime qualification

The documented structured header was applied on every candidate request:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="f7bf204d-5041-45c0-bb8c-4c3f776d7c9e"
```

Cloudflare's version-override contract is documented at
<https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>.

An authoritative JSON tail correlated these rays and script versions:

| Request                        | HTTP | Ray                    | Tail `scriptVersion.id`                |
| ------------------------------ | ---: | ---------------------- | -------------------------------------- |
| candidate `/health`            |  200 | `a390fa3fd80013c4-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |
| no-override baseline `/health` |  200 | `a390fa82ee55ae19-ATL` | `db7054c9-76ee-4830-aabe-8a4542261b6a` |
| candidate `/ready`             |  200 | `a390fc965f57a8a4-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |
| Agent Card                     |  200 | `a3910111ac5433f7-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |
| JWKS                           |  200 | `a391011228235d32-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |
| A2A message                    |  200 | `a39101126eb933f7-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |
| MCP initialize                 |  200 | `a392940dbd3c136e-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |
| MCP tools/list                 |  200 | `a39294118c02c202-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |
| malformed MCP request          |  400 | `a39294147de5136e-ATL` | `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e` |

The readiness endpoint returned its expected truthful foundation state:
`production_services_enabled=true`, with the known external publication/DNS
dependencies still named as blockers. `CANDIDATE_READY=PASS` here means the
candidate readiness contract executed correctly; it does not claim those
external dependencies are complete.

The Agent Card had one ES256 signature and A2A protocol version 1.0. Its
canonical interface remained `https://utility.siteborne.net/a2a`. The JWKS
returned one public key and no private scalar. Verification against the trusted
canonical JWKS URL passed. No `mutualTLS` declaration appeared.

The official A2A client remained on `utility.siteborne.net`, with the override
added to its request, and returned an input-required/payment-required task with
zero artifacts and no useful work. MCP initialization negotiated `2025-11-25`;
tools/list returned the six frozen tools; the malformed request was rejected
with JSON-RPC code `-32600`.

```text
EXACT_VERSION_OVERRIDE_REACHABILITY=PASS
CANDIDATE_HEALTH_HTTP_STATUS=200
CANDIDATE_HEALTH_TAIL_ATTRIBUTION=PASS
BASELINE_CONTROL_HTTP_STATUS=200
BASELINE_CONTROL_TAIL_ATTRIBUTION=PASS
CANDIDATE_READY=PASS
CANDIDATE_AGENT_CARD_GENERATION=PASS
CANDIDATE_JWS_CRYPTOGRAPHIC_VERIFICATION=PASS
CANDIDATE_JWKS_RUNTIME=PASS
CANDIDATE_MTLS_ADVERTISED=NO
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
CANDIDATE_A2A_ZERO_WRITE_RUNTIME_PROOF=PASS
CANDIDATE_MCP_INITIALIZE=PASS
CANDIDATE_MCP_DISCOVERY=PASS
ALL_ZERO_WRITE_REQUESTS_ATTRIBUTED_TO_NEW_CANDIDATE=YES
NORMAL_TRAFFIC_TO_NEW_CANDIDATE=0%
```

Two local harness construction attempts failed before calling `fetch` (first a
package-resolution error, then a workspace ESM export mismatch). They consumed
no live request or mutation budget. The corrected harness then produced the
results above.

## One-shot MCP to shared REST 402 proof

Fresh source trace established the exact chain:

```text
MCP tools/call
-> createMcpX402ServiceBoundary.execute
-> /v2/company/evidence-graph production route handler
-> deterministic local resolveGovernedSellerAddress
-> shared createX402ServiceRoute unpaid branch
-> one x402_quotes insert
-> one payment_required_created audit_events insert
-> REST 402
-> MCP PaymentRequired result
```

The facilitator object is constructed only after the local seller syntax and
checksum check; neither construction nor the unpaid path calls it. With no
payment carrier, control returns before payment-attempt acquisition,
verification, job/Workflow construction, useful execution, or settlement.

The D1 pre-snapshot at `2026-09-11T00:34:31Z` contained 72 quotes, 170 audit
events, 18 payment attempts, and zero queue dispatches. Exactly one legacy
stateless `tools/call` request with the frozen company-evidence example and no
payment metadata was sent. It returned HTTP 200 at the MCP transport, with
`isError=true` and a machine-readable structured payment requirement. Tail Ray
`a39296f21b146378-ATL` selected `f7bf204d`.

The immediate post-snapshot contained exactly:

```text
QUOTE_ID=qte_27bf4878327c56dd6048fbdc
REQUIREMENT_ID=req_c73ba03e503c282c7082c89b
QUOTE_SERVICE=company_evidence_graph.v2
QUOTE_SCHEME=exact
QUOTE_RESOURCE=https://utility.siteborne.net/v2/company/evidence-graph
QUOTE_CREATED_AT=2026-09-11T00:34:57.377Z
AUDIT_ID=7750d04d-1b29-4cf6-9196-da945fcc1cd1
AUDIT_EVENT_TYPE=payment_required_created
AUDIT_CREATED_AT=2026-09-11T00:34:57.424Z
```

Counts changed from 72/170/18/0 to 73/171/18/0. The quote ID in the audit event
and the resource ID exactly matched the sole new quote. No second MCP or direct
REST paid-route request was sent.

```text
ONE_MCP_REQUEST_COVERS_SHARED_REST_PAYMENT_BOUNDARY=YES
DIRECT_REST_RUNTIME_REQUEST_REQUIRED=NO
MCP_REQUEST_COUNT=1
MCP_SCHEMA_VALID_UNPAID_RUNTIME_PROOF=PASS
MCP_TO_REST_PAYMENT_BOUNDARY_PROVEN=YES
SHARED_REST_402_BOUNDARY_RUNTIME_PROVEN=YES
CDP_EVM_GET_ACCOUNT_CALLS=0
CDP_ANALYTICS_POSTS=0
PRE_402_AUTOMATIC_RETRIES=0
X402_QUOTES_CREATED=1
AUDIT_EVENTS_CREATED=1
PAYMENT_ATTEMPTS_CREATED=0
QUEUE_WRITES=0
WORKFLOW_CREATIONS=0
USEFUL_PROVIDER_EXECUTIONS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
MCP_REST_STATE_ATTRIBUTION_PROVEN=YES
UNATTRIBUTED_D1_WRITES=0
UNATTRIBUTED_D1_UPDATES=0
UNATTRIBUTED_D1_DELETIONS=0
```

The four production composition builders retain the same local governed-seller
resolver and `payTo: env.SELLER_WALLET_ADDRESS`; all four use the same shared
x402 unpaid branch. The fresh four-service acceptance test passed.

```text
FOUR_SERVICE_SELLER_PATH_EQUIVALENCE=PASS
FOUR_SERVICE_PAYMENT_REQUIRED_BOUNDARY_EQUIVALENCE=PASS
PCC_REST_RUNTIME_UNPAID_PROOF=PASS
PCC_MCP_RUNTIME_UNPAID_PROOF=PASS
PCC_A2A_RUNTIME_UNPAID_PROOF=PASS
LIVE_FULFILLED_PCC_RESULT_VERIFIED=NO
```

REST proof is the real REST handler executed inside the accepted MCP adapter; it
is not a second direct public REST request. This is unpaid boundary proof, not
paid fulfillment.

## Bounded document-artifact proof

Fresh source and live-state inspection reconfirmed the normal route order:
per-source admission, global admission, bounded body read, media-type/magic
validation, content hash, D1 duplicate lookup, R2 head/put, and one artifact
metadata insert. The route imports no payment, facilitator, provider executor,
Queue, Workflow, settlement, or chain path.

For the current window beginning `2026-09-11T00:00:00Z`, the route's exact
cleanup cutoff was `2026-09-09T00:00:00Z`. The entire pre-request admission
table still consisted of the same two previously authorized housekeeping-only
rows:

| Primary key                          | Scope  |  Window start | Count |
| ------------------------------------ | ------ | ------------: | ----: |
| `global:global:1788393600000`        | global | 1788393600000 |     4 |
| `source:207.68.238.67:1788393600000` | source | 1788393600000 |     4 |

Both were older than the route cutoff. No third, unrelated, or newly expired row
existed. The table has no foreign keys and no payment, job, artifact, audit, or
settlement lifecycle references. The fixture hash had no D1 artifact row and the
exact R2 key returned `The specified key does not exist.`

```text
EXPIRED_ROW_IDENTITIES_UNCHANGED=YES
EXPIRED_ADMISSION_ROWS_ROUTE_WOULD_DELETE=2
UNRELATED_OR_NEWLY_EXPIRED_ROWS_ROUTE_WOULD_DELETE=0
DEPENDENT_PRODUCTION_LIFECYCLE_ROWS=0
PLANNED_ARTIFACT_EXISTS_PRE=NO
```

The request body was the exact authorized synthetic value:

```text
%PDF-sun1222c-pcc-q-9e626a8f73daa2b2cdce0a5c2eabc89a27ecedc82a5671ad
```

Local assertions confirmed 68 bytes and
`sha256:fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef` before
`fetch` was called. Exactly one request was sent; it returned HTTP 201, upload
ID `20ee043a-2e23-4ace-9d11-540cf5055507`, and the exact expected hash and size.
Tail Ray `a3929a86ec82dd19-ATL` selected `f7bf204d`.

Immediate readback showed:

- exactly two current-window admission rows, source and global, each count 1;
- both exact expired rows removed;
- exactly one new `job_artifacts` row with ID
  `20ee043a-2e23-4ace-9d11-540cf5055507`, `buyer_authorized`, `ephemeral`,
  `input`, 68 bytes, and the expected hash;
- exactly one content-addressed R2 object at
  `artifacts/fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef`;
- R2 readback SHA-256 exactly
  `fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef`;
- no change to quote, audit, payment-attempt, or queue state after the MCP
  post-snapshot.

The artifact and metadata remain under the repository's existing retention and
reclamation lifecycle; no manual cleanup bypass was attempted.

```text
DOCUMENT_ARTIFACT_REQUESTS=1
DOCUMENT_ARTIFACT_HTTP_STATUS=201
DOCUMENT_ARTIFACT_RUNTIME_PROOF=PASS
UPLOAD_ID=20ee043a-2e23-4ace-9d11-540cf5055507
ARTIFACT_ID=20ee043a-2e23-4ace-9d11-540cf5055507
R2_KEY=artifacts/fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef
HASH=sha256:fdacd0a37cc16d810fd42c59455af644cfa860ebb0c287277cc6a1663cc488ef
SIZE=68
R2_KEY_MATCHES_EXPECTED=YES
HASH_MATCHES_FIXTURE=YES
SIZE_MATCHES_FIXTURE=YES
DOCUMENT_ARTIFACT_REQUEST_ATTRIBUTED_TO_NEW_CANDIDATE=YES
PREEXISTING_EXPIRED_ADMISSION_ROWS_DELETED=2
NEW_CURRENT_ADMISSION_ROWS=2
NEW_JOB_ARTIFACT_ROWS=1
R2_OBJECTS_CREATED=1
ALL_ARTIFACT_STATE_ACCOUNTED_FOR=YES
UNATTRIBUTED_D1_WRITES=0
UNATTRIBUTED_D1_UPDATES=0
UNATTRIBUTED_D1_DELETIONS=0
UNATTRIBUTED_R2_WRITES=0
```

## Final topology and safety accounting

Final Wrangler readback reported deployment
`bea168df-631e-4974-abd1-25b2bd3fcaeb`: baseline `db7054c9` at 100% and
candidate `f7bf204d` at 0%. Versions list still contains both `d155c9a1` and
`d3472f58`. Paid runtime `d62011b9` remains at 100%. A read-only Worker
subdomain API call returned `enabled=true, previews_enabled=false`.

```text
PUBLIC_BASELINE_VERSION_FINAL=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC_FINAL=100%
NEW_REMEDIATED_CANDIDATE_CURRENT_MEMBER=YES
NEW_REMEDIATED_CANDIDATE_TRAFFIC_FINAL=0%
D155_CURRENT_DEPLOYMENT_MEMBER=NO
D155_IMMUTABLE_VERSION_RETAINED=YES
D3472F58_IMMUTABLE_VERSION_RETAINED=YES
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC_FINAL=100%
LIVE_PREVIEW_URLS_ENABLED_FINAL=NO
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
```

The fresh canonical tests reconfirmed:

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

Complete mutation and economic accounting:

```text
CHECKPOINT_VERSION_UPLOADS=1
CHECKPOINT_DEPLOYMENT_COMPOSITION_MUTATIONS=1
CHECKPOINT_TRAFFIC_PERCENTAGE_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
CUSTOM_DOMAIN_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
MTLS_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0
REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
WORKFLOW_CREATIONS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

## Decision

```text
SUN1222C_PCC_REMEDIATED_CANDIDATE_UPLOAD_AND_A2_REPLACEMENT=PASS
CANDIDATE_QUALIFICATION_RECOVERED=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R6-FEATURE-CUTOVER-AUTHORIZATION
```

This result authorizes no promotion, traffic change, paid-runtime deployment,
payment, provider execution, Workflow creation, settlement, chain transaction,
or mTLS action.
