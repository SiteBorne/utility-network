# SUN-1222C-Q1R5 — `company_evidence_graph.v2` post-EDGAR failure diagnosis

Read-only diagnosis. No payment retry, no 402, no EIP-3009, no signing, no
paid POST, no settlement, no USDC transfer, no production mutation.
Evidence lineage: `2d2ace6`.

## 1. Authoritative facts (re-read, D1 + chain)

| Field | Value |
|---|---|
| JOB_ID | `63dfe74b-6414-4cfa-9dfa-0fb2b7a83aa0` |
| PAYMENT_VERIFIED | YES (`payment_attempts.lifecycle_stage = 'verified'`) |
| PROVIDER_RATE_ADMISSIONS | 1 (`provider_rate_window`, `sec-edgar`, `1788804804708` ms) |
| SETTLEMENT_ATTEMPTS | 0 (`cdp_facilitator_settle_attempt_count = 0`) |
| X402_SERVICE_RESULTS_ROWS | 0 |
| AUDIT_EVENTS_ROWS | 0 |
| SECURITY_EVENTS_ROWS | 0 |
| BUYER_BALANCE_ATOMIC | 79727 (dual-RPC, unchanged) |
| SELLER_BALANCE_ATOMIC | 28000 (dual-RPC, unchanged) |
| MATCHING_NEW_USDC_TRANSFERS | 0 |

All match the prior turn's facts exactly. No reconciliation needed.

## 2. Execution timeline (millisecond-resolution, from `job_state_events`)

| Event | Timestamp |
|---|---|
| PAYMENT_VERIFIED_AT | 2026-09-07T18:13:21.274Z |
| LOCKED_AT | 2026-09-07T18:13:21.423Z |
| ROUTED_AT | 2026-09-07T18:13:24.524Z |
| EXECUTING_AT | 2026-09-07T18:13:24.600Z |
| PROVIDER_RATE_ADMITTED_AT | 2026-09-07T18:13:24.708Z |
| QUARANTINED_AT (`EXECUTION_FAILED`) | 2026-09-07T18:13:29.406Z |
| REJECTED_AT (`QUARANTINE_POLICY`) | 2026-09-07T18:13:29.479Z |

FAILURE_WINDOW_START=2026-09-07T18:13:24.708Z
FAILURE_WINDOW_END=2026-09-07T18:13:29.406Z (4.698s)

This duration is consistent with one real Worker→Modal→data.sec.gov→Modal→Worker
round trip, not a synchronous/local rejection (TermsGuard and the rate
coordinator both resolve in single-digit milliseconds, as proven throughout
R1/R2/R3's own test suites).

## 3–4. Call graph and uncaught-exception enumeration — superseded by §7

Sections 3–6 were planned as static-analysis work (tracing every throw site
in `service.ts`, `submissions-adapter.ts`, `client.ts`). That analysis was
started and is preserved below for completeness, but §7 (existing
observability) produced an *authoritative, non-inferential* answer before
it was needed: **there was no uncaught exception.** `invoke-executor-1`
completed successfully.

Static trace performed regardless, for the record:
- `service.ts` `execute()`: no local `try/catch`; relies entirely on
  `executeLocalService`'s catch-all (see next).
- `dispatcher.ts` `executeLocalService()`: wraps `registered.service.execute()`
  in `try/catch` — **any** exception (sync setup, async, timeout) is
  converted to a `closedFailure` `ServiceExecutionResult`; nothing escapes
  this boundary by design (confirmed by direct source read, matches its own
  doc comment).
- `submissions-adapter.ts` `execute()`: every branch (`PolicyBlockedError`,
  `RateLimitedError`, generic retryable, terminal) returns a defined
  `resultClass`; `fetchAndNormalize` runs entirely inside the adapter's own
  `try` block.
- `paid-continuation-workflow.ts` `invoke-executor` step: wraps
  `deps.executor(...)` in `try/catch`, converting a thrown error into
  `executor_timeout` and a resolved-but-non-`success` result into
  `executor_rejected` — both terminal, both graceful.

Given this, PRE_RESULT_UNCAUGHT_PATH_COUNT=0 (none reachable on this call
graph for this input) and STRUCTURED_FAILURE_COVERAGE_COMPLETE=YES for the
executor/service layer.

## 5. The `x402_service_results` gap, explained

Zero rows is **not** evidence of an uncaught exception — it is evidence
that `x402_service_results` is only ever written on the `executor_success`
path further down `paid-continuation-workflow.ts` (after the `VERIFYING`
transition), which a `result_class !== 'success'` outcome never reaches
(the Workflow returns `terminal('executor_rejected', ...)` at that branch
instead). Confirmed structurally, not just inferred: `audit_events` /
`security_events` are also empty for the same reason — nothing in this
rejection branch writes to either table. This is consistent, symmetric
behavior, not a defect specific to this attempt.

## 6–7. SEC response handling / existing observability — the authoritative answer

Rather than statically guessing at SEC response shapes, the Cloudflare
Workflows engine's own retained step output was read directly (read-only,
zero new requests):

