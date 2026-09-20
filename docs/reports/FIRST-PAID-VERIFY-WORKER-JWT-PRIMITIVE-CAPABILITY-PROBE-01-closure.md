# FIRST-PAID-VERIFY-WORKER-JWT-PRIMITIVE-CAPABILITY-PROBE-01 — closure

Status: **PASS**. First failing symbol: **`getRandomValues`** (uncrypto's
export, called by `nonce()` in `@coinbase/cdp-sdk` `auth/utils/jwt.js`). Fault
domain: **`TREE_SHAKING_OR_BUNDLE_TRANSFORM_DEFECT`**. Nothing was fixed in this
checkpoint. No secret, JWT, signature, raw authorization or raw exception was
read, printed or persisted. No real payment, no web-direct, no secret/traffic
mutation, no push.

## 1. Provenance

Start HEAD `e2a2cd065e74471893a44f8d213d4a3c4459c08f`, tree clean, branch
`metadata-vcm-qualification` (32 ahead / 0 behind). Live: `369b4bf5…`@100,
`0546d6b7…`@0. `STARTING_PROVENANCE=PASS`. Wrangler config: root
`wrangler.toml`, `compatibility_date=2026-08-05`,
`compatibility_flags=["nodejs_compat"]` (unchanged). Wrangler 4.119.0 bundles
with esbuild 0.28.1.

## 2. Traced JWT call graph (installed versions)

| Stage | Symbol (module)                                                                                      | Notes                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1     | `createAuthHeaders` (`cdp-sdk/_esm/x402/facilitator.js`)                                             | static import of `../auth/index.js`; calls `generateJwt` ×3                                        |
| 2     | `generateJwt` (`_esm/auth/utils/jwt.js`)                                                             | validates args, builds claims                                                                      |
| 3     | **`nonce()` → `getRandomValues` (`uncrypto` `crypto.web.mjs`) → `Buffer.from(...).toString('hex')`** | WebCrypto `getRandomValues`; Buffer via nodejs_compat; **runs before any key handling**            |
| 4     | `isValidECKey` → `jose.importPKCS8` (try/catch → false)                                              | jose 6.2.8, WebCrypto                                                                              |
| 5     | `isValidEd25519Key` → `Buffer.from(str,'base64')`                                                    | Buffer, nodejs_compat                                                                              |
| 6     | `buildEdwardsJWT`: `Buffer`, `jose.importJWK`, `new SignJWT(...).sign`                               | errors here are wrapped as `Failed to generate Ed25519 JWT:` (classified `cdp_jwt_signing_failed`) |

Because the observed class was `cdp_jwt_unknown_failure` (not the wrapped
signing class), the throw had to occur outside `buildEdwardsJWT`: stage 3 or 5.
`uncrypto` 0.1.3 resolves to `crypto.web.mjs` under the `workerd`/`worker`
conditions (not the `node:crypto` build).

