# SUN-1220D — Temporary CDP Buyer Signer-Capability Diagnostic

## 1. Starting authority

Continued from `SUN1220C_DIAGNOSTIC_TEARDOWN=PASS` at commit
`4ac0cb097e2f18fa186cf0fa746db67cf5f8b3fd`. SUN-1220C proved:

```
BUYER_ADDRESS=0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
BUYER_FOUND_IN_CDP_PROJECT=YES
BUYER_CDP_ACCOUNT_TYPE=server_account
CURRENT_CDP_CREDENTIAL_CAN_LOOKUP_BUYER=YES
OFFICIAL_X402_SIGNER_ADAPTER=fromCdpEvmAccount
CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER=UNPROVEN
```

This checkpoint (implementation + tests + commit only — no upload, no
deployment, no live signing, no payment, no funding) resolves that last
unproven fact for the currently bound `siteborne-x402-facilitator`
credential, without ever creating an economically usable signature.

## 2. Approved design

The design (SUN-1220D design-only checkpoint, approved before this
implementation) was: `cdp.evm.getAccount({address}) -> ServerAccount ->
fromCdpEvmAccount(account) -> ClientEvmSigner.signTypedData(...)` against
one fixed, non-economic EIP-712 message, recovered locally with viem's
`recoverTypedDataAddress`, compared to the fixed controlled buyer
constant, and discarded — returning only redacted booleans.

## 3. Official SDK paths used

```
CDP_PACKAGE=@coinbase/cdp-sdk
CDP_VERSION=1.55.0
ACCOUNT_LOOKUP_API=cdp.evm.getAccount({address})
OFFICIAL_CLIENT_EVM_SIGNER_ADAPTER=fromCdpEvmAccount (from @coinbase/cdp-sdk/x402)
OFFICIAL_TYPED_DATA_SIGNING_PATH=ClientEvmSigner.signTypedData({domain,types,primaryType,message})
RECOVERY=viem recoverTypedDataAddress(...)
```

`fromCdpEvmAccount(account: CdpEvmAccount): ClientEvmSigner` is a thin,
official wrapper (`toClientEvmSigner(account)` from `@x402/evm`) around
`CdpEvmAccount = Pick<EvmAccount, "address" | "signTypedData">`. The
resolved `ServerAccount` returned by `cdp.evm.getAccount(...)`
structurally satisfies this without a cast. No custom JWT/authentication
was implemented — the diagnostic reuses
`buildProductionCdpAccountLookupClientFactory` from
`config/production-payment.ts` unmodified, the same construction the
real `verify_agent_output.v2` production route and the SUN-1220C
provenance diagnostic already use.

## 4. Fixed diagnostic typed data (non-economic)

```
domain: {
  name: "SITEBORNE Signer Capability Diagnostic",
  version: "1",
  chainId: 8453
}                                    // no verifyingContract (optional, omitted)
primaryType: "SignerCapabilityDiagnostic"
types: { SignerCapabilityDiagnostic: [
  { name: "checkpoint", type: "string" },
  { name: "purpose", type: "string" },
  { name: "nonce", type: "bytes32" },
] }
message: {
  checkpoint: "SUN-1220D",
  purpose: "non-economic signer capability proof",
  nonce: "0xf542d25a1f9eb8af01e7b6f9032603893bd135895126cc74309fc1b6955ec355",
}
```

The nonce is `keccak256(toHex("SUN-1220D-SIGNER-CAPABILITY-DIAGNOSTIC-v1"))`,
computed once and frozen as a source literal (test "S" recomputes and
asserts equality, so any future edit to the source string is caught).

## 5. Economic non-reusability proof

```
USES_USDC_DOMAIN=NO
USES_USDC_CONTRACT=NO
USES_TRANSFER_WITH_AUTHORIZATION=NO
USES_PAYMENT_FIELDS=NO
DIAGNOSTIC_SIGNATURE_ECONOMICALLY_USABLE=NO
```

