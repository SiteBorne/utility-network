# SUN-1222B-S3 — Four-Service Commercial-Readiness Reconciliation + Final Release Manifest

**Result: repo-only reconciliation. One genuine repo-side fix landed (secrets-gate
false positive). No deploy, no candidate upload, no Cloudflare/Modal mutation, no
economic activity.**

Start HEAD: `640e0d2` (clean). All prior SUN-1222D work (PRE, R1, R2, RESUME) is
carried forward unchanged and re-verified from current source rather than trusted
from narration.

## 1. Stale-premise correction (load-bearing)

A condensed-memory note from an earlier turn in this engagement asserted:

> "`upload_reference` and `document_url` are not [implemented]"

Re-traced from current source rather than trusted. **This was wrong for
`upload_reference`.** `POST /v2/artifacts/documents`
([document-artifact-upload-route.ts](../../apps/edge-api/src/control-plane/routes/document-artifact-upload-route.ts))
and its storage layer
([document-upload.ts](../../apps/edge-api/src/control-plane/artifacts/document-upload.ts))
were built in commit `b3878f5` (`SUN-1222B-S3-R2`), long before the checkpoint that
produced the stale note, and are wired into `index.ts` (line 221). The buyer-facing
upload path is real, tested, and — critically — already consumed end-to-end by
[document-evidence-json-v2-production-executor.ts](../../apps/edge-api/src/control-plane/production/document-evidence-json-v2-production-executor.ts)'s
`resolveUploadReference`, which performs a real D1 lookup, cross-validates the
buyer's declared `media_type`/`size_bytes`/`content_hash` against the stored
record, and fetches real bytes from R2 by content hash — all before the billable
Modal call ever runs.

`document_url` genuinely is **not** implemented anywhere (edge-api or
service-runtime layer) — confirmed by `service.ts`'s own doc comment: "only
`artifact_reference` input mode is implemented in this increment —
`upload_reference`/`document_url` are recognized by the frozen schema but not yet
supported." The frozen schema's "exactly one mode" requirement does not obligate
all three modes to exist; `upload_reference` alone is a complete, buyer-usable
path, so `document_url`'s absence is not a release blocker.

## 2. Document buyer-ingress load-bearing gate — traced end-to-end

```
buyer
  -> POST /v2/artifacts/documents (bounded read, magic-byte sniff, SHA-256,
     content-addressed store) -> upload_id capability
  -> paid request with { upload_reference: { upload_id, ... } }, sealed into
     the 402 quote's AEAD envelope (requestInputHash bound at seal time,
     x402-service.ts:1384)
  -> durable Workflow (PaidContinuationWorkflow.run) opens the envelope,
     forwards executorInput unchanged (AEAD-authenticated, cannot be
     tampered with post-quote)
  -> resolveUploadReference: fresh D1 lookup by upload_id, reject if
     expired, reject if declared media_type/size_bytes/content_hash
     disagree with the stored record, fetch bytes from R2 by content hash
     via env.ARTIFACTS constructed independently on the Workflow host
     (production-dependencies.ts:150-167) -- NOT trusting anything the
     public API Worker already resolved
  -> real DocumentEvidenceJsonService.execute against real Modal worker
  -> PCC-wrapped result, request_input_hash bound into paymentServiceLink
  -> receipt/settlement
```

`DOCUMENT_V2_COMMERCIAL_BUYER_PATH=PASS` — an independent external machine can
supply a permitted document through the public contract with zero private/
internal operator intervention, once the route/CDP flags are enabled on a
candidate (repo code path is complete; flag activation is a deploy-time decision
deliberately deferred to candidate creation, matching this repo's established
"cutover switches absent from committed config" convention — see `wrangler.toml`'s
own SUN-1205 checkpoint K comment).

## 3. Artifact / payment binding

`DOCUMENT_CONTENT_PAYMENT_BINDING=PASS`. The binding is structural, not a runtime
re-hash comparison: `executorInput` (containing the buyer's declared
`upload_reference`) and `requestInputHash` (its hash, computed once at 402-quote
time) are sealed together inside the same AEAD-authenticated continuation
envelope (H2AWI-1). Neither can drift independently post-quote without failing
envelope authentication. Server-side ground truth (the D1 artifact record) is
re-checked against the buyer's declared dimensions at execution time regardless,
closing the "buyer declares mismatched metadata" case even before the AEAD
argument is invoked. `request_input_hash` is carried into the final
`paymentServiceLink`, so a receipt can be independently checked against the exact
input that was quoted.

