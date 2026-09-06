# SUN-1222C2-Q1-R1 — SEC EDGAR Automated-Access Compliance Hardening

Repo-only checkpoint. No deploy, no Cloudflare mutation, no Modal mutation, no
production D1 mutation, no TermsReview marked verified, no real SEC request,
no payment, no signing, no settlement. D1 lineage: `4c63c7f`
(`docs/reports/SUN-1222C2-Q1-D1-sec-edgar-policy-block-diagnosis.md`).

## 0. Scope recap

D1 proved the Q1 real-paid attempt's `sec-edgar company_submissions returned
policy_blocked` limitation was `globalTermsGuard` correctly fail-closing on a
missing `TermsReview` record for `sec-edgar` — a governance gap, not a code
defect, and not something this checkpoint may close by registering a review
itself. Before any future governance decision, this checkpoint hardens the
actual SEC EDGAR request contract and documents what a safe aggregate-rate
architecture would require.

## 1. Official SEC policy reconciled (current, not third-party summaries)

Read directly from `sec.gov` on 2026-09-06:

- **https://www.sec.gov/os/accessing-edgar-data** (SEC's own "Last Reviewed
  or Updated: June 26, 2024")
  - "Current max request rate: 10 requests/second."
  - "Please declare your user agent in request headers" — sample declared
    bot header: `User-Agent: Sample Company Name
    AdminContact@<sample company domain>.com`, `Accept-Encoding: gzip,
    deflate`, `Host: www.sec.gov`.
  - "The SEC does not allow botnets or automated tools to crawl the site.
    Any request that has been identified as part of a botnet or an
    automated tool outside of the acceptable policy will be managed to
    ensure fair access for all users."
  - "Submissions by company and extracted XBRL data are available via
    RESTful APIs on data.sec.gov, offering JSON formatted data." — no
    mention of an API key or credential anywhere on this page.
- **https://www.sec.gov/developer** (SEC's own "Last Reviewed or Updated:
  March 10, 2025")
  - "Current guidelines limit each user to a total of no more than 10
    requests per second, **regardless of the number of machines used to
    submit requests**." — the ceiling is explicitly an aggregate,
    per-organization ceiling, not a per-process or per-IP one.
  - "To ensure that SEC.gov remains available to all users, we reserve the
    right to block IP addresses that submit excessive requests." — SEC's
    stated enforcement mechanism is IP blocking, not a documented
    `429`/`Retry-After` API contract.

| Field | Value |
|---|---|
| `SEC_POLICY_REVIEW_DATE` | 2026-09-06 |
| `SEC_POLICY_SOURCE_URLS` | `https://www.sec.gov/os/accessing-edgar-data`, `https://www.sec.gov/developer` |
| `SEC_DATA_API_AUTH_REQUIRED` | NO |
| `SEC_DECLARED_USER_AGENT_REQUIRED_OR_REQUESTED` | Requested explicitly ("please declare"); non-compliant/unclassified automated tools are subject to being blocked |
| `SEC_CURRENT_MAX_REQUEST_RATE` | 10 requests/second |
| `SEC_RATE_LIMIT_SCOPE` | Aggregate per user/organization, "regardless of the number of machines used" |
| `SEC_429_GUIDANCE` | Not documented on either page; stated enforcement is IP blocking, not a published status-code/backoff contract |
| `SEC_AUTOMATED_ACCESS_OTHER_REQUIREMENTS` | No botnets/"unclassified" automated tools; efficient scripting, download only what's needed; no technical support for scripting/debugging |

## 2. Declared SITEBORNE bot identity

No source file in this repository (code, docs, or config) records an
administrative contact **email**. `git log --format='%an <%ae>'` shows a
single author identity across the repository's entire real commit
history, pushed to the public `github.com/SiteBorne/utility-network`:

```
SiteBorne <hello@siteborne.com>
```

That address is therefore already public — visible to anyone viewing the
repository's commit history — and is SITEBORNE's own canonical identity,
not a value invented for this checkpoint. The organization name matches
what's already published verbatim in the production Agent Card
(`packages/protocol-a2a/src/card.ts`: `provider: { organization:
'SITEBORNE', url: 'https://siteborne.com' }`).

