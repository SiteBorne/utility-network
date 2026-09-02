# SUN-1222C-1-REMEDIATION — Document Buyer-Upload Real-App Fix, New Candidate, Live Qualification

**Lineage.** Prior checkpoint: SUN-1222C-1 (`796f6cb`, four-service immutable
candidate `9080c1dd-e96f-4204-a857-fed85e6646cc` @0%, production
`db7054c9-76ee-4830-aabe-8a4542261b6a` @100%). SUN-1222C-1 discovered that
`POST /v2/artifacts/documents` was structurally unreachable in the real
deployed Worker: the isolated route-level test suite (38 cases) mounted the
route into a bare Hono instance, never exercising `index.ts`'s real global
middleware chain, and so never caught that
`app.use('*', createContentTypeMiddleware())` unconditionally rejects any
non-`application/json` request with 415 — before the route handler, and
therefore before `R2ArtifactStoreAdapter.put`, ever runs. Every document
upload's accepted media types (`application/pdf`, `image/png`,
`image/jpeg`) are disjoint from `application/json`; no Content-Type could
ever satisfy both checks.

Authorization for this checkpoint covered exactly: repo-only source/test/
config/doc/commit mutations implementing the narrowest fix plus a real-
assembled-app regression test; one new 0%-traffic Cloudflare candidate
version superseding `9080c1dd-…` (kept, not deleted); one bounded live R2
synthetic-artifact write+delete through the new candidate; reuse of the
existing `MODAL_DOCWORKER_*` secrets as-is (no new credential); and zero
economic action. All five held throughout.

## 1. Root cause (§2)

```
DOCUMENT_UPLOAD_ROUTE=POST /v2/artifacts/documents
  (apps/edge-api/src/control-plane/routes/document-artifact-upload-route.ts)
GLOBAL_CONTENT_TYPE_MIDDLEWARE_FILE=
  apps/edge-api/src/control-plane/middleware/request-context.ts
  (createContentTypeMiddleware, mounted app.use('*', …) in index.ts)
ROUTE_CONTENT_VALIDATION_FILE=
  apps/edge-api/src/control-plane/artifacts/document-upload.ts
NO_CONTENT_TYPE_CAN_SATISFY_BOTH_BEFORE_FIX=YES
```

`AllowedContentTypes = ['application/json', 'application/json; charset=utf-8']`
(global) vs. `DOCUMENT_UPLOAD_ALLOWED_MEDIA_TYPES = ['application/pdf',
'image/png', 'image/jpeg']` (route) — empty intersection, confirmed by
reading both files directly, not inferred.

## 2. Real-app RED (§3), proven live

New file `apps/edge-api/src/index.document-upload-real-app.test.ts`, built
against the SAME assembled app `index.test.ts` already uses
(`import app from './index'`), never an isolated Hono mount. Run against
pre-fix code:

```
REAL_APP_DOCUMENT_UPLOAD_RED=YES
ROUTE_REACHED_BEFORE_FIX=NO
R2_WRITE_CALLS_BEFORE_FIX=0
```

5/10 cases failed, every failure showing `415` where `201`/`404`/`400` was
expected — the route and its R2 write seam were never reached.

## 3. Causal design (§4)

```
SELECTED_MIDDLEWARE_FIX_MODEL=
  narrow route+method exemption list (NON_JSON_BODY_ROUTES) inside
  createContentTypeMiddleware, scoped to exactly POST
  /v2/artifacts/documents; the route's own already-tested media-type/
  magic-byte validation (document-upload.ts) is the real content-type
  authority for that one path.
WHY_NARROWEST_SAFE=
  Rejected (a) restructuring mount order to register the route before the
  global middleware stack — Hono composes matched handlers in
  registration order, so this would also skip structured-error, security-
  headers, timing, audit-context, and body-size middleware for the
  exempted route, a far larger behavior change than intended; and
  (b) weakening AllowedContentTypes globally — would remove JSON-only
  protection from every other endpoint. The chosen fix touches exactly one
  function, changes behavior for exactly one route+method pair, and every
  other route's JSON-only enforcement is provably unchanged (§5 below).
```

## 4. Real-app GREEN (§10) and mutation/reversion proof (§11)

```
REAL_APP_DOCUMENT_UPLOAD_GREEN=PASS   (10/10 cases)
DOCUMENT_UPLOAD_MUTATION_PROOF=PASS
```

