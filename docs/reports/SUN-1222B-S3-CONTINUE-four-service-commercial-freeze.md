# SUN-1222B-S3-CONTINUE — Four-Service Commercial Freeze & Immutable Candidate Manifest

**Status: PASS.** All four v2 services (`company_evidence_graph`,
`web_context_verified`, `document_evidence_json`, `verify_agent_output`) have
real, tested production executors with bounded external fan-out and comfortable
margins at their current, unchanged, frozen prices. One real defect was found —
a display-only registry price mismatch — and correctly **not** fixed
in-checkpoint once tracing showed the fix cascades into a frozen-contract
major-version bump outside repo-only/no-economic-action scope. A CI release-gate
audit found real, material gaps and closed the safe ones; the full repository
gate is green.

**Correction note:** an earlier attempt to publish this report accidentally
wrote a stale internal placeholder string instead of real content (a
context-bookkeeping artifact, not a data leak — no secret or credential was
involved). This is the corrected, complete version, rewritten from the session's
actual tool output rather than from that placeholder.

## 1. Authorization

Authorized in a standalone message: _"I authorize SUN-1222B-S3-CONTINUE exactly
as specified: repo-only source, test, configuration, documentation,
evidence-report, and commit mutations are authorized, together with the
explicitly specified read-only production/configuration/telemetry/balance
readbacks..."_ — explicitly excluding deployment, candidate upload, any
Cloudflare/D1/secret/registry/traffic mutation, live price changes, and any
payment/settlement/signing action, with an explicit instruction to stop and
request fresh authorization if continuing would require any of those.

## 2. Reconciliation

Start state: `HEAD=3913f9d` (SUN-1222B-S3-R3-RS evidence commit), working tree
clean. Mid-checkpoint, after a context-window reset, `git log` showed three
additional commits already present that weren't in this session's retained
reasoning trace: `4139746` (`fix(build): make release validation truthful`),
`c126c86` (`ci: enforce commercial release gates`), `e11e1bf`
(`test(x402): budget concurrent route properties`) — all authored by this
session (matching timestamps, immediately following other verified work in this
same checkpoint). Rather than trusting them blindly, each was independently
re-verified this session (§8).

## 3. Four-service real-executor matrix

Traced from source, not documentation:

| Service                     | Executor file                                      | `execution_mode` | Fixture markers                              | Route mounted                     |
| --------------------------- | -------------------------------------------------- | ---------------- | -------------------------------------------- | --------------------------------- |
| `company_evidence_graph.v2` | `company-evidence-graph-v2-production-executor.ts` | `'live'`         | none (`buildFixtureRegistry` never imported) | `POST /v2/company/evidence-graph` |
| `web_context_verified.v2`   | `web-context-v2-production-executor.ts`            | `'live'`         | none                                         | `POST /v2/web/context`            |
| `document_evidence_json.v2` | `document-evidence-json-v2-production-executor.ts` | `'live'`         | none                                         | `POST /v2/document/evidence-json` |
| `verify_agent_output.v2`    | `verify-agent-output-v2-production-executor.ts`    | `'live'`         | none                                         | `POST /v2/verify/agent-output`    |

All four routes are registered in `apps/edge-api/src/index.ts` before the
`/v2/*` wildcard 404 fallback, each independently gated by `PAID_ROUTES_ENABLED`
AND its own dedicated `*_CDP_ROUTE_ENABLED` flag.
`SERVICE_TOOL_MATRIX_V2_EXACT=PASS`: `protocol-mcp/src/constants.ts`'s
`MCP_SERVICE_TOOLS` maps exactly the four `siteborne_*` tool names to the four
v2 service IDs; `protocol-a2a/src/constants.ts` retains all eight skill IDs (v1
and v2 for all four services).

## 4. `company_evidence_graph.v2` — bounded external fan-out (traced, not assumed)

