# SUN-1222C-QUALIFICATION-FUNDING — Funding-Optimized Four-Service Qualification Preparation

**Status:** Read-only preparation and reconciliation complete through §13.
**Stopped at §14 (human signing boundary) per absolute policy: this session
never executes a financial transfer, regardless of authorization scope.**
No transfer has been broadcast by this session. This report will be
amended with the on-chain reconciliation (§16-17) once the human operator
submits the transaction and reports the resulting hash.

**Inherited HEAD:** `2d9a93d` (SUN-1222C evidence commit). Working tree
clean before and during this checkpoint — no source, test, or config file
was modified.

## 1. Authorization gate

Authorized in a dedicated, standalone message naming this exact scope:
read-only proof of document pricing, minimum-liquidity computation, and
preparation of exactly one funding transfer (max `110273` atomic),
explicitly excluding any private key access, signing, or broadcast by the
coding agent.

This is a hard boundary independent of authorization phrasing: this
session has no access to, and will not request, print, store, or use any
private key, wallet secret, seed phrase, CDP secret, or equivalent signing
material, **and does not execute financial transfers under any
circumstance, even with explicit user authorization** — this is a fixed
policy of this session, not a negotiable scope item.

```
QUALIFICATION_FUNDING_AUTHORIZATION=PRESENT
```

## 2. Release containment (fresh)

```
$ wrangler deployments status
(100%) db7054c9-76ee-4830-aabe-8a4542261b6a
(0%)   3a74686d-bad8-4fb0-b6b8-604292145d69
```
Unchanged from SUN-1222C. No traffic mutation, no candidate replacement.
```
FUNDING_PRECHECK_DEPLOYMENT=PASS
```

## 3. Live candidate price-card reconciliation (fresh, this checkpoint)