Reasoning (also in the route module's own doc comment, and asserted by
test "T/U/V/W"):

1. EIP-712 signatures cryptographically commit to
   `(domainSeparator, hashStruct(message))`. This diagnostic's domain
   hashes to a completely different `domainSeparator` than Base mainnet
   USDC's real one (`name: "USD Coin"`, `version: "2"`,
   `verifyingContract: 0x8335...02913`) — any verifier checking against
   USDC's real domain separator rejects this signature outright.
2. `primaryType` is `"SignerCapabilityDiagnostic"`, not
   `"TransferWithAuthorization"` — the embedded EIP-712 type hash differs
   entirely from EIP-3009's.
3. The message fields (`checkpoint`, `purpose`, `nonce`) contain no
   `from`/`to`/`value`/`validAfter`/`validBefore` — there is no way to
   construct a `transferWithAuthorization(...)` call from this signature.
4. This module never assembles an x402 `PaymentPayload` object around
   the signature — it is discarded before any such structure could be
   built. `ExactEvmScheme`, `createPaymentPayload`,
   `encodePaymentSignatureHeaderSafe`, `settle`, and verify-route imports
   are all structurally absent from this module.

## 6. Files changed

Created:
- `apps/edge-api/src/control-plane/routes/production-cdp-buyer-signer-capability-diagnostic-route.ts`
- `apps/edge-api/src/control-plane/routes/production-cdp-buyer-signer-capability-diagnostic-route.test.ts`
- `scripts/test-cdp-buyer-signer-capability-diagnostic-reintroduction-caught.mts`
- this report

Modified (narrow, additive hunks only):
- `apps/edge-api/src/control-plane/config/env.ts` — `CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED?: string` gate typing
- `apps/edge-api/src/index.ts` — one `app.get(...)` mount
- `scripts/test-worker-runtime.mts` — one PHASE 0 404-under-real-workerd check

## 7. Red-green test evidence

21 tests, all passing (0 failed), covering the full requested matrix
(gate absence/wrong-value/wrong-method/query/body-immunity, exact
`getAccount`/`signTypedData` call counts and arguments, fixed
domain/types/primaryType/message/nonce assertions, USDC/EIP-3009
field-absence assertions, success/mismatch/failure response shapes,
sanitized-error assertions, signature non-leakage, structural-violation
mock coverage of every other CDP method, and arity-1 proof).

The real controlled buyer's private key is CDP-managed and never
available to this repository (by design) — no test can honestly produce
a signature that recovers to the literal `CONTROLLED_BUYER_ADDRESS`
constant via real, unmocked cryptography. Test "X" (full success)
therefore signs with a deterministic, non-funded test-only key (a real,
verifiable EIP-712 signature) and stubs `recoverTypedDataAddress`'s
result for that one call only, via `vi.mock('viem', ...)` with a
pass-through default; every other test (including a dedicated
cross-check test and the recovery-mismatch test "Y") exercises real,
unmocked `recoverTypedDataAddress`.

## 8. Signature-leak regression test

A recognizable fixed fake-signature marker
(`0xdeadbeef...`, never derived from real cryptographic material) is
asserted absent from the response body and from `console.log`/`error`/
`warn` output under every outcome. This module has no persistence
call site (no D1/R2/KV/Queue import) for a signature to reach.

## 9. Mutation proof

```
SIGNER_DIAGNOSTIC_SAFETY_REINTRODUCTION_CAUGHT=YES
```

Two independent proofs in
`scripts/test-cdp-buyer-signer-capability-diagnostic-reintroduction-caught.mts`,
each mutating the real source file, requiring the route's own test file
to fail for the expected reason, then restoring byte-for-byte (verified
by SHA-256 comparison):

- **Proof A** — reintroducing `client.evm.getOrCreateAccount()`
  immediately after the legitimate `getAccount` call: caught by the
  `AG/AH/AI/AJ/AK/AL` structural-violation test.
- **Proof B** — reintroducing the raw `signature` into the success
  response object: caught (multiple tests fail — exact-shape `toEqual`
  assertions and the leak-non-containment assertion).

