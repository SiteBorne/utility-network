# SUN-1221E5Q — Cloudflare non-payment executor reproduction seam

**Checkpoint type:** architecture design (approved with refinements) + implementation + one bounded live reproduction attempt.
**Outcome:** seam built and empirically proven safe/non-economic/production-unreachable. Live reproduction of E5's `WEBCTX_HTTP_PREMATURE_EOF` was **inconclusive** — a tooling-layer failure (`wrangler dev --remote` returning Cloudflare edge HTTP 525 before the request ever reached Worker code) blocked every attempt. This is not evidence for or against the E5 root cause.

## Lineage
- SUN-1221E5 evidence: `00c7cf0c6b6cb6102221241380cd12bece96826b`
- SUN-1221E5P evidence: `09f025cf358331a866d232742ff8ca9fe8ec0aee`
- Architecture approved (chat, this session) as `WRANGLER_DEV_REMOTE_EPHEMERAL_DIAGNOSTIC` with a dev-only entry point (not a gated production route)

## What was built
`apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts` — a dev-only Hono app, never imported by `index.ts` or any production composition file, never bundled by the real `wrangler.toml`. One route, `GET /__diag/webctx-remote`, gated by `DIAGNOSTIC_SEAM_ENABLED === 'true'` (set only via a one-off `wrangler dev --remote ... --var` CLI flag — never a persisted var, secret, or committed config). It invokes the exact production executor boundary (`WebContextVerifiedService` → `PublicHttpAdapter` → `SafeSocketHttpClient` → real `cloudflare:sockets` `connect()`, the real `direct-public-http`/`operator_risk_acceptance` TermsGuard path, the real DNS-rebinding/SSRF checks) via the same `buildWebContextV2SafeHttpClient` the production composition already exports — no transport code duplicated. Target is a source-level constant (`https://example.com/`), never accepted from the request.

