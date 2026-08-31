# SUN-1221E6R-H1A — Verified-but-Unsettled Authorization Reconciliation

**Supersedes:** the "synthetic artifact" conclusion in H1R (`c1d9e78`), which H1S
(`<prior commit>`) already partially corrected. This report completes that
correction with full financial/execution forensics. Read-only throughout;
zero mutations to jobs, D1, the Worker, or the chain.

## Correction of SUN-1221E6R-H1R

| Claim in H1R | Status | Correction |
|---|---|---|
| `attempt_hash` values are synthetic placeholders | **WRONG** | `computeAttemptHash()` (`apps/edge-api/src/control-plane/state-machine/index.ts:82-101`) is a real production function. It is prefixed `sha256:` but is **not** SHA-256 — it's a 32-bit rolling hash (`hash << 5 - hash + char`, 32-bit masked) rendered as hex and zero-padded to 64 chars. A 32-bit hash only ever produces ≤8 significant hex digits, so ~56-58 leading zeros is the *universal, correct* output for every row in production, not a synthetic marker. Separately mislabeled/weak as a hash (flagged below), but genuine. |
| `payment_attempts` has 0 rows for this job → no real payment | **WRONG** | The join was wrong. `payment_attempts.job_id` and `.idempotency_key` are both `NULL` on this row (and broadly). The real correlation is by `payment_identifier` cross-referenced with timing. Correctly queried, a full, well-formed `payment_attempts` row exists. |
| Classification `F_INTERNAL_JOB_OR_RECOVERY_ARTIFACT`, `POTENTIAL_UNAUTHORIZED_PAYMENT_ACTIVITY=NO` | **WRONG** | This is a genuine payment attempt, not an artifact. Superseded below. |

`H1R_SYNTHETIC_CLASSIFICATION_CORRECT=NO`
`H1R_PAYMENT_JOIN_CORRECT=NO`
`H1R_ATTEMPT_HASH_INTERPRETATION_CORRECT=NO`

## `computeAttemptHash()` — corrected record

```
ATTEMPT_HASH_IS_CRYPTOGRAPHIC_SHA256=NO   (mislabeled — real algorithm is a 32-bit rolling hash, not SHA-256)
ATTEMPT_HASH_ZERO_PREFIX_PATTERN_IS_NORMAL=YES
ATTEMPT_HASH_SAFE_AS_SECURITY_IDENTIFIER=NO  (weak collision resistance; should not be relied on for integrity — separate, lower-priority defect, not touched in this checkpoint)
```

## Corrected payment linkage

```
PAYMENT_ATTEMPT_JOB_LINK_FIELDS=payment_attempts.job_id (NULL on this row), payment_attempts.idempotency_key (NULL on this row) — neither populated for this attempt
PAYMENT_ATTEMPTS_JOB_ID_SEMANTICS=nullable, not populated by this code path
CORRECT_H1_PAYMENT_ATTEMPT_ID=3a728ffc-5f1b-4b12-8145-c84f25fc9330
CORRECT_H1_PAYMENT_IDENTIFIER=pay_02703c94503e489890f51c4e98a771c6
CORRECT_H1_IDEMPOTENCY_KEY=NOT_RECORDED (null)
```