Fix applied → 10/10 pass. Fix temporarily reverted (mutation) → the same
5/10 cases fail identically to the original RED (415 where 201/404/400
expected). Fix restored → 10/10 pass again. Not narrated — both states
executed live in this session.

## 5. Content/auth/security matrix (§5-9)

```
SUPPORTED_UPLOAD_MEDIA_TYPES=application/pdf, image/png, image/jpeg
UPLOAD_AUTH_REGRESSION=PASS   (flag-absent -> 404, zero R2 writes)
R2_OBJECT_KEY_SAFETY=PASS     (key = prefix + server-computed SHA-256 hex;
                                buyer input never becomes a key/id anywhere)
ARTIFACT_ID_SECURITY_MODEL=
  upload_id = crypto.randomUUID() (122-bit CSPRNG, unguessable);
  capability-based — possession of the id is the authorization, no buyer-
  identity binding; 900s TTL enforced at *read* time
  (resolveUploadReference); content-addressed dedup reuses the same
  upload_id for byte-identical re-uploads (not a defect — R2's own put()
  already no-ops on an existing hash-keyed object, this mirrors that at
  the D1 layer). Pre-existing model from SUN-1222B-S3-R2, re-verified
  here, not redesigned (no real defect found).
ARTIFACT_ID_COLLISION_RISK_ACCEPTABLE=YES
```

New test coverage also proves: unrelated JSON routes' 415 enforcement is
completely unchanged (both directions — non-JSON body still rejected,
JSON body still reaches its own gating); oversized declared
`Content-Length` still 413 with zero R2 writes; empty body still 400 with
zero R2 writes; JSON-content-type-with-non-document-body still 415;
declared-vs-sniffed media-type mismatch still 415 — all with zero R2
writes.

## 6. Isolated tests remain secondary (§12)

```
document-upload.test.ts:                    18/18 PASS
document-artifact-upload-route.test.ts:      13/13 PASS
ISOLATED_ROUTE_TESTS_SUFFICIENT_FOR_DEPLOYMENT=NO
```
Recorded explicitly, per this checkpoint's own §12: these tests never
exercised the global middleware chain and so could not have caught this
defect on their own. `index.document-upload-real-app.test.ts` is now the
permanent release regression that would.

## 7. Full repository gate (§13-18)

```
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
  (siteborne_company_evidence_graph -> company_evidence_graph.v2,
   siteborne_web_context_verified -> web_context_verified.v2,
   siteborne_document_evidence_json -> document_evidence_json.v2,
   siteborne_verify_agent_output -> verify_agent_output.v2 — confirmed
   both from source and live against the new candidate's real MCP
   tools/list, §13/§30)
MCP_REGRESSION=PASS       (protocol-mcp: 37/37; legacy='stateless' intact)
A2A_REGRESSION=PASS       (protocol-a2a: 51/51; a2a-route.test.ts 2/2)
AGENT_CARD_JWS=PASS       (unchanged; 8 versioned skill ids confirmed live
                            against candidate, §30)
X402_REGRESSION=PASS      (protocol-x402: full suite green, unchanged)

TYPECHECK=23/23 PASS
BUILD=12/12 PASS
LINT=16/16 PASS
TEST_FILES=223 passed | 22 skipped (245)
TESTS_PASS=2700
TESTS_SKIPPED=74
  (was 2690/74/0 before this checkpoint — +10 new, 0 regressed)
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
WORKER_RUNTIME=99/99 scenarios passed
SSRF_DNS_REBINDING=PASS (covered inside worker-runtime's 99 scenarios;
                          unchanged by this checkpoint)
SECRETS_SCAN=PASS (gitleaks: 662 commits + working tree, no leaks)
PRODUCTION_PREFLIGHT=PASS (--config-only)
WRANGLER_DRY_RUN=PASS (env.ARTIFACTS now present in the bundle's binding
                        table, matching SUN-1222C-1's R2 enablement)

Also run (superset of the composite `pnpm check` pipeline, all PASS):
governance:validate, state:validate, tasks:validate, pcc:generate:check,
schemas:check, services:generate:check, openapi:generate:check,
pricing:check, contracts:baseline:verify, contracts:compat:check,
contracts:release:verify, migrations:verify, verification:check,
document-worker:check, document-worker:fixtures:verify, d1:test,
control-plane:test, python:test:pcc (91 passed), python:test:modal
(88 passed), mcp:check, x402:check, a2a:check, nevermined:check.
```

