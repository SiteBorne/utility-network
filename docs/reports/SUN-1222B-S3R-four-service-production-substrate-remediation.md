# SUN-1222B-S3R — Four-Service Production Substrate Remediation

**Scope**: repo-only. Zero production mutations, zero economic transactions, zero external deployments (`modal deploy`, `wrangler deploy`, R2 bucket creation) performed or attempted.

**Start**: HEAD `605e786` (SUN-1222B-S3, `SUN1222B_S3=PARTIAL`, `FOUR_SERVICE_DEPLOY_READY=NO`), working tree clean.

## 1. Root causes (confirmed by direct source inspection)

**`company_evidence_graph.v2`**: the underlying business service (`CompanyEvidenceGraphService`) and every dependency it needs (`SecSubmissionsAdapter`, `PublicHttpAdapter`, `FederalRegisterAdapter`) already exist and are already used in production by other services. SEC EDGAR/Federal Register need no new credential. `company_evidence_graph.v2`'s `website_evidence` field group fetches an arbitrary buyer-supplied URL — the identical SSRF profile `web_context_verified.v2`'s direct retrieval already has, and already solves via a dedicated off-Cloudflare Modal safe-egress executor (`MODAL_WEBCTX_*`). **Verdict: `REPO_IMPLEMENTABLE=YES`, `EXTERNAL_BLOCKER=NO`.**

**`document_evidence_json.v2`**: two independent, genuine, pre-existing external blockers, both confirmed by direct source inspection, neither newly discovered by narration:
1. `services/modal-worker/src/modal_worker/modal_app.py`'s only existing entry point (`process_document`) has no HTTP endpoint at all — it's a plain Modal function callable only via Modal's own SDK, which Cloudflare Workers cannot use — and depends on `_ModalArtifactAccessor`, explicitly `NotImplementedError` pending SUN-0400B. `modal deploy` has never been run (module docstring: "SUN-0400B (blocked_external) owns actually running `modal deploy`").
2. Even with an HTTP endpoint, `DocumentEvidenceJsonService.execute` genuinely calls `context.artifact_store.getContent(...)` — unlike the other three services, whose artifact store is provably unreachable. The real R2-backed implementation (`R2ArtifactStoreAdapter`) already exists in `apps/edge-api/src/control-plane/artifacts/store.ts` but is **unwired**: `ARTIFACTS` has been commented out of `wrangler.toml` since SUN-0800B checkpoint 3 ("needs dashboard enablement first") — a real Cloudflare-account action, not a repo change.

## 2. `company_evidence_graph.v2` — real production executor (built, tested)

New files, mirroring `web_context_verified.v2`'s exact architecture:
- [`company-evidence-graph-v2-production-executor.ts`](../../apps/edge-api/src/control-plane/production/company-evidence-graph-v2-production-executor.ts) — real (`execution_mode: 'live'`) executor against the unmodified `CompanyEvidenceGraphService`, wired to `SecSubmissionsAdapter`/`PublicHttpAdapter`/`FederalRegisterAdapter`, all sharing one injected `httpClient`.
- [`company-evidence-graph-v2-cdp-composition.ts`](../../apps/edge-api/src/control-plane/production/company-evidence-graph-v2-cdp-composition.ts) — production route composition. **Deliberately reuses the already-deployed `MODAL_WEBCTX_*` safe-egress endpoint** rather than standing up a second, functionally-identical off-Cloudflare egress deployment — it is a general arbitrary-URL proxy, not scoped to `web_context_verified.v2`'s own request shape.
- [`production-company-evidence-v2-cdp-route.ts`](../../apps/edge-api/src/control-plane/routes/production-company-evidence-v2-cdp-route.ts) — mounted at `POST /v2/company/evidence-graph` in `index.ts`, gated by `PAID_ROUTES_ENABLED` + `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`.
- Wired into `EFFECTIVE_DISCOVERY_RESOLVERS` (`production-payment.ts`) so `/catalog`/A2A/MCP discovery correctly reflects the new real composition.

