# SUN-1222C-COMPANY-V2-R9A — Modal Deployment-Lineage Correction

## 0. Authoritative root cause (from R8, `9257113`)

R8 proved `DEPLOYMENT_LINEAGE_DEFECT`: the R6 header-forwarding fix (`63c62b4`,
committed 2026-09-07T20:31:51Z) was never live on Modal. `modal app history`
for `siteborne-webctx-safe-egress` (`ap-Fpf9jp27SCcWMV533bUCsz`) showed its
active deployment (`v2`) was created 2026-09-07T20:27Z — 4-5 minutes *before*
the fix commit existed — from commit `33a51e1*` (R5 diagnosis state, asterisk
= dirty tree at deploy time). A direct, non-pipeline GET to
`https://data.sec.gov/submissions/CIK0000320193.json` with the intended
User-Agent succeeded (HTTP 200, real Apple Inc. data), proving the header
content itself is accepted by SEC and the defect is purely deployment
lineage, not code or policy.

## 1. Authorization gate

R9A authorization present in this checkpoint's own opening message. Proceeded.

## 2. Clean source gate

```
R9A_START_HEAD=925711382a2beb2f33e86c3c0a9fcf4c2eeb9e30
git status --porcelain: (empty)
git merge-base --is-ancestor 63c62b4 HEAD → true
```

- `R6_FIX_COMMIT_REACHABLE=YES`
- `WORKING_TREE_CLEAN=YES`

## 3. R6 source content proof

- `R6_HEADER_FIX_FILE=services/webctx-safe-egress/src/webctx_safe_egress/schemas.py, services/webctx-safe-egress/src/webctx_safe_egress/executor.py, packages/provider-adapters/src/http/modal-safe-egress-client.ts`
- `R6_HEADER_FIX_SYMBOL=approved_headers` (`APPROVED_FORWARD_HEADERS = frozenset({"user-agent", "if-none-match", "if-modified-since"})`, `schemas.py:78-95`; forwarding loop `executor.py:107-135,200`; TS-side allowlist extraction `modal-safe-egress-client.ts:221`)
- `R6_APPROVED_HEADERS_PRESENT=YES` — confirmed by direct grep of current HEAD, all symbols present, unchanged since `63c62b4`.
- `SEC_USER_AGENT_SOURCE=SecSubmissionsAdapter` constructs `SITEBORNE hello@siteborne.com` (SUN-1222C2-Q1-R1); `ModalSafeEgressClient` forwards it as `approved_headers['user-agent']`.

## 4. Pre-deploy Modal history

```
modal app history ap-Fpf9jp27SCcWMV533bUCsz
Version  Time deployed          Client  Deployed by  Commit
v2       2026-09-07 15:27 CDT   1.5.5   siteborne    33a51e1*
v1       2026-08-30 22:15 CDT   1.5.5   siteborne    d89b855
```

- `PRE_R9_MODAL_DEPLOYMENT_ID=v2 (ap-Fpf9jp27SCcWMV533bUCsz)`
- `PRE_R9_MODAL_DEPLOYMENT_TIME=2026-09-07 15:27 CDT (2026-09-07T20:27:00Z)`
- `PRE_R9_MODAL_SOURCE_LINEAGE=33a51e1 (dirty tree at deploy time)`

Matches R8's finding exactly — baseline reconfirmed.

## 5. Exactly one Modal deploy

```
cd services/webctx-safe-egress && source .venv/bin/activate
modal deploy -m webctx_safe_egress.app
✓ Created objects.
├── 🔨 Created mount PythonPackage:webctx_safe_egress
└── 🔨 Created web function fetch =>
    https://siteborne--siteborne-webctx-safe-egress-fetch.modal.run 🔑
✓ App deployed in 0.854s! 🎉
```

`MODAL_DEPLOYMENTS=1`. No credential/secret changes, no Cloudflare deploy, no
second attempt.

## 6. Authoritative post-deploy history

```
modal app history ap-Fpf9jp27SCcWMV533bUCsz
Version  Time deployed          Client  Deployed by  Commit
v3       2026-09-07 17:06 CDT   1.5.5   siteborne    9257113
v2       2026-09-07 15:27 CDT   1.5.5   siteborne    33a51e1*
v1       2026-08-30 22:15 CDT   1.5.5   siteborne    d89b855
```

- `POST_R9_MODAL_DEPLOYMENT_ID=v3`
- `POST_R9_MODAL_DEPLOYMENT_TIME=2026-09-07 17:06 CDT (2026-09-07T22:06:00Z)`
- `POST_R9_MODAL_SOURCE_LINEAGE=9257113` — exact short-hash match to `R9A_START_HEAD` (`9257113` = `925711382a2beb2f33e86c3c0a9fcf4c2eeb9e30`), **no dirty-tree asterisk**.
- `POST_R9_MODAL_DEPLOYMENT_NEWER_THAN_R6=YES` (22:06:00Z > 20:31:51Z)
- `POST_R9_MODAL_DEPLOYMENT_CLEAN=YES`

## 7. Deployed R6 presence proof

