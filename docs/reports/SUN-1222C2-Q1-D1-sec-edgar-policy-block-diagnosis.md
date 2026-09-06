# SUN-1222C2-Q1-D1 — `sec-edgar` policy-block root-cause diagnosis

Date: 2026-09-06

Read-only / repo-only diagnosis. No payment retry, no new 402, no EIP-3009
authorization, no signing, no paid POST, no settlement, no traffic change,
no candidate upload, no production deployment. The paid SITEBORNE executor
was **not** invoked again — the entire diagnosis below is local, zero-network
source inspection plus one new, purely additive test file
(`packages/provider-adapters/src/tests/sec-edgar-terms-review-gap.test.ts`).

Lineage: [`75dd24f`](../../docs/reports/SUN-1222C2-Q1-company-evidence-graph-real-paid-attempt.md)
(the Q1 real-paid attempt this diagnoses).

## 0. Headline finding

**SEC EDGAR was never contacted.** The Q1 executor result's own limitation
string — `"sec-edgar company_submissions returned policy_blocked for CIK
0000320193"` — reads as if SEC EDGAR's servers rejected the call. They did
not receive it. `policy_blocked` here is SITEBORNE's **own internal
governance gate** (`globalTermsGuard.checkAccess()` in
[`packages/provider-adapters/src/policy/terms-guard.ts`](../../packages/provider-adapters/src/policy/terms-guard.ts))
throwing because no `TermsReview` record has ever been registered for
`provider_id: 'sec-edgar'` — only `direct-public-http` has one. This throw
happens **before** the adapter's rate limiter, circuit breaker, or HTTP
client ever run (`packages/provider-adapters/src/sec/submissions-adapter.ts:136-152`,
checked ahead of `rateLimiter.acquire()` at line 154 and `fetchAndNormalize()`
inside the retry loop). It is deterministic and **CIK-independent** — it
would happen identically for any company, every time, in `execution_mode:
'live'`, until this gap is closed.

This is not a bug in the sense of broken logic: `TermsGuard`'s fail-closed
behavior for an unreviewed provider is a documented, permanent, already
regression-tested invariant (`direct-public-http-terms-review.test.ts` §7:
*"an unreviewed capability remains blocked in live mode, always"*, proven
back in SUN-1221E2T). The code is doing exactly what it was built to do. The
gap is that `sec-edgar` — unlike `direct-public-http` — was wired into a
live, real-money executor (`company-evidence-graph-v2-production-executor.ts`,
`execution_mode: 'live'`) without ever completing the same governance step
`direct-public-http` completed on 2026-08-29 (an explicit, recorded
operator decision — see
[`SUN-1221E2T-direct-public-http-governance-review.md`](./SUN-1221E2T-direct-public-http-governance-review.md)).
`company-facts-adapter.ts` shares the identical `provider_id: 'sec-edgar'`
and the identical `globalTermsGuard.checkAccess()` call, so it carries the
same gap even though Q1 never exercised it.

## 1. Frozen Q1 economic identity (unchanged, no new state)

```
PAYMENT_IDENTIFIER=pay_a750ea6da8ea479fa7660c2cf92a4378
JOB_ID=cdc7b707-cb2c-41c5-a503-360bd95621d8
WORKFLOW_INSTANCE_ID=siteborne-wf-4cbc0df301ef220cbff6d219e6f8d6c7e71dc210b2e008ec
PAYMENT_ATTEMPT_ID=3706d9a9-789e-4e07-bab5-7b3174e11f24
Q1_PAYMENT_REUSED=NO
```

No new payment-related state was created anywhere in this checkpoint. No D1
read even repeats the earlier queries — this diagnosis works entirely from
already-quoted values in the Q1 report and from static source inspection.

## 2. Exact SEC failure recovered from authoritative artifacts

There is no SEC-side failure to recover, because no SEC-side request was
ever made:

```
SEC_REQUEST_URL=NONE_SENT (would have been https://data.sec.gov/submissions/CIK0000320193.json — buildSubmissionsUrl(), never called: fetchAndNormalize() is unreachable code on this path)
SEC_HTTP_METHOD=NONE_SENT
SEC_HTTP_STATUS=NONE_SENT (SEC never responded; distinct from the client-observed http_status:502, which is SITEBORNE's own executor_rejected -> service_execution_failed mapping in x402-service.ts, already traced in the Q1 report)
SEC_RESPONSE_CLASS=NONE_SENT
SEC_RESPONSE_HEADERS_SAFE_SUBSET=NONE_SENT
SEC_RESPONSE_BODY_CLASS=NONE_SENT
SEC_FAILURE_MESSAGE="Provider sec-edgar has no terms review record. Live use is blocked." (PolicyBlockedError thrown by TermsGuard.checkAccess(), terms-guard.ts:89-94 — a SITEBORNE-authored string, not anything SEC ever sent)
SEC_FAILURE_TIMESTAMP=2026-09-06T05:06:55.927Z (the job's EXECUTING -> QUARANTINED transition, D1 job_state_events, per the Q1 report §4)
```

## 3. Exact EDGAR endpoint (as constructed, never dispatched)

```
SEC_ENDPOINT_FAMILY=data.sec.gov (submissions API)
SEC_ENDPOINT_PATH_PATTERN=/submissions/CIK{cik zero-padded to 10 digits}.json
```

From `buildSubmissionsUrl()` in
[`packages/provider-adapters/src/sec/submissions.ts:170-173`](../../packages/provider-adapters/src/sec/submissions.ts) —
read directly from source, not guessed from the service name.

## 4. Request construction trace

```
SEC_CLIENT_FILE=packages/provider-adapters/src/sec/submissions-adapter.ts
SEC_CLIENT_FUNCTION=SecSubmissionsAdapter.fetchAndNormalize() (never reached this attempt)
SEC_HEADERS_CONSTRUCTION=none set explicitly -- fetchAndNormalize() calls httpClient.fetchJson<...>(url) with NO options/headers argument at all
SEC_USER_AGENT_SOURCE=NONE in this repository's SEC client code path
SEC_ACCEPT_ENCODING=not set explicitly by SITEBORNE code
SEC_ACCEPT_HEADER=not set explicitly by SITEBORNE code
SEC_HOST_BEHAVIOR=NONE_SENT (unreached)
SEC_TIMEOUT_MS=30000 (SecureHttpClient.DEFAULT_HTTP_CONFIG.timeoutMs, http/client.ts:24 -- would apply if reached; a separate context.timeout_ms is also computed in buildAdapterContext() as min(budget.totalTimeoutMs, 30000) but is not read by SecSubmissionsAdapter's own fetch path)
SEC_RETRY_POLICY=maximum_retries: 3, retry_after_respected: true (SEC_EDGAR_MANIFEST.rate_policy) -- never engaged, the block occurred before the retry loop's first iteration
SEC_RATE_LIMIT_POLICY=token_bucket, maximum_concurrency 10, minimum_interval_ms 100 (manifest) -- never engaged
SEC_CACHE_POLICY=bypass (buildAdapterContext() hardcodes cache_policy: 'bypass' for every adapter call from this service) -- moot here since the cache lookup happens before the guard check but found nothing (fresh job, no prior successful fetch)
SEC_REDIRECT_POLICY=manual, max 10 hops, each hop independently re-validated against network policy (SecureHttpClient.fetch()) -- never engaged
```

This confirms the client-construction path is real, specific, inspectable
source code — not a guess from the service's name.

## 5. User-Agent compliance

```
Q1_SEC_USER_AGENT_PRESENT=NO
Q1_SEC_USER_AGENT_VALUE_SAFE=N/A (none sent, none constructed -- irrelevant to this attempt since no request left the process)
IDENTIFIES_SITEBORNE=NO
CONTAINS_CONTACT_INFORMATION=NO
STATIC_OR_PER_REQUEST=N/A
```

