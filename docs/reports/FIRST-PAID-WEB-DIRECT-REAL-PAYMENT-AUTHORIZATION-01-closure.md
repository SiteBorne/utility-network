# FIRST-PAID-WEB-DIRECT-REAL-PAYMENT-AUTHORIZATION-01 — Closure

Status: **PASS** (read-only reconciliation of one operator-executed real payment).
This checkpoint did not run the buyer client, create a signature, deploy, change traffic, change secrets, or push.

## 1. Starting provenance

- HEAD: `8aecb185f476dedaccecdc5733086fe52961b0a4`, branch `metadata-vcm-qualification`, 45 commits ahead / 0 behind upstream, working tree clean.

## 2. Web-direct contract and test input

- service `web_context_verified.v2`, retrieval_mode `direct`, route `POST /v2/web/context`, contract_release `2.0.0`, pricing_key `web_context_verified_direct_v2`.
- amount 8000 atomic USDC ($0.008), network `eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, payTo `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, scheme `exact`, EIP-712 domain `USD Coin` / `2`.
- input: `target_url=https://example.com/`, `retrieval_mode=direct`.

## 3. Client result

`ok=true`, stage `RESULT_OBSERVED`, HTTP 200, `submission_result=success`, `service_execution_observed=true`, `settlement_observed=true`, tx `0x65e79c32…3168225`, receipt `rcpt_38c489e6ac4f68ec77b0176f`. One paid submission, no retry. CF-Ray challenge `a3e3a2510f04afe7-ATL`, paid `a3e3a2540fdbafe7-ATL`.

## 4. Public exact-version attribution — PASS (direct)

Sanitized tail (started before signing) joined on the 16-hex ray prefix:

| ray | time (UTC) | path | status | scriptVersion.id |
|---|---|---|---|---|
| `a3e3a2510f04afe7` (challenge) | 20:38:29.295 | POST /v2/web/context | 402 | `0456f44c-1c28-4919-9fdb-ab4673bac8f6` |
| `a3e3a2540fdbafe7` (paid) | 20:38:29.765 | POST /v2/web/context | 200 | `0456f44c-1c28-4919-9fdb-ab4673bac8f6` |

All other in-window public traffic (cron, MCP, A2A) was attributed to `369b4bf5`. Both events `outcome=ok`.

## 5. Durable payment identity (D1, read-only)

- request_id `54246931-eaf0-4f76-9f18-69aa9ef36191`
- quote_id `qte_859b38a90086f5e929854464`; requirement_id `req_24931e2a24ebc35c1942d170`
- payment_identifier (payment_id) `pay_4f8cc4e0f39047ab8c6d968821a67696`
- payment_attempt_id `6064153c-5fc1-41bd-83f9-ab71742ee3ca`
- job_id (D1) `725cf0e5-6aae-4a42-b89f-a8e17c076785`; PCC job_id `job_8ebf975770d8970b60774d56`
- owner_intent_id / workflow_instance_id `owner-intent:siteborne-wf-1a82f96230a774ef2dbb8e74d5a3a806f3ca9342d91d4768` / `siteborne-wf-1a82f96230a774ef2dbb8e74d5a3a806f3ca9342d91d4768`
- service result: `x402_service_results` keyed (job_id, payment_identifier); no separate result id column. Persistence receipt id `pay_4f8cc4e0…:receipt`; PCC receipt `rcpt_38c489e6ac4f68ec77b0176f`; link_id `lnk_3fef297b9478e0a220b9a99b`.
- settlement tx `0x65e79c323963e93680e97f570e6ebd91a5732ba9ac2c97d2433edee7a3168225`.

Quote/requirement bind exactly to the contract above (`extra`: name `USD Coin`, version `2`, quote_id; maxTimeoutSeconds 60). WEB_DIRECT_QUOTE_BINDING=PASS.

## 6. Verification and execution trace