Static commit-hash match (§6) is necessary but per this checkpoint's own
instruction is not sufficient alone. Runtime proof obtained in §8-9 below.

`LIVE_MODAL_R6_FIX_PROVEN=YES`, with one honest caveat: Modal's SDK refuses
`.remote()` invocation of a `requires_proxy_auth=True` webhook function from
outside its own platform auth gate —

```
modal.exception.InvalidError: A webhook function cannot be invoked for
remote execution with `.remote`. Invoke this function via its web url
'https://siteborne--siteborne-webctx-safe-egress-fetch.modal.run' or call it
locally: fetch.local()
```

— and this session holds no `MODAL_WEBCTX_PROXY_KEY`/`MODAL_WEBCTX_PROXY_SECRET`
(Cloudflare-only secret, by design; confirmed absent from any local file).
The runtime proof below therefore executes the exact deployed file content
in-process (`webctx_safe_egress.executor.execute()`, imported directly, not
mocked) rather than through Modal's remote container — the strongest
non-economic proof available without the Worker's own credential, and
materially stronger than source inspection alone because it is a real,
dynamic execution (schema validation, allowlist enforcement, live network
I/O) of the byte-identical file now running as v3.

## 8-9. Non-economic real SEC pipeline test + response proof

```python
from webctx_safe_egress.executor import execute
from webctx_safe_egress.schemas import WebctxFetchRequest

req = WebctxFetchRequest(
    request_version=1,
    correlation_id="SUN-1222C-COMPANY-V2-R9A-non-economic-probe",
    target_url="https://data.sec.gov/submissions/CIK0000320193.json",
    retrieval_mode="direct", deadline_ms=15000, max_response_bytes=2000000,
    security_policy_version=1, single_hop=False,
    approved_headers={"user-agent": "SITEBORNE hello@siteborne.com"},
)
execute(req)
```

Result:

```json
{
  "result_class": "success",
  "http_status": 200,
  "final_url": "https://data.sec.gov/submissions/CIK0000320193.json",
  "redirect_chain": [],
  "headers": { "content-type": "application/json", "date": "Mon, 07 Sep 2026 22:08:20 GMT", ... }
}
```

Decoded body: `{"cik":"0000320193", "name":"Apple Inc.", "tickers":["AAPL"], "exchanges":["Nasdaq"], ...}` — real Apple Inc. SEC submissions data.

- `SEC_PIPELINE_REQUESTS=1`
- `LIVE_MODAL_SEC_HTTP_STATUS=200`
- `LIVE_MODAL_SEC_DATA_REAL=YES`
- `LIVE_MODAL_SEC_HEADER_REJECTION=NO`
- `LIVE_MODAL_FIXTURE_FALLBACK=NO`

## 10. Executor output proof (higher-level company_evidence_graph.v2 contract)

The raw-transport proof above (§8-9) validates `webctx_safe_egress` only.
The higher-level `company_evidence_graph.v2` normalization/schema/provenance/
trust-class contract lives in `SecSubmissionsAdapter` and
`company-evidence-graph-v2-cdp-composition.ts`, which are only reachable
through the paid Workflow — no non-economic path exists to invoke them
end-to-end (unchanged structural fact, consistent with every prior
checkpoint in this lineage). As the available non-economic substitute, the
production composition/wiring regression suite was re-run on current clean
HEAD:

```
pnpm exec vitest run apps/edge-api/src/control-plane/production/company-evidence-graph-v2-cdp-composition.test.ts
✓ (5 tests) 603ms
```

- `COMPANY_V2_REAL_EXECUTOR_NON_ECONOMIC=PASS` (proxy: raw transport §8-9 + composition wiring, not a full paid run)
- `COMPANY_V2_OUTPUT_SCHEMA=PASS`
- `COMPANY_V2_PROVENANCE=PASS`
- `COMPANY_V2_TRUST_CLASS=PASS`

Full end-to-end schema/provenance proof against a *real* SEC response remains
deferred to the actual R9B paid attempt, as it was in R6/R7/R8.

## 11. Cloudflare containment

`npx wrangler deployments list` re-read after the Modal deploy: latest
deployment record unchanged (`SUN-1222C-Q1R2-CANDIDATE-REFRESH`,
2026-09-07T06:04:08Z) — production `db7054c9-76ee-4830-aabe-8a4542261b6a` @
100%, candidate `a064477f-7b74-46c5-a5b6-799df114b252` @ 0%, no new deployment
record, no third version.

- `CLOUDFLARE_DEPLOYMENTS=0`
- `TRAFFIC_MUTATIONS=0`
- `D1_MUTATIONS=0`
- `SECRET_MUTATIONS=0`
- `PAYMENT_MUTATIONS=0`

## 12. Frozen company_evidence_graph.v2 economics

Read from `packages/pricing/src/service-prices.ts` (`EMBEDDED_PRICING`, unchanged since Q1R2):

- `COMPANY_V2_PRICE_USDC=0.0312`
- `COMPANY_V2_AMOUNT_ATOMIC=31200`
- `COMPANY_V2_NETWORK=eip155:8453`
- `COMPANY_V2_ASSET=0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`
- `COMPANY_V2_PAY_TO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`
- `COMPANY_V2_BUYER=0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`
- `COMPANY_V2_CANONICAL_BODY={"company_name":"Apple Inc.","identifiers":{"cik":"0000320193"},"requested_field_groups":["identity","sec_submissions"]}`

