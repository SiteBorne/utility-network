# SUN-1222C Model-C legacy-backfill remediation

Date: 2026-09-11 (America/Chicago)

## Decision

`SUN1222C_PCC_MODEL_C_LEGACY_BACKFILL_REMEDIATION=PASS`.

The controlled operator and governed 17-row plan now satisfy the evidence,
preimage, all-or-nothing transaction, and idempotency contracts that blocked the
previous production checkpoint. This remediation performed read-only production
queries only. Migration 0010 remains unapplied, the Model-C production tables
remain absent, and no production row was inserted, updated, or deleted.

The separate MCP tool-definition remediation requested after this checkpoint's
original contract is recorded in
`docs/reports/SUN-1222C-mcp-tool-definition-quality-remediation.md`. It changes
MCP metadata only and does not change the Model-C lifecycle domain semantics.

## Integrity and commits

```text
START_EVIDENCE_COMMIT=737493beadaa5e84f9b8ed77edd603f387d68655
MODEL_C_SOURCE_COMMIT=74290db10e1eb4a3d266e9310ebe5b2dad177ce4
EVIDENCE_COMMIT_SHA=21afdd282c5ed2d1e94f35c607c8350f2dbe5dca
OPERATOR_REMEDIATION_COMMIT_SHA=9b39a826fe4271303b0abc3be08daea0b0a293c8
```

Migration 0010 remained byte-for-byte unchanged. Its SHA-256 at the failed
authorization commit and after this remediation is:

```text
83f95242ff2788cbee29e00e2a52c3b268f23eb265a7c01a690f67b4634107d9
```

## The four reproduced defects and repairs

1. **Unresolvable evidence references.** The prior 17 Markdown fragments had no
   corresponding anchors. A first, separate commit created a strict,
   machine-readable evidence index with one unique evidence identifier for each
   attempt. Every plan reference is now commit-pinned and resolves through Git.
2. **Incomplete remote preimage contract.** The old operator treated a count of
   17 as sufficient. The repaired operator compares service, lifecycle stage,
   local SHA-256 of the payment identifier, correlated job cardinality/ID/state,
   settlement-reference presence, creation time, evidence, and current
   reconciliation state for every row.
3. **Partial success hidden by conflict skipping.** The governed apply contains
   no `ON CONFLICT ... DO NOTHING`. Every insert carries exact preconditions
   inside the same transactional multi-statement D1 batch. A mismatch produces a
   statement failure through the target table's required `id`, rolling back
   earlier statements. Success is accepted only when trustworthy per-statement
   change metadata sums to 17 and the immediate postimage contains all 17 exact
   events.
4. **False post-apply dry-run.** The operator now distinguishes a fresh plan,
   the one valid exact idempotent postimage, and every conflict/partial state. A
   second dry-run after a successful isolated apply reports zero to insert, 17
   already reconciled, zero preimage conflicts, and no mutation required. A
   second apply is a successful zero-write no-op.

The original TDD red run reproduced all four defects before the implementation
was replaced. The final operator suite passes 38 tests.

## Evidence-reference contract

The selected scheme is:

```text
git-evidence:v1:<40-hex-commit>:docs/evidence/<index>.json#<unique-evidence-id>
```

The resolver first proves that the commit exists, reads the exact JSON object
from that commit, validates its strict schema, requires exactly one matching
evidence ID, and matches the plan's attempt ID, correlated job ID,
classification, and reason code. Only `docs/evidence/*.json` is accepted.
Unsupported paths, malformed references, missing files/IDs, duplicated targets,
wrong attempts/jobs/classifications/reasons, and wrong commit identity fail
closed.

```text
EVIDENCE_REFERENCE_SCHEME=GIT_COMMIT_PINNED_MACHINE_READABLE_EVIDENCE_INDEX_V1
PLAN_EVIDENCE_REFS=17
RESOLVABLE_EVIDENCE_REFS=17
UNRESOLVABLE_EVIDENCE_REFS=0
DUPLICATE_EVIDENCE_TARGETS=0
EVIDENCE_REF_NEGATIVE_TESTS=PASS
```

No payment authorization, signature, bearer material, credential, secret, or
private provider payload is stored in the evidence index. Payment identifiers
are represented in the governed plan only by SHA-256 fingerprints and are never
printed by the operator.

## Governed plan and exact preimage

The plan is a strict array of exactly 17 entries in explicit sequence order 1
through 17. Unknown fields and unknown classifications are rejected. Each entry
includes:

```text
sequence
payment_attempt_id
expected_service_id
expected_lifecycle_stage
expected_payment_identifier_sha256
expected_correlated_job_id
expected_correlated_job_state
expected_settlement_reference_present
expected_created_at
classification
reason_code
evidence_ref
actionability
owner_kind
cutover_blocking_after_review
reconciliation_id
dedupe_key
```

All attempt IDs, payment-identifier fingerprints, job IDs, evidence refs,
reconciliation IDs, dedupe keys, and sequences must be unique. Dedupe and
reconciliation IDs are deterministically bound to the attempt and sequence.
Settlement-reference expectations must agree with the classification.

The authoritative correlation is exactly:

```text
jobs.idempotency_key=payment_attempts.payment_identifier
```

Every attempt must correlate to exactly one job; zero or multiple jobs are
preimage conflicts.

## Whole-plan and transaction contract

The operator has exactly three whole-plan states:

- `FRESH_APPLY`: all 17 complete preimages match and no relevant reconciliation
  event, ID, or dedupe key exists; exactly 17 rows are planned.
- `EXACT_IDEMPOTENT_NOOP`: all 17 preimages still match and all 17 exact
  governed events exist; zero rows are planned and no mutation is required.
- `CONFLICT`: every other state, including 1-16 exact preexisting rows, any
  wrong event content, an extra/superseding event, source-preimage drift,
  evidence failure, or schema mismatch; apply is blocked.

Inside the fresh-apply transaction, each statement reasserts the exact raw
payment identifier captured only after its governed fingerprint matched, plus
the attempt, service, stage, created time, exact single job, job state,
settlement presence, and absence of any event/ID/dedupe collision. A false
predicate attempts a NULL required ID and fails the batch instead of succeeding
with zero changed rows. Cloudflare documents `wrangler d1 execute --command` as
supporting semicolon-separated statements and the D1 query API as executing
multiple statements as a batch:
[Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)
and
[D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).

The actual operator path was exercised against isolated Miniflare D1, not a
mocked transaction facade:

```text
GOLDEN_OPERATOR_FLOW=PASS
INSERT_RESULT_CHANGE_COUNT=17
POST_APPLY_EXACT_EXPECTED_EVENT_COUNT=17
SECOND_APPLY_NEW_ROWS=0
PARTIAL_ALREADY_RECONCILED_PLAN_BEHAVIOR=CONFLICT
GOVERNED_APPLY_CONTAINS_ON_CONFLICT_DO_NOTHING=NO
EXACTLY_17_OR_ZERO_GUARANTEE=YES
TRANSACTIONAL_PREIMAGE_ASSERTIONS=PASS
ZERO_ROW_PREIMAGE_MISMATCH_FAILS_TRANSACTION=YES
ACTUAL_OPERATOR_D1_TRANSACTION_ROLLBACK=PASS
```

Transaction rollback was proven with post-preflight drift at plan rows 1, 9,
and 17. Every case durably inserted zero rows. A conflicting row introduced
after preflight also caused zero new governed rows. A separate test forces
incorrect result metadata (`16`) after an exact durable 17-row batch and proves
that the operator refuses to report success unless both change metadata and the
postimage agree.

## Test matrices

The 38-test operator suite covers:

- the successful dry-run/apply/dry-run/apply golden flow;
- migration-absent readiness;
- lifecycle, service, payment-identifier, job-ID, job-state,
  settlement-presence, created-time, missing-attempt, zero-job, and
  duplicate-job preimage mutants;
- missing/wrong/malformed/unsupported/duplicate commit-pinned evidence;
- 1, 8, and 16 exact preexisting events as conflicts;
- 17 exact events as the only no-op;
- wrong classification, evidence, actionability, owner kind, and dedupe key;
- an extra superseding event;
- actual D1 rollback at early, middle, and late statements;
- no conflict-skipping SQL, no zero-row success, and exact inserted-count
  enforcement; and
- a CommonJS-compatible, explicit-mode CLI entrypoint.

```text
OPERATOR_TEST_FILES=scripts/reconcile-payment-attempts.contract.test.ts
OPERATOR_TESTS_PASSED=38
OPERATOR_TESTS_FAILED=0
PREIMAGE_CONTRACT_NEGATIVE_TESTS=PASS
RECONCILIATION_STATE_NEGATIVE_TESTS=PASS
BACKFILL_OPERATOR_MUTATION_TESTS=PASS
D1_TRANSACTION_TESTS=PASS
```