`PRIMITIVE_PROBE_COUNT=6` (allow-list of the diagnostic's symbol enum):
`getRandomValues`, `Buffer`, `importPKCS8`, `importJWK`, `SignJWT`, `digest` (+
`OTHER`, `NONE`). The Worker instrumentation does **not** import any of those
modules (an extra import of `uncrypto` would have initialised the very module
under test and masked the defect); it maps the thrown "X is not a function"
message onto the allow-list and discards the text.

## 3. First failing stage, from the real path (production canary `bece9f41`)

Durable `payment_verification_failed` audit (safe enums only):

```
synthetic:  FAIL  symbol=getRandomValues stage=NONCE_GENERATION shape=NOT_A_FUNCTION TYPE_ERROR
bound:      FAIL  symbol=getRandomValues stage=NONCE_GENERATION target=VERIFY (first)
createAuthHeaders: FAIL symbol=getRandomValues stage=NONCE_GENERATION
failure_stage_parity=PASS   facilitator_contact_attempted=NO
binding: ED25519 / VALID / unquoted / no whitespace / no CRLF
```

Synthetic (public RFC 8032 vector) and bound credential fail at the same symbol,
in the pre-key-content stage: credential content is excluded.
`LAST_SUCCESSFUL_STAGE=claims construction`;
`FIRST_FAILING_STAGE=NONCE_GENERATION`; `FIRST_FAILING_SYMBOL=getRandomValues`;
`EXPECTED_TYPE=function`; `ACTUAL_TYPE=undefined` (bundle variable declared,
never assigned — see §5; the runtime error text is "is not a function",
`undefined` is inferred from the bundle, not measured in production).

## 4. Local reproduction of the emitted bundle — `LOCAL_BUNDLE_REPRODUCTION=PASS`

Minimal entry importing only `@coinbase/cdp-sdk/x402` and calling
`createCdpFacilitatorClient({…public RFC 8032 key…}).createAuthHeaders('verify')`,
bundled by `wrangler deploy --dry-run` (same compat date/flag) and run in local
workerd via `wrangler dev`: **`TypeError: getRandomValues is not a function`**.
An entry importing only `@coinbase/cdp-sdk/auth` does not reproduce (its bundle
is not wrapped). Probe files were temporary and removed (untracked; copies not
committed).

## 5. Source vs bundle; export condition

- Source: `import { getRandomValues } from "uncrypto"` (static, inside jwt.js).
- Bundle: uncrypto and jwt.js are each wrapped in esbuild `__esm` lazy
  initialisers (`init_crypto_web`, `init_jwt`). `getRandomValues2` is a hoisted
  `var` assigned only inside `init_crypto_web`, which is reached only from
  `init_jwt`. **`init_jwt()` is never called anywhere in the production
  bundle**, so `generateJwt`/`nonce` run (function declarations are hoisted)
  while `getRandomValues2` stays unassigned.
- Cause of the dropped call: `@coinbase/cdp-sdk/_esm/package.json` declares
  `"sideEffects": false`. Building the same entry with esbuild
  `ignoreAnnotations: true` (ignores `sideEffects`) emits the `init_jwt()` call.
  Why esbuild wraps jwt.js in this graph at all was **not** determined.
- `PACKAGE_EXPORT_CONDITION`: uncrypto → `workerd`/`worker` → `crypto.web.mjs`
  in the bundle (bundled variant confirmed). Local Node/vitest select `node` →
  `crypto.node.mjs`; local vitest-pool-workers (vite, not esbuild) also passes.
  That is why every local mint passed. jose 6.2.8 selected the web/workerd
  build. `BUNDLE_IMPORT_PARITY=FAIL`.
- `MODULE_EXPORT_PRESENT=YES` (source module exports the function);
  `MODULE_INTEROP_CLASS=NONE` (not an ESM/CJS mismatch; a skipped module
  initialiser).

## 6. Compatibility analysis

`COMPATIBILITY_DEPENDENCY=none`: the failing symbol is a bundle-level module
initialisation gap, not a runtime primitive. It reproduces under the current
`nodejs_compat` + 2026-08-05 settings and does not depend on the flag or date.
(Not tested: other dates/flags; none were changed.)

## 7. Historical comparison — `HISTORICAL_COMPARISON_LEVEL=SOURCE_AND_LOCKFILE_ONLY`

No historical emitted bundle exists; I rebuilt each commit with the current
toolchain (locks show wrangler 4.119.0 and esbuild 0.28.1 at all three points,
`cdp-sdk` 1.55.0 throughout). `init_jwt()` calls in the bundle:

| Commit      | Date       | `init_jwt()` calls |
| ----------- | ---------- | ------------------ |
| 418b75b     | 2026-08-28 | 2 (works)          |
| f35df82     | 2026-09-01 | 2 (works)          |
| 1bf1de7     | (bisect)   | 2                  |
| **8cc7222** | 2026-09-10 | **0** (first bad)  |
| eccc684     | 2026-09-19 | 0                  |
| HEAD        | 2026-09-20 | 0                  |

Bisect over 223 commits (`f35df82..eccc684`). `HISTORICAL_RELEVANT_DELTA`:
commit `8cc7222` "make seller identity pre-402 deterministic" removed
`import { CdpClient } from '@coinbase/cdp-sdk'` from `production-payment.ts`,
leaving only `@coinbase/cdp-sdk/x402`/`/auth`. The SDK root import had been what
caused jwt.js's initialiser to be invoked. The removal was a legitimate,
unrelated change. Caveat: this is source-level attribution with today's
toolchain, not a rebuild of the actual 08-28 artifact.

## 8. Tests and mutation test

`tests/jwt-runtime-diagnostic.test.ts` now 25 tests (symbol/stage mapping incl.
bundler-renamed `getRandomValues2` and `importPKCS8`; unknown symbol → `OTHER`;
non-callable phrasing/other errors → `NONE`; same-symbol parity PASS, differing
FAIL; full success path; enums survive the redactor with no `[REDACTED]`;
earlier network/secret/flag-off/public-402 tests unchanged). Mutation (forcing
`failing_stage` to `UNKNOWN`) failed 3 tests; file restored byte-exactly
(SHA-256 verified). Also fixed two pre-existing lint errors in that test file.

Gates: `apps/edge-api` + `packages/protocol-x402` 183 files / 2317 passed, 22
files / 73 skipped, 0 failed; tsc (edge-api, live-tests, protocol-x402) clean;
eslint 0 errors; prettier clean; secret scan clean. Two workerd test files
(`input-schema-validation`, `service-binding-timeout`) fail to load with the ajv
`SyntaxError`, identical at the earlier baseline; not counted as passing.
`SOURCE_QUALIFICATION=PASS_WITH_ACCEPTED_PREEXISTING_LIMITATION`.

## 9. Canary, qualification, single diagnostic

Source `cab355d`; harness pin `dc75217`. New version
`bece9f41-ddbb-4fa3-a6e8-8be3b67ae8fa` (tag
`first-paid-verify-worker-jwt-primitive-capability-probe-01`): 42/42 bindings,
runtime identical to `0546d6b7` (`BINDING_PARITY=PASS`), secrets inherited.
Deployment `369b4bf5`@100 + `bece9f41`@0; **rollback deployment**
`53deee7f-545e-467d-b4a2-aeeb60cfd578` (`369b4bf5`@100 + `0546d6b7`@0).

Exact-version attribution: 37/37 probes mapped CF-Ray → `scriptVersion.id` (25
canary, 11 production controls); one JWKS probe missed the first tail and was
re-probed twice with a fresh tail and attributed to `bece9f41`; the diagnostic
ray was attributed too. Qualification: health/ready/catalog/OpenAPI/
schemas/card differ from production only in the truthful `production_enabled`/
`protocol_status`/ready flags for the two admitted routes; JWKS and health
identical; MCP `tools/list` under the 2026-07-28 envelope: 6 tools (2
intentional description flips); A2A JWS PASS for canary and production.
Admission: verify standard 402 (17000), web direct 402 (8000), both Base USDC
`0x8335…2913`, payTo `0x7f44…E6E1`, domain USD Coin/2; rendered and
independent_reproduction 400 before 402; company, document, upload, Nevermined,
v1: 404; production verify/web 404. The MCP response does not echo a protocol
version; no wrong-version negative probe was sent.

Diagnostic (2026-09-20T14:50:34Z): 1 unpaid fetch, 1 submission, all-zero
sentinel signature, unowned zero-balance sender, no credentials in the harness
environment, no retry. Request `7e734081-379e-44d6-87ee-ab83075209e3`, quote
`qte_4e0ddc618432acfb87bf7f49`, requirement `req_e4ffd8b165789a5bf51dd298`,
payment id `pay_520eccebc4cc4d3a92cba8bec9943338`, CF-Ray
`a3e1a4ac0aa9a3fb-ATL`, version `bece9f41`, HTTP 402 (public body unchanged).

## 10. Zero effect

D1 delta +1 payment_attempt/job/quote, +5 audit rows; job `REJECTED`,
`verification_failed`, settle attempts 0, successful settlements 0,
`job_attempts`/`job_artifacts`/`x402_service_results` unchanged. Base: buyer
79727 USDC units, payTo 28000, sender 0; tx counts 0; address-scoped Transfer
and AuthorizationUsed events 0. Provider invocations 0.

## 11. Root cause, proposed fix, backtest plan (for review; not applied)

**Root cause.** Since `8cc7222`, the bundle contains cdp-sdk `auth/utils/jwt.js`
and uncrypto as `__esm`-wrapped modules whose initialisers are never invoked
(esbuild honours `sideEffects:false` from the SDK's `_esm/package.json`), so the
`getRandomValues` binding used by `nonce()` is unassigned. Every CDP JWT mint in
the deployed Worker therefore throws before any key handling.

**Minimum proposed fix (choose after review):** (a) restore a module-level
import that keeps the SDK auth graph initialised (e.g. use the SDK root export
again), or (b) a bundler-level change so the SDK's `sideEffects` hint is not
applied to `jwt.js`/uncrypto (Wrangler `alias`/custom esbuild option). Prefer
the smallest that leaves `compatibility_*` untouched; no polyfill needed.

**Backtest plan.** (1) Add a build-output test that bundles the Worker with
Wrangler and fails unless `init_jwt` is either absent or invoked. (2) Rebuild
`8cc7222`, HEAD and the fix and compare `init_jwt()` counts (0, 0, ≥1). (3) Run
the repro entry from §4 under local workerd before/after. (4) New 0% canary,
zero-economic diagnostic expecting `create_auth_headers=PASS` and the
facilitator layer as next stage (`facilitator_verify_invalid`). (5) Only then a
separately authorised real verify payment.

## 12. Cloud mutation accounting

Worker uploads 1 (`bece9f41`); deployment mutations 1; traffic mutations 0;
secret mutations 0; older versions not deleted. Local commits: `cab355d`
(source), `dc75217` (harness pin), plus this report. Not pushed.

## 13. Not established

Why esbuild wraps jwt.js/uncrypto in this graph; the production runtime
`ACTUAL_TYPE` (inferred, not measured); behaviour under other compat dates;
whether the exact historical 08-28 artifact matched today's rebuild of that
commit; whether the facilitator accepts the credential (never contacted).