Not the cause of this attempt's failure (the request was never built or
sent), but a genuine, separately provable, latent gap worth flagging for
whoever eventually makes the sec-edgar governance decision: SEC's own
documented automated-access expectations
(https://www.sec.gov/os/accessing-edgar-data) require a descriptive
`User-Agent` identifying the requester with contact information, enforced
with real `403`s. Neither `SecureHttpClient` nor `SecSubmissionsAdapter`
sets one. The eventual outbound hop for this executor's dependency
(`ModalSafeEgressClient`, see §8) sends a fixed JSON envelope to a Modal
endpoint with no `headers` override for the target request either — whether
Modal's own out-of-repo executor code sets a compliant header itself is
unprovable from this repository. **Not changed in this checkpoint** — it is
downstream of the governance decision in §0/§12, and fixing it without
first resolving the governance gap changes nothing observable, since the
current code path never reaches it in `live` mode.

## 6. Rate-limit / fair-access analysis

```
MAX_SEC_REQUESTS_PER_JOB=1 (only the `sec_submissions` field group calls the SEC adapter; `recent_filings` reuses the same cached `secCovered` result within one job, service.ts:118-129/142)
MAX_SEC_CONCURRENCY_PER_JOB=1
SEC_RETRIES_MAX=3 (manifest value; never engaged this attempt)
SEC_GLOBAL_RATE_LIMIT_PRESENT=NO
SEC_EFFECTIVE_MAX_REQUEST_RATE=unbounded across separate jobs/requests -- each `buildCompanyEvidenceGraphV2ProductionExecutor` invocation constructs a brand-new `SecSubmissionsAdapter` (company-evidence-graph-v2-production-executor.ts:153-158), which constructs its own fresh, request-scoped token-bucket rate limiter (submissions-adapter.ts:88-97). There is no limiter shared across concurrent Cloudflare Worker invocations.
SEC_FAIR_ACCESS_RISK=LOW today (the governance gate above blocks 100% of live sec-edgar calls unconditionally, so no volume of calls can currently reach SEC at all); MEDIUM once/if that gate is resolved, since concurrent buyer requests would each get an independent, unshared rate limiter with no cross-request cap -- worth a fresh look at that time, out of this diagnosis's scope
```

## 7. Fan-out analysis (Apple / CIK 0000320193, this Q1 attempt)

| Sequence | Endpoint | Purpose | Started | Status | Dependency |
|---|---|---|---|---|---|
| 1 | `data.sec.gov/submissions/CIK0000320193.json` | `sec_submissions`/`recent_filings` field groups | **NO** | blocked before dispatch | `globalTermsGuard.checkAccess('sec-edgar', 'live')` |

`identity` resolved with zero dependency calls (deterministic function of
input, service.ts:103-116); `website_evidence` and `regulatory_mentions`
were not requested for this Q1 canonical body (only
`identity`+`sec_submissions` per the Workflow trace's `executorInput` in the
Q1 report §5). Exactly one SEC call was ever planned; it never started.

```
SEC_BLOCK_OCCURRED_ON_FIRST_REQUEST=YES (blocked prior to constructing/dispatching the one and only planned request -- there was no "burst" or fan-out to distinguish)
```

## 8. Egress / network origin analysis

```
SEC_REQUEST_RUNTIME=would have been Modal (ModalSafeEgressClient, single-hop safe-egress proxy), invoked from the Cloudflare Worker's injected InjectedHttpClient -- see company-evidence-graph-v2-cdp-composition.ts:83-93 -- but never reached
SEC_EGRESS_PROVIDER=Modal (would-be)
SEC_EGRESS_REGION_IF_KNOWN=UNPROVEN (not present in this repository; Modal's own deployment config is out-of-repo)
SEC_STATIC_EGRESS=UNPROVEN
SEC_SHARED_CLOUD_EGRESS=UNPROVEN
```

No claim of IP reputation, rate-limiting-by-cloud-provider, or
anonymous-proxy classification is made — none of this layer was ever
reached, so there is no evidence to support or refute it either way.

## 9. Failure class

```
SEC_POLICY_BLOCK_CLASS=OTHER_PROVEN
CONFIDENCE=HIGH
EVIDENCE=Source-level trace (submissions-adapter.ts:136-152 calls globalTermsGuard.checkAccess() before rateLimiter.acquire() at line 154 or fetchAndNormalize() in the retry loop) + globalTermsGuard.getReview('sec-edgar') === undefined (only 'direct-public-http' is registered, terms-guard.ts:211) + a new, passing, zero-network reproduction (6/6 tests, packages/provider-adapters/src/tests/sec-edgar-terms-review-gap.test.ts) proving execute() returns policy_blocked with an unreachableHttpClient() that throws if ever invoked (zero calls, for both the Q1 CIK and an arbitrary different CIK), and that recording a review record on an ISOLATED, throwaway TermsGuard instance (not globalTermsGuard) removes the block.
```

None of the enumerated SEC-side classes (`MISSING_OR_INVALID_USER_AGENT`,
`CONTACT_INFO_POLICY`, `RATE_LIMIT_429`, `FAIR_ACCESS_403`,
`CLOUD_EGRESS_POLICY`, `REQUEST_PATTERN/BURST`, `ENDPOINT_ACCESS_POLICY`,
`TRANSIENT_UPSTREAM`, `MALFORMED_REQUEST`) apply, because none of them
describe an event that happens **before the request exists**. `OTHER_PROVEN`
is the correct fit: a SITEBORNE-internal governance gate, proven, not a
guess.

## 10. Source-contract check

```
SEC_REQUEST_CONTRACT_VALID=N/A_NOT_SENT
```

No request was built or sent this attempt, so there is nothing to compare
against SEC's live endpoint contract for *this specific failure*. The one
concrete, repo-provable latent mismatch against SEC's documented automated-
access expectations, independent of this failure, is the missing compliant
`User-Agent` noted in §5 — flagged for future reference, not the cause here.

## 11. No-retry quality semantics (reconfirmed, protected invariant)

```
Q1_FAIL_CLOSED_BEHAVIOR=PASS
```

`company_evidence_graph.v2` did not fabricate evidence for the missing SEC
data (`field_groups.sec_submissions.status: "unavailable"`,
`source_count: 0`, an honest `limitations` entry); `result_class: "partial"`
was reported accurately; the paid-continuation Workflow's own quality gate
rejected the job before any settlement step; `cdp_facilitator_settle_attempt_count:
0`; buyer funds unchanged (dual-RPC, Q1 report §7). This diagnosis changes
nothing about that chain and does not touch it.

## 12. Root-cause classification

```
Q1_EXECUTOR_ROOT_CAUSE_CLASS=CONFIGURATION_DEFECT
```

Specifically: `company-evidence-graph-v2-production-executor.ts` wires a
real, `execution_mode: 'live'` `SecSubmissionsAdapter` into a real-money
paid route, but the `sec-edgar` provider it depends on has never completed
the governance step (`globalTermsGuard.recordReview(...)`) that
`direct-public-http` completed before *its* real-money executor
(`web_context_verified.v2`) went live. `SEC_EDGAR_MANIFEST` already declares
`commercial_application_allowed`, `automated_access_allowed`, and
`transformed_output_allowed` as literal `true` and carries a real,
reviewable `terms_uri` (`https://www.sec.gov/os/accessing-edgar-data`) — the
missing piece is exclusively the recorded review itself, `terms_review_status:
'pending_review'` on the manifest says so explicitly. This is not a logic
bug: `TermsGuard`'s "no review, no live access, ever" behavior is a
deliberate, permanent, already-tested safety invariant working exactly as
designed. The defect is that a real-money route was deployed depending on a
provider that never finished the same governance step its sibling
capability did.

## 13. Safe local reproduction (zero network)

```
NON_ECONOMIC_SEC_DIAGNOSTIC_REQUESTS=0
```

No request to `sec.gov`/`data.sec.gov`, bounded or otherwise, was made. The
existing `unreachableHttpClient()` test helper
(`packages/provider-adapters/src/tests/support.ts`, already used elsewhere
in this package) — an `InjectedHttpClient` that throws if `.fetch()` is ever
called — was reused to prove request construction never happens. See
`packages/provider-adapters/src/tests/sec-edgar-terms-review-gap.test.ts`,
6/6 passing:

1. `globalTermsGuard.getReview('sec-edgar')` is `undefined`.
2. `SEC_EDGAR_MANIFEST`'s three permission flags are already `true`
   (proving the block isn't because the manifest looks unsafe).
3. Live-mode `execute()` for CIK `0000320193` (the exact Q1 CIK) returns
   `policy_blocked` with `httpClient.callCount === 0`.
4. The identical outcome for an arbitrary different CIK (`0000051143`,
   IBM) — proving this is not Apple-specific or CIK-dependent in any way.
5. `TermsGuard.checkAccess()` returns immediately for `execution_mode:
   'test'` (source-level confirmation only, no adapter call) — isolating
   that the block is specifically the `'live'` + missing-review path.
6. A mutation-style isolation proof: recording a review on a **throwaway,
   local** `TermsGuard` instance (never `globalTermsGuard`, never committed
   to production wiring) removes the block on that isolated instance, while
   `globalTermsGuard.getReview('sec-edgar')` remains `undefined` throughout
   — proving the guard lookup is the sole, sufficient cause, without
   asserting or implying that SEC EDGAR's terms actually permit this use.

## 14. TDD — not applicable

```
SEC_DEFECT_RED=NOT_APPLICABLE
```

No deterministic *code* defect was found to fix. The governance gap
identified in §12 is not something a coding change should resolve
unilaterally: exactly like `direct-public-http`'s review, closing it
requires an explicit, recorded, first-person operator decision about
whether SEC EDGAR's terms of service license this commercial, automated
use — the same kind of decision the operator made and had recorded verbatim
on 2026-08-29 for `direct-public-http`
(`DIRECT_PUBLIC_HTTP_TERMS_REVIEW.reviewBasis: 'operator_risk_acceptance'`,
`reviewer: 'operator (SITEBORNE, recorded via chat 2026-08-29)'`). Writing
that same kind of record for `sec-edgar` on this coding agent's own
initiative, without the operator's own words, would be exactly the failure
mode `TermsGuard`'s permanent fail-closed test (§7 of
`direct-public-http-terms-review.test.ts`) exists to prevent. No repo change
was made to `terms-guard.ts`, `submissions-adapter.ts`, or
`company-facts-adapter.ts`.

## 15/16/17/18. Green, mutation proof, executor matrix, economic non-regression, full gate

No production code changed. One new, purely additive test file was added:
`packages/provider-adapters/src/tests/sec-edgar-terms-review-gap.test.ts`.

```
SEC_DEFECT_GREEN=NOT_APPLICABLE
SEC_DEFECT_MUTATION_PROOF=NOT_APPLICABLE
COMPANY_EXECUTOR_FAILURE_MATRIX=PASS (unchanged from the Q1 report -- fail-closed on partial/missing evidence was independently reconfirmed in §11 above, no behavior touched)
NO_PAYMENT_ON_PARTIAL_RESULT=PASS (unchanged, reconfirmed by reference to Q1's own D1/Workflow/on-chain evidence, not re-run)
```

Targeted validation actually run this checkpoint (package-scoped, since no
production source changed):

```
pnpm --filter @siteborne/provider-adapters exec vitest run
  -> 20 test files, 314 passed | 6 skipped (pre-existing skips, unrelated)
pnpm --filter @siteborne/provider-adapters exec tsc --noEmit
  -> clean, zero errors
```

Per the checkpoint's own §18 instruction ("If no code changed: targeted
validation plus existing clean baseline may be referenced, but do not
invent a full-gate rerun"), no full monorepo gate (typecheck/build/lint/
protocol checks/worker-runtime/secrets scan/production preflight/wrangler
dry-run) was invented or re-run, since no production source file changed.

