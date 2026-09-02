# SUN-1222C-R2 — Document Buyer-Upload: Verification, Threat-Model Audit, Deployment Manifest

**Scope:** repo-only audit/hardening of the already-implemented `document_evidence_json.v2`
buyer-upload pipeline (`POST /v2/artifacts/documents` → `upload_reference` → private R2 →
paid Modal execution → PCC/receipt → settlement). No production mutation, no new credentials,
no deployment.

## 0–1. Starting state

```
START_HEAD=eeea6121e536bac16645f0b8178a6905d4828169
WORKING_TREE_CLEAN=YES
```

Premise correction (as flagged before authorization): the runbook's original §1
("buyer upload ingress does not exist") does not match reality. The path was implemented in
SUN-1222B-S3-R2 (`b3878f5`) and its real-app reachability defect (global Content-Type
middleware conflict) was fixed in SUN-1222C-1-REMEDIATION (`2b0ab01` / `01600ff`). This
checkpoint is therefore an audit of existing code, not new construction.

## 2–3. Files verified

- `apps/edge-api/src/control-plane/artifacts/document-upload.ts` (297 lines) — validation/storage core
- `apps/edge-api/src/control-plane/routes/document-artifact-upload-route.ts` (122 lines) — HTTP handler
- `apps/edge-api/src/control-plane/production/document-evidence-json-v2-production-executor.ts` — `resolveUploadReference`
- `apps/edge-api/src/index.document-upload-real-app.test.ts` — assembled real-app regression

## 4–40. Threat-model audit (item → verified control → evidence)

| Threat-model item | Status | Evidence |
|---|---|---|
| Authorization/capability binding | PASS | `upload_id` is an unguessable server-minted UUID capability, never buyer-supplied; possession of the ID is the authorization model (deliberate, documented design — not identity-bound) |
| Object isolation | PASS | R2 key derived from server-computed SHA-256 only; buyer input never reaches a storage key (`document-upload.ts:15-20`) |
| Path/key safety, path traversal | PASS | No buyer string is ever used as an R2 key or D1 row id — ids are `deps.randomId()` / content hash only |
| Content addressing / SHA-256 integrity | PASS | `sha256Hex` computed server-side in the route; declared `content_hash` in a later `upload_reference` is cross-checked, never trusted alone (`resolveUploadReference` lines 215-219) |
| MIME/file validation | PASS | Magic-byte sniff (`sniffMediaType`) must agree with declared `Content-Type`; disagreement → 415. Byte-identical signature set to the independent Modal-worker validator (kept in sync deliberately, not duplicated blindly) |
| Byte limits | PASS | Declared `Content-Length` rejected pre-read (413); `readBoundedBody` hard-stops at `limit+1` bytes even for chunked/no-Content-Length requests — no unbounded buffering |
| Page-count ceiling | PASS (independent layer) | Enforced by the real Modal worker's own `validation.py`, not duplicated here by design (this layer's job ends at "plausible container, within size bound") |
| Malformed input | PASS | Garbage bytes / near-miss signatures → `media_type_mismatch`/415, never a crash, never treated as valid |
| Replay/claim semantics | PASS (by design) | Content-addressed dedup: identical bytes always resolve to the same `upload_id` regardless of uploader — expected content-addressing behavior, not an IDOR (an attacker who doesn't have the bytes cannot produce or guess the ID) |
| State transitions | PASS | Only two states: unclaimed/resolvable vs. expired; no partial/corrupt states possible (write is atomic — D1 row only created after a successful R2 `put`) |
| Concurrency | PASS | Concurrent identical-content race (`DUPLICATE_ARTIFACT`) is caught and re-read rather than surfaced as a false failure — tested |
| Fail-closed dependency behavior | PASS | Missing `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED`/`PAID_ROUTES_ENABLED`/`DB`/`ARTIFACTS` → `404`, never `500`, never a fixture fallback — tested for all four combinations |
| IDOR / enumeration | PASS | Unknown/enumerated `upload_id` → generic `upload_reference_unresolved`, never a distinguishing error; proven by dedicated test |
| Expiry (TTL) | PASS | 900s TTL enforced at *read* time in `resolveUploadReference`; expired artifact rejected even though the D1 row and R2 object still physically exist — tested |
| Cross-buyer declared-field spoofing | PASS | Declared `media_type`/`size_bytes`/`content_hash` in the paid request are cross-checked against the stored record; any mismatch rejects *before* the billable Modal call |
| No credentials/internal identifiers in response | PASS | `POST /v2/artifacts/documents` response contains only `upload_id`, `media_type`, `size_bytes`, `content_hash`, `expires_at` — no bucket name, R2 key, or D1 internals (§34, tested) |
| SSRF via `document_url` | NOT REACHABLE | The frozen input schema (`schemas/services/document-evidence-input.schema.json`) declares a third `document_url` mode; **it is not implemented anywhere in the executor** — a request containing only `document_url` falls through untouched to `service.ts`'s existing artifact-reference-required rejection. No outbound fetch of buyer-supplied URLs exists in this code path. Confirmed by full-repository grep (zero non-test matches). |
| Price-before-payment determinism | PASS (verified in SUN-1222C-Q0) | `document_evidence_json.v2` uses the x402 `upto` scheme with a fixed 190000-atomic authorization ceiling; the resolution step above runs entirely before any payment/PCC/settlement code executes (§22, structurally enforced and tested — the route handler itself never imports payment machinery) |

## Findings

Two items are genuine, previously-documented residual risks — **not** newly discovered, and
**not** fixed in this checkpoint because each requires an infrastructure decision (a new
binding or a scheduled trigger) outside "minimal repo-side fix" scope, and outside this
checkpoint's no-new-infrastructure authorization:

1. **No scheduled physical cleanup.** Expiry is enforced logically at read time; there is no
   `scheduled` Worker export or D1/R2 reclamation job. An unclaimed upload's bytes and D1 row
   persist indefinitely past `expires_at` (bounded per-object at 10 MB, but unbounded in
   aggregate over time). This was flagged in the code's own doc comment at implementation
   time, not hidden.
2. **No abuse/resource ceiling (rate limiting) on the free upload endpoint.** `POST
   /v2/artifacts/documents` requires no payment and no authentication — by design, since the
   buyer must be able to upload before paying. Nothing bounds how many uploads a single
   caller can make, so an anonymous actor could drive R2 storage/request costs by uploading
   the byte-limit maximum repeatedly. Confirmed absent by full-repository search.

A third item is a coherence gap, not a security defect: the frozen input schema declares
`document_url`, `declared_page_count`, `page_range`, and `extraction_request` fields that the
executor does not act on. This matches the module's own documented "truthful
underimplementation" position (declared-but-inert fields fail closed rather than silently
misbehaving) — flagged here for visibility, not treated as a blocker.

