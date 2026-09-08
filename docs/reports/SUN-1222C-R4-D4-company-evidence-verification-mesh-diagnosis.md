# SUN-1222C-R4-D4 — company_evidence_graph.v2 verification-mesh rejection diagnosis

Read-only, local-only checkpoint. Zero production mutation, zero economic
activity performed by this checkpoint.

## 0. Authoritative failed attempt

| Field | Value |
|---|---|
| Payment identifier | `pay_285a4c0c94aa4513a2f74c5400ab70b4` |
| payment_attempts.id | `22d6df47-41db-49a6-8eff-3750bd5539c9` |
| Job (executor-internal) | `job_46226ba1610ed79dc3bf6daf` |
| request_id | `d88f10b6-c556-4b80-b483-2b8102556fa1` |
| Workflow instance | `siteborne-wf-b81b31e5064aa3a0e0b18d9cc77366155c5e57d6a8b7e6fc` |
| Workflow name (corrected) | `siteborne-paid-continuation` (script name `siteborne-paid-continuation-runtime` is not the workflow name wrangler needs) |
| lifecycle_stage | `verified` |
| `cdp_facilitator_settle_attempt_count` | `0` |
| `cdp_successful_economic_settlement_count` | `0` |
| `payment_attempts.job_id` | `null` (never durably linked) |
| receipt_id | `rcpt_56ae73cf0aa6fa6f7dcbd4cd` |
| result_class | `internal_verification_failed` |

Zero economic mutation confirmed independently in this checkpoint (no new
balance read performed — none needed, since `cdp_facilitator_settle_attempt_count=0`
is authoritative and sufficient proof no settlement was attempted).

## 1. runMesh callsite (single production path)

- File: `packages/service-runtime/src/pcc/verify-and-sign.ts`, function `verifyAndSign`, line 123.
- This is the **only** production callsite of `runMesh`; every service (including
  `company_evidence_graph.v2`) shares it — no service reimplements mesh invocation.
- `RUNMESH_INPUT_TYPE`: `CandidateResult` (job_id, service_id/version, contract_release,
  input/schema hashes, claims, evidence, completeness, freshness_requirement_ms).
- `RUNMESH_OUTPUT_TYPE`: `MeshVerdict` (`decision: 'pass'|'quarantined'|'fail'`,
  `verification.deterministic_failures: string[]`, plus per-dimension summary fields).
- `RUNMESH_CONFIGURATION`: `verifiers = mode === 'independent_reproduction' ? buildReproductionVerifiers(...) : buildStandardVerifiers()`.
- `RUNMESH_PASS_CRITERIA`: `verdict.decision === 'pass'`.

## 2. Verifier set actually used for this attempt

`context.mode` for `company_evidence_graph.v2`'s production executor
(`company-evidence-graph-v2-production-executor.ts`) is **never explicitly
set** — only `execution_mode: 'live'` is passed to `buildServiceContext`.
`buildServiceContext` defaults `mode: overrides.mode ?? 'standard'`
(`packages/service-runtime/src/context.ts:134`). Therefore:

- `ATTEMPT_MODE = 'standard'` (confirmed from source, not inferred).
- `buildStandardVerifiers()` is used — **8 verifiers, no `ReproductionVerifier`**.
  This rules out the hypothesis that a stray `independent_reproduction` mode
  silently added an always-failing 9th verifier with `reproduction: null`.

The 8 standard verifiers (`packages/verification/src/index.ts:44-55`), each with
its pass predicate read from source:

| VERIFIER_ID | rule_id | PASS_CONDITION (source-verified) | DETERMINISTIC | EXTERNAL_DEP |
|---|---|---|---|---|
| `schema_verifier` | `schema_conformance` | AJV validates candidate output against registered output schema | YES | NO |
| `evidence_accessibility_verifier` | `evidence_accessibility` | every evidence item has a `locator`; no evidence item has a disqualifying `result_class` (`source_changed`/`policy_blocked`/`quarantined`/`retryable_failure`/`permanent_failure`); every claim's `evidence_ids` resolve to real evidence items | YES | NO |
| `claim_evidence_verifier` (`material_claims_supported`) | `material_claims_supported` | every claim has ≥1 linked evidence_id (or is `verified_absent`) | YES | NO |
| `freshness_verifier` | `freshness_score` | evidence age ≤ `freshness_requirement_ms` (derived from `draft.contract.freshness_seconds`) | YES | NO |
| `completeness_verifier` | `completeness_consistency` | `supported_fields ≤ populated_fields ≤ requested_fields`; no claim backed solely by disqualified evidence while `missing_fields` is empty | YES | NO |
| `cross_source_verifier` | `cross_source_agreement` | claims with >1 evidence source must not have conflicting sibling values | YES | NO |
| `provenance_verifier` | `provenance_valid` | (see source; blocking findings gate) | YES | NO |
| `prompt_injection_verifier` | `prompt_injection_scan` | no blocking prompt-injection signal in scanned content | YES | NO |