Command → result:
```
$ npx tsx scripts/test-cdp-buyer-signer-capability-diagnostic-reintroduction-caught.mts
[cdp-buyer-signer-capability-diagnostic: forbidden-capability reintroduction] PASS
[cdp-buyer-signer-capability-diagnostic: signature-leak reintroduction] PASS
```

## 10. Full regression

```
LINT=PASS
TYPECHECK=PASS
FULL_TEST_SUITE=PASS (2192 passed, 35 skipped, 0 failed — up 21 tests from the pre-checkpoint 2171/2206)
WORKER_RUNTIME=PASS (89/89 scenarios — up 1 from 88, the new PHASE 0 diagnostic-404 check)
PRODUCTION_PREFLIGHT=PASS
SECRETS_SCAN=PASS
```

Also run and passing: the diagnostic's own isolated test file (21/21),
its dedicated mutation proof (above), and the existing
`test:production-fixture-reintroduction` proofs A–D (all PASS,
unaffected). The twelve-route truth table and x402 pricing/contract
checks are covered by `test:worker-runtime` PHASE 8 and the full test
suite respectively, both PASS.

No failed run occurred that required diagnosis in this checkpoint (an
earlier local `--force` typecheck attempt against the wrong root-level
command, and two initially-incorrect test assertions written against a
mock setup that didn't match the source's actual security property,
were caught and corrected before any regression command reported a
false PASS — see the two fixed assertions in section 7).

## 11. Real Workerd (PHASE 0) proof

Under the exact committed `wrangler.toml` (gate absent), real workerd
confirms:

```
GET /diagnostics/cdp-buyer-signer-capability -> 404
```

with zero live CDP calls — the check runs before any economics/paid
config is present, matching every other PHASE 0 404 assertion in this
suite.

## 12. Live production containment (read-only only)

```
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
GET /diagnostics/cdp-buyer-signer-capability -> 404  (route not deployed at all -- no upload occurred this checkpoint)
12/12 paid REST routes -> 404
pnpm production:preflight -> PASS
LIVE_CDP_CALLS=0
LIVE_SIGN_TYPED_DATA_CALLS=0
```

## 13. Explicit statement

**No live signature has been created.** This checkpoint performed
source implementation, unit tests (against mock and deterministic
test-only-key signers only), a mutation proof, and read-only production
verification. No Worker version was uploaded, no deployment or traffic
shift occurred, and no CDP SDK call of any kind was made against the
real, live `siteborne-x402-facilitator` credential or the real
controlled buyer account. `CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER`
remains unproven until a separately authorized bounded live-upload
checkpoint runs the one real `getAccount` + `signTypedData` call pair.

## 14. Classification

```
DIAGNOSTIC_SOURCE_CLASS=TEMPORARY_VALIDATION_INSTRUMENTATION
DIAGNOSTIC_CANDIDATE_REUSABLE_AS_PAID_E2E_CANDIDATE=NO
```

This code must later be uploaded (candidate, non-deploying), proven
live in one bounded non-economic signature run, restored, evidence
committed, then removed — matching the SUN-1220C provenance-diagnostic
lifecycle exactly. It must not remain in final mainnet paid source.

## 15. Candidate upload (non-deploying)

Authorized scope: exactly ONE non-deploying immutable Worker version
upload containing the committed source at
`4c9e6ccac7e0166fbde961b81b6c8daf405a25c7`, with the single new var
`CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED=true`. No deployment,
traffic shift, version override, live diagnostic invocation, or live
CDP/signing call was authorized or performed.

### Freeze identities (immediately pre-upload)

```
AUTHORIZED_SOURCE_HEAD=4c9e6ccac7e0166fbde961b81b6c8daf405a25c7
GIT_TREE_SHA=c0e047746133e35852bb2c59aa845fabf31ad279
WRANGLER_CONFIG_SHA256=10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387
LOCKFILE_SHA256=b95d04c58768f6e047edc5717cc03ccd82865240083767984683eda7eb1d923d
DRY_RUN_BUNDLE_SHA256=7e551779e8c67128c53e6b5e34cbf705148c447b5c859c5e20adfa95a7b287da
```

