# METADATA-VCM-IMPL-04B — Immutable 0%-Traffic Candidate Qualification

Status: **BLOCKED** (before any production mutation)

Parent checkpoints:
- `METADATA-VCM-IMPL-04A` implementation: `eab1f41`
- `METADATA-VCM-IMPL-04A` evidence: `36e82f5`
- `METADATA-VCM-IMPL-03B` implementation: `623cb10`
- `METADATA-VCM-IMPL-03B` evidence: `55e2570`

Design authority (unchanged, not re-litigated in this checkpoint):
- `docs/reports/METADATA-VCM-06-a2a-mcp-canary-integration-design.md`
- `docs/reports/METADATA-VCM-IMPL-03B-a2a-mcp-shadow-parity.md`
- `docs/reports/METADATA-VCM-IMPL-04A-dual-render-compare-only.md`

This checkpoint is a **deployment qualification checkpoint, not an implementation checkpoint**. No source files were changed. No Cloudflare production mutation was performed. The checkpoint reached the human-operated mutation boundary for Mutation 1 (candidate version creation) and stopped there, because a hard prerequisite gate (`ZERO_PERCENT_CANDIDATE_CRON_SAFETY_PROVEN`) could not be established from authoritative evidence.

## I. Source-tree state at start

```
git status --short   => (empty; clean)
HEAD                 => 36e82f508b2918c196c7564530bea2388e2348d2
```

`HEAD` is exactly `VCM_IMPL_04A_EVIDENCE_COMMIT` (`36e82f5`). There are zero intervening commits between the approved 04A evidence commit and the start of this checkpoint, so there is nothing to classify as `RUNTIME_AFFECTING` / `DOCS_ONLY` / `TEST_ONLY` / `UNRELATED` — the set is empty.

```
SOURCE_TREE_CLEAN_AT_START = YES
```

## II. Source-control provenance

```
git merge-base --is-ancestor 623cb10 HEAD  => ancestor (PASS)
git merge-base --is-ancestor 55e2570 HEAD  => ancestor (PASS)
git merge-base --is-ancestor eab1f41 HEAD  => ancestor (PASS)
git merge-base --is-ancestor 36e82f5 HEAD  => ancestor (PASS, HEAD itself)

LOCAL_SOURCE_PROVENANCE = PASS
```

Remote check:

```
git remote -v            => origin  https://github.com/SiteBorne/utility-network.git
current branch           => smtp-diagnostic-starttls-observability
upstream                 => none configured
git branch -r --contains 36e82f5  => (empty — no remote branch contains this commit)

REMOTE_SOURCE_PROVENANCE = NOT_SYNCED
```

**Flagged, not silently treated as fine, per instruction:** the entire VCM effort (Authority Map through 04A) exists only on a local branch named `smtp-diagnostic-starttls-observability` — a name from an unrelated, apparently earlier body of work (SMTP/STARTTLS diagnostics) — and that branch has never been pushed to `origin`. No repository governance file (`governance/*.yaml`, `docs/decisions/*.md`) was found that states an explicit remote-parity precondition for a 0%-traffic candidate deployment, and there is no CI/CD deploy workflow in `.github/workflows` — deployment in this repository is entirely human-operated via local Wrangler, consistent with the human-operated mutation boundary this checkpoint already imposes. In the absence of a written rule either way, this report surfaces the fact plainly rather than deciding it: **if the local machine were lost today, the exact source of any Worker version built from this branch would not be recoverable from GitHub.** This is independent of, and does not by itself cause, the BLOCKED result below — but it is a real, unresolved provenance gap the human operator should weigh before authorizing Mutation 1 in a future checkpoint (e.g., by pushing the branch, or opening a PR, before candidate creation).

## III. Source qualification baseline (re-run, not reused from memory)

All gates were re-run fresh in this checkpoint against the clean `36e82f5` tree.

| Gate | Result |
|---|---|
| `@siteborne/vcm` tests | **135/135 PASS** (16 files) |
| `a2a:check` (protocol + edge route + fixtures + property) | **67/67 PASS** |
| `mcp:check` (protocol + edge route + stdio + property) | **164/164 PASS** |
| `x402:check` (incl. Bazaar round-trip/catalog/property + spec-baseline) | **532/532 PASS** |
| edge-api full suite | **1550/1550 PASS**, 72 skipped, 1 file with 1 assertion re-run in isolation (below) |
| repo `typecheck` | **25/25 tasks PASS** (turbo) |
| `lint` | **17/17 tasks PASS** |
| `secrets:scan` (gitleaks) | **PASS** — 0 leaks, 1582 files scanned |
| `openapi:generate:check` | **PASS** — 3/3 files, zero drift |
| `pricing:check` | **PASS** — embedded pricing matches `governance/RISK_LIMITS.yaml` exactly (15 keys) |
| `pricing:registry:check` | **PASS** — runtime registry prices match governed pricing, 8/8 services |
| `governance:validate` | **PASS** — 77/77 |
| `schemas:check` | **PASS** — generated validators up to date |
| `contracts:baseline:verify` | **PASS** |
| `contracts:release:verify` | **PASS** |
| `state:validate` | **PASS** — 30/30 |
| `tasks:validate` | **PASS** — 252/252 |

