# SUN-1220G — Local-only CDP buyer signer-capability execution

Date: 2026-08-25
Classification: local-only execution evidence. No Cloudflare mutation, no
Worker upload, no deployment, no funding, no payment.

## Decision

```
SUN1220G_LOCAL_SIGNER_CAPABILITY = PASS
CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER = YES
```

**With `CDP_WALLET_SECRET` supplied locally (never touching Cloudflare), the
production CDP credential pair (`siteborne-x402-facilitator`) can sign
EIP-712 typed data for the controlled buyer.** This confirms the SUN-1220E
root-cause finding (`MISSING_CDP_WALLET_SECRET`) was the complete
explanation — no other blocking layer (e.g. the `"Trade - View"` API-key
permission scope) rejected the request once the missing credential was
supplied.

## 1. Pre-execution reconciliation

```
CDP_API_KEY_ID_PRESENT     = YES
CDP_API_KEY_SECRET_PRESENT = YES
CDP_WALLET_SECRET_PRESENT  = YES
(booleans only — no value was ever printed, echoed, or read by this report)

HEAD                = ea89b80588962389131c74066228e92d244bd886 (matched)
WORKING_TREE_CLEAN   = YES
```

## 2. Local-only reachability re-confirmed (read-only, no Cloudflare mutation)

```
TOOL_LOCATION  = apps/edge-api/tests/live/cdp-buyer-signer-capability-local-check.test.ts
CLI_WRAPPER    = scripts/cdp-buyer-signer-capability-check.ts
WORKER_RUNTIME_IMPORT_REACHABILITY = 0   (no match in apps/edge-api/src or wrangler.toml)
PRODUCTION_BUNDLE_REACHABILITY     = 0   (fresh `wrangler deploy --dry-run`, tool file absent from bundle)
CDP_WALLET_SECRET_IN_WRANGLER_TOML = NO  (only a comment noting its removal)
CDP_WALLET_SECRET_BOUND_TO_WORKER  = NO  (`wrangler secret list`: 6 names, none is CDP_WALLET_SECRET)
```

## 3. Fixed non-economic payload re-verified from source

```
domain.name    = "SITEBORNE Local Signer Capability Diagnostic"
domain.version = "1"
domain.chainId = 8453
primaryType    = SignerCapabilityDiagnostic
message        = { checkpoint: "SUN-1220F", purpose: "non-economic local signer capability proof", nonce: <fixed bytes32> }
verifyingContract = absent
DIAGNOSTIC_SIGNATURE_ECONOMICALLY_USABLE = NO
```

Note: the directive's own paraphrase named the domain
`"SITEBORNE Signer Capability Diagnostic"` and referenced a
`SUN-1220D`/`SUN-1220G`-labeled message; the actually-committed tool (built
under SUN-1220F, unchanged since) uses `"SITEBORNE Local Signer Capability
Diagnostic"` and `checkpoint: "SUN-1220F"`. This is a cosmetic label
difference only — grep confirmed no `USD Coin`/`USDC`/`TransferWithAuthorization`/
`validAfter`/`validBefore`/`payTo`/`PaymentPayload`/`verifyingContract` field
exists anywhere in the payload — so it did not block execution.

## 4. Call budget

```
MAX_CDP_GET_ACCOUNT_CALLS  = 1 (structurally enforced — no loop/retry in source)
MAX_SIGN_TYPED_DATA_CALLS  = 1 (structurally enforced — no loop/retry in source)
```

## 5. Execution

```
$ pnpm cdp:signer-capability-check
✓ apps/edge-api/tests/live/cdp-buyer-signer-capability-local-check.test.ts (8 tests) 380ms
  ✓ ... reads real credentials from process.env only and reports a fully redacted result  371ms
Test Files  1 passed (1)
     Tests  8 passed (8)
```

## 6. Redacted result (verbatim, complete)

```json
{
  "ok": true,
  "buyer_found": true,
  "account_kind": "server_account",
  "typed_data_signing_succeeded": true,
  "signature_recovered_to_buyer": true,
  "credential_signing_authorized": true
}
```

No other field was present. No raw signature, wallet secret, API secret,
JWT, `X-Wallet-Auth` value, `Authorization` header, or provider raw response
appeared anywhere in the command's stdout/stderr, transcript, or any file on
disk (`git status --short` was clean before and after; no `.env`/`.dev.vars`
file was created or modified).

```
RAW_SIGNATURE_PRINTED   = NO
RAW_SIGNATURE_LOGGED    = NO
RAW_SIGNATURE_PERSISTED = NO
RAW_SIGNATURE_RETURNED  = NO
```

## 7. Result classification

```
BUYER_FOUND_IN_CDP_PROJECT   = YES
BUYER_CDP_ACCOUNT_TYPE       = server_account
TYPED_DATA_SIGNING_SUCCEEDED = YES
SIGNATURE_RECOVERED_TO_BUYER = YES

CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER = YES
REAL_PAYMENT_SIGNING_PATH_PROVEN          = YES
```

## 8. Signature containment

```
NON_ECONOMIC_DIAGNOSTIC_SIGNATURES_CREATED = 1
PAYMENT_SIGNATURES_CREATED                 = 0
```

The one signature produced is the fixed non-economic diagnostic message
described in §3 — not payment material, and it was never returned, logged,
or persisted (§6).

## 9. No economic action

```
BUYER_FUNDING_ACTIONS = 0
LIVE_PAID_REQUESTS    = 0
SERVICE_EXECUTIONS    = 0
SETTLEMENTS           = 0
TRANSACTIONS          = 0
REAL_ECONOMIC_EFFECTS = 0
```

## 10. Production containment (read-only, post-execution)

```
$ wrangler deployments status
Version(s): (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

WORKER_VERSIONS_CREATED     = 0
DEPLOYMENTS                 = 0
TRAFFIC_SHIFTS              = 0
CLOUDFLARE_SECRET_MUTATIONS = 0
```

## 11. Local secret cleanup

```
LOCAL_CDP_CREDENTIAL_ENV_CLEANUP = NOT_APPLICABLE
```

This session's shell tool does not persist environment state between
commands — each command re-initializes from the calling shell's own profile
(confirmed: the three credentials were already present, unmodified by this
session, both before and after the single execution). There was no
transient in-process value this session set or could unset. If these three
variables were exported into a persistent profile (e.g. `~/.zshrc`,
`~/.zshenv`) solely for this qualification, removing them there is a step
only the operator can take — this checkpoint did not read, and will not
propose editing, any such file.

## 12. Summary

Exactly one local, non-economic `signTypedData` call was made against the
real CDP credential and the real controlled buyer account, entirely outside
Cloudflare. It succeeded and recovered to the controlled buyer address. No
Worker version, deployment, traffic shift, or Cloudflare secret mutation
occurred. No payment signature, funding action, settlement, or transaction
of any kind occurred. The buyer remains unfunded; the paid end-to-end flow
has not begun.
