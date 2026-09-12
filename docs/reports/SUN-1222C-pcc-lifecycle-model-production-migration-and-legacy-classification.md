# SUN-1222C PCC lifecycle Model-C production migration and legacy classification

Date: 2026-09-11 (America/Chicago)

## Decision

`SUN1222C_PCC_LIFECYCLE_MODEL_PRODUCTION_MIGRATION_AND_LEGACY_CLASSIFICATION=BACKFILL_DRY_RUN_FAILED`.

The production checkpoint stopped before every authorized mutation. Migration
`0010_lifecycle_reconciliation_and_workflow_ownership` remains unapplied and no
legacy reconciliation event was inserted. This full stop follows the
checkpoint's explicit whole-plan rule: the controlled operator cannot prove the
required preimage, evidence-reference, exact-row-count, and post-apply
idempotency contract in its current form.

This is not a failure of the Model-C runtime design, its additive migration, or
the governed 17-row forensic classification. The exact production preimage still
matches the forensic plan. It is a production-operator/evidence-binding gap that
must be repaired and revalidated before the already-authorized D1 changes are
attempted.

## Repository and topology integrity

Checkpoint start:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=74290db10e1eb4a3d266e9310ebe5b2dad177ce4
WORKING_TREE=CLEAN
MODEL_C_COMMIT_EXISTS=YES
MODEL_C_COMMIT_REACHABLE_FROM_MAIN=YES
PINNED_WRANGLER_VERSION=4.119.0
```

Read-only Cloudflare readback matched the frozen topology:

```text
PUBLIC_NORMAL_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
PUBLIC_NORMAL_TRAFFIC=100%
CURRENT_QUIESCENCE_VERSION=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
CURRENT_QUIESCENCE_TRAFFIC=0%
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
SETTLEMENT_ALERT_VERSION=8fe32c69-d906-4369-9c0a-49b2cc406e8e
SETTLEMENT_ALERT_TRAFFIC=100%
PUBLIC_TOPOLOGY_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
SETTLEMENT_ALERT_WORKER_UNCHANGED=YES
```

No Worker version, deployment, traffic, variable, secret, route, DNS, Preview
URL, mTLS, payment, provider, Workflow, settlement, or chain state was changed.

## Migration artifact and production pre-state

The migration is additive. It creates three new tables and two supporting
indexes:

- `payment_attempt_reconciliations`, with append-only sequence, constrained
  classification/actionability/owner/source values, unique event ID and dedupe
  key, and payment-attempt/supersession foreign keys;
- `idx_payment_attempt_reconciliations_effective`;
- `payment_workflow_owner_intents`, with unique attempt, payment identifier, and
  Workflow instance ownership plus bounded dispatch/recovery state;
- `idx_payment_workflow_owner_intents_recovery`; and
- `payment_service_link_evidence`, binding the attempt, payment identifier, job,
  link, settlement, result, receipt, and signing-key evidence.

The file contains no `DROP TABLE`, `DROP COLUMN`, payment-attempt update,
payment-identifier rewrite, settlement-reference rewrite, or quote/requirement
rewrite.

```text
D1_MIGRATION_ID=0010_lifecycle_reconciliation_and_workflow_ownership
ADDITIVE_ONLY=YES
DROP_TABLE=NO
DROP_COLUMN=NO
PAYMENT_ATTEMPT_STAGE_REWRITE=NO
EXISTING_PAYMENT_IDENTIFIER_REWRITE=NO
EXISTING_SETTLEMENT_REFERENCE_REWRITE=NO
EXISTING_QUOTE_OR_REQUIREMENT_REWRITE=NO

