# SUN-1222D-RESUME-CREDENTIAL-CANDIDATE-QUALIFICATION — partial: stale-price closure + full release gate + Modal proxy-auth tooling gap

Status: **BLOCKED before §13** (Modal credential creation). Repo-only work (§2–§7) is
complete and green. §8–§11 read-only external reconciliation is complete. §12
(Modal credential inventory) surfaced a genuine tooling/architecture gap that
stops this checkpoint before any credential, secret, host, or candidate
mutation, per this checkpoint's own instruction to stop and reconcile on
ambiguity rather than improvise.

No production mutation, no Modal mutation, no Cloudflare secret/host/candidate
mutation, no traffic mutation, and no payment material of any kind occurred.

## 0. Authorization

`SUN1222D_RESUME_AUTHORIZATION=PRESENT` — the standalone authorization message
immediately preceding the runbook explicitly covers repo-only stale-price
correction, read-only Modal inventory, conditional credential creation, host
secret/binding provisioning, one host deployment, one immutable candidate
upload at 0% traffic, and non-economic four-service qualification, while
excluding all payment/signing/settlement/traffic-to-candidate actions.

## 1–2. Repository readback

- `START_HEAD` (checkpoint start) = `21fbf114ffbc952903e17e8420a31146054d6ed8`
- `WORKING_TREE_CLEAN` = YES at start
- Current HEAD after this checkpoint's two repo-only commits =
  `531a9a1cc15aa7ae50a006813ef0cf6217ad2ca6`
- Working tree clean at time of writing this report.

## 3–4. Stale worker-runtime price — RED → GREEN → mutation-proof

Reproduced the inherited failure exactly first:

```
[test:worker-runtime] 98/99 scenarios passed.
[test:worker-runtime] FAILED scenarios:
  - PHASE 6 (1): verify-production unsigned request -> real 402 with canonical production price: expected=19000 actual=17000
```

`STALE_PRICE_RUNTIME_RED=YES` (exact reproduction, single failure, matches
inherited packet).

**Root cause traced to source, not narration.** `scripts/test-worker-runtime.mts`
Phase 6 hardcoded `expectedAmount: '19000'`. `19000` is
`verify_agent_output_standard`'s (the **v1** pricing key) price
(`governance/RISK_LIMITS.yaml`: `0.019`) — not
`verify_agent_output_standard_v2`'s frozen `0.017`/`17000` (c81b737,
SUN-1222C-R3). The real production composition
(`verify-agent-output-v2-cdp-composition.ts`, `pricingKey:
'verify_agent_output_standard_v2'`) was already correct; only this one test
literal drifted when SUN-1222C-R3 repriced the v2 tier down from 0.019 to
0.017.

**Fix (preferred form — no new independently-drifting literal).** Added a
module-level constant in `scripts/test-worker-runtime.mts` derived from the
same authoritative source the real composition reads:

```ts
import { resolveServiceMaxPriceUsd, usdToAtomicUnits } from '../packages/pricing/src/service-prices';
const VERIFY_AGENT_OUTPUT_V2_EXPECTED_ATOMIC = usdToAtomicUnits(
  resolveServiceMaxPriceUsd('verify_agent_output_standard_v2'),
  6
);
```

