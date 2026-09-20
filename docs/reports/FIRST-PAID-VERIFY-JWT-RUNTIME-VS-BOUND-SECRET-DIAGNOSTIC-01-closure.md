# FIRST-PAID-VERIFY-JWT-RUNTIME-VS-BOUND-SECRET-DIAGNOSTIC-01 — closure

Status: **PASS**. Fault domain: **`WORKER_RUNTIME_OR_BUNDLE`** (decision-matrix
Class A). Inside the same production-workerd invocation, the SDK's JWT primitive
fails with a public, non-secret test key, while the Cloudflare-bound credential
is well-formed. The bound secret is not implicated. No secret, JWT, signature or
credential-derived value was read, printed or persisted. No real payment, no
real signature, no web-direct, no secret mutation, no traffic mutation, no push.

## 1. Starting state

HEAD `f88e9d092c498af1ce912a839c59f9052ea5b38b`, tree clean, branch
`metadata-vcm-qualification` (29 ahead / 0 behind). Deployment:
`369b4bf5…`@100 + `a6acfc75…`@0; `PAID_ROUTES_ENABLED=false` on ordinary
production. `STARTING_PROVENANCE=PASS`. Prior unresolved classification:
`cdp_jwt_unknown_failure` (auth stage, no HTTP attempted; local validator PASS).

## 2. Diagnostic architecture (stages)

| #   | Stage                                       | Mechanism                                                                                                      |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | ENV_BINDING_RESOLUTION                      | `typeof` + non-empty check on the two bindings → `PRESENT/MISSING/NON_STRING`                                  |
| 2   | CREDENTIAL_OUTER_SHAPE                      | shared `cdp-credential-shape.ts` (same classifier the operator validator now re-exports); enums only           |
| 3–4 | CLIENT_CONSTRUCTION + SYNTHETIC_JWT_CONTROL | the SDK's own `createCdpFacilitatorClient(...).createAuthHeaders('verify')` with a public test key; no `fetch` |
| 5   | BOUND_DIRECT_JWT_MINT                       | the SDK's **public** `generateJwt` (`@coinbase/cdp-sdk/auth`) for VERIFY, SETTLE, SUPPORTED; result discarded  |
| 6   | CREATE_AUTH_HEADERS                         | outcome of the _real_ call that already ran, classified to enums; arguments/claims/URI untouched               |
| 7   | FACILITATOR_HTTP                            | contact attempted? (`NO` when stage 6 failed)                                                                  |

`BOUND_DIRECT_JWT_MINT` was available through the public export, so no private
internals were used and no signing was reimplemented.

Synthetic key: the published RFC 8032 §7.1 "TEST 1" Ed25519 vector, assembled at
runtime from two hex halves; unrelated to any SITEBORNE/CDP project, no
permission anywhere, never sent to CDP, never persisted. Secret scan clean.

Controls run **only** on a failed verification and **only** when the non-secret
var `JWT_RUNTIME_DIAGNOSTIC_ENABLED` is exactly `'true'` (verify_agent_output.v2
composition only; unset in ordinary production; web/company/document
compositions do not reference it, asserted by test). The route forwards the flag
explicitly — without that, the flag would have been silently ignored.

## 3. Source (commit `4498eb7`; harness pin `cdbc5d8`)

New: `cdp-credential-shape.ts`, `cdp-jwt-diagnostic.ts` (pure, deps injected),
`cdp-jwt-diagnostic-sdk.ts` (only file wiring the real SDK). Changed:
`cdp-provider.ts` (optional diagnostic hook, absent by default),
`production-payment.ts`, `env.ts`, the verify composition and route,
`x402-service.ts` (allow-listed `jwt_diag_*` audit keys), `types.ts` (optional
field), `validate-cdp-credentials.mts` (re-exports the shared classifier).

Audit keys avoid the existing `sanitizeDetails` substring redactor (`key`,
`credential`, `secret`, `token`, …): the first draft's `bound_key_type` /
`bound_credential_*` were rendered `[REDACTED]`, so they were renamed
`binding_*`. `thrown_value_class` is a superset of the requested enum
(`ERROR|TYPE_ERROR|NON_ERROR_THROW|UNKNOWN` plus `RANGE_ERROR`,
`REFERENCE_ERROR`, `SYNTAX_ERROR`, `DOM_EXCEPTION`); `error_shape` is a fixed
allow-list (`NOT_A_FUNCTION`, `NOT_DEFINED`, `NOT_SUPPORTED`, …) derived by
pattern-matching the message, never echoing it.

## 4. Tests and secret safety

