# FIRST-PAID-VERIFY-SETTLEMENT-OBSERVABILITY-01 — closure

Status: **PASS (source and gate work complete; no production host deployment
performed).** No real payment, no signature, no web-direct, no refund, no job
mutation, no secret change, no Worker upload or deployment, no traffic change,
no push. No secret, JWT or signature appears in this report.

## 1. Provenance

HEAD `6313f10e754bc0d5619097d98a62b4dcda404a45`, branch
`metadata-vcm-qualification` (0 behind / 40 ahead). Starting tree: only the
harness pin (`first-paid-e2e-local.test.ts`) modified. All work below is
uncommitted-then-committed locally; not pushed.

## 2. Why the deployed host fails (established)

The `/settle` step runs in a separate Workflow-host Worker,
`siteborne-paid-continuation-runtime`, live as version
`2833ed03-a5da-474c-86eb-aa4ea710f7d9` at 100% (created 2026-09-13), built from
source `9502db3`. `9502db3` contains regression `8cc7222` and predates JWT-init
fix `3fc1664`. A public-canary version override cannot reach this Worker.

Reproduction (local workerd, emitted host bundle, public synthetic Ed25519
fixture, stubbed fetch):

| Host source          | `init_jwt()` calls | verify                           | settle                       | supported                        |
| -------------------- | ------------------ | -------------------------------- | ---------------------------- | -------------------------------- |
| `9502db3` (deployed) | 0                  | `facilitator_verify_unavailable` | no JWT, no facilitator fetch | `getRandomValues_not_a_function` |
| `3fc1664` (fix)      | 3                  | verified                         | JWT minted, fetch reached    | JWT minted, fetch reached        |
| current HEAD         | 3                  | verified                         | JWT minted, fetch reached    | JWT minted, fetch reached        |

Limitation: source-level attribution with today's toolchain, not the
byte-identical deployed artifact; the exact live `/settle` reason for the
2026-09-20T16:10Z attempt was never recorded and remains not recoverable. The
evidence is strong, not direct.

## 3. Changes

1. **Settle subclassification** (`cdp-facilitator-failure.ts`,
   `cdp-provider.ts`, `packages/protocol-x402/.../types.ts`): the settle auth
   stage is tagged, and a failed settle now yields a closed-vocabulary
   `subreason`, integer `transport_status`, `retryability` and `jwt_subreason`
   (`settle_jwt_generation_failed`, `settle_authentication_rejected`,
   `settle_authorization_rejected`, `settle_rate_limited`,
   `settle_http_4xx/5xx`, `settle_payment_invalid`, `settle_nonce_replay`,
   `settle_network_unavailable`, `settle_timeout`, `settle_response_invalid`).
   Never a message, header, body or JWT. Excluded from `raw_evidence_hash`.
2. **Durable persistence** (`paid-continuation-workflow.ts`,
   `continuation/types.ts`): the workflow re-normalizes the fields (short
   lowercase token / plain HTTP status only) and appends them to the job-event
   `error_detail`. The public `402 settlement_rejected` body still carries only
   the gate enum.
3. **Bundle gate extended to the host** (`cdp-jwt-host-bundle-init.test.ts`,
   shared `cdp-jwt-probe-core.ts`, host and public probe entries): the host
   config is built with `--config wrangler.paid-continuation-runtime.toml` and
   run under workerd.
4. **Release invariant** (`payment-worker-release-invariant.test.ts`,
   `payment-worker-gates.ts`): every Worker config whose entry graph reaches the
   CDP provider/SDK must have a gate, or be in an explicit, verified
   never-deployed exemption (`siteborne-worker-runtime-test`, whose config says
   NEVER deployed and which no deploy command references).
5. **Live harness timeout**: the live test had no per-test budget, so vitest's
   5000 ms default aborted the first real attempt at client level while the
   server was still settling. Now 90 s. No retry added; still one signed
   submission per invocation.

## 4. Proof

- New tests: `settlement-observability.test.ts` 24/24; host gate 4; release
  invariant 6; public gate 3. Harness unit tests 33 passed, live test skipped.
- Host gate run against the historical `9502db3` tree: **fails** (2/4) — mint
  fails and the structural `init_jwt()` check fails. Against current source:
  passes.
- Mutation checks (each applied, observed failing, restored): host gate removed
  from registry → invariant fails (2); workflow drops diagnostics → 2 fail;
  settle auth stage untagged → 2 fail; provider omits settle classification → 14
  fail. (A first attempt at mutations 2 and 3 silently did not apply because of
  BSD `sed`; they were redone with Python and are the results above.)
- Full repo vitest: 314 files passed / 1 failed; 3928 tests passed / 1 failed.
  The single failure, `scripts/reconcile-payment-attempts.contract.test.ts`,
  timed out at 5000 ms under full-suite load; it passes alone (38/38), with and
  without these changes.
