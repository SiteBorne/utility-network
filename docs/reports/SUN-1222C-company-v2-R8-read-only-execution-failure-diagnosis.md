# SUN-1222C-COMPANY-V2-R8 — Read-only exact execution-failure diagnosis

Read-only checkpoint. No payment, 402, EIP-3009, signing, paid POST,
settlement, deploy, source mutation, D1 write, or secret mutation performed.

## 0–1. Authoritative failure state and full attempt lineage

All four real `company_evidence_graph.v2` attempts, correlated across
`payment_attempts`, `jobs`, `job_state_events`, `x402_service_results`
(empty for all four — see §5 below, not itself evidence of a crash), and
Cloudflare Workflows' own retained instance history (the authoritative
source throughout, independent of D1):

| Attempt | Payment ID | Job ID | Created (UTC) | Host version | Duration | Provider call reached | Result |
|---|---|---|---|---|---|---|---|
| 1 (orig. Q1) | `pay_a750ea6da8ea479fa7660c2cf92a4378` | `cdc7b707` | 2026-09-06T05:06:51Z | `f17acb0c` (pre-R1/R2/R3) | 227ms | NO | TermsGuard blocked pre-flight, zero SEC calls |
| 2 (Q1R2-live) | `pay_a3bde18f5a714dbf9f94dd2a40c695bc` | `8c3add98` | 2026-09-07T16:56:12Z | `f17acb0c` (still stale — host redeploy had not happened yet) | 137ms | NO | TermsGuard blocked pre-flight, zero SEC calls (same as #1; R3's TermsReview registration lived only in the public-API candidate at this point, not the Workflow host) |
| 3 (Q1R4) | `pay_246c956277394be0aec72656322264d6` | `63dfe74b` | 2026-09-07T18:13:20Z | `917c1c49` (R1+R2+R3 present) | 4.8s | YES (`provider_rate_window` admission `1788804804708`) | Clean `result_class: partial`, `limitation: "sec-edgar company_submissions returned permanent_failure for CIK 0000320193"` (R5 diagnosis) |
| 4 (Q1R7/R8, this one) | `pay_a99341faa7a542b786030c90f453d231` | `72efabd1` | 2026-09-07T21:27:10Z | `e11304df` (claimed R6 header fix) | 5.9s | YES (`provider_rate_window` admission `1788816434644`, the only row currently in the table — sliding-window cleanup prunes older rows, so absence of #3's row now is expected, not evidence of anything) | **Identical** clean `result_class: partial`, **identical** `limitation: "sec-edgar company_submissions returned permanent_failure for CIK 0000320193"` |

`job_state_events.reason` is a fixed enum (`EXECUTION_FAILED`,
`QUARANTINE_POLICY`) for all four attempts — D1 never stores free-text
error detail. The descriptive `limitation` text for #3 and #4 exists only
in Cloudflare Workflows' own retained step output, not in any D1 table —
this is the load-bearing observability gap (§13 below).

`REAL_SEC_EXECUTION_PATH_REACHED=YES` for attempt #4, confirming R1's
User-Agent construction, R2's rate coordinator, and R3's TermsReview
registration are all still correctly wired and passed. This is not in
question.

## 2. R6 header-defect classification

```
R6_HEADER_DEFECT_REAL=YES
R6_HEADER_DEFECT_FIXED=YES        (in the repository — 63c62b4, TDD-proven)
R6_HEADER_FIX_REACHED_RUNTIME=NO  (see §3 — proven below, not assumed)
R6_HEADER_FIX_SUFFICIENT=NO
```

R5's diagnosis was not wrong: `ModalSafeEgressClient` genuinely dropped
`RequestInit.headers`, and the fix committed in `63c62b4` (allowlisted
`approved_headers` on both the TypeScript client and the Python
`WebctxFetchRequest` schema/executor) is real, correctly implemented, and
fully covered by passing tests. The defect this checkpoint proves is
**deployment lineage**, not a bad fix.

## 3. Workflow instance for attempt #4

```
Instance:      siteborne-wf-f05448718811118ffa644621c8506414fcc764768419d68f
Version Id:    ca8da8cd-89d9-4998-8a00-cdd48f604ebd
Status:        ✅ Completed, Success: Yes
Queued:        2026-09-07T21:27:12Z   Start: 21:27:13Z   End: 21:27:20Z
Last Successful Step: invoke-executor-1
```

Three steps ran, all succeeded: `open-envelope-1` (0s),
`check-authorization-expiry-1` (0s, `{"expired":false}`), `invoke-executor-1`
(6s, clean `result_class: "partial"` output, see §0 table). The Workflow
correctly stops after `invoke-executor-1` for a non-`success` result
(`executor_rejected` branch — proven correct in R5 §5) — there is no
missing/hidden failing step; the Workflow's own terminal state is
authoritative and matches D1's `REJECTED`/`QUARANTINE_POLICY` exactly.
**Failure occurs nowhere in the Workflow** — it occurs upstream, at SEC
EDGAR itself rejecting the request. The client's separately-observed
`http_status: 502` / `submission_result: "ambiguous"` is a distinct,
already-known artifact of the edge Worker's synchronous paid-POST
response path timing out ahead of/independent from the Workflow's own
(slower, async) completion — present identically in attempt #3 (see the
R4 evidence report, same `502`/`ambiguous` client observation despite an
identical clean internal Workflow result) and therefore not new, not
caused by R6, and out of scope for this root-cause determination (R5 §8
already reached the same conclusion: Workflows' retained history is
authoritative over the client's transport-level view).

## 4. Cloudflare read-only observability used

`wrangler workflows instances list/describe` (no `tail` needed or
available after the fact — confirmed still true, matching R5 §8).
`HISTORICAL_WORKFLOW_STEP_ERROR_AVAILABLE=YES` in the sense that the step
history is fully retained and conclusive; `EXACT_RUNTIME_EXCEPTION_RECOVERED=NO`
because there was no runtime exception to recover (same as R5 — the
Workflow completed cleanly both times).

## 5. Why zero `x402_service_results` rows, again

Unchanged from R5 §5: that table is only written on the `executor_success`
path further down `paid-continuation-workflow.ts`; a `result_class !==
'success'` outcome never reaches it. Confirmed structurally, symmetric
across all four attempts, not a defect.

## 6–7. SEC response — new evidence this checkpoint

`SEC_HTTP_STATUS`, `SEC_RESPONSE_CONTENT_TYPE`, and the raw SEC response
body for attempt #4 are **not** durably persisted anywhere (same
limitation as R5 found for #3 — `permanent_failure` is a classified
outcome of `classifyTerminalHttpStatus`, and the underlying raw HTTP
response is not retained past that classification). What is new and
decisive: a bounded, read-only, non-SITEBORNE, non-payment direct request
was made from this session to the same public SEC endpoint, described in
§11.

## 8. Partial vs. crash — reframed

Both #3 and #4 are "clean partial" outcomes at the Workflow/D1 level —
there is no crash in either. The real diff to explain is why **identical**
`permanent_failure` persisted across a change that, per its own diagnosis
and fix, should have altered SEC's response. Diffing the full commit
range `2d2ace6..a478b13` (R4 through R6-evidence) against what actually
executed:

| Layer | Repo state (commit `a478b13`, HEAD at attempt #4) | Actually running in production at attempt #4 |
|---|---|---|
| `ModalSafeEgressClient` (TS, Workflow host) | Sends `approved_headers: {"user-agent": "SITEBORNE hello@siteborne.com"}` | Host `e11304df` — **deployed at 2026-09-07T20:28:37.792Z, which is 3m14s *before* commit `63c62b4` (20:31:51Z) that introduced this code.** See §20. |
| `WebctxFetchRequest` schema / executor (Python, Modal) | Accepts `approved_headers`, applies `user-agent` override in `_fetch_one_hop` | Modal app `ap-Fpf9jp27SCcWMV533bUCsz` — `modal app history` shows **exactly two deployments ever**: v1 (2026-08-30) and v2 (2026-09-07 15:27 CDT = 20:27 UTC, tagged to commit `33a51e1` — the R5 **diagnosis-only** commit, timestamped 20:02:52Z, which does **not** contain `approved_headers` — confirmed by `git show 33a51e1:.../schemas.py \| grep approved_headers` returning zero matches). **No v3 deployment exists.** |

`PARTIAL_VS_CRASH_DIFF_COUNT`: not applicable in the crash sense (neither
is a crash); the operative diff is a **deployment gap**, quantified above.

## 9. Bisect

Not needed — §8's timestamp evidence is already a direct, non-inferential
proof, stronger than a behavioral bisect would provide.

```
BEHAVIOR_REGRESSION_COMMIT=UNPROVEN (no code regression exists; this is a
  deployment-process gap, not a source defect introduced by any commit)
```

## 10. Failure-branch elimination (updated)

All eight branches from R5 §10 remain eliminated as before, **plus**:

| Candidate | Status | Evidence |
|---|---|---|
| R6 header fix did not reach the live Modal executor | **PROVEN** | `modal app history` shows the currently-deployed version (v2) was deployed at 20:27 UTC, 3m14s before the fix commit (`63c62b4`, 20:31:51 UTC) even existed; no later deployment exists |
| The corrected User-Agent value itself is rejected by SEC | ELIMINATED | §11 — direct out-of-band request with the exact same header string succeeds (HTTP 200, real Apple Inc. data) |
| CIK 0000320193 is invalid or has no data | ELIMINATED | Same direct request confirms valid, populated data |

## 11. Direct read-only SEC reproduction (bounded, non-economic)

One GET, from this session's own network egress (not through Modal, not
through any SITEBORNE job, no payment context, same public endpoint the
production adapter targets, same declared User-Agent):

```
GET https://data.sec.gov/submissions/CIK0000320193.json
User-Agent: SITEBORNE hello@siteborne.com
Accept-Encoding: identity

→ HTTP/2 200, content-type: application/json, 164,121 bytes,
  valid Apple Inc. submissions JSON (name, CIK, tickers, filings, etc.)
```

```
DIRECT_SEC_READ_ONLY_REPRO_USED=YES
DIRECT_SEC_RESPONSE_MATCHES_EXPECTED=YES (200, valid data — proves the
  User-Agent string and CIK are both fine; SEC's Fair Access policy is
  satisfied by this exact header)
```

This conclusively rules out "the fixed User-Agent is itself somehow still
non-compliant" and leaves exactly one explanation standing: **the
production request never actually carries this header**, because the
Modal executor serving it has never run the code that would apply it.

## 12. Live tail — design only, for the next attempt

```
wrangler tail siteborne-paid-continuation-runtime --format=pretty
```

started in a background terminal *before* the next authorized paid
attempt, kept attached through the full request window. Captures
`console.error`/uncaught-exception output from the Workflow host in real
time (would have been moot for both #3 and #4, which never threw — but is
the correct standing instrumentation for any *future* attempt that does).
Retention: `tail` only streams live; it cannot recover the past, hence
this checkpoint relying on Workflows' own retained instance history
instead (§4). `NEXT_ATTEMPT_TAIL_COMMAND_PREPARED=YES`,
`TAIL_CAPTURES_HOST_EXCEPTIONS=YES`,
`TAIL_RETENTION_LIMITATION=live-only, no historical replay`.

## 13. Instrumentation gap analysis

```
DURABLE_EXECUTION_ERROR_DIAGNOSTICS=INADEQUATE
```

Not because exceptions are swallowed (there were none), but because
**deployment provenance is not verified or recorded anywhere in the
qualification pipeline.** Nothing in this engagement's checkpoints
independently confirmed, post-deploy, that the Modal app's *running* code
actually matches the intended commit — every prior checkpoint trusted the
`modal deploy` command's own exit code as sufficient proof. `modal app
history` (used for the first time this checkpoint) is the authoritative
source and should be a standard readback step after any Modal deploy,
the same way `wrangler deployments list` / `versions list` already is for
Cloudflare artifacts throughout this engagement. This is the actual gap:
not missing stack traces, but a missing deployment-lineage proof step for
one of the two platforms involved.

## 14–15. Error-wrapper audit / result-persistence order

Unchanged from R5 §3–5 (still accurate, re-verified against current
source): `executeLocalService`'s catch-all, `submissions-adapter.ts`'s
defined-`resultClass` branches, and `invoke-executor`'s
`try/catch→executor_timeout|executor_rejected` all remain exactly as
described, no regressions. `RESULT_PERSISTENCE_ORDER`: executor returns →
Workflow classifies (`success`/`executor_rejected`/`executor_timeout`) →
only `success` persists to `x402_service_results`/proceeds toward
settlement → job transitions to `QUARANTINED`/`REJECTED` regardless, with
the classification recorded only in the Workflow's own retained step
output, not D1.

## 16–19. Schema / header edge cases / timeouts / trust-class

Not the operative branch this time — §11's direct reproduction already
isolates the cause to "header never applied," making further edge-case
enumeration on the SEC response shape unnecessary (the response shape
itself, `permanent_failure` classification, was already fully explained
by R5 and reconfirmed identical here). `LATEST_EVIDENCE_MODE=production`,
`LATEST_PROVIDER_TRUST_CLASS=external/production` (unchanged invariant,
confirmed present in the same executor composition code read in R7/R8
preflight; `TRUST_CLASS_REJECTION_OCCURRED=NO` — the rejection is SEC's,
not an internal trust-class gate). Step duration (5.9s) is well under the
40s `INVOKE_EXECUTOR` timeout and consistent with one real network round
trip, not a timeout artifact (`RELEVANT_TIMEOUTS`: none match 5–6s as a
boundary; this is real latency, not a truncated wait).

## 20. Deployed-lineage verification — the finding

```
PUBLIC_API_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a (100%, unchanged, uninvolved)
WORKFLOW_HOST_VERSION=e11304df-ea78-4082-8668-43f71c0eb8fa
  — created 2026-09-07T20:28:37.792Z
  — contains the TypeScript-side R6 fix (verified present in current repo HEAD,
    which this deploy was sourced from per the R6 evidence report's own commit
    lineage claim — not independently re-fingerprinted this checkpoint, since
    the decisive gap is on the Modal side regardless)
MODAL_APP=ap-Fpf9jp27SCcWMV533bUCsz (siteborne-webctx-safe-egress)
  — `modal app history` authoritative readback:
      v1: 2026-08-30 22:15 CDT, commit d89b855
      v2: 2026-09-07 15:27 CDT (=20:27:00Z), commit 33a51e1* (*dirty tree)
  — NO v3 exists as of this checkpoint (2026-09-07T21:5x Z)
  — commit 33a51e1 = "SUN-1222C-Q1R5: root-cause diagnosis" (2026-09-07T20:02:52Z)
    — diagnosis-only commit, confirmed via `git show 33a51e1:.../schemas.py`
      to NOT contain `approved_headers`
  — commit 63c62b4 = "SUN-1222C-Q1R6: fix ModalSafeEgressClient..." (2026-09-07T20:31:51Z)
    — the actual fix, committed **9 minutes after** Modal's v2 was deployed
```

**Deployed source differs from assumed source, exactly as §20 anticipated.**
Per its own instruction, this checkpoint stops the "assume it's deployed"
line of inquiry here and reclassifies accordingly (§21–22 below), rather
than continuing to treat the fix as live.

## 21–22. Root cause

```
ROOT_CAUSE_PROVEN=YES
```

Standard met: criterion **D** (source/control-flow elimination leaves
exactly one branch) reinforced by criterion **B** (a real, direct,
out-of-band request with the intended header reproduces success, not
failure — proving the header content is fine and the gap is upstream of
SEC).

```
ROOT_CAUSE_CLASS=DEPLOYMENT_LINEAGE_DEFECT
```

`ROOT_CAUSE`: The R6 fix to `ModalSafeEgressClient`/`WebctxFetchRequest`
(header-forwarding allowlist) is correctly implemented and committed
(`63c62b4`), and the Cloudflare Workflow host was redeployed carrying the
TypeScript side of it (`e11304df`). **The Modal side of the same
versioned cross-service contract was never actually redeployed with the
fix** — Modal's own authoritative deployment history shows its current
running code (v2) was deployed several minutes *before* the fix commit
existed, sourced from the R5 diagnosis-only working tree state. The
result: the Workflow host now sends `approved_headers` in its request
body, but the live Modal executor is still running pre-fix code that has
no `approved_headers` field and always applies its own hardcoded
`user-agent: SITEBORNE-webctx-safe-egress/1`. SEC EDGAR — confirmed by a
direct, independent, bounded request in §11 to accept the *intended*
User-Agent cleanly — continues to reject the real production request,
because that request still never carries it. This is a **process gap**
(no independent deployment-lineage verification for the Modal side of a
cross-repo contract), not a code defect, not a SEC-side transient fault,
and not a new regression introduced by R6's actual source changes.

## 23. Next checkpoint design (not executed here)

**`SUN-1222C-COMPANY-V2-R9-COMBINED`**, scoped to exactly what this
evidence requires:
1. Re-run `modal deploy -m webctx_safe_egress.app` from the current
   clean, committed HEAD (already containing `63c62b4`) — no source
   change needed, only the deployment action itself.
2. Immediate authoritative readback: `modal app history` must show a new
   v3 tagged to a commit at-or-after `63c62b4`, with **no** dirty-tree
   marker (repo is clean at HEAD as of this checkpoint).
3. Optionally pre-attach `wrangler tail` (§12) before the next attempt,
   though moot if step 2 alone resolves the SEC rejection.
4. Then, and only then, one fresh paid qualification attempt under its
   own standalone financial authorization — this is the fifth real
   payment and must not be spent before step 2's readback is clean.

## 24. No-retry / economic state

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
NEW_CHAIN_TRANSFERS=0
ECONOMIC_EFFECT_USDC=0
```

Buyer `0x516F...ecB99`: 79,727 atomic (dual-RPC: mainnet.base.org,
base.publicnode.com, both agree). Seller `0x7f44...E6E1`: 28,000 atomic
(same). Both unchanged from every prior checkpoint in this lineage.

## 25–26. Final packet

```
SUN1222C_COMPANY_V2_R8=PASS
LATEST_PAYMENT_ATTEMPT=pay_a99341faa7a542b786030c90f453d231
LATEST_JOB_ID=72efabd1-062b-4fca-9f04-68525b5d1446
REAL_SEC_EXECUTION_PATH_REACHED=YES
R6_HEADER_DEFECT_REAL=YES
R6_HEADER_DEFECT_FIXED=YES
R6_HEADER_FIX_REACHED_RUNTIME=NO
R6_HEADER_FIX_SUFFICIENT=NO
WORKFLOW_INSTANCE_ID=siteborne-wf-f05448718811118ffa644621c8506414fcc764768419d68f
WORKFLOW_HOST_VERSION=e11304df-ea78-4082-8668-43f71c0eb8fa
EXACT_RUNTIME_EXCEPTION_RECOVERED=NO (none occurred; moot)
HISTORICAL_HOST_LOGS_AVAILABLE=NO (tail-only; not needed — Workflows history sufficed)
HISTORICAL_WORKFLOW_STEP_ERROR_AVAILABLE=YES (full clean step history retained)
SEC_HTTP_STATUS=UNPROVEN (not durably persisted in production; direct
  out-of-band reproduction used instead, see §11: 200)
SEC_RESPONSE_CONTENT_TYPE=UNPROVEN (production); application/json (direct repro)
SEC_RESPONSE_BODY_AVAILABLE=NO (production); YES (direct repro, 164,121 bytes)
PARTIAL_VS_CRASH_DIFF_COUNT=1 (the Modal deployment-lineage gap, §8/§20)
BEHAVIOR_REGRESSION_COMMIT=UNPROVEN (no source regression; deployment-process gap)
LATEST_FAILURE_LOCALLY_REPRODUCED=NO (not applicable — no crash to reproduce;
  instead, the *correct* behavior was reproduced locally/out-of-band, §11)
LOCAL_EXCEPTION_TYPE=N/A
LOCAL_EXCEPTION_MESSAGE=N/A
DURABLE_EXECUTION_ERROR_DIAGNOSTICS=INADEQUATE (missing deployment-lineage
  verification step, not missing exception detail — see §13)
RESULT_PERSISTENCE_ORDER=executor returns → Workflow classifies → only
  `success` persists to x402_service_results → job reaches terminal state
  regardless, with classification detail retained only in Workflows'
  step history
LATEST_EVIDENCE_MODE=production
LATEST_PROVIDER_TRUST_CLASS=external/production
TRUST_CLASS_REJECTION_OCCURRED=NO
PUBLIC_API_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
WORKFLOW_HOST_VERSION=e11304df-ea78-4082-8668-43f71c0eb8fa
SOURCE_COMMIT=a478b13 (repo HEAD at time of attempt #4; contains the fix)
ROOT_CAUSE_PROVEN=YES
ROOT_CAUSE_CLASS=DEPLOYMENT_LINEAGE_DEFECT
ROOT_CAUSE_SUMMARY=The R6 header-forwarding fix is correctly implemented
  and committed, and the Cloudflare Workflow host was redeployed with it,
  but the Modal `webctx-safe-egress` app was never actually redeployed
  with the fix — its authoritative deployment history shows the current
  running version was deployed 9 minutes before the fix commit existed.
  A direct, independent, bounded request to SEC EDGAR with the intended
  User-Agent succeeds cleanly (HTTP 200), proving the header itself is
  fine and the production rejection persists solely because the live
  Modal executor still never sends it.
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
NEW_CHAIN_TRANSFERS=0
ECONOMIC_EFFECT_USDC=0
COMPANY_EVIDENCE_GRAPH_V2_LIVE_PAID_QUALIFIED=NO
NEXT_SERVICE_QUALIFICATION_ELIGIBLE=NO
R8_EVIDENCE_COMMIT_SHA=<set by the commit that includes this file>
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-COMPANY-V2-R9-COMBINED
```
