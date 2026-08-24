# SUN-1220C — temporary CDP buyer-provenance diagnostic

`TEMPORARY_VALIDATION_INSTRUMENTATION` — not a mainnet paid candidate, not
uploaded, not deployed. This checkpoint is source implementation + tests +
commit only, following the same pattern already used and later removed for
SUN-1219B's `cdpX402SupportDiagnosticRoute`.

## 1. Starting authority

```text
FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%
SUN1219C_EVIDENCE_COMMIT_SHA=c5a7b0cb78833de415d9a09f20efa7e1c0407275
```

Fresh `git rev-parse HEAD` at the start of this checkpoint returned exactly
`c5a7b0cb78833de415d9a09f20efa7e1c0407275`, matching the authoritative head.
`git status --short` was empty. `WORKING_TREE_CLEAN=YES`,
`UNEXPLAINED_SOURCE_DRIFT=NO`. Confirmed absent (grep, zero matches):
`CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED` and `/diagnostics/cdp-x402-supported` —
the SUN-1219B diagnostic remains fully removed (`ea4c917`); this checkpoint
does not resurrect it.

Controlled buyer address (fixed, not request-overridable):
`0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`. Selected CDP credential:
`siteborne-x402-facilitator` (`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`, already
bound to the Worker — this checkpoint adds no new credential).

## 2. SDK findings grounding the design

`@coinbase/cdp-sdk@1.55.0`, installed and already a transitive dependency via
`@siteborne/protocol-x402`.

```text
ACCOUNT_LOOKUP_API   = cdp.evm.getAccount(options: GetServerAccountOptions): Promise<ServerAccount>
ACCOUNT_LIST_API     = cdp.evm.listAccounts(options?): Promise<ListServerAccountResult>
TYPED_DATA_SIGNING_API = cdp.evm.signTypedData(...); ServerAccount.signTypedData(...)
```

Two literal facts from the installed type declarations drove the design,
rather than any guess from field names:

- **`getAccount`'s return type is `Promise<ServerAccount>` unconditionally.**
  Smart Accounts are retrievable only through the separate
  `getSmartAccount(options: GetSmartAccountOptions)` method, which this
  diagnostic never calls and never imports. A successful resolution through
  this diagnostic's one call path is therefore *by construction* always a
  `ServerAccount` — `"smart_account"` is a structurally unreachable response
  branch here, retained in the response type only for the vocabulary this
  checkpoint's directive requires, and documented as unreachable rather than
  fabricated (directive §4).
- **Not-found is not safely distinguishable from a generic provider/auth
  failure.** The SDK's internal `APIError` class carries `statusCode` +
  `errorType` (including an `ErrorType.NotFound = "not_found"` literal), but
  `APIError` is not part of `@coinbase/cdp-sdk`'s public `package.json`
  `exports` map (only `.`, `./auth`, `./x402` are exported — the errors
  module is reachable only via an unsupported deep import). Relying on that
  unexported shape would not be a "reliable discriminator" in the sense
  directive §6 requires. This diagnostic therefore fails closed identically
  for every thrown error — not-found, auth failure, network failure alike —
  to the same fixed, sanitized 503. `buyer_found: false` is consequently
  reachable only through that generic failure path, never through a
  distinguished not-found path, matching directive §6's own fallback
  instruction.

## 3. Bounded design (frozen, as specified)

```text
DIAGNOSTIC_ROUTE       = GET /diagnostics/cdp-buyer-provenance
DIAGNOSTIC_GATE_NAME   = CDP_BUYER_PROVENANCE_DIAGNOSTIC_ENABLED
CONTROLLED_BUYER_ADDRESS_FIXED_IN_SOURCE = YES (no ?address=, no ?buyer=, no path param, no body override)
```

Gate absent/false → `c.notFound()`, zero dependency construction — byte-
identical to every other disabled gate in this repository. The gate is
single and dedicated: not satisfied by `PAID_ROUTES_ENABLED` or
`VERIFY_V2_CDP_ROUTE_ENABLED` alone, and does not alter either flag's
semantics, `PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED`, or `NEVERMINED_ROUTES_ENABLED`. Not
added to committed production `wrangler.toml` `[vars]`.

## 4. Official CDP client path only

The route reuses, unmodified, `buildProductionCdpAccountLookupClientFactory`
from `apps/edge-api/src/control-plane/config/production-payment.ts` — the
exact same construction the real `verify_agent_output.v2` production route
already uses (via `buildCdpSellerAddressLookup`) to resolve the *seller*
identity. This checkpoint is only a second call site of that same factory,
pointed at the fixed buyer address instead of `env.SELLER_WALLET_ADDRESS`. No
second authentication implementation, no manual JWT construction, no raw
`fetch` to CDP.

