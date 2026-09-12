# SUN-1222C Model-C production migration and legacy classification reauthorization

Date: 2026-09-12 (America/Chicago)

## Decision

`SUN1222C_PCC_MODEL_C_PRODUCTION_MIGRATION_AND_LEGACY_CLASSIFICATION_REAUTHORIZATION=PASS`.

Exactly the two authorized production data mutations completed, in order:

1. additive migration 0010 applied once; and
2. the repaired controlled operator inserted exactly 17 append-only legacy
   reconciliation events in one all-or-nothing D1 batch.

No payment-attempt stage, payment identifier, settlement reference, job,
owner-intent, or lifecycle row was changed or deleted. Raw nonterminal history
remains 17. The Model-C ownership-aware gate moved from 17 active blockers to
zero solely because all 17 historical attempts now carry their exact governed,
non-actionable reconciliation classification.

This is a production data-model and historical-classification result only. The
public and paid runtimes remain pre-Model-C. They can still create new ownerless
legacy-shaped state until separately authorized Model-C Worker candidates are
built, qualified, and deployed. The independent TDQS pre-upload gate remains
blocked by the missing local TDQS account key, and no Worker upload occurred.

## Repository and operator authority

```text
START_HEAD=098944e8dae93baf88a4f7dc7ab1ed560fcb7596
MODEL_C_IMPLEMENTATION_COMMIT=74290db10e1eb4a3d266e9310ebe5b2dad177ce4
MODEL_C_EVIDENCE_INDEX_COMMIT=21afdd282c5ed2d1e94f35c607c8350f2dbe5dca
MODEL_C_OPERATOR_REMEDIATION_COMMIT=9b39a826fe4271303b0abc3be08daea0b0a293c8
MCP_METADATA_SOURCE_AUTHORITY=896d75a343d5a4ac2690cf60e1259828482a8a63
BRANCH=main
WORKING_TREE_PRE=CLEAN
ALL_REQUIRED_COMMITS_EXIST=YES
ALL_REQUIRED_COMMITS_REACHABLE_FROM_MAIN=YES
```

The isolated operator suite passed 38/38 immediately before production work. It
covered the strict 17-row evidence/preimage contract, three-state whole-plan
machine, partial-state conflict behavior, zero-row assertion failures,
early/middle/late D1 rollback, exact 17-or-zero insertion, idempotent dry-run
and second-apply behavior, and the required mutation matrix. Settlement
ownership also passed its focused 4/4 test.

```text
PLAN_ENTRY_COUNT=17
PLAN_EVIDENCE_REFS=17
RESOLVABLE_EVIDENCE_REFS=17
UNRESOLVABLE_EVIDENCE_REFS=0
WHOLE_PLAN_STATE_MACHINE_IMPLEMENTED=YES
PARTIAL_ALREADY_RECONCILED_PLAN_BEHAVIOR=CONFLICT
GOVERNED_APPLY_CONTAINS_ON_CONFLICT_DO_NOTHING=NO
EXACTLY_17_OR_ZERO_GUARANTEE=YES
TRANSACTIONAL_PREIMAGE_ASSERTIONS=PASS
ZERO_ROW_PREIMAGE_MISMATCH_FAILS_TRANSACTION=YES
ACTUAL_OPERATOR_D1_TRANSACTION_ROLLBACK=PASS
GOLDEN_OPERATOR_FLOW=PASS
SECOND_APPLY_NEW_ROWS=0
BACKFILL_OPERATOR_TESTS=PASS
D1_TRANSACTION_TESTS=PASS
BACKFILL_OPERATOR_MUTATION_TESTS=PASS
```

## Migration integrity and pending-set proof

Pinned Wrangler was `4.119.0`. The migration file retained the frozen SHA-256:

```text
MIGRATION_0010_SHA256=83f95242ff2788cbee29e00e2a52c3b268f23eb265a7c01a690f67b4634107d9
MIGRATION_0010_CONTENT_CHANGED=NO
ADDITIVE_ONLY=YES
DROP_TABLE=NO
DROP_COLUMN=NO
PAYMENT_ATTEMPT_STAGE_REWRITE=NO
PAYMENT_IDENTIFIER_REWRITE=NO
SETTLEMENT_REFERENCE_REWRITE=NO
```