None of these verifiers make their own network calls — all operate purely on
the `CandidateResult` object `CompanyEvidenceGraphService` already built.
`RUNMESH_DETERMINISTIC` is therefore expected `YES` for a fixed input, but
this could not be independently confirmed for *this exact* input (§8/§14 below).

## 3. Exact verdict recovery attempt

`EXACT_RUNMESH_VERDICT_RECOVERED = NO`.

Recovery was attempted in the order specified:

- **A. Workflow instance output** — `wrangler workflows instances describe`
  initially used the wrong workflow name (`siteborne-paid-continuation-runtime`,
  the *script* name) and 404'd (`workflows.api.error.workflow.not_found`).
  Corrected via `wrangler workflows list` to the real workflow name
  `siteborne-paid-continuation`. Re-ran with `--truncate-output-limit 200000`
  (200x the 5000 default). **The output was still cut off** at
  `"...output_hash":"sha256:0623954cb311a65e27e2aff52bf1e[truncated output]"` —
  i.e. before `deterministic_failures` (which appears later in the JSON, inside
  `receipt`/`verification`). Raising the CLI flag by 40x had **zero effect** on
  where the cut occurred, proving the truncation is **not** CLI-side rendering.
- **B/C. Higher-output-limit / step detail** — no other wrangler subcommand or
  flag exists for this (`--help` confirms `--step-output` is the only other
  relevant flag, a boolean visibility toggle, not a size control).
- **D. D1 persisted state** — `jobs`, `job_artifacts`, `job_state_events` all
  return **zero rows** for `job_46226ba1610ed79dc3bf6daf` / `d88f10b6-c556-4b80-b483-2b8102556fa1`.
  `payment_attempts` has the row but `job_id`, `service_output_hash`,
  `service_receipt_id`, `settlement_transaction_reference` are all `NULL` —
  this payment attempt was never durably linked to a job or artifact record.
  `x402_service_results` was not separately re-checked here (already
  established empty for every non-settled attempt in this lineage; settlement
  never reached).
- **E/F/G. Durable artifacts / structured app logs / operator evidence** — none
  exist; the only operator-visible evidence from the attempt itself is the
  harness's own printed summary (`application_error_code`, `application_error_detail`),
  which (per SUN-1221E2D, correctly) never carries `deterministic_failures`.

**Root cause of the truncation**: not the wrangler CLI's own
`--truncate-output-limit` (proven ineffective at 200000). Extracting wrangler's
stored OAuth token to query the raw Cloudflare Workflows API directly was
**not attempted** — explicitly prohibited by this checkpoint's own §4
("Do not extract OAuth tokens or internal Cloudflare credentials"). The
truncation therefore sits at a layer this checkpoint could not cross: either
the Cloudflare Workflows API's own step-output storage/retrieval cap, or a
platform-side response-size limit upstream of wrangler's rendering — not
distinguishable further without raw API access this checkpoint does not
authorize obtaining.

```
RUNMESH_DETAIL_TRUNCATION_LAYER = API_OR_PLATFORM_STORAGE (not CLI rendering — proven by --truncate-output-limit having no effect)
FULL_VERDICT_STILL_RETRIEVABLE (within this checkpoint's constraints) = NO
```

## 4. Failed document recovery