The diagnostic calls exactly one CDP operation:
`client.evm.getAccount({ address: CONTROLLED_BUYER_ADDRESS })` — a documented
read-only GET (see that factory's own doc comment: "the SDK only requires
the Wallet Secret for POST/DELETE Account-API writes, which this repository
never performs"). It never calls `getOrCreateAccount`, `createAccount`,
`importAccount`, `listAccounts`, `signTypedData`, `signMessage`,
`sendTransaction`, `transfer`, `getSmartAccount`, `verify`, `settle`,
`createPaymentPayload`, `fromCdpEvmAccount`, or `fromCdpSmartWallet`. No
signer object is ever constructed; `official_signer_adapter` in the response
is a static string literal chosen by a plain conditional on the (always-
`server_account`) success path, never a call to the adapter itself.

## 5. Redacted response contract

```json
{
  "ok": true,
  "buyer_found": true,
  "account_kind": "server_account",
  "official_signer_adapter": "fromCdpEvmAccount",
  "credential_lookup_authorized": true
}
```

or, on any failure (missing credentials, generic provider/auth error,
not-found):

```json
{
  "ok": false,
  "buyer_found": false,
  "account_kind": "unknown",
  "official_signer_adapter": "none",
  "credential_lookup_authorized": false,
  "error": "diagnostic provider call failed"
}
```

Never returned: buyer address, account ID, account name, API key ID/
metadata, portfolio/project ID, JWT, authorization header, raw provider
response, raw SDK error message/stack. Tests N/O/K/L/M assert this
structurally, including against a mock response deliberately carrying extra
fields (`name: 'buyer-account-name'`) that must not leak.

## 6. Implementation files

```text
apps/edge-api/src/control-plane/routes/production-cdp-buyer-provenance-diagnostic-route.ts       (new, route + testable core)
apps/edge-api/src/control-plane/routes/production-cdp-buyer-provenance-diagnostic-route.test.ts  (new, 14 tests)
apps/edge-api/src/control-plane/config/env.ts                                                     (+gate typing)
apps/edge-api/src/index.ts                                                                        (+route mount)
scripts/test-cdp-buyer-provenance-diagnostic-reintroduction-caught.mts                            (new, mutation proof)
scripts/test-worker-runtime.mts                                                                   (+PHASE 0 404 check)
docs/reports/SUN-1220C-cdp-buyer-provenance-diagnostic.md                                          (this file)
```

The route's exported surface is deliberately split in two, because Hono
infers `Handler` vs. `MiddlewareHandler` from a function's declared
parameter count:

- `resolveCdpBuyerProvenance(createClient)` — the testable core, arity 1,
  takes an injected client factory. This is the "explicitly named test seam"
  directive §10/§12 require: it carries no HTTP reachability of its own,
  since nothing in `index.ts` or the real route handler ever supplies an
  override.
- `cdpBuyerProvenanceDiagnosticRoute(c)` — the real Hono handler, arity 1,
  the only thing `index.ts` mounts (`app.get(path, cdpBuyerProvenanceDiagnosticRoute)`,
  no second argument). Always constructs the real
  `buildProductionCdpAccountLookupClientFactory(...)`.

## 7. Test evidence

`production-cdp-buyer-provenance-diagnostic-route.test.ts`: **14/14 passed**.

```text
A/B/B2  gate absent, gate≠"true", PAID_ROUTES_ENABLED+VERIFY_V2_CDP_ROUTE_ENABLED alone -> 404, real handler, no client constructed
D       wrong method -> 404
missing credentials -> 503, credential_lookup_authorized=false, no client constructed
C/E     getAccount called exactly once, with the fixed controlled address
F       structural proof: resolveCdpBuyerProvenance has no address parameter at all (arity 1: createClient only)
G       ServerAccount success -> buyer_found=true, server_account, fromCdpEvmAccount
H       smart_account documented-unreachable (mock getSmartAccount throws if invoked; never triggered)
I       not-found (thrown) -> buyer_found=false, unknown, none, generic sanitized error
K/L/M   err.message/err.stack never reach the result, even when deliberately embedding "Bearer", "cdp-key-id", "acc_9f3e..."
N/O     result contains exactly the 5 allowed keys; buyer address, account name, credential material never present, even when the mock deliberately returns extra fields
P       getAccount called at most once per resolution
Q/R/S/T getOrCreateAccount/createAccount/importAccount/listAccounts/signTypedData/signMessage/sendTransaction/transfer/getSmartAccount all wired to throw immediately if called; never triggered across every exercised branch
```

Full monorepo suite (`pnpm test`): **2185 passed, 35 skipped, 0 failed**
(180 test files passed, 19 skipped). `pnpm lint`: PASS (16/16 tasks).
`pnpm typecheck`: PASS (23/23 tasks, zero errors).

## 8. Mutation/regression proof

`scripts/test-cdp-buyer-provenance-diagnostic-reintroduction-caught.mts`:
temporarily reintroduces `client.evm.signTypedData({} as never)` immediately
after the route's one legitimate `getAccount` call, requires the route's own
test file to fail (it does — the mock's `signTypedData` throws, which
`resolveCdpBuyerProvenance`'s own fail-closed `try/catch` swallows,
observably flipping the Q/R/S/T success-path test from pass to
`expected false to be true`), restores the exact original bytes in a
`finally` block, and verifies the restoration byte-for-byte via SHA-256.

```text
DIAGNOSTIC_SIGNING_REINTRODUCTION_CAUGHT=YES
```

Result: **PASS** — `apps/edge-api/src/control-plane/routes/production-cdp-buyer-provenance-diagnostic-route.ts`
confirmed restored byte-for-byte after the proof ran.

The pre-existing `scripts/test-production-fixture-reintroduction-caught.mts`
(proofs A–D, unrelated to this checkpoint's new route) was also re-run for
the regression record: **PASS**, all four proofs caught their mutation and
restored byte-for-byte.

## 9. Full regression

Run sequentially, each reported individually rather than papered over:

```text
pnpm lint                 PASS (16/16 tasks)
pnpm typecheck             PASS (23/23 tasks)
pnpm test                  PASS (2185 passed / 35 skipped / 0 failed, 180 files)
pnpm test:worker-runtime   PASS (89/89 scenarios, including the new
                            "PHASE 0: GET /diagnostics/cdp-buyer-provenance
                            remains 404" check under real workerd)
pnpm production:preflight  PASS
pnpm secrets:scan          PASS (0 leaks, git + working-tree scans; scope
                            verify: 1081 tracked files, 8 required classes)
```

No run failed due to resource contention; nothing was rerun to paper over a
different failure.

## 10. Live production containment

Fresh read-only checks (no infrastructure mutation) against the currently
deployed production Worker:

```text
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
GET /diagnostics/cdp-buyer-provenance -> 404
12/12 paid REST routes -> 404
```

This checkpoint uploaded no Worker version, so the live 404 above reflects
the currently-deployed `f4f20676` bundle, which predates and does not
contain this checkpoint's new route at all — not a live evaluation of the
new gate. The gate's own fail-closed behavior is proven separately, in-
process, by tests A/B/B2 above and by the real-workerd PHASE 0 check (both
against this checkpoint's actual new source, run locally — never against the
live deployed Worker).

## 11. Explicit statement: no live CDP provenance lookup has been executed

This checkpoint answers none of SUN-1220C's original three provenance
questions (is the buyer address a CDP-managed account? what kind? is the
bound credential authorized to sign for it?) with real evidence. It builds
and proves, entirely offline, the one temporary instrument capable of
answering them later, once a future checkpoint is separately authorized to
upload and briefly enable it. `BUYER_FOUND_IN_CDP_PROJECT`,
`BUYER_CDP_ACCOUNT_TYPE`, and `CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER`
remain exactly `NOT_DETERMINED`/`UNPROVEN`, unchanged from SUN-1220C's prior
source-only checkpoint.

## 12. Source classification

```text
DIAGNOSTIC_SOURCE_CLASS=TEMPORARY_VALIDATION_INSTRUMENTATION
DIAGNOSTIC_CANDIDATE_REUSABLE_AS_PAID_E2E_CANDIDATE=NO
```

This source must be removed after the one future provenance lookup, matching
the SUN-1219B precedent exactly. The historical qualified mainnet candidate
(`9a18898a-f08b-4543-8e00-8bccf2dfc52a`) was not modified, referenced in any
mutable way, or reused as the diagnostic candidate. A future diagnostic
candidate, if separately authorized, must be a new immutable Worker version
— this checkpoint creates none.

## 13. Commit

```text
SOURCE_FILES_CHANGED=6
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_CDP_CALLS=0
CDP_ACCOUNT_LOOKUPS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SERVICE_EXECUTIONS=0
BOUND_SIGNER_EXECUTIONS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
BUYER_FUNDING_ACTIONS=0
```

Commit message: `SUN-1220C: add temporary CDP buyer provenance diagnostic`.
