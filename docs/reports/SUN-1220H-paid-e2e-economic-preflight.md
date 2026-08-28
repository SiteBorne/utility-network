# SUN-1220H — Signer Evidence Freeze + Fresh Economic Preflight

Read-only. No funding. No payment signature. No paid request. No Cloudflare
mutation. No live 402. No EIP-3009 authorization.

> **Backfill note (SUN-1220M, committed after the fact):** this file was
> written during the SUN-1220H checkpoint turn but was left uncommitted when
> the session moved on to SUN-1220I; it sat untracked in the working tree
> through SUN-1220I/J/K/L and is committed here for the first time,
> unmodified except for this note.
>
> ```
> STATUS      = SUPERSEDED_FOR_CURRENT_ECONOMIC_STATE
> SUPERSEDED_BY = SUN-1220I first paid E2E challenge preflight
> PURPOSE     = historical point-in-time economic preflight evidence
> ```
>
> Every balance, funding-shortfall, `HEAD`, and production-state value below
> is a historical observation from when SUN-1220H actually ran (on top of
> `SUN1220G_SIGNER_EVIDENCE_COMMIT_SHA = 6eaa1359b3ae109bacb8f7e6301a94a7de0e9104`,
> i.e. before SUN-1220I/J/K/L) and must **not** be treated as current
> authority for balances, funding status, or production/source state. In
> particular, `FRESH_BUYER_USDC_ATOMIC`/`FRESH_SHORTFALL_USDC` here reflect
> the buyer's balance as measured at that time, superseded by SUN-1220I's own
> fresh preflight; and this file predates the SUN-1220L domain-metadata fix
> entirely — it is not evidence about that fix one way or the other. No
> content below was rewritten to correct or update it; only this note was
> added.

## 0. Starting state

```
SUN1220F_DESIGN_EVIDENCE_COMMIT_SHA        = 3489054ec54cd550ed135354f0b9333d53f91437
SUN1220F_IMPLEMENTATION_COMMIT_SHA         = ea89b80588962389131c74066228e92d244bd886
SUN1220G_LOCAL_SIGNER_CAPABILITY           = PASS
BUYER_ADDRESS                              = 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER  = YES
```

## 1. Phase 1 — freeze SUN-1220G signing evidence

```
$ git rev-parse HEAD          -> ea89b80588962389131c74066228e92d244bd886
$ git status --short          -> ?? docs/reports/SUN-1220G-local-cdp-signer-capability.md
```

Report content verified (grep) to preserve every required field exactly:
`SUN1220G_LOCAL_SIGNER_CAPABILITY = PASS`,
`CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER = YES`,
`TYPED_DATA_SIGNING_SUCCEEDED = YES`, `SIGNATURE_RECOVERED_TO_BUYER = YES`,
`NON_ECONOMIC_DIAGNOSTIC_SIGNATURES_CREATED = 1`,
`REAL_PAYMENT_SIGNING_PATH_PROVEN = YES`, `RAW_SIGNATURE_PRINTED/LOGGED/PERSISTED = NO`,
`WORKER_VERSIONS_CREATED/DEPLOYMENTS/TRAFFIC_SHIFTS/CLOUDFLARE_SECRET_MUTATIONS = 0`,
`BUYER_FUNDING_ACTIONS/PAYMENT_SIGNATURES_CREATED/LIVE_PAID_REQUESTS/SETTLEMENTS/TRANSACTIONS/REAL_ECONOMIC_EFFECTS = 0`.

## 2. Domain-label discrepancy — honest disposition

The report's committed tool uses domain name
`"SITEBORNE Local Signer Capability Diagnostic"` and `checkpoint: "SUN-1220F"`
(built at SUN-1220F, unchanged), rather than the invoking prompt's paraphrase
`"SITEBORNE Signer Capability Diagnostic"` / `"SUN-1220D"`/`"SUN-1220G"`.

Verified directly against `apps/edge-api/tests/live/cdp-buyer-signer-capability-local-check.test.ts`
that all five execution paths ran unaffected by this string difference —
`domain.name`/`message.checkpoint` are plain data fields signed as part of the
EIP-712 message; they do not select or branch any code path:

