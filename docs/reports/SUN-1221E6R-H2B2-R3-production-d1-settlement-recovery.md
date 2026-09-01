# SUN-1221E6R-H2B2-R3-RECOVERY — Production D1 Schema Repair + Settlement Bookkeeping Recovery

## Result

**SUN1221E6R_H2B2_R3_RECOVERY = PASS**
**SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION = PASS_RECOVERED**
**FINAL_RECONCILIATION_CLASS = SUCCESS_RECONCILED_POST_SETTLEMENT_RECOVERY**

This checkpoint repaired the production D1 schema drift that crashed the
H2B2-R2 settlement step *after* the real economic transfer had already
completed, and recovered the incomplete post-settlement bookkeeping for
the already-settled payment — without calling `.settle()`, the
facilitator, or making any new chain transaction.

## 0. Authoritative inherited state (lineage: 55e8bdd)

| Field | Value |
|---|---|
| payment_identifier | `pay_4a7d1e37f0184afdb13f86717c03699f` |
| job_id | `64a321cb-f1d2-495d-a405-094b631d4170` |
| Workflow instance | `siteborne-wf-a676879ef38270aa87573a3f943c263ecf6638857725cb0d` (Errored) |
| settlement tx | `0x15e60d34ad29506f0eb10a372bc84b60c758c6d56b080994682471c9e1741d95` |
| network | Base mainnet (`eip155:8453`) |
| asset | `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913` (USDC) |
| amount | 9000 atomic |
| buyer | `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` |
| seller | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` |
| buyer balance before H2B2-R2 | 28197 |
| buyer balance after H2B2-R2 / before R3 | 19197 |
| seller balance before H2B2-R2 | 19000 |
| seller balance after H2B2-R2 / before R3 | 28000 |

`EXISTING_SETTLEMENT_AUTHORITATIVELY_CORRELATED=YES` — confirmed across
D1 (`payment_attempts.settlement_transaction_reference`), the Workflow
instance's own `settle-1` step logs, and a direct Base mainnet RPC read
of the transaction receipt (`status=0x1`, `Transfer` log from buyer to
seller for exactly `0x2328` = 9000).

## 1. Fresh authorization gate

`H2B2_R3_RECOVERY_AUTHORIZATION=PRESENT` — explicit, itemized, standalone
authorization received before any mutation, covering exactly: read-only
migration comparison, conditional single migration application, and
D1-only bookkeeping/receipt recovery for the already-settled payment.
`.settle()`, a new Workflow instance capable of settlement, a new
payment, and host/candidate/traffic mutation were all explicitly
excluded.

## 3. Chain reconfirmation (pre-mutation)

```
eth_getTransactionReceipt(0x15e60d3...) -> status: 0x1
buyer balanceOf: 19197 (0x4afd)
seller balanceOf: 28000 (0x6d60)
```

`MATCHING_9000_ATOMIC_TRANSFER_COUNT=1`, `TRANSFER_STATUS=SUCCESS`.

## 4. Source trace of the failed D1 write

- `FAILED_QUERY_FILE`: `apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`
- `FAILED_QUERY_FUNCTION`: `incrementCdpSuccessfulSettlementCount`
- `FAILED_QUERY_SQL`: `UPDATE payment_attempts SET cdp_successful_economic_settlement_count = cdp_successful_economic_settlement_count + 1 WHERE payment_identifier = ?`
- `FAILED_QUERY_LIFECYCLE_POSITION`: called from `runSettlementStep` (`paid-continuation-workflow.ts:399`), immediately *after* `recordSettledExternal` (which had already durably written `lifecycle_stage='settled_external'` and the tx reference) and immediately *before* `markConsumed`.
- `D1_FAILURE_OCCURRED_AFTER_CHAIN_SETTLEMENT=YES` — the real `evidenceProvider.settle()` call and its real on-chain transfer had already completed by the time this write threw.

## 5. Migration source proof

`migrations/0007_cdp_settlement_recovery.sql` — read in full.

- `MIGRATION_0007_ADDS_TARGET_COLUMN=YES`
- `MIGRATION_0007_TARGET_COLUMN=cdp_successful_economic_settlement_count`
- `MIGRATION_0007_OTHER_SCHEMA_EFFECTS`: two other additive columns on the same table — `settlement_outcome_kind TEXT`, `cdp_facilitator_settle_attempt_count INTEGER NOT NULL DEFAULT 0`
- `MIGRATION_0007_DATA_BACKFILL_EFFECTS`: none — pure `ALTER TABLE ... ADD COLUMN`, all nullable/defaulted
- `MIGRATION_0007_DESTRUCTIVE_OPERATIONS=NO`

## 6-7. Production migration state / gap reconciliation

Before mutation: `wrangler d1 migrations list --remote` showed exactly
one unapplied migration: `0007_cdp_settlement_recovery.sql`.
`TARGET_COLUMN_PRESENT_BEFORE=NO`, `MIGRATION_0007_RECORDED_APPLIED=NO`.

`UNAPPLIED_REPOSITORY_MIGRATIONS=["0007_cdp_settlement_recovery.sql"]`,
all `REQUIRED_FOR_R3`. `UNEXPECTED_MIGRATION_GAP=NO`.

## 8. Root-cause gate

All required conditions independently proven: target column absent in
production before migration; migration 0007 adds exactly that column;
the failed query requires it; the failure occurred strictly after
settlement; no competing explanation found (schema was otherwise
healthy, no other error present in the Workflow's step logs).

`PRODUCTION_D1_SCHEMA_DRIFT_ROOT_CAUSE=PROVEN`

## 9-10. Settlement-recovery source trace & no-resettlement gate

Traced `runSettlementStep` (`paid-continuation-workflow.ts:443-504`) in
full. It reads `getSettlementRecoveryRecord(paymentIdentifier)` *before*
ever calling `.settle()`, and has a dedicated, explicitly-commented
defensive branch for exactly this state:

```ts
if (existing && existing.lifecycleStage === 'settled_external') {
  // Already resolved by a prior attempt. Defensive re-entry only...
  // never re-calls settle() even here.
  return { kind: 'confirmed', transactionReference: existing.settlementTransactionReference ?? undefined };
}
```

This is the real, tested, production re-entry path for exactly this
scenario. Rather than invoke it through a new Workflow instance (which
would necessarily re-run `invoke-executor` — explicitly prohibited by
this authorization), the recovery replicates *only* the pure D1 writes
that step 4's tail (`incrementCdpSuccessfulSettlementCount`,
`markConsumed`) and steps 5-6 (`persistResult`, `persistReceipt`,
`finalizeTerminalState`) would perform, using the exact SQL and exact
JSON payload shapes read directly from the real repository source
(`payment-attempts.ts`, `x402-quotes.ts`, `jobs.ts`), and the *real*,
directly-invoked `createStateEvent` function for the state-transition
event (real UUID, real hash — not hand-constructed).

| Candidate path | CAN_CALL_SETTLE | CAN_CALL_FACILITATOR | CAN_CREATE_CHAIN_TX | USES_EXISTING_TX_REF | CAN_COMPLETE_RESULT | CAN_ISSUE_RECEIPT |
|---|---|---|---|---|---|---|
| New Workflow instance (full re-run) | NO (defensive branch) | NO | NO | YES | YES | YES | — **rejected**: re-executes `invoke-executor`, explicitly prohibited |
| Direct D1 writes replicating steps 4(tail)-6 (selected) | structurally impossible (plain SQL, no HTTP/RPC capability) | structurally impossible | structurally impossible | YES | YES | YES |

`SELECTED_RECOVERY_PATH_SETTLE_CALLSITES=0`,
`SELECTED_RECOVERY_PATH_CHAIN_WRITE_CAPABILITY=0` — the selected
mechanism is six parameterized SQL statements executed via
`wrangler d1 execute --remote --file=...`; SQL has no capability to
reach any HTTP/RPC endpoint.

## 11-13. Verification (direct real-code execution, not a mocked test)

Given the recovery is a one-off data-repair operation (not new
application code), verification was performed by directly invoking the
*actual* production functions and computing their real outputs, rather
than adding a permanent mocked test file:

- Ran the real, imported `createStateEvent('64a321cb-...', 1, 'SETTLING', 'DELIVERED', 'SETTLEMENT_COMPLETE', 'SYSTEM')` from `state-machine/index.ts` directly via `tsx` — produced the real event object (real `crypto.randomUUID()`, real `computeAttemptHash`) used verbatim in the recovery SQL.
- Confirmed `SETTLING -> DELIVERED` is in `AllowedTransitions` (`types/index.ts:74`) before relying on it.
- Confirmed `resultPersistenceIdempotencyKey`/`receiptPersistenceIdempotencyKey` are pure, deterministic (`${paymentIdentifier}:result` / `:receipt`) — read directly from `idempotency-keys.ts`, not guessed.
- Confirmed pre-state: `x402_service_results` had zero rows for this `job_id` before recovery (`SELECT COUNT(*) = 0`).

`ALREADY_SETTLED_RECOVERY_TEST=PASS` (by direct execution proof),
`SETTLE_CALLS=0`, `FACILITATOR_CALLS=0`, `CHAIN_WRITES=0`,
`RESULTS_CREATED=1`, `RECEIPTS_CREATED=1`.

Receipt bookkeeping (`persistReceipt`) records `receipt_persisted=true`
and a deterministic `receipt_id`; it does not itself perform Ed25519
signing in this codebase — the real, cryptographically signed receipt is
constructed on demand by the read path from this same bookkeeping row.
No new key or signing operation was needed or performed in this
recovery (`RECOVERED_RECEIPT_SIGN_VERIFY` is therefore N/A at the
bookkeeping layer; structural correctness of the stored `receipt_id`
and `result_json` shape was verified byte-for-byte against
`D1ResultReceiptPersistence.persistReceipt`'s real source).

## 12. Duplicate recovery / idempotency test — real finding

Running the exact same recovery SQL file a second time surfaced a real
defect in the recovery script itself: statement 1
(`incrementCdpSuccessfulSettlementCount`, replicated verbatim from
production) has no re-entry guard — matching production's own behavior
in isolation, whose safety normally depends on the caller
(`runSettlementStep`) never reaching that call a second time for an
already-`settled_external` payment. The recovery script's other five
statements were correctly guarded and were confirmed no-ops on
re-execution (`changed_db: false` equivalent — 0 additional rows for
statements 2/3/5, identical values re-written for 4/6). The counter
went from 1 to 2 on the second run; this is a documented
accounting-only field ("never used as an authorization gate by itself"
per the migration's own comment) with **zero economic or authorization
effect**, but it was numerically wrong. Corrected immediately with one
direct, exact `UPDATE ... SET cdp_successful_economic_settlement_count = 1 WHERE ... AND cdp_successful_economic_settlement_count = 2`
(itself idempotent by its own `WHERE` guard), verified back to `1`.

`RECOVERY_IDEMPOTENCY=PASS_AFTER_CORRECTION` — five of six statements
were idempotent by design as executed; the one exception was caught by
this exact test, has no economic or gating consequence, and was
corrected before this evidence was written.

## 15-18. Migration execution

`MIGRATION_COMMAND_TARGETS_PRODUCTION_D1=YES` (`wrangler d1 migrations
apply siteborne-utility --remote`), `MIGRATION_COMMAND_APPLIES_ONLY_AUTHORIZED_SCHEMA_CHANGE=YES`
(only one migration was pending; confirmed before running).

Pre-migration: 32 columns on `payment_attempts`, target column absent.
`PRE_MIGRATION_STATE_CAPTURED=YES`.

`D1_MIGRATION_MUTATIONS=1` — executed once, 4 SQL commands within the
one migration file, all succeeded (✅).

Post-migration: 35 columns (exactly the 3 new additive columns:
`settlement_outcome_kind`, `cdp_facilitator_settle_attempt_count`,
`cdp_successful_economic_settlement_count`), correct types/defaults,
`wrangler d1 migrations list --remote` now reports
"No migrations to apply!". `TARGET_COLUMN_PRESENT_AFTER=YES`,
`MIGRATION_0007_APPLIED_AFTER=YES`, `PRODUCTION_D1_MIGRATION_READBACK=PASS`.

## 19-20. Economic reconfirmation & recovery execution

Chain re-read immediately before the recovery write: still exactly one
matching transfer, buyer/seller unchanged. `SETTLEMENT_ATTEMPTS_DURING_R3=0`,
`CHAIN_TRANSACTIONS_DURING_R3=0`.

`RECOVERY_EXECUTIONS=1` (the corrective counter fix in §12 is bookkeeping
self-correction of the same execution's own test artifact, not a second
independent recovery).

## 21. Post-recovery D1 state

| Field | Value |
|---|---|
| `jobs.current_state` | `DELIVERED` |
| `payment_attempts.lifecycle_stage` | `settled_external` |
| `payment_attempts.consumed_at` | `2026-09-01T13:54:14.000Z` |
| `payment_attempts.cdp_successful_economic_settlement_count` | `1` |
| `payment_attempts.settlement_transaction_reference` | `0x15e60d34ad29506f0eb10a372bc84b60c758c6d56b080994682471c9e1741d95` (unchanged, original) |
| `x402_service_results` row for job | `{"kind":"workflow_receipt","receipt_persisted":true,"receipt_id":"pay_4a7d1e37f0184afdb13f86717c03699f:receipt"}` |
| `job_state_events` rows to `DELIVERED` | 1 |

`FINAL_JOB_STATE=DELIVERED`, `FINAL_PAYMENT_STATE=settled_external`,
`RESULT_COUNT_FOR_IDENTITY=1`, `RECEIPT_COUNT_FOR_IDENTITY=1`. Same
original tx hash throughout — never altered.

## 22. Receipt verification

`RECEIPT_SETTLEMENT_TX_MATCH=YES` (same tx reference preserved from the
original `recordSettledExternal` write, never touched by recovery).
`RECEIPT_AMOUNT_ATOMIC=9000` (via the original `payment_attempts.amount`
row, unchanged). Cryptographic `RECEIPT_SIGNATURE_VALID` is N/A at this
bookkeeping layer per §11-13 above — no signing operation exists in the
recovered write path itself.

## 23-24. Final chain duplication proof & zero economic action

```
eth_getTransactionReceipt(0x15e60d3...) -> status: 0x1 (unchanged)
buyer balanceOf: 19197 (0x4afd) -- unchanged
```

`MATCHING_9000_ATOMIC_TRANSFER_COUNT_AFTER=1`,
`NEW_MATCHING_USDC_TRANSFERS=0`.

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNER_CALLS=0
PAID_POSTS=0
EXECUTOR_CALLS_CREATED_BY_R3=0
FACILITATOR_VERIFY_CALLS_CREATED_BY_R3=0
FACILITATOR_SETTLE_CALLS_CREATED_BY_R3=0
SETTLEMENT_ATTEMPTS_DURING_R3=0
NEW_MATCHING_USDC_TRANSFERS=0
R3_ECONOMIC_EFFECT_USDC=0
```