## 4. Artifact lifecycle — honest partial

States are explicit and correctly enforced in the direction that matters
(`created` → `validated` at upload time; `available` while unexpired; `expired`
enforced fail-closed at *read* time in `resolveUploadReference`; **never** deleted
before the durable Workflow could still need it, since nothing deletes at all).

What is **not** implemented: physical R2/D1 reclamation of expired uploads. This
is not a new discovery — it is explicitly self-flagged in
`document-upload.ts`'s own doc comment ("Physical R2/D1 reclamation after expiry
is NOT wired to a scheduled trigger in this checkpoint... Flagged as a follow-up,
not silently implied complete"), confirmed by trace: no `scheduled` export exists
anywhere in `index.ts`, and `D1ArtifactsRepository.deleteExpired()` exists but is
called from nowhere in production code (only from its own test). This is a
repo-wide pattern, not document-specific — `IdempotencyRepository`/
`QuotaRepository` have the identical unused `deleteExpired()` shape.

Given the 15-minute TTL and 10MB cap, worst-case unbounded accumulation is slow,
but it is genuinely unbounded over long uptime. Adding a Cron Trigger is
repo-only in principle, but changes a deployed script's trigger surface — outside
this checkpoint's read/trace/harden-existing-path scope, and better done as its
own small, reviewable checkpoint. **`DOCUMENT_ARTIFACT_LIFECYCLE=FAIL`** (narrow:
missing physical reclamation only; logical correctness is proven).

## 5. Document ingestion security matrix

Verified by reading and executing (not assuming) the existing test suites in
[document-upload.test.ts](../../apps/edge-api/src/control-plane/artifacts/document-upload.test.ts)
(21 cases) and
[document-artifact-upload-route.test.ts](../../apps/edge-api/src/control-plane/routes/document-artifact-upload-route.test.ts)
(13 cases), plus
[document-evidence-json-v2-production-executor.test.ts](../../apps/edge-api/src/control-plane/production/document-evidence-json-v2-production-executor.test.ts)
(7 cases covering the upload-reference resolution branch specifically):

| Matrix item | Covered | Where |
| --- | --- | --- |
| valid supported document | YES | route test: 201 on genuine PDF |
| empty document | YES | 400 |
| malformed PDF (garbage bytes) | YES | 415, magic-byte mismatch |
| MIME spoofing / extension spoofing | YES | declared-vs-sniffed disagreement, 415 |
| oversized bytes / max allowed bytes | YES | declared Content-Length 413 (cheapest path) + streamed-body 413 |
| path traversal / object-key traversal | YES by construction | id is always `randomId()`/content-hash-derived, never buyer input (§9) |
| invalid / unknown artifact ID | YES | `upload_reference_unresolved`, proven no enumeration/IDOR |
| expired artifact/reference | YES | rejected even though D1 row + R2 content still exist |
| cross-payment artifact substitution | YES | declared media_type/size_bytes/content_hash vs. stored record, independently |
| duplicate upload / replay | YES | content-addressed idempotency: identical bytes twice return the same `upload_id` |
| concurrent access | YES | concurrent-identical-content D1 race (`DUPLICATE_ARTIFACT`) handled without a false `storage_failure` |
| partial / aborted upload | YES | bounded streaming reader never buffers past limit+1 bytes regardless of Content-Length presence |
| R2 write failure | YES | surfaced as `storage_failure`, never an uncaught throw |
| D1 write failure | YES | same |
| artifact_reference mode unaffected by new code | YES | explicit regression test |
| truncated PDF / page-count overflow / polyglot / decompression bounds | Out of this layer's scope by design | `document-upload.ts`'s own doc comment: full document-structure validation is proven independently and non-duplicated in `services/modal-worker/.../document/validation.py`, exercised again at real-execution time regardless of what this layer accepts |

`document_url` is unimplemented, so its SSRF sub-matrix is not applicable:
`DOCUMENT_URL_SSRF_MATRIX=NOT_APPLICABLE`.

