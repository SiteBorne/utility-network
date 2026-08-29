# SUN-1221E2R — web_context_verified.v2 502 forensic reconciliation (read-only)

## 1. E2 evidence reconciliation

```
SUN1221E2_EVIDENCE_COMMIT_SHA=814e66c9a31e11e7093b95d577f089d3dcabbb5f
git status --short (pre-checkpoint) = clean
git rev-parse HEAD (pre-checkpoint) = 814e66c9a31e11e7093b95d577f089d3dcabbb5f
```

The committed E2 report (`docs/reports/SUN-1221E2-web-context-v2-paid-e2e-ambiguous-reconciliation.md`) was inspected directly. All required literal evidence is present and matches: one payment signature created, one paid submission, HTTP 502, no retry, `SUN1221E2_RESTORATION=PASS`, initial on-chain check found no transaction, initial buyer balance unchanged (28197 atomic), D1 `settlement_transaction_reference=null`, no `x402_service_results` row, `SUN1221F_PUBLIC_CANARY_ELIGIBLE=NO`.

One thing the E2 report got **wrong** as a guess (flagged, not hidden): §5's classification speculated the 502 was *"most likely the facilitator's `settle` call itself erroring or timing out."* Forensic evidence recovered in this checkpoint (§7) proves that guess incorrect — the facilitator's `settle` endpoint was **never called at all**. Correcting this here rather than letting the earlier speculation stand uncorrected.

## 2. Sanitized old authorization metadata

Recovered from the live Cloudflare tail capture active during the E2 attempt (`payment-signature` request header, base64-decoded locally). The raw signature and raw nonce are never printed below — only non-reusable derived values (address/value/timestamp fields, and one-way hashes).

```
OLD_AUTH_FROM=              0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
OLD_AUTH_TO=                0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
OLD_AUTH_VALUE=             9000
OLD_AUTH_VALID_AFTER=       0
OLD_AUTH_VALID_BEFORE=      1788026127  (2026-08-29T17:55:27Z)
OLD_AUTH_NONCE_HASH=        sha256:a1d21173e0f2448121d3e5f87549c076e4146033a5ef54ac93aed017ad32fa95
OLD_AUTH_NETWORK=           eip155:8453
OLD_AUTH_ASSET=             0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
OLD_AUTH_SCHEME=            exact
OLD_AUTH_QUOTE_ID=          qte_9963cfc676f1f3849db19a3d
OLD_AUTH_PAYMENT_ATTEMPT_ID=pay_5b90677d6a7d4a178bec037e21409e22
SIGNATURE_SHA256_FINGERPRINT (not reusable) = sha256:c0c6559a06f9ff38c9dac59676ea8f782a027a089d0226c8b2fa07b09a9f00d7
```

Note: `OLD_AUTH_QUOTE_ID` recovered here (`qte_9963...`) differs from the fresh-402 quote id recorded in the E2 report's gating step (`qte_1cdda6b8...`). This is expected, not an anomaly: the E2E client re-fetched a fresh 402/quote immediately before signing (quotes are short-lived), and the authorization was built against that second, later quote — the one that matches the D1 `payment_attempts.quote_id` exactly.

## 3. Authorization expiry

```
CURRENT_TIME=            2026-08-29T18:06:47Z
OLD_AUTH_VALID_BEFORE=   2026-08-29T17:55:27Z
OLD_AUTH_EXPIRED=        YES  (current time is ~11 minutes past validBefore)
```

## 4. On-chain authorization state (read-only)

The exact EIP-3009 nonce is not independently recoverable from D1 (the schema does not persist `nonce`/`from`/`validBefore` in `payment_attempts` — only `payee`/`amount`/`network`/`asset`/`scheme`). A nonce-specific `authorizationState()` call is therefore not performed; instead, the broader and strictly stronger check — the buyer address's full balance and transaction history — is used, which proves no USDC of any kind moved for this buyer, regardless of which nonce would have been consumed.

```
BUYER_USDC_BALANCE_ATOMIC_NOW=  28197  (fresh read via viem, direct Base mainnet RPC, this checkpoint)
BUYER_USDC_BALANCE_BEFORE_E2=   28197  (from E2 report)
BUYER_USDC_BALANCE_AFTER_E2=    28197  (from E2 report)
→ unchanged across all three reads.

OLD_AUTH_ONCHAIN_USED=       NO   (inferred from unchanged balance; no nonce-specific check possible — see above)
OLD_AUTH_LATE_TRANSACTION_HASH=  NONE
OLD_AUTH_LATE_SETTLEMENT=    NO
```

