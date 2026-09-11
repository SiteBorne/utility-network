# SUN-1222C R6 Feature Cutover Authorization

Date: 2026-09-10

Decision type: feature authority only

Execution status: **NOT AUTHORIZED FOR EXECUTION**

## Executive decision

`SUN1222C_R6_FEATURE_CUTOVER_AUTHORIZATION=PARTIALLY_AUTHORIZED_REQUIRES_NEW_CANDIDATE`

The current immutable candidate is qualified for the exact-version,
zero-economic scope previously approved, but it must not be promoted to 100% as
presently configured. Two services may be included in a future feature-scoped
candidate:

- `verify_agent_output.v2`
- `web_context_verified.v2`

Three capabilities must be disabled in that future candidate:

- `company_evidence_graph.v2`: the last production provider execution reached
  SEC but failed at the external SEC call; no current successful production
  execution is proven.
- `document_evidence_json.v2`: its `upto` payment scheme is explicitly rejected
  by the public durable-continuation boundary after payment verification and
  before provider execution.
- `document-artifact-upload`: anonymous ingress is rate-bounded but physical
  R2/D1 reclamation is not live, expired content-addressed rows can make
  identical re-uploads permanently unusable, and critical
  abuse/storage/reclamation signals are not operator-observable.

This is not a retroactive failure of the candidate qualification. The accepted
qualification proved exact-version reachability, discovery, signature/JWKS
behavior, unpaid payment boundaries, deterministic pre-402 seller resolution,
bounded artifact behavior, and zero-economic protocol operation. It did not
prove useful paid execution or indefinite public storage safety. Accordingly:

```text
PRE_FEATURE_CUTOVER_QUALIFICATION_STATUS=PASS
CANDIDATE_RUNTIME_DEFECT_FOUND_WITHIN_QUALIFIED_SCOPE=NO
PRODUCTION_FEATURE_BLOCKERS_PRESENT=YES
ALL_FIVE_FEATURES_AUTHORIZED=NO
CURRENT_CANDIDATE_100_PERCENT_CUTOVER_AUTHORIZED=NO
NEW_FEATURE_SCOPED_CANDIDATE_REQUIRED=YES
```

No traffic, version, deployment, variable, secret, binding, route, Preview URL,
paid runtime, payment, provider, Workflow, settlement, chain, or mTLS state was
changed by this checkpoint.

## 1. Integrity and live topology

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
EVIDENCE_COMMIT_PRE=e2051a07d1e81ef08dde97cdd7c6dc805ab2254b
EVIDENCE_COMMIT_EXISTS=YES
EVIDENCE_COMMIT_REACHABLE=YES
WORKING_TREE_PRE=CLEAN
HEAD_ADVANCED_BEFORE_CHECKPOINT=NO

PINNED_WRANGLER_VERSION=4.119.0
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
CURRENT_ZERO_PERCENT_CANDIDATE=f7bf204d-5041-45c0-bb8c-4c3f776d7c9e
CURRENT_ZERO_PERCENT_CANDIDATE_TRAFFIC=0%
CURRENT_CANDIDATE_SOURCE=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb
PUBLIC_DEPLOYMENT_DRIFT=NO

PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
PAID_RUNTIME_DRIFT=NO

