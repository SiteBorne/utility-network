# SUN-1222C-R4-D10 — Ambiguous Settlement Detection & Operator Escalation

## Result: PASS — genuine Class D gap found and remediated (observational only)

## Authorization

`SUN1222C_R4_D10_AUTHORIZATION=GRANTED` (standalone first-person authorization),
scoped to: read-only detection/escalation audit; narrowly scoped tests and
observability/escalation source changes only if a genuine gap was found; at
most one deployment of the exact component whose runtime source changed.
Explicitly excluded all payment, settlement, chain, credential, public API
deployment, traffic, and schema-migration actions.

## Starting state / drift proof

```
D10_START_HEAD=15beb02e8c87526af04fbd8227f89a4f0fb889c1
D9_EVIDENCE_COMMIT_REACHABLE=YES
WORKING_TREE_RELEASE_CLEAN=YES
D10_PRE_HOST_VERSION_ID=8e10f91c-5654-4943-93f0-3a4bb5d27e10 @ 100% (no drift)
D10_HOST_DRIFT=NONE
D10_PUBLIC_API_DRIFT=NONE (db7054c9 @ 100%, d3472f58 @ 0%)
D10_TRAFFIC_DRIFT=NONE
```

## The D10 question

D9 proved automated reconciliation is already implemented to the maximum
extent an authoritative provider contract justifies. The residual manual
case — no transaction reference ever recorded, or the bounded 5-retry
chain-receipt check remains `STILL_UNKNOWN` — correctly stays manual
(design §13). D10 asked a different question: **can that unresolved case
become invisible to an operator?**

## Enumeration of manual-intervention exits (§4)

`runSettlementStep` in `paid-continuation-workflow.ts` converges all
`ambiguous_unresolved` origins into exactly one call site (line ~882),
regardless of which of three underlying causes produced it:

| Path | Cause | Durable state |
|---|---|---|
| Pre-settle CAS contention (line ~639) | `recordSettlementPending`'s `WHERE lifecycle_stage = 'executed'` UPDATE affected 0 rows | `payment_attempts.lifecycle_stage` unchanged from whatever it already was |
| Post-settle-throw reconciliation exhaustion (line ~653 → `resolveViaReconciliation`) | `settle()` threw, reconciliation found a claimed draft but the bounded on-chain check stayed `STILL_UNKNOWN` | `lifecycle_stage = 'settlement_pending'` |
| Prior-pending reconciliation exhaustion (line ~600 → `resolveViaReconciliation`) | A previous attempt's `settlement_pending` row was found on re-entry; reconciliation again exhausted | `lifecycle_stage = 'settlement_pending'` |

```
D10_MANUAL_INTERVENTION_PATHS_TOTAL=3 (all three origins, one convergence point)
D10_UNCLASSIFIED_PATHS=0
```

## Durable signal audit (§5)

The underlying fact — a payment attempt is durably claimed for settlement
and unresolved — already survives every failure mode D10's four durability
properties require (process exit, Workflow restart, log expiration, host
redeploy, operator absence): `payment_attempts.lifecycle_stage =
'settlement_pending'` plus `settlement_pending_at` (an already-indexed
column, `idx_payment_attempts_settlement_pending`, migration
0006_settlement_recovery.sql).

```
D10_D1_ALONE_OPERATOR_DETECTION=PARTIAL
```

Partial, not YES: the fact is durable, but (a) no code anywhere queried it
for discovery purposes, and (b) `jobs.current_state` stays `SETTLING`
whether a job is genuinely mid-flight or permanently stuck — the
job-state-machine layer alone cannot distinguish the two (by design —
forcing a transition here would face the exact same no-`DELIVERED`-path
problem D7 already ruled out for the retry-safety-equivalent
`persistence_failed_after_settlement` branches).

## Discovery / alerting audit (§6-7)

