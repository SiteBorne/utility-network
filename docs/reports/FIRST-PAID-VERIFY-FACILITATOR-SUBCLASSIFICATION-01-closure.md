# FIRST-PAID-VERIFY-FACILITATOR-SUBCLASSIFICATION-01 — closure

Status: **PASS** (mission met: the umbrella `facilitator_verify_unavailable` is
now precisely classified). Classification:
**`FACILITATOR_JWT_GENERATION_FAILED`** — the Worker fails while building the
CDP auth header, _before any HTTP request to the facilitator is made_. No real
payment, no real signature, no web-direct, no push, no credential access, no
credential/config change.

## 1. Starting state

HEAD `6c318c0e07a2eb5e7842976cebf68396ca689797`, tree clean, branch
`metadata-vcm-qualification` (0 behind / 24 ahead of upstream). Production
`369b4bf5` @100%; diagnostic `81cca759` @0%; `PAID_ROUTES_ENABLED` false on
production, true on the diagnostic. `STARTING_PROVENANCE=PASS`.

## 2. Causal map (where distinct causes collapsed)

All "no facilitator answer" outcomes ended in one `catch` in
`cdp-provider.ts:verify` → `facilitator_verify_unavailable` /
`external_unverified`.

| Stage                                        | Source                                                              | Error input                                                             | Before                         |
| -------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| JWT / auth-header mint (verify+settle+supp.) | `@coinbase/cdp-sdk` `generateJwt` via `createAuthHeaders`, pre-HTTP | plain `Error`, `UserInputValidationError`, jose error                   | unavailable                    |
| Network / DNS                                | `fetch`                                                             | `TypeError`                                                             | unavailable                    |
| Timeout (30 s default)                       | `HTTPFacilitatorClient.withRequestTimeout`                          | `FacilitatorTimeoutError`                                               | unavailable                    |
| Non-2xx, no `isValid` body (401/403/4xx/5xx) | `HTTPFacilitatorClient.verify`                                      | plain `Error("Facilitator verify failed (NNN): …")`, **no status prop** | unavailable                    |
| Non-2xx with `isValid` body                  | same                                                                | `VerifyError` (`statusCode`, `invalidReason`)                           | answered (`external_verified`) |
| 2xx bad JSON / schema                        | `parseSuccessResponse`                                              | `FacilitatorResponseError`                                              | unavailable                    |

SDK facts (source read; no credential values touched): facilitator base
`https://api.cdp.coinbase.com/platform/v2/x402`; `/verify` = base + `/verify`;
JWT `sub`=key id, `iss`=cdp, `uris`=[`POST host+path`], EC (PEM, `importPKCS8`
ES256) or Ed25519 (64-byte base64) chosen by key format, 120 s expiry; `fetch`
with a 30 s `AbortSignal.timeout`; failures surface as listed above.

## 3. Source change (commit `2a9a681`)

- `apps/edge-api/src/control-plane/evidence/cdp-facilitator-failure.ts` (new,
  pure): classifier + `FacilitatorAuthStageError`. Reads no message text except
  to extract the three digits of `Facilitator verify failed (NNN)`; returns only
  a closed vocabulary + integer status.
- `cdp-provider.ts`: verify path uses a behaviour-neutral view of the client
  whose only difference is that a `createAuthHeaders` failure is rethrown
  wrapped, so a JWT-stage failure is distinguishable from a later `fetch`
  failure. Same headers, same request, same throw. Evidence gains optional
  `subreason`, `transport_status`, `retryability` on **failure only**; success
  evidence is byte-identical; `raw_evidence_hash` inputs unchanged. Settle path
  untouched.
- `packages/protocol-x402/src/evidence/types.ts`: three optional fields on
  `ExternalVerificationEvidence`.
- `routes/x402-service.ts`: `payment_verification_failed` audit additionally
  records `verification_subreason`, `transport_status` (integer 100–599 only),
  `verification_retryability`, each through the existing safe-code filter.

Taxonomy: `facilitator_jwt_generation_failed`,
`facilitator_authentication_rejected` (401),
`facilitator_authorization_rejected` (403), `facilitator_rate_limited` (429),
`facilitator_http_4xx`, `facilitator_http_5xx`, `facilitator_timeout`,
`facilitator_network_unavailable`, `facilitator_response_invalid`,
`facilitator_verify_invalid` (facilitator answered `isValid:false`),
`facilitator_unknown_error`. Retryability: `transient`,
`operator_action_required`, `non_retryable`, `unknown`.

Unchanged (verified by diff): facilitator URL, credentials/lookup, JWT claims
and algorithm, requirement, payload, verify body, settlement, retry, amount,
asset, network, payTo, and the public response.

