# SUN-1221E3R — Reconciliation of the Ambiguous `web_context_verified.v2` Paid Submission

**Checkpoint:** SUN-1221E3R (read-only reconciliation of the SUN-1221E3 real paid E2E attempt)
**Lineage:** SUN-1221E2T1 implementation `dd9943e4d6e38a54a4906ca41288342502425a81`, evidence
`bfcd132700b0a15a4440b29f0464e83113da380d`. Both resolve to full SHAs matching the checkpoint's
citation exactly; `HEAD` at reconciliation start was `bfcd132`, confirming
`CANDIDATE_DRIFT_SINCE_E2T1=NO`.

## 0. Authoritative client result

The operator ran `pnpm exec tsx scripts/web-context-first-paid-e2e.ts` exactly once, with real CDP
credentials. The credential-gated live test returned:

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

The client's own test suite completed 14/14 PASS, proving the client behaved safely (single 402,
single signature, single submission, no retry) — but that says nothing about whether payment
settled. This document reconciles the actual outcome from independent evidence.

## 1. Immediate production restoration

Before any forensic analysis, production was restored:

```
$ pnpm exec wrangler versions deploy de70bf98-f304-4d7f-b189-4ae2401041a0@100 \
    --message "SUN-1221E3R: mandatory restoration after ambiguous paid submission (HTTP 502)" --yes
SUCCESS  Deployed siteborne-utility-edge version de70bf98-f304-4d7f-b189-4ae2401041a0 at 100% (0.86 sec)
```

Authoritative read-back (`wrangler deployments status`):

```
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

- `SUN1221E3_RESTORATION=PASS`
- `ACTIVE_DEPLOYMENT_VERSION_COUNT=1`
- `FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`
- `FINAL_PRODUCTION_TRAFFIC=100%`
- `E3_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`

## 2. Post-restoration safety

```
GET /health   -> HTTP 200 {"status":"ok",...}
GET /ready    -> HTTP 200 {"status":"not_ready","production_services_enabled":true,
                  "blocked_external":["ionos_dns_migration","nevermined_credentials","registry_publication"],...}
GET /catalog  -> verify_agent_output.v2 production_enabled=true; web_context_verified.v2 production_enabled=false
pnpm production:preflight -> PREFLIGHT RESULT: PASS
```

- `POST_E3_FIRST_SERVICE_HEALTH=PASS`
- `POST_E3_WEB_CONTEXT_PRODUCTION_ACTIVE=NO`
- `POST_E3_PRODUCTION_PREFLIGHT=PASS`

## 3. The exact attempt, recovered from the E3-owned tail capture

An E3-owned `wrangler tail --format json` process (started before the qualification/payment gate,
still running) captured the real submission. One event matches: candidate-attributed
(`scriptVersion.id = 54d87b77-e3fd-44da-a012-a817c23f1953`), `POST /v2/web/context`, a
`payment-signature` header present, `outcome: "ok"`, `exceptions: []`, `response.status: 502`.

`outcome: "ok"` with zero exceptions is decisive on its own: the Worker did not crash or exceed a
limit. It executed a normal request/response cycle and *deliberately* returned 502 from application
code.

Sanitized, non-reversible identifiers recovered from the (locally decoded, never printed in full)
`PAYMENT-SIGNATURE` header:

- `E3_PAYMENT_ATTEMPT_ID = pay_f2aef800737144979cafe8281f504074`
- `E3_QUOTE_ID = qte_5bddf139a844065020b17867`
- `E3_AUTH_NONCE_HASH (sha256 of raw nonce) = 5adc4249d045556deabfa630d8732443d8f4624123ac6ff43dff3cb9814cc03c`
- `E3_AUTH_VALID_AFTER = 0`
- `E3_AUTH_VALID_BEFORE = 1788042992 (2026-08-29T22:36:32Z)`
- `E3_PAYMENT_AMOUNT_ATOMIC = 9000`
- `E3_BUYER = 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`
- `E3_PAYTO = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`
- `E3_ASSET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- `E3_NETWORK = eip155:8453`
- `E3_SCHEME = exact`

All fields exactly match the frozen contract. No raw signature, no raw nonce, and no private/wallet
material is reproduced anywhere in this report.

## 4. Current buyer economic state (read-only, on-chain)

```
BUYER_USDC_BALANCE_ATOMIC_NOW = 28197   (unchanged from pre-attempt balance)
BUYER_USDC_DELTA_ATOMIC = 0
BUYER_NATIVE_BALANCE_WEI = 10000000000000 (unchanged, no gas spent by buyer — CDP-custodial signing, no client-side broadcast)
```

## 5. On-chain transaction reconciliation

Queried Base USDC `Transfer` event logs directly (not a block-explorer UI) for ~700 blocks
(≈23 minutes, fully spanning the attempt) in both directions:

```
Transfer events FROM buyer (0x516F...ecB99): 0
Transfer events TO seller (0x7f44...E6E1): 0
```

- `E3_ONCHAIN_TX_HASH = NONE`
- `E3_ONCHAIN_TX_STATUS = NONE`
- `E3_ONCHAIN_TRANSFER_AMOUNT_ATOMIC = 0`
- `E3_BUYER_NATIVE_TOKEN_DELTA = 0`

## 6. EIP-3009 authorization state

Queried Base USDC's authoritative `authorizationState(authorizer, nonce)` view function directly
on-chain for the exact buyer + nonce from this attempt (nonce passed as an argument, never
printed):

```
E3_AUTH_ONCHAIN_USED = false
```

- `E3_AUTH_EXPIRED = YES` (`validBefore` 2026-08-29T22:36:32Z has passed; current time at
  reconciliation was 2026-08-29T22:40+Z)
- `E3_AUTH_ONCHAIN_USED = NO`
- `E3_OLD_AUTHORIZATION_RETIRED = YES` (unused, expired, no late settlement — fully dead, cannot be
  replayed)

## 7. D1 payment state (read-only)

`payment_attempts` row for `pay_f2aef800737144979cafe8281f504074`:

```
lifecycle_stage: "verified"
settlement_transaction_reference: null
service_output_hash: null
service_receipt_id: null
```

- `E3_D1_PAYMENT_ATTEMPT_STATUS = verified` (never advanced past `verified` — the `verified ->
  executed` transition in `x402-service.ts` only fires after a successful executor result, which
  never happened)
- `E3_D1_PAYMENT_ATTEMPT_COUNT = 1`
- `E3_D1_SETTLEMENT_TRANSACTION_REFERENCE = null`
- `E3_D1_SETTLEMENT_COUNT = 0`
- `E3_D1_SERVICE_RESULT_COUNT = 0` (`x402_service_results` table: zero rows for this payment
  identifier)
- `E3_D1_RECEIPT_COUNT = 0`
- `security_events` in the attempt window: 0 rows (no anomaly flagged)

`audit_events` for this attempt's `job_id` (`c51a822e-c110-43e1-ac6e-cb1a5444315e`), in order:

| timestamp | event_type | detail |
|---|---|---|
| 22:35:32.499Z | `job_created` | payment_identifier linked |
| 22:35:32.829Z | `payment_verification_requested` | — |
| 22:35:32.941Z | `payment_verified` | facilitator `verify()` succeeded |
| 22:35:33.156Z | `service_execution_started` | real `web_context_verified.v2` executor invoked |
| 22:35:33.315Z | `service_execution_diagnostic` | **the decisive record — see §8** |

No further events exist for this job. No `service_execution_completed`, no settlement-stage
transition, no receipt event.

## 8. Facilitator / provider reconciliation, using E2D's diagnostic instrumentation

Reading the source path this request actually took
(`apps/edge-api/src/control-plane/routes/x402-service.ts:1386-1461`):

1. `evidenceProvider.verify(...)` succeeded — `payment_verified` audit event confirms.
2. `config.executor(body, ...)` (the real `web_context_verified.v2` executor) was invoked and
   returned **without throwing** (`exceptions: []` in the tail event confirms this directly).
3. The executor's own result had `result_class !== 'success'`, so the route's post-executor branch
   fired: transitions to `QUARANTINED -> REJECTED`, writes exactly one
   `service_execution_diagnostic` audit event (SUN-1221E2D's new instrumentation, added
   specifically so the *next* failure like SUN-1221E2's silent 502 would be diagnostically
   decisive), and returns `jsonError(c, 502, 'service_execution_failed', ...)`.
4. **Settlement is unreachable from this branch.** The facilitator's `settle()` call lives strictly
   after the `EXECUTING -> VERIFYING -> EXECUTION_COMPLETED` transition, which this attempt never
   reached.

The `service_execution_diagnostic` audit event recorded:

```json
{
  "job_id": "c51a822e-c110-43e1-ac6e-cb1a5444315e",
  "request_id": "84f3b2e0-6b12-42d6-9ddb-1a678392b52c",
  "result_class": "internal_verification_failed",
  "diagnostic_reason_code": "WEBCTX_UPSTREAM_PROTOCOL_ERROR",
  "diagnostic_stage": "direct_public_http_fetch"
}
```

- `E3_FACILITATOR_VERIFY_CALLED = YES`, `E3_FACILITATOR_VERIFY_STATUS = success`
- `E3_EXECUTOR_INVOKED = YES`
- `E3_FACILITATOR_SETTLE_CALLED = NO` (proven by code-path trace, not inferred from
  verification succeeding — exactly the inference the checkpoint warned against making)
