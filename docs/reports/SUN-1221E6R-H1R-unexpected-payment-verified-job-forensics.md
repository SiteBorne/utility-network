# SUN-1221E6R-H1R — Unexpected `PAYMENT_VERIFIED` Job Forensics

**Read-only.** Zero mutations performed against jobs, D1, Worker deployment, or chain state. All commands below were `SELECT`/read-only D1 queries and a single `eth_call` (Base mainnet RPC).

## 1. Job record (current, live read)

| Field | Value |
|---|---|
| `id` | `de147124-c264-452b-b784-86ee4422ecd1` |
| `request_id` | `d8d2dce0-8dc8-4da0-b37c-30c451ee6dc7` |
| `service_id` | `web_context_verified.v2` |
| `current_state` | `EXECUTING` |
| `created_at` | `2026-08-31T04:46:24.078Z` |
| `expires_at` | `2026-08-31T04:51:23.504Z` |
| `attempt_count` | 1 |
| `production_enabled` | `0` |
| `idempotency_key` | `pay_02703c94503e489890f51c4e98a771c6` |

`SECONDS_PAST_EXPIRES_AT` at time of investigation (~04:59:50 UTC): ~510s.

**Important:** `production_enabled = 0` is not anomalous — `apps/edge-api/src/control-plane/repositories/d1/acquisition.ts:210` hardcodes `production_enabled = 0` for every job the real application code ever inserts. It carries no diagnostic value here.

## 2. Full event timeline (`job_state_events`)

| Seq | Timestamp | Transition | Reason | Actor |
|---|---|---|---|---|
| 1 | 04:46:24.181 | RECEIVED → VALIDATED | VALIDATION_PASSED | SYSTEM |
| 2 | 04:46:24.235 | VALIDATED → QUOTED | QUOTE_GENERATED | SYSTEM |
| 3 | 04:46:24.286 | QUOTED → PAYMENT_CHALLENGED | PAYMENT_REQUIRED | SYSTEM |
| 4 | 04:46:24.508 | PAYMENT_CHALLENGED → PAYMENT_VERIFIED | PAYMENT_VERIFIED | SYSTEM |
| 5 | 04:46:24.613 | PAYMENT_VERIFIED → LOCKED | RESOURCE_LOCKED | SYSTEM |
| 6 | 04:46:24.667 | LOCKED → ROUTED | ROUTED_TO_WORKER | SYSTEM |
| 7 | 04:46:24.718 | ROUTED → EXECUTING | EXECUTION_STARTED | SYSTEM |

Full RECEIVED→EXECUTING sequence: **537ms total**, no gaps > ~230ms.

Every `attempt_hash` in these rows is a near-all-zero placeholder (e.g. `sha256:000000000000000000000000000000000000000000000000000000001a60a784` — 58 zero digits + 6 real hex digits), not a genuine SHA-256 digest (64 pseudo-random hex chars expected).

## 3. Cross-table evidence

| Table | Rows for this job/request | Expected if real |
|---|---|---|
| `job_attempts` | **0** | Exactly 1, inserted atomically with `jobs` row by `acquisition.ts` |
| `payment_attempts` | **0** | ≥1 once PAYMENT_VERIFIED is reached |
| `payment_quotes` | **0** | 1, created at PAYMENT_CHALLENGED |

The real job-creation code path (`acquisition.ts`) inserts `jobs`, `idempotency_records`, and `job_attempts` in the same batch — there is no code path in the application that creates a `jobs` row without a matching `job_attempts` row. This job has none.

## 4. Timing plausibility

A genuine PAYMENT_CHALLENGED → PAYMENT_VERIFIED transition requires: real CDP custodial-signer round trip (typically 1–3s+) and a real x402 facilitator `/verify` network call. This job completed that exact transition in **222ms** (04:46:24.286 → 04:46:24.508), and completed the entire RECEIVED→EXECUTING chain in 537ms. This is not achievable by the real payment/execution pipeline.

## 5. On-chain reconciliation

- Buyer (`0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`) USDC balance before H1: `28197` atomic
- Buyer USDC balance **read live via Base mainnet RPC just now**: `28197` atomic (`0x...6e25`)
- Delta: **0**
- No 9000-atomic (0.009 USDC) transfer of any kind is attributable to this job.

**REAL_ECONOMIC_EFFECT_USDC = 0**, confirmed by a fresh, direct chain read (not just the earlier CSV/H1 snapshot).

## 6. H1 correlation

H1's timed-out client made at most one real HTTP request cycle; it does not create `job_state_events` rows client-side, and if the real POST had reached the Worker, the resulting job would carry real `job_attempts`/`payment_attempts` rows and multi-second inter-state gaps (real CDP + facilitator latency), not this job's 537ms all-SYSTEM sequence with placeholder hashes. **This job is not H1's delayed continuation** (no shared request_id, no shared correlation evidence, and the structural/timing signature rules it out).

## 7. Origin investigation

`scripts/d1-verify.ts` was located as a codebase precedent for direct `INSERT INTO jobs` bypassing `job_attempts` — but it instantiates a `Miniflare` (local, in-process, ephemeral) database exclusively; it has no remote-D1 code path (no `--remote`, no account/database-id wiring), so it is **ruled out** as the literal writer of this row, which unambiguously exists in the real remote D1 (`served_by: v3-prod`, `efe23c42-cbcc-47c2-9b28-922a541bdcdd`). No other in-repo script was found that targets the remote database with this exact placeholder-hash / all-SYSTEM-actor pattern for `web_context_verified.v2`.

**The exact process that wrote this row could not be identified from repository code alone.**

## 8. Conclusion

All available evidence — missing `job_attempts`/`payment_attempts`/`payment_quotes` rows, non-cryptographic placeholder `attempt_hash` values, and an inter-state timing profile impossible for real CDP signing + facilitator verification — is inconsistent with this job having passed through the genuine payment/execution pipeline. Independently, a live on-chain balance read proves zero USDC moved. This is assessed as a **synthetic/artifact job row**, not a real payment, and not H1's continuation. The exact writing process is unresolved from static analysis; runtime/access logs outside this repository would be needed to identify it conclusively.

No recovery action was taken. This row does not gate or block any real traffic, service, or other job.