**Known, pre-existing, out-of-scope gap** (not introduced by this
checkpoint): `format:check` fails on 442 files repo-wide (`adapters:check`
and `services-runtime:check` fail transitively on this same condition, in
packages this checkpoint never touched). Confirmed via `git stash`
comparison against the pre-remediation commit (`796f6cb`) that the same
count of pre-existing warnings is present with this checkpoint's changes
removed. Both files this checkpoint actually wrote/edited
(`request-context.ts`, `index.document-upload-real-app.test.ts`) pass
`prettier --check` individually. Not fixed here — reformatting 442
unrelated files is outside this checkpoint's narrowest-fix mandate and its
repo-only, focused-change containment. Flagged, not silently absorbed.

## 8. Fix commit (§19)

```
REMEDIATION_FIX_COMMIT_SHA=2b0ab01808670fff7c3d5d2250fbce0e9e5bbe2e
```
Working tree clean immediately before any external mutation below.

## 9. Pre-candidate production readback (§20)

```
$ wrangler deployments list  (tail)
Version(s):  (100%) db7054c9-76ee-4830-aabe-8a4542261b6a
             (0%)   9080c1dd-e96f-4204-a857-fed85e6646cc  [historical]
PRE_REMEDIATION_PRODUCTION_TRAFFIC_READBACK=PASS
```

## 10. Candidate freeze and exactly one new immutable candidate (§21-23)

```
NEW_CANDIDATE_SOURCE_HEAD=2b0ab01808670fff7c3d5d2250fbce0e9e5bbe2e
NEW_CANDIDATE_CONFIG_DIFF=
  identical bindings/vars to 9080c1dd's own config (confirmed via
  `wrangler versions view 9080c1dd-…` read first, then dry-run compared
  byte-for-byte against the same --var set); no --secrets-file passed —
  the three MODAL_DOCWORKER_* secrets already exist at the account level
  (confirmed read-only via `wrangler secret list`) and are inherited
  automatically, satisfying "no new/rotated/replaced Modal credential."
NEW_CANDIDATE_SECRET_CHANGES=0
```

```
$ wrangler versions upload --message "SUN-1222C-1-REMEDIATION: document-upload
  real-app middleware fix (repo-only source 2b0ab01); 0% traffic" \
  --tag sun1222c1-remediation-candidate \
  --var PAID_ROUTES_ENABLED:true --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true \
  --var COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true \
  --var PRODUCTION_ENABLED:true \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
  --var PAYMENT_ENVIRONMENT:production
Uploaded siteborne-utility-edge (3.07 sec)
Worker Version ID: 3a74686d-bad8-4fb0-b6b8-604292145d69
```
Validated with `--dry-run` first (identical binding table, all vars shown
`(hidden)`) before the real upload. Not deployed by this command —
`versions upload` never shifts traffic on its own.

```
CANDIDATE_UPLOADS=1
REMEDIATION_CANDIDATE_VERSION_ID=3a74686d-bad8-4fb0-b6b8-604292145d69
```

`wrangler versions view 3a74686d-…` readback: `env.ARTIFACTS` (R2) present,
all three `MODAL_DOCWORKER_*` secret names present, all 9 route/production
vars `true`/`production` exactly matching `9080c1dd-…`'s own config.

```
REMEDIATION_CANDIDATE_READBACK=PASS
```

## 11. Zero-traffic registration (§21-23 continued)

```
$ wrangler versions deploy db7054c9-…@100% 3a74686d-…@0% --name
  siteborne-utility-edge -y
SUCCESS  Deployed siteborne-utility-edge version db7054c9-… at 100% and
         version 3a74686d-… at 0% (1.72 sec)
```
Readback (`wrangler deployments list`, tail) confirms the split exactly as
issued; `9080c1dd-…` remains a historical, non-serving version (not
deleted, no longer the active 0% slot).

## 12. Pre-live-artifact auth/privacy check (§24)

```
$ wrangler r2 bucket domain list siteborne-artifacts
There are no custom domains connected to this bucket.
$ wrangler r2 bucket dev-url get siteborne-artifacts
Public access via the r2.dev URL is disabled.
R2_BUCKET_PRIVATE=YES
```

Live probe of the new candidate with a deliberately wrong Content-Type
(`text/plain`, no valid document):
```
$ curl -X POST https://utility.siteborne.net/v2/artifacts/documents \
  -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="3a74686d-…"' \
  -H 'content-type: text/plain' --data 'not a document'
-> 415
```
`wrangler r2 bucket info siteborne-artifacts` before and after: `object_count:
0` both times.
```
CANDIDATE_UNAUTH_UPLOAD_FAIL_CLOSED=YES
CANDIDATE_UNAUTH_R2_WRITES=0
```

