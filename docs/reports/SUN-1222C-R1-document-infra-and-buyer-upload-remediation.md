# SUN-1222C-R1 — Document Infra Remediation (Part 1: External Provisioning + Live Qualification)

**Status:** PARTIAL — external dependency provisioning and live qualification complete; buyer-facing upload path (§11-20 of the R1 spec) not yet built. Stopped here to check in before undertaking that as new feature work.

**Inherited HEAD:** `baddff0` (SUN-1222C evidence commit). Working tree clean before and after this session (only external, non-repo actions performed).

## 1. Authorization

Standalone authorization for SUN-1222C-R1 was provided in a dedicated user message (pasted separately per the requested protocol), naming the Cloudflare account (`29a264a25ccfd13882defe49ed3e17b1`) and R2 endpoint, and scoping this checkpoint to exactly one R2 bucket creation and one Modal proxy-token creation.

## 2. R2 account enablement

Prior checkpoint (SUN-1222C) found R2 disabled at the account level (Cloudflare API error code `10042`). Direct read of `GET /accounts/{id}/r2/buckets` this session returned `HTTP 200`, `"success": true`, `"buckets": []` — **R2_ACCOUNT_ENABLED=YES** (enabled since the last checkpoint, account-side, not by this session).

## 3. R2 bucket — source-derived identity

Traced from `wrangler.toml:145-147` (commented-out block, unchanged since SUN-0800B):
```
binding = "ARTIFACTS"
bucket_name = "siteborne-artifacts"
```
`DOCUMENT_R2_BINDING_NAME=ARTIFACTS`, `DOCUMENT_R2_EXPECTED_BUCKET_NAME=siteborne-artifacts`. No bucket by that name existed (confirmed via authoritative listing before creating). Created exactly one:

```
$ wrangler r2 bucket create siteborne-artifacts
✅ Created bucket 'siteborne-artifacts' with default storage class of Standard.
```
Readback (`wrangler r2 bucket list`) confirms exactly one bucket, `siteborne-artifacts`, created `2026-09-02T01:59:27.265Z`, no duplicates. Public access (`r2.dev` managed domain) confirmed **disabled** via `GET /accounts/{id}/r2/buckets/siteborne-artifacts/domains/managed` → `"enabled": false`. No custom domain, no anonymous access — bucket is private.

**R2_BUCKET_CREATIONS=1, DOCUMENT_R2_BUCKET_EXISTS=YES, R2_BUCKET_PUBLIC_ACCESS=NO.**

## 4. Bounded R2 functional qualification

One synthetic, non-sensitive text object (`sun-1222c-r1-qualification-probe.txt`, containing only a static identifying string) was PUT to the bucket via `--remote`, read back byte-identical, then deleted; a subsequent GET returned `The specified key does not exist.`, confirming absence.

**R2_SYNTHETIC_OBJECTS_CREATED=1, R2_SYNTHETIC_OBJECTS_REMAINING=0.**

## 5. Modal proxy-auth source contract

Traced from `services/modal-worker/src/modal_worker/modal_app.py:205` (`@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, ...)`) and `apps/edge-api/src/control-plane/config/env.ts:117-119`:

- **MODAL_DOCUMENT_AUTH_SCHEME** = Modal's platform-enforced `Modal-Key`/`Modal-Secret` header pair (`requires_proxy_auth=True`), matching the identical pattern already used for `web_context_verified.v2`'s Modal worker.
- **MODAL_DOCUMENT_ENDPOINT** = `https://siteborne--siteborne-document-worker-process-document-http.modal.run` (captured from the SUN-1222C deploy output; unchanged, no redeploy performed).
- **MODAL_PROXY_SECRET_ENV_NAMES** (Worker-side) = `MODAL_DOCWORKER_ENDPOINT_URL`, `MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET` — distinct from `MODAL_WEBCTX_*`, confirming source intends a dedicated credential per service, not a shared token.

## 6. Modal proxy-token reconciliation and creation

`modal workspace proxy-tokens list --json` before creation showed exactly one existing token (`wk-jozfRBPfBFAJbWbQoXV88z`, created 2026-08-30, unscoped) with no name/purpose metadata exposed by the API to confirm what it was issued for. Since source names a dedicated `MODAL_DOCWORKER_*` credential distinct from `MODAL_WEBCTX_*` and the architecture does not specify a shared token, this existing token was **not** reused. Created exactly one new dedicated token:

