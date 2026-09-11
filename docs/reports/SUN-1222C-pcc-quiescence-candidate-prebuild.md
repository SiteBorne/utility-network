# SUN-1222C PCC Quiescence Candidate Prebuild

**Checkpoint:** `SUN-1222C-PCC-QUIESCENCE-CANDIDATE-PREBUILD`

**Evidence date:** 2026-09-11 (America/Chicago)

**Decision:** `PASS`

**Runtime source authority:** `8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb`

**Prior governance evidence:** `af4f3c92db89ab072dfdaeace1b62f3d945e53fc`

## Outcome

Exactly one immutable quiescence version was uploaded for
`siteborne-utility-edge`:

```text
NEW_QUIESCENCE_VERSION_ID=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
NEW_QUIESCENCE_VERSION_NUMBER=63
NEW_QUIESCENCE_TAG=sun1222c-pcc-feature-scoped-quiescence-candidate
NEW_QUIESCENCE_CREATED_AT=2026-09-11T11:22:21.425566Z
UPLOAD_EXIT_CODE=0
```

The version is byte-for-byte the same Worker script as qualified feature-scoped
candidate `b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca`: both immutable version
readbacks report script etag
`edac15bd421dec8d300c7d27c1d2daeb22fc062183bb5b2a1d3dd3da8b2ca5a9`. The
compatibility date, compatibility flags, secrets, and non-secret bindings also
match exactly. The only configuration difference is:

```text
PAID_ROUTES_ENABLED=true -> false
```

The upload was not deployed. It is not a member of the current deployment and
receives no normal traffic. No runtime qualification is claimed in this
checkpoint because versioned Preview URLs remain disabled and the deployment's
two member slots remain occupied by the baseline and qualified normal candidate.

## Integrity and source-drift gate

