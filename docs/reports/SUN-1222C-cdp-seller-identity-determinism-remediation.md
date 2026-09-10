# SUN-1222C — CDP Seller-Identity Determinism Remediation

Date: 2026-09-10

Start evidence commit: `1bf1de791e255f8d1105d5d5755b97299534796d`

Scope: source, deterministic local tests, dry-run verification, and evidence
only

## Decision

`SELECTED_REMEDIATION_MODEL=A` — normal pre-402 request handling now uses the
governed `SELLER_WALLET_ADDRESS` directly after strict, deterministic local EVM
address validation. It performs zero authenticated CDP account requests, zero
analytics requests, and zero automatic retries before producing an unpaid 402.

This does not change the receiving address or weaken payment verification or
settlement. All four production composition builders already sourced `payTo`
directly from `env.SELLER_WALLET_ADDRESS`; the removed lookup did not return
data used by the payment requirement. It only asserted that the configured
address was visible as an account under the authenticated CDP project. CDP
facilitator authentication for later payment verification and settlement is a
separate operation and is unchanged.

The authenticated seller-membership equality assertion remains available as the
transport-neutral `buildCdpSellerAddressLookup` qualification helper. It is no
longer wired into an anonymous request path and has no SDK-backed factory. Any
future live invocation requires a separately authorized qualification with a
reviewed deterministic transport. Thus:

```text
SELLER_IDENTITY_INVARIANT_LOCATION_POST_FIX=runtime payTo authority and syntax/checksum: resolveGovernedSellerAddress; optional authenticated CDP membership: separately authorized buildCdpSellerAddressLookup qualification helper
PRODUCTION_PREFLIGHT_CHANGE_REQUIRED=NO
```

The authenticated membership check is useful qualification evidence, but it is
not required for payTo construction, payment security, or settlement. The
existing production preflight confirms the committed seller variable is present
and CDP credential names exist; it does not make an authenticated account
request. No live request was authorized or performed here.

## Blocker chronology and installed dependency authority

The prior exact-candidate qualification stopped safely before MCP or artifact
requests because the immutable candidate's pre-402 seller path invoked
`@coinbase/cdp-sdk` 1.55.0. Installed source proves:

- `src/client/evm/evm.ts` `getAccount()` calls
  `Analytics.trackAction({action: "get_account"})`, then delegates to
  `_getAccountInternal()`, and calls `Analytics.trackError(...)` on qualifying
  failures.
- `_getAccountInternal()` calls `CdpOpenApiClient.getEvmAccount(address)`.
- `src/openapi-client/generated/evm-accounts/evm-accounts.ts` implements that as
  `GET /v2/evm/accounts/{address}`.
- `src/openapi-client/cdpApiClient.ts` installs `axiosRetry` with only an
  exponential delay override. Installed `axios-retry` 4.5.0 therefore retains
  its default `retries: 3` and its network-or-idempotent-request retry
  predicate. One application lookup can make four authenticated GET attempts.
- `src/analytics.ts` sends events to the Coinbase analytics `/amp` endpoint.
  `DISABLE_CDP_USAGE_TRACKING=true` suppresses non-error action events only;
  `DISABLE_CDP_ERROR_REPORTING=true` independently suppresses error events.
  Consequently, usage tracking alone does not reliably suppress every analytics
  request across success and failure outcomes.