Read `packages/service-runtime/src/services/company-evidence/service.ts` in
full. Per request, at most **3** external HTTP calls are possible: one SEC EDGAR
submissions call, one call to exactly `buyer_urls[0]` (never iterates the full
array) for `website_evidence`, one Federal Register call for
`regulatory_mentions` — no reranking, no retry loop, no unbounded fan-out.
Runtime ceiling: `DEFAULT_SERVICE_BUDGET`
(`packages/service-runtime/src/types.ts`) caps `totalTimeoutMs=30_000`,
`maxDependencyCalls=20` (real usage never exceeds 3),
`maxResultBytes=5_000_000`. The composition
(`company-evidence-graph-v2-cdp-composition.ts`) deliberately reuses the
already-deployed `MODAL_WEBCTX_*` safe-egress endpoint rather than standing up a
second Modal deployment for the identical arbitrary-URL-fetch SSRF profile
`web_context_verified.v2` already has hardened.

## 5. `document_evidence_json.v2` — input-mode closure (re-verified)

Confirmed the SUN-1222B-S3-R2 buyer-upload path (commit `b3878f5`, already
committed prior to this checkpoint) is intact and unregressed:
`packages/service-runtime/src/services/document-evidence/service.ts` still
implements only `artifact_reference` directly (by design — stays
D1/R2-agnostic);
`apps/edge-api/.../document-evidence-json-v2-production-executor.ts`'s
`resolveUploadReference()` translates a buyer-supplied
`upload_reference.upload_id` (minted by `POST /v2/artifacts/documents`) into an
equivalent `artifact_reference` before calling the unmodified service — so the
PCC receipt's `sourceUri` always shows the buyer-facing capability, never an
internal R2 key. `document_url` remains declared in the frozen schema but
genuinely unimplemented (no route exists to fetch an arbitrary URL into the
artifact store) — stated truthfully, not silently faked.