**Self-correction, documented rather than hidden:** the first probe
attempt this checkpoint used an unquoted `Cloudflare-Workers-Version-Overrides`
header value (`siteborne-utility-edge=3a74686d-...`), which Cloudflare
silently ignores (no error — it just serves the 100% production version
instead). That mistake produced misleading `/catalog` output
(`document_evidence_json.v2` and `company_evidence_graph.v2` showing
`production_enabled=false`, matching production `db7054c9` — which
predates both services' hardening — not the candidate). Comparing the
result against production's known build date immediately flagged the
inconsistency; correcting the header to the quoted form used everywhere
else in this engagement's history (`siteborne-utility-edge="3a74686d-..."`,
per `SUN-1217`'s own proof) restored the expected candidate behavior on
retest. This was a probe-syntax error in this session, not a candidate or
platform defect — recorded here because the discipline of this engagement
is to document what actually happened, not just the corrected answer.

With the corrected header, four fresh unpaid `402` probes against candidate
`3a74686d-bad8-4fb0-b6b8-604292145d69` (zero traffic to production, zero
`PaymentPayload`, zero signature, zero economic action):

| SERVICE | SCHEME | AMOUNT_ATOMIC | ASSET | PAY_TO |
|---|---|---|---|---|
| `company_evidence_graph.v2` | exact | `39000` | Base USDC | `0x7f44...E6E1` |
| `web_context_verified.v2` | exact | `9000` | Base USDC | `0x7f44...E6E1` |
| `document_evidence_json.v2` | **upto** | **`190000`** | Base USDC | `0x7f44...E6E1` |
| `verify_agent_output.v2` | exact | `19000` | Base USDC | `0x7f44...E6E1` |

```
COMPANY_SCHEME=exact
COMPANY_AMOUNT_ATOMIC=39000
WEBCTX_SCHEME=exact
WEBCTX_AMOUNT_ATOMIC=9000
DOCUMENT_SCHEME=upto
DOCUMENT_MAX_AMOUNT_ATOMIC=190000
DOCUMENT_PRICING_KEY=document_evidence_json_max_job
VERIFY_SCHEME=exact
VERIFY_AMOUNT_ATOMIC=19000
```
Matches frozen source/evidence from SUN-1222C exactly. No STOP condition.

## 4. Document authorization-ceiling proof

Traced live, this checkpoint, from `apps/edge-api/src/control-plane/
production/document-evidence-json-v2-cdp-composition.ts:202-203`:
```ts
scheme: 'upto',
pricingKey: 'document_evidence_json_max_job',
```
`governance/RISK_LIMITS.yaml:18`: `document_evidence_json_max_job: 0.19`
→ `190000` atomic at 6 decimals. x402 `upto` scheme
(`packages/protocol-x402/src/requirements/upto.ts`) requires the buyer to
authorize up to this maximum at signing time; the facilitator settles the
lesser of the measured actual amount and this ceiling.
```
DOCUMENT_AUTHORIZATION_CEILING_ATOMIC=190000
DOCUMENT_CEILING_LIQUIDITY_REQUIRED=YES
```
No premise revision needed — matches the inherited assumption exactly.

## 5. Frozen document qualification request

Reuses the same fixture already live-proven end-to-end in
`SUN-1222C-1-REMEDIATION`:
```
DOCUMENT_QUALIFICATION_PAGE_COUNT=1
DOCUMENT_QUALIFICATION_MODE=native (no OCR, no tables)
DOCUMENT_QUALIFICATION_CONTENT_TYPE=application/pdf
DOCUMENT_QUALIFICATION_FIXTURE=services/modal-worker/fixtures/pdf/native_text_one_page.pdf (sha256:bed592e5...5bab3, 1530 bytes)
DOCUMENT_QUALIFICATION_EXPECTED_PRICE_ATOMIC=12000
```
This is the smallest representative request that still proves the real
production document executor (real Modal PDF text extraction, not a
fixture/stub) — already proven to reach the real worker and return `201`
with byte-exact `R2` round-trip in `SUN-1222C-1-REMEDIATION`.

## 6. Deterministic document price proof (source trace, fresh)

Traced live, this checkpoint, through the actual pricing call path (not
the display price alone):

`apps/edge-api/src/control-plane/production/
document-evidence-json-v2-production-executor.ts:375-382`:
```ts
const usage = calculateDocumentUsage(
  workerResult.pages.map((p) => ({
    page_number: p.page_number,
    ocr_used: p.ocr_used,
    table_count: p.tables.length,
  }))
);
const actualAmountAtomic = documentUsageToAtomicUnits(usage, 6);
```
`packages/pricing/src/document-usage.ts`: for a single page with
`ocr_used=false, table_count=0` → `tier='native'` →
`price_usd_micro = usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_native'))`.
`governance/RISK_LIMITS.yaml:15`: `document_evidence_json_native: 0.012`
→ `12000` micro-USD → `12000` atomic (6-decimal USDC, 1:1). `subtotal
(12000) <= max_job (190000)` → `capped=false` → `total_usd_micro=12000`.

```
DOCUMENT_QUALIFICATION_EXPECTED_PRICE_ATOMIC=12000
DOCUMENT_ACTUAL_PRICE_CAN_BE_COMPUTED_BEFORE_SETTLEMENT=YES, WITH ONE CAVEAT
```
Caveat, stated precisely: the tier (`native`/`ocr`/`table`) is a function
of the *real Modal worker's own measured extraction result*
(`workerResult.pages[].ocr_used`/`.tables`), not of the raw uploaded bytes
alone — so it is not knowable from the file bytes without running
extraction, in general. For *this specific, previously-run* fixture,
however, the tier outcome (`native`, 1 page, no OCR, no tables) is already
empirically known from `SUN-1222C-1-REMEDIATION`'s real end-to-end run, so
`12000` is a proven expectation for *this exact qualification request*,
not a general pre-payment guarantee for arbitrary uploads.

## 7. Document overcharge defense (source trace, fresh)

```
DOCUMENT_QUALIFICATION_PRICE_BOUND=PASS
```
Proven from the same call site (§6):
- **Page count cannot be inflated**: `usage.page_costs` maps 1:1 over
  `workerResult.pages` — the real worker's own measured page array, never
  buyer-supplied. A 1-page upload cannot produce more than 1 page-cost
  entry.
- **Tier cannot silently escalate**: `tierForPage()` is a pure function of
  `ocr_used`/`table_count`, both measured server-side by the real worker,
  not caller-controlled input fields.
- **Settlement cannot exceed the ceiling**: `calculateDocumentUsage`'s own
  `capped = subtotal > max_job_usd_micro` logic clamps `total_usd_micro`
  to `max_job_usd_micro` unconditionally — the facilitator is never asked
  to settle more than `190000` regardless of measured usage.
- **Auditability**: the executor returns `resourceMetrics.page_costs` and
  `.capped` alongside the result — the exact per-page pricing basis is
  part of the record, not just the final number.
- **Tied to actual processed dimensions**: confirmed above — the input to
  `calculateDocumentUsage` is `workerResult.pages`, the real worker's
  output, not a client-supplied field anywhere in this call path.

## 8. Remaining three-service total (fresh, live, §3)

```
19000 + 9000 + 39000 = 67000
REMAINING_THREE_QUALIFICATION_TOTAL_ATOMIC=67000
```
Matches expected exactly.

## 9. Qualification order optimization

Using fresh buyer balance `79727` (§10):

**Order A** (`verify → webctx → company → document`): buyer must reach
`67000` for the three exact-scheme payments (covered by `79727`, leaving
`12727`), then must additionally hold the full `190000` ceiling to
authorize document — top-up required: `190000 - 12727 = 177273`.

**Order B** (`document → verify → webctx → company`): buyer must reach
`190000` immediately to authorize document's ceiling — top-up required:
`190000 - 79727 = 110273`. After document settles at its expected `12000`,
`178000` remains, comfortably covering the remaining `67000`
(`178000 - 67000 = 111000` final).

```
ORDER_A_MINIMUM_TOPUP_ATOMIC=177273
ORDER_B_MINIMUM_TOPUP_ATOMIC=110273
FUNDING_SAVINGS_FROM_DOCUMENT_FIRST_ATOMIC=67000
OPTIMAL_QUALIFICATION_ORDER=[document_evidence_json.v2, verify_agent_output.v2, web_context_verified.v2, company_evidence_graph.v2]
```
Matches the runbook's own expected figures exactly; no new evidence favors
a different ordering.

## 10. Fresh buyer balance (§10)

```
$ eth_call balanceOf(0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99) on Base mainnet USDC, block 0x307128d
0x1376f = 79727 atomic
```
```
BUYER_BALANCE_BEFORE_ATOMIC=79727
```
Unchanged from `SUN-1222C`'s reading moments earlier — `FUNDING_TARGET_STALE=NO`.

## 11. Exact minimum top-up

```
MINIMUM_TOPUP_ATOMIC = max(0, 190000 - 79727) = 110273
```
```
MINIMUM_TOPUP_ATOMIC=110273
```
`110273 <= 110273` — within the authorized ceiling. Not zero —
`FUNDING_NOT_REQUIRED` does not apply; a transfer is required.

## 12. Funding source safety

No source wallet address was supplied to this session, and this session
has no visibility into any wallet the human operator controls. These
checks are **self-attested by the human operator before signing**, not
independently verifiable by this session (same limitation documented in
`SUN-1222C-2F`):

- `FUNDING_SOURCE_CONTROLLED=` — operator must confirm the source wallet
  is theirs and is not the SITEBORNE seller/payTo wallet
  (`0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`) unless separately
  authorized.
- `FUNDING_SOURCE_USDC_SUFFICIENT=` — operator must confirm ≥`0.110273`
  Base USDC available.
- `FUNDING_SOURCE_GAS_SUFFICIENT=` — operator must confirm sufficient Base
  ETH for one ERC-20 `transfer` call.

## 13. Frozen exact funding transfer

```
Asset:       Base USDC (0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913)
Destination: 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
Amount:      110273 atomic (0.110273 USDC)
Network:     eip155:8453 (Base mainnet)
```
```
FUNDING_TRANSFER_FROZEN=YES
```

## 14. Human signing boundary — STOP POINT

This session **does not execute financial transfers under any
circumstance** — not a scope limitation negotiated for this checkpoint,
but a fixed operating boundary independent of what any authorization
states. No private key, wallet secret, seed phrase, or signing mechanism
is accessed, requested, or used by this session.

One-shot operator command (Foundry `cast`, or equivalent in the operator's
own wallet UI/CLI — the operator supplies their own key via
`--private-key`/`--account`/hardware wallet, never pasted here):

```bash
cast send 0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913 \
  "transfer(address,uint256)" \
  0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99 \
  110273 \
  --rpc-url https://mainnet.base.org \
  --account <YOUR_OWN_ACCOUNT_ALIAS_OR_LEDGER>
```

```
HUMAN_FUNDING_SIGNING_ACTIONS=0
FUNDING_SUBMISSIONS=0
FUNDING_TRANSFERS=0
```
No retry, no alternate construction, and no second transfer will be
prepared without fresh authorization. This report will be amended with
§16-17 on-chain reconciliation once the operator reports a transaction
hash.

## 15-19. Reserved pending operator transaction hash

Not yet performed — depends on §14's stop point. `FUNDING_TX_HASH=`,
`FUNDING_TX_STATUS=`, `BUYER_BALANCE_AFTER_ATOMIC=`, and
`DOCUMENT_AUTHORIZATION_CEILING_COVERED=` will be filled in this same
report once the operator submits.

## 18. No service economic action (this checkpoint)

```
SERVICE_402_REQUESTS_FOR_PAYMENT=0
```
Four ordinary unauthenticated-caller `402` responses were received in §3
(routine discovery of `PaymentRequirements`, the same response any
unauthenticated caller gets) — no `PaymentPayload`, no `EIP-3009`
authorization, no signature, no facilitator call. Distinguished per the
convention established in every prior `SUN-1222C*` checkpoint: an
"intentional 402 qualification" in the `ADR-0055`/facilitator sense means
constructing and submitting a `PaymentPayload`, which did not happen here.
```
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_SERVICE_POSTS=0
FACILITATOR_SETTLEMENT_ATTEMPTS=0
SERVICE_USDC_SETTLEMENTS=0
```
The funding transaction prepared in §13-14 (not yet submitted) is a plain
wallet-to-wallet `ERC-20 transfer`, not a SITEBORNE service payment.

## 21. Next payment order

Freeze (unchanged from §9):
```
1. document_evidence_json.v2
2. verify_agent_output.v2
3. web_context_verified.v2
4. company_evidence_graph.v2
```
Reason: document is the only `upto` service with a large temporary
authorization-liquidity requirement; qualifying it first while the buyer
is freshly funded to the ceiling minimizes total external top-up, leaving
ample balance (`178000`, expected) for the three subsequent fixed-price
qualifications without a second funding round.

## 22. Final packet

```
SUN1222C_QUALIFICATION_FUNDING=BLOCKED (awaiting human-operator signing — not a failure, the designed stop point)
QUALIFICATION_FUNDING_AUTHORIZATION=PRESENT
CANDIDATE_VERSION=3a74686d-bad8-4fb0-b6b8-604292145d69
PRODUCTION_TRAFFIC_PERCENT=100
CANDIDATE_TRAFFIC_PERCENT=0
DOCUMENT_SCHEME=upto
DOCUMENT_AUTHORIZATION_CEILING_ATOMIC=190000
DOCUMENT_QUALIFICATION_EXPECTED_PRICE_ATOMIC=12000
DOCUMENT_QUALIFICATION_PRICE_BOUND=PASS
REMAINING_THREE_QUALIFICATION_TOTAL_ATOMIC=67000
ORDER_A_MINIMUM_TOPUP_ATOMIC=177273
ORDER_B_MINIMUM_TOPUP_ATOMIC=110273
FUNDING_SAVINGS_FROM_DOCUMENT_FIRST_ATOMIC=67000
OPTIMAL_QUALIFICATION_ORDER=[document_evidence_json.v2, verify_agent_output.v2, web_context_verified.v2, company_evidence_graph.v2]
BUYER_BALANCE_BEFORE_ATOMIC=79727
MINIMUM_TOPUP_ATOMIC=110273
FUNDING_SOURCE_PUBLIC_ADDRESS=UNKNOWN (operator-controlled, not disclosed to this session)
FUNDING_TRANSFERS=0
FUNDING_TX_HASH=NOT_YET_SUBMITTED
FUNDING_TX_STATUS=NOT_YET_SUBMITTED
FUNDING_TRANSFER_MATCH_COUNT=0
FUNDING_AMOUNT_ATOMIC=0 (frozen target: 110273, not yet transferred)
BUYER_BALANCE_AFTER_ATOMIC=NOT_YET_APPLICABLE
DOCUMENT_AUTHORIZATION_CEILING_COVERED=NO (pending funding)
EXPECTED_BALANCE_AFTER_DOCUMENT_ATOMIC=178000 (190000 - 12000, once funded and qualified)
EXPECTED_BALANCE_AFTER_ALL_FOUR_ATOMIC=111000 (178000 - 67000, once funded and all four qualified)
SERVICE_402_REQUESTS_FOR_PAYMENT=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_SERVICE_POSTS=0
FACILITATOR_SETTLEMENT_ATTEMPTS=0
SERVICE_USDC_SETTLEMENTS=0
SUN1222C_FUNDING_EVIDENCE_COMMIT_SHA=(this commit)
WORKING_TREE=clean
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-QUALIFICATION-FUNDING (resume at §15 once operator reports tx hash)
```

`DO NOT QUALIFY DOCUMENT YET. DO NOT CREATE PAYMENT MATERIAL. DO NOT
QUALIFY ANOTHER SERVICE.` — all honored; none were performed.