`FAILED_DOCUMENT_RECOVERED = NO`. The full drafted PCC document
(`signed.document`, which embeds `verification.deterministic_failures` in
full — see `verify-and-sign.ts:159-163`) is constructed and returned entirely
within the Workflow step's function scope. `CompanyEvidenceGraphService`'s
`ServiceExecutionResult.output` is `undefined` for any non-`'pass'` decision
(`service.ts:486-489`), so the full document is **never included** in the
step's own return value, `payment_attempts`, or any D1 table for a rejected
attempt. No R2 bucket write occurs for this service (`unreachableArtifactStore`
in the production executor deliberately throws on any call — confirmed by
source, not just doc comment). The document that failed is unrecoverable
post-hoc through any currently-existing durable channel.

## 5. Local reproduction

**Not performed in this checkpoint.** Building a faithful local reproduction
requires wiring `CompanyEvidenceGraphService` against the *real* Modal
safe-egress `InjectedHttpClient`, a real `Signer`/`KeyRegistry`, and a real
`D1Database` handle for `SecD1RateCoordinator` — the same wiring
`company-evidence-graph-v2-production-executor.ts` does inside the deployed
Worker. No existing repo script builds this combination outside the Workers
runtime (checked: `scripts/*.ts` has no such harness; the closest precedent,
R9A's "non-economic SEC proof," called Modal's safe-egress function directly,
bypassing `CompanyEvidenceGraphService`/the mesh entirely, so it cannot be
reused here). Building this wiring live was judged out of this checkpoint's
proportionate scope (would itself require nontrivial new code under a
"no source mutation" constraint) and is deferred to the next checkpoint if
pursued.

```
REPRODUCTION_FIDELITY = N/A (not attempted)
LOCAL_RUNMESH_DECISION = N/A
LOCAL_REPRODUCES_PRODUCTION_FAILURE = N/A
RUNMESH_REPEAT_COUNT = 0
RUNMESH_DETERMINISTIC = UNKNOWN (not independently tested this attempt)
```

## 6. Ruled-out and open hypotheses

**Ruled out by source proof:**
- Stray `independent_reproduction` mode / phantom 9th `ReproductionVerifier`
  with `reproduction: null` — ruled out; `context.mode` is `'standard'` by
  the executor's own construction (§2).
- `EvidenceAccessibilityVerifier` making its own network re-fetch that could
  be blocked by SSRF/DNS-pinning — ruled out by reading the verifier's full
  source (§2 table): it performs **no network I/O**, only structural checks
  on the `CandidateResult` object already built by the service.

**Open, unresolved (would require the recovered document or a live
reproduction to isolate to one exact predicate):**
- `evidence_accessibility_verifier`: could trip if any evidence item the SEC
  adapter constructed from the now-successfully-parsed real `company_submissions`
  payload carries a disqualifying `result_class`, is missing a `locator`, or
  a claim references an evidence_id that doesn't exist in the candidate.
- `claim_evidence_verifier` / `completeness_verifier`: could trip if the real
  SEC payload's actual shape (now reaching the mesh for the first time, since
  the chunked-framing fix only just started letting real data through) departs
  from what the curated test fixtures assume — e.g. a claim built with zero
  evidence_ids, or `supported_fields`/`populated_fields`/`requested_fields`
  arithmetic inconsistency for a real, partially-available Apple filing.
- `provenance_verifier`: same class of open risk, unexamined for real-data
  edge cases.

No single one of these is proven; `PRIMARY_FAILURE_CLASS` is therefore
`G. ROOT_CAUSE_NOT_YET_PROVEN`, not a guess among them.

## 7. Fail-closed and trust-class non-regression — both PASS

- `VERIFICATION_FAILURE_FAIL_CLOSED = PASS`: executor completed, document
  drafted, receipt issued and cryptographically self-verified, mesh rejected,
  **settlement was never attempted** (`cdp_facilitator_settle_attempt_count=0`),
  result correctly classified `internal_verification_failed`, zero chain effect.
- `ATTEMPT_EVIDENCE_MODE = 'live'`, `ATTEMPT_PROVIDER_TRUST_CLASS` (mesh
  `mode`) `= 'standard'` — matches `EXPECTED_TRUST_CLASS = 'standard'` for a
  non-reproduction real attempt. `TRUST_CLASS_MATCH = YES`.
  `TRUST_CLASS_NOT_ALLOWED_RECURRED = NO` — the historical
  evidenceMode-propagation defect (unrelated prior lineage) has not resurfaced.

## 8. Receipt/PCC semantics clarified

