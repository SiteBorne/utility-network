# SUN-1222C-R3 — Document V2 Candidate Deploy + Real-Paid Qualification (§0–21, stopped at financial authorization gate)

Status: **STOPPED AT §21 (financial authorization gate) — awaiting standalone user authorization.**

## 0–1. Lineage / authorization

- R3_DEPLOYMENT_AUTHORIZATION=PRESENT (standalone user message preceding this checkpoint)
- Inherited: SUN-1222C-R2=PASS, evidence 81200de, DOCUMENT_V2_DEPLOY_READY=YES

## 2. Repository reconciliation

- R3_START_HEAD=81200dea124aaa930df3c1973bcccf3ed3919959
- R2_EVIDENCE_REACHABLE=YES
- WORKING_TREE_RELEASE_CLEAN=YES

## 3. Production freeze (read-only)

- R3_CURRENT_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
- R3_CURRENT_PRODUCTION_TRAFFIC=100%
- R3_ACTIVE_VERSION_COUNT=2 (production 100% + one candidate 0%)
- No traffic mutation performed.

## 4. Service-tool contract mapping

- MCP: `siteborne_document_evidence_json` → `document_evidence_json.v2` (packages/protocol-mcp/src/constants.ts:15)
- A2A: `document_evidence_json.v2` present (packages/protocol-a2a/src/constants.ts:28)
- Registry/discovery resolver: `production-payment.ts:400` — dedicated CDP resolver
- Route: `production-document-evidence-v2-cdp-route.ts`; Executor: `document-evidence-json-v2-production-executor.ts`; Workflow: `PAID_CONTINUATION_WORKFLOW` (shared, confirmed at composition:75)
- One pre-existing, non-blocking documentation gap found: `routes/catalog.ts`'s OpenAPI `operationId: serviceMetadata` path-parameter `enum` still lists only `document_evidence_json.v1` (and the v1-only sibling IDs for the other three services) — stale since the v2 cutover. This is a static OpenAPI enum, not the runtime discovery path (which is D1 + `EFFECTIVE_DISCOVERY_RESOLVERS`-driven and independently confirmed correct below). Not a release blocker; out of R3's authorized scope (OpenAPI generator, unrelated file).
- DOCUMENT_V2_PRIMARY_TOOL_MAPPING=PASS

## 5. Zero-fixture proof