`DOCUMENT_INGESTION_SECURITY_MATRIX=PASS` for this layer's actual responsibility
boundary (container-plausibility + size + storage integrity); deeper
document-structure adversarial handling is a different, already-proven layer's
job, not duplicated here by design.

## 6. Secrets gate — one genuine finding, fixed

`pnpm secrets:scan` (gitleaks) flagged 4 matches, all resolving to the same 3
values: the Modal workspace proxy-token *resource IDs* (`wk-...`) recorded in the
SUN-1222D-R1/R2 evidence reports (`ORPHANED_TOKEN_DELETED`,
`LIVE_CANDIDATE_TOKEN_UNTOUCHED`, `THIRD_PRE_EXISTING_TOKEN_UNTOUCHED`,
`TOKEN_RESOURCE_ID_SAFE`). Verified these are non-secret by Modal's own
credential model: a proxy-auth credential is an ID/secret **pair** — the ID alone
authorizes nothing and is exactly what `modal workspace proxy-tokens list` already
shows in plaintext. The actual secret half of every pair created in this lineage
was staged only to a gitignored chmod-600 scratch file and securely wiped —
verified against those reports' own `*_SECRET_PRINTED_LOGGED_OR_COMMITTED=NO`
fields, never re-asserted blindly.

Fixed by adding the three exact literals (not a `wk-` pattern) to
`.gitleaks.toml`'s allowlist, matching this file's own established convention
(pinned one-off values, never path-wide exclusions, never a prefix pattern that
would also catch a real secret). Re-ran: `no leaks found` / working-tree scan OK.

## 7. Candidate `3a74686d` reconciliation (read-only)

```
CANDIDATE_3A74686D_FULL_VERSION_ID = 3a74686d-bad8-4fb0-b6b8-604292145d69
Source commit: 8de9fc3 ("SUN-1222C-1: enable ARTIFACTS R2 binding for
  document_evidence_json.v2 candidate")
```

Verified via `git merge-base --is-ancestor`:

- `b3878f5` (buyer upload path) **is** an ancestor of `8de9fc3` → the candidate
  DOES contain the buyer-ingress code.
- `8de9fc3` **predates** `c81b737` (the SUN-1222C-R3 price freeze that set current
  `document_evidence_json_native_v2`/`ocr_v2`/`table_v2`/
  `web_context_verified_direct_v2`/`verify_agent_output_standard_v2`) → the
  candidate's baked-in prices are stale.
- `8de9fc3` **predates** `5f87a05` (SUN-1222D-PRE's Workflow dispatch-registry
  fix) → the candidate's Workflow host cannot route `company_evidence_graph.v2`
  or `document_evidence_json.v2` at all (fails closed at "unsupported service").

```
CANDIDATE_3A74686D_MATCHES_FINAL_S3_HEAD=NO
CANDIDATE_3A74686D_MATCHES_FINAL_S3_ECONOMICS=NO
CANDIDATE_3A74686D_MATCHES_FINAL_BUYER_INGRESS=YES
CANDIDATE_3A74686D_FINAL_RELEASE_ELIGIBLE=NO
```

Per the runbook's own rule, this candidate is an intermediate qualification
artifact, not patchable, and must not be promoted. A live release needs a new
immutable candidate built from this checkpoint's frozen HEAD.

## 8. Final price freeze — reconciled, not re-invented

All four services were already frozen with real, dated market research earlier
the same day this checkpoint runs (`c81b737`/`36e6cae`, 2026-09-03), re-verified
here rather than redone:

| Service (pricing key) | Display price | Atomic | Market anchor | Anchor effective price | Discount vs. prior | P95 variable cost | P95 margin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `company_evidence_graph_v2` | $0.0312 | 31200 | knowledge-graph/entity-export APIs | $0.0225–$0.025 (premium justified: multi-source assembly, SSRF-safe execution, PCC/receipt) | 20% vs. $0.039 | ~$0.0015 | ~95.2% |
| `web_context_verified_direct_v2` | $0.008 | 8000 | (runbook-hypothesis-anchored, kept conservative) | n/a | 11.1% | ~$0.002 | ~75% |
| `document_evidence_json_native_v2` | $0.0098 | 9800 | Google Cloud Document AI, live-fetched (Enterprise OCR $0.0015/pg, Layout Parser ~$0.01/pg, Form Parser $0.03/pg) | kept well above commodity raw-OCR since SITEBORNE does materially more | 18.3% | ~$0.0015 | ~85% |
| `document_evidence_json_ocr_v2` | $0.0156 | 15600 | same | — | 17.9% | ~$0.005 | ~68% |
| `document_evidence_json_table_v2` | $0.0238 | 23800 | same | — | 17.9% | ~$0.006 | ~75% |
| `document_evidence_json_max_job` | $0.19 | 190000 | ceiling, unchanged | n/a | n/a | n/a | n/a |
| `verify_agent_output_standard_v2` | $0.017 | 17000 | (runbook-hypothesis-anchored, kept conservative) | n/a | 10.5% | ~$0.005 | ~71% |

All within the repo's `price_change_per_experiment_pct: 20` governance cap; all
comfortably clear `governance/RISK_LIMITS.yaml`'s `minimum_accepted_margin: 0.60`
floor (stricter than this runbook's suggested 55%, and the one actually honored).
`document_evidence_json.v2`'s billing tier (native/ocr/table) is determined by the
real worker's own output classification, not multiple buyer-selectable tiers
quoted before payment — the `max_job` ceiling is what bounds the pre-payment
quote. No floating-point settlement arithmetic anywhere in this path (all atomic
integer USDC units).

No price change was made this checkpoint — fresh evidence confirmed the existing
freeze is still current and correctly anchored, not stale.

## 9. Full release gate (re-run this checkpoint, not carried forward blindly)

| Gate | Result |
| --- | --- |
| `pnpm test` | 2799 passed, 77 skipped, 228/250 files, 0 failed |
| `pnpm typecheck` | 23/23 |
| `pnpm lint` | 16/16 |
| `pnpm build` | 12/12 |
| `pnpm test:worker-runtime` | 99/99 |
| `pnpm x402:check` | PASS |
| `pnpm mcp:check` | PASS |
| `pnpm a2a:check` | PASS |
| `pnpm secrets:scan` | PASS (after `.gitleaks.toml` fix, §6) |
| `pnpm production:preflight` | PASS |
| `pnpm pricing:check` | PASS (`EMBEDDED_PRICING` matches `governance/RISK_LIMITS.yaml` exactly) |
| `pnpm governance:validate` | 77/77 |
| `wrangler deploy --dry-run` (public API) | clean, no CDP/economic vars present |
| `wrangler deploy --config wrangler.paid-continuation-runtime.toml --dry-run` (Workflow host) | clean, `env.ARTIFACTS`/`env.DB` bound, `PAID_CONTINUATION_WORKFLOW` resolves |
| `pnpm format:check` (part of `pnpm check`) | **pre-existing FAIL, out of scope** — 449 files, none touched by this or any SUN-1222D/S3 checkpoint; a repo-wide formatting-debt cleanup, not a document/buyer-ingress/pricing defect |

## 10. Four-service commercial-readiness verdict

| Service | Real executor | Public buyer path | Dependency closure | Fail-closed x402 | Price frozen | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `company_evidence_graph.v2` | YES | YES (`{company_name, requested_field_groups}` direct input, no artifact needed) | YES (SUN-1222D-PRE) | YES | YES | `COMPANY_V2_COMMERCIAL_READY=YES` |
| `web_context_verified.v2` | YES | YES (direct URL input) | YES | YES | YES | `WEBCTX_V2_COMMERCIAL_READY=YES` |
| `document_evidence_json.v2` | YES | YES (`upload_reference`) | YES (SUN-1222D-PRE + R2) | YES | YES | `DOCUMENT_V2_COMMERCIAL_READY=YES` (lifecycle reclamation gap noted §4, non-blocking for correctness) |
| `verify_agent_output.v2` | YES | YES (direct input) | YES | YES | YES | `VERIFY_V2_COMMERCIAL_READY=YES` |

All four are commercially ready at the repo level. None of the four is proven
*live* — that requires a new immutable candidate (not `3a74686d`), Modal/Cloudflare
credential activation already partially done in SUN-1222D-R2, and a fresh,
separately authorized paid qualification.
