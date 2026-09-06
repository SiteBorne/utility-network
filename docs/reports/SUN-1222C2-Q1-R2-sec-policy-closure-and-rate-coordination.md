# SUN-1222C2-Q1-R2 — SEC Policy Closure & Aggregate Rate Coordination

Repo-only checkpoint. No deploy, no Cloudflare mutation, no SEC terms
review registered, no real SEC request, no payment, no signing, no
settlement. R1 lineage: `3cbee0e`.

## 0. Scope recap

R1 fixed the User-Agent and CIK-validation gaps and established two open
release blockers it explicitly did not fix: `SecureHttpClient` never
inspected HTTP status codes, and the SEC rate limiter has no real
aggregate cross-job guarantee. This checkpoint closes both.

## 1. Protected R1 fixes

```
R1_USER_AGENT_FIX_PRESERVED=YES
R1_CIK_GUARD_PRESERVED=YES
```

Both re-verified passing after every change in this checkpoint
(`sec-edgar-user-agent-compliance.test.ts` 2/2,
`sec-edgar-cik-request-validation.test.ts` 13/13 — the latter also had an
unrelated hygiene defect fixed this checkpoint: a literal raw NUL byte in
a string literal, functionally identical to vitest but not clean UTF-8
text, commit `b84c9bf`).

## 2-3. SecureHttpClient trace and HTTP status contract

Full trace: `fetch()` — URL validation → redirect loop (0-10 hops,
re-validating each target) → **(new) status classification** →
media-type check → content-length pre-check → `readBoundedBody`
(streaming, hard `maxResponseBytes` cap) → gzip/deflate decompression
(capped by `decompressionLimit`) → `fetchText` (UTF-8 decode) →
`fetchJson` (JSON.parse). Timeout via `AbortController` + injected
clock. Network-level throws (`AbortError`, ECONNRESET-shaped messages)
were already converted by `classifyGenericAdapterErrorReason` in
`errors.ts`; HTTP status codes were not converted at all before this
checkpoint — every non-3xx status fell straight through as an ordinary
successful `HttpResponse`.

Searched every consumer (`grep -rn "metadata.status\|error.status ===" src`)
before writing the fix, per this checkpoint's own instruction not to
blindly convert every non-2xx into an exception: found `PublicHttpAdapter`
deliberately depends on receiving a normal `HttpResponse` for **304 Not
Modified** (conditional GET via `If-None-Match`/`If-Modified-Since`) — the
only such caller repo-wide. Preserved as an explicit pass-through.

| Status class | Before | After | Retryable | Failure class | Caller dependency found |
|---|---|---|---|---|---|
| 2xx | success | success (unchanged) | n/a | n/a | every adapter |
| 304 | success | **success (unchanged)** | n/a | n/a | `PublicHttpAdapter` conditional GET |
| 404 | success (fabricated) | `NotFoundError` | No | `not_found` | `GitHubAdapter` already had a dead branch for this |
| 429 | success (fabricated) | `RateLimitedError`, honors `Retry-After` | Yes (bounded) | `rate_limited` | all 7 consumers had a dead branch for this |
| 401/403 | success (fabricated) | `PermanentFailureError` | No | `permanent_failure` | `GitHubAdapter` already had a dead branch for 403 |
| 408 | success (fabricated) | `RetryableFailureError` | Yes (bounded) | `retryable_failure` | none found |
| 5xx | success (fabricated) | `RetryableFailureError`, honors `Retry-After` | Yes (bounded) | `retryable_failure` | none found |
| other non-2xx | success (fabricated) | `PermanentFailureError` (fail closed) | No | `permanent_failure` | none found |

```
SECURE_HTTP_RESPONSE_FLOW=fetch->redirect_loop->status_classification(NEW)->media_type->content_length->readBoundedBody->decompress->fetchText->fetchJson
```

## 4-5. Genuine RED

`secure-http-client-status-semantics.test.ts`'s first describe block
(captured before the fix existed, then removed once superseded by the
permanent GREEN contract below — the transcript output at the time is the
record): a 429/403/500/503 each carrying a plausible-provider-shaped JSON
body (`{cik, entityName, error: 'Too Many Requests'}`) were all returned
as `result.data` equal to that body, no exception. Confirmed genuinely
RED against the pre-fix source, not assumed.

