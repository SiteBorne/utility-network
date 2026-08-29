# SUN-1221E — `web_context_verified.v2` Zero-Traffic Qualification and Real-Paid E2E

Final classification: **pre-economic qualification failure; paid E2E not
executed**.

The authorized candidate was temporarily included at 0% normal traffic and
successfully attributed at Cloudflare's edge. Its REST catalog, service-detail,
agent-card, readiness, and inactive-route boundaries were coherent. The
checkpoint then stopped at a mandatory pre-payment gate because the official MCP
client exposed contradictory live production status: its health tool still
reported both active CDP services as `production_disabled` / `not_live`.

No unpaid request was sent to the active web-context route, no 402 was minted,
no buyer account or balance was queried, and no payment material or economic
action occurred. Mandatory restoration completed before this report was written.

## 1. Evidence authority and repository state

The repository began clean at:

```text
START_HEAD=f73ae04409e60fd585211f479ad0fa2e41428996
SUN1221B_DESIGN_EVIDENCE_COMMIT_SHA=b0426d467eb23379e2264ef1fb88de3f57067d13
SUN1221C_IMPLEMENTATION_COMMIT_SHA=7b5064cbbaa8635fc6331baab9ccfae149d55b00
SUN1221D_EVIDENCE_COMMIT_SHA=f73ae04409e60fd585211f479ad0fa2e41428996
```

The omitted D SHA was recovered with:

```text
git log -1 --format=%H -- docs/reports/SUN-1221D-web-context-v2-candidate-upload.md
```

and the resulting Git object was read directly. It is substantive and records:

- candidate `2044d898-0e42-4d3a-b7c1-d080b463e91e`;
- source `7b5064cbbaa8635fc6331baab9ccfae149d55b00`;
- `verify_agent_output.v2` / CDP active;
- `web_context_verified.v2` / CDP active;
- the remaining ten paid configurations inactive;
- Nevermined inactive (`NVM_ENVIRONMENT=sandbox`, no Nevermined route flag);
- six required Worker secrets present by name;
- `CDP_WALLET_SECRET` absent from the Worker;
- candidate not deployed, production unchanged, and zero D-phase live/economic
  activity.

```text
SUN1221D_REPORT_INTEGRITY=PASS
CANDIDATE_DRIFT_SINCE_D=NO
```

Disk headroom before live work was 37 GiB.

## 2. Fresh human authorization

The immediately preceding standalone human checkpoint message explicitly
authorized all of the following as one bounded operation:

```text
candidate=2044d898-0e42-4d3a-b7c1-d080b463e91e
temporary_deployment=de70bf98-f304-4d7f-b189-4ae2401041a0@100%, candidate@0%
service=web_context_verified.v2
rail=CDP
buyer=0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
seller=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
network=eip155:8453
asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
maximum_atomic_amount=9000
maximum_aggregate_buyer_usdc_exposure_atomic=9000
paid_submissions_maximum=1
payment_signatures_maximum=1
retry_after_payment_material=PROHIBITED
mandatory_restoration=YES
```

```text
FRESH_SUN1221E_ZERO_TRAFFIC_AND_REAL_PAYMENT_AUTHORIZATION=YES
CURRENT_REAL_PAYMENT_AUTHORIZATION=CONSUMED
SECOND_REAL_PAID_ATTEMPT_AUTHORIZED=NO
```

The authorization was consumed by this qualification attempt even though the
attempt stopped before any economic step.

## 3. Authoritative pre-E Cloudflare state

Read-only Wrangler reconciliation immediately before mutation returned:

```text
CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
CURRENT_PRODUCTION_TRAFFIC=100%
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
PRE_E_PRODUCTION_PREFLIGHT=PASS
WRANGLER_VERSION=4.119.0
```

Candidate read-back returned:

```text
Version ID: 2044d898-0e42-4d3a-b7c1-d080b463e91e
Created: 2026-08-29T12:27:46.935Z
Compatibility Date: 2026-08-05
NVM_ENVIRONMENT=sandbox
PAID_ROUTES_ENABLED=true
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
```