The focused Model-C regression set passed 83 tests across eight runtime test
files, including append-only reconciliation, owner intents/recovery,
finalization, ownership-aware drain gating, route handoff, production-registry
orchestration, and sole settlement ownership. The Model-C 14-test mutation
matrix also passed (unmutated control plus all 13 source-architecture mutants
killed).

## Read-only production preflight

The repaired command was run in `--dry-run --remote` mode only against
`siteborne-utility`. Wrangler was the pinned project version `4.119.0`.

```text
REMOTE_READ_ONLY_PREFLIGHT=PASS
ROWS_PLANNED=17
ROWS_WITH_PREIMAGE_MATCH=17
PRODUCTION_PLAN_IDS_FOUND=17
PRODUCTION_STAGE_MATCHES=17
PRODUCTION_SERVICE_MATCHES=17
PRODUCTION_PAYMENT_IDENTIFIER_MATCHES=17
PRODUCTION_CORRELATED_JOB_MATCHES=17
PRODUCTION_JOB_STATE_MATCHES=17
PRODUCTION_SETTLEMENT_PRESENCE_MATCHES=17
EVIDENCE_REF_FAILURES=0
MODEL_C_SCHEMA_READY=NO
RECONCILIATION_APPLY_READY=NO_SCHEMA_MISSING
PLANNED_MUTATIONS=0
REMOTE_READ_ONLY_PREFLIGHT_D1_WRITES=0
```

The first CLI attempt stopped locally on a CommonJS/top-level-await compilation
error and made no Cloudflare request. A second launch exposed only child
Wrangler's error stream because npm warnings masked its JSON output. Both
entrypoint/error-propagation defects were corrected, tested, and the final
read-only invocation then produced the complete machine-readable result above.

The final 2026-09-12 revalidation initially received Cloudflare API error 7403
before a D1 query was accepted. A read-only `wrangler whoami` confirmed the
expected account and refreshed OAuth context; one bounded retry of the same
`--dry-run --remote` command then succeeded with the same 17/17 result. The
rejected attempt did not reach D1, and neither invocation requested apply or
performed a write.

## Final verification

Fresh final verification on 2026-09-12 produced:

```text
PINNED_WRANGLER_VERSION=4.119.0
TYPECHECK=PASS (23/23 TURBO TASKS)
LINT=PASS (16/16 TURBO TASKS)
BACKFILL_OPERATOR_TESTS=PASS (38/38)
MODEL_C_RUNTIME_REGRESSION_TESTS=PASS (83/83)
COMBINED_FOCUSED_TESTS=PASS (121/121 ACROSS 9 FILES)
D1_TRANSACTION_TESTS=PASS
BACKFILL_OPERATOR_MUTATION_TESTS=PASS
DOCUMENT_FORMAT_CHECK=PASS
CHANGED_FILE_FORMAT_CHECK=PASS (13/13 REMEDIATION FILES)
GIT_DIFF_CHECK=PASS
NEW_SECRET_FINDINGS=0
SECRET_SCAN=PASS (790 COMMITS AND WORKING TREE)
```

The repository-wide `pnpm format:check` remains blocked by 246 previously
committed files outside this remediation. None of the 13 files added or changed
by the combined operator/evidence/MCP-metadata remediation appears in that
finding set. The historical corpus was not reformatted because that would be a
large unrelated change; the requested document and changed-file formatting gates
passed independently.

## Future operation—fresh authority required

This report does not authorize migration or classification. A future production
checkpoint must verify the exact source/evidence commits and topology, confirm
0010 is the only unapplied migration, revalidate the 17 source preimages, apply
0010 once, prove old-runtime compatibility, require a first remote dry-run of
`FRESH_APPLY / 17 to insert / 0 already / 0 conflicts`, separately authorize one
apply, require change metadata and exact postimage both equal 17, then require a
second dry-run of:

```text
WHOLE_PLAN_STATE=EXACT_IDEMPOTENT_NOOP
ROWS_PLANNED=17
ROWS_TO_INSERT=0
ROWS_ALREADY_RECONCILED=17
PREIMAGE_CONFLICTS=0
NO_MUTATION_REQUIRED=YES
```

The raw historical lifecycle count remains 17. Only the ownership-aware Model-C
gate may become zero for these explicitly reviewed non-actionable rows.

## Mutation and economic accounting

```text
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
NEW_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
FRESH_PRODUCTION_AUTHORITY_REQUIRED=YES
```
