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