All six required Worker secrets were present by name:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
NVM_API_KEY
PAID_RECEIPT_SIGNING_KEY_ID
PAID_RECEIPT_SIGNING_PRIVATE_KEY
```

`CDP_WALLET_SECRET` was not a Worker binding. No secret value was read or
printed.

## 4. Canonical request and frozen economics

The exact service-specific request was recovered from the committed C test:

`apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.test.ts`.

```json
{
  "target_url": "https://example.com/",
  "retrieval_mode": "direct"
}
```

```text
CANONICAL_REQUEST_PROVENANCE=apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.test.ts
CANONICAL_REAL_PAID_REQUEST_FROZEN=YES
CANONICAL_WEB_CONTEXT_V2_MODE=direct
CANONICAL_WEB_CONTEXT_V2_TARGET_URL=https://example.com/
CANONICAL_WEB_CONTEXT_V2_REQUEST_BODY={"target_url":"https://example.com/","retrieval_mode":"direct"}
```

The independent service contract recovered from B/C was:

```text
amount=9000
network=eip155:8453
asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
payTo=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
scheme=exact
extra.name=USD Coin
extra.version=2
```

This was not copied from `verify_agent_output.v2`, whose distinct frozen price
remains 19000 atomic USDC.

## 5. Offline request and security validation

Focused credential-stripped tests covered the real composition, route,
multi-service discovery, DNS-rebinding prevention, and SSRF policy. The first
run produced 75 passing assertions; the remaining three Miniflare assertions
could not start because the execution sandbox denied a local `127.0.0.1`
listener (`listen EPERM`). Rerunning that exact file with local-socket
permission produced 3/3 PASS. No application assertion failed.

```text
FOCUSED_SECURITY_DISCOVERY_TESTS=78/78 PASS
REQUEST_SCHEMA_VALID=YES
REQUEST_MODE_VALID=YES
TARGET_SCHEME_ALLOWED=YES
TARGET_CREDENTIAL_FREE=YES
TARGET_LITERAL_PRIVATE_ADDRESS=NO
DNS_REBINDING_SAFE_CONNECTION_PATH_SELECTED=YES
REDIRECT_POLICY_ACTIVE=YES
TIMEOUT_BOUND_ACTIVE=YES
RESPONSE_SIZE_BOUND_ACTIVE=YES
```

The committed `resolveSafeAddress` policy was also executed against the frozen
target's live DNS. It returned only public addresses:

```text
104.20.23.154
172.66.147.243
2606:4700:10::ac42:93f3
2606:4700:10::6814:179a
```

with `safe=true`, zero prohibited answers, and selected address `104.20.23.154`.

```text
TARGET_RESOLVED_DESTINATIONS_ALLOWED=YES
```

## 6. E-owned observability

One fresh `wrangler tail siteborne-utility-edge --format json` process was
started before the deployment mutation. The E-owned unified execution session
was `88688`. It captured request Ray IDs, paths, HTTP statuses,
`scriptVersion.id`, outcome, CPU/wall time, exceptions, and Worker logs.

Observed candidate requests had `outcome=ok` and `exceptions=[]`. Only this
E-owned session was interrupted after restoration; no global process cleanup was
performed.

```text
SUN1221E_OWN_TAIL_STOPPED=YES
BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED=NO
```

## 7. Exact temporary 100/0 deployment

Wrangler created the authorized two-version deployment once:

```text
de70bf98-f304-4d7f-b189-4ae2401041a0 100%
2044d898-0e42-4d3a-b7c1-d080b463e91e   0%
```

The immediate authoritative read-back returned exactly those two versions and
percentages, with no third version.

```text
ACTIVE_DEPLOYMENT_VERSION_COUNT=2
CURRENT_PRODUCTION_TRAFFIC=100%
CANDIDATE_TRAFFIC=0%
MAX_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
SUN1221E_100_0_DEPLOYMENT=PASS
```

## 8. Routing and candidate attribution

Ordinary requests, with no version override:

| Request        | HTTP | Ray                | `scriptVersion.id`                     |
| -------------- | ---: | ------------------ | -------------------------------------- |
| `GET /health`  |  200 | `a32ba2e9596b6970` | `de70bf98-f304-4d7f-b189-4ae2401041a0` |
| `GET /catalog` |  200 | `a32ba31b4f03bd3b` | `de70bf98-f304-4d7f-b189-4ae2401041a0` |

The exact structured-field override:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="2044d898-0e42-4d3a-b7c1-d080b463e91e"
```

sent to `GET /health` returned HTTP 200, Ray `a32ba358fb32ed82`, and tail
attribution:

```text
scriptVersion.id=2044d898-0e42-4d3a-b7c1-d080b463e91e
outcome=ok
exceptions=[]
```

```text
ORDINARY_ROUTING_FIRST_SERVICE_PRODUCTION_CONTROL=PASS
SUN1221E_CANDIDATE_ATTRIBUTION=PASS
```

## 9. Candidate discovery and inactive-route isolation

Candidate-overridden REST discovery returned:

- `/catalog`: exactly `verify_agent_output.v2` and `web_context_verified.v2`
  were production-active; the other six canonical service IDs were
  preproduction;
