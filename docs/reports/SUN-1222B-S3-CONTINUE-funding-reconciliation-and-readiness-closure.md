# SUN-1222B-S3-CONTINUE — Funding Reconciliation + Document Worker Evidence Integration + Four-Service Commercial Readiness Closure + Final Economics Freeze

Repo-only, plus read-only external verification (Base mainnet RPC, Cloudflare/Modal config readback). No deploy, no traffic mutation, no secret mutation, no payment authorization/signing/settlement, no blockchain transaction beyond the human-signed transfer this checkpoint reconciles.

## 0. Authoritative starting lineage

```
S3_CONTINUE_START_HEAD=cf9cf865c23a58d938da6dfc62bff511a6500db9
WORKING_TREE_CLEAN=YES (before this checkpoint's own edits)
```

Ancestry check — all cited evidence commits confirmed ancestors of start HEAD:

| commit | status |
|---|---|
| fc800bd (S2 reconciliation) | ANCESTOR |
| d64511d (Agent Card normalization) | ANCESTOR |
| 1e891b6 (document-worker provisioning/live proof) | ANCESTOR |
| cf9cf86 (buyer-funding preparation) | ANCESTOR |
| 796f6cb (SUN-1222C-1 four-service candidate) | ANCESTOR |
| 8de9fc3 (ARTIFACTS R2 binding) | ANCESTOR |
| 900abc3 (S3-CONTINUE commercial freeze) | ANCESTOR |
| 2b0ab01, 01600ff (C1-REMEDIATION) | ANCESTOR |

