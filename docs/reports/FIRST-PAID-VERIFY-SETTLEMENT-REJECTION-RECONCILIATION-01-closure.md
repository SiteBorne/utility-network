# FIRST-PAID-VERIFY-SETTLEMENT-REJECTION-RECONCILIATION-01 — closure

Status: **PASS (read-only investigation complete)**. Root cause is **strongly indicated but not directly
observed** (see §5, §15, §18). No retry, no new signature, no refund, no job mutation, no deploy, no push.

## 1. Starting provenance

| Item | Value |
| --- | --- |
| git HEAD | `0dd2222def8c01c4e5cfeb2ddea2dabc9ba1a0a8` |
| git status | ` M apps/edge-api/tests/live/first-paid-e2e-local.test.ts` (pre-existing; not touched, not committed here) |
| Ordinary production (public API) | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` @ 100% |
| Repaired public canary | `0456f44c-1c28-4919-9fdb-ab4673bac8f6` @ 0% |
| **Workflow host Worker** `siteborne-paid-continuation-runtime` | version `2833ed03-a5da-474c-86eb-aa4ea710f7d9` @ 100%, created 2026-09-13T04:24:22Z, source `9502db3` |

## 2. Durable attempt (recovered from D1 / Workflow instance; nothing inferred)

request_id `1385968b-5aaa-4f0b-991d-8c263b3c99aa` · payment_id `pay_5ce76fc95a1748fd875acf93f70d5d0b` ·
quote `qte_cb80d25d2699c42966ec77cd` · requirement `req_fe2ba421b480265ca9a005a4` · attempt
`8f4253a7-b617-495e-b4ba-37eeb7ad8fe0` · job `af5f7e55-d9ba-43e1-99b6-66cde5ac6a37` · service
`verify_agent_output.v2` (standard) · exact / eip155:8453 / USDC `0x8335…2913` / amount 17000 / payTo
`0x7f44…E6E1` / payer = buyer `0x516F…cB99` · rail cdp · provider `cdp-facilitator@1.55.0` ·
Workflow instance `siteborne-wf-06411d2de5e735c741c3342e00d820a6e269b45b0a9e74ea` (Workflow version `274647a4`).

Timeline (UTC, 2026-09-20):

| Time | Event |
| --- | --- |
| 16:10:22.961 | quote created |
| 16:10:23.005 | `payment_required_created` |
| 16:10:23.470 | `payment_payload_received` (valid, rail cdp); payment_attempt row; owner intent |
| 16:10:23.596 | `job_created` |
| 16:10:24.000 | `payment_verification_requested` |
| 16:10:24.035 / .182 | job `PAYMENT_VERIFIED` / `payment_verified` (**/verify PASS**, public API canary) |
| 16:10:24.290 | `service_execution_started` |
| 16:10:25.304 | Workflow instance created (owner intent `workflow_created`) |
| 16:10:27.339–.942 | ROUTED → EXECUTING → VERIFYING → SETTLING (Workflow host) |
| 16:10:28.113 | `settlement_pending_at`; settle attempt count = 1 |
| 16:10:28.260 | job `SETTLING → REFUND_REQUIRED`, reason `PAYMENT_FAILED`, evidence_ref `settlement_not_successful` |

Workflow steps (all `Success`): open-envelope, check-authorization-expiry `{"expired":false}`, invoke-executor
(`result_class=success`, receipt `rcpt_6d5d3922195cc87938185085`, output_hash `sha256:3d571e7a…50ea`),
generate-pcc (`valid:true`, `decision:pass`), **settle-1 → `{"kind":"rejected","reason":"settlement_not_successful"}`,
duration 0 s**. Workflow status Completed.

## 3. Settlement call graph

1. `paid-continuation-workflow.ts` `runPaidContinuationWorkflow` → `step.do('settle', SETTLE{retries:0,timeout 20s})`
2. `runSettlementStep` — guards (existing record, expiry recheck) → `repo.recordSettlementPending` (sets
   `settlement_pending_at`, `service_output_hash = verificationEvidence.raw_evidence_hash`)
3. `CdpPaymentEvidenceProvider.settle` (`evidence/cdp-provider.ts`) → `facilitator.settle(payload, requirements)`
4. `HTTPFacilitatorClient.settle` (`@x402/core` 2.21.0): `createAuthHeaders("settle")` **then** `fetch /settle`
5. Provider normalisation: throw → `success:false`, `reason = errorReason ?? 'facilitator_settlement_unavailable'`,
   `trust_class external_unverified/verified`; non-throw → `success` / `settlement_*` mismatch reasons
6. `canAdvanceToSettled` (`packages/protocol-x402/src/evidence/settlement.ts`): structure → verification hash →
   `!success ⇒ 'settlement_not_successful'` — **the evidence's own `reason` is dropped here**
7. `repo.recordCdpSettlementOutcome(…'explicit_rejection'…)` → `{kind:'rejected', reason: gateReason}`
8. `transitionJobState(…'REFUND_REQUIRED','PAYMENT_FAILED', detail=gateReason)`

Non-rejected branches yield different durable markers: a thrown `settle()` at workflow level → reconciliation
(`reconciliation_not_found` / ambiguous), so **`settlement_not_successful` proves `settle()` returned an evidence
object with `success:false` and bindings/verification hash valid** (no thrown workflow-level error).

## 4–5. Settle JWT / auth and facilitator response

- `SETTLE_JWT_MINT` / `SETTLE_AUTH_HEADERS`: **NOT_OBSERVABLE** directly (no durable field; no console logging on this
  path; catch swallows errors into evidence).
- `SETTLE_HTTP_STATUS` / `SETTLE_ERROR_CODE` / `SETTLE_ERROR_REASON`: **not_observable** — the provider's evidence
  reason is discarded at step 6 and never persisted anywhere (audit_events, payment_attempts, job_state_events,
  reconciliations, link evidence, Workflow step output all checked).
- Workflow host has `[observability] enabled = true`, but nothing is logged on this path.

## 6. SDK settle error model (`@x402/core` 2.21.0)

Success (2xx, schema-valid) → `SettleResponse`. Non-2xx with JSON body containing `success` → throws `SettleError`
(status + body). Non-2xx otherwise / non-JSON → plain `Error("Facilitator settle failed (status): …")`. Auth-header
failure, network failure, timeout, malformed 2xx response → throw. The provider's catch reduces **every** thrown
cause (JWT/auth-stage TypeError, network, timeout, 401/403/409/422/429/5xx without machine `errorReason`, malformed
response) to `facilitator_settlement_unavailable`, and `canAdvanceToSettled` then reduces that and a facilitator
`success:false` to `settlement_not_successful` / `explicit_rejection`.
**SETTLE_REASON_OBSERVABILITY = GENERIC.** (Verify has a subreason classifier; settle does not.)

## 7. Verify vs settle inputs

The settle context is built from the same encrypted continuation envelope as verify (same payload, same quote,
requirement, payTo, asset, network, amount 17000 exact; `requirement_id`/`payment_identifier` bindings passed
structural validation and `verification_evidence_hash` matched, else the gate would have returned
`not_structurally_valid` / `verification_not_accepted`). Payload bytes (signature, nonce, validAfter/Before) are inside
the encrypted envelope and were **deliberately not decrypted or printed**; field-level comparison of those is therefore
not performed. Semantic parity at the binding level: PASS.

## 8. Validity window

`valid_before_unix = 1789920922` = 16:15:22Z (Workflow metadata). `check-authorization-expiry-1` returned
`expired:false` (~16:10:27) and the settle-time guard `clock() >= validBefore` did not fire (else
`authorization_expired`). Facilitator `/verify` accepted at 16:10:24Z and settle began 16:10:28Z (≈5 s after issue;
`maxTimeoutSeconds` 60). The EIP-3009 `validBefore` inside the envelope was not read.
AUTHORIZATION_VALID_AT_VERIFY=YES · AUTHORIZATION_VALID_AT_SETTLE=YES (by workflow guards and timing; envelope
field itself not inspected).

## 9. Prior successful settlements

| | 2026-08-28 (`83a65c9b`) | 2026-09-01 (`56d84294`) | 2026-09-20 (`8f4253a7`) |
| --- | --- | --- | --- |
| service | verify std, 19000 | web_context, 9000 | verify std, 17000 |
| exact / Base / same asset & payTo | yes | yes | yes |
| provider | cdp-facilitator@1.55.0 | same | same |
| outcome | settled, tx `0x612efe6f…`, receipt | settled_external, tx `0x15e60d34…` | settlement_failed, no tx |
| host Worker source | pre-regression | pre-regression (host deployed 08-31) | **9502db3 (contains 8cc7222, lacks 3fc1664)** |

SETTLEMENT_RELEVANT_DELTA: the **only** settlement-relevant difference is the deployed host bundle. The CDP SDK/x402
versions, payment shape, payTo, asset and network are identical. PRIOR_SUCCESS_SETTLEMENT_PARITY = PARTIAL (all
protocol inputs equal; runtime bundle differs). PayTo USDC balance 28000 = 19000 + 9000, consistent with exactly the
two prior settlements.

## 10–11. Execution eligibility and result persistence

Executor `result_class=success`, receipt id present, PCC `valid:true / decision:pass`, output_hash valid shape
(`sha256:` + 64 hex). Settlement gates on verification acceptance, not on result rows.
EXECUTION_ACCEPTED_FOR_SETTLEMENT = YES · SERVICE_OUTPUT_HASH_VALID = YES.
Note (observation, not a defect claim): `payment_attempts.service_output_hash` (`sha256:e3e45a34…`) is written by
`recordSettlementPending` from `verificationEvidence.raw_evidence_hash`, not the executor `output_hash` (`3d571e7a…`).
`x402_service_results` is persisted only after settlement success (code path after the `rejected` early return), so
its absence is **EXPECTED_GATING_BEHAVIOR**.

## 12. REFUND_REQUIRED semantics

ADR 0046 maps `settlement_failed → REFUND_REQUIRED`. It is the state machine's generic post-execution settlement-
failure bucket (`SETTLING → REFUND_REQUIRED`, exits only to REJECTED/TOMBSTONED); it does not assert funds were
captured, and no refund executor exists. Here zero funds moved, so the name is **semantically misleading**
(overclassification). REFUND_ACTUALLY_OWED = **NO**. Job not mutated.

## 13. Durable reconciliation

Present: payment_attempt (`settlement_failed`, settle count 1, successful settlements 0, receipt null, consumed_at
null), job (`REFUND_REQUIRED`), 11 job_state_events, 6 audit events, x402_quote, owner intent (`workflow_created`).
Absent: x402_service_results, payment_service_link_evidence, payment_attempt_reconciliations (no refund/recon rows),
job_attempts, job_artifacts, queue_dispatches, security_events, idempotency_records. Total payment_attempts = 26.

## 14. On-chain (Base mainnet, read-only)

Buyer USDC 79,727 (unchanged) · payTo USDC 28,000 · buyer tx count 0 · USDC Transfer from buyer 0 · Transfer to payTo
0 · AuthorizationUsed for buyer 0 (last 3000 blocks, scoped). ONCHAIN_TRANSACTION=NO, USDC_TRANSFER=NO,
AUTHORIZATION_USED=NO.

## 15. Findings on cause (evidence-graded)

1. **Observed:** the settle step ran in the **separate Workflow host Worker**, not the repaired public canary. Its live
   version `2833ed03` was built from `9502db3`, which contains regression commit `8cc7222` and predates JWT fix
   `3fc1664`. The version-override on the public canary does not reach it.
2. **Reproduced:** building that exact source (`git archive 9502db3`, `wrangler deploy --dry-run`, scratch dir outside
   the repo) gives a host bundle with `init_jwt` defined and **0 calls**; the public-synthetic-key probe built from the
   same tree fails under workerd on verify/settle/supported (`getRandomValues_not_a_function`, no facilitator fetch).
   The probe bundles the public entry plus the same provider/SDK graph, not the host entrypoint file itself.
3. **Observed:** `settle-1` returned in 0 s; `settlement_pending_at → REFUND_REQUIRED` = 147 ms including two D1 writes
   (a full on-chain `/settle` round trip is materially longer; `/verify` alone took ~180 ms).
4. The provider maps a pre-fetch auth-header throw to `success:false` / `facilitator_settlement_unavailable`, which the
   gate renders as `settlement_not_successful` — matching the observed durable output exactly.

Not observed: any facilitator request/response for this `/settle`. A facilitator-answered `success:false` is not
excluded by durable data. A definitive discriminator (owner action): CDP portal request log — **no `/settle` request
received near 2026-09-20T16:10:28Z ⇒ auth-stage failure confirmed.**

SETTLEMENT_FAILURE_CLASS = **UNKNOWN_EXACT_REASON_NOT_RECORDED** (leading, evidence-supported hypothesis:
SETTLE_JWT_FAILURE from the un-remediated host bundle).

## 16. Observability gap

SETTLEMENT_OBSERVABILITY_GAP = **YES**. Smallest safe patch (not implemented): carry a bounded enum
subreason/transport_status/retryability (as verify does, no bodies/JWT/headers) on `ExternalSettlementEvidence`, tag
the auth stage in `CdpPaymentEvidenceProvider.settle`, and append it to the `REFUND_REQUIRED` state-event detail and
the settlement outcome record instead of only the gate reason. Additionally the bundle-output regression gate builds
only root `wrangler.toml`; it must also build and exercise `wrangler.paid-continuation-runtime.toml`.

## 17. Client timeout

The signed submission (16:10:23.470) preceded the 5 s vitest timeout (test start ≈16:10:22 → ≈16:10:27–28). The
Workflow ran independently of the client connection and completed at 16:10:28.26 with a deterministic, server-side
outcome. CLIENT_TIMEOUT_CAUSAL_TO_SETTLEMENT_FAILURE = **NO**. Measured server duration quote→outcome ≈ 5.3 s; a
future live-test timeout of ≥ 60 s (with the harness reading the job/result, not only the HTTP reply) is warranted.

## 18. Decision

**B. SETTLEMENT_REASON_NOT_PERSISTED**, with a strongly indicated cause: the Workflow host Worker is running a
bundle without the JWT init remediation. Proposed next: `FIRST-PAID-VERIFY-SETTLEMENT-OBSERVABILITY-01` — (a) extend the
bundle-output gate to the host config; (b) add settle subreason persistence; (c) after human authorization, redeploy the
host Worker from a commit containing `3fc1664` (a production mutation of a single-version script — separate gate) and
verify with a host-bundle synthetic probe; (d) only then a fresh real-payment authorization.

## Final block

```
FIRST_PAID_VERIFY_SETTLEMENT_REJECTION_RECONCILIATION_01=PASS
ATTEMPT_COUNT=1  RETRY_COUNT=0
QUOTE_ID=qte_cb80d25d2699c42966ec77cd
REQUEST_ID=1385968b-5aaa-4f0b-991d-8c263b3c99aa
REQUIREMENT_ID=req_fe2ba421b480265ca9a005a4
PAYMENT_ID=pay_5ce76fc95a1748fd875acf93f70d5d0b
ATTEMPT_ID=8f4253a7-b617-495e-b4ba-37eeb7ad8fe0
JOB_ID=af5f7e55-d9ba-43e1-99b6-66cde5ac6a37
VERIFY_COMPLETED=YES  EXECUTION_STARTED=YES  SETTLE_REQUESTED=YES
SETTLE_JWT_MINT=NOT_OBSERVABLE  SETTLE_AUTH_HEADERS=NOT_OBSERVABLE
SETTLE_HTTP_STATUS=not_observable  SETTLE_ERROR_CODE=not_observable  SETTLE_ERROR_REASON=not_observable
AUTHORIZATION_VALID_AT_VERIFY=YES  AUTHORIZATION_VALID_AT_SETTLE=YES
PRIOR_SUCCESS_SETTLEMENT_PARITY=PARTIAL
SETTLEMENT_RELEVANT_DELTA=Workflow host Worker 2833ed03 (source 9502db3) has 8cc7222 regression, lacks 3fc1664 JWT init fix
EXECUTION_ACCEPTED_FOR_SETTLEMENT=YES  SERVICE_OUTPUT_HASH_VALID=YES
RESULT_PERSISTENCE_BEHAVIOR=EXPECTED_GATING_BEHAVIOR
JOB_STATE=REFUND_REQUIRED
REFUND_REQUIRED_SEMANTICS=generic post-execution settlement-failure bucket; misleading when no funds moved
REFUND_ACTUALLY_OWED=NO
ONCHAIN_TRANSACTION=NO  USDC_TRANSFER=NO  AUTHORIZATION_USED=NO
SUCCESSFUL_SETTLEMENTS=0  RECEIPT_ID=none
CLIENT_TIMEOUT_CAUSAL_TO_SETTLEMENT_FAILURE=NO
SETTLEMENT_FAILURE_CLASS=UNKNOWN_EXACT_REASON_NOT_RECORDED
SETTLEMENT_OBSERVABILITY_GAP=YES
ROOT_CAUSE=not directly recorded; strongly indicated: un-remediated JWT bundle-init defect in the Workflow host Worker
MINIMUM_PROPOSED_FIX=settle subreason persistence + host-bundle gate + (authorized) host redeploy from >=3fc1664
REAL_PAYMENT_RETRY_AUTHORIZED=NO  WEB_DIRECT_CANARY_AUTHORIZED=NO
NEXT_RECOMMENDED_CHECKPOINT=FIRST-PAID-VERIFY-SETTLEMENT-OBSERVABILITY-01
```