- `/services/verify_agent_output.v2`: production active, `$0.019`;
- `/services/web_context_verified.v2`: production active, `$0.009`;
- `/.well-known/agent-card.json`: both v2 services active, the remaining six
  canonical service IDs inactive;
- `/ready`: HTTP 200, `production_services_enabled=true`, while preserving the
  platform-wide `status=not_ready` and frozen external blockers.

```text
LIVE_TWO_SERVICE_CATALOG_TRUTHFUL=YES
LIVE_VERIFY_SERVICE_DETAIL_TRUTHFUL=YES
LIVE_WEB_CONTEXT_SERVICE_DETAIL_TRUTHFUL=YES
LIVE_AGENT_CARD_TRUTHFUL=YES
LIVE_READY_TRUTHFUL=YES
VERIFY_AGENT_OUTPUT_V2_DISCOVERY_REGRESSION=NO
VERIFY_AGENT_OUTPUT_V2_ECONOMICS_REGRESSION=NO
```

Ten candidate-overridden, payment-free route-isolation POSTs returned 404:

```text
/v1/company/evidence-graph
/v1/web/context
/v1/document/evidence-json
/v1/verify/agent-output
/v2/company/evidence-graph
/v2/document/evidence-json
/v2/nevermined/company/evidence-graph
/v2/nevermined/web/context
/v2/nevermined/document/evidence-json
/v2/nevermined/verify/agent-output
```

```text
REMAINING_10_PAID_SERVICES_RUNTIME_ACTIVE=NO
REMAINING_10_PAID_SERVICES_DISCOVERY_ACTIVE=NO
NEVERMINED_RUNTIME_ACTIVE=NO
NEVERMINED_DISCOVERY_ACTIVE=NO
```

## 10. Mandatory MCP contradiction and pre-economic stop

Raw MCP probes first established two transport facts without invoking a tool:

- the `workers.dev` hostname is intentionally rejected by the MCP host policy;
- hand-written JSON-RPC negotiation is not release authority for this modern
  protocol boundary.

The repository's official MCP client was then used against
`https://utility.siteborne.net/mcp`, with the exact candidate version override.
Initialization succeeded, six governed tools were listed, and only the
non-economic `siteborne_get_service_health` tool was called.

The live response was:

```json
{
  "production_ready": false,
  "production_enabled": false,
  "services": {
    "company_evidence_graph.v2": {
      "implementation": "local_fixture_verified",
      "production": "production_disabled",
      "external": "not_live"
    },
    "web_context_verified.v2": {
      "implementation": "local_fixture_verified",
      "production": "production_disabled",
      "external": "not_live"
    },
    "document_evidence_json.v2": {
      "implementation": "local_fixture_verified",
      "production": "production_disabled",
      "external": "not_live"
    },
    "verify_agent_output.v2": {
      "implementation": "local_fixture_verified",
      "production": "production_disabled",
      "external": "not_live"
    }
  }
}
```

This is a material discovery contradiction: the same immutable candidate's REST
catalog, service-detail routes, agent card, readiness resolver, and route gates
all showed `verify_agent_output.v2` and `web_context_verified.v2` active, while
the public MCP health surface described both as disabled/not live and still
labeled their implementation `local_fixture_verified`.

```text
MCP_DISCOVERY_RUNTIME_CONTRADICTION=YES
SUN1221E_ZERO_TRAFFIC_QUALIFICATION=FAIL
```

Section 10 of the authorization required
`MCP_DISCOVERY_RUNTIME_CONTRADICTION=NO` before any live 402 or economic action.
The checkpoint therefore stopped immediately and restored production.

## 11. No 402, signing, payment, or economic activity

Because the MCP gate failed before section 13:

```text
WEB_CONTEXT_V2_UNPAID_POST_COUNT=0
WEB_CONTEXT_V2_UNPAID_HTTP_STATUS=NOT_EXECUTED
WEB_CONTEXT_V2_FRESH_402_CONTRACT_MATCH=NO (not obtained)
FRESH_402_AMOUNT_ATOMIC=NOT_OBSERVED
FRESH_402_NETWORK=NOT_OBSERVED
FRESH_402_ASSET=NOT_OBSERVED
FRESH_402_PAYTO=NOT_OBSERVED
BUYER_FOUND=NOT_CHECKED
BUYER_USDC_BALANCE_ATOMIC=NOT_READ
CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER=NOT_REEVALUATED
REAL_PAYMENT_SIGNING_ELIGIBLE=NO
SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_PAYLOADS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
REAL_PAID_REQUEST_SUBMISSIONS=0
PAID_SUBMISSION_OUTCOME=NOT_EXECUTED
SETTLEMENTS=0
TRANSACTIONS=0
ONCHAIN_TRANSACTION_HASH=
ONCHAIN_TRANSACTION_STATUS=NOT_FOUND (no transaction was created)
FACILITATOR_SETTLEMENT_STATUS=NOT_EXECUTED
D1_PAYMENT_ATTEMPT_COUNT_FOR_THIS_PAYMENT=0
D1_SETTLEMENT_COUNT_FOR_THIS_PAYMENT=0
WEB_CONTEXT_SERVICE_RESULT_COUNT=0
RECEIPT_COUNT=0
DUPLICATE_SETTLEMENT_DETECTED=NO
```

