# SUN-1221E5Q5R — corrected remote-seam verification: E5 reproduces non-economically

## Lineage

- **SUN-1221E5Q5 evidence commit**: `94a2e8dd48c117fe533da49889ac692256012997`, reconciled at the start of this
  checkpoint (`git rev-parse HEAD` == that SHA, `git status --short` clean). Contains: dev-diagnostic stage tracing
  (`createStageTrace`/`wrapConnectForDiagnostics`), the ephemeral-signer construction (already validated by
  `webctx-remote-diagnostic.construction.test.ts`), the `setPrecompiledOutputValidators(outputValidatorsById)`
  fix, and the SUN-1221E5Q5 report.
- This checkpoint (Q5R) made **zero source changes**. It is verification-only, as mandated.

## §2 — AJV/eval fix reconciliation (literal, not inferred)

`apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts` imports:

```ts
import { setPrecompiledOutputValidators, ... } from '@siteborne/verification';
import { outputValidatorsById } from '../generated/output-validators.generated.js';
...
setPrecompiledOutputValidators(outputValidatorsById);
```

This is the **literal same import path and the literal same function call** used by
`production-web-context-v2-cdp-route.ts:23,33` and `production-verify-v2-cdp-route.ts:64,90` — confirmed by direct
`grep` diff across all three files (identical `'../../generated/output-validators.generated.js'` /
`'../generated/output-validators.generated.js'` resolving to the same file, identical
`setPrecompiledOutputValidators(outputValidatorsById)` call). No hand-written diagnostic schema exists anywhere in
the diagnostic file. `git show --stat` for commit `94a2e8d` shows only the diagnostic file, its new test, and the
report changed — zero production route files touched.

```
DIAGNOSTIC_PRECOMPILED_VALIDATORS_REGISTERED=YES
PRODUCTION_VALIDATOR_MECHANISM_REUSED=YES
RUNTIME_NEW_FUNCTION_REQUIRED_BY_DIAGNOSTIC=NO
PRODUCTION_RUNTIME_SOURCE_CHANGED_BY_FIX=NO
```

## §3 — Production-bundle isolation, reconfirmed

`pnpm test:worker-runtime` (93/93 scenarios passed) includes its own literal-string check against the real
`wrangler.toml` dry-run bundle: `containsDiagnosticSeamGate=false containsDiagnosticSeamRoute=false` (checks for
`DIAGNOSTIC_SEAM_ENABLED` and `__diag/webctx-remote`).

