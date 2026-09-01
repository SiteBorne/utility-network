# SUN-1221E6R-H2B2-R4 — Receipt Durability and Cryptographic Verification

**Lineage:** H2AWI-2 (`55e8bdd` era) → H2B2-R3 (`099b6b9`) → H2B2-R3A (`c1c386f`) → this checkpoint.

## Result

**SUN1221E6R_H2B2_R4_RECEIPT_DURABILITY = PASS**

## §3 — Signing object model (load-bearing, resolved from source)

**SIGNING_OBJECT_MODEL = A** — the PCC *is* the paid receipt. One signed
object, not two.

Proof, from source (not inferred):

- `production-dependencies.ts`'s own doc comment on `validateExecutorPcc`:
  *"The signed PCC artifact itself (`verify-and-sign.ts`) is already
  produced INSIDE the executor... by the time `ExecutorOutcome` reaches
  this Workflow, `result.receipt` IS the final signed PCC."*
- `validateExecutorPcc` returns `{ valid: true, pcc: outcome.result.receipt }`
  — `outcome.result.receipt` is a `VerificationReceipt`
  (`packages/verification/src/receipt/models.ts`), the exact shape
  observed in the real Workflow instance's `generate-pcc-1` step output.
- `PCC_SIGNING_FUNCTION` = `issueReceipt` (`packages/verification/src/
  receipt/issue.ts`), called inside the executor via `verifyAndSign`
  (`packages/service-runtime/src/pcc/verify-and-sign.ts`).
- `PCC_SIGNING_KEY_SOURCE` = `env.PAID_RECEIPT_SIGNING_PRIVATE_KEY` /
  `env.PAID_RECEIPT_SIGNING_KEY_ID`, threaded into `buildProductionSigner()`
  by `buildWebContextV2CdpProductionRouteConfig` — the exact two secrets
  generated and provisioned to the host during H2BF5-S2/FINAL.
- `PAID_RECEIPT_SIGNING_FUNCTION` / `PAID_RECEIPT_SIGNING_KEY_SOURCE` are
  identical to the above — there is no separate receipt-signing step.
- **PCC_AND_RECEIPT_SAME_OBJECT = YES.**

Independent internal-consistency proof: the real H2B2-R2 Workflow's
observed `signing_key_id` (`kid_0ea0e04e294f20fc78b2b155`) exactly
matches the `PAID_RECEIPT_SIGNING_KEY_ID` value still present in the
locally-staged H2BF5-S2 secrets file — the two were never expected to
collide by construction (SHA-256-derived, 96 bits of entropy) and do.

## §4 — Canonical receipt contract (frozen, not invented)

- `CANONICAL_RECEIPT_REQUIRED_FIELDS` = `ReceiptPreimage` (19 fields) +
  `receipt_id` + `signature` (`VerificationReceipt`).
- `CANONICAL_RECEIPT_SIGNATURE_FIELD` = `signature` (base64url Ed25519).
- `CANONICAL_RECEIPT_KEY_ID_FIELD` = `signing_key_id`.
- `CANONICAL_RECEIPT_SIGNED_PAYLOAD` = `canonicalize(preimage)` (RFC 8785
  JCS), everything except `signature` and `receipt_id`.
- `CANONICAL_RECEIPT_VERIFY_FUNCTION` = `verifyReceipt`
  (`packages/verification/src/receipt/verifier.ts`) — used verbatim,
  never reimplemented.

## §5 — Persistence-path trace and loss point

| Stage | Object created | Signature created | Durably persisted | Table/field | Retrievable after Workflow |
|---|---|---|---|---|---|
| executor / `issueReceipt` | YES | YES | NO | — | NO |
| `generate-pcc` step (`validateExecutorPcc`) | (passthrough) | (passthrough) | NO (Workflow-internal memo only) | — | NO (API truncates before `signature`) |
| `persist-receipt-and-finalize` step, pre-fix | — | — | NO | `x402_service_results.result_json` — but only `{kind, receipt_persisted, receipt_id}` | N/A (nothing to retrieve) |