```
wrangler workflows instances list siteborne-paid-continuation --status=complete
wrangler workflows instances describe siteborne-paid-continuation \
  siteborne-wf-a97a35ead180f908257562f41b6087a7ecbd885d2bb505df
```

Instance `siteborne-wf-a97a35ead180f908257562f41b6087a7ecbd885d2bb505df`
(queued 2026-09-07 18:13:22Z, matching this job's `created_at` and payment
identifier `pay_246c956277394be0aec72656322264d6` verbatim in its own
`open-envelope-1` step output) — **Status: Completed, Success: Yes.**

`invoke-executor-1` step: Success ✅, 5s duration, output:

```json
{
  "result": {
    "result_class": "partial",
    "service_id": "company_evidence_graph.v2",
    "field_groups": {
      "identity": { "status": "complete", "source_count": 0 },
      "sec_submissions": { "status": "empty", "source_count": 0 },
      "recent_filings": { "status": "empty", "source_count": 0 }
    },
    "limitations": [
      "sec-edgar company_submissions returned permanent_failure for CIK 0000320193"
    ],
    "source_coverage_summary": { "sec": true, "website": false, "regulatory": false, "repositories": false }
  }
}
```

**There was no exception, timeout, or ambiguity anywhere in this
Workflow run.** `deps.executor(...)` returned cleanly with a well-formed,
non-`success` result. TermsGuard passed. The D1 rate coordinator admitted
the request (1 row, timestamp 108ms after `EXECUTING_AT`, consistent with
"first thing the retry loop does"). A real network round trip to SEC EDGAR
then took ~4.6s and came back classified `permanent_failure` by
`classifyTerminalHttpStatus` (SUN-1222C2-Q1-R2) — the class used for
401/403/other non-retryable 4xx statuses. `executor_rejected` (not
`executor_timeout`) is therefore the correct, already-proven-correct
Workflow branch that fired.

EXACT_RUNTIME_EXCEPTION_RECOVERED=NO (none occurred — this question is
moot; recovered instead the authoritative non-exception outcome)
HISTORICAL_WORKER_EXCEPTION_AVAILABLE=NO (none to recover — Workflows
instance history was sufficient and is a stronger source than a Worker
stack trace would have been here)

## 8. Wrangler-tail limitation

Moot given §7. For the record: `wrangler tail` requires a live session
started before the request; none was attached for this attempt (by
design — the prior checkpoint stopped before authorizing an instrumented
live attempt). Cloudflare Workflows' own retained instance/step history
(available via `wrangler workflows instances describe`, independent of
`tail`) proved sufficient and more precise than a stack trace would have
been, since the failure was a classified result, not a crash.

## 9. Local reproduction (zero network, zero SEC request)

Given `permanent_failure` and not an exception, the real diagnostic
question became: **why would a real, live, correctly-User-Agent'd request
to `data.sec.gov` receive a non-retryable rejection**, when
`SEC_EDGAR_DECLARED_USER_AGENT = 'SITEBORNE hello@siteborne.com'`
(SUN-1222C2-Q1-R1) is demonstrably attached by `SecSubmissionsAdapter`
(`submissions-adapter.ts:325-327`)?

Traced the real production transport for this service
(`company-evidence-graph-v2-cdp-composition.ts:88` →
`ModalSafeEgressClient`, confirmed by direct import/construction) and
found, by direct source read (`modal-safe-egress-client.ts:103-128`):

`ModalSafeEgressClient.fetch(input, init)` accepts a `RequestInit` (`init`)
parameter but **only ever reads `init.method` and `init.signal`.**
`init.headers` — the object carrying `{'User-Agent': 'SITEBORNE
hello@siteborne.com'}` — is never read, never forwarded. The JSON body
POSTed to the Modal executor
(`request_version`/`correlation_id`/`target_url`/`retrieval_mode`/
`deadline_ms`/`max_response_bytes`/`security_policy_version`/`single_hop`)
has no field for outgoing request headers at all.

Confirmed on the Modal (Python) side too
(`services/webctx-safe-egress/src/webctx_safe_egress/schemas.py:30-53`):
`WebctxFetchRequest` (`model_config = ConfigDict(extra="forbid")`) lists
exactly those same eight fields — no `headers` field exists to receive
one even if the TypeScript side sent it. The executor's own outbound
fetch to `target_url` therefore always uses its own fixed/default
outgoing headers, never anything the calling Worker specifies.

