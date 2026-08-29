# SUN-1221E4R — Ambiguous E4 Paid Submission Reconciliation

**Status:** COMPLETE
**Classification:** `FAIL_RECONCILED_NO_SETTLEMENT` (not ambiguous once independently reconciled)

## 0. Operator client result (authoritative input)

```json
{
  "ok": false,
  "stage": "RESULT_OBSERVED",
  "challenge_received": true,
  "challenge_validated": true,
  "payment_material_created": true,
  "paid_request_submitted": true,
  "submission_result": "ambiguous",
  "http_status": 502
}
```

Vitest: 14/14 PASS (proves client no-retry safety behavior, not payment success).

`E4_CLIENT_OUTCOME=AMBIGUOUS`. No retry was performed. Absolute no-retry law honored throughout this reconciliation: no new 402, no new signature, no resend.

## 1. Immediate production restoration

The active deployment still contained the E4 100/0 split
(`de70bf98-f304-4d7f-b189-4ae2401041a0@100%` / `a088632e-b93c-4953-b0fc-411a2005e57c@0%`).
Restored first, before any forensic work:

```
wrangler versions deploy de70bf98-f304-4d7f-b189-4ae2401041a0@100 --message "SUN-1221E4R: mandatory restoration after ambiguous paid submission (HTTP 502)" --yes
```

Read-back:
- `ACTIVE_DEPLOYMENT_VERSION_COUNT=1`
- `FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`
- `FINAL_PRODUCTION_TRAFFIC=100%`
- `E4_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`
- `SUN1221E4_RESTORATION=PASS`

## 2. Post-restoration safety

- `GET /health` → 200
- `GET /ready` → `production_services_enabled:true` (verify_agent_output.v2 still live), `blocked_external` unchanged (3 unproven items only)
- `GET /catalog` → `web_context_verified.v2.production_enabled:false` (correctly inactive; candidate not deployed)
- `pnpm production:preflight` → `PREFLIGHT RESULT: PASS`

`POST_E4_FIRST_SERVICE_HEALTH=PASS`, `POST_E4_WEB_CONTEXT_PRODUCTION_ACTIVE=NO`, `POST_E4_PRODUCTION_PREFLIGHT=PASS`.

## 3. E4 attempt identity (sanitized only)

From authoritative tail capture (`e4_tail.jsonl`) cross-referenced with D1:

