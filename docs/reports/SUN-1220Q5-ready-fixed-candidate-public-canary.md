# SUN-1220Q5 / SUN-1220Q5R — Ready-Fixed Candidate Public Canary

Status: **PASS** (on fresh retry, SUN-1220Q5R)

Candidate: `de70bf98-f304-4d7f-b189-4ae2401041a0` (SUN-1220Q3 ready-truthfulness
qualification candidate, immutable since creation `2026-08-29T02:40:02.907Z`)

Known-good / rollback: `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` (SUN-1209 frozen
candidate)

Lineage: Q1 design `a5a1ea59062f28456bdf5d5b1fda35ec9475222b` -> Q2
implementation `41fdaccea4ad245fa0dd034740d7577e2cdb650b` -> Q3 upload
`60defb81832bf320fc57bd67278a85b20f3c4de6` -> Q4 zero-traffic qualification
`4c8d0177dbc7c56b78bee3680812231bb99c30da` -> Q5 (this report, attempt 1,
incomplete) -> Q5R (this report, attempt 2, PASS).

This report documents **two separate live-traffic attempts** against the same
candidate. Per the Q5R authorization, the partial Q5 window does **not** count
toward the governing minimum; SUN-1220Q5R independently satisfied the full
gate on its own.

---

## Attempt 1 — SUN-1220Q5 (INCOMPLETE, aborted on user interrupt)

- Authorization: fresh standalone `FRESH_SUN1220Q5_PUBLIC_CANARY_AUTHORIZATION=YES`
  obtained via explicit confirmation.
- Phase A (100/0 pre-canary gate): PASS — ordinary routing stayed on
  known-good, candidate-override routing correctly reached
  `de70bf98-f304-4d7f-b189-4ae2401041a0`, `/ready` under override showed
  `production_services_enabled=true` with the 3 proven-stale blockers absent
  and the 3 unproven blockers preserved, catalog/agent-card truthful, other
  11 paid routes + Nevermined inactive.
- Phase B (99/1 public canary): deployed and read back
  (`f4f20676@99% / de70bf98@1%`). Continuous window ran **~192 seconds**
  before the operator interrupted the session.
- Sampling result at time of interrupt: **5/5 qualifying candidate-attributed
  normal-routing safe samples**, all HTTP 200, 0 exceptions, 0 unexpected
  5xx. Duration floor (300s) was **not** reached.
- Outcome: **INCOMPLETE** — sample-count threshold was met but the 300-second
  continuous-duration floor was not. Per checkpoint law this cannot be
  reported as PASS, and cannot be stitched together with a later attempt.
- Restoration: production returned to `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @
  100%` immediately; own sampler/tail/monitor processes stopped by exact PID.
  `SUN1220Q5_RESTORATION=PASS`.
- Zero agent economic actions throughout (no selected-route POST, no
  sign-typed-data, no payment signatures, no settlements, no transactions).

## Attempt 2 — SUN-1220Q5R (fresh retry, PASS)

- Authorization: fresh standalone
  `FRESH_SUN1220Q5R_PUBLIC_CANARY_AUTHORIZATION=YES`, explicitly stating the
  prior partial window does not carry forward.
- Fresh observability: new sampler (`q5r_sampler.sh`), new tail capture
  (`q5r_tail.jsonl`), new strict sample analyzer (`q5r_check.py`) — no reuse
  of Q5 attempt-1 process IDs, counters, or timestamps.