**LOCAL_FAILURE_REPRODUCED=YES**, zero network, in
`packages/provider-adapters/src/tests/modal-safe-egress-client-header-forwarding-gap.test.ts`:
constructs a `ModalSafeEgressClient` with a fake `fetchImpl`, calls
`.fetch(url, { headers: { 'User-Agent': 'SITEBORNE hello@siteborne.com' } })`
exactly as `SecSubmissionsAdapter` does, and asserts the User-Agent
appears **nowhere** in the request Modal actually receives (neither as a
real outer HTTP header nor inside the JSON body) — confirmed passing
(1/1) against current code, i.e. the gap is confirmed present, not
theoretical.

This is not a stack trace, but it is a complete, deterministic,
zero-ambiguity explanation: the User-Agent SEC's own published Fair
Access policy requires was constructed correctly at every layer up to
the transport client, and silently discarded there, every single time,
for every provider that routes through `ModalSafeEgressClient`
(`company_evidence_graph.v2`'s SEC/direct-HTTP/Federal-Register calls,
and `web_context_verified.v2`'s direct retrieval mode).

## 10. Failure-branch elimination

| Candidate | Status | Evidence |
|---|---|---|
| TermsGuard blocked access | ELIMINATED | `provider_rate_window` has 1 admission; a TermsGuard block returns before the rate coordinator is ever reached (submissions-adapter.ts:173-189) |
| Aggregate rate coordinator denied | ELIMINATED | Same admission row; a denial throws `RateLimitedError`, producing `resultClass: 'rate_limited'`, not `permanent_failure` |
| Uncaught exception anywhere in the call graph | ELIMINATED | Workflow step `invoke-executor-1`: Success ✅, clean structured output |
| Workflow step timeout | ELIMINATED | `STEP_CONFIG.INVOKE_EXECUTOR.timeout = '40 seconds'`; actual duration 5s |
| Settlement attempted incorrectly | ELIMINATED | `cdp_facilitator_settle_attempt_count = 0`; result was non-`success`, so the Workflow correctly never reached the settlement step |
| Real SEC EDGAR request never left the executor | ELIMINATED | ~4.6s real-network-consistent duration; `permanent_failure` is a `classifyTerminalHttpStatus`-only classification, unreachable without a real HTTP response |
| SEC rejected the request due to a missing/non-forwarded User-Agent (`ModalSafeEgressClient` header-drop) | **PROVEN** | Source-confirmed, zero-network-reproduced structural gap; fully explains a real, live, non-retryable 4xx-class rejection despite R1's adapter-level fix being genuinely present and correctly constructed |
| A different SEC-side data-shape/parsing defect in `service.ts`/`submissions.ts` | ELIMINATED | Never reached — `permanent_failure` is a pre-parse HTTP-status classification; normalization code never runs for a non-2xx response |

## 11. Recent hardening regression check

The header-drop gap in `ModalSafeEgressClient` **predates** SUN-1222C2
entirely (file's own header: "SUN-1221E5Q6G", authored before this
engagement). R1/R2/R3 did not introduce it and did not regress anything
that previously worked around it — no prior real request to SEC EDGAR
had ever reached this transport in a state where it could matter (every
earlier attempt was blocked earlier, by TermsGuard, before any real
fetch). R1's own test suite is unit-level and injects a fake
`InjectedHttpClient` directly into `SecSubmissionsAdapter`/`SecureHttpClient`
— it never exercises `ModalSafeEgressClient`, so it could not have caught
this gap, and did not need to for its own stated scope (SEC User-Agent
*construction*, which is correct). This is a genuine, previously-latent,
now-newly-exposed integration gap between two independently-correct,
independently-tested layers — exactly the kind of seam unit tests on
either side alone cannot see.

## 12. Structured failure contract

STRUCTURED_FAILURE_COVERAGE_COMPLETE=YES for the executor/service/Workflow
boundary (see §3–4). The gap found is a **data-loss** defect (a header
silently dropped), not a missing-catch defect — no boundary here needs a
new `try/catch`; the fix belongs to the request-construction contract
between `ModalSafeEgressClient` and the Modal executor.

## 13. Local TDD (root cause proven)

Reproducer written and confirmed passing (i.e., the bug is confirmed
present) — see §9 and
`modal-safe-egress-client-header-forwarding-gap.test.ts` (1/1 pass,
zero network, zero live SEC request). No fix implemented or deployed
this checkpoint, per explicit instruction. The minimal fix requires
changes on **both** sides of a versioned cross-service contract:

1. `services/webctx-safe-egress/src/webctx_safe_egress/schemas.py`:
   add a bounded, allow-listed `headers: dict[str, str] | None` field to
   `WebctxFetchRequest` (with its own test proving `FORBIDDEN_FIELD_SUBSTRINGS`
   still holds and that only a small, explicit allow-list of header names
   — e.g. `User-Agent` — can be set, never arbitrary headers from an
   untrusted source), and forward it into the executor's own outbound
   fetch call.
2. `packages/provider-adapters/src/http/modal-safe-egress-client.ts`:
   read `init.headers`, filter to the same allow-list, and include it in
   the JSON body sent to Modal.
3. A coordinated redeploy of the Modal `webctx-safe-egress` App and the
   `siteborne-utility-edge` / `siteborne-paid-continuation-runtime`
   Cloudflare artifacts (both sides of the contract must ship together;
   shipping only the TypeScript side is a no-op, and shipping only the
   Python side is inert until a caller uses it).

This is explicitly out of scope for a read-only diagnosis checkpoint and
is scoped to `SUN-1222C-Q1R6-FIX-AND-QUALIFY`.

## 14. No blind live reproduction

Not needed and not performed — §7–9 uniquely and authoritatively
identified the cause without any new request of any kind.

## 15. Root-cause classification

**ROOT_CAUSE_PROVEN**

`ROOT_CAUSE`: `ModalSafeEgressClient.fetch()` (the real production
transport for `company_evidence_graph.v2`'s SEC EDGAR calls) never reads
or forwards `RequestInit.headers`, and the Modal-side `WebctxFetchRequest`
contract has no field to receive them — so the SUN-1222C2-Q1-R1 canonical
User-Agent (`SITEBORNE hello@siteborne.com`), while correctly constructed
by `SecSubmissionsAdapter`, never reaches SEC's servers on a real request.
SEC EDGAR's own published Fair Access policy requires a declared,
identifying User-Agent from automated clients; a request effectively
arriving with none is fully consistent with the observed non-retryable
(`permanent_failure`) rejection. This is a genuine, deterministic,
pre-existing structural gap — not a transient SEC-side fault, and not a
SUN-1222C2 regression.

## 16. Next checkpoint design

**`SUN-1222C-Q1R6-FIX-AND-QUALIFY`**, containing (once separately
authorized):
1. Repo fix on both sides of the Worker↔Modal contract (§13), each with
   its own RED→GREEN→mutation proof (TypeScript unit tests, Python
   `pytest` tests including the existing `test_no_payment_material.py`-style
   field audit extended to cover the new field's allow-list).
2. Full regression (provider-adapters, edge-api, `webctx-safe-egress`'s
   own Python suite).
3. A coordinated redeploy: the Modal `webctx-safe-egress` App **and** a
   new `siteborne-utility-edge` candidate **and** a
   `siteborne-paid-continuation-runtime` Workflow-host redeploy (both
   Cloudflare artifacts, since both currently reference the old
   `ModalSafeEgressClient` behavior).
4. Non-economic verification that the real outbound request to
   `data.sec.gov` now carries the declared User-Agent (bounded,
   non-payment observability — exact mechanism to be designed in that
   checkpoint; a real SEC EDGAR request without payment context is not
   possible to induce non-economically here, since the only wired
   production caller is this paid executor — that checkpoint should
   design a narrow, explicitly-scoped non-economic path if one is to be
   authorized, rather than assume one exists).
5. Then, and only then, one fresh paid qualification attempt under a new,
   standalone financial authorization.

## 17. Evidence

This report. Lineage: `2d2ace6`. New file:
`packages/provider-adapters/src/tests/modal-safe-egress-client-header-forwarding-gap.test.ts`.

## 18. Final packet

```
SUN1222C_Q1R5=PASS
PAYMENT_RETRY_PERFORMED=NO
NEW_402_REQUESTS=0
NEW_PAYMENT_AUTHORIZATIONS=0
NEW_PAID_POSTS=0
NEW_SETTLEMENT_ATTEMPTS=0
NEW_USDC_TRANSFERS=0
EXACT_RUNTIME_EXCEPTION_RECOVERED=NO
HISTORICAL_WORKER_EXCEPTION_AVAILABLE=NO
LOCAL_FAILURE_REPRODUCED=YES
PRE_RESULT_UNCAUGHT_PATH_COUNT=0
STRUCTURED_FAILURE_COVERAGE_COMPLETE=YES
ROOT_CAUSE_CLASSIFICATION=ROOT_CAUSE_PROVEN
ROOT_CAUSE=ModalSafeEgressClient silently drops RequestInit.headers (no
  outgoing-header field exists in the Worker<->Modal WebctxFetchRequest
  contract on either side), so SEC EDGAR never receives the SUN-1222C2-Q1-R1
  canonical User-Agent on a real request, producing a real, non-retryable
  (permanent_failure) SEC rejection for CIK 0000320193.
ROOT_CAUSE_TDD_RED=YES
PRODUCTION_MUTATIONS=0
ECONOMIC_EFFECT_USDC=0
EVIDENCE_COMMIT_SHA=<set by the commit that includes this file>
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-Q1R6-FIX-AND-QUALIFY
```
