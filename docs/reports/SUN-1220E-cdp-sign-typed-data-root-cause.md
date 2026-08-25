# SUN-1220E — CDP `signTypedData` failure: read-only root-cause investigation

Date: 2026-08-24/25
Classification: read-only source/SDK investigation; zero live CDP calls; zero
Worker versions; zero deployments; zero funding; zero signing of any kind.

## Decision

```
ROOT_CAUSE_PROVEN = YES
SECOND_LIVE_SIGN_ATTEMPT_REQUIRED_TO_DISAMBIGUATE = NO
```

The SUN-1220D live failure is fully explained by a **local, deterministic,
pre-network SDK validation error**: the production CDP client is
constructed without a `walletSecret`/`CDP_WALLET_SECRET`, and the installed
`@coinbase/cdp-sdk`'s own auth layer unconditionally requires that secret for
`POST /v2/evm/accounts/{address}/sign/typed-data` — the exact endpoint
`ServerAccount.signTypedData(...)` calls. This is proven entirely by reading
the installed SDK's own source; no additional live signing call was needed
or performed to reach this conclusion.

## Scope discipline

No live CDP call, no Worker version, no deployment, no traffic shift, and no
credential/permission/payload change occurred during this investigation.

```
WORKER_VERSIONS_CREATED_DURING_ROOT_CAUSE_ANALYSIS = 0
DEPLOYMENTS_DURING_ROOT_CAUSE_ANALYSIS             = 0
LIVE_CDP_CALLS                                     = 0
LIVE_SIGN_TYPED_DATA_CALLS                         = 0
NON_ECONOMIC_DIAGNOSTIC_SIGNATURES_CREATED         = 0
PAYMENT_SIGNATURES_CREATED                         = 0
BUYER_FUNDING_ACTIONS                              = 0
LIVE_PAID_REQUESTS                                 = 0
SETTLEMENTS                                        = 0
TRANSACTIONS                                       = 0
REAL_ECONOMIC_EFFECTS                              = 0
```

## §8 — Exact signing data-flow trace

Read directly from the SUN-1220D diagnostic source, preserved in git history
at `4c9e6ccac7e0166fbde961b81b6c8daf405a25c7` (surgically removed from
`HEAD` by `d4f759210d722eb2dc2e15dbce0ae8b1b5a0f6ce`, but still readable via
`git show 4c9e6ccac7e0166fbde961b81b6c8daf405a25c7:apps/edge-api/src/control-plane/routes/production-cdp-buyer-signer-capability-diagnostic-route.ts`),
and from the installed `@coinbase/cdp-sdk@1.55.0` / `@x402/evm@2.21.0`
packages under `node_modules/.pnpm/`:

```
SIGNING_PIPELINE_STAGES =
  1. cdpBuyerSignerCapabilityDiagnosticRoute (route handler)
  2. buildProductionCdpAccountLookupClientFactory(...)  [apps/edge-api/src/control-plane/config/production-payment.ts:253]
       -> returns closure: () => new CdpClient({ apiKeyId, apiKeySecret })  -- NO walletSecret passed
  3. client.evm.getAccount({ address: CONTROLLED_BUYER_ADDRESS })  -- GET, succeeds (buyer_found=true, account_kind=server_account)
  4. account.signTypedData({ domain, types, primaryType, message })  -- called DIRECTLY, not via fromCdpEvmAccount(...)
  5. @coinbase/cdp-sdk toEvmServerAccount.ts's signTypedData closure
       -> apiClient.signEvmTypedData(address, { domain, types, primaryType, message })
  6. openapi-client generated signEvmTypedData(...)
       -> POST /v2/evm/accounts/{address}/sign/typed-data
  7. cdpApiClient's axios request interceptor -> auth/hooks/axios/withAuth.ts -> auth/utils/http.ts getAuthHeaders(...)
  8. getAuthHeaders(...): hasCredentials=true (apiKeyId+apiKeySecret present) -> issues bearer JWT
       -> requiresWalletAuth("POST", "/v2/evm/accounts/{address}/sign/typed-data") = TRUE (matches /\/(evm|solana)\/accounts/ + POST)
       -> options.walletSecret is undefined -> THROWS UserInputValidationError BEFORE any HTTP request is sent
```