## 19. Retry eligibility

```
Q1_FRESH_RETRY_ELIGIBLE=NO
```

Neither condition A nor B holds: no deterministic SITEBORNE code defect was
found, fixed, and regressed (A); and the block is proven, not transient —
it will recur identically for any CIK, any company, on every future live
attempt, until a `TermsReview` record for `sec-edgar` is explicitly
authorized and recorded (B does not hold either, since the response is not
"transient/non-deterministic enough to justify a fresh attempt" — it is
100% deterministic and will reproduce every time under present
configuration).

## 20. Retry eligibility is not authorization

Nothing in this checkpoint requests, constructs, or signs a new 402,
EIP-3009 authorization, or paid POST. None occurred. A fresh, standalone,
first-person financial authorization would still be required for any future
real `company_evidence_graph.v2` attempt, exactly as before.

## 21. Q2 independence

```
Q2_WEB_CONTEXT_CAN_PROCEED_INDEPENDENTLY=YES
```

`web_context_verified.v2` depends on `direct-public-http`
(`PublicHttpAdapter`), a **separate, already-`verified`** `TermsReview`
record in the same `globalTermsGuard` registry
(`DIRECT_PUBLIC_HTTP_TERMS_REVIEW`, `terms-guard.ts:191-209`) — structurally
independent of `sec-edgar`'s missing record (`TermsGuard.getReview()` is a
`Map` keyed by `provider_id`; §10's own non-transfer test in
`direct-public-http-terms-review.test.ts` already proves one provider's
review can never leak to another). Q1's root cause has no shared
architectural effect on payment verification, Workflow dispatch,
settlement, receipts, cross-script binding, or the general executor trust
class — all of those were independently exercised and proven correct by
Q1's own real attempt (Q1 report §§3-9), untouched by this diagnosis.