`DRY_RUN_BUNDLE_SHA256` is a composite hash (sha256 of the sorted
per-file sha256 hashes of the `--dry-run --outdir` bundle), not a
digest Cloudflare itself exposes for the uploaded artifact. Candidate
identity therefore rests on the unbroken freeze -> dry-run -> upload
chain documented here, not on an independently verified uploaded-bundle
byte digest.

`git status --short` was clean immediately before the real upload —
`CANDIDATE_FREEZE_INVALIDATED=NO`.

### Dry run (`wrangler versions upload --dry-run --var CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED:true`)

Confirmed: gate present; `PAID_ROUTES_ENABLED`,
`VERIFY_V2_CDP_ROUTE_ENABLED`, `NEVERMINED_ROUTES_ENABLED` absent; all
four ADR-0055 production gates absent; base vars
(`PCC_VERSION`, `ENVIRONMENT`, `LOG_LEVEL`, `AGENT_CARD_SIGNING_KEY_ID`,
`NVM_ENVIRONMENT`, `SELLER_WALLET_ADDRESS`) and all bindings
(`CATALOG`, `JOBS`, `EVENTS`, `DB`, `BROWSER`, `AI`) preserved.
`compatibility_date=2026-08-05`, `nodejs_compat` present,
`preview_urls=false` — all confirmed from the committed `wrangler.toml`
(not overridden by the dry run). `SIGNER_DIAGNOSTIC_CANDIDATE_DRY_RUN=PASS`.

### Real upload (exactly one)

```
$ wrangler versions upload --name siteborne-utility-edge \
    --message "SUN-1220D temporary CDP signer-capability diagnostic candidate" \
    --var CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED:true
Uploaded siteborne-utility-edge (3.20 sec)
Worker Version ID: e1b0902e-a454-46e7-8dd7-2af5578396cb
```

Result unambiguous — no retry performed.

```
SIGNER_DIAGNOSTIC_CANDIDATE_VERSION_ID=e1b0902e-a454-46e7-8dd7-2af5578396cb
SIGNER_DIAGNOSTIC_CANDIDATE_CREATED_AT=2026-08-25T02:01:13.824Z
```

### Authoritative post-upload read-back

`wrangler versions view e1b0902e-a454-46e7-8dd7-2af5578396cb` confirmed:

- `CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED = "true"`
- `PAID_ROUTES_ENABLED`, `VERIFY_V2_CDP_ROUTE_ENABLED`,
  `NEVERMINED_ROUTES_ENABLED` — absent
