# SUN-1221E6R-H2AR — waitUntil Bound Architecture Reconciliation

**Read-only. Zero economic action. Zero mutation.**

## Verdict up front

**The prior H2A `PASS` classification was not valid.** H2A's own stop packet
asserted `WAITUNTIL_ARCHITECTURALLY_SUFFICIENT=YES` and
`MAX_POST_VERIFY_EXECUTION_BOUND_MS≈60000` in the same breath as Cloudflare's
documented ~30s post-disconnect `waitUntil` extension, with no proof bridging
the two. That proof does not exist, and on inspection cannot be constructed
for the pipeline as currently built.

## 1. Reconciling H2A's claims

- `H2A_FIX_COMMIT_SHA` = `1a7e9e6` (waitUntil wrap added in
  `apps/edge-api/src/control-plane/routes/x402-service.ts`)
- `H2A_CANDIDATE_VERSION_ID` = `2ca5d120-db79-4b54-8ae3-53e2c91dad87`
- H2A's reported `MAX_POST_VERIFY_EXECUTION_BOUND_MS≈60000` traces to
  `x402-service.ts`'s `maxTimeoutSeconds = config.maxTimeoutSeconds ?? 60` —
  **this is x402 protocol metadata advertised to the buyer/facilitator, not
  an enforced ceiling on the Worker's own execution.** Nothing in
  `x402-service.ts` wraps the post-verify continuation in a matching
  `AbortSignal.timeout(60_000)` or equivalent. Treating an advertised value
  as a proven hard bound was the error.
- `H2A_BOUND_CONTRADICTION_CONFIRMED = YES`

## 2. The correct time model

Per-phase, the *only* bound that is actually enforced in code:

| Phase | Hard bound found in code | Where |
|---|---|---|
| `T_executor` (Worker→Modal) | Modal `@app.function(timeout=35)` — platform kill at 35s | `services/webctx-safe-egress/src/webctx_safe_egress/app.py:45` |
| `T_executor` internal target-fetch budget | `deadline_ms` capped `le=30_000`, client defaults to 25,000 | `schemas.py:37`, `modal-safe-egress-client.ts:60` |
| `T_pcc` | **none found** — no external call located, no explicit ceiling | — |
| `T_settle` (facilitator settle()) | **none found** — `cdp-provider.ts` has no `AbortSignal`/timeout wrapper | `apps/edge-api/src/control-plane/evidence/cdp-provider.ts` |
| `T_persist` / `T_terminal_state` | **none found** — plain D1 write, no ceiling | — |
| Worker→Modal `fetch()` itself | **none found** — no `AbortController` in `modal-safe-egress-client.ts` | — |

```
MAX_EXECUTOR_MS = 35,000            (Modal's own declared hard kill)
MAX_PCC_MS = UNPROVEN                (no enforced bound)
MAX_SETTLE_MS = UNPROVEN             (no enforced bound)
MAX_PERSIST_MS = UNPROVEN            (no enforced bound)
MAX_TERMINAL_STATE_MS = UNPROVEN
MAX_POST_VERIFY_EXECUTION_BOUND_MS = UNPROVEN (>= 35,000, no proven ceiling)
MAX_REMAINING_AT_ARBITRARY_DISCONNECT_MS = UNPROVEN (>= 35,000 in the
  disconnect-at-T_executor-start case alone)
WAITUNTIL_LIMIT_MS = ~30,000 (Cloudflare-documented, platform-controlled,
  not independently verifiable from this repo)
SAFETY_MARGIN_MS = NEGATIVE (worst case already exceeds the limit using only
  the one phase that *is* code-bounded)
```

The mission forbids proving sufficiency with average/observed latency. It
does not need to be invoked here: a **single already-enforced hard bound**
(Modal's 35s function timeout) already exceeds the ~30s waitUntil grace
window by itself, before PCC, settlement, or persistence add anything. No
average-case reasoning is needed to falsify `A`.

## 3. Worst-case disconnect table

| Disconnect phase | Max remaining work | ≤ waitUntil limit? | Margin |
|---|---|---|---|
| Immediately after `PAYMENT_VERIFIED` | executor(35,000) + PCC + settle + persist | **NO** | negative |
| 1ms after Modal request starts | ~35,000 (Modal may run to its own kill) | **NO** | negative |
| Just before Modal's internal 30s deadline fires | up to ~35,000 (Modal's outer kill still applies) | **NO** | negative |
| After executor success, before PCC | PCC(unproven) + settle(unproven) + persist(unproven) | **UNPROVEN** | unknown |
| After PCC, before settlement | settle(unproven) + persist(unproven) | **UNPROVEN** | unknown |
| While settlement is in flight (facilitator call) | settle(unproven, no client timeout) | **UNPROVEN, plausibly unbounded** | unknown |

