# SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX — four-service durable continuation dependency closure

Repo-only. Zero deployment, zero Cloudflare/Modal/host secret mutation, zero
candidate upload, zero traffic change, zero real 402, zero payment signing,
zero paid POST, zero settlement, zero economic transaction.

Authorization: standalone, explicit, first-person message authorizing this
exact checkpoint (repo mutations only — source, tests, fixtures,
documentation/evidence, and git commits necessary to implement and prove the
bounded Workflow dependency-construction/dispatch correction; explicitly no
production deployment, candidate upload, Cloudflare/Modal/D1/R2/DNS
mutation, host secret/variable mutation, traffic change, live activation,
live price change, external registry mutation, real 402 qualification,
EIP-3009 authorization, payment signing, paid POST, facilitator settlement,
blockchain transaction, or economic activity).

## 1. Root cause (proven from current source before any edit)

`apps/edge-api/src/control-plane/workflows/production-dependencies.ts:57`
(pre-fix):

```ts
const SUPPORTED_SERVICES = new Set(['web_context_verified.v2', 'verify_agent_output.v2']);
```

`PaidContinuationWorkflow.run()` (`paid-continuation-workflow.ts:944-947`,
unchanged by this checkpoint) calls
`buildProductionPaidContinuationWorkflowDependencies(this.env,
event.payload.metadata.service)` for every real Workflow instance, and
throws `dependencies_unavailable: unsupported service: <id>` — never
resolves — whenever the service isn't in that Set. A real, fully-verified
`company_evidence_graph.v2` or `document_evidence_json.v2` paid request would
therefore pass 402/signature verification, quote binding, and durable
handoff, then fail closed at Workflow dependency construction — the
platform records the instance as errored with **zero steps executed**,
identical in shape to the real H2BF5 incident this Workflow's own doc
comments already document for a missing-credential case, except here the
cause is a hard-coded allowlist gap, not a missing secret.

Both services' production composition functions and executors already
existed (SUN-1222B-S3R) and were never reachable from this Workflow.

## 2. Pre-fix call-graph proof, all four services

| Service | Public ingress accepts | Payment reqs supported | Durable handoff supported | **Workflow deps supported** | Executor reachable from Workflow | PCC reachable | Settlement reachable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `web_context_verified.v2` | YES | YES | YES | YES | YES | YES | YES |
| `verify_agent_output.v2` | YES | YES | YES | YES | YES | YES | YES |
| `company_evidence_graph.v2` | YES | YES | YES | **NO** (pre-fix) | NO | NO | NO |
| `document_evidence_json.v2` | YES | YES | YES | **NO** (pre-fix) | NO | NO | NO |

Proven live: `production-dependencies.test.ts`'s pre-fix RED run (§7 below)
returned `reason: 'unsupported service: company_evidence_graph.v2'` /
`'unsupported service: document_evidence_json.v2'` for both — the exact
architectural blocker, not a copied constant.

## 3. Company dependency trace

- Executor factory: `buildCompanyEvidenceGraphV2ProductionExecutor`
  (`production/company-evidence-graph-v2-production-executor.ts`) — real
  `CompanyEvidenceGraphService`, real `SecSubmissionsAdapter`/
  `PublicHttpAdapter`/`FederalRegisterAdapter`, `execution_mode: 'live'`.
  Never `buildFixtureRegistry`, never a fixture/canned HTTP client.
- Required bindings: `PAID_RECEIPT_SIGNING_PRIVATE_KEY`,
  `PAID_RECEIPT_SIGNING_KEY_ID`, `SELLER_WALLET_ADDRESS`, `CDP_API_KEY_ID`,
  `CDP_API_KEY_SECRET`, `MODAL_WEBCTX_ENDPOINT_URL`,
  `MODAL_WEBCTX_PROXY_KEY`, `MODAL_WEBCTX_PROXY_SECRET` — **all already
  present** on `PaidContinuationWorkflowHostEnv` before this checkpoint (the
  service deliberately reuses `web_context_verified.v2`'s already-deployed
  safe-egress endpoint; see `company-evidence-graph-v2-cdp-composition.ts`'s
  own doc comment). Zero new host bindings required.