- All four ADR-0055 production gates — absent
- All 6 expected secret names bound (names only, no values read):
  `AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`,
  `CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
  `PAID_RECEIPT_SIGNING_PRIVATE_KEY` — `EXPECTED_SECRET_NAMES_PRESENT=6/6`
- Base vars and bindings preserved

```
CANDIDATE_SOURCE_IDENTITY=PASS
CANDIDATE_CONFIG_IDENTITY=PASS
CANDIDATE_SECRET_BINDING_IDENTITY=PASS
```

`wrangler deployments status` confirmed the active deployment is
unchanged: only `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%` —
`SIGNER_DIAGNOSTIC_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`,
`SIGNER_DIAGNOSTIC_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0`.

### Preview containment

`preview_urls=false` confirmed in committed `wrangler.toml`, unmodified
this checkpoint — `SIGNER_DIAGNOSTIC_PREVIEW_CONTAINMENT=PASS`.

### Post-upload production containment (read-only)

Ordinary (no override): `GET /health` -> 200;
`GET /diagnostics/cdp-buyer-signer-capability` -> 404; 12/12 paid REST
routes -> 404; `pnpm production:preflight` -> PASS.

```
POSTUPLOAD_PRODUCTION_PREFLIGHT=PASS
```

**No live CDP or signing call of any kind occurred this checkpoint.**
`LIVE_CDP_CALLS=0`, `LIVE_CDP_GET_ACCOUNT_CALLS=0`,
`LIVE_SIGN_TYPED_DATA_CALLS=0`, `LIVE_SIGNATURES_CREATED=0`,
`PAYMENT_SIGNATURES_CREATED=0`. The candidate exists, undeployed, at
0% traffic, eligible for a future separately-authorized one-call
non-economic signer-capability qualification. It is not reusable as
the real SUN-1220 paid-E2E candidate.

## 16. Reconciliation before the live run

A later continuation of this checkpoint began with `wrangler deployments
status` already showing a 100%/0% split (`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
/ `e1b0902e-a454-46e7-8dd7-2af5578396cb`, created 2026-08-25T02:06:39Z) that
this conversation had not created and that this document (through Section 15)
does not record. Per this checkpoint's own evidence-integrity rule ("if a
mutation result is ambiguous, do not repeat it — reconcile authoritative state
first") and the standing `SITEBORNE_RELEASE_AUTHORIZATION_AUTHORITY=v1` rule
(only this conversation's own record is authoritative), the operator chose to
restore to known-good-only and restart the bounded live sequence from a clean,
freshly verified baseline rather than reuse the unexplained deployment.

```
$ wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 --yes
SUCCESS  Deployed siteborne-utility-edge version f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce at 100%
```

```
UNRECONCILED_PREEXISTING_DEPLOYMENT_DETECTED     = YES
PREEXISTING_DEPLOYMENT_TREATED_AS_AUTHORIZED_EXECUTION = NO
PREEXISTING_DIAGNOSTIC_INVOCATION_STATUS         = UNPROVEN
FAIL_CLOSED_RESTORATION_EXECUTED                 = YES
```

Whether the unexplained deployment had already been used to invoke the live
diagnostic is not established either way by any evidence available to this
conversation, and this document does not assert a conclusion in either
direction.

Read-back confirmed a single version, `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`,
before any further action. Ordinary `GET /health` / `GET /ready` returned 200
with body `{"status":"ok",...}`. `git rev-parse HEAD` = 4c9e6ccac7e0166fbde
961b81b6c8daf405a25c7 (matches `AUTHORIZED_SOURCE_HEAD`). Candidate metadata
re-read via `wrangler versions view e1b0902e-...` confirmed only
`CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED=true`, no
`PAID_ROUTES_ENABLED`/`VERIFY_V2_CDP_ROUTE_ENABLED`/`NEVERMINED_ROUTES_ENABLED`,
and no ADR-0055 gate — unchanged since Section 15's original upload.

## 17. Attribution method used

The Observability-scoped API tokens from SUN-1210 checkpoints P3/P4 had
already been deleted (as that report's own cleanup section records), and this
checkpoint's Wrangler OAuth token carries no Analytics/Observability-query
scope (confirmed against `wrangler whoami`'s printed scope list). Rather than
provision a new scoped credential, plain `wrangler tail siteborne-utility-edge
--format json` was used as the live attribution channel: each tail event
carries `scriptVersion.id`, `outcome`, `cpuTime`, `wallTime`, `exceptions`, and
the full request (including `cf-ray`), which is sufficient to authoritatively
match every HTTP response by Ray ID to the Worker version that served it,
without creating any new credential.

## 18. Bounded live run — clean sequence

Exactly one temporary deployment was created:

```
$ wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 e1b0902e-a454-46e7-8dd7-2af5578396cb@0 --yes
SUCCESS  Deployed ... f4f20676... at 100% and e1b0902e... at 0%
```

Read-back: `(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`, `(0%)
e1b0902e-a454-46e7-8dd7-2af5578396cb`. `SIGNER_DIAGNOSTIC_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0`.

Under one continuous `wrangler tail` session, five requests were sent and
authoritatively attributed:

| Request | HTTP | Ray ID | `scriptVersion.id` | outcome | cpu ms | wall ms |
| --- | ---: | --- | --- | --- | ---: | ---: |
| ordinary `GET /health` | 200 | `a30722872a575205` | `f4f20676...` (known-good) | ok | 1 | 2 |
| ordinary `GET /ready` | 200 | `a3072287994e8cd2` | `f4f20676...` (known-good) | ok | 9 | 9 |
| candidate-override `GET /health` | 200 | `a307229d987190d8` | `e1b0902e...` (candidate) | ok | 11 | 12 |
| candidate-override `GET /diagnostics/cdp-buyer-signer-capability` | 503 | `a30722b49e54160a` | `e1b0902e...` (candidate) | ok | 73 | 155 |
| ordinary `GET /health` (pre-restore recheck) | 200 | `a30722cc1f1074ee` | `f4f20676...` (known-good) | ok | 4 | 4 |

```
ORDINARY_ROUTING_DURING_SIGNER_DIAGNOSTIC = KNOWN_GOOD
SIGNER_DIAGNOSTIC_CANDIDATE_ATTRIBUTION   = PASS
```

### Exact redacted diagnostic response (the only live invocation)

```json
{"ok":false,"buyer_found":true,"account_kind":"server_account","typed_data_signing_succeeded":false,"signature_recovered_to_buyer":false,"credential_signing_authorized":false,"error":"diagnostic signing capability check failed"}
```

No raw signature appears in this body, in any tail event's `logs`/`exceptions`
array (both empty for this Ray ID), or in this document. `outcome=ok` and
`exceptions=[]` for this Ray ID confirm the Worker itself did not crash — the
`503`/`ok:false` came from the route's own sanitized `catch` branch around
`account.signTypedData(...)`, matching Section 14's "handled sanitized
diagnostic failure" case, not a Worker-runtime failure.

## 19. Result classification

`buyer_found=true` and `account_kind="server_account"` confirm the read-only
lookup call succeeded (as SUN-1220C already proved). `typed_data_signing_succeeded=false`
means the `account.signTypedData(...)` call itself threw, caught by the
route's own `catch` block before any signature ever existed — the *attempt*
failed, not a recovery mismatch (Section 9's "recovered address" branch was
never reached). The route's `catch` block intentionally discards the
underlying SDK/provider error before responding, so this one sanitized
failure is evidence that the call did not succeed; it is not yet evidence of
*why* — a credential-permission denial, an SDK/provider-side validation
rejection of the typed-data shape, an adapter-layer defect, or a transient
provider condition would all produce the same observable shape. Converting
"the observed call failed" into "the credential fundamentally lacks signing
permission" is not supported by this evidence alone and is deferred to a
dedicated root-cause investigation (SUN-1220E) before any second live
attempt.

```
LIVE_SIGNER_CAPABILITY_ATTEMPT_RESULT  = FAIL
CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER = UNPROVEN
SIGN_TYPED_DATA_FAILURE_ROOT_CAUSE     = UNRESOLVED
CDP_SERVER_ACCOUNT_SIGNING_CAPABILITY  = FAIL_UNDIAGNOSED
OFFICIAL_SIGNER_ADAPTER_EXECUTION_PROVEN = NO
```

`OFFICIAL_SIGNER_ADAPTER_EXECUTION_PROVEN=NO` for two independent reasons:
the underlying call failed, and — noted here for evidence-integrity honesty —
the route's own source (Section "5. Approved design" above) calls
`account.signTypedData(...)` directly rather than literally constructing
`fromCdpEvmAccount(account)` first; the route's doc comment argues this is a
structurally-equivalent call to the same method the wrapper would invoke, but
the wrapper itself was never literally exercised.

This checkpoint does not investigate *why* the live sign call failed (no
retry was authorized or performed); the sanitized error message does not
distinguish CDP-side authorization/policy denial from a transient fault. That
root-cause question is out of this checkpoint's bounded scope.

## 20. Mandatory restoration and final containment

```
$ wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 --yes
SUCCESS  Deployed siteborne-utility-edge version f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce at 100%
```

Read-back: single version, `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`.
`SUN1220D_SIGNER_DIAGNOSTIC_RESTORATION=PASS`.

Post-restoration, under the same tail session: ordinary `GET /health` (Ray
`a3072524dd847c0e`) and a stale candidate-override `GET /health` (Ray
`a3072531f84170fe`) **both** attributed to `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`,
`outcome=ok` — proving the override header is inert once the candidate is no
longer part of the active deployment (matches Cloudflare's documented
version-override contract, and SUN-1210 checkpoint P4's prior observation).

```
POST_SIGNER_DIAGNOSTIC_ATTRIBUTION = PASS
```

Final containment (ordinary production, no override):

```
GET /diagnostics/cdp-buyer-signer-capability -> 404
GET /v1/company/evidence-graph            -> 404
GET /v1/web/context                       -> 404
GET /v1/document/evidence-json            -> 404
GET /v1/verify/agent-output               -> 404
GET /v2/company/evidence-graph            -> 404
GET /v2/web/context                       -> 404
GET /v2/document/evidence-json            -> 404
GET /v2/verify/agent-output               -> 404
GET /v2/nevermined/company/evidence-graph -> 404
GET /v2/nevermined/web/context            -> 404
GET /v2/nevermined/document/evidence-json -> 404
GET /v2/nevermined/verify/agent-output    -> 404
```

(12/12 paid routes confirmed 404 with a well-formed `Content-Type:
application/json` request; an initial content-type-less probe returned `415`
from the global content-type middleware, which runs before routing — a
request-format artifact, not a route-availability signal.)

```
$ pnpm production:preflight
PREFLIGHT RESULT: PASS
```

```
FINAL_PRODUCTION_VERSION      = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC      = 100%
SUN1220D_POST_DIAGNOSTIC_PREFLIGHT = PASS
```

## 21. Mutation and call accounting

```
WORKER_VERSIONS_CREATED = 0   (candidate already existed from Section 15's prior upload)
DEPLOYMENTS = 3   (reconciliation restore + temporary 100/0 + mandatory restoration)
CANDIDATE_NORMAL_TRAFFIC_PERCENT = 0 (throughout)
DIAGNOSTIC_ROUTE_INVOCATIONS = 1
LIVE_CDP_GET_ACCOUNT_CALLS = INFERRED_1 (buyer_found=true, account_kind=server_account; not independently observed via a provider-side log)
LIVE_SIGN_TYPED_DATA_CALLS = INFERRED_1 (attempted once; threw, caught by the route's own handler; no retry)
NON_ECONOMIC_DIAGNOSTIC_SIGNATURES_CREATED = 0  (the call threw before any signature value existed)
PAYMENT_SIGNATURES_CREATED = 0
CREATE_PAYMENT_PAYLOAD_CALLS = 0
BUYER_FUNDING_ACTIONS = 0
LIVE_PAID_REQUESTS = 0
SERVICE_EXECUTIONS = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
```

The extra reconciliation deployment (Section 16) was itself a restoration to
the pre-existing known-good version at 100% with no candidate present — it
changed no candidate config, created no Worker version, and shifted no
candidate traffic; it is counted here for full mutation-accounting honesty
even though it falls outside the three deployments the original directive
anticipated.

## 22. Explicit statement

**Exactly one live, non-economic EIP-712 typed-data signing attempt was made
against the real `siteborne-x402-facilitator` CDP credential and the real
controlled buyer account, and it failed** (the underlying `signTypedData`
call threw; no signature was ever produced, returned, logged, or persisted).
The read-only account lookup succeeded, confirming the credential can still
resolve the buyer as a `server_account`. This checkpoint proves, with live
evidence, that **this one signing attempt did not succeed under the observed
conditions** — it does **not** yet prove that the currently bound production
CDP credential fundamentally lacks signing authority for this buyer, since
the route's sanitized error handling discarded the underlying failure detail
needed to distinguish credential/permission denial from a provider-side
validation rejection, an adapter defect, or a transient condition. That
distinction is left `UNRESOLVED` pending a dedicated, read-only root-cause
investigation before any second live attempt is considered. Production was
restored to `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%` immediately after,
verified by authoritative read-back and post-restoration attribution. No
payment signature, payment payload, funding action, settlement, or
transaction of any kind occurred at any point in this checkpoint.

## 23. Temporary diagnostic teardown (SUN-1220E Phase 2)

With the live-failure evidence above committed
(`1a89af24620bb7fd9011b7e6d448fd5805c11781`), the temporary instrumentation
introduced by `4c9e6ccac7e0166fbde961b81b6c8daf405a25c7` was surgically
removed using that commit's own diff as authority — this document's history
was left untouched. Removed:

- `apps/edge-api/src/control-plane/routes/production-cdp-buyer-signer-capability-diagnostic-route.ts` (route, deleted)
- `apps/edge-api/src/control-plane/routes/production-cdp-buyer-signer-capability-diagnostic-route.test.ts` (tests, deleted)
- `scripts/test-cdp-buyer-signer-capability-diagnostic-reintroduction-caught.mts` (mutation-proof script, deleted)
- `CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED` gate declaration in `apps/edge-api/src/control-plane/config/env.ts` (hunk reverted)
- the route mount (`app.get('/diagnostics/cdp-buyer-signer-capability', ...)`) and its import in `apps/edge-api/src/index.ts` (hunk reverted)
- the corresponding Phase-0 404 scenario in `scripts/test-worker-runtime.mts` (hunk reverted)

Normal production CDP/x402 code (`@coinbase/cdp-sdk`, `fromCdpEvmAccount`,
`cdp.evm.getAccount`, the real x402 signer path) was not touched. A
repository-wide search confirmed no remaining reference to the removed
route, gate, or file names outside this report.

Full regression after removal:

```
pnpm lint                      PASS
pnpm turbo run typecheck --filter=@siteborne/edge-api --force   PASS (fresh, non-cached)
pnpm test                      2171 passed | 35 skipped  (was 2192 passed pre-removal; -21 matches the deleted diagnostic test file exactly)
pnpm test:worker-runtime       88/88 scenarios passed (was 89; -1 matches the deleted Phase-0 scenario)
pnpm production:preflight      PASS
pnpm secrets:scan              PASS (no leaks, git history + working tree)
pnpm pricing:check             PASS
pnpm contracts:baseline:verify PASS
pnpm contracts:compat:check    PASS
pnpm contracts:release:verify  PASS
```

Worker-runtime Phase 8 (states A–D) re-confirmed the full 12-route truth
table with the diagnostic gone: all four gate combinations produce the
correct 404/503 pattern with zero reachable fixture/bypass markers.

```
TEMPORARY_SIGNER_DIAGNOSTIC_RUNTIME_REACHABILITY = 0
DIAGNOSTIC_ROUTE_PRESENT_IN_RUNTIME_SOURCE        = NO
DIAGNOSTIC_GATE_PRESENT_IN_RUNTIME_SOURCE         = NO
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY = 0
TWELVE_ROUTE_TRUTH_TABLE                          = PASS
```

Preserved without modification:

```
LIVE_SIGNER_CAPABILITY_ATTEMPT_RESULT     = FAIL
CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER = UNPROVEN
SIGN_TYPED_DATA_FAILURE_ROOT_CAUSE        = UNRESOLVED
```

The historical candidate `e1b0902e-a454-46e7-8dd7-2af5578396cb` remains
immutable historical evidence only (Section 15's upload, Section 18's live
run) and is not reused for any further signing attempt — no Worker version,
deployment, or CDP call of any kind occurred during this teardown.

```
WORKER_VERSIONS_CREATED_DURING_TEARDOWN = 0
DEPLOYMENTS_DURING_TEARDOWN             = 0
LIVE_CDP_CALLS_DURING_TEARDOWN          = 0
```
