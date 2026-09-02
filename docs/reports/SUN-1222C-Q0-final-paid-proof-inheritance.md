# SUN-1222C-Q0 — Final Paid-Proof Inheritance + Two-Service Funding Lock

Read-only. Zero mutations of any kind (no commits touching source/config, no
deploy, no traffic change, no secret mutation, no payment material, no
signing, no paid POST, no settlement, no USDC transfer).

## 0. Current read-only finding (input to this checkpoint)

Prior analysis (this session, pre-Q0) concluded 2 new real payments required
(company_evidence_graph.v2, document_evidence_json.v2). This checkpoint
re-derives that conclusion from the actual final candidate contract rather
than accepting it as given.

## 1. Candidate manifest

```
CANDIDATE_SOURCE_HEAD=6b273f0c2b9e6c861a25bf3d161b34d7a358b541
WORKING_TREE_CLEAN=YES (no source/config changes made this checkpoint)
```

Candidate lineage since last qualification checkpoint (SUN-1222C, 2d9a93d):
only `6b273f0` (SUN-1222C-QUALIFICATION-FUNDING evidence — no source/config
touched, funding stopped at signing boundary, no transfer executed).

`CANDIDATE_SERVICE_MATRIX`: four services registered — `company_evidence_graph.v2`
(`POST /v2/company/evidence-graph`), `web_context_verified.v2`
(`POST /v2/web-context/verify`), `document_evidence_json.v2`
(`POST /v2/document/evidence-json`), `verify_agent_output.v2`
(`POST /v2/verify/agent-output`).

`CANDIDATE_PRICE_CARD` (from `governance/RISK_LIMITS.yaml` v1.0.0,
`max_price_usd_per_service`, embedded copy verified byte-identical in
[`packages/pricing/src/service-prices.ts`](../../packages/pricing/src/service-prices.ts)):

| pricingKey | USD | atomic (6dp) |
|---|---|---|
| `verify_agent_output_standard` | 0.019 | 19000 |
| `web_context_verified_direct` | 0.009 | 9000 |
| `company_evidence_graph` | 0.039 | 39000 |
| `document_evidence_json_native` | 0.012 | 12000 |
| `document_evidence_json_ocr` | 0.019 | 19000 |
| `document_evidence_json_table` | 0.029 | 29000 |
| `document_evidence_json_max_job` | 0.19 | 190000 |

`CANDIDATE_NETWORK` / `CANDIDATE_ASSET` / `CANDIDATE_PAY_TO`: all four
services call the identical shared helpers
`resolvePaymentNetwork(productionAuthorization)` and
`resolvePaymentAsset(network)`, and all four set `payTo: env.SELLER_WALLET_ADDRESS`
verbatim ([`company-evidence-graph-v2-cdp-composition.ts:137,190,200`](../../apps/edge-api/src/control-plane/production/company-evidence-graph-v2-cdp-composition.ts),
[`document-evidence-json-v2-cdp-composition.ts:143,198,208`](../../apps/edge-api/src/control-plane/production/document-evidence-json-v2-cdp-composition.ts),
[`verify-agent-output-v2-cdp-composition.ts:146,215,225`](../../apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts),
[`web-context-v2-cdp-composition.ts:194,253,263`](../../apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.ts)).
No per-service divergence in network/asset/payTo resolution exists anywhere
in the candidate.

`CANDIDATE_SETTLEMENT_OWNER`: single shared durable Workflow
(`c.env.PAID_CONTINUATION_WORKFLOW`), required identically by all four route
files — none has an alternate settlement path.

No candidate upload performed or needed this checkpoint (existing candidate
`3a74686d-bad8-4fb0-b6b8-604292145d69` remains byte-identical to this source,
confirmed unchanged in SUN-1222C).

## 2–3. `verify_agent_output.v2` — historical proof vs. candidate

Historical qualified economics (SUN-1220O first real paid E2E,
SUN-1220Q6 100% production promotion):
`PRICE_USDC=0.019`, `AMOUNT_ATOMIC=19000`, network/asset/payTo per the
shared resolvers above.