- `COMPANY_V2_PRODUCTION_COMPOSITION_COMPLETE=YES` (confirmed by direct
  source read, not assumed).

## 4. Document dependency trace

- Executor factory: `buildDocumentEvidenceJsonV2ProductionExecutor`
  (`production/document-evidence-json-v2-production-executor.ts`) — real
  `DocumentEvidenceJsonService`, real `ModalDocumentWorkerBridge` (injected,
  never constructed inside the executor), real R2-backed artifact store via
  `serviceRuntimeArtifactStore`, `execution_mode: 'live'`. Supports BOTH an
  internal `artifact_reference` input and the buyer-facing `upload_reference`
  capability (resolved via `D1ArtifactsRepository` + R2 `getContentByContentHash`,
  with pre-economic hash/size/media-type/expiry validation) — this is a
  genuinely implemented input mode, not a declared-but-unimplemented one, so
  this checkpoint made no buyer-upload feature claims it couldn't verify.
- Required bindings: `PAID_RECEIPT_SIGNING_PRIVATE_KEY`,
  `PAID_RECEIPT_SIGNING_KEY_ID`, `SELLER_WALLET_ADDRESS`, `CDP_API_KEY_ID`,
  `CDP_API_KEY_SECRET`, plus two **genuinely new** requirements:
  `MODAL_DOCWORKER_ENDPOINT_URL`/`MODAL_DOCWORKER_PROXY_KEY`/
  `MODAL_DOCWORKER_PROXY_SECRET` (a dedicated, undeployed Modal App,
  SUN-0400B, `blocked_external`) and an `ARTIFACTS` R2 bucket binding.
- `DOCUMENT_V2_PRODUCTION_COMPOSITION_COMPLETE=YES` (executor-side; real
  external dependency provisioning remains blocked_external — see §5).

## 5. Corrected finding: `ARTIFACTS` is no longer Cloudflare-dashboard-blocked

`document-evidence-json-v2-cdp-composition.ts`'s own doc comment (and
`env.ts`'s) states `ARTIFACTS` has been "commented out of `wrangler.toml`
since SUN-0800B checkpoint 3, pending Cloudflare dashboard R2 enablement."
**That comment is now stale.** A live `wrangler deploy --dry-run` this
checkpoint (read-only; see §11) shows the PUBLIC API Worker's `wrangler.toml`
already has, since SUN-1222C-1:

```
[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "siteborne-artifacts"
```

