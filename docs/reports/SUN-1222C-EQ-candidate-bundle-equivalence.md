# SUN-1222C-EQ — Zero-Mutation Candidate/Production Deployed-Bundle Equivalence Certification

**Checkpoint:** SUN-1222C-EQ
**Scope:** Read-only. Zero mutations of any kind.
**Objective:** Determine whether Cloudflare Worker candidate version `3a74686d-bad8-4fb0-b6b8-604292145d69` (built from commit `01600ff`, currently at 0% traffic) remains a faithful, execution-equivalent representative of the intended production artifact at current HEAD (`82de4de`), given that repository HEAD has advanced past the candidate's source commit.

---

## 0. Candidate targeting is unavailable (inherited from prior turn)

`preview_urls = false` (SUN-1207 M3 security hardening) means no zero-mutation mechanism exists to route an HTTP request to a specific 0%-traffic Worker version. This checkpoint does not attempt to resolve that; it instead asks whether the candidate can be certified equivalent to current HEAD by static/config/build analysis, so that qualification against production (byte/behavior equivalent to the candidate) is evidentially valid without needing to reach the candidate directly.

## 1. Candidate source lineage and commit classification

```
CANDIDATE_VERSION_ID     = 3a74686d-bad8-4fb0-b6b8-604292145d69
CANDIDATE_SOURCE_COMMIT  = 01600ff
CURRENT_HEAD             = 82de4de183ca267538d3ab0d0a9f58af7fd723a2
WORKING_TREE             = clean
```

`git log --oneline 01600ff..HEAD` (9 commits):

| Commit | Subject | Classification |
|---|---|---|
| cf9cf86 | SUN-1222C-2F: read-only funding preparation + reconciliation stub | DOCS_ONLY |
| b6601d4 | SUN-1222B-S3-CONTINUE: funding reconciliation + four-service readiness closure | DOCS_ONLY |
| 2d9a93d | SUN-1222C: four-service immutable candidate qualification (read-only) | DOCS_ONLY |
| 6b273f0 | SUN-1222C-QUALIFICATION-FUNDING: document ceiling proof + funding prep | DOCS_ONLY |
| eeea612 | SUN-1222C-Q0: final paid-proof inheritance analysis | DOCS_ONLY |
| 81200de | SUN-1222C-R2: audit/harden document buyer-upload path (no defect found) | DOCS_ONLY (zero code changes — audit found no defect) |
| e5ad97f | SUN-1222C-R3: document candidate qualification + fresh 402 economics freeze | DOCS_ONLY |
| ce5922a | SUN-1222C-R3B: mainnet upto one-shot client for document_evidence_json.v2 | TEST_ONLY / EXTERNAL_CONTROL_PLANE_ONLY (see §2–4) |
| 82de4de | SUN-1222C-R3B: correct self-referencing evidence commit SHA | DOCS_ONLY |

**`POST_CANDIDATE_COMMITS` = 9. Only `ce5922a` touches non-documentation files.**

`git diff --stat 01600ff..HEAD` — exactly 15 files changed, 3606 insertions(+), 1 deletion(-):

```
apps/edge-api/src/control-plane/production/document-mainnet-upto-client.binding.test.ts   | 165 ++
apps/edge-api/src/control-plane/production/document-mainnet-upto-client.test.ts           | 284 ++
apps/edge-api/src/control-plane/production/document-mainnet-upto-client.ts                | 230 ++
apps/edge-api/tests/live/document-paid-e2e-mainnet.test.ts                                | 263 ++
docs/reports/*.md (10 files)                                                              | 2550 ++
package.json                                                                              |   1 ++
packages/provider-adapters/fixtures/FIXTURE_MATRIX.yaml                                   |   1±
scripts/document-paid-e2e.ts                                                              | 112 ++
```

No changes to: `wrangler.toml`, `pnpm-lock.yaml`, `apps/edge-api/src/index.ts`, any route file, any middleware file, any pricing/service-registry file, any MCP/A2A file, any PCC/receipt file, `document-upload.ts`, `document-artifact-upload-route.ts`, any D1/R2 config, any executor file.

## 2. Entrypoint import-closure proof

Worker entrypoint: `apps/edge-api/src/index.ts` (confirmed via `apps/edge-api/wrangler.toml` `main` field, unchanged since `01600ff`).

`index.ts`'s static import list (33 imports) was read directly — it imports `documentEvidenceJsonV2CdpProductionRoute` from `./control-plane/routes/production-document-evidence-v2-cdp-route`, `documentArtifactUploadRoute`, and no reference to `control-plane/production/document-mainnet-upto-client` anywhere.