`OFFICIAL_SIGNER_ADAPTER_EXECUTION_PROVEN` (from the SUN-1220D report) was
correctly marked `NO` because the route called `account.signTypedData(...)`
directly rather than literally constructing
`fromCdpEvmAccount(account).signTypedData(...)`. This investigation traced
`fromCdpEvmAccount` (`@coinbase/cdp-sdk`'s `src/x402/account-signers.ts:28`)
and the `toClientEvmSigner` it delegates to (`@x402/evm`'s `dist/cjs/index.js`,
`src/signer.ts`):

```js
function toClientEvmSigner(signer, publicClient) {
  ...
  signTypedData: (msg) => signer.signTypedData(msg)
  ...
}
```

`toClientEvmSigner` is a **pure pass-through wrapper** — its `signTypedData`
does nothing but forward to the exact same `signer.signTypedData(msg)` the
diagnostic called directly. `fromCdpEvmAccount(account).signTypedData(msg)`
and `account.signTypedData(msg)` are therefore behaviorally identical calls
into stage 5 above; the adapter's absence changes nothing about why this
attempt failed. Stage 4 is confirmed to have been reached and to have
initiated stage 5–8 before throwing (the tail telemetry showed 73ms CPU /
155ms wall time and `outcome=ok` — consistent with local JWT generation work
happening before the thrown error, not an instant no-op).

## §9 — Signing argument shape vs. SDK expectations

```
SIGN_TYPED_DATA_ARGUMENTS_SDK_VALID = UNPROVEN (never reached)
```

The failure occurs in `getAuthHeaders(...)` — a pure local header-construction
step that runs **before** the request body (the typed-data payload) is
attached to the outgoing HTTP call at all (stage 8 throws before stage 6's
`data: eIP712Message` is ever transmitted). The domain/types/primaryType/
message shape was therefore never evaluated by the SDK's request-building
logic, by any CDP server-side validator, or by any network round-trip.
Whether the fixed SUN-1220D payload (`domain.name`, `version`, `chainId:
8453`, no `verifyingContract`, `bytes32` nonce, etc.) would be accepted is
simply untested — the call never got that far.

## §10 — SDK validation and error paths

Read directly from `@coinbase/cdp-sdk`'s `src/auth/utils/http.ts`
(`getAuthHeaders`):

```
SIGNING_CAN_FAIL_BEFORE_NETWORK = YES

LOCAL_VALIDATION_FAILURE_CLASSES =
  - missing apiKeyId/apiKeySecret on a non-public operation
    -> UserInputValidationError("Missing required CDP API Key configuration...")
  - missing walletSecret on an operation matched by requiresWalletAuth(method, path)
    -> UserInputValidationError("Wallet Secret not configured. Please set the
       CDP_WALLET_SECRET environment variable, or pass it as an option to the
       CdpClient constructor.")  <-- THIS IS THE OBSERVED FAILURE CLASS

REMOTE_ERROR_CLASSES = not reached this attempt (no request left the process)

STABLE_SANITIZABLE_ERROR_FIELDS =
  - error is a typed `UserInputValidationError` (a distinct class from any
    HTTP/network error the SDK also defines), so "local pre-network
    configuration error" vs. "remote rejection" IS a stably distinguishable
    condition for any future diagnostic, without exposing its message text.
```

`requiresWalletAuth(requestMethod, requestPath)`
(`src/auth/utils/http.ts:155`) matches `/\/(evm|solana)\/accounts/` combined
with `POST`/`DELETE`/`PUT`. `POST /v2/evm/accounts/{address}/sign/typed-data`
(`src/openapi-client/generated/evm-accounts/evm-accounts.ts:222`) matches
this unconditionally, for any address, any payload, any credential pair —
this is a blanket SDK-level policy, not something specific to this buyer or
this diagnostic's fixed message.

## §11 — Official working reference

```
OFFICIAL_WORKING_REFERENCE_FOUND = YES
```

`@coinbase/cdp-sdk`'s own `toEvmServerAccount.ts` is the real, official
implementation backing every `ServerAccount` this repository's
`client.evm.getAccount(...)` returns — it is not a hypothetical reference,
it is the exact code that ran. Its `signTypedData` (line ~124) calls
`apiClient.signEvmTypedData(options.account.address, openApiMessage)` with
no special-casing of domain shape; the SDK does not reject non-payment
EIP-712 domains at the client layer.

```
REFERENCE_DIFFERENCES = none of behavioral consequence. The diagnostic's
call is a structurally ordinary use of the SDK's own documented
signTypedData surface; the failure is not caused by any deviation from a
working pattern, but by a repository-level configuration gap (no
walletSecret bound) that would reproduce identically for ANY domain/types/
message/nonce and ANY resolvable account address.
```

## §12 — Credential authorization model

```
SIGN_TYPED_DATA_REQUIRED_CREDENTIAL_SCOPE = CDP_WALLET_SECRET (a distinct
  secret from CDP_API_KEY_ID/CDP_API_KEY_SECRET), used to derive a second
  "X-Wallet-Auth" JWT specifically for POST/DELETE/PUT calls under
  /v2/evm/accounts/* and /v2/solana/accounts/* (and a few other write-shaped
  endpoint families) — see requiresWalletAuth's own match list.

CURRENT_CREDENTIAL_SCOPE_KNOWN = YES (for this layer)

CURRENT_CREDENTIAL_SCOPE_SUFFICIENT = NO
  -- confirmed by direct inspection of both source and live binding state:
```

Repository search (`grep -rn "CDP_WALLET_SECRET\|walletSecret"`) shows:
- `apps/edge-api/src/control-plane/config/env.ts:26` declares
  `CDP_WALLET_SECRET?: string` on `Env`, but nothing in the live request
  path reads it.
- `apps/edge-api/src/control-plane/config/production-payment.ts:253`
  (`buildProductionCdpAccountLookupClientFactory`) constructs
  `new CdpClient({ apiKeyId, apiKeySecret })` — no `walletSecret` field at
  all, by deliberate design (see next section).
- Live production secret names (`wrangler secret list`, read-only, names
  only): `AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`,
  `CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
  `PAID_RECEIPT_SIGNING_PRIVATE_KEY` — **`CDP_WALLET_SECRET` is not bound**.
- `wrangler.toml`'s own comment confirms this is intentional: "CDP_WALLET_SECRET
  removed entirely, [SUN-1200 checkpoint E] — not required by either the
  facilitator client or the read-only seller `getAccount` lookup."

That SUN-1200 checkpoint E reasoning was correct for the two call sites that
existed *at the time* (the x402 facilitator's `.verify()`/`.settle()`, which
never accept a `walletSecret` parameter at all; and the read-only
`evm.getAccount(...)` seller lookup, a `GET` that `requiresWalletAuth` never
matches). SUN-1220D introduced a **third** call site —
`account.signTypedData(...)`, a `POST` under `/evm/accounts/*` — that SUN-1200
checkpoint E's reconciliation did not and could not have anticipated. This is
not a credential-authorization *denial*; it is a **configuration gap**:
`CDP_WALLET_SECRET` was correctly identified as unneeded for the two
original call sites, and never provisioned, and no one has since needed it
until this diagnostic's new call site.

```
TRADE_VIEW_LABEL_RELEVANT_TO_CDP_WALLET_SIGNING = UNPROVEN
```

SUN-1219B recorded the `siteborne-x402-facilitator` key's Portal permission
display as `"Trade - View"` (`SELECTED_KEY_PERMISSION_DISPLAY="Trade - View"`).
That label describes the `apiKeyId`/`apiKeySecret` pair's own CDP-platform
permission scope — a different axis entirely from `walletSecret` (a
separate secret value, not a permission flag on the API key). The local
`UserInputValidationError` observed here fires **before** any request
reaches CDP's servers, so whatever `"Trade - View"` does or does not permit
server-side was never tested by this call and remains genuinely unproven —
not because the label is irrelevant to this credential, but because the
local check short-circuits before that layer could ever be exercised.

## §13 — Account-type / policy analysis

```
SERVER_ACCOUNT_EXISTENCE_IMPLIES_SIGNING_AUTHORITY = NO
```

`client.evm.getAccount(...)` (`GET`) and `account.signTypedData(...)`
(`POST .../sign/typed-data`) are gated by independently-checked layers in
the SDK's own `getAuthHeaders`:

1. **Bearer JWT** (from `apiKeyId`/`apiKeySecret`) — required for both, and
   present here (lookup succeeded).
2. **`X-Wallet-Auth` JWT** (from `walletSecret`) — required *additionally*
   for `POST`/`DELETE`/`PUT` under `/evm/accounts/*` (and the other
   `requiresWalletAuth`-matched families) — **absent here**, independent of
   which account is targeted, whether it exists, or its `account_kind`.

The existence of a resolvable `server_account` says nothing about whether
the calling credential set can sign for it; those are two different checks
in two different SDK code paths.

## §14 — Chain-ID / domain requirements

```
DIAGNOSTIC_DOMAIN_ACCEPTED_BY_CDP_SCHEMA  = UNPROVEN (never reached)
DIAGNOSTIC_TYPES_ACCEPTED_BY_CDP_SCHEMA   = UNPROVEN (never reached)
DIAGNOSTIC_MESSAGE_ACCEPTED_BY_CDP_SCHEMA = UNPROVEN (never reached)
```

As established in §9, the thrown error occurs strictly before the payload is
attached to any outgoing request. No CDP-side or SDK-side schema validation
of `domain`/`types`/`primaryType`/`message` ever ran.

## §15 — Root-cause hypotheses (ranked)

| Hypothesis | Supporting evidence | Contradicting evidence | Confidence | Minimal test needed |
| --- | --- | --- | --- | --- |
| **A. Missing `walletSecret` triggers a local, unconditional pre-network `UserInputValidationError`** | Direct source read of `getAuthHeaders`/`requiresWalletAuth` (§8, §10); confirmed no `CDP_WALLET_SECRET` bound in production secrets or in the client-construction call site; confirmed `POST .../sign/typed-data` unconditionally matches `requiresWalletAuth`; matches 73ms CPU / no unhandled exception / `outcome=ok` telemetry (consistent with local JWT-generation work before the throw) | None found | **High** — this is a deterministic code path, not an inference | None — already proven by static evidence. (Provisioning `CDP_WALLET_SECRET` and re-running would be *remediation verification*, not further root-cause disambiguation.) |
| B. CDP-side account-policy/permission denial (e.g. `"Trade - View"` scope) | SUN-1219B's Portal label exists | The observed failure happens **before** any request reaches CDP's servers (§8 stage 8 throws pre-network) — a server-side policy could not have produced this specific failure | Low, and moot for explaining *this* failure — remains untested for any *future* attempt made with `walletSecret` supplied | Only relevant after A is remediated: a further bounded live call with `walletSecret` present, not authorized by this checkpoint |
| C. `fromCdpEvmAccount`/adapter incompatibility | The diagnostic didn't literally call the wrapper | `toClientEvmSigner`'s own source (§8) is a pure 1:1 pass-through to `signer.signTypedData(msg)` — calling it would have failed identically at the same stage | **Ruled out** | none needed |
| D. Typed-data payload/domain rejected by CDP validation | none | Failure occurs before payload transmission (§9, §14) | **Ruled out** for this attempt | none needed |
| E. Transient network/provider failure | none | The thrown error is a typed local `UserInputValidationError`, not a network/HTTP error class; no network call was ever dispatched | **Ruled out** | none needed |

```
ROOT_CAUSE_PROVEN = YES
FAILED_PIPELINE_STAGE = local_validation (credential-configuration
  prerequisite unmet: CDP_WALLET_SECRET absent, required for
  POST /v2/evm/accounts/{address}/sign/typed-data)
SECOND_LIVE_SIGN_ATTEMPT_REQUIRED_TO_DISAMBIGUATE = NO
NEXT_DIAGNOSTIC_DESIGN_REQUIRED = NO (root cause already proven without one)
```

## §16 — Explicit statement

This checkpoint proves, **without any additional live signing call**, that
the SUN-1220D failure was caused by a local SDK validation error: the
production CDP client is constructed without `walletSecret`
(`CDP_WALLET_SECRET`, correctly and deliberately omitted at SUN-1200
checkpoint E for the two call sites that existed then), and
`@coinbase/cdp-sdk`'s own `getAuthHeaders` unconditionally requires that
secret for any `POST`/`DELETE`/`PUT` call under `/evm/accounts/*` —
including `signTypedData`, which SUN-1220D was the first checkpoint to
invoke. The error is thrown locally, before any network request is sent, so
it cannot reflect a CDP-side account-policy or permission-scope decision;
whether the `"Trade - View"`-scoped API key would *also* be rejected
server-side once `walletSecret` is supplied remains genuinely untested and
is explicitly left `UNPROVEN`, not asserted either way.

`CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER` remains the honest label for the
**outcome** (`UNPROVEN` — the credential set as currently configured cannot
complete this operation, but that is a config gap, not a proven permission
denial), while `SIGN_TYPED_DATA_FAILURE_ROOT_CAUSE` is now resolved for
**why**: `MISSING_CDP_WALLET_SECRET`. No fix was implemented, no credential
was changed, no permission was changed, no payload was changed, and no
buyer funding, payment signature, or economic action of any kind occurred
during this investigation.
