# SUN-1222C-R4-D3: Public Error-Contract Reconciliation

**Checkpoint class:** repo-only correction, no deployment, no economic activity.
**Trigger:** SUN-1222C-R4-D2 discovered a genuine pre-deployment regression and halted before any mutation.

## 1. The D2 blocker

`SUN1222C_R4_D2=BLOCKED`. Re-running the full deployment-critical test matrix (not the
narrower subset R4-FIX had verified) surfaced a failing pre-existing test:

```
apps/edge-api/tests/x402-service-route.test.ts
  › SUN-1221E2D — executor failures surface a sanitized diagnostic audit event,
    never new detail in the public 502 body
  › writes a service_execution_diagnostic audit_events row correlated by job_id,
    without adding to the public response

AssertionError: expected { …(3) } to not have property "details"
- Expected: undefined
+ Received: "direct-public-http did not succeed (permanent_failure) for https://unreachable.example/"
```

`SUN-1221E2D` (an earlier, deliberate checkpoint) established and tested an explicit
security boundary: **the public `executor_rejected` HTTP response must never carry a
`details` key, or any other diagnostic field, for any executor failure, regardless of
service.** Diagnostic detail was designed to live only in an internal, operator-only
trail.

`SUN-1222C-R4` (commit `9f282e4`) violated that boundary: it added a passthrough in
`x402-service.ts` that put the new `WorkflowContinuationResult.error_detail` field
directly into the public response's `details` field.

No live mutation occurred at any point: `HOST_DEPLOYMENTS=0`,
`PUBLIC_CANDIDATE_UPLOADS=0`, `TRAFFIC_MUTATIONS=0`, `REAL_402_REQUESTS=0`,
`REAL_PAID_POSTS=0`.

## 2. Exact R4 change reconstructed

- `R4_PUBLIC_DETAILS_INTRODUCTION_FILE` = `apps/edge-api/src/control-plane/routes/x402-service.ts`
- `R4_PUBLIC_DETAILS_INTRODUCTION_FUNCTION` = `respondFromWorkflowResult`'s
  `case 'executor_rejected':` branch, which called `jsonError(c, 502,
  'service_execution_failed', result.error_code ?? 'executor_rejected',
  result.error_detail)` — the 5th argument (`details`) is what `SUN-1221E2D` forbids.
- `R4_INTERNAL_ERROR_DETAIL_SOURCE` = `paid-continuation-workflow.ts`'s
  `deriveErrorDetail()`, populating the new, additive
  `WorkflowContinuationResult.error_detail` field (`types.ts`). This function and field
  are **unchanged by this checkpoint** — they remain the correct internal
  representation.