The current Coinbase documentation independently confirms that Secret API keys
authenticate server-to-server REST requests using a Bearer JWT, while a Wallet
Secret is additionally required for sensitive wallet write/signing operations;
the account lookup itself is a read. See
[CDP API authentication](https://docs.cdp.coinbase.com/api-reference/v2/authentication)
and
[Create and manage wallets](https://docs.cdp.coinbase.com/server-wallets/v2/using-the-wallet-api/managing-accounts).

```text
CDP_SDK_VERSION=1.55.0
AXIOS_RETRY_VERSION=4.5.0
GET_ACCOUNT_IMPLEMENTATION=@coinbase/cdp-sdk/src/client/evm/evm.ts getAccount -> _getAccountInternal -> CdpOpenApiClient.getEvmAccount -> generated GET /v2/evm/accounts/{address}
ANALYTICS_CALLSITE=@coinbase/cdp-sdk/src/client/evm/evm.ts getAccount -> Analytics.trackAction/trackError; src/analytics.ts sendEvent -> POST /amp
RETRY_CONFIGURATION_CALLSITE=@coinbase/cdp-sdk/src/openapi-client/cdpApiClient.ts configure -> axiosRetry(axiosInstance,{retryDelay:exponentialDelay}); axios-retry 4.5.0 DEFAULT_OPTIONS.retries=3
DISABLE_CDP_USAGE_TRACKING_IMPLEMENTATION=src/analytics.ts sendEvent returns only for non-error events when exact process.env value is true
DISABLE_CDP_ERROR_REPORTING_IMPLEMENTATION=src/analytics.ts trackError/sendEvent return for error events when exact process.env value is true
USAGE_TRACKING_FLAG_ALONE_RELIABLY_SUPPRESSES_ANALYTICS=NO
ERROR_REPORTING_FLAG_REQUIRED_TOO=YES
PRE_FIX_AUTHENTICATED_CDP_GET_ATTEMPTS_MAX=4
PRE_FIX_ANALYTICS_POST_POSSIBLE=YES
AUTOMATIC_RETRY_LAYER_PRESENT=YES
```

No environment flag is the primary fix. The request path no longer imports the
general CDP SDK client at all, so neither telemetry opt-out nor retry mutation
is required. Global CDP usage/error telemetry policy is not established by
current governance and remains `UNDECIDED`.

## Seller authority and purpose trace

`wrangler.toml` freezes the public ordinary var
`SELLER_WALLET_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`. Release
reports consistently classify it as the payment quote/receiver and required
governed public configuration. Every production composition assigns
`payTo: env.SELLER_WALLET_ADDRESS`; none consumed the account lookup response.

Before this remediation, the lookup validated a 40-hex-character syntax regex
and then compared the configured and returned addresses case-insensitively. It
did not validate an EIP-55 mixed-case checksum. `resolveGovernedSellerAddress`
now uses `viem.isAddress(..., {strict: true})`: malformed or invalid mixed-case
checksums fail closed before facilitator construction, while the exact frozen
address bytes are retained.

```text
SELLER_LOOKUP_PURPOSE=A
SELLER_LOOKUP_REQUIRED_FOR_PAYTO_CONSTRUCTION=NO
SELLER_LOOKUP_REQUIRED_BEFORE_RETURNING_402=NO
SELLER_LOOKUP_REQUIRED_FOR_PAYMENT_SECURITY=NO
SELLER_LOOKUP_REQUIRED_FOR_SETTLEMENT=NO
SELLER_WALLET_ADDRESS_AUTHORITY=CONFIGURED_CANONICAL_PAYTO
EVM_ADDRESS_SYNTAX_VALIDATED_PRE_FIX=YES
ADDRESS_CHECKSUM_VALIDATED_PRE_FIX=NO
EVM_ADDRESS_SYNTAX_VALIDATED_POST_FIX=YES
ADDRESS_CHECKSUM_VALIDATED_POST_FIX=YES
PRODUCTION_PREFLIGHT_ALREADY_VALIDATES_SELLER_IDENTITY=NO
DEPLOYMENT_GOVERNANCE_ALREADY_FREEZES_SELLER_ADDRESS=YES
PRE_FIX_GOVERNED_SELLER_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
POST_FIX_GOVERNED_SELLER_ADDRESS=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
SELLER_ADDRESS_CHANGED=NO
```

## Model comparison

| Model                                  | Security                                                                        | Determinism                         | Latency          | Failure surface                                | Coupling | Testability | Authentication correctness                                                 | Production compatibility          | Public contract               | Migration risk |
| -------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- | ---------------- | ---------------------------------------------- | -------- | ----------- | -------------------------------------------------------------------------- | --------------------------------- | ----------------------------- | -------------- |
| A — governed config, no request lookup | Strong: strict local validation and frozen receiver; facilitator auth unchanged | Exact: 0 calls                      | None             | Smallest                                       | Lowest   | Excellent   | No redundant credential probe; actual facilitator calls still authenticate | Native Worker-safe                | Unchanged                     | Low            |
| B — cold-isolate verification          | Adds membership evidence but creates isolate lifecycle/readiness state          | Conditional and isolate-dependent   | Cold-start       | Cache/state/expiry                             | Medium   | Moderate    | Correct only after explicit deterministic transport exists                 | Worker lifecycle complexity       | Potential availability change | Medium-high    |
| C — direct GET per composition         | Preserves per-request membership proof                                          | At most one if hand-built correctly | One external RTT | CDP/auth/timeout/parse on every unpaid request | Medium   | Good        | Can be correct with installed auth helper                                  | Worker-compatible but unnecessary | Availability/latency change   | Medium         |
| D — patch/wrap `CdpClient`             | Same membership proof                                                           | Fragile against SDK internals/env   | One or more RTTs | Hidden analytics/retry behavior                | Highest  | Poorer      | Delegated to SDK                                                           | Version-sensitive                 | Availability/latency change   | High           |

Model A is the only model that removes an unrelated external dependency from the
unpaid public contract while preserving every actual economic invariant.

## RED, GREEN, and mutation evidence

The focused test was added before the production edit. Against the inherited
implementation it failed with the instrumented legacy hook reporting one
analytics POST and four authenticated GET attempts where zero were expected.
After removing the hook from provider selection and all four compositions, the
same test passed.

The final focused file has 16 tests covering the governed address, missing/
malformed/bad-checksum failure, exact payTo retention, zero global fetch,
429/500/timeout/connection/parse outcomes, malformed/mismatched legacy results,
no signing/transaction/facilitator/Workflow/settlement activity, and structural
four-service equivalence.

Six reversible mutations were introduced one at a time and restored:

1. bypass strict address validation — caught by malformed/checksum controls;
2. reintroduce one authenticated lookup — caught by zero-network control;
3. invoke the lookup twice (retry regression) — caught by zero-network control;
4. emit an analytics POST — caught by the global fetch spy;
5. drift one service's `payTo` — caught by four-service source integrity;
6. reimport the high-level `CdpClient` — caught by the SDK-exclusion guard.

```text
PRE_FIX_TEST_RESULT=RED
POST_FIX_TEST_RESULT=GREEN
MUTATIONS_INTRODUCED=6
MUTATIONS_CAUGHT=6
MUTATION_PROOF=PASS
POST_FIX_PRE_402_AUTHENTICATED_CDP_NETWORK_CALLS_MAX=0
POST_FIX_PRE_402_ANALYTICS_REQUESTS=0
POST_FIX_PRE_402_AUTOMATIC_RETRIES=0
PRE_402_PAYMENT_VERIFY_CALLS=0
PRE_402_PROVIDER_EXECUTIONS=0
PRE_402_WORKFLOW_CREATIONS=0
PRE_402_SETTLEMENTS=0
```

## Shared path and economic non-change

All four production builders call the same
`resolveProductionCdpEvidenceProvider`, contain no `CdpClient`,
`buildCdpSellerAddressLookup`, or `.evm.getAccount` request-path use, and retain
their exact `payTo: env.SELLER_WALLET_ADDRESS` assignment. MCP delegates to the
same REST-owned route handlers through `createMcpX402ServiceBoundary`; no second
seller resolver was added.

Targeted evidence: 17 files, 139 passing tests, 3 pre-existing skips. This
included seller/provider gates, four composition suites, direct REST routes, MCP
route and four-service acceptance, and `settle-sole-ownership.test.ts`. The MCP
suite's existing diagnostic about a test-double PCC fidelity gap was unchanged
and non-failing.

```text
REST_USES_DETERMINISTIC_SELLER_PATH=YES
MCP_USES_SAME_DETERMINISTIC_SELLER_PATH=YES
SELLER_RESOLUTION_IMPLEMENTATIONS_COUNT=1
FOUR_SERVICE_SELLER_PATH_EQUIVALENCE=PASS
PAYMENT_REQUIREMENT_SCHEMA_CHANGED=NO
PAYTO_CHANGED=NO
PRICE_CHANGED=NO
NETWORK_CHANGED=NO
PAYMENT_ENVIRONMENT_CHANGED=NO
FACILITATOR_CHANGED=NO
PAYMENT_VERIFY_LOGIC_CHANGED=NO
SETTLEMENT_LOGIC_CHANGED=NO
PCC_RESULT_LOGIC_CHANGED=NO
MCP_PAYMENT_WIRE_CHANGED=NO
PCC_WIRE_RESULT_CHANGED=NO
MTLS_PRODUCTION_ACTIVE_BEHAVIOR_CHANGED=NO
AGENT_CARD_SECURITY_DECLARATION_CHANGED=NO
ARTIFACT_HOUSEKEEPING_SOURCE_CHANGED=NO
```

## Release and future candidate disposition

Every release gate required by this checkpoint passed. The full Vitest suite
reported 255 passing files and 3,120 passing tests, with 22 files and 78 tests
explicitly skipped. The three Wrangler 4.119.0 commands used `--dry-run`, wrote
only to isolated temporary directories, and exited before upload; the temporary
directories were then moved to Trash. No command in this checkpoint uploads or
deploys a Worker.

The first repository secret scan exposed three existing false positives in
historical evidence: one public Cloudflare Worker Version ID repeated in two
reports and one content-addressed R2 fixture key. Following the repository's
existing exact-literal policy, `.gitleaks.toml` now allows only those two proven
public values. A repeat scan covered all 775 commits plus the working tree with
the default rules enabled and reported no leaks. This is scanner hygiene, not a
runtime or credential change.

An additional `pnpm check` attempt stopped at its first step because the global
formatter reports 249 pre-existing tracked files outside this remediation as
unformatted. The initially larger count also included an ignored nested
`.claude/worktrees` checkout, which `.prettierignore` now excludes. Reformatting
the remaining historical corpus would be an unrelated change and was not done.
All files changed by this checkpoint pass their applicable Prettier check. This
inherited aggregate-format debt does not alter the individual required gate
results below.

```text
TARGETED_TESTS=PASS (139 passed, 3 pre-existing skipped)
DETERMINISTIC_FAILURES=0
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
FULL_TEST_SUITE=PASS (255 files passed, 3120 tests passed, 22 files/78 tests skipped)
X402_PROTOCOL_CHECK=PASS
MCP_PROTOCOL_CHECK=PASS
A2A_PROTOCOL_CHECK=PASS
PRODUCTION_PREFLIGHT=PASS
PUBLIC_API_WRANGLER_DRY_RUN=PASS
PAID_RUNTIME_WRANGLER_DRY_RUN=PASS
ALERT_WORKER_WRANGLER_DRY_RUN=PASS
NEW_SECRET_FINDINGS=0
CHANGED_FILE_FORMAT_CHECK=PASS
AGGREGATE_PNPM_CHECK=BLOCKED_BY_249_PRE_EXISTING_FORMAT_FINDINGS
```

Source changed, so immutable candidate `d155c9a1-ca3a-49f9-92a3-b35760dc58e6`
remains retained but cannot represent the remediated HEAD. A new immutable
public candidate is required under a separate authorization. No Worker ordinary
variables change.

```text
ENV_FLAG_REQUIRED=NO
PUBLIC_CANDIDATE_VAR_SET_WOULD_CHANGE=NO
NEW_REQUIRED_PUBLIC_VARS=NONE
FUTURE_CANDIDATE_VAR_DELTA_FROM_D155=NONE
GLOBAL_CDP_USAGE_TRACKING_CURRENTLY_DESIRED=UNDECIDED
GLOBAL_CDP_ERROR_REPORTING_CURRENTLY_DESIRED=UNDECIDED
EXISTING_D155_STATUS=SUPERSEDED_PENDING_REMEDIATED_CANDIDATE
D155_IMMUTABLE_VERSION_RETAINED=YES
NEW_IMMUTABLE_PUBLIC_CANDIDATE_REQUIRED=YES
REMEDIATION_MAKES_BOUNDED_RUNTIME_PROBE_DETERMINISTIC=YES
```

## Production and economic accounting

Only local source, tests, documentation, generated local build output, and
validation configuration were touched. There were no Cloudflare mutations, live
authenticated CDP calls, production state writes, payment actions, provider
executions, or settlement actions.

```text
PRODUCTION_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENT_MUTATIONS=0
DEPLOYMENT_MEMBERSHIP_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
D1_WRITES=0
R2_WRITES=0
QUEUE_WRITES=0
PAID_RUNTIME_DEPLOYMENTS=0
LIVE_CDP_ACCOUNT_LOOKUPS=0
LIVE_CDP_ANALYTICS_POSTS=0
REAL_TEST_PAYMENTS=0
PAYMENT_VERIFY_CALLS=0
REAL_PROVIDER_EXECUTIONS=0
WORKFLOW_CREATIONS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```