| Field | Value |
|---|---|
| `E4_PAYMENT_ATTEMPT_ID` | `bff2bc21-3b12-417c-ac35-4be05c212936` |
| `E4_PAYMENT_IDENTIFIER` | `pay_de014688ebfe4e69bac34504c0044d3b` |
| `E4_QUOTE_ID` | `qte_f28581689ea4e57fe16f5bbb` |
| `E4_REQUEST_ID` (job) | `11fde704-fce5-4ef0-b627-c0290e20ead8` |
| `E4_AMOUNT_ATOMIC` | `9000` |
| `E4_BUYER` | `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` |
| `E4_PAYTO` | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` |
| `E4_AUTH_VALID_BEFORE` | `2026-08-29T23:32:39.862Z` (D1 `expires_at`) |

Attribution: candidate `a088632e-b93c-4953-b0fc-411a2005e57c`, HTTP 502, `outcome: ok`, zero Worker exceptions — the 502 is an application-level failure, not an unhandled runtime exception.

No raw signature, authorization, nonce, or private key material recovered or printed anywhere in this reconciliation.

## 4. Buyer balance

```json
{"buyer":"0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99","balance_atomic":"28197","decimals":6}
```

`BUYER_USDC_BALANCE_ATOMIC_NOW=28197`
`BUYER_USDC_DELTA_ATOMIC=0` (identical to pre-E3/E4 balance recorded in SUN-1221E3R)

## 5. On-chain reconciliation

Queried Base mainnet USDC `Transfer` events with `from = buyer` over the last 600 blocks (~20 minutes), covering the entire E4 window (submission at 23:27:39Z, query run at 23:33Z):

```json
{"latest_block":"50628542","from_block":"50627942","buyer_outgoing_transfer_count":0,"transfers":[]}
```

- `E4_ONCHAIN_TX_HASH=NONE`
- `E4_ONCHAIN_TX_STATUS=NONE`
- `E4_ONCHAIN_TRANSFER_AMOUNT_ATOMIC=0`
- `E4_BUYER_NATIVE_TOKEN_EFFECT=0`

## 6. EIP-3009 authorization state

- `E4_AUTH_VALID_BEFORE=2026-08-29T23:32:39.862Z`
- Current time at reconciliation: `2026-08-29T23:33:29Z`
- `E4_AUTH_EXPIRED=YES`
- `E4_AUTH_ONCHAIN_USED=NO` (zero on-chain transfers found, §5)
- `E4_OLD_AUTHORIZATION_RETIRED=YES` (unused + expired + no late settlement)

## 7. D1 reconciliation (read-only)

`payment_attempts` row for `pay_de014688ebfe4e69bac34504c0044d3b`:

```json
{
  "id": "bff2bc21-3b12-417c-ac35-4be05c212936",
  "quote_id": "qte_f28581689ea4e57fe16f5bbb",
  "requirement_id": "req_16082b7e7abeb2213369333d",
  "service_id": "web_context_verified.v2",
  "amount": "9000",
  "created_at": "2026-08-29T23:27:39.862Z",
  "expires_at": "2026-08-29T23:32:39.862Z",
  "lifecycle_stage": "verified",
  "settlement_transaction_reference": null,
  "service_receipt_id": null
}
```

- `E4_D1_PAYMENT_ATTEMPT_STATUS=verified`
- `E4_D1_PAYMENT_ATTEMPT_COUNT=1`
- `E4_D1_SETTLEMENT_TRANSACTION_REFERENCE=null`
- `E4_D1_SETTLEMENT_COUNT=0`
- `E4_D1_SERVICE_RESULT_COUNT=0` (zero rows in `x402_service_results` for this `payment_identifier`)
- `E4_D1_RECEIPT_COUNT=0`

`audit_events` for `job_id=11fde704-fce5-4ef0-b627-c0290e20ead8` / `payment_identifier=pay_de014688ebfe4e69bac34504c0044d3b`, in order:

| timestamp | event_type | detail |
|---|---|---|
| 23:27:39.947Z | `job_created` | job + payment_identifier linked |
| 23:27:40.323Z | `payment_verification_requested` | — |
| 23:27:40.432Z | `payment_verified` | facilitator `verify()` succeeded |
| 23:27:40.641Z | `service_execution_started` | real executor invoked |
| 23:27:40.787Z | `service_execution_diagnostic` | `result_class: internal_verification_failed`, `diagnostic_reason_code: WEBCTX_UPSTREAM_PROTOCOL_ERROR`, `diagnostic_stage: direct_public_http_fetch` |

This is the newest row in `audit_events` — **no event exists after the diagnostic**. There is no `settle`, `service_execution_completed`, or later event of any kind for this attempt.

`E4_D1_AUDIT_EVENT_SEQUENCE=job_created → payment_verification_requested → payment_verified → service_execution_started → service_execution_diagnostic (terminal)`

## 8. Facilitator path

- `E4_FACILITATOR_VERIFY_CALLED=YES`
- `E4_FACILITATOR_VERIFY_STATUS=success` (audit event `payment_verified`)
- `E4_EXECUTOR_INVOKED=YES`
- `E4_FACILITATOR_SETTLE_CALLED=NO` — proven by the audit trail terminating at the diagnostic event with no subsequent settlement-path event, corroborated by `settlement_transaction_reference=null` and zero `x402_service_results` rows. Not inferred from `verify()` success.
- `E4_FACILITATOR_SETTLE_STATUS=NOT_CALLED`
- `E4_SETTLEMENT_REFERENCE=null`

## 9. E3P diagnostic result — critical finding

**E4 did NOT produce `WEBCTX_RESPONSE_READ_FAILED`** (the new diagnostic code added in SUN-1221E3P to isolate raw `socket.readable.read()` rejections). It produced the same **`WEBCTX_UPSTREAM_PROTOCOL_ERROR`** at `direct_public_http_fetch` stage that E3 produced, before the E3P instrumentation existed.

This is genuine forensic progress, not a null result: it **rules out** the response-read-rejection branch as the cause (class G) — that code path was live in the deployed candidate and did not fire. The failure is happening somewhere else inside the generic HTTP protocol/framing handling that `WEBCTX_UPSTREAM_PROTOCOL_ERROR` still covers as a catch-all.

- `E4_EXECUTOR_RESULT_CLASS=internal_verification_failed`
- `E4_EXECUTOR_DIAGNOSTIC_REASON=WEBCTX_UPSTREAM_PROTOCOL_ERROR`
- `E4_EXECUTOR_DIAGNOSTIC_STAGE=direct_public_http_fetch`
- `E4_TERMSGUARD_RISK_ACCEPTANCE_PATH_USED=YES` (proven — execution reached the fetch stage at all, which only happens after TermsGuard's `operator_risk_acceptance` check passes; this is the second live confirmation of the SUN-1221E2T1 fix working under a real payment)
- `E4_SAFE_SOCKET_PATH_EXECUTED=YES` (implied by reaching `direct_public_http_fetch` diagnostic stage)
- `E4_CANONICAL_TARGET_FETCHED=NO` (fetch did not complete successfully)
- `E4_UPSTREAM_HTTP_STATUS=UNPROVEN` (no successful upstream response was parsed)

## 10. PCC / result / receipt

- `E4_PCC_OUTPUT_EXISTS=NO`
- `E4_PCC_OUTPUT_VALID=NO`
- `E4_RESULT_PERSISTED=NO`
- `E4_SERVICE_RESULT_ID=null`
- `E4_RECEIPT_EXISTS=NO`
- `E4_RECEIPT_VALID=NO`
- `E4_RECEIPT_ID=null`

## 11. Failure-stage classification

`E4_502_ROOT_CAUSE_CLASS=H_EXECUTOR_HTTP_PROTOCOL_FAILED`
`E4_502_ROOT_CAUSE_PROVEN=NO`

Not fully proven at the byte level, but now bounded: class `G_EXECUTOR_RESPONSE_READ_FAILED` is affirmatively ruled out by the E3P instrumentation not firing. The failure remains within HTTP/1.1 request or response framing/parsing against `https://example.com/`, occurring identically across two independent live attempts (E3, E4) with different payment identifiers, at the same stage.