| Field | Value |
|---|---|
| `SEC_USER_AGENT_SOURCE` | `git log --format='%an <%ae>'` (sole author identity, 707+ commits) + `packages/protocol-a2a/src/card.ts` (organization name) |
| `SEC_USER_AGENT_ORGANIZATION` | `SITEBORNE` |
| `SEC_USER_AGENT_CONTACT` | `hello@siteborne.com` |
| `SEC_USER_AGENT_CANONICAL_FORM` | `SITEBORNE hello@siteborne.com` |
| `CONTACT_ALREADY_PUBLIC` | YES |

## 3. Request construction trace (before this checkpoint)

`CompanyEvidenceGraphService` → `SecSubmissionsAdapter.execute()` →
`fetchAndNormalize()` → `buildSubmissionsUrl(cik)` →
`SecureHttpClient.fetchJson()` → `SecureHttpClient.fetch()` → injected
`InjectedHttpClient.fetch()` (Modal safe-egress `MODAL_WEBCTX_*` endpoint in
production).

```
SEC_REQUEST_CALL_GRAPH =
  CompanyEvidenceGraphService.execute
    -> SecSubmissionsAdapter.execute (globalTermsGuard.checkAccess gate)
      -> SecSubmissionsAdapter.fetchAndNormalize
        -> submissions.ts: buildSubmissionsUrl(cik)
        -> http/client.ts: SecureHttpClient.fetchJson
          -> SecureHttpClient.fetchText -> SecureHttpClient.fetch
            -> InjectedHttpClient.fetch (Modal safe-egress client in production)
```

`SecureHttpClient.fetch()` (`packages/provider-adapters/src/http/client.ts`)
passes `options: RequestInit` straight through to the injected client, but
**no caller anywhere in the SEC path constructed any `options.headers`** —
`fetchAndNormalize()` called `this.httpClient.fetchJson<SecSubmissionsResponse>(url)`
with no second argument at all.

| Field | Value (before fix) |
|---|---|
| `SEC_USER_AGENT_PRESENT_BEFORE` | NO |
| `SEC_ACCEPT_ENCODING_PRESENT` | NO |
| `SEC_REQUEST_HOST` | `data.sec.gov` (hardcoded literal in `buildSubmissionsUrl`) |
| `SEC_TIMEOUT` | 30000 ms (`DEFAULT_HTTP_CONFIG.timeoutMs`) |
| `SEC_RETRIES` | up to 3 (`SEC_EDGAR_MANIFEST.rate_policy.maximum_retries`), but see §6 — only reachable for network-level errors, not HTTP status codes |
| `SEC_RATE_LIMIT_IMPLEMENTATION` | Per-`SecSubmissionsAdapter`-instance `TokenBucketLimiter` (token_bucket, `maximum_concurrency: 10`, `minimum_interval_ms: 100` ⇒ 10 tokens/sec) |

## 4. User-Agent — genuine RED → GREEN → mutation proof

New regression test:
[`sec-edgar-user-agent-compliance.test.ts`](../../packages/provider-adapters/src/tests/sec-edgar-user-agent-compliance.test.ts).
It exercises the **real** `SecSubmissionsAdapter.execute()` →
`fetchAndNormalize()` path with a header-capturing `InjectedHttpClient` and
asserts the actual outgoing request's `User-Agent` header — not that a
constant merely exists. `execution_mode: 'test'` is used deliberately: it is
the one documented way to reach the real request-construction path without
needing a `sec-edgar` `TermsReview` record (`checkAccess()`'s first line is
`if (executionMode === 'test') return;`); the injected HTTP client is a
plain function returning a canned local fixture — zero real network calls.

- **RED** (before fix): `expected null not to be null` — no `User-Agent`
  header was sent at all.
- **Fix**: `packages/provider-adapters/src/sec/submissions-adapter.ts` adds
  `SEC_EDGAR_DECLARED_USER_AGENT = 'SITEBORNE hello@siteborne.com'` and
  passes `{ headers: { 'User-Agent': SEC_EDGAR_DECLARED_USER_AGENT } }` into
  the one `fetchJson()` call site. No other header, timeout, retry, or
  rate-limit behavior touched.