## 4. Sufficiency proof

`WAITUNTIL_ARCHITECTURALLY_SUFFICIENT = NO` — a hard, code-declared bound
(Modal's 35s function timeout, which itself sits *above* its own 30,000ms
internal deadline cap to leave packaging time) already exceeds the ~30s
`waitUntil` extension window in isolation. The remaining phases (PCC,
settlement, persistence) add no enforced ceiling at all, so the true
worst-case bound for the full post-verify pipeline is not just "over 30s" —
it is currently **unbounded** by any code-enforced mechanism this repo
contains.

## 5. `maxTimeoutSeconds` — what it actually is

- `MAX_TIMEOUT_SECONDS_SOURCE` = x402 payment-requirements field
  (`config.maxTimeoutSeconds ?? 60`), sent to the buyer/facilitator as
  protocol metadata describing how long the resource server *claims* it may
  take.
- `MAX_TIMEOUT_SECONDS_VALUE` = 60 (default)
- `APPLIES_TO_MODAL_EXECUTOR` = NO (Modal's own 35s kill is independent and
  unrelated to this value; nothing threads it into the executor call)
- `APPLIES_TO_TOTAL_PIPELINE` = NO (advertised only, not enforced)
- `CAN_CLIENT_DISCONNECT_IMMEDIATELY_BEFORE_FULL_TIMEOUT` = YES — and
  because Modal's own hard kill (35s) already exceeds the waitUntil grace
  window (~30s), the client does not even need to wait for the full
  advertised 60s window to create a stranding risk.

## 6. Reproduction

Deterministic, non-economic: simulated a payment-verified continuation
registered via `waitUntil`, using fake timers to advance past a 30s
disconnect-extension boundary while the (stubbed) executor promise is still
pending at 35s. The continuation is still in-flight when the simulated
extension window closes.

`WAITUNTIL_EXPIRY_STALE_EXECUTING_REPRODUCED = YES`

H2A's disconnect fix is **incomplete**: it correctly prevents the
*immediate*-cancellation failure mode (client vanishes at T=0, Worker dies
instantly), but does not — and structurally cannot, as currently bounded —
prevent stranding when the executor legitimately runs close to its own
declared 35s ceiling and the client disconnects early in that window.

## 7. Corrected H2A classification

```
SUN1221E6R_H2A_CLIENT_DISCONNECT_HARDENING = INCOMPLETE
SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE = NO
```

## 8. Bounded-time option

```
CURRENT_PUBLIC_CONTRACT_REQUIRES_60S = YES (x402 maxTimeoutSeconds default
  advertised to buyers/facilitators; changing it is an external-facing
  contract change, not an internal implementation detail)
REDUCING_TIMEOUT_IS_CONTRACT_CHANGE = YES
MINIMUM_ACCEPTABLE_EXECUTOR_TIMEOUT_MS = not determined here — depends on
  legitimate slow-target latency data this checkpoint does not have
  (DNS/TLS/redirect/streaming/Modal cold start), a product judgment call
MAX_SAFE_EXECUTOR_TIMEOUT_FOR_WAITUNTIL_MS = comfortably under 30,000 minus
  PCC + settle + persist + margin — with PCC/settle/persist currently
  unbounded, no such headroom can be computed yet
BOUNDED_WAITUNTIL_DESIGN_FEASIBLE = YES, in principle (Modal's deadline_ms,
  its schema cap, and its app.function(timeout=...) are all in-repo
  configuration, not platform-fixed), but only once PCC and settlement also
  get explicit enforced ceilings — today they do not.
```

## 9. Economic consequence of shrinking the timeout

`SHORTER_TIMEOUT_PRESERVES_ECONOMIC_SEMANTICS = YES` — the existing pipeline
already treats executor failure/timeout as a non-settling outcome (settle()
only runs after successful PCC), so shrinking the executor's ceiling
increases the rate of legitimate-but-slow targets failing closed (buyer
correctly not charged), not the rate of miscarged payments. It is a
availability/success-rate tradeoff, not a correctness or safety one — still
a product decision, not one to make unilaterally here.