## 12. Settlement outcome

`E4_SETTLEMENT_OUTCOME=NOT_ATTEMPTED`
`E4_SETTLEMENT_COUNT=0`
`E4_DUPLICATE_SETTLEMENT_DETECTED=NO`

## 13. Economic effect

`E4_BUYER_USDC_ECONOMIC_EFFECT_ATOMIC=0`
`E4_SELLER_USDC_ECONOMIC_EFFECT_ATOMIC=0`
`E4_BUYER_NATIVE_TOKEN_ECONOMIC_EFFECT=0`

Maximum authorized was 9000 atomic; actual effect is 0. No incident.

## 14. Did E4 secretly succeed?

No. Settlement was never attempted (§8, §11), no receipt exists (§10), no on-chain transfer occurred (§5), buyer balance is unchanged (§4). All required conditions for `SUCCESS_DESPITE_CLIENT_502` are false.

## 15. Clean failure classification

Executor failed (§9) AND settle() never called (§8) AND authorization unused + expired (§6) AND zero economic effect (§13):

`E4_RECONCILED_E2E_OUTCOME=FAIL_RECONCILED_NO_SETTLEMENT`
`SUN1221E4_REAL_PAID_E2E=FAIL`

## 16. F eligibility

`SUN1221F_PUBLIC_CANARY_ELIGIBLE=NO` — `SUN1221E4_REAL_PAID_E2E` is `FAIL`, not `PASS`.

## 17–20. Secrets scan, cleanup, final status

- Secrets scan: 2 findings, both pre-existing historical false positives in older committed reports (BaseScan public-contract-address heuristic match, previously documented in SUN-1220 and SUN-1221E2/E3 reconciliations). `NEW_SECRET_FINDINGS=0`.
- Cleanup: E4-owned tail process only (none left running from this checkpoint; historical stale tails from earlier checkpoints untouched, per scope).