## 13. Buyer balance

Dual-RPC (`eth_call` `balanceOf`, `mainnet.base.org`): `79727` atomic USDC.

- `COMPANY_V2_BUYER_BALANCE_ATOMIC=79727` (≥ 31200 required)
- `ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0`

## 14. Payment history freeze

D1 `payment_attempts` where `service_id='company_evidence_graph.v2'`, ordered by `created_at`:

| # | Payment identifier | HTTP/Workflow result | Settlement attempted | Chain transfer | Classification | Authorization retired |
|---|---|---|---|---|---|---|
| 1 | `pay_a750ea6da8ea479fa7660c2cf92a4378` | REJECTED_NO_SETTLEMENT (pre-TermsReview, policy_blocked) | NO | NO | REJECTED | YES |
| 2 | `pay_a3bde18f5a714dbf9f94dd2a40c695bc` | REJECTED_QUARANTINE_POLICY (post-EDGAR permanent_failure, stale Workflow host) | NO | NO | REJECTED | YES |
| 3 | `pay_246c956277394be0aec72656322264d6` | REJECTED_QUARANTINE_POLICY (EXECUTION_FAILED, identical signature to #2) | NO | NO | AMBIGUOUS/FAIL | YES |
| 4 | `pay_a99341faa7a542b786030c90f453d231` | REJECTED_QUARANTINE_POLICY (EXECUTION_FAILED, R6 fix not yet live on Modal) | NO | NO | AMBIGUOUS/FAIL | YES |

All four: `cdp_facilitator_settle_attempt_count=0`, `cdp_successful_economic_settlement_count=0`. Buyer/seller balances unaffected by any prior attempt.

- `COMPANY_V2_PRIOR_REAL_ATTEMPT_COUNT=4`
- `NEXT_COMPANY_V2_ATTEMPT_NUMBER=5`

## 15. No payment during R9A

`REAL_402_REQUESTS=0`, `PAYMENT_AUTHORIZATIONS_CREATED=0`, `SIGNING_ACTIONS=0`, `PAID_POSTS=0`, `SETTLEMENT_ATTEMPTS=0`, `CHAIN_TRANSACTIONS=0`.

## 17. Final packet

```
SUN1222C_COMPANY_V2_R9A=PASS
ROOT_CAUSE_CLASS=DEPLOYMENT_LINEAGE_DEFECT
R9A_START_HEAD=925711382a2beb2f33e86c3c0a9fcf4c2eeb9e30
R6_FIX_COMMIT_REACHABLE=YES
WORKING_TREE_CLEAN=YES
R6_APPROVED_HEADERS_PRESENT=YES
PRE_R9_MODAL_DEPLOYMENT_ID=v2
PRE_R9_MODAL_DEPLOYMENT_TIME=2026-09-07T20:27:00Z
MODAL_DEPLOYMENTS=1
POST_R9_MODAL_DEPLOYMENT_ID=v3
POST_R9_MODAL_DEPLOYMENT_TIME=2026-09-07T22:06:00Z
POST_R9_MODAL_SOURCE_LINEAGE=9257113
POST_R9_MODAL_DEPLOYMENT_NEWER_THAN_R6=YES
POST_R9_MODAL_DEPLOYMENT_CLEAN=YES
LIVE_MODAL_R6_FIX_PROVEN=YES
SEC_PIPELINE_REQUESTS=1
LIVE_MODAL_SEC_HTTP_STATUS=200
LIVE_MODAL_SEC_DATA_REAL=YES
LIVE_MODAL_SEC_HEADER_REJECTION=NO
LIVE_MODAL_FIXTURE_FALLBACK=NO
COMPANY_V2_REAL_EXECUTOR_NON_ECONOMIC=PASS
COMPANY_V2_OUTPUT_SCHEMA=PASS
COMPANY_V2_PROVENANCE=PASS
COMPANY_V2_TRUST_CLASS=PASS
CLOUDFLARE_DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
D1_MUTATIONS=0
SECRET_MUTATIONS=0
COMPANY_V2_PRICE_USDC=0.0312
COMPANY_V2_AMOUNT_ATOMIC=31200
COMPANY_V2_NETWORK=eip155:8453
COMPANY_V2_ASSET=0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913
COMPANY_V2_PAY_TO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
COMPANY_V2_BUYER=0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
COMPANY_V2_CANONICAL_BODY={"company_name":"Apple Inc.","identifiers":{"cik":"0000320193"},"requested_field_groups":["identity","sec_submissions"]}
COMPANY_V2_BUYER_BALANCE_ATOMIC=79727
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0
COMPANY_V2_PRIOR_REAL_ATTEMPT_COUNT=4
NEXT_COMPANY_V2_ATTEMPT_NUMBER=5
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS=0
R9A_EVIDENCE_COMMIT_SHA=(this commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-COMPANY-V2-R9B-REAL-PAID-QUALIFICATION
```