CURRENT_APPLIED_MIGRATIONS=0001,0002,0003,0004,0005,0006,0007,0008,0009
MIGRATION_0010_ALREADY_APPLIED=NO
MIGRATIONS_TO_APPLY=ONLY_0010
PRODUCTION_MIGRATION_PLAN_EXACT=YES
```

Before mutation, production contained 18 payment attempts, 73 x402 quotes, 171
audit events, 18 jobs, 158 job-state events, and zero queue dispatches.
`payment_attempt_reconciliations`, `payment_workflow_owner_intents`,
`payment_service_link_evidence`, and `state_events` were absent, as expected.
The authoritative raw nonterminal result remained 16 `verified` plus one
`settled_external`, total 17.

Cloudflare's current D1 API documentation says semicolon-separated statements
submitted to `/query` execute as a batch, and its D1 database documentation says
batched statements are transactional and roll back the sequence when a statement
fails. Inspection of Wrangler 4.119.0 confirmed remote `d1 execute --command`
sends the SQL string once to that `/query` endpoint. Transaction rollback is
therefore not the blocker identified here.

## Exact production preimage

Every payment attempt and job below was fetched read-only from production.
Correlated job authority was
`jobs.idempotency_key = payment_attempts.payment_identifier`; the nullable
`payment_attempts.job_id` field was not used. `Set ref` is presence only; no
settlement reference value is reproduced.

|   # | Payment attempt                        | Payment identifier                     | Service                     | Stage              | Created UTC                | Set ref | Correlated job                         | Job state   | Planned classification                            |
| --: | -------------------------------------- | -------------------------------------- | --------------------------- | ------------------ | -------------------------- | ------: | -------------------------------------- | ----------- | ------------------------------------------------- |
|   1 | `57a2bcdb-3d47-4369-b871-2d7befec555c` | `pay_5b90677d6a7d4a178bec037e21409e22` | `web_context_verified.v2`   | `verified`         | `2026-08-29T17:54:27.958Z` |       0 | `33c5387f-4abb-49af-95f6-ef929ba83ad9` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|   2 | `a5928987-1c4c-4fd0-8e91-5095b955dda6` | `pay_f2aef800737144979cafe8281f504074` | `web_context_verified.v2`   | `verified`         | `2026-08-29T22:35:32.413Z` |       0 | `c51a822e-c110-43e1-ac6e-cb1a5444315e` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|   3 | `bff2bc21-3b12-417c-ac35-4be05c212936` | `pay_de014688ebfe4e69bac34504c0044d3b` | `web_context_verified.v2`   | `verified`         | `2026-08-29T23:27:39.862Z` |       0 | `11fde704-fce5-4ef0-b627-c0290e20ead8` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|   4 | `e8d2607b-c3e3-4690-825a-b919bdaa9a48` | `pay_1aa78bb3601942b7bf4834d076c63e9f` | `web_context_verified.v2`   | `verified`         | `2026-08-30T01:24:30.515Z` |       0 | `ee04c4bf-1b74-44c6-a1ab-00edc235b4a9` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|   5 | `3a728ffc-5f1b-4b12-8145-c84f25fc9330` | `pay_02703c94503e489890f51c4e98a771c6` | `web_context_verified.v2`   | `verified`         | `2026-08-31T04:46:24.078Z` |       0 | `de147124-c264-452b-b784-86ee4422ecd1` | `EXECUTING` | `legacy_execution_outcome_unknown`                |
|   6 | `123c4f61-2090-40fb-b918-7b2e1f187af0` | `pay_3a36092dec7c4da68653c0a05aca0907` | `web_context_verified.v2`   | `verified`         | `2026-08-31T20:10:40.909Z` |       0 | `8187902a-c3bf-4c3f-89c0-3d84ecd72d05` | `LOCKED`    | `legacy_verified_unrouted_unsettled`              |
|   7 | `abc98f87-9164-4d97-98d3-c24d4367f0a6` | `pay_eb7a027d441448c5b9f5d707e20df776` | `web_context_verified.v2`   | `verified`         | `2026-09-01T12:40:04.749Z` |       0 | `49a43a08-5479-4087-8ada-1afcf8074120` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|   8 | `eddedd77-86c0-47c6-8ec3-11f1354dddc5` | `pay_eb8417f8666e4ff088b93d7359c88a0f` | `web_context_verified.v2`   | `verified`         | `2026-09-01T13:10:06.014Z` |       0 | `3898e160-edd7-4bbf-adcb-80ac4b75f301` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|   9 | `56d84294-eff5-4f92-ae91-d61ceca5339a` | `pay_4a7d1e37f0184afdb13f86717c03699f` | `web_context_verified.v2`   | `settled_external` | `2026-09-01T13:39:25.906Z` |       1 | `64a321cb-f1d2-495d-a405-094b631d4170` | `DELIVERED` | `legacy_settled_external_finalization_incomplete` |
|  10 | `3706d9a9-789e-4e07-bab5-7b3174e11f24` | `pay_a750ea6da8ea479fa7660c2cf92a4378` | `company_evidence_graph.v2` | `verified`         | `2026-09-06T05:06:51.691Z` |       0 | `cdc7b707-cb2c-41c5-a503-360bd95621d8` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|  11 | `f964e050-abd4-4f27-b04e-dc06eaf219ed` | `pay_a3bde18f5a714dbf9f94dd2a40c695bc` | `company_evidence_graph.v2` | `verified`         | `2026-09-07T16:56:12.319Z` |       0 | `8c3add98-6d41-4d12-8838-7acd3a443ef4` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|  12 | `7176fb23-7c68-451e-b0a3-1e93f54ef8fe` | `pay_246c956277394be0aec72656322264d6` | `company_evidence_graph.v2` | `verified`         | `2026-09-07T18:13:20.736Z` |       0 | `63dfe74b-6414-4cfa-9dfa-0fb2b7a83aa0` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|  13 | `0ada4abc-a437-428e-803f-3dfb68f915f9` | `pay_a99341faa7a542b786030c90f453d231` | `company_evidence_graph.v2` | `verified`         | `2026-09-07T21:27:10.226Z` |       0 | `72efabd1-062b-4fca-9f04-68525b5d1446` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|  14 | `d275356c-f6f8-46f7-8a2a-cabe26d32185` | `pay_5fd98a0f196d4df5b9420fa6f1a4a3f0` | `company_evidence_graph.v2` | `verified`         | `2026-09-07T22:30:30.359Z` |       0 | `70434d7b-35d0-4658-ba5c-b324b210bd2a` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|  15 | `ab07fd69-e50c-4abf-ae5b-1fb8476230b8` | `pay_1be0e6752e094e2aa5ae6eb2c9d54bbc` | `company_evidence_graph.v2` | `verified`         | `2026-09-07T23:38:33.935Z` |       0 | `d6563fbb-71ba-4509-8c01-a9e674cba52d` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|  16 | `5be6b110-62fb-40a4-8bda-cf4698645d71` | `pay_7a5adbd29a0644d78ea608cf24209b04` | `company_evidence_graph.v2` | `verified`         | `2026-09-08T05:40:30.686Z` |       0 | `5a87c9c5-995f-4173-8015-596257a41ea2` | `REJECTED`  | `legacy_execution_failed_unsettled`               |
|  17 | `22d6df47-41db-49a6-8eff-3750bd5539c9` | `pay_285a4c0c94aa4513a2f74c5400ab70b4` | `company_evidence_graph.v2` | `verified`         | `2026-09-08T13:05:49.043Z` |       0 | `07b7655b-3731-40e2-b376-30302333497c` | `REJECTED`  | `legacy_execution_failed_unsettled`               |

```text
LEGACY_PLAN_IDS_FOUND=17
LEGACY_PLAN_IDS_MISSING=0
LEGACY_PLAN_DUPLICATE_IDS=0
LEGACY_PLAN_PREIMAGE_MATCH=YES
CLASSIFICATION_AGGREGATE=legacy_execution_failed_unsettled:14;legacy_execution_outcome_unknown:1;legacy_verified_unrouted_unsettled:1;legacy_settled_external_finalization_incomplete:1
RAW_NONTERMINAL_LIFECYCLE_COUNT_PRE=17
```

## Old-runtime compatibility and safe health proof

The additive migration and compatibility behavior were revalidated locally by
the Model-C, Workflow, mutation, and sole-settlement-owner suites: 4 files, 29
tests passed. These include the explicit raw-17/gate-17-to-zero model,
append-only supersession, atomic verified-plus-owner-intent behavior,
provider-failure classification, durable finalization, restart idempotency,
mutation guards, and the single settlement owner.

The current pre-Model-C public runtime remained healthy before the stop:

```text
PRE_MIGRATION_PUBLIC_HEALTH=PASS_HTTP_200
PRE_MIGRATION_PUBLIC_READY=PASS_HTTP_200_TRUTHFUL_NOT_READY_WITH_PRODUCTION_SERVICES_ENABLED
PRE_MIGRATION_PUBLIC_AGENT_CARD=PASS_HTTP_200_SIGNED
PRE_MIGRATION_PUBLIC_JWKS=PASS_HTTP_200_ONE_PUBLIC_KEY
PRE_MIGRATION_PUBLIC_CATALOG=PASS_HTTP_200_EIGHT_SERVICES
PRE_MIGRATION_PUBLIC_MCP=PASS_INITIALIZE_HTTP_200_PROTOCOL_2025-11-25_AND_TOOLS_LIST_HTTP_200_SIX_TOOLS
PRE_MIGRATION_PUBLIC_A2A=PASS_AGENT_CARD_DISCOVERY_HTTP_200
PRE_MIGRATION_PAID_RUNTIME_HEALTH=BEST_AVAILABLE_READ_ONLY_PROOF_DEPLOYMENT_STATUS_100_PERCENT_AND_LOCAL_COMPATIBILITY_TESTS