## 5. Late provider / D1 reconciliation (fresh, this checkpoint)

```sql
SELECT * FROM payment_attempts WHERE payment_identifier='pay_5b90677d6a7d4a178bec037e21409e22';
```

```
lifecycle_stage:                    verified   (unchanged since E2)
settlement_transaction_reference:   null
consumed_at:                        null
expires_at:                         2026-08-29T17:59:27.958Z  (quote/requirement expiry; already passed)
```

```sql
SELECT COUNT(*) FROM x402_service_results WHERE payment_identifier='pay_5b90677d6a7d4a178bec037e21409e22';
→ 0
```

```
PAYMENT_ATTEMPT_STATUS_NOW=            verified (not settled)
SETTLEMENT_TRANSACTION_REFERENCE_NOW=  null
SETTLEMENT_COUNT_NOW=                  0
RECEIPT_COUNT_NOW=                     0
SERVICE_RESULT_COUNT_NOW=              0
```

No silent transition to settled occurred. State is identical to what E2 originally recorded.

## 6. Old authorization retirement gate

All required conditions hold:

```
CURRENT_TIME > OLD_AUTH_VALID_BEFORE                    → YES (18:06:47 > 17:55:27)
OLD_AUTH_ONCHAIN_USED = NO                               → YES
OLD_AUTH_LATE_SETTLEMENT = NO                             → YES
SETTLEMENT_TRANSACTION_REFERENCE_NOW = null                → YES
SETTLEMENT_COUNT_NOW = 0                                   → YES
RECEIPT_COUNT_NOW = 0                                       → YES
SERVICE_RESULT_COUNT_NOW = 0                                 → YES
buyer balance shows no corresponding debit                    → YES

OLD_AUTHORIZATION_RETIRED = YES
```

## 7. Root-causing the HTTP 502

Recovered the live Cloudflare tail capture (`wrangler tail --format json`) that was running during the E2 attempt and located the exact request/response pair by timestamp and `payment-signature` header (see §2). Traced the full path from committed source:

**Actual call order in `x402-service.ts` (verify → execute → settle, NOT verify → settle → execute):**

1. Facilitator `verify()` is called and **succeeds** — proven three ways: (a) D1 `lifecycle_stage=verified`; (b) the tail log's single `"[x402] extension responses: {}"` line is emitted only from `@x402/core`'s `HTTPFacilitatorClient.verify()` success path (`dist/cjs/server/index.js:630`), never from a failure branch; (c) the state-machine transition `PAYMENT_CHALLENGED → PAYMENT_VERIFIED` requires a successful verify.
2. The route then calls `config.executor(body, {...})` — the real `web_context_verified.v2` executor (`web-context-v2-production-executor.ts` → `WebContextVerifiedService.execute` → `PublicHttpAdapter.execute` → `SecureHttpClient.fetch`, using the SUN-1221C `SafeSocketHttpClient` raw-socket path against the real `https://example.com/`).
3. The executor returned a result with `result_class !== 'success'` (or missing `receipt`/`output_hash`/`receipt_id` — the evidence does not distinguish which, see below).
4. This hits `apps/edge-api/src/control-plane/routes/x402-service.ts:1429-1441` exactly:
   ```ts
   if (
     outcome.result.result_class !== 'success' ||
     !outcome.result.receipt || !outcome.result.output_hash || !outcome.result.receipt_id
   ) {
     await transition(jobId, 'EXECUTING', 'QUARANTINED', 'EXECUTION_FAILED');
     await transition(jobId, 'QUARANTINED', 'REJECTED', 'QUARANTINE_POLICY');
     return jsonError(c, 502, 'service_execution_failed', outcome.result.failure?.message ?? ...);
   }
   ```
5. **Facilitator `settle()` was never called.** This is proven, not assumed: `@x402/core`'s `settle()` success path emits its own `"[x402] extension responses: ..."` log line (`dist/cjs/server/index.js:679`) — the tail capture shows exactly **one** such line for this request, matching only the `verify()` call. D1's `lifecycle_stage` never advances past `verified` (the code only transitions it to `executed` *after* a successful executor call — see the `SUN-1200 checkpoint C` comment at `x402-service.ts` around line 1451 — which this request never reached).

