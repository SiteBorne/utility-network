# SUN-1222C PCC Public Canary 5% Pre-Mutation Gate

Date: 2026-09-10/11 (America/Chicago)  
Checkpoint authority:
`SUN-1222C-PCC-PUBLIC-CANARY-EXECUTION-AUTHORIZATION-5PCT`  
Prior evidence authority: `408962ab674c2e7315c0ea2890d110e7394fdfc6`

## Decision

```text
SUN1222C_PCC_PUBLIC_CANARY_EXECUTION_AUTHORIZATION_5PCT=VERSION_SKEW_BLOCKED_PRE_MUTATION
PUBLIC_PERCENTAGE_CANARY_SAFE=NO
```

The checkpoint stopped at the mandatory mixed-version gate before the 5%
deployment, its dry run, baseline-metrics collection, or canary observation. No
Cloudflare configuration or traffic state changed.

Two independent, externally visible incompatibilities make ordinary percentage
routing unsuitable for this candidate/baseline pair:

1. Candidate version 62 accepts and negotiates the MCP `2025-11-25` legacy
   request sequence. The 100% baseline rejects that same protocol with HTTP 400
   and JSON-RPC error `-32022` (`Unsupported protocol version: 2025-11-25`). A
   client can therefore initialize and discover tools on the candidate, then
   fail on its next independently routed request to the baseline.
2. Both enabled REST v2 services exist on both versions, but their advertised
   and freshly generated PaymentRequired prices differ: verify is 17000 atomic
   on the candidate versus 19000 on the baseline; web context is 8000
   versus 9000. A client can read the candidate catalog and receive a different
   price when its first paid-route request randomly reaches the baseline.

The second finding does **not** mean an already-issued quote becomes unsafe on
the other version. Both immutable sources recover the same persisted quote from
the shared D1 binding and validate the retry against that quote's ID, resource,
scheme, amount, asset, network, payee, and expiry. Candidate-to-baseline and
baseline-to-candidate payment-bearing retries are therefore structurally safe.
The blocker is the random discovery-to-initial-challenge contract, plus the hard
MCP protocol failure.

## Repository and pre-state integrity

