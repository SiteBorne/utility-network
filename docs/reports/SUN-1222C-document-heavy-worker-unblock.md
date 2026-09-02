# SUN-1222C — Document Heavy-Worker Unblock

**Scope**: non-economic infrastructure qualification for `document_evidence_json.v2`. Repo-only source/test changes permitted if proven required; at most one `modal deploy`; R2/secret mutation only if proven required against already-existing resources. No edge/API deployment, no candidate upload, no payment.

**Lineage**: `f35df82` (SUN-1222B-S3R) → this checkpoint. Working tree was clean and unmodified throughout — no source edits were made this checkpoint; all findings below are pure tracing, one external deployment, and verification.

## Process note on sequencing

The initial authorization for this checkpoint arrived as a plain-language grant. A much more detailed, gated version of the same checkpoint (full local-gate-before-deploy sequencing, §17→§20→§21→§22) arrived as a second, mid-turn message *after* the Modal deploy (§22 below) had already been run against the evidence available at that point: 88/88 local `services/modal-worker` pytest tests passing, a clean `import modal_worker.modal_app`, and source-proof that the deployed HTTP entry point does not depend on R2. The full monorepo gate (typecheck/build/lint/test/protocol/secrets/dry-run) was run *after* the deploy rather than before, which is a real deviation from the fuller spec's intended ordering. It is reported here rather than silently reconciled. No second deploy occurred, and none was considered — the `<=1` cap was already spent by the first deploy, and the full gate (§ below) subsequently confirmed nothing was broken by it.

## 1. Document public input contract (§4–§6)

Traced `contracts/releases/2.0.0/schemas/services/document-evidence-input.schema.json` (the frozen public schema) against `packages/service-runtime/src/services/document-evidence/service.ts`:

- The frozen schema declares **three** input modes (`oneOf`): `artifact_reference`, `upload_reference`, `document_url`.
- `service.ts:57-66` implements **only** `artifact_reference` — the code's own comment states `upload_reference`/`document_url` "are recognized by the frozen schema but not yet supported."
- `artifact_reference.artifact_id` is resolved via `context.artifact_store.getContent(id)` — i.e., the buyer must already have bytes staged in the artifact store *before* calling the paid route.
- `apps/edge-api/src/control-plane/routes/` contains **no** upload/artifact-staging route. `InMemoryArtifactStore` (`artifacts/store.ts`) implements a `put()` method, but nothing HTTP-reachable calls it for external buyers.

**DOCUMENT_INPUT_MODEL = ARTIFACT_ID** (the only implemented mode; schema declares two additional unimplemented modes).
**CAN_EXTERNAL_BUYER_SUPPLY_DOCUMENT_TODAY = NO.**
**DOCUMENT_BUYER_INPUT_BLOCKER**: no route exists for an external buyer to create an artifact and obtain an `artifact_id`; the one input mode the service implements is unreachable without one.
**DOCUMENT_UPLOAD_ROUTE_REQUIRED = YES.** **PUBLIC_DOCUMENT_INPUT_PATH_INCOMPLETE = YES** — this is a real, distinct launch blocker, independent of the R2/Modal blockers below. Not built this checkpoint (see §5 below) — deferred to `SUN-1222C-REMEDIATION` since it cannot be tested against real R2 while R2 remains disabled at the account level (§2).

## 2. R2 requirement reconciliation (§9–§11)

Traced `document-evidence-json-v2-cdp-composition.ts`, `document-evidence-json-v2-production-executor.ts`, and `service.ts`:

| Question | Answer | Evidence |
|---|---|---|
| R2_REQUIRED_FOR_DOCUMENT_INPUT | **YES** | `service.ts:66` calls `context.artifact_store.getContent(artifact_reference.artifact_id)` — the buyer's raw bytes must already be durably staged before the paid route can read them. |
| R2_REQUIRED_FOR_DOCUMENT_PROCESSING | NO | The Modal HTTP bridge (`process_document_http`) uses `InMemoryArtifactAccessor` with base64 bytes sent inline over HTTP — it never touches R2 itself (composition doc comment, confirmed against `modal_app.py`). |
| R2_REQUIRED_FOR_DOCUMENT_OUTPUT | NO | `WorkerResult` is returned directly in the paid HTTP response body; nothing persists it back to R2. |
| R2_REQUIRED_FOR_DURABLE_RESULT | NO | Same as above — no durable-result R2 write path exists or is composed. |
| **R2_REQUIRED_ANYWHERE_IN_FINAL_PATH** | **YES** | Solely because of buyer input staging. |