Linkage to job `de147124-c264-452b-b784-86ee4422ecd1` is therefore **not** a
foreign-key join — it is established by exact-timestamp correlation
(`payment_attempts.created_at` = `2026-08-31T04:46:24.078Z`, matching the
job's first state-machine event) plus matching economics
(`service_id=web_context_verified.v2`, `amount=9000`,
`asset=0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`,
`payee=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`,
`network=eip155:8453`) and matching resource
(`resource_id=https://utility.siteborne.net/v2/web/context`).

## Full H1 payment_attempts row (safe fields only)

```
PAYMENT_ATTEMPT_ID=3a728ffc-5f1b-4b12-8145-c84f25fc9330
CREATED_AT=2026-08-31T04:46:24.078Z
LIFECYCLE_STAGE=verified
PROVIDER=cdp-facilitator@1.55.0
PAYMENT_RAIL=cdp
NETWORK=eip155:8453
ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
PAYEE=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
AMOUNT_ATOMIC=9000
PAYMENT_IDENTIFIER=pay_02703c94503e489890f51c4e98a771c6
IDEMPOTENCY_KEY=NOT_RECORDED (null)
EXPIRES_AT=2026-08-31T04:51:24.078Z   (SITEBORNE's own quote/attempt expiry — see note below)
CONSUMED_AT=NOT_RECORDED (null)
SETTLEMENT_PERMISSION_HASH=NOT_RECORDED (null)
SERVICE_OUTPUT_HASH=NOT_RECORDED (null)
SERVICE_RECEIPT_ID=NOT_RECORDED (null)
SETTLEMENT_TRANSACTION_REFERENCE=NOT_RECORDED (null)
SETTLEMENT_PENDING_AT=NOT_RECORDED (null)
```

There is no `verify_status`/`verify_at`/`settle_status`/`settle_at`/
`settlement_tx_hash` schema in production — those were guessed field names in
the mission spec. The real schema (`payment_attempts`, 32 columns, confirmed
via `PRAGMA table_info`) tracks `lifecycle_stage` as the single state field,
plus `settlement_permission_hash` / `settlement_transaction_reference` /
`settlement_pending_at`, all `NULL` here. **Every settlement-related field on
this row is null** — settlement was never begun for this payment attempt.

## EIP-3009 authorization window

`AUTHORIZATION_WINDOW_RECOVERED=NO` — SITEBORNE's schema and code never
persist the raw EIP-3009 `validAfter` / `validBefore` / `nonce`. A repo-wide
search for `validBefore`/`validAfter` returns zero matches, and for `nonce`
returns exactly one (a doc comment in `x402-service.ts:991` noting EIP-3009
nonces are enforced elsewhere). The CDP custodial signer + facilitator own
those raw fields; SITEBORNE only stores `payment_attempts.expires_at`, its
own tracked quote/attempt expiry, and a `binding_digest` (a SHA-256 hash of
the payment binding — one-way, not reversible to recover the nonce).

Best available proxy, explicitly not identical to the true on-chain
`validBefore`, but the closest recoverable value:

```
AUTH_VALID_AFTER=UNKNOWN (not persisted anywhere in this repository)
AUTH_VALID_BEFORE≈2026-08-31T04:51:24.078Z (payment_attempts.expires_at, SITEBORNE's own tracked proxy — NOT the raw on-chain value)
CURRENT_TIME_UTC=2026-08-31T05:21:13Z
SECONDS_UNTIL_VALID_BEFORE=-1789 (≈29m49s past the proxy expiry at time of this report)
AUTHORIZATION_TIME_STATE=EXPIRED (using the best available proxy; HIGH confidence, not absolute — the true on-chain window is not independently recoverable from this repo)
```

## On-chain nonce state

```
AUTHORIZATION_NONCE_STATE_QUERY=NOT_POSSIBLE
AUTHORIZATION_NONCE_CONSUMED=UNKNOWN
```

The raw EIP-3009 nonce was never returned to or persisted by SITEBORNE (it
lives inside the CDP-signed payload, verified opaquely by the facilitator).
Without it, `authorizationState(authorizer, nonce)` cannot be called against
Base USDC. This is a genuine forensic dead end from the repository side —
not a gap in this investigation's effort.

## Settlement / transfer search

```
SUCCESSFUL_SETTLEMENT_TX_COUNT=0
FAILED_SETTLEMENT_TX_EVIDENCE=UNPROVEN (no BaseScan/explorer API key configured in this environment to search failed/reverted txs by address; only a live eth_call balance read was performed)
SETTLEMENT_TX_HASH=NONE
BUYER_TO_SELLER_9000_TRANSFER_COUNT=0
```

## Fresh buyer balance (live, this checkpoint)

```
BUYER_USDC_BALANCE_CURRENT=28197 atomic (0.028197 USDC)
BUYER_BALANCE_DELTA_FROM_28197=0
```

Confirmed via a fresh, direct `eth_call` (`balanceOf`) against
`https://mainnet.base.org`, not reused from an earlier cached reading.

## Facilitator verify / settle evidence

```
FACILITATOR_VERIFY_CALL_COUNT=1 (inferred: exactly one QUOTED→PAYMENT_CHALLENGED→PAYMENT_VERIFIED transition recorded, 222ms duration — consistent with one real facilitator /verify round trip; SITEBORNE does not persist a separate facilitator-call audit log, so this is inferred from state-machine timing, not a raw call log)
FACILITATOR_VERIFY_AT=2026-08-31T04:46:24.508Z
FACILITATOR_VERIFY_RESULT=verified (lifecycle_stage='verified')
GENUINE_FACILITATOR_VERIFY_PROVEN=YES (high confidence: real provider string `cdp-facilitator@1.55.0`, plausible network latency, matches H1's own attempt timing)

FACILITATOR_SETTLE_CALL_COUNT=0 (all settlement fields on the payment_attempts row are null; job never reached SETTLING)
FACILITATOR_SETTLE_CALL_AT=NONE
FACILITATOR_SETTLE_RESPONSE=NONE
FACILITATOR_SETTLE_TX_HASH=NONE
```

## H1 attribution

```
H1_AND_JOB_PAYMENT_IDENTIFIER_MATCH=UNPROVEN (H1's sanitized console output was not captured/persisted anywhere this session can re-read; the operator reported only an HTTP-level Vitest timeout, no payment_identifier)
H1_AND_JOB_IDEMPOTENCY_KEY_MATCH=UNPROVEN (field is null on the row; nothing to match)
H1_AND_JOB_REQUEST_ID_MATCH=UNPROVEN (jobs.request_id not independently reconciled against any H1 client log)
H1_AND_JOB_BODY_MATCH=UNPROVEN (request_input_hash is one-way; no independent copy of H1's request body was persisted to compare)
H1_AND_JOB_CANDIDATE_MATCH=HIGH_CONFIDENCE (only H1 was authorized to target candidate 30ab6b71 in this exact ~5-minute production window; service/economics/timing all match exactly)
H1_ATTRIBUTION=HIGH_CONFIDENCE (not PROVEN in the strict cryptographic-identifier sense — no persisted raw log ties H1's process to this exact payment_identifier — but the timing coincidence (same second), unique economics, and exclusivity of authorized activity in this window make an unrelated third-party origin implausible)
```

## Client-side timeline

```
H1_TEST_PROCESS_STARTED_AT=UNKNOWN (not logged/persisted by this session)
H1_402_RECEIVED_AT=UNKNOWN
H1_SIGNER_CALL_STARTED_AT=UNKNOWN
H1_SIGNER_CALL_COMPLETED_AT=UNKNOWN
H1_PAID_HTTP_SUBMISSION_STARTED_AT=UNKNOWN
H1_PROCESS_TIMED_OUT_AT≈ reported ~5000ms after test start
H1_PAID_RESPONSE_RECEIVED_AT=NEVER (Vitest reported a timeout, not a response)

DID_PAID_HTTP_SUBMISSION_BEGIN_BEFORE_TEST_TIMEOUT=HIGH_CONFIDENCE_YES — the server-side timeline (job created/verified/executing, all within 640ms of payment_attempts.created_at) categorically requires that the paid HTTP POST reached the Worker; the request could not have advanced through VALIDATED→QUOTED→PAYMENT_CHALLENGED→PAYMENT_VERIFIED→LOCKED→ROUTED→EXECUTING without arriving.
```

## Why the 5000ms Vitest timeout does not explain a cancelled request

```
GLOBAL_TEST_TIMEOUT_MS=5000 (Vitest default; no `testTimeout` override found in vitest.config.ts)
H1_CUSTOM_TIMEOUT_PRESENT=NO (confirmed: the `it(...)` block in apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts takes no timeout argument)
TIMEOUT_APPLIES_TO_WHOLE_IT_BLOCK=YES

FETCH_ABORT_SIGNAL_PRESENT=NO (grepped the live test file for AbortSignal/AbortController/`signal:` — zero matches)
VITEST_TIMEOUT_CANCELS_NETWORK_REQUEST=NO — Vitest's test timeout only rejects the *test's* promise/reports a failure; with no AbortController wired to fetch(), the in-flight HTTP request(s) the test made are not cancelled by the timeout itself. They keep running until the underlying Node process exits (ending the whole `pnpm web-context-first-paid-e2e` command), which closes the TCP connection(s) — an indirect, delayed cancellation, not an immediate one.
```

## Server-side request timeline (from `job_state_events`, authoritative)

```
REQUEST_RECEIVED_AT≈2026-08-31T04:46:24.078Z (payment_attempts.created_at, first observable event)
job RECEIVED→VALIDATED  at 04:46:24.181Z
job VALIDATED→QUOTED    at 04:46:24.235Z
job QUOTED→PAYMENT_CHALLENGED at 04:46:24.286Z
PAYMENT_VERIFY_STARTED_AT≈04:46:24.286Z
PAYMENT_VERIFY_COMPLETED_AT=04:46:24.508Z (PAYMENT_CHALLENGED→PAYMENT_VERIFIED, 222ms — a real facilitator round trip, not instant)
JOB_LOCKED_AT=04:46:24.613Z (PAYMENT_VERIFIED→LOCKED)
JOB_ROUTED_AT=04:46:24.667Z (LOCKED→ROUTED)
EXECUTION_STARTED_AT=04:46:24.718Z (ROUTED→EXECUTING)
EXECUTION_LAST_ACTIVITY_AT=04:46:24.718Z  ← no further job_state_events row exists after this, ever
SETTLEMENT_STARTED_AT=NEVER (no SETTLING/DELIVERED/REFUND_REQUIRED event recorded)
REQUEST_CONTEXT_TERMINATED_AT=UNKNOWN (Cloudflare Workers does not expose this to D1/repo-visible logs)
```

`job_attempts` (the queue/worker-dispatch tracking table) has **zero rows**
for this job, and `queue_dispatches` has **zero rows** for this job. Whatever
executed after `EXECUTING` ran synchronously inside the original HTTP
request handler — it was never handed off to a queue consumer.

## Is the execution context still alive?

This is the central, decisive architectural finding:

```
grep -rln "waitUntil" apps/edge-api/src   → 0 matches, anywhere in production source
```

`x402-service.ts` never calls `ctx.waitUntil()`. In Cloudflare Workers, when
a fetch handler does not explicitly protect its async work with
`ctx.waitUntil()`, the runtime ties that work's lifetime to the original
client connection — if the client disconnects, the pending promise chain is
liable to be cancelled at its next `await`. The Vitest process here had no
`AbortSignal` wired (so the timeout alone didn't sever the TCP connection),
but the whole `pnpm web-context-first-paid-e2e` command exited shortly after
Vitest reported the failure, which does close the underlying socket.

```
ORIGINAL_WORKER_INVOCATION_STILL_RUNNING=HIGH_CONFIDENCE_NO (no waitUntil protection existed to keep it alive past client disconnection; ~35 minutes have since elapsed with zero further state transitions, consistent with early termination rather than a still-hung invocation)
QUEUE_CONSUMER_STILL_PROCESSING=NO (zero queue_dispatches rows — this job was never queued)
MODAL_REQUEST_STILL_RUNNING=NO (Modal Web Functions do not run indefinitely; any real invocation for this job completed or errored out within seconds to low minutes, over 30 minutes ago)
OTHER_ASYNC_EXECUTOR_STILL_RUNNING=NO (no other async executor identified in the codebase)

LIVE_EXECUTION_CURRENTLY_EXISTS=HIGH_CONFIDENCE_NO
```

## Modal request reconciliation

```
MODAL_REQUEST_FOUND=NO — this session has no read access to Modal's own
  application/function invocation logs (only the deployed app's presence,
  from prior E6 checkpoints). Correlating this exact job to a specific Modal
  invocation would require pulling Modal dashboard/CLI logs for the relevant
  ~1-minute window, which was not done in this checkpoint (out of scope: no
  mutation risk either way, and the architectural waitUntil finding above is
  already decisive for the risk question this checkpoint exists to answer).
MODAL_COMPLETED_AFTER_CLIENT_TIMEOUT=UNPROVEN
```

## EXECUTING → settle path (as written)

```
POST_EXECUTION_SETTLEMENT_CALLSITE=apps/edge-api/src/control-plane/routes/x402-service.ts (settle-adjacent lifecycle transitions live alongside the `markConsumed`/`transitionLifecycleStage` calls inspected in this checkpoint; e.g. lines ~920-945 for the (Nevermined-specific) recovery branch, and further call sites at ~1070 and ~1887 for the primary/CDP path)
SETTLEMENT_REQUIRES_ORIGINAL_PAYMENT_PAYLOAD=YES (the verified payment binding must be threaded through to the facilitator /settle call)
SETTLEMENT_REQUIRES_RAW_SIGNATURE=UNPROVEN from this repo alone — no raw signature is ever persisted to D1 (confirmed: `payment_attempts` has no signature column, only hashes), so if a raw signature is required for /settle, it can only ever have lived in the original request's in-memory execution — never durably.
SETTLEMENT_REQUIRES_REQUEST_CONTEXT=YES (synchronous code path, no queue handoff observed for this job)
SETTLEMENT_CAN_RUN_FROM_PERSISTED_JOB_ONLY=NO (no code path was found that can reconstruct a settle() call from the `jobs`/`payment_attempts` rows alone, since the raw payment material is never durably stored)
```

`markConsumed()` (`payment-attempts.ts:333-340`) is only ever called
**after** a `lifecycle_stage` transition into `'settled'` (or the
Nevermined-specific `'settled_external'` recovery variant) — never at
job-creation or verify time. `consumed_at IS NULL` on this row therefore
does **not** indicate "no job was created"; it simply reconfirms settlement
never completed, consistent with everything else observed.

## Where signed payment material lives

```
LOCATION                          SIGNATURE_PRESENT  AUTHORIZATION_PRESENT  PAYMENT_REQUIREMENTS_PRESENT  PERSISTS_AFTER_REQUEST  CAN_LATER_DRIVE_SETTLEMENT
original request memory (Worker)  likely (transient)  likely (transient)     yes (transient)                NO                      NO (dies with the invocation)
payment_attempts row (D1)         NO                  NO (only a one-way hash: binding_digest)  partially (economics, not raw)  YES                     NO (insufficient — no raw signature/nonce)
jobs / job_attempts row (D1)      NO                  NO                     NO (only input_hash)          YES                     NO
queue_dispatches                  NO (0 rows for this job)                                                                          N/A
Durable Objects                   not used by this service (no DO binding found in this route's dependencies)                       N/A
logs                              not accessible to this session                                                                    UNPROVEN
local H1 operator output          not persisted anywhere this session can read                                                       N/A
provider (CDP) side               possible — CDP is the actual holder of the signing material, opaque to this repo                    UNPROVEN (SITEBORNE-side, not something this repo's code can trigger)

RAW_PAYMENT_SIGNATURE_PERSISTED=NO (in every location this repository or its D1 can reach)
SERVER_CAN_SETTLE_AFTER_ORIGINAL_REQUEST_CONTEXT_DIES=HIGH_CONFIDENCE_NO
```

## Recovery / sweeper mechanisms

```
grep -rln "stale.*job|sweep|cron|alarm|lease.*expir" apps/edge-api/src   → 0 matches

AUTOMATIC_RECOVERY_EXISTS=NO
AUTOMATIC_RECOVERY_CAN_CALL_SETTLE=NO (nothing exists to call)
NEXT_AUTOMATIC_RECOVERY_TIME=NONE
```

There is no cron trigger, alarm, or stale-job sweeper anywhere in the
codebase. This job will remain in `EXECUTING` in D1 indefinitely unless a
human or a future engineering change acts on it — it cannot silently
resurrect itself.

## Expiries, distinguished

```
HTTP_CLIENT_TIMEOUT_AT≈5000ms after H1 test start (exact wall-clock UNKNOWN)
JOB_EXPIRES_AT=2026-08-31T04:51:23.504Z
EXECUTION_LEASE_EXPIRES_AT=N/A (no lease mechanism found in this codebase)
QUOTE_EXPIRES_AT=2026-08-31T04:51:24.078Z (payment_attempts.expires_at)
AUTH_VALID_BEFORE≈2026-08-31T04:51:24.078Z (proxy only, see above — true value not recoverable)

JOB_EXPIRED_WHILE_AUTH_STILL_VALID=UNKNOWN (cannot be answered precisely without the true on-chain validBefore; using the best proxy, job expiry and the authorization proxy expiry are the same instant — the two were not meaningfully independent in this design)
```

## Money-at-risk classification

```
CURRENT_PAYMENT_RISK_CLASS=A_NO_SETTLEMENT_AUTH_EXPIRED
```

Basis: ~30 minutes have elapsed past the best-available authorization-expiry
proxy with (a) zero balance change on a freshly re-read live chain balance,
(b) zero settlement fields populated on the payment_attempts row, (c) zero
queue/recovery mechanism that could resume this job, and (d) an
architectural finding (no `waitUntil`) that makes continued live execution
implausible. This is not an absolute proof (the true on-chain `validBefore`
is unrecoverable from this repo, and this session cannot query CDP's own
internal state), but the convergence of independent evidence is strong.

```
AUTHORIZATION_EXPIRED_UNSETTLED=YES (using the proxy expiry; current time is ~30 minutes past it)
FUTURE_SETTLEMENT_WITH_THIS_AUTHORIZATION_POSSIBLE=HIGH_CONFIDENCE_NO
PAYMENT_RISK_ACTIVE=NO
```

## Stuck EXECUTING root cause

```
STUCK_EXECUTING_ROOT_CAUSE_CLASS=B_WORKER_REQUEST_CONTEXT_TERMINATED
STUCK_EXECUTING_ROOT_CAUSE_CONFIDENCE=HIGH
```

The production execution path has no `ctx.waitUntil()` protecting its
post-verification work. When the H1 client process exited (after its
Vitest-level timeout at 5s, with no earlier `AbortSignal`-driven
cancellation), the underlying TCP connection closed, and the Cloudflare
Workers runtime almost certainly cancelled the still-in-flight handler at
its next `await` — most plausibly while awaiting the Modal safe-egress
executor's response, which explains both why `EXECUTING` was reached
(post-payment-lock code definitely started) and why nothing after it was
ever recorded (the handler's promise chain never resumed).

## Job recovery options (informational only — no mutation performed)

```
SAFEST_POST_RECONCILIATION_JOB_ACTION=leave the stale row as historical record, or (separately, later) add an explicit "mark expired" transition/tombstone once such a code path exists — no such path currently exists in the frozen state machine
CAN_SAFE_JOB_ACTION_TRIGGER_SETTLEMENT=NO (nothing in the state machine or any adjacent code can turn a D1 row mutation into a facilitator /settle call by itself)
ACTION_REQUIRED_BEFORE_H2=NO (the stuck row does not block or interfere with H2 harness work; it is inert)
```

## Security / release implications

```
POTENTIAL_UNAUTHORIZED_PAYMENT_ACTIVITY=NO (H1_ATTRIBUTION=HIGH_CONFIDENCE, and no settlement/economic effect occurred regardless of exact attribution)
LIVE_PAYMENT_HARNESS_TIMEOUT_AMBIGUITY=YES (root cause identified: missing custom Vitest timeout + missing AbortSignal wiring in the live E2E harness — a real defect worth fixing before any future live attempt)
STALE_EXECUTING_JOB_RECOVERY_DEFECT=YES (no sweeper/cron/alarm exists anywhere in the codebase to detect or clean up jobs stuck past `expires_at` — an operational gap, not a financial-risk gap, given the `waitUntil` finding above)
```

## H2 gate

```
H2_HARNESS_WORK_SAFE_TO_RESUME=YES
```

All required conditions are met: H1 attribution is resolved to
high-confidence; no successful settlement occurred and the position is fully
reconciled; the best-available authorization proxy is expired by ~30
minutes; no live settlement path remains (no `waitUntil`, no queue
dispatch, no raw signature persisted anywhere reachable); no automatic
retry/recovery mechanism exists in the codebase; production remains at
`de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%; the E6R qualification
candidate carries 0% normal traffic; and the stale job cannot be
accidentally settled by any safe cleanup action, because no cleanup action
this repo could take is wired to settlement.

## Final Stop Packet

```
SUN1221E6R_H1A_VERIFIED_AUTHORIZATION_RECONCILIATION=PASS_WAITING_FOR_EXPIRY
SUPERSEDES_H1R_SYNTHETIC_ORIGIN_CONCLUSION=YES

H1R_SYNTHETIC_CLASSIFICATION_CORRECT=NO
H1R_PAYMENT_JOIN_CORRECT=NO
H1R_ATTEMPT_HASH_INTERPRETATION_CORRECT=NO

GENUINE_FACILITATOR_VERIFY_PROVEN=YES
H1_ATTRIBUTION=HIGH_CONFIDENCE

PAYMENT_ATTEMPT_ID=3a728ffc-5f1b-4b12-8145-c84f25fc9330
PAYMENT_IDENTIFIER=pay_02703c94503e489890f51c4e98a771c6
PAYMENT_LIFECYCLE_STAGE=verified

AUTHORIZATION_WINDOW_RECOVERED=NO
AUTH_VALID_AFTER=UNKNOWN
AUTH_VALID_BEFORE≈2026-08-31T04:51:24.078Z (proxy: payment_attempts.expires_at)
CURRENT_TIME_UTC=2026-08-31T05:21:13Z
AUTHORIZATION_TIME_STATE=EXPIRED
SECONDS_UNTIL_VALID_BEFORE=-1789

AUTHORIZATION_NONCE_CONSUMED=UNKNOWN
FACILITATOR_VERIFY_CALL_COUNT=1
FACILITATOR_SETTLE_CALL_COUNT=0
FAILED_SETTLEMENT_TX_EVIDENCE=UNPROVEN

BUYER_USDC_BALANCE_CURRENT=28197
BUYER_BALANCE_DELTA_FROM_28197=0
BUYER_TO_SELLER_9000_TRANSFER_COUNT=0

DID_PAID_HTTP_SUBMISSION_BEGIN_BEFORE_TEST_TIMEOUT=YES (high confidence, from server-side state machine evidence)
VITEST_TIMEOUT_CANCELS_NETWORK_REQUEST=NO
FETCH_ABORT_SIGNAL_PRESENT=NO

LIVE_EXECUTION_CURRENTLY_EXISTS=NO (high confidence)
MODAL_REQUEST_FOUND=NO
TARGET_HTTP_COMPLETED=UNPROVEN

RAW_PAYMENT_SIGNATURE_PERSISTED=NO
SERVER_CAN_SETTLE_AFTER_ORIGINAL_REQUEST_CONTEXT_DIES=NO (high confidence)

AUTOMATIC_RECOVERY_EXISTS=NO
AUTOMATIC_RECOVERY_CAN_CALL_SETTLE=NO

HTTP_CLIENT_TIMEOUT_AT≈5000ms after H1 test start (exact wall-clock unknown)
JOB_EXPIRES_AT=2026-08-31T04:51:23.504Z
EXECUTION_LEASE_EXPIRES_AT=N/A
QUOTE_EXPIRES_AT=2026-08-31T04:51:24.078Z
AUTH_VALID_BEFORE≈2026-08-31T04:51:24.078Z
JOB_EXPIRED_WHILE_AUTH_STILL_VALID=UNKNOWN

CURRENT_PAYMENT_RISK_CLASS=A_NO_SETTLEMENT_AUTH_EXPIRED
PAYMENT_RISK_ACTIVE=NO
POST_EXPIRY_RECHECK_NOT_BEFORE=N/A (already past expiry at time of this report)

STUCK_EXECUTING_ROOT_CAUSE_CLASS=B_WORKER_REQUEST_CONTEXT_TERMINATED
STALE_EXECUTING_JOB_RECOVERY_DEFECT=YES

SAFEST_POST_RECONCILIATION_JOB_ACTION=leave as historical record
ACTION_REQUIRED_BEFORE_H2=NO

LIVE_PAYMENT_HARNESS_TIMEOUT_AMBIGUITY=YES
POTENTIAL_UNAUTHORIZED_PAYMENT_ACTIVITY=NO

NEW_LIVE_402_REQUESTS=0
NEW_EIP3009_AUTHORIZATIONS=0
NEW_SIGNER_CALLS=0
NEW_PAID_REQUESTS=0
NEW_VERIFY_CALLS=0
NEW_SETTLE_CALLS=0
NEW_CHAIN_TRANSACTIONS=0
JOB_MUTATIONS=0
D1_MUTATIONS=0

FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%

H2_HARNESS_WORK_SAFE_TO_RESUME=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R-H2 (dedicated one-shot operator harness, timeout + AbortSignal hardened)
```