Candidate: `pricingKey: 'verify_agent_output_standard'` → `resolveServiceMaxPriceUsd` →
`0.019` → `19000` atomic (identical arithmetic path, `packages/pricing/src/service-prices.ts`
unchanged since embedding). `verify-agent-output-v2-cdp-composition.ts` has
not been touched since `9e37edf` (SUN-1220L), which predates and is included
in the qualified proof.

```
VERIFY_HISTORICAL_PRICE=0.019
VERIFY_HISTORICAL_AMOUNT=19000
VERIFY_HISTORICAL_NETWORK=<shared resolver, unchanged>
VERIFY_HISTORICAL_ASSET=<shared resolver, unchanged>
VERIFY_HISTORICAL_PAY_TO=SELLER_WALLET_ADDRESS

VERIFY_PRICE_UNCHANGED=YES
VERIFY_NETWORK_UNCHANGED=YES
VERIFY_ASSET_UNCHANGED=YES
VERIFY_PAY_TO_UNCHANGED=YES
VERIFY_PAYMENT_ARCHITECTURE_UNCHANGED=YES
VERIFY_EXECUTOR_SEMANTICS_MATERIALLY_UNCHANGED=YES
VERIFY_PCC_RECEIPT_SEMANTICS_UNCHANGED=YES
VERIFY_SETTLEMENT_OWNER_UNCHANGED=YES
```

## 3. Verify inheritance decision

```
VERIFY_OUTPUT_NEW_PAYMENT_REQUIRED=NO
```

## 4–5. `web_context_verified.v2` — historical proof vs. candidate

Historical qualified economics (SUN-1221E real paid E2E): `PRICE_USDC=0.009`,
`AMOUNT_ATOMIC=9000`. Candidate: `pricingKey: 'web_context_verified_direct'`
→ `0.009` → `9000` atomic (unchanged). `web-context-v2-cdp-composition.ts`
last touched at `bfb2c45` (SUN-1221E5Q6G), which predates and is included in
the qualified proof.

```
WEBCTX_PRICE_UNCHANGED=YES
WEBCTX_NETWORK_UNCHANGED=YES
WEBCTX_ASSET_UNCHANGED=YES
WEBCTX_PAY_TO_UNCHANGED=YES
WEBCTX_PAYMENT_ARCHITECTURE_UNCHANGED=YES
WEBCTX_EXECUTOR_SEMANTICS_MATERIALLY_UNCHANGED=YES
WEBCTX_PCC_RECEIPT_SEMANTICS_UNCHANGED=YES
WEBCTX_SETTLEMENT_OWNER_UNCHANGED=YES
```

No lower-price candidate (e.g. 0.008/8000) exists anywhere in the current
source — the 0.009/9000 value is the one and only value present in
governance and its embedded copy.

## 5. Web-context inheritance decision

```
WEB_CONTEXT_NEW_PAYMENT_REQUIRED=NO
```

## 6. Company graph

No evidence report in `docs/reports/` documents a completed real x402
settlement for `company_evidence_graph.v2`. `SUN-1213` explicitly recorded
404/never-paid status; no later report supersedes that with a completed
settlement.

```
COMPANY_PRIOR_REAL_PAID_PROOF=NO
COMPANY_GRAPH_NEW_PAYMENT_REQUIRED=YES
```

## 7. Document evidence

Real Modal executor proof exists (`SUN-1222C-1-REMEDIATION`, authenticated
201 + R2 write, real PDF text extraction). Real buyer-input path proof
exists (same checkpoint: real-app assembled regression, middleware fix,
`POST /v2/artifacts/documents` reachable end to end). Neither constitutes a
completed x402 real paid settlement — no evidence report anywhere records a
completed `document_evidence_json.v2` payment.

```
DOCUMENT_REAL_EXECUTOR_PROOF=YES
DOCUMENT_BUYER_INPUT_PATH_PROOF=YES
DOCUMENT_PRIOR_REAL_PAID_PROOF=NO
DOCUMENT_EVIDENCE_NEW_PAYMENT_REQUIRED=YES
```