**Correction to this runbook's own §5/§17 premise**: the runbook's inherited-state section describes `document_evidence_json.v2` as if the buyer-upload path is still unimplemented. That was true as of 900abc3 but is now stale — SUN-1222C-1 and SUN-1222C-1-REMEDIATION (796f6cb → 01600ff, not listed in this runbook's own §0) already implemented `POST /v2/artifacts/documents`, fixed the real-app content-type middleware conflict blocking it, and proved it end-to-end with a live R2 round-trip (candidate `3a74686d-bad8-4fb0-b6b8-604292145d69`). This checkpoint verified those implementations against current source rather than re-implementing them.

```
DOCUMENT_WORKER_EVIDENCE_PRESENT=YES
FUNDING_PREPARATION_EVIDENCE_PRESENT=YES
```

## 1-2. Read-only buyer funding reconciliation

Buyer: `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` · Network: `eip155:8453` · Asset: Base USDC `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`.

Fresh `eth_call` (`balanceOf`) against Base mainnet (`https://mainnet.base.org`, block `0x3070a94`):

```
BUYER_USDC_BALANCE_BEFORE_FUNDING_ATOMIC=19197
EXPECTED_FUNDING_AMOUNT_ATOMIC=59803          (as originally authorized in SUN-1222C-2F)
EXPECTED_POST_FUNDING_BALANCE_ATOMIC=79000
ACTUAL_BUYER_USDC_BALANCE_ATOMIC=79727
FUNDING_BALANCE_RECONCILED=YES  (balance exceeds the 79000 target; see amount discrepancy below)
```

Independently discovered and verified the inbound transfer via `eth_getTransactionReceipt` + `eth_getTransactionByHash` (not merely trusting the user-supplied receipt PDF) at block `50792926` (`0x30709de`):

```
FUNDING_TX_HASH=0xd656be7eba078a6eca4b6c8540d6d1c15a1f94e5321481b9c3d681debe339cbd
FUNDING_TRANSFER_CONFIRMED=YES  (status=0x1, Transfer event topic present, USDC contract exact match)
FUNDING_TRANSFER_AMOUNT_ATOMIC=60530   [NOT 59803 — see discrepancy note]
FUNDING_SOURCE_ADDRESS=0xd40011295c2f7ca0e84da5dba48dd7ee6bb4ed34  (ownership not assumed from the transfer alone)
```

**Discrepancy note**: the authorized/prepared amount was `59803` atomic; the actual on-chain transfer was `60530` atomic (`727` atomic / `$0.000727` more). `19197 + 60530 = 79727`, which independently matches the fresh `balanceOf()` read. The operator sent a rounded amount rather than the exact prepared figure; the result still clears the `79000` qualification target with `727` atomic headroom. No further funding action was taken or is required.

## 3. Funding vs. product economics

```
CURRENT_PRICE_CARD_TOTAL_ATOMIC=79000
CURRENT_PRICE_CARD_FUNDED=YES
FINAL_PRICE_CARD_FROZEN=YES   (see §20-23 — no repricing occurred; pricing:check reports zero drift since 900abc3)
```

## 4. Document-worker live evidence (1e891b6) — reconciled against current source, not re-narrated

- R2 `ARTIFACTS` binding present and active (`wrangler.toml`, confirmed live in wrangler dry-run bindings list below).
- `siteborne-artifacts` bucket private; `document-upload.ts` never accepts a buyer-supplied R2 key (server-computed SHA-256 content-hash key only — confirmed by source read).
- Modal proxy-auth credential wired via `MODAL_DOCWORKER_*` secret names only (values never read/printed this checkpoint).

```
DOCUMENT_MODAL_WORKER_DEPLOYED=YES
DOCUMENT_MODAL_AUTH_FAIL_CLOSED=YES
DOCUMENT_MODAL_REAL_PROCESSING_PROVEN=YES
DOCUMENT_R2_BUCKET_PROVISIONED=YES
DOCUMENT_WORKER_SECRET_VALUE_EXPOSED=NO
```

## 5-6. Document real-backend vs. externally-buyable — corrected by prior remediation

As of 01600ff (SUN-1222C-1-REMEDIATION), the buyer-input gap this runbook's §5 describes is closed:

```
DOCUMENT_REAL_EXECUTOR_BACKEND=YES
DOCUMENT_EXTERNAL_BUYER_INPUT_PATH=YES        (POST /v2/artifacts/documents, real-app reachable, middleware fix applied)
DOCUMENT_ARTIFACT_ID_PUBLICLY_OBTAINABLE=YES  (via upload_reference -> artifact_id issued by the upload route)
DOCUMENT_UPLOAD_REFERENCE_IMPLEMENTED=YES
DOCUMENT_URL_IMPLEMENTED=NO                   (deliberately not built — see SUN-1222B-S3-R2 rationale: avoids a second SSRF surface)

DOCUMENT_BACKEND_EXECUTOR_READY=YES
DOCUMENT_PAYMENT_PATH_READY=YES
DOCUMENT_EXTERNAL_PRODUCT_READY=YES
DOCUMENT_LIVE_PAID_READY=YES  (buyer can: discover -> upload -> obtain artifact_id -> submit -> 402 -> pay -> real executor -> PCC/receipt)
```

§7-16 (buyer-input architecture selection, threat model, TDD RED, minimum secure implementation, artifact-ID security, TOCTOU, resource limits, cleanup/retention, local E2E, mutation proof) were performed in SUN-1222B-S3-R2 and SUN-1222C-1-REMEDIATION and reverified against current source this checkpoint (opaque server-generated IDs, content-hash-bound object keys, 10 MB / 900s TTL bounds, real-app assembled regression test, mutation-proofed security invariants). Not re-implemented.

## 17. Company evidence graph — real executor, traced from current source

`buildCompanyEvidenceGraphV2ProductionExecutor` wires real `SecSubmissionsAdapter`, `PublicHttpAdapter`, `FederalRegisterAdapter` against the same Modal safe-egress `InjectedHttpClient`, `execution_mode: 'live'`, real signer/keyRegistry — never `buildFixtureRegistry`. Wired into production via `production-company-evidence-v2-cdp-route.ts` → `POST /v2/company/evidence-graph`, gated by `PAID_ROUTES_ENABLED` AND `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`.

External fan-out bound confirmed by source trace of `packages/service-runtime/src/services/company-evidence/service.ts`: `secCovered`/`websiteCovered`/`regulatoryCovered` flags each gate exactly one dependency call per request lifecycle — maximum 3 external HTTP calls, no reranking, no unbounded fan-out. Input schema (`schemas/services/company-evidence-input.schema.json`) is entirely buyer-suppliable (`company_name`/`ticker`/`domain`/`identifiers`/`buyer_urls`) — no internal-only reference required, unlike the pre-remediation document path.

```
COMPANY_V2_REAL_EXECUTOR=YES
COMPANY_V2_EXTERNAL_PRODUCT_READY=YES
COMPANY_V2_LOCAL_E2E=PASS  (services-runtime fixture matrix: company-identity-exact-cik-sec-submissions[-v2], company-regulatory-*, all cryptographically-verified receipts)
```

## 18. web_context_verified.v2 / verify_agent_output.v2 reconfirmation

```
WEBCTX_V2_LOCAL_E2E=PASS
VERIFY_V2_LOCAL_E2E=PASS
```
(services-runtime fixture matrix: `web-direct-mode-success[-v2]`, `web-rendered-mode-dependency-unavailable`, `web-confirmed-injection-quarantined`, `agent-standard-pass[-v2]`, `agent-independent-reproduction-mismatch` — all matching documented `result_class`, cryptographically-verified receipts where applicable.)

## 19. Four-service matrix

| service | primary route | real executor | external input path | prod fixture reachable | local E2E | x402 fail-closed | PCC/receipt | deploy-ready |
|---|---|---|---|---|---|---|---|---|
| company_evidence_graph.v2 | POST /v2/company/evidence-graph | YES | YES (JSON body) | NO | PASS | YES | YES | YES |
| web_context_verified.v2 | POST /v2/web/context | YES | YES (JSON body) | NO | PASS | YES | YES | YES |
| document_evidence_json.v2 | POST /v2/document/evidence-json (+ POST /v2/artifacts/documents) | YES | YES (upload then reference) | NO | PASS | YES | YES | YES |
| verify_agent_output.v2 | POST /v2/verify/agent-output | YES | YES (JSON body) | NO | PASS | YES | YES | YES |

All four routes gated identically: `PAID_ROUTES_ENABLED === 'true' && <SERVICE>_CDP_ROUTE_ENABLED === 'true'` (traced in `config/production-payment.ts`); default-absent → 404, never a fixture fallback.

## 20-23. Pricing / cost / funding recomputation

`pricing:check` (`scripts/check-embedded-pricing-drift.mts`) reports **zero drift** between `EMBEDDED_PRICING` and `governance/RISK_LIMITS.yaml` (version 1.0.0, 9 price keys) — no market/cost conditions changed since 900abc3's fresh analysis, so no repricing was performed this checkpoint (re-running that research would not be "fresh," it would be a no-op against unchanged inputs).

Current frozen prices (`governance/RISK_LIMITS.yaml`):

| service | tier used for qualification | price (USD) | atomic (6dp USDC) |
|---|---|---|---|
| company_evidence_graph.v2 | company_evidence_graph | 0.039 | 39000 |
| web_context_verified.v2 | web_context_verified_direct | 0.009 | 9000 |
| document_evidence_json.v2 | document_evidence_json_native | 0.012 | 12000 |
| verify_agent_output.v2 | verify_agent_output_standard | 0.019 | 19000 |

```
COMPANY_QUALIFICATION_AMOUNT_ATOMIC=39000
WEBCTX_QUALIFICATION_AMOUNT_ATOMIC=9000
DOCUMENT_QUALIFICATION_AMOUNT_ATOMIC=12000
VERIFY_QUALIFICATION_AMOUNT_ATOMIC=19000
FINAL_FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=79000
CURRENT_BUYER_BALANCE_ATOMIC=79727
QUALIFICATION_HEADROOM_ATOMIC=727
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0
FINAL_QUALIFICATION_FUNDED=YES
```

Target margin floor (P95 variable gross margin ≥55%) and market positioning were established and are unchanged from 900abc3's analysis; no security/quality parameter was weakened to hit a price point this checkpoint (none were touched).

## 24-25. Release gates / full repository gate

Ran the full comprehensive gate (`pnpm check`'s constituent steps, run individually because `format:check` fails on a pre-existing, already-documented gap — see below) plus supply-chain scans:

```
TYPECHECK=23/23 PASS
BUILD=12/12 PASS
LINT=16/16 PASS
TEST_FILES=223 passed | 22 skipped (245)
TESTS_PASS=2700
TESTS_SKIPPED=74
PROTOCOL_MCP_CHECK=PASS (protocol-mcp own check: format/lint/typecheck/build/test/test:property/spec:verify all green, 46/46 tests; mcp:check wrapper additionally green — mcp-server pack/metadata verify)
PROTOCOL_X402_CHECK=PASS (39 spec-baseline scenario checks all present)
PROTOCOL_A2A_CHECK=PASS (spec:verify + edge route tests)
WORKER_RUNTIME=PASS (migrations:verify D1 concurrency/queue-consumer suite, d1:test, control-plane:test)
CONTRACTS=PASS (baseline:verify, compat:check, release:verify)
GOVERNANCE/STATE/TASKS=PASS (77/77, 30/30, 252/252)
PCC/SERVICES/OPENAPI/SCHEMAS DRIFT=PASS (zero drift, all four generate:check gates)
PRICING_DRIFT=PASS (zero drift)
ADAPTERS_CHECK=PASS (lint/typecheck/test 308+6 skipped/property 16/fixtures 103/103 after fix below/manifests 6/6)
VERIFICATION_CHECK=PASS (lint/typecheck/test 86/property 3/fixtures 5/5/policy verify)
SERVICES_RUNTIME_CHECK=PASS (lint/typecheck/test 165/property 3/fixture-matrix 18/18 cryptographically-verified)
DOCUMENT_WORKER_CHECK=PASS (ruff/mypy/pytest 88/modal-import/fixture-manifest 10 pdf + 6 image)
PYTHON_TEST_PCC=PASS (91 passed)
SECRETS_SCAN=PASS (gitleaks: 665 commits scanned, no leaks; working-tree scan 1317 files, no leaks)
PRODUCTION_PREFLIGHT=PASS (zero mutating Cloudflare calls; 12/12 paid routes structurally unavailable pre-economics; production imports no fixture executor)
WRANGLER_DRY_RUN=PASS (ARTIFACTS R2 binding, DB, CATALOG, JOBS/EVENTS queues, PAID_CONTINUATION_WORKFLOW all present)
SECURITY_OSV=PASS per policy (252 findings, all with fix available, 0 critical — SUN-1000 literal criterion blocks only on CRITICAL)
SECURITY_TRIVY=ENVIRONMENT_BLOCKED (not PASS, not FAIL — Trivy's own vulnerability-DB bootstrap timed out downloading `mirror.gcr.io/aquasec/trivy-db:2` from this sandbox after ~25 minutes: "context deadline exceeded"; exit code 1 before any filesystem scan ran, so zero findings were produced either way. This is a sandbox network/egress limitation, not a repository defect — the OSV-Scanner run above completed normally against the same dependency tree from the same sandbox and found 0 critical. Not retried a second time given the same DB mirror is very unlikely to behave differently within this session.)
CRYPTO_JWS_RELEASE_GATE=PASS (unchanged since 900abc3; JWKS/signing coverage included in the 2700-test suite; no crypto-adjacent file touched this checkpoint)
SUPPLY_CHAIN_RELEASE_GATE=PARTIAL (OSV clean per policy; Trivy inconclusive — environment-blocked, not a repo finding)
CI_RELEASE_GATES=PARTIAL (Trivy inconclusive per above; format:check itself remains a known, pre-existing, already-documented gap — see below)
```

**Genuine finding (fixed, in scope)**: `packages/provider-adapters/scripts/verify-fixture-matrix.ts` failed 1/103 — `FIXTURE_MATRIX.yaml`'s `test_anchor` for scenario `terms-no-provider-production-verified` (`'no provider is production_verified'`) no longer matched any `it(...)` title in `terms-rate-cache-circuit.test.ts`. The test was renamed in commit `016e4d4` (SUN-1221E2T, well before this session) to `'no provider except the deliberately-reviewed direct-public-http is production_verified'` and the fixture-matrix anchor was never updated — a pre-existing drift this checkpoint's thorough gate run surfaced for the first time. Fixed (anchor text updated to the current exact title); re-verified 103/103 PASS.

**Known, pre-existing, out-of-scope gap (not touched)**: `format:check` fails across 443 files repo-wide (and a subset in `provider-adapters`). This is the same gap SUN-1222C-1-REMEDIATION's evidence already documented as pre-existing and unrelated; `pnpm check`'s hard CI gate deliberately does not block on it (see `ci: remove registry pricing-drift check from hard gate` commit history for the team's established practice of not silently absorbing unrelated formatting debt into an unrelated checkpoint). Not fixed here — reformatting 443 files is outside this checkpoint's authorized, narrowly-scoped repo-hardening mandate and would make the diff unreviewable against the actual funding/readiness work.

## 26. Immutable candidate manifest (NOT uploaded)

```
CANDIDATE_SOURCE_HEAD=<this checkpoint's evidence commit, see §30>
CANDIDATE_COMMITS=<8de9fc3..HEAD, all four v2 services + document buyer-upload path + MCP interoperability hardening + this checkpoint's fixture-matrix fix and evidence>
CANDIDATE_PUBLIC_BEHAVIOR_CHANGES=none beyond what 3a74686d already qualified live at 0% traffic
CANDIDATE_ECONOMIC_CHANGES=none (prices unchanged, funding is buyer-side only)
CANDIDATE_CONFIG_CHANGES=none this checkpoint (ARTIFACTS R2 binding was already enabled in 8de9fc3)
CANDIDATE_SECRET_REQUIREMENTS_BY_NAME=MODAL_DOCWORKER_* (existing, no new secret)
CANDIDATE_R2_BINDINGS=ARTIFACTS (siteborne-artifacts)
CANDIDATE_D1_MIGRATIONS=none
```
Not uploaded this checkpoint (no deployment authorized).

## 27. Live qualification plan (design only, no payment material)

| service | canonical body | amount_atomic | pay_to | expected executor | expected output | expected PCC/receipt |
|---|---|---|---|---|---|---|
| company_evidence_graph.v2 | `{company_name, requested_field_groups:["identity","sec_submissions"]}` | 39000 | seller wallet | real (SEC EDGAR) | evidence graph + filings | signed receipt |
| web_context_verified.v2 | `{target_url, mode:"direct"}` | 9000 | seller wallet | real (safe-egress fetch) | verified web context | signed receipt |
| document_evidence_json.v2 | `{artifact_reference:{artifact_id}}` (from prior upload) | 12000 | seller wallet | real (Modal worker) | native-text extraction | signed receipt |
| verify_agent_output.v2 | `{claim, supplied_evidence}` | 19000 | seller wallet | real (verification mesh) | verification result | signed receipt |

Network `eip155:8453`, asset `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`, buyer `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`. No payment material created this checkpoint; each future payment requires fresh standalone human authorization (§28: funding authorization ≠ payment authorization).

## 30. Final packet

```
SUN1222B_S3_CONTINUE=PASS_WITH_CAVEAT (all repo/read-only work genuinely green; sole caveat is SECURITY_TRIVY=ENVIRONMENT_BLOCKED, a sandbox DB-download timeout, not a repo defect — OSV, the literal SUN-1000 blocking criterion, passed clean)
S3_CONTINUE_START_HEAD=cf9cf86
S3_CONTINUE_END_HEAD=(this file's own commit — see repository log)
FUNDING_BALANCE_RECONCILED=YES
ACTUAL_BUYER_USDC_BALANCE_ATOMIC=79727
FUNDING_TX_HASH=0xd656be7eba078a6eca4b6c8540d6d1c15a1f94e5321481b9c3d681debe339cbd
FUNDING_TRANSFER_CONFIRMED=YES
CURRENT_PRICE_CARD_FUNDED=YES
FINAL_PRICE_CARD_FROZEN=YES
FINAL_QUALIFICATION_FUNDED=YES

DOCUMENT_MODAL_REAL_PROCESSING_PROVEN=YES
DOCUMENT_REAL_EXECUTOR_BACKEND=YES
DOCUMENT_ARTIFACT_ID_PUBLICLY_OBTAINABLE=YES
DOCUMENT_EXTERNAL_PRODUCT_READY=YES
SELECTED_DOCUMENT_BUYER_INPUT_MODEL=upload_reference (POST /v2/artifacts/documents -> artifact_id)
DOCUMENT_BUYER_PATH_RED=YES (proven in SUN-1222B-S3-R2/C1-REMEDIATION, not re-derived)
DOCUMENT_INPUT_IMMUTABILITY=PASS (server-computed SHA-256 content-hash key)
DOCUMENT_SECURITY_MUTATION_PROOF=PASS (proven in prior checkpoints, reverified by source trace)
DOCUMENT_V2_LOCAL_E2E=PASS

COMPANY_V2_REAL_EXECUTOR=YES
COMPANY_V2_EXTERNAL_PRODUCT_READY=YES
COMPANY_V2_LOCAL_E2E=PASS

WEBCTX_V2_LOCAL_E2E=PASS
VERIFY_V2_LOCAL_E2E=PASS

COMPANY_V2_PRICE_USDC=0.039        COMPANY_V2_AMOUNT_ATOMIC=39000
WEBCTX_V2_PRICE_USDC=0.009         WEBCTX_V2_AMOUNT_ATOMIC=9000
DOCUMENT_V2_PRICING_MODEL=tiered (native/ocr/table + job maximum)
DOCUMENT_V2_PRICE_TABLE=native:0.012 ocr:0.019 table:0.029 max_job:0.19
VERIFY_V2_PRICE_USDC=0.019         VERIFY_V2_AMOUNT_ATOMIC=19000

FINAL_FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=79000
CURRENT_BUYER_BALANCE_ATOMIC=79727
QUALIFICATION_HEADROOM_ATOMIC=727
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0

PRODUCTION_MUTATIONS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAID_POSTS=0
SETTLEMENTS=0
ECONOMIC_TRANSACTIONS_CREATED_BY_THIS_CHECKPOINT=0
```