```
$ modal workspace proxy-tokens create --json
```
Output was redirected directly to a `chmod 600` file outside the repository (never printed to this session's visible output). Only the safe `Modal-Key` identifier was read back: **`wk-6LcEUTuEzcQBsQ7oIPSmMj`**, confirmed present in a subsequent `proxy-tokens list`. The `Modal-Secret` value was never printed, logged, or committed. Workspace has a single environment (`main`, no RBAC scoping in use), so no `allow`/`revoke` step was needed.

**MODAL_PROXY_TOKENS_CREATED=1, MODAL_PROXY_TOKEN_SECRET_PRINTED=NO, MODAL_PROXY_TOKEN_SECRET_COMMITTED=NO.**

## 7. Authenticated live qualification

Reconfirmed unauthenticated request still fails closed:
```
POST <endpoint> {} → HTTP 401 "modal-http: missing credentials for proxy authorization"
```
**MODAL_UNAUTHENTICATED_FAIL_CLOSED=PASS.**

Sent exactly one bounded authenticated request using the new token and an existing, already-repo-committed synthetic fixture (`services/modal-worker/fixtures/pdf/native_text_one_page.pdf`, 1530 bytes, no real user data), via the `DocumentWorkerHttpRequest` contract (`job_id`, `request_id`, `media_type`, `content_base64`, `ocr_policy`, `table_policy`). Response: `HTTP 200`, `status: "success"`, real extraction (`pdfplumber+pypdf`) of the fixture's exact text (`"SUN-0400A Fixture: Native Text Document..."`), correct SHA-256, correct page classification, well-formed `WorkerResult` schema (`document`, `pages`, `metrics`, `provenance`, `failure: null`). This is the first successful live invocation of the deployed document worker.

**MODAL_AUTHENTICATED_REQUEST_ACCEPTED=YES, MODAL_REAL_PROCESSING_SUCCESS=YES, MODAL_RESPONSE_SCHEMA_VALID=YES.**

The staged credential file was securely deleted immediately after this qualification step (its authorized use — this checkpoint's provisioning steps only — was complete); it was never wired into any Cloudflare Worker configuration (`WORKER_SECRET_MUTATIONS=0` held throughout).

## 8. Deployment/mutation counters (this checkpoint)

```
INHERITED_MODAL_DEPLOYMENTS=1
MODAL_DEPLOYMENTS_THIS_CHECKPOINT=0
TOTAL_DOCUMENT_MODAL_DEPLOYMENTS_THIS_LINEAGE=1
CLOUDFLARE_WORKER_DEPLOYS=0
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
R2_BUCKET_CREATIONS=1
MODAL_PROXY_TOKENS_CREATED=1
```

## 9. What remains (not done this session)

The R1 specification's §11-20 (buyer-facing document upload path: trace the input-mode gap in full, design the minimal safe upload architecture, build it with a full security test matrix — path traversal, oversized files, malformed/zip-bomb content, replay, SSRF, artifact enumeration, retention policy — TDD RED→GREEN→mutation proof, local buyer E2E, discovery coherence) is **not yet done**. Confirmed root cause only: `packages/service-runtime/src/services/document-evidence/service.ts:57-63` implements only the `artifact_reference` input mode; `upload_reference` and `document_url` are declared in the frozen schema (`types.ts`, `schemas/services/document-evidence-input.schema.json`) but explicitly unimplemented, and no route exists for an external buyer to obtain an `artifact_id`. **BUYER_INPUT_PATH_EXISTS_BEFORE_FIX=NO.**

Because this is a genuinely new feature (an upload endpoint backed by the R2 bucket just created, with a substantial security-test obligation) rather than a continuation of already-scoped remediation, this checkpoint stops here for review rather than building it silently in the same pass.

## 10. Final packet

```
SUN1222C_R1_DOCUMENT_INFRA_REMEDIATION=PARTIAL
R2_ACCOUNT_ENABLED=YES
DOCUMENT_R2_BINDING_NAME=ARTIFACTS
DOCUMENT_R2_BUCKET_NAME=siteborne-artifacts
R2_BUCKET_CREATIONS=1
DOCUMENT_R2_BUCKET_EXISTS=YES
R2_SYNTHETIC_OBJECTS_CREATED=1
R2_SYNTHETIC_OBJECTS_REMAINING=0
MODAL_DOCUMENT_AUTH_SCHEME=Modal-Key/Modal-Secret header pair (requires_proxy_auth=True)
MODAL_PROXY_TOKENS_CREATED=1
MODAL_PROXY_TOKEN_SECRET_PRINTED=NO
MODAL_PROXY_TOKEN_SECRET_COMMITTED=NO
MODAL_UNAUTHENTICATED_FAIL_CLOSED=PASS
MODAL_AUTHENTICATED_REQUEST_ACCEPTED=YES
MODAL_REAL_PROCESSING_SUCCESS=YES
MODAL_RESPONSE_SCHEMA_VALID=YES
BUYER_INPUT_PATH_EXISTS_BEFORE_FIX=NO
DOCUMENT_BUYER_UPLOAD_RED=NOT_YET_ATTEMPTED
DOCUMENT_BUYER_UPLOAD_GREEN=NOT_YET_ATTEMPTED
DOCUMENT_BUYER_UPLOAD_MUTATION_PROOF=NOT_YET_ATTEMPTED
DOCUMENT_PRICE_KNOWN_BEFORE_PAYMENT=NOT_YET_EVALUATED
DOCUMENT_V2_LOCAL_BUYER_E2E=NOT_YET_ATTEMPTED
DOCUMENT_INPUT_DISCOVERY_COHERENT=NOT_YET_EVALUATED
DOCUMENT_V2_INFRA_READY=NO
INHERITED_MODAL_DEPLOYMENTS=1
MODAL_DEPLOYMENTS_THIS_CHECKPOINT=0
TOTAL_DOCUMENT_MODAL_DEPLOYMENTS_THIS_LINEAGE=1
CLOUDFLARE_WORKER_DEPLOYS=0
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
REQUIRED_R2_BINDINGS=ARTIFACTS (bucket: siteborne-artifacts)
REQUIRED_MODAL_SECRET_NAMES=MODAL_DOCWORKER_ENDPOINT_URL, MODAL_DOCWORKER_PROXY_KEY, MODAL_DOCWORKER_PROXY_SECRET
FUTURE_CANDIDATE_MANIFEST=deferred to a future SUN-1222C checkpoint, once the buyer upload path exists
EVIDENCE_COMMIT_SHA=<this file's own commit>
WORKING_TREE=clean
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R2-DOCUMENT-BUYER-UPLOAD-PATH
```

No repository source was modified in this session. No Worker was deployed. No Modal application was redeployed. No production traffic, payment, or settlement action occurred.