D155_IMMUTABLE_VERSION_RETAINED=YES
D3472F58_IMMUTABLE_VERSION_RETAINED=YES
SETTLEMENT_ALERT_WORKER_VERSION=8fe32c69-d906-4369-9c0a-49b2cc406e8e
SETTLEMENT_ALERT_WORKER_TRAFFIC=100%
SETTLEMENT_ALERT_WORKER_UNCHANGED=YES
```

Cloudflare's current model separates immutable versions from deployments: a
deployment assigns traffic to versions, and version overrides can target a
version in the current deployment, including the 0% member. The candidate
`/ready` readback was therefore requested with the documented structured
version-override header and correlated to `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e`
by `cf-ray` and JSON Tail.

Fresh read-only candidate proof:

```text
READY_HTTP_STATUS=200
READY_CF_RAY=a392e6fe6e40e4ee-ATL
READY_TAIL_SCRIPT_VERSION=f7bf204d-5041-45c0-bb8c-4c3f776d7c9e
READY_EXACT_VERSION_ATTRIBUTION=PASS
```

## 2. Qualification authority

The authoritative prior evidence remains accepted:

```text
EXACT_VERSION_OVERRIDE_REACHABILITY=PASS
CANDIDATE_HEALTH=PASS
CANDIDATE_READY=PASS
CANDIDATE_AGENT_CARD_GENERATION=PASS
CANDIDATE_JWKS_RUNTIME=PASS
CANDIDATE_JWS_CRYPTOGRAPHIC_VERIFICATION=PASS
CANDIDATE_MTLS_ADVERTISED=NO
CANDIDATE_A2A_ZERO_WRITE_RUNTIME_PROOF=PASS
CANDIDATE_MCP_INITIALIZE=PASS
CANDIDATE_MCP_DISCOVERY=PASS
MCP_SCHEMA_VALID_UNPAID_RUNTIME_PROOF=PASS
MCP_TO_REST_PAYMENT_BOUNDARY_PROVEN=YES
SHARED_REST_402_BOUNDARY_RUNTIME_PROVEN=YES
PCC_REST_RUNTIME_UNPAID_PROOF=PASS
PCC_MCP_RUNTIME_UNPAID_PROOF=PASS
PCC_A2A_RUNTIME_UNPAID_PROOF=PASS
DOCUMENT_ARTIFACT_RUNTIME_PROOF=PASS
SELLER_DETERMINISM_TESTS=PASS
POST_FIX_PRE_402_AUTHENTICATED_CDP_NETWORK_CALLS_MAX=0
POST_FIX_PRE_402_ANALYTICS_REQUESTS=0
POST_FIX_PRE_402_AUTOMATIC_RETRIES=0
LIVE_FULFILLED_PCC_RESULT_VERIFIED=NO
```

## 3. `/ready` blocker classification

Literal sanitized response:

```json
{
  "status": "not_ready",
  "phase": "foundation",
  "production_services_enabled": true,
  "blocked_external": [
    "ionos_dns_migration",
    "nevermined_credentials",
    "registry_publication"
  ],
  "reason": "Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available."
}
```

The response's global wording is a foundation-era aggregate, not a per-service
decision. Source inspection and the already-live custom domain show that these
three entries do not execute on the five feature paths governed here.

| Blocker ID               | Dependency                    | Affected service families                                            | Type          | Runtime path                                                      | Failure behavior / user effect                                                            | Fail closed | Recovery path                              |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- | ------------------------------------------ |
| `ionos_dns_migration`    | Legacy DNS migration evidence | Platform administration; none of the five request paths              | INFORMATIONAL | None in candidate routes                                          | No feature-path effect; `utility.siteborne.net` is already serving the Worker             | N/A         | Dedicated DNS-governance evidence          |
| `nevermined_credentials` | Optional Nevermined rail      | Nevermined publication/payment rail, not the governed CDP/x402 paths | INFORMATIONAL | None in these CDP routes                                          | No CDP feature-path effect; Nevermined remains separately unavailable                     | YES         | Separate credential and rail authorization |
| `registry_publication`   | External registry publication | External distribution/discoverability                                | INFORMATIONAL | None in health, Agent Card, A2A, MCP, REST, or artifact execution | External registry discovery remains unavailable; direct canonical discovery is unaffected | YES         | Separate registry-publication checkpoint   |

The literal readiness list is preserved, but none of those three is the reason a
feature is blocked below. The production-feature blockers were discovered by
service-specific source, provider, storage, and observability analysis.

```text
READY_RESPONSE_PRODUCTION_FEATURE_BLOCKERS_PRESENT=NO
PRODUCTION_FEATURE_BLOCKERS_PRESENT=YES
```

## 4. Activation parity

The immutable candidate version metadata and exact-version runtime catalog
agree:

```text
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=true
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=true
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=true
PAID_ROUTES_ENABLED=true
PRODUCTION_ENABLED=true
PAYMENT_ENVIRONMENT=production
CANDIDATE_FEATURE_ACTIVATION_PARITY=YES
MTLS_PRODUCTION_ACTIVE=FALSE
```

All five are immutable in `f7bf204d`; this candidate has no mechanism to expose
only a subset at 100%.

## 5. Service readiness matrix

| Service                     | Activated | Schema ready |                                Payment boundary ready | Dependency configured | Dependency health proof                                                                  |                             Fail closed | Useful execution pre-cutover tested                                 | Cutover blocker                                                                              |
| --------------------------- | --------: | -----------: | ----------------------------------------------------: | --------------------: | ---------------------------------------------------------------------------------------- | --------------------------------------: | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `verify_agent_output.v2`    |       YES |          YES |                                         YES (`exact`) |                   YES | In-process verification mesh; historical production execution/rejection evidence         |                                     YES | Historical provider execution; no current-candidate live paid proof | NONE for feature authority                                                                   |
| `web_context_verified.v2`   |       YES |          YES |                                         YES (`exact`) |                   YES | Modal endpoint and proxy secret names present; historical real fulfilled provider output |                                     YES | YES historically; no current-candidate live paid proof              | NONE for feature authority                                                                   |
| `company_evidence_graph.v2` |       YES |          YES |                                         YES (`exact`) |                   YES | Modal path reached a real SEC request, but the external SEC request failed               |                        YES economically | NO successful production execution                                  | External SEC fair-access/IP or unmet request-policy requirement unresolved                   |
| `document_evidence_json.v2` |       YES |          YES | 402/verification YES; useful continuation NO (`upto`) |                   YES | Modal document secret names present; no useful live execution                            |                        YES economically | NO                                                                  | Public boundary rejects every `upto` request after verification and before Workflow/provider |
| `document-artifact-upload`  |       YES |          YES |                                N/A; not payment-gated |             R2/D1 YES | One exact-candidate synthetic write passed                                               | YES on malformed/limiter/storage errors | One bounded upload                                                  | No physical reclamation, stale expired dedup, incomplete observability                       |

## 6. Exposure model at 100%

| Feature                     | Current normal exposure | At 100%                     | Auth required | Payment required | Persistent state before payment                                 |                  Useful provider after payment | D1 effect                                | R2 effect                   | Workflow effect                      |                            Economic effect possible |
| --------------------------- | ----------------------- | --------------------------- | ------------: | ---------------: | --------------------------------------------------------------- | ---------------------------------------------: | ---------------------------------------- | --------------------------- | ------------------------------------ | --------------------------------------------------: |
| `verify_agent_output.v2`    | No; candidate 0%        | Public REST/A2A/MCP surface |            NO |              YES | Quote and audit rows                                            |                                            YES | quote/audit/payment/job lifecycle        | none                        | paid continuation after verification |                                                 YES |
| `web_context_verified.v2`   | No                      | Public REST/A2A/MCP surface |            NO |              YES | Quote and audit rows                                            |                                            YES | quote/audit/payment/job lifecycle        | none                        | paid continuation after verification |                                                 YES |
| `company_evidence_graph.v2` | No                      | Public REST/A2A/MCP surface |            NO |              YES | Quote and audit rows                                            | YES, but current SEC dependency is not healthy | quote/audit/payment/job lifecycle        | none                        | paid continuation after verification |                                                 YES |
| `document_evidence_json.v2` | No                      | Public REST/A2A/MCP surface |            NO |     YES (`upto`) | Quote/audit and, after valid payment, payment/job lifecycle     |                    NO with current public code | quote/audit/payment/job rejection        | reads referenced input only | none for the rejected `upto` path    | payment verification possible; settlement prevented |
| `document-artifact-upload`  | No                      | Anonymous public upload     |            NO |               NO | Admission counters, artifact metadata, and object on acceptance |                                            N/A | two admission counters plus artifact row | content-addressed object    | none                                 |                        storage cost without payment |

For each paid service, payment-absent requests return requirements and cannot
execute useful provider work. The public API has zero settlement callsites; the
dedicated Workflow remains the sole settlement owner.

## 7. Pricing and seller authority

Pricing is read from `governance/RISK_LIMITS.yaml` through `@siteborne/pricing`,
and the exact-version catalog agrees. The asset uses six-decimal atomic units as
defined by the pricing conversion and Base USDC contract.

| Service ID                  |                                                                                                            Price atomic | Asset                                        | Network       | Pay-to                                       | Scheme  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------: | -------------------------------------------- | ------------- | -------------------------------------------- | ------- |
| `verify_agent_output.v2`    |                                                                                                                 `17000` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `eip155:8453` | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` | `exact` |
| `web_context_verified.v2`   |                                                                                                                  `8000` | same                                         | `eip155:8453` | same                                         | `exact` |
| `company_evidence_graph.v2` |                                                                                                                 `31200` | same                                         | `eip155:8453` | same                                         | `exact` |
| `document_evidence_json.v2` | `190000` authorization ceiling; measured native/OCR/table units are `9800`/`15600`/`23800` per page, capped at `190000` | same                                         | `eip155:8453` | same                                         | `upto`  |