`PUBLIC_PAYMENT_ERROR_SEMANTICS_CHANGED=NO`; `SECRET_MATERIAL_LOGGED=NO`.

## 4. Tests

`apps/edge-api/tests/facilitator-verify-subclassification.test.ts` — full real
stack (`buildPaidServicesApp`, Miniflare D1, real CDP provider) driving the
**real** `@x402/core` `HTTPFacilitatorClient`, and for case A the **real**
`@coinbase/cdp-sdk` `createCdpFacilitatorClient` with a syntactically invalid
throwaway key; only `globalThis.fetch` is stubbed, so genuine SDK error shapes
are what gets classified. 24 tests, cases A–M (JWT throw; 401; 403; 400; 429;
500/503; DNS/connection; real SDK timeout; malformed 2xx ×2; `isValid:false` on
200 and on 400; `isValid:true`; secret audit; public-402 identity) plus a
classifier table. Result: 24/24, and the existing observability suite 6/6 (30/30
with CDP env vars unset).

Mutation test: collapsing the 401 branch and the network branch made cases **B,
G** and a unit row fail; file restored byte-exactly (SHA-256
`565704d156837b9921ca9247e3fdc359d5eb4d7539f432ee7cac1f2dcbadae13` before and
after).

Secret-safety proof (case L, 4 failure shapes): the stub receives a real-looking
`Bearer` token, yet no audit row contains the JWT, the Authorization header, the
payment signature, key id/secret, `PAYMENT-SIGNATURE`, or the injected
facilitator body text. Case M: the public 402 body is identical across all
failure classes and contains no sub-cause.

Broader: typecheck (edge-api incl. live-tests tsconfig, protocol-x402) clean;
eslint clean; prettier clean on changed files; working-tree secret scan OK (1649
files); gitleaks over the range: no leaks. `gitleaks dir` reports 5 findings,
all in git-ignored local files (`.dev.vars`, `.superpowers/sdd/**` build logs),
pre-existing and not read. Subset (edge-api tests, protocol-x402,
control-plane): 167 files / 2039 tests pass. Full repo: 3829 pass, 1 fail —
`scripts/reconcile-payment-attempts.contract.test.ts` "exact-17 apply" timed out
(5.4 s) under full parallel load; it passes 38/38 in isolation and does not
import any changed module. Not run: `test:workerd*` configs.

## 5. Canary

`8cddb16e-7f73-4875-8d50-4adc0ade5eb4`, tag
`first-paid-verify-facilitator-subclassification-01`, source `2a9a681`. Uploaded
with the same 6 `wrangler.toml` vars + 12 `--var` overrides as `81cca759`;
secrets inherited by name. Deployment: `369b4bf5`@100 + `8cddb16e`@0.

`BINDING_PARITY=PASS` — 41 bindings, names, types and non-secret values
identical to `81cca759`; runtime identical (`2026-08-05`, `nodejs_compat`).
`PAID_ADMISSION_PARITY=PASS` — `PAID_ROUTES_ENABLED`, `VERIFY_V2`,
`WEB_CONTEXT_V2` true; company, document evidence, document upload false;
`NVM_ENVIRONMENT=sandbox`.

## 6. Exact-version qualification (override header)