## 22. Evidence

This document. Committed alongside the new, passing, zero-network test file.

## 23. Final packet

```
SUN1222C2_Q1_D1=PARTIAL
Q1_PAYMENT_REUSED=NO

SEC_ENDPOINT_FAMILY=data.sec.gov (submissions API)
SEC_HTTP_STATUS=NONE_SENT
SEC_FAILURE_MESSAGE=Provider sec-edgar has no terms review record. Live use is blocked.

Q1_SEC_USER_AGENT_PRESENT=NO
IDENTIFIES_SITEBORNE=NO
CONTAINS_CONTACT_INFORMATION=NO

MAX_SEC_REQUESTS_PER_JOB=1
MAX_SEC_CONCURRENCY_PER_JOB=1
SEC_GLOBAL_RATE_LIMIT_PRESENT=NO

SEC_BLOCK_OCCURRED_ON_FIRST_REQUEST=YES

SEC_REQUEST_RUNTIME=Modal (would-be, ModalSafeEgressClient) -- never reached
SEC_EGRESS_PROVIDER=Modal (would-be)

SEC_POLICY_BLOCK_CLASS=OTHER_PROVEN
SEC_REQUEST_CONTRACT_VALID=N/A_NOT_SENT

Q1_FAIL_CLOSED_BEHAVIOR=PASS

Q1_EXECUTOR_ROOT_CAUSE_CLASS=CONFIGURATION_DEFECT

SEC_DEFECT_RED=NOT_APPLICABLE
SEC_DEFECT_GREEN=NOT_APPLICABLE
SEC_DEFECT_MUTATION_PROOF=NOT_APPLICABLE

COMPANY_EXECUTOR_FAILURE_MATRIX=PASS
NO_PAYMENT_ON_PARTIAL_RESULT=PASS

PRODUCTION_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
NEW_402_REQUESTS=0
NEW_PAYMENT_AUTHORIZATIONS=0
NEW_PAID_POSTS=0
NEW_SETTLEMENT_ATTEMPTS=0

Q1_FRESH_RETRY_ELIGIBLE=NO
Q2_WEB_CONTEXT_CAN_PROCEED_INDEPENDENTLY=YES

EVIDENCE_COMMIT_SHA=<set by the commit that includes this file>

NEXT_REQUIRED_CHECKPOINT=SUN-1222C2-Q2-WEB-CONTEXT-VERIFIED (if the operator
  chooses to move on to the next service) -- OR, if the operator instead
  wants to unblock company_evidence_graph.v2's SEC path, a distinct future
  checkpoint that first records an explicit sec-edgar TermsReview decision
  (analogous to SUN-1221E2T's direct-public-http review), which is a
  governance action, not a code fix, and is out of this diagnosis's scope.
```

`SUN1222C2_Q1_D1=PARTIAL` (not `PASS`, not `FAIL`, not `BLOCKED`): the
diagnosis itself fully succeeded — the exact, deterministic, non-SEC root
cause is proven with a passing zero-network reproduction — but
`company_evidence_graph.v2`'s SEC-sourced field groups remain genuinely
blocked pending an operator governance decision this checkpoint correctly
does not make on its own.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