Traced `document-evidence-json-v2-production-executor.ts`: `productionEnabled: false` / `implementationStatus: 'local_fixture_verified'` is the permanently-scoped, unrelated SUN-0600 dispatch-registry gate label (documented in the executor's own comment, matching the same pattern already proven for the other three v2 services). What actually governs real-vs-fixture behavior is `context.execution_mode: 'live'` and the injected `worker` — never constructed inside the executor. Traced the caller: `document-evidence-json-v2-cdp-composition.ts:185` constructs `new ModalDocumentWorkerBridge(...)` (never `FixtureDocumentWorkerBridge`); missing `MODAL_DOCWORKER_*` credentials throw a `blocked_external` error (fail-closed), never a silent fixture fallback.

- DOCUMENT_V2_REAL_EXECUTOR=YES
- DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE=NO
- DOCUMENT_V2_SYNTHETIC_FALLBACK_REACHABLE=NO

## 6. Document worker proof (names only)

- DOCUMENT_MODAL_ENDPOINT=`MODAL_DOCWORKER_ENDPOINT_URL` (name only; value not read)
- `wrangler secret list` confirms `MODAL_DOCWORKER_ENDPOINT_URL`, `MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET` present on the Worker (13 secrets total, names only, no values read/printed)
- DOCUMENT_MODAL_AUTH_CONFIGURED=YES
- DOCUMENT_MODAL_CREDENTIAL_ROTATION_REQUIRED=NO (existing credential reused, no new mint)

## 7. R2 artifact storage proof

- DOCUMENT_R2_BINDING=ARTIFACTS
- DOCUMENT_R2_BUCKET=siteborne-artifacts
- DOCUMENT_R2_PRIVATE=YES
- DOCUMENT_UPLOAD_SECURITY_BASELINE=PASS (per SUN-1222C-R2 audit, 48 tests, no defect)

## 8. Residual-risk acceptance

- SCHEDULED_PHYSICAL_CLEANUP=NOT_IMPLEMENTED (carried forward, non-blocking; expiry enforced at read-time)
- FREE_UPLOAD_RATE_LIMIT=NOT_IMPLEMENTED (carried forward, non-blocking)
- DOCUMENT_R2_RESIDUAL_RISKS_ACCEPTED_FOR_QUALIFICATION=YES (not accepted forever)

## 9. Economic source of truth

- DOCUMENT_V2_PRICING_MODEL=tiered per-page (native/ocr/table) with a hard `max_job` authorization ceiling; actual = min(sum(page tier prices), ceiling)
- DOCUMENT_V2_PRICE_SOURCE_FILE=`packages/pricing/src/service-prices.ts` (`document_evidence_json_native=0.012`, `_ocr=0.019`, `_table=0.029`, `_max_job=0.19`) + `packages/pricing/src/document-usage.ts` (`calculateDocumentUsage`)
- DOCUMENT_V2_MAX_AMOUNT_ATOMIC=190000
- PRICE_DETERMINABLE_PRE_PAYMENT=YES (the `upto` ceiling is declared in the 402 before execution; final actual amount is measured post-execution and capped at the ceiling — by design of the `upto` scheme, not a gap)

## 10. Canonical qualification request

Reused the already-proven repo-committed fixture (independently re-hashed, not assumed from narration):

- QUALIFICATION_FIXTURE_SHA256=bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3 (`services/modal-worker/fixtures/pdf/native_text_one_page.pdf`, independently reconfirmed via local `shasum -a 256`)
- QUALIFICATION_FILE_BYTES=1530
- QUALIFICATION_PAGE_COUNT=1
- QUALIFICATION_PROCESSING_MODE=native (single page, native text — no OCR, no tables)
- QUALIFICATION_UPLOAD_BODY=raw PDF bytes, `content-type: application/pdf`, `POST /v2/artifacts/documents`
- QUALIFICATION_PAID_BODY=`{"upload_reference":{"upload_id":"<issued>","media_type":"application/pdf","size_bytes":1530,"content_hash":"sha256:bed592e5...5bab3"}}`

## 11. Pre-candidate regression

| Gate | Result |
|---|---|
| typecheck | PASS (exit 0) |
| lint | PASS (16/16 successful) |
| build | PASS (12/12 successful) |
| full test suite | 2700 passed, 74 skipped, 0 failed (223 test files) |
| gitleaks (670 commits, actual repo history) | PASS — no leaks (a separate filesystem-only `--no-git` scan flagged the local, gitignored, never-committed `.dev.vars` dev-secrets file; confirmed via `git ls-files .dev.vars` = empty and `git check-ignore -v .dev.vars` = ignored by `.gitignore:29` — not a repo/commit-history leak) |
| `pnpm production:preflight` | PASS (12/12 paid routes structurally unavailable pre-economics; all required secret names present; zero mutating Cloudflare API calls) |
| `wrangler deploy --dry-run` | PASS (bindings confirmed: `ARTIFACTS` R2, `DB` D1, `PAID_CONTINUATION_WORKFLOW`, `CATALOG` KV, `JOBS`/`EVENTS` queues, `BROWSER`, `AI`) |

## 12–13. Candidate manifest / no-surprise gate

Since SUN-1222C-1-REMEDIATION's candidate `3a74686d-bad8-4fb0-b6b8-604292145d69` was built (source commit `2b0ab01`), the six commits added to HEAD are five evidence-report-only commits plus one that touches exactly one non-runtime file: `packages/provider-adapters/fixtures/FIXTURE_MATRIX.yaml` (a test-only fixture never imported by any non-test source file — confirmed via repo-wide grep). **Runtime source is unchanged since the existing 0%-traffic candidate `3a74686d` was built.**

- CANDIDATE_SOURCE_HEAD=2b0ab01 (the commit `3a74686d` was actually built from; current HEAD 81200de is source-identical for Worker-bundle purposes)
- CANDIDATE_INCLUDED_COMMITS=all commits through 2b0ab01
- CANDIDATE_DOCUMENT_SERVICE_ACTIVE=true (production_enabled/production_ready/protocol_status='production' confirmed live on the candidate, §16)
- CANDIDATE_PRICE_CONFIG=native 0.012 / ocr 0.019 / table 0.029 / ceiling 0.19 USDC
- CANDIDATE_BINDINGS=ARTIFACTS(R2)/DB(D1)/PAID_CONTINUATION_WORKFLOW/CATALOG(KV)/JOBS+EVENTS(queues)/BROWSER/AI
- CANDIDATE_SECRET_NAMES=(names only, unchanged) MODAL_DOCWORKER_*, CDP_API_KEY_*, AGENT_CARD_SIGNING_PRIVATE_KEY, PAID_RECEIPT_SIGNING_*, PAYMENT_CONTINUATION_ENCRYPTION_KEY, NVM_API_KEY, MODAL_WEBCTX_*
- CANDIDATE_D1_MIGRATIONS=none new
- CANDIDATE_PUBLIC_BEHAVIOR_CHANGES=none since `3a74686d`
- CANDIDATE_ECONOMIC_CHANGES=none
- No unexpected migration/secret/bucket/credential requirement discovered.

## 14. Candidate upload decision

**Decision: reused the existing immutable candidate `3a74686d-bad8-4fb0-b6b8-604292145d69` rather than uploading a redundant new one**, since runtime source is unchanged (§12) — same reuse discipline already established in SUN-1222C (2d9a93d). This satisfies "exactly one immutable 0%-traffic candidate" without an unnecessary external mutation.

- CANDIDATE_UPLOADS=0 (reused; no new Worker version created this checkpoint)
- DOCUMENT_R3_CANDIDATE_VERSION_ID=3a74686d-bad8-4fb0-b6b8-604292145d69

## 15. Deployment readback

- `wrangler deployments list`: current split = `(100%) db7054c9-76ee-4830-aabe-8a4542261b6a` / `(0%) 3a74686d-bad8-4fb0-b6b8-604292145d69` — exactly two traffic-bearing versions, no unintended third.
- DOCUMENT_R3_CANDIDATE_READBACK=PASS

## 16. Non-economic candidate public probes

All probes targeted the candidate directly via `Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="3a74686d-..."` against the production hostname:

| Probe | Result |
|---|---|
| `/health` | 200 |
| `/ready` | 200 |
| `/catalog` | `document_evidence_json.v2`: `production_enabled=true`, `production_ready=true`, `protocol_status=production`, `price_usd=0.012` |
| `/services/document_evidence_json.v2` | matches catalog; `bounds.max_input_bytes=10485760`, `max_execution_time_seconds=300` |
| `/.well-known/agent-card.json` | skill `document_evidence_json.v2` present, correct description, `v2` tag |
| `/.well-known/jwks.json` | one EC P-256 signing key, `kid=siteborne-agent-card-2026-08` |
| MCP `initialize` (legacy handshake, no `Mcp-Protocol-Version` header) → `tools/list` | `siteborne_document_evidence_json` tool present, description references `document_evidence_json.v2`, input schema exposes `artifact_reference` |

No paid POST performed in this section.

## 17. Buyer-upload live candidate qualification (non-economic)

Real upload through the actual public pipeline, targeting the candidate:

```
POST /v2/artifacts/documents  (Cloudflare-Workers-Version-Overrides: 3a74686d-...)
content-type: application/pdf
--data-binary @native_text_one_page.pdf
→ 201
{"upload_id":"4254fc94-3e71-4de3-a050-62b5bea27181","media_type":"application/pdf",
 "size_bytes":1530,"content_hash":"sha256:bed592e5...5bab3","expires_at":"2026-09-02T14:07:11.064Z"}
```

- Upload succeeded, opaque `upload_id` issued (no raw R2 key/URL exposed).
- Hash/size exact match to the independently-recomputed fixture hash.
- Object isolation / IDOR / capability-binding already proven by the 48-test SUN-1222C-R2 audit; not re-probed here to avoid unnecessary additional live traffic.

## 18. Artifact → executor non-economic proof

Production architecture deliberately gates real executor invocation behind payment (signer/worker are constructed only inside the paid-route composition, after payment verification) — confirmed by source trace, not bypassed here.

- PAID_ROUTE_EXECUTOR_PENDING_REAL_PAYMENT=YES
- Relying on the already-established SUN-1222C-1 direct-Modal proof (authenticated invocation succeeded; unauthenticated → 401; real PDF/native-text extraction; correct SHA-256; correct page classification; valid response schema) as the standing real-executor-capability evidence.

## 19. Unauthenticated / unpaid fail-closed

- Unpaid paid-route request (correct schema, no `X-PAYMENT`) → **402** (not 200, not a silent fixture path). Confirmed below in §20.
- Malformed/incomplete `upload_reference` bodies → **400** (frozen-contract schema validation, fail-closed before reaching payment logic).
- Invalid/enumerated `upload_id` and object-isolation fail-closed behavior: inherited from SUN-1222C-R2's 48-test audit (IDOR/enumeration PASS); not independently re-probed here (no additional live traffic needed to establish this).

DOCUMENT_V2_FAIL_CLOSED=PASS

## 20. Fresh 402 — economics freeze

Exactly one well-formed unpaid request to the candidate's paid route (two earlier attempts in this section used incorrect/incomplete request bodies and received `400`, not `402` — corrected before the one real `402`):

```
POST /v2/document/evidence-json  (Cloudflare-Workers-Version-Overrides: 3a74686d-...)
{"upload_reference":{"upload_id":"4254fc94-...","media_type":"application/pdf",
 "size_bytes":1530,"content_hash":"sha256:bed592e5...5bab3"}}
→ 402
{"error":"payment_required","x402_version":2,
 "quote_id":"qte_4d0997fca62254e5d8b93f11","requirement_id":"req_8c446ea8260ce7943a0ee924"}
```

Decoded `PAYMENT-REQUIRED` header (base64 → JSON):

```json
{
  "x402Version": 2,
  "resource": {"url": "https://utility.siteborne.net/v2/document/evidence-json"},
  "accepts": [{
    "scheme": "upto", "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "190000",
    "payTo": "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1",
    "maxTimeoutSeconds": 60,
    "extra": {"name": "USD Coin", "version": "2", "quote_id": "qte_4d0997fca62254e5d8b93f11"}
  }]
}
```

REAL_402_REQUESTS=1

DOCUMENT_402_ECONOMICS_MATCH_SOURCE=YES — `amount=190000` matches §9's `DOCUMENT_V2_MAX_AMOUNT_ATOMIC` exactly; `asset` matches the canonical Base USDC contract used throughout this engagement; `network=eip155:8453` matches Base mainnet; `payTo` matches `SELLER_WALLET_ADDRESS` (`0x7f44a2dd237938F18632d4CcA40f4c69029...`, confirmed via `wrangler deploy --dry-run` bindings output).

**Important scheme detail, traced from source** (`packages/protocol-x402/src/requirements/upto.ts` + `apps/edge-api/tests/live/x402-live-upto.test.ts`): `upto` on Base uses **Permit2**, not a single fixed-value EIP-3009 transfer. `amount=190000` is the authorized *ceiling* echoed in the buyer's Permit2 allowance/authorization; the real on-chain **pull** at settlement is for the **measured actual usage** only (`0 <= actual <= 190000`, per `packages/pricing/src/document-usage.ts`). For this canonical one-page native-text fixture, actual usage prices to exactly **12000** atomic (`document_evidence_json_native=0.012` USD). The buyer's current balance therefore only needs to cover the *actual* expected settlement (12000), not the full ceiling — though a Permit2 **allowance** of at least 190000 (a zero-value `approve`-style authorization, not a fund transfer) may be required as a separate on-chain step if no prior allowance exists for this buyer/asset/Permit2 pair, since this is document's first-ever `upto` qualification.

## 21. FINANCIAL AUTHORIZATION GATE — STOP

```
DOCUMENT_R3_CANDIDATE_VERSION_ID=3a74686d-bad8-4fb0-b6b8-604292145d69
SERVICE=document_evidence_json.v2
CANONICAL_PAID_BODY={"upload_reference":{"upload_id":"4254fc94-3e71-4de3-a050-62b5bea27181","media_type":"application/pdf","size_bytes":1530,"content_hash":"sha256:bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3"}}
AUTHORIZED_CEILING_ATOMIC=190000
EXPECTED_ACTUAL_SETTLEMENT_ATOMIC=12000   (native tier, 1 page — capped by real Modal-measured usage, not assumed)
DISPLAY_PRICE_USDC=0.012 expected actual (0.19 ceiling)
NETWORK=eip155:8453 (Base mainnet)
ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (USD Coin)
PAY_TO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
BUYER_BALANCE_ATOMIC=79727   (fresh eth_call, cross-verified via mainnet.base.org and base-rpc.publicnode.com)
EXPECTED_POST_PAYMENT_BUYER_BALANCE_ATOMIC=67727   (79727 - 12000, assuming exact expected settlement)
QUALIFICATION_FIXTURE_SHA256=bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3
QUOTE_ID=qte_4d0997fca62254e5d8b93f11 (maxTimeoutSeconds=60 — will very likely have expired by the time standalone authorization is received back; a fresh 402 quote-refresh, not a "retry" under §26, will be needed at resume time using these same frozen economics)

PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
SETTLEMENT_ATTEMPTS=0
```

**Proposed standalone authorization sentence** (for the human operator to send as a separate message — not authorization until sent by the user):

> "I authorize SUN-1222C-R3 to obtain a fresh `upto` payment quote for `document_evidence_json.v2` against candidate `3a74686d-bad8-4fb0-b6b8-604292145d69` for the canonical one-page qualification document (SHA-256 `bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3`), with authorized ceiling `190000` atomic Base USDC (network `eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, payTo `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`) and expected actual settlement `12000` atomic; to prepare (but not submit) any required Permit2 allowance and payment-authorization material for exactly one signing action and one paid POST, which I will perform myself; and to perform read-only reconciliation only, with no retry, if the result is ambiguous or unexpected."

This checkpoint is paused here per its own instruction (do not split into a new checkpoint). Resume at §22 upon receipt of that standalone authorization.