The literal repository pre-state was:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=af4f3c92db89ab072dfdaeace1b62f3d945e53fc
WORKING_TREE=CLEAN
PRIOR_EVIDENCE_COMMIT_EXISTS=YES
PRIOR_EVIDENCE_COMMIT_REACHABLE=YES
RUNTIME_SOURCE_AUTHORITY_EXISTS=YES
```

Every path changed between runtime authority `8cc7222` and prebuild HEAD was
under `docs/`. No source, manifest, lockfile, build configuration, Wrangler
configuration, or bundled runtime schema/contract changed.

```text
PRODUCTION_SOURCE_DIFF_FROM_8CC7222=EMPTY
RUNTIME_DEPENDENCY_DIFF_FROM_8CC7222=EMPTY
PUBLIC_WORKER_CONFIG_SOURCE_DIFF_FROM_8CC7222=EMPTY
```

## Pre- and post-upload topology

Fresh Wrangler 4.119.0 readback before the upload and again after immutable
readback showed the same active topology:

```text
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
FEATURE_SCOPED_CANDIDATE_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
FEATURE_SCOPED_CANDIDATE_TRAFFIC=0%
NEW_QUIESCENCE_VERSION_CURRENT_DEPLOYMENT_MEMBER=NO
NEW_QUIESCENCE_VERSION_NORMAL_TRAFFIC=0%/UNASSIGNED
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
PUBLIC_TOPOLOGY_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
```

The immutable version list retained all governed versions, including `b6b7477f`,
`f7bf204d`, `d155c9a1`, and `d3472f58`; none was deleted.

## Immutable configuration

### Complete ordinary-variable map

The version has exactly 16 ordinary variables:

```text
AGENT_CARD_SIGNING_KEY_ID=siteborne-agent-card-2026-08
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=false
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=false
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=false
ENVIRONMENT=production
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
LOG_LEVEL=info
NVM_ENVIRONMENT=sandbox
PAID_ROUTES_ENABLED=false
PAYMENT_ENVIRONMENT=production
PCC_VERSION=1.0.0
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
PRODUCTION_ENABLED=true
SELLER_WALLET_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
```

Direct sorted readback diff against b6 showed exactly one changed value, no key
addition, and no key removal:

```text
QUIESCENCE_VAR_COUNT=16
QUIESCENCE_VAR_DELTA_FROM_B6=ONLY_PAID_ROUTES_ENABLED_TRUE_TO_FALSE
QUIESCENCE_SELLER_ADDRESS_PARITY_WITH_B6=YES
QUIESCENCE_PRICE_CONFIG_PARITY_WITH_B6=YES
QUIESCENCE_PCC_VERSION_PARITY_WITH_B6=YES
QUIESCENCE_FEATURE_SCOPE_PARITY_WITH_B6=YES
BLOCKED_FEATURE_SCOPE_PRESERVED=YES
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
```

### Secret names

Wrangler's immutable readback reported the same 13 secret names on b6 and the
quiescence version. No secret value was read or printed:

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

### Non-secret bindings and compatibility

Direct readback diff showed no difference in these bindings:

| Type     | Binding                      | Resource                                                                                            |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Workflow | `PAID_CONTINUATION_WORKFLOW` | `siteborne-paid-continuation` / `PaidContinuationWorkflow` on `siteborne-paid-continuation-runtime` |
| KV       | `CATALOG`                    | `59dc955c3ebf4208a882f82d8d8fab30`                                                                  |
| Queue    | `JOBS`                       | `siteborne-jobs`                                                                                    |
| Queue    | `EVENTS`                     | `siteborne-events`                                                                                  |
| D1       | `DB`                         | `efe23c42-cbcc-47c2-9b28-922a541bdcdd` / `siteborne-utility`                                        |
| R2       | `ARTIFACTS`                  | `siteborne-artifacts`                                                                               |
| Browser  | `BROWSER`                    | Browser binding version 2                                                                           |
| AI       | `AI`                         | Workers AI                                                                                          |

```text
COMPATIBILITY_DATE=2026-08-05
COMPATIBILITY_FLAGS=nodejs_compat
USAGE_MODEL=standard
QUIESCENCE_BINDING_PARITY_WITH_B6=YES
QUIESCENCE_SECRET_NAME_PARITY_WITH_B6=YES
QUIESCENCE_COMPATIBILITY_DATE_PARITY_WITH_B6=YES
QUIESCENCE_COMPATIBILITY_FLAGS_PARITY_WITH_B6=YES
```

## Quiescence semantics

The exact runtime checks `PAID_ROUTES_ENABLED === "true"` at the top of both
authorized paid ingress routes. With the quiescence value `false`, each route
returns 404 before it builds the production composition. Therefore it cannot
reach seller resolution, quote or audit persistence, payment verification,
provider execution, Workflow creation, or settlement.

| Route                     | Fail-closed status | D1 write possible | Provider call possible | Payment verify possible | Workflow creation possible | Settlement possible |
| ------------------------- | ------------------ | ----------------- | ---------------------- | ----------------------- | -------------------------- | ------------------- |
| `verify_agent_output.v2`  | 404                | No                | No                     | No                      | No                         | No                  |
| `web_context_verified.v2` | 404                | No                | No                     | No                      | No                         | No                  |

The health, readiness, Agent Card, JWKS, A2A, MCP, and catalog routes are not
removed by the master paid-admission gate. Their discovery projections use the
same effective service gates, so verify and web remain listed but are reported
as production-disabled. Company, document, and artifact stay disabled by their
unchanged route-specific flags.

```text
QUIESCED_VERSION_PRESERVES_HEALTH=YES
QUIESCED_VERSION_PRESERVES_READINESS=YES_ENDPOINT_AVAILABLE_AND_REPORTS_NO_PRODUCTION_SERVICES_ENABLED
QUIESCED_VERSION_PRESERVES_AGENT_CARD=YES
QUIESCED_VERSION_PRESERVES_JWKS=YES
QUIESCED_VERSION_PRESERVES_A2A_DISCOVERY=YES
QUIESCED_VERSION_PRESERVES_MCP_DISCOVERY=YES
QUIESCED_VERSION_PRESERVES_CATALOG=YES
QUIESCED_VERSION_BLOCKS_NEW_PAID_EXECUTION=YES
NEW_PAID_ADMISSION_CLOSED=YES
CATALOG_QUIESCENCE_BEHAVIOR=AVAILABLE;_ALL_GATED_SERVICES_PRODUCTION_DISABLED
MCP_QUIESCENCE_BEHAVIOR=INITIALIZE_AND_DISCOVERY_AVAILABLE;_SERVICES_PRODUCTION_DISABLED;_PAID_EXECUTION_INGRESS_404
A2A_QUIESCENCE_BEHAVIOR=AGENT_CARD_AND_PROTOCOL_AVAILABLE;_SERVICE_PRODUCTION_ENABLED_FALSE;_PAID_EXECUTION_REJECTED
AGENT_CARD_QUIESCENCE_BEHAVIOR=SIGNED_CARD_AVAILABLE;_SERVICE_PRODUCTION_ENABLED_FALSE;_MTLS_NOT_ADVERTISED
QUIESCENCE_DISCOVERY_TRUTHFUL=YES
BLOCKED_FEATURE_SCOPE_PRESERVED=YES
```

Already-running paid Workflow instances execute in the separate
`siteborne-paid-continuation-runtime` Worker. They do not re-enter the public
Worker's paid route or consult its version-local `PAID_ROUTES_ENABLED` value to
continue. The current paid runtime and its traffic were not changed.

```text
EXISTING_WORKFLOWS_DEPEND_ON_PUBLIC_PAID_ROUTES_ENABLED=NO
QUIESCED_VERSION_ALLOWS_EXISTING_WORKFLOWS_TO_FINISH=YES
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