```text
PRICE_CONFIG_DRIFT=NO
SELLER_WALLET_ADDRESS_AUTHORITY=CONFIGURED_CANONICAL_PAYTO
SELLER_ADDRESS_CHANGED_SINCE_QUALIFICATION=NO
PRE_402_AUTHENTICATED_CDP_NETWORK_CALLS=0
PRE_402_ANALYTICS_REQUESTS=0
PRE_402_AUTOMATIC_RETRIES=0
```

## 8. Provider readiness and paid failure safety

Only secret names were inspected; no secret values were read or printed.

| Provider                       | Configured |                                Auth secret present by name |            Endpoint present | Health proof available                   | Last proven health                                                | Production execution previously proven | Current blocker                                                       |
| ------------------------------ | ---------: | ---------------------------------------------------------: | --------------------------: | ---------------------------------------- | ----------------------------------------------------------------- | -------------------------------------: | --------------------------------------------------------------------- |
| Verify mesh                    |        YES | Receipt-signing and CDP payment-verification names present | In-process, no external URL | Structural/tests plus historical runtime | Historical real execution reached provider-level rejection safely |                                    YES | No current-candidate live paid acceptance; treated as acceptance debt |
| Web context / Modal            |        YES |                                                        YES |                         YES | Historical real execution                | Real fulfilled provider payload returned                          |                                    YES | No current-candidate live paid acceptance; treated as acceptance debt |
| Company evidence / Modal + SEC |        YES |                                                        YES |                         YES | Real call, negative result               | Modal reached SEC; SEC-side request failed                        |                      YES, unsuccessful | External SEC fair-access/IP or unmet request-policy requirement       |
| Document / Modal               |        YES |                                                        YES |                         YES | No useful paid health proof              | Not reached through current `upto` continuation                   |                                     NO | Public durable continuation does not support `upto`                   |