`WebContextVerifiedService.execute()` unconditionally self-signs a PCC document (`verifyAndSign`) regardless of success/failure — discovered by tracing the call graph, not assumed. This needs *a* structurally valid signer, not real receipt-signing material. Per explicit chat approval, the seam reuses `@siteborne/verification`'s existing `generateTestKeypair` (the same genuinely-random, in-memory, per-invocation primitive `createFixtureSigner` uses throughout this repo's test suites) with an unmistakable diagnostic key id (`kid_diagnosticwebctxe5qnonpr`) and `environment: 'test'` — never `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, never persisted, private key bytes never returned.

## Non-reachability proof
`apps/edge-api/tests/dev-diagnostics-webctx-remote.test.ts` (9 tests, all PASS):
- no file under `apps/edge-api/src` imports the diagnostic module (real ES-import-statement check, not a bare substring)
- the real production app 404s on `/__diag/webctx-remote`
- the diagnostic file's code (doc comments excluded) contains zero references to `x402-service`, `facilitator`, `createCdpFacilitatorClient`, `CDP_API_KEY_ID/SECRET`, `CDP_WALLET_SECRET`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `signTypedData`, EIP-3009/`PAYMENT-SIGNATURE` identifiers, `.settle(`, or `facilitatorClient.verify`
- the route 404s for every value of the gate var except the exact literal `'true'` (`false`, `TRUE`, `1`, `yes`, empty string all rejected)

Strongest proof — `scripts/test-worker-runtime.mts`'s existing real `wrangler deploy --dry-run` bundle-isolation check, extended with a new assertion: the actual compiled production bundle contains **neither** `DIAGNOSTIC_SEAM_ENABLED` nor `__diag/webctx-remote` anywhere in its text. Not "we didn't wire it up" — the literal bytes that would ship are absent.

```
X402_CHALLENGE_CALLS=0 (no import)          FACILITATOR_VERIFY_CALLS=0 (no import)
FACILITATOR_SETTLE_CALLS=0 (no import)      SIGN_TYPED_DATA_CALLS=0 (no identifier present)
EIP3009_AUTHORIZATIONS_CREATED=0            PAYMENT_SIGNATURES_CREATED=0
PAYMENT_ATTEMPTS_CREATED=0 (no D1 import)   PAID_SERVICE_RESULTS_CREATED=0
REAL_ECONOMIC_EFFECT=0
PRODUCTION_ENTRYPOINT_CHANGED=NO (empirically proven via real dry-run bundle inspection)
NEW_PUBLIC_ROUTE_REQUIRED=NO / NEW_SECRET_REQUIRED=NO / NEW_BINDING_REQUIRED=NO / NEW_WORKER_REQUIRED=NO
```

A necessary side-fix: `verify-agent-output-v2-production-executor.context-defaults.test.ts`'s existing SUN-1216 allowlist walk (which conservatively flags any `buildServiceContext(` call site outside two named production executors) needed `dev-diagnostics/` added to its exclusion filter alongside `paid-services.ts` and `scripts/` — the same "never part of the real bundle" category, justified in an updated doc comment, not weakened to a wildcard.

## Regression
`pnpm test`: 197/197 files, 2425 passed, 38 skipped (0 new failures). `pnpm run test:worker-runtime`: 93/93 scenarios (was 92; added the bundle-isolation assertion above). `pnpm run production:preflight`: PASS. Lint: zero new errors introduced (diffed against pre-change baseline in both touched files — `test-worker-runtime.mts` unchanged at 26 pre-existing problems, the SUN-1216 test file clean). Typecheck: clean. `pnpm run secrets:scan`: 2 known pre-existing false positives (same fingerprints as every prior checkpoint this session), 0 new.

## Empirical proof gate (before any live request)
```
REMOTE_DEV_RUNS_ON_CLOUDFLARE_NETWORK=YES   (confirmed: "Starting remote preview...", real multi-MB bundle upload — distinct from local workerd mode)
REMOTE_DEV_PUBLICLY_REACHABLE=NO            (confirmed: "Ready on http://localhost:<port>" only, no --tunnel used)
REMOTE_DEV_PERSISTENT_WORKER_CREATED=NO     (confirmed: wrangler versions list unchanged before/after)
REMOTE_DEV_PERSISTENT_ROUTE_CREATED=NO      (confirmed: wrangler deployments status unchanged)
REMOTE_DEV_VERSION_UPLOADED=NO              (confirmed)
REMOTE_DEV_NORMAL_PRODUCTION_TRAFFIC_EFFECT=0 (confirmed)
```
No stop condition triggered — cleared to proceed to a live request.

## The live reproduction attempts (3 of the authorized max 10)
1. Fresh session, `GET /__diag/webctx-remote` → **HTTP 525**, body `error code: 525` (a Cloudflare edge-branded SSL-handshake-failure page, not something this Worker's code can produce — the route only ever returns `c.json(...)`).
2. Same session, retried → identical 525.
3. **Killed the session, started an entirely fresh one**, then tested a completely unrelated path with zero `cloudflare:sockets`/executor involvement (`GET /this-route-does-not-exist`, Hono's own default 404 logic) → **also 525**.

Attempt 3 is decisive: a route with no path anywhere near the SafeSocket transport code failed identically, proving the 525 is a session-wide `wrangler dev --remote` tunnel failure occurring *before* any request reaches this Worker's routing at all — not a WebContextVerifiedService/SafeSocket/TermsGuard failure, and not informative about `WEBCTX_HTTP_PREMATURE_EOF` in either direction. Continuing to retry an already-proven-broken tunnel with identical requests would not produce new evidence, so per the user's own instruction ("stop repeated probing once enough evidence exists" — the same principle applies to a repeatably-broken tool as to a repeatably-successful reproduction), I stopped at 3 of the 10 authorized attempts rather than exhausting the budget.

```
LIVE_DIAGNOSTIC_EXECUTIONS=3 (of 10 authorized)
PREMATURE_EOF_REPRODUCED=UNPROVEN — tooling failure prevented any request from reaching the executor
FIDELITY_GAP=wrangler dev --remote's remote-preview tunnel itself returned Cloudflare edge HTTP 525 on every attempt, across two independent sessions, for both diagnostic and non-diagnostic paths — this specific tool, in this specific execution environment, right now, could not deliver a request to the Worker at all
ROOT_CAUSE_PROVEN=NO
BEHAVIORAL_FIX_IMPLEMENTED=NO
E6_CANDIDATE_UPLOADED=NO
SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=NO — per the user's own E6 gate, diagnostic success (or in this case, an inconclusive diagnostic attempt) alone is not sufficient
```

## Production containment (unaffected throughout)
```
WORKER_VERSIONS_CREATED=0    DEPLOYMENTS=0            TRAFFIC_SHIFTS=0
LIVE_402_REQUESTS=0          PAYMENT_SIGNATURES_CREATED=0   PAID_REQUESTS=0
SETTLEMENTS=0                REAL_ECONOMIC_EFFECT_USDC=0
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
```
Confirmed via `wrangler deployments status` read-back after cleanup: unchanged from before this checkpoint. All `wrangler dev --remote` processes and their child processes killed and confirmed gone (`pgrep` empty).

## Next step
The seam itself is sound and reusable (proven non-economic, proven production-unreachable, proven to reuse the exact executor code), but `wrangler dev --remote` did not deliver a usable Cloudflare-network reproduction in this environment today. Before retrying with the remaining 7 attempts, worth investigating whether the newer "remote bindings" mode wrangler's own startup banner pointed at (`wrangler dev` with `remote: true` per-resource, positioned as `--remote`'s replacement) behaves differently — that is a new, separate investigation, not performed in this checkpoint. No further live attempts were made; none are authorized beyond what this report already used.
