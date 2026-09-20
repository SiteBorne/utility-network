# FIRST-PAID-VERIFY-REJECTION-OBSERVABILITY-01 — closure

Status: **PASS** (observability delivered; facilitator classified as
`FACILITATOR_UNAVAILABLE`, an umbrella class whose sub-cause is still open). No
real payment, no real signature, no web-direct, no push.

## 1. Original attempt (not retried)

| Field                    | Value                                  |
| ------------------------ | -------------------------------------- |
| Request time (UTC)       | 2026-09-20T06:24:12.979Z               |
| Request ID               | `ecb62d6b-cac1-4571-a7b7-efbd2101da42` |
| Quote                    | `qte_84147da3ba7d92f693fa6086`         |
| Requirement              | `req_e4e6d69dda3ff407070d9c07`         |
| Paid-canary version      | `2b44db89-fd95-4b6e-8449-8b7a1b4c51de` |
| HTTP                     | 402 `payment_verification_rejected`    |
| Public message           | `verification_not_successful`          |
| Retry count              | 0                                      |
| On-chain tx / USDC moved | none / none                            |

Durable chain:
`payment_required_created → payment_payload_received(valid) → job_created → payment_verification_requested → payment_verification_failed`.
Job `REJECTED`. Authority, execution, result, settlement, provider invocations:
none.

## 2. Observability gap

`x402-service.ts` audited only `verifyGate.reason`, which `canAdvanceToVerified`
collapses to `verification_not_successful` for every `verified:false` outcome.
The existing `ExternalVerificationEvidence` already carried `reason`,
`trust_class`, `verifier_identity`, but they were dropped. `cdp-provider.ts`
already distinguishes facilitator-answered (`invalidReason`,
`external_verified`) from no-answer (`facilitator_verify_unavailable`,
`external_unverified`). No second result model was invented.

## 3. Source change (runtime, commit `a1f1671`)

`apps/edge-api/src/control-plane/routes/x402-service.ts` (+26 lines): the
`payment_verification_failed` audit now also records `verification_reason`,
`trust_class`, `verification_provider`, each admitted only if it matches
`^[A-Za-z0-9_.:-]{1,160}$`. Existing `reason` field and the public 402 body are
unchanged. No payload, signature, payer, credentials, or free-form facilitator
text is persisted. No payment logic touched (signature semantics, quote
matching, amount/network/asset/payTo, EIP-712, facilitator URL/credentials,
settlement, replay, codec, pricing all unchanged).

Commit order (kept semantically separate):

1. `1357742` — non-runtime buyer-harness update (pre-existing modification,
   preserved; SHA-256 before commit
   `18b0a2c224b54019d5a9124f8c44002befd88e7555c49f66bd14f1a8423348ed`;
   `scripts/first-paid-e2e.ts`
   `3eff1e47095fb1c61c463152fcac825b340bfee6525383b64283135fcea4dc05`,
   unchanged).
2. `a1f1671` — runtime observability change + tests.
3. `6b85be9`, `0ddd352` — non-runtime zero-economic diagnostic harness.

Starting HEAD `4aef887dfc366d4cb4ca02b65d43c1ae6d85de54`; final HEAD
`0ddd3529902aa7f3d1c84a07c20a8b88ef8b2ac2` (plus this report commit).

## 4. Tests

`apps/edge-api/tests/payment-verification-observability.test.ts` — full real
stack (`buildPaidServicesApp`, Miniflare D1, real CDP provider), injected
facilitator double: (1) `isValid:false` reason persisted; (2) thrown error →
`facilitator_verify_unavailable`/`external_unverified`; (2b) HTTP 401 without
machine code → unavailable; (3) success → no failed audit; (4) no signature
header/marker, credentials, or free-form text in any audit row; (5) public 402
unchanged and does not leak the precise reason. 6/6 pass; cases 1, 2, 2b fail
against the unfixed source. Related suites (cdp-provider, production-cdp\*,
production-payment\*, paid-routes-mounting, nevermined route, protocol-x402):
634 passed, 14 skipped, 0 failed. Typecheck (incl. live-test tsconfig) clean;
eslint clean; prettier clean; working-tree secret scan and gitleaks: no leaks.