```
HTTP_STATUS_RED_429=YES
HTTP_STATUS_RED_403=YES
HTTP_STATUS_RED_5XX=YES
```

## 6-10. Fix, GREEN, mutation proof

Implemented `classifyTerminalHttpStatus` exactly per the table above,
reusing this package's own existing `AdapterError` subclass taxonomy
(`errors.ts`) instead of a new one — `toAdapterResult()` already special-
cases each subclass's `resultClass`, so every consumer gets the correct
classification for free. `RateLimitedError.retryAfterMs` widened from
required to optional (zero real construction sites existed before this
checkpoint — grep-confirmed — pure addition). Never includes response
body content in a thrown message — `readBoundedBody` is never reached for
a rejected status.

`secure-http-client-status-semantics.test.ts`: 18/18 pass, including
`Retry-After` edge cases (integer seconds, malformed, missing, negative
via the pre-existing `parseRetryAfterMs`'s own HTTP-date fallback branch,
huge-but-capped) and a "no response body content leaks into the error
message" test.

Mutation proof: removed the `classifyTerminalHttpStatus` call entirely —
16/17 tests failed. Restored, re-verified 18/18 (an 18th test — the 304
pass-through — was added after the mutation run).

```
HTTP_STATUS_GREEN=PASS
HTTP_STATUS_MUTATION_PROOF=PASS
```

## 11. Cross-adapter regression

```
SECURE_HTTP_CONSUMERS=SecSubmissionsAdapter, SecCompanyFactsAdapter, CrossrefAdapter, OpenAlexAdapter, GitHubAdapter, PublicHttpAdapter, FederalRegisterAdapter
```

All 7 shared an identical dead `error instanceof Response && error.status
=== 429` catch branch (`GitHubAdapter` also had 403/404) — `SecureHttpClient`
never actually threw a `Response`, so none of these branches had ever
fired. Updated all 7 to check the real thrown types
(`RateLimitedError`/`NotFoundError`/`PermanentFailureError`), making
their existing bounded-retry logic (`backoff.canRetry()`/
`wait(retryAfterMs)`) reachable for the first time — not new logic, the
same logic these adapters' own authors already wrote and could never
exercise.

`secure-http-client-cross-adapter-status-regression.test.ts` (new, 8
tests): exercises each adapter's real `execute()` through the real
`SecureHttpClient` against a fixed-status fake transport — no mocking
below the transport boundary. 8/8 pass, including
`SecSubmissionsAdapter` specifically (the one real production consumer).

```
CROSS_ADAPTER_HTTP_STATUS_REGRESSION=PASS
```

## 12. SEC request call sites

```
SEC_REQUEST_CALLSITES=1 (company-evidence-graph-v2-production-executor.ts:166, via SecSubmissionsAdapter.execute -> fetchAndNormalize -> SecureHttpClient.fetchJson)
SEC_LIMITER_CONSTRUCTION_CALLSITES=1 production call site, but instantiated fresh on EVERY invocation of the returned executor closure (confirmed: `new SecSubmissionsAdapter(...)` sits inside `return async (input, ctx) => {...}`, not in module- or route-scoped setup that runs once)
```

`SecCompanyFactsAdapter` (the other SEC-capable adapter) is never
constructed anywhere in `apps/edge-api/src` outside tests/scripts —
`company_evidence_graph.v2`'s `xbrl_facts` field group is not wired to it
(confirmed: zero references to it in
`packages/service-runtime/src/services/company-evidence/service.ts`).

## 13. Policy invariant

```
SEC_POLICY_MAX_RPS=10
SEC_SELECTED_OPERATIONAL_RPS=8
SEC_RATE_HEADROOM_RATIONALE=Operating exactly at a hard external ceiling leaves zero margin for clock skew between this coordinator's nowMs source and whatever clock SEC's own edge measures against, this coordinator's own window-boundary granularity, and any future second caller sharing this same provider-scoped (not call-site-scoped) budget. A 20% cut (10->8) matches the same order of margin this codebase's own network-policy/backoff jitter factors already use elsewhere -- not an arbitrary number.
```

## 14-15. Coordination-scope analysis and selection

Full analysis lives in `sec-d1-rate-coordinator.ts`'s own doc comment
(reproduced in full there, not duplicated verbatim here to avoid drift
between two copies — see that file). Summary:

| Candidate | Cross-isolate | Atomic | Latency | Failure mode | Burst behavior | Retry coordination | Op. complexity |
|---|---|---|---|---|---|---|---|
| Process-local singleton | **NO** | n/a | ~0 | n/a | n/a | n/a | trivial |
| Cloudflare native `[[ratelimits]]` | NO (per-colo) | NO ("eventually consistent") | ~0 | fails open per Cloudflare's own docs | fixed 10s/60s window only | none | low |
| New Durable Object | YES | YES | tens of ms | configurable | configurable | app-level | **requires new binding + deploy (prohibited this checkpoint)** |
| **D1 sliding-window log (selected)** | YES | YES (SQLite single-writer serialization) | tens of ms | fail closed (catches, denies) | genuine sliding window, no boundary doubling | every retry re-calls `tryAcquire` | low (reuses existing `DB` binding) |

The native-binding rejection reasons are not a fresh judgment call —
they're the exact three reasons `document-ingress-admission-control.ts`
(SUN-1222C0-R1) already established for a structurally identical
problem in this codebase, cited rather than re-litigated, and they apply
with equal or greater force here (SEC's 1-second window is 8x finer than
the binding's coarsest 10-second option).

```
SELECTED_SEC_RATE_COORDINATOR=D1-backed sliding-window log (SecD1RateCoordinator + D1SecRateWindowRepository)
WHY_CORRECT_FOR_PRODUCTION_TOPOLOGY=every Cloudflare Worker isolate shares the same logical D1 database (not per-isolate state), and D1 serializes writes to it -- the same real property document-ingress-admission.ts already proved atomic under concurrent callers for a structurally identical statement shape, re-proven here directly against real Miniflare D1 up to 100 simultaneous callers (section 21)
```

## 16. Fail-closed coordinator behavior

`SecD1RateCoordinator.tryAcquire` catches any error from the repository
(including a D1 failure surfaced as `RepositoryResponse.ok === false`)
and returns `{ allowed: false, reason: 'coordinator_unavailable' }` —
proven directly (`sec-rate-window.test.ts`'s dedicated fail-closed test,
a throwing fake repository).

```
COORDINATOR_FAILURE_ALLOWS_UNLIMITED_SEC_REQUESTS=NO
```

## 17. Genuine RED — concurrency

`sec-edgar-aggregate-rate-red.test.ts`: two independently-constructed
`SecSubmissionsAdapter` instances (exactly mirroring how the real
executor constructs one per job, with no coordinator wired — matching
the pre-fix default), each fed a concurrent burst, together produced **up
to 20 simultaneous in-flight SEC-bound request starts** — measured via a
counting fake transport, not inferred. Fake clock/transport throughout;
no real SEC request.

```
AGGREGATE_RATE_RED=YES
```

Per this checkpoint's own instruction not to overclaim: this proves
absence of shared coordination among independently-constructed adapter
instances (an exact structural mirror of the real per-job construction
pattern), not a directly-observed real-wall-clock SEC-side schedule
exceeding 10/s against the live data.sec.gov service — no real SEC
request was made to check that, nor should one have been.

## 18. Implementation

`packages/provider-adapters/src/rate-limit/aggregate-coordinator.ts`:
storage-agnostic `RateCoordinator` interface + `NullRateCoordinator`
(fail-open default, used by every existing caller so nothing else
changes). `SecSubmissionsAdapter` gained an optional 5th constructor
parameter, defaulted to `NullRateCoordinator`; `execute()`'s retry loop
calls `tryAcquire` at the top of **every** attempt (not only the first),
throwing the denial as a `RateLimitedError` so it flows through the
already-correct bounded-backoff/terminal-result handling rather than a
parallel code path.

`apps/edge-api`: `D1SecRateWindowRepository` (migration `0009`, one row
per admitted request — a genuine sliding window, never a fixed-window
counter) + `SecD1RateCoordinator`, wired into the one real production call
site by threading the route's already-required `D1Database` through
`buildCompanyEvidenceGraphV2ProductionExecutor`'s signature.

No unbounded memory growth: every `tryAdmit` call deletes this
provider's own rows older than the trailing window in the same D1
`batch()` transaction as the conditional insert.

## 19-20. Burst semantics and window-boundary proof

`sec-rate-window.test.ts`, real Miniflare D1 throughout:

```
SEC_MAX_OBSERVED_REQUEST_STARTS_PER_1S_WINDOW=8 (the configured operational ceiling -- proven never exceeded even at 100 concurrent racers, section 21)
SEC_WINDOW_BOUNDARY_TEST=PASS
```

The boundary test specifically: 8 requests land at t=[1,999] (a naive
fixed window bucketed to [0,1000) would allow all 8); a 9th request at
t=1001 is correctly denied because the genuine sliding window still
counts most of the earlier 8 (a naive fixed window would instead start a
fresh bucket at t=1000 and wrongly allow 8 more, an effective 16-request
double burst). A companion test proves the window also frees capacity
incrementally as entries individually age out, not all-at-once at a
fixed boundary.

## 21. Multi-job concurrency matrix

Real Miniflare D1, real `Promise.all`, real SQLite concurrency — not a
logic double:

| Concurrent callers | Admitted (ceiling=8) |
|---|---|
| 1 | 1 |
| 10 | 8 |
| 11 | 8 |
| 50 | 8 |
| 100 | 8 |

Every case: `admitted === Math.min(concurrent, ceiling)`, never more.

## 22. 429 + rate-coordinator integration

`sec-edgar-rate-coordinator-wiring.test.ts`'s fourth test: a fake
coordinator denies once then admits — proves the **retry** attempt
genuinely re-invokes `tryAcquire` (2 calls recorded), not a cached first
decision.

```
RETRY_BYPASSES_RATE_COORDINATOR=NO
```

## 23-25. 403/429/5xx handling

All three proven end-to-end through real adapters in
`secure-http-client-cross-adapter-status-regression.test.ts` and
`sec-edgar-rate-coordinator-wiring.test.ts`: never parsed as data, bounded
retry only, terminal failure is an explicit `resultClass`
(`permanent_failure`/`rate_limited`/`retryable_failure`), never `success`.

```
SEC_403_HANDLING=PASS
SEC_429_HANDLING=PASS
SEC_5XX_HANDLING=PASS
```

## 26. Company executor failure semantics

Covered by the existing, unmodified, already-passing test suites this
checkpoint re-ran and did not touch: `company-evidence-graph-v2-cdp-
composition.test.ts` (5/5), `service-runtime`'s `chaos.test.ts`
("an adapter that throws during company_evidence_graph.v1 never crashes
the dispatcher and never returns success"), `verified-absence.test.ts`,
`freshness.test.ts`. This checkpoint's own new tests
(`secure-http-client-cross-adapter-status-regression.test.ts`'s
`SecSubmissionsAdapter` case, `sec-edgar-rate-coordinator-wiring.test.ts`)
extend the same invariant to the two new failure modes it introduces
(HTTP-status misclassification, aggregate rate denial) — neither ever
produces a fabricated/partial success.

```
COMPANY_SEC_FAILURE_MATRIX=PASS
```

## 27. Payment/economics non-regression

Zero touched: no pricing, network, asset, payTo, authorization,
settlement-owner, PCC-signing, receipt-economics, or MCP/A2A
service-mapping file appears in this checkpoint's diff (confirmed via
`git diff --stat 4c63c7f HEAD` — the full file list is entirely
`provider-adapters`/`sec-rate-window`/`sec-d1-rate-coordinator`/the two
executor-wiring lines that add a `db` parameter, nothing else).
`company-evidence-graph-v2-cdp-composition.test.ts` re-ran green,
re-confirming the frozen 31200 atomic economics unchanged.

```
ECONOMIC_CONFIG_CHANGED=NO
TOTAL_PRODUCTION_SETTLE_CALLSITES=1 (paid-continuation-workflow.ts:599, deps.settlement.evidenceProvider.settle(), unchanged)
PUBLIC_API_SETTLE_CALLSITES=0
```

## 28. SSRF/transport non-regression

Full `provider-adapters` suite re-ran (368 tests, 27 files) including
`http-ssrf.test.ts` (31 tests) and `dns-rebinding.test.ts` (21 tests),
both untouched and green. `classifyTerminalHttpStatus` runs strictly
*after* the redirect-chain/URL-validation/network-policy checks, never
altering them.

```
SECURE_HTTP_SECURITY_REGRESSION=PASS
```

## 29. Observability

No new instrumentation layer added. Confirmed by reading the full
package: `AuditEventSink`/`context.audit_event_sink` are already
constructor/context-level dependencies on every adapter (including
`SecSubmissionsAdapter`) but are never actually invoked anywhere in
`provider-adapters` today (`grep -rn "audit_event_sink\." src` returns
zero hits outside tests) — this is a pre-existing, consistent,
package-wide convention (observability happens at the route/Workflow
layer, which already has real `job_state_events`/`security_events`/
`audit_events` D1 tables), not a gap specific to this checkpoint's new
code. Adding a new, inconsistent instrumentation pattern just for the
rate coordinator would contradict that convention rather than follow it.
Every classified failure (`rate_limited`/`permanent_failure`/
`retryable_failure`/`coordinator_unavailable`) is already a distinct,
safely-loggable `resultClass`/`reason` string, observable by whatever
higher layer chooses to record it. No secret, payment signature, private
key, or credential header ever appears in any thrown message —
`classifyTerminalHttpStatus`'s messages contain only a static
description and the HTTP status number; the User-Agent value itself
(`SITEBORNE hello@siteborne.com`) is public operational metadata, safe
to log if ever needed.

## 30. Official SEC policy re-reconciliation

Re-read live from `sec.gov/os/accessing-edgar-data` and `sec.gov/developer`
during this checkpoint (not reused from R1's copy). Byte-for-byte
identical guidance to R1's 2026-09-06 reading: "Current max request
rate: 10 requests/second"; "limit each user to a total of no more than
10 requests per second, regardless of the number of machines used";
declared User-Agent requested, sample format "Sample Company Name
AdminContact@<sample company domain>.com"; no authentication for
data.sec.gov; no documented 429/Retry-After contract (enforcement is via
IP blocking, not a described status-code protocol). No material change
found — no STOP triggered.

```
SEC_POLICY_REVIEW_DATE=2026-09-06
SEC_DATA_API_AUTH_REQUIRED=NO
```

## 31. Final proposed TermsReview (NOT registered)

Frozen verbatim in
`sec-edgar-terms-review-local-validation.test.ts` as
`PROPOSED_SEC_EDGAR_TERMS_REVIEW`:

```ts
{
  providerId: 'sec-edgar',
  termsUri: 'https://www.sec.gov/os/accessing-edgar-data',
  termsHash: null,
  reviewedAt: null, // operator sets the real timestamp only upon actual registration
  status: 'verified',
  reviewBasis: 'provider_terms_review', // not operator_risk_acceptance -- SEC has one single reviewable policy and the manifest already asserts all three permission flags as true
  reviewer: 'PENDING_OPERATOR_APPROVAL',
  notes:
    'SEC EDGAR company_submissions API (data.sec.gov/submissions/CIK*.json), no ' +
    'authentication required, per SEC's own published Fair Access policy ' +
    '(sec.gov/os/accessing-edgar-data, sec.gov/developer -- reviewed 2026-09-06, ' +
    'no material change from the same-day re-check). SITEBORNE now (SUN-1222C2-Q1-R1/R2): ' +
    'declares a compliant User-Agent (SITEBORNE hello@siteborne.com) on every real ' +
    'request; validates CIK format before constructing any request URL (no SSRF/path ' +
    'escape); evaluates HTTP status before treating any response as data -- 404/429/' +
    '401/403/408/5xx are never fabricated into a success; retries are bounded (max 3), ' +
    'honor a valid Retry-After, and are coordinated through the same aggregate limiter ' +
    'as every other attempt; enforces an aggregate, D1-backed, cross-isolate sliding-' +
    'window rate coordinator capped at 8 req/s (20% headroom below the published 10 ' +
    'req/s ceiling), fails closed (denies) if that coordinator is itself unavailable, ' +
    'proven under real SQLite concurrency up to 100 simultaneous callers. This review ' +
    'does not claim any enforcement mechanism beyond what these two checkpoints' own ' +
    'tests actually proved.',
}
```

No claim in `notes` exceeds what a test in this or the R1 checkpoint
actually proved.

## 32. Local validation

`sec-edgar-terms-review-local-validation.test.ts`, 7/7 pass, exercised
only against a throwaway local `TermsGuard` — never `globalTermsGuard`
(the final test in the file asserts `globalTermsGuard.getReview('sec-
edgar')` is still `undefined` after the whole file runs):

- No review recorded → fail closed. ✓
- Exact proposed review → passes. ✓
- An arbitrarily stale `reviewedAt` (2020) → still passes. This
  architecture has **no staleness/expiry enforcement** — confirmed by
  reading `TermsGuard.checkAccess`'s complete source, not assumed. Stated
  honestly here rather than fabricating a freshness mechanism that
  doesn't exist in this codebase.
- Wrong provider identity → fails. ✓
- `termsHash` mismatch → fails. ✓
- `pending_review`/`blocked` status → fails regardless of everything else
  being otherwise correct. ✓

```
SEC_TERMS_REVIEW_LOCAL_VALIDATION=PASS
```

## 33. Registration status

```
SEC_TERMS_REVIEW_REGISTERED=NO
```

`packages/provider-adapters/src/policy/terms-guard.ts` is untouched by
this checkpoint (confirmed by `git diff 3cbee0e HEAD --
'**/terms-guard.ts'` showing nothing). The proposed object exists only
as a constant inside a test file proving it *would* pass validation —
never imported by, or added to, `globalTermsGuard`'s constructor array.

**Exact destination if/when registered:**
`packages/provider-adapters/src/policy/terms-guard.ts`, line 211 —
`export const globalTermsGuard = new TermsGuard([DIRECT_PUBLIC_HTTP_TERMS_REVIEW]);`
would become
`export const globalTermsGuard = new TermsGuard([DIRECT_PUBLIC_HTTP_TERMS_REVIEW, SEC_EDGAR_TERMS_REVIEW]);`
alongside a new exported `SEC_EDGAR_TERMS_REVIEW` constant (mirroring
`DIRECT_PUBLIC_HTTP_TERMS_REVIEW`'s own placement, lines 176-209) with
`reviewedAt`/`reviewer` filled in with the operator's real approval
timestamp/identity at registration time — the only two fields this
report deliberately leaves as placeholders.

## 34. Governance approval text (for the human to send in a future checkpoint, if appropriate)

> I authorize registering the exact `sec-edgar` `TermsReview` object
> frozen in `SUN-1222C2-Q1-R2`'s evidence report (§31) — and only that —
> into `packages/provider-adapters/src/policy/terms-guard.ts`'s
> `globalTermsGuard`, filling in `reviewedAt` with the real approval
> timestamp and `reviewer` with my real identity. This does not authorize
> any deployment, any Cloudflare mutation, any real SEC request, any
> payment, any retry of Q1, or starting Q2.

This sentence is not itself authorization — it is text prepared for the
human to send standalone, in a future checkpoint, only if they choose to.

Note left un-decided deliberately: `SEC_RATE_LIMIT_RELEASE_BLOCKER` is
now `NO` (closed this checkpoint), but the operator may still want to
weigh the 8 req/s operational ceiling choice before registering — this
report does not decide that for them.

## 35. Mutation proof — rate coordinator

Temporarily replaced `SecD1RateCoordinator.tryAcquire`'s body with an
unconditional `return { allowed: true }`, bypassing all real logic.
Re-ran `sec-rate-window.test.ts`: 3 of its 16 tests correctly failed (the
10-simultaneous-admits-exactly-8 test, the sustained-load test, and the
fail-closed test) — the 1/10/11/50/100 concurrency-matrix tests, which
exercise the *repository* directly rather than the coordinator, correctly
continued to pass (they were never testing the coordinator's own logic).
Restored; re-verified 16/16.

```
SEC_RATE_COORDINATOR_MUTATION_PROOF=PASS
```

## 36. Full targeted tests

| Suite | Result |
|---|---|
| `secure-http-client-status-semantics.test.ts` | 18/18 |
| `secure-http-client-cross-adapter-status-regression.test.ts` | 8/8 |
| `sec-edgar-aggregate-rate-red.test.ts` | 2/2 |
| `sec-edgar-rate-coordinator-wiring.test.ts` | 4/4 |
| `sec-edgar-terms-review-local-validation.test.ts` | 7/7 |
| `sec-rate-window.test.ts` (real Miniflare D1) | 16/16 |
| `sec-edgar-user-agent-compliance.test.ts` (R1, re-verified) | 2/2 |
| `sec-edgar-cik-request-validation.test.ts` (R1, re-verified) | 13/13 |
| `sec-edgar-terms-review-gap.test.ts` (D1, re-verified) | 6/6 |
| Full `provider-adapters` suite | 368/368 (6 skipped, pre-existing live-gate skips) |
| Full `edge-api` suite | 1157/1157 (72 skipped) |
| `company-evidence-graph-v2-cdp-composition.test.ts` | 5/5 |
| `protocol-x402` full check | PASS |
| `protocol-a2a` full check | PASS |
| `protocol-mcp` full check | PASS |
| `service-runtime` full suite | 165/165 |

## 37. Full repository gate

```
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
```

`pnpm mcp:check` / `pnpm x402:check` / `pnpm a2a:check` /
`pnpm exec tsx scripts/test-worker-runtime.mts` (99/99, includes a real
`wrangler deploy --dry-run`): all PASS.

`format:check`: re-ran; same pre-existing baseline as R1 (462 files,
confirmed via the same `git stash`-on-clean-tree technique in R1 —
re-confirmed unaffected by this checkpoint's own new/changed files,
which are all clean per direct `prettier --check` on each one).

`secrets:scan`: **2** findings now, not R1's 1 — both are duplicates of
the exact same pre-existing false positive (`3a74686d-bad8-...`, a
Cloudflare Worker version UUID, already flagged via `task_1f6eb5a9` in
R1). The second is this checkpoint's own R1 evidence report quoting that
same UUID string verbatim while documenting the first finding — an
inherent, harmless consequence of transparent documentation, not an
independent new leak. Reported honestly here rather than characterizing
the scanner as clean.

`pnpm test` (full monorepo, single run): **2920 passed, 14 failed, 78
skipped** (3012 total, 265 files, 8 failed files). All 14 failures were
individually re-run in isolation and **all passed** (8/8 files, including
every assertion in `load-v2.test.ts`, `x402-service-route.test.ts`,
`production-cdp-provider-wiring.test.ts`,
`production-cdp-full-stack-mock.test.ts`, `nevermined-service-route.test.ts`,
`nevermined-live-migration-idempotency.test.ts`,
`production-route-continuation-wiring.test.ts`, and the
already-known-from-R1 `worker-bridge.subprocess.test.ts` OCR-fixture
timing flake) — none of the 8 failed files touch any code this checkpoint
changed (they exercise `verify_agent_output.v2`/`web_context_verified.v2`/
`company_evidence_graph.v1`/Nevermined rails and `x402-service.ts`'s own
generic replay logic, none of which appear in this checkpoint's diff).
The failure signatures (hardcoded latency thresholds in `load-v2.test.ts`,
a timing-sensitive 503 assertion, D1-concurrency-sensitive Nevermined/CDP
tests) match resource contention from running this full 3012-test suite
simultaneously alongside ~10 other parallel gate commands
(`typecheck`/`build`/`mcp:check`/`x402:check`/`a2a:check`/`format:check`/
`worker-runtime`) this same checkpoint intentionally ran in parallel to
save wall-clock time — not a regression this checkpoint introduced.
Reported honestly (a single contended run failed 14 tests) rather than
only reporting the clean isolated re-verification.

## 38. Release-blocker decision

```
SEC_RATE_LIMIT_RELEASE_BLOCKER=NO (real, D1-backed, atomicity-proven aggregate enforcement now exists)
SEC_HTTP_STATUS_RELEASE_BLOCKER=NO (non-2xx misclassification fixed and regression-tested across every consumer)
```

Both of R1's carried-forward blockers are closed. Q1 fresh-retry
eligibility is **still** gated by the one remaining, unrelated, and
deliberately-untouched item: `SEC_TERMS_REVIEW_REGISTERED=NO` (§33) — a
separately-governed human decision this checkpoint does not make.

## 39. Mutation ledger

- Repo commits: 5 (`4f54351` HTTP status fix, `ce91ea9` rate coordinator,
  `6bfa72e` local terms validation, `b84c9bf` NUL-byte hygiene fix, this
  evidence report).
- Production/Cloudflare mutations: 0.
- External mutations: 0.
- Real SEC requests: 0.
- Economic actions: 0.

```
PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
REAL_SEC_REQUESTS=0
ECONOMIC_TRANSACTIONS=0
```

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