Audit chain: payment_required_created 20:38:29.334 → payment_payload_received (valid, rail cdp) .765 → job_created .850 → payment_verification_requested 30.160 → payment_verified 30.299 → service_execution_started 30.388.
Job states: RECEIVED → VALIDATED → QUOTED → PAYMENT_CHALLENGED → PAYMENT_VERIFIED (30.188) → LOCKED (30.328) → ROUTED (33.326) → EXECUTING (33.455) → VERIFYING (38.080) → SETTLING (38.330) → DELIVERED (40.010). Execution started only after PAYMENT_VERIFIED/LOCKED. trust_class `external_verified`, facilitator `cdp:facilitator`, provider `cdp-facilitator@1.55.0`.

Executor (source): `buildWebContextV2ProductionExecutor` → `WebContextVerifiedService`, direct path → exactly one `PublicHttpAdapter.execute` for the target URL through the SafeSocketHttpClient. Rendered path returns dependency_unavailable and is not reachable in direct mode; no Modal/Browser Rendering is involved. Expected provider invocations: 1 logical fetch (redirect hops, if any, are internal to it). Result `decision=pass`, `evidence_accessibility_ratio=1.000` implies the fetch succeeded.

**Limitation:** the retrieval fetch leaves no dedicated durable record (`provider_rate_window` has no row in the window, and `job_attempts` is empty). PROVIDER_CONTACTED / latency are therefore *inferred* from source plus the passing PCC result, not directly observed. Duplicate-invocation absence rests on single job, single owner-intent dispatch (count 1) and single result row.

## 7. Assurance / result

One result row; receipt fields actually present: service_id `web_context_verified.v2`, decision `pass`, completeness 1, signing_key_id `kid_0ea0e04e294f20fc78b2b155`, Ed25519 over RFC8785-JCS, issued_at 20:38:38.022Z. Note: the receipt's `verification_mode: "standard"` is the PCC schema enum (`standard | independent_reproduction`), not the retrieval mode; retrieval_mode `direct` is **not** carried in the receipt and is linked only through job/quote/service_id.

## 8. Continuation host attribution — PASS (direct, temporal instance link)

Sanitized host tail: one `rpcMethod` event at 20:38:33.114Z, `script_version_id=9b1e9b10-beed-4ff3-914c-2221aada9b45`, `outcome=ok`, no exceptions, no JWT/getRandomValues/settle errors. It is the only host event in the window and falls between LOCKED and ROUTED; the sanitized capture carries no workflow-instance id, so the instance link is temporal rather than by id.

## 9. Settlement and on-chain proof — PASS

- settlement_pending 20:38:38.520, consumed 20:38:39.304, owner intent completed 39.710, `lifecycle_stage=settled`, `cdp_successful_economic_settlement_count=1`, settleResponse `success:true`, amount `8000`.
- Base tx `0x65e79c32…3168225`: block 51573687, status 1, sent by facilitator relayer `0x2a89…eb5a` to the USDC contract; exactly 2 logs: one `AuthorizationUsed` (authorizer = buyer), one `Transfer` buyer `0x516F…cB99` → payTo `0x7f44…E6E1`, value 8000.
- Balances: buyer 62727 → 54727; payTo 45000 → 53000 (read at block N-1, N, and latest). Buyer Transfers since N-1: 1; AuthorizationUsed(buyer): 1; buyer nonce 0. No duplicate charge or settlement.

## 10. D1 deltas (baseline → now)

payment_attempts 27→28, jobs 27→28, results 3→4, successful settlements 2→3, settled-stage attempts +1, owner intents +1 (completed), REFUND_REQUIRED 1→1 (historical job `af5f7e55…`, untouched), audit events +6 for this chain. Only new job/attempt/quote since 20:38:00 is `web_context_verified.v2`. Unpaid qualification probes are not counted as paid activity.

## 11. Bookkeeping observations (not fixed)