No real executor conclusion can be drawn from a payment that did not happen:

```text
REAL_WEB_CONTEXT_EXECUTOR_INVOKED=UNPROVEN
PRODUCTION_FIXTURE_EXECUTOR_INVOKED=NO
PRODUCTION_SYNTHETIC_EXECUTOR_INVOKED=NO
FETCH_TARGET_MATCHED_CANONICAL_TARGET=UNPROVEN
PCC_OUTPUT_VALID=UNPROVEN
RESULT_PERSISTED=UNPROVEN
RECEIPT_VALID=UNPROVEN
BUYER_USDC_ECONOMIC_EFFECT_ATOMIC=0
BUYER_NATIVE_TOKEN_ECONOMIC_EFFECT=0
```

The fixture/synthetic statements are bounded to this checkpoint's observed
activity: neither path executed because no active-service POST was made.

## 12. Mandatory restoration and final containment

Restoration was executed immediately after the MCP contradiction, before any
extended investigation or report writing:

```text
de70bf98-f304-4d7f-b189-4ae2401041a0 100%
```

Authoritative read-back:

```text
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
SUN1221E_RESTORATION=PASS
```

Post-restoration checks returned:

- `/health`: HTTP 200;
- `/ready`: HTTP 200 and the established platform-wide not-ready narrative;
- `/catalog`: only `verify_agent_output.v2` production-active;
- `POST /v2/web/context` without payment material: HTTP 404;
- `GET https://utility.siteborne.net/mcp`: HTTP 405;
- `pnpm production:preflight`: PASS.

```text
POST_E_FIRST_SERVICE_HEALTH=PASS
POST_E_WEB_CONTEXT_PRODUCTION_ACTIVE=NO
POST_E_PRODUCTION_PREFLIGHT=PASS
```

## 13. Hard counters and final gate

The required `pnpm secrets:scan` command ran after report generation. Its
scope-verification phase passed (1,135 tracked files, eight required classes,
nine redacted detector probes). Gitleaks then returned the already-recorded
historical false positive in commit `322852a78e032f3d06a43ead8102517af2cdecdf`,
`docs/reports/SUN-1220O-first-real-paid-e2e.md:159`: the public Base USDC
contract address labeled `BASESCAN_TOKEN_CONTRACT`. This is the identical
pre-existing heuristic match documented by SUN-1220P2, P5, Q1, Q2, Q3, Q4, Q5,
and Q6; it predates this checkpoint and is not credential material.

A separate redacted scan of the complete new SUN-1221E report returned
`no leaks found`.

```text
PNPM_SECRETS_SCAN_SCOPE=PASS
PNPM_SECRETS_SCAN_COMMAND=NONZERO_PREEXISTING_PUBLIC_CONTRACT_FALSE_POSITIVE
NEW_SECRET_FINDINGS=0
SUN1221E_REPORT_SECRET_FINDINGS=0
```

```text
TEMPORARY_100_0_DEPLOYMENT_MUTATIONS=1
RESTORATION_DEPLOYMENT_MUTATIONS=1
WORKER_VERSIONS_CREATED=0
MAX_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0

WEB_CONTEXT_V2_UNPAID_POST_COUNT=0
SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_PAYLOADS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
REAL_PAID_REQUEST_SUBMISSIONS=0
MAX_REAL_PAID_REQUEST_SUBMISSIONS=1
MAX_AUTHORIZED_TRANSFER_ATOMIC=9000
SETTLEMENTS=0
TRANSACTIONS=0
D1_WRITES_BY_RELEASE_AGENT_DIRECTLY=0

SUN1221E_ZERO_TRAFFIC_QUALIFICATION=FAIL
SUN1221E_REAL_PAID_E2E=NOT_EXECUTED
SUN1221F_PUBLIC_CANARY_ELIGIBLE=NO
```

The smallest exact next gap is repository-owned: make MCP production-health and
service availability derive from the same governed effective discovery resolvers
already used by REST catalog/service-detail/agent-card/readiness, then repeat
the zero-traffic qualification under a new explicit payment authorization. This
report does not authorize that change or another paid attempt.