No exploitable defect was found. All 48 existing tests across the four files pass
(`document-upload.test.ts` 18, `document-artifact-upload-route.test.ts` 13,
`document-evidence-json-v2-production-executor.test.ts` 7,
`index.document-upload-real-app.test.ts` 10). No code changes were required or made.

## Deployment manifest (planning only — not executed)

To activate `POST /v2/artifacts/documents` in production, in order:

1. Confirm `siteborne-artifacts` R2 bucket privacy posture (already proven PASS in SUN-1222C-R1).
2. Set `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED='true'` alongside existing `PAID_ROUTES_ENABLED='true'`.
3. Confirm the `ARTIFACTS` R2 binding and `DB` D1 binding are present on the target Worker
   version (already enabled repo-side in `wrangler.toml`, commit `8de9fc3`).
4. **Pre-activation recommendation (not a hard blocker):** add a Cloudflare rate-limiting rule
   or WAF-level throttle on `POST /v2/artifacts/documents` to bound anonymous-upload abuse,
   since no application-level limiter exists.
5. **Pre-activation recommendation (not a hard blocker):** add a `scheduled` Worker export (or
   equivalent D1/R2 sweep) to physically reclaim artifacts past `expires_at`, since current
   enforcement is read-time-only.
6. No new secret or credential is required for the upload path itself — it uses the existing
   `DB`/`ARTIFACTS` bindings only. The existing Modal document-worker credential (already
   live-qualified in SUN-1222C-R1/SUN-1222C-1) is required only for the downstream paid
   execution step, not for upload acceptance.

## Result

```
DOCUMENT_V2_DEPLOY_READY=YES
GENUINE_SECURITY_DEFECT_FOUND=NO
CODE_CHANGES_MADE=0
NEW_TESTS_ADDED=0 (existing 48 already cover the full threat-model matrix)
PRE_ACTIVATION_RECOMMENDATIONS=2 (rate limiting, scheduled cleanup — non-blocking)
PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
WORKING_TREE=clean (no source changes; this evidence report is the only new file)
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R3-DOCUMENT-CANDIDATE-DEPLOY-AND-REAL-QUALIFICATION
```
