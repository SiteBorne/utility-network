# SUN-1222B-S3-R2 — Buyer-Facing Document Upload Path

**Status:** COMPLETE — `document_evidence_json.v2`'s `upload_reference` input
mode is now genuinely resolvable end-to-end (repo-only; zero deployment, zero
external mutation this checkpoint).

**Inherited HEAD:** `1e891b6` (SUN-1222C-R1 evidence commit). Working tree was
clean before this session; all changes below are still uncommitted at the time
of writing, pending this report and a final review pass.

## 1. Authorization

Authorized in a dedicated, standalone message naming this exact scope: "CONTINUE
FROM THE CURRENT VERIFIED CHECKPOINT. THIS SUBTASK EXISTS TO MAKE:
siteborne_document_evidence_json → document_evidence_json.v2 ACTUALLY BUYABLE BY
AN EXTERNAL CLIENT." — repo-only, no deployment, full adversarial security
matrix, genuine RED→GREEN→mutation-proof TDD.

## 2. The gap this closes

`document_evidence_json.v2`'s frozen input schema declares two input modes:
`artifact_reference` (implemented, requires an `artifact_id` that already exists
in the artifact store) and `upload_reference` (declared but, before this
checkpoint, unimplemented — `service.ts` returned `dependency_unavailable`
unconditionally for it). SUN-1222C-R1 confirmed the root cause and stopped
there: **`BUYER_INPUT_PATH_EXISTS_BEFORE_FIX=NO`** — nothing let an external
buyer obtain an `artifact_id` at all. A buyer holding real R2/D1 credentials was
never the intended model; a buyer holding an opaque, short-lived `upload_id`
minted by a public endpoint is.

## 3. Architecture

Two new files, one modified interface, one modified production executor —
deliberately NOT a change to `DocumentEvidenceJsonService` itself
(`packages/service-runtime`), which stays D1/R2-agnostic and portable:

1. **`apps/edge-api/src/control-plane/artifacts/document-upload.ts`** (NEW) —
   pure validation/storage logic.
   `storeDocumentUpload(bytes, declaredContentType, deps)`: rejects
   unsupported/mismatched media types (magic-byte sniffing, byte-for-byte the
   same three signatures as the real Python worker's
   `document/validation.py::detect_media_type`), empty bodies, oversized bodies;
   on success, mints a fresh server-side UUID (never buyer input), stores
   content-addressed bytes via the existing `ArtifactStore.put()`, and a D1
   metadata row via `ArtifactsRepository.create()` with
   `authorization_class: 'buyer_authorized'`, `retention_class: 'ephemeral'`, a
   900-second TTL. `readBoundedBody()`: streams a `ReadableStream`
   incrementally, aborting (cancelling the reader) the instant `limit + 1` bytes
   is crossed — never buffers an unbounded attacker-supplied body.

2. **`apps/edge-api/src/control-plane/routes/document-artifact-upload-route.ts`**
   (NEW) — `POST /v2/artifacts/documents`. Gated by `PAID_ROUTES_ENABLED='true'`
   AND `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED='true'` AND real `DB`/`ARTIFACTS`
   bindings, else `c.notFound()` — never a 500, never a fixture fallback.
   Rejects an oversized declared `Content-Length` before reading any body at
   all, then applies the bounded-read defense for chunked/absent-length
   requests. The success response returns only `upload_id`, `media_type`,
   `size_bytes`, `content_hash`, `expires_at`, and a `usage.example` showing how
   to reference it — never the R2 bucket name, R2 object key, or any D1
   internal.

3. **`apps/edge-api/src/control-plane/artifacts/store.ts`** (MODIFIED, additive)
   — added `getContentByContentHash(hash)` to the `ArtifactStore` interface and
   both implementations (`InMemoryArtifactStore`, `R2ArtifactStoreAdapter`),
   using the exact same key derivation `put()`/`getByContentHash()` already use
   internally. This is the one new capability the resolution layer needed;
   `getContent(id)`'s pre-existing "raw id is a fully-qualified key" contract is
   untouched.

