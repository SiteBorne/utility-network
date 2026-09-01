# SUN-1221E6R-H2B2-R2 — First Successful Real Settlement, With a Post-Settlement Bookkeeping Defect

## Result

**SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION = PARTIAL_SUCCESS_WITH_DEFECT**

The real payment **succeeded economically** for the first time in this
program: exactly 9,000 atomic USDC moved on Base mainnet from the
authorized buyer to the authorized seller, the real service was delivered
(a real Modal fetch of `https://example.com/`), and a valid PCC was
generated (`decision: "pass"`). Immediately afterward, the Workflow's
`settle-1` step crashed while writing its own bookkeeping to D1, because
a migration required by that write (`0007_cdp_settlement_recovery.sql`)
was never applied to the remote production database. The Workflow
instance is now terminally `Errored`; the job is stuck at `SETTLING`; no
receipt was issued.

No retry was performed. No second mutation was performed. This report is
read-only reconciliation only, per the SUN-1221E6R-H2B2-R2-COMBINED
authorization's own "stop on ambiguous/unexpected result" clause.

## What actually happened, step by step

Real Workflow instance:
`siteborne-wf-a676879ef38270aa87573a3f943c263ecf6638857725cb0d`
(Workflow version `7f9ab8d1-a45a-4ee1-95a8-283deea6facd`, dedicated host
`siteborne-paid-continuation-runtime` version
`67ae702c-f8d0-4a56-afd4-55b135784871`), queued 2026-09-01 08:39:28,
started 08:39:30, ended 08:39:37 (7 seconds total).

| Step | Result | Notes |
|---|---|---|
| `open-envelope-1` | ✅ Success | Real continuation envelope decrypted correctly (the R1 fix from H2B2-R1 continues to hold). |
| `check-authorization-expiry-1` | ✅ Success | `expired: false`. |
| `invoke-executor-1` | ✅ Success | Real Modal call. `result_class: "success"`, fetched `https://example.com/` (HTTP 200), 5 seconds — the Modal `max_response_bytes` fix from this checkpoint's own R2 source change is what let this call succeed at all (the prior two real-payment attempts never got this far, or errored before this point). |
| `generate-pcc-1` | ✅ Success | Valid PCC, `decision: "pass"`, `completeness: 1`, `verifier_set_hash` populated, signed with `kid_0ea0e04e294f20fc78b2b155`. |
| `settle-1` | ❌ **Error** | `Error: D1_ERROR: no such column: cdp_successful_economic_settlement_count at offset 71: SQLITE_ERROR`. The real CDP facilitator settlement call inside this step evidently succeeded (see on-chain proof below) — the step's D1 bookkeeping write is what threw, after the economic action had already happened. |

## Independent economic proof (all read-only)

**On-chain transaction** `0x15e60d34ad29506f0eb10a372bc84b60c758c6d56b080994682471c9e1741d95`
(`eth_getTransactionReceipt` against `https://mainnet.base.org`):

- `status: 0x1` (success)
- `to: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` — the exact authorized
  USDC contract
- ERC-20 `Transfer` log: `from=0x516F...abEcB99` (exact authorized buyer)
  → `to=0x7f44...295E6E1` (exact authorized seller), `data=0x2328` = **9000
  decimal** — the exact authorized amount, exactly once

**Balance reconciliation** (`eth_call` → `balanceOf`, read independently,
not from any application log):

| | Before (H2B2-R1 baseline) | After | Delta |
|---|---|---|---|
| Buyer `0x516F...abEcB99` | 28,197 atomic | 19,197 atomic | **−9,000** |
| Seller `0x7f44...295E6E1` | 19,000 atomic | 28,000 atomic | **+9,000** |

Exact match to the transaction log, exact match to the authorized
amount, exactly one transfer. No duplicate: `SELECT COUNT(*) FROM
payment_attempts WHERE payment_identifier =
'pay_4a7d1e37f0184afdb13f86717c03699f'` → `1`.