- **GREEN** (after fix): both tests pass.
- **Mutation proof**: temporarily changed the constant to `'MUTATED'` —
  test failed (`expected 'MUTATED' to contain 'SITEBORNE'`); reverted;
  confirmed green again. Diff was `git diff`-clean before/after (no
  accidental residue).

| Field | Value |
|---|---|
| `SEC_USER_AGENT_RED` | YES |
| `SEC_USER_AGENT_GREEN` | PASS |
| `SEC_USER_AGENT_MUTATION_PROOF` | PASS |

## 5. CIK / path validation (§13 audit — a real, separate defect found and fixed)

Auditing `buildSubmissionsUrl` (`packages/provider-adapters/src/sec/submissions.ts`)
for request-forgery/path-escape, independent of the User-Agent work:
`cik.padStart(10, '0')` only left-pads a string **shorter** than 10
characters — a `cik` already ≥ 10 characters passed through completely
unvalidated into the URL template literal, which the WHATWG `URL` parser
then dot-segment-normalizes. Proven by direct construction (no adapter, no
network) before any fix:

```
cik = "../../../../etc/passwd"
  -> "https://data.sec.gov/submissions/CIK../../../../etc/passwd.json"
  -> new URL(...).pathname === "/etc/passwd.json"   (escapes /submissions/ entirely)
cik = "1/2"       -> pathname "/submissions/CIK00000001/2.json"        (extra segment)
cik = "0000320193?x=1" -> adds a query string to the real outbound request
```

The host stays `data.sec.gov` in every case (it's a hardcoded literal in the
template) — this is **not** cross-host SSRF — but it is a genuine
same-origin path-escape / request-forgery defect: a crafted `cik` could
make SITEBORNE issue an arbitrary GET to any path on `data.sec.gov`, or
inject an arbitrary query string into the real request.