## 13. Exactly one bounded live artifact upload (§25)

Fixture: `services/modal-worker/fixtures/pdf/native_text_one_page.pdf`
(repo-committed, deterministic, 1530 bytes, known SHA-256, no sensitive
data — the same fixture SUN-1222C-1 used for its Modal auth smoke test).

```
$ curl -X POST https://utility.siteborne.net/v2/artifacts/documents \
  -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="3a74686d-…"' \
  -H 'content-type: application/pdf' --data-binary @native_text_one_page.pdf
-> 201
{"upload_id":"4254fc94-3e71-4de3-a050-62b5bea27181",
 "media_type":"application/pdf","size_bytes":1530,
 "content_hash":"sha256:bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3",
 "expires_at":"2026-09-02T14:07:11.064Z", …}
```
Content hash matches the fixture's independently-computed local SHA-256
exactly. **This is the live proof the fix works in the real deployed
Worker, not only in local vitest.**

```
R2_TEST_OBJECT_WRITES=1
```

## 14. R2 authoritative readback (§26)

```
$ wrangler r2 object get siteborne-artifacts/artifacts/bed592e5…5bab3
  --remote --file <local>
Download complete.
$ shasum -a 256 <local>
bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3  <local>
```
Size (1530 bytes) and hash both match exactly. Bucket privacy unchanged
(dev-url still disabled, checked again after the write).
```
LIVE_ARTIFACT_R2_ROUNDTRIP=PASS
```
(Note: `wrangler r2 object get`/`delete` default to a *local* simulated R2
instance unless `--remote` is passed — every object operation in this
checkpoint explicitly used `--remote` against the real bucket; the bucket-
level `object_count` figure in `r2 bucket info` lagged the real write,
consistent with R2's own eventually-consistent bucket analytics, not with
the object being absent — confirmed present by direct remote fetch.)

## 15. Document service candidate probe, unpaid (§27-28)

```
$ curl -X POST https://utility.siteborne.net/v2/document/evidence-json \
  -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="3a74686d-…"' \
  -H 'content-type: application/json' \
  -d '{"upload_reference":{"upload_id":"4254fc94-…","media_type":"application/pdf",
      "size_bytes":1530,"content_hash":"sha256:bed592e5…5bab3"}}'
-> 402 {"error":"payment_required","x402_version":2,"quote_id":"qte_dc3c82ad…",
        "requirement_id":"req_eea05c9b…"}
```
A schema-validation failure would have produced `400 invalid_request`
(confirmed shape from the same route, other services below) — the `402`
response instead proves the `upload_reference` body was structurally
accepted and the request reached the real economics boundary.
```
DOCUMENT_CANDIDATE_ARTIFACT_REFERENCE_ACCEPTED=YES
DOCUMENT_UNPAID_GATE=PASS
DOCUMENT_UNPAID_EXECUTOR_CALLS=0
DOCUMENT_ARTIFACT_RESOLUTION_PROVEN=NOT_AVAILABLE_WITHOUT_PAYMENT
  (architecturally correct — resolveUploadReference runs inside the paid
  production executor, after quote/payment, per SUN-1222B-S3-R2's own
  design; no internal non-economic seam bypasses that, and none should)
```

## 16. Cleanup of the one synthetic artifact (§29)

```
$ wrangler r2 object delete siteborne-artifacts/artifacts/bed592e5…5bab3 --remote
Delete complete.
$ wrangler r2 object get siteborne-artifacts/artifacts/bed592e5…5bab3 --remote
ERROR: The specified key does not exist.
R2_TEST_OBJECT_DELETES=1
TEST_ARTIFACT_PRESENT_AFTER_CLEANUP=NO
```
Local scratch copies of the fetched object were also deleted; nothing
sensitive (a public-domain synthetic PDF fixture already committed to the
repo) was ever at risk. The D1 metadata row for this upload is governed
by the pre-existing 900s TTL / read-time-expiry model (§5 above) — no
separate D1 delete was in scope or needed; the row carries no sensitive
data (id, hash, size, timestamps only).

## 17. Four-service candidate discovery (§30)