**Real pricing found, not invented**: `resolveServiceMaxPriceUsd('company_evidence_graph')` reads **$0.039 / 39,000 atomic** from `governance/RISK_LIMITS.yaml` — the actual enforced runtime price. This differs from `registry/services/company_evidence_graph.v2.json`'s `maximum_price` field (`0.19`), which SUN-1222B-S3 already found drifted from governance and is purely informational metadata never consulted by the real pricing path (confirmed: `outputSchemaHash` in the same registry file is similarly informational, never enforced).

**Second, new drift finding**: `web-context-v2-cdp-composition.ts` and `verify-agent-output-v2-cdp-composition.ts`'s `outputSchemaHash` constants reference the 1.0.0-only schema hash instead of the real, distinct 2.0.0 schema hash (`contracts/releases/2.0.0/schemas/services/*-output.schema.json` differs from 1.0.0's: `service_id`/`service_version` widen from `const` to `enum`). Cosmetic only — `output_schema_hash` is reported metadata, never used to validate the actual output payload (real validation goes through `outputValidatorsById`, independent of this field). Pre-existing on already-shipped production routes; out of scope to fix here. `company_evidence_graph.v2`'s new composition uses the **correct**, freshly-computed 2.0.0 hash.

**RED → GREEN → restored-GREEN** (genuine, not narrated): moved the two new source files out, ran the composition test suite (`Cannot find module` — RED), restored them (5/5 GREEN), reran to confirm the restore (5/5 GREEN again).

**Tests** (`company-evidence-graph-v2-cdp-composition.test.ts`, 5/5 pass): exact governance-enforced 39,000-atomic contract at `/v2/company/evidence-graph`; never charges the drifted 190,000-atomic registry value; fails closed (unavailable) when `MODAL_WEBCTX_*` is missing; route-flag gating proven independently.

## 3. `document_evidence_json.v2` — Worker-reachable Modal endpoint + TS bridge (built, tested; deployment remains blocked)

### 3a. New Modal HTTP entry point (Python, repo-only)

`local_runner.py`'s own `InMemoryArtifactAccessor` pattern (used by every existing test and the local CLI) needs no R2/artifact-reference design at all — it registers bytes directly, in-memory, by a synthetic `artifact_id`. This is a real, already-exercised code path, not a new/unproven one. Added to `modal_app.py`:
- `DocumentWorkerHttpRequest` (strict pydantic model: `job_id`, `request_id`, `media_type`, `content_base64`, `ocr_policy`, `table_policy`).
- `process_document_http_core(payload)` — the real, directly-unit-testable request/response logic: base64-decodes, bound-checks against the frozen `MAX_DOCUMENT_BYTES` (10 MiB) contract, validates media type/policy, registers into `InMemoryArtifactAccessor`, calls the real `execute()` core, returns `WorkerResult.model_dump(mode="json")`.
- `process_document_http` — a trivial `@app.function(...) @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, docs=False)` wrapper, mirroring `webctx_safe_egress.app.fetch`'s exact, already-real Modal SDK pattern (confirmed: Modal's platform enforces the `Modal-Key`/`Modal-Secret` proxy-auth pair before this code ever runs).

**No R2 dependency introduced** — this endpoint is entirely independent of `_ModalArtifactAccessor`/SUN-0400B's R2 blocker.

**Tests** (`test_modal_wrapper.py::TestProcessDocumentHttpCore`, 7/7 pass, real): a real `native_text_one_page.pdf` fixture processed end-to-end through the actual `execute()` pipeline (extracted text verified: `"Native Text Document"`), plus malformed-request/invalid-base64/empty/oversized/unsupported-media-type/extra-field rejection, all exercised directly (not mocked) via the extracted `process_document_http_core`. Full package regression: 88/88 pass (was 81/81 before this checkpoint). `ruff check` and `mypy` clean.

### 3b. TypeScript-side bridge, executor, composition, route (built, tested)