OLD_PUBLIC_WITH_NEW_ADDITIVE_SCHEMA=SAFE_BY_ADDITIVE_SCHEMA_AND_TESTS_NOT_LIVE_MUTATION
OLD_PAID_WITH_NEW_ADDITIVE_SCHEMA=SAFE_BY_ADDITIVE_SCHEMA_AND_TESTS_NOT_LIVE_MUTATION
NEW_PUBLIC_WITH_NEW_SCHEMA=SAFE
NEW_PAID_WITH_NEW_SCHEMA=SAFE
NEW_PUBLIC_WITH_OLD_SCHEMA=FAILS_CLOSED
NEW_PAID_WITH_OLD_SCHEMA=FAILS_CLOSED

PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

The attempted legacy A2A v0.3-style method without a version header returned the
expected bounded protocol error and was not counted as A2A discovery; the signed
Agent Card is the read-only A2A discovery authority for this checkpoint.

## Controlled-operator blocker

The non-remote diagnostic dry-run printed 17 planned append-only rows with the
expected aggregate, no payment-attempt update/delete, no owner intent, and no
economic action. The exact remote dry-run was not run because it depends on the
new reconciliation table and the full checkpoint stopped before applying the
migration.

The production operator fails four mandatory gates:

1. Every generated `evidence_ref` uses
   `docs/reports/SUN-1222C-pcc-lifecycle-backlog-reconciliation.md#attempt-<UUID>`.
   The file contains all 17 attempt IDs and all 17 correlated job IDs in its
   forensic table, but defines zero matching headings or explicit HTML anchors.
   Consequently, all 17 fragments are unresolved.