```
D10_UNRESOLVED_DISCOVERY_SURFACE=NONE (pre-remediation)
D10_UNRESOLVED_QUERY_COMPLETE=N/A (no query existed)
D10_ALERTING_CLASS=D (no reliable operator signal — repo-wide grep found
  zero metrics/webhook/alert infrastructure of any kind; this specific
  file had zero console output of any kind before this checkpoint)
```

D9's own runbook ("Operator recovery procedure") already documents *how*
to reconcile a known `payment_identifier` — but presumes the operator
already has one. It does not answer *how an operator finds out one
exists*. That is the genuine D10 gap: not the reconciliation procedure
(D9 closed that), but discovery and escalation.

## Staleness / age detection (§8)

No authoritative reconciliation-attempt-count or last-attempt-time is
persisted anywhere — `reconcileAmbiguousSettlement`'s bounded 5-retry loop
is entirely in-memory, per-Workflow-invocation. Rather than invent an
arbitrary threshold unrelated to actual behavior, the remediation exposes
`settlement_pending_at` age as a caller-supplied filter parameter
(`olderThanMs`) instead of a hardcoded constant.

```
D10_ESCALATION_TRIGGER=AGE (caller-supplied, no invented default threshold)
D10_ESCALATION_THRESHOLD=N/A (left to caller/runbook, not hardcoded)
```

## Decision gate (§13)

Not all six audit criteria for "already complete" were met
(`D10_ALERTING_CLASS=D`, not A) — this is a genuine defect per the
checkpoint's own criteria (§13, third bullet: discovery/alerting absent).
Proceeded test-first with the minimal permitted remediation (§14):
observational only, zero new economic authority.

## Remediation (test-first, RED → GREEN → mutation-proof)

Two additive, read-only/observational changes:

1. **`D1PaymentAttemptRepository.listUnresolvedSettlements()`**
   (`apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`)
   — a new read-only query: `SELECT ... WHERE lifecycle_stage =
   'settlement_pending' [AND settlement_pending_at < ?] ORDER BY
   settlement_pending_at ASC LIMIT ?`, returning only fields already
   surfaced elsewhere by this repository (`payment_identifier`, `job_id`,
   `service_id`, `service_version`, `resource_id`, `network`, `amount`,
   `payee`, `settlement_pending_at`, `settlement_transaction_reference`,
   `settlement_outcome_kind`, `cdp_facilitator_settle_attempt_count`). No
   secret column exists on this table (proven previously by
   `getSettlementRecoveryRecord`'s own doc comment); a dedicated test
   asserts none of the returned field names match `private`/`secret`/
   `authorization`/`signature`/`token`/`apikey`. Uses the existing index —
   **no schema migration**.

2. **`logSettlementAmbiguous(jobId, paymentIdentifier)`**
   (`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`)
   — a single `console.warn(JSON.stringify({event, job_id,
   payment_identifier}))` call at the one `ambiguous_unresolved`
   convergence point. Deliberately carries only the two identifiers an
   operator needs to run query (1) or look the row up directly — not a
   duplicate of the durable row itself.

### Why not more (§14/§15/§23 minimalism)

Repo-wide search found **zero** existing alerting/metrics/webhook
infrastructure (no PagerDuty, no Slack integration, no Analytics Engine
binding, no scheduled/cron Worker trigger). Per §15 ("do not add a new
vendor/service/dependency solely for D10"), this checkpoint does not
introduce one. The structured log is the maximum *active* signal safely
achievable without new infrastructure (honestly, this remains
best-effort/passive relative to a true paging system — see Known
Limitation below); the new query method is the *discoverable* half,
usable via the same local-script pattern already established by
`scripts/nevermined-recover.ts`.

### Tests (11 new, all RED → GREEN, mutation-proven)

- `apps/edge-api/tests/payment-attempts-unresolved-settlements.test.ts`
  (6 tests, real D1/Miniflare, no mock): excludes `executed`,
  `settled_external`, `settlement_failed` rows; includes genuine
  `settlement_pending` rows with correct safe fields; `olderThanMs`
  filtering; no forbidden field names.
- `apps/edge-api/tests/paid-continuation-workflow-observability.test.ts`
  (5 tests): O1 (exactly one log on reaching `settlement_ambiguous`), O2
  (dedup — same `payment_identifier`/`job_id` across repeated
  invocations against the same unresolved durable state, matching the
  structural guarantee that the underlying D1 row is updated in place,
  never duplicated), O4 (no secret material, exact field-set shape), plus
  a happy-path negative test (zero log calls when settlement succeeds)
  and a static source-scan proof that `logSettlementAmbiguous`'s function
  body contains zero settle/verify/executor/chain tokens.

**Mutation proof**: temporarily removed the `logSettlementAmbiguous` call
site — 3 of 5 observability tests failed exactly as expected (RED);
restored — all 5 GREEN again.

## Non-economic side-effect proof (§18)

```
D10_ALERT_PATH_SETTLE_CALLSITES=0
D10_ALERT_PATH_VERIFY_CALLSITES=0
D10_ALERT_PATH_EXECUTOR_CALLSITES=0
D10_ALERT_PATH_CHAIN_CALLSITES=0
```
(statically proven by the dedicated source-scan test above; `listUnresolvedSettlements` is a single read-only `SELECT`, no `UPDATE`/`INSERT`/`DELETE`.)

## Settlement ownership recheck (§19)

```
D10_PUBLIC_API_SETTLE_CALLSITES=0
D10_DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
D10_TOTAL_PRODUCTION_SETTLE_CALLSITES=1
D10_SETTLEMENT_OWNERSHIP_UNCHANGED=YES
```

## Schema / migration boundary (§20)

```
D10_SCHEMA_CHANGE_REQUIRED=NO
D10_MIGRATION_REQUIRED=NO
```
`listUnresolvedSettlements` reuses `settlement_pending_at`, already a
column (migration 0006) and already indexed
(`idx_payment_attempts_settlement_pending`, same migration).

## Regression (§21)

```
TARGETED_TESTS=11/11 pass (2 new files)
7_CASE_RECONCILIATION_SUITE=7/7 pass (settlement-reconciliation.test.ts)
12_CASE_CRASH_MATRIX=12/12 pass (paid-continuation-workflow-crash-matrix.test.ts)
PAID_CONTINUATION_WORKFLOW_TEST=46/46 pass
D1_REPOSITORY_TESTS=35/35 pass (d1-payment-attempts.test.ts) + 7/7 pass (nevermined-settlement-recovery.test.ts)
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
SECRETS_SCAN=2 pre-existing findings, both in files untouched by D10 (docs/reports/SUN-1222C2-Q1-R1-*.md:468, docs/reports/SUN-1222C1-four-service-candidate-provisioning.md:13, both from commit 3cbee0e — not a D10 regression)
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS (wrangler.paid-continuation-runtime.toml)
FULL_SUITE=2979/3063 pass, 78 skipped, 6 failed
```

The 6 full-suite failures (`load-v2.test.ts` ×2, `production-cdp-full-
stack-mock.test.ts`, `production-route-continuation-wiring.test.ts`,
`worker-bridge.subprocess.test.ts`) were re-run in isolation and all
passed — pure resource contention under full-suite parallelism, per D7-D9
precedent. None touch `paid-continuation-workflow.ts` or
`payment-attempts.ts`.

## Operator correlation & runbook (§9, §12)

Operator escalation surfaces exactly: `payment_identifier`, `job_id`,
`service_id`, `service_version`, `resource_id`, `network`, `amount`,
`payee`, `settlement_pending_at`, `settlement_transaction_reference` (if
one exists), `settlement_outcome_kind`, `cdp_facilitator_settle_attempt_count`
— never a private key, wallet secret, authorization header, or raw
signature (none of those are columns on this table).

```
D10_OPERATOR_CORRELATION_SUFFICIENT=YES
D10_OPERATOR_CORRELATION_FIELDS=payment_identifier, job_id, service_id, service_version, resource_id, network, amount, payee, settlement_pending_at, settlement_transaction_reference, settlement_outcome_kind, cdp_facilitator_settle_attempt_count
```

**Updated operator procedure** (extends D9's, which starts from step 2):

1. **Discover**: call `D1PaymentAttemptRepository.listUnresolvedSettlements({ olderThanMs: <N> })`
   (or, until a dedicated CLI wrapper exists, `wrangler d1 execute
   siteborne-utility --remote --command "SELECT payment_identifier, job_id,
   settlement_pending_at FROM payment_attempts WHERE lifecycle_stage =
   'settlement_pending' ORDER BY settlement_pending_at ASC"`) to enumerate
   every currently-unresolved `payment_identifier`.
2. For each: inspect `lifecycle_stage` and `settlement_transaction_reference`
   (D9's existing procedure).
3. Only if a transaction reference exists and remains unresolved on-chain
   after the bounded automated check, perform a manual on-chain lookup
   before deciding on a refund/retry-eligibility classification.
4. **Never** blindly call `settle()` merely because local state is
   ambiguous — no automated path re-attempts it under any circumstance,
   and this remediation adds none.

```
D10_OPERATOR_RUNBOOK_PRESENT=YES (this report + D9's, together)
D10_OPERATOR_RUNBOOK_SOURCE_ACCURATE=YES
```

## Known limitation (honestly disclosed, not silently scoped out)

`D10_ALERTING_CLASS` moves from D to **C** (active signal exists via
`console.warn`, but incomplete relative to a true paging/incident system —
no guaranteed delivery, no push notification, no automatic escalation if
unread). A `D10_ALERTING_CLASS=A` (complete, guaranteed-delivery alert)
would require a new vendor/service integration this checkpoint's
authorization and §15 explicitly forbid introducing. This gap is real and
is the natural target of a future, narrowly-scoped checkpoint if/when a
paging integration is separately authorized — not silently absorbed into
D10's claimed result.

## Zero economic qualification (§22)

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
EXECUTOR_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
```

## Required operator-safety matrix (§24)

| Manual path | Durable detection | Active alert | Dedup key | Safe correlation | Resolution condition | Runbook |
|---|---|---|---|---|---|---|
| Pre-settle CAS contention | YES (`lifecycle_stage='settlement_pending'`) | YES (console.warn) | `payment_identifier` | YES | `lifecycle_stage` leaves `settlement_pending` (settled/failed) | YES |
| Post-throw reconciliation exhaustion | YES | YES | `payment_identifier` | YES | same | YES |
| Prior-pending reconciliation exhaustion | YES | YES | `payment_identifier` | YES | same | YES |

```
D10_UNCLASSIFIED_PATHS=0
```

## SUN1222C_R4_D10 = PASS

```
SUN1222C_R4_D10_AMBIGUOUS_SETTLEMENT_OPERATOR_ESCALATION=PASS
D10_REMEDIATION_REQUIRED=YES
FUNCTIONAL_SOURCE_MUTATIONS=2 (payment-attempts.ts, paid-continuation-workflow.ts)
D10_GENUINE_RED=PASS
D10_GREEN=PASS
D10_MUTATION_PROOF=PASS
HOST_DEPLOYMENTS=1 (siteborne-paid-continuation-runtime only)
PUBLIC_API_DEPLOYMENTS=0
D10_TRAFFIC_MUTATIONS=0
D10_SCHEMA_CHANGE_REQUIRED=NO
D10_MIGRATION_REQUIRED=NO
D10_TOTAL_PRODUCTION_SETTLE_CALLSITES=1
REAL_SETTLEMENT_ATTEMPTS=0
ECONOMIC_EFFECT_USDC=0
D10_EVIDENCE_COMMIT_SHA=<set at commit time>
D10_UNCLASSIFIED_PATHS=0
```

Do not begin D11 automatically.