```
$ curl https://utility.siteborne.net/catalog  [version-override header]
company_evidence_graph.v2  enabled=True ready=True status=production  $0.039
document_evidence_json.v2  enabled=True ready=True status=production  $0.012
verify_agent_output.v2     enabled=True ready=True status=production  $0.019
web_context_verified.v2    enabled=True ready=True status=production  $0.009

$ curl .../.well-known/agent-card.json  [version-override header]
skills: company_evidence_graph.v1, web_context_verified.v1,
        document_evidence_json.v1, verify_agent_output.v1,
        company_evidence_graph.v2, web_context_verified.v2,
        document_evidence_json.v2, verify_agent_output.v2   (8/8)

$ curl -XPOST .../mcp  initialize + tools/list  [version-override header]
tools: siteborne_company_evidence_graph, siteborne_web_context_verified,
       siteborne_document_evidence_json, siteborne_verify_agent_output,
       siteborne_get_quote, siteborne_get_service_health
protocolVersion negotiated: 2025-11-25 (legacy='stateless' intact)

$ curl .../services/document_evidence_json.v2  [version-override header]
{ input_schema, output_schema, bounds: {max_input_bytes:10485760, …} }
  -- per-service detail endpoint, matches openapi.json's own design
     (discovery endpoints only in the top-level openapi.json; per-service
     richer detail lives at /services/{id} -- unchanged from the design
     already audited in SUN-1222B-S3-CONTINUE, not a new regression)
```
```
ALL_FOUR_CANDIDATE_DISCOVERY=PASS
```

## 18. Four unpaid fail-closed probes (§31)

```
$ curl -XPOST .../v2/company/evidence-graph  {"company_name":"Example Corp"}
-> 402 payment_required
$ curl -XPOST .../v2/web/context  {"target_url":"https://example.com/","retrieval_mode":"direct"}
-> 402 payment_required
$ curl -XPOST .../v2/document/evidence-json  (upload_reference, §15 above)
-> 402 payment_required
$ curl -XPOST .../v2/verify/agent-output  {verification_contract, candidate_output,
   required_schema, verification_mode}
-> 402 payment_required
```
```
COMPANY_UNPAID_GATE=PASS
WEBCTX_UNPAID_GATE=PASS
DOCUMENT_UNPAID_GATE=PASS
VERIFY_UNPAID_GATE=PASS
```
All four: a `quote_id`/`requirement_id` pair only — no `X-PAYMENT` header
was ever sent, no signature created, no settlement attempted, zero
executor invocation for any of the four.

## 19. Production containment (§32)

```
$ wrangler deployments list  (tail)
Version(s):  (100%) db7054c9-76ee-4830-aabe-8a4542261b6a
             (0%)   3a74686d-bad8-4fb0-b6b8-604292145d69
PRODUCTION_CONTAINMENT=PASS
```

## 20. Zero-economic-action proof (§33)

```
INTENTIONAL_402_PAYMENT_QUALIFICATIONS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS=0
USDC_TRANSFER_ATOMIC=0
BUYER_WALLET_FUNDING=0
```
Every economic gate encountered in this checkpoint was deliberately left
unresolved (402 returned and not paid), by construction — no code path in
this session ever constructs, signs, or submits a payment authorization.

## 21. Buyer balance readback (§34)

```
$ eth_call balanceOf(0x516F…EcB99) @ 0x8335…02913 (USDC), Base mainnet,
  "latest" -- read-only, no gas, no signing, no state change, fresh this
  session
-> 0x4afd = 19197 base units (6 decimals) = $0.019197 USDC
CURRENT_BUYER_USDC_ATOMIC=19197
```
Unchanged from SUN-1222C-1's own reading — no funding action taken by
either checkpoint.

## 22. Payment qualification readiness (§35)

```
FOUR_SERVICE_CANDIDATE_NON_ECONOMIC_READY=YES
```
All required conditions held: real-app upload regression PASS; R2 private
artifact roundtrip PASS; document artifact reference accepted correctly;
all four discovery coherent; all four unpaid gates fail closed; full repo
gate clean (excepting the pre-existing, unrelated, disclosed
`format:check` gap); candidate at 0%; production at 100%; zero economic
activity. This does **not** mean all four are real-paid qualified — no
service has completed an actual settled payment in this checkpoint or its
predecessor.

## 23. Next payment funding calculation (§36)

Using the frozen price card read live from the candidate's own `/catalog`
(§17), at 6-decimal USDC atomic units:

```
COMPANY_QUALIFICATION_ATOMIC=39000    ($0.039)
WEBCTX_QUALIFICATION_ATOMIC=9000      ($0.009)
DOCUMENT_QUALIFICATION_ATOMIC=12000   ($0.012 -- smallest representative:
                                        the one-page fixture already
                                        uploaded and referenced above)
VERIFY_QUALIFICATION_ATOMIC=19000     ($0.019)
TOTAL_QUALIFICATION_ATOMIC=79000      ($0.079)
CURRENT_BUYER_USDC_ATOMIC=19197
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=59803   ($0.059803)
```
No price was altered to fit the wallet; no funding action taken. These
figures match SUN-1222B-S3-CONTINUE's earlier, independently-derived
total exactly — no price drift between checkpoints.

## 24. Final packet (§38)

```
SUN1222C1_REMEDIATION=PASS
AUTHORIZATION=PRESENT
DOCUMENT_UPLOAD_ROUTE=POST /v2/artifacts/documents
NO_CONTENT_TYPE_CAN_SATISFY_BOTH_BEFORE_FIX=YES
REAL_APP_DOCUMENT_UPLOAD_RED=YES
SELECTED_MIDDLEWARE_FIX_MODEL=narrow route+method exemption in
  createContentTypeMiddleware, scoped to POST /v2/artifacts/documents
REAL_APP_DOCUMENT_UPLOAD_GREEN=PASS
DOCUMENT_UPLOAD_MUTATION_PROOF=PASS
UPLOAD_AUTH_REGRESSION=PASS
R2_OBJECT_KEY_SAFETY=PASS
DOCUMENT_ARTIFACT_LOCAL_E2E=PASS (per §5/§15; unpaid gate correctly blocks
  executor invocation both locally and live against the candidate)
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
MCP_REGRESSION=PASS
A2A_REGRESSION=PASS
AGENT_CARD_JWS=PASS
X402_REGRESSION=PASS
TYPECHECK=23/23 PASS
BUILD=12/12 PASS
LINT=16/16 PASS
TEST_FILES=223 passed | 22 skipped (245)
TESTS_PASS=2700
TESTS_SKIPPED=74
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
WORKER_RUNTIME=99/99 PASS
SSRF_DNS_REBINDING=PASS
SECRETS_SCAN=PASS
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS
REMEDIATION_FIX_COMMIT_SHA=2b0ab01808670fff7c3d5d2250fbce0e9e5bbe2e
CANDIDATE_UPLOADS=1
REMEDIATION_CANDIDATE_VERSION_ID=3a74686d-bad8-4fb0-b6b8-604292145d69
REMEDIATION_CANDIDATE_READBACK=PASS
R2_TEST_OBJECT_WRITES=1
LIVE_ARTIFACT_R2_ROUNDTRIP=PASS
DOCUMENT_CANDIDATE_ARTIFACT_REFERENCE_ACCEPTED=YES
DOCUMENT_UNPAID_GATE=PASS
DOCUMENT_UNPAID_EXECUTOR_CALLS=0
R2_TEST_OBJECT_DELETES=1
TEST_ARTIFACT_PRESENT_AFTER_CLEANUP=NO
ALL_FOUR_CANDIDATE_DISCOVERY=PASS
COMPANY_UNPAID_GATE=PASS
WEBCTX_UNPAID_GATE=PASS
VERIFY_UNPAID_GATE=PASS
PRODUCTION_CONTAINMENT=PASS
INTENTIONAL_402_PAYMENT_QUALIFICATIONS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS=0
USDC_TRANSFER_ATOMIC=0
CURRENT_BUYER_USDC_ATOMIC=19197
COMPANY_QUALIFICATION_ATOMIC=39000
WEBCTX_QUALIFICATION_ATOMIC=9000
DOCUMENT_QUALIFICATION_ATOMIC=12000
VERIFY_QUALIFICATION_ATOMIC=19000
TOTAL_QUALIFICATION_ATOMIC=79000
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=59803
FOUR_SERVICE_CANDIDATE_NON_ECONOMIC_READY=YES
PRODUCTION_MUTATIONS_EXCEPT_NEW_0PCT_CANDIDATE=0
EVIDENCE_COMMIT_SHA=<this file's own commit, see below>
WORKING_TREE=clean (post-commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-2-FOUR-SERVICE-REAL-PAID-QUALIFICATION
  -- gated on a separate funding decision/authorization first: current
  buyer balance ($0.019197) covers none of the four $0.079 total; a
  funding top-up of at least $0.059803 is required before any real paid
  qualification can begin.
```

DO NOT FUND THE BUYER. DO NOT SIGN ANY PAYMENT. DO NOT SUBMIT ANY PAID
REQUEST. DO NOT MOVE TRAFFIC. — all held throughout this checkpoint.