`tests/jwt-runtime-diagnostic.test.ts`: 20 tests, A–N of the mission (synthetic
PASS/FAIL, missing/invalid bound, bound parse/sign failure, bound PASS,
createAuthHeaders failing after bound PASS, non-Error throw, unknown Error,
createAuthHeaders PASS → facilitator layer, no secret/JWT/signature/header/
thrown-text in any audit row, zero network for local controls, public 402
byte-identical on/off, flag-off writes nothing, route forwards only the flag).
`tests/workerd/jwt-runtime-diagnostic.workerd-test.ts`: 2 tests under real
workerd. Mutation test: forcing `create_auth_headers` to `PASS` and the
non-Error class to `ERROR` failed 3 tests (I/J, H, I); file restored
byte-exactly (SHA-256 verified).

Gates: `apps/edge-api` + `packages/protocol-x402` 183 files / 2312 passed, 22
files / 73 skipped, 0 failed; tsc (edge-api, live-tests config, protocol-x402)
clean; eslint clean; prettier clean on changed files; working-tree secret scan
clean. Workerd suite: my 2 files + existing pass; 2 files
(`input-schema-validation`, `service-binding-timeout`) fail to load with the
known ajv CJS `SyntaxError` — **identical at base `f88e9d0`**, pre-existing.
`SOURCE_QUALIFICATION=PASS`; `SECRET_MATERIAL_LOGGED=NO`.

Observation (local only): Node and local workerd both accept a quoted or
newline-padded base64 Ed25519 secret at the SDK (the shape classifier reports
`INVALID`, the mint `PASS`). So `binding_format=INVALID` alone would not prove a
mint failure; both fields are recorded for that reason.

## 5. New canary and deployment

`0546d6b7-98e3-49c3-9f72-b552a0582cb8`, tag
`first-paid-verify-jwt-runtime-vs-bound-secret-diagnostic-01`, source `4498eb7`.
Bindings 42 vs `a6acfc75`'s 41: the **only** difference is
`JWT_RUNTIME_DIAGNOSTIC_ENABLED=true`. Secrets inherited by name (both CDP
bindings `secret_text`); runtime identical (`2026-08-05`, `nodejs_compat`).
Deployment `369b4bf5`@100 + `0546d6b7`@0. **Rollback deployment**
`8df5348d-e77a-49e9-a18a-a30018b5a733` (`369b4bf5`@100 + `a6acfc75`@0). Older
versions not deleted.

## 6. Exact-version attribution and full qualification

All probes went to `utility.siteborne.net` with the override header. Each
response's CF-Ray was mapped to `scriptVersion.id` via an unfiltered
`wrangler tail --format json` capture: **37/37 probes attributed correctly** (26
to `0546d6b7`, 11 no-override control probes to `369b4bf5`; 0 mismatched, 0
missing). `EXACT_VERSION_ATTRIBUTION=PASS`.

- **MCP.** The authoritative protocol is `2026-07-28`
  (`packages/protocol-mcp/src/constants.ts`). The modern era has no `initialize`
  method (it returns `-32601`), so the prior "initialize negotiated 2025-11-25"
  was the legacy-compat path, which the promotion report documents as unchanged.
  Qualification used the modern envelope + `MCP-Protocol-Version: 2026-07-28`
  header: `tools/list` → 200, exactly **6** tools, identical to production
  except the two intentional description flips. The response does not echo a
  protocol version; the evidence is acceptance under the modern envelope. I did
  not send a wrong-version negative probe. `MCP_QUALIFICATION=PASS`.
- **A2A/JWS.** Agent Card verified against the served JWKS with the repo's
  `verifyAgentCardAgainstTrustedJwks`: canary PASS, production PASS; one
  signature, one key, no private `d`. JWKS byte-identical.
- **OpenAPI** 3.1.0, four v2 paid POST operations; **catalog**, **schemas**,
  **ready**, **agent card** differ from production only in truthful
  `production_enabled`/`protocol_status`/ready for web-direct and
  verify-standard (and the re-signed card). Flag not exposed in any public
  document.
- **Paid admission.** verify standard **402** (17000, `eip155:8453`, USDC
  `0x8335…2913`, payTo `0x7f44…E6E1`, exact, `USD Coin`/`2`); web direct **402**
  (8000, same rail); rendered and independent_reproduction **400 unavailable**
  before any 402; company, document, document upload, four `/v2/nevermined/*`
  and four `/v1/*` routes **404**; ordinary production verify/web **404**. MCP
  `siteborne_get_quote` (read-only) returned quotes for both services.
- Static canonical metadata not touched (`STATIC_METADATA_CHANGED=NO`).

## 7. Baseline (read-only)

D1 counts before: payment_attempts 22, jobs 22, x402_quotes 91, audit_events
205, job_attempts 0, job_artifacts 0, x402_service_results 2,
payment_service_link_evidence 0. Base: buyer 79,727 USDC / 0 txs; payTo 28,000 /
0; unowned sender 0 / 0.

## 8. The single diagnostic

2026-09-20T13:48:31Z. One unpaid fetch + exactly one submission; all-zero
sentinel signature, random unowned zero-balance sender, no CDP credentials or
wallet secret in the environment, no retry.