Repo-wide grep for `document-mainnet-upto-client` under `apps/edge-api/src/` found exactly one importer:

```
apps/edge-api/src/control-plane/production/document-mainnet-upto-client.test.ts:23:} from './document-mainnet-upto-client';
```

— its own unit test file. No production route, middleware, or executor file imports it, directly or transitively.

```
POST_01600FF_WORKER_REACHABLE_FILES = []
```

## 3. Dead-code claim proof

`document-mainnet-upto-client.ts`'s only importer is `document-mainnet-upto-client.test.ts` (a `*.test.ts` file, excluded from the Worker bundle by the build's own test-file exclusion and by esbuild tree-shaking, since nothing outside the test imports it). The companion CLI (`scripts/document-paid-e2e.ts`) is a standalone Node/tsx script outside `apps/edge-api` entirely, invoked only via the new `package.json` script entry (`"document-paid-e2e"`), never bundled into the Worker.

```
R3B_UPTO_IMPORTED_BY_WORKER  = NO
R3B_UPTO_BUNDLE_REACHABLE    = NO
```

## 4. Build-time side-effect check

- `package.json` diff is exactly one added line: a new npm script (`"document-paid-e2e": "tsx scripts/document-paid-e2e.ts"`). No dependency, devDependency, or build-tool version changed.
- `pnpm-lock.yaml`: **byte-unchanged** (`git diff --stat 01600ff..HEAD -- pnpm-lock.yaml` empty).
- `wrangler.toml`: **byte-unchanged** (`git diff --stat 01600ff..HEAD -- apps/edge-api/wrangler.toml` empty).
- `packages/provider-adapters/fixtures/FIXTURE_MATRIX.yaml`: a test-fixture manifest consumed only by a fixture-matrix verifier script, not bundled into the Worker.
- No `tsconfig.json`, bundler plugin, code-generation script, or environment-replacement config changed.

```
POST_01600FF_BUILD_SIDE_EFFECTS = NONE
```

## 5–7. Bundle equivalence