- [`worker-bridge-http.ts`](../../packages/service-runtime/src/services/document-evidence/worker-bridge-http.ts) — `ModalDocumentWorkerBridge implements DocumentWorkerBridge`: real HTTP client, `Modal-Key`/`Modal-Secret` headers, base64 encoding, bounded timeout with `AbortController`. Fails closed at construction if any credential is missing. On any transport/HTTP/schema failure, **resolves** (never throws) a real `WorkerResult` with `status: 'failed'` and a `WorkerFailure` — matching `DocumentEvidenceJsonService.execute`'s actual consumption contract (`worker.status === 'failed'` branch), confirmed by direct source inspection before writing this class.
- [`document-evidence-json-v2-production-executor.ts`](../../apps/edge-api/src/control-plane/production/document-evidence-json-v2-production-executor.ts) — real executor against the unmodified `DocumentEvidenceJsonService`. Unlike the other three executors, `artifact_store` is genuinely wired to a real R2-backed store (a thin shape-adapter over `R2ArtifactStoreAdapter`, since edge-api's own `ArtifactStore` interface differs structurally from `@siteborne/provider-adapters`'s — only `getContent` is ever exercised, confirmed by grep). Computes real `scheme: 'upto'` post-execution pricing (`calculateDocumentUsage`/`documentUsageToAtomicUnits`) from the real captured `WorkerResult`'s real page metrics, via a thin capturing-wrapper around the injected bridge (never guesses a price).
- [`document-evidence-json-v2-cdp-composition.ts`](../../apps/edge-api/src/control-plane/production/document-evidence-json-v2-cdp-composition.ts) — fails closed (`unavailable: true`) if `artifactStore` is absent (documents the real `ARTIFACTS`/wrangler.toml blocker in the reason string) or if `MODAL_DOCWORKER_*` is absent (a **dedicated** credential set, deliberately not reusing `MODAL_WEBCTX_*` — a different Modal App).
- [`production-document-evidence-v2-cdp-route.ts`](../../apps/edge-api/src/control-plane/routes/production-document-evidence-v2-cdp-route.ts) — mounted at `POST /v2/document/evidence-json`; the one place constructing `R2ArtifactStoreAdapter` from `c.env.ARTIFACTS` (`undefined` in the deployed Worker today).

**Tests** (`document-evidence-json-v2-cdp-composition.test.ts`, 3/3 pass): unavailable without a real artifact store; unavailable without `MODAL_DOCWORKER_*` even with a real store; produces the real `scheme: 'upto'` 190,000-atomic ceiling contract at the correct path when both are present. (`worker-bridge-http.test.ts`, 7/7 pass): real header/base64 mapping proven against a captured request; every failure mode (network error, non-2xx, malformed JSON, schema mismatch, timeout) resolves a structured `WorkerResult`, never throws.

### 3c. What remains genuinely blocked