| Field               | Value                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Request id (job)    | `c5e9b30c-f8b1-46cf-9ced-69a516d5c15e`                                       |
| Quote / requirement | `qte_ff78a3af8c17a218c3757ccb` / `req_13ef4f406e5239f3593b829d`              |
| Payment id          | `pay_64bbbc903be4434392961658069716f9`                                       |
| CF-Ray              | `a3e149cc1e53eb67-ATL` → scriptVersion `0546d6b7…`, outcome ok, 0 exceptions |
| Public response     | 402 `payment_verification_rejected` / `verification_not_successful`          |

## 9. Same-invocation control results (durable audit, enums only)

```
env_binding                     = PRESENT
binding_present                 = YES
binding_algorithm               = ED25519
binding_format                  = VALID
binding_quoted / whitespace / crlf = NO / NO / NO
synthetic_jwt_control           = FAIL
  synthetic_failure_class       = cdp_jwt_unknown_failure
  synthetic_thrown_value_class  = TYPE_ERROR
  synthetic_error_shape         = NOT_A_FUNCTION
bound_direct_jwt_mint           = FAIL   (failing target: VERIFY, the first)
  bound_direct_failure_class    = cdp_jwt_unknown_failure
  bound_direct_thrown_value_class = TYPE_ERROR
  bound_direct_error_shape      = NOT_A_FUNCTION
create_auth_headers             = FAIL
  create_auth_headers_failure_class = cdp_jwt_unknown_failure
  thrown_value_class            = TYPE_ERROR
  create_auth_headers_error_shape = NOT_A_FUNCTION
facilitator_contact_attempted   = NO      (no HTTP status)
```

## 10. Decision

Class A: `SYNTHETIC_JWT_CONTROL=FAIL`. Production workerd cannot complete the
SDK's JWT operation even with a public, no-permission Ed25519 test key; the
bound credential's outer shape matches the operator's valid local copy (ED25519,
valid, unquoted, no whitespace, no CRLF). The real path, the bound-direct mint
and the synthetic control fail identically: a `TypeError` whose message is of
the "… is not a function" shape, at the first target, before any HTTP.
`FAULT_DOMAIN=WORKER_RUNTIME_OR_BUNDLE`.

What this does **not** establish: _which_ function is missing. Candidates
(unverified): a primitive the SDK calls before key import — `getRandomValues`
from `uncrypto`, a `Buffer` method used for base64url — or a bundling/condition-
resolution difference for `jose` 6.2.8 / `uncrypto` in the deployed bundle,
possibly interacting with the production compatibility date (`2026-08-05`; local
workerd falls back to `2026-01-03`, and passes). Earlier settlements on 08-28
and 09-01 used the same secrets and, per the lockfile, the same dependency
versions, so the change is more likely in how the current bundle resolves them
than in the secret. `LOCAL_WORKER_CREDENTIAL_BEHAVIOR_PARITY=FAIL` (local mints,
Worker does not) — now attributed to the runtime, not the credential. An attempt
to reproduce by bundling the controls into local Miniflare failed on module
resolution and was dropped; no conclusion is drawn from it.

## 11. Zero-effect reconciliation

D1 delta: +1 payment_attempt, +1 job (`REJECTED`, `verification_failed`), +1
quote, +5 audit events; job_attempts, job_artifacts, results and link evidence
unchanged; settle attempts 0, successful settlements 0. Base (scoped to buyer,
unowned sender, payTo): balances unchanged, txcount 0, USDC Transfer in/out 0,
`AuthorizationUsed` 0 since the baseline block. Tail window: 0 exceptions, all
outcomes `ok`. `ONCHAIN_TRANSACTION=NO`, `USDC_TRANSFER=NO`,
`PROVIDER_INVOCATIONS=0`, `SETTLEMENT_COMPLETED=NO`.

## 12. Cloud mutations

Worker uploads 1 (`0546d6b7`); deployment mutations 1 (`8df5348d…` → new
record); traffic mutations 0 (production stayed 100%); secret mutations 0; DNS
0; D1 writes only by the Worker's own rejected diagnostic request.

## 13. Recommendation

**Do not re-provision the CDP secret.** Next checkpoint: identify the missing
primitive inside production workerd. On a new 0% canary, add a diagnostic-only,
fixed-allow-list capability probe (booleans such as
`typeof crypto.getRandomValues`, `typeof crypto.subtle.importKey`,
`typeof Buffer.from`, `Buffer.prototype.toString` supporting `base64url`, and
whether the bundled `uncrypto`/`jose` export the expected functions), executed
in the same invocation. Compare a bundle built with wrangler's exact resolver
conditions against the dependency versions that settled on 08-28/09-01. Only
then decide between a dependency/bundle pin and a source fix; either needs its
own authorization.
