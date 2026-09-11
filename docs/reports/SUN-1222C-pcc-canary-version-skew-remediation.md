# SUN-1222C PCC Canary Version-Skew Remediation

**Decision date:** 2026-09-10 (America/Chicago)

**Prior evidence:** `87641e67c1f33df9b3d0b000c165fe7bea273880`

**Decision:** `ATOMIC_CUTOVER_SELECTED`

**Production mutation in this checkpoint:** none

## Executive decision

The 5%/25%/50%/100% percentage canary is retired for this release. The public
baseline and candidate expose different MCP and price contracts, and SITEBORNE's
actual machine-agent protocols do not provide a universal, stable identity to
Cloudflare before the first relevant request. IP affinity is the broadest
available edge key, but it only reduces version switching: an agent can change
egress, a proxy can distribute one logical flow across egress addresses, and a
NAT can group unrelated agents under one canary assignment. Cookie affinity has
the same first-request gap and is not part of the MCP, A2A, or REST contract.

The safest supported transition is therefore a separately authorized atomic
public deployment from:

```text
db7054c9-76ee-4830-aabe-8a4542261b6a @ 100%
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @ 0%
```

to:

```text
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @ 100%
db7054c9-76ee-4830-aabe-8a4542261b6a @ 0%
```

Keeping the baseline as the explicit 0% member preserves an exact, immediate
rollback composition. It does not route normal traffic to the baseline after the
cutover. This report authorizes neither command.

```text
SELECTED_ROLLOUT_STRATEGY=ATOMIC_100_PERCENT_PUBLIC_CUTOVER
PERCENTAGE_CANARY_RETIRED=YES
PUBLIC_CANARY_STAGES=RETIRED_DUE_TO_PUBLIC_CONTRACT_VERSION_SKEW
FINAL_CANDIDATE_CONTRACT_REMEDIATION_REQUIRED=NO
```

## Repository and live-state integrity