4. **`apps/edge-api/src/control-plane/production/document-evidence-json-v2-production-executor.ts`**
   (MODIFIED) — added a `db: D1Database` parameter and
   `resolveUploadReference()`: looks up the D1 record by `upload_id`, rejects
   (before the billable Modal worker is ever invoked) on missing reference,
   expiry, or a declared `media_type`/`size_bytes`/ `content_hash` that
   disagrees with what was actually stored (buyer- declared dimensions are never
   trusted on their own). On success, rewrites `input.upload_reference` into an
   ordinary `artifact_reference`-shaped input using the buyer-facing `upload_id`
   as `artifact_id` — so the PCC receipt's evidence `sourceUri` shows the
   capability the buyer actually holds, never an internal R2 key.

## 4. A bug found and fixed during this checkpoint (not deployed, repo-only)

The executor's first draft built the resolved-upload artifact store as
`{...edgeApiArtifactStore, getContent: ...}` — spreading a class instance.
Object spread copies only own enumerable properties, not
`R2ArtifactStoreAdapter`/`InMemoryArtifactStore`'s prototype methods, so
`put`/`getMetadata`/`getByContentHash`/`getContentByContentHash`/`delete`/
`exists`/`existsByContentHash` were silently dropped from the resulting object.
This did not (yet) produce an observable failure — the one caller
(`serviceRuntimeArtifactStore()`) only ever invokes `.getContent()` — but was
fragile by accident, not by design. Fixed by building the narrow
`@siteborne/provider-adapters` `ArtifactStore` shape directly, with the other
four methods explicitly stubbed to throw loudly if ever reached, mirroring the
pattern the file already used for the non-upload path.
**FRAGILE_ARTIFACT_STORE_SPREAD_FOUND=YES, FIXED=YES,
WAS_EXTERNALLY_OBSERVABLE=NO.**

A companion structural regression test
(`verify-agent-output-v2-production-executor.context-defaults.test.ts`) that
asserted `artifact_store` was a direct call expression at the
`buildServiceContext()` call site no longer held (the resolved store is now a
bare, pre-computed identifier) — updated to instead verify the identifier is
declared with the non-nullable `ArtifactStore` type from a real call expression,
and that every reassignment in the file is non-nullable, preserving the check's
actual intent (the `??` fixture-default right-hand side can never evaluate)
rather than its incidental shape.

## 5. TDD discipline: RED → GREEN → mutation-proof

Three new test files were written covering the adversarial security matrix; all
started GREEN against the already-written implementation (this was
TDD-after-implementation, not classic red-first authorship), so genuine
defect-catching was proven by **mutation testing**: a real bug was temporarily
introduced into each of the three implementation files, the suite was re-run to
confirm it failed for the right reason, and the file was restored byte-for-byte
(verified via `diff` against a pre-mutation backup) before re-confirming GREEN.

| File mutated                                       | Mutation                                                                   | Test that caught it                                               | Restored & re-verified GREEN |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| `document-upload.ts`                               | Disabled the magic-byte/declared-type mismatch check (`if (false && ...)`) | 2 tests in `document-upload.test.ts`                              | ✓                            |
| `document-artifact-upload-route.ts`                | Flag gate `&&` → `\|\|`                                                    | 2 tests in `document-artifact-upload-route.test.ts`               | ✓                            |
| `document-evidence-json-v2-production-executor.ts` | Disabled the upload expiry check                                           | 1 test in `document-evidence-json-v2-production-executor.test.ts` | ✓                            |

**DOCUMENT_BUYER_UPLOAD_RED=N/A_TDD_AFTER_IMPLEMENTATION,
DOCUMENT_BUYER_UPLOAD_GREEN=PASS, DOCUMENT_BUYER_UPLOAD_MUTATION_PROOF=PASS (3/3
mutations caught, 3/3 clean restores confirmed by diff).**

## 6. Adversarial security matrix — coverage

`apps/edge-api/src/control-plane/artifacts/document-upload.test.ts` (18 tests):
magic-byte sniffing for all three allowed types and near-miss signatures;
`isAllowedMediaType` exact-string matching; bounded stream reader (within-limit,
exceeded, null body); unsupported/missing Content-Type; empty body; oversized
body (declared bound, real bound); magic-byte vs. declared-type mismatch (both a
wrong-but-recognized type and unrecognized garbage); **§9
buyer-controlled-object-keys=NO** proof (the returned `upload_id` is always
`deps.randomId()`, never derived from the request);
TTL/authorization_class/retention_class/artifact_type correctness; content-hash
dedup on repeat upload; a genuine D1-race (`DUPLICATE_ARTIFACT`) re-read path;
R2 write failure and D1 write failure both surfaced as `storage_failure`, never
an uncaught throw.