For this checkpoint's own direct, independent confirmation, a fresh `wrangler deploy --dry-run` bundle
(6,487,791 bytes, matching the same size class as every prior checkpoint's dry-run) was grepped directly for every
marker the mission listed, plus the diagnostic seam's other identifying strings:

| marker | occurrences |
|---|---|
| `dev-diagnostics` | 0 |
| `webctx-remote-diagnostic` | 0 |
| `DIAGNOSTIC_SEAM_ENABLED` | 0 |
| `__diag/webctx-remote` | 0 |
| `__diag/health` | 0 |
| `DIAGNOSTIC_KEY_ID` | 0 |
| `kid_diagnosticwebctxe5qnonpr` | 0 |
| `diag_handler_entered` | 0 |
| `socket_connect_called` | 0 |
| `buildEphemeralDiagnosticSigner` | 0 |

The temporary bundle directory was deleted immediately after this check.

```
PRODUCTION_BUNDLE_DIAGNOSTIC_ISOLATION=PASS
```

## §4 — Production containment (pre-session)

`wrangler deployments list`'s most recent entry shows exactly one active version:
`(100%) de70bf98-f304-4d7f-b189-4ae2401041a0`. `pnpm production:preflight` → `PREFLIGHT RESULT: PASS`.

```
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
CURRENT_PRODUCTION_TRAFFIC=100%
PRE_Q5R_PRODUCTION_PREFLIGHT=PASS
```

## §5 — Economic non-reachability, reconfirmed

`grep` across the diagnostic file for x402/facilitator/settlement/EIP-3009/payment-signing identifiers returns only
prose-comment mentions (lines 51-52, 72, 131, 440), zero imports, zero calls — unchanged from Q5.

```
X402_CHALLENGE_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAYMENT_ATTEMPTS_CREATED=0
PAID_RESULTS_CREATED=0
RECEIPTS_CREATED=0
```

## §6-8 — One corrected remote session, inert control, one executor call

Reused the Q4-proven override config (`name`/`compatibility_date`/`compatibility_flags`/`workers_dev`, no `routes`,
no `[queues]`) with `wrangler dev --remote apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts --config
<override> --var DIAGNOSTIC_SEAM_ENABLED:true`. Reached `Ready on http://localhost:19544` against real Cloudflare
edge (CF-Ray `a334c...-ATL` on every response).

```
Q5R_REMOTE_SESSION_READY=YES
Q5R_REMOTE_SESSION_PID=6020
```

`GET /__diag/health` → `HTTP/1.1 200 OK`, `{"diagnostic":"SUN-1221E5Q2 inert-health","ok":true,...}`.

```
Q5R_INERT_HTTP_STATUS=200
Q5R_INERT_HANDLER_REACHED=YES
```

**Exactly one** `GET /__diag/webctx-remote` was then issued. Full raw response:

```json
{
  "diagnostic": "SUN-1221E5Q5 webctx-remote-diagnostic",
  "target": "https://example.com/",
  "stage_trace": [
    {"stage":"diag_handler_entered","success":true,"elapsed_ms":0},
    {"stage":"executor_constructed","success":true,"elapsed_ms":0},
    {"stage":"service_execute_entered","success":true,"elapsed_ms":0},
    {"stage":"socket_connect_called","success":true,"elapsed_ms":6,"detail":{"hostname":"104.20.23.154","port":443}},
    {"stage":"socket_connect_returned","success":true,"elapsed_ms":6,"detail":{"hostname":"104.20.23.154","port":443}},
    {"stage":"service_execute_returned","success":true,"elapsed_ms":6}
  ],
  "safe_socket_connect_called": true,
  "safe_socket_connect_returned": true,
  "service_execute_reached_verify_and_sign": true,
  "failure_code": "verification_failed",
  "diagnostic_reason_code": "WEBCTX_HTTP_PREMATURE_EOF",
  "diagnostic_stage": "direct_public_http_fetch",
  "limitation": "direct-public-http returned permanent_failure for https://example.com/",
  "result_class": "internal_verification_failed",
  "error_detail": "direct-public-http did not succeed (permanent_failure) for https://example.com/",
  "elapsed_ms": 6
}
```

```
Q5R_REMOTE_DIAGNOSTIC_REQUEST_COUNT=1
```

The session was stopped immediately afterward (`pkill -f "wrangler dev --remote.*webctx-remote-diagnostic"`),
confirmed by process list; the only other `wrangler` process present (`wrangler tail siteborne-utility-edge`,
PID 23730, started long before this checkpoint) was left untouched.

```
Q5R_REMOTE_SESSION_STOPPED=YES
```

## §9 — Required stage read-back

```
REMOTE_DIAGNOSTIC_HTTP_STATUS=200
REMOTE_DIAGNOSTIC_RESULT_CLASS=internal_verification_failed
REMOTE_DIAGNOSTIC_REASON=direct-public-http did not succeed (permanent_failure) for https://example.com/
REMOTE_DIAGNOSTIC_ELAPSED_MS=6

SERVICE_EXECUTE_ENTERED=YES
TERMSGUARD_ENTERED=YES
TERMSGUARD_PASSED=YES
ADAPTER_ENTERED=YES
SAFE_SOCKET_CONNECT_CALLED=YES
SAFE_SOCKET_CONNECT_RETURNED=YES
VERIFY_AND_SIGN_ENTERED=YES
VERIFY_AND_SIGN_COMPLETED=YES
PCC_OUTPUT_VALID=UNPROVEN
```

TermsGuard/adapter-entry are not directly instrumented by name, but the evidence is not inference-from-absence: the
returned `diagnostic_reason_code` is drawn from a closed, mutually-exclusive taxonomy
(`packages/provider-adapters/src/errors.ts`) that includes a distinct `POLICY_BLOCKED` value TermsGuard would have
produced had it rejected. Observing `WEBCTX_HTTP_PREMATURE_EOF` instead is direct positive evidence the request
proceeded past TermsGuard, rate limiting, and URL/DNS validation, matching `safe_socket_connect_called=true`
independently. `PCC_OUTPUT_VALID` is marked `UNPROVEN` rather than inferred `YES`: the diagnostic response does not
echo `verification.schema_valid` directly (only the boolean presence-proxy
`service_execute_reached_verify_and_sign`), so this checkpoint does not claim direct evidence of that specific
field.

## §10 — Transport result recovered (the central output of Q5R)

Because Q5's extraction-path fix now reads the correct fields, the real `PublicHttpAdapter` outcome — previously
obscured by the EvalError — is directly recoverable from this single response:

```
HTTP_ADAPTER_RESULT_CLASS=FAILURE
HTTP_ADAPTER_DIAGNOSTIC_REASON=WEBCTX_HTTP_PREMATURE_EOF
HTTP_ADAPTER_DIAGNOSTIC_STAGE=direct_public_http_fetch
HTTP_ADAPTER_HTTP_STATUS=NOT_AVAILABLE (not echoed by this route's response fields; WEBCTX_HTTP_PREMATURE_EOF
  itself implies the exchange never reached a fully-parsed response)
CANONICAL_TARGET_FETCH_COMPLETED=NO
```

The underlying `PublicHttpAdapter.execute()` result class itself (`permanent_failure`) is directly visible in the
`limitation` field: `"direct-public-http returned permanent_failure for https://example.com/"`.

## §11 — Outcome A: WEBCTX_HTTP_PREMATURE_EOF reproduces

```
REMOTE_NONPAYMENT_E5_FAILURE_REPRODUCED=YES
```

**This is the first faithful, non-economic reproduction of the production E5 failure class** — against a real
Cloudflare edge, through the real `cloudflare:sockets`-backed `SafeSocketHttpClient`, with `connect()`/`startTls()`
proven to have succeeded (`safe_socket_connect_called=true`, `safe_socket_connect_returned=true`, resolved to a
real IP `104.20.23.154:443`), and with `verifyAndSign()` proven to have completed cleanly (no EvalError recurrence)
— isolating the failure to genuinely be inside the HTTP exchange itself, not upstream of transport and not
downstream in PCC finalization.

This checkpoint's own connect-boundary instrumentation cannot distinguish `socket-http-client.ts`'s two internal
EOF throw sites (the header-parse loop vs. the chunked-body-read loop) without modifying that shared file, which is
out of scope here per explicit instruction.

```
EXACT_EOF_BRANCH_DISTINGUISHED=NO
EOF_BRANCH_ID=UNPROVEN
EOF_PARSER_PHASE=UNPROVEN
STATUS_LINE_PARSED=UNPROVEN
HEADERS_COMPLETE=UNPROVEN
FRAMING_MODE=UNPROVEN
CONTENT_LENGTH_PRESENT=UNPROVEN
CONTENT_LENGTH_EXPECTED=(not captured)
TRANSFER_ENCODING_CLASS=UNPROVEN
SOCKET_READ_COUNT=(not captured)
BYTES_OBSERVED_COUNT=(not captured)
```

```
NEXT_CHECKPOINT=REMOTE_EOF_BRANCH_INSTRUMENTATION_AND_ROOT_CAUSE
```

## §12-14 — Outcomes B/C/D

Not applicable — Outcome A occurred. No alternate transport failure, no transport success, no new diagnostic-seam
defect was observed in this single call.

```
REMOTE_TRANSPORT_ALTERNATE_FAILURE=NO
REMOTE_DIAGNOSTIC_EXECUTOR_SUCCESS=NO
NEW_DIAGNOSTIC_SEAM_DEFECT=NO
NEW_DIAGNOSTIC_SEAM_DEFECT_CLASS=(n/a)
REMOTE_PREVIEW_DEPLOYED_RUNTIME_FIDELITY_GAP_REMAINS=NO — the remote-preview seam now reproduces the real E5
  signature; the fidelity gap this checkpoint chain has been tracking since Q3 is closed for the purpose of E5
  reproduction (a real, non-economic, real-edge reproduction now exists). It does NOT mean E5 is fixed, nor that
  E6 is eligible — see §19.
```

## §15 — No behavioral fix in Q5R

Zero source files were modified in this checkpoint. Verification only.

```
SHARED_TRANSPORT_BEHAVIOR_CHANGED=NO
HTTP_PARSER_BEHAVIOR_CHANGED=NO
SSRF_BEHAVIOR_CHANGED=NO
TERMSGUARD_BEHAVIOR_CHANGED=NO
PAYMENT_BEHAVIOR_CHANGED=NO
```

## §17 — Final production safety

```
WORKER_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENTS=0
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
```

`pnpm production:preflight` → `PREFLIGHT RESULT: PASS` (re-run after the remote session was stopped).

```
FINAL_PRODUCTION_PREFLIGHT=PASS
LIVE_402_REQUESTS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
```

## §19 — E6 eligibility

The production E5 failure class has now been reproduced non-economically, but its exact root cause (which of the
two EOF throw sites, and why) is not yet proven. Per the mission's own default:

```
SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=NO
```

The next checkpoint should instrument (or otherwise directly distinguish) `socket-http-client.ts`'s two EOF throw
sites against this same real, reproducing, non-economic target — still no shared-code behavior change until the
exact branch and cause are proven.