- `R4_PUBLIC_RESPONSE_CONSTRUCTION_PATH`: executor result (`failure.message` or last
  `limitations` entry) → `paid-continuation-workflow.ts`'s `terminal('executor_rejected',
  ..., { error_detail })` → `WorkflowContinuationResult.error_detail` →
  `x402-service.ts`'s `respondFromWorkflowResult` → `jsonError(...)` → public HTTP body
  `{ error, message, details }`.

## 3. Existing internal diagnostic surfaces (proving public leakage is unnecessary)

| Surface | Persists error_detail | Operator readable | Publicly exposed | Durable | Correlated by job_id |
|---|---|---|---|---|---|
| `WorkflowContinuationResult.error_detail` (in-memory return value) | YES | YES (via the calling request, or Workflow instance retention) | NO (after this fix) | Partial — lives in the Workflow instance's own retained step/return output | YES (per-invocation) |
| Cloudflare Workflow instance status/output (`wrangler workflows instances describe`) | YES (same value, retained by the platform) | YES | NO | YES (Cloudflare-retained) | YES (instance ID ↔ job_id correlated via job row) |
| D1 `jobs` table | NO (only state/status, not error_detail) | YES | NO | YES | YES |
| D1 `audit_events` | NO (SUN-1221E6R-H2AWI-3 disclosed gap — the `service_execution_diagnostic` write was removed when the executor moved into the durable Workflow; not restored by this checkpoint) | N/A | NO | N/A | N/A |
| D1 `payment_attempts` | NO | YES | NO | YES | YES (payment_identifier) |

This proves R4's diagnostic value survives entirely through the Workflow instance's own
retained output (exactly the surface `SUN-1222C-R3`/`SUN-1222C-R4-D1`'s own diagnosis
used to recover detail for six prior real attempts) — no public exposure is required.

## 4. Frozen public error contract

```
PUBLIC_EXECUTOR_REJECTED_FIELDS = { error: string, message: string }
PUBLIC_DETAILS_FIELD_ALLOWED = NO
PUBLIC_ERROR_DETAIL_FIELD_ALLOWED = NO
PUBLIC_RAW_EXECUTOR_MESSAGE_ALLOWED = NO
PUBLIC_TARGET_URL_ALLOWED_IN_FAILURE_DETAIL = NO
```

HTTP status (502) and the stable `error`/`message` fields are unchanged from
pre-`R4` behavior.

## 5. Security rationale

Internal executor diagnostics must stay separated from public paid-client responses
because a generic passthrough of any classified/sanitized string cannot bound what a
*future* executor attaches to it. Today's example (`sec-edgar company_submissions
returned permanent_failure for CIK 0000320193`) is not itself a secret, but the same
code path is shared, unconditionally, by all four v2 services (`company_evidence_graph`,
`web_context_verified`, `document_evidence_json`, `verify_agent_output`) and by any
future one. A generic pipe from "whatever an executor's `failure.message` or
`limitations` array contains" to "the public HTTP body" has no service-specific gate to
stop it from one day carrying internal provider behavior, retrieval-mode details,
target/internal URLs, upstream error classes, infrastructure topology, provider names,
raw exception text, or — in a worse executor bug — a fragment of a response body that
itself contained transient credentials. `PUBLIC_DIAGNOSTIC_PASSTHROUGH_SECURITY_RISK =
YES`.

## 6. TDD RED

Two failing assertions confirmed genuine RED against the unmodified `9f282e4` source:

1. The pre-existing `SUN-1221E2D` test (`failure.message`-shaped executor result,
   `web_context_verified.v1`) — already failing as shown in §1.
2. A new test added by this checkpoint, `SUN-1222C-R4-D3: the same public non-leak rule
   holds for a limitations-only executor result...` — exercises the *other* branch of
   `deriveErrorDetail` (no `failure` object at all, detail only in `limitations`), using
   `company_evidence_graph.v1`'s exact real production shape (`SUN-1222C-R4-D1`'s
   diagnosed case). Failed identically:

   ```
   AssertionError: expected { …(3) } to not have property "details"
   + Received: "sec-edgar company_submissions returned permanent_failure for CIK 0000320193"
   ```

`PUBLIC_DETAILS_LEAK_RED = YES` (both branches of `deriveErrorDetail` covered).

## 7. Internal detail retention (unaffected)

`apps/edge-api/tests/paid-continuation-workflow.test.ts`'s three pre-existing R4 tests
(`error_detail` preserved for a `limitations`-only partial result; `error_detail`
prefers `failure.message` over `limitations`; `error_detail` is `undefined` when neither
exists) test `WorkflowContinuationResult.error_detail` directly and are untouched by
this checkpoint — they continue to pass, proving the internal representation is
unaffected by removing the public passthrough. `INTERNAL_DIAGNOSTIC_RETENTION_TEST =
PASS_AFTER_FIX` (never regressed — it was never broken).

## 8. Minimal source fix

`apps/edge-api/src/control-plane/routes/x402-service.ts`: removed the 5th argument
(`result.error_detail`) from the `jsonError(...)` call in the `executor_rejected`
branch. No other line changed. `error_detail` generation
(`paid-continuation-workflow.ts`), the `WorkflowContinuationResult.error_detail` field
(`types.ts`), and `ExecutorOutcome.result.limitations` (`x402-service.ts`'s type
declaration) are all **untouched** — they remain the correct internal representation,
simply never read into the public response.

## 9. GREEN

```
apps/edge-api/tests/x402-service-route.test.ts — 37/37 PASS
```

Both the pre-existing `SUN-1221E2D` test and the new `SUN-1222C-R4-D3` test pass.
`PUBLIC_DETAILS_LEAK_GREEN = PASS`, `INTERNAL_ERROR_DETAIL_RETAINED = YES` (proven by
§7's unaffected workflow-level tests).

## 10. Mutation proof

Temporarily restored the forbidden passthrough (`result.error_detail` as the `details`
argument). Re-ran the strengthened regression: both the `SUN-1221E2D` test and the new
`SUN-1222C-R4-D3` test failed with the exact leaked string. Restored the corrected
source; re-ran; both passed (37/37 total). `PUBLIC_ERROR_BOUNDARY_MUTATION_PROOF = PASS`.

## 11. Public schema stability

`PUBLIC_ERROR_SCHEMA_CHANGED_FROM_SUN1221E2D = NO`. The corrected
`executor_rejected` response is byte-identical in shape to the pre-`R4` contract:
`{ error: "service_execution_failed", message: <stable code> }`, HTTP 502. No field was
renamed or reintroduced under another name.

## 12. Operator diagnosis without public details

Demonstrated locally: for the same `limitations`-only executor result, the public
client receives `{ error: "service_execution_failed", message: "partial" }` (verified
by the new test's exact-equality assertion), while
`terminal('executor_rejected', jobId, { error_code, error_detail })`'s return value —
the same object the Workflow instance's `run()` resolves with, and thus the same object
Cloudflare retains as that instance's output — carries the full `error_code`,
`error_detail` (the specific SEC rejection string), `job_id`, and (via the job row) the
correlated `payment_identifier`. This is exactly the mechanism `SUN-1222C-R3` used to
recover diagnostic detail for six real prior attempts before `R4` existed.
`OPERATOR_DIAGNOSIS_WITHOUT_PUBLIC_DETAILS = PASS`.

## 13–14. Four-service / document-specific error boundary

`createX402ServiceRoute`'s `respondFromWorkflowResult` contains exactly one
`case 'executor_rejected':` branch in the entire file (grep-verified) — there is no
per-`serviceId` conditional anywhere in this response path. All four v2 service
compositions (`company-evidence-graph-v2-cdp-composition.ts`,
`web-context-v2-cdp-composition.ts`, `document-evidence-json-v2-cdp-composition.ts`,
`verify-agent-output-v2-cdp-composition.ts`) route through this same shared function.
The fix therefore applies uniformly by construction, not by per-service test coverage;
both concrete shapes `deriveErrorDetail` can produce (`failure.message`-populated, and
`limitations`-only) are covered by the two tests in §6/§9, one using each of
`web_context_verified.v1` and `company_evidence_graph.v1` as the configured `serviceId`
— the identical code path any v2 service's real executor result flows through.

```
COMPANY_ERROR_NONLEAKAGE  = PASS
WEBCTX_ERROR_NONLEAKAGE   = PASS
DOCUMENT_ERROR_NONLEAKAGE = PASS (shared code path, no service-specific branch)
VERIFY_ERROR_NONLEAKAGE   = PASS (shared code path, no service-specific branch)
```

## 15. Payment / post-settlement safety (unaffected)

This checkpoint's diff touches only the `executor_rejected` response-construction
line — no line in the payment verification, trust-class, evidenceMode, settlement,
PCC, or receipt paths. The full `x402-service-route.test.ts` file (37 tests, including
its settlement-ownership, replay, concurrency, and property-test suites) and the full
`paid-continuation-workflow.test.ts` suite both pass unchanged.

## 16. Full deployment-critical matrix

| Gate | Result |
|---|---|
| Typecheck | PASS (all 23 turbo tasks) |
| Build | PASS (all 12 turbo tasks) |
| Lint | PASS (all 16 turbo tasks) |
| Full test suite | 265/266 files, 2955/3033 tests pass, 78 skipped; 2 flakes (`production-cdp-full-stack-mock.test.ts` §22 5000ms timeout, `worker-bridge.subprocess.test.ts` real-subprocess 60000ms timeout) — both reconfirmed passing in isolation, both pre-existing resource-contention-sensitive tests untouched by this diff |
| `x402-service-route.test.ts` (targeted) | 37/37 PASS |
| `paid-continuation-workflow.test.ts` (targeted) | unaffected, PASS |
| `company-evidence-first-paid-e2e-local.test.ts` | 16/17 pass, 1 skipped (unaffected) |
| `mcp:check` | PASS |
| `x402:check` | PASS |
| `a2a:check` | 2/2 PASS |
| `test:worker-runtime` | 99/99 scenarios PASS |
| `secrets:scan` | 2 findings, both the same pre-existing Cloudflare Worker-version-UUID `generic-api-key` false positive (`3a74686d-bad8-4fb0-b6b8-604292145d69`) in two historical evidence reports (commits `3cbee0e`, `1e3e3d0`, both predating this checkpoint) — no new findings, no secret leak |
| `production:preflight` | PASS |
| `wrangler deploy --dry-run` (public API) | clean, bindings unchanged |
| `wrangler deploy --dry-run` (Workflow host) | clean, bindings unchanged (pre-existing benign `unenv`/`whatwg-url` build warning only) |

## 17. Secret / diagnostic leak scan

`PUBLIC_DIAGNOSTIC_LEAK_PATHS = 0` — the only introduction point (§2) is now corrected;
`error_detail`/`limitations` are read in exactly two places: `paid-continuation-workflow.ts`
(generation, internal) and `x402-service.ts`'s type declaration (comment-only, marked
"internal-only, never read into the public `jsonError` response"). `grep` for `details`,
`error_detail`, `stack`, `cause` in `x402-service.ts`'s response-construction code found
no other passthrough. `PUBLIC_SECRET_LEAK_PATHS = 0` — the two `secrets:scan` findings
(§16) are pre-existing, unrelated, non-secret UUID false positives, not diagnostic
passthrough of any kind.

## 18. R4 design reclassification

```
R4_DIAGNOSTIC_DESIGN = INTERNAL_ONLY
SUN1221E2D_SECURITY_CONTRACT = PRESERVED
PUBLIC_SCHEMA_CHANGE = NO
```

The original `R4` public-passthrough approach is recorded as
`REJECTED_DURING_PREDEPLOY_REGRESSION` — not a viable design, corrected before any
deployment.

## Final packet

```
SUN1222C_R4_D3 = PASS