All reproduce in prior settled attempts unless noted.
1. `payment_attempts.service_receipt_id` = null (also on the verify-standard attempt). Canonical linkage via `payment_service_link.verification_receipt_id` is intact.
2. `cdp_facilitator_settle_attempt_count` = 0 despite one successful settlement (also on the verify attempt). Accepted counter undercount.
3. No `payment_attempt_reconciliations` row for the success path (count unchanged at 17).
4. `payment_attempts.job_id` is null on all three settled attempts; job is linked through `jobs.idempotency_key = payment_identifier` and `payment_service_link.job_id`.
5. **Output-hash naming:** `payment_attempts.service_output_hash` (`sha256:402a04be…`) ≠ PCC `output_hash` / `payment_service_link.service_output_hash` (`sha256:f4611bf9…`). Source (`paid-continuation-workflow.ts:772`) writes the attempt column from `verificationEvidence.raw_evidence_hash` at settlement_pending, while the link uses `executorOutcome.result.output_hash`. So the attempt column is not the service output hash despite its name. Same mismatch exists on the verify-standard attempt. Canonical service-output identity = `f4611bf9…` (PCC = link). Recommend a later naming/documentation fix.
6. `settlement_evidence.settled_at` equals the attempt `created_at` (20:38:29.765Z), not the settlement time (~20:38:38.5); same pattern on earlier settled attempts. Cosmetic timestamp defect.
7. Owner intents: 3 rows, 2 completed; the third is the historical 16:10 failed attempt (`workflow_created`), unchanged.

## 12. Client observation fix — PASS

`service_execution_observed=true` on this run, and the server result is `web_context_verified.v2` with a governed receipt body. This is the first live proof of the corrected detector.

## 13. Runtime health

Public: both rays `outcome=ok` (402, 200); the sanitized public capture does not record an exceptions field, so "no exception" rests on `outcome=ok`. Host: `outcome=ok`, `exceptions=[]`. Settlement success on the host also confirms the JWT-init remediation works in production.

## 14. Replay / caller-binding — NOT EXERCISED

The signed authorization was intentionally not retained; replay or a non-authorized retrieval would need new or recovered authorization material, and no non-economic result-retrieval endpoint exists. CALLER_BOUND_RESULT=NOT_EXERCISED; WEB_DIRECT_REPLAY_SAFETY=NOT_EXERCISED_WITH_JUSTIFICATION. SECOND_WEB_DIRECT_PAYMENT_ATTEMPT=NO; SECOND_CHARGE=NO; SECOND_SETTLEMENT=NO.

## 15. Capability isolation — PASS

Since 20:38:00: one quote, one attempt, one job, all `web_context_verified.v2`. No verify-standard, company, document, rendered, independent-reproduction, Nevermined, or legacy v1 economic rows.

## 16. Stale test name — STALE_TEST_DESCRIPTION=YES (case A)

`first-paid-e2e-local.test.ts:1485`, "the current live candidate is expected to fail closed at CHALLENGE_VALIDATED (CRITICAL FINDING regression proof)". The body feeds a synthetic requirement with `extra={quote_id}` only and asserts the validator rejects it with an EIP-712 domain mismatch. The logic is correct and network-free; only the name and comment are stale, since the live candidate now emits `name`/`version` (confirmed in the stored requirement). Recommend a later harness-only rename to a historical-regression description. Product behavior unchanged.

## 17. Tail sanitization and cleanup

- Stopped only the 12 processes that held `/tmp/wd_capture` files open (public and host tails plus their wrapper). `lsof` on the capture directory is now empty.
- Not stopped (not positively identified as this checkpoint's, per instructions): PID 13622 (host tail from the 14:16 host-redeploy work), 16058 (14:46 host tail), and 21394 (15:27 public tail, holds no capture file). The operator may stop these.
- Sensitive-material scan of `/tmp/wd_capture`: 0 hits for payment-signature/authorization-header markers; no client IP fields. The 3 hits in `/tmp/tp01` are OpenAPI documents that merely mention the header name.
- RAW_PAYMENT_SIGNATURE_PERSISTED=NO.

## 18. Economic side effects and cloud mutations

One settled 8000-atomic USDC transfer (buyer → payTo). Worker uploads 0; deployment mutations 0; public traffic mutations 0; secret mutations 0. Public: `369b4bf5` 100%, `0456f44c` 0%; host `9b1e9b10` 100% (all three confirmed via read-only `wrangler deployments status` at closure).

## 19. Remaining pre-production work

Production security declarations; decisions on the bookkeeping items in §11 (particularly output-hash naming and `settled_at`); a non-economic caller-bound retrieval/replay proof; a durable provider-invocation record; capturing workflow-instance id in the host attribution capture; harness rename (§16). Paid production activation remains NOT authorized.
