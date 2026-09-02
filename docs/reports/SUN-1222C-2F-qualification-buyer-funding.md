# SUN-1222C-2F — Qualification Buyer Funding Bridge

**Status:** Read-only preparation and reconciliation complete through §7.
**Stopped at §8 (human signing boundary) per authorization scope.** No
transfer has been broadcast by this session. This report will be amended
with the on-chain reconciliation (§10–11) once the human operator submits
the transaction and reports the resulting hash.

**Inherited HEAD:** `01600ff` (SUN-1222C-1-REMEDIATION evidence commit).
Working tree clean before and during this checkpoint — this checkpoint
makes no source, test, or config changes; it is evidence-only.

## 1. Authorization

Authorized in a dedicated, standalone message naming this exact scope:
read-only preparation and reconciliation for exactly one controlled
funding transfer of `59803` atomic Base USDC to the qualification buyer
`0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`, explicitly excluding any
private key access, signing, or broadcast by the coding agent — the human
operator performs the single signing action and single submission in
their own wallet.

This is a hard boundary independent of authorization phrasing: this
session has no access to, and will not request, print, store, or use, any
private key, wallet secret, seed phrase, or equivalent signing material.

## 2. Fresh buyer balance (§3)

Read directly from Base mainnet via public RPC (`https://mainnet.base.org`),
`eth_call` to the canonical Base USDC contract's `balanceOf(buyer)`:

```
to:   0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913  (Base USDC)
data: 0x70a08231000000000000000000000000516f57e1fb800cceb2e70c42607fb93e2abecb99
```

Result: `0x0000...4afd` = **19197 atomic** (`$0.019197`).

**BUYER_BALANCE_BEFORE_ATOMIC=19197** — matches the inherited value
exactly. `FUNDING_TARGET_STALE=NO`.

## 3. Exact transfer freeze (§4)

```
19197 + 59803 = 79000
```

**FUNDING_ARITHMETIC=PASS**. `TARGET_BALANCE_ATOMIC=79000`,
`TRANSFER_AMOUNT_ATOMIC=59803`, `TRANSFER_AMOUNT_USDC=0.059803`.

## 4. Funding source safety (§5)

No source wallet address was supplied to this session, and this session
has no visibility into any wallet the human operator controls. These
three checks are therefore **self-attested by the human operator before
signing**, not independently verifiable by this session:

- `FUNDING_SOURCE_CONTROLLED=` — operator must confirm the source wallet
  is theirs.
- `FUNDING_SOURCE_USDC_SUFFICIENT=` — operator must confirm ≥`0.059803`
  USDC on Base mainnet in that wallet.
- `FUNDING_SOURCE_GAS_SUFFICIENT=` — operator must confirm sufficient ETH
  on Base mainnet for one ERC-20 transfer's gas.

This session did not print, request, or receive any private key, seed
phrase, or wallet secret in the course of this check.

## 5. No secret propagation (§6)

```
PRIVATE_KEY_PRINTED=NO
WALLET_SECRET_PRINTED=NO
CDP_WALLET_SECRET_USED_BY_WORKER=NO
SECRET_PERSISTED_TO_REPO=NO
SECRET_PERSISTED_TO_CLOUDFLARE=NO
SECRET_PERSISTED_TO_EVIDENCE=NO
```

## 6. Exact transfer parameters (§7)

One human-operated Base-mainnet ERC-20 `transfer(address,uint256)` call,
constructed and validated, **not broadcast**:

```
asset (Base USDC):  0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913
recipient:           0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
amount:               59803  (0xe99b, atomic, 6 decimals)
chain:                eip155:8453 (Base mainnet)

calldata:
0xa9059cbb000000000000000000000000516f57e1fb800cceb2e70c42607fb93e2abecb99000000000000000000000000000000000000000000000000000000000000e99b
```

**FUNDING_TRANSFER_PARAMETERS_VERIFIED=YES.**

One-shot operator command (Foundry `cast`, or equivalent in the
operator's own wallet UI/CLI — the operator supplies their own key via
`--private-key`/`--account`/hardware wallet, never pasted here):

```bash
cast send 0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913 \
  "transfer(address,uint256)" \
  0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99 \
  59803 \
  --rpc-url https://mainnet.base.org \
  --account <YOUR_OWN_ACCOUNT_ALIAS_OR_LEDGER>
```

## 7. Human signing boundary (§8) — STOP POINT

This session stops here. `HUMAN_FUNDING_SIGNING_ACTIONS=0`,
`FUNDING_SUBMISSIONS=0` — the operator has not yet signed or submitted.
No retry, no alternate construction, and no second transfer will be
prepared without fresh authorization per the absolute no-retry law (§9).

## 8. Four-service candidate economics readback (§14)

Read from `governance/RISK_LIMITS.yaml` (`financial_limits.max_price_usd_per_service`)
and cross-checked against the embedded copy in
[`packages/pricing/src/service-prices.ts`](../../packages/pricing/src/service-prices.ts).
Representative (lowest-tier) qualification amount per service, `PAY_TO`
resolved from [`wrangler.toml`](../../wrangler.toml)'s `SELLER_WALLET_ADDRESS`
(same seller wallet for all four — this is the production payee, distinct
from the qualification buyer being funded above):

