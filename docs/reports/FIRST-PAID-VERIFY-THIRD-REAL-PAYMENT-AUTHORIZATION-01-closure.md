# FIRST-PAID-VERIFY-THIRD-REAL-PAYMENT-AUTHORIZATION-01 — closure

Status: **VERIFY_STANDARD_REAL_PAYMENT = PASS.** One real verify-standard
payment settled end to end; every economic, on-chain and result identity
reconciles. Replay/idempotency and caller-bound retrieval were **not exercised**
(justified in sections 8-9). Several non-economic bookkeeping gaps are recorded,
not fixed.

This closure phase was read-only: no payment, signature, replay, deployment,
rollback, refund, secret change, job mutation, traffic change or push. No
secret, JWT, signature or credential appears in this report. Times are UTC
unless marked local (operator's local zone is UTC-5).

## 1. Manual signing boundary and client result

- Human ran `pnpm first-paid-e2e` exactly once (2026-09-20 ~19:46Z, 14:46
  local). Live test timeout 90 s, automatic retry disabled, one signed
  submission.
- Client output: `ok=true`, `stage=RESULT_OBSERVED`,
  `submission_result=success`, `http_status=200`, `settlement_observed=true`,
  `transaction_hash=0x831725da0467ebb826389bb7e743819cc8ae75348eacdb892031e59732bf975d`,
  `receipt_id=rcpt_bc961249855b79fe3e377564`, `service_execution_observed=false`
  (false negative, section 11).
- Harness hashes at closure: `first-paid-e2e-local.test.ts`
  `488913a63a763fff74fb1d26708e4a48d2a1db1ba1d703e1e4261f7a9b141698`;
  `scripts/first-paid-e2e.ts`
  `3eff1e47095fb1c61c463152fcac825b340bfee6525383b64283135fcea4dc05`. HEAD
  `f1fcf0868baf4eab913b4b8d9dbf30b487205406`, tree clean.

## 2. Version attribution

### 2a. Continuation host — PASS (direct evidence)

Retained `wrangler tail` capture (`/tmp/tp01/host-tail.jsonl`, written by the
prior turn's telemetry step, not created in this checkpoint) contains one event:

| Field                    | Value                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| `scriptName`             | `siteborne-paid-continuation-runtime`                                         |
| `scriptVersion.id`       | `9b1e9b10-beed-4ff3-914c-2221aada9b45`                                        |
| `tailAttributes`         | workflow `siteborne-paid-continuation`, instance `siteborne-wf-c670a797…3c8b` |
| `eventTimestamp`         | 1789933612829 = `2026-09-20T19:46:52.829Z` (= Workflow `Start`)               |
| `outcome` / `exceptions` | `ok` / `[]`                                                                   |

Corroboration: deployment history shows 9b1e9b10 sole at 100% since
`2026-09-20T19:13:40Z`, no later deployment; Workflow ran 19:46:52-19:46:55Z.

Caution recorded: the `wrangler workflows instances describe` "Version Id"
(`274647a4-…`) is **identical** for the failed (11:10 local, host 2833ed03) and
the successful (14:46 local, host 9b1e9b10) instances. It is a
Workflow-definition version, not a Worker `scriptVersion.id`, and was **not**
used as evidence.

### 2b. Public verify request — PARTIAL

No CF-Ray or `scriptVersion.id` was retained for the 19:46:48-49Z public
requests: the only public tail capture (`/tmp/tp01/tail.jsonl`) ends 19:38:39Z,
before the payment, and the client does not log CF-Ray. Strongest evidence:

1. Harness pins `CANDIDATE_VERSION_ID=0456f44c-1c28-4919-9fdb-ab4673bac8f6` and
   attaches the override header to both the unpaid and the paid request (test
   file lines 117-125, 420, 550; test S/T asserts identical values).
2. Ordinary production 369b4bf5 does not mount the paid route (404), so a
   402→200 sequence required a paid-enabled version.
3. Of all uploaded public versions, only `0456f44c` (newest, 2026-09-20T15:33Z)
   contains the JWT-init fix. Every earlier paid-enabled canary (2b44db89,
   81cca759, 8cddb16e, a6acfc75, 0546d6b7, bece9f41) was pre-fix and failed CDP
   JWT construction; facilitator `/verify` passed here, which they could not do.

Limitation: elimination, not a direct version stamp. The override header alone
was not treated as proof. Attribution = PARTIAL.

## 3. Causal chain — PASS

| Stage                   | Evidence                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Fresh quote             | `qte_b80393f52a0d70734ae278ee`, `payment_required_created` 19:46:48.716Z           |
| Requirement             | `req_171f123dbb550818f27b0383`; amount 17000, eip155:8453, USDC, payTo as governed |
| Signed payload received | `payment_payload_received` (valid, rail cdp) 19:46:49.193Z; attempt `d14c1727-…`   |
| Job                     | `acf8fab2-0011-4267-a0ad-82e410612f55` created 19:46:49.290Z                       |
| Facilitator `/verify`   | requested 19:46:49.635Z → `payment_verified` 19:46:49.765Z                         |
| Execution               | `service_execution_started` 19:46:49.850Z                                          |
| Workflow                | instance `siteborne-wf-c670a797…`, Completed, 19:46:52-55Z, all 7 steps succeeded  |
| Settlement              | step `settle-1` 19:46:53-54Z, `kind=confirmed`, tx `0x831725da…f975d`              |
| Result                  | `x402_service_results` row 19:46:54.751Z, HTTP 200, PCC body                       |
| Finalization            | link evidence verified 19:46:54.795Z, settled 19:46:54.881Z; job `DELIVERED`       |

Attempt row: `lifecycle_stage=settled`, `consumed_at=19:46:54.512Z`,
`cdp_successful_economic_settlement_count=1`, `settlement_transaction_reference`
= the on-chain tx. Owner intent completed.

## 4. On-chain reconciliation — PASS

Base mainnet, tx
`0x831725da0467ebb826389bb7e743819cc8ae75348eacdb892031e59732bf975d`, block
51572134 (`0x312eda6`), status 1, facilitator-relayed (`from` `0x42dd…4b00`,
`to` USDC contract).

- Exactly one USDC `Transfer`: `0x516F…cB99` → `0x7f44…E6E1`, **17000** atomic.
- Exactly one `AuthorizationUsed` for authorizer `0x516F…cB99`.
- Window 51571990 (baseline) → 51572605: 1 Transfer from buyer, 1 to payTo, 1
  AuthorizationUsed for buyer — all the same tx. No duplicate.
- Buyer 79727 → 62727 (−17000); payTo 28000 → 45000 (+17000). Buyer own-nonce tx
  count 0 (gasless authorization).

`DUPLICATE_CHARGES=0`, `DUPLICATE_SETTLEMENTS=0`.

## 5. PCC / result reconciliation — PASS

Persisted result (HTTP 200) is the PCC receipt:
`receipt_id=rcpt_bc961249855b79fe3e377564`, `service_id=verify_agent_output.v2`,
`verification_mode=standard`, `decision=pass`, `completeness=1`,
`signature_algorithm=Ed25519`, `signing_key_id=kid_0ea0e04e294f20fc78b2b155`,
canonicalization RFC8785-JCS, `issued_at=19:46:53.287Z`.
`payment_service_link_evidence` (`lnk_666a89dfac926a75e2cc167b`) joins payment
identifier `pay_aca7968b…`, job `acf8fab2…`, tx reference,
`verification_receipt_id=rcpt_bc96…` (matches client), and
`service_output_hash=sha256:95c6eeed…` (= PCC `output_hash`).
`buyer_receipt_id=pay_aca7968b…:receipt`. Scope: this proves the implemented PCC
receipt and link evidence; it makes no claim beyond them.

Note: `payment_attempts.service_output_hash` (`sha256:d5fdd859…`) is the
_verification-evidence_ hash (`raw_evidence_hash`), a different domain from the
PCC output hash; both are present and neither is inconsistent.

## 6. Durable reconciliation — PASS

| Counter                         | Baseline | Final | Delta |
| ------------------------------- | -------: | ----: | ----: |
| x402_quotes                     |      105 |   106 |    +1 |
| payment_attempts                |       26 |    27 |    +1 |
| jobs                            |       26 |    27 |    +1 |
| x402_service_results            |        2 |     3 |    +1 |
| payment_workflow_owner_intents  |        1 |     2 |    +1 |
| audit_events                    |      236 |   242 |    +6 |
| successful_settlements (sum)    |        1 |     2 |    +1 |
| settle_attempts (sum)           |        1 |     1 |     0 |
| payment_attempt_reconciliations |       17 |    17 |     0 |
| jobs REFUND_REQUIRED            |        1 |     1 |     0 |

The six audit events are exactly: payment_required_created,
payment_payload_received, job_created, payment_verification_requested,
payment_verified, service_execution_started. All new attempts today by service:
verify_agent_output.v2 only. No company, document, rendered,
independent-reproduction or Nevermined job or attempt. One link-evidence row,
one distinct tx. Historical REFUND_REQUIRED job `af5f7e55-…` unchanged
(`updated_at` 2026-09-20 16:10:28); no refund is owed (zero funds were
captured).

## 7. Post-deploy host telemetry — PASS (narrow scope)

The retained tail event for the exact successful Workflow invocation shows
`outcome=ok`, `exceptions=[]`, wallTime 2580 ms, and one benign log line
(`[x402] extension responses: {}`). No `getRandomValues`, JWT,
`createAuthHeaders`, settle, facilitator, D1 or startup error is present in it.

Limitations, stated exactly: this covers the single captured invocation only. No
historical log search was performed — Wrangler has no read-back command and
Workers Observability's query API would have required extracting the operator's
OAuth token, which this checkpoint did not do. Positive settle/facilitator
execution evidence comes from durable state and the chain, not logs.
`HOST_FUNCTIONAL_LIVE_PROOF=PASS` independently (real settlement).

## 8. Caller-bound result retrieval — NOT_EXERCISED

There is no GET/retrieval endpoint. The only result-serving path is
`reconstructFromJob` in `routes/x402-service.ts`, reached by resubmitting the
paid request with the same payment identifier **and the original
`PAYMENT-SIGNATURE`**. The client intentionally did not persist that signature.
Exercising an authorized or unauthorized caller therefore needs new
authorization material or a harness change, both out of scope. Production was
not modified to enable it. The attempt row carries
`binding_digest=sha256:4a634d28…` (binding v2), but binding enforcement itself
was not tested here.

## 9. Replay / idempotency — NOT_EXERCISED_WITH_JUSTIFICATION

Original payment signature was intentionally not retained; replaying now would
require changing the harness or creating new authorization material. The harness
enforces one signed submission and automatic retry is disabled. Confirmed:
`SECOND_PAYMENT_ATTEMPT=NO`, `SECOND_CHARGE=NO`, `SECOND_SETTLEMENT=NO` (one
attempt row, one tx, one AuthorizationUsed).

## 10. Bookkeeping gaps (all non-economic; nothing backfilled)

- **Reconciliation row = `EXPECTED_NOT_CREATED`.** Rows are appended only by
  `recordProviderFailure`, `recordSettlementFinalizationUnresolved`
  (`payment-finalization.ts:45,71`) and by operator checkpoints. The
  classification enum has no "cleanly settled" class. All 17 existing rows are
  operator-written `legacy_*`. A clean settle correctly produces none.
  Observation for backlog: the historical explicit-rejection attempt `8f4253a7`
  also has no row.
- **Service receipt linkage = `BOOKKEEPING_GAP`.**
  `payment_attempts.service_receipt_id` is NULL; the Workflow calls
  `recordSettlementPending` with only `serviceOutputHash`
  (`paid-continuation-workflow.ts:771`), and nothing writes the column
  afterwards. History: 08-28 linked (in-request path), 09-01 null, current null.
  The canonical link lives in `payment_service_link_evidence` and
  `x402_service_results`, which reconcile.
- **Settle-attempt counter = `UNDERCOUNTED_BOOKKEEPING`.**
  `cdp_facilitator_settle_attempt_count` increments only in the failure writer
  (`payment-attempts.ts:451`) and the bounded recovery retry (`:480`). A
  first-try success never increments it: 08-28 = 0, 09-01 = 0, current = 0, the
  failed attempt = 1. Telemetry not changed.

## 11. Client false negative

`service_execution_observed` is computed as
`responseBody?.result_class !== undefined`
(`first-paid-e2e-local.test.ts:~580`). The 200 body is the PCC receipt, which
has no `result_class` field, so the flag reads `false` although execution
completed (durable evidence above).
`CLIENT_SERVICE_EXECUTION_FLAG=FALSE_NEGATIVE`. The same body's `receipt_id` is
read correctly. Recommend a later harness-only fix.

## 12. Economic effects

USDC 17000 atomic ($0.017) moved buyer → payTo, once. No refund, no second
authorization, no provider spend beyond the one verify execution. Worker uploads
0, deployment mutations 0, public traffic mutations 0, secret mutations 0,
web-direct attempts 0. One transient D1 API error (code 7403) occurred on the
first query and cleared on retry; it did not affect any evidence.

## 13. Remaining release blockers

`SAFE_FOR_PRODUCTION_PAID_RELEASE=NO`:

1. Replay/idempotency and caller-binding unproven on a real payment.
2. Web-direct capability has no real payment proof; the harness is pinned to
   verify-standard (amount 17000, route) and needs its own audit.
3. Public-request version attribution is PARTIAL; no retained CF-Ray.
4. `service_receipt_id` linkage, settle-attempt counter and client flag gaps.
5. `REFUND_REQUIRED` remains a generic bucket; it does not prove capture.
6. Host log retention is unproven beyond one tail event; ordinary production
   still has paid routes disabled and the paid canary is at 0%.
7. Nothing is pushed; HEAD carries many unpushed local commits.

## 14. Release decision

Gates met: economic, on-chain, PCC/result and durable reconciliation pass; no
duplicate charge or settlement; host attribution PASS; no functional host error
observed. `VERIFY_STANDARD_REAL_PAYMENT=PASS`. Accepted non-economic
limitations: replay not exercised, caller-binding not exercised, receipt-link
gap, counter undercount, client false negative, historical REFUND_REQUIRED
record, host telemetry scoped to one invocation.

`SAFE_FOR_WEB_DIRECT_CANARY=YES` as a recommendation only; it still requires its
own explicit authorization checkpoint. Next:
`FIRST-PAID-WEB-DIRECT-REAL-PAYMENT-AUTHORIZATION-01`.