Literal repository readback before the audit:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=408962ab674c2e7315c0ea2890d110e7394fdfc6
WORKING_TREE=CLEAN
PRIOR_EVIDENCE_COMMIT_EXISTS=YES
PRIOR_EVIDENCE_COMMIT_REACHABLE=YES
```

No intervening source, configuration, dependency, or evidence drift existed.
Wrangler remained pinned at `4.119.0`.

Fresh read-only Cloudflare status was exact:

```text
PRE_DEPLOYMENT_ID=12f9c2c5-b275-4cfb-87ba-dcdbcae8e76e
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
FEATURE_SCOPED_CANDIDATE_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
FEATURE_SCOPED_CANDIDATE_TRAFFIC=0%
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
SETTLEMENT_ALERT_VERSION=8fe32c69-d906-4369-9c0a-49b2cc406e8e
SETTLEMENT_ALERT_TRAFFIC=100%
PUBLIC_TOPOLOGY_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
```

The deployment ID is the ID recorded by the immediately preceding A2 operation.
Fresh `deployments status` and the final entry of `deployments list` showed that
same operation remains current with the exact 100%/0% composition. Immutable
versions `f7bf204d`, `d155c9a1`, and `d3472f58` remain retained.

## Cloudflare percentage-routing semantics and affinity

Cloudflare's current first-party documentation states that gradual deployments
route requests according to configured percentages and that, by default, each
request is independently assigned to a version. Cloudflare explicitly warns that
this can create version skew for multi-request flows. Deterministic version
affinity requires the caller or an upstream rule to supply
`Cloudflare-Workers-Version-Key`:

- <https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>
- <https://developers.cloudflare.com/workers/wrangler/commands/workers/>

```text
GRADUAL_DEPLOYMENT_ROUTES_REQUESTS_BY_PERCENTAGE=YES
REQUESTS_ARE_INDEPENDENTLY_VERSION_SELECTED_BY_DEFAULT=YES
MIXED_VERSION_SKEW_POSSIBLE=YES
VERSION_AFFINITY_REQUIRES_CLIENT_OR_UPSTREAM_VERSION_KEY=YES
```

Repository-wide inspection found no reference to
`Cloudflare-Workers-Version-Key`, version affinity, or a version-key propagation
mechanism. A normal no-header `/health` request was then observed with an
authoritative JSON tail: it returned HTTP 200 from the baseline, and the
post-Transform request headers contained no version-affinity key. The Cloudflare
Rulesets list endpoint could not be used as a second enumeration mechanism
because the authenticated OAuth profile lacks the required Rulesets read
permission (Cloudflare error 10000); no token or credential was printed. The
live request-path evidence proves that an ordinary external request is not
currently pinned.

```text
SITEBORNE_VERSION_AFFINITY_ACTIVE=NO
```

## Exact baseline/candidate surface matrix

All live comparisons used documented exact-version overrides against the two
versions already in the current deployment. No paid, provider, Workflow,
settlement, or state-writing REST probe was issued.

| Surface                             | Baseline behavior                                                                        | Candidate behavior                                                                              | Mixed sequence possible | User-visible failure possible    | State corruption possible       | Economic inconsistency possible                    | Canary safe                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------- | ------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `/health`                           | HTTP 200, `ok`                                                                           | HTTP 200, `ok`                                                                                  | Yes                     | No                               | No                              | No                                                 | Yes                                 |
| `/ready`                            | HTTP 200; truthful `not_ready`, foundation phase                                         | Same                                                                                            | Yes                     | No                               | No                              | No                                                 | Yes                                 |
| `/catalog`                          | verify/web enabled at 0.019/0.009                                                        | verify/web enabled at 0.017/0.008                                                               | Yes                     | Yes                              | No                              | Yes                                                | **No**                              |
| Agent Card                          | HTTP 200; eight skills; global x402 production flag false                                | HTTP 200; eight skills; global x402 production flag true; version-qualified labels/descriptions | Yes                     | Yes, metadata changes by request | No                              | No                                                 | **No as interchangeable discovery** |
| JWKS                                | HTTP 200; one public ES256 P-256 key                                                     | Byte-equivalent public key set                                                                  | Yes                     | No                               | No                              | No                                                 | Yes                                 |
| OpenAPI                             | HTTP 200; six paths                                                                      | Same normalized document                                                                        | Yes                     | No                               | No                              | No                                                 | Yes                                 |
| Service schemas                     | HTTP 200; same schema identities                                                         | Same normalized schemas                                                                         | Yes                     | No                               | No                              | No                                                 | Yes                                 |
| A2A discovery                       | Same eight skill IDs and `/a2a` interface; metadata noted above                          | Same IDs/interface; metadata noted above                                                        | Yes                     | Metadata can differ              | No                              | No                                                 | Conditional                         |
| A2A `SendMessage`                   | HTTP 200; `TASK_STATE_INPUT_REQUIRED`, `payment_required`, no artifact                   | Same                                                                                            | Yes                     | No cross-version delta           | No; per-request in-memory state | No                                                 | Yes                                 |
| MCP initialize, legacy `2025-11-25` | HTTP 400, JSON-RPC `-32022` unsupported protocol                                         | HTTP 200; negotiates `2025-11-25`                                                               | **Yes**                 | **Yes**                          | No; rejected before dispatch    | No                                                 | **No**                              |
| MCP tools/list, legacy `2025-11-25` | HTTP 400, JSON-RPC `-32022`                                                              | HTTP 200; six tools                                                                             | **Yes**                 | **Yes**                          | No; rejected before dispatch    | No                                                 | **No**                              |
| MCP modern `2026-07-28`             | Correct envelope: HTTP 200; six tools and truthful health                                | Same tool set and feature statuses                                                              | Yes                     | No protocol failure              | No                              | Initial REST price still depends on routed version | Conditional                         |
| MCP paid tools/call                 | Legacy sequence may fail before tool dispatch; modern call maps to baseline REST pricing | Both protocols supported; maps to candidate REST pricing                                        | **Yes**                 | **Yes**                          | No failure-path corruption      | Yes before quote issuance                          | **No**                              |
| verify v2 REST                      | Enabled; exact 19000 atomic                                                              | Enabled; exact 17000 atomic                                                                     | **Yes**                 | **Yes**                          | No                              | **Yes**                                            | **No**                              |
| web-context v2 REST                 | Enabled; exact 9000 atomic                                                               | Enabled; exact 8000 atomic                                                                      | **Yes**                 | **Yes**                          | No                              | **Yes**                                            | **No**                              |
| company v2                          | Production-disabled; early 404                                                           | Production-disabled; early 404                                                                  | Yes                     | No cross-version delta           | No                              | No                                                 | Yes                                 |
| document v2                         | Production-disabled; early 404                                                           | Production-disabled; early 404                                                                  | Yes                     | No cross-version delta           | No                              | No                                                 | Yes                                 |
| artifact ingress                    | Unavailable/disabled before state                                                        | Explicitly disabled before state                                                                | Yes                     | No cross-version delta           | No                              | No                                                 | Yes                                 |

The OpenAPI, schema, JWKS, feature-ID, and modern-MCP comparisons are
compatible. That does not cure the legacy-MCP split or the catalog/initial-402
price split.

## Specific cross-version sequences

| Sequence                                                          | Expected result                | Exact behavior                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: candidate catalog -> baseline verify v2                        | `ECONOMIC_RISK`                | Catalog says 17000 atomic; an unpaid baseline request would issue HTTP 402 at 19000 atomic. No request was manufactured because it would write quote/audit state.                |
| B: candidate catalog -> baseline web v2                           | `ECONOMIC_RISK`                | Catalog says 8000 atomic; an unpaid baseline request would issue HTTP 402 at 9000 atomic. No state-writing request was manufactured.                                             |
| C: candidate legacy MCP initialize/list -> baseline tools/call    | `SEMANTIC_FAILURE`             | Candidate accepts `2025-11-25`; baseline rejects that protocol before dispatch with HTTP 400 / JSON-RPC `-32022`.                                                                |
| D: baseline modern MCP discovery -> candidate modern tools/call   | `SAFE` for transport           | Correct `2026-07-28` envelopes are accepted by both. A paid tool's initial challenge still uses the version-local price reached by the call.                                     |
| E: candidate Agent Card -> baseline `SendMessage`                 | `SAFE` for the actual exchange | Baseline returned HTTP 200, `TASK_STATE_INPUT_REQUIRED`, `payment_required`, zero artifacts—the same closed in-memory result as candidate.                                       |
| F: baseline Agent Card -> candidate `SendMessage`                 | `SAFE` for the actual exchange | Candidate returned the same HTTP 200 closed in-memory result.                                                                                                                    |
| G: candidate PaymentRequired -> payment-bearing retry on baseline | `SAFE` structurally            | Baseline reads the candidate-issued quote by quote ID from shared D1 and validates the submitted requirement against that stored quote, preserving candidate amount and binding. |
| H: baseline payment state -> subsequent candidate request         | `SAFE` structurally            | Candidate uses the same quote repository, payload parser, exact-requirement binding, payment-attempt binding, and durable ownership model.                                       |

No payment-bearing request was executed. The G/H result is a source-and-lineage
proof: baseline source lineage `8f25a291e4144dcdb08999b29a1333b21238eb0e` and
candidate source authority `8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb` have
identical relevant quote issuance/recovery and payment-binding logic. `git diff`
across the quote repository, exact-requirement builder, payload parser, and
relevant x402 route sections showed no cross-version wire or validation change.
Both versions bind `DB` to the same production D1 database.

```text
CANDIDATE_402_TO_BASELINE_PAID_RETRY=SAFE
BASELINE_402_TO_CANDIDATE_PAID_RETRY=SAFE
NO_PERSISTENT_STATE_CORRUPTION_PROVEN=YES
NO_DUPLICATE_PAYMENT_OWNERSHIP_CHANGE=YES
NO_SETTLEMENT_OWNERSHIP_CHANGE=YES
```

## Hard mixed-session decision

```text
MCP_MIXED_VERSION_SESSION_SAFE=NO
A2A_MIXED_VERSION_SESSION_SAFE=YES
FEATURE_DISCOVERY_TO_EXECUTION_SKEW_SAFE=NO
PUBLIC_PERCENTAGE_CANARY_SAFE=NO
```

The feature launch cannot deliberately enter a state where ordinary clients
randomly observe a legacy MCP server or one of two prices. The prior
`FEATURE_SCOPED_NEW_PUBLIC + OLD_PAID=SAFE` finding remains true, but it covers
public-to-paid-runtime compatibility, not baseline-public-to-candidate-public
request skew.

## Commands deliberately not run

Wrangler 4.119.0 confirms that `versions deploy` takes complete positional
`VERSION@PERCENTAGE` specs, creates a deployment, and uploads no source. The
commands that would have represented the authorized stage and governed restore
are recorded for remediation design, but neither was dry-run nor executed
because section 10 required an immediate pre-mutation stop:

```sh
# NOT RUN — blocked pre-mutation
npx wrangler versions deploy \
  db7054c9-76ee-4830-aabe-8a4542261b6a@95% \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@5% \
  --name siteborne-utility-edge \
  --message "SUN-1222C PCC public canary stage 1: db7054c9 95%; b6b7477f 5%; stop at 5%" \
  --yes