## 8. Document input-path materiality

Traced in source: buyer `POST /v2/artifacts/documents` (D1-backed,
capability-token artifact id, 900s TTL) → `artifact_reference` input to
`document_evidence_json.v2` → `documentEvidenceJsonV2CdpProductionRoute` →
real Modal executor → `documentUsageToAtomicUnits` measured actual amount →
signed PCC/receipt. This is the sole buyer-input mechanism in current
source; no alternate `document_url` path is wired to the production route.

```
DOCUMENT_FINAL_BUYER_PATH_READY=YES
```

## 9. Final price lock for the two never-paid services

```
COMPANY_GRAPH_PRICE_USDC=0.039
COMPANY_GRAPH_AMOUNT_ATOMIC=39000
DOCUMENT_PRICING_MODEL=upto (authorization ceiling 190000 atomic / $0.19; actual
  settlement measured post-execution via calculateDocumentUsage() per-page tier)
DOCUMENT_QUALIFICATION_REQUEST=one native-text (no OCR, no tables) single page
DOCUMENT_QUALIFICATION_PRICE_USDC=0.012
DOCUMENT_QUALIFICATION_AMOUNT_ATOMIC=12000
```

Derivation (`packages/pricing/src/document-usage.ts`): a page with
`ocr_used=false, table_count=0` classifies to tier `native` →
`document_evidence_json_native` = `0.012` → `12000` micro-USD → `12000`
atomic (6dp), well under the `190000` max-job ceiling (`capped=false`).

## 10. Recompute total payment count

```
TOTAL_NEW_REAL_PAYMENTS_REQUIRED=2
```

Both verify and web-context retain their exact previously-qualified
economics and unchanged material path semantics (§3, §5); no unexpected
third or fourth payment is triggered.

## 11. Buyer balance (fresh read-only)

Fresh `eth_call` `balanceOf()` against Base mainnet USDC contract
`0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913` for
`0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`, block `50795711`
(`0x30714bf`):

```
BUYER_BALANCE_ATOMIC=79727
```

Unchanged from the last read (`SUN-1222C-QUALIFICATION-FUNDING` stopped at
the signing boundary; no transfer was executed since).

## 12. Qualification funding

```
VERIFY_QUALIFICATION_REQUIRED_ATOMIC=0
WEBCTX_QUALIFICATION_REQUIRED_ATOMIC=0
COMPANY_QUALIFICATION_REQUIRED_ATOMIC=39000    (exact scheme: buyer must hold >= this to authorize)
DOCUMENT_QUALIFICATION_REQUIRED_ATOMIC=190000  (upto scheme: buyer must hold >= the ceiling to authorize;
                                                  actual measured settlement is only 12000 of that)
TOTAL_REQUIRED_ATOMIC=229000
BUYER_BALANCE_ATOMIC=79727
FUNDING_HEADROOM_ATOMIC=-149273
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=149273
```

`229000 = 39000 (company, exact) + 190000 (document, upto ceiling)`.
`149273 = 229000 - 79727`. This holds regardless of qualification order:
company settles for its full authorized amount (exact scheme, balance drops
by exactly 39000), so funding to cover both sequentially or fund the ceiling
up front is arithmetically identical either way.

No commercial price was altered to fit wallet funding.

## 13. Qualification order

```
FINAL_REAL_PAYMENT_QUALIFICATION_ORDER=[company_evidence_graph.v2, document_evidence_json.v2]
```

Company first (exact scheme, smaller absolute ceiling, no upload
prerequisite) minimizes total temporary funding need and sequencing
complexity; document requires a prior non-economic buyer upload step (§16).
The two previously-qualified services need no further economic test.

## 14. Payment isolation

Each of the two required future payments will use: a separate standalone
authorization message, a fresh `402` challenge, a fresh EIP-3009
authorization, a fresh nonce, a fresh validity window, one human signing
action, one paid POST, and at most one settlement attempt. No standing
authorization covers more than one payment; no payment material will be
reused between the two.

## 15. Company future qualification body

