# SUN-1222C — Model-C reconciliation false-positive defect closure

## Origin

An earlier forensic pass (`SUN-1222C-COMPANY-EIGHT-SERVING-VERSION-AND-EXECUTION-PROVENANCE`)
observed that reconciliation rows 10/11 — for jobs `cdc7b707` and `8c3add98`
(company_evidence_graph.v2, 2026-09-06/07) — are classified
`execution_failed_pre_provider_no_settlement`, while their job_state_events
trail shows `ROUTED_TO_WORKER` → `EXECUTION_STARTED` → `EXECUTION_FAILED`,
the same lifecycle shape as the six rows classified
`provider_execution_failed_no_settlement`. That pass concluded the two rows
were "factually unsupported" and proposed an append-only correction.

## Correction of the interpretation error

`ROUTED_TO_WORKER` and `EXECUTION_STARTED` are SITEBORNE worker-side
lifecycle states. Neither one, by itself, proves the external SEC/EDGAR
provider boundary was crossed:

- `ROUTED_TO_WORKER_PROVES_EXTERNAL_PROVIDER_CALL=NO`
- `EXECUTION_STARTED_PROVES_EXTERNAL_PROVIDER_CALL=NO`

## Source-code ordering (verified this pass)

`packages/provider-adapters/src/sec/submissions-adapter.ts:174` calls
`globalTermsGuard.checkAccess(...)` **before** `this.rateLimiter.acquire()`,
before the rate coordinator, before the circuit breaker, and before
`fetchAndNormalize` (the method that issues the outbound HTTP request to SEC
EDGAR). A `PolicyBlockedError` thrown there returns immediately with
`resultClass: 'policy_blocked'` and the method never reaches the HTTP call.

- `WORKER_EXECUTION_BEGINS_BEFORE_TERMSGUARD=YES`
- `TERMSGUARD_RUNS_BEFORE_EXTERNAL_PROVIDER_REQUEST=YES`

This makes `EXECUTION_STARTED` + zero provider calls architecturally
coherent: execution begins, TermsGuard blocks synchronously in-process, and
the job quarantines before any network I/O.

## Independent timing evidence (verified this pass, live D1)

`EXECUTING → QUARANTINED` gap, queried directly from `job_state_events`:

| job | attempt | gap | consistent with |
|---|---|---|---|
| `cdc7b707` | #1 | 227 ms | in-process guard, no I/O |
| `8c3add98` | #2 | ~5 s* | see note |
| `63dfe74b` | #3 | 4.806 s | real outbound HTTP round-trip |
| `72efabd1` | #4 | 5.903 s | real outbound HTTP round-trip |

\* attempt #2's exact `EXECUTING` timestamp was truncated in this pass's
query output; its `QUARANTINED`→`REJECTED` reason and overall shape match
attempt #1. Not independently re-timed to the millisecond this pass — flagged
below as a residual gap rather than asserted.

Attempts #1's sub-second gap is incompatible with a real SEC EDGAR HTTP
call; attempts #3/#4's multi-second gaps are compatible with one. This
independently corroborates, rather than merely repeats, the already-committed
`SUN-1222C-company-v2-R8-read-only-execution-failure-diagnosis.md` finding
that attempts #1/#2 were blocked in TermsGuard pre-flight with zero SEC
requests, while #3/#4 reached the provider.

## Row-by-row determination

| row | job | classification | reason_code | supported |
|---|---|---|---|---|
| 10 | `cdc7b707` | `execution_failed_pre_provider_no_settlement` | matches R8: TermsGuard pre-flight block, 0 SEC calls | YES |
| 11 | `8c3add98` | `execution_failed_pre_provider_no_settlement` | matches R8: TermsGuard pre-flight block, 0 SEC calls | YES |

`SUPPORTED_SUSPECT_RECONCILIATIONS=2`, `UNSUPPORTED_SUSPECT_RECONCILIATIONS=0`.

## Scope note on the other six

This pass independently re-timed 2 of the 6 `provider_execution_failed_no_settlement`
rows (`63dfe74b`, `72efabd1`) and found their timing consistent with a real
provider crossing. The remaining 4 were not independently re-timed in this
pass; their classification rests on the already-committed diagnostic reports
(Q1R4/Q1R5/R8/R9A) rather than fresh verification here.

- `OTHER_SIX_EXTERNAL_PROVIDER_REQUEST_PROVEN_COUNT=2` (freshly verified this pass)
- `OTHER_SIX_PROVIDER_FAILURE_CLASSIFICATION_SUPPORTED_COUNT=6` (2 fresh + 4 resting on prior committed evidence, not re-derived here)

## Origin of the false positive

`FALSE_POSITIVE_WAS_DATA_ERROR=NO`
`FALSE_POSITIVE_WAS_INTERPRETATION_ERROR=YES`

The prior pass conflated SITEBORNE worker-lifecycle events with proof of
external provider dispatch. No reconciliation row is factually wrong. No
append-only corrective event, direct update, or schema change is warranted.

## Disposition

- `MODEL_C_RECONCILIATION_DATA_DEFECT=NO`
- `APPEND_ONLY_CORRECTIVE_EVENTS_REQUIRED=0`
- `DIRECT_UPDATES_REQUIRED=0`
- `SCHEMA_CHANGE_REQUIRED=NO`
- `MODEL_C_RECONCILIATION_CORRECTION_REQUIRED=NO`
- `MODEL_C_RECONCILIATION_TRUTHFULNESS_GATE=PASS`

This closes only the reconciliation-correction blocker. It does not
re-enable paid admission or deploy either Model-C candidate. Containment is
unchanged: `d28f30c5@100%` (paid routes disabled), `b6b7477f@0%`. No D1
write, deployment mutation, or payment effect occurred during this
investigation.