## 5. Diagnostic canary

`81cca759-9fc8-4470-a896-9a93873dfff8`, tag
`first-paid-verify-rejection-observability-01`. Runtime = candidate source
`eccc684…` plus only the audit change (source diff eccc684→HEAD in runtime paths
is exactly that 26-line change; the rest is tests, static-site paths and a
script). Bindings (41) and runtime settings identical to `2b44db89`; secrets
inherited (names only compared, values never read). Var set = 6 from
`wrangler.toml` + 12 `--var` overrides identical to the paid canary.

### Exact-version qualification (all 16 rays attributed to `81cca759` via tail)

- health/ready/catalog/Agent Card/JWKS/OpenAPI/MCP all 200. Differences vs
  ordinary production are exactly: timestamps, re-signed card, and
  `production_enabled`/`protocol_status`/`ready` truth for the two v2 services
  (web direct, verify) plus MCP descriptions for those two tools
  (`disabled and rejects execution` → `enabled`). JWKS identical. MCP: same six
  tools.
- 402 challenges: web-direct 8000, verify-standard 17000; both `eip155:8453`,
  USDC `0x833589fC…2913`, payTo `0x7f44a2dd…E6E1`, `exact`, EIP-712
  `USD Coin`/`2`.
- Admission: rendered 400 unavailable; independent_reproduction 400 unavailable;
  company v2, document v2, document upload, legacy v1
  web/verify/company/document all 404. Nevermined stays
  `NVM_ENVIRONMENT=sandbox`, no Nevermined production route; binding parity with
  the paid canary.

## 6. The one zero-economic diagnostic

Harness: `apps/edge-api/tests/live/facilitator-diagnostic-local.test.ts`, opt-in
`RUN_FACILITATOR_DIAGNOSTIC=1`, CDP credential vars explicitly unset, none read.
Payload: real EIP-3009 wire shape via the repo's own codec; `accepted` bound to
a fresh challenge; inner signature = 65 zero bytes; `from` = random unowned
address `0xb4e4…06f9a4` (verified on Base: 0 USDC, 0 txs, no code); no reference
to the controlled buyer. The conventional `0x…dEaD` address was rejected during
authoring because it holds ~25.9k USDC. A pre-send gate refuses any payload with
a non-sentinel signature or non-approved `from`. Mocked proof (before live):
payload reaches facilitator `verify` exactly once, `settle` never; strict
challenge expectations fail closed with nothing sent.

Live result (1 submission, no retry):

| Field                         | Value                                                               |
| ----------------------------- | ------------------------------------------------------------------- |
| Time (UTC)                    | 2026-09-20T06:54:22Z                                                |
| Quote                         | `qte_2a9cd669340250138a867c65`                                      |
| Requirement                   | `req_e83f95f85fc127285abd0eac`                                      |
| Payment identifier            | `pay_fe97511de54443a3ba69592a841f1135`                              |
| Request ID (job)              | `0500e2e0-c1c4-43fc-8c52-0a465b3472a4`                              |
| CF-Ray                        | `a3deeb1c2c0b0bec-ATL` (script version `81cca759`)                  |
| HTTP                          | 402 `payment_verification_rejected` / `verification_not_successful` |
| Audit `verification_reason`   | **`facilitator_verify_unavailable`**                                |
| Audit `trust_class`           | **`external_unverified`**                                           |
| Audit `verification_provider` | `cdp:facilitator`                                                   |
| Job state                     | `REJECTED`; attempt `verification_failed`, settle attempts 0        |

Worker outcome `ok`, no exceptions/logs (the provider swallows the error by
design).

## 7. Zero-effect proof