```
E2_502_FAILURE_STAGE=              executor / web-fetch adapter layer (SUN-1221C code), strictly before settlement
E2_502_THROW_SITE=                 apps/edge-api/src/control-plane/routes/x402-service.ts:1434-1440 (jsonError 502 branch)
E2_502_HTTP_MAPPING_SITE=          same location
FACILITATOR_VERIFY_RESULT=         success
FACILITATOR_SETTLE_REQUEST_ATTEMPTED=  NO
FACILITATOR_SETTLE_RESPONSE_STATUS=    N/A (never attempted)
FACILITATOR_SETTLE_RESPONSE_BODY_SANITIZED= N/A
FACILITATOR_SETTLE_ERROR_CLASS=        N/A
```

**This corrects the original E2 report's speculative classification** (§1 above) — the failure has nothing to do with the CDP facilitator's settlement endpoint at all.

## 8. Provider request/response forensics — deeper trace

The Cloudflare tail event for the failing request shows:

```
outcome:      "ok"     (Cloudflare did NOT record an unhandled exception/crash)
exceptions:   []       (empty — confirms no uncaught error propagated to the top)
response.status: 502
wallTime:     974ms
cpuTime:      45ms     (→ ~929ms was I/O wait, not computation — consistent with a real
                          outbound network attempt, not an instant synchronous rejection)
logs:         exactly one line, from the verify() success path only
```

The large wallTime/cpuTime gap rules out an instant, synchronous `resultClass: 'invalid_request'` (URL-format validation failure would be sub-millisecond). It is consistent with either (a) the raw-socket `SafeSocketHttpClient` connect/TLS/DoH-resolution path genuinely attempting and failing/timing out against `https://example.com/`, or (b) a slower-but-successful fetch followed by a verification-mesh (`signed.verdict.decision !== 'pass'`) rejection during PCC document signing. **No log statement exists anywhere on either failure path** (`PublicHttpAdapter.execute`'s catch-and-classify branch and `WebContextVerifiedService.execute`'s non-success branches are both silent by design — confirmed by direct source inspection), so the tail capture cannot distinguish between these two possibilities. Reproducing the exact failure would require either a new live request (not authorized in this read-only checkpoint) or adding diagnostic logging first.

```
VERIFY_SERVICE_SETTLEMENT_PATH=      verify → transition PAYMENT_VERIFIED → execute → (settle only on success)
WEB_CONTEXT_SETTLEMENT_PATH=         identical (same `x402-service.ts` route handler, config-driven; no service-specific settlement code)
SETTLEMENT_PATH_SHARED=              YES
SETTLEMENT_REQUEST_SEMANTIC_DIFFERENCES= NONE (settlement code path is 100% shared; the difference is entirely upstream, in each service's own executor)
```

## 9. Root-cause classification

```
E2_502_ROOT_CAUSE_CLASS=    H_UNKNOWN
E2_502_ROOT_CAUSE_PROVEN=   NO
```