**Reachability in production**: the one production call site
(`company_evidence_graph.v2`'s x402 request body) is already protected by
the AJV-compiled contract schema
(`schemas/services/company-evidence-input.schema.json`:
`identifiers.cik` pattern `^[0-9]{10}$`), so this defect is **not**
currently reachable through the public paid API. This fix is
defense-in-depth for `buildSubmissionsUrl` itself, which had no such
caller-independent guarantee (a future direct caller, script, or test
fixture would have had none of AJV's protection).

New regression test:
[`sec-edgar-cik-request-validation.test.ts`](../../packages/provider-adapters/src/tests/sec-edgar-cik-request-validation.test.ts)
(13 cases: valid full/short CIK, path traversal, extra segment, query
injection, host-confusion suffix, fragment injection, embedded NUL,
non-ASCII, empty string, >10 digits, leading `+`).

- **RED**: 10/13 cases failed (`expected [Function] to throw an error`) —
  every malicious input was silently accepted.
- **Fix**: `buildSubmissionsUrl` now throws
  `Invalid CIK format: expected 1-10 ASCII digits, got ...` for anything not
  matching `/^[0-9]{1,10}$/`, before the URL is ever constructed.
- **GREEN**: 13/13 pass.
- **Mutation proof**: temporarily replaced the guard condition with `if
  (false)` — 10/13 tests failed again (guard proven load-bearing); reverted;
  confirmed 13/13 green again.

Two sibling functions in the same file (`buildFilingDetailUrl`,
`buildPrimaryDocumentUrl`) share the same unvalidated-concatenation pattern
on their `accessionNumber` parameter, but are not called anywhere in the
current production or test code (`grep` found zero call sites outside their
own file). Left unchanged — out of this checkpoint's minimal-diff scope —
and flagged separately (see §11).

## 6. A more serious finding: SEC HTTP status codes are never inspected (documented, not fixed here)

While tracing retry/429 behavior (§8 below), found that
`SecureHttpClient.fetch()` (`packages/provider-adapters/src/http/client.ts`)
**never inspects `response.status` except for the five 3xx redirect codes**.
Every other status — 200, 429, 403, 500, anything — falls through to
`readBoundedBody()` and is returned as an ordinary successful `HttpResponse`
as long as the body is JSON-parseable and the media type is allowed.

Consequences specific to the SEC path:

- `SecSubmissionsAdapter.execute()`'s own `if (error instanceof Response &&
  error.status === 429)` branch (with its Retry-After-aware backoff) can
  **never fire** — `SecureHttpClient` never throws a `Response` object, only
  plain `Error`s (media-type/size/JSON-parse failures) or a successful
  return. This is dead code today.
- `SecSubmissionsResponseSchema` (a full Zod schema for the real SEC
  response shape) is **defined in `submissions.ts` but never `.parse()`d
  anywhere** — `fetchAndNormalize()` casts the parsed JSON directly via a
  TypeScript generic (`fetchJson<SecSubmissionsResponse>`) with no runtime
  validation.
- Net effect: a real SEC 429/403/5xx response with a JSON-shaped error body
  (e.g. `{"error": "too many requests"}`) would not be recognized as a
  failure at all — it would be treated as an ordinary 200 success, and
  `normalizeEntity()`/`normalizeFilings()` would silently produce an entity
  record with `undefined` fields rather than throwing. A JSON-shaped error
  body is a realistic scenario, not a corner case, for any API gateway or
  CDN in front of `data.sec.gov`.

This is **not** a SEC-specific defect — it's an architectural gap in the
shared `SecureHttpClient` used by every provider adapter in this package
(`PublicHttpAdapter`, `FederalRegisterAdapter`, `SecCompanyFactsAdapter`,
etc.), not something a minimal "declare a User-Agent for SEC" checkpoint
should fix by touching a cross-cutting, every-adapter-affecting shared
client. Fixing it correctly (status-aware branching, a distinguishable
error type for 4xx/5xx, wiring that into the existing backoff/circuit-breaker
logic, and adding the missing `SecSubmissionsResponseSchema.parse()` call)
is its own TDD project with a much larger regression surface than this
checkpoint's two targeted fixes. **Documented and flagged for a dedicated
follow-up checkpoint (§11); not fixed here.**

## 7. Retry / 429 / 403 behavior

Given §6, the practical behavior today is:

| Field | Value |
|---|---|
| `SEC_429_BEHAVIOR` | Not detected as 429 at all — dead-code path (see §6); a JSON-shaped 429 body would silently be misclassified as `success` |
| `SEC_403_BEHAVIOR` | Same as 429 — not distinguished from 200 at the transport layer |
| `SEC_RETRY_COUNT_MAX` | 3 (`SEC_EDGAR_MANIFEST.rate_policy.maximum_retries`), but only reachable via `isRetryableError()`'s network-level string match (`timeout`/`network`/`econnreset`/`etimedout`/`socket hang up`) — a `JSON parse failed` error from a non-JSON 429/403 body does not match any of those and is **not** retried |
| `SEC_RETRY_STORM_POSSIBLE` | NO for status-triggered retries specifically — that whole path is unreachable given §6 (safe by accident, not by design; the real residual risk is silent misclassification, not a retry storm) |

No retry-behavior code change made this checkpoint (per instructions: "do
not create retry behavior merely to improve success rate," and the
underlying gap is the §6 finding, addressed there as a separate follow-up).

## 8. Response size / resource bounds — already adequate

`DEFAULT_HTTP_CONFIG` (`http/client.ts`): `maxResponseBytes: 10 * 1024 *
1024` (10 MB), `decompressionLimit: 50 * 1024 * 1024` (50 MB),
`timeoutMs: 30000`, `maxRedirects: 10`. `readBoundedBody()` enforces the byte
cap while streaming (throws mid-stream, not just via `Content-Length`).
Adequate for a single company's SEC submissions JSON; no change made.

## 9. Cache / duplicate-request behavior

`SecSubmissionsAdapter` owns a per-instance `InMemoryCache` keyed on
`(providerId, capability, cik, forms, maxFilings, adapterVersion,
normalizationVersion)`. However, `buildCompanyEvidenceGraphV2ProductionExecutor`
(`apps/edge-api/src/control-plane/production/company-evidence-graph-v2-production-executor.ts`)
constructs a **brand-new** `SecSubmissionsAdapter` (and therefore a brand-new,
empty `InMemoryCache`) inside its returned per-request closure — i.e. once
per paid job, not once per process. The cache can never survive across two
different paid requests in production, even for the identical CIK seconds
apart.

| Field | Value |
|---|---|
| `SEC_REQUEST_COALESCING_PRESENT` | NO (no cross-job coalescing possible — adapter and cache are reconstructed fresh per job) |
| `SEC_CACHE_POLICY` | Per-instance `InMemoryCache` with a TTL, but reconstructed empty on every production invocation — effectively no cache in production today |

Given `MAX_SEC_REQUESTS_PER_JOB=1` (established in D1), this doesn't cause
excess SEC traffic *within* one job, only a missed Fair-Access-friendly
optimization *across* jobs. Documented as an observation; no change made
(out of this checkpoint's minimal-diff scope).

## 10. Aggregate rate-control architecture (the real release blocker)

Traced the full call chain from `SecSubmissionsAdapter`'s constructor
through to where it's actually instantiated:

- `SecSubmissionsAdapter`'s constructor builds its own
  `TokenBucketLimiter` from `SEC_EDGAR_MANIFEST.rate_policy`
  (`maximum_concurrency: 10`, `minimum_interval_ms: 100` ⇒ exactly 10
  tokens/sec — **at** the SEC ceiling, with zero headroom, even for a
  single instance).
- `buildCompanyEvidenceGraphV2ProductionExecutor` returns `async (input,
  ctx) => { ... const secSubmissions = new SecSubmissionsAdapter(...); ...
  }` — a **new** adapter, and therefore a **new**, fully-refilled rate
  limiter, is constructed on **every single production job invocation**.
  Rate-limiter state has zero persistence across requests, let alone across
  concurrent ones.
- The one real cross-request concurrency ceiling that does exist is
  incidental, not SEC-aware: the Modal safe-egress function used for this
  and other buyer-URL/SEC/federal-register egress
  (`services/modal-worker/src/modal_worker/modal_app.py`) is decorated
  `@app.function(image=image, timeout=300, max_containers=3)` — capping
  concurrent containers at 3, shared across **all** consumers of that one
  Modal endpoint (not SEC-specific, not designed with SEC's 10 rps ceiling
  in mind).

| Field | Value |
|---|---|
| `SEC_AGGREGATE_RATE_CONTROL_PRESENT` | NO |
| `SEC_AGGREGATE_RATE_CONTROL_SCOPE` | None by design; the only real ceiling is Modal's `max_containers=3` on a shared, non-SEC-specific safe-egress function |
| `SEC_CONFIGURED_RATE_LIMIT_RPS` | 10 (per-instance manifest config — non-aggregate; N concurrent jobs ⇒ N independent 10 rps allowances) |
| `SEC_WORST_CASE_REQUEST_RATE_RPS` | Bounded only incidentally by the shared Modal `max_containers=3` (~3 concurrent in-flight calls system-wide across unrelated services); not a provable, SEC-aware ceiling |
| `SEC_CAN_EXCEED_10_RPS_UNDER_CONCURRENCY` | UNPROVEN — no dedicated aggregate guard exists; the incidental Modal ceiling was not designed for this and its effective req/s depends on per-request latency not load-tested against this specific question |
| `SEC_RATE_LIMIT_RELEASE_BLOCKER` | YES |

### Minimum safe coordinator (designed, not deployed)

A process-independent aggregate guarantee needs state that survives across
concurrent Worker/Workflow invocations, which today's
per-invocation-constructed `TokenBucketLimiter` structurally cannot provide.
The minimum viable design, sized well under the 10 rps ceiling for
headroom:

1. A single shared counter (e.g. a Cloudflare Durable Object, or a D1/KV
   row with a short TTL) keyed `sec-edgar:rps-window`, incremented
   atomically on every SEC EDGAR request attempt (success or failure) and
   consulted **before** `SecSubmissionsAdapter.execute()` is called.
2. A conservative ceiling below the published maximum (e.g. 3–5 req/s, not
   10) to leave headroom for the guidance's own volatility and for the
   Modal container pool being shared with other, unrelated egress traffic.
3. Reject (fail closed, no SEC call at all — matching the job's existing
   `MAX_SEC_REQUESTS_PER_JOB=1` semantics) rather than queue/retry when the
   shared counter is at capacity, to avoid building unbounded queuing
   latency into a paid, buyer-facing request.
4. Tests before any implementation: single request, sequential jobs,
   parallel jobs, burst above the configured limit, and recovery after the
   window rolls over — using the coordinator's real read/increment/expiry
   logic against a fake clock, not a mocked pass-through.

Not implemented or deployed this checkpoint — this is architecture design
output only, per instructions.

## 11. Follow-ups flagged (not fixed here — separate scope)

1. **`SecureHttpClient` HTTP-status blindness** (§6) — cross-adapter,
   affects every provider using `SecureHttpClient`, not SEC-specific. Needs
   its own TDD checkpoint: status-aware branching, a distinguishable
   4xx/5xx error type, wiring into existing backoff/circuit-breaker logic,
   and enabling `SecSubmissionsResponseSchema.parse()` (and the equivalent
   schemas for other adapters) at the point JSON is parsed.
2. **`buildFilingDetailUrl`/`buildPrimaryDocumentUrl`** (§5) — same
   unvalidated-concatenation pattern on `accessionNumber`, currently dead
   code (no call sites), low priority unless wired up later.
3. **SEC aggregate rate coordinator** (§10) — design above, not built.

## 12. Draft `sec-edgar` TermsReview (illustrative only — NOT registered)

Modeled on `DIRECT_PUBLIC_HTTP_TERMS_REVIEW`
(`packages/provider-adapters/src/policy/terms-guard.ts`), using only fields
the real `TermsReview` interface defines. This is text for the operator to
review, not a change made to `terms-guard.ts`:

```ts
{
  providerId: 'sec-edgar',
  termsUri: 'https://www.sec.gov/os/accessing-edgar-data',
  termsHash: null,
  reviewedAt: '<operator-approval timestamp, recorded verbatim from the operator, not invented here>',
  status: 'verified',
  reviewBasis: 'provider_terms_review', // SEC publishes a single reviewable
    // Fair Access policy for automated data.sec.gov access — unlike
    // direct-public-http, this is not an unreviewable-per-target situation.
  reviewer: 'operator (SITEBORNE, recorded via chat <date>)',
  notes:
    'Approved for automated access to SEC EDGAR company_submissions data ' +
    'under SEC\'s published Fair Access guidance (sec.gov/os/accessing-edgar-data, ' +
    'sec.gov/developer, reviewed 2026-09-06): declared User-Agent ' +
    '"SITEBORNE hello@siteborne.com" (SEC_EDGAR_DECLARED_USER_AGENT), no ' +
    'API key required, CIK request construction validated against path ' +
    'escape. This approval is contingent on [operator to decide: resolving ' +
    'the aggregate-rate-control blocker in SUN-1222C2-Q1-R1 §10 first, or ' +
    'explicitly accepting that residual risk pending a follow-up fix].',
}
```

`SEC_TERMS_REVIEW_REGISTERED=NO`, `SEC_TERMS_REVIEW_VERIFIED=NO` — this
draft has not been added to `globalTermsGuard` or `terms-guard.ts`.

## 13. Governance approval text (for the operator to send next, standalone)

Prepared for the operator's own use — not authorization obtained by this
checkpoint:

> I authorize registering a `sec-edgar` `TermsReview` record (provider:
> `sec-edgar`, endpoint family: `data.sec.gov` submissions API) in
> `globalTermsGuard`, based on SEC's current official automated-access
> guidance (`https://www.sec.gov/os/accessing-edgar-data`,
> `https://www.sec.gov/developer`, reviewed 2026-09-06), which I have
> reviewed. SITEBORNE will declare the User-Agent `SITEBORNE
> hello@siteborne.com`, identifying the organization and its existing
> public administrative contact. [Operator to state the configured
> aggregate request ceiling it is accepting, e.g. "no more than N req/s
> aggregate across all SITEBORNE EDGAR traffic" — SUN-1222C2-Q1-R1 found no
> such enforced ceiling exists yet; state whether this approval is
> contingent on that being built first, or accepted as a residual risk.]
> `TermsGuard`'s fail-closed design for every other unreviewed provider is
> unaffected and remains permanent. This approval authorizes registering
> the reviewed `sec-edgar` policy record only — it does **not** authorize a
> deploy, a real SEC EDGAR call, a payment, or a settlement.

