# FIRST-PAID-VERIFY-WORKER-JWT-BUNDLE-INIT-REMEDIATION-01 — closure

Status: **PASS**. The proven JWT bundle-initialisation defect is repaired in
source, proven in the emitted Worker bundle under real workerd, and proven in
one new immutable 0%-traffic canary (`0456f44c`) by exactly one zero-economic
diagnostic. No real payment, no real signature, no web-direct, no secret or
traffic mutation, no push. No secret, JWT or signature appears in this report.

## 1. Provenance

Start HEAD `ed7a3c65f0d9667ef37607ee39d2e799c8a1b0ac`, tree clean, branch
`metadata-vcm-qualification` (0 behind / 35 ahead). Live at start:
`369b4bf5`@100, `bece9f41`@0. `STARTING_PROVENANCE=PASS`.

## 2. Root cause (unchanged) and pre-fix reproduction

`@coinbase/cdp-sdk/_esm/package.json` declares `sideEffects:false`. esbuild
wraps `auth/utils/jwt.js` in a lazy `__esm` initialiser. `x402/facilitator.js`
is emitted unwrapped and does call `init_version2()` (it uses the non-hoisted
`version` const), but it references only the hoisted function `generateJwt`, so
the `init_jwt()` call is dropped. `generateJwt`/`nonce()` run while
`getRandomValues2` (assigned only inside `init_crypto_web`, reached only from
`init_jwt`) is unassigned.

Pre-fix, current HEAD, emitted production bundle: `init_jwt` defined, **0**
`init_jwt()` calls (`CURRENT_BUNDLE_JWT_INIT=FAIL`). The full production graph
plus a raw synthetic mint under local workerd: `TypeError`, symbol
`getRandomValues`, shape `NOT_A_FUNCTION` (`CURRENT_SYNTHETIC_JWT_MINT=FAIL`,
`CURRENT_FIRST_FAILING_SYMBOL=getRandomValues`).

## 3. Fix candidates (measured on small entries, control = 219,217 B, 0 calls)

| Candidate                                                      | `init_jwt()` calls | Synthetic mint | Size delta  |
| -------------------------------------------------------------- | ------------------ | -------------- | ----------- |
| A0 static root `import { CdpClient } from '@coinbase/cdp-sdk'` | 2                  | PASS           | +2.54 MB    |
| A1 static `import * as` of `@coinbase/cdp-sdk/auth`            | 0                  | FAIL           | none        |
| A1b bare `import '@coinbase/cdp-sdk/auth'`                     | 0                  | FAIL           | none        |
| A3 dynamic `import('@coinbase/cdp-sdk/x402')`                  | 3                  | PASS           | +3.4 MB     |
| **A2 dynamic `import('@coinbase/cdp-sdk/auth')`**              | 3                  | PASS           | **+165 KB** |
| C global `ignoreAnnotations`                                   | not built          | —              | —           |

`SELECTED_FIX`: `apps/edge-api/src/control-plane/evidence/cdp-auth-init.ts`
awaits a memoised dynamic import of the SDK's **public** `./auth` entry
immediately before `createAuthHeaders` on the verify, settle and supported paths
(wrapper applied once in the `CdpPaymentEvidenceProvider` constructor and in
`checkCdpSupportsNetwork`). A dynamic import is a genuine awaited module load;
esbuild emits the initialiser call at the import site regardless of
`sideEffects`. A rejected load is not cached and fails closed (verify degrades
to `facilitator_verify_unavailable` / `external_unverified`, no exception, no
message leak). Settle is covered deliberately: fixing verify alone would let a
verified payment fail at settlement with the same error.

Rejected: A0 (12x bundle growth), A3 (heavier), A1/A1b (no effect). Candidate C
was **not** built or measured: a narrower fix passes, and Wrangler exposes no
esbuild option, so it would mean replacing Wrangler's bundling with a custom
build plus `no_bundle` — the largest regression surface.
`BROAD_GLOBAL_IGNORE_ANNOTATIONS_USED=NO`. No private SDK paths, no talismans,
no compat/flag/secret/price/payTo/network/asset change. JWT claims, algorithm,
nonce, URI, credential parsing and auth-header semantics are untouched.

## 4. Build-output regression gate