## Verification gates

The focused suite covered the two paid routes, disabled artifact route,
catalog/service/ready/Agent Card/MCP discovery coherence, A2A, MCP transport,
seller determinism, and settlement ownership:

```text
QUIESCENCE_TARGETED_TESTS=PASS (13 files; 219 tests)
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
PRODUCTION_PREFLIGHT=PASS
PROTOCOL_X402=PASS
PROTOCOL_MCP=PASS
PROTOCOL_A2A=PASS
SELLER_DETERMINISM=PASS
SETTLEMENT_OWNERSHIP=PASS
WRANGLER_VERSION=4.119.0
```

No production source change was needed to pass the quiescence tests.

## Exact upload proof

The exact command was dry-run first and then executed once with `--dry-run`
removed:

```bash
npx wrangler versions upload \
  --name siteborne-utility-edge \
  --tag sun1222c-pcc-feature-scoped-quiescence-candidate \
  --message 'runtime_source_authority=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb normal_candidate=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca only_delta=PAID_ROUTES_ENABLED:true→false' \
  --var PAID_ROUTES_ENABLED:false \
  --var PRODUCTION_ENABLED:true \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
  --var PAYMENT_ENVIRONMENT:production \
  --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true \
  --var COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:false \
  --var DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:false \
  --var DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:false \
  --var SELLER_WALLET_ADDRESS:0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
```

The dry run bundled 4003.18 KiB (653.08 KiB gzip), listed all eight non-secret
resource bindings and all 16 ordinary variables, then exited without mutation.
The upload used the identical command shape and completed with exit code 0.

```text
QUIESCENCE_UPLOAD_DRY_RUN=PASS
DRY_RUN_SOURCE_MATCHES_QUALIFIED_RUNTIME=YES
DRY_RUN_VAR_DELTA_EXACTLY_ONE=YES
DRY_RUN_BINDING_PARITY_WITH_B6=YES
DRY_RUN_SECRET_SET_EXPECTED_PRESERVED=YES
DRY_RUN_BLOCKED_FEATURE_FLAGS_FALSE=YES
DRY_RUN_VERIFY_FLAG_TRUE=YES
DRY_RUN_WEB_FLAG_TRUE=YES
DRY_RUN_MTLS_TRUE=NO
QUIESCENCE_VERSION_UPLOADS=1
```

