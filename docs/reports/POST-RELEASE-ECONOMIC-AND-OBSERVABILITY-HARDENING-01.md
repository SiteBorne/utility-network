# POST-RELEASE-ECONOMIC-AND-OBSERVABILITY-HARDENING-01

Read-first audit of economic persistence, observability, reconciliation semantics and
operational evidence after Release 1 went live. **No source, config, schema, or cloud
state was changed.** The only file written is this report.

## 0. Method and evidence limits

- Evidence is **source reading at HEAD `ab95c45`** plus read-only Cloudflare queries
  (`wrangler deployments status`, a 30 s `wrangler tail`).
- **No production D1 rows were queried.** Every "observed" bookkeeping behaviour in the
  mission brief (null `service_receipt_id`, `count=0`, no reconciliation row, null
  `job_id`) is **explained by source**, not re-observed in D1. Each explanation below is
  a code-path proof, and each fix proposal should first be confirmed against a
  read-only D1 sample in its own checkpoint.
- The Security Constitution text is **not in this repository** (only a one-line
  reference in `packages/vcm/src/security/declaration.ts:5`). The SA-0 baseline in §10
  is built from the nine dimensions listed in the mission, not from the Constitution's
  own template.

## 1. Production baseline

| Item | Value | Source |
|---|---|---|
| Repo HEAD | `ab95c45d172afb7150d04efbd037eb0577c594b1` (branch `metadata-vcm-qualification`) | `git rev-parse` |
| Working tree | clean at start | `git status --short` |
| Release closure commit | `ab95c45` (FINAL-PAID-PRODUCTION-ACTIVATION-01) | `git log` |
| Release artifact source SHA | `182bfb5f4473c904ddaefb113f69a15979f68144` | version message |
| Public Worker | `3b35f9e7-6fb8-47e4-acff-c5736eff6da6` @ **100%** (deployed 2026-09-21T01:44:13Z) | `wrangler deployments status` |
| Rollback | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` @ 0% | same |
| Continuation host | `9b1e9b10-beed-4ff3-914c-2221aada9b45` @ 100% (unchanged) | `wrangler deployments status -c wrangler.paid-continuation-runtime.toml` |

`PRODUCTION_PAID_RELEASE=ACTIVE` (public version carries `PAID_ROUTES_ENABLED=true`
and holds 100% traffic).

## 2. Known bookkeeping debt

### A. `payment_attempts.service_receipt_id` → `REDUNDANT_FIELD`
- Added by migration 0006 for Nevermined crash-recovery correlation; reused "as-is"
  for CDP by 0007.
- Only writer: `recordSettlementPending(..., { serviceReceiptId })`
  (`repositories/d1/payment-attempts.ts:394`). The sole live caller,
  `paid-continuation-workflow.ts:771`, passes **only** `serviceOutputHash`. The old
  in-request pipeline that passed a receipt id was removed in H2AWI-3. So the column is
  **never written on the Workflow path** and is null by construction.
- Only reader: `getSettlementRecoveryRecord` (:530). No consumer uses the value.
- Canonical receipt linkage: `payment_service_link_evidence.buyer_receipt_id` /
  `verification_receipt_id` / `buyer_receipt_hash` (written by `persistLinkEvidence`),
  the deterministic `receiptPersistenceIdempotencyKey(payment_identifier)`, and the
  signed PCC in `x402_service_results.result_json`.
- Null is semantically harmless. Future writes should **not** populate it (a second
  copy adds drift risk). Historical rows untouched. Deprecate in docs.

### B. `cdp_facilitator_settle_attempt_count` → `SETTLE_ATTEMPT_COUNTER_FIX_REQUIRED=YES` (low urgency, write-semantics only)
- Migration 0007 documents it as "counts every real `.settle()` call regardless of
  outcome".
- Actual increments: only `recordCdpSettlementOutcome` (failure transitions) and
  `incrementCdpSettleAttemptCount` (legacy bounded retry). **That second method has no
  non-test caller since `attemptCdpRecovery` was removed** (dead code).
- Workflow success path: `recordSettlementPending` → `settle()` →
  `recordSettledExternal` → `incrementCdpSuccessfulSettlementCount`. The attempt counter
  is never touched. First-try success therefore yields `attempts=0, successes=1`,
  violating the documented `successes <= attempts` intent. A `settle()` that throws and
  resolves via reconciliation also leaves `attempts=0`.
- Not an authorization gate (no gate reads it). Its only production reader is the
  settlement alert sweep (`alerting/settlement-alert-sweep.ts:140`), which emits it as
  `reconciliation_attempts` for `settlement_pending` incidents, i.e. **under-reports
  for exactly the rows it alerts on**.
- Safest fix (future, separate checkpoint): define the counter as "`settle()` claims"
  and increment once inside the `recordSettlementPending` CAS (the write that
  immediately precedes `settle()`), then remove the increment from the
  `settlement_pending → settlement_failed` call to avoid double counting. Historical
  rows are not backfilled; they remain "legacy semantics".

### C. Successful reconciliation rows → `SUCCESS_RECONCILIATION_ROW_EXPECTED=NO`
- `payment_attempt_reconciliations` is an append-only **exception/classification
  ledger** (migration 0010). Its classifications are legacy-cutover states plus
  `current_execution_failed_unsettled` and
  `current_settlement_finalization_unresolved`.
- Only two writers exist in `src`: `recordProviderFailure` and
  `recordSettlementFinalizationUnresolved`. It feeds the ownership-aware drain gate.
  A clean settlement is proven by `payment_attempts.lifecycle_stage='settled'` +
  `consumed_at` + `payment_service_link_evidence`, not by a reconciliation row.

### D. `payment_attempts.service_output_hash` → `MISLEADING_NAME_LEGACY_SEMANTIC_DRIFT` (no authority consumer)
- Workflow writes `decrypted.verificationEvidence.raw_evidence_hash`
  (`paid-continuation-workflow.ts:772`), i.e. the facilitator **verify-response**
  hash, into a column named for service output.
- The canonical service output hash is `payment_service_link_evidence.service_output_hash`
  (= `executor output_hash`, or hash of the output) and is covered by
  `link_hash` inside the `PaymentServiceLink`.
- Readers: only `getSettlementRecoveryRecord`; **no authority, economic or security
  consumer** found (grep of non-test `apps/` + `packages/`).
- Strategy: keep the column, do not rewrite history, document as "pre-settlement
  facilitator verification correlation (legacy name)". If a consumer ever needs it,
  add a correctly named additive column (e.g. `verification_raw_evidence_hash`)
  rather than semantic reuse.

### E. `settlement_evidence.settled_at` → `SETTLED_AT_FUTURE_FIX` (correction to the brief)
- Origin: providers set `settled_at: context.nowIso` (`evidence/cdp-provider.ts:292,358`).
  `nowIso` is fixed at **request time** and sealed in the continuation envelope, so
  it is attempt-creation time, not settlement time. Confirmed.
- **Correction:** on the live CDP/Workflow path `settled_at` does **not** feed
  `settlement_evidence_hash`. The direct-success hash is `raw_evidence_hash`, computed
  over `{kind, quote_id, requirement_id, payment_identifier, success, transaction,
  network, amount, payer, errorReason}` (`cdp-provider.ts:322`), which excludes
  `settled_at`. The reconciled-path hash is over
  `{kind, payment_identifier, transaction_reference, checked_at_unix}`
  (`paid-continuation-workflow.ts:679`). I did **not** verify the Nevermined
  `evidence_hash` (`protocol-nevermined/src/evidence.ts:80,112`, which hashes a whole
  object); that rail is not on the Release-1 Workflow path (`payment_rail: 'cdp'` is
  hard-coded there).
- Real settlement-side timestamps already exist: `payment_service_link_evidence.settled_at`
  (set by `finalizeSettled`, `COALESCE` write-once) and
  `payment_attempts.settlement_pending_at`.
- Future-write-only fix: stamp `settled_at` from the Workflow clock at the moment the
  settle response is received (`deps.clock()`), and add a prerequisite unit test that
  pins "`settled_at` is excluded from `raw_evidence_hash`". The value lives only in
  the internal `durableEvidence` blob and is not in the public body (the wire body is
  the PCC).
- `HISTORICAL_SETTLEMENT_EVIDENCE_MUTATION=NO`.

### F. `payment_attempts.job_id` → `OBSERVABILITY_GAP`; **do not populate**
- `job_id` is set only by the initial `acquire` INSERT from the request binding, which
  is built **before** the job exists (`x402-service.ts:782` vs job creation at :1109).
  Nothing updates it later. Null is by construction.
- **Hazard:** `job_id` is part of the immutable binding digest (`replay/binding.ts`
  `digestPayload`), and `mapRow` (`payment-attempts.ts:63`) reconstructs
  `existing.binding` from the row including a non-null `job_id`. A later-populated
  `job_id` would make `bindingsAreIdentical(existing, fresh)` false, turning a
  legitimate replay into `duplicate_conflict` / `replay_conflict` 409. **Populating this
  column would break replay idempotency.** Historical and prospective rows must both
  stay null.
- Canonical job linkage already exists: `jobs.idempotency_key = payment_identifier`
  (unique index `idx_jobs_idempotency_key`), `payment_service_link_evidence.job_id`
  (NOT NULL, post-settlement), `x402_service_results.job_id`, and the Workflow input
  metadata.
- **Concrete consequence:** `listUnresolvedSettlements` reads `job_id` from
  `payment_attempts` (`:604`), so `manual_intervention_required` alert payloads carry
  `job_id: null` for every Workflow-era row. Fixable read-side with a `LEFT JOIN jobs`
  on `idempotency_key`, no schema or write change.

## 3. Field-authority matrix

Legend: Src = source of truth; W = written by; R = read by; Sec/Eco = security/economic
sensitive; H = hashed; Fwd = safe to change prospectively; Bf = safe to backfill.

| Field | Class | Src | W | R | Sec | Eco | H | Fwd | Bf |
|---|---|---|---|---|---|---|---|---|---|
| `payment_attempts.lifecycle_stage` | canonical authority (payment) | itself | route + Workflow CAS | replay, Workflow, drain gate | Y | Y | N | No (state machine) | No |
| `payment_attempts.consumed_at` | canonical authority (idempotency) | itself | `markConsumed` post-settle | `acquirePaymentAttempt` | Y | Y | N | No | No |
| `payment_attempts.binding_digest` + binding cols (incl. `job_id`) | canonical authority (identity) | itself | `acquire` | replay classification | Y | Y | Y | **No** | **No** |
| `payment_attempts.service_receipt_id` | redundant | link evidence | nobody live | recovery getter | N | N | N | Yes (leave) | Not needed |
| `payment_attempts.service_output_hash` | deprecated/legacy name (verify hash) | link evidence | `recordSettlementPending` | recovery getter | N | N | N | Additive col only | **No** |
| `payment_attempts.job_id` | redundant / binding-participant | `jobs.idempotency_key` | acquire only | alert sweep | N | N | Y (binding) | **No** | **No** |
| `cdp_facilitator_settle_attempt_count` | operator convenience (accounting) | itself | failure paths only | alert sweep | N | N | N | Yes | No |
| `cdp_successful_economic_settlement_count` | derived cache / accounting | chain + link evidence | Workflow | none | N | Y | N | Yes | No |
| `settlement_transaction_reference` | audit evidence | facilitator/chain | `recordSettledExternal` | link, alert | N | Y | Y (in link) | No | No |
| `payment_service_link_evidence.*` | hashed evidence / canonical linkage | itself | `persistLinkEvidence` | audit | Y | Y | Y | No | No |
| `payment_service_link_evidence.settled_at` | audit evidence (real finalize time) | itself | `finalizeSettled` | audit | N | N | N | Yes | No |
| `settlement_evidence.settled_at` (in `result_json`) | audit evidence, request-time | provider | provider | none | N | N | N on CDP path | Yes | **No** |
| `settlement_evidence_hash` | hashed evidence | `raw_evidence_hash` | Workflow | link | Y | Y | Y | No | No |
| `payment_attempt_reconciliations.*` | audit evidence (exception ledger) | itself | Workflow/operator | drain gate | Y | Y | N | Additive | No |
| `payment_workflow_owner_intents.*` | canonical authority (Workflow ownership) | itself | route + cron | recovery | Y | Y | N | No | No |
| `x402_service_results.result_json` | canonical result + signed PCC | itself | Workflow steps | replay reconstruct | Y | Y | Y (PCC sig) | No | No |
| `jobs.*` / `job_state_events` | canonical authority (job state) | itself | route + Workflow | replay, audit | Y | N | N | No | No |

## 4. Successful lifecycle trace (production architecture)

| Stage | Durable rows | Canonical ID | Write boundary | Notes |
|---|---|---|---|---|
| Quote | `x402_quotes` | `quote_id` | 402 route (no signature) | not single-use; `idx_payment_attempts_quote` is non-unique |
| Requirement | quote row | `requirement_id` | same | frozen at 402 |
| Payload receipt + acquire | `payment_attempts` (`acquired`) | `payment_identifier` (buyer-chosen, UNIQUE index) | route, atomic INSERT | single economic identity |
| Verification | evidence in memory | facilitator verify | route calls `evidenceProvider.verify` | failure → `verification_failed`, 402 |
| Job + state | `jobs`, `job_state_events` | `job_id`, `idempotency_key = payment_identifier` | route | before verify |
| Authorization/hand-off | `payment_workflow_owner_intents`; `payment_attempts` `verified` | deterministic `workflow_instance_id` | `commitVerifiedWithIntent` | payload sealed in encrypted envelope |
| Execution | Workflow step `invoke-executor` | job_id | Workflow | thrown → `executor_timeout`; non-success → `executor_rejected` |
| Assurance / PCC | PCC produced inside executor, validated in `generate-pcc` | receipt id | Workflow | invalid → `pcc_failed` |
| Settlement | `payment_attempts` `executed → settlement_pending → settled_external`, `settlement_transaction_reference`, `consumed_at` | tx reference | Workflow, `retries.limit=0`, CAS before `settle()` | never re-settles; ambiguity → reconciliation only |
| Link/receipt | `payment_service_link_evidence` | `link_id`, `buyer_receipt_id` | `persist-receipt-and-finalize` | `ON CONFLICT DO NOTHING` + hash equality check |
| Result | `x402_service_results` | `job_id` | `persist-result`, read-before-write | wire body is the PCC |
| Finalize | `link_verified → settled`, job → `DELIVERED`, intent `completed` | | `finalizeSettled` | |
| Reconciliation | none on success | | | by design |

Authority significance: `consumed_at` is written only after `canAdvanceToSettled` passes
(or read-only reconciliation confirms). Execution authority begins only at
`commitVerifiedWithIntent`; result authority only after the persisted signed PCC.

## 5. Failure and ambiguity paths

| Path | Effect | Authority granted? |
|---|---|---|
| Verification failure | job `REJECTED`; stage `verification_failed`; 402; no intent, no Workflow | None |
| Envelope-open failure | job `REJECTED`; `workflow_internal_error`; no reconciliation row | None |
| Authorization expired (entry or pre-claim) | job `REJECTED`; nothing settled | None |
| Execution failure (thrown / non-success) | job `QUARANTINED → REJECTED`; `recordProviderFailure` appends a non-actionable row and completes the intent; settle never reached | None |
| Assurance (PCC) failure | job `REJECTED`; **no reconciliation row and owner intent not completed** (see P1-6) | None |
| Settlement explicit rejection | `settlement_failed` (terminal), job `REFUND_REQUIRED`, no consume/result | None |
| Settlement ambiguous | stays `settlement_pending`/`SETTLING`; only read-only reconciliation; `settle()` unreachable again (guard at `runSettlementStep`) | None |
| `settle()` throws | routed to reconciliation, never retried | None |
| Continuation-runtime deps unavailable | `run()` throws → platform status errored | None |
| Post-settle persistence failure | left `SETTLING` deliberately so retry can reach `DELIVERED` | Settlement already real; result withheld until persist |

No failure path sets `consumed_at`, persists a result, writes a signed receipt, or advances
to `settled` without passing the settlement gate. **`FAILURE_PATH_AUTHORITY_AUDIT=PASS`.**

## 6. Observability matrix

| Question | Class | Basis |
|---|---|---|
| Which public Worker version served a request? | PARTIALLY_OBSERVABLE | platform log/tail per-invocation `scriptVersion`; **not persisted** in D1, audit, or PCC |
| Which continuation host version completed it? | PARTIALLY_OBSERVABLE | platform Workflow instance metadata only; not persisted |
| Which quote authorized it? | DIRECTLY_OBSERVABLE | `payment_attempts.quote_id`, link JSON |
| Which payment attempt paid it? | DIRECTLY_OBSERVABLE | `payment_attempts.id` / `payment_identifier` |
| Which requirement governed it? | DIRECTLY_OBSERVABLE | `payment_attempts.requirement_id` |
| Which job executed it? | DERIVABLE | `jobs.idempotency_key = payment_identifier`; `payment_attempts.job_id` is null by design; direct in link evidence after settlement |
| Which workflow continued it? | DIRECTLY_OBSERVABLE | `payment_workflow_owner_intents.workflow_instance_id` (deterministic from payment id) |
| Which receipt resulted? | DIRECTLY_OBSERVABLE | `buyer_receipt_id`, `result_json.receipt_id` (not `service_receipt_id`) |
| Which transaction settled it? | DIRECTLY_OBSERVABLE | `settlement_transaction_reference` |
| Which PCC proves it? | DIRECTLY_OBSERVABLE | `result_json.pcc`, `buyer_receipt_hash`, `signing_key_id` |
| Which result belongs to which caller? | PARTIALLY_OBSERVABLE | payer captured in settlement evidence inside `result_json`; no first-class caller column; binding is by tuple knowledge (§8) |

`OBSERVABILITY_MATRIX=PASS` (audit complete). Two PARTIALLY_OBSERVABLE rows are
candidates for one additive telemetry checkpoint; no telemetry is created here.

## 7. MCP legacy-name observability

`LEGACY_NAME_TELEMETRY_RECOMMENDATION`: add one closed-vocabulary counter at MCP
dispatch, following the existing `metadata-projection-telemetry.ts` pattern
(structured `console.error` JSON, best-effort, never throws):

```
mcp_tool_call_total{ tool_bucket, outcome }
  tool_bucket ∈ { 6 canonical names | LEGACY_company_evidence_graph |
                  LEGACY_web_context_verified | LEGACY_document_evidence_json | UNKNOWN }
  outcome     ∈ { ok | tool_error | unknown_tool | invalid_params }