`tests/build-output/cdp-jwt-bundle-init.test.ts` builds the production entry and
a probe entry with Wrangler (root config, whole production graph), runs the
probe under Miniflare/workerd (`compatibility_date=2026-08-05`, `nodejs_compat`)
and drives the real provider verify/settle/supported paths with a stubbed
`fetch` and a **public** RFC 8032 §7.1 Ed25519 fixture. Asserted: reached fetch,
`alg=EdDSA`, 32-hex nonce, `sub`/`iss`/scoped `uris`, signature present, verify
evidence `verified:true`; report contains no key, key id or JWT; structural
check that a defined `init_jwt` is invoked. Behavioural execution is
authoritative; the textual check is secondary.

| Rebuild (same probe, today's toolchain) | `init_jwt()` calls | Result                                                                                     |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `1bf1de7` (`8cc7222^`)                  | 2                  | PASS — all three paths mint                                                                |
| `8cc7222` (boundary)                    | 0                  | FAIL — verify `facilitator_verify_unavailable`; supported `getRandomValues_not_a_function` |
| fixed HEAD                              | 3                  | PASS                                                                                       |

`PRE_BOUNDARY_REBUILD=PASS`, `REGRESSION_BOUNDARY_REBUILD=FAIL`,
`FIXED_HEAD_REBUILD=PASS`. Limitation: source-level attribution with today's
toolchain, not byte-identical historical artifacts.

Mutation test: replacing the dynamic import with a resolved no-op made the
emitted-bundle gate fail (verify no longer succeeds, structural check fails) and
7/9 unit tests fail. Restored byte-exactly (SHA-256 `de66a18f…` before and
after). `MUTATION_TEST=PASS`.

## 5. Bundle diff review

Uncompressed 4,269,349 → 4,435,973 B (+166,624, +3.9%); gzip 708,806 → 744,801
(+35,995, +5.1%); source modules 725 → 789 (+64); `__esm` wrappers 93 → 156;
`init_jwt()` calls 0 → 3. Retained: the SDK `auth` graph and, through the public
`./auth` entry's `axiosHooks`, ~50 axios modules (unavoidable via the only
public entry exposing the JWT module short of the root or x402). Two new
top-level `init_auth();` calls (`facilitator.js`, diagnostic bridge): the JWT
graph now also initialises at Worker startup. Startup-safe: workerd enforces
global-scope restrictions and started cleanly, and the platform reported Worker
Startup Time 196 ms at upload. The two `whatwg-url` `import-is-undefined`
bundler warnings are pre-existing (identical on the parent commit).
`BUNDLE_DIFF_REVIEW=PASS`.

## 6. Source qualification