**D1 state** (`payment_attempts` row `56d84294-eff5-4f92-ae91-d61ceca5339a`):

- `lifecycle_stage: "settled_external"`
- `settlement_transaction_reference:
  "0x15e60d34ad29506f0eb10a372bc84b60c758c6d56b080994682471c9e1741d95"`
- `service_receipt_id: null` — **never issued**, because the step that
  would have issued it crashed first
- `consumed_at: null` — same reason
- `job_id: null` on this row (the `jobs` table row
  `64a321cb-f1d2-495d-a405-094b631d4170` for `web_context_verified.v2`
  exists independently, `current_state: "SETTLING"`, stuck there since
  08:39:36 — the job-finalization write that would have advanced it past
  `SETTLING` is downstream of the same crashed step)

## Root cause of the crash (source-confirmed, read-only)

```
apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts:496
  `UPDATE payment_attempts SET cdp_successful_economic_settlement_count =
   cdp_successful_economic_settlement_count + 1 WHERE payment_identifier = ?`
```

This column is added by `migrations/0007_cdp_settlement_recovery.sql`
(`ALTER TABLE payment_attempts ADD COLUMN
cdp_successful_economic_settlement_count INTEGER NOT NULL DEFAULT 0`),
which exists in the repository but was **never applied to the remote
production D1 database**:

```
$ npx wrangler d1 migrations list siteborne-utility --remote
Migrations to be applied:
┌──────────────────────────────────┐
│ Name                             │
├──────────────────────────────────┤
│ 0007_cdp_settlement_recovery.sql │
└──────────────────────────────────┘
```

This is a deployment-process gap, not an application-logic bug: the code
in `settle-1` correctly assumes the schema its own migration file
declares; production's D1 instance was simply never migrated to match.
Applying that one migration is expected to be the complete, minimal fix
— no source code change is implicated by this specific defect.

## Containment (unaffected)

- Public production `de70bf98-f304-4d7f-b189-4ae2401041a0` — still 100%
  traffic, untouched.
- Cross-script candidate `db7054c9-76ee-4830-aabe-8a4542261b6a` — still
  0% traffic, untouched.
- Exactly one host deployment this checkpoint
  (`67ae702c-f8d0-4a56-afd4-55b135784871`), containing only the Modal
  `max_response_bytes` fix.
- Exactly one fresh 402, one new EIP-3009 authorization
  (`pay_4a7d1e37f0184afdb13f86717c03699f`, distinct from every retired
  prior attempt), one human-operated signing action, one paid POST — no
  retry.
- Exactly one settlement attempt, exactly one on-chain transfer, exactly
  9,000 atomic USDC, no duplicate.
- No second host deployment, no API candidate upload, no traffic change,
  no secret/key rotation performed this checkpoint.
- This report performs zero additional mutations: the missing migration
  was **not** applied here — that requires its own explicit
  authorization, since it is a production D1 mutation outside this
  checkpoint's read-only-reconciliation authorization.

## Assessment

This is the first time real money has moved correctly through the full
architecture end-to-end (public API candidate → cross-script Workflow
binding → dedicated host → real executor → real PCC → real on-chain
settlement), and every dollar-figure involved reconciles exactly. But the
system did not yet complete its own bookkeeping (`service_receipt_id`
and `consumed_at`, and the job's terminal state) for that same payment.
A payer's money moved and no receipt exists yet to prove it — this is a
real, must-fix gap before any canary/production traffic (F/G), even
though the underlying payment/settlement path itself is now proven
correct for the first time.

**SUN1221F_CANARY_ELIGIBLE = NO** — pending a corrective checkpoint that
(1) applies the missing D1 migration to remote production, (2) proves
receipt issuance completes for a subsequent real or synthetic settlement
without crashing, and (3) considers whether `settle-1` should be made
resilient to a bookkeeping-write failure after the economic action has
already succeeded (e.g. so a future occurrence of this class of bug
can't leave a paid job invisible to reconciliation).