**One flaky, unrelated failure and its resolution:** `apps/edge-api/tests/load-v2.test.ts` failed once under full-suite host contention (`STEADY_CONCURRENCY`: measured p95 `19507.939ms` vs. fixed ceiling `19500ms`, a 0.04% overshoot). This test exercises SUN-1000 load/capacity gating for the v2 paid-route family and has no relationship to VCM, metadata projection, or anything touched by 03B/04A/04B. Re-run in isolation (no contention from the parallel full-suite run): **7/7 PASS**, p95 `12257.0ms`, comfortably under ceiling. Treated as a pre-existing, host-load-dependent flake, consistent with the precedent already recorded in `METADATA-VCM-IMPL-03B` (10 pre-existing D1-timeout flakes, 38/38 confirmed in isolation).

```
SOURCE_QUALIFICATION = PASS
```

**Shadow digest reproduction (Section VI requirement):** `packages/vcm/src/projections/digests.test.ts` and the `a2a-shadow.test.ts` / `mcp-shadow.test.ts` real-data-parity tests do not compare against a hardcoded historical hex constant — by design (see `METADATA-VCM-IMPL-03B` §XX), they compute `computeProjectionDigest()` fresh, in the same test run, over both (a) the real production builder's live output (`buildUnsignedSiteborneAgentCard`, `createSiteborneMcpHonoApp` → `tools/list`) and (b) the VCM shadow projection's output, and assert equality. This property was re-verified as part of the 135/135 VCM pass above (`projections/digests.test.ts`: 4/4, `projections/a2a-shadow.test.ts`: 12/12, `projections/mcp-shadow.test.ts`: 12/12, including the explicit "reproduces the real six-tool tools/list output with zero unexplained differences" case). Reading a stale literal digest string out of the 03B report would have been reading it from prose rather than proving it live; re-running the tests is the actual proof and was performed.

## IV. Live production baseline (read-only, zero mutation)

Captured via `pnpm exec wrangler --profile storage-alert-bootstrap ...` and unauthenticated `curl` against the public origin. No secret value was requested, displayed, or copied — only secret *names*, which Wrangler itself displays without a value.

```
WRANGLER_VERSION            = 4.119.0
CLOUDFLARE_ACCOUNT          = Hello@siteborne.com's Account (29a264a25ccfd13882defe49ed3e17b1)

CURRENT_DEPLOYMENT_ID       = 6f2fbbb4-f599-44b6-bab4-bcd3204c90f4
CURRENT_ACTIVE_WORKER_VERSION_ID = 38cbf4dd-52fd-4afc-ad34-626a2e6454d3
CURRENT_TRAFFIC_PERCENT     = 100%
CURRENT_VERSION_MESSAGE     = "SUN-1222C: activate final cleaned production baseline, 16-var parity (b96373c)"
CURRENT_VERSION_CREATED     = 2026-09-15T04:31:53.251Z
DEPLOYMENT_CREATED          = 2026-09-15T04:33:16.430Z
HANDLERS                    = fetch, scheduled
COMPATIBILITY_DATE          = 2026-08-05
COMPATIBILITY_FLAGS         = nodejs_compat
```

Bindings (names/types only):
`PAID_CONTINUATION_WORKFLOW` (Workflow), `CATALOG` (KV), `EVENTS` / `JOBS` (Queues), `DB` (D1), `ARTIFACTS` (R2), `STORAGE_ALERT_RECEIVER` (Service Binding), `BROWSER`, `AI`.

Plaintext var names and *values that are not secret* (economic/route-control state):
```
PAID_ROUTES_ENABLED                              = "false"
PRODUCTION_ENABLED                               = "true"
PRODUCTION_CDP_CREDENTIALS_APPROVED              = "true"
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP            = "true"
PAYMENT_ENVIRONMENT                              = "production"
VERIFY_V2_CDP_ROUTE_ENABLED                      = "true"
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED                 = "true"
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED      = "false"
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED      = "false"
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED           = "false"
ENVIRONMENT                                      = "production"
LOG_LEVEL                                        = "info"
NVM_ENVIRONMENT                                  = "sandbox"
PCC_VERSION                                      = "1.0.0"
AGENT_CARD_SIGNING_KEY_ID                        = "siteborne-agent-card-2026-08"
SELLER_WALLET_ADDRESS                            = "0x7f44a2dd237938F18632d4CcA40f4c69029..." (truncated by Wrangler's own display; public address, not a secret, not reproduced further here)
```