health/ready/agent-card/JWKS/OpenAPI/catalog 200; MCP `initialize` 200 and 6
tools (canonical host `utility.siteborne.net`, the only MCP-allowed host). Diff
vs production: only `production_enabled` / `production_ready` /
`protocol_status` for the two v2 services in catalog and OpenAPI, `/ready`
production-services flag/reason, and timestamps; JWKS identical. Admission:
verify standard **402**; web direct **402**; rendered **400 unavailable**;
independent_reproduction **400 unavailable**; company, document, upload,
Nevermined, legacy v1 **404**; production verify/web routes **404**. (An earlier
probe with a malformed verify body returned 400 schema errors; I re-ran it with
the harness's known-good body before drawing any admission conclusion.)

## 7. The one diagnostic

Harness `apps/edge-api/tests/live/facilitator-diagnostic-local.test.ts`; only
change is the version pin (commit `33b9195`). Sentinel all-zero signature,
unowned zero-balance `from`, no CDP credentials in the environment. 1 unpaid
fetch + exactly 1 submission, no retry. 2026-09-20T07:17Z.

| Field       | Value                                                               |
| ----------- | ------------------------------------------------------------------- |
| Quote       | `qte_f01c3e12aaf173926f6983ee`                                      |
| Requirement | `req_ed823af62da1ff129aaa18b4`                                      |
| Payment id  | `pay_9e94a26b8194465da9ab519229affba7`                              |
| Job         | `8e75dc40-869f-4773-935b-7b413e97f659`                              |
| CF-Ray      | `a3df0c96f89efe53-ATL`                                              |
| HTTP        | 402 `payment_verification_rejected` / `verification_not_successful` |

## 8. Durable subclass

`payment_verification_failed` audit:

```
verification_reason       = facilitator_verify_unavailable
verification_subreason    = facilitator_jwt_generation_failed
trust_class               = external_unverified
verification_provider     = cdp:facilitator
verification_retryability = operator_action_required
transport_status          = (absent: no HTTP reply)
```

Chain:
`job_created → payment_verification_requested → payment_verification_failed`,
~97 ms end to end.

## 9. Zero-effect reconciliation

D1 (SELECT-only, per-table counts) before → after: payment_attempts 20→21, jobs
20→21, x402_quotes 85→86, audit_events 191→196; job_attempts, job_artifacts,
x402_service_results (2), payment_service_link_evidence unchanged. Base mainnet
before/after: buyer USDC 79,727 / txcount 0; payTo USDC 28,000 / txcount 0;
unowned sender 0 / 0 — unchanged. No transfer, no settlement, no provider
invocation.

## 10. What this establishes, and what it does not

Established: with the credentials currently bound to the Worker, the verify path
fails at JWT / auth-header construction; the facilitator is never contacted.
Connectivity to the facilitator and its authentication/authorization are
therefore **UNKNOWN** (untested), not failed — a network problem would have
produced a different subclass.

Not established: _why_ JWT construction fails. Inside that stage the SDK can
throw for an empty key id, an empty secret, a key that is neither a PEM EC key
nor a 64-byte base64 Ed25519 key, or a signing error. The current taxonomy does
not separate these. Because the bindings check in
`resolveProductionCdpEvidenceProvider` requires both values non-empty before
this path runs, a present-but-unusable secret (format/encoding) is the leading
candidate, but this is inference, not evidence.

Not explained by drift: no runtime-config change (`compatibility_date`/flags),
the `@coinbase/cdp-sdk` lockfile entry is untouched since 2026-08-15, and the
CDP provider/composition auth path is unchanged since the 08-28 and 09-01
settled payments. This points at the credential value/state rather than code,
but pre-09-14 secret history is not observable from `wrangler versions list`.

## 11. Original-attempt reassessment

The original real attempt (request `ecb62d6b…`, quote `qte_84147da3…`, canary
`2b44db89`) ran the same code path with the same secrets and failed at the same
stage with the same umbrella reason. JWT construction precedes any HTTP and
depends only on the credential, not on the payload. **Strongly consistent with
the same JWT-stage failure**; not directly proven for that request, because its
audit predates the subreason field. It also means the real authorization was
very likely never evaluated by the facilitator — a buyer-side or payload defect
is not indicated, and none is asserted.

## 12. HUMAN_ACTION_REQUIRED

Operator (no secret values requested or to be pasted here):

1. In the CDP portal confirm the API key referenced by the Worker is active/not
   revoked, belongs to the expected project, has x402 facilitator access, and
   note any recent rotation or account restriction.
2. Confirm that the value stored as the Worker's `CDP_API_KEY_SECRET` is in the
   format the SDK accepts (PEM EC private key with real newlines, or the base64
   Ed25519 secret) and matches `CDP_API_KEY_ID` — e.g. by minting a JWT locally
   from your own secure copy, without sharing it.

## 13. Minimum proposed correction (not applied)

1. Operator re-provisions or re-validates the Worker's CDP API key secret per
   the SUN-1219B provenance procedure. No rotation was done here.
2. Optionally first narrow the JWT stage (missing vs invalid-format vs signing
   error) with one more sub-classification and one more zero-economic
   diagnostic.
3. After any credential change, repeat this same single zero-economic diagnostic
   on a 0% canary. The success signal is `facilitator_verify_invalid`
   (facilitator reached and authenticated, invalid signature) — only then
   consider a real retry.

## 14. Cloud mutations

- Worker version uploads: **1** (`8cddb16e…`).
- Deployment mutations: **1** (`369b4bf5`@100 + `8cddb16e`@0, replacing
  `369b4bf5`@100 + `81cca759`@0; `81cca759` remains uploaded but is no longer
  override-addressable).
- Production traffic mutations: **0** (`369b4bf5` 100% throughout).
- Secrets/config/D1 schema/wallet/payTo/network/asset: unchanged. D1 access
  SELECT-only plus the Worker's own rows from the diagnostic.
- Live requests: qualification probes (incl. 2 quote-creating 402s, counted in
  the baseline) + 1 diagnostic submission; 0 real signatures; 0 real payments.

Rollback: remove `8cddb16e` from the deployment (`369b4bf5`@100 alone).

## 15. Commits (local, not pushed)

`2a9a681` classifier + audit + tests; `33b9195` diagnostic version pin; plus
this report.