Paid path semantics for all four services:

- Payment verification happens before useful provider execution.
- A caller can therefore present a valid payment authorization before a later
  provider failure.
- Settlement never happens before the provider.
- Provider failure prevents settlement.
- Exact-service execution occurs in a durable Workflow with bounded executor
  retries (two retries, exponential five-second base, 40-second step timeout),
  idempotent payment/job ownership, and join behavior for a same-payment
  duplicate.
- Provider exhaustion leaves durable rejected/quarantined job evidence and a
  verified but unsettled payment attempt; the caller receives a 5xx failure.
- Settlement reconciliation handles settlement ambiguity after execution; it is
  not a mechanism to turn provider failure into success.
- The `upto` document path is rejected before Workflow creation/provider
  execution and before settlement.

| Service                     | Payment verified before provider | Customer may authorize before provider failure | Provider-failure lifecycle                                                       | Settlement prevented | Reconciliation behavior                                                         | User-visible failure                |
| --------------------------- | -------------------------------: | ---------------------------------------------: | -------------------------------------------------------------------------------- | -------------------: | ------------------------------------------------------------------------------- | ----------------------------------- |
| `verify_agent_output.v2`    |                              YES |                                            YES | `EXECUTING → QUARANTINED → REJECTED`; payment attempt remains verified/unsettled |                  YES | No provider-success fabrication; same-payment duplicate joins the durable owner | bounded 5xx rejection               |
| `web_context_verified.v2`   |                              YES |                                            YES | `EXECUTING → QUARANTINED → REJECTED`; payment attempt remains verified/unsettled |                  YES | Same as verify                                                                  | bounded 5xx rejection               |
| `company_evidence_graph.v2` |                              YES |                                            YES | `EXECUTING → QUARANTINED → REJECTED`; payment attempt remains verified/unsettled |                  YES | Same as verify; external SEC failure is not reconciled into success             | bounded 5xx rejection               |
| `document_evidence_json.v2` |                              YES |                                            YES | public job moves `LOCKED → REJECTED` with quarantine policy; no Workflow created |                  YES | No provider or settlement reconciliation begins                                 | HTTP 500 `service_execution_failed` |