R4_PUBLIC_DETAILS_INTRODUCTION_FILE = apps/edge-api/src/control-plane/routes/x402-service.ts
R4_PUBLIC_DETAILS_INTRODUCTION_FUNCTION = respondFromWorkflowResult (executor_rejected case)

PUBLIC_EXECUTOR_DETAILS_POLICY = FORBIDDEN
INTERNAL_EXECUTOR_DIAGNOSTICS_POLICY = RETAINED
PUBLIC_DIAGNOSTIC_PASSTHROUGH_SECURITY_RISK = YES

PUBLIC_DETAILS_LEAK_RED = YES
PUBLIC_DETAILS_LEAK_GREEN = PASS
INTERNAL_ERROR_DETAIL_RETAINED = YES
INTERNAL_DIAGNOSTIC_RETENTION_TEST = PASS
PUBLIC_ERROR_BOUNDARY_MUTATION_PROOF = PASS
PUBLIC_ERROR_SCHEMA_CHANGED_FROM_SUN1221E2D = NO
OPERATOR_DIAGNOSIS_WITHOUT_PUBLIC_DETAILS = PASS

COMPANY_ERROR_NONLEAKAGE = PASS
WEBCTX_ERROR_NONLEAKAGE = PASS
DOCUMENT_ERROR_NONLEAKAGE = PASS
VERIFY_ERROR_NONLEAKAGE = PASS