The literal pre-state was:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=87641e67c1f33df9b3d0b000c165fe7bea273880
WORKING_TREE=CLEAN
PRIOR_EVIDENCE_COMMIT_EXISTS=YES
PRIOR_EVIDENCE_COMMIT_REACHABLE=YES
PINNED_WRANGLER_VERSION=4.119.0
```

Fresh read-only Wrangler status showed:

```text
PUBLIC_BASELINE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_BASELINE_TRAFFIC=100%
FEATURE_SCOPED_CANDIDATE_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
FEATURE_SCOPED_CANDIDATE_TRAFFIC=0%
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
PUBLIC_TOPOLOGY_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
```

No percentage canary had started.

## Cloudflare version-affinity semantics

Cloudflare documents that requests in a gradual deployment are independently
routed unless a stable `Cloudflare-Workers-Version-Key` is supplied. The key is
hashed into the configured distribution; it makes routing deterministic for a
given deployment state but does not let a caller name a version. Cloudflare's
documented rollout behavior is monotonic only in the candidate direction:
candidate-assigned keys remain candidate-assigned as the candidate percentage
increases, while some baseline-assigned keys necessarily migrate to the
candidate. Therefore the prompt's literal proposition that every key stays on
the same version across percentage increases is false; the qualified behavior is
the one just stated.

Primary authority:

- [Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)
- [Version affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)
- [Request Header Transform Rules](https://developers.cloudflare.com/rules/transform/request-header-modification/)
- [Request-header operation parameters](https://developers.cloudflare.com/rules/transform/request-header-modification/reference/parameters/)

```text
WITHOUT_VERSION_KEY_REQUESTS_RANDOMLY_SELECT_VERSION_PER_REQUEST=YES
VERSION_KEY_DETERMINISTIC_WITHIN_DEPLOYMENT=YES
SAME_VERSION_KEY_STAYS_ON_SAME_VERSION_AS_PERCENTAGE_INCREASES=NO_AS_LITERAL
QUALIFIED_PERCENTAGE_INCREASE_BEHAVIOR=CANDIDATE_ASSIGNED_KEYS_REMAIN_CANDIDATE;_BASELINE_ASSIGNED_KEYS_PROGRESSIVELY_MIGRATE_TO_CANDIDATE
VERSION_KEY_DOES_NOT_ALLOW_CALLER_TO_CHOOSE_SPECIFIC_VERSION=YES
VERSION_AFFINITY_CAN_BE_SET_BY_TRANSFORM_RULE=YES
TRANSFORM_RULE_REQUIRES_ZONE_ROUTE=YES
```

### Live route and rule eligibility

Read-only Cloudflare API state showed that `utility.siteborne.net` is the
production custom domain for `siteborne-utility-edge` in the `siteborne.net`
zone. The only separate Worker Route is
`siteborne.net/.well-known/mcp-registry-auth`. The account Workers subdomain is
`siteborneutilitynetwork`; the normal workers.dev endpoint is enabled while
versioned preview URLs are disabled. Both the custom domain and normal
workers.dev health endpoints returned HTTP 200 during this read-only check.

Thus the custom domain is eligible for a zone Request Header Transform Rule, but
a rule scoped to `utility.siteborne.net` cannot govern the public
`siteborne-utility-edge.siteborneutilitynetwork.workers.dev` path. The OAuth
profile available to this session could read routes/custom domains but lacked
Rulesets and DNS read scopes (Cloudflare error 10000). The dashboard was not
authenticated. Existing rule ordering therefore could not be enumerated and is
reported as unknown, never guessed. That uncertainty would be a mandatory
precondition in any future rule-mutation checkpoint; it does not block the
selected no-rule atomic strategy.

```text
UTILITY_SITEBORNE_NET_ELIGIBLE_FOR_TRANSFORM_RULE_AFFINITY=YES
CALLER_CAN_SUBMIT_VERSION_KEY=YES
TRANSFORM_RULE_CAN_AUTHORITATIVELY_OVERWRITE_VERSION_KEY=YES
CLIENT_CAN_BYPASS_ZONE_AFFINITY_RULE=YES_VIA_PUBLIC_WORKERS_DEV_SURFACE
EXISTING_RULE_ORDER_CONFLICT=UNKNOWN_RULESETS_READ_PERMISSION_AND_DASHBOARD_SESSION_UNAVAILABLE
```

A matching `set` rule runs before Worker version selection and overwrites a
caller-supplied value. A caller cannot use a version key to name a version in
any event. A later request-header rule could overwrite an earlier one, which is
why rule ordering must be read before any future rule authorization.

## SITEBORNE client model

The source and public contracts establish the following pre-routing identity
matrix. A Transform Rule can use request headers, cookies, and edge properties,
but cannot inspect a JSON request body to extract MCP `clientInfo`, A2A
`messageId`, or a later payment identifier before the Worker is selected.

| Client class            | Stable ID before first request                     | Source                                                                                                                              | Persists across sequence                                         | Transform-rule usable                                                               | Version-key usable        | Egress can change      | Cookie support assumed                | Coverage                                    |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------- | ---------------------- | ------------------------------------- | ------------------------------------------- |
| MCP clients             | No                                                 | Modern `clientInfo` is inside the request envelope; legacy initialize may omit the modern envelope; neither is a required unique ID | Not guaranteed; server creates a fresh instance per request      | No                                                                                  | No                        | Yes                    | No/unknown                            | None                                        |
| A2A agents              | No                                                 | Agent Card GET is anonymous; `messageId`/`contextId` appear only in later POST bodies                                               | Body IDs can persist, but arrive after first selection           | No                                                                                  | No                        | Yes                    | No/unknown                            | None                                        |
| Direct REST agents      | No                                                 | Catalog/schema GET is anonymous; optional idempotency metadata is not universal                                                     | Not guaranteed                                                   | Not universally                                                                     | Not universally           | Yes                    | No/unknown                            | None                                        |
| Browser users           | No dedicated browser application was found         | Public discovery URLs can be opened in a browser, but no application session contract exists                                        | Browser-dependent                                                | Cookie/IP only                                                                      | Cookie/IP only            | Yes                    | Technically possible, not contractual | Partial only                                |
| Payment clients         | No                                                 | `PAYMENT-SIGNATURE` and `Payment-Identifier` arise only after the initial 402                                                       | Yes after challenge, too late for discovery/initial-402 affinity | Not for the first request                                                           | Not for the first request | Yes                    | No/unknown                            | Retry only                                  |
| Crawlers/directories    | No                                                 | Anonymous HTTP/MCP discovery; User-Agent is neither unique nor stable identity                                                      | Not guaranteed                                                   | IP/User-Agent only                                                                  | IP/User-Agent only        | Yes                    | No/unknown                            | Partial only                                |
| Service-binding callers | No public inbound service-binding caller was found | The paid Workflow binding is downstream from the public Worker, not an inbound public identity                                      | N/A                                                              | A service-binding subrequest can carry a key if an upstream explicitly supplies one | Yes if newly implemented  | Architecture-dependent | N/A                                   | Not applicable to ordinary Internet clients |

```text
EXISTING_REQUIRED_STABLE_CLIENT_ID=NO
CALLER_SUPPLIED_AFFINITY_REQUIRES_PROTOCOL_CHANGE=YES
LEGACY_CLIENTS_WITHOUT_KEY_REMAIN_SKEWED=YES
UNIVERSAL_PRE_ROUTING_STABLE_ID_AVAILABLE=NO
UNIVERSAL_PRE_ROUTING_STABLE_ID_EXPLANATION=MCP_CLIENTINFO,_A2A_MESSAGE_IDS,_AND_X402_PAYMENT_IDENTITY_ARE_BODY_OR_POST_402_DATA_AND_ARE_UNAVAILABLE_BEFORE_EDGE_VERSION_SELECTION
```

### IP affinity

`ip.src` is the strongest broadly available key because Cloudflare has it on the
first request without client cooperation. It is not a logical-transaction
identity. A stable single egress remains stable for as long as that network path
remains unchanged, but SITEBORNE's contracts neither require nor observe a fixed
egress across MCP, A2A, or x402 sequences. Cloud agents, serverless clients,
forward proxies, mobile networks, and multi-region callers can change egress.
Conversely, carrier or enterprise NAT can bind unrelated clients to one key,
correlating canary assignment and reducing sample independence.

```text
IP_AFFINITY_SAME_EGRESS_CLIENT=STABLE_WHILE_EGRESS_REMAINS_UNCHANGED
MCP_CLIENT_MULTI_REQUEST_IP_STABILITY=UNKNOWN
A2A_CLIENT_MULTI_REQUEST_IP_STABILITY=UNKNOWN
REST_PAYMENT_RETRY_IP_STABILITY=UNKNOWN
KNOWN_MULTI_EGRESS_OR_PROXY_CLIENT_RISK=YES_ARCHITECTURAL;_NO_FIXED_EGRESS_CONTRACT
NAT_GROUPING_SECURITY_OR_CANARY_CONCERN=YES
IP_AFFINITY_ELIMINATES_ALL_RELEVANT_VERSION_SKEW=NO
```

### Caller headers, authenticated identity, and cookies

Requiring callers to send a new stable header would itself change the public
contract and would leave all legacy clients randomly split. No API key,
authenticated principal, wallet, or mTLS identity is present on every request;
mTLS is deliberately inactive. x402 identity is too late.

MCP, A2A, and REST do not require cookie persistence. A response-set cookie can
only influence a later request after the first request has already been
assigned. That allows the exact discovery-to-execution switch the gate is meant
to prevent.

```text
MCP_CLIENTS_RELIABLY_PERSIST_COOKIES=UNKNOWN
A2A_CLIENTS_RELIABLY_PERSIST_COOKIES=UNKNOWN
REST_AGENTS_RELIABLY_PERSIST_COOKIES=UNKNOWN
FIRST_REQUEST_TO_SECOND_REQUEST_VERSION_CHANGE_STILL_POSSIBLE=YES
COOKIE_AFFINITY_FULLY_SOLVES_CURRENT_SKEW=NO
APPLICATION_GENERATED_KEY_AVAILABLE_BEFORE_FIRST_VERSION_SELECTION=NO
APPLICATION_GENERATED_AFFINITY_SOLVES_CURRENT_HARD_GATE=NO
```

## Affinity sufficiency standard and controlled test design

The hard requirements are:

```text
VERSION_AFFINITY_HARD_REQUIREMENTS=ALL_NORMAL_MCP_REQUESTS,_DISCOVERY_TO_EXECUTION,_CATALOG_TO_INITIAL_402,_402_TO_RETRY,_AND_A2A_SEQUENCES_SHARE_A_KEY_AVAILABLE_BEFORE_THE_FIRST_REQUEST;_THE_KEY_REMAINS_STABLE_FOR_THE_FULL_LOGICAL_FLOW;_LEGACY_CALLERS_CANNOT_BYPASS;_CROSS_VERSION_RETRY_REMAINS_SAFE
BEST_VERSION_AFFINITY_KEY_SOURCE=ip.src_AS_BROADLY_AVAILABLE_EDGE_INPUT_BUT_INSUFFICIENT_FOR_THE_HARD_STANDARD
```

If affinity were reconsidered later, a separate rule checkpoint would have to
test, without assuming a local simulation proves edge behavior:

1. one explicit key over 100 health requests at each deployment composition;
2. complete initialize/list/call MCP sequences with one key;
3. Agent Card plus A2A SendMessage with one key;
4. catalog, initial 402, and payment-bearing retry with one key;
5. many distinct keys and observed percentage distribution;
6. monotonic key movement across 5%, 25%, and 50%;
7. version overrides and no-key legacy controls; and
8. workers.dev bypass behavior.

Only a real Cloudflare edge test under separately authorized rule and traffic
mutations can prove these routing semantics. A local hash simulation cannot.

The strongest hypothetical rule design is recorded for completeness, not as a
recommendation or authorization:

```text
TRANSFORM_RULE_MATCH_EXPRESSION=(http.host eq "utility.siteborne.net")
TRANSFORM_RULE_OPERATION=SET_DYNAMIC
TRANSFORM_RULE_HEADER=Cloudflare-Workers-Version-Key
TRANSFORM_RULE_VALUE_EXPRESSION=ip.src
```

At 100% it would not change application behavior, would not conflict with the
distinct `Cloudflare-Workers-Version-Overrides` mechanism, and would not remove
tail attribution. During a split it would make monitoring identities sticky and
would alter sample independence; monitoring would need explicit distinct keys.
The rule remains insufficient because the key is insufficient.

```text
AFFINITY_RULE_CHANGES_APPLICATION_SEMANTICS_AT_100_PERCENT=NO
AFFINITY_RULE_INTERFERES_WITH_VERSION_OVERRIDES=NO
AFFINITY_RULE_INTERFERES_WITH_OBSERVABILITY=NO_BUT_IT_CHANGES_SAMPLING_AND_MONITOR_ASSIGNMENT
VERSION_AFFINITY_FULLY_COVERS_RELEVANT_CLIENTS=NO
RESIDUAL_DISCOVERY_EXECUTION_SKEW=YES
RESIDUAL_MCP_SESSION_SKEW=YES
RESIDUAL_PRICE_SKEW_WITHIN_LOGICAL_TRANSACTION=YES
```

## Alternative strategies

### Compatibility bridge

Every bridge can make one transition compatible only by deferring some part of
the final MCP/price contract to another transition. The already-qualified
candidate therefore still needs an atomic contract change later.

| Bridge stage                                            | Tests final contract                                                                   | Atomic contract change later                                                                           | New versions                                               | Deployments                                                          | New economic governance                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| New runtime + baseline MCP + baseline prices            | No                                                                                     | Yes, final MCP and prices                                                                              | 1 additional bridge                                        | At least 5 if bridge is canaried at 5/25/50/100 then final is atomic | Yes; two separately governed public contracts                                       |
| New runtime + common MCP intersection + baseline prices | No                                                                                     | Yes, final advertised MCP behavior and prices                                                          | 1 additional bridge                                        | At least 5 on the same staged model                                  | Yes                                                                                 |
| New runtime + final MCP + baseline prices               | No; final price absent, and its MCP split is not safe against baseline legacy behavior | Yes; first transition cannot safely use the intended percentage canary and final price is still atomic | 1 additional bridge                                        | At least 2 atomic transitions                                        | Yes                                                                                 |
| Final prices after 100% new runtime                     | Yes only at the final instant                                                          | This is the deferred atomic change                                                                     | 0 if the existing `b6b7477f` is used as final; otherwise 1 | At least 1 final atomic deployment in addition to bridge deployments | Final prices are already authorized, but the extra bridge contract needs governance |

The extra immutable version, deployments, and intermediate contract add release
surface while duplicating runtime evidence already obtained through
exact-version qualification. They do not eliminate the final atomic boundary.

```text
BRIDGE_STRATEGY_ACTUALLY_REDUCES_TOTAL_RISK=NO
```

### Dedicated protected canary ingress

A dedicated hostname, Access policy, upstream router/service binding, explicit
version override, and allowlisted agents could deterministically reach the
candidate. It would create new infrastructure and a new security boundary. It
would test a synthetic/allowlisted population, not the actual random public
distribution, and would largely repeat the exact-version custom-domain
qualification already completed.

```text
DEDICATED_CANARY_CAN_TEST_ORGANIC_EQUIVALENT_TRAFFIC=NO
NEW_INFRA_REQUIRED=YES
NEW_SECURITY_BOUNDARY_REQUIRED=YES
WOULD_IT_TEST_REAL_PUBLIC_DISTRIBUTION=NO
DEDICATED_CANARY_INCREMENTAL_EVIDENCE=LOW;_MOSTLY_DUPLICATES_EXISTING_EXACT_VERSION_QUALIFICATION
```

## Atomic-cutover safety gates

An atomic public deployment removes the mixed-version state, so the legacy MCP
and price contracts cannot alternate between requests. Its blast radius is 100%,
but its rollback is one precomputed deployment and the candidate has already
passed exact-version health, readiness, Agent Card, JWKS/JWS, A2A, MCP, feature
gating, unpaid shared-payment-boundary, seller-determinism, and
settlement-ownership qualification.

```text
ATOMIC_CUTOVER_ELIMINATES_MIXED_PUBLIC_VERSION_SKEW=YES
ATOMIC_CUTOVER_PREQUALIFICATION_STRENGTH=HIGH
ATOMIC_PUBLIC_CUTOVER_WITH_OLD_PAID_SAFE=YES
ATOMIC_CUTOVER_CHANGES_PUBLIC_PRICE_CONTRACT=YES
ATOMIC_CUTOVER_CHANGES_PUBLIC_MCP_CONTRACT=YES
FINAL_PRICE_CONTRACT_ALREADY_AUTHORIZED=YES
FINAL_MCP_CONTRACT_ALREADY_QUALIFIED=YES
```

The price transition is explicit:

```text
verify_agent_output.v2: 19000 -> 17000 atomic
web_context_verified.v2: 9000 -> 8000 atomic
```

### In-flight compatibility

Both versions use the same production D1 quote repository and validate a paid
retry against the persisted server-issued requirement instead of recalculating
the current version's catalog price. Payment ownership and the dedicated
Workflow settlement owner do not change.

```text
PRE_CUTOVER_BASELINE_QUOTE_SURVIVES_ATOMIC_CUTOVER=YES
NO_PRICE_RECALCULATION_ON_EXISTING_QUOTE=YES
NO_DUPLICATE_PAYMENT_OWNERSHIP_CHANGE=YES
```

MCP is stateless: each HTTP request receives a fresh server and no MCP session
ID is exposed. A baseline-negotiated modern `2026-07-28` client keeps sending a
protocol accepted by the candidate. Legacy clients rejected by the baseline can
reconnect safely after cutover. A2A likewise constructs a fresh request handler
and in-memory task store for every POST; both versions accept the same A2A 1.0
`SendMessage` shape, and prior cross-version proof returned the same closed
`payment_required` result.

```text
EXISTING_BASELINE_MCP_SESSION_SURVIVES_ATOMIC_CUTOVER=YES
EXISTING_BASELINE_A2A_CLIENT_SURVIVES_ATOMIC_CUTOVER=YES
```

Before any paid-runtime change, the exact rollback is safe:

```text
db7054c9-76ee-4830-aabe-8a4542261b6a @ 100%
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @ 0%
PRE_PAID_RUNTIME_ATOMIC_ROLLBACK_SAFE=YES
```

After a future paid-runtime cutover, the rollback barrier is:

```text
POST_PAID_RUNTIME_ROLLBACK_ORDER=
1._PAID_RUNTIME_TO_OLD_d62011b9-6219-47e1-8cf9-5006776cfb50
2._PROVE_CANDIDATE_NEW_PUBLIC_PLUS_OLD_PAID_HEALTHY
3._ONLY_THEN_PUBLIC_TO_db7054c9-76ee-4830-aabe-8a4542261b6a_IF_NEEDED
```

## Risk matrix

| Strategy                  | Mixed skew                             | Blast radius     | New infra | New source           | Rule mutation | Deployments                | Public-contract mutations                     | Rollback                                          | Client assumptions               | Evidence                                                      | Residual unknown            |
| ------------------------- | -------------------------------------- | ---------------- | --------- | -------------------- | ------------- | -------------------------- | --------------------------------------------- | ------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- | --------------------------- |
| IP affinity               | Reduced, not eliminated                | Low per key      | No        | No                   | Yes           | 4 staged                   | Existing final contract                       | Medium; rule + deployment                         | Stable egress for all flows      | Medium                                                        | High                        |
| Strong stable-ID affinity | Could eliminate if universal           | Low per identity | Possibly  | Protocol/client work | Yes           | 4 staged                   | New affinity contract plus final              | Medium                                            | Universal pre-first stable ID    | High if deployed/proven                                       | Not feasible today          |
| Application cookie        | First-request skew remains             | Low after cookie | No        | Yes                  | Possibly      | 4 staged                   | New cookie behavior                           | Medium                                            | Reliable cookie jars             | Low-medium                                                    | High                        |
| Bridge candidate          | Safe only for an intermediate contract | Medium           | No        | Yes                  | No            | At least 2, commonly 5+    | Multiple                                      | High                                              | None                             | Medium                                                        | Final atomic change remains |
| Dedicated ingress         | None for allowlisted probes            | Isolated         | Yes       | Possibly             | Possibly      | Separate ingress lifecycle | No normal-contract proof                      | Medium-high                                       | Test clients use special ingress | High for synthetic probes                                     | Organic behavior untested   |
| Atomic 100%               | None                                   | High/100%        | No        | No                   | No            | 1                          | Final prices + MCP contract, already governed | Low before paid-runtime change; one exact restore | None                             | High from exact-version qualification + live 100% observation | Short stabilization window  |

```text
ROLLOUT_STRATEGY_RISK_MATRIX=SEE_TABLE_ABOVE
```

## Atomic release structure and stabilization

The superseding release sequence is:

1. prebuild the quiescence derivative as an unassigned immutable version;
2. rerun final exact-version candidate qualification;
3. take baseline metrics and lifecycle snapshots;
4. atomically deploy `b6b7477f` at 100% and retain `db7054c9` at 0%;
5. immediately smoke normal-routing identity, protocol, feature gates, and the
   unpaid payment boundary;
6. observe 100% candidate traffic for both 60 minutes and 1,000 attributable
   normal requests;
7. immediately restore the exact 100%/0% baseline composition on any hard
   failure;
8. only after stabilization, introduce and qualify the quiescence derivative;
9. quiesce paid admission;
10. drain; and
11. deploy the paid runtime under its separate authorization.

Prebuilding the quiescence derivative freezes the emergency artifact without
traffic impact and separates upload/config risk from the cutover window. It
cannot be runtime-qualified until it later replaces the 0% deployment member.

```text
PREBUILD_UNASSIGNED_QUIESCENCE_VERSION_BEFORE_ATOMIC_CUTOVER=YES
ATOMIC_STABILIZATION_MIN_DURATION=60_MINUTES
ATOMIC_STABILIZATION_MIN_REQUESTS=1000_CANDIDATE_ATTRIBUTABLE_NORMAL_REQUESTS
```

Both floors are required. Sixty minutes covers time-dependent behavior and
Workflow/alert observation; 1,000 requests ensures the decision is not based on
a quiet clock window. Under an idealized independent-event model, zero failures
in 1,000 requests gives an approximate 95% upper bound of 0.3% for an unseen
failure rate (the rule of three). Real traffic is correlated, so this is a
minimum evidence floor, not a statistical guarantee. Any hard functional,
economic, or settlement signal triggers rollback immediately without waiting for
either floor.

Required pass conditions are: 100% candidate attribution and 0% baseline normal
traffic; expected `/health` and `/ready`; valid Agent Card/JWKS/JWS; MCP and A2A
success; company, document, and artifact surfaces still disabled; verify and web
enabled at exactly 17000/8000; no unexpected 5xx increase; no semantic MCP
errors, price inconsistency, payment-ownership anomaly, Workflow/provider
failure, or settlement anomaly.

Cloudflare Workers observability is enabled. An operator-attached JSON tail
provides per-version attribution, request/response outcomes, and exceptions; the
atomic checkpoint's active MCP/A2A/payment-boundary probes directly inspect
semantic responses. D1 quote/audit/payment-attempt state, durable Workflow
state/logs, provider failure evidence, and the deployed settlement-alert Worker
cover the economic lifecycle. This is sufficient for a bounded, staffed atomic
window; it does not claim a general external APM or long-retention analytics
system.

```text
ATOMIC_CUTOVER_CRITICAL_OBSERVABILITY_COMPLETE=YES_FOR_BOUNDED_OPERATOR_ATTACHED_WINDOW
```

## Current lifecycle and settlement ownership

The fresh read-only D1 query returned zero writes and:

```text
CURRENT_INFLIGHT_BY_STAGE={"settled_external":1,"verified":16}
CURRENT_INFLIGHT_TOTAL=17
```

This does not block a public-only cutover while the old paid runtime remains. It
continues to block paid-runtime deployment until the separately governed
quiesce-and-drain gate passes.

Fresh `settle-sole-ownership.test.ts` passed 4/4:

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

## Mutation and economic accounting

This checkpoint performed only read-only local/Cloudflare/D1 inspection and
documentation changes.

```text
TRANSFORM_RULE_MUTATIONS=0
VERSION_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
DNS_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0
D1_WRITES=0
R2_WRITES=0
REAL_TEST_PAYMENTS=0
USEFUL_PROVIDER_EXECUTIONS=0
WORKFLOW_CREATIONS=0
REAL_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
```

## Final decision

```text
SUN1222C_PCC_CANARY_VERSION_SKEW_REMEDIATION=ATOMIC_CUTOVER_SELECTED
FEATURE_SCOPED_CANDIDATE=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
CURRENT_PUBLIC_BASELINE=db7054c9-76ee-4830-aabe-8a4542261b6a
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-QUIESCENCE-CANDIDATE-PREBUILD
```

No Transform Rule was created. No percentage canary resumed. No traffic,
deployment, version, variable, secret, route, DNS, paid-runtime, D1, R2,
payment, provider, Workflow, settlement, chain, or mTLS state was changed.