```
COMPANY_CANONICAL_QUALIFICATION_BODY=(smallest real representative company-name/domain
  input the production route accepts — frozen at qualification-authorization time,
  not invented ahead of it)
COMPANY_EXPECTED_EXECUTOR=real bounded external-source executor (<=3 calls, no
  reranking, no unbounded fan-out — SUN-1222B-S3-CONTINUE)
COMPANY_EXPECTED_OUTPUT_CLASS=structured company evidence graph + PCC receipt
```

No execution performed.

## 16. Document future qualification body

```
DOCUMENT_UPLOAD_REQUIRED=YES
DOCUMENT_UPLOAD_ENDPOINT=POST /v2/artifacts/documents (non-economic, buyer-authenticated,
  D1-backed capability token, 900s TTL)
DOCUMENT_CANONICAL_QUALIFICATION_INPUT=artifact_reference to one uploaded single-page,
  native-text (no OCR, no tables) PDF
DOCUMENT_EXPECTED_EXECUTOR=real Modal document-worker (authenticated, live-qualified
  in SUN-1222C-1-REMEDIATION)
DOCUMENT_EXPECTED_OUTPUT=structured document evidence JSON + PCC receipt, actual
  settlement 12000 atomic under the 190000 atomic authorization ceiling
```

No upload performed this checkpoint.

## 17. Funding decision

```
FUNDING_MUTATION_REQUIRED=YES
```

No transfer performed. Minimum exact amount prepared: `149273` atomic Base
USDC to raise the buyer from `79727` to `229000` atomic, covering both
remaining qualifications' authorization requirements in sequence. Stops here
for separate standalone authorization before any transfer.

## 18. Final packet

```
SUN1222C_Q0=PASS

CANDIDATE_SOURCE_HEAD=6b273f0c2b9e6c861a25bf3d161b34d7a358b541

VERIFY_OUTPUT_PRIOR_REAL_PAID_PROOF=YES
VERIFY_PRICE_UNCHANGED=YES
VERIFY_PAYMENT_ARCHITECTURE_UNCHANGED=YES
VERIFY_OUTPUT_NEW_PAYMENT_REQUIRED=NO

WEB_CONTEXT_PRIOR_REAL_PAID_PROOF=YES
WEBCTX_PRICE_UNCHANGED=YES
WEBCTX_PAYMENT_ARCHITECTURE_UNCHANGED=YES
WEB_CONTEXT_NEW_PAYMENT_REQUIRED=NO

COMPANY_PRIOR_REAL_PAID_PROOF=NO
COMPANY_GRAPH_NEW_PAYMENT_REQUIRED=YES
COMPANY_GRAPH_PRICE_USDC=0.039
COMPANY_GRAPH_AMOUNT_ATOMIC=39000

DOCUMENT_PRIOR_REAL_PAID_PROOF=NO
DOCUMENT_REAL_EXECUTOR_PROOF=YES
DOCUMENT_BUYER_INPUT_PATH_PROOF=YES
DOCUMENT_FINAL_BUYER_PATH_READY=YES
DOCUMENT_EVIDENCE_NEW_PAYMENT_REQUIRED=YES
DOCUMENT_QUALIFICATION_PRICE_USDC=0.012
DOCUMENT_QUALIFICATION_AMOUNT_ATOMIC=12000

TOTAL_NEW_REAL_PAYMENTS_REQUIRED=2
FINAL_REAL_PAYMENT_QUALIFICATION_ORDER=[company_evidence_graph.v2, document_evidence_json.v2]

BUYER_BALANCE_ATOMIC=79727
TOTAL_REQUIRED_ATOMIC=229000
FUNDING_HEADROOM_ATOMIC=-149273
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=149273
FUNDING_MUTATION_REQUIRED=YES

PRODUCTION_MUTATIONS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
REAL_PAID_POSTS=0
ECONOMIC_TRANSACTIONS=0

NEXT_REQUIRED_CHECKPOINT=SUN-1222C-QUALIFICATION-FUNDING
```

(Funding insufficient by `149273` atomic — routes to
`SUN-1222C-QUALIFICATION-FUNDING`, not directly to candidate deployment.)
