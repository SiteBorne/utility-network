# FIRST-PAID-VERIFY-WORKER-CREDENTIAL-SHAPE-DIAGNOSTIC-01 — closure

Status: **PASS** (the Worker's JWT failure was safely classified). The
classification is `cdp_jwt_unknown_failure`, which does **not** match any of the
secret-shape classes the mission expected. No secret was read, printed, hashed
or persisted. No real payment, no real signature, no web-direct, no secret
mutation, no traffic mutation, no push.

## 1. Local human-validator result (operator, offline)

```
CDP_API_KEY_ID_SHAPE=UUID            CDP_API_KEY_SECRET_SHAPE=OTHER
CDP_KEY_TYPE=ED25519                 CDP_CREDENTIAL_FORMAT=VALID
CDP_JWT_MINT=PASS                    CDP_JWT_FAILURE_CLASS=NONE
CDP_VALIDATOR_NETWORK_ACCESS=NONE
```

This proves the operator's local copy mints under the installed SDK. It does not
prove Cloudflare holds the same bytes.

## 2. Source state and Worker JWT subclassifier

Starting HEAD `3a2452ee6091a5ac9d45a973fe666be6cbf12749`, tree clean.
`cdp-jwt-failure.ts` present. Exact enum (repository values):
`cdp_key_id_missing`, `cdp_key_secret_missing`, `cdp_key_format_invalid`,
`cdp_key_parse_failed`, `cdp_jwt_signing_failed`, `cdp_jwt_unknown_failure`.

`WORKER_JWT_SUBCLASSIFIER_SECRET_SAFE=PASS`: `classifyCdpJwtFailure` returns
only a member of the fixed union; `Error.message` is matched against fixed
patterns and discarded; the audit value additionally passes the existing
`safeAuditCode` filter. Nothing returns message, cause, stack, Authorization
header or key bytes.

## 3. Source qualification — `SOURCE_QUALIFICATION=PASS`

| Gate                                                               | Result                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| JWT subclassification + credential-validator + observability tests | 3 files / 58 passed                                      |
| Full `apps/edge-api` + `packages/protocol-x402`                    | 182 files / 2292 passed, 22 files / 73 skipped, 0 failed |
| `tsc` edge-api, edge-api live-tests tsconfig, protocol-x402        | clean                                                    |
| `eslint` (evidence, x402-service, protocol-x402 evidence types)    | clean                                                    |
| `prettier --check` on every file changed since `2a9a681`           | clean                                                    |
| Working-tree secret scan                                           | no leaks (1655 files)                                    |

## 4. New canary and deployment

`NEW_DIAGNOSTIC_CANARY_VERSION=a6acfc75-58ab-4de3-8bff-4445a20376cc`, tag
`first-paid-verify-worker-credential-shape-diagnostic-01`, source `3a2452e`.
Uploaded with the 6 `wrangler.toml` vars plus the same 12 `--var` overrides as
`8cddb16e`; secrets inherited by name; no `wrangler secret put`.

Deployment: `369b4bf5…`@100 + `a6acfc75…`@0. **Rollback deployment** (recorded
before the mutation, 2026-09-20T07:13:45Z): `369b4bf5…`@100 + `8cddb16e…`@0.

`BINDING_PARITY=PASS` versus `8cddb16e`: 41/41 bindings, no name/type/non-secret
value differences, identical runtime (`2026-08-05`, `nodejs_compat`).
`CDP_API_KEY_ID_BINDING_PRESENT=YES`, `CDP_API_KEY_SECRET_BINDING_PRESENT=YES`
(both `secret_text`; values never requested).

## 5. Exact-version qualification — `PAID_ADMISSION_PARITY=PASS`

Override header `siteborne-utility-edge="a6acfc75-…"`. health, ready,
agent-card, JWKS, OpenAPI, catalog: 200. verify standard **402**; web direct
**402**; web rendered **400 `retrieval_mode_unavailable`**; verify
independent_reproduction **400 `verification_mode_unavailable`** (both before
any 402). Company evidence graph, document evidence, document upload, and all
four `/v2/nevermined/*` routes: **404**. Ordinary production (no override):
verify and web **404**.

Caveat: MCP `initialize` on `utility.siteborne.net` returned 200 but negotiated
protocolVersion `2025-11-25` for my `2026-07-28` request, and I did not prove
the version override applies on that custom host. A2A/JWS, OpenAPI and catalog
parity were not re-diffed at this checkpoint beyond HTTP 200. These are not
blockers for a credential diagnostic but are not full re-qualification.

## 6. The one zero-economic diagnostic

Harness `apps/edge-api/tests/live/facilitator-diagnostic-local.test.ts`; only
change is the version pin. All-zero sentinel signature, random unowned
zero-balance `from`, no CDP credentials or wallet secret in the environment, 1
unpaid fetch + exactly 1 submission, no retry. 2026-09-20T08:03:52Z.

| Field       | Value                                                               |
| ----------- | ------------------------------------------------------------------- |
| Quote       | `qte_3f86defa3d85a2feb685e5d6`                                      |
| Requirement | `req_0eb16182e448bbd9296eb79d`                                      |
| Payment id  | `pay_fa3bb743b5274903a7fb6f4f1e606fbe`                              |
| CF-Ray      | `a3df50ee7fe1674f-ATL`                                              |
| HTTP        | 402 `payment_verification_rejected` / `verification_not_successful` |

The harness does not capture the `x-request-id`; the durable audit rows are
keyed by the quote and payment id above. The public 402 is unchanged.

## 7. Worker JWT subclass (durable `payment_verification_failed` audit)

```
verification_reason        = facilitator_verify_unavailable
verification_subreason     = facilitator_jwt_generation_failed
verification_jwt_subreason = cdp_jwt_unknown_failure
trust_class                = external_unverified
verification_provider      = cdp:facilitator
verification_retryability  = operator_action_required
transport_status           = (absent: no HTTP request attempted)
```

Chain:
`payment_required_created → job_created → payment_verification_requested → payment_verification_failed`,
~490 ms end to end.

## 8. What `cdp_jwt_unknown_failure` means — and does not mean

The classifier returns it when the auth-stage error matches none of the SDK
message shapes for a missing id, missing secret, bad format, key-import failure
or signing failure (or when the cause is not an `Error` with a string message).

I tested the classifier offline against 13 synthetic secret shapes with the
installed SDK: empty, undefined, whitespace-only, non-string, number, array,
quoted, trailing newline, escaped-newline PEM, truncated PEM, short garbage,
mismatched-key Ed25519, and a valid EC PEM. Every malformed or missing input
mapped to `cdp_key_secret_missing`, `cdp_key_format_invalid` or
`cdp_key_parse_failed`; the valid EC PEM minted. **None mapped to
`cdp_jwt_unknown_failure`.**

Therefore the production result is **not** explained by an empty, mis-quoted,
mis-encoded, truncated or otherwise mis-shaped secret. Something else throws
inside the production auth-header path with a message the classifier does not
recognise. Candidates I can name but have **not** distinguished: a runtime fault
in a primitive used before key import (`uncrypto` `getRandomValues`, `Buffer`
under `nodejs_compat`), a production-only compatibility-date behaviour (local
workerd is `2026-08-01`, production runs `2026-08-05`), a non-`Error` throw, or
an error shape from a dependency I did not model. The SDK's own `Promise.all`
mints three JWTs, so one of the three could fail differently.

The Worker does not log this error (no `console.*` on the path), so Workers Logs
cannot supply the message either. I did not attempt Logpush/telemetry APIs.

## 9. Local vs Worker

`LOCAL_WORKER_CREDENTIAL_BEHAVIOR_PARITY=FAIL`: local JWT mint passes; the
Worker's does not. This is direct evidence that the Worker environment does not
behave like the operator's local copy. It is **not** evidence that the stored
secret differs: no equality was or can be established here, and the failure
class rules out the shape errors a differing secret would most plausibly
produce.

## 10. Zero-effect reconciliation

D1 (SELECT-only) before → after: payment_attempts 21→22, jobs 21→22, x402_quotes
88→89, audit_events 198→203; job_attempts (0), job_artifacts (0),
x402_service_results (2), payment_service_link_evidence (0) unchanged. Base
mainnet before → after: buyer USDC 79,727 / txcount 0; payTo USDC 28,000 /
txcount 0; unowned sender 0 / 0 — unchanged. USDC `AuthorizationUsed` and
`Transfer` events involving the buyer or the unowned sender since the baseline
block: 0. USDC transfers to payTo since baseline: 0. No provider invocation, no
settlement, no authority or result rows.

## 11. Decision-tree outcome

The tree in the mission covers `cdp_key_secret_missing`,
`cdp_key_format_invalid`, `cdp_key_parse_failed`, `cdp_jwt_signing_failed`, and
"Worker JWT PASS". The observed class is none of these. No branch of the tree
supports re-provisioning the secret, so:

`CLOUD_SECRET_REMEDIATION_REQUIRED=NO` (not established by evidence). I am
**not** recommending `CDP_API_KEY_SECRET` replacement on this result, and doing
so now would be a guess that could also destroy the only known-working
comparison point.

## 12. Recommended next checkpoint (proposal only)

Separate the credential from the runtime without ever touching secret bytes: on
a new 0% canary, split the auth stage into individually-classified steps and add
a **synthetic-key control** — mint one JWT in the production runtime from a
compile-time synthetic EC key and Ed25519 key. If the synthetic mint fails in
production, the fault is the runtime/bundle (fix code or compat date, secret is
innocent). If it passes, the fault is specific to the bound credential value.
Also record a coarse, allow-listed error-kind enum (constructor name from a
fixed set, message-pattern family, thrown-non-Error) for the residual `unknown`
case. Each step reports only an enum. This needs one more zero-economic
diagnostic and is not authorised by this checkpoint.

## 13. Mutations

`WORKER_UPLOADS=1` (`a6acfc75`) · `WORKER_DEPLOYMENT_MUTATIONS=1` ·
`WORKER_TRAFFIC_MUTATIONS=0` (production stayed 100%, new canary 0%) ·
`CLOUD_SECRET_MUTATIONS=0` · `REAL_PAYMENT_RETRY_COUNT=0` ·
`WEB_DIRECT_CANARY_ATTEMPTS=0` · `DIAGNOSTIC_REQUEST_COUNT=1` ·
`DIAGNOSTIC_REAL_SIGNATURE=NO` · `ONCHAIN_TRANSACTION=NO` · `USDC_TRANSFER=NO` ·
`PROVIDER_INVOCATIONS=0` · `SETTLEMENT_COMPLETED=NO` ·
`SAFE_TO_RETRY_REAL_VERIFY_PAYMENT=NO` · `WEB_DIRECT_CANARY_AUTHORIZED=NO`. Not
pushed.