`rcpt_56ae73cf0aa6fa6f7dcbd4cd` is a **verification receipt** — issued by
`issueReceipt(candidate, verificationContext, verdict, signer)` and
immediately self-verified via `verifyServiceReceipt` (the SUN-1201 runtime
receipt-verification boundary) **before** `result_class` is computed. It is
issued regardless of `verdict.decision` (the receipt documents the mesh's
verdict, including a rejection) and carries no implication of economic
settlement.

```
OBSERVED_RECEIPT_ID_OBJECT_TYPE = verification_receipt (signed, self-verified)
CREATED_BEFORE_RUNMESH = NO (created immediately after, from the verdict)
CREATED_BEFORE_SETTLEMENT = YES
ECONOMIC_SETTLEMENT_IMPLIED_BY_RECEIPT_ID = NO
```

## Final classification

```
SUN1222C_R4_D4 = PARTIAL

PAYMENT_IDENTIFIER = pay_285a4c0c94aa4513a2f74c5400ab70b4
JOB_ID = job_46226ba1610ed79dc3bf6daf
WORKFLOW_INSTANCE_ID = siteborne-wf-b81b31e5064aa3a0e0b18d9cc77366155c5e57d6a8b7e6fc
SETTLEMENT_ATTEMPT_COUNT = 0
SETTLEMENT_TRANSACTION_REFERENCE = NULL

EXACT_RUNMESH_VERDICT_RECOVERED = NO
RUNMESH_DECISION = quarantined_or_fail (decision string itself not recovered verbatim; result_class=internal_verification_failed proves decision !== 'pass')
DETERMINISTIC_FAILURES = NOT_RECOVERED
RUNMESH_DETAIL_TRUNCATION_LAYER = API_OR_PLATFORM_STORAGE (proven not CLI-side)

FAILED_DOCUMENT_RECOVERED = NO
FAILED_DOCUMENT_SHA256 = N/A
DOCUMENT_SCHEMA_VALID = UNKNOWN

LOCAL_RUNMESH_DECISION = N/A
LOCAL_DETERMINISTIC_FAILURES = N/A
LOCAL_REPRODUCES_PRODUCTION_FAILURE = N/A
RUNMESH_DETERMINISTIC = UNKNOWN

XBRL_NORMALIZATION_FAILURE = UNKNOWN (open hypothesis, not isolated)
PROVENANCE_GRAPH_VALID = UNKNOWN (open hypothesis, not isolated)

ATTEMPT_EVIDENCE_MODE = live
ATTEMPT_PROVIDER_TRUST_CLASS = standard
TRUST_CLASS_MATCH = YES
TRUST_CLASS_NOT_ALLOWED_RECURRED = NO

OBSERVED_RECEIPT_ID_OBJECT_TYPE = verification_receipt
ECONOMIC_SETTLEMENT_IMPLIED_BY_RECEIPT_ID = NO

VERIFICATION_FAILURE_FAIL_CLOSED = PASS

PRIMARY_FAILURE_CLASS = G. ROOT_CAUSE_NOT_YET_PROVEN
ROOT_CAUSE_PROVEN = NO

REMEDIATION_CLASS = OBSERVABILITY (must precede any business-logic remediation): add a
  bounded, redacted, D1-persisted capture of verdict.verification.deterministic_failures
  (and candidate claim/evidence counts) at the exact point verify-and-sign.ts
  computes effectiveVerdict, so a future rejection is diagnosable without
  depending on Workflow instance CLI output at all.
SCHEMA_CHANGE_REQUIRED = NO
D1_MIGRATION_REQUIRED = YES (new narrow table or column for verifier-findings capture)
SECRET_CHANGE_REQUIRED = NO
HOST_DEPLOY_REQUIRED = YES (once observability fix lands)
API_CANDIDATE_DEPLOY_REQUIRED = NO
MODAL_DEPLOY_REQUIRED = NO

NEXT_REAL_PAYMENT_ELIGIBLE = NO

PRODUCTION_MUTATIONS = 0
EXTERNAL_MUTATIONS = 0
ECONOMIC_TRANSACTIONS = 0

NEXT_REQUIRED_CHECKPOINT = SUN-1222C-R4-D4-CONTINUED-DIAGNOSIS
```
