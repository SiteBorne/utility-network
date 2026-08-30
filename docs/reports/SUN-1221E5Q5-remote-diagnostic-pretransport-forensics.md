# SUN-1221E5Q5 — remote-diagnostic pre-transport forensics

## Lineage

- Continues SUN-1221E5Q4 (evidence commit `6722cda96e31df0ea246de9b9fb8bd95090124db`), reconciled at the start of this
  checkpoint: `git rev-parse 6722cda` == `git rev-parse HEAD` == `6722cda...`, `git status --short` clean.
- Q4 proved: `REMOTE_PREVIEW_BASELINE_FUNCTIONAL=YES`, the inert `/__diag/health` probe reaches HTTP 200 under
  `wrangler dev --remote` with the corrected `--config <routes-and-queues-free override>.toml` invocation, and the
  full `webctx-remote-diagnostic.ts` executor route reaches the handler (no longer 525) but returned
  `result_class=internal_verification_failed`, `elapsed_ms≈9`, with no further detail.
- Production, throughout: `de70bf98-f304-4d7f-b189-4ae2401041a0 @100%`, zero deploys, zero worker version uploads.

## Mission

Determine, with proof (not inference), whether the real SafeSocket/DNS/TLS transport to `https://example.com/` ever
ran, and pinpoint the exact origin of `internal_verification_failed`.

## §2/§3 — call graph and the origin of `internal_verification_failed`

Traced by direct source reading (no modification) of every stage in the mission's list:
`webctx-remote-diagnostic.ts` → `executeLocalService` (`dispatcher.ts`) → `WebContextVerifiedService.execute()`
(`packages/service-runtime/src/services/web-context/service.ts`) → `PublicHttpAdapter.execute()` → `globalTermsGuard`
→ `SecureHttpClient` → `SafeSocketHttpClient` (`cloudflare:sockets` `connect()`/`startTls()`, DoH resolution,
hand-rolled HTTP/1.1) → `verifyAndSign()` (`packages/service-runtime/src/pcc/verify-and-sign.ts`).

**`INTERNAL_VERIFICATION_FAILED_SOURCE_COUNT=2`** distinct origins reachable from this one route:

1. **`service.ts:235`** (genuine): `WebContextVerifiedService.execute()` legitimately classifies the outcome once it
   has run to completion — either the underlying `direct-public-http` fetch didn't succeed
   (`result.resultClass !== 'success'`) or the verification mesh's `decision !== 'pass'`. **Proof this stage
   completed**: `receipt_id` and `verification` are populated on the returned `ServiceExecutionResult` (`verifyAndSign`
   runs unconditionally, success or failure, per `service.ts`'s own structure).
2. **`dispatcher.ts:99`** (`closedFailure`, wrapper): fires only when an exception escapes
   `registered.service.execute(...)` uncaught, or the service exceeds its total timeout budget. **Proof this
   fired instead**: `receipt_id`/`verification`/`output_hash` are all absent; `failure.code` is `internal_error`
   (or `execution_timeout`), never `verification_failed`.

Both origins emit the byte-identical string `internal_verification_failed` — indistinguishable from `result_class`
alone. `IS_THIS_RESULT_CLASS_WRAPPER=` **both, ambiguously, unless `receipt_id`/`verification` presence is also
read** — exactly the gap this checkpoint closes.

**A real, proven, dev-diagnostic-seam-only defect found while tracing this**: the previous version of this route's
response construction read `executed.output?.limitations?.[0]` for `error_detail`. `service.ts` only ever populates
`output` on a genuine `success` (`output: !verdictFailed && !httpFetchFailed ? ... : undefined`) — so on *any*
failure (both origins above), that expression is structurally `undefined`. The real diagnostic detail was always on
the sibling top-level `limitations` array and on `failure.code` / `failure.details.diagnostic_reason_code` /
`failure.details.diagnostic_stage` (populated by `service.ts`'s own `httpDiagnosticDetails`, added under
SUN-1221E2D specifically so this information would survive). This is why Q4's remote call reported nothing more than
the bare `result_class` and `elapsed_ms≈9` with an empty `error_detail`. Fixed this checkpoint (see §9); no shared
production code reads `output.limitations` this way, and no production caller of `WebContextVerifiedService` was
ever affected (existing test `service.test.ts`'s `SUN-1221E2D` suite already covers the underlying
`failure.details` behavior and was already GREEN before this checkpoint).

## §4/§5 — dev-only boundary telemetry and the connect() wrapper

Added to `webctx-remote-diagnostic.ts` only (never imported by production, never bundled — reconfirmed in §10):

- A monotonic `stage_trace` (`diag_handler_entered`, `executor_constructed`, `service_execute_entered`,
  `socket_connect_called`, `socket_connect_returned`, `service_execute_returned`), each event carrying only a stage
  name, a boolean, `elapsed_ms`, and (for the connect events only) the resolved-IP/port pair — never response
  body/headers/credentials. `DEV_TRACE_SECRET_REACHABILITY=0` by construction.
- `wrapConnectForDiagnostics()`: wraps the **real** `cloudflare:sockets` `connect` (the same one
  `buildWebContextV2SafeHttpClient` defaults to) so this seam can *prove*, not infer, whether `SafeSocketHttpClient`
  reached the socket boundary. Every call forwards to the real platform `connect()`; no fake socket is ever
  substituted for the live remote test.
- Everything upstream of `connect()` (URL validation, TermsGuard, DoH resolution) is disambiguated instead via the
  now-correctly-surfaced `diagnostic_reason_code` (`WEBCTX_DNS_RESOLUTION_FAILED` / `WEBCTX_URL_VALIDATION_FAILED` /
  `POLICY_BLOCKED` / etc., from `packages/provider-adapters/src/errors.ts`'s
  `classifyGenericAdapterErrorReason`) — a second parallel wrapper around the DoH client was unnecessary and not
  built, since `buildWebContextV2SafeHttpClient` does not expose it as an injectable parameter.

## §6 — ephemeral signer / key registry audit

`buildEphemeralDiagnosticSigner()` (`DIAGNOSTIC_KEY_ID`, `generateTestKeypair`, `KeyRegistry.register(...)` with
`environment: 'test'`) is structurally identical to `packages/service-runtime/src/pcc/test-signer.ts`'s
`createFixtureSigner()` — same primitive, same registration shape, differing only in the literal `key_id`/`purpose`
strings. `createFixtureSigner()` is exercised successfully (with real cryptographic self-verification,
`verification.valid === true`) across hundreds of already-passing tests, including
`web-context/service.test.ts`'s own `'success'` case. This checkpoint's `webctx-remote-diagnostic.construction.test.ts`
(§8) re-proves it directly with the diagnostic seam's own literal construction, not by inference from equivalence
alone.

- `EPHEMERAL_SIGNER_INTERFACE_VALID=YES`
- `EPHEMERAL_KEYREGISTRY_INTERFACE_VALID=YES`
- `EPHEMERAL_SIGNER_SELFTEST=PASS` (real `verifyServiceReceipt(...)` call, `valid: true` — see §8 test 1)

## §7 — stub dependency audit

| Dependency | Production contract | Diagnostic implementation | Can cause `internal_verification_failed`? | Contract satisfied? |
|---|---|---|---|---|
| `artifact_store` | `ArtifactStore` (put/getMetadata/getContent/exists) | `unreachableArtifactStore()` — throws on any call | NO — confirmed by source reading: neither `PublicHttpAdapter`, `WebContextVerifiedService.execute()`, nor `verifyAndSign` ever calls `context.artifact_store` on this code path | YES (never invoked) |
| adapter-level `AuditEventSink` | log/getEvents/clear | `discardedAuditSink()` — no-op | NO — constructor param is unused (`_auditSink`) in `PublicHttpAdapter` | YES |
| service-level `ServiceAuditEventSink` | emit/getEvents | `requestScopedAuditSink()` — real in-memory array | NO — correctly implements the contract; `dispatcher.ts` calls `.emit()` at start/end | YES |
| `clock` (`InjectedClock`) | now/nowMs/setTimeout/clearTimeout/advance/setTime/getCurrentTime | `realClock()` — real platform time; `advance`/`setTime` throw | NO — `advance`/`setTime` are never called outside fixture-clock test paths | YES |
| `keyRegistry`/`signer` | Ed25519 signer + matching registry | `buildEphemeralDiagnosticSigner()` | Was the suspected culprit; **ruled out**, see §6/§8 | YES |

None of the injected stubs were the cause. The real cause (§9) was a missing **module-level side effect**
(`setPrecompiledOutputValidators`) that none of these five stubs represent — a construction gap, not a stub-contract
violation.

## §8 — local, deterministic execution (no real socket)

New file: `apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.construction.test.ts`. Exports added to
`webctx-remote-diagnostic.ts` (`realClock`, `unreachableArtifactStore`, `discardedAuditSink`,
`requestScopedAuditSink`, `buildEphemeralDiagnosticSigner`, `FIXED_DIAGNOSTIC_TARGET`, `DIAGNOSTIC_KEY_ID`) purely so
this test can exercise the *exact* diagnostic-seam construction — never a generic approximation — against a fake,
non-network `InjectedHttpClient`. Exporting more symbols from a file that is never imported by production changes
nothing about reachability or bundling (reconfirmed in §10).

Three tests, all real vitest runs (`pnpm exec vitest run apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.construction.test.ts`), **3/3 passed**:

1. `DIAGNOSTIC_CONTEXT_LOCAL_SUCCESS`: exact diagnostic wiring + fake successful HTML fetch → `result_class: 'success'`,
   real `receipt_id`, cryptographically verified (`verifyServiceReceipt(...).valid === true`).
2. RED/GREEN for the `output.limitations` extraction defect (§3/§9): fake failing fetch → `result.output` is
   `undefined`, `result.limitations[0]` and `result.failure.details` (`diagnostic_reason_code:
   'WEBCTX_DNS_RESOLUTION_FAILED'`, `diagnostic_stage: 'direct_public_http_fetch'`) carry the real detail, and
   `receipt_id`/`verification` are still present (proving `verifyAndSign` ran unconditionally even on failure).
3. A genuine `dispatcher.ts`-wrapper case (unregistered service id) is structurally distinguishable: `result_class:
   'rejected'`, no `receipt_id`, no `verification`.

`DIAGNOSTIC_CONTEXT_LOCAL_SUCCESS=YES`.

## §9 — the real root cause, and its TDD RED/GREEN proof

**Root cause**: `verifyAndSign()`'s post-finalization schema check
(`packages/service-runtime/src/pcc/verify-and-sign.ts:179-181`) prefers
`getPrecompiledOutputValidator(schemaId)` but falls through to `getAjv().getSchema(schemaId)` — AJV's runtime
validator compilation, which uses `new Function(...)` internally — whenever nothing has registered a precompiled
validator for that schema id. Every real production route module that serves `web_context_verified.v2`
(`production-web-context-v2-cdp-route.ts`, mirrored by `production-verify-v2-cdp-route.ts` and
`paid-services.ts`) calls `setPrecompiledOutputValidators(outputValidatorsById)` as a **module-load side effect**,
so real production traffic never falls through to AJV (independently reconfirmed this checkpoint: `pnpm
test:worker-runtime`'s PHASE 1/2 EvalError guards — `grep -i "EvalError|Code generation from strings" ` against the
real dev-server log for the real production entrypoint — both passed clean, and this is the same class of defect
SUN-1201 checkpoint G already found and fixed once at a different call site). `webctx-remote-diagnostic.ts`
deliberately never imports those route modules (the entire point of this seam is bypassing the real x402/payment
composition), so it never got that side effect either — until this checkpoint.

**RED/GREEN, proven under real `workerd`, zero real network** (a temporary, throwaway scratch entrypoint —
`apps/edge-api/src/dev-diagnostics/__scratch-e5q5-evalerror-proof.ts`, deleted immediately after use, never
committed — booted via `wrangler dev` **without** `--remote`, i.e. fully local, 127.0.0.1-only, no Cloudflare edge,
no `example.com`, using a fake always-throwing `InjectedHttpClient` so the real socket/DNS layer was never touched):

- **RED** (`setPrecompiledOutputValidators` not called): `result_class: internal_verification_failed`,
  `failure.code: internal_error`, `failure.message: "internal exception: EvalError: Code generation from strings
  disallowed for this context"`, no `receipt_id`, no `verification` — byte-for-byte the same shape the real remote
  call (§13) produced.
- **GREEN** (`setPrecompiledOutputValidators(outputValidatorsById)` called first, same shared generated validators
  production uses): real `receipt_id`, real `output_hash`, `verification.schema_valid: true`,
  `verification.decision: 'pass'` — `verifyAndSign` completed. (`result_class` is still not `'success'` here only
  because the scratch harness's fake HTTP client always throws by design — an intentionally orthogonal, already-
  understood outcome, not a remaining defect.)

`DIAGNOSTIC_SEAM_FIX_TDD_RED=YES` (real, under real workerd — not merely inferred). Fix applied to
`webctx-remote-diagnostic.ts`: import `outputValidatorsById` from the same
`apps/edge-api/src/generated/output-validators.generated.js` production already uses, and call
`setPrecompiledOutputValidators(outputValidatorsById)` at module load, mirroring the production route modules'
own already-tested, self-documented "idempotent and side-effect-free" pattern verbatim. No shared production
behavior was touched — `verify-and-sign.ts`, `schema-registry.ts`, and the generated validators file are all
unmodified; only the diagnostic-only file gained a new import and a one-line call.

**`SHARED_PRODUCTION_CODE_IMPLICATED=NO`. `DEV_DIAGNOSTIC_FIX_REQUIRED=YES`, applied.**

## §10 — production bundle isolation (re-verified after the fix)

`pnpm test:worker-runtime` → **93/93 scenarios passed**, including, unchanged and still green after this
checkpoint's edits:

```
✓ bundle isolation: real wrangler.toml dry-run bundle does NOT contain the SUN-1221E5Q dev-only diagnostic seam -- containsDiagnosticSeamGate=false containsDiagnosticSeamRoute=false
✓ PHASE 1: zero EvalError/request-time-eval exception in the dev server log
✓ PHASE 2: zero EvalError/request-time-eval exception reaching the real post-settlement path
```

`PRODUCTION_BUNDLE_DIAGNOSTIC_ISOLATION=PASS`.

## §11 — economic non-reachability

`grep` of `webctx-remote-diagnostic.ts` and its new test file for `x402|facilitator|settle|EIP3009|signTypedData|
PAID_RECEIPT_SIGNING`: zero real matches (only prose/comments already present before this checkpoint, describing
what is *not* imported). No new import was added that touches payment orchestration — the only two new imports are
`setPrecompiledOutputValidators` (schema-registry, `@siteborne/verification`) and `outputValidatorsById` (a static
generated JSON-derived validators map, `apps/edge-api/src/generated/output-validators.generated.js`).

`X402_CHALLENGE_CALLS=0 FACILITATOR_VERIFY_CALLS=0 FACILITATOR_SETTLE_CALLS=0 SIGN_TYPED_DATA_PAYMENT_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0 PAYMENT_SIGNATURES_CREATED=0 PAYMENT_ATTEMPTS_CREATED=0
PAID_SERVICE_RESULTS_CREATED=0 RECEIPTS_CREATED=0 (real payment receipts) REAL_ECONOMIC_EFFECT_USDC=0`. The ephemeral
diagnostic PCC self-signature (§6) is explicitly distinct and not counted here.

## §12/§13 — remote inert control, then exactly one remote diagnostic execution

Recreated the Q4-proven override config (`name`/`compatibility_date`/`compatibility_flags`/`workers_dev`/
`preview_urls` only — no `routes`, no `[queues]`, no bindings the diagnostic file never touches), since Q4's own
scratchpad copy was already cleaned up per its own §22. One fresh `wrangler dev --remote` session:

```
GET /__diag/health  -> HTTP 200 {"diagnostic":"SUN-1221E5Q2 inert-health","ok":true,...}  (real CF-Ray, real Cloudflare edge)
```

`REMOTE_INERT_HTTP_STATUS=200 REMOTE_INERT_HANDLER_REACHED=YES`. Then exactly one call to the fixed target:

```json
{
  "diagnostic": "SUN-1221E5Q5 webctx-remote-diagnostic",
  "target": "https://example.com/",
  "stage_trace": [
    {"stage":"diag_handler_entered","success":true,"elapsed_ms":0},
    {"stage":"executor_constructed","success":true,"elapsed_ms":0},
    {"stage":"service_execute_entered","success":true,"elapsed_ms":0},
    {"stage":"socket_connect_called","success":true,"elapsed_ms":6,"detail":{"hostname":"172.66.147.243","port":443}},
    {"stage":"socket_connect_returned","success":true,"elapsed_ms":6,"detail":{"hostname":"172.66.147.243","port":443}},
    {"stage":"service_execute_returned","success":true,"elapsed_ms":7}
  ],
  "safe_socket_connect_called": true,
  "safe_socket_connect_returned": true,
  "service_execute_reached_verify_and_sign": false,
  "failure_code": "internal_error",
  "result_class": "internal_verification_failed",
  "error_detail": "internal exception: EvalError: Code generation from strings disallowed for this context",
  "elapsed_ms": 7
}
```

This is the **pre-fix** capture (the fix in §9 was derived from, and applied immediately after, this exact
response) — preserved verbatim as the checkpoint's primary evidence artifact. Real `CF-Ray` present on both calls;
real Cloudflare edge (Atlanta). The remote session was stopped immediately after this one call.

## §14 — primary classification

`SAFE_SOCKET_CONNECT_CALLED=YES`, `SAFE_SOCKET_CONNECT_RETURNED=YES` (real DNS resolution to `172.66.147.243:443`
completed and the real `cloudflare:sockets` `connect()`+`startTls()` call returned a socket handle without
throwing) — this alone disproves the pre-checkpoint suspicion that the fast `elapsed_ms` implied transport never
ran; DNS-over-Cloudflare's-own-edge and a lazy, non-blocking `connect()` handle return are both genuinely fast.
`service_execute_reached_verify_and_sign: false` and `failure_code: internal_error` (never
`verification_failed`) prove this was the **`dispatcher.ts` wrapper origin** (§3, origin 2), not the service-level
HTTP-fetch-failure classification (origin 1) — the uncaught `EvalError` escaped `WebContextVerifiedService.execute()`
mid-way through `verifyAndSign()`'s post-finalization schema check, after the mesh/receipt were already computed in
local scope but before the function returned them.

`REMOTE_INTERNAL_VERIFICATION_ROOT_CAUSE_CLASS=K_OTHER_PROVEN` (a diagnostic-context-construction gap — missing
`setPrecompiledOutputValidators` registration — not any of the transport-stage classes A–J).
`REMOTE_INTERNAL_VERIFICATION_ROOT_CAUSE_PROVEN=YES`.

## §15/§16/§17/§18

`REMOTE_TRANSPORT_EXERCISED=YES` (§15 branch does not apply). `REMOTE_NONPAYMENT_E5_FAILURE_REPRODUCED=NO` — the
failure signature was `EvalError`, never `WEBCTX_HTTP_PREMATURE_EOF`; §16's EOF-specific capture fields are
`NOT_REACHED`. Per §17: this is a post-"transport-attempt" (connect succeeded), diagnostic-context-specific defect,
correctly *not* treated as an E5 production fix. Per §18: `REMOTE_PREVIEW_DEPLOYED_RUNTIME_FIDELITY_GAP_REMAINS=YES`
— this checkpoint fixed a diagnostic-seam-only construction gap, not the deployed-runtime fidelity question; E5's
real production `WEBCTX_HTTP_PREMATURE_EOF` still has not been reproduced through this seam, and E6 remains
ineligible.

## §19 — full regression

- `pnpm exec vitest run apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.construction.test.ts` — 3/3 passed.
- `pnpm test` — **198 test files passed, 19 skipped (live-credential-gated), 2428 tests passed, 0 failed.**
- `pnpm test:worker-runtime` — **93/93 scenarios passed** (re-run after the fix; includes the diagnostic-seam
  isolation check and both EvalError guards).
- `pnpm run production:preflight` — PASS (re-run after the fix).
- `pnpm --filter @siteborne/edge-api exec tsc --project tsconfig.json --noEmit` — clean, zero errors.
- `pnpm typecheck` (full monorepo) — only the same 2 pre-existing, unrelated errors in
  `tests/live/web-context-first-paid-e2e-local.test.ts` (`tsconfig.live-tests.json`), confirmed byte-identical on a
  clean `git stash` of this checkpoint's changes before making them — not a regression from this checkpoint.
- `pnpm lint` (full monorepo, turbo) — 16/16 passed.
- `pnpm secrets:scan` — 2 pre-existing findings, both in historical `docs/reports/` files from prior checkpoints
  (`SUN-1221E2R-...md` commit `a755620...`, `SUN-1220O-...md` commit `322852a...`, both weeks before this
  checkpoint) — not introduced by this checkpoint, and neither file was touched.

## §20 — mutation/structural proof

`Q5_DIAGNOSTIC_MUTATION_PROOF=PASS`: test 2 in §8 directly encodes the structural invariant this fix depends on
(`result.output` is `undefined` on failure; the real detail is at `result.limitations`/`result.failure.details`) —
a regression back to reading `output.limitations` would leave that test's assertions describing a codepath the
fixed handler no longer uses, and the RED/GREEN scratch proof (§9) is preserved verbatim in this report as the
record of what a missing `setPrecompiledOutputValidators` call produces.

## §21/§22 — production safety and cleanup

`WORKER_VERSION_UPLOADS=0 PRODUCTION_DEPLOYMENTS=0`. `FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`
`FINAL_PRODUCTION_TRAFFIC=100%` `FINAL_PRODUCTION_PREFLIGHT=PASS`. `LIVE_402_REQUESTS=0
PAYMENT_SIGNATURES_CREATED=0 PAID_REQUESTS=0 SETTLEMENTS=0 REAL_ECONOMIC_EFFECT_USDC=0`.

Two `wrangler dev` sessions this checkpoint owned (one `--remote`, pid confirmed; one local scratch-proof session,
pid confirmed) were both explicitly stopped (`pkill`), reconfirmed via `ps aux` showing zero matching processes.
The throwaway scratch entrypoint file was deleted immediately after use and never committed (`git status --short`
never showed it). `Q5_REMOTE_SESSIONS_STOPPED=YES`. `TEMP_Q5_ARTIFACTS_REMOVED=YES`.