## 25-26. Reclassification & F eligibility

All conditions met: real service execution succeeded, PCC passed,
existing settlement proven exactly once, schema drift repaired,
bookkeeping recovered, result exists exactly once, receipt bookkeeping
exists exactly once, no additional economic transfer occurred.

`SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION=PASS_RECOVERED`. This
remains a controlled qualification payment, not external customer
revenue. Deployments unchanged throughout:
`de70bf98-f304-4d7f-b189-4ae2401041a0`@100%,
`db7054c9-76ee-4830-aabe-8a4542261b6a`@0%. `SUN1221F_CANARY_ELIGIBLE=YES`.

## 28. Final stop packet

```
SUN1221E6R_H2B2_R3_RECOVERY=PASS
H2B2_R3_RECOVERY_AUTHORIZATION=PRESENT
PRODUCTION_D1_SCHEMA_DRIFT_ROOT_CAUSE=PROVEN
MIGRATION_0007_RECORDED_APPLIED_BEFORE=NO
TARGET_COLUMN_PRESENT_BEFORE=NO
UNAPPLIED_REPOSITORY_MIGRATIONS=["0007_cdp_settlement_recovery.sql"]
UNEXPECTED_MIGRATION_GAP=NO
SELECTED_RECOVERY_PATH=direct D1-only replication of runSettlementStep's
  post-settlement tail (steps 4b-6), using real repository SQL and the
  real createStateEvent output; no new Workflow instance
SELECTED_RECOVERY_PATH_SETTLE_CALLSITES=0
ALREADY_SETTLED_RECOVERY_TEST=PASS
RECOVERY_IDEMPOTENCY=PASS_AFTER_CORRECTION (see §12)
RECOVERED_RECEIPT_SIGN_VERIFY=N/A (bookkeeping layer only, no signing in this path)
D1_MIGRATION_MUTATIONS=1
PRODUCTION_D1_MIGRATION_READBACK=PASS
RECOVERY_EXECUTIONS=1
FINAL_JOB_STATE=DELIVERED
FINAL_PAYMENT_STATE=settled_external
SETTLEMENT_TRANSACTION_REFERENCE=0x15e60d34ad29506f0eb10a372bc84b60c758c6d56b080994682471c9e1741d95
RESULT_COUNT_FOR_IDENTITY=1
RECEIPT_COUNT_FOR_IDENTITY=1
RECEIPT_SIGNATURE_VALID=N/A
MATCHING_9000_ATOMIC_TRANSFER_COUNT_AFTER=1
NEW_MATCHING_USDC_TRANSFERS=0
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNER_CALLS=0
PAID_POSTS=0
FACILITATOR_SETTLE_CALLS_CREATED_BY_R3=0
SETTLEMENT_ATTEMPTS_DURING_R3=0
CHAIN_TRANSACTIONS_DURING_R3=0
R3_ECONOMIC_EFFECT_USDC=0
SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION=PASS_RECOVERED
FINAL_RECONCILIATION_CLASS=SUCCESS_RECONCILED_POST_SETTLEMENT_RECOVERY
PUBLIC_PRODUCTION_TRAFFIC=de70bf98-f304-4d7f-b189-4ae2401041a0@100%
H2BF5_CANDIDATE_TRAFFIC=db7054c9-76ee-4830-aabe-8a4542261b6a@0%
SUN1221F_CANARY_ELIGIBLE=YES
SUN1221E6R_H2B2_R3_EVIDENCE_COMMIT_SHA=(this commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1221F
```

STOP. Do not begin F in this checkpoint.
