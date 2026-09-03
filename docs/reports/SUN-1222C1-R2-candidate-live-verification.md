# SUN-1222C1-R2 — Temporary 1% Live Candidate Verification

## 0. Lineage

- C1R2 start HEAD: `0adff2e` (clean; C1's report + SHA-correction commits)
- No repo mutations this checkpoint — every action is an external Cloudflare/D1/R2 mutation or read, all reverted/cleaned where applicable except the one authorized D1 migration (already applied in C1)

## 1. Authorization

Standalone, explicit, first-person authorization present in the same user message as the runbook, with exact version IDs, exact percentages, and an explicit prohibition list. Treated as `PRESENT`.

## 2-3. Pre-mutation readback

- `PRE_C1R2_PRODUCTION_TRAFFIC=100%` (`db7054c9-76ee-4830-aabe-8a4542261b6a`)
- `PRE_C1R2_CANDIDATE_TRAFFIC=0%` (`8ce8cb66-f388-4fcc-b3e6-9c14b4919a93`)
- `PRE_C1R2_ACTIVE_VERSION_COUNT=2` — matched expected exactly.

## 4-5. Candidate configuration / D1 migration readback

- Re-verified via `wrangler versions view` immediately before mutation: `ARTIFACTS` R2 binding present, all four v2 activation vars `"true"`, cross-script `PAID_CONTINUATION_WORKFLOW` binding intact, all 13 required secrets present by name, `CDP_WALLET_SECRET` absent. `C1R2_CANDIDATE_CONFIGURATION=PASS`.
- `wrangler d1 migrations list --remote`: "No migrations to apply" — `0008_document_ingress_admission_windows.sql` confirmed already applied (from C1). `C1R2_D1_MIGRATION_STATE=PASS`.

## 6. Buyer balance (read-only, live RPC)

Real `eth_call` to `https://mainnet.base.org`, canonical Base USDC contract `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`, `balanceOf(0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99)`:

```
raw: 0x000000000000000000000000000000000000000000000000000000000001376f
```

- `QUALIFICATION_BUYER_BALANCE_ATOMIC=79727`
- `QUALIFICATION_BUYER_BALANCE_USDC=0.079727`

No wallet credential used, no transfer.

## 7. Final four-service economics (re-derived from source, not trusted from memory)

Read fresh from `governance/RISK_LIMITS.yaml` via `packages/pricing/src/service-prices.ts`'s own `EMBEDDED_PRICING` table:

| Service | Price (USD) | Atomic (6dp USDC) |
|---|---|---|
| `company_evidence_graph.v2` | 0.0312 | 31200 |
| `web_context_verified.v2` | 0.008 | 8000 |
| `document_evidence_json.v2` (native, representative) | 0.0098 | 9800 |
| `verify_agent_output.v2` | 0.017 | 17000 |

- `FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=66000`
- `QUALIFICATION_HEADROOM_ATOMIC=13727` (79727 − 66000)
- `ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0`
- `C2_PAYMENT_QUALIFICATION_FUNDING_READY=YES`

## 8. Pre-canary public baseline (at 100/0)

`GET /`, `/health`, `/ready`, `/catalog`, `/.well-known/agent-card.json`, `/.well-known/jwks.json` on `https://utility.siteborne.net` — all `200`. `PRE_C1R2_PUBLIC_BASELINE=PASS`.

Also discovered (useful diagnostic, not a blocker): a bare-legacy `POST /mcp` `tools/list` (no envelope, no protocol-version header) returns `-32022 Unsupported protocol version` on current production `db7054c9`. Since the candidate's source is newer and includes MCP legacy-compatibility work, this gave a genuine behavioral signal for candidate attribution independent of tail logs.

## 9. Observability

`wrangler tail --version-id 8ce8cb66-f388-4fcc-b3e6-9c14b4919a93 --format json` started and confirmed alive before any traffic mutation. `C1R2_VERSION_ATTRIBUTION_READY=YES`.

## 10-12. Temporary 99/1 mutation and readback

`wrangler versions deploy db7054c9@99 8ce8cb66@1` executed exactly once at `2026-09-03T21:17:48Z`. Immediate readback confirmed `99%`/`1%`, no third version. `CANARY_TRAFFIC_MUTATIONS=1`, `C1R2_99_1_READBACK=PASS`, `C1R2_LIVE_WINDOW_START=2026-09-03T21:17:55Z`.

## 13. Immediate health

`/health`, `/ready`, `/catalog` all `200` immediately after the mutation. `C1R2_IMMEDIATE_HEALTH=PASS`.

## 14-16. Live candidate discovery sampling / MCP interoperability

Ran ~100 rotation iterations (health/ready/catalog/root/MCP/document-ingress) at ~1/sec against `https://utility.siteborne.net`, with `wrangler tail` filtered to the candidate's own version ID as the authoritative attribution source (a hit in that log is candidate traffic by construction of the filter).

**Authoritative tail-captured candidate-attributed events: 9**, all `outcome: ok`:

| Method | Path | Status |
|---|---|---|
| GET | /catalog | 200 |
| POST | /mcp | 200 |
| GET | / | 200 |
| GET | /ready | 200 |
| GET | / | 200 |
| POST | /v2/artifacts/documents | 201 |
| POST | /v2/artifacts/documents | 201 |
| POST | /v2/artifacts/documents | 201 |
| POST | /v2/artifacts/documents | 201 |

- `C1R2_CANDIDATE_SAMPLE_COUNT=9` (≥5 required)
- `CANDIDATE_FOUR_SERVICE_DISCOVERY=PARTIAL` — the candidate's own version configuration (§4, verified twice via direct binding readback) proves all four v2 route-enable flags are `true`; a candidate-attributed `/catalog`/`/mcp` call did succeed live, but this checkpoint's own sampling script only captured a boolean success marker for the MCP body (SSE-framed), not the full JSON payload, so the exact tool-name list was not independently re-captured from that specific live response. Not treated as a live-verification failure given the structural proof is solid; flagged as a minor follow-up (capture full response bodies, not just success/fail, in any future live-sampling script).
- `CANDIDATE_MCP_CONTRACT=PASS` — a well-formed JSON-RPC response containing `"tools"` was returned by the candidate.
- `CANDIDATE_MCP_INTEROPERABILITY=PASS` — the exact bare-legacy `tools/list` call that fails with `-32022` on current production succeeded against the candidate, live, at least once.
- `CANDIDATE_A2A_CONTRACT=NOT_EXECUTED` — no A2A-specific method call was made this checkpoint (only the shared `agent-card.json`/`jwks.json` GET endpoints, whose candidate-attributed responses were not distinctly captured). Not required for the eligibility gate below; flagged as a gap for `SUN-1222C2` to close before relying on A2A behavior specifically.

## 17-21. Document ingress: safety analysis, gate, bounded proof, readback, cleanup

**Safety analysis (source-derived, before any mutation):**
- `DOCUMENT_INGRESS_ENDPOINT=POST /v2/artifacts/documents`
- `DOCUMENT_INGRESS_REQUIRES_PAYMENT=NO` (route's own doc comment: "deliberately non-executing... never imports the document worker, the x402/payment modules, PCC, or the service registry")
- `DOCUMENT_INGRESS_CREATES_R2_OBJECT=YES`, `DOCUMENT_INGRESS_CREATES_D1_STATE=YES`
- `DOCUMENT_INGRESS_IDEMPOTENCY_KEY_SUPPORTED=YES` — not a caller-supplied header, but genuine **content-addressed** dedup: `storeDocumentUpload` calls `artifactsRepository.getByContentHash` before ever writing, and reuses the existing `upload_id` if found; a concurrent-write race is separately handled (`DUPLICATE_ARTIFACT` → re-read).
- `SAME_IDEMPOTENCY_KEY_REUSES_ARTIFACT=YES` — proven directly from source, then proven live (see below).
- `PRODUCTION_VERSION_WITHOUT_ROUTE_HAS_ZERO_SIDE_EFFECT=YES` — `isDocumentArtifactUploadRouteFlagEnabled` is the literal first check in the handler, before any D1/R2 access; production returns 404 (or, as observed live, a global content-type-middleware `415` when the body isn't JSON — that middleware runs even earlier, before route resolution, and also performs zero D1/R2 access).

`DOCUMENT_INGRESS_LIVE_PROOF_ELIGIBLE=YES` — every §18 condition verified true from source before any request was sent.

**Bounded live proof:** used the fixed 68-byte 1×1 PNG fixture (`sha256:431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`) with `Content-Type: image/png`. Sent attempts in batches (100 interleaved with discovery sampling, then 60 + 150 + 190 dedicated — 500 total, exactly the runbook's stated hard cap) at ≤~2 req/sec.

- Non-candidate landings (99% of traffic): uniform `415 UNSUPPORTED_MEDIA_TYPE` — this is current production's pre-existing, unrelated global JSON-only content-type gate rejecting a non-JSON POST body before route resolution; zero D1/R2 access, confirmed safe by source (§17).
- **4 candidate landings**, all returning **byte-identical response bodies**:
  ```json
  {"upload_id":"acc005f4-118e-476e-85de-7b447e6fd142","media_type":"image/png","size_bytes":68,
   "content_hash":"sha256:431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
   "expires_at":"2026-09-03T21:44:18.612Z", ...}
  ```
  Same `upload_id`, same `expires_at` across all 4 — proving content-addressed dedup held under real, repeated, probabilistically-routed candidate landings exactly as designed.

- `DOCUMENT_INGRESS_CANDIDATE_HIT=YES`
- `DOCUMENT_ARTIFACT_CREATIONS=1` (not 4 — this is the number of underlying artifacts created, which is what the authorization bounds)
- `DOCUMENT_ARTIFACT_ID_CREATED=YES`

**Artifact readback:** `wrangler r2 object get siteborne-artifacts/artifacts/431ced...` downloaded and byte-diffed identical to the local fixture. `wrangler d1 execute ... SELECT ... FROM job_artifacts WHERE id='acc005f4-...'` (table is `job_artifacts`, not `artifacts` — corrected mid-checkpoint after an initial wrong-table-name query error) returned the exact expected row: `content_hash` match, `media_type=image/png`, `byte_length=68`, `authorization_class=buyer_authorized`, `retention_class=ephemeral`, `artifact_type=input`. `DOCUMENT_ARTIFACT_READBACK=PASS`.

**Cleanup:** `wrangler r2 object delete` + `DELETE FROM job_artifacts WHERE id=...`, both confirmed by authoritative post-delete readback (R2: "key does not exist"; D1: `COUNT(*) = 0`). `DOCUMENT_ARTIFACT_CLEANUP=PASS`. No other artifact was touched.

## 22-23. Live-window health / economic guardrail

- `C1R2_CANDIDATE_5XX=0`, `C1R2_CANDIDATE_EXCEPTIONS=0`, `C1R2_MATERIAL_ERRORS=0` (all 9 tail-captured candidate events: `outcome: ok`, status 200 or 201 only).
- Zero requests were ever sent to any of the four paid v2 POST routes (`/v2/company/evidence-graph`, `/v2/web/context`, `/v2/document/evidence-json`, `/v2/verify/agent-output`) this checkpoint. `INTENTIONAL_PAID_SERVICE_REQUESTS=0`, `PAYMENT_AUTHORIZATIONS_CREATED=0`, `PAYMENT_SIGNATURES_CREATED=0`, `PAID_POSTS=0`, `FACILITATOR_SETTLE_CALLS_CREATED_BY_C1R2=0`, `USDC_TRANSFERS_CREATED_BY_C1R2=0`.

## 24-25. Restoration

`wrangler versions deploy db7054c9@100 8ce8cb66@0` executed exactly once at `2026-09-03T21:32:25Z`. `RESTORE_TRAFFIC_MUTATIONS=1`. Authoritative post-restore readback: `100%`/`0%`, exactly 2 active versions. `C1R2_FINAL_TRAFFIC_READBACK=PASS`.

Live window duration: ~14.5 minutes (`21:17:55Z`–`21:32:25Z`).

## 26. Candidate live verification verdict

All required conditions met: 99/1 readback PASS, 9≥5 candidate-attributed samples, zero errors/exceptions, MCP interoperability proven, document ingress fully proven (bounded, idempotent, cleaned up), zero economic activity, restoration proven.

`C1R2_CANDIDATE_LIVE_VERIFICATION=PASS`

(Two items — full-body capture of the candidate's MCP tool listing, and an A2A-specific live call — are flagged as minor gaps for `SUN-1222C2` rather than failures of this checkpoint; the corresponding structural/config proof was already established via direct version-binding readback in §4/C1.)

## 27. Buyer funding decision

`QUALIFICATION_BUYER_BALANCE_ATOMIC=79727`, `FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=66000`, `QUALIFICATION_HEADROOM_ATOMIC=13727`, `ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0`. `C2_PAYMENT_QUALIFICATION_FUNDING_READY=YES`.

## 28. C2 deterministic routing constraint

`preview_urls=false` remains in effect (unchanged this checkpoint) — the candidate at 0% cannot be directly HTTP-addressed. A real signed payment must never be sprayed probabilistically at 1% traffic hoping to hit the candidate (unlike the non-economic proof above, a paid request that lands on *production* instead of the intended candidate would be a real, irreversible economic transaction against the wrong code path).

`C2_DETERMINISTIC_ROUTING_PLAN`: for each of the four one-shot qualification payments, temporarily route the candidate to 100% (production immediately available as rollback at the prior version), execute exactly one paid request per service, reconcile settlement/receipt, then either continue to the next service or restore `db7054c9@100`/candidate@0% before ending the window — never attempt a payment while traffic is split, and never repeat a payment attempt against ambiguous routing.

## Final packet

```
SUN1222C1_R2=PASS
SUN1222C1_R2_AUTHORIZATION=PRESENT
C1R2_START_HEAD=0adff2e
PRE_C1R2_PRODUCTION_TRAFFIC=100%
PRE_C1R2_CANDIDATE_TRAFFIC=0%
C1R2_CANDIDATE_CONFIGURATION=PASS
C1R2_D1_MIGRATION_STATE=PASS
QUALIFICATION_BUYER_BALANCE_ATOMIC=79727
FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=66000
QUALIFICATION_HEADROOM_ATOMIC=13727
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0
CANARY_TRAFFIC_MUTATIONS=1
C1R2_99_1_READBACK=PASS
C1R2_CANDIDATE_SAMPLE_COUNT=9
CANDIDATE_FOUR_SERVICE_DISCOVERY=PARTIAL
CANDIDATE_MCP_CONTRACT=PASS
CANDIDATE_MCP_INTEROPERABILITY=PASS
CANDIDATE_A2A_CONTRACT=NOT_EXECUTED
DOCUMENT_INGRESS_LIVE_PROOF_ELIGIBLE=YES
DOCUMENT_INGRESS_CANDIDATE_HIT=YES
DOCUMENT_ARTIFACT_CREATIONS=1
DOCUMENT_ARTIFACT_READBACK=PASS
DOCUMENT_ARTIFACT_CLEANUP=PASS
C1R2_CANDIDATE_5XX=0
C1R2_CANDIDATE_EXCEPTIONS=0
C1R2_MATERIAL_ERRORS=0
INTENTIONAL_PAID_SERVICE_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_POSTS=0
FACILITATOR_SETTLE_CALLS_CREATED_BY_C1R2=0
USDC_TRANSFERS_CREATED_BY_C1R2=0
RESTORE_TRAFFIC_MUTATIONS=1
C1R2_FINAL_TRAFFIC_READBACK=PASS
C1R2_CANDIDATE_LIVE_VERIFICATION=PASS
C2_PAYMENT_QUALIFICATION_FUNDING_READY=YES
C2_DETERMINISTIC_ROUTING_PLAN=temporarily route candidate to 100% per one-shot payment with production as immediate rollback; never split traffic during a signed payment
PRODUCTION_MUTATIONS=2
ECONOMIC_TRANSACTIONS=0
SUN1222C1_R2_EVIDENCE_COMMIT_SHA=<set on commit, see follow-up correction commit>
WORKING_TREE=clean
NEXT_REQUIRED_CHECKPOINT=SUN-1222C2-FOUR-SERVICE-PAID-QUALIFICATION
```
