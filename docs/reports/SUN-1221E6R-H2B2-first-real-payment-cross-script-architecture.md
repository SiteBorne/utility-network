# SUN-1221E6R-H2B2 — First Real Payment Through the Final Cross-Script Architecture

## Outcome

`SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION=FAIL_RECONCILED_NO_SETTLEMENT`

Client-side result was `ambiguous` (HTTP 502) — resolved definitively by read-only
reconciliation against the real Workflow instance, D1, and on-chain state. Zero
economic effect, zero retry, zero mutation.

## Pre-payment reconciliation (all PASS)

- Lineage: `de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%, `db7054c9-76ee-4830-aabe-8a4542261b6a` @ 0% — unchanged since H2BF5-FINAL.
- Candidate coherence: cross-script Workflow binding intact (`PaidContinuationWorkflow` defined in `siteborne-paid-continuation-runtime`), all 4 ADR-0055 vars and all secrets present (`wrangler versions view db7054c9...`).
- Single settlement owner: exactly one production call site (`paid-continuation-workflow.ts:480`), inside the Workflow only.
- D1 baseline: 3 non-terminal jobs found and individually investigated — H1 forensic job (untouched, expected), one legitimate terminal `DELIVERED` job (my own filter list was incomplete; `DELIVERED` is a real terminal state in this schema), one benign `LOCKED` artifact (`8187902a-...`) with zero `payment_attempts` rows and `production_enabled=0` — confirmed non-economic, different idempotency key, not a blocker.
- Buyer balance baseline: 28197 atomic. Seller balance baseline: 19000 atomic.
- Fresh 402 challenge obtained directly against the candidate via version-override header: exact authorized economics (`scheme=exact`, `network=eip155:8453`, `asset` = Base USDC, `amount=9000`, `payTo` exact match, `extra.name="USD Coin"`, `extra.version="2"`).
- Operator tool repointed to `db7054c9` (commit `4b1363c`); 120s timeout fix from the H2B checkpoint still in place.

## Operator execution

Human-executed, exactly once, via `pnpm web-context-first-paid-e2e`:

```
{"ok":false,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,"payment_material_created":true,"paid_request_submitted":true,"submission_result":"ambiguous","http_status":502}
```

`SIGNER_CALLS=1`, `PAYMENT_SIGNATURES_CREATED=1`, `PAID_REQUESTS=1` — all confirmed by this actual output. `CLIENT_RESULT_CLASSIFICATION=AMBIGUOUS` (HTTP 502, client cannot see server-side state). Per authorization: no retry, no second signature, no second submission. Proceeded directly to read-only reconciliation.

## Reconciliation

**On-chain (most decisive check, done first):**

```
buyer balance before: 28197 atomic
buyer balance after:  28197 atomic  (unchanged)
seller balance before: 19000 atomic
seller balance after:  19000 atomic  (unchanged)
```

Zero settlement, zero economic effect — confirmed directly on-chain before touching D1 or Workflow state.

**D1 — the real job**, found by querying `jobs` for `service_id='web_context_verified.v2'` ordered by `created_at DESC`:

```
id: 49a43a08-5479-4087-8ada-1afcf8074120
idempotency_key: pay_eb7a027d441448c5b9f5d707e20df776
created_at: 2026-09-01T12:40:04.749Z
current_state: REJECTED (as of 2026-09-01T12:40:13.548Z, 9 seconds later)
```

**Full state-event history** (`job_state_events`, real query, ordered by timestamp):

```
PAYMENT_CHALLENGED  -> PAYMENT_VERIFIED  (PAYMENT_VERIFIED)   12:40:05.231Z
PAYMENT_VERIFIED    -> LOCKED            (RESOURCE_LOCKED)    12:40:05.350Z
LOCKED               -> ROUTED            (ROUTED_TO_WORKER)   12:40:08.799Z
ROUTED               -> EXECUTING         (EXECUTION_STARTED)  12:40:08.933Z
EXECUTING            -> QUARANTINED       (EXECUTION_FAILED)   12:40:13.415Z
QUARANTINED          -> REJECTED          (QUARANTINE_POLICY)  12:40:13.548Z
```

This is a genuinely clean lifecycle: real EIP-3009 payment was verified,
resource was locked, the durable handoff to the dedicated Workflow host
succeeded (`ROUTED_TO_WORKER` — proving the H2BF5-FINAL cross-script
architecture engaged correctly end-to-end for a real request, for the first
time), execution started — and then the executor itself produced a clean
failure verdict, quarantined, and rejected. No ambiguity survives this
reconciliation.

**Real Workflow instance** (`wrangler workflows instances describe`, against the dedicated host):

```
Instance Id: siteborne-wf-d16a93bef301ad802660e2fad5f588af1db37875bb95394b
Version Id:  85dc348b-4fe9-41be-b880-cb83a0875bda  (the qualified H2BF5-FINAL version)
Status:      Completed (platform-level)
Duration:    5 seconds
Last Successful Step: invoke-executor-1
```

Step-by-step:
1. `open-envelope-1` — Success. Decrypted the real payment payload correctly (envelope, settlement context, signed EIP-3009 authorization all present and valid).
2. `check-authorization-expiry-1` — Success. `{"expired":false}`.
3. `invoke-executor-1` — **Success as a step** (ran to completion, did not throw), but its own **output is a failure verdict**:
   ```json
   {
     "result": {
       "result_class": "internal_verification_failed",
       "service_id": "web_context_verified.v2",
       "job_id": "49a43a08-5479-4087-8ada-1afcf8074120",
       "failure": {
         "code": "internal_error",
         "message": "internal exception: EvalError: Code generation from strings disallowed for this context",
         "retryable": false
       }
     }
   }
   ```
   No further steps ran — PCC generation and settlement were never reached, matching the frozen step order and the unchanged on-chain balances exactly.

## Root cause (new, real, actionable)

`EvalError: Code generation from strings disallowed for this context` is the
exact AJV-runtime-schema-compilation-in-Workers failure this project already
fixed once, in SUN-1200 checkpoint F, by precompiling every service's output
schema and registering the precompiled validators via
`setPrecompiledOutputValidators(outputValidatorsById)` at module load —
called today from both real production route files
(`production-web-context-v2-cdp-route.ts`, `production-verify-v2-cdp-route.ts`).

**The dedicated Workflow host (`apps/edge-api/src/workflow-host-entrypoint.ts`,
introduced by H2BF4) never makes that same call.** Since the executor —
and therefore its output-schema validation — now runs *inside the dedicated
host's own Worker isolate* (a separate script from the two route files),
that isolate's AJV instance has no precompiled validators registered, falls
back to runtime `new Function`/`eval`-based schema compilation, and
Cloudflare's isolate blocks it.

This is the same *class* of gap as the E6P Modal-propagation bug and the
H2AWI-3F route-wiring bug: something that worked correctly in the pre-split
architecture silently stopped working when H2BF4 moved the executor into a
separate script, because a piece of module-load-time wiring was never
carried over. It was invisible to every local test in this entire H2BF1–
H2BF5 arc because none of them exercise the real precompiled-validator
registration path — they either mock the executor, use fixture services, or
never reach real output-schema validation with the dedicated host's real
module graph.

## Final reconciliation packet

```
SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION=FAIL_RECONCILED_NO_SETTLEMENT
H2B2_FINANCIAL_AUTHORIZATION=PRESENT
REAL_LIVE_402_REQUESTS=1
PAYMENT_CHALLENGE_VALID=PASS
CHALLENGE_AMOUNT_ATOMIC=9000
CHALLENGE_NETWORK=eip155:8453
CHALLENGE_ASSET=0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913
CHALLENGE_PAYTO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
SIGNER_CALLS=1
PAYMENT_SIGNATURES_CREATED=1
PAID_REQUESTS=1
CLIENT_RESULT_CLASSIFICATION=AMBIGUOUS (client-side; reconciled below)
REAL_WORKFLOW_INSTANCE_ID=siteborne-wf-d16a93bef301ad802660e2fad5f588af1db37875bb95394b
REAL_WORKFLOW_TERMINAL_STATE=Completed (platform) / REJECTED (job, via EXECUTION_FAILED -> QUARANTINE_POLICY)
REAL_EXECUTOR_CALL_COUNT=1
REAL_EXECUTOR_RESULT=internal_verification_failed (EvalError: Code generation from strings disallowed for this context)
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENT_ATTEMPT_COUNT=0
SETTLEMENTS=0
SETTLEMENT_TX_HASH=(none)
SETTLEMENT_BLOCK=(none)
CHAIN_TRANSFERS_MATCHING_9000_ATOMIC=0
BUYER_USDC_BALANCE_BEFORE_ATOMIC=28197
BUYER_USDC_BALANCE_AFTER_ATOMIC=28197
SELLER_USDC_BALANCE_BEFORE_ATOMIC=19000
SELLER_USDC_BALANCE_AFTER_ATOMIC=19000
REAL_ECONOMIC_EFFECT_USDC=0
RESULT_COUNT=0
RECEIPT_COUNT=0
PCC_VALID=N/A (never generated)
RECEIPT_VALID=N/A (never generated)
H2B2_AUTHORIZATION_RETIRED=YES
NEW_HOST_DEPLOYS=0
NEW_WORKFLOW_INSTANCE_CREATIONS=0 (the one real instance is the payment's own, not a separately-authorized qualification instance)
NEW_API_CANDIDATE_UPLOADS=0
NEW_DEPLOYMENT_MUTATIONS=0
D1_MUTATIONS_BY_THIS_CHECKPOINT=0 (read-only throughout)
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_CANDIDATE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
FINAL_CANDIDATE_TRAFFIC=0%
SUN1221F_CANARY_ELIGIBLE=NO
NEXT_REQUIRED_CHECKPOINT=DIAGNOSIS_OR_CORRECTIVE_FIX (wire setPrecompiledOutputValidators into workflow-host-entrypoint.ts, then a fresh H2B2-class real-payment retry under its own new authorization)
```

## Lineage

R1 `4428528`/`fe7efb5`, C1 `701cf50`, C1B `ae46400`, H2BF5-FINAL `8f25a29`,
operator-tool repoint `4b1363c`, this evidence report.
