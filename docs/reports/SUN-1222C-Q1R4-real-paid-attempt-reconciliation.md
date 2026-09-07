# SUN-1222C-Q1R4 — Real Paid Attempt Reconciliation

**Checkpoint:** SUN-1222C-Q1R4 (§8–28, post financial-authorization)
**Date:** 2026-09-07
**Result:** AMBIGUOUS — no retry performed per standing no-retry authorization term.

## What happened

One fresh real paid qualification attempt was executed by the operator against
candidate `a064477f-7b74-46c5-a5b6-799df114b252` (routes to Workflow host
`917c1c49-16fd-4c4d-b9d6-e54ad6f9ec80`, confirmed 100% active since
2026-09-07T17:53:04Z, well before this attempt).

Client-observed result:

```json
{"ok":false,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,"payment_material_created":true,"paid_request_submitted":true,"submission_result":"ambiguous","http_status":502}
```

## Authoritative D1 reconciliation

- **Payment attempt:** `pay_246c956277394be0aec72656322264d6`, amount 31200,
  asset/network/payTo all match frozen economics, `lifecycle_stage: "verified"`
  (payment itself verified correctly), `cdp_facilitator_settle_attempt_count: 0`
  (no settlement ever attempted).
- **Job:** `63dfe74b-6414-4cfa-9dfa-0fb2b7a83aa0`, `current_state: REJECTED`.
  State trail: RECEIVED → VALIDATED → QUOTED → PAYMENT_CHALLENGED →
  PAYMENT_VERIFIED → LOCKED → ROUTED → EXECUTING → **QUARANTINED**
  (`EXECUTION_FAILED`) → REJECTED (`QUARANTINE_POLICY`). Total duration 8.7s.
- **x402_service_results:** zero rows for this job — unlike the original Q1
  attempt (which produced a clean structured `partial` result with an
  explicit `sec-edgar policy_blocked` limitation), this attempt produced **no
  structured result at all**, indicating an uncaught exception rather than a
  classified business rejection.
- **audit_events / security_events:** zero rows for this job or this time
  window — the failure was not captured by either audit path.
- **provider_rate_window:** exactly **one** row,
  `sec-edgar:1788804804708:...`, timestamp ≈ 2026-09-07T18:13:24.7Z — matching
  the job's `ROUTED_TO_WORKER`→`EXECUTING` transition almost exactly. This is
  decisive: the SEC aggregate rate coordinator **admitted** the request (R2
  did not wrongly deny it), and a real SEC EDGAR network attempt **was**
  made — TermsGuard (R3) did **not** block this attempt pre-flight, unlike
  the original Q1 failure.

## Interpretation

R3 (TermsReview registration) and R2's rate coordinator are proven working as
intended in this real attempt: the request reached the point of a real SEC
network call, which never happened in the original attempt. Something failed
during or immediately after that real SEC call, before a structured result
could be produced. Candidates, none of which can be distinguished from D1
alone: a genuine SEC EDGAR-side rejection this run (403/429/5xx unrelated to
User-Agent), a bug newly introduced in the R1/R2 status-classification or
rate-coordinator wiring path that throws uncaught rather than resolving to a
classified `AdapterError`, or an unrelated infrastructure fault (Modal
safe-egress, timeout). No live `wrangler tail` was attached during the
~9-second execution window, so the exact stack trace is not recoverable after
the fact.

## Economic reconciliation

- Buyer `0x516F...ecB99`: 79,727 atomic before and after (dual-RPC:
  mainnet.base.org, base.publicnode.com).
- Seller `0x7f44...E6E1`: 28,000 atomic before and after.
- Zero settlement attempts, zero USDC transfers, zero economic effect.

## Disposition

Per the governing authorization's explicit ambiguity clause, **no retry was
performed**. This checkpoint stops here.

```
COMPANY_EVIDENCE_GRAPH_V2_REAL_PAID_QUALIFICATION=AMBIGUOUS
PRODUCTION_TRAFFIC_MUTATIONS=0
HOST_DEPLOYMENTS_DURING_Q1R4=0
REAL_402_REQUESTS=1
EIP3009_AUTHORIZATIONS_CREATED=1
PAID_POSTS=1
SETTLEMENT_ATTEMPTS=0
NEW_USDC_TRANSFERS=0
ECONOMIC_EFFECT_USDC=0
NEXT_REQUIRED_CHECKPOINT=READ_ONLY_DIAGNOSIS (with live wrangler tail attached
  before any further attempt, to capture the actual exception)
```
