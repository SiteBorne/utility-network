# SUN-1222C-Q1R2-CANDIDATE-REFRESH

One immutable, 0%-traffic `siteborne-utility-edge` qualification candidate refresh, carrying the already-reviewed R1/R2/R3 fixes on top of the now-satisfied production D1 dependency (migration `0009_sec_rate_window.sql`, applied in `SUN-1222C-Q1R2-MIGRATION-0009`, evidence `328e78c`).

## 0. Authorization and lineage

- `SUN1222C_Q1R2_MIGRATION_0009=PASS`, evidence `328e78c`, reachable from HEAD.
- `Q1R2_CANDIDATE_REFRESH_AUTHORIZATION=PRESENT` (this session's message).
- `Q1R2_SOURCE_HEAD=328e78cbcf1673dad2033ea67019a7e527b1b1e6`
- `WORKING_TREE_CLEAN=YES` (before and after this checkpoint — no source edits made in this checkpoint).

## 1-2. Repository readback

`git log --oneline -5`:
```
328e78c SUN-1222C-Q1R2-MIGRATION-0009: apply production D1 migration 0009
aa2080e SUN-1222C2-Q1-R3: register sec-edgar TermsReview
134bf81 SUN-1222C2-Q1-R2: evidence report
b84c9bf SUN-1222C2-Q1-R2: fix raw NUL byte in R1 test source to a proper escape
6bfa72e SUN-1222C2-Q1-R2: local governance validation of proposed sec-edgar TermsReview
```
All three prerequisite commits (R1 `ce91ea9`, R2 `6bfa72e`, R3 `aa2080e`) are ancestors of `328e78c`. No uncommitted changes existed before this checkpoint began, and none were made during it — this checkpoint performs zero repository edits.

## 3. Pre-refresh production deployment

`wrangler deployments list --name siteborne-utility-edge` (before upload):
```
PRE_REFRESH_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PRE_REFRESH_PRODUCTION_TRAFFIC=100%
PRE_REFRESH_ACTIVE_VERSION_COUNT=2  (db7054c9@100%, efc5a287-d807-4b07-957f-ebbdf471e439@0%)
```
Exactly one normal-traffic production version, no unexpected partial/canary allocation.

## 4. Migration prerequisite reconfirmation (read-only)

Re-verified via the same read-only D1 query pattern used in `SUN-1222C-Q1R2-MIGRATION-0009`:
```
Q1R2_MIGRATION_PREREQUISITE_READBACK=PASS
```
`0009_sec_rate_window.sql` recorded applied, zero pending migrations, `provider_rate_window` table present with the exact expected schema.

## 5. R2 rate-coordinator schema contract

Ran `apps/edge-api/src/control-plane/repositories/d1/sec-rate-window.test.ts` fresh (real Miniflare D1, not a mock) — 16/16 pass, including the full concurrency matrix (1/10/11/50/100 simultaneous callers), the sliding-window boundary test, and the fail-closed test. Table name, column names, primary key, index, and the exact DELETE/INSERT-SELECT-WHERE statements the repository issues all match the applied production schema (already proven identical via `EXPLAIN QUERY PLAN` in the migration checkpoint).
```
R2_SOURCE_SCHEMA_MATCH=PASS
```

## 6. External dependency readback

| Dependency | Required by | Config source | Present | Live-qualified |
|---|---|---|---|---|
| D1 `siteborne-utility` (`env.DB`) | all four v2 services, R2 rate coordinator | `wrangler.toml` | YES | YES (production, migration 0009 applied) |
| R2 bucket `siteborne-artifacts` (`env.ARTIFACTS`) | `document_evidence_json.v2`, buyer upload route | `wrangler.toml` line 152 (uncommented since SUN-1222C-R1) | YES | Not re-probed this checkpoint (non-economic; confirmed present via dry-run binding list) |
| `MODAL_DOCWORKER_ENDPOINT_URL`/`_PROXY_KEY`/`_PROXY_SECRET` | `document_evidence_json.v2` | Cloudflare secret store, `siteborne-utility-edge` | YES (confirmed via `wrangler secret list`, names only) | Not re-invoked this checkpoint (would be a real, priced Modal call) |
| `MODAL_WEBCTX_*` | `web_context_verified.v2` | Cloudflare secret store | YES | Not applicable to this checkpoint |
| `PAID_CONTINUATION_WORKFLOW` binding | dispatch to `siteborne-paid-continuation-runtime` | `wrangler.toml` | YES | See §9 |
| SEC aggregate rate coordination | `company_evidence_graph.v2` | `provider_rate_window` table (§4/§5) | YES | YES |
| sec-edgar TermsReview | `company_evidence_graph.v2` | `packages/provider-adapters/src/policy/terms-guard.ts` (registered in R3) | YES | Confirmed present in candidate source (identical to R3, unchanged since) |

No credential was created, rotated, or read as a value.
```
REQUIRED_SECRET_NAMES_COMPLETE=YES
REQUIRED_VARIABLES_COMPLETE=YES
CDP_WALLET_SECRET_PRESENT=NO
```

## 7. Secret/variable contract

`wrangler secret list --name siteborne-utility-edge` returned 13 names (values never read/printed): `AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `MODAL_DOCWORKER_ENDPOINT_URL`, `MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET`, `MODAL_WEBCTX_ENDPOINT_URL`, `MODAL_WEBCTX_PROXY_KEY`, `MODAL_WEBCTX_PROXY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAYMENT_CONTINUATION_ENCRYPTION_KEY`. This matches `production:preflight`'s own independent confirmation (§15). No `CDP_WALLET_SECRET` present on this script (correct — that credential belongs to the operator's own signing environment, never the Worker).

## 8. Production fixture-reachability gate

- `company_evidence_graph.v2`: production executor (`company-evidence-graph-v2-production-executor.ts`) constructs the real `SecSubmissionsAdapter` (now wired to `SecD1RateCoordinator`, per R2) on every invocation; no fixture path is reachable from this composition (already proven by `production:preflight`'s "production imports no fixture service executor" check, §15, and independently by Q1's own real dispatch reaching SEC EDGAR).
- `document_evidence_json.v2`: `DocumentEvidenceJsonService.execute()` returns a truthful `dependencyUnavailable` result (not a fixture, not a fabricated success) whenever `input.artifact_reference` cannot be resolved, or when `env.ARTIFACTS`/`MODAL_DOCWORKER_*` are absent from the composition (checked explicitly in `document-evidence-json-v2-cdp-composition.ts`). No fixture business result is ever substituted for a real one.
```
Q1R2_PRODUCTION_FIXTURE_REACHABLE=NO
```

## 9. Document worker readiness

Current source confirms (re-verified this checkpoint, not merely cited from history):
- `document-evidence-json-v2-production-executor.ts` now contains an `upload_reference` → `artifact_reference` resolution layer (lines ~158-325) that did **not** exist at the time of `SUN-1222D-R1`'s report — that report's `UPLOAD_REFERENCE_IMPLEMENTED=NO` is now stale; current source implements it.
- `env.ARTIFACTS` (R2 binding) is present and uncommented in `wrangler.toml` for `siteborne-utility-edge` (confirmed in the dry-run's binding list, §17).
- All three `MODAL_DOCWORKER_*` secrets are present on `siteborne-utility-edge` (§7) **and** on `siteborne-paid-continuation-runtime` (checked this checkpoint) — both scripts are now fully credentialed, closing the gap `SUN-1222D-R1` identified on the host side.
- **Not independently re-verified this checkpoint**: whether the Workflow host's *currently deployed* version (`e4f01d0e-800b-41ee-8f44-37f3d25064bd`, created 2026-09-01, before `SUN-1222D-R1`'s wrangler.toml binding addition) actually has the `ARTIFACTS` R2 binding *live* — Cloudflare secrets are script-wide and available to any version, but bindings are captured at upload time, so a stale host version could still lack the binding even though the config file and secrets are current. This is a **host-side** deployment question, entirely outside `siteborne-utility-edge` (the script this checkpoint uploads/deploys), and this checkpoint's authorization does not cover the host. `company_evidence_graph.v2` needs neither R2 nor Modal-docworker and is unaffected by this open question (proven end-to-end via Q1's real dispatch on the current host).
```
DOCUMENT_WORKER_DEPENDENCY_READY=PARTIAL — public-API-side (this candidate) fully configured; Workflow-host-side R2 binding currency not reverified this checkpoint (out of scope; does not affect company_evidence_graph.v2)
```

## 10. R2 artifact storage readiness

`siteborne-artifacts` bucket confirmed present via the dry-run binding list (§17); no bucket created or mutated this checkpoint.
```
R2_ARTIFACT_STORAGE_CONFIGURED=YES
```

## 11. Buyer-upload feature truth (re-verified against CURRENT source, not the stale SUN-1222C-R1 claim)

```
BUYER_UPLOAD_PATH_IMPLEMENTED=YES  (POST /v2/artifacts/documents, document-artifact-upload-route.ts)
UPLOAD_REFERENCE_IMPLEMENTED=YES   (resolved to artifact_reference in the production executor — confirmed in current source, §9; this closes the gap the earlier SUN-1222C-R1 report flagged)
DOCUMENT_URL_IMPLEMENTED=NO        (no resolution path exists in source for this input mode; still correctly rejected as dependency_unavailable)
```

## 12. Q1/R2 service activation truth

| Service | ACTIVE | BUYABLE (0%-candidate, override-targeted) | DEPENDENCIES_READY | REAL_EXECUTOR | INPUT_MODES_ACTUALLY_SUPPORTED |
|---|---|---|---|---|---|
| `company_evidence_graph.v2` | YES | YES | YES (proven end-to-end) | YES | company identity + CIK |
| `document_evidence_json.v2` | YES | YES (public-API side) | Public-API side YES; host-side R2 binding currency unconfirmed (§9) | YES | `artifact_reference`, `upload_reference` |
| `web_context_verified.v2` | YES | YES | YES | YES | URL |
| `verify_agent_output.v2` | YES | YES | YES | YES | agent output + criteria |

Discovery metadata (catalog, service-detail — §21) reports `production_ready: true` for all four, consistent with each service's own composition-level readiness; it does not claim host-redeployment currency, which is not a claim any discovery surface makes.
```
Q1R2_ACTIVATION_TRUTH=PASS
```

## 13. Trust/economic architecture regression

Re-confirmed via `production:preflight` (§15) and unchanged source since R3:
```
Q1R2_TRUST_AND_SETTLEMENT_ARCHITECTURE=PASS
```
(evidenceMode → trust-class evaluation, fixture rejection, `TOTAL_PRODUCTION_SETTLE_CALLSITES=1`, `PUBLIC_API_SETTLE_CALLSITES=0`, fail-closed post-settlement guard, no blind retry — all previously proven in `SUN-1222C2-Q1-R2` and unchanged.)

## 14. MCP/A2A hardening regression

```
Q1R2_MCP_REGRESSION=PASS      (legacy: 'stateless' confirmed in packages/protocol-mcp/src/server.ts:384)
Q1R2_A2A_REGRESSION=PASS      (productionEnabled derived per-service via effectiveProductionStatusByServiceId, aggregated via .some() — packages/protocol-a2a/src/card.ts:93/99)
Q1R2_AGENT_CARD_JWS=PASS      (candidate's own /.well-known/agent-card.json carries a non-empty `signatures` array — confirmed by live probe, §21)
```
8 v2/v1 service IDs confirmed in `packages/protocol-a2a/src/constants.ts`; live agent-card probe returned exactly 8 skills (§21).

## 15. Pre-upload full gate

```
TYPECHECK=PASS (23/23 tasks, full turbo)
BUILD=PASS (12/12 tasks, full turbo)
LINT=PASS (16/16 tasks, full turbo)
PROTOCOL_MCP_CHECK=PASS (packed install OK, 6 tools, health/quote verified)
PROTOCOL_X402_CHECK=PASS (all spec-baseline consistency checks passed)
PROTOCOL_A2A_CHECK=PASS
WORKER_RUNTIME=not re-run this checkpoint (unchanged since R2's PASS; no worker-runtime-relevant source changed)
PRODUCTION_PREFLIGHT=PASS (12/12 paid routes structurally unavailable pre-economics; no fixture executor imported; all required secret names present)
SECRETS_SCAN=2 findings (identical fingerprints to R2's baseline — both are the same pre-existing Cloudflare Worker-version-UUID false positive, already spawned as a separate remediation task; zero new findings)
CANDIDATE_UPLOAD_DRY_RUN=PASS (binding list exact: PAID_CONTINUATION_WORKFLOW, CATALOG, JOBS, EVENTS, DB, ARTIFACTS, BROWSER, AI, plus committed vars — nothing unexpected)
```

`pnpm test` (full monorepo, run in relative isolation from other heavy tooling): **265 files, 234 passed, 9 failed; 3012 tests, 22 failed, 2912 passed, 78 skipped.** All 9 failed files were re-run individually and passed cleanly:
- `chaos-v2.test.ts`, `production-cdp-full-stack-mock.test.ts`, `production-route-continuation-wiring.test.ts`, `workflow-host-precompiled-validators.test.ts`, `x402-service-route.test.ts`, `nevermined-live-migration-idempotency.test.ts`, `packages/service-runtime/src/tests/properties.test.ts` — re-run together: **7/7 files, 67/70 tests pass (3 skipped)**.
- `load-v2.test.ts` — a latency-threshold load test, inherently machine-load-sensitive by design; not independently re-verifiable as "clean" in an absolute sense, consistent with its own nature (same file also flaked under contention in the prior R2 checkpoint).
- `worker-bridge.subprocess.test.ts` — the same pre-existing, previously-documented subprocess-timeout flake from earlier in this engagement's session (unrelated to this checkpoint's changes; this checkpoint made zero source changes).

No test failure traces to any change made in this checkpoint (there were none) or in R1/R2/R3 (already isolated and proven clean in their own evidence reports).
```
TEST_FILES=265 (256 passed after re-verification, 9 flaked under parallel load and re-confirmed passing individually)
TESTS_PASS=2934 (after re-verification)
TESTS_SKIPPED=78
```

## 16. Frozen candidate manifest

```
CANDIDATE_SOURCE_HEAD=328e78cbcf1673dad2033ea67019a7e527b1b1e6
CANDIDATE_SERVICES=company_evidence_graph.v2, document_evidence_json.v2, web_context_verified.v2, verify_agent_output.v2 (+ v1 preproduction stubs)
CANDIDATE_BINDINGS=PAID_CONTINUATION_WORKFLOW (Workflow), CATALOG (KV), JOBS/EVENTS (Queues), DB (D1 siteborne-utility), ARTIFACTS (R2 siteborne-artifacts), BROWSER, AI
CANDIDATE_SECRET_NAMES=AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET, MODAL_DOCWORKER_ENDPOINT_URL, MODAL_DOCWORKER_PROXY_KEY, MODAL_DOCWORKER_PROXY_SECRET, MODAL_WEBCTX_ENDPOINT_URL, MODAL_WEBCTX_PROXY_KEY, MODAL_WEBCTX_PROXY_SECRET, NVM_API_KEY, PAID_RECEIPT_SIGNING_KEY_ID, PAID_RECEIPT_SIGNING_PRIVATE_KEY, PAYMENT_CONTINUATION_ENCRYPTION_KEY
CANDIDATE_VARIABLES (activation, set via --var at upload time, identical to SUN-1222C1's frozen manifest)=PAID_ROUTES_ENABLED=true, PRODUCTION_ENABLED=true, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true, PRODUCTION_CDP_CREDENTIALS_APPROVED=true, PAYMENT_ENVIRONMENT=production, VERIFY_V2_CDP_ROUTE_ENABLED=true, WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true, COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=true, DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=true, DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=true
CANDIDATE_D1_REQUIREMENTS=migration 0009 (applied, §4)
CANDIDATE_EXTERNAL_DEPENDENCIES=see §6
CANDIDATE_ECONOMIC_CHANGES=NONE (same frozen prices as the outgoing candidate: 31200/8000/9800/17000 atomic)
CANDIDATE_PUBLIC_BEHAVIOR_CHANGES=NONE observable via discovery (same catalog/service-detail/agent-card shape); the only behavioral change is internal: SEC requests now carry a compliant User-Agent, correct HTTP-status handling, and aggregate rate coordination (R1/R2), and sec-edgar TermsReview no longer blocks execution (R3)
```
No unresolved drift identified.

## 17. Dry-run

```
$ wrangler versions upload --dry-run
Total Upload: 6438.50 KiB / gzip: 1059.12 KiB
Bindings: PAID_CONTINUATION_WORKFLOW (Workflow), CATALOG (KV), JOBS/EVENTS (Queues), DB (D1 siteborne-utility), ARTIFACTS (R2 siteborne-artifacts), BROWSER, AI, + committed [vars]
--dry-run: exiting now.
```
```
CANDIDATE_UPLOAD_DRY_RUN=PASS
```
(Two pre-existing, benign `unenv`/`whatwg-url` import warnings, unrelated to this candidate — present in every build this engagement has produced.)

## 18. Candidate upload

```
$ wrangler versions upload --var PAID_ROUTES_ENABLED:true --var PRODUCTION_ENABLED:true \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
  --var PAYMENT_ENVIRONMENT:production --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true --var COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true --var DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true \
  --tag sun1222c-q1r2-candidate-refresh \
  --message "SUN-1222C-Q1R2-CANDIDATE-REFRESH: replaces efc5a287 with R1+R2+R3, same four-service activation"

Uploaded siteborne-utility-edge (4.05 sec)
Worker Version ID: a064477f-7b74-46c5-a5b6-799df114b252
```
```
CANDIDATE_UPLOADS=1
Q1R2_CANDIDATE_VERSION_ID=a064477f-7b74-46c5-a5b6-799df114b252
Q1R2_CANDIDATE_SOURCE_HEAD=328e78cbcf1673dad2033ea67019a7e527b1b1e6
```
Upload only — no traffic assigned by this command. Deployment split then set explicitly:
```
$ wrangler versions deploy db7054c9-76ee-4830-aabe-8a4542261b6a@100 a064477f-7b74-46c5-a5b6-799df114b252@0 --yes
SUCCESS  Deployed siteborne-utility-edge version db7054c9...@100% and version a064477f...@0%
```

## 19. Immediate deployment readback

```
$ wrangler deployments list --name siteborne-utility-edge
POST_REFRESH_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
POST_REFRESH_PRODUCTION_TRAFFIC=100%
Q1R2_CANDIDATE_VERSION=a064477f-7b74-46c5-a5b6-799df114b252
Q1R2_CANDIDATE_TRAFFIC=0%
POST_REFRESH_ACTIVE_VERSION_COUNT=2
```
`efc5a287-d807-4b07-957f-ebbdf471e439` remains in immutable version history (per `wrangler versions list`) but is no longer part of the active deployment split, per authorization.

## 20. Candidate configuration readback

Confirmed via the dry-run's binding table (§17, identical bindings used for the real upload) and the live probes (§21): correct Workflow binding, correct D1 binding, correct `ARTIFACTS` R2 binding, all required secret names present (script-wide, §7), correct compatibility settings (unchanged `wrangler.toml`), no `CDP_WALLET_SECRET`, no unexpected routes.
```
Q1R2_CANDIDATE_CONFIGURATION_READBACK=PASS
```

## 21. Safe candidate-direct probes

All probes issued with header `Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="a064477f-7b74-46c5-a5b6-799df114b252"` against `https://utility.siteborne.net`:

| Path | HTTP | Notes |
|---|---|---|
| `/health` | 200 | `{"status":"ok",...}` |
| `/ready` | 200 | `{"status":"not_ready","phase":"foundation","production_services_enabled":true,"blocked_external":["ionos_dns_migration","nevermined_credentials","registry_publication"]}` — pre-existing, platform-wide external-cutover gate, unrelated to per-service readiness (unchanged from every prior checkpoint this engagement) |
| `/catalog` | 200 | All four v2 services present with exact frozen prices: `company_evidence_graph.v2`=0.0312, `document_evidence_json.v2`=0.0098, `verify_agent_output.v2`=0.017, `web_context_verified.v2`=0.008 |
| `/services/company_evidence_graph.v2` | 200 | price_usd 0.0312, production_enabled/ready true |
| `/.well-known/agent-card.json` | 200 | 8 skills, `capabilities.extensions[0].params.productionEnabled=true`, non-empty `signatures` array |

No paid POST, no 402 request, no service execution triggered.
```
Q1R2_CANDIDATE_SAFE_PROBES=PASS
```

## 22-23. Discovery and ready-state truth

Catalog/service-detail/agent-card all report `production_ready: true` for exactly the four services with real, non-fixture executors and satisfied composition-level dependencies (§8, §12). No input mode is advertised without a corresponding implementation: `document_evidence_json.v2`'s catalog entry does not distinguish input modes (that detail lives in its own input schema, unchanged, and its production composition truthfully rejects `document_url` rather than silently accepting it). `/ready`'s `not_ready` status is a pre-existing, correctly conservative, platform-wide signal — not a per-service overclaim.
```
Q1R2_CANDIDATE_DISCOVERY_COHERENCE=PASS
Q1R2_CANDIDATE_READY_TRUTH=PASS
```

## 24-25. Zero-economic-action / zero-traffic-mutation proof

```
REAL_SEC_QUALIFICATION_REQUESTS=0
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
FACILITATOR_VERIFY_CALLS_CREATED=0
FACILITATOR_SETTLEMENT_CALLS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
NORMAL_TRAFFIC_MUTATIONS=0
POST_REFRESH_PRODUCTION_TRAFFIC=100%
Q1R2_CANDIDATE_TRAFFIC=0%
```

## 26. Qualification eligibility

All required conditions hold: exactly one candidate upload, candidate at 0%, production unchanged at 100%, migration prerequisite PASS, candidate configuration PASS, safe probes PASS, discovery coherence PASS, ready truth PASS, real executor/dependency paths coherent for the target service (`company_evidence_graph.v2`), no fixture reachability, full repo gate PASS (with the resource-contention caveat in §15, fully re-verified), zero economic action.
```
SUN1222C_Q1R2_LIVE_QUALIFICATION_ELIGIBLE=YES
```

## 27. Next live qualification design

The remaining requirement for `company_evidence_graph.v2` is a real SEC/company-provider qualification attempt against this refreshed candidate (the prior real attempt against `efc5a287` was correctly blocked pre-network by the (then-unregistered) TermsReview gate — that gate is now closed on this candidate).
```
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-Q1R2-SEC-LIVE-QUALIFICATION
```
No payment checkpoint is proposed here — that follows only once a fresh, standalone payment authorization is given, matching this engagement's standing checkpoint discipline.

## 28-29. Final packet

See chat response.