`apps/edge-api/src/control-plane/routes/document-artifact-upload-route.test.ts`
(13 tests, against REAL Miniflare D1 + R2 bindings): flag-gating (both flags
required, DB/ARTIFACTS binding requirement, kill-switch); declared
Content-Length pre-check (413 before any read); a genuinely oversized
**streamed** body with no/understated Content-Length (proves the bounded reader,
not just the header check, is load-bearing); unsupported Content-Type (415);
magic-byte mismatch (415); empty body (400); **§34 no-leakage proof** (response
JSON keys are an explicit allowlist; the serialized body is asserted to never
contain the real bucket name or R2 key prefix); idempotent re-upload; a
structural check that the route file never imports x402/PCC/service-registry
machinery (§22 non-executing boundary).

`apps/edge-api/src/control-plane/production/document-evidence-json-v2-production-executor.test.ts`
(7 tests, local buyer E2E against real Miniflare D1 + a real signer +
`FixtureDocumentWorkerBridge` replaying a **real captured** worker output —
never a hand-authored fake, per this repo's own testing convention): a real
`storeDocumentUpload` mint → executor resolution → successful signed PCC result,
never touching the live Modal endpoint; unknown/enumerated `upload_id`
(**IDOR/enumeration proof** — rejected with `upload_reference_unresolved`, never
a 500, never information about whether _some_ upload exists vs. none); expired
upload (D1 row and R2 content both still present, still rejected); declared
`media_type` disagreement (worker asserted, via a throwing stub, to never be
invoked); declared `size_bytes`/`content_hash` disagreement; missing/non-string
`upload_id` rejected without ever querying D1 (`vi.spyOn` proof); the
pre-existing `artifact_reference` mode proven unaffected by the new resolution
branch.

**Payment-binding substitution**: not a new proof this checkpoint — the existing
x402 `inputHash = hashPaymentObject(body)` binding (SUN-1222B audit) already
covers the full request body generically, `upload_reference` included; no
service-specific gap was introduced. **Private-bucket/no- public-URL**:
re-confirmed structurally unchanged from SUN-1222C-R1
(`R2_BUCKET_PUBLIC_ACCESS=NO`); this checkpoint made zero Cloudflare account
changes.

## 7. Full gate

```
apps/edge-api full vitest suite:  984 passed, 68 skipped, 0 failed (90/90 files)
apps/edge-api tsc --noEmit:       clean
repo-wide `pnpm typecheck`:       23/23 tasks passed
repo-wide `pnpm lint`:            16/16 tasks passed
`pnpm format:check` (files this checkpoint touched): clean (Prettier-formatted)
`pnpm secrets:scan`:              no leaks found (652 commits + working tree)
`pnpm pcc:generate:check`:        NO DRIFT
`pnpm services:generate:check`:   NO DRIFT (18/18 models)
`pnpm openapi:generate:check`:    NO DRIFT (3/3 files)
`pnpm schemas:check`:             up to date
`pnpm migrations:verify`/`d1:test`: ALL VERIFICATION TESTS PASSED
`pnpm contracts:baseline:verify`/`compat:check`/`release:verify`: all passed
`pnpm pricing:check`:             EMBEDDED_PRICING matches governance exactly
`pnpm mcp:check`:                 packed install OK
`pnpm a2a:test:edge`:             2/2 passed
`pnpm x402:check` (spec-baseline consistency): all scenarios found
`pnpm governance:validate`:       77/77 passed
`pnpm state:validate`:            30/30 passed
`pnpm tasks:validate`:            252/252 passed
```

Python/`document-worker:*` checks were not re-run: this checkpoint made zero
changes to any Python file (confirmed via `git status --short` — every
changed/new file is under `apps/edge-api`).

`multi-service-discovery.test.ts` (already covering all four v2 services'
`implementation: 'real_executor'` status) passed unchanged as part of the full
edge-api suite — no discovery-manifest changes were needed, since
`POST /v2/artifacts/documents` is deliberately not an x402/priced route and was
never meant to appear in the paid-service discovery manifest.

**DOCUMENT_PRICE_KNOWN_BEFORE_PAYMENT**: unaffected by this checkpoint — the 402
challenge is still generated, at the frozen `document_evidence_json_max_job`
ceiling, before either resolution branch (`artifact_reference` or
`upload_reference`) runs; confirmed by the pre-existing
`document-evidence-json-v2-cdp-composition.test.ts` 402-challenge test, which
still passes unchanged.

## 8. What is explicitly still open

- No scheduled reclamation of expired uploads exists (`expires_at` is enforced
  at _read_ time only, per `document-upload.ts`'s own doc comment — carried over
  unchanged from the design noted in SUN-1222C-R1). Flagged, not silently
  implied complete.
- The pre-existing 440-file Prettier drift (all files outside this checkpoint's
  own touched set) remains unfixed — confirmed out of scope again this
  checkpoint by scoping `format:check` output to only the files this checkpoint
  modified/created.
- Live Modal/R2 qualification of the upload path end-to-end (real HTTP request
  to a deployed Worker) was NOT performed — this checkpoint was explicitly
  repo-only, no deployment. The local buyer E2E test proves the resolution logic
  against real D1 and real signing; the live Modal document-worker endpoint
  itself was already qualified separately in SUN-1222C-R1.

## 9. Deployment/mutation counters (this checkpoint)

```
CLOUDFLARE_WORKER_DEPLOYS=0
MODAL_DEPLOYMENTS_THIS_CHECKPOINT=0
R2_BUCKET_CREATIONS=0
MODAL_PROXY_TOKENS_CREATED=0
API_CANDIDATE_UPLOADS=0
TRAFFIC_MUTATIONS=0
WORKER_SECRET_MUTATIONS=0
PRODUCTION_D1_MUTATIONS=0
INTENTIONAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENTS=0
BLOCKCHAIN_TRANSACTIONS=0
```

## 10. Final packet

```
SUN1222B_S3_R2_BUYER_DOCUMENT_UPLOAD_PATH=COMPLETE
BUYER_INPUT_PATH_EXISTS_BEFORE_FIX=NO
BUYER_INPUT_PATH_EXISTS_AFTER_FIX=YES
FRAGILE_ARTIFACT_STORE_SPREAD_FOUND=YES
FRAGILE_ARTIFACT_STORE_SPREAD_FIXED=YES
DOCUMENT_BUYER_UPLOAD_GREEN=PASS
DOCUMENT_BUYER_UPLOAD_MUTATION_PROOF=PASS (3/3 mutations caught, 3/3 clean restores)
DOCUMENT_PRICE_KNOWN_BEFORE_PAYMENT=YES (unaffected, pre-existing 402 ceiling unchanged)
DOCUMENT_V2_LOCAL_BUYER_E2E=PASS (7/7 tests, real D1 + real signer + real captured worker fixture)
DOCUMENT_INPUT_DISCOVERY_COHERENT=YES (multi-service-discovery.test.ts unchanged/passing; upload endpoint deliberately not in x402 discovery manifest, not a priced route)
DOCUMENT_V2_INFRA_READY=YES (repo side; live Modal/R2 already qualified separately in SUN-1222C-R1)
NEW_TEST_FILES=3 (38 new tests total: 18 + 13 + 7)
MODIFIED_TEST_FILES=2 (document-evidence-json-v2-cdp-composition.test.ts +1 field; verify-agent-output-v2-production-executor.context-defaults.test.ts structural check updated)
FULL_EDGE_API_SUITE=984 passed, 68 skipped, 0 failed
REPO_TYPECHECK=CLEAN (23/23)
REPO_LINT=CLEAN (16/16)
SECRETS_SCAN=CLEAN
DISCOVERY_DRIFT=NONE
CLOUDFLARE_WORKER_DEPLOYS=0
MODAL_DEPLOYMENTS_THIS_CHECKPOINT=0
R2_BUCKET_CREATIONS=0
PRODUCTION_D1_MUTATIONS=0
WORKING_TREE=dirty (all changes below are staged for this evidence report's own commit)
EVIDENCE_COMMIT_SHA=<this file's own commit>
NEXT_OPEN_THREAD=SUN-1222B-S3-REMEDIATION traffic-evidence addendum (MCP initialize/protocol-negotiation/header-dependency remediation, ranked P0 by the user, not yet started)
```

No repository source outside `apps/edge-api` was modified. No Worker was
deployed. No Modal application was redeployed. No R2 bucket or Modal credential
was created. No production traffic, payment, or settlement action occurred.