```

- Bucket by **exact match against the closed set**; never log the caller-supplied name,
  arguments, body, payment signature, headers, or `clientInfo` (attacker-controlled).
- The hook point is `routes/mcp.ts`, which already parses `method` from the body
  (:127); the SDK's own unknown-tool error stays unchanged.
- Classification: `E. INTERNAL_TELEMETRY_ADDITIVE`. **Not implemented.**
- Caveat: Workers Logs retention limits any historical answer; the counter only measures
  forward from deployment.

## 8. Result-binding / retrieval

`NEW_RESULT_RETRIEVAL_ROUTE_REQUIRED=NO`. The signed request is itself the retrieval
path: replay of the same `payment_identifier` with an identical binding goes through
`already_consumed` / `duplicate_same` → `reconstructFromJob`, returning the cached body
and `PAYMENT-RESPONSE` header. A conflicting binding gets 409 `replay_conflict`.

Finding (P1-5, needs security governance): on those replay branches the route
**returns before** `evidenceProvider.verify`. The binding digest covers
`payment_identifier, quote_id, requirement_id, service, request_input_hash, resource,
scheme, network, asset, amount, payee` but **not the payer**. Caller binding on replay is
therefore *knowledge of the full tuple, including the private request input and the
buyer-chosen identifier*, not a re-proven payer signature. Practical exposure is low
(high-entropy identifier plus identical private input required), and I did not test
this live, so treat it as a baseline fact for SA-0 rather than a confirmed defect.

## 9. Replay / idempotency model

| Scenario | Enforced by | Result |
|---|---|---|
| Same quote, different payment ids | none (quote not single-use) | separate attempts, separate payments |
| Same payment id, same binding | `UNIQUE(payment_identifier)` + `acquirePaymentAttempt` | `duplicate_same` → join Workflow / 202 |
| Same payment id, different binding | binding digest | 409 `replay_conflict` |
| Consumed id | `consumed_at` | `already_consumed` → reconstruct cached result |
| Same requirement reused | requirement bound in digest | per-identifier |
| Job continuation replay | deterministic instance id; step memoization; `owner_intents UNIQUE` | one instance |
| Settlement retry | `retries.limit=0`; `lifecycle_stage` CAS; pending → reconciliation only | single `settle()` |
| Duplicate provider completion | read-before-write + PK `job_id` on results | idempotent |
| Duplicate PCC generation | PCC made once in memoized executor step; link `ON CONFLICT DO NOTHING` + hash check | single |
| Same on-chain authorization under a new payment id | outside this codebase (facilitator/chain nonce) | **not verified here** |

`REPLAY_IDEMPOTENCY_MODEL=PASS`. No live replay payments were run.

## 10. Production telemetry review

- 30 s `wrangler tail siteborne-utility-edge` (post-release): **0 events** (no traffic).
  This is `PATH_NOT_EXERCISED`, not proof of health.
- From the activation checkpoint (own probes, 24/24 attributed to `3b35f9e7`, all 200,
  0 exceptions): `NO_ERRORS_OBSERVED` for MCP tools/list, A2A card, OpenAPI, catalog and
  unpaid 402 admission.
- `PATH_NOT_EXERCISED` on public traffic: paid execution, settlement, continuation
  completion, provider errors, reconciliation, alert sweep.
- No D1 or Workers-Logs historical query was run in this checkpoint.

## 11. SA-0 baseline (source-derived; `SECURITY_AUTHORITY_SA0_BASELINE_READY=YES`, with caveat in §0)

| Dimension | Current behaviour |
|---|---|
| Identity | buyer identified by `payment_identifier` + facilitator-verified payer; no session/account identity; result not bound to payer on replay |
| Authorization | 402 challenge + verified payment; `canAdvanceToVerified` gate; security declaration ceiling `CONFIGURED` |
| Economic authority | `payment_attempts.lifecycle_stage` + `consumed_at` + one `settle()` per identifier |
| Execution authority | `commitVerifiedWithIntent` then Workflow `invoke-executor`; no execution before verify |
| Commit authority | `canAdvanceToSettled` + `recordSettledExternal` CAS |
| Result binding | tuple-knowledge replay (see §8) |
| Settlement authority | Workflow only; `retries.limit=0`; reconciliation read-only |
| Runtime qualification | version-attributed via platform tail; not persisted |
| Evidence semantics | hashed link evidence + signed PCC; `service_output_hash` (attempts) and `settled_at` (evidence) semantics noted in §2 |

## 12. Remediation classification

| # | Issue | Class |
|---|---|---|
| 1 | Alert `job_id` always null | D-adjacent read-side (`C` future read semantics, no schema) |
| 2 | Settle-attempt counter under-count | C. FUTURE_WRITE_SEMANTICS_ONLY |
| 3 | Version / host not persisted | E. INTERNAL_TELEMETRY_ADDITIVE |
| 4 | Legacy/unknown MCP tool counters | E. INTERNAL_TELEMETRY_ADDITIVE |
| 5 | Replay caller binding is tuple-based | G. REQUIRES_SECURITY_GOVERNANCE |
| 6 | Non-settlement terminal branches write no reconciliation row | C. FUTURE_WRITE_SEMANTICS_ONLY (PLAUSIBLE, not tested) |
| 7 | `service_receipt_id` redundant | B. DOCS_ONLY |
| 8 | `service_output_hash` misleading name | B. DOCS_ONLY (D. later if needed) |
| 9 | `settled_at` is request-time | C. FUTURE_WRITE_SEMANTICS_ONLY |
| 10 | `payment_attempts.job_id` null by design; **must not be populated** | B. DOCS_ONLY |
| 11 | `incrementCdpSettleAttemptCount` dead code | B/C cleanup |
| 12 | Verification-failed identifier replay answers 202 `processing` until expiry | A/C (PLAUSIBLE from source, not tested) |
| 13 | Success has no reconciliation row | A. NO_CHANGE_NEEDED |

No item requires a public-contract change (F).

## 13. Prioritization

- **P0 = 0**. No path found that grants execution, commit, result or settlement
  authority incorrectly.
- **P1 = 6**: #1 alert job linkage, #2 counter, #3 version/host attribution, #4 legacy-name
  telemetry, #5 replay caller binding (governance), #6 missing reconciliation rows on
  PCC/expiry/envelope failures.
- **P2 = 6**: #7, #8, #9, #10, #11 (docs + cleanup), #12. (#13 is not a finding.)

## 14. Implementation decision

No source change is made here. The single lowest-risk, bounded, backwards-compatible next
step is a **read-side-only** fix to `listUnresolvedSettlements` (LEFT JOIN `jobs` on
`idempotency_key`). It needs no migration, does not touch settlement write paths, does
not touch the public contract, and would need a separately authorised deploy of the
settlement-alert Worker.

## 15. Cloud mutation accounting

`WORKER_UPLOADS=0`, `WORKER_DEPLOYMENT_MUTATIONS=0`, `PUBLIC_TRAFFIC_MUTATIONS=0`,
`CONTINUATION_HOST_DEPLOYMENTS=0`, `CLOUD_SECRET_MUTATIONS=0`, `REAL_PAYMENT_ATTEMPTS=0`.
Cloud reads only: two `wrangler deployments status`, one 30 s `wrangler tail`.