| Item | Classification | Status |
|---|---|---|
| `modal deploy` for `siteborne-document-worker` (now including `process_document_http`) | MODAL_DEPLOY | Not run. `MODAL_DEPLOY_COUNT=1` when authorized. |
| `MODAL_DOCWORKER_ENDPOINT_URL`/`PROXY_KEY`/`PROXY_SECRET` as Cloudflare Worker secrets | CLOUDFLARE_CONFIG_MUTATION | Not set. `CLOUDFLARE_SECRET_MUTATION_COUNT=3`. |
| `ARTIFACTS` R2 bucket binding (`wrangler.toml`, currently commented) | STORAGE_BINDING | Blocked on Cloudflare dashboard R2 enablement (SUN-0800B checkpoint 3), pre-existing, not newly introduced. |
| Buyer-facing artifact **upload** route (how a buyer's document bytes reach `ARTIFACTS` before referencing them by `artifact_id`) | REPO_GAP (not external) | **Genuinely does not exist yet** — a new finding from this checkpoint's root trace (`R2ArtifactStoreAdapter` was previously unwired anywhere). Real, repo-buildable work for a future checkpoint; explicitly not fabricated as solved here. |
| Worker/host redeploy to ship all of the above | CLOUDFLARE_DEPLOYMENT | Not run. |
| D1 migration | — | None required — no schema change. |

`DOCUMENT_V2_REPO_READY=YES` (real executor/bridge/composition/route/tests exist and pass), `DOCUMENT_V2_EXTERNAL_INFRA_READY=NO`, `DOCUMENT_V2_PRODUCTION_PAID_READY=NO`.

## 4. Full regression (after all of the above)

- `pnpm -w typecheck`: 23/23
- `pnpm -w build`: 12/12
- `pnpm -w lint`: 16/16
- `npx vitest run` (repo-wide): **219/219 test files pass, 2639/2639 non-skipped tests pass, 74 intentional skips**, 0 failures.
  - Three pre-existing repo-invariant "residual adjudication" sentinel tests correctly flagged the two new real composition/executor files as unaudited call sites and were updated with genuine, individually-reasoned audit blocks (not a blanket allowlist widening): `paymentRequirementExtra` file-set grew from 2→4; `buildServiceContext` `AUDITED_PATHS` grew from 2→4, each new call site independently proven to supply `clock`/`artifact_store`/`audit` as unconditional non-nullable expressions (document's `artifact_store` is a real, argument-taking call — still unconditional/non-nullable, documented as such rather than forced into the nullary pattern).
  - `multi-service-discovery.test.ts`'s MCP-health test correctly started reporting `implementation: 'real_executor'` (was `'local_fixture_verified'`) for both services — an accurate consequence of this checkpoint's discovery-resolver wiring, not a regression; `production: 'production_disabled'` (the invariant the test exists to prove) is unchanged since neither new route flag is set in that test's env fixture.
- `gitleaks git .`: 0 findings (649 commits scanned). `gitleaks dir .`: 2 findings, both in `.dev.vars` (gitignored, untracked, never committed — pre-existing, unrelated to this checkpoint).
- `wrangler versions upload --dry-run`: clean, same pre-existing unenv warnings only, all bindings resolve, no new errors.

Company/web-context/verify's real production executors continue to pass their full existing suites unmodified (no behavior change to any of the three).

## 5. Final disposition

```
SUN1222B_S3R=PARTIAL
S3R_END_HEAD=<this file's own commit>

COMPANY_V2_REAL_EXECUTOR=YES
COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
COMPANY_V2_LOCAL_E2E=PASS (5/5 composition tests, RED->GREEN proven)
COMPANY_V2_DEPLOY_READY=YES (repo-side; awaiting env credentials only)
COMPANY_EVIDENCE_GRAPH_V2_PRICE_USDC=0.039
COMPANY_EVIDENCE_GRAPH_V2_AMOUNT_ATOMIC=39000

DOCUMENT_V2_REAL_BUSINESS_PIPELINE=YES
DOCUMENT_V2_REMOTE_BRIDGE_WIRED=YES
DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE=NO
DOCUMENT_PRODUCTION_FAILS_CLOSED_WITHOUT_REMOTE=YES
DOCUMENT_V2_REPO_READY=YES
DOCUMENT_V2_EXTERNAL_INFRA_READY=NO
DOCUMENT_V2_PRODUCTION_PAID_READY=NO
DOCUMENT_EXTERNAL_UNBLOCK_MANIFEST=see section 3c

WEBCTX_V2_DEPLOY_READY=YES (unchanged from S3)
VERIFY_V2_DEPLOY_READY=YES (unchanged from S3)

FOUR_SERVICE_DEPLOY_READY=NO
BLOCKING_REASON=DOCUMENT_HEAVY_WORKER_EXTERNAL_INFRA_NOT_DEPLOYED (Modal deploy + R2 dashboard enablement + Worker secrets, none performed this checkpoint)

TYPECHECK=23/23
BUILD=12/12
LINT=16/16
TEST_FILES=219/219
TESTS_PASS=2639
TESTS_SKIPPED=74
SECRETS_SCAN=CLEAN (2 pre-existing .dev.vars findings, gitignored/untracked)
WRANGLER_DRY_RUN=CLEAN

PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0

NEXT_REQUIRED_CHECKPOINT=SUN-1222C-DOCUMENT-HEAVY-WORKER-UNBLOCK
```

No `modal deploy`. No Cloudflare deployment. No company-only production deployment. No real payment. No traffic mutation.