```
cdp.evm.getAccount(...)                     -> executed (line 202)
fromCdpEvmAccount(account)                  -> executed (line 221)
ClientEvmSigner.signTypedData(...)          -> executed (line 224, via fromCdpEvmAccount's
                                                pass-through to the same underlying method)
ServerAccount.signTypedData(...)            -> executed (the method fromCdpEvmAccount wraps)
recoverTypedDataAddress(...) -> buyer       -> executed (line 244), recovered address matched
                                                CONTROLLED_BUYER_ADDRESS
```

```
SIGNER_CAPABILITY_PROOF_AFFECTED_BY_DOMAIN_LABEL_DISCREPANCY = NO
```

Preserved as documentation only; the SUN-1220G report was not rewritten.

## 3. Report secret safety

```
$ pnpm secrets:scan
216 commits scanned, no leaks found (history)
21.26 MB scanned, no leaks found (working tree)
SECRETS_SCAN = PASS
```

Targeted grep of the SUN-1220G report for `CDP_API_KEY_SECRET=`, JWT prefix
(`eyJ`), `Authorization: Bearer`, 65-byte hex signature pattern, `private key`,
`seed phrase`: zero matches. The only `X-Wallet-Auth` occurrence is the
report's own sentence stating no such value was ever captured.

```
SECRET_VALUES_IN_REPORT        = 0
WALLET_SECRET_VALUES_IN_REPORT = 0
JWT_VALUES_IN_REPORT           = 0
SIGNATURE_VALUES_IN_REPORT     = 0
```

## 4. Fresh production containment

```
$ wrangler deployments status
Version(s): (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

$ curl /health                 -> 200 {"status":"ok",...}
$ curl /diagnostics/cdp-buyer-signer-capability -> 404
$ 12/12 paid REST routes (POST, Content-Type: application/json, {}) -> 404
$ pnpm production:preflight    -> PREFLIGHT RESULT: PASS
```

```
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
PAID_ROUTES_404             = 12/12
PRODUCTION_PREFLIGHT        = PASS
```

No infrastructure mutation performed.

## 5. Commit SUN-1220G evidence

```
$ git add docs/reports/SUN-1220G-local-cdp-signer-capability.md
$ git commit -m "SUN-1220G: record local CDP signer capability proof"
[main 6eaa135] SUN-1220G: record local CDP signer capability proof
 1 file changed, 179 insertions(+)

$ git status --short   -> (empty; clean tree)
$ git rev-parse HEAD    -> 6eaa1359b3ae109bacb8f7e6301a94a7de0e9104
```

```
SUN1220G_SIGNER_EVIDENCE_COMMIT_SHA = 6eaa1359b3ae109bacb8f7e6301a94a7de0e9104
```

## 6. Fresh buyer economic state (read-only, on-chain)

Queried Base mainnet (`eip155:8453`) directly via viem's own built-in default
public Base RPC (the same fallback already documented at
`apps/edge-api/src/control-plane/config/env.ts` and
`apps/edge-api/src/control-plane/evidence/chain-receipt-checker.ts` —
no new endpoint introduced), reading only `balanceOf`/`decimals` on the USDC
contract and the buyer's native balance. No transaction broadcast; no
private key involved; no mutation of any kind.

```
$ rpc_used            = https://mainnet.base.org
$ chain_id             = 8453
$ block_number         = 50480001
$ buyer                = 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
$ usdc_contract        = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
$ usdc_decimals        = 6
```

```
FRESH_BUYER_USDC_ATOMIC  = 13260
FRESH_BUYER_USDC         = 0.01326
FRESH_BUYER_NATIVE_WEI   = 10000000000000
FRESH_BUYER_NATIVE_ETH   = 0.00001
```

The fresh on-chain read exactly reproduces the historical figure
(`0.01326 USDC`) — the buyer's balance has not moved since it was last
recorded; this is a genuine fresh read, not a reuse of the old value.

## 7. Service economics reconciliation (from committed source, not old reports)

```
$ grep verify_agent_output_standard packages/pricing/src/service-prices.ts
verify_agent_output_standard: 0.019,

$ grep contractRelease apps/edge-api/src/control-plane/production/verify-agent-output-v2-production-executor.ts
contractRelease: '2.0.0',

$ grep PRODUCTION_NETWORK packages/protocol-x402/src/network/preproduction.ts
export const PRODUCTION_NETWORK: Network = 'eip155:8453';

$ grep SELLER_WALLET_ADDRESS wrangler.toml
SELLER_WALLET_ADDRESS = "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1"
```