## 14. Protected invariants — re-run, all pass

MCP (`stateless` legacy, edge route), A2A (aggregate `productionEnabled`, 8
contractual `AgentSkill` IDs, Agent Card JWS, edge route), x402 (spec
baseline, replay/concurrency, fixtures), TermsGuard tri-state, SSRF/DNS
protections, PCC/settlement invariants — see §15 for exact counts.
`sec-edgar-terms-review-gap.test.ts` (D1's own suite) re-run unchanged and
still green — nothing in this checkpoint altered `TermsGuard` or
`globalTermsGuard`.

## 15. Full gate

`pnpm format:check` (repo-wide composite) fails on **462 pre-existing
files**, none of which this checkpoint touched or created — confirmed by
`git stash && pnpm format:check` on the clean pre-checkpoint tree, which
fails identically (exit 1) with the same file list. This is a pre-existing
repo-wide formatting drift, unrelated to this checkpoint. All four files
this checkpoint touched/created pass `prettier --check` individually. Ran
every other gate directly rather than through the `format:check`-gated
composite scripts:

| Gate | Result |
|---|---|
| `sec-edgar-user-agent-compliance.test.ts` | 2/2 pass |
| `sec-edgar-cik-request-validation.test.ts` | 13/13 pass |
| `sec-edgar-terms-review-gap.test.ts` (D1 regression) | 6/6 pass |
| `provider-adapters` package `lint` | PASS (0 errors) |
| `provider-adapters` package `typecheck` | PASS |
| `provider-adapters` package `all:test` | 329 passed, 6 skipped (335), 22 files |
| `provider-adapters` `fixtures:verify` / `manifests:verify` | PASS (ran as part of `adapters:check`'s later steps, unaffected by the format-check early exit — confirmed via direct re-run) |
| `pnpm --filter control-plane:test` (D1 integration) | 32/32 pass |
| `pnpm mcp:check` | PASS |
| `pnpm a2a:check` | PASS |
| `pnpm x402:check` | PASS |
| `pnpm typecheck` (workspace) | PASS (23/23 tasks) |
| `pnpm lint` (workspace) | PASS |
| `pnpm build` (workspace) | PASS (12/12 tasks) |
| `pnpm test` (full monorepo vitest) | **2879 passed, 78 skipped, 237 test files passed, 22 skipped** |
| `tsx scripts/test-worker-runtime.mts` (includes real `wrangler deploy --dry-run`) | **99/99 scenarios passed** |
| `pnpm production:preflight` | PASS (all sub-checks) |
| `pnpm secrets:scan` | 1 pre-existing finding, confirmed false positive (see below) |

**Secrets-scan finding (pre-existing, unrelated, false positive):**
`gitleaks` flagged `docs/reports/SUN-1222C1-four-service-candidate-provisioning.md:13`
as a `generic-api-key` match, in commit `1e3e3d043d0ce6ca40aec2c0e34e9a16a4c65956`
(2026-09-03, before this checkpoint). Inspected the line directly: it is
`PUBLIC_API_SECOND_VERSION=3a74686d-bad8-4fb0-b6b8-604292145d69` — a
Cloudflare Worker version UUID, not a credential. This is a classic
high-entropy-string false positive in `gitleaks`'s generic detector, not a
real secret exposure, and predates this checkpoint entirely (this
checkpoint touched no `docs/reports/*` file and no historical commit).
Not modified — allowlisting `.gitleaks.toml` is a security-tooling-config
change outside this checkpoint's repo-only SEC-hardening scope; flagged
separately for the operator's own triage.

`WRANGLER_DRY_RUN` is satisfied by `test-worker-runtime.mts`'s own internal
real `wrangler deploy --dry-run` runs (documented in its own source
comments and confirmed present in its 99/99 passing output).

## 16. Working tree / mutations

`git status` at the end of this checkpoint: 2 modified files
(`packages/provider-adapters/src/sec/submissions.ts`,
`packages/provider-adapters/src/sec/submissions-adapter.ts`), 3 new files
(2 test files + this report). Zero Cloudflare mutations, zero Modal
mutations, zero D1 mutations, zero secret mutations, zero `TermsReview`
registrations, zero real SEC EDGAR requests, zero payments, zero traffic
changes.