```text
PAID_FAILURE_PATH_FAILS_SAFE=YES
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

## 9. Real-paid acceptance gap

No paid operation occurred in this checkpoint:

```text
LIVE_VALID_PAYMENT_VERIFICATION_TESTED=NO
LIVE_USEFUL_PROVIDER_EXECUTION_TESTED=NO
LIVE_PAID_WORKFLOW_CREATION_TESTED=NO
LIVE_SETTLEMENT_TESTED=NO
LIVE_FULFILLED_PCC_RESULT_VERIFIED=NO
```

| Behavior                                                 | Pre-cutover possible with NEW public + OLD paid?             | Classification                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Valid payment verification for authorized exact services | YES, via exact candidate override and separate authorization | OPTIONAL_POST_CUTOVER_ACCEPTANCE; not required by this governance-only checkpoint         |
| Useful verify/web provider execution                     | YES, with separate payment/provider authorization            | OPTIONAL_POST_CUTOVER_ACCEPTANCE; historical provider evidence supports feature authority |
| Fulfilled PCC for verify/web                             | YES, technically compatible                                  | OPTIONAL_POST_CUTOVER_ACCEPTANCE; must never be inferred from unpaid proof                |
| Successful company evidence                              | Not presently reliable                                       | REQUIRED_BEFORE_ENABLING_THIS_FEATURE; currently blocked by the external dependency       |
| Useful document evidence                                 | NO with current public source                                | REQUIRED_BEFORE_ENABLING_THIS_FEATURE; code remediation and a new candidate are required  |

The authorized exact-service set can be cut over without constructing an
impossible precondition. A separately authorized live-paid checkpoint may occur
before or after its public cutover; it is not authorized here.

## 10. Document artifact governance

```text
DOCUMENT_ARTIFACT_PAYMENT_GATED=NO
MAX_UPLOAD_BYTES=10485760
ACCEPTED_MEDIA_TYPES=application/pdf,image/png,image/jpeg
PER_SOURCE_ADMISSION_LIMIT=50
GLOBAL_ADMISSION_LIMIT=2000
WINDOW_DURATION_SECONDS=86400
LOGICAL_UPLOAD_TTL_SECONDS=900
R2_OBJECT_RETENTION=UNBOUNDED_IN_LIVE_CONFIGURATION
BOUNDED_STORAGE_ABUSE_CONTROLS_PRESENT=YES
ABUSE_CONTROLS_SUFFICIENT_FOR_PRODUCTION=NO
DOCUMENT_ARTIFACT_SAFE_FOR_NORMAL_PUBLIC_PRODUCTION=NO
```

Controls present: bounded streaming before full buffering, Content-Length fast
rejection, signature/media matching, Cloudflare-supplied source identity, atomic
D1 per-source and global fixed-window admission, fail-closed limiter behavior,
server-generated UUIDs, server-computed SHA-256 addressing, and D1/R2 content
deduplication. Malformed/oversize/media failures return 4xx; quota returns 429;
limiter unavailability returns 503; storage failure returns 502.

Remaining blockers:

1. The repository defines 24-hour physical reclamation but exports no scheduled
   handler. Live R2 lifecycle readback contains only the default seven-day
   incomplete-multipart abort rule, not object expiry. At configured maximums,
   acceptance is bounded to 20,971,520,000 bytes per day but total retained
   storage is not bounded over time.
2. Hash deduplication returns the pre-existing row without refreshing
   `expires_at`. Because read-time resolution rejects expired rows and
   reclamation is not running, re-uploading identical content after 900 seconds
   can return the same already-expired, unusable upload capability indefinitely.
3. Artifact 429/503/502 rates, write anomalies, and missing reclamation have no
   dedicated durable audit/alert path.

Admission housekeeping is separately sound:

```text
EXPIRED_ADMISSION_CLEANUP_IS_INTENDED_PRODUCTION_BEHAVIOR=YES
ACTIVE_WINDOW_ROWS_DELETED=NO
JOB_ARTIFACT_PAYMENT_LIFECYCLE_ROWS_DELETED=NO
```

The predicate deletes only admission-window rows strictly older than the cutoff.
It cannot target job, artifact, payment, or active-window tables.

## 11. Observability matrix

| Feature           | 402 volume | Payment transitions         | Provider failure                                                          | Workflow failure                       | Settlement failure                            | Abuse/rate-limit                                   | R2/D1 anomalies                                               |
| ----------------- | ---------- | --------------------------- | ------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Verify            | D1 audit   | D1 payment lifecycle/audit  | Durable job state/audit                                                   | Workflow status and job state          | Settlement lifecycle + scheduled alert Worker | N/A                                                | D1 error response/audit coverage                              |
| Web context       | D1 audit   | D1 payment lifecycle/audit  | Durable job state/audit                                                   | Workflow status and job state          | Settlement lifecycle + scheduled alert Worker | N/A                                                | D1 error response/audit coverage                              |
| Company evidence  | D1 audit   | D1 payment lifecycle/audit  | Durable rejection captures failure, but no proactive provider-health gate | Workflow status and job state          | Settlement lifecycle + scheduled alert Worker | N/A                                                | D1 error response/audit coverage                              |
| Document evidence | D1 audit   | Verified/rejected lifecycle | Explicit unsupported-`upto` rejection                                     | Workflow is never created on this path | Settlement prevented                          | N/A                                                | D1 errors visible per request                                 |
| Artifact upload   | N/A        | N/A                         | N/A                                                                       | N/A                                    | N/A                                           | Caller receives 429/503; no durable operator alert | Caller receives 502; no dedicated anomaly/reclamation monitor |

```text
CRITICAL_FAILURE_MODE_UNOBSERVABLE=YES
UNOBSERVABLE_BLOCKER=DOCUMENT_ARTIFACT_ABUSE_STORAGE_AND_RECLAMATION_HEALTH_LACK_DURABLE_OPERATOR_SIGNAL
```

This violates the requested production observability gate for the artifact
feature and is an independent reason to keep it disabled.

## 12. Five-feature authorization matrix

| Feature                     | Authority      | Why                                                                                                                                  | Remaining acceptance debt                                   | Required later proof                                                                         |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `verify_agent_output.v2`    | **AUTHORIZED** | Exact payment boundary, deterministic seller, historical provider execution, durable failure containment, sole settlement owner      | Current-candidate live valid-payment/fulfilled PCC not run  | Optional bounded NEW/OLD or NEW/NEW live-paid acceptance under separate authority            |
| `web_context_verified.v2`   | **AUTHORIZED** | Exact payment boundary, production endpoint/secrets present, historical real fulfilled provider output, safe failure/settlement path | Current-candidate live valid-payment/fulfilled PCC not run  | Optional bounded NEW/OLD or NEW/NEW live-paid acceptance under separate authority            |
| `company_evidence_graph.v2` | **BLOCKED**    | Last production attempt failed at external SEC despite reaching the real path                                                        | Successful production provider acceptance absent            | Resolve SEC access policy and prove one bounded successful provider result                   |
| `document_evidence_json.v2` | **BLOCKED**    | Current public code rejects all `upto` services after verification and before useful continuation                                    | Durable actual-amount handoff and settlement support absent | Remediate `upto`, test authorization ceiling/actual amount, upload and qualify new candidate |
| `document-artifact-upload`  | **BLOCKED**    | Anonymous storage has unbounded live retention, stale expired dedup, and an observability gap                                        | Live reclamation, expiry-safe dedup, monitoring not present | Implement and qualify reclamation/repair/observability or keep route disabled                |

Required feature-scoped ordinary-variable delta from `f7bf204d`:

```text
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true→false
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true→false
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true→false
ALL_OTHER_ORDINARY_VARS_BINDINGS_AND_SECRET_NAMES=UNCHANGED
```

## 13. Canary and organic economics

The current all-five candidate must not receive a nonzero canary because its
immutable flags would expose all three blocked capabilities. A future
feature-scoped candidate requires staged canarying with the old paid runtime,
because `NEW_PUBLIC + OLD_PAID = SAFE`.

```text
PUBLIC_CANARY_REQUIRED=YES
PUBLIC_CANARY_STAGES=5%,25%,50%,100%
ORGANIC_REAL_PAYMENT_POSSIBLE_DURING_CANARY=YES
ORGANIC_PAID_EXECUTION_DURING_CANARY_SAFE=YES
CURRENT_ALL_FIVE_CANDIDATE_CANARY_AUTHORIZED=NO
```

The `YES` is the narrow lifecycle/compatibility answer: the old paid runtime can
safely own organically created exact-service Workflows and provider failure
cannot settle. It does not override the feature blockers, so it does not permit
a canary of `f7bf204d`.

Each stage must remain for at least 30 minutes **and** accumulate at least 500
attributable requests. Advance only when all of the following hold:
candidate-attributed 5xx rate does not exceed the baseline's trailing-24-hour
rate; health/readiness/Agent Card/JWKS/JWS checks pass; A2A and MCP protocol
probes pass; unpaid exact-service probes return the expected `payment_required`;
all three disabled paths return 404; no unexpected Workflow/settlement alert or
lifecycle anomaly appears. Any gate failure restores `db7054c9` to 100% and
leaves `d62011b9` unchanged. No synthetic payment is part of canary gates.

## 14. Quiescence and zero-inflight state

Quiescence requires a distinct immutable public version because `f7bf204d` has
`PAID_ROUTES_ENABLED=true`.

```text
QUIESCENCE_REQUIRES_NEW_PUBLIC_VERSION=YES
QUIESCENCE_REQUIRES_TRAFFIC_DEPLOYMENT=YES
QUIESCED_VERSION_PRESERVES_DISCOVERY=YES
QUIESCED_VERSION_BLOCKS_NEW_PAID_EXECUTION=YES
QUIESCED_VERSION_ALLOWS_EXISTING_WORKFLOWS_TO_FINISH=YES
QUIESCENCE_SOURCE_COMMIT=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb
ONLY_INTENTIONAL_QUIESCENCE_DELTA=PAID_ROUTES_ENABLED:true→false
QUIESCED_VERSION_CONFIG_EQUIVALENCE_FEASIBLE=YES
```

“Preserves discovery” means the health, Agent Card, JWKS, A2A, MCP, and catalog
endpoints remain routable; the service descriptors truthfully report
production-disabled and paid invocations fail closed.

Fresh read-only D1 count at this checkpoint:

```text
verified=16
settled_external=1
INFLIGHT_PAID_JOBS_TOTAL=17
PAID_RUNTIME_DEPLOY_ALLOWED=NO
```

The future invariant is sound but not presently satisfied:

```text
RACE_FREE_QUIESCENCE_MODEL=PASS
REQUIRED=QUIESCED_PUBLIC_TRAFFIC_100_AND_PROPAGATED + ADMISSION_CLOSED + INFLIGHT_PAID_JOBS_TOTAL_0
CURRENT_ZERO_INFLIGHT_GATE=BLOCKED (17 NONTERMINAL ROWS)
```

No lifecycle row was changed by the count query.

## 15. Optimal coordinated sequence

Because the current candidate is blocked, the sequence begins with feature
scoping:

1. Build, upload, and exact-version qualify a feature-scoped normal candidate
   from the accepted source with only the three blocked activation flags false.
2. Build a quiesced derivative of that exact candidate with only
   `PAID_ROUTES_ENABLED=false`; upload it before public cutover.
3. Cloudflare permits only two versions per deployment. To exact-version qualify
   the quiesced derivative while retaining `db7054c9@100`, a separately
   authorized 0%-membership operation must temporarily replace the normal 0%
   candidate with the quiesced candidate, qualify it with a version override,
   then restore the normal candidate at 0%. Both immutable versions remain
   retained.
4. Canary the normal feature-scoped candidate at 5%, 25%, 50%, and 100% with
   `d62011b9` paid runtime.
5. Hold a stability gate on NEW public + OLD paid.
6. Reintroduce and promote the already-qualified quiesced derivative to 100%;
   wait for deployment propagation and prove new paid admission is closed.
7. Query the authoritative lifecycle stages until the total is zero. A timeout
   blocks the paid deploy; it never permits force-deployment.
8. Under separate authority, deploy the paid-runtime PCC fix.
9. Qualify quiesced NEW public + NEW paid.
10. Restore the normal feature-scoped public version at 100%.
11. Run any separately authorized bounded NEW/NEW live-paid acceptance.
12. Stop.

```text
PREBUILD_QUIESCENCE_VERSION_BEFORE_PUBLIC_CUTOVER=YES
OPTIMAL_COORDINATED_CUTOVER_SEQUENCE=FEATURE_SCOPE→PREBUILD_AND_0%_QUALIFY_QUIESCENCE→STAGED_PUBLIC_CANARY→NORMAL_NEW_100→QUIESCED_NEW_100→PROPAGATE_AND_CLOSE_ADMISSION→DRAIN_TO_ZERO→DEPLOY_NEW_PAID→QUALIFY_QUIESCED_NEW_NEW→RESTORE_NORMAL_NEW_100→OPTIONAL_LIVE_PAID_ACCEPTANCE→STOP
```

## 16. Rollback matrix

| Failure                     | Required response                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Canary                   | Restore `db7054c9@100`; keep normal candidate at 0% and paid runtime `d62011b9`                                                               |
| B. 100% public promotion    | Restore `db7054c9@100`; do not proceed to quiescence or paid deploy                                                                           |
| C. Quiesced qualification   | Never promote quiesced version; retain normal public/old paid topology                                                                        |
| D. Quiesced 100% deployment | Restore normal NEW public at 100%; keep old paid runtime                                                                                      |
| E. Drain timeout            | Keep quiescence and old paid runtime; inspect/reconcile exact lifecycle rows; do not force deploy                                             |
| F. Paid-runtime deploy      | Restore/confirm `d62011b9`; keep quiesced public until NEW+OLD health is re-established, then restore normal NEW                              |
| G. NEW-paid qualification   | Roll paid runtime back to `d62011b9` first; verify NEW public + OLD paid; only then change public traffic if necessary                        |
| H. Restore-normal-public    | Keep quiesced NEW public at 100%; if paid state is uncertain, restore `d62011b9` first; never route old public traffic while NEW paid is live |

Critical rule: once the paid runtime is NEW, `db7054c9` may not receive traffic.
Paid rollback comes first, NEW public + OLD paid is verified second, and only
then may old public traffic be considered.

## 17. First-party Cloudflare references

- [Versions and Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
- [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

## 18. Verification and accounting

Fresh gates:

```text
FOCUSED_QUALIFICATION_TESTS=PASS (299 PASSED)
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
PRODUCTION_PREFLIGHT=PASS
SECRET_SCAN=PASS (777 COMMITS + WORKING TREE; NO LEAKS)
PRICE_CONFIG_DRIFT=NO
```

Checkpoint accounting:

```text
VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENT_MUTATIONS=0
DEPLOYMENT_MEMBERSHIP_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
CUSTOM_DOMAIN_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0

REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
WORKFLOW_CREATIONS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0

MTLS_PRODUCTION_ACTIVE=FALSE
CANDIDATE_MTLS_ADVERTISED=NO
MTLS_PROVISIONING_AUTHORIZED=NO
LEGAL_IDENTITY_BINDING_AUTHORIZED=NO
TRAFFIC_CUTOVER_EXECUTION_AUTHORIZED=NO
PAID_RUNTIME_DEPLOY_AUTHORIZED=NO
```

## 19. Governance authority statement

No all-five human authority statement is emitted because the all-five gate did
not pass. This evidence decision authorizes only carrying
`verify_agent_output.v2` and `web_context_verified.v2` forward into a new,
separately uploaded and separately qualified feature-scoped candidate. It does
**not** authorize promotion of `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e`, because
that would also expose three blocked capabilities. It does not authorize any
version upload, deployment membership change, traffic change, quiescence,
paid-runtime deployment, payment, provider execution, Workflow creation,
settlement, chain transaction, or mTLS operation.

## 20. Decision packet

```text
SUN1222C_R6_FEATURE_CUTOVER_AUTHORIZATION=PARTIALLY_AUTHORIZED_REQUIRES_NEW_CANDIDATE
EVIDENCE_COMMIT_PRE=e2051a07d1e81ef08dde97cdd7c6dc805ab2254b
CANDIDATE_VERSION=f7bf204d-5041-45c0-bb8c-4c3f776d7c9e
CANDIDATE_SOURCE=8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb
PRE_FEATURE_CUTOVER_QUALIFICATION_STATUS=PASS
CANDIDATE_READINESS_BLOCKERS=ionos_dns_migration,nevermined_credentials,registry_publication
PRODUCTION_FEATURE_BLOCKERS_PRESENT=YES
VERIFY_AGENT_OUTPUT_V2_PRODUCTION_CUTOVER_AUTHORITY=AUTHORIZED
WEB_CONTEXT_VERIFIED_V2_PRODUCTION_CUTOVER_AUTHORITY=AUTHORIZED
COMPANY_EVIDENCE_GRAPH_V2_PRODUCTION_CUTOVER_AUTHORITY=BLOCKED
DOCUMENT_EVIDENCE_JSON_V2_PRODUCTION_CUTOVER_AUTHORITY=BLOCKED
DOCUMENT_ARTIFACT_UPLOAD_PRODUCTION_CUTOVER_AUTHORITY=BLOCKED
ALL_FIVE_FEATURES_AUTHORIZED=NO
FEATURE_CUTOVER_AUTHORITY=BLOCKED_FOR_CURRENT_CANDIDATE
CURRENT_CANDIDATE_SUPPORTS_PARTIAL_FEATURE_CUTOVER=NO
NEW_FEATURE_SCOPED_CANDIDATE_REQUIRED=YES
PRICE_CONFIG_DRIFT=NO
SELLER_ADDRESS_CHANGED_SINCE_QUALIFICATION=NO
DOCUMENT_ARTIFACT_PAYMENT_GATED=NO
DOCUMENT_ARTIFACT_SAFE_FOR_NORMAL_PUBLIC_PRODUCTION=NO
BOUNDED_STORAGE_ABUSE_CONTROLS_PRESENT=YES
ABUSE_CONTROLS_SUFFICIENT_FOR_PRODUCTION=NO
LIVE_FULFILLED_PCC_PROOF_PRE_CUTOVER_POSSIBLE=YES_FOR_AUTHORIZED_EXACT_SERVICES_UNDER_SEPARATE_AUTHORITY
LIVE_FULFILLED_PCC_PROOF_REQUIRED_BEFORE_PUBLIC_CUTOVER=NO_FOR_AUTHORIZED_FEATURE_SCOPED_SET
PAID_FAILURE_PATH_FAILS_SAFE=YES
PUBLIC_CANARY_REQUIRED=YES_FOR_FUTURE_FEATURE_SCOPED_CANDIDATE
ORGANIC_REAL_PAYMENT_POSSIBLE_DURING_CANARY=YES
ORGANIC_PAID_EXECUTION_DURING_CANARY_SAFE=YES
CURRENT_ALL_FIVE_CANDIDATE_CANARY_AUTHORIZED=NO
QUIESCED_VERSION_CONFIG_EQUIVALENCE_FEASIBLE=YES
RACE_FREE_QUIESCENCE_MODEL=PASS
SETTLEMENT_ALERT_WORKER_UNCHANGED=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-FEATURE-SCOPED-CANDIDATE-REMEDIATION
```