```
SERVICE            = verify_agent_output.v2
CONTRACT_RELEASE    = 2.0.0
PRICE_USD           = 0.019
PAYMENT_ASSET       = USDC
PAYMENT_NETWORK     = eip155:8453
USDC_CONTRACT       = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
SELLER_PAYTO        = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
```

Note: `PRICE_USD`, `CONTRACT_RELEASE`, `PAYMENT_NETWORK`, and `SELLER_PAYTO`
are all confirmed directly from currently-committed source/config (not from
prior reports). The literal USDC contract address is **not** hardcoded
anywhere in SITEBORNE's own source — by design, the live x402/CDP facilitator
resolves the asset address per network at challenge time (matching §12's
"fresh at signing time" requirement). `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
is the well-known canonical Base-mainnet USDC contract, and this checkpoint's
own read-only `balanceOf` call against it (§6) succeeded and returned a real,
non-zero, expected balance — empirical confirmation it is the correct
contract, not a repeated assumption.

## 8. Fresh funding requirement

```
REQUIRED_PAYMENT_USDC          = 0.019
FRESH_BUYER_USDC                = 0.01326
FRESH_SHORTFALL_USDC            = max(0, 0.019 - 0.01326) = 0.00574

BUYER_ALREADY_SUFFICIENTLY_FUNDED = NO
MINIMUM_ADDITIONAL_FUNDING_USDC   = 0.00574
```

## 9. Funding safety-margin candidates (calculate only — none selected)

| Target | Balance (USDC) | Additional required from 0.01326 |
|---|---|---|
| A | 0.019 | 0.00574 |
| B | 0.025 | 0.01174 |
| C | 0.050 | 0.03674 |

No transfer performed. No target selected.

## 10. Gas / payer-fee model (revalidated from pinned implementation)

`apps/edge-api/src/control-plane/routes/x402-service.ts` and
`paid-services.ts` confirm settlement is performed by calling the CDP
**facilitator**'s own `.verify()`/`.settle()` (via `createCdpFacilitatorClient`,
SITEBORNE's own facilitator credential — never the buyer's). The buyer only
ever produces an off-chain EIP-3009 `signTypedData` authorization (proven at
SUN-1220G); the facilitator broadcasts the on-chain settlement transaction
and bears its own gas. This matches the buyer's negligible on-chain native
balance observed fresh in §6 (`0.00001 ETH`) — consistent with a buyer that
has never needed, and is not expected to need, gas.

```
PAYER_EXPECTED_TO_BROADCAST_TRANSACTION = NO
EXPECTED_PAYER_NATIVE_GAS_REQUIRED       = NO
MAX_PAYER_BORNE_NETWORK_FEE_USD          = 0
```

## 11. $0.25 hard-ceiling reconciliation

```
SERVICE_PAYMENT_USD                 = 0.019
EXPECTED_PAYER_BORNE_NETWORK_FEE_USD = 0
EXPECTED_PAID_E2E_EXPOSURE_USD       = 0.019

MAX_AUTHORIZED_PAID_E2E_EXPOSURE_USD = 0.25
PAID_E2E_HARD_CAP_PREFLIGHT           = PASS
```

Funding itself (§9) is reported separately and is not counted as "service
payment"; the $0.25 figure is a ceiling, not a spend target or authorization.

## 12. Funding source provenance

No prior report, commit, or session evidence designates an already-authorized
funding source (wallet, exchange balance, or account) for this buyer.

```
AUTHORIZED_FUNDING_SOURCE_ALREADY_DEFINED = NO
FUNDING_SOURCE_REQUIRED_FROM_USER          = YES
```

No funding source was chosen on the operator's behalf (no CDP account,
exchange balance, production seller wallet, facilitator wallet, or personal
wallet was selected).

## 13. Next-step branch

```
BUYER_ALREADY_SUFFICIENTLY_FUNDED = NO
FUNDING_ACTION_REQUIRED           = YES
```

No funding performed. Proceeding requires an explicit, separate authorization
naming: funding source, destination buyer (`0x516F...cB99`), exact amount or
target balance (A/B/C above or another), network (`eip155:8453`), asset
(`USDC`).

## 14. No payment challenge this checkpoint

No paid candidate deployment created. No live 402 requested. The
authoritative payment challenge (amount/network/asset/payTo/timing) is
deferred to the payment-signing checkpoint itself, immediately before EIP-3009
authorization is created.

```
FRESH_402_DEFERRED_UNTIL_PAYMENT_SIGNING_CHECKPOINT = YES
```

## 15. Mutation accounting

```
SOURCE_FILES_CHANGED            = 0   (only the pre-existing SUN-1220G report was committed;
                                        a temporary local read-only balance-check script was
                                        created under apps/edge-api/, run, and deleted before
                                        any commit -- never part of git history)