# NOT RUN — no canary deployment existed to restore
npx wrangler versions deploy \
  db7054c9-76ee-4830-aabe-8a4542261b6a@100% \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C PCC public canary restore: db7054c9 100%; b6b7477f 0%" \
  --yes
```

```text
CANARY_5PCT_DRY_RUN=NOT_RUN_PREMUTATION_HARD_STOP
RESTORE_COMMAND_DRY_RUN=NOT_RUN_PREMUTATION_HARD_STOP
CANARY_DEPLOYMENT_ID=NONE
CANARY_OBSERVATION_DURATION=0m
TOTAL_REQUESTS_OBSERVED=0
BASELINE_ATTRIBUTABLE_REQUESTS=0
CANDIDATE_ATTRIBUTABLE_REQUESTS=0
```

The read-only override requests used to build the compatibility matrix are not
normal-routing canary traffic and are excluded from these counts.

## Gates not entered

Because the section-10 result was `NO`, sections 11-45 were not used to imply a
canary run. No trailing-24-hour metric baseline, canary lifecycle snapshot, 5xx
gate, semantic-error counter, organic-payment accounting window, or
30-minute/500-request observation was started.

```text
BASELINE_TRAILING_24H_5XX_RATE=UNAVAILABLE_NOT_COLLECTED_PREMUTATION_STOP
CANDIDATE_5XX=NOT_APPLICABLE_NO_CANARY
CANDIDATE_5XX_RATE=NOT_APPLICABLE_NO_CANARY
CANDIDATE_5XX_GATE=NOT_RUN
SEMANTIC_VERSION_SKEW_ERRORS=PREMUTATION_PROOF_OF_POSSIBILITY; NO_CANARY_COUNTER
CANDIDATE_UNEXPECTED_404=NOT_APPLICABLE_NO_CANARY
CANDIDATE_UNKNOWN_TOOL_ERRORS=NOT_APPLICABLE_NO_CANARY
CANDIDATE_PAYMENT_CONTRACT_ERRORS=NOT_APPLICABLE_NO_CANARY
HEALTH_PASS=PASS_PREMUTATION_READ_ONLY
READY_PASS=PASS_PREMUTATION_READ_ONLY_TRUTHFUL_NOT_READY
AGENT_CARD_PASS=PASS_PREMUTATION_READ_ONLY_WITH_DOCUMENTED_CROSS_VERSION_METADATA_DRIFT
JWKS_PASS=PASS_PREMUTATION_READ_ONLY
JWS_PASS=PASS_INHERITED_EXACT_CANDIDATE_QUALIFICATION
MCP_CANARY_GATE=NOT_RUN
A2A_CANARY_GATE=NOT_RUN
COMPANY_FEATURE_LEAK=NOT_APPLICABLE_NO_CANARY
DOCUMENT_FEATURE_LEAK=NOT_APPLICABLE_NO_CANARY
ARTIFACT_FEATURE_LEAK=NOT_APPLICABLE_NO_CANARY
ORGANIC_CANDIDATE_402_OBSERVED=NO_CANARY
PRE_CANARY_INFLIGHT_TOTAL=NOT_TAKEN_SECTION_10_STOP
POST_CANARY_INFLIGHT_TOTAL=NOT_TAKEN_SECTION_10_STOP
```

The previously observed lifecycle value (`verified=16`, `settled_external=1`,
total 17) was not relabeled as a fresh pre-canary snapshot.

## Mutation, economics, and final topology

Fresh final readback remained the pre-state. No rollback was needed because no
canary deployment occurred.

```text
PUBLIC_BASELINE_TRAFFIC_FINAL=100%
FEATURE_SCOPED_CANDIDATE_TRAFFIC_FINAL=0%
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC_FINAL=100%
SETTLEMENT_ALERT_WORKER_UNCHANGED=YES