- `pnpm typecheck` (edge-api, protocol-x402) clean; eslint clean; prettier clean
  on changed files.
- Secret scan: repository working-tree scan OK (1675 files). A broader
  `gitleaks dir` reported 5 findings, all in gitignored, untracked local
  artifacts (`.dev.vars`, `.superpowers/sdd/...`); none in tracked files.
- `vitest.workerd.config.ts`: 6 tests pass; `input-schema-validation` and
  `service-binding-timeout` fail to load inside ajv, neither imports anything
  changed here (pre-existing limitation).

## 5. Host bundle review (production config, dry-run only)

| Source    | bytes     | gzip    | modules | `init_jwt()` calls | dynamic `./auth` imports |
| --------- | --------- | ------- | ------- | ------------------ | ------------------------ |
| `9502db3` | 3,115,846 | 511,760 | 697     | 0                  | 0                        |
| `3fc1664` | 3,319,057 | 554,832 | 769     | 3                  | 2                        |
| current   | 3,263,932 | 554,427 | 769     | 3                  | 2                        |

Delta versus deployed: +72 modules, 0 removed. 63 are the expected CDP auth
graph (53 axios, 10 SDK); the other 9 are JWT-diagnostic/classifier files plus
three unrelated but already-shipped PRODUCTION-ECONOMICS-DISCOVERY-01 modules
(mode gate, economic contract, paid-operations). Host has accumulated 97 commits
since `9502db3`; the redeploy therefore ships more than the JWT fix and needs
its own qualification.

## 6. Semantics established

- `REFUND_REQUIRED` here means a settle did not succeed after execution; it is
  **not** evidence funds were captured (zero transfers, zero
  `AuthorizationUsed`).
- No result row is persisted unless settlement succeeds (test Q).
- The client timeout did not cause the settlement failure (server rejected at
  ~147 ms after execution completed).

## 7. Host redeploy plan (NOT executed; needs human authorization)

1. Commit and qualify this change set (done locally).
2. Record rollback target: `2833ed03-a5da-474c-86eb-aa4ea710f7d9`
   (`wrangler rollback <id> --name siteborne-paid-continuation-runtime`).
3. Upload the host from the qualified commit, with the host config only. Note
   `wrangler deploy` deletes vars not in the config unless `--keep-vars`;
   secrets are retained. Compare binding parity (19 bindings incl.
   `CDP_API_KEY_ID/SECRET`, `PAYMENT_CONTINUATION_ENCRYPTION_KEY`,
   receipt-signing keys, Modal secrets, D1, R2, workflow) against `2833ed03`
   before any traffic.
4. Zero-economic probe of the new host, then a fresh real-payment authorization
   from the operator. Sequencing question for the operator: Workflow instances
   already in flight are bound to a version.

## 8. Reconciliation block

```
SETTLEMENT_OBSERVABILITY_01=PASS
SOURCE_HEAD_AT_START=6313f10e754bc0d5619097d98a62b4dcda404a45
DEPLOYED_HOST_VERSION=2833ed03-a5da-474c-86eb-aa4ea710f7d9
DEPLOYED_HOST_SOURCE=9502db3  FIX_3fc1664_PRESENT=NO  REGRESSION_8cc7222_PRESENT=YES
HOST_BUNDLE_GATE_ADDED=YES  HOST_GATE_FAILS_ON_STALE_SOURCE=YES  HOST_GATE_PASSES_ON_CURRENT=YES
RELEASE_INVARIANT_ADDED=YES
SETTLE_SUBREASON_PERSISTED=YES  PUBLIC_402_SEMANTICS_CHANGED=NO  SECRET_MATERIAL_LOGGED=NO
LIVE_TEST_TIMEOUT_FIXED=YES  AUTOMATIC_RETRY_ADDED=NO
ROOT_CAUSE_OF_2026-09-20T16:10Z_SETTLE_FAILURE=strongly_indicated_not_directly_observed
ONCHAIN_TRANSACTION=NO  USDC_TRANSFER=NO  PROVIDER_INVOCATIONS=0  SETTLEMENT_COMPLETED=NO
REAL_PAYMENT_RETRY_COUNT=0  WEB_DIRECT_CANARY_ATTEMPTS=0
WORKER_UPLOADS=0  WORKER_DEPLOYMENT_MUTATIONS=0  WORKER_TRAFFIC_MUTATIONS=0  CLOUD_SECRET_MUTATIONS=0
HOST_REDEPLOY_REQUIRED=YES  HOST_REDEPLOY_AUTHORIZED=NO
SAFE_TO_RETRY_REAL_VERIFY_PAYMENT=NO
WEB_DIRECT_CANARY_AUTHORIZED=NO
NEXT_RECOMMENDED_CHECKPOINT=FIRST-PAID-VERIFY-PAID-CONTINUATION-HOST-REDEPLOY-01
```