Full `apps/edge-api` + `packages/protocol-x402`: 185 files / 2329 tests passed,
22 files / 73 skipped, 0 failed (previous 183 / 2317; +2 files, +12 tests are
this checkpoint's). tsc (edge-api, live-tests) clean; eslint 0 errors; prettier
clean on changed files; `pnpm secrets:scan` clean (894 commits + working tree).
`vitest.workerd.config.ts`: 3 files / 6 tests pass; `input-schema-validation`
and `service-binding-timeout` still fail to load inside ajv, identical to
baseline (not hidden or relabelled). Service-binding config 4/4 pass.
`SOURCE_QUALIFICATION=PASS_WITH_ACCEPTED_PREEXISTING_LIMITATION`.

## 7. Canary and deployment

Source `3fc166415e62a31f1a65f847bc61b09af0cd0251`, harness pin `f5f39ff`.
Version `0456f44c-1c28-4919-9fdb-ab4673bac8f6` (tag
`first-paid-verify-worker-jwt-bundle-init-remediation-01`), one upload. All 19
non-`wrangler.toml` plain-text vars were passed explicitly from `bece9f41`
(including `JWT_RUNTIME_DIAGNOSTIC_ENABLED=true`), so the single upload did not
depend on var inheritance. `BINDING_PARITY=PASS`: 42/42 bindings, zero type or
value differences, runtime identical; secrets inherited (names only inspected).
Rollback deployment `90cd995c-81a2-430f-862d-ea1316982829` (`369b4bf5`@100 +
`bece9f41`@0). New deployment `b479cf40-f457-4f41-b1ae-4bac2216aa55`:
`369b4bf5`@100 + `0456f44c`@0.

## 8. Exact-version public qualification

CF-Ray → `scriptVersion.id` via Worker tail: 37/37 attributed correctly (one ray
was mislabelled by my own script as production; it was an override request and
resolved to the canary as it should). Health/ready 200. MCP via
`utility.siteborne.net` (workers.dev is intentionally outside the MCP host
allowlist) with the 2026-07-28 envelope and `Mcp-Method` header: 200, 6 tools,
identical to production. A2A JWS verified with the repo's
`verifyAgentCardAgainstTrustedJwks` for canary and production; a tampered-card
negative control throws. JWKS identical. Catalog/OpenAPI/schemas differ from
production only in `production_enabled`/`production_ready`/`protocol_status` on
the two admitted services (plus generation timestamps). Economics: verify
standard 402 / 17000, web direct 402 / 8000, both `eip155:8453`, USDC
`0x8335…2913`, payTo `0x7f44…E6E1`, domain USD Coin/2, matching governed
`service-prices.ts`, `RISK_LIMITS.yaml` and `SELLER_WALLET_ADDRESS`. Rendered
and independent_reproduction: 400 unavailable before 402. Company, document,
upload, Nevermined v2, legacy v1: 404. Production verify/web: 404 (paid routes
not mounted).

## 9. Single zero-economic post-fix diagnostic

2026-09-20T15:43:12Z–15:43:17Z. 1 unpaid fetch, 1 submission, sentinel all-zero
signature, unowned zero-balance sender, no CDP credentials in the environment,
no retry. Request CF-Ray `a3e1f1e1ede9757e-ATL` → `0456f44c`. Quote
`qte_88a93898f375e9a696a025a6`, requirement `req_aa7711fafee7f118d3f34cf2`,
payment `pay_07bc2d13e4b746f1b1ef586226bffbf8`. HTTP 402
`payment_verification_rejected` / `verification_not_successful` (public body
unchanged).

Durable audit: `SYNTHETIC_JWT_CONTROL=PASS`, `BOUND_DIRECT_JWT_MINT=PASS`,
`CREATE_AUTH_HEADERS=PASS` (all failure fields `NONE`; bound ED25519/VALID);
`facilitator_contact_attempted=YES`;
`verification_reason= invalid_exact_evm_payload_signature`,
`subreason=facilitator_verify_invalid`, `trust_class=external_verified`,
`transport_status=400`, `retryability= non_retryable`. The facilitator was
reached, accepted the CDP JWT, and rejected the deliberately invalid
authorization. `FACILITATOR_CONNECTIVITY=PASS`,
`FACILITATOR_AUTHENTICATION=PASS`.

## 10. Zero effect

D1 delta: +1 payment_attempt/job/quote, +5 audit_events, +4 job_state_events;
`job_attempts`, `job_artifacts`, `x402_service_results` unchanged; the attempt
is `verification_failed` with 0 settle attempts; global settle-attempt counter 0
and successful settlements 1 (the historical 09-01/08-28 settlement) unchanged.
Base (blocks 51,564,804 → 51,564,845): buyer 79,727 units, payTo 28,000, sender
0, all transaction counts 0 before and after; 0 USDC Transfer and 0
AuthorizationUsed events scoped to buyer/payTo/sender. Provider invocations 0.

## 11. Cloud mutation accounting

Worker uploads 1; deployment mutations 1; traffic mutations 0 (production
`369b4bf5` stayed 100%); secret mutations 0. `versions deploy` printed "Synced
non-versioned settings" (logpush false, observability enabled) — no change was
requested; I did not diff them against the prior values.

## 12. Remaining blockers / next

The JWT defect is repaired and the facilitator path is proven up to a valid
`/verify` verdict, but nothing here exercises a real, valid authorization
through settlement. `0456f44c` is a 0% diagnostic canary with
`JWT_RUNTIME_DIAGNOSTIC_ENABLED=true`; it is not promoted, and ordinary
production still has paid routes disabled. A second real verify-standard payment
needs its own authorization checkpoint (a fresh canary decision on whether to
keep the diagnostic flag on, a fresh 402, and the one-shot buyer client). Only
one real-payment failure mode is explained by this repair; whether the 09-20
06:24 rejection was exactly this defect is consistent with the evidence
(pre-verify JWT failure, same stage on every attempt) but is inferred, since
that attempt's audit predates the sub-classification.

`SAFE_TO_RETRY_REAL_VERIFY_PAYMENT` is a decision for the next checkpoint, not
this one.