2. Its remote preimage query displays only attempt ID, payment identifier,
   lifecycle stage, settlement-reference value, and any latest reconciliation.
   It does not join the job through the authoritative payment identifier; does
   not display service, creation time, correlated job ID/state, or the expected
   plan values; and treats any 17 returned IDs as a valid preimage.
3. Apply uses `ON CONFLICT(dedupe_key) DO NOTHING` but neither preflights nor
   verifies the number of conflicts or newly inserted rows. A pre-existing
   subset can therefore yield fewer than 17 inserts without a nonzero exit.
4. A second `--dry-run` always prints the same 17 planned rows. It cannot
   produce the required `ROWS_TO_INSERT=0`, `ROWS_ALREADY_RECONCILED=17`,
   `PREIMAGE_CONFLICTS=0`, and `NO_MUTATION_REQUIRED=YES` idempotency proof.

Cloudflare's batch transaction prevents a statement failure from partially
committing. It cannot turn a successful zero-row `INSERT ... SELECT` or
`ON CONFLICT DO NOTHING` into an all-or-nothing exact-count assertion. The
required coherent 17-row outcome is therefore not guaranteed by this tool.

```text
RECONCILIATION_TOOL_SAFETY_RECONFIRMED=NO
LEGACY_EVENTS_WITH_NONEMPTY_EVIDENCE_REF=17
LEGACY_EVENTS_WITH_VALID_RESOLVABLE_EVIDENCE_REF=0
MISSING_OR_UNRESOLVED_EVIDENCE_REF=17
EVIDENCE_REF_VALIDATION=FAIL
ALL_OR_NOTHING_CLASSIFICATION_SAFE=NO
LEGACY_BACKFILL_DRY_RUN=NOT_RUN_REMOTE_BLOCKED_BEFORE_MIGRATION
LEGACY_BACKFILL_APPLY_EXIT_CODE=NOT_RUN
```