- `WORKER_RUNTIME_PRICE_SOURCE_BEFORE` = hardcoded literal `'19000'` (no
  traceable source; happened to equal the v1 key's price)
- `WORKER_RUNTIME_PRICE_SOURCE_AFTER` = `packages/pricing/src/service-prices.ts`
  → `resolveServiceMaxPriceUsd('verify_agent_output_standard_v2')` →
  `governance/RISK_LIMITS.yaml` (the single canonical source every real
  production composition already reads)
- `PRICE_DRIFT_SOURCE_REMOVED=YES`

The bare `@siteborne/pricing` package specifier does not resolve for this
bare `tsx` script (`packages/pricing/dist` is not built as part of `pnpm
test:worker-runtime`'s own invocation; confirmed empirically both ways), so
the import uses a direct relative path to the package's TS source — the same
resolution `tsx`'s tsconfig-paths support already grants other scripts in
this repo.

**GREEN**: reran full suite, `99/99` scenarios passed.
`STALE_PRICE_RUNTIME_GREEN=PASS`.

**Mutation proof**: temporarily reverted the assertion's condition back to
`actualAmount === '19000'`, reran the full suite, confirmed the exact same
scenario fails again (`98/99`, `PHASE 6 (1)` — the only failure), then
restored the fix. `STALE_PRICE_MUTATION_PROOF=PASS`.

Committed as `9fbd5ff` (fix) + `531a9a1` (Prettier line-length correction on
9fbd5ff's own new import line — confirmed via `git show 21fbf11:… | prettier
--check` that the file was Prettier-clean before 9fbd5ff, so the deviation is
attributable to this checkpoint's own edit, not pre-existing debt).

### Investigated and ruled out a broader economic-freeze concern

Before trusting the single stale literal as the *only* drift, traced whether
`web_context_verified.v2` and `document_evidence_json.v2`'s Phase 4 literals
(`'9000'`, `'190000'`) were also stale relative to real production:

- Real production (`apps/edge-api/src/index.ts`) mounts `/v2/web/context` →
  `webContextVerifiedV2CdpProductionRoute` and `/v2/document/evidence-json` →
  `documentEvidenceJsonV2CdpProductionRoute` — both real composition
  handlers.
- `web-context-v2-cdp-composition.ts` uses `pricingKey:
  'web_context_verified_direct_v2'` (0.008/8000) — correct, frozen value.
- `document-evidence-json-v2-cdp-composition.ts` uses `pricingKey:
  'document_evidence_json_max_job'` (0.19/190000, the `upto` ceiling) for the
  initial 402 — correct; the settled amount per document is tier-dependent
  (e.g. `document_evidence_json_native_v2` = 0.0098/9800, the "representative"
  figure this checkpoint's authorization cites).
- Phase 4's `'9000'`/`'190000'` literals exercise a **different**, explicitly
  non-production `evidenceMode:'fixture'` path
  (`worker-runtime-test-entrypoint.ts`'s generic `/v2/*` mount →
  `buildPaidServicesApp`), not the real per-service production compositions —
  confirmed by reading the entrypoint source directly. No real production
  economics mismatch for either service.

Secondary, non-blocking observation for a future checkpoint: the `/v2/nevermined/*`
route family's own Phase 5 test literals (`'9000'`, `'19000'` for
webctx/verify) are similarly stale relative to the current v2 freeze, but
`neverminedV2Enabled` is never set `true` anywhere in source (confirmed:
zero references outside `paid-services.ts`'s own parameter read), so this
rail is unconditionally unreachable in real production (also confirmed live:
Phase 1 shows `/v2/nevermined/*` returns `503
service_executor_not_configured` under the real entrypoint with real gates
enabled) — zero real economic exposure, out of this checkpoint's scope, not
fixed here.

## 5. Pre-mutation full release gate

Ran each gate item individually rather than the aggregate `pnpm check`
one-shot — see note below.

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS — 23/23 tasks |
| `pnpm build` | PASS — 12/12 tasks |
| `pnpm lint` | PASS — 16/16 tasks |
| `pnpm test` (full vitest) | PASS — 228 files / 2799 tests passed, 22 files / 77 tests skipped (pre-existing `live/*` opt-in tests), 0 failures |
| `pnpm x402:check` | PASS |
| `pnpm mcp:check` | PASS |
| `pnpm a2a:check` | PASS |
| `pnpm test:worker-runtime` | PASS — 99/99 (see §3–4) |
| SSRF / DNS-rebinding | PASS — covered inside `pnpm test` (`packages/provider-adapters/src/tests/http-ssrf.test.ts`, `dns-rebinding.test.ts`) |
| x402 replay/concurrency | PASS — covered inside `pnpm test` + `pnpm x402:check` (`packages/protocol-x402/src/replay/*.test.ts`, `properties.test.ts`) |
| Post-settlement / trust-class | PASS — covered inside `pnpm test` (`chaos-v2-settlement-recovery.test.ts`, `x402-service-route.test.ts`, `nevermined-provider.test.ts`, etc.) |
| `pnpm secrets:scan` | PASS — gitleaks 683 commits scanned + working-tree scan, 0 leaks |
| `pnpm production:preflight` | PASS — 13/13 required secrets present, 12/12 paid routes structurally unavailable pre-economics |
| Public API `wrangler deploy --dry-run` | PASS — 6423.07 KiB / 1054.85 KiB gzip, all expected bindings present including `env.ARTIFACTS` (already bound) |
| Workflow-host `wrangler deploy --dry-run` | PASS — 4720.34 KiB / 769.81 KiB gzip, all 4 ADR vars + DB + self-Workflow binding present, **no `ARTIFACTS` binding yet** (expected — this checkpoint's own §16 gap) |

**Note on the aggregate `pnpm check` / format gate.** `pnpm check` chains
`format:check` first with `&&`, and `format:check` currently fails across
**446 pre-existing files** repo-wide — confirmed pre-existing and unrelated
to this checkpoint: `git show 21fbf11:scripts/test-worker-runtime.mts |
prettier --check` was clean before this checkpoint touched anything, and the
446-file count is unrelated to the one file this checkpoint edited (which is
itself now Prettier-clean, see §3–4). Reformatting 446 files across the repo
is a large, unbounded, out-of-scope mutation this checkpoint's authorization
does not cover (scoped narrowly to document-credential/host-dependency/
candidate work). Per the runbook's own "format gate **if release-required**"
phrasing, and since this exact debt evidently hasn't blocked any of this
repo's many prior production releases (it predates this checkpoint by an
unknown, likely large margin), the individual named gates above were run
directly instead of the aggregate one-shot. This is a judgment call, not a
waived red gate — flagging explicitly rather than silently deciding it on
your behalf.

`WORKER_RUNTIME=99/99` (hard requirement met).

## 6. Four-service source state (reconfirmed)

`SUPPORTED_SERVICES` in `production-dependencies.ts` is still mechanically
derived from `ROUTE_CONFIG_BUILDERS`'s own keys (`new
Set(Object.keys(ROUTE_CONFIG_BUILDERS))`), landed in the prior
SUN-1222D-PRE-WORKFLOW-DISPATCH-FIX checkpoint (commit `5f87a05`). All four
services present:

- `COMPANY_V2_PRODUCTION_COMPOSITION_COMPLETE=YES`
- `WEBCTX_V2_PRODUCTION_COMPOSITION_COMPLETE=YES`
- `DOCUMENT_V2_PRODUCTION_COMPOSITION_COMPLETE=YES`
- `VERIFY_V2_PRODUCTION_COMPOSITION_COMPLETE=YES`
- `PUBLIC_API_SETTLE_CALLSITES=0` / `DEDICATED_WORKFLOW_SETTLE_CALLSITES=1` /
  `TOTAL_PRODUCTION_SETTLE_CALLSITES=1` (unchanged from SUN-1222D-PRE — not
  re-audited from scratch this checkpoint since no code touched that
  boundary).

## 7. Frozen economics from source

- `COMPANY_V2_AMOUNT_ATOMIC=31200` (`company_evidence_graph_v2: 0.0312`)
- `WEBCTX_V2_AMOUNT_ATOMIC=8000` (`web_context_verified_direct_v2: 0.008`)
- `DOCUMENT_V2_PRICING_MODEL=` tiered `upto`, ceiling `document_evidence_json_max_job: 0.19` (190000 atomic), representative native-tier settlement `document_evidence_json_native_v2: 0.0098`
- `DOCUMENT_V2_QUALIFICATION_AMOUNT_ATOMIC=9800`
- `VERIFY_V2_AMOUNT_ATOMIC=17000` (`verify_agent_output_standard_v2: 0.017`)
- `FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=66000`

All four match the runbook's expected frozen amounts exactly.
`ECONOMIC_FREEZE_MISMATCH=NO`.

## 8. Public API deployment readback

- `PRE_D_PUBLIC_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a`
- `PRE_D_PUBLIC_PRODUCTION_TRAFFIC=100%`
- `PRE_D_ACTIVE_NORMAL_TRAFFIC_VERSION_COUNT=1`
- Other non-normal-traffic (0%) versions present, unrelated to this
  checkpoint: `9080c1dd-e96f-4204-a857-fed85e6646cc` (tag
  `sun1222c1-candidate`) and `3a74686d-bad8-4fb0-b6b8-604292145d69` (tag
  `sun1222c1-remediation-candidate`) — both pre-existing, both 0%, no
  unexpected normal-traffic allocation.

## 9. Dedicated Workflow host readback

- `PRE_D_HOST_VERSION_ID=1641fac4-0cf6-4bf0-b182-33b3d1c608ec` (100% traffic,
  created 2026-09-01T15:16:59.991Z)
- Existing secrets (names only, via `wrangler secret list`): `CDP_API_KEY_ID`,
  `CDP_API_KEY_SECRET`, `MODAL_WEBCTX_ENDPOINT_URL`, `MODAL_WEBCTX_PROXY_KEY`,
  `MODAL_WEBCTX_PROXY_SECRET`, `PAID_RECEIPT_SIGNING_KEY_ID`,
  `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAYMENT_CONTINUATION_ENCRYPTION_KEY` —
  exactly 8, matching inherited state. **`CDP_WALLET_SECRET` absent** (required
  invariant holds). No `MODAL_DOCWORKER_*` secrets yet (expected gap).
- `wrangler deploy --dry-run` bindings: `PAID_CONTINUATION_WORKFLOW` (self),
  `DB`, `SELLER_WALLET_ADDRESS`, `PAYMENT_ENVIRONMENT=production`,
  `PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
  `PRODUCTION_CDP_CREDENTIALS_APPROVED=true` — all 4 ADR vars present and
  correct, no `ARTIFACTS` binding yet (expected gap, this checkpoint's own
  §16 target).

No secret values were read, printed, or logged at any point.

## 10. Artifacts R2 readback

- `ARTIFACTS_BUCKET_EXISTS=YES` — confirmed via the **public API Worker's own**
  `wrangler deploy --dry-run`, which already shows `env.ARTIFACTS
  (siteborne-artifacts)` bound (this was already true going into this
  checkpoint, per SUN-1222D-PRE's finding).
- `ARTIFACTS_BUCKET_PRIVATE=YES` per that same prior finding (not re-verified
  via the Cloudflare dashboard/API this checkpoint — no reason to doubt it;
  no second bucket created).
- The dedicated Workflow host's own `wrangler.paid-continuation-runtime.toml`
  does **not** yet declare this binding (confirmed directly above) — this is
  the real, still-open gap, not the bucket's existence.

## 11. Modal document-worker readback

- `modal app list --json` shows two deployed apps: `siteborne-webctx-safe-egress`
  and `siteborne-document-worker`, both `state: deployed`.
- `MODAL_DOCWORKER_ENDPOINT=https://siteborne--siteborne-document-worker-process-document-http.modal.run`
  — matches inherited lineage exactly.
- `MODAL_DOCWORKER_DEPLOYMENT_PRESENT=YES`
- An unauthenticated `curl` against that exact URL returned real `401` —
  consistent with `requires_proxy_auth=True` correctly gating the endpoint
  (see §12 for the formal, in-scenario proof this checkpoint stops short of).

## 12. Modal credential inventory — the blocking finding

`modal secret list` returns **empty** — but this is not the relevant
resource. Reading `services/modal-worker/src/modal_worker/modal_app.py`
directly (source, not narration):

```python
@app.function(image=image, timeout=300, max_containers=3)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, docs=False)
async def process_document_http(payload: dict[str, object]) -> JSONResponse:
```

`requires_proxy_auth=True` is Modal's own platform-level webhook gate
("Proxy Auth Tokens": a `Modal-Key`/`Modal-Secret` header pair Modal's
infrastructure checks *before* the function ever runs) — structurally
identical to `webctx_safe_egress.app.fetch`'s existing, already-working
pattern, and **entirely unrelated to `modal.Secret`/`modal secret
list`/`create`** (the function takes no `secrets=[...]` parameter at all).

The installed Modal CLI (`modal` client 1.5.5) exposes no subcommand for
inspecting, listing, or creating Proxy Auth Tokens — confirmed by reading
every top-level and `token`/`secret` subcommand (`modal --help`, `modal token
--help`, `modal secret --help`): `token` manages only the CLI's own
account-level login credential; `secret` manages only container-injected
secrets. Proxy Auth Tokens for `requires_proxy_auth=True` endpoints are a
Modal-workspace-level resource created through Modal's web dashboard, with
no CLI or documented REST path available here.

This means:

- `ACTIVE_SITEBORNE_DOCWORKER_PROXY_CREDENTIALS` cannot be determined from
  the CLI (not zero — genuinely **unknown/unreachable from this tooling**).
  It is plausible the *existing* `MODAL_WEBCTX_PROXY_KEY`/`_SECRET` pair
  (workspace-scoped, per Modal's Proxy Auth Token model) already
  authenticates against `process_document_http` too, since Proxy Auth Tokens
  are not necessarily bound to one function — this was not verified because
  doing so would require reading the existing secret's actual value, which
  no authorization here permits.
- §13's authorized credential creation ("Create exactly one dedicated Modal
  proxy credential") cannot be executed via any tool available in this
  session's toolchain (Bash/CLI only). It requires either the Modal web
  dashboard or an unresearched Modal REST API call.
- Critically, creating a Proxy Auth Token through the web dashboard displays
  the generated `Modal-Key`/`Modal-Secret` pair **once**, on screen, at
  creation time. Doing this via this session's browser-automation tool would
  require reading that value off the page (screenshot or DOM read) to relay
  it into `wrangler secret put` — which means the value would necessarily
  enter this session's own observable context. That is in real tension with
  this checkpoint's explicit "must never be printed, logged, or committed"
  constraint on credential values, even though the *chat transcript* itself
  would never show it. Rather than deciding unilaterally whether that
  crosses the line, this checkpoint stops here and surfaces the conflict.

**Stopping per this checkpoint's own instruction**: "If any credential
operation … is ambiguous, stop and reconcile read-only rather than repeating
it blindly." Nothing in §13 onward (credential creation, host secret
mutation, host deployment, candidate upload, traffic mutation, qualification
probes) was attempted.

## Zero external/economic mutation confirmation

```
MODAL_CREDENTIALS_CREATED=0
HOST_SECRET_MUTATIONS=0
HOST_DEPLOYMENTS=0
API_CANDIDATE_UPLOADS=0
API_TRAFFIC_MUTATIONS=0
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_NONCES_CREATED=0
HUMAN_PAYMENT_SIGNATURES=0
PAID_POSTS=0
FACILITATOR_SETTLEMENT_CALLS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_TRANSACTIONS=0
```

## Final packet

```
SUN1222D_RESUME_CREDENTIAL_CANDIDATE_QUALIFICATION=BLOCKED
SUN1222D_RESUME_AUTHORIZATION=PRESENT
START_HEAD=21fbf114ffbc952903e17e8420a31146054d6ed8
CANDIDATE_SOURCE_HEAD=(not reached — no candidate prepared)
STALE_PRICE_RUNTIME_RED=YES
STALE_PRICE_RUNTIME_GREEN=PASS
STALE_PRICE_MUTATION_PROOF=PASS
TYPECHECK=PASS (23/23)
BUILD=PASS (12/12)
LINT=PASS (16/16)
TEST_FILES=228 passed, 22 skipped (250)
TESTS_PASS=2799
TESTS_SKIPPED=77
WORKER_RUNTIME=99/99
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
X402_REPLAY_CONCURRENCY=PASS (within pnpm test / x402:check)
SSRF_DNS_REBINDING=PASS (within pnpm test)
SECRETS_SCAN=PASS (0 leaks, 683 commits)
PRODUCTION_PREFLIGHT=PASS
PUBLIC_API_DRY_RUN=PASS
WORKFLOW_HOST_DRY_RUN=PASS
COMPANY_V2_AMOUNT_ATOMIC=31200
WEBCTX_V2_AMOUNT_ATOMIC=8000
DOCUMENT_V2_QUALIFICATION_AMOUNT_ATOMIC=9800
VERIFY_V2_AMOUNT_ATOMIC=17000
QUALIFICATION_TOTAL_ATOMIC=66000
PRE_D_HOST_VERSION_ID=1641fac4-0cf6-4bf0-b182-33b3d1c608ec
ARTIFACTS_BUCKET_EXISTS=YES
ARTIFACTS_BUCKET_PRIVATE=YES
ACTIVE_SITEBORNE_DOCWORKER_PROXY_CREDENTIALS_BEFORE=UNKNOWN (no CLI/API path; see §12)
MODAL_CREDENTIALS_CREATED=0
MODAL_UNAUTHENTICATED_STATUS=401 (informal curl probe only; formal scenario not run)
MODAL_AUTHENTICATED_STATUS=(not attempted)
MODAL_REAL_DOCUMENT_PROCESSING=(not attempted)
HOST_SECRET_MUTATIONS=0
HOST_DEPLOYMENTS=0
POST_D_HOST_VERSION_ID=(unchanged: 1641fac4-0cf6-4bf0-b182-33b3d1c608ec)
POST_D_HOST_CONFIGURATION=(not attempted)
POST_D_HOST_RUNTIME_QUALIFICATION=(not attempted)
HOST_ROLLBACK_DEPLOYMENTS=0
LOCAL_MODAL_SECRET_STAGING_PRESENT=NO
MODAL_PRODUCTION_CREDENTIAL_ACTIVE=YES (existing webctx credential; docworker-specific status unknown per §12)
API_CANDIDATE_UPLOADS=0
FOUR_SERVICE_CANDIDATE_VERSION_ID=(none)
API_TRAFFIC_MUTATIONS=0
CANDIDATE_0_PERCENT_READBACK=(not attempted)
CANDIDATE_DISCOVERY_COHERENCE=(not attempted)
REAL_402_REQUESTS=0
PROVIDER_INVOCATIONS_FROM_UNPAID_PROBES=0
DOCUMENT_BUYER_PATH_IMPLEMENTED=(not attempted)
DOCUMENT_ARTIFACT_QUALIFICATION=(not attempted)
COMPANY_CANDIDATE_REAL_EXECUTOR=(not attempted)
WEBCTX_CANDIDATE_REAL_EXECUTOR=(not attempted)
DOCUMENT_CANDIDATE_REAL_EXECUTOR=(not attempted)
VERIFY_CANDIDATE_REAL_EXECUTOR=(not attempted)
QUALIFICATION_BUYER_BALANCE_ATOMIC=(not read this checkpoint)
FOUR_SERVICE_REAL_PAYMENT_QUALIFICATION_ELIGIBLE=NO
FUNDING_BLOCKED=NO (blocker is tooling/credential-mechanism, not funding)
PAYMENT_AUTHORIZATIONS_CREATED=0
HUMAN_PAYMENT_SIGNATURES=0
PAID_POSTS=0
FACILITATOR_SETTLEMENT_CALLS=0
ECONOMIC_TRANSACTIONS=0
CURRENT_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
CURRENT_PRODUCTION_TRAFFIC=100%
FOUR_SERVICE_CANDIDATE_TRAFFIC=(none created)
EVIDENCE_COMMIT_SHA=(this commit)
WORKING_TREE=clean
NEXT_REQUIRED_CHECKPOINT=READ_ONLY_DIAGNOSIS — specifically, human decision on
how to provision the document-worker's Modal Proxy Auth Token (dashboard
walkthrough with the human operator handling the one-time secret display
directly, e.g. via `wrangler secret put` run by the human themselves; or
confirming the existing webctx Proxy Auth Token pair is workspace-scoped and
already valid for the document endpoint, which would need no new
credential at all)
```

DO NOT SIGN. DO NOT PAY. DO NOT CANARY. DO NOT PROMOTE.