## 10. Durable architecture options (evaluated, not implemented)

| | A. Queue consumer | B. Cloudflare Workflow | 
|---|---|---|
| Durability | High (message persisted, redelivered on failure) | High (step state persisted by platform) |
| Max wall time | Effectively unbounded (async consumer) | Effectively unbounded (long-running steps supported) |
| Delivery semantics | At-least-once | At-least-once per step, with step memoization |
| Retry semantics | Automatic, configurable backoff | Automatic per-step retry |
| Idempotency requirement | Mandatory (dedupe on `payment_identifier`) | Mandatory (same) |
| Payment material requirement | Must persist enough to resume `execute→PCC→settle` across redelivery | Same |
| Can preserve verify→execute→settle order | Yes, if consumer enforces it explicitly | Yes, step ordering is native to the primitive |
| Can return synchronous x402 response | **No** — requires a contract change (202 + poll, or a synchronous wait with its own new bound) | Same constraint |
| Client-disconnect behavior | Unaffected — consumer runs independent of the original HTTP request | Same |
| Duplicate-settlement risk | Present unless settlement step is idempotency-keyed on `payment_identifier`/nonce | Same, mitigated by step memoization if keyed correctly |
| Operational complexity | Medium (new binding, new consumer worker, DLQ policy) | Medium-high (newer primitive, less operational history in this repo) |

## 11. Payment-material durability problem

```
SETTLEMENT_REQUIRES_RAW_PAYMENT_PAYLOAD = YES
SETTLEMENT_REQUIRES_SIGNATURE = YES
SETTLEMENT_REQUIRES_AUTHORIZATION_FIELDS = YES
SETTLEMENT_REQUIRES_ORIGINAL_402_REQUIREMENTS = YES
CURRENTLY_PERSISTED_DURABLY = NO
```
Any durable (async) redesign needs the signed EIP-3009 payload to survive
past the original request — that is new at-rest signed-payment-material
storage this system does not have today, and per this session's own
standing policy on payment material, it would need an explicit
encryption/access-boundary/retention/redaction design *before*
implementation, not as an afterthought.

## 12. Synchronous contract problem

```
CURRENT_CONTRACT_SYNCHRONOUS = YES (the paid POST currently returns the
  final service result in the same HTTP response)
QUEUE_DESIGN_REQUIRES_ASYNC_CONTRACT_CHANGE = YES
WORKFLOW_DESIGN_REQUIRES_ASYNC_CONTRACT_CHANGE = YES
```
Both durable options break the current "pay once, get your result in this
response" contract. That is a buyer-facing API change, not an internal
refactor.

## 13–16. Hybrid designs, idempotency, retry policy, crash matrix

Scoped but not designed in detail here — out of proportion for a
reconciliation checkpoint given §17's answer below is `D`, not `B` or `C`.
The authoritative keys available for idempotency gating are
`payment_identifier` (from `payment_attempts`) and job `id`; neither
`idempotency_key` nor a persisted authorization nonce is reliably non-null
today (see H1A finding: `payment_attempts.idempotency_key` observed NULL on
every row), which is itself a prerequisite gap for either durable design.

## 17. Design decision

```
CORRECTED_POST_VERIFY_ARCHITECTURE = D_BLOCKED_PENDING_MORE_EVIDENCE
```

`A` is disproven (§4). Between `B` (durable continuation — bigger lift,
breaks the synchronous contract, needs new signed-payment-material storage
design) and `C` (bounded-timeout redesign — smaller lift, keeps the
synchronous contract, but requires accepting more failed-but-unsettled
requests for legitimately slow targets and needs explicit ceilings added to
PCC/settlement/persistence that don't exist today), the two paths carry
materially different product tradeoffs that are not this checkpoint's to
pick. `D` is returned so that choice is made explicitly.

## 18/19. Not applicable

Neither `A` nor a specific `B`/`C` was selected, so no hard-bound table or
full durable-architecture spec is produced here.

## 20–22. Containment

```
H2A_CANDIDATE_USABLE_FOR_REAL_PAYMENT = NO
H1_JOB_MUTATIONS = 0
FINAL_PRODUCTION_VERSION = de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC = 100%
H2A_CANDIDATE_TRAFFIC = 0%
```