## Mutation and economic accounting

```text
MIGRATION_0010_APPLIED=NO
PRODUCTION_0010_SCHEMA_VERIFICATION=NOT_RUN
PRODUCTION_D1_MIGRATIONS_APPLIED=0
PRODUCTION_RECONCILIATION_ROWS_INSERTED=0
PRODUCTION_PAYMENT_ATTEMPTS_UPDATED=0
PRODUCTION_PAYMENT_ATTEMPTS_DELETED=0
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
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
PRODUCTION_WORKFLOW_CREATIONS=0
NEW_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

Because no migration or backfill occurred, the raw/global Model-C postimage and
ownership-aware post-backfill gate are not claimed. Production remains on the
pre-Model-C runtimes. The source defect is fixed in commit `74290db`, but
neither the public nor paid Model-C runtime is deployed, so the ownerless
`verified` and ownerless `settled_external` recurrence windows remain live.

## Required remediation checkpoint

Before returning to production migration/classification authority, a dedicated
legacy-backfill remediation must, at minimum:

1. create durable, resolvable per-attempt evidence anchors or change the plan to
   point at an equally durable exact record;
2. bind the plan to expected current stage, service, payment identifier, job ID,
   job state, and settlement-reference-presence preimage values;
3. fail closed on any missing, duplicate, drifted, or pre-reconciled row;
4. make the apply operation assert exactly 17 inserted rows inside the same D1
   transaction, with no successful partial/no-op subset;
5. emit explicit dry-run counts for planned, already present, and mismatched
   rows; and
6. make the post-apply dry-run prove 0-to-insert, 17-already-reconciled, zero
   conflicts, and no mutation required.

After that source/docs-only remediation passes, a new production authorization
must start from a fresh migration list, topology readback, exact preimage, and
health snapshot. Migration 0010 must not be inferred as still authorized merely
from this stopped attempt.

```text
SOURCE_DEFECT_FIXED=YES
MODEL_C_OWNER_RECOVERY_CODE_DEPLOYED=NO
CURRENT_LIVE_PUBLIC_CAN_STILL_CREATE_OWNERLESS_VERIFIED=YES
CURRENT_LIVE_PAID_CAN_STILL_CREATE_OWNERLESS_SETTLED_EXTERNAL=YES
MODEL_C_PUBLIC_RUNTIME_LIVE=NO
MODEL_C_PAID_RUNTIME_LIVE=NO
PAID_RUNTIME_CUTOVER_AUTHORIZED_NOW=NO
NEW_MODEL_C_NORMAL_VERSION_REQUIRED=YES
NEW_MODEL_C_QUIESCENCE_VERSION_REQUIRED=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-MODEL-C-LEGACY-BACKFILL-REMEDIATION
```