**R2_EXTERNAL_MUTATION_REQUIRED = YES.** Per §10, the composition's fail-closed gate on `artifactStore` is real and correct — not stale — and was **not** removed.

**§11 read-only bucket-existence check**: `npx wrangler r2 bucket list` → `A request to the Cloudflare API ... failed. Please enable R2 through the Cloudflare Dashboard. [code: 10042]`. R2 is not even enabled at the Cloudflare account level — bucket existence cannot be confirmed because the product itself isn't turned on for this account.

**EXISTING_R2_BUCKET_PRESENT = NO** (indeterminable — R2 disabled account-wide). Per this checkpoint's own §11: **STOP** on any R2/bucket mutation. None was attempted. Expected binding name (`ARTIFACTS`) and bucket name (`siteborne-artifacts`) are documented in `wrangler.toml:144-147` (commented since SUN-0800B checkpoint 3) — unchanged this checkpoint.

## 3. Document pricing determinism (§13–§14)

`document-evidence-json-v2-production-executor.ts` uses `scheme: 'upto'` with `pricingKey: 'document_evidence_json_max_job'`. The buyer authorizes a bounded ceiling (`maximum_authorized_price` in the input schema, e.g. the schema's own `$0.19` example) before payment; the executor measures real usage post-execution (`calculateDocumentUsage` over real `page_number`/`ocr_used`/`table_count` from the actual `WorkerResult`) and reports `actualAmountAtomic`, with `usage.capped` bounding the charge at the pre-authorized ceiling. This is the same `upto`-scheme pattern already accepted elsewhere in this codebase for variable-cost services.

**DOCUMENT_PRICE_KNOWN_PRE_PAYMENT = YES** (bounded ceiling, not a fixed price — consistent with the `upto` scheme's design).
**DOCUMENT_PRICING_DIMENSIONS** = page count, per-page OCR usage, per-page table count.

Ran `npx tsx scripts/check-registry-pricing-drift.mts`: flags `company_evidence_graph.v1`/`.v2` (carried forward from S3, unchanged) but **does not flag `document_evidence_json`** — its registry `maximum_price` (`0.19`) matches the governance-derived expectation for `document_evidence_json_max_job`.

**DOCUMENT_PRICE_SINGLE_SOURCE_OF_TRUTH = YES.** No drift-class issue for document, unlike company.
**COMPANY_PRICE_METADATA_DRIFT_REPO_FIXED = NO** — the drift-guard script still flags it exactly as S3 found; not touched this checkpoint (out of scope, carried forward as an open governance question).

## 4. Modal document endpoint deployment (§16–§17, §22–§24)

**MODAL_DOCUMENT_REQUIRED_SECRET_NAMES** = `MODAL_DOCWORKER_ENDPOINT_URL`, `MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET` (names only, from `document-evidence-json-v2-cdp-composition.ts`; no values printed or handled).

Pre-deploy local validation: `services/modal-worker` pytest 88/88 passing; `python -c "import modal_worker.modal_app"` clean; app registry (`modal app list --json`) confirmed `siteborne-document-worker` had never been deployed before this checkpoint (only `siteborne-webctx-safe-egress` existed).

**MODAL_DEPLOYMENTS = 1.** `modal deploy -m modal_worker.modal_app` — succeeded, image built (58s), function `process_document` and web function `process_document_http` created:

> `https://siteborne--siteborne-document-worker-process-document-http.modal.run`

**MODAL_DOCUMENT_DEPLOYMENT** = `siteborne-document-worker`, app id `ap-XGJZ4rFDRghT8pARYFl3EA`.

**§23 readback**: `modal app history siteborne-document-worker --json` → exactly one version (`v1`), deployed from commit `f35df82` (the correct source commit — no drift, no unintended second version). **MODAL_DOCUMENT_DEPLOY_READBACK = PASS.**

**§24 safe non-economic live probes**:
- Unauthenticated plain `curl` POST → `HTTP 401`. **LIVE_MODAL_DOCUMENT_AUTH = PASS** (endpoint correctly rejects unauthenticated requests before any application code runs — Modal's own `requires_proxy_auth=True` platform gate, not application logic).
- Malformed-body and known-fixture positive-processing probes: attempted via `modal curl` (Modal's own CLI tool, documented as "send an authenticated request ... without including proxy token headers"). It failed in this environment with `modal-http: missing credentials for proxy authorization` regardless of invocation form (plain GET, POST with body, explicit `--profile`) — Modal's own CLI marks this command "Experimental ... may change or be removed." No proxy-auth token exists for this brand-new app (proxy auth tokens are minted via the Modal Dashboard, not CLI/API, and none existed before this deploy — there is nothing to "provision" per the no-rotation/no-regeneration constraint). **LIVE_MODAL_DOCUMENT_VALIDATION = NOT_EXECUTED. LIVE_MODAL_DOCUMENT_REAL_PROCESSING = NOT_EXECUTED** (genuine tooling/credential limitation, not a failure of the code — the same validation and real-processing logic is already proven locally: `test_modal_wrapper.py::TestProcessDocumentHttpCore` exercises request validation, base64/size/media-type/policy rejection, and a real end-to-end `execute()` call against a real tiny PDF fixture, all passing in the 88/88 count above).

## 5. Worker secret provisioning (§27)

**WORKER_SECRET_MUTATIONS = 0.** No Cloudflare Worker secret was set. `MODAL_DOCWORKER_PROXY_KEY`/`MODAL_DOCWORKER_PROXY_SECRET` do not exist yet — this is a first-time deployment with no prior proxy-auth token, and minting one is a Modal Dashboard action outside repo-only/CLI scope and outside this checkpoint's "no rotation, no regeneration" bound (there is nothing existing to inject). This, plus R2 (§2), are the two external blockers carried to remediation.

## 6. Full local/repo gate (§17, §20)

Run *after* the Modal deploy (see process note above), against the unmodified `f35df82` tree:

| Check | Result |
|---|---|
| typecheck | 23/23 |
| build | 12/12 |
| lint | 16/16 |
| full test suite | 219/219 files, 2639/2639 non-skipped tests, 74 intentional skips (exact S3R baseline — no regression) |
| protocol-mcp (`mcp:check`) | PASS |
| protocol-a2a (`check` + spec baseline) | PASS |
| protocol-x402 (lint/typecheck/replay/concurrency) | PASS (53/53 replay+concurrency tests) |
| SSRF/DNS-rebinding | 21/21 |
| secrets scan (gitleaks + working-tree) | clean |
| `wrangler versions upload --dry-run` | clean; confirms `ARTIFACTS` binding still absent, no drift |
| `document-worker:check` (ruff) | clean |
| `document-worker:test` (pytest) | 88/88 |

Two **pre-existing, unrelated** findings (working tree was clean and unmodified before this checkpoint touched anything — confirmed via `git status --short` returning empty at the start):
- `pnpm check`'s `format:check` step flags 440 files repo-wide for Prettier drift. Not caused by, or related to, this checkpoint's work; not fixed here (out of scope, large mechanical change).
- `document-worker:typecheck` (`mypy --strict`) reports 7 "untyped call" errors, all confined to `tests/test_modal_wrapper.py` calling a `_core` alias — a test-file-only typing gap. `ruff` and the full pytest run (88/88, including that same file's test bodies) are unaffected.

Neither finding is fixed in this checkpoint.

## 7. Production containment (§28)

`EDGE_API_DEPLOYMENTS=0`, `API_CANDIDATE_UPLOADS=0`, `TRAFFIC_MUTATIONS=0`, `LIVE_SERVICE_ACTIVATION_MUTATIONS=0`, `LIVE_PRICE_MUTATIONS=0`, `REAL_402_REQUESTS=0`, `PAYMENT_AUTHORIZATIONS=0`, `PAID_POSTS=0`, `SETTLEMENTS=0`, `CHAIN_TRANSACTIONS=0`. Production edge-api remains exactly the previously released state throughout.

## 8. Disposition (§29–§30)

`DOCUMENT_V2_EXTERNAL_INFRA_READY = NO` — three independent, evidenced gaps remain: (1) no buyer-facing document-input path exists at all (§1), (2) R2 is not enabled at the Cloudflare account level so its bucket cannot even be confirmed to exist, let alone bound (§2), (3) no Modal proxy-auth token exists yet to authenticate real traffic to the now-deployed endpoint, and none could be minted from this environment (§4). Per §30, do **not** overstate this as live-paid-working: `DOCUMENT_V2_DEPLOY_READY = NO`. What *is* now true and durable: the Modal app is deployed, correctly authenticated against unauthenticated traffic, and running the exact source at `f35df82` — real, verifiable infrastructure progress, not yet sufficient for buyer traffic.