PRODUCTION_DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VERSION_UPLOADS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
CUSTOM_DOMAIN_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0

CHECKPOINT_D1_WRITES_FROM_TEST_TRAFFIC=0
CHECKPOINT_R2_WRITES_FROM_TEST_TRAFFIC=0
CHECKPOINT_QUEUE_WRITES_FROM_TEST_TRAFFIC=0
CHECKPOINT_WORKFLOW_CREATIONS_FROM_TEST_TRAFFIC=0

CHECKPOINT_GENERATED_REAL_PAYMENTS=0
CHECKPOINT_GENERATED_PAYMENT_AUTHORIZATIONS=0
CHECKPOINT_GENERATED_USEFUL_PROVIDER_EXECUTIONS=0
CHECKPOINT_GENERATED_SETTLEMENTS=0
CHECKPOINT_GENERATED_CHAIN_TRANSACTIONS=0
CHECKPOINT_GENERATED_ECONOMIC_EFFECT_USDC=0

ORGANIC_CANARY_REAL_PAYMENTS=NOT_APPLICABLE_NO_CANARY
ORGANIC_CANARY_PROVIDER_EXECUTIONS=NOT_APPLICABLE_NO_CANARY
ORGANIC_CANARY_SETTLEMENTS=NOT_APPLICABLE_NO_CANARY
ORGANIC_CANARY_ECONOMIC_EFFECT=NOT_APPLICABLE_NO_CANARY

PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1

QUIESCENCE_PREBUILD_EXECUTED=NO
QUIESCENCE_STILL_REQUIRED_BEFORE_PAID_RUNTIME_DEPLOY=YES
NEXT_TRAFFIC_STAGE_AUTHORIZED=NO
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-CANARY-VERSION-SKEW-REMEDIATION
```

The remediation checkpoint must define a coherent public-version transition. At
minimum it must eliminate the candidate-legacy-MCP-to-baseline failure and the
random catalog-to-initial-402 price mismatch, or prove and deploy an
ordinary-client version-affinity mechanism under separate authority. This report
does not authorize any such source, ruleset, deployment, or traffic change.