**Ownership/security model** (traced from `document-upload.ts`'s own comments):
capability-based, not identity-bound — "content, not identity, is what's being
deduplicated." Whoever holds the unguessable, server-minted `upload_id` can
redeem it once, within a 900-second TTL, for content that matches its declared
`media_type`/`size_bytes`/`content_hash` exactly. This is the same security
model as an S3 presigned URL, not a buyer-wallet binding — a deliberate,
already-tested design (IDOR/enumeration and expiry are both covered by existing
tests in `document-evidence-json-v2-production-executor.test.ts`), not a gap.

## 6. Crypto / JWKS release gate — PASS

`AGENT_CARD_SIGNING_PRIVATE_KEY` (ES256/P-256 JWK, `packages/protocol-a2a`) and
`PAID_RECEIPT_SIGNING_PRIVATE_KEY` (Ed25519, `packages/verification`) are
confirmed genuinely distinct key materials — `env.ts`'s own doc comment:
"distinct from `AGENT_CARD_SIGNING_PRIVATE_KEY` (different key...)". The
`/.well-known/jwks.json` route (`protocol-a2a/src/transport.ts:152`) serves
`identity.jwks`, constructed in `signing.ts` from a `publicJwk` derived
separately from the private key — the file's own comment states "only the
derived PUBLIC key ever leaves this function, via `.jwks`" — confirmed by
reading the construction path, not merely trusting the comment.

## 7. Supply-chain release gate — PASS (residuals traced, not hand-waved)

`pnpm audit --prod`: 7 findings (0 critical, 0 high, 5 moderate, 2 low). Traced
reachability against the **actual production Worker bundle**
(`wrangler deploy --dry-run`, then grepped the real output JS), not assumed:

- `qs`/`body-parser` (moderate/low, via `@a2a-js/sdk`'s `express` peer dep):
  SITEBORNE only ever imports from `@a2a-js/sdk`'s top-level `.` export (types,
  constants, signing helpers) — never `./server/express`. Confirmed by grepping
  the actual bundled `index.js`: zero occurrences of `body-parser` or `qs/lib`;
  the only `express` substring matches are `regular-expressions` in an unrelated
  string and a pnpm-store _directory name_ baked into a sourcemap comment.
  **Confirmed unreachable — not bundled at all.**
- `@types/uuid`'s transitive `uuid` advisory: a types-only package, no runtime
  code ships. **Unreachable.**
- `ajv` `$data`-option ReDoS (moderate): genuinely bundled (177 real matches in
  the Worker JS), but only ever invoked internally by `@coinbase/cdp-sdk`'s own
  schema validation — not something SITEBORNE code constructs or controls, and
  not fed attacker-controlled schemas directly. Tracked, not exploitable via any
  known SITEBORNE-owned request path.
- `yaml` stack-overflow-on-deep-nesting (moderate): genuinely bundled (used by
  `@siteborne/pricing` to parse `governance/RISK_LIMITS.yaml`), but its **sole
  call site** parses a static, repo-committed file — never buyer/attacker input.
  Not exploitable via any external request.

`SUPPLY_CHAIN_RELEASE_GATE=PASS`; recommend tracking upstream
`@coinbase/cdp-sdk`/`@a2a-js/sdk` releases, not release-blocking today.

## 8. CI release-gate audit — real gaps found and closed

`.github/workflows/ci.yml` previously ran only format/lint/typecheck/test plus
governance/state/tasks validation and three package-level composite checks
(adapters/verification/services-runtime) — it did **not** enforce `pnpm build`,
any schema/OpenAPI/PCC/contract drift check, the
`x402:check`/`mcp:check`/`a2a:check`/`nevermined:check` protocol composites, D1
migration verification, an offline production-config preflight, or the
real-`workerd` release harness. A broken schema, a stale generated OpenAPI file,
or a genuinely broken `pnpm build` could all have merged undetected.

Closed (all individually verified passing locally before being wired in):
`pnpm build`, `pcc:generate:check`, `schemas:check`, `services:generate:check`,
`openapi:generate:check`, `pricing:check`, `contracts:baseline:verify`,
`contracts:compat:check`, `contracts:release:verify`, `migrations:verify`,
`production:preflight --config-only` (a new, verified flag added to
`scripts/production-preflight.mts` that exits after the two credential-free
config layers — binding presence, `[vars]` presence — without ever calling
`wrangler secret list`, so it needs no Cloudflare credentials in CI),
`x402:check`, `mcp:check`, `a2a:check`, `nevermined:check`,
`test:worker-runtime` (the real-`workerd`, real-`wrangler dry-run` harness —
confirmed by its own doc comment and by running it fresh this session: "No
remote Cloudflare access. No real credentials. No live CDP calls, ever" — 99/99
scenarios passed).

**One step was added and then had to be removed this session**:
`pricing:registry:check` was wired in by the earlier (pre-reset) portion of this
checkpoint, but it **currently fails for real** (§9) — leaving it in would have
permanently broken CI. Verified the failure directly, removed the step, and left
a doc comment in `ci.yml` explaining exactly why and pointing at this report,
rather than silently dropping it.

`wrangler deploy --dry-run` and `production:preflight`'s credentialed Layer 3
were deliberately **not** added to CI — they need real Cloudflare secrets this
session cannot verify are provisioned in the GitHub Actions environment, and
provisioning new CI secrets is outside repo-only scope.

## 9. The three pre-existing commits — independently re-verified this session

- **`4139746` (`fix(build): make release validation truthful`)**: removed a
  stray `"rootDir": "src"` from `packages/test-fixtures/tsconfig.json`
  (verified: `pnpm --filter @siteborne/test-fixtures build` now passes clean)
  and fixed the previously-known, previously-untracked mypy gap in
  `services/modal-worker/tests/test_modal_wrapper.py` (proper `Callable`/ `cast`
  typing, `json.loads(bytes(body))` instead of the untyped `json.loads(body)`).
  Re-ran `mypy .` over the whole `modal-worker` package fresh this session:
  **"Success: no issues found in 36 source files."** Re-ran
  `pytest tests/test_modal_wrapper.py`: **10/10 passed.**
- **`c126c86` (`ci: enforce commercial release gates`)**: the CI-hardening work
  described in §8.
- **`e11e1bf` (`test(x402): budget concurrent route properties`)**: added an
  explicit `15_000`ms timeout to the two `fc.assert`-based property tests in
  `x402-service-route.test.ts` that had been flaking under concurrent load (they
  issue multiple real D1-backed async operations per property run; the default
  5000ms budget was too tight when run immediately after the 100-request
  `load-v2.test.ts` campaign). Confirmed the fix: the full repository test suite
  (§13) now passes **222/222 test files, 0 failures** — including the exact
  sequence that previously reproduced the flake.

## 10. Registry pricing drift — found, traced, correctly left unfixed

`pnpm pricing:registry:check` (a guard script from a prior checkpoint,
`b75d91f`) reports: `registry/services/company_evidence_graph.{v1,v2}.json`'s
`maximum_price` is `0.19` — copy-paste drift from
`document_evidence_json_max_job`'s value, matching neither
`company_evidence_graph`'s own `base_price` ($0.039) nor any real governance
ceiling for this family (governance has no distinct `maximum_price` tier for
`company_evidence_graph` at all). The real charged amount is unaffected — every
quote-minting call site reads `governance/RISK_LIMITS.yaml` live via
`resolveServiceMaxPriceUsd()`, never this field — but it is exactly what
`/catalog` serves back to a buyer verbatim.

Attempted the direct fix (correcting `maximum_price` to `0.039` in both registry
files) and immediately re-ran the full generation/contract-check chain.
`services:generate:check` and `openapi:generate:check` passed clean, but
`contracts:compat:check` **failed**: the corrected value flows into
`metadata/company_evidence_graph.v2.json`, part of the **frozen** `2.0.0`
contract release snapshot, and changing it there is classified
`property_type_changed` / `required_version_bump: major` by the compatibility
checker — a real, structural, intentional governance guardrail (protecting any
existing integrator against a silent contract change), not a bug in the checker.
Since a contract major-version bump is a substantial governance action requiring
its own explicit authorization (matching `governance:validate`'s own "Schema
changes require human approval" rule) and is well outside this checkpoint's
repo-only, no-economic-action authorization, the registry edit was **reverted**
(confirmed via `git status` showing a clean tree and `contracts:compat:check`
passing again) rather than pushed through. Left as a tracked, real, unfixed
finding — not silently corrected, not silently ignored.

## 11. Fresh market research (live, this session)

- **Modal** (`modal.com/pricing`, fetched live): CPU `$0.0000131/core/sec`
  (physical core = 2 vCPU), memory `$0.00000222/GiB/sec` — GPU tiers listed but
  irrelevant here (the document worker's native-text/OCR path runs on CPU only).
  Applied to the real observed processing times from this session's own test
  runs (`~0.5s` for a 1-page native-text fixture, `~12–34s` for a 10-page OCR
  fixture, from `SubprocessDocumentWorkerBridge`'s real subprocess tests), the
  Modal compute cost per document request is on the order of **$0.0001–0.0005**
  — negligible next to the $0.001 CDP facilitator fee that already dominates the
  cost model for the other two services.
- **Exa** (`exa.ai` pricing page, fetched live): `/contents` still exactly
  `$1 / 1k pages` ($0.001/page), `/search` still `$7 / 1k requests` — unchanged
  from the prior checkpoint's research, confirming no material market drift in
  the ~1–2 weeks since.

## 12. Final price card — FROZEN, unchanged

With real executors and bounded-cost evidence now in hand for all four services
(previously only two had real executors), the responsible recommendation is to
**keep the current, already-governance-frozen prices exactly as they are** — not
to adopt any of the lower speculative hypotheses that predated real-executor
cost evidence:

| Service                     | Price(s)                                                  | Atomic (USDC, 6dp)                 |
| --------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `company_evidence_graph.v2` | $0.039                                                    | 39,000                             |
| `web_context_verified.v2`   | $0.009 direct / $0.029 rendered                           | 9,000 / 29,000                     |
| `document_evidence_json.v2` | $0.012 native / $0.019 OCR / $0.029 table / $0.19 max job | 12,000 / 19,000 / 29,000 / 190,000 |
| `verify_agent_output.v2`    | $0.019 standard / $0.049 reproduction                     | 19,000 / 49,000                    |

All four clear the governance 60% minimum / 70% target margin floor by a wide
margin given the now-measured near-zero variable compute cost plus the fixed
~$0.001 facilitator fee. `PRICE_SINGLE_SOURCE_OF_TRUTH`: embedded pricing
matches `governance/RISK_LIMITS.yaml` exactly (`pricing:check` PASS) — the one
known display-only exception is §10's registry drift, tracked and unfixed for
the stated reason.

## 13. Buyer qualification funding (read-only)

Live, read-only `eth_call` this session to Base mainnet (chain id `0x2105` =
8453, confirmed via `eth_chainId`) USDC contract
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `balanceOf` on the controlled
buyer address `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`. No transfer, no
signature, no write call.

`QUALIFICATION_BUYER_BALANCE_ATOMIC = 19,197` (0.019197 USDC) — **unchanged**
from the prior checkpoint's reading.

At current frozen prices, the smallest qualifying request per service costs
39,000 / 9,000 / 12,000 / 19,000 atomic respectively —
`FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC = 79,000`.
`QUALIFICATION_HEADROOM_ATOMIC = -59,803` (still insufficient).
`ADDITIONAL_FUNDING_REQUIRED_ATOMIC = 59,803` minimum (more once gas/facilitator
overhead is included). Prices were not lowered to fit the wallet, per
instruction. Unlike the prior checkpoint, company/document qualification
payments are no longer blocked by "no production executor" — only by funding and
by the production-activation gaps in §15.

## 14. Full repository gate — GREEN

- **Tests**: `pnpm test` (root vitest, full monorepo glob) — **222/244 test
  files passed, 22 correctly skipped (live/paid); 2690/2764 tests passed, 74
  correctly skipped; 0 failed.** (An earlier run in this same session hit
  exactly 1 flaky timeout in `x402-service-route.test.ts` immediately after the
  100-request load campaign; §9's `e11e1bf` fix resolved it — this final run,
  with that fix in place, is clean.)
- **Typecheck**: `pnpm typecheck` (turbo, 23 packages) — all pass.
- **Lint**: `pnpm lint` (turbo, 16 packages) — all pass.
- **Build**: `pnpm build` — all 12 buildable packages pass (this is the gate
  §9's `4139746` fix made truthful).
- **Format**: `.github/workflows/ci.yml` and this report both pass
  `prettier --check`.
- **Secrets**: `gitleaks detect --source . --log-opts="--all"` — **659 commits
  scanned, no leaks found.**
- **Production preflight**: `pnpm production:preflight --config-only` — PASS
  (all four v2 CDP route flags confirmed absent from `wrangler.toml`, correctly
  resolving every one of the 12 paid-route configurations to a governed
  pre-economic unavailable state).
- **Wrangler dry-run**: `wrangler deploy --dry-run` succeeds, 6420.47 KiB
  upload, exits before any actual upload.

## 15. Immutable candidate manifest (designed, not built or uploaded)

`CANDIDATE_SOURCE_HEAD = HEAD (this commit)` (this report's own commit, once
committed). `CANDIDATE_COMMITS = 88078b9..HEAD (this commit)` — 26 commits,
spanning SUN-1222B/S2/S3/S3R/S3-R2/S3-R3-RS/S3-CONTINUE plus this checkpoint's
own two build-truthfulness/CI-hardening/test-budget commits.
`CANDIDATE_CONFIG_CHANGES = none live` — every change this checkpoint made is
repo-only (CI workflow, an offline preflight flag, a test timeout, this report);
nothing was deployed, and no `wrangler.toml`/secret/D1 state was touched.

**Required before this candidate could actually go live with all four services**
(traced from `wrangler.toml` and `wrangler deploy --dry-run`'s own bindings
table this session — none of this was done, all of it needs its own explicit
future authorization):

- `env.ARTIFACTS` (R2) binding — still commented out in `wrangler.toml`
  (confirmed: `grep -n ARTIFACTS wrangler.toml` shows only commented lines;
  confirmed absent from the live dry-run bindings table). The bucket itself
  (`siteborne-artifacts`) was already created and qualified in SUN-1222C-R1 —
  only the binding needs uncommenting.
- Four route-enable flags, all currently absent from `wrangler.toml` `[vars]`
  (confirmed by grep): `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`,
  `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED`,
  `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED`, plus `PAID_ROUTES_ENABLED` itself if
  not already set.
  `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`/`VERIFY_V2_CDP_ROUTE_ENABLED` were already
  live per the prior checkpoint's `test:worker-runtime` PHASE 9 evidence.
- `MODAL_DOCWORKER_ENDPOINT_URL`/`_PROXY_KEY`/`_PROXY_SECRET` secrets — the
  qualification token minted in SUN-1222C-R1 was securely deleted after use
  (never wired into any live Cloudflare config); a fresh token would need to be
  minted and set as a real Worker secret — an explicit credential-mutation
  action requiring its own standalone authorization, not performed here.
- `MODAL_WEBCTX_*` — already live (reused, unchanged, by
  `company_evidence_graph.v2`'s composition per §4).

None of the above was performed this checkpoint. `FUTURE_CANDIDATE_MANIFEST`: a
dedicated activation checkpoint, explicitly authorized for exactly the R2
binding + flag + secret changes above.

## 16. Final packet

```
SUN1222B_S3_CONTINUE=PASS
CONTINUE_START_HEAD=3913f9d
CONTINUE_END_HEAD=HEAD (this commit)
FOUR_SERVICE_REAL_EXECUTOR_MATRIX=PASS (company/web/document/verify all execution_mode:'live', zero fixture markers)
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
COMPANY_MAX_EXTERNAL_CALLS=3 (SEC EDGAR x1, buyer_urls[0] x1, Federal Register x1 -- no reranking, no retry loop)
COMPANY_RUNTIME_TIMEOUT_MS=30000 (DEFAULT_SERVICE_BUDGET, ceiling maxDependencyCalls=20 never approached)
DOCUMENT_IMPLEMENTED_INPUT_MODES=artifact_reference (direct), upload_reference (executor-level translation)
DOCUMENT_DECLARED_BUT_UNIMPLEMENTED_INPUT_MODES=document_url
DOCUMENT_ARTIFACT_OWNERSHIP_MODEL=opaque bearer capability, content-addressed, TTL-bound (not identity-bound; deliberate)
CRYPTO_JWKS_RELEASE_GATE=PASS (AGENT_CARD_SIGNING_PRIVATE_KEY and PAID_RECEIPT_SIGNING_PRIVATE_KEY confirmed distinct; JWKS publishes public key material only)
SUPPLY_CHAIN_RELEASE_GATE=PASS (0 critical/high; 5 moderate + 2 low, all traced -- 2 confirmed unreachable via unused @a2a-js/sdk/server/express subpath and types-only uuid, 2 bundled-but-not-attacker-reachable via governance-file-only yaml parse and CDP-SDK-internal ajv usage)
CI_RELEASE_GATE_MATERIAL_GAPS_FOUND=YES (build/schema/OpenAPI/PCC/contract-drift/protocol-composite/migration/preflight/worker-runtime checks were all previously unenforced)
CI_RELEASE_GATE_STEPS_ADDED=15 (build, pcc:generate:check, schemas:check, services:generate:check, openapi:generate:check, pricing:check, contracts:baseline:verify, contracts:compat:check, contracts:release:verify, migrations:verify, production:preflight --config-only, x402:check, mcp:check, a2a:check, nevermined:check, test:worker-runtime)
CI_STEP_ADDED_THEN_REMOVED=pricing:registry:check (verified still failing for a real, tracked, out-of-scope reason; would have permanently broken CI)
PRODUCTION_PREFLIGHT_CONFIG_ONLY_FLAG_ADDED=YES (new, verified, needs zero Cloudflare credentials)
PRE_EXISTING_COMMITS_INDEPENDENTLY_REVERIFIED=3 (4139746, c126c86, e11e1bf -- each re-run and re-confirmed passing this session, not merely trusted)
MYPY_MODAL_WORKER=PASS (36/36 source files, 0 issues -- previously-known untyped-call gap now closed)
X402_FLAKE_ROOT_CAUSED_AND_FIXED=YES (15s explicit timeout on 2 property tests, confirmed via a clean full-suite rerun)
REGISTRY_PRICE_DRIFT_FOUND=YES (company_evidence_graph.{v1,v2} maximum_price=0.19, expected 0.039)
REGISTRY_PRICE_DRIFT_FIXED=NO (correcting it is a MAJOR frozen-contract compatibility break per contracts:compat:check -- requires its own governance authorization + version bump; reverted, tracked, not silently fixed or ignored)
LIVE_CHARGED_PRICE_AFFECTED_BY_DRIFT=NO (every quote-minting call site reads governance/RISK_LIMITS.yaml live, never the registry display field)
MARKET_RESEARCH_FRESH=YES (Modal pricing, Exa pricing -- both live-fetched this session, Exa confirmed unchanged from prior checkpoint)
FINAL_PRICE_CARD=FROZEN, UNCHANGED (company=$0.039, web=$0.009/$0.029, document=$0.012/$0.019/$0.029/$0.19, verify=$0.019/$0.049)
PRICE_SINGLE_SOURCE_OF_TRUTH=PASS (embedded pricing matches governance/RISK_LIMITS.yaml exactly; registry display-only exception tracked separately above)
QUALIFICATION_BUYER_BALANCE_ATOMIC=19197 (unchanged, live-reconfirmed via read-only eth_call, Base mainnet chain id 8453)
FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=79000
QUALIFICATION_HEADROOM_ATOMIC=-59803
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=59803 (minimum; prices not lowered to fit wallet, per instruction)
FULL_REPO_TEST_FILES=222 passed, 22 skipped, 0 failed (244 total)
FULL_REPO_TESTS=2690 passed, 74 skipped, 0 failed (2764 total)
TYPECHECK=PASS (23/23 packages)
LINT=PASS (16/16 packages)
BUILD=PASS (12/12 packages)
FORMAT_CHECK=PASS (files touched this checkpoint)
SECRETS_SCAN=PASS (gitleaks, 659 commits, 0 leaks)
PRODUCTION_PREFLIGHT=PASS (--config-only, offline)
WRANGLER_DRY_RUN=PASS (6420.47 KiB, exits before upload)
CANDIDATE_SOURCE_HEAD=HEAD (this commit)
CANDIDATE_COMMITS=88078b9..HEAD (this commit) (26 commits)
CANDIDATE_CONFIG_CHANGES=none live
REQUIRED_FOR_FOUR_SERVICE_ACTIVATION=env.ARTIFACTS R2 binding (bucket already exists), 3-4 route-enable flags, MODAL_DOCWORKER_* secrets (fresh mint required, prior token securely deleted), all deliberately NOT performed this checkpoint
DEPLOYMENT_ACTIONS=0
PRODUCTION_D1_MUTATIONS=0
SECRET_MUTATIONS=0
REGISTRY_MUTATIONS=0
TRAFFIC_MUTATIONS=0
PAYMENT_AUTHORIZATIONS=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENTS=0
BLOCKCHAIN_TRANSACTIONS=0
EVIDENCE_COMMIT_SHA=HEAD (this commit)
WORKING_TREE=clean after commit
NEXT_REQUIRED_CHECKPOINT=a dedicated, explicitly-authorized four-service production activation checkpoint (R2 binding + route flags + fresh MODAL_DOCWORKER_* secret mint), OR a dedicated registry-price-drift + contract-version-bump governance checkpoint for §10/16's tracked finding
```