- Candidate immutability reconfirmed since Q4: `PAID_ROUTES_ENABLED=true`,
  `VERIFY_V2_CDP_ROUTE_ENABLED=true`, `PAYMENT_ENVIRONMENT=production`,
  `PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
  `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`; 6/6 Worker secrets present;
  `CDP_WALLET_SECRET` absent. `CANDIDATE_DRIFT_SINCE_Q4=NO`.
- Phase A (100/0 pre-canary gate): PASS — ordinary routing on known-good
  (`/health`, `/ready` -> `production_services_enabled=false`, all 6
  blockers present, matching known-good baseline exactly); candidate-override
  routing confirmed reaching `de70bf98-...`, `/ready` truthful
  (`production_services_enabled=true`, 3 proven-stale blockers absent, 3
  unproven blockers preserved, status/phase/reason unchanged); catalog and
  agent-card show only `verify_agent_output.v2` as `production_enabled:true`
  (other 7 services false); other 11 paid routes + Nevermined confirmed
  inactive/404 under override.
- Phase B (99/1 public canary): deployed and read back
  (`f4f20676@99% / de70bf98@1%`), start timestamp
  `2026-08-29T03:10:16.662Z` (epoch ms `1787973016662`).
- Sampler: safe non-economic GET rotation across
  `/health`, `/ready`, `/catalog`, `/.well-known/agent-card.json`,
  `/services/verify_agent_output.v2`, `/openapi.json`, rate-limited well
  under the 2 req/s ceiling, no override header, no POST anywhere.
- Monitor polled tail attribution (`scriptVersion.id` from live
  `wrangler tail --format json`) every ~20s until both governing thresholds
  were simultaneously satisfied.
- **Milestone reached at elapsed = 364.8s** (>= 300s continuous floor) with
  **5/5 fresh qualifying candidate-attributed normal-routing samples**:

  | Timestamp (epoch ms) | Path |
  |---|---|
  | 1787973053040 | `/.well-known/agent-card.json` |
  | 1787973068650 | `/services/verify_agent_output.v2` |
  | 1787973082681 | `/.well-known/agent-card.json` |
  | 1787973362513 | `/.well-known/agent-card.json` |
  | 1787973364909 | `/ready` |

  All 5 HTTP 200. 0 candidate exceptions, 0 candidate unexpected 5xx.
  Total controlled requests observed: 450 (445 known-good, 5 candidate) —
  consistent with an expected ~1% attribution rate at this sample size.
- The qualifying `/ready` sample (ts `1787973364909`) under genuine
  normal-routing attribution independently confirms the candidate's `/ready`
  truthfulness fix is live and correct under real public traffic, not just
  under manual override.
- Agent economic counters: `LIVE_SIGN_TYPED_DATA_CALLS=0`,
  `PAYMENT_SIGNATURES_CREATED=0`, `LIVE_PAID_REQUESTS=0`, `SETTLEMENTS=0`,
  `TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECTS=0`. No selected-route POST was
  ever sent by the sampler.
- `EXTERNAL_PAID_REQUESTS_OBSERVED`, `EXTERNAL_SETTLEMENTS_OBSERVED`: not
  independently proven either way from the sampled subset (sampler only
  issued safe GETs; full tail was not exhaustively audited for third-party
  traffic) — `UNPROVEN`. `EXTERNAL_DUPLICATE_SETTLEMENT_PATTERN=UNPROVEN`
  (no evidence of it, not affirmatively ruled out).
- Restoration: production deployed back to
  `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`, read-back confirmed single
  active version. `SUN1220Q5R_RESTORATION=PASS`.
- Own sampler (PID 14238) and tail (PID 13835) processes stopped by exact
  PID; both confirmed terminated.
- Post-restoration verification: `/health` -> `200 {"status":"ok",...}`;
  `/ready` -> `200`, known-good body
  (`production_services_enabled:false`, all 6 blockers present) —
  matches pre-canary baseline exactly.
- `POST_RESTORATION_PRODUCTION_PREFLIGHT=PASS` (
  `pnpm run production:preflight`: required bindings/vars present, economic
  vars fail-closed, 12/12 paid routes structurally unavailable pre-economics,
  6/6 required secret names present).
- `NEW_SECRET_FINDINGS=0` (`pnpm secrets:scan`: single finding is the
  pre-existing, previously-reported `BASESCAN_TOKEN_CONTRACT` public-address
  heuristic match in `docs/reports/SUN-1220O-first-real-paid-e2e.md:159`,
  same fingerprint as prior checkpoints — not new).
- `HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES` (economic execution path
  untouched by the `/ready` fix). `REAL_PAID_E2E_REPEAT_REQUIRED=NO`.

---

## Final stop packet

```
SUN1220Q5R_PUBLIC_CANARY=PASS
SUN1220Q5R_DURATION_SECONDS=364.8
SUN1220Q5R_CANDIDATE_QUALIFYING_SAMPLES=5
SUN1220Q5R_CANDIDATE_SAMPLE_STATUS_DIST={200:5}
SUN1220Q5R_CANDIDATE_EXCEPTIONS=0
SUN1220Q5R_CANDIDATE_UNEXPECTED_5XX=0
SUN1220Q5_ATTEMPT1_OUTCOME=INCOMPLETE (192s, 5 samples, 0 anomalies, aborted on interrupt)
SUN1220Q5_ATTEMPT1_CARRIED_FORWARD=NO
READY_TRUTHFULNESS_UNDER_NORMAL_ROUTING=PASS
CATALOG_AGENT_CARD_TRUTHFUL_UNDER_NORMAL_ROUTING=YES
OTHER_11_PAID_ROUTES_ACTIVE=NO
NEVERMINED_ACTIVE=NO
AGENT_REAL_ECONOMIC_EFFECT_USDC=0
LIVE_SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
EXTERNAL_PAID_REQUESTS_OBSERVED=UNPROVEN
EXTERNAL_SETTLEMENTS_OBSERVED=UNPROVEN
EXTERNAL_DUPLICATE_SETTLEMENT_PATTERN=UNPROVEN
SUN1220Q5R_RESTORATION=PASS
FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%
POST_RESTORATION_PRODUCTION_PREFLIGHT=PASS
HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES
REAL_PAID_E2E_REPEAT_REQUIRED=NO
NEW_SECRET_FINDINGS=0
Q5R_OWN_SAMPLER_STOPPED=YES
Q5R_OWN_MONITOR_STOPPED=YES
Q5R_OWN_TAIL_STOPPED=YES
Q6_FINAL_PRODUCTION_PROMOTION_ELIGIBLE=YES
```

STOP. No promotion performed. No further 402 requests obtained in this
checkpoint. No real payment attempted or repeated.