confirmed live in the dry-run binding table: `env.ARTIFACTS
(siteborne-artifacts)  R2 Bucket`. The real bucket exists and is bound on
the public Worker today. **This does not change this checkpoint's design**:
the DEDICATED Workflow-host script
(`wrangler.paid-continuation-runtime.toml`) still binds no `[[r2_buckets]]`
at all (confirmed by direct read and by this checkpoint's own dry-run,
§11) — a fact this checkpoint verified directly against that file, not
against the (stale) doc comment — so `PaidContinuationWorkflowHostEnv`'s
`ARTIFACTS` is still correctly modeled as absent/optional today. The
practical implication worth surfacing: closing this specific gap for the
Workflow host is now a smaller lift than the stale comment implies — adding
the same `[[r2_buckets]]` binding to
`wrangler.paid-continuation-runtime.toml` and deploying that dedicated host
(both outside this repo-only checkpoint's authorization) — not a Cloudflare
dashboard action. `MODAL_DOCWORKER_*` remains genuinely `blocked_external`
(Modal deploy never run). Flagged, not fixed — updating the stale comment
itself was left alone as out of this checkpoint's bounded scope.

## 6/7. Existing two services frozen; evidenceMode propagation protected

`EXISTING_TWO_SERVICE_BEHAVIOR_FROZEN=YES` — `web_context_verified.v2`/
`verify_agent_output.v2`'s dependency-builder closures are byte-identical to
pre-fix source (same composition-function calls, same argument objects);
the full pre-existing fail-closed-guard suite
(`production-dependencies.test.ts`) passes unmodified.

Every dependency builder calls its composition function with **no**
`explicitTestEvidenceOverride` argument — the only way any of these four
composition functions can ever resolve `evidenceMode: 'fixture'`. Each
composition function's own gate (`resolved.evidenceMode !== 'production' ->
unavailable: true`) already guarantees `evidenceMode: 'production'` is
correct-by-construction for every service by the time
`buildProductionPaidContinuationWorkflowDependencies` reaches its return
statement — proven directly (not merely asserted) by the new orchestration
test's trust-class-matrix case (§10): a settlement evidence object with
`trust_class: 'synthetic_fixture'` under this exact code path is rejected
(`status: 'settlement_rejected'`), for both new services, through the real
`canAdvanceToSettled` gate (`@siteborne/protocol-x402`).

## 8. Selected architecture

One `ROUTE_CONFIG_BUILDERS: Record<string, (env) => Promise<X402ServiceRouteConfig
| Unavailable>>` registry, keyed by service ID, each entry calling the one
already-audited production composition function for that service.
`SUPPORTED_SERVICES` is mechanically derived: `new
Set(Object.keys(ROUTE_CONFIG_BUILDERS))` — never a second, hand-maintained
list. `buildProductionPaidContinuationWorkflowDependencies` looks up
`ROUTE_CONFIG_BUILDERS[service]`; a miss is the one and only "unsupported
service" path. No switch/if-else chain, no service-name string checks
elsewhere, no settlement-logic fork.

Files changed: `apps/edge-api/src/control-plane/workflows/production-dependencies.ts`
(registry + dispatch), `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`
(`PaidContinuationWorkflowHostEnv` widened by 4 fields:
`MODAL_DOCWORKER_ENDPOINT_URL`/`_PROXY_KEY`/`_PROXY_SECRET` added to the
existing `Pick<Env, ...>`, `ARTIFACTS` added as its own optional member).

Why this design: mechanical coherence between "supported" and "has a
builder" is enforced by construction, not by a comment or a second test
someone could forget to add when the next service ships; zero new
settlement/PCC/persistence code (all of that is already service-agnostic —
confirmed by direct read of `runPaidContinuationWorkflow`, which only ever
touches `deps.executor`/`deps.evidenceMode`/`deps.settlement`, never a
service-ID branch).

## 9. Registry invariant + test

`production-dependencies.test.ts`'s `REGISTRY_COHERENCE` suite (new)
asserts: exactly 4 supported services; the exact 4 intended IDs, no more no
fewer; an unknown service has no factory; no v1 service ID is present; no
Nevermined-fallback/unreleased-provider ID is present. Backed by a
test-only exported `ReadonlySet` view (`__TEST_ONLY_SUPPORTED_SERVICES`) of
the real dispatch table — never a copied literal.

## 10. Genuine RED

Both new services' dependency-request tests were run against the REAL
pre-fix source (`git stash` of only the two implementation files, tests
left in place, `git stash pop` after):

```
COMPANY_WORKFLOW_DEPENDENCY: expected 'unsupported service: company_evidence_graph.v2' not to contain 'unsupported service'  [FAILED, as required]
DOCUMENT_WORKFLOW_DEPENDENCY: expected 'unsupported service: document_evidence_json.v2' not to contain 'unsupported service'  [FAILED, as required]
REGISTRY_COHERENCE (4 tests): __TEST_ONLY_SUPPORTED_SERVICES undefined / not iterable  [FAILED, as required]
```

`COMPANY_WORKFLOW_DEPENDENCY_RED=YES`, `DOCUMENT_WORKFLOW_DEPENDENCY_RED=YES`
— exercising the actual blocker, not a copied constant.

## 11. GREEN + full gate

After restoring the fix: `production-dependencies.test.ts` 12/12 pass;
`paid-continuation-workflow-entrypoint.test.ts` 6/6; `paid-continuation-workflow.test.ts`
(pure orchestration, unmodified) 31/31; new
`paid-continuation-workflow-production-registry-orchestration.test.ts` 6/6;
`workflow-host-entrypoint.test.ts` 5/5; `dedicated-workflow-host-config.test.ts`
11/11; all four `*-cdp-composition.test.ts` suites unmodified and green.

Repository-wide:

- `TYPECHECK`: `pnpm typecheck` (turbo, all 23 package/app tasks) — 23/23
  successful.
- `BUILD`: `pnpm build` — 12/12 successful.
- `LINT`: `pnpm lint` — 16/16 successful, zero warnings-as-errors.
- `TEST`: `pnpm test` (full repo `vitest run`) — **228 test files / 2799
  tests passed, 22 files / 77 tests skipped** (live/network-gated, expected
  — e.g. `apps/edge-api/tests/live/*`), **0 failed**.
- `PROTOCOL_MCP_CHECK`: `@siteborne/protocol-mcp` (47/47), `@siteborne/mcp-server`
  (1/1) — MCP tool mapping (`siteborne_company_evidence_graph` ->
  `company_evidence_graph.v2`, etc., `packages/protocol-mcp/src/constants.ts`)
  untouched by this checkpoint.
- `PROTOCOL_A2A_CHECK`: `@siteborne/protocol-a2a` — 46/46, untouched.
- `PROTOCOL_X402_CHECK`: `@siteborne/protocol-x402` — 34 files / 512 tests,
  untouched.
- `X402_REPLAY_CONCURRENCY`: `replay/binding.test.ts` (29),
  `replay/idempotency.test.ts` (18), `replay/repository.test.ts` (6) — all
  pass, part of the full-repo run above.
- `SSRF_DNS_REBINDING`: `provider-adapters/src/tests/http-ssrf.test.ts` (31),
  `dns-rebinding.test.ts` (21) — pass, untouched (this checkpoint never
  modifies any HTTP client/egress code).
- `WORKER_RUNTIME` / `POST_SETTLEMENT_FAIL_CLOSED`: `pnpm test:worker-runtime`
  — **98/99 scenarios passed.** The one failure (`PHASE 6 (1):
  verify-production unsigned request -> real 402 with canonical production
  price: expected=19000 actual=17000`) is a **pre-existing, unrelated**
  stale test literal: `scripts/test-worker-runtime.mts` was last touched at
  commit `36e6cae`, before `c81b737` repriced
  `verify_agent_output_standard_v2` from 0.019 (19000 atomic) to 0.017
  (17000 atomic); the script's hardcoded expectation was never updated.
  Confirmed via `git log -L` that this line predates and is unrelated to
  every file this checkpoint touched. Flagged as a follow-up task
  (`task_95372fab`), not fixed here (out of this checkpoint's bounded
  scope).
- `SECRETS_SCAN`: `pnpm secrets:scan` — scope verify OK (1336-1337 tracked
  files), gitleaks (678 commits + working tree) "no leaks found" both
  passes, working-tree scan OK. `NEW_SECRET_FINDINGS=0`.
- `PRODUCTION_PREFLIGHT`: `pnpm production:preflight` — PASS (zero mutating
  API calls; all required bindings/vars/secret names present; 12/12 paid
  routes structurally unavailable before economics; no fixture executor in
  the production bundle).
- `WRANGLER_DRY_RUN`: `wrangler deploy --dry-run` (public API Worker) — clean
  bundle, binding table as expected (including the `ARTIFACTS` R2 binding,
  §5). `wrangler deploy --dry-run --config wrangler.paid-continuation-runtime.toml`
  (dedicated Workflow host) — clean bundle; binding table confirms
  `ARTIFACTS`/`MODAL_DOCWORKER_*` are genuinely absent from this script
  today, matching this checkpoint's fail-closed design.
- `FORMAT_CHECK`: `pnpm format:check` — the two files this checkpoint
  touched/added were reformatted with `prettier --write` (whitespace-only)
  and reverified clean; the repository's ~447 pre-existing warnings in
  unrelated files are untouched and out of this checkpoint's scope.
- `PRICING_CHECK` / `GOVERNANCE_VALIDATE`: both clean (§13).

## 12. Mutation proof

Three live mutate → prove-fails → restore cycles, each verified then
reverted with `cp` from a pre-mutation backup:

1. Removed the `company_evidence_graph.v2` entry from `ROUTE_CONFIG_BUILDERS`
   → `production-dependencies.test.ts` failed 6 tests (dependency-recognition
   test + all 3 registry-coherence tests: count, exact-set, ...). Restored,
   reverified green.
2. Removed the `document_evidence_json.v2` entry → failed 7 tests
   (equivalent). Restored, reverified green.
3. Reintroduced a supported-service-without-builder mismatch
   (`SUPPORTED_SERVICES` manually widened to include a `phantom_service.v2`
   with no builder) → both registry-coherence count/exact-set tests failed
   (`expected 5 to be 4`, extra ID present). Restored, reverified green.

`WORKFLOW_DISPATCH_MUTATION_PROOF=PASS`.

## 13. Real orchestration + trust-class matrix (§18/§21)

New `paid-continuation-workflow-production-registry-orchestration.test.ts`
mocks ONLY the four leaf composition functions (controlled,
non-economic executor/`evidenceProvider.settle` doubles) and the four leaf
D1 repository classes (in-memory doubles) — everything above those two
seams (the real registry dispatch, `SUPPORTED_SERVICES`, guard ordering,
`D1JobStatePersistence`/`D1ResultReceiptPersistence` adapters, and the full
real `runPaidContinuationWorkflow` step graph) runs for real, for all four
services:

```
open-envelope -> check-authorization-expiry -> invoke-executor -> generate-pcc -> settle -> persist-result -> persist-receipt-and-finalize
```

All four reach `status: 'settled'`, with exactly one executor call and one
`settle` call each (`EXECUTOR_CALLS=1`, `SETTLE_CALLS<=1` satisfied for
every service, no duplicate result/receipt). No real network, D1, or
blockchain call anywhere in the file.

A companion trust-class case proves the negative half for both NEW
services: with `deps.evidenceMode === 'production'` (proven, not assumed —
asserted directly in the test), a settlement evidence object carrying
`trust_class: 'synthetic_fixture'` is rejected
(`result.status === 'settlement_rejected'`), never silently advanced —
`FOUR_SERVICE_TRUST_CLASS_MATRIX=PASS`, the exact defect class §7 warns
against re-introducing (the past `paid-services.ts` evidenceMode-propagation
bug) proven absent here.

## 14. Env type closure

`WORKFLOW_ENV_TYPE_CLOSURE=PASS` — `PaidContinuationWorkflowHostEnv` widened
via `Pick<Env, ...>` (3 new fields) plus one explicit optional member
(`ARTIFACTS`); every new field is dereferenced in
`production-dependencies.ts`, none is exposed to the public API Env surface
this file doesn't already narrow to, none is logged, none is persisted
(confirmed by direct read — the two new builders only ever pass these
fields into the same already-audited composition functions the public HTTP
routes already call with the same values).

## 15. Minimum-privilege host classification

| Dependency | Classification |
| --- | --- |
| `MODAL_DOCWORKER_ENDPOINT_URL`/`_PROXY_KEY`/`_PROXY_SECRET` | HOST_REQUIRED (document_evidence_json.v2 only) |
| `ARTIFACTS` (R2) | HOST_REQUIRED (document_evidence_json.v2 only) |
| `MODAL_WEBCTX_*` | SHARED (already required by web_context_verified.v2; company_evidence_graph.v2 reuses it) |
| Everything else already on the Pick | SHARED (all four services) |
| `VOYAGE_API_KEY`, `MODAL_TOKEN_ID/SECRET`, `NVM_*`, `AGENT_CARD_SIGNING_*`, `SENTRY_DSN`, `JOBS`/`EVENTS`/`CATALOG`/`AI`/`BROWSER` | PUBLIC_API_ONLY — never added to the Workflow host Pick |

`NEW_HOST_DEPENDENCIES=MODAL_DOCWORKER_ENDPOINT_URL, MODAL_DOCWORKER_PROXY_KEY,
MODAL_DOCWORKER_PROXY_SECRET, ARTIFACTS` — none provisioned live.

## 16. Single settlement owner (unchanged)

`runPaidContinuationWorkflow`'s one `deps.settlement.evidenceProvider.settle(...)`
call site (`paid-continuation-workflow.ts`, `STEP_CONFIG.SETTLE`, zero
retries) remains the only production settle call site — proven by the
pre-existing, unmodified static-source test ("is the sole production
settle() call site introduced by this Workflow") in
`paid-continuation-workflow.test.ts`, which still passes. This checkpoint
adds zero settlement call sites. `PUBLIC_API_SETTLE_CALLSITES=0`,
`DEDICATED_WORKFLOW_SETTLE_CALLSITES=1`, `TOTAL_PRODUCTION_SETTLE_CALLSITES=1`.

## 17. Economics (re-read from current source, unchanged)

| Service | pricingKey | USD | Atomic |
| --- | --- | --- | --- |
| `company_evidence_graph.v2` | `company_evidence_graph_v2` | 0.0312 | 31200 |
| `web_context_verified.v2` | `web_context_verified_direct_v2` | 0.008 | 8000 |
| `document_evidence_json.v2` (smallest valid qualification: native, 1 page) | `document_evidence_json_native_v2` | 0.0098 | 9800 |
| `verify_agent_output.v2` | `verify_agent_output_standard_v2` | 0.017 | 17000 |
| **Total** | | | **66000** |

Matches `docs/reports/SUN-1222C-R3-document-ingress-and-remaining-price-freeze.md`
§13 exactly (unchanged since that checkpoint) — confirmed against
`packages/pricing/src/service-prices.ts` and `governance/RISK_LIMITS.yaml`
directly, not from memory. `pricing:check`/`governance:validate` both clean.
This checkpoint changed zero pricing.

## 18. Future secret/binding manifest (name only, none provisioned)

- `FUTURE_DOCUMENT_HOST_SECRET_NAMES`: `MODAL_DOCWORKER_ENDPOINT_URL`,
  `MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET`
- `FUTURE_COMPANY_HOST_SECRET_NAMES`: none — reuses `MODAL_WEBCTX_*`,
  already provisioned/documented for `web_context_verified.v2`
- `FUTURE_HOST_BINDINGS`: `ARTIFACTS` (R2 bucket binding on
  `wrangler.paid-continuation-runtime.toml` — the real bucket already
  exists and is bound on the PUBLIC Worker per §5; only the dedicated
  Workflow-host script's own binding + a deploy of that script are
  outstanding, both outside this checkpoint's authorization)

No values read, printed, logged, or stored. No credential created.

## 19. Readiness

- `COMPANY_V2_WORKFLOW_READY=YES` — real executor composition exists,
  production dependency builder exists, missing `MODAL_WEBCTX_*` fails
  closed before any economic effect, real orchestration reaches
  executor/PCC/settlement/persistence seams locally, trust-class and
  unpaid-fail-closed behavior correct.
- `DOCUMENT_V2_WORKFLOW_READY=YES` under the equivalent conditions — real
  dependency construction is now reachable and correctly fails closed on
  its two still-external requirements (`MODAL_DOCWORKER_*`, `ARTIFACTS` on
  the dedicated host); orchestration/trust-class/unpaid-fail-closed proven
  the same way.
- `SUN1222D_RESUME_ELIGIBLE=YES`.

## 20. Final packet

```
SUN1222D_PRE_WORKFLOW_DISPATCH_FIX=PASS
PRE_FIX_HEAD=1f2671edc17fb5abd2fea59a3a22bdda09c538f5
POST_FIX_HEAD=5f87a05
ROOT_CAUSE_PROVEN=YES
SUPPORTED_SERVICES_BEFORE=web_context_verified.v2,verify_agent_output.v2
SUPPORTED_SERVICES_AFTER=company_evidence_graph.v2,web_context_verified.v2,document_evidence_json.v2,verify_agent_output.v2
COMPANY_V2_PRODUCTION_COMPOSITION_COMPLETE=YES
DOCUMENT_V2_PRODUCTION_COMPOSITION_COMPLETE=YES
COMPANY_WORKFLOW_DEPENDENCY_RED=YES
DOCUMENT_WORKFLOW_DEPENDENCY_RED=YES
COMPANY_WORKFLOW_DEPENDENCY_GREEN=PASS
DOCUMENT_WORKFLOW_DEPENDENCY_GREEN=PASS
WEBCTX_WORKFLOW_DEPENDENCY=PASS
VERIFY_WORKFLOW_DEPENDENCY=PASS
UNKNOWN_SERVICE_FAIL_CLOSED=PASS
WORKFLOW_ENV_TYPE_CLOSURE=PASS
COMPANY_WORKFLOW_ORCHESTRATION=PASS
WEBCTX_WORKFLOW_ORCHESTRATION=PASS
DOCUMENT_WORKFLOW_ORCHESTRATION=PASS
VERIFY_WORKFLOW_ORCHESTRATION=PASS
ALL_FOUR_UNPAID_FAIL_CLOSED=PASS
FOUR_SERVICE_TRUST_CLASS_MATRIX=PASS
POST_SETTLEMENT_FAIL_CLOSED=PASS
PUBLIC_API_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
WORKFLOW_DISPATCH_MUTATION_PROOF=PASS
MCP_FOUR_SERVICE_MAPPING=PASS
MCP_STATELESS_FIX_PRESERVED=YES
A2A_REGRESSION=PASS
JWS_REGRESSION=PASS
COMPANY_V2_AMOUNT_ATOMIC=31200
WEBCTX_V2_AMOUNT_ATOMIC=8000
DOCUMENT_V2_QUALIFICATION_AMOUNT_ATOMIC=9800
VERIFY_V2_AMOUNT_ATOMIC=17000
QUALIFICATION_TOTAL_ATOMIC=66000
FUTURE_COMPANY_HOST_SECRET_NAMES=none
FUTURE_DOCUMENT_HOST_SECRET_NAMES=MODAL_DOCWORKER_ENDPOINT_URL,MODAL_DOCWORKER_PROXY_KEY,MODAL_DOCWORKER_PROXY_SECRET
FUTURE_HOST_BINDINGS=ARTIFACTS
TYPECHECK=23/23
BUILD=12/12
LINT=16/16
TEST_FILES=228 passed, 22 skipped (250)
TESTS_PASS=2799
TESTS_SKIPPED=77
PROTOCOL_MCP_CHECK=PASS (47+1 tests)
PROTOCOL_X402_CHECK=PASS (512 tests)
PROTOCOL_A2A_CHECK=PASS (46 tests)
WORKER_RUNTIME=98/99 (1 pre-existing unrelated failure, see §11)
X402_REPLAY_CONCURRENCY=PASS (53 tests)
SSRF_DNS_REBINDING=PASS (52 tests)
SECRETS_SCAN=PASS
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS (both configs)
NEW_SECRET_FINDINGS=0
PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
MODAL_CREDENTIALS_CREATED=0
HOST_SECRET_MUTATIONS=0
HOST_DEPLOYMENTS=0
API_CANDIDATE_UPLOADS=0
REAL_402_REQUESTS=0
ECONOMIC_TRANSACTIONS=0
WORKFLOW_DEPENDENCY_FIX_COMMIT_SHA=5f87a05
EVIDENCE_COMMIT_SHA=a2f8266 (corrected self-reference; see follow-up correction commit)
WORKING_TREE=clean after evidence commit
COMPANY_V2_WORKFLOW_READY=YES
DOCUMENT_V2_WORKFLOW_READY=YES
SUN1222D_RESUME_ELIGIBLE=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1222D-RESUME-CREDENTIAL-CANDIDATE-QUALIFICATION
```