WORKER_VERSIONS_CREATED          = 0
DEPLOYMENTS                      = 0
TRAFFIC_SHIFTS                   = 0
CLOUDFLARE_SECRET_MUTATIONS      = 0
LIVE_SIGN_TYPED_DATA_CALLS       = 0
NON_ECONOMIC_DIAGNOSTIC_SIGNATURES_CREATED = 0
PAYMENT_SIGNATURES_CREATED       = 0
PAYMENT_AUTHORIZATIONS_CREATED   = 0
BUYER_FUNDING_ACTIONS            = 0
LIVE_PAID_REQUESTS               = 0
SERVICE_EXECUTIONS               = 0
SETTLEMENTS                      = 0
TRANSACTIONS                     = 0
REAL_ECONOMIC_EFFECTS            = 0
```

One read-only on-chain RPC call was made in §6 (`balanceOf` + `getBalance` +
`getBlockNumber` reads) — no transaction, no signature, no state mutation.

## 16. Final stop packet

```
SUN1220H_ECONOMIC_PREFLIGHT = PASS

SUN1220G_SIGNER_EVIDENCE_COMMIT_SHA = 6eaa1359b3ae109bacb8f7e6301a94a7de0e9104
REAL_PAYMENT_SIGNING_PATH_PROVEN    = YES
SIGNER_CAPABILITY_PROOF_AFFECTED_BY_DOMAIN_LABEL_DISCREPANCY = NO

SERVICE        = verify_agent_output.v2
PRICE_USD      = 0.019
NETWORK        = eip155:8453
ASSET          = USDC
USDC_CONTRACT  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
BUYER          = 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
SELLER_PAYTO   = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1

FRESH_BUYER_USDC_ATOMIC = 13260
FRESH_BUYER_USDC        = 0.01326
FRESH_BUYER_NATIVE_WEI  = 10000000000000
FRESH_BUYER_NATIVE_ETH  = 0.00001
FRESH_SHORTFALL_USDC    = 0.00574

BUYER_ALREADY_SUFFICIENTLY_FUNDED = NO
MINIMUM_ADDITIONAL_FUNDING_USDC   = 0.00574

TARGET_A_BALANCE_USDC = 0.019   TARGET_A_ADDITIONAL_REQUIRED_USDC = 0.00574
TARGET_B_BALANCE_USDC = 0.025   TARGET_B_ADDITIONAL_REQUIRED_USDC = 0.01174
TARGET_C_BALANCE_USDC = 0.050   TARGET_C_ADDITIONAL_REQUIRED_USDC = 0.03674

PAYER_EXPECTED_TO_BROADCAST_TRANSACTION = NO
EXPECTED_PAYER_NATIVE_GAS_REQUIRED       = NO
MAX_PAYER_BORNE_NETWORK_FEE_USD          = 0

EXPECTED_PAID_E2E_EXPOSURE_USD       = 0.019
MAX_AUTHORIZED_PAID_E2E_EXPOSURE_USD = 0.25
PAID_E2E_HARD_CAP_PREFLIGHT           = PASS

AUTHORIZED_FUNDING_SOURCE_ALREADY_DEFINED = NO
FUNDING_SOURCE_REQUIRED_FROM_USER          = YES
FUNDING_ACTION_REQUIRED                    = YES

FRESH_402_DEFERRED_UNTIL_PAYMENT_SIGNING_CHECKPOINT = YES

WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS             = 0
TRAFFIC_SHIFTS          = 0

BUYER_FUNDING_ACTIONS    = 0
PAYMENT_SIGNATURES_CREATED = 0
LIVE_PAID_REQUESTS      = 0
SETTLEMENTS             = 0
TRANSACTIONS            = 0
REAL_ECONOMIC_EFFECTS   = 0

FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%
```

No funding performed. No paid candidate deployment created. No live 402
requested. No EIP-3009 authorization created. No PAYMENT-SIGNATURE sent. Paid
E2E not started.