PUBLIC_DIAGNOSTIC_LEAK_PATHS = 0
PUBLIC_SECRET_LEAK_PATHS = 0

PUBLIC_API_SETTLE_CALLSITES = 0
DEDICATED_WORKFLOW_SETTLE_CALLSITES = 1
TRUST_CLASS_MATRIX = PASS (unaffected, re-verified via full x402-service-route.test.ts pass)
POST_SETTLEMENT_FAIL_CLOSED = PASS (unaffected)

TYPECHECK = PASS
BUILD = PASS
LINT = PASS
TEST_FILES = 265/266 (2 pre-existing resource-contention flakes, both reconfirmed passing in isolation)
TESTS_PASS = 2955/3033 (+2 isolation-reconfirmed = effectively 2957)
TESTS_SKIPPED = 78
WORKER_RUNTIME = PASS (99/99)
PROTOCOL_MCP_CHECK = PASS
PROTOCOL_X402_CHECK = PASS
PROTOCOL_A2A_CHECK = PASS (2/2)
SSRF_DNS_REBINDING = PASS (unaffected, part of full suite)
X402_REPLAY_CONCURRENCY = PASS (unaffected, part of x402-service-route.test.ts)
SECRETS_SCAN = 2 pre-existing non-secret false positives, 0 new
PRODUCTION_PREFLIGHT = PASS
WRANGLER_DRY_RUN = PASS (both public API and Workflow host)

R4_DIAGNOSTIC_DESIGN = INTERNAL_ONLY
SUN1221E2D_SECURITY_CONTRACT = PRESERVED

PRODUCTION_MUTATIONS = 0
HOST_DEPLOYMENTS = 0
PUBLIC_CANDIDATE_UPLOADS = 0
TRAFFIC_MUTATIONS = 0
REAL_402_REQUESTS = 0
REAL_PAID_POSTS = 0

WORKING_TREE = clean after commit

NEXT_REQUIRED_CHECKPOINT = SUN-1222C-R4-DEPLOYMENT-RETRY
```