## Deferred exact-runtime qualification

The prebuild strategy was `UPLOAD_UNASSIGNED_ONLY`. Preview URLs remained
disabled and no deployment member was replaced merely to exercise the new
version. Accordingly:

```text
QUIESCENCE_LOCAL_AND_CONFIG_QUALIFICATION=PASS
QUIESCENCE_EXACT_RUNTIME_QUALIFICATION=DEFERRED_UNTIL_CURRENT_DEPLOYMENT_MEMBERSHIP
```

The exact public restoration shape remains:

```bash
npx wrangler versions deploy \
  'db7054c9-76ee-4830-aabe-8a4542261b6a@100%' \
  'b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@0%' \
  --name siteborne-utility-edge \
  --message 'SUN-1222C atomic public restore: db7054c9 100%; b6b7477f 0%' \
  --yes
```

Wrangler 4.119.0 dry-run selected exactly those two versions and percentages,
then exited without deploying:

```text
ATOMIC_PUBLIC_RESTORE_DRY_RUN=PASS
```

After a separately authorized atomic cutover and stabilization of b6 at 100%, a
separate checkpoint may deploy this composition:

```bash
npx wrangler versions deploy \
  'b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@100%' \
  'd28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@0%' \
  --name siteborne-utility-edge \
  --message 'SUN-1222C post-atomic quiescence qualification membership: b6b7477f 100%; d28f30c5 0%; no normal quiescence traffic' \
  --yes
```

Wrangler 4.119.0 dry-run resolved that exact 100%/0% composition and exited
without deploying. Exact-version qualification must then prove health,
readiness, Agent Card, JWKS/JWS, mTLS truthfulness, catalog, MCP, A2A, both
closed paid ingress routes, all three still-blocked features, and zero economic
side effects. No runtime PASS is recorded today.

```text
FUTURE_QUIESCENCE_0PCT_MEMBERSHIP_DRY_RUN=PASS
```

Only after that qualification may a separate checkpoint consider:

```bash
npx wrangler versions deploy \
  'd28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@100%' \
  'b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@0%' \
  --name siteborne-utility-edge \
  --message 'SUN-1222C quiesce public paid admission: d28f30c5 100%; retain b6b7477f 0% for immediate restore' \
  --yes
```

That command was designed only and was not run.

## Inflight and drain gate

The fresh read-only D1 query returned:

```text
CURRENT_INFLIGHT_BY_STAGE={verified:16,settled_external:1}
CURRENT_INFLIGHT_TOTAL=17
D1_QUERY_ROWS_WRITTEN=0
```

This does not block this immutable prebuild and does not block a public-only
atomic cutover while the old paid runtime stays deployed. It does block any
paid-runtime deployment until, after quiescence is at 100% and propagation plus
the deployment-tail interval have passed, repeated read-only queries show zero
across all frozen nonterminal stages:

```text
acquired
verified
executed
settlement_pending
settled_external
link_verified
settlement_failed
FUTURE_ZERO_INFLIGHT_GATE_FROZEN=YES
```

## Mutation and economic accounting

```text
QUIESCENCE_VERSION_UPLOADS=1
DEPLOYMENT_MUTATIONS=0
DEPLOYMENT_MEMBERSHIP_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
EXISTING_VERSION_VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
DNS_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0
D1_WRITES=0
R2_WRITES=0
QUEUE_WRITES=0
WORKFLOW_CREATIONS=0
REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
ATOMIC_PUBLIC_CUTOVER_READINESS_PRESERVED=YES
PAID_RUNTIME_DEPLOY_AUTHORIZED=NO
```

The next production transition remains the separately authorized atomic public
cutover from `db7054c9@100% + b6b7477f@0%` to `b6b7477f@100% + db7054c9@0%`.
This report does not authorize or execute it.