| Service | DISPLAY_PRICE_USDC | AMOUNT_ATOMIC | NETWORK | ASSET | PAY_TO |
|---|---|---|---|---|---|
| `company_evidence_graph.v2` | 0.039 | 39000 | eip155:8453 | 0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913 | 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1 |
| `web_context_verified.v2` (direct tier) | 0.009 | 9000 | eip155:8453 | 0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913 | 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1 |
| `document_evidence_json.v2` (native tier) | 0.012 | 12000 | eip155:8453 | 0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913 | 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1 |
| `verify_agent_output.v2` (standard tier) | 0.019 | 19000 | eip155:8453 | 0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913 | 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1 |

```
39000 + 9000 + 12000 + 19000 = 79000
```

**FOUR_SERVICE_PRICE_SUM_ATOMIC=79000**,
**PRICE_SUM_MATCHES_FUNDING_TARGET=YES.**

Higher-tier prices exist for three of the four services
(`web_context_verified_rendered`=0.029, `document_evidence_json_ocr`=0.019/
`_table`=0.029/`_max_job`=0.19, `verify_agent_output_reproduction`=0.049)
but are not part of this funding target — the lowest qualifying tier per
service is what SUN-1222C-2A–2D will actually invoke.

## 9. Production containment

No deployment, traffic, or Cloudflare state was touched by this
checkpoint. `PRODUCTION_TRAFFIC_MUTATIONS=0`,
`CANDIDATE_TRAFFIC_MUTATIONS=0`, `CLOUDFLARE_MUTATIONS=0`.

## 10. Zero service economic action

No SITEBORNE service was invoked. `SITEBORNE_402_REQUESTS=0`,
`EIP3009_AUTHORIZATIONS_CREATED=0`, `SITEBORNE_PAYMENT_SIGNATURES=0`,
`SITEBORNE_PAID_POSTS=0`, `FACILITATOR_VERIFY_CALLS=0`,
`FACILITATOR_SETTLE_CALLS=0`, `SITEBORNE_SETTLEMENT_TRANSACTIONS=0`.

## 11. Qualification order (frozen, pending funding completion)

1. `company_evidence_graph.v2`
2. `web_context_verified.v2`
3. `document_evidence_json.v2`
4. `verify_agent_output.v2`

Each requires a separate, fresh, standalone financial authorization — no
standing authorization from this checkpoint carries forward to any of
them.

## 12. Classification

This transfer, once submitted by the operator, is **controlled
qualification wallet funding** — moving the human operator's own USDC
between wallets they control to pre-fund a test/qualification buyer. It
is explicitly **not** revenue, not a customer payment, and not a
SITEBORNE service settlement.

## Final packet

```
SUN1222C_2F_QUALIFICATION_FUNDING=BLOCKED  (awaiting human signature/submission)
FUNDING_AUTHORIZATION=PRESENT
BUYER_BALANCE_BEFORE_ATOMIC=19197
TARGET_BALANCE_ATOMIC=79000
TRANSFER_AMOUNT_ATOMIC=59803
FUNDING_SOURCE_CONTROLLED=SELF_ATTESTED_BY_OPERATOR
FUNDING_SOURCE_USDC_SUFFICIENT=SELF_ATTESTED_BY_OPERATOR
FUNDING_SOURCE_GAS_SUFFICIENT=SELF_ATTESTED_BY_OPERATOR
HUMAN_FUNDING_SIGNING_ACTIONS=0
FUNDING_SUBMISSIONS=0
FUNDING_TX_HASH=(none yet)
FUNDING_TX_STATUS=(none yet)
FUNDING_TRANSFER_COUNT=0
BUYER_BALANCE_AFTER_ATOMIC=(unchanged, 19197)
BUYER_BALANCE_DELTA_ATOMIC=0
PRIVATE_KEY_PRINTED=NO
SECRET_PERSISTED_TO_REPO=NO
PRODUCTION_TRAFFIC_MUTATIONS=0
CANDIDATE_TRAFFIC_MUTATIONS=0
CLOUDFLARE_MUTATIONS=0
SITEBORNE_402_REQUESTS=0
EIP3009_AUTHORIZATIONS_CREATED=0
SITEBORNE_PAID_POSTS=0
FACILITATOR_SETTLE_CALLS=0
FOUR_SERVICE_PRICE_SUM_ATOMIC=79000
PRICE_SUM_MATCHES_FUNDING_TARGET=YES
QUALIFICATION_ORDER=company_evidence_graph.v2,web_context_verified.v2,document_evidence_json.v2,verify_agent_output.v2
SUN1222C_2F_EVIDENCE_COMMIT_SHA=(this commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-2F-RECONCILE (after operator submits; report tx hash back)
```

**DO NOT START THE FIRST SERVICE PAYMENT.** Awaiting the operator's
transaction hash to complete on-chain reconciliation (§10–11 of the
original spec) before any further checkpoint proceeds.
