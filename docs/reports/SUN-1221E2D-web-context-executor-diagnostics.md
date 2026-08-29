# SUN-1221E2D — web_context_verified.v2 executor diagnostic hardening

## Lineage

- SUN-1221E2 (ambiguous HTTP 502, real payment attempt): `814e66c`
- SUN-1221E2R (forensic reconciliation, bounded failure stage to `POST_PAYMENT_VERIFICATION → WEB_CONTEXT_REAL_EXECUTOR → NON_SUCCESS → BEFORE_SETTLEMENT`, `E2_502_ROOT_CAUSE_CLASS=H_UNKNOWN`): `a75562084c47fb07fd17a8533eefc5e7650a70fa`
- This checkpoint (SUN-1221E2D): instrumentation, plus — going beyond what E2R could prove without a live run — an actual, deterministic, locally-reproduced root cause for `H_UNKNOWN`.

## §0 Debugging law

No fix without root-cause evidence. This checkpoint added structured diagnostics to every silent failure branch E2R identified, then used that instrumentation (plus a real local `workerd` run, §9) to make the next failure — and, as it turned out, *this* investigation's own failure — fully decisive. No speculative behavioral fix was made anywhere; §9/§10 explain exactly why not, for the one case where a "fix" was tempting.

## §3 — the two silent branches

1. **`packages/service-runtime/src/services/web-context/service.ts`, `WebContextVerifiedService.execute()`** (was lines 88–92). `direct-public-http`'s `resultClass`/`error` were computed and pushed into a `limitations` string, but that string only ever reached the final result's `output.limitations` — which is set to `undefined` whenever `output` is omitted. Worse (found while writing the RED test, not assumed): when the verification mesh has nothing deterministic to check (zero claims/evidence), `signed.verdict.decision` can be `'pass'` even though the underlying fetch failed — and the OLD code set `failure: undefined` in that case, specifically. `CAN_CAUSE_OBSERVED_502=YES` — this is the exact shape SUN-1221E2's real 502 hit (`failure` undefined, composition boundary falling back to a bare `result_class=...` string, SUN-1221E2R §found).
2. **`packages/provider-adapters/src/errors.ts`, `toAdapterResult`**'s generic-`Error` fallback (was lines 99–107). Collapsed *any* non-`AdapterError` thrown value — DNS failure, connect/TLS failure, write failure, read failure, redirect-policy rejection, media-type rejection, size-bound rejection, decompression failure, JSON-parse failure, a genuinely unknown platform error — into one indistinguishable `resultClass: 'permanent_failure'` / `code: 'INTERNAL_ERROR'` bucket, logged nowhere. `CAN_CAUSE_OBSERVED_502=YES`.

`SILENT_FAILURE_BRANCH_COUNT=2` (as framed by the checkpoint) plus two genuinely new instrumentation points inside `packages/provider-adapters/src/http/socket-http-client.ts` closing a gap upstream of both: `connect()`/`startTls()` and the request-write step called straight into the real `cloudflare:sockets` platform with **no** try/catch anywhere in this codebase — whatever raw, unclassified error the platform threw there propagated all the way to branch 2 above with nothing to distinguish it.

## §4 — diagnostic contract

Nine reason codes, every one grounded in an actual source branch (never invented): `WEBCTX_DNS_RESOLUTION_FAILED`, `WEBCTX_URL_VALIDATION_FAILED`, `WEBCTX_REDIRECT_POLICY_BLOCKED`, `WEBCTX_MEDIA_TYPE_BLOCKED`, `WEBCTX_RESPONSE_TOO_LARGE`, `WEBCTX_RESPONSE_PARSE_FAILED`, `WEBCTX_TIMEOUT`, `WEBCTX_UPSTREAM_CONNECTION_FAILED` (new instrumentation), `WEBCTX_REQUEST_WRITE_FAILED` (new instrumentation), plus an honest catch-all `WEBCTX_UPSTREAM_PROTOCOL_ERROR` for anything genuinely unrecognized — never a false claim of precision. `DIAGNOSTIC_CONTRACT_SENSITIVE_DATA_REACHABILITY=0`: the diagnostic record is `{diagnostic_reason_code, diagnostic_stage, result_class, job_id, request_id}` (plus `deterministic_failures` when the mesh also failed) — never a payment signature, authorization header, private key, nonce, or unbounded response body. Proven directly by a test asserting the audit `details` never matches `/signature|authorization|private_key|nonce/i`.

## §5/§6 — RED, then GREEN

Four RED→GREEN cycles, one per layer:

1. `packages/provider-adapters/src/tests/web-context-diagnostic-classification.test.ts` (24 tests, new) — `classifyGenericAdapterErrorReason` didn't exist; `toAdapterResult` always returned `INTERNAL_ERROR`.
2. `packages/provider-adapters/src/tests/web-context-transport-diagnostics.test.ts` (4 tests, new) — a raw `connect()`/`startTls()`/write throw propagated completely unwrapped (proven against the real, unmodified `SafeSocketHttpClient`).
3. `packages/service-runtime/src/services/web-context/service.test.ts` (3 tests added, 8/8 total) — `failure.details` was `undefined` on the exact SUN-1221E2 shape (verdict passed, fetch failed).
4. `apps/edge-api/tests/x402-service-route.test.ts` (2 tests added, 35/35 total) — no `audit_events` row was ever written on executor failure; separately proved the public 502 body carries neither a `details` key nor the reason-code string.

`EXECUTOR_DIAGNOSTIC_TDD_RED=YES` (all four, independently confirmed failing before implementation). All four GREEN after the minimal implementation below.

## §7 — implementation (behavior-preserving)

- `errors.ts`: `classifyGenericAdapterErrorReason(error)` — a small, ordered, message-pattern classifier delegated to by `toAdapterResult`'s generic branch. `resultClass` stays exactly `'permanent_failure'` — only `error.code` gains precision. `EXECUTOR_BEHAVIOR_CHANGED=NO` for every existing caller (only one non-test call site anywhere reads `.failure`/`.error`, `apps/edge-api/src/control-plane/routes/x402-service.ts:1441`, and only via an optional-chained fallback that can only get *more* informative).
- `socket-http-client.ts`: wraps `connect()`/`startTls()` in a try/catch tagging `WEBCTX_UPSTREAM_CONNECTION_FAILED: <original>` with `{ cause: err }`; wraps the request-write step the same way with `WEBCTX_REQUEST_WRITE_FAILED`, deliberately swallowing any secondary `close()` failure on an already-failed writer so it can never mask the real reason. A successful fetch through connect/write/read is untouched (proven by a dedicated regression test).
- `service.ts`: `failure` is now constructed whenever the verdict failed **or** the underlying fetch failed (previously only the former) — the exact SUN-1221E2 gap. The pre-existing content-based-failure case (verdict fails, fetch succeeded — e.g. the "quarantine" test) is byte-for-byte unchanged: `details` stays a bare `deterministic_failures` array in that case; only the *new* case gets the `{diagnostic_reason_code, diagnostic_stage: 'direct_public_http_fetch'}` object, merged with `deterministic_failures` when both signals are present.
- `x402-service.ts`: the existing 502 branch now also calls the existing `audit()` helper (the same D1-backed `audit_events` sink every other step of this request already writes to) with `service_execution_diagnostic` — internal-only; the `jsonError` call three lines below is untouched, still passed only `message`.