No literal saved copy of the exact `01600ff` build artifact exists to diff byte-for-byte (Cloudflare does not expose a mechanism to download a previously-uploaded version's compiled bundle, and none was archived locally at deployment time). Byte-identity is therefore established by **input-equivalence** rather than direct artifact diff:

- Every file that (transitively, per §2) feeds the Worker bundle — `wrangler.toml`, `pnpm-lock.yaml`, and all of `apps/edge-api/src/**` reachable from `index.ts` — is unchanged between `01600ff` and HEAD.
- The build toolchain (`tsc`/`esbuild` via `wrangler`) is deterministic given identical inputs.
- A dry-run build was executed against current HEAD to confirm it compiles cleanly and to capture reference stats:

```
HEAD_BUNDLE_SIZE  = 6420.82 KiB
HEAD_GZIP_SIZE    = 1054.30 KiB
```

Given zero input diff on every bundle-reachable file, the deployed candidate bundle and a hypothetical HEAD rebuild are equivalent by construction.

```
BUNDLE_BYTE_EQUIVALENT     = YES (by input-equivalence; no literal saved artifact to diff)
BUNDLE_SEMANTIC_EQUIVALENT = YES
```

## 8. Worker config equivalence

`wrangler.toml` byte-unchanged (§4) ⇒ bindings, vars, compatibility date/flags, routes, and `workers.dev`/`preview_urls` posture are identical.

Current dry-run binding readback (HEAD):

```
env.PAID_CONTINUATION_WORKFLOW  → Workflow (siteborne-paid-continuation-runtime)
env.CATALOG                     → KV Namespace
env.JOBS / env.EVENTS           → Queues
env.DB                          → D1 Database (siteborne-utility)
env.ARTIFACTS                   → R2 Bucket (siteborne-artifacts)
env.BROWSER, env.AI             → Bindings
env.PCC_VERSION="1.0.0", env.ENVIRONMENT="production", env.LOG_LEVEL="info",
env.AGENT_CARD_SIGNING_KEY_ID, env.NVM_ENVIRONMENT, env.SELLER_WALLET_ADDRESS
```

```
BINDING_EQUIVALENCE            = PASS
VAR_NAME_EQUIVALENCE           = PASS
ROUTE_EQUIVALENCE              = PASS
WORKFLOW_BINDING_EQUIVALENCE   = PASS
```

## 9–17. Economics / service-tool matrix / executor / trust-class / PCC guard / MCP / A2A / receipt / document-R2 equivalence

Every file governing these subsystems — `packages/pricing/**`, `control-plane/routes/production-*-cdp-route.ts`, `control-plane/routes/mcp.ts`, `control-plane/routes/a2a.ts`, PCC/receipt signing modules, `document-upload.ts`, `document-artifact-upload-route.ts` — is **absent from the `01600ff..HEAD` diff** (§1). No commit in this range touches any of them. Therefore whatever state each subsystem was in at `01600ff` (the commit the candidate was built from) is identical at current HEAD; there is no drift to detect because there is no change to those files at all.

This includes the previously hardened fixes (all landed well before `01600ff`, unmodified since):

```
CANDIDATE_EVIDENCE_MODE_FIX_PRESENT       = YES    HEAD_EVIDENCE_MODE_FIX_PRESENT       = YES   → TRUST_CLASS_BEHAVIOR_EQUIVALENT = YES
CANDIDATE_PCC_UNDEFINED_GUARD_PRESENT     = YES    HEAD_PCC_UNDEFINED_GUARD_PRESENT     = YES   → POST_SETTLEMENT_GUARD_EQUIVALENT = YES
CANDIDATE_MCP_STATELESS_PRESENT           = YES    HEAD_MCP_STATELESS_PRESENT           = YES   → MCP_EQUIVALENCE = PASS
CANDIDATE_A2A_PRODUCTION_ENABLED_FIX_PRESENT = YES CANDIDATE_AGENT_CARD_NORMALIZATION_PRESENT = YES → A2A_EQUIVALENCE = PASS
```

```
ECONOMICS_EQUIVALENCE              = PASS  (packages/pricing/** unchanged; all four v2 services' price/network/asset/payTo unchanged)
SERVICE_TOOL_MATRIX_EQUIVALENCE    = PASS  (MCP tool↔service mapping file unchanged)
EXECUTOR_EQUIVALENCE               = PASS  (all four production-*-cdp-route.ts files unchanged; no real↔fixture/provider/trust-class switch occurred)
RECEIPT_DURABILITY_EQUIVALENCE     = PASS  (receipt/PCC persistence modules unchanged)
DOCUMENT_EXECUTOR_CONFIG_EQUIVALENCE = PASS (Modal endpoint/auth-name config unchanged)
R2_BINDING_EQUIVALENCE             = PASS  (ARTIFACTS binding unchanged, confirmed live in §8 dry-run readback)
```

## 18. Hidden config drift

`wrangler.toml`, `package.json` (script-only addition), `pnpm-lock.yaml`, all schema/service registries, and all environment conditionals were checked; the only changes anywhere in the diff are the two new test-only source files, one new dead (unreachable) production-plane file, one new standalone CLI script, one fixture-matrix test-anchor string fix, and ten new evidence-report documents.

```
HIDDEN_CONFIG_DRIFT = NONE
```

## 19. Current HEAD full safe gate

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS (exit 0) |
| `pnpm build` | PASS, 12/12 tasks (exit 0) |
| `pnpm lint` | PASS (exit 0) |
| `pnpm test` | PASS — 2743 passed, 76 skipped (226 test files passed, 22 skipped) |
| `pnpm mcp:check` | PASS |
| `pnpm x402:check` | PASS |
| `pnpm a2a:check` | PASS |
| secrets scan (git history, 673 commits) | PASS — 0 leaks |
| secrets scan (working tree incl. gitignored) | 1 known finding: `.dev.vars:generic-api-key` — confirmed gitignored, never committed to git history (`git log --all -- .dev.vars` empty); same pre-existing, non-committed local-dev placeholder observed in every prior checkpoint of this engagement, not a regression |
| `pnpm production:preflight` | PASS — all bindings/vars present, preview URLs disabled, 12/12 paid routes fail-closed pre-economics, no fixture executor imported |
| `wrangler deploy --dry-run` | PASS — clean compile, bundle 6420.82 KiB / gzip 1054.30 KiB, bindings as listed in §8 |

## 20–22. Equivalence decision

Every production-relevant dimension — runtime bundle inputs, bindings/config, service mappings, executors, economics, trust-class/evidenceMode behavior, post-settlement guards, MCP, A2A, receipt durability, and document/R2 integration — is unchanged between the candidate's source commit (`01600ff`) and current HEAD (`82de4de`). The only material additions are dead code (unreachable from the Worker bundle), test files, a standalone CLI script, a fixture-manifest test-anchor correction, and documentation. Dead repository code is explicitly not drift per the decision rule; no production-path fix is missing from the candidate.

```
SUN1222C_EQ = PASS
CANDIDATE_3A74686D_CURRENTLY_USABLE = YES
```

## 23. Zero mutations performed

No deployment, candidate upload, traffic change, secret/var/D1 mutation, payment, or economic transaction occurred during this checkpoint.
