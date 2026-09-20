# FIRST-PAID-VERIFY-PAID-CONTINUATION-HOST-REDEPLOY-01 — closure

Status: **BLOCKED before any Cloudflare mutation.** All local qualification
passed. The single production step that mutates Cloudflare (immutable host
version upload) was denied by the permission classifier and was NOT retried or
worked around. No upload, no deployment, no traffic change, no secret change, no
real payment, no web-direct, no refund, no job mutation, no push. No secret, JWT
or signature appears in this report.

## 1. Starting provenance — PASS

- HEAD `9845f66a346b344fc08646ae5fe6c4e5fc7bdf07`, branch
  `metadata-vcm-qualification`, tree clean, 41 ahead / 0 behind upstream.
- Host Worker `siteborne-paid-continuation-runtime`: version
  `2833ed03-a5da-474c-86eb-aa4ea710f7d9` at 100% (deployed
  2026-09-13T04:25:34Z), source `9502db3`, compat date `2026-08-05`, flag
  `nodejs_compat`.
- Bindings (names/types only): Workflow `PAID_CONTINUATION_WORKFLOW`, D1 `DB`,
  R2 `ARTIFACTS`, five plain vars (`SELLER_WALLET_ADDRESS`,
  `PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`,
  `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
  `PRODUCTION_CDP_CREDENTIALS_APPROVED`), 11 secret names (`CDP_API_KEY_ID`,
  `CDP_API_KEY_SECRET`, six `MODAL_*` names, two `PAID_RECEIPT_SIGNING_*` names,
  `PAYMENT_CONTINUATION_ENCRYPTION_KEY`). No `CDP_WALLET_SECRET` (correct). No
  values read.
- `wrangler.paid-continuation-runtime.toml` and `workflow-host-entrypoint.ts`
  are identical at `9502db3` and HEAD: binding, var, compat-date and flag parity
  holds for every artifact.

## 2. Release source strategy

`HOST_RELEASE_SOURCE_STRATEGY=MINIMAL_REMEDIATION_LINEAGE`. HEAD is 98 commits
past the deployed host source (132 changed src/package files), most unrelated
(VCM, metadata, economics discovery, SMTP). HEAD was not chosen merely because
it builds.

## 3. Minimum remediation derivation

Dependency chain for `cdp-provider.ts` since `9502db3`:
`2a9a681 → 3a2452e → 4498eb7 → 3fc1664 → 9845f66`. Directly cherry-picking
`3fc1664` conflicts on the provider constructor. Actual closure needed:

| Commit    | Role                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| `a1f1671` | verify-audit enrichment; base for `2a9a681` in `x402-service.ts` (reached by host graph) |
| `2a9a681` | facilitator failure classifier (`cdp-facilitator-failure.ts`); base of settle subreason  |
| `3a2452e` | `cdp-jwt-failure.ts` (jwt_subreason vocabulary); provider/types context                  |
| `3fc1664` | **JWT bundle-init fix** (`cdp-auth-init.ts`, dynamic `@coinbase/cdp-sdk/auth` import)    |
| `9845f66` | **settle observability**, host bundle gate, release invariant                            |

`4498eb7` (canary-only `JWT_RUNTIME_DIAGNOSTIC_ENABLED` diagnostic) was
deliberately excluded; the `3fc1664` conflict was resolved by keeping the fix
and omitting the unused `jwtDiagnostic` constructor parameter. The live harness
change in `9845f66` (`first-paid-e2e-local.test.ts`) conflicts, is not bundled,
and was left at its `9502db3` state in the lineage; the 90 s timeout evidence is
taken from HEAD. The offline `validate-cdp-credentials.mts`, its test, its
package script and its report (from `3a2452e`) were dropped: not in the Worker
bundle, and it failed lint without a later fix.

Isolated worktree branch `host-min-remediation` (local only, not pushed):

- `d015d33` (a1f1671), `e3a1ff2` (2a9a681), `f52f170` (3a2452e), `0294ba7`
  (3fc1664), `eabac59` (9845f66), `3ed1b1e` (drop offline validator).
- **`HOST_RELEASE_SOURCE_SHA=3ed1b1e410ab17478c344befd4bd24cf2009710b`**

Runtime files changed vs `9502db3` (9 non-test): `continuation/types.ts`,
`evidence/cdp-auth-init.ts`, `cdp-facilitator-failure.ts`, `cdp-jwt-failure.ts`,
`cdp-provider.ts`, `routes/x402-service.ts`,
`workflows/paid-continuation-workflow.ts`,
`packages/protocol-x402/src/evidence/types.ts`, plus this lineage's own report
copy.

## 4. Qualification of the minimal lineage (own lockfile install)

- `pnpm typecheck` 23/23, `pnpm lint` 16/16, eslint on changed files clean,
  prettier clean, tracked-file secret scan OK (1503 files), gitleaks over
  `9502db3..HEAD` no leaks.
- Targeted suites: 7 files / 78 tests pass — host bundle gate 4, public bundle
  gate 3, settlement observability 24, verify subclassification 26, verify audit
  6, plus cdp-auth-init and release invariant.
- Full repo run (under concurrent load): 3263 passed / 7 failed / 81 skipped.
  - 5 x `scripts/reconcile-payment-attempts.contract.test.ts` and 1 x
    `nevermined-live-migration-idempotency.test.ts`: 5000 ms timeouts; both
    files pass in isolation (38/38; 6 with 1 skipped).
  - 1 x `first-paid-e2e-local.test.ts` test `AA` (grep proof "no src file
    mentions the harness"): **fails identically on pristine 9502db3**. A comment
    in `verify-agent-output-v2-cdp-composition.domain-metadata.test.ts` mentions
    the harness filename; that comment is also present at HEAD. On HEAD it
    appears to pass vacuously because the repo path contains spaces
    (`new URL().pathname` is percent-encoded, so the `grep` cwd is invalid and
    the error path yields an empty match). Inferred, not run. Unrelated to the
    Worker bundle. Pre-existing test-hygiene defect; not fixed here.

## 5. Negative control and artifact proof

| Artifact          | init_jwt() | verify               | settle                       | supported                        |
| ----------------- | ---------- | -------------------- | ---------------------------- | -------------------------------- |
| old `9502db3`     | 0 calls    | not verified, no JWT | no JWT, no facilitator fetch | `getRandomValues_not_a_function` |
| minimal `3ed1b1e` | present    | verified, JWT, fetch | JWT, fetch reached           | JWT, fetch reached               |

Old host gate: 2 of 4 fail (workerd mint; structural `init_jwt()`), for the
expected reason (build succeeds, no compile error). `OLD_HOST_BUNDLE_GATE=FAIL`,
`NEW_HOST_BUNDLE_GATE=PASS`. Probe results are under workerd with a public
synthetic Ed25519 key and a stubbed facilitator fetch; no network, no real
credential.

## 6. Minimal vs HEAD host comparison

Real host config, `wrangler deploy --dry-run`: total upload old 2989.32 KiB /
gzip 499.55, minimal 3164.10 / 537.08, HEAD 3187.46 / 542.49. Modules 708 / 774
/ 780. Build is deterministic (two minimal builds, identical digest).

- minimal minus old: 3 repo modules (`cdp-auth-init`, `cdp-facilitator-failure`,
  `cdp-jwt-failure`) + SDK `./auth` graph and ~50 axios modules (the intended
  retention).
- HEAD minus minimal: `cdp-credential-shape`, `cdp-jwt-diagnostic`,
  `cdp-jwt-diagnostic-sdk` (flag-gated diagnostic, off on the host),
  `routes/pre-economic-mode-gate`, `pricing/economic-contract`,
  `protocol-x402/openapi/paid-operations`.
- Byte-identical between minimal and HEAD: `paid-continuation-workflow.ts`
  (settlement logic), `cdp-facilitator-failure.ts`, `cdp-auth-init.ts`,
  `continuation/types.ts`, `workflow-host-entrypoint.ts`, host wrangler config.

`HEAD_ONLY_HOST_CHANGES` = diagnostic hook + economic-contract/mode-gate
modules. `MINIMAL_VS_HEAD_HOST_PARITY=FAIL` (HEAD carries extras) → minimal
lineage preferred. `HOST_RELEASE_ARTIFACT_DIGEST` (sha256 of emitted
`workflow-host-entrypoint.js`):
`c8ec8c35e1e3c6c57e855d75a88c497ade47152fe8dbce57a0b53890fbdf1263` (old
`17eaae5a…d451d1`, HEAD `122b54a1…055510`).

Compatibility risk noted: the minimal host lacks the newer
economic-contract/mode-gate modules. The 2026-09-20T16:10Z attempt already
flowed public canary → deployed `9502db3` host through execution to settle at
17000, so the envelope hand-off is compatible; not re-proven post-deploy.

## 7. Settlement observability, contract, harness

- Closed-vocabulary settle `subreason`, integer `transport_status`,
  `retryability`, and conditional `jwt_subreason`; provider/workflow/audit
  reason parity covered by `settlement-observability.test.ts` (24/24). No raw
  body, header, JWT, signature, key or stack persisted. Public 402 body
  unchanged (`PUBLIC_CONTRACT_CHANGED=NO`).
- Harness (HEAD): `90_000` ms test budget at
  `first-paid-e2e-local.test.ts:1351`; no retry in `scripts/first-paid-e2e.ts`;
  one signed submission per invocation. `LIVE_TEST_TIMEOUT_MS=90000`,
  `AUTOMATIC_RETRY=NO`. Live test not run.

## 8. Deployment capability and rollback

- `HOST_STAGED_DEPLOYMENT_SUPPORTED=YES` (immutable upload then version deploy;
  history shows `2833ed03` was uploaded via `version_upload` then promoted).
  Limitation: a 0% host version cannot be exercised meaningfully (no routes,
  `workers_dev=false`; Workflow instances are created by the public Worker), so
  the plan is upload → metadata parity check → single promotion to 100%.
- `HOST_ROLLBACK_READY=YES`, target `2833ed03-a5da-474c-86eb-aa4ea710f7d9`
  (source `9502db3`), still viewable; operation
  `wrangler versions deploy 2833ed03-a5da-474c-86eb-aa4ea710f7d9@100% --name siteborne-paid-continuation-runtime`.
  Not executed.

## 9. Pre-deployment baseline (read-only)

- Public: `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` 100%,
  `0456f44c-1c28-4919-9fdb-ab4673bac8f6` 0%.
- D1: 26 payment_attempts, 101 quotes, 2 results, 26 jobs, 1 settle attempt, 1
  successful settlement. Job states: DELIVERED 2, EXECUTING 1, LOCKED 1,
  REFUND_REQUIRED 1, REJECTED 21. The EXECUTING and LOCKED jobs are from
  2026-08-31, long expired: no in-flight paid work.
- Base: buyer USDC 79,727 atomic, buyer nonce 0; payTo 28,000 atomic.
- Host exception baseline not obtained (no read-only historical log API
  available here).

## 10. Blocked step and accounting

Attempted:
`wrangler versions upload --config wrangler.paid-continuation-runtime.toml` from
the minimal worktree. Denied by the permission classifier. No retry, no
alternate route.

`WORKER_UPLOADS=0`, `HOST_DEPLOYMENT_MUTATIONS=0`,
`PUBLIC_WORKER_TRAFFIC_MUTATIONS=0`, `CLOUD_SECRET_MUTATIONS=0`,
`HOST_ROLLBACK_EXECUTED=NO`, `REAL_PAYMENT_RETRY_COUNT=0`,
`WEB_DIRECT_CANARY_ATTEMPTS=0`. Historical failed job `af5f7e55` untouched
(`REFUND_REQUIRED`, `REFUND_ACTUALLY_OWED=NO`).

Not exercised, honestly: post-deploy synthetic verify/settle/supported JWT on
the deployed host, zero-economic settle probe, host runtime telemetry (nothing
deployed). The deployed host exposes only an inert 404 and cannot reach settle
without a real signed authorization, which is not authorized here.

## 11. Remaining blockers

1. Human authorization for the host upload and promotion (this report's plan).
2. Then post-deploy host telemetry check, then
   `FIRST-PAID-VERIFY-THIRD-REAL-PAYMENT-AUTHORIZATION-01`.
