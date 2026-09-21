# SETTLEMENT-ALERT-PROJECTION-READ-FIX-01

Status: **PASS_WITH_LIMITATION** — job_id fix implemented and qualified locally; `reconciliation_attempts` deliberately left unchanged (blocked by semantic ambiguity). Not deployed.

- Starting HEAD: `c006807bf036193340b6599a9f81539d62380c49` (branch `metadata-vcm-qualification`, working tree clean at start)
- Production release (unchanged, not touched): `3b35f9e7-6fb8-47e4-acff-c5736eff6da6` @ 100%

## 1. Problem

`manual_intervention_required` alerts carried `job_id = null` because `listUnresolvedSettlements` read `payment_attempts.job_id`. That column is null by design: the attempt is acquired before the job exists (migration 0002 header), and `job_id` is an input to the immutable binding digest (`packages/protocol-x402/src/replay/binding.ts`, `digestPayload`). Populating it later would change the digest and turn legitimate replays into `duplicate_conflict`. It therefore must not be written or backfilled.

## 2. Job-linkage authority

Durable relationships traced:

| Source | Available for an unresolved (`settlement_pending`) row? | Notes |
| --- | --- | --- |
| `payment_attempts.job_id` | Null in practice | Binding-digest input; must stay untouched |
| **`jobs.idempotency_key = payment_attempts.payment_identifier`** | **Yes** | `x402-service.ts:1119` creates the job with `idempotency_key: paymentIdentifier`; `idx_jobs_idempotency_key` is UNIQUE |
| `payment_workflow_owner_intents.workflow_input_json` → `metadata.job_id` | Yes, but requires JSON parsing of a blob | Not narrowest |
| `payment_service_link_evidence.job_id` | **No** — written only at settlement finalization | Absent exactly when the alert fires |
| `payment_attempt_reconciliations.evidence_ref` (`d1:jobs/<id>`) | Only for two classifications | Not general |

```
JOB_LINKAGE_READ_SOURCE=jobs.idempotency_key = payment_attempts.payment_identifier (LEFT JOIN, repositories/d1/payment-attempts.ts listUnresolvedSettlements)
JOB_LINKAGE_CARDINALITY=ONE_TO_ONE (at most one job per key; UNIQUE index)
JOB_LINKAGE_AMBIGUITY=NO
```

Determinism argument: a `settlement_pending` row can only exist after the same request flow created its job with that key. If a different flow had already taken that key, the x402 job insert would fail (500 `repository_failure`) and the attempt would never reach settlement. The join additionally requires `jobs.service_id = payment_attempts.service_id` and `jobs.input_hash = payment_attempts.request_input_hash` (both set from the same request in the same flow); a same-key job that disagrees on either is treated as no linkage, never as a match.

## 3. Immutable-binding safety

No write path, schema, or binding input was touched: the change is a single SELECT (adds a LEFT JOIN) plus a pure in-memory resolver. `git diff --name-only` = `payment-attempts.ts` (read method + helper), `settlement-alert-sweep.ts` (type + comment), one test file. No `migrations/` or `.sql` file changed.

```
PAYMENT_ATTEMPT_JOB_ID_WRITE_CHANGED=NO
BINDING_DIGEST_INPUTS_CHANGED=NO
REPLAY_SEMANTICS_CHANGED=NO
ALERT_JOB_ID_SOURCE=DERIVED_CANONICALLY
PAYMENT_ATTEMPTS_SCHEMA_CHANGED=NO
HISTORICAL_DATA_MUTATION=NO
```

Test C proves this at runtime: after `listUnresolvedSettlements`, `binding_digest` is byte-identical, `job_id` is still null, and re-acquiring with the identical binding is not `duplicate_conflict`/`first_seen`/`repository_error`.

## 4. Read-side implementation

`listUnresolvedSettlements` now returns `jobId` plus an internal `jobLinkage` classification so a null is never ambiguous:

| `jobLinkage` | Meaning | `jobId` |
| --- | --- | --- |
| `derived_from_jobs_idempotency_key` | Canonical `jobs.id` found | job id |
| `binding_recorded` | No derived job; attempt's own `job_id` populated (prior behavior kept) | that id |
| `conflict` | Derived job and attempt `job_id` disagree; neither trusted | null |
| `not_found` | No linkage | null |

`jobLinkage` is **not** copied into `SettlementAlertPayload`; the operator payload keys are unchanged (asserted in test H).

## 5. `reconciliation_attempts` semantic analysis

The alert field is populated from `payment_attempts.cdp_facilitator_settle_attempt_count`.

- **Writers:** only `recordCdpSettlementOutcome` (called at `paid-continuation-workflow.ts:691, 820`). It runs `UPDATE … lifecycle_stage='settlement_failed' … count = count + 1 WHERE lifecycle_stage = <from>`. `incrementCdpSettleAttemptCount` has no caller.
- **Readers:** the alert sweep and `getSettlementRecoveryRecord`.
- **Consequence:** legal transitions from `settlement_pending` are only `settled_external` and `settlement_failed` (`lifecycle/stage.ts`); nothing returns to `settlement_pending`. Every row that increments the counter therefore leaves the unresolved list. **For the population this query returns, the value is 0 by construction.**
- **Candidate alternative sources, rejected:**
  - `reconcileAmbiguousSettlement`'s bounded retry loop — in-memory, per Workflow invocation, never persisted (per the D10 note in the repository).
  - `payment_attempt_reconciliations` rows — written only by `recordProviderFailure` and `recordSettlementFinalizationUnresolved`; these are classification records with dedupe keys, not counts of reconciliation executions, and are not written for the ambiguous-`settlement_pending` path.

```
RECONCILIATION_ATTEMPTS_CANONICAL_MEANING=none authoritative (field name implies "reconciliation executions"; stored counter means "facilitator settle outcomes recorded", which is structurally 0 for settlement_pending rows)
RECONCILIATION_ATTEMPTS_CANONICAL_SOURCE=none
RECONCILIATION_ATTEMPTS_FIX=BLOCKED_BY_SEMANTIC_AMBIGUITY
```

Field left unchanged; limitation documented in code at the `toPayload` call site and here. The retry writer was not revived. Note for consumers: `reconciliation_attempts: 0` in these alerts is not evidence that no reconciliation was tried. Resolving this needs a decision on what the field should mean (and, if "executions", a new persisted count — a separate checkpoint).

## 6. Economic / evidence / write paths

Quote, requirement, verification, authorization, execution, assurance, settlement, receipt, PCC, result persistence, reconciliation and refund-required writes: untouched (no diff). `raw_evidence_hash`, `settlement_evidence_hash`, `service_output_hash`, `settled_at`, PCC digests, binding digests: untouched.

```
ECONOMIC_WRITE_PATH_CHANGED=NO
SETTLEMENT_WRITE_PATH_CHANGED=NO
RECONCILIATION_WRITE_PATH_CHANGED=NO
HASHED_EVIDENCE_CHANGED=NO
```

## 7. Alert contract scope

`manual_intervention_required` is emitted only by the settlement-alert Worker to the operator-configured `SETTLEMENT_ALERT_WEBHOOK_URL`. It is not referenced by any OpenAPI/schema/catalog/A2A/MCP artifact (grep of the tree: only the sweep source, its two test files, and the prior audit report).

```
ALERT_CONTRACT_SCOPE=internal-only (operator webhook)
PUBLIC_CONTRACT_CHANGED=NO
```

## 8. Tests

New suite in `apps/edge-api/tests/payment-attempts-unresolved-settlements.test.ts` (real D1/Miniflare, FK enforcement ON):