**Neither `A2A_METADATA_PROJECTION_MODE` nor `MCP_METADATA_PROJECTION_MODE` is present on the current active version** — confirming both surfaces are today, as designed, on the implicit `legacy` default with no explicit var required.

Secret *names* present (values never inspected): `AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `MODAL_DOCWORKER_ENDPOINT_URL`, `MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET`, `MODAL_WEBCTX_ENDPOINT_URL`, `MODAL_WEBCTX_PROXY_KEY`, `MODAL_WEBCTX_PROXY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAYMENT_CONTINUATION_ENCRYPTION_KEY`, `STORAGE_ALERT_PATH_TOKEN`.

Public production baseline (unauthenticated GET, status code only):

```
GET https://utility.siteborne.net/health                          => 200
GET https://utility.siteborne.net/ready                           => 200
GET https://utility.siteborne.net/.well-known/mcp-registry-auth   => 200
GET https://utility.siteborne.net/.well-known/agent-card.json     => 200
```

Endpoint paths above were read directly from `apps/edge-api/src/index.ts` route registration (`app.get('/.well-known/agent-card.json', a2aRoute)`, `app.all('/mcp', mcpRoute)`, `app.route('/.well-known/mcp-registry-auth', mcpRegistryAuthRoute)`), not invented.

```
LIVE_BASELINE_CAPTURED       = YES
PAID_ROUTES_ENABLED_CURRENT  = false
ECONOMIC_CONTAINMENT_PRECHECK = PASS
```

## V. Cron / Service Binding safety — the blocking gate

Current Cron Trigger configuration (`wrangler.toml`):

```toml
[triggers]
crons = ["* * * * *"]
```

One trigger, running every minute (UTC), driving `recoverWorkflowOwnerIntentsScheduled` and `reclaimStaleArtifactsScheduled` via the Worker's `scheduled()` handler.

**Required invariant (VCM-06, IMPL-04B §XI):** a candidate created and deployed at 0% normal HTTP traffic must not receive scheduled-event (`scheduled()`) execution, unless the platform's documented, qualified mechanism explicitly proves a 0%-weighted candidate cannot receive them.

**Research performed (this checkpoint, live, primary sources):**
- Fetched `https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/` in full. Describes gradual deployments exclusively in terms of HTTP request routing (`curl` testing, "traffic," version skew *between requests*). Makes no statement about `scheduled()` / Cron Trigger routing under a percentage split.
- Fetched `https://developers.cloudflare.com/workers/configuration/cron-triggers/` in full. Documents cron expression syntax, propagation delay (up to 15 minutes for *trigger* changes), and the `scheduled()` handler contract. Makes no statement about which *version* a Cron Trigger invokes when the Worker currently has a gradual (split) deployment active.
- Fetched `https://developers.cloudflare.com/workers/configuration/versions-and-deployments/` (top-level overview). States "a deployment determines which version(s) of your Worker are actively serving traffic" and describes gradual deployments purely in traffic-percentage/request terms; does not disambiguate whether `scheduled()` invocations are "traffic" for this purpose.
- Attempted to fetch a distinct "Deployment management" page (linked from the overview's "Next steps," and referenced in a Google result snippet mentioning cron triggers explicitly: *"To apply changes to a Worker's triggers (routes, domains, or cron triggers), You can also set the traffic percentage to less than 100% to start..."*) at `https://developers.cloudflare.com/workers/configuration/versions-and-deployments/deployment-management/` — **returned 404** in this session.
- Searched web and GitHub/community sources for an explicit statement of Cron Trigger behavior during a gradual deployment; found no authoritative confirmation either way.

**Conclusion:** the exact behavior of a Cron Trigger when the Worker is in a 100%/0% (or any split) gradual-deployment state could not be established from authoritative, currently-reachable evidence in this session. The one page that (per its search snippet) appears to discuss cron triggers specifically in the context of traffic percentage returned 404 when fetched directly, and no other primary source fills the gap.

Per the checkpoint's own explicit instruction: *"If this cannot be established: BLOCK the candidate deployment."*

```
ZERO_PERCENT_CANDIDATE_CRON_SAFETY_PROVEN = NO
```

This is a hard PASS gate. The checkpoint stops here, before Mutation 1, rather than weakening or guessing past this requirement.

## VI. What was deliberately not attempted

Per the checkpoint's scope and the block above, none of the following were performed, and none should be inferred from anything above:

- No `wrangler versions upload` was executed.
- No `wrangler versions deploy` was executed.
- No candidate Worker version was created.
- No traffic split was created or changed.
- No production, economic, registry, governance, or contract file was mutated.
- No secret value was read, displayed, or transmitted.

`wrangler versions upload --help` and `wrangler versions deploy --help` were inspected (read-only) to confirm exact future syntax ahead of the next attempt at this checkpoint: `versions deploy` accepts `<version-id>@<percentage>` shorthand with percentages in `[0, 100]`, so an exact `0%` candidate is syntactically representable once the cron-safety gate is resolved — this was inspected only to remove a future unknown, not to imply authorization to proceed.

## VII. Required final return

```
METADATA_VCM_IMPL_04B = BLOCKED

SOURCE_COMMIT = 36e82f508b2918c196c7564530bea2388e2348d2

VCM_IMPL_04A_IMPLEMENTATION = eab1f41
VCM_IMPL_04A_EVIDENCE = 36e82f5

LOCAL_SOURCE_PROVENANCE = PASS
REMOTE_SOURCE_PROVENANCE = NOT_SYNCED

WRANGLER_VERSION = 4.119.0

CURRENT_DEPLOYMENT_ID = 6f2fbbb4-f599-44b6-bab4-bcd3204c90f4
CURRENT_WORKER_VERSION_ID = 38cbf4dd-52fd-4afc-ad34-626a2e6454d3
CANDIDATE_WORKER_VERSION_ID = NONE

CURRENT_VERSION_TRAFFIC = 100%
CANDIDATE_VERSION_TRAFFIC = NOT_CREATED

CANDIDATE_VERSION_MESSAGE = NOT_CREATED

CANDIDATE_CONFIG_DELTA_COUNT = NOT_APPLICABLE
CANDIDATE_UNRELATED_CONFIG_DRIFT = NOT_APPLICABLE

A2A_METADATA_PROJECTION_MODE = absent (legacy default, current active version)
MCP_METADATA_PROJECTION_MODE = absent (legacy default, current active version)

PAID_ROUTES_ENABLED_CURRENT = false
PAID_ROUTES_ENABLED_CANDIDATE = NOT_APPLICABLE

ZERO_PERCENT_CANDIDATE_CRON_SAFETY_PROVEN = NO

CANDIDATE_SPECIFIC_INVOCATION = NOT_ATTEMPTED

A2A_CANDIDATE_QUALIFICATION = NOT_RUN
A2A_LIVE_SHADOW_EXECUTION_PROVEN = NO
A2A_PROJECTION_DIGEST_MATCH = NOT_RUN (source-level equivalent re-proven, see §III)

MCP_CANDIDATE_QUALIFICATION = NOT_RUN
MCP_LIVE_SHADOW_EXECUTION_PROVEN = NO
MCP_PROJECTION_DIGEST_MATCH = NOT_RUN (source-level equivalent re-proven, see §III)

A2A_SIGNING_EVIDENCE_LEVEL = CONFIGURED (unchanged; no live candidate to measure ACTIVE from)
A2A_SIGNING_BOUNDARY_PRESERVED = NOT_RUN
MCP_HANDLER_BINDING_PRESERVED = NOT_RUN

PUBLIC_PRODUCTION_NON_REGRESSION = PASS (baseline captured, unchanged by this checkpoint)

ECONOMIC_CONFIG_DRIFT = 0
PAYMENT_EVENTS_CREATED = 0
SETTLEMENT_EVENTS_CREATED = 0

CRON_MUTATIONS = 0
STORAGE_ALERT_MUTATIONS = 0
QUALIFICATION_EMAILS_SENT = 0

SOURCE_MUTATIONS = 0
REGISTRY_MUTATIONS = 0
GOVERNANCE_MUTATIONS = 0
CONTRACT_MUTATIONS = 0

AUTHORITY_INVERSION = NO
VCM_PRIMARY_SERVING = NO
CANARY_TRAFFIC_INCREASE = NO

REPORT_CONTENT_VERIFIED_BEFORE_COMMIT = YES

VCM_IMPL_04B_EVIDENCE_COMMIT = <recorded after commit, see chat response>

REPORT = docs/reports/METADATA-VCM-IMPL-04B-zero-percent-candidate-qualification.md

SAFE_TO_DESIGN_BOUNDED_A2A_MCP_CANARY = NO (blocked upstream of the canary question)

NEXT_CHECKPOINT = Resolve ZERO_PERCENT_CANDIDATE_CRON_SAFETY_PROVEN before re-attempting METADATA-VCM-IMPL-04B.
Two known paths, either sufficient to unblock:
  (a) obtain an authoritative Cloudflare statement/support confirmation on Cron Trigger
      routing during a gradual (percentage-split) deployment, or
  (b) sidestep the ambiguity structurally -- e.g. have the scheduled() handler read
      Version metadata (the runtime binding documented alongside gradual deployments)
      and no-op unless it is running as the currently-designated cron-owning version,
      so correctness does not depend on Cloudflare's routing behavior being any
      particular way.
Path (b) would itself be a source change and therefore its own reviewed checkpoint,
not a fix folded into a re-run of 04B.
```