`EXECUTOR_FAILURE_SETTLEMENT_CALLS=0`, `AUTOMATIC_PAYMENT_RETRY_CALLS=0` (confirmed by code structure: the audit write and `jsonError` return both happen strictly before any settlement code in the function). `WEB_CONTEXT_ECONOMICS_CHANGED=NO`, `VERIFY_ECONOMICS_CHANGED=NO`, `PAYMENT_COMPOSITION_ORDER_CHANGED=NO` (confirmed by diff scope: no pricing/composition/gate file appears in this checkpoint's diff at all).

## §9 — local reproduction (the actual finding)

One real, local, real-`workerd` (`wrangler dev --local`) reproduction was run: the REAL production composition (`buildWebContextV2CdpProductionRouteConfig`, real `cloudflare:sockets` `connect`, no override) making one real outbound fetch to the canonical `https://example.com/` target this whole release train has used throughout. Wired as a new route on the existing test-only entrypoint (`/v2/web-context-production/*`, mirroring the existing `/v2/verify-production/*` pattern exactly) and committed as **PHASE 10** of `scripts/test-worker-runtime.mts` — gated behind `RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true` (opt-in only; the default `pnpm test:worker-runtime` run stays exactly as network-isolated as every other phase).

`LOCAL_CANONICAL_EXECUTOR_FAILURE_REPRODUCED=YES`. Result, byte-for-byte:

```
status=502 message="direct-public-http did not succeed (policy_blocked) for https://example.com/"
```

`LOCAL_CANONICAL_EXECUTOR_FAILURE_REASON`: `globalTermsGuard` (`packages/provider-adapters/src/policy/terms-guard.ts`) is a module-level singleton whose `reviews` Map starts empty. A repository-wide search (`grep -rn "recordReview"`) found **zero callers anywhere in the non-test codebase** — every real adapter that calls `globalTermsGuard.checkAccess(manifest, 'live')` (`direct-public-http` included) unconditionally throws `PolicyBlockedError('has no terms review record. Live use is blocked.')` for `execution_mode: 'live'`. This is not network flakiness, not a transient condition, and not DNS/socket/TLS/timeout at all — it is 100% deterministic and would reproduce on every single attempt, forever, regardless of retry count.

`verify_agent_output.v2` (SUN-1220's already-live, already-real-paid first service) never touches this guard — its executor verifies buyer-supplied `candidate_output` deterministically with no external HTTP fetch — which is exactly why *that* service's real payment succeeded while `web_context_verified.v2`'s structurally cannot, yet.

## §10 — conditional bug fix: deliberately NOT applied

`LOCAL_CANONICAL_EXECUTOR_FAILURE_REPRODUCED=YES` and the root cause is proven with certainty — but this is not a coding defect to patch. `globalTermsGuard` is doing exactly its designed job: refusing live use of a provider whose terms have never been reviewed. Recording a `TermsReview` with `status: 'verified'` for `direct-public-http` would be **me fabricating a real compliance/business judgment** — "SITEBORNE has reviewed and accepts the terms of automatically fetching arbitrary buyer-specified public URLs" — which is exactly the kind of unilateral policy decision this checkpoint's own debugging law ("do NOT alter executor behavior merely to make it succeed") forbids, and squarely a human/business decision, not an engineering one.

`BEHAVIORAL_FIX_IMPLEMENTED=NO`. Instead: PHASE 10 (§9) asserts the current, real, structural limitation as a **named, permanent regression proof** — it fails loudly and informatively the moment this behavior ever changes, whether via a genuine terms review being recorded or an unauthorized bypass, so that change can never happen silently.

**This needs a human decision before `web_context_verified.v2` can ever process a real payment**: either perform an actual terms review of `direct-public-http` (per the manifest's own declared `terms_uri`, `https://www.rfc-editor.org/rfc/rfc9110`) and record it via `globalTermsGuard.recordReview(...)`, or decide not to launch this service. No further real-paid-E2E attempt against this candidate can succeed until that decision is made and implemented — retrying the payment will reproduce this exact `policy_blocked` 502 every time.

## §11–14 — non-regression

- **Settlement ordering**: `EXECUTOR_FAILURE_SETTLEMENT_CALLS=0`, `AUTOMATIC_PAYMENT_RETRY_CALLS=0` (§7).
- **Payment/economic**: `WEB_CONTEXT_ECONOMICS_CHANGED=NO`, `VERIFY_ECONOMICS_CHANGED=NO`, `PAYMENT_COMPOSITION_ORDER_CHANGED=NO` (§7).
- **Security**: `dns-rebinding.test.ts` (21/21) + `http-ssrf.test.ts` (31/31) — all PASS, zero changes to any security-relevant assertion.
- **MCP/discovery**: `multi-service-discovery.test.ts` (25/25), `readiness-truthfulness.test.ts` (18/18), `discovery-truthfulness.test.ts` (15/15) — all PASS.

## §15 — diagnostic mutation proof

`scripts/test-web-context-executor-diagnostics-mutation-caught.mts` — 10 deliberate mutations against the four touched source files (classifier collapse, classifier bypass, wrong stage tag ×2, dropped `cause`, `httpFetchFailed` hardcoded false [SUN-1221E2's exact gap re-opened], wrong `diagnostic_stage` value, missing audit write, duplicate audit write, public-body leak), each proven caught, each restored byte-for-byte (SHA-256 verified). **`DIAGNOSTIC_MUTATION_PROOF=PASS`, 10/10 caught, 0 skipped.**

## §16 — full regression

```
LINT=PASS
TYPECHECK=PASS (edge-api tsconfig.json, provider-adapters, service-runtime all clean;
  one PRE-EXISTING failure in apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts
  under tsconfig.live-tests.json, confirmed via git stash to predate this checkpoint entirely —
  unrelated to this diff, not touched by it, left as-is)
TESTS=2351 passed, 38 skipped, 0 failed
WORKER_RUNTIME=95/95 PASS (PHASE 0–9 unchanged + new PHASE 10)
PRODUCTION_PREFLIGHT=PASS
NEW_SECRET_FINDINGS=0 (2 pre-existing known false positives — BASESCAN_TOKEN_CONTRACT,
  OLD_AUTH_PAYMENT_ATTEMPT_ID — both from prior commits, unchanged)
```

## Consequences

- Candidate `915be949-b46f-464b-a4d6-17b74539ce55` is now historical (`OLD_E2_CANDIDATE_REUSE_ELIGIBLE=NO`) — source changed.
- Current production remains `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`, untouched throughout (verify_agent_output.v2 only — this checkpoint made zero deployment/traffic/D1/economic changes).
- `SUN1221E3_REAL_PAID_RETRY_ELIGIBLE=NO` until the §10 human decision is made — retrying the real paid E2E against a new candidate today would reproduce the identical `policy_blocked` 502, at real economic risk to nothing (the failure is pre-settlement, per E2R) but at the cost of buyer time/gas for a doomed attempt.