**RECEIPT_DURABILITY_LOSS_POINT** = `D1ResultReceiptPersistence.
persistReceipt` (`production-dependencies.ts`, pre-fix): it received no
`pcc` argument at all and wrote only a boolean completion marker.

## §6 — R3A observability gap, reconfirmed

- `WORKFLOW_SIGNATURE_TRUNCATED` = YES — confirmed again this checkpoint:
  `wrangler workflows instances describe --truncate-output-limit 20000`
  still truncates at the identical byte offset as the untuned default,
  proving the truncation is server-side (Cloudflare's API), not a CLI
  display artifact.
- `D1_FULL_SIGNED_RECEIPT_PRESENT` (pre-fix) = NO.
- `JOB_ARTIFACT_RECEIPT_PRESENT` = NO (`job_artifacts` table: 0 rows for
  this job).
- `RECEIPT_RETRIEVAL_PATH_PRESENT` = NO (no GET/receipt route exists in
  this codebase).
- **RECEIPT_VERIFICATION_GAP_PROVEN = YES.**

## §7 — Original-signature recoverability

**ORIGINAL_PRODUCTION_RECEIPT_RECOVERABLE = NO.**

The full `ReceiptPreimage` requires `issued_at` (the exact signing-time
timestamp, part of the signed material) plus the original `signature`
and `receipt_id` — none of which survive anywhere durable (D1 held only
the boolean marker; the Workflow API truncates the step output before
reaching `canonicalization_algorithm`/`signature_algorithm`/`issued_at`/
`signature`). Exhausted every approved read-only source (Workflow API at
raised truncation limit, D1, `job_artifacts`, receipt-retrieval routes)
before concluding this — did not fabricate a positive result. This
routes to the §15 re-signing recovery path, which the authorization
explicitly anticipates for exactly this case.

## §8–9 — Durable-persistence fix design

- `DURABLE_RECEIPT_STORAGE_TARGET` = `x402_service_results.result_json`
  — the existing, already-generic JSON blob column `X402ServiceResultRepository.
  create()`/`finalize()` already write to.
- **`DURABLE_RECEIPT_SCHEMA_CHANGE_REQUIRED` = NO.** `result_json` is
  `TEXT`, populated via `JSON.stringify(result)` with no fixed shape
  enforced at the SQL layer — the full signed document fits without any
  migration.
- `HOST_CODE_CHANGE_REQUIRED` = YES.
- `API_CODE_CHANGE_REQUIRED` = NO (the public API Worker never touches
  this Workflow-only persistence path).
- **`D1_MIGRATION_REQUIRED` = NO.**

## §10–14 — TDD

New suite: `apps/edge-api/src/control-plane/workflows/
durable-receipt-persistence.test.ts`, driving the real (now exported)
`D1ResultReceiptPersistence` class against a minimal in-memory D1 fake —
mocks nothing else.

- **RED** (genuine, not narrated): stashed the fix, re-ran — all 5 tests
  failed with `D1ResultReceiptPersistence is not a constructor` (the
  class was private pre-fix; the behavioral assertions on `pcc` would
  have failed too, but the export itself was the first failure).
  `DURABLE_RECEIPT_RED = YES`. `WORKFLOW_OUTPUT_INDEPENDENCE_RED = YES`
  (same file covers both: persistence and output-independent retrieval
  both fail identically pre-fix).
- Restored the fix (`git stash pop`) — **GREEN**, 5/5.
  `DURABLE_RECEIPT_GREEN = PASS`.
  `WORKFLOW_OUTPUT_INDEPENDENCE_GREEN = PASS` (retrieval proven via
  `X402ServiceResultRepository.getByJobId` alone — no Workflow object
  referenced anywhere in the test).
- **Idempotency**: calling `persistReceipt` twice for the same identity
  with two *different* `pcc` payloads — second call returns
  `already_written`, the stored document is unchanged (still the first
  `pcc`, not silently overwritten by the second). `DURABLE_RECEIPT_
  IDEMPOTENCY = PASS`.
- **Mutation-proof**: a dedicated test asserting `parsed.pcc` is
  non-null with the exact original signature — regressing to
  marker-only persistence fails this immediately.

## Fix (minimal, as designed)

`PersistReceiptInput` gained one optional field, `pcc?: unknown`. The one
real call site (`paid-continuation-workflow.ts`'s `persist-receipt-and-
finalize` step) now passes `pccResult.pcc` (already in scope, already
computed — no new computation). `D1ResultReceiptPersistence.
persistReceipt` now stores `{ kind, receipt_persisted, receipt_id, pcc }`
instead of `{ kind, receipt_persisted, receipt_id }`. Nothing else
changed: no signing algorithm, no keypair, no key ID, no PCC semantics,
no payment economics, no settlement semantics, no Workflow step
ordering, no executor, no Modal, no x402.

Implementation commit: **`0b88a6c`**.

## §17 — Full regression

- TESTS: 2592/2592 pass (+5 net-new), 74 skipped (unchanged baseline).
- WORKER_RUNTIME: 99/99 scenarios pass.
- LINT: clean.
- TYPECHECK: 3 pre-existing baseline errors (unrelated file — Mock-type
  assignability in `paid-continuation-workflow-entrypoint.test.ts`), 0
  new.
- PRODUCTION_PREFLIGHT: PASS.
- Secret scan: 5 pre-existing findings, all in unrelated historical
  report files (none in anything this checkpoint touched) — 0 new.
- Single-settlement-owner audit: unchanged, exactly one production
  `.settle()` call site (`paid-continuation-workflow.ts:490`).

## §19 — Pre-mutation readback

- `de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%, `db7054c9-76ee-4830-
  aabe-8a4542261b6a` @ 0%, no third version.
- Chain (direct Base RPC `eth_call`, not a third-party indexer): buyer
  `0x4afd` = 19197 atomic, seller `0x6d60` = 28000 atomic — unchanged
  from R3A.
- One payment/job/result/receipt marker for the identity, as R3A left
  it.

## §21–22 — Host deployment

`HOST_DEPLOYMENTS = 1`. `wrangler deploy --config wrangler.paid-
continuation-runtime.toml` — ordinary deploy, not `triggers deploy` (the
H2BF3-established requirement for real DAG compilation). New version:
`1641fac4-0cf6-4bf0-b182-33b3d1c608ec`.

Readback: all 8 secrets present and unchanged (`wrangler secret list`);
all 4 ADR-0055 vars present and unchanged (`PAYMENT_ENVIRONMENT=
production`, `PRODUCTION_ENABLED=true`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED=true`); `env.PAID_CONTINUATION_
WORKFLOW → PaidContinuationWorkflow` binding intact. No API candidate
uploaded, no traffic changed. `R4_HOST_DEPLOY_READBACK = PASS`.

## §23 — Pre-recovery chain reconfirmation

Re-read via direct Base RPC immediately before the D1 write: buyer =
19197, seller = 28000, `MATCHING_9000_ATOMIC_TRANSFER_COUNT = 1` (the
original `0x15e60d3...` transaction, previously established) — unchanged.

## §15–16, §24 — D1-only receipt recovery

**R4_RECEIPT_RECOVERY_PATH**: construct a `ReceiptPreimage` using the
exact real field values observed in the real Workflow instance's
`generate-pcc-1` step output (`job_id`, `request_id`, `service_id`,
`input_hash`, `output_hash`, `evidence_hash`, `policy_hash`,
`verifier_set_hash`, `decision=pass`, `completeness=1`, `limitations`,
`signing_key_id`) — nothing invented except `issued_at` (the one field
that cannot be original, since the original was never durably captured;
this is the re-signing recovery path §15 explicitly authorizes, not
exact-original-byte recovery, which §7 already ruled out). Sign with the
real, recovered `PAID_RECEIPT_SIGNING_PRIVATE_KEY` via the real,
unmodified `buildProductionSigner`/`signBytes`/`computeReceiptId`. Self-
verify with the real, unmodified `verifyReceipt` before ever touching
D1.

`R4_RECOVERY_SETTLE_CALLSITES = 0`, `R4_RECOVERY_EXECUTOR_CAPABILITY =
0`, `R4_RECOVERY_CHAIN_WRITE_CAPABILITY = 0` — the recovery scripts
import only `@siteborne/verification` and `@siteborne/service-runtime`'s
signer; no facilitator, executor, x402, or chain client is imported
anywhere in the recovery path.

**Local test (§16)**: ran the full construct→sign→self-verify sequence
locally first — `RECEIPT_SIGNATURE_VALID = true`
(`receipt_id = rcpt_b648190b5c6e1b2dd058e9bd`), deterministic
`computeReceiptId` re-checked equal on a second call in the same
process (construction-level idempotency proven locally, before any
production write — matching the authorization's "no second execution
in production" constraint).

**Production write (§24)**: exactly one signing event, one D1 `UPDATE`.
`RECEIPT_RECOVERY_WRITES = 1` (`rows_written: 1`, `changes: 2` — both
`result_json` and `created_at`). Resulting `pcc.receipt_id =
rcpt_d706df07ba12d71c31882051`.

## §25–26 — Final durable readback + cryptographic verification

Read back **directly from D1** (`SELECT result_json FROM
x402_service_results WHERE job_id = ...`) — zero dependence on Workflow
step output. `DURABLE_RECEIPT_READBACK = PASS`,
`RECEIPT_COUNT_FOR_IDENTITY = 1`.

Ran the round-tripped (JSON-stringified into D1, JSON-parsed back out),
persisted document through the real `verifyReceipt` a second, independent
time:

```
RECEIPT_SIGNATURE_VALID = YES
RECEIPT_KEY_ID = kid_0ea0e04e294f20fc78b2b155
RECEIPT_KEY_ID_VALID = YES
RECEIPT_AMOUNT_ATOMIC = 9000 (payment_attempts row, unchanged since R3A)
RECEIPT_NETWORK = eip155:8453
RECEIPT_ASSET = 0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913
RECEIPT_PAY_TO = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
RECEIPT_SETTLEMENT_TX = 0x15e60d34ad29506f0eb10a372bc84b60c758c6d56b080994682471c9e1741d95
RECEIPT_PCC_CORRELATION_VALID = YES (job_id/request_id/output_hash exact match to the real generate-pcc-1 step output)
RECEIPT_RESULT_CORRELATION_VALID = YES (same D1 row, same job_id FK)
```

## §27 — Final chain proof

Direct Base RPC, post-recovery: buyer = 19197 (`0x4afd`), seller = 28000
(`0x6d60`) — byte-identical to §19/§23. `MATCHING_9000_ATOMIC_
TRANSFER_COUNT_AFTER = 1`, `NEW_MATCHING_TRANSFERS = 0`,
`CHAIN_TRANSACTIONS_CREATED_BY_R4 = 0`, `R4_ECONOMIC_EFFECT_USDC = 0`.

## §28 — Traffic containment

`de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%, `db7054c9-76ee-4830-
aabe-8a4542261b6a` @ 0%, no third version — the public API Worker was
never touched this checkpoint (only the separate dedicated host script
was deployed). `API_DEPLOYMENT_MUTATIONS = 0`.

## §29–30 — Final qualification

All conditions hold: technical payment qualification remains PASS (R3A);
one settlement only; one chain transfer only; final result valid;
canonical receipt now durably available (D1, independent of Workflow
step output); receipt signature cryptographically verifies (real
verifier, real key, twice — once locally, once against the actual
persisted/round-tripped row); receipt economics exact; receipt
settlement tx exact; PCC/result linkage valid; zero new economic effect;
R3 governance deviation remains documented and is **not** rewritten as
compliant (`R3_GOVERNANCE_CLASSIFICATION =
NONCOMPLIANT_NON_ECONOMIC_EXTRA_MUTATIONS`, preserved permanently per
instruction).

**SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION = PASS_RECOVERED_VERIFIED**
**SUN1221F_CANARY_ELIGIBLE = YES_WITH_DOCUMENTED_R3_GOVERNANCE_DEVIATION**

## Final stop packet

```
SUN1221E6R_H2B2_R4_RECEIPT_DURABILITY=PASS
H2B2_R4_AUTHORIZATION=PRESENT
SIGNING_OBJECT_MODEL=A (PCC is the receipt)
PCC_AND_RECEIPT_SAME_OBJECT=YES
RECEIPT_VERIFICATION_GAP_PROVEN=YES
ORIGINAL_PRODUCTION_RECEIPT_RECOVERABLE=NO
DURABLE_RECEIPT_STORAGE_TARGET=x402_service_results.result_json (existing column)
DURABLE_RECEIPT_SCHEMA_CHANGE_REQUIRED=NO
D1_MIGRATION_REQUIRED=NO
HOST_CODE_CHANGE_REQUIRED=YES
API_CODE_CHANGE_REQUIRED=NO
DURABLE_RECEIPT_RED=YES
WORKFLOW_OUTPUT_INDEPENDENCE_RED=YES
DURABLE_RECEIPT_GREEN=PASS
WORKFLOW_OUTPUT_INDEPENDENCE_GREEN=PASS
DURABLE_RECEIPT_IDEMPOTENCY=PASS
R4_RECOVERY_SETTLE_CALLSITES=0
R4_RECOVERY_EXECUTOR_CAPABILITY=0
R4_RECOVERY_CHAIN_WRITE_CAPABILITY=0
TESTS=PASS (2592/2592, +5 net-new)
WORKER_RUNTIME=PASS (99/99)
LINT=PASS
TYPECHECK=3 pre-existing baseline errors, 0 new
PRODUCTION_PREFLIGHT=PASS
NEW_SECRET_FINDINGS=0
H2B2_R4_FIX_COMMIT_SHA=0b88a6c
D1_MIGRATIONS=0
HOST_DEPLOYMENTS=1
R4_HOST_DEPLOY_READBACK=PASS
RECEIPT_RECOVERY_WRITES=1
DURABLE_RECEIPT_READBACK=PASS
RECEIPT_COUNT_FOR_IDENTITY=1
RECEIPT_SIGNATURE_VALID=YES
RECEIPT_KEY_ID_VALID=YES
RECEIPT_SETTLEMENT_TX_MATCH=YES
RECEIPT_PCC_CORRELATION_VALID=YES
RECEIPT_RESULT_CORRELATION_VALID=YES
MATCHING_9000_ATOMIC_TRANSFER_COUNT_AFTER=1
NEW_MATCHING_TRANSFERS=0
CHAIN_TRANSACTIONS_CREATED_BY_R4=0
R4_ECONOMIC_EFFECT_USDC=0
PUBLIC_PRODUCTION_TRAFFIC=de70bf98-f304-4d7f-b189-4ae2401041a0 @100%
H2BF5_CANDIDATE_TRAFFIC=db7054c9-76ee-4830-aabe-8a4542261b6a @0%
R3_GOVERNANCE_CLASSIFICATION=NONCOMPLIANT_NON_ECONOMIC_EXTRA_MUTATIONS (preserved, not rewritten)
SUN1221E6R_H2B2_REAL_PAYMENT_QUALIFICATION=PASS_RECOVERED_VERIFIED
SUN1221F_CANARY_ELIGIBLE=YES_WITH_DOCUMENTED_R3_GOVERNANCE_DEVIATION
SUN1221E6R_H2B2_R4_EVIDENCE_COMMIT_SHA=(this commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1221F
```

STOP. No F executed. No G executed. No new Workflow instance. No
executor call. No settlement retry. No payment retry.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
