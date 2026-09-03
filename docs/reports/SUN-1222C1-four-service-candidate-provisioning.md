# SUN-1222C1 — Four-Service Immutable Candidate Provisioning

## 0. Lineage / authoritative state

- C1 start HEAD: `eaeffa7` (working tree clean; matches C0-R1's final commit)
- C0-R1 fix commit `d11ab52` and SHA-correction `eaeffa7` both reachable in `git log`
- Working tree remained clean throughout this checkpoint — every mutation below is external (Cloudflare API / D1), not a repo change

## 1. Current production readback (before this checkpoint)

```
PUBLIC_API_ACTIVE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a @ 100%
PUBLIC_API_SECOND_VERSION=3a74686d-bad8-4fb0-b6b8-604292145d69 @ 0%  (stale, from S3/C0-1-REMEDIATION)
ACTIVE_VERSION_COUNT=2
```

`3a74686d` was already documented as stale/ineligible for promotion (SUN-1222B-S3). Its presence is not "unknown" (it is the known, previously-reported state), so it did not trigger a stop — `wrangler versions deploy` replaces the entire active-deployment version set with exactly what is specified in the command, so uploading and deploying a new candidate correctly supersedes/drops it rather than creating a third active version.

Direct readback of `db7054c9`'s bindings/vars (`wrangler versions view`) confirmed, independent of any prior transcript: `PAID_ROUTES_ENABLED=true`, `VERIFY_V2_CDP_ROUTE_ENABLED=true`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true`, all four ADR-0055 gates true, `SELLER_WALLET_ADDRESS` set — but **no** `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`, no `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED`, no `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED`, and no `ARTIFACTS` R2 binding. This directly confirms current production genuinely serves only 2 of 4 v2 services (`web_context_verified.v2`, `verify_agent_output.v2`), matching every prior report's claim from live evidence, not inherited assumption.

## 2. Four-service matrix (traced from current HEAD)

| Service | Route flag | Route | Real executor | Fixture reachable | Price (USD) | Atomic |
|---|---|---|---|---|---|---|
| `company_evidence_graph.v2` | `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` | `/v2/company/evidence-graph` | `company-evidence-graph-v2-production-executor.ts` (real `CompanyEvidenceGraphService`, reuses `MODAL_WEBCTX_*`) | NO | $0.0312 | 31,200 |
| `web_context_verified.v2` | `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` | `/v2/web/context` | `web-context-v2-production-executor.ts` | NO | $0.008 | 8,000 |
| `document_evidence_json.v2` | `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` | `/v2/document/evidence-json` | `document-evidence-json-v2-production-executor.ts` (real Modal doc-worker via `ModalDocumentWorkerBridge`) | NO | $0.0098 (native tier, representative qualification amount; tiered model also has ocr/table/max_job) | 9,800 |
| `verify_agent_output.v2` | `VERIFY_V2_CDP_ROUTE_ENABLED` | `/v2/verify/agent-output` | `verify-agent-output-v2-production-executor.ts` | NO | $0.017 | 17,000 |

`SERVICE_TOOL_MATRIX_V2_EXACT=PASS`. All four production compositions verified by direct source read to never import `buildFixtureRegistry`/`createFixtureSigner`/`FixtureDocumentWorkerBridge`/`SubprocessDocumentWorkerBridge` — every "fixture" mention in these files is either a doc-comment negation or the `evidenceMode: 'fixture'` discriminant used exclusively by the fail-closed branch.

**Settlement owner**: all four dispatch through the single `PaidContinuationWorkflow` (`production-dependencies.ts`'s `ROUTE_CONFIG_BUILDERS` registry, extended to all four in SUN-1222D-PRE, `SUPPORTED_SERVICES` mechanically derived from its keys). No service has a second settlement path.

## 3. Price freeze

`AUTHORITATIVE_PRICE_FREEZE_SOURCE = packages/pricing/src/service-prices.ts` (`EMBEDDED_PRICING`, version `1.0.0`, mirrors `governance/RISK_LIMITS.yaml`, cross-validated by `pricing:check` passing clean this checkpoint). Values above read directly from that constant, not from memory of a prior report. `PRICE_FREEZE_PROVEN=YES`. Four-service qualification total: `31200 + 8000 + 9800 + 17000 = 66,000` atomic USDC.

## 4. Full pre-provision gate (re-run at exact candidate source HEAD `eaeffa7`)

All green, same HEAD already gated in full at the end of C0-R1: typecheck 23/23, build 12/12, lint 16/16, tests 2842 passed / 77 skipped / 0 failed, worker-runtime 99/99, x402/mcp/a2a protocol checks, `migrations:verify`, `pricing:check`, `governance:validate` 77/77, `production:preflight` PASS, `secrets:scan` clean, both wrangler dry-runs PASS. No source fixes performed this checkpoint (none needed — HEAD unchanged from C0-R1's own verified-clean state).

## 5. Dependency inventory (read-only, names only, real Cloudflare readback)

| Dependency | Required by | Present | Secret names present (public API script) |
|---|---|---|---|
| D1 `siteborne-utility` (`efe23c42-cbcc-47c2-9b28-922a541bdcdd`) | all four | YES | n/a (binding) |
| R2 `siteborne-artifacts` | document ingress/execution | YES (confirmed via `wrangler r2 bucket list`) | n/a (binding) |
| `PAID_CONTINUATION_WORKFLOW` cross-script binding → `siteborne-paid-continuation-runtime` | all four (settlement) | YES | n/a (binding) |
| `MODAL_WEBCTX_*` (endpoint/key/secret) | web_context, company | YES | present |
| `MODAL_DOCWORKER_*` (endpoint/key/secret) | document | YES — **already present on the public API script itself** (`siteborne-utility-edge`), confirmed via `wrangler secret list`, not only on the Workflow host | present |
| `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` | all four (seller identity, facilitator) | YES | present |
| `PAID_RECEIPT_SIGNING_PRIVATE_KEY`/`_KEY_ID` | all four | YES | present |
| `PAYMENT_CONTINUATION_ENCRYPTION_KEY` | all four (continuation envelope) | YES | present |
| `AGENT_CARD_SIGNING_PRIVATE_KEY` | discovery | YES | present |
| `NVM_API_KEY` | legacy Nevermined path | YES | present |
| `CDP_WALLET_SECRET` | — | **absent** (correct — not required, SUN-1200 checkpoint E) | absent |

A real finding worth flagging explicitly: I initially assumed (from this engagement's own prior transcript) that `MODAL_DOCWORKER_*` existed only on the Workflow host (SUN-1222D-R2's own scope). Direct `wrangler secret list --config wrangler.toml` readback proved this assumption wrong — the public API script's own composition (`document-evidence-json-v2-cdp-composition.ts`) independently gates on these same three secrets before it will even build a non-`unavailable` route config (belt-and-suspenders: the public API checks readiness before advertising the 402, and the Workflow independently re-checks before real execution), and they are already present there. This removed what would otherwise have been a genuine credential-provisioning blocker requiring fresh authorization. `NEW_CREDENTIALS_CREATED=0`, `ROTATED_CREDENTIALS=0`, `DELETED_CREDENTIALS=0` — nothing was created; this was a correction of a stale assumption, not a new provisioning action.

Live, non-economic proof the Modal document-worker resource itself is real and fail-closed: an unauthenticated `POST` to `https://siteborne--siteborne-document-worker-process-document-http.modal.run` returned `401` (confirmed live this checkpoint).

`web_context_verified.v2`/`company_evidence_graph.v2` both reuse the same `MODAL_WEBCTX_*` safe-egress endpoint already serving live production traffic today — `WEBCTX_MODAL_DEPENDENCY_READY=YES`, `COMPANY_EXTERNAL_DEPENDENCIES_READY=YES` (no new/second deployment). `verify_agent_output.v2` is already one of the two services live in production today — `VERIFY_EXTERNAL_DEPENDENCIES_READY=YES`.

## 6. Workflow host

`siteborne-paid-continuation-runtime` unchanged at version `f17acb0c-6400-47f7-a203-5c97b44dcb9d` @ 100% (deployed SUN-1222D-R2, confirmed no drift). It already contains the SUN-1222D-PRE four-service dispatch registry (predates f17acb0c's deployment in git history) and neither C0 (artifact reclamation) nor C0-R1 (document-ingress admission control) touch the Workflow/continuation contract — both are additive modules the Workflow host's existing code never needs to import. `C1_WORKFLOW_HOST_READY=YES`. No host deploy performed or required.

## 7. D1 migration

```
REPOSITORY_MIGRATIONS = 0001..0008 (8 files)
PENDING_MIGRATIONS (pre-checkpoint, remote readback) = [0008_document_ingress_admission_windows.sql]
PENDING_MIGRATION_COUNT = 1
```

Exactly the one migration authorized. Re-inspected the SQL: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` only, no `ALTER`, no `DROP`, no `DELETE`, no data rewrite, no credential data. `C1_D1_MIGRATION_SAFE=YES`.

Applied: `wrangler d1 migrations apply siteborne-utility --remote` → `0008_document_ingress_admission_windows.sql ✅` (1 command execution, 3 SQL statements, 0.99ms). Post-migration readback: `wrangler d1 migrations list --remote` → "No migrations to apply"; direct query confirms table `document_ingress_admission_windows` exists in the real production database. `PRODUCTION_D1_MIGRATION_OPERATIONS=1`, `C1_D1_MIGRATION_READBACK=PASS`.

## 8. Reclamation/retention caveat (preserved, not resolved)

`DOCUMENT_RECLAMATION_IMPLEMENTED=YES` (`artifact-reclamation.ts`, proven in C0). `DOCUMENT_RECLAMATION_LIVE_SCHEDULED=NO` — confirmed again this checkpoint: no `[triggers]`/`crons` block in `wrangler.toml`, no `scheduled` export in `index.ts`. `DOCUMENT_RECLAMATION_CRON=none configured`. `DOCUMENT_RETENTION_PRODUCTION_BLOCKER=YES`, carried forward unchanged from C0-R1, not silently resolved.

## 9. Candidate build, upload, and deployment

**Config freeze**: candidate source = HEAD `eaeffa7`, unchanged from the fully-gated C0-R1 state. Activating vars set at upload time via `wrangler versions upload --var` (not committed to `wrangler.toml`, which deliberately keeps all "cutover" vars absent per its own SUN-1205 checkpoint K doc comment, so a plain `wrangler deploy` from this repo can never silently activate paid routes):

```
PAID_ROUTES_ENABLED=true
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
PAYMENT_ENVIRONMENT=production
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=true   (new)
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=true    (new)
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=true         (new)
```

The first seven exactly replicate current production's own already-live values (read back directly, not invented); the three marked "new" are what activate the two additional services and the document-upload ingress path this candidate adds. `SELLER_WALLET_ADDRESS` and all other non-activating vars come from `wrangler.toml`'s own committed `[vars]`.

**Dry-run** (`wrangler versions upload --dry-run` with the same flags): binding list showed exactly the intended set (D1, R2 `ARTIFACTS`, Workflow, KV, Queues, all vars) and nothing unexpected. `CANDIDATE_DRY_RUN=PASS`.

**Upload**: `wrangler versions upload` → `Worker Version ID: 8ce8cb66-f388-4fcc-b3e6-9c14b4919a93`, tag `sun1222c1-four-service-candidate`, uploaded only (no traffic). `CANDIDATE_UPLOADS=1`.

**Version readback** (`wrangler versions view 8ce8cb66...`): all 13 existing secrets inherited automatically (secrets are never deleted by a version upload); `ARTIFACTS` binding present; all ten activating vars present with the exact intended `"true"`/`"production"` values; `PAID_CONTINUATION_WORKFLOW` cross-script binding correct; no `CDP_WALLET_SECRET`. `C1_CANDIDATE_VERSION_READBACK=PASS`.

**Deployment**: `wrangler versions deploy db7054c9@100 8ce8cb66@0` → `Deployed siteborne-utility-edge version db7054c9... at 100% and version 8ce8cb66... at 0%`. `DEPLOYMENT_STATE_MUTATIONS=1`.

**Traffic readback** (`wrangler deployments status`): `(100%) db7054c9-76ee-4830-aabe-8a4542261b6a`, `(0%) 8ce8cb66-f388-4fcc-b3e6-9c14b4919a93` — exactly two active versions; the stale `3a74686d` candidate was correctly dropped from the active deployment (its immutable version artifact still exists in Cloudflare's version history, it is simply no longer part of the current deployment's routing table). `C1_TRAFFIC_READBACK=PASS`.

## 10. Live candidate HTTP verification — genuinely blocked, not skipped

`wrangler.toml` (SUN-1207 M3) sets `preview_urls = false` specifically because "undeployed Worker versions can inherit production secrets and stale version-scoped variables" and "must never make those versions publicly routable." This is a deliberate, already-existing, correctly-reasoned security control — and it means there is **no available public-HTTP mechanism to address this specific 0%-traffic candidate version directly**. The `workers.dev`/custom-route surface always resolves to the current percentage split (100% → `db7054c9`); a 0%-weighted version receives no live traffic by construction.

Re-enabling `preview_urls` would be a security-relevant config change ("no source fixes" — not authorized this checkpoint, and re-disabling it afterward would still leave a window where it was live). Giving the candidate non-zero traffic is explicitly prohibited. Neither workaround was taken.

Consequently, §28 (safe candidate public probes), §29 (four-service discovery truth against the live candidate), and §30 (bounded synthetic document-ingress qualification against the live candidate) **could not be executed** as literal live-HTTP operations this checkpoint:

```
C1_CANDIDATE_DISCOVERY=NOT_EXECUTED (blocked by preview_urls=false, a pre-existing, deliberate security control)
C1_FOUR_SERVICE_DISCOVERY_COHERENCE=NOT_EXECUTED
C1_DOCUMENT_SYNTHETIC_UPLOADS=0
C1_DOCUMENT_R2_ROUNDTRIP=NOT_EXECUTED
C1_DOCUMENT_SYNTHETIC_CLEANUP=NOT_APPLICABLE
```

What was verified instead, as the strongest available substitute: (a) the authoritative version/binding/secret/var readback above, which structurally proves the exact configuration a live request would see; (b) the full existing Miniflare-backed integration test suite (already re-run clean at this exact source HEAD in §4), which exercises the identical code paths — including the real `document-artifact-upload-route.ts` admission-control/R2/D1 flow — against realistic D1/R2 bindings, just not against this specific deployed Cloudflare version over real HTTP. This is real evidence of correctness, but it is not the same claim as "the live candidate was probed and responded correctly," and I am not representing it as such.

**Recommended remediation, not performed here**: a narrowly-scoped follow-up checkpoint that explicitly authorizes either (a) a brief, monitored, explicitly-bounded non-zero canary percentage for live verification, or (b) a temporary, explicitly-reverted `preview_urls` re-enable window — both are meaningful production-security decisions that deserve their own authorization, not a default assumption inside this one.

## 11. Buyer balance / funding

Not read this checkpoint — no existing read-only balance-check tooling was found in the repository (`cdp:signer-capability-check` checks signer capability, not balance), and writing new tooling for a live CDP wallet-balance call was judged out of this checkpoint's already-large scope. `C1_BUYER_BALANCE_ATOMIC=NOT_READ_THIS_CHECKPOINT`. This must be resolved before or alongside SUN-1222C2.

## 12. Zero economic effect (confirmed)

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_POSTS=0
FACILITATOR_VERIFY_CALLS_CREATED_BY_C1=0
FACILITATOR_SETTLE_CALLS_CREATED_BY_C1=0
CHAIN_TRANSACTIONS_CREATED_BY_C1=0
USDC_TRANSFER_ATOMIC=0
```

## 13. Verdict and next checkpoint

Candidate provisioning, migration, and deployment-state itself are fully proven correct by direct, authoritative readback. What is NOT proven is live end-to-end behavior of the deployed candidate, and buyer funding status is unknown — both real gaps, not resolved by assumption. `SUN1222C1_FOUR_SERVICE_CANDIDATE_PROVISIONING=PARTIAL`.

`NEXT_REQUIRED_CHECKPOINT = SUN-1222C1-R2-CANDIDATE-LIVE-VERIFICATION` — a narrowly-scoped checkpoint authorizing exactly one bounded, monitored mechanism (brief canary percentage or temporary preview-URL window, human's choice) to prove live discovery/document-roundtrip behavior against the actual deployed candidate, plus a read-only buyer-balance check — before `SUN-1222C2-FOUR-SERVICE-PAID-QUALIFICATION` can proceed.

`SUN1222C2_FOUR_SERVICE_PAID_QUALIFICATION_ELIGIBLE=NO` (pending the above; the document-retention/cron gap from C0-R1 remains a separate, already-tracked non-blocker for a *single bounded* qualification run, since that one artifact can be reclaimed manually, but it does still block canary/promotion — `DOCUMENT_RETENTION_BLOCKS_C2_PAID_QUALIFICATION=NO`, `DOCUMENT_RETENTION_BLOCKS_CANARY=YES`, `DOCUMENT_RETENTION_BLOCKS_FINAL_PROMOTION=YES`).

## Final packet

```
SUN1222C1_FOUR_SERVICE_CANDIDATE_PROVISIONING=PARTIAL
SUN1222C1_AUTHORIZATION=PRESENT
C1_START_HEAD=eaeffa7
C1_CURRENT_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
C1_CURRENT_PRODUCTION_TRAFFIC=100%
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
PRICE_FREEZE_PROVEN=YES
AUTHORITATIVE_PRICE_FREEZE_SOURCE=packages/pricing/src/service-prices.ts (EMBEDDED_PRICING v1.0.0)
COMPANY_EVIDENCE_GRAPH_V2_PRICE_USDC=0.0312   COMPANY_EVIDENCE_GRAPH_V2_AMOUNT_ATOMIC=31200
WEB_CONTEXT_VERIFIED_V2_PRICE_USDC=0.008      WEB_CONTEXT_VERIFIED_V2_AMOUNT_ATOMIC=8000
DOCUMENT_EVIDENCE_JSON_V2_PRICING_MODEL=tiered (native/ocr/table/max_job)  DOCUMENT_EVIDENCE_JSON_V2_QUALIFICATION_AMOUNT_ATOMIC=9800
VERIFY_AGENT_OUTPUT_V2_PRICE_USDC=0.017       VERIFY_AGENT_OUTPUT_V2_AMOUNT_ATOMIC=17000
COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
WEBCTX_V2_PRODUCTION_FIXTURE_REACHABLE=NO
DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE=NO
VERIFY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
DOCUMENT_R2_BUCKET_PRESENT=YES
DOCUMENT_MODAL_RESOURCE_PRESENT=YES
DOCUMENT_MODAL_CREDENTIAL_READY=YES
WEBCTX_MODAL_DEPENDENCY_READY=YES
COMPANY_EXTERNAL_DEPENDENCIES_READY=YES
VERIFY_EXTERNAL_DEPENDENCIES_READY=YES
C1_WORKFLOW_HOST_READY=YES
PENDING_MIGRATION_COUNT=1
C0_R1_ADMISSION_MIGRATION=0008_document_ingress_admission_windows.sql
PRODUCTION_D1_MIGRATION_OPERATIONS=1
C1_D1_MIGRATION_READBACK=PASS
DOCUMENT_RECLAMATION_IMPLEMENTED=YES
DOCUMENT_RECLAMATION_LIVE_SCHEDULED=NO
DOCUMENT_RETENTION_PRODUCTION_BLOCKER=YES
CANDIDATE_SOURCE_HEAD=eaeffa7
NEW_CREDENTIALS_CREATED=0
ROTATED_CREDENTIALS=0
CANDIDATE_DRY_RUN=PASS
CANDIDATE_UPLOADS=1
C1_CANDIDATE_VERSION_ID=8ce8cb66-f388-4fcc-b3e6-9c14b4919a93
C1_CANDIDATE_VERSION_READBACK=PASS
DEPLOYMENT_STATE_MUTATIONS=1
C1_TRAFFIC_READBACK=PASS
C1_CANDIDATE_DISCOVERY=NOT_EXECUTED
C1_FOUR_SERVICE_DISCOVERY_COHERENCE=NOT_EXECUTED
C1_DOCUMENT_SYNTHETIC_UPLOADS=0
C1_DOCUMENT_R2_ROUNDTRIP=NOT_EXECUTED
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_POSTS=0
FACILITATOR_SETTLE_CALLS_CREATED_BY_C1=0
CHAIN_TRANSACTIONS_CREATED_BY_C1=0
C1_BUYER_BALANCE_ATOMIC=NOT_READ_THIS_CHECKPOINT
C1_FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=66000
DOCUMENT_RETENTION_BLOCKS_C2_PAID_QUALIFICATION=NO
DOCUMENT_RETENTION_BLOCKS_CANARY=YES
DOCUMENT_RETENTION_BLOCKS_FINAL_PROMOTION=YES
SUN1222C2_FOUR_SERVICE_PAID_QUALIFICATION_ELIGIBLE=NO
C1_EVIDENCE_COMMIT_SHA=<set on commit, see below>
WORKING_TREE=clean
NEXT_REQUIRED_CHECKPOINT=SUN-1222C1-R2-CANDIDATE-LIVE-VERIFICATION
```