**What is proven, precisely, by direct evidence:** the failure occurred in the `web_context_verified.v2` executor/adapter layer (SUN-1221C's brand-new real-outbound-fetch code path, its first-ever live invocation), strictly before any facilitator settlement call — not a payment/settlement bug, not a facilitator-side failure, not an on-chain event.

**What is not proven:** the exact low-level failure mechanism inside that layer (raw-socket connect/TLS failure, DoH resolution failure, or verification-mesh signing rejection), because every relevant failure branch in `PublicHttpAdapter.execute` and `WebContextVerifiedService.execute` is silent (no logging) by the current design, and no second live request is authorized in this checkpoint to reproduce it with added instrumentation.

Per this checkpoint's own instruction — *"If UNKNOWN: do not implement speculative fixes"* — no source change is made.

## 10. Repository fix requirement

```
REPOSITORY_FIX_REQUIRED=   UNPROVEN
```

Cannot be determined without first knowing the exact mechanism. It could be a genuine repository bug in the untested raw-socket path (fix required) or a one-off transient network condition against a fresh, never-before-exercised code path (no fix required, just retry once diagnostics exist). Implementing any change now would be guessing at a mechanism not yet observed — exactly what this checkpoint prohibits.

**Recommendation for a future, separately authorized checkpoint (not executed here):** add narrow, non-functional diagnostic logging to the two silent failure branches identified in §8 (`PublicHttpAdapter.execute`'s final catch-and-classify branch, and `WebContextVerifiedService.execute`'s `result.resultClass !== 'success'` / `signed.verdict.decision !== 'pass'` branches) so that *if* a future real attempt fails the same way, the actual cause is captured instead of silently swallowed. This is observability, not a "fix" — it changes no economic, security, or execution behavior.

## 11. TDD / mutation proof

```
E2_502_TDD_RED=   NOT_REQUIRED   (REPOSITORY_FIX_REQUIRED is not YES; no fix implemented; nothing to reproduce a RED test against without guessing at the mechanism)
```

## 12. Settlement failure safety (verified against current source, no changes)

Confirmed by direct source inspection (`x402-service.ts` and `@x402/core`'s settlement orchestration, §1490-1610):

```
- Facilitator settle 5xx/failure → executor is never invoked a second time, and was never invoked
  for settlement in the first place here (executor runs BEFORE settle, not after).
- No automatic internal resubmission of a payment exists anywhere in the settle path.
- No receipt is issued on a failed/unreached settlement (confirmed: RECEIPT_COUNT_NOW=0).
- No service result is persisted on a failed/unreached settlement (confirmed: SERVICE_RESULT_COUNT_NOW=0).
- No duplicate attempt occurred (exactly one payment_attempts row exists for this payment_identifier).

AUTOMATIC_SETTLEMENT_RETRY_COUNT=  0
```

## 13. First-service non-regression

No source was changed in this checkpoint, so first-service (`verify_agent_output.v2`) behavior is unchanged by construction. This was not independently re-exercised live (no live requests authorized in this read-only checkpoint).

```
FIRST_SERVICE_PAYMENT_PATH_CHANGED=   NO
FIRST_SERVICE_ECONOMICS_CHANGED=      NO
```

## 14. Web-context security non-regression

No source was changed. `SafeSocket`/DNS-rebinding/redirect/timeout/size-bound behavior is exactly as it was after SUN-1221C.

```
WEB_CONTEXT_SSRF_POLICY_CHANGED=   NO
```

## 15. Regression

No source changed → full `lint`/`typecheck`/`test`/`test:worker-runtime` suite was not required to be re-run in full for this checkpoint. Ran the two checks this checkpoint's own evidence chain depends on:

```
pnpm production:preflight   → PASS
pnpm secrets:scan           → 1 finding, pre-existing known false positive
                               (BASESCAN_TOKEN_CONTRACT public address literal in
                               docs/reports/SUN-1220O-first-real-paid-e2e.md, commit 322852a,
                               flagged and accepted in every prior checkpoint since SUN-1220O)
NEW_SECRET_FINDINGS=  0
```

## 16. Candidate decision

```
NEW_CANDIDATE_REQUIRED=   NO
```

Source did not change (`REPOSITORY_FIX_REQUIRED=UNPROVEN`, no implementation performed). Candidate `915be949-b46f-464b-a4d6-17b74539ce55` remains the technical candidate, unchanged, for any future authorized retry.

## 17. Production containment

```
ACTIVE_DEPLOYMENT_VERSION_COUNT=   1
FINAL_PRODUCTION_VERSION=          de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=          100%
FINAL_PRODUCTION_PREFLIGHT=        PASS
```

No deployment mutation was performed in this checkpoint (production was already correctly restored by E2's own mandatory-restoration step; this checkpoint only read it back).

## 18. No economic mutation (this checkpoint)

```
NEW_SIGN_TYPED_DATA_CALLS=          0
NEW_EIP3009_AUTHORIZATIONS_CREATED= 0
NEW_PAYMENT_PAYLOADS_CREATED=       0
NEW_PAYMENT_SIGNATURES_CREATED=     0
NEW_PAID_REQUESTS=                  0
NEW_SETTLEMENTS_INITIATED=          0
NEW_TRANSACTIONS_INITIATED=         0
NEW_REAL_ECONOMIC_EFFECT_USDC=      0
```

The old (E2) signature was never reused, printed in full, or resubmitted anywhere in this checkpoint.

## 19. E3 eligibility

```
E2 502 root cause proven sufficiently to justify retry?   PARTIALLY — the failure STAGE is
    proven precise and proven unrelated to payment/settlement/economics; the exact low-level
    mechanism inside the web-fetch layer is not proven.
OLD_AUTHORIZATION_RETIRED=       YES
current candidate integrity PASS=  YES (915be949, unchanged since E1)
production containment PASS=      YES
no late settlement occurred=      YES

SUN1221E3_REAL_PAID_RETRY_ELIGIBLE=  YES
```

A fresh real-paid retry is technically eligible under the letter of §24's conditions (old authorization fully retired, no late settlement, candidate and production containment both PASS). It is worth being explicit with the user, outside this stop packet's fixed fields, about the residual risk this creates: retrying without first adding the diagnostic logging recommended in §10 means a second failure would leave us exactly as uncertain about the mechanism as this one did — a second real payment attempt at genuine, still-unexplained risk of repeating an unexplained failure. That tradeoff is the user's call to make, not this checkpoint's to decide.

## 20. Final stop packet

```
SUN1221E2R_RECONCILIATION=              PASS
SUN1221E2_EVIDENCE_COMMIT_SHA=          814e66c9a31e11e7093b95d577f089d3dcabbb5f
SUN1221E2R_EVIDENCE_COMMIT_SHA=         <recorded after commit, below>

E2_CLIENT_OUTCOME=                      AMBIGUOUS
E2_RECONCILED_SETTLEMENT_OUTCOME=       NO_SETTLEMENT_OCCURRED

OLD_AUTH_VALID_BEFORE=                  2026-08-29T17:55:27Z
CURRENT_TIME=                           2026-08-29T18:06:47Z
OLD_AUTH_EXPIRED=                       YES
OLD_AUTH_ONCHAIN_USED=                  NO
OLD_AUTH_LATE_SETTLEMENT=               NO
OLD_AUTHORIZATION_RETIRED=              YES

BUYER_USDC_BALANCE_ATOMIC_NOW=          28197
PAYMENT_ATTEMPT_STATUS_NOW=             verified
SETTLEMENT_TRANSACTION_REFERENCE_NOW=   null
SETTLEMENT_COUNT_NOW=                   0
RECEIPT_COUNT_NOW=                      0
SERVICE_RESULT_COUNT_NOW=               0

E2_502_FAILURE_STAGE=                   executor/web-fetch adapter layer, before settlement
E2_502_ROOT_CAUSE_CLASS=                H_UNKNOWN
E2_502_ROOT_CAUSE_PROVEN=               NO
REPOSITORY_FIX_REQUIRED=                UNPROVEN
E2_502_TDD_RED=                         NOT_REQUIRED

AUTOMATIC_SETTLEMENT_RETRY_COUNT=       0
FIRST_SERVICE_PAYMENT_PATH_CHANGED=     NO
FIRST_SERVICE_ECONOMICS_CHANGED=        NO
WEB_CONTEXT_SSRF_POLICY_CHANGED=        NO

SUN1221E2R_IMPLEMENTATION_COMMIT_SHA=   NOT_REQUIRED
NEW_CANDIDATE_REQUIRED=                 NO
ACTIVE_E3_CANDIDATE_VERSION_ID=         915be949-b46f-464b-a4d6-17b74539ce55  (unchanged, historical)
REPLACEMENT_CANDIDATE_CONFIG_READBACK=  NOT_REQUIRED
WORKER_VERSION_UPLOADS=                 0

FINAL_PRODUCTION_VERSION=               de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=               100%
FINAL_PRODUCTION_PREFLIGHT=             PASS

NEW_SIGN_TYPED_DATA_CALLS=0
NEW_PAYMENT_SIGNATURES_CREATED=0
NEW_PAID_REQUESTS=0
NEW_SETTLEMENTS_INITIATED=0
NEW_TRANSACTIONS_INITIATED=0
NEW_REAL_ECONOMIC_EFFECT_USDC=0

CURRENT_REAL_PAYMENT_AUTHORIZATION=     NONE
SUN1221E3_REAL_PAID_RETRY_ELIGIBLE=     YES  (see §19 for the residual-risk caveat)
```

STOP. No payment retried. No payment material created. No canary begun. No promotion performed.