| Req | Test |
| --- | --- |
| A, B | linked job → correct `job_id`; stored `payment_attempts.job_id` stays null |
| C | binding digest unchanged; identical replay still not a conflict |
| D | unrelated job exists, none linked → null / `not_found` |
| E | UNIQUE index rejects a second job per key; same-key job with different `input_hash` → no match; different `service_id` → no match; attempt/derived disagreement → `conflict`, null |
| F | not applicable (no semantic fix implemented) |
| G | counter retained (0); row leaving `settlement_pending` drops from the list |
| H | alert payload has exactly the 8 documented keys; `jobLinkage` not exposed; `job_id` correct end to end through `runSettlementAlertSweep` |

Mutation check: run against the original source, 7 of the new tests fail (derivation, not_found, unique/guards, conflict, payload); C and G pass on both, as expected for invariants. Restored afterwards.

## 9. Qualification results

| Gate | Result |
| --- | --- |
| New + existing alert tests (2 files) | 26 passed |
| Focused suites (26 files: payment attempts, reconciliation, settlement, workflow, binding/replay, lifecycle, jobs) | 23 files passed, 3 env-gated files skipped; 341 tests passed, 30 skipped |
| `tsc --noEmit` (apps/edge-api) | exit 0 |
| eslint (3 changed files) | exit 0 |
| prettier | The 3 files **already fail `prettier --check` at HEAD** (pre-existing). Diff-line counts vs. HEAD baseline: 3→3, 5→5, 33→33, i.e. this change adds no new deviations. Files were not reformatted, to avoid unrelated churn. |
| Working-tree secret scan (`scripts/scan-working-tree-secrets.ts`, gitleaks) | OK, 1700 files, no leaks |
| Broad `vitest run` | **Not green**: 8 files / 28 tests failed under load (315 files passed, 22 skipped) |

Broad-suite failures (load): `a2a-metadata-shadow-adversarial`, `facilitator-verify-subclassification`, `load-v2` (4), `nevermined-live-migration-idempotency`, `production-cdp-full-stack-mock`, `production-route-continuation-wiring`, `worker-bridge.subprocess` (60 s timeout), `scripts/reconcile-payment-attempts.contract.test.ts` (18). Re-run of those 8 files together: 7 passed; the reconcile contract test had 1 failure. Re-run **alone**: 38/38 passed. I did not run the eight failures against a baseline checkout; none imports the changed code paths' behavior (only caller of `listUnresolvedSettlements` is the alert sweep), and all passed in isolation. Timeout was not modified.

```
SOURCE_QUALIFICATION=PASS_WITH_KNOWN_PREEXISTING_LOAD_FLAKE
KNOWN_BROAD_SUITE_FAILURE=reconcile-payment-attempts.contract.test.ts (plus 7 other files that also timed out under load and passed in isolation)
```

## 10. Artifact / runtime scope and deployment

- Only production caller of `listUnresolvedSettlements`: `settlement-alert-sweep.ts`, run by `wrangler.settlement-alert-worker.toml` (`siteborne-settlement-alert`, entry `settlement-alert-worker-entrypoint.ts`).
- The public Worker (`siteborne-utility-edge`) and continuation host (`siteborne-paid-continuation-runtime`) import the same repository class and so bundle the changed file, but never call this method; their behavior is unaffected. They should **not** be redeployed for this change.

```
AFFECTED_RUNTIME=siteborne-settlement-alert
PUBLIC_WORKER_AFFECTED=NO (bundle bytes differ; method unreachable)
CONTINUATION_HOST_AFFECTED=NO (bundle bytes differ; method unreachable)
DEPLOYMENT_REQUIRED=YES (to make the alert payload carry job_id in production)
DEPLOYMENT_TARGET=siteborne-settlement-alert
```

Not deployed. Requires separate authorization.

## 11. Cloud mutation accounting

```
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CLOUD_SECRET_MUTATIONS=0
REAL_PAYMENT_ATTEMPTS=0
```

Only local test runs against ephemeral Miniflare D1 were performed.

## 12. Next

`SETTLEMENT-ALERT-WORKER-DEPLOY-01` (deploy `siteborne-settlement-alert` only, human-boundary, verify one alert payload against a test double or the next real incident). Separately queue a semantic decision on `reconciliation_attempts`.