- `E3_FACILITATOR_SETTLE_STATUS = not_attempted`
- `E3_SETTLEMENT_REFERENCE = null`
- `E3_EXECUTOR_DIAGNOSTIC_REASON = WEBCTX_UPSTREAM_PROTOCOL_ERROR`
- `E3_EXECUTOR_DIAGNOSTIC_STAGE = direct_public_http_fetch`
- `E3_EXECUTOR_RESULT_CLASS = internal_verification_failed`

`diagnostic_stage = direct_public_http_fetch` (not `terms_review` or any policy-gate stage) proves
the request got **past** `globalTermsGuard` cleanly on the `operator_risk_acceptance` path — the
SUN-1221E2T/E2T1 fix worked as designed. The failure is a distinct, later fault: the real fetch to
`https://example.com/` from the live Cloudflare Workers runtime failed at the HTTP protocol layer
(malformed/unexpected response handling), not at DNS, TCP connect, TLS, or the terms gate.

- `E3_TERMSGUARD_RISK_ACCEPTANCE_PATH_USED = YES`
- `E3_SAFE_SOCKET_PATH_EXECUTED = YES` (implied — a protocol-layer failure occurs after a
  connection is established)
- `E3_CANONICAL_TARGET_FETCHED = NO` (the fetch did not complete successfully)
- `E3_UPSTREAM_HTTP_STATUS`: not captured by this diagnostic record (the failure was in protocol
  handling, not a clean upstream status code)

## 9. Result / PCC / receipt reconciliation

- `E3_PCC_OUTPUT_EXISTS = NO`
- `E3_PCC_OUTPUT_VALID = NO`
- `E3_RESULT_PERSISTED = NO`
- `E3_RECEIPT_EXISTS = NO`
- `E3_RECEIPT_VALID = NO`
- `E3_SERVICE_RESULT_ID = (none)`
- `E3_RECEIPT_ID = (none)`

## 10. Exact failure-stage classification

Selected from the checkpoint's exhaustive class list:

**`E3_502_ROOT_CAUSE_CLASS = F_EXECUTOR_HTTP_PROTOCOL_FAILED`**
**`E3_502_ROOT_CAUSE_PROVEN = YES`**

Ruled out with direct evidence, not inference:

- `A_PAYMENT_VERIFY_FAILED` — no; `payment_verified` audit event fired.
- `B_EXECUTOR_POLICY_BLOCKED` — no; `diagnostic_stage=direct_public_http_fetch`, not a terms-gate
  stage. The E2T1 fix is proven working under real payment pressure.
- `C/D/E` (DNS / socket / TLS) — no; the reason code is explicitly
  `WEBCTX_UPSTREAM_PROTOCOL_ERROR`, a distinct code from the DNS/socket/TLS codes E2D also
  instrumented.
- `G_EXECUTOR_TIMEOUT` — no; distinct reason code exists for timeout, not what fired.
- `I/J/K` (settlement-adjacent classes) — no; settlement was never reached, proven by code-path
  trace and by `payment_attempts.lifecycle_stage` never advancing past `verified`.
- `H_EXECUTOR_OTHER_FAILURE` / `L_UNKNOWN` — not selected; SUN-1221E2D's diagnostic instrumentation
  did its job and produced a specific, named class instead of an unknown one.

The prior SUN-1221E2 failure class (`H_UNKNOWN`, unproven) was **not** copied forward. This attempt
has its own, independently-evidenced classification.

## 11. Settlement decision

**`E3_SETTLEMENT_OUTCOME = NOT_ATTEMPTED`**

Not `FAILED` — the facilitator's `settle()` was never called at all (proven by code-path trace: the
branch that calls it is downstream of `EXECUTION_COMPLETED`, which this attempt never reached).

- `E3_SETTLEMENT_COUNT = 0`
- `E3_DUPLICATE_SETTLEMENT_DETECTED = NO` (zero settlements exist to duplicate; confirmed by
  `x402_service_results` count = 0 and on-chain Transfer-log search = 0 in both directions)

## 12. Economic effect

- `E3_BUYER_USDC_ECONOMIC_EFFECT_ATOMIC = 0`
- `E3_BUYER_NATIVE_TOKEN_ECONOMIC_EFFECT = 0`
- `E3_SELLER_USDC_RECEIVED_ATOMIC = 0`

No amount moved in either direction. The authorized-but-unused EIP-3009 authorization for exactly
9000 atomic USDC expired at 2026-08-29T22:36:32Z and is now permanently unusable
(`E3_OLD_AUTHORIZATION_RETIRED = YES`).

## 13. Was E3 actually successful despite the client's HTTP 502?

No. All of the required conditions for `SUCCESS_DESPITE_CLIENT_502` fail:

- settlement success — NO (never attempted)
- exact 9000 atomic transfer — NO (zero on-chain transfer)
- real executor succeeded — NO (`result_class: internal_verification_failed`)
- canonical target fetched — NO
- PCC valid / result persisted / receipt valid — NO / NO / NO

**`E3_RECONCILED_E2E_OUTCOME = FAIL_RECONCILED_NO_SETTLEMENT`**

Economic state is fully resolved (not merely "no evidence of settlement" — direct on-chain
Transfer-log search and `authorizationState` query both independently confirm zero economic
effect), so this is not `AMBIGUOUS`. It is a definitively reconciled failure with zero settlement
and zero economic effect.

**`SUN1221E3_REAL_PAID_E2E = FAIL`**

## 14. Canary eligibility

`SUN1221F_PUBLIC_CANARY_ELIGIBLE = NO` — E3 did not reach a proven successful end-to-end paid
settlement. A further real paid attempt would require its own fresh, standalone authorization, and
ideally a fix for `WEBCTX_UPSTREAM_PROTOCOL_ERROR` in the `direct_public_http_fetch` stage first, so
the next attempt isn't spent rediscovering the same class of failure.

## 15. Local client fix (in scope, narrow)

One stray uncommitted edit was found and folded into this checkpoint's evidence: the local one-shot
E2E client (`apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts`) still pointed
`CANDIDATE_VERSION_ID` at the retired SUN-1221E2 candidate (`915be949-...`) after SUN-1221E2T1
uploaded the current one (`54d87b77-...`). This caused the operator's first re-run this checkpoint
cycle to fail at `PRE_CHALLENGE` with HTTP 404 (zero payment material created) before the real
attempt reported in §0 above. Fixed to point at the current candidate; typecheck clean; 13/13
non-economic tests pass, 1 correctly skipped without live credentials. No Worker runtime, candidate
source, economics, or payment-semantics files touched.

## Final stop packet

```
SUN1221E3_CLIENT_OUTCOME=AMBIGUOUS
SUN1221E3_REAL_PAID_E2E=FAIL
SUN1221E3_RECONCILED_E2E_OUTCOME=FAIL_RECONCILED_NO_SETTLEMENT
SUN1221E3R_EVIDENCE_COMMIT_SHA=<set at commit time, below>
SUN1221E3_RESTORATION=PASS
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
POST_E3_PRODUCTION_PREFLIGHT=PASS
E3_AUTH_VALID_BEFORE=1788042992 (2026-08-29T22:36:32Z)
E3_AUTH_EXPIRED=YES
E3_AUTH_ONCHAIN_USED=NO
E3_OLD_AUTHORIZATION_RETIRED=YES
BUYER_USDC_BALANCE_ATOMIC_NOW=28197
BUYER_USDC_DELTA_ATOMIC=0
E3_ONCHAIN_TX_HASH=NONE
E3_ONCHAIN_TX_STATUS=NONE
E3_ONCHAIN_TRANSFER_AMOUNT_ATOMIC=0
E3_D1_PAYMENT_ATTEMPT_STATUS=verified
E3_D1_SETTLEMENT_TRANSACTION_REFERENCE=null
E3_D1_SETTLEMENT_COUNT=0
E3_D1_SERVICE_RESULT_COUNT=0
E3_D1_RECEIPT_COUNT=0
E3_FACILITATOR_VERIFY_STATUS=success
E3_EXECUTOR_INVOKED=YES
E3_EXECUTOR_DIAGNOSTIC_REASON=WEBCTX_UPSTREAM_PROTOCOL_ERROR
E3_EXECUTOR_DIAGNOSTIC_STAGE=direct_public_http_fetch
E3_FACILITATOR_SETTLE_CALLED=NO
E3_FACILITATOR_SETTLE_STATUS=not_attempted
E3_SETTLEMENT_OUTCOME=NOT_ATTEMPTED
E3_PCC_OUTPUT_VALID=NO
E3_RESULT_PERSISTED=NO
E3_RECEIPT_VALID=NO
E3_SETTLEMENT_COUNT=0
E3_DUPLICATE_SETTLEMENT_DETECTED=NO
E3_BUYER_USDC_ECONOMIC_EFFECT_ATOMIC=0
E3_BUYER_NATIVE_TOKEN_ECONOMIC_EFFECT=0
E3_502_ROOT_CAUSE_CLASS=F_EXECUTOR_HTTP_PROTOCOL_FAILED
E3_502_ROOT_CAUSE_PROVEN=YES
CURRENT_REAL_PAYMENT_AUTHORIZATION=CONSUMED
SECOND_E3_PAYMENT_ATTEMPT_AUTHORIZED=NO
SUN1221F_PUBLIC_CANARY_ELIGIBLE=NO
```