D1 delta vs pre-diagnostic baseline: payment_attempts +1, jobs +1, x402_quotes
+1, audit_events +5; job_attempts, job_artifacts, x402_service_results,
payment_service_link_evidence, reconciliations, owner intents,
provider_rate_window: 0. Base mainnet before/after: buyer USDC 79,727
(unchanged), buyer txcount 0, payTo USDC 28,000 (unchanged), payTo txcount 0. No
transfer, no AuthorizationUsed, no settlement, no provider invocation.

## 8. Classification

`FACILITATOR_UNAVAILABLE` — the Worker received no facilitator evaluation of a
structurally valid, requirement-bound payload. `FACILITATOR_CONNECTIVITY=FAIL`
(no answer obtained); `FACILITATOR_AUTHENTICATION=UNKNOWN`.

What "unavailable" covers (from `@coinbase/cdp-sdk` 1.55.0 / `@x402/core` 2.21.0
source): JWT generation failure (it mints verify, settle and supported JWTs on
every call before any HTTP), network/timeout, and any non-2xx reply lacking a
verify body (e.g. 401/403 auth, 400/429/5xx) — all become a plain `Error` that
`cdp-provider.ts` maps to `facilitator_verify_unavailable`. The audit therefore
cannot separate auth/credential/config faults from outage. The remaining
sub-cause is not established by this checkpoint and is not claimed.

## 9. Reassessment of the original attempt (not retried)

The original failure is now **strongly attributable to the same class**: same
`verification_not_successful` public reason, same stage, near-identical
verify-step timing (~177 ms vs ~185 ms between job creation and the post-verify
audit; D1 writes dominate that window), and a deterministic repeat with a
different, unspendable payload. That makes a payload-specific policy rejection
of the real authorization unlikely, because a payload-independent no-answer
reproduced with a payload that would have been rejected on signature anyway. The
historical exact reason remains unrecoverable and is not asserted.

It is a regression: production D1 records real Worker CDP payments that
completed verify and settle on 2026-08-28 (`settled`) and 2026-09-01
(`settled_external`). Since then the Worker/facilitator condition changed.
Candidates not yet separable: CDP API key state/permissions/rotation,
`generateJwt` behaviour in the Worker runtime, CDP-side outage/policy, Worker
config drift. `wrangler versions list` exposes only the 10 latest versions (from
2026-09-14), so pre-09-14 secret changes cannot be ruled in or out from here.

## 10. Cloud mutations

- Worker version uploads: **1** (`81cca759…`).
- Deployment mutations: **1** (`369b4bf5`@100 + `81cca759`@0, replacing
  `369b4bf5`@100 + `2b44db89`@0). `2b44db89` stays uploaded but is no longer a
  deployment member (max two), so it is not override-addressable.
- Production traffic mutations: **0** (`369b4bf5` 100% throughout).
- Secrets/config/D1 schema/wallet/payTo/network/asset: unchanged. D1 access was
  SELECT-only, plus the Worker's own rows from the diagnostic.
- Live requests: 16 qualification probes, 2 qualification 402 quotes, 1
  diagnostic submission; 0 real signatures; 0 real payments.

## 11. Rollback

Target: deployment `3083307e-2ad4-440a-bd72-0ed7911042e2` (`369b4bf5`@100 +
`2b44db89`@0), or simply remove the diagnostic from the deployment
(`369b4bf5`@100 alone). Ordinary production was never changed.
`PAID_ROUTES_ENABLED=true` exists only on 0%-traffic `81cca759`.

## 12. Recommendation

Do **not** retry the real verify payment
(`SAFE_TO_RETRY_REAL_VERIFY_PAYMENT=NO`): the Worker currently cannot obtain a
facilitator answer, so a retry would be rejected again. Next:
`FIRST-PAID-VERIFY-FACILITATOR-SUBCLASSIFICATION-01` — add safe sub-reason codes
at the provider catch (auth-header generation failure vs network/timeout vs
facilitator HTTP status code only, no bodies), build a new 0% canary, and repeat
one zero-economic diagnostic. In parallel the account owner should check in the
CDP portal that the API key used by the Worker is active, not rotated, and
entitled for the x402 facilitator (no secret values needed in the repo).