Two immediate read-only lists—before the mutation and again in the same guarded
execution—reported exactly one pending file:

```text
0010_lifecycle_reconciliation_and_workflow_ownership.sql
```

No other migration was pending.

## Live topology and pre-migration state

Read-only deployment status matched the checkpoint exactly:

```text
PUBLIC_NORMAL=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @100%
PUBLIC_QUIESCENCE=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @0%
PAID_RUNTIME=d62011b9-6219-47e1-8cf9-5006776cfb50 @100%
SETTLEMENT_ALERT=8fe32c69-d906-4369-9c0a-49b2cc406e8e @100%
TOPOLOGY_DRIFT=NO
```

The repaired pre-migration remote dry-run found all 17 exact payment/job
preimages and zero conflicts. Model-C tables were absent as expected, so it
truthfully returned `NO_SCHEMA_MISSING` with zero planned mutations and zero
writes.

```text
ROWS_PLANNED=17
ROWS_WITH_PREIMAGE_MATCH=17
PREIMAGE_CONFLICTS=0
EVIDENCE_REF_FAILURES=0
PRODUCTION_PLAN_IDS_FOUND=17
PRODUCTION_STAGE_MATCHES=17
PRODUCTION_SERVICE_MATCHES=17
PRODUCTION_PAYMENT_IDENTIFIER_MATCHES=17
PRODUCTION_CORRELATED_JOB_MATCHES=17
PRODUCTION_JOB_STATE_MATCHES=17
PRODUCTION_SETTLEMENT_PRESENCE_MATCHES=17
MODEL_C_SCHEMA_READY_PRE=NO
REMOTE_READ_ONLY_PREFLIGHT_D1_WRITES=0
```

Pre-migration aggregate state was:

```text
PAYMENT_ATTEMPTS=18
X402_QUOTES=73
AUDIT_EVENTS=171
JOBS=18
JOB_STATE_EVENTS=158
QUEUE_DISPATCHES=0
RAW_VERIFIED=16
RAW_SETTLED_EXTERNAL=1
RAW_NONTERMINAL_LIFECYCLE_COUNT=17
```

Public `/health`, `/ready`, Agent Card, JWKS, MCP initialize, and MCP tools/list
all returned HTTP 200. Readiness remained truthfully `not_ready/foundation`; the
signed Agent Card exposed eight skills and one interface; JWKS exposed one
public key and no private `d`; MCP negotiated `2025-11-25` and listed six tools.
The dedicated paid runtime has a deliberately inert 404 HTTP surface, so its
best available read-only health proof was the exact unchanged 100% deployment
status plus the focused settlement-ownership test.

## Migration execution and schema readback

The exact command executed once was:

```bash
npx wrangler d1 migrations apply siteborne-utility \
  --remote \
  --config wrangler.toml
```

Wrangler identified only 0010, captured the normal migration backup, executed
six commands, and reported the migration successful.

```text
MIGRATION_COMMAND_EXIT_CODE=0
MIGRATION_0010_APPLIED=YES
MIGRATION_0010_APPLIED_AT=2026-09-12 12:16:38 UTC
PRODUCTION_D1_MIGRATIONS_APPLIED=1
```

The ledger then reported no pending migrations. `sqlite_schema` readback proved
the three tables, both explicit indexes, all required checks, uniqueness, and
foreign keys:

```text
payment_attempt_reconciliations
idx_payment_attempt_reconciliations_effective
payment_workflow_owner_intents
idx_payment_workflow_owner_intents_recovery
payment_service_link_evidence
PRODUCTION_0010_SCHEMA_VERIFICATION=PASS
```

All three new tables started empty. Raw lifecycle counts and every governed
payment/job preimage remained unchanged. Old public health/MCP/A2A discovery and
the paid deployment readback passed against the new schema before any legacy
event was inserted.

## Pre-backfill gate and dry-run

Immediately after migration:

```text
PREEXISTING_RECONCILIATION_EVENTS=0
LEGACY_17_OWNER_INTENTS=0
RAW_NONTERMINAL_LIFECYCLE_COUNT=17
ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=17
OWNER_INTENT_PENDING_COUNT=0
ACTIVE_WORKFLOW_OWNED_ATTEMPTS=0
UNRECONCILED_ACTIONABLE_ATTEMPTS=17
UNRESOLVED_SETTLEMENT_FINALIZATION_COUNT=0
```

The operator does not implement a `--help` branch: `--help` failed locally on
the mandatory mode guard before any remote call. The committed parser was
therefore inspected directly rather than inventing syntax; its exact production
acknowledgement is `--acknowledge-sun1222c-production-backfill`.

Both the initial post-migration dry-run and the final immediately pre-apply
dry-run returned exactly:

```text
WHOLE_PLAN_STATE=FRESH_APPLY
RECONCILIATION_APPLY_READY=YES
ROWS_PLANNED=17
ROWS_TO_INSERT=17
ROWS_ALREADY_RECONCILED=0
ROWS_WITH_PREIMAGE_MATCH=17
PREIMAGE_CONFLICTS=0
EVIDENCE_REF_FAILURES=0
PAYMENT_ATTEMPT_UPDATES_PLANNED=0
PAYMENT_ATTEMPT_DELETIONS_PLANNED=0
OWNER_INTENTS_PLANNED=0
WORKFLOW_CREATIONS_PLANNED=0
ECONOMIC_ACTIONS_PLANNED=0
```

## Exact append-only apply and postimage

The exact command executed once was:

```bash
pnpm tsx scripts/reconcile-payment-attempts.ts \
  --apply \
  --remote \
  --database siteborne-utility \
  --plan scripts/data/sun1222c-legacy-17-model-c-plan.json \
  --acknowledge-sun1222c-production-backfill
```

The operator first analyzed `FRESH_APPLY`, issued one 17-statement asserted D1
batch, required trustworthy change metadata to sum to 17, then reanalyzed the
postimage. Its returned `whole_plan_state` is intentionally the verified
post-apply state (`EXACT_IDEMPOTENT_NOOP`), while `actual_insert_count=17`
records the mutation. This matches `runOperator`'s committed output contract and
is not a second apply.

```text
LEGACY_BACKFILL_APPLY_EXIT_CODE=0
LEGACY_APPLY_COMMAND_EXECUTED_ONCE=YES
PRE_APPLY_WHOLE_PLAN_STATE=FRESH_APPLY
APPLY_RETURNED_POSTIMAGE_STATE=EXACT_IDEMPOTENT_NOOP
ACTUAL_INSERT_COUNT=17
POST_APPLY_EXACT_EXPECTED_EVENT_COUNT=17
```

Independent readback proved:

```text
NEW_RECONCILIATION_EVENTS_CREATED=17
TOTAL_EFFECTIVE_RECONCILIATION_EVENTS_FOR_LEGACY_17=17
DISTINCT_LEGACY_ATTEMPTS_WITH_EVENTS=17
EXACTLY_ONE_EFFECTIVE_EVENT_PER_LEGACY_ATTEMPT=YES
LEGACY_EXECUTION_FAILED_UNSETTLED=14
LEGACY_EXECUTION_OUTCOME_UNKNOWN=1
LEGACY_VERIFIED_UNROUTED_UNSETTLED=1
LEGACY_SETTLED_EXTERNAL_FINALIZATION_INCOMPLETE=1
NON_ACTIONABLE_COUNT=17
OWNER_KIND_NONE_COUNT=17
SOURCE_OPERATOR_COUNT=17
ALL_EVIDENCE_REFS_EXACT_AND_RESOLVABLE=YES
LEGACY_CLASSIFICATION_INSERTION=PASS
```

The same complete preimage comparison after apply proved all payment IDs,
payment-identifier fingerprints, lifecycle stages, settlement presence,
correlated job IDs, job states, and creation times unchanged. Aggregate counts
were also unchanged:

```text
PAYMENT_ATTEMPTS=18
X402_QUOTES=73
AUDIT_EVENTS=171
JOBS=18
JOB_STATE_EVENTS=158
QUEUE_DISPATCHES=0
OWNER_INTENTS=0
LINK_EVIDENCE=0
RAW_VERIFIED=16
RAW_SETTLED_EXTERNAL=1
RAW_NONTERMINAL_LIFECYCLE_COUNT=17
```

## Idempotency and global ownership-aware gate

The required second production invocation was dry-run only:

```text
SECOND_DRY_RUN_WHOLE_PLAN_STATE=EXACT_IDEMPOTENT_NOOP
SECOND_DRY_RUN_ROWS_PLANNED=17
SECOND_DRY_RUN_ROWS_TO_INSERT=0
SECOND_DRY_RUN_ROWS_ALREADY_RECONCILED=17
SECOND_DRY_RUN_PREIMAGE_CONFLICTS=0
SECOND_DRY_RUN_NO_MUTATION_REQUIRED=YES
SECOND_DRY_RUN_D1_WRITES=0
SECOND_PRODUCTION_APPLY_EXECUTED=NO
```

The exact implemented Model-C query was run over all production records, not
only the governed identifiers:

```text
GLOBAL_RAW_NONTERMINAL_LIFECYCLE_COUNT=17
GLOBAL_OWNER_INTENT_PENDING_COUNT=0
GLOBAL_ACTIVE_WORKFLOW_OWNED_ATTEMPTS=0
GLOBAL_UNRECONCILED_ACTIONABLE_ATTEMPTS=0
GLOBAL_UNRESOLVED_SETTLEMENT_FINALIZATION_COUNT=0
GLOBAL_ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0
MODEL_C_GATE_POST_BACKFILL=PASS
```

No new production work appeared during the checkpoint.

## Post-operation health, recurrence, and independent TDQS blocker

Final public health, readiness, Agent Card, JWKS, MCP initialize, six-tool MCP
discovery, and A2A discovery remained unchanged. Final deployment readback again
proved b6 at 100%, d28 at 0%, paid d620 at 100%, and alert 8fe at 100%.

```text
PUBLIC_POST_BACKFILL_HEALTH=PASS
PUBLIC_READY=TRUTHFUL_NOT_READY_FOUNDATION
AGENT_CARD=PASS
JWKS=PASS
MCP_INITIALIZE=PASS
MCP_DISCOVERY=PASS
A2A_DISCOVERY=PASS
PAID_RUNTIME_POST_BACKFILL_HEALTH=BEST_AVAILABLE_READ_ONLY_PROOF

MODEL_C_SCHEMA_LIVE=YES
LEGACY_17_CLASSIFIED=YES
MODEL_C_PUBLIC_RUNTIME_LIVE=NO
MODEL_C_PAID_RUNTIME_LIVE=NO
CURRENT_LIVE_PUBLIC_CAN_STILL_CREATE_OWNERLESS_VERIFIED=YES
CURRENT_LIVE_PAID_CAN_STILL_CREATE_OWNERLESS_SETTLED_EXTERNAL=YES
PAID_RUNTIME_CUTOVER_AUTHORIZED_NOW=NO

TDQS_PREUPLOAD_GATE=BLOCKED_MISSING_TDQS_ACCOUNT_KEY
PUBLIC_WORKER_UPLOAD_AUTHORIZED=NO
```

Settlement ownership remains:

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

## Mutation and economic accounting

```text
PRODUCTION_D1_MIGRATIONS_APPLIED=1
PRODUCTION_RECONCILIATION_ROWS_INSERTED=17
PRODUCTION_PAYMENT_ATTEMPTS_UPDATED=0
PRODUCTION_PAYMENT_ATTEMPTS_DELETED=0
PAYMENT_ATTEMPT_STAGE_UPDATES=0
PAYMENT_IDENTIFIER_MUTATIONS=0
SETTLEMENT_REFERENCE_MUTATIONS=0
JOB_MUTATIONS=0
PRODUCTION_OWNER_INTENTS_INSERTED=0
PRODUCTION_WORKFLOWS_CREATED=0

PUBLIC_VERSION_UPLOADS=0
PAID_VERSION_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
DNS_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
MTLS_MUTATIONS=0

REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
NEW_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```
