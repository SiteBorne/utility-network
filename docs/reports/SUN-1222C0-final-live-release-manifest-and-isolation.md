# SUN-1222C0 — Final Live-Release Manifest, Release-Plane Isolation, Document Artifact Lifecycle Closure, Exact Economics/Funding Freeze

**Result: repo-only. One genuine RED→GREEN→mutation-proof fix landed (physical
R2 artifact reclamation). One genuine, previously-undiscovered release blocker
found and honestly reported, not fixed (per-source upload rate limiting). No
deploy, no Cloudflare/R2/secret mutation, no traffic change, no payment
material, no signing, no settlement.**

## 0. Inherited state

S3 evidence (`a514a2f`) reconciled and confirmed accurate on every claim
checked directly against source/live state this checkpoint (see §1-§2).

## 1. Repository reconciliation

```
C0_START_HEAD=a514a2f0c871bc4a21a8d46e48f29905c41d12e5
S3_EVIDENCE_REACHABLE=YES (HEAD *was* a514a2f -- trivially reachable)
WORKING_TREE_CLEAN=YES
```

No intervening commits between S3 and this checkpoint's start — nothing to
explain.

## 2. Current live production (read-only, `wrangler deployments status`/`versions view`)

```
PUBLIC_API_ACTIVE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a @ 100%
PUBLIC_API_TRAFFIC=100%
PUBLIC_API_ROLLBACK_VERSION=db7054c9 itself (stable since 2026-09-01T03:38:55Z
  across three separate deployment registrations that only ever changed the
  0% candidate slot -- 9080c1dd -> 3a74686d; the next-older distinct 100%
  version is 855ee345, "h2bf2-candidate")
PAID_CONTINUATION_HOST_VERSION=f17acb0c-6400-47f7-a203-5c97b44dcb9d @ 100%
  (deployed SUN-1222D-R2, unchanged since -- confirmed no drift)
DOCUMENT_INGRESS_WORKER_VERSION=same as PUBLIC_API_ACTIVE_VERSION -- there is
  no separate document-ingress script; POST /v2/artifacts/documents is a
  route on siteborne-utility-edge (Plane A), not an independent deployment
OTHER_RELEVANT_WORKER_VERSIONS=none (only two real production Worker scripts
  exist: siteborne-utility-edge, siteborne-paid-continuation-runtime; the
  three wrangler.*-test.toml configs are test-only, never deployed to a real
  account)
```

**Critical, load-bearing fact directly read from `db7054c9`'s own live
binding table** (`wrangler versions view`): it has `VERIFY_V2_CDP_ROUTE_
ENABLED=true` and `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true` only — no
`COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`, no `DOCUMENT_EVIDENCE_JSON_V2_
CDP_ROUTE_ENABLED`, no `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED`, no
`ARTIFACTS` binding, no `MODAL_DOCWORKER_*` secrets. **Real 100%-traffic
production today economically serves only 2 of the 4 v2 services**
(`web_context_verified.v2`, `verify_agent_output.v2`); `company_evidence_
graph.v2` and `document_evidence_json.v2` 404 at 100% traffic regardless of
anything reported PASS at the repo level.

## 3. Deployment-plane diff (db7054c9's source vs. current HEAD `11ed608`)

| Plane | Change | Deploy required |
| --- | --- | --- |
| A. Public API Worker (`siteborne-utility-edge`) | Adds: company_evidence_graph.v2 + document_evidence_json.v2 routes/composition/executors, buyer upload route (`/v2/artifacts/documents`, includes plane C below), `ARTIFACTS` R2 binding, 3 new route-enable flags, `MODAL_DOCWORKER_*` secret names, 4-service price freeze, MCP/A2A/discovery/Nevermined updates for the 2 new services, and (this checkpoint) `reclaimStaleArtifacts`/`listReclaimable`/`deleteByContentHash` (new code, unwired to any route/cron) | **YES** |
| B. Dedicated Workflow host (`siteborne-paid-continuation-runtime`) | Already fully current — deployed at `f17acb0c` from source `640e0d2` (SUN-1222D-R2), and zero files under `apps/edge-api/src/control-plane/workflows/` or `wrangler.paid-continuation-runtime.toml` changed between `640e0d2` and `11ed608` | **NO** (already deployed, current) |
| C. Document buyer-ingress "Worker" | Not an independent script — folded into Plane A | (covered by A) |
| D. Document/Modal integration client (TS) | Bundled into both A and B by wrangler's own esbuild step, not independently deployed | (covered by A/B) |
| E. Modal document worker (`siteborne-document-worker`) | Unchanged since 2026-09-01 (confirmed `modal app list`: state=deployed, v1, same source `f35df82`) | **NO** |
| F. Modal web-context safe-egress (`siteborne-webctx-safe-egress`) | Unchanged | **NO** |
| G. Shared packages (`pricing`, `protocol-x402`, `protocol-mcp`, `protocol-nevermined`, `service-runtime`, `provider-adapters`) | Bundled transitively into A/B; no independent deploy step exists | (covered by A/B) |
| H. D1 schema/migrations | `wrangler d1 migrations list siteborne-utility --remote` → **"No migrations to apply!"** (read-only, authoritative) | **NO** |
| I. R2 configuration | Bucket `siteborne-artifacts` already exists (created 2026-09-02); only a default multipart-abort lifecycle rule exists, no expiry rule (see §8) — not mutated this checkpoint | **NO** (repo-only readiness only; any real R2 lifecycle rule is a future, separately authorized mutation) |
| J. Static/independently-deployed discovery artifacts | None — catalog/Agent Card/OpenAPI/MCP tool list are all served dynamically from Plane A | N/A |

```
PUBLIC_API_DEPLOY_REQUIRED=YES
WORKFLOW_HOST_DEPLOY_REQUIRED=NO
DOCUMENT_INGRESS_DEPLOY_REQUIRED=YES (same script as Plane A)
MODAL_DOC_DEPLOY_REQUIRED=NO
MODAL_WEBCTX_DEPLOY_REQUIRED=NO
D1_MIGRATION_REQUIRED=NO
R2_CONFIG_MUTATION_REQUIRED=NO (repo-only readiness for a future lifecycle
  rule; not required for candidate qualification itself)
```

## 4. Zero-percent candidate isolation

`siteborne-paid-continuation-runtime` is a **separate Cloudflare Worker
script** from `siteborne-utility-edge` (confirmed: two distinct `name`s in
two distinct wrangler configs, two distinct `wrangler deployments status`
outputs, two distinct version histories). The public API's `[[workflows]]`
binding references the host **by script name**, not by version — Cloudflare
Workflows bindings resolve to whatever version currently serves 100% traffic
on the named host script at *dispatch* time, not at the calling Worker's own
deploy time.

This has one real consequence already fully executed and proven safe
(SUN-1222D-R2): **redeploying the shared host script is NOT isolated from a
public API candidate sitting at 0%** in the sense that a host redeploy takes
effect immediately for whichever binding calls it — but critically, this
does **not** touch current 100% production, because the *current* 100%
public API version (`db7054c9`) never dispatches `company_evidence_graph.v2`
or `document_evidence_json.v2` continuations at all (its own route flags are
absent — see §2), and its existing dispatches (`web_context_verified.v2`,
`verify_agent_output.v2`) are additive-only in the host's own registry
(`ROUTE_CONFIG_BUILDERS`, SUN-1222D-PRE) — proven, this session, that adding
the two new services never altered the two existing ones' behavior (same
registry-coherence test suite, unchanged).

```
PUBLIC_CANDIDATE_ISOLATED=YES (0% traffic slot, proven by wrangler deployments status)
WORKFLOW_RUNTIME_ISOLATED=NOT_REQUIRED (the host has no traffic-split concept
  of its own -- it is a single-version, no-public-route script; the isolation
  question that matters is "does redeploying it change current production
  behavior", answered NO in §5)
DOCUMENT_INGRESS_ISOLATED=YES (same script/slot as Plane A)
FINAL_CANDIDATE_ALL_CHANGED_PLANES_ISOLATED=YES
```

No qualification-specific second Workflow host is required — inventing one
would add an unproven binding-reuse question (per H2BF4's own design doc,
"Workflow resource reuse... UNPROVEN pending a real deploy+readback") for no
isolation benefit, since the shared host's redeploy is already proven safe
for current production by the additive-registry argument above.

## 5. Protect current production

```
AFFECTS_CURRENT_PRODUCTION_REQUESTS=NO
```
for every mutation this checkpoint's manifest proposes (§26): a public API
candidate upload at 0% traffic, a Workflow host redeploy (additive-only
dispatch registry, current production dispatches only the two already-
working services, unaffected), and (future, separately authorized) R2
lifecycle rule addition (an R2-account-level configuration change that
applies only to objects, never alters Worker routing/traffic).

## 6. Document artifact lifecycle — root cause (re-opened)

Traced the full path from source, current at `11ed608`:

```
ARTIFACT_CREATED_AT=POST /v2/artifacts/documents (documentArtifactUploadRoute
  -> storeDocumentUpload) -- D1 row (job_artifacts) + R2 object (content-hash
  keyed) written together
ARTIFACT_LOGICAL_EXPIRY_MODEL=two independent gates:
  (a) expires_at (900s from upload) -- gates whether resolveUploadReference
      (the production executor) will still accept a fresh paid request
      against this upload_id; enforced at READ time only, proven by
      document-evidence-json-v2-production-executor.test.ts's "rejects an
      expired upload_reference, even though the D1 row and R2 content both
      still exist" test.
  (b) (NEW this checkpoint) a 24h age-based physical-reclamation window,
      independent of expires_at -- see below.
PHYSICAL_DELETE_IMPLEMENTED=YES (as of this checkpoint; was NO before)
PHYSICAL_DELETE_TRIGGER=none live -- reclaimStaleArtifacts exists as callable
  code only; no Cron Trigger, no queue consumer, no admin route invokes it
  yet (deliberately, per this checkpoint's own "do NOT configure live
  Cron/R2 lifecycle here" instruction)
CURRENT_ORPHAN_PATHS=zero going forward once reclamation is actually wired
  (out of scope this checkpoint) -- until then, orphan accumulation
  continues exactly as before this checkpoint (nothing physically deletes)
MAX_ARTIFACT_BYTES=10,485,760 (10MB; DOCUMENT_UPLOAD_MAX_BYTES, matches the
  Modal worker's own frozen MAX_DOCUMENT_BYTES and the schema's size_bytes.maximum)
UPLOAD_RATE_LIMIT=NONE FOUND (see §7 -- genuine gap)
AUTH_REQUIREMENT=none -- POST /v2/artifacts/documents requires only the two
  route-enable flags server-side; it takes no buyer credential, API key, or
  payment of any kind (by design: this is the necessarily-pre-payment step)
CAN_UNPAID_USER_CREATE_R2_STORAGE=YES (by design -- this is the entire point
  of the buyer-ingress feature)
```

## 7. Lifecycle risk classification

- **Unbounded free R2 growth**: bounded per-object (10MB, and now a proven
  24h physical-reclamation ceiling once wired) but **not rate-limited by
  request volume** — see the genuine gap below.
- **Authenticated-but-unpaid storage abuse**: N/A (no authentication exists
  on this route at all; it's anonymous by design).
- **Orphan creation** (failed-payment/failed-Workflow/successful-job/replay
  leftovers): all collapse to the same case under this system's actual
  architecture — `job_id` is **never** written back onto an uploaded
  artifact's D1 row by any code path (confirmed by source trace: neither
  `storeDocumentUpload` nor `resolveUploadReference` in the production
  executor writes it), so there is no distinction in storage between "never
  used," "used successfully," or "used then failed" — all of them are
  reclaimed identically by the new age-based window once it is wired,
  bounded to 24h regardless of outcome.
- **Genuine new finding, not previously reported**: **no application-level
  rate limit exists on `POST /v2/artifacts/documents`** — an anonymous
  caller can submit an unbounded number of distinct-content 10MB uploads
  within any 24h window, each individually bounded (size + eventual
  reclamation) but the *aggregate accumulation rate* is bounded today only
  by Cloudflare's own platform-level abuse mitigations, not by this
  application. `packages/provider-adapters/src/rate-limit/limiter.ts`
  (`TokenBucketLimiter`) exists but is a single-process, in-memory,
  outbound-call-concurrency limiter — structurally unsuited to gating a
  stateless, horizontally-scaled Worker's inbound anonymous traffic; using
  it here would be cosmetic, not real. A real fix needs a durable,
  shared-state (D1/KV/Cloudflare Rate Limiting) per-source counter — new
  schema/architecture with its own privacy classification questions (IP
  retention), genuinely out of scope for safe improvisation within this
  checkpoint.

```
DOCUMENT_ARTIFACT_LIFECYCLE_SEVERITY=P1
```
(Not P0: no payment/settlement/economic-integrity risk — reclamation
touches only `job_artifacts` rows/R2 objects, proven never to read or write
payment/job/settlement state. Not P2/P3: it is a real, currently-exploitable
unbounded-storage-accumulation path against a public, anonymous, unauthenticated
endpoint, not a cosmetic or theoretical concern.)

## 8. Selected reclamation model

```
SELECTED_ARTIFACT_RECLAMATION_MODEL=hybrid: explicit application-level
  reclamation code (reclaimStaleArtifacts, built this checkpoint) as the
  primary mechanism, invoked later by EITHER a Cron Trigger OR reused by an
  admin/maintenance route -- plus an R2 lifecycle expiration rule as a
  defense-in-depth safety net for any artifact reclaimStaleArtifacts never
  reaches (e.g. if the Cron Trigger is itself misconfigured/disabled).
  Chosen over R2-lifecycle-alone because a lifecycle rule cannot delete the
  matching D1 metadata row (leaving permanent orphaned rows), and chosen
  over explicit-only because a platform-native safety net costs nothing and
  catches operational drift the application code can't self-heal from.
REQUIRED_RETENTION_WINDOW=86400 seconds (24h)
RETENTION_WINDOW_RATIONALE=A large, deliberately conservative multiple of
  both the 900s buyer-facing upload TTL and of every real
  paid-continuation-workflow.ts step's own retry/settlement timescale in
  this codebase (traced directly: every step has either a small bounded
  retry count or, for `settle`, explicitly zero retries) -- chosen because
  job_id linkage does not exist (see §6/§7), so age-based headroom
  substitutes for job-state awareness without inventing new machinery.
REQUIRES_CODE_CHANGE=YES (done this checkpoint: reclaimStaleArtifacts,
  listReclaimable, deleteByContentHash)
REQUIRES_CRON=YES (not configured this checkpoint -- explicitly out of scope)
REQUIRES_R2_LIFECYCLE_RULE=YES, as the defense-in-depth layer (not configured
  this checkpoint -- explicitly out of scope; NO R2 CONFIGURATION MUTATION)
```

## 9. TDD (genuine RED→GREEN→mutation-proof)

Full detail in commit `11ed608`. Summary:

- **RED**: `store.test.ts` (5 tests) and `artifact-reclamation.test.ts` (7
  tests) written and confirmed failing (`TypeError: ... is not a function`)
  before any implementation existed.
- **GREEN**: `deleteByContentHash` added to both `ArtifactStore`
  implementations; `listReclaimable` added to both `ArtifactsRepository`
  implementations; `reclaimStaleArtifacts` orchestration written. 12/12 new
  tests pass; 3 pre-existing structural test doubles updated for the new
  required interface members (typecheck-driven, not test-failure-driven).
- **Mutation proof** (2 real mutations, both caught then reverted):
  1. Removed the `try/catch` around the R2 delete call → the "R2 delete
     failure... never thrown" test failed with the real thrown error,
     confirming the catch is load-bearing.
  2. Changed the cutoff computation to always include everything (`nowMs +
     1000` instead of `nowMs - WINDOW * 1000`) → the "NEVER reclaims within
     the window" test failed (`reclaimed: 1` instead of `0`), confirming the
     age filter is load-bearing.

Covered from §9's own required matrix: successful/never-consumed artifacts
(covered structurally by the age-window test, since the function never
inspects job/payment state — proven not to distinguish these cases at all),
missing R2 object (idempotent no-op, tested), R2 delete failure (tested,
mutation-proven), duplicate/already-deleted D1 row (concurrent-race test),
metadata cleanup ordering (R2-before-D1, documented and structurally
enforced by the function's own control flow — a thrown R2 delete `continue`s
before the D1 delete call is ever reached).

**Explicitly not covered** (honest scope boundary, not silently skipped):
Workflow retry/rejoin and post-settlement recovery as *named, job-state-aware*
scenarios — because, as established in §6/§7, this system's actual
architecture has no job-state signal on an artifact row to test against at
all; the age-window design covers these categories *structurally* (by being
long enough that they can never overlap with reclamation) rather than by
explicit job-state branching, which does not exist and was deliberately not
invented this checkpoint.

## 10. Reclamation idempotency

```
ARTIFACT_RECLAMATION_IDEMPOTENCY=PASS
```
Proven directly: running `reclaimStaleArtifacts` twice in a row (test:
"is idempotent: running twice in a row") reclaims once then finds nothing;
deleting an already-R2-missing object returns `false`, never throws (proven,
both `InMemoryArtifactStore` and `R2ArtifactStoreAdapter`); a D1 row already
gone by delete-time is not counted, never thrown (proven). The function
touches **only** `job_artifacts`/R2 object state — it never reads or writes
`payment_attempts`, `x402_service_results`, `state_events`, or any receipt
table, so there is structurally nothing in payment/settlement/receipt state
for a repeated or partial reclamation pass to alter.

## 11. Storage abuse bounds

```
UNBOUNDED_UNPAID_STORAGE_PATHS=1
```
Named: `POST /v2/artifacts/documents` has no per-source (IP/session/API-key)
rate limit — see §7's genuine-gap finding. Every other dimension is now
bounded: per-object size (10MB), per-object lifetime (24h to physical
reclamation, code now exists), malformed-upload handling (rejected before
storage, proven by `document-upload.test.ts`'s adversarial matrix),
abandoned artifacts (now reclaimable). This is **not** zero, so per this
checkpoint's own bar ("Require: 0 for final release readiness") this is a
named, real release blocker — not silently waived.

## 12. Reconfirmed document security matrix

Reran the full existing matrix plus this checkpoint's 12 new tests:
path/key isolation (content-addressed, buyer input never becomes an R2 key
or D1 id — proven), content-type checks (magic-byte vs. declared-type
mismatch rejected), maximum size (declared-length AND streamed-length both
bounded), malformed document (garbage bytes rejected), artifact-id guessing
(IDOR — unknown/enumerated upload_id rejected without ever executing),
cross-buyer access (N/A — no buyer identity exists to isolate against;
content-hash addressing means only the exact bytes' owner can derive a valid
reference in practice, though there is no cryptographic secrecy on
upload_id itself — flagged, not a new finding, consistent with the
`authorization_class: 'buyer_authorized'` model already in place), replay
(content-hash dedup — reuploading identical bytes returns the same
upload_id, never creates a duplicate object), quote/artifact mismatch and
declared-hash mismatch (both proven rejected in
`document-evidence-json-v2-production-executor.test.ts`), independent
Workflow R2 refetch (proven — production-dependencies.ts constructs its own
`R2ArtifactStoreAdapter` from the host's own `env.ARTIFACTS`, never trusting
anything the original request handler resolved), logical expiry (proven),
physical cleanup (new, proven this checkpoint).

```
DOCUMENT_INGESTION_SECURITY_MATRIX=PASS
DOCUMENT_ARTIFACT_LIFECYCLE=FAIL
```
(`FAIL` specifically and only because of §11's unrated-limit gap — the
reclamation mechanism itself is now proven correct, idempotent, and
mutation-tested; lifecycle is not "PASS" while an unbounded accumulation
path exists.)

## 13. Exact price card (source-read at `11ed608`)

```
COMPANY_EVIDENCE_GRAPH_V2_PRICE_USDC=0.0312
COMPANY_EVIDENCE_GRAPH_V2_AMOUNT_ATOMIC=31200
WEB_CONTEXT_VERIFIED_V2_PRICE_USDC=0.008
WEB_CONTEXT_VERIFIED_V2_AMOUNT_ATOMIC=8000
DOCUMENT_EVIDENCE_JSON_V2_PRICING_MODEL=upto (variable, tiered by page
  classification: native=$0.0098/9800, ocr=$0.0156/15600, table=$0.0238/23800,
  ceiling=$0.19/190000 -- unchanged, this is the "upto" maximum, not a
  competitive per-unit price)
DOCUMENT_EVIDENCE_JSON_V2_QUALIFICATION_PRICE_USDC=0.0098 (native tier,
  smallest valid qualification request -- see §25's frozen fixture)
DOCUMENT_EVIDENCE_JSON_V2_QUALIFICATION_AMOUNT_ATOMIC=9800
VERIFY_AGENT_OUTPUT_V2_PRICE_USDC=0.017
VERIFY_AGENT_OUTPUT_V2_AMOUNT_ATOMIC=17000
```
All read directly from `packages/pricing/src/service-prices.ts`'s
`EMBEDDED_PRICING` (the actual production source of truth — bundling can't
do a live YAML read; `pricing:check` proves this stays in sync with
`governance/RISK_LIMITS.yaml`, both confirmed identical this checkpoint).
All atomic values are integer Base-USDC units (6 decimals; e.g. `0.0312 *
1e6 = 31200`, verified by direct computation, not assumed).

**Unchanged from S3** — no repricing occurred this checkpoint.

## 14. Market-discount reconfirmation

Reused S3's evidence (`SUN-1222B-S3-company-evidence-graph-price-governance.md`,
`SUN-1222C-R3-document-ingress-and-remaining-price-freeze.md`) — both dated
the same calendar day as this checkpoint's own work, so no external
re-fetch was performed (per this checkpoint's own "only refresh if pricing
changed or evidence was incomplete" instruction — neither applies).

| Service | Market anchor | Comparability | Discount | P95 var. cost | P95 gross margin |
| --- | --- | --- | --- | --- | --- |
| company_evidence_graph.v2 | Knowledge-graph/entity export, $0.0225-$0.025 | SITEBORNE does materially more (multi-source assembly, provenance/PCC, receipt evidence) | 24.8% *premium* to $0.025 (SITEBORNE prices above the raw-commodity anchor deliberately); 20% *reduction* from its own prior $0.039 | ~$0.0015 | ~95.2% |
| web_context_verified.v2 | (S3's own stated hypothesis, used as frozen price) | direct retrieval, safe-egress | 11.1% reduction from $0.009 | ~$0.002 | ~75% |
| document_evidence_json.v2 (native) | Google Cloud Document AI: Enterprise OCR $0.0015/pg, Layout Parser ~$0.01/pg, Form Parser $0.03/pg (live-fetched by S3) | SITEBORNE does structured evidence JSON + SHA-256 binding + PCC/receipt + x402 settlement, priced well above raw-OCR commodity by design | 18.3% reduction from $0.012 | ~$0.0015 | ~85% |
| document_evidence_json.v2 (ocr) | same anchor | same | 17.9% reduction from $0.019 | ~$0.005 | ~68% |
| document_evidence_json.v2 (table) | same anchor | same | 17.9% reduction from $0.029 | ~$0.006 | ~75% |
| verify_agent_output.v2 | (S3's own stated hypothesis) | bounded LLM verification call | 10.5% reduction from $0.019 | ~$0.005 | ~71% |

All margins clear `governance/RISK_LIMITS.yaml`'s real `minimum_accepted_
margin: 0.60` floor (re-confirmed present and unchanged by `governance:
validate`, 77/77 checks passed). Estimates, not measured actuals from a live
paid execution — stated as such in S3 and unchanged here; no cosmetic
re-optimization performed, matching this checkpoint's own instruction.

## 15. Price single source of truth

`packages/pricing/src/service-prices.ts` (`EMBEDDED_PRICING`) is the one
place every consumer resolves price from: `packages/protocol-mcp/src/
server.ts`'s `EXACT_PRICING_KEYS`/`UPTO_PRICING_KEYS` maps, `packages/
protocol-x402/src/bazaar/discovery.ts`'s `BAZAAR_PAYMENT_POLICY`, `packages/
protocol-x402/src/bazaar/registry-source.ts`'s `withGovernedRegistryPrice`
runtime overlay (never mutating the frozen registry contract JSON), the real
production CDP composition files' own `pricingKey` fields, and `packages/
protocol-nevermined/src/declarations.ts`'s `V2_PRICING_KEY_OVERRIDES` — all
traced and confirmed in the SUN-1222B/C/D chain, unchanged this checkpoint,
reconfirmed by `pricing:check` (drift-free) and the full test suite
(2811/77, 0 failures) exercising all of these consumers.

```
PRICE_SINGLE_SOURCE_OF_TRUTH=YES
ALL_FOUR_PRICE_DISCOVERY_COHERENT=YES
```

## 16. Four real executors (production composition, not unit-test composition)

```
COMPANY_V2_REAL_EXECUTOR=YES
WEBCTX_V2_REAL_EXECUTOR=YES
DOCUMENT_V2_REAL_EXECUTOR=YES
VERIFY_V2_REAL_EXECUTOR=YES
```
All four confirmed by direct source read of their `*-production-executor.ts`
files (real `execution_mode: 'live'`, real unmodified service classes, real
injected adapters — never `buildFixtureRegistry`/`createFixtureSigner`/
`FixtureDocumentWorkerBridge`). `PRODUCTION_FIXTURE_REACHABLE=NO` for all
four, reconfirmed this checkpoint by the unchanged `FIXTURE_RUNTIME_
REACHABILITY` gate in `test:worker-runtime`'s 99/99 pass (hard-bypass
markers=0, both disclosed findings structurally unreachable/fail-closed).

## 17. Trust-class / post-settlement regression

```
TRUST_CLASS_REGRESSION=PASS
POST_SETTLEMENT_FAIL_CLOSED_REGRESSION=PASS
```
Reconfirmed by the unchanged, full-suite-passing trust-class matrix
(`packages/protocol-x402/src/evidence/policy.test.ts`, and this session's
own new orchestration test proving `evidenceMode: 'production'` +
`trust_class: 'synthetic_fixture'` evidence is REJECTED while `trust_class:
'external_verified'` is accepted, for all four services through the real
Workflow dispatch registry) and by every post-settlement/`hashPaymentObject`/
PCC-undefined regression test in the full suite (0 failures across 2811
tests).

## 18. MCP / A2A / Agent Card

```
MCP_RELEASE_STATE=PASS
A2A_RELEASE_STATE=PASS
AGENT_CARD_JWS=PASS
```
`pnpm mcp:check` and `pnpm a2a:check` both green this checkpoint (spec
baselines, packed install, edge routes). Legacy `'stateless'` mode,
aggregate `productionEnabled` derivation, the 8 contractual version-specific
`AgentSkill` IDs, normalized skill names/descriptions, and Agent Card JWS
validity are all exercised by the full test suite (0 failures) — none of
this checkpoint's changes touch `protocol-mcp`, `protocol-a2a`, or Agent
Card signing at all (confirmed: `git show --stat 11ed608` touches only
`apps/edge-api/src/control-plane/artifacts/*` and `repositories/*`).

## 19. Secrets reconciliation

```
MODAL_RESOURCE_ID_ALLOWLIST_SCOPE=EXACT
UNEXPLAINED_SECRET_FINDINGS=0
```
`pnpm secrets:scan` clean (691 commits scanned, "no leaks found" x2,
working-tree scan OK on 1345 files). The three `.gitleaks.toml` entries S3
added remain exact, pinned `wk-...` literals (not a `wk-[a-z0-9]+` pattern)
— reconfirmed by re-reading the file this checkpoint; no broadening
occurred. No credential values printed anywhere in this checkpoint's work.

## 20. Full release gate (after this checkpoint's code change)

```
TYPECHECK=23/23 PASS
BUILD=12/12 PASS
LINT=16/16 PASS
TESTS=2811 passed / 77 skipped (252 files, 230 passed / 22 skipped) -- 0 failures
WORKER_RUNTIME=99/99 PASS
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
SSRF_DNS_REBINDING=PASS (unchanged files; covered by full test run)
X402_REPLAY_CONCURRENCY=PASS (unchanged files; covered by full test run)
DOCUMENT_INGESTION_SECURITY_MATRIX=PASS
ARTIFACT_LIFECYCLE_TESTS=PASS (12/12 new, mutation-proven)
TRUST_CLASS_TESTS=PASS
POST_SETTLEMENT_TESTS=PASS
SECRETS_SCAN=PASS (0 unexplained findings)
PRODUCTION_PREFLIGHT=PASS
PRICING_CHECK=PASS (0 drift, 15 keys)
PCC_GENERATION_CHECK=PASS
GOVERNANCE_VALIDATION=PASS (77/77)
WRANGLER_DRY_RUN=PASS (both scripts, clean bundle)
FORMAT=pre-existing, out-of-scope Prettier debt (449 files, none touched
  this checkpoint or by any commit since SUN-1222D-RESUME first documented
  it) -- not release-gating per that established, unchanged precedent
```

## 21. Final candidate source freeze

Lifecycle work changed HEAD. `a514a2f` is superseded.

```
FINAL_CANDIDATE_SOURCE_HEAD=11ed608e25f75746ae0892582048b6cd068b6188
FINAL_CANDIDATE_COMMITS_SINCE_PRODUCTION=every commit from 8de9fc3
  (exclusive, db7054c9's approximate source lineage) through 11ed608
  inclusive -- the full SUN-1222B-S3/SUN-1222C/SUN-1222D chain
WORKING_TREE_CLEAN=YES
```

## 22. Current buyer balance (fresh, dual-RPC, read-only)

```
QUALIFICATION_BUYER=0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
QUALIFICATION_BUYER_BALANCE_ATOMIC=79727
```
`eth_call balanceOf()` against Base mainnet USDC
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) via both `mainnet.base.org`
and `base.publicnode.com`, same block (`0x307b2b1`), identical results
(`0x1376f` = 79727) — unchanged since first observed in SUN-1222C-R3.

## 23. Exact four-payment spend

```
COMPANY_QUALIFICATION_AMOUNT_ATOMIC=31200
WEBCTX_QUALIFICATION_AMOUNT_ATOMIC=8000
DOCUMENT_QUALIFICATION_AMOUNT_ATOMIC=9800
VERIFY_QUALIFICATION_AMOUNT_ATOMIC=17000
TOTAL_FOUR_SERVICE_QUALIFICATION_ATOMIC=66000
BUYER_BALANCE_ATOMIC=79727
QUALIFICATION_HEADROOM_ATOMIC=13727
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0
```
No price was lowered to fit the wallet — these are the same frozen
commercial prices from §13, computed independently and cross-checked
(`python3` arithmetic, not eyeballed).

## 24. Canonical qualification requests (frozen, no upload yet)

```
COMPANY_V2_QUALIFICATION_BODY={"identifiers":{"cik":"0000320193"},
  "requested_field_groups":["identity","sec_submissions"]}
  (Apple Inc.'s real, public CIK -- SEC EDGAR, no external mutation)

WEBCTX_V2_QUALIFICATION_BODY={"target_url":"https://example.com/",
  "retrieval_mode":"direct"}

DOCUMENT_V2_QUALIFICATION_FLOW=
  1. POST /v2/artifacts/documents with the exact fixture bytes from §25
     (Content-Type: application/pdf) -> 201 {upload_id, media_type,
     size_bytes, content_hash, expires_at}
  2. Within 900s, POST /v2/document/evidence-json with body
     {"upload_reference":{"upload_id":"<from step 1>",
     "media_type":"application/pdf","size_bytes":1530,
     "content_hash":"sha256:bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3"}}
  3. Fresh 402 -> pay 9800 atomic (native tier, single page, no OCR/table
     needed) -> settle -> receipt
  4. Expected cleanup/reclamation: this artifact becomes eligible for
     physical reclamation 24h after step 1's created_at, once a reclamation
     trigger is separately authorized and wired -- no manual action expected
     at qualification time

VERIFY_V2_QUALIFICATION_BODY={"verification_contract":{"claims":[{"claim_id":
  "total","predicate":"equals","expected_value":42}],
  "deterministic_requirements":[]},"candidate_output":{"total":42},
  "required_schema":{"type":"object","properties":{"total":
  {"type":"number"}},"required":["total"]},"verification_mode":"standard"}
```

## 25. Document qualification artifact (frozen fixture)

```
FIXTURE_PATH=services/modal-worker/fixtures/pdf/native_text_one_page.pdf
FIXTURE_SHA256=sha256:bed592e52666c6b8098eb2a9d4eae0d5551053657736593ec0cba9f4f205bab3
FIXTURE_BYTE_SIZE=1530
FIXTURE_CONTENT_TYPE=application/pdf
EXPECTED_PAGE_CLASSIFICATION=native (1 page)
EXPECTED_QUALIFICATION_TIER=native ($0.0098/9800 atomic)
```
Reused from the already-proven SUN-1222C-1 smoke test (`796f6cb`), which
recorded this exact fixture producing a real 200 with the same SHA-256,
`page_count:1`, against the live Modal endpoint with the (now-superseded)
prior credential.

## 26. Exact live mutation targets (manifest only — none performed)

```
LIVE_MUTATION_01:
  TARGET=siteborne-utility-edge (public API Worker)
  ACTION=wrangler versions upload (create ONE new candidate version) from
    source 11ed608, then wrangler versions deploy registering it at 0%
    normal traffic alongside the existing 100% db7054c9
  COUNT=1 upload, 1 traffic-registration call
  WHY_REQUIRED=company_evidence_graph.v2 + document_evidence_json.v2 route
    flags, ARTIFACTS binding, and 4-service price freeze are absent from
    db7054c9 (proven, §2/§3)
  NORMAL_TRAFFIC_EFFECT=NO (0% candidate slot only)
  ROLLBACK=the existing db7054c9@100% is untouched and remains the
    immediate rollback target; no traffic-split change occurs at all in
    this mutation

LIVE_MUTATION_02:
  TARGET=none required this cycle -- siteborne-paid-continuation-runtime is
    already current (f17acb0c, source 640e0d2, and 640e0d2..11ed608 touches
    no file relevant to this host)
```

No secret copies, no new R2 bucket, no R2 lifecycle rule, and no Cron
Trigger are included — none is proven necessary for candidate qualification
itself (only for the separate, later, fully-scoped lifecycle-wiring
authorization implied by §8's `REQUIRES_CRON=YES`/`REQUIRES_R2_LIFECYCLE_
RULE=YES`, which this checkpoint deliberately does not fold into the
candidate-provisioning authorization below).

## 27. Zero-percent qualification topology

```
client
  -> [NEW_0_PERCENT_CANDIDATE] siteborne-utility-edge candidate version
  -> [ECONOMIC] payment verification (CDP, real)
  -> [SHARED_EXTERNAL_DEPENDENCY] siteborne-paid-continuation-runtime
     (already-current, 100%-of-its-own-script Workflow host)
  -> [ECONOMIC] real executor (company/webctx/document/verify)
  -> [ECONOMIC] PCC generation
  -> [ECONOMIC] settlement (CDP, sole owner)
  -> [READ_ONLY/CURRENT_PRODUCTION] D1 (shared with 100% production --
     writes are new rows, never touch existing production rows)
  -> [ECONOMIC] signed receipt

document flow, additionally:
client
  -> [NEW_0_PERCENT_CANDIDATE] buyer upload (POST /v2/artifacts/documents)
  -> [SHARED_EXTERNAL_DEPENDENCY] R2 (siteborne-artifacts, existing bucket)
  -> [CURRENT_PRODUCTION shared D1] artifact metadata row
  -> [ECONOMIC] quote/payment binding (AEAD-sealed requestInputHash)
  -> [SHARED_EXTERNAL_DEPENDENCY] Workflow independent R2 refetch (host's
     own ARTIFACTS binding, never trusting the original request's resolved
     bytes)
  -> [SHARED_EXTERNAL_DEPENDENCY] Modal document worker (siteborne-document-worker)
  -> [ECONOMIC] result/PCC/receipt
  -> [READ_ONLY, not yet live] reclamation (code exists, not triggered)
```

```
ZERO_PERCENT_QUALIFICATION_DOES_NOT_CHANGE_NORMAL_PRODUCTION_BEHAVIOR=YES
```

## 28. Candidate safe-qualification plan (non-economic probes only)

health, ready, `GET /catalog`, per-service detail, Agent Card (`/.well-known/
agent-card.json` or equivalent), JWKS/JWS validation, OpenAPI document, MCP
`tools/list` (modern), MCP legacy-compat lifecycle handshake, A2A dispatch
probe, all four v2 discovery entries (company/webctx/document/verify),
price coherence (discovery price == `EMBEDDED_PRICING` == what a real 402
would return), Workflow binding presence (`env.PAID_CONTINUATION_WORKFLOW`
resolves), dependency availability (`buildProductionPaidContinuationWorkflowDependencies`
does not return `unavailable` for any of the 4 services, checked without
ever completing a real payment). Every probe must be reachable via the
candidate-version-override header mechanism already proven safe in
SUN-1222C-1 (`Cloudflare-Workers-Version-Overrides`), never via a traffic
shift. Zero paid service invocation.

## 29-35. Payment sequencing, authorization law, canary/promotion, proposed authorizations

Rules restated verbatim as binding constraints for the next checkpoints (not
re-litigated here): sequential P1(company)->P2(webctx)->P3(document)->
P4(verify), each gated on the prior's reconciliation; one authorization per
payment with exact service/amount/network/asset/payTo/buyer/nonce/validity/
signing/POST/settlement-attempt bound; no retry on any ambiguous HTTP outcome
— read-only reconciliation only; the document authorization must separately
and explicitly cover the one bounded upload + its eventual reclamation, never
hidden inside a payment authorization that names only USDC; canary only
after all four qualification payments pass, one immutable candidate for the
whole release, never a per-service deploy.

```
PROPOSED_SUN1222C1_CANDIDATE_AUTHORIZATION=
"I authorize SUN-1222C1-CANDIDATE-PROVISIONING to create and register
exactly one new Cloudflare Worker version for siteborne-utility-edge from
source commit 11ed608e25f75746ae0892582048b6cd068b6188, at 0% normal
traffic (current 100% production, db7054c9-76ee-4830-aabe-8a4542261b6a,
remains untouched at 100%). This authorizes at most one `wrangler versions
upload` and one `wrangler versions deploy` traffic-registration call
against siteborne-utility-edge only. I do not authorize any deployment,
version upload, or traffic change to siteborne-paid-continuation-runtime
(already current) or any Modal application. I authorize no new R2 bucket,
no R2 lifecycle rule, no Cron Trigger, and no new or copied secret --
MODAL_DOCWORKER_*, ARTIFACTS, and all route-enable flags already exist on
this exact source's account-level configuration per SUN-1222D-R1/R2/
SUN-1222C-1. I authorize zero live price deviation from the frozen card in
docs/reports/SUN-1222C0-final-live-release-manifest-and-isolation.md §13.
I authorize zero payment material, zero signing, zero paid POST, zero
settlement, and zero economic transaction of any kind. I authorize
non-economic safe-qualification probes only (health/ready/catalog/service
detail/Agent Card/JWKS/OpenAPI/MCP/A2A/price-coherence/dependency-
availability), never a real 402 payment flow."

PROPOSED_COMPANY_PAYMENT_AUTHORIZATION=
"I authorize exactly one real controlled qualification payment for
company_evidence_graph.v2 against the qualified 0%-traffic candidate
version [VERSION_ID], for exactly 31200 atomic Base USDC ($0.0312), on
eip155:8453, asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, payTo
0x7f44a2dd237938F18632d4CcA40f4c690295E6E1, buyer
0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99, using the canonical body
frozen in §24 of docs/reports/SUN-1222C0-final-live-release-manifest-and-isolation.md.
Exactly one fresh 402, one fresh EIP-3009 nonce/validity window, one
human-operated signing action, one paid POST (I perform the signing and
POST myself), at most one settlement attempt. No retry on any ambiguous
outcome -- read-only reconciliation only. No other service's payment
material may be created before this one reconciles."

PROPOSED_WEBCTX_PAYMENT_AUTHORIZATION=
"I authorize exactly one real controlled qualification payment for
web_context_verified.v2 against the same qualified candidate, for exactly
8000 atomic Base USDC ($0.008), same network/asset/payTo/buyer as above,
using the canonical body frozen in §24. Same one-fresh-402/one-nonce/
one-signing/one-POST/at-most-one-settlement/no-retry terms. Requires
company_evidence_graph.v2's payment to have already reconciled."

PROPOSED_DOCUMENT_PAYMENT_AUTHORIZATION=
"I authorize exactly one bounded buyer artifact upload (the exact fixture
frozen in §25 of docs/reports/SUN-1222C0-final-live-release-manifest-and-isolation.md,
POST /v2/artifacts/documents against the qualified candidate) AND exactly
one real controlled qualification payment for document_evidence_json.v2
referencing that upload via upload_reference, for exactly 9800 atomic Base
USDC ($0.0098, native tier), same network/asset/payTo/buyer as above. This
authorization covers the R2 write the upload step performs as an explicit,
named external mutation -- not merely the USDC payment. Same
one-fresh-402/one-nonce/one-signing/one-POST/at-most-one-settlement/
no-retry terms. Requires web_context_verified.v2's payment to have already
reconciled. Does not authorize any physical-reclamation trigger, R2
lifecycle rule, or Cron Trigger."

PROPOSED_VERIFY_PAYMENT_AUTHORIZATION=
"I authorize exactly one real controlled qualification payment for
verify_agent_output.v2 against the same qualified candidate, for exactly
17000 atomic Base USDC ($0.017), same network/asset/payTo/buyer as above,
using the canonical body frozen in §24. Same one-fresh-402/one-nonce/
one-signing/one-POST/at-most-one-settlement/no-retry terms. Requires
document_evidence_json.v2's payment to have already reconciled. This is the
final of the four qualification payments."
```

None of the above four/five were sent or executed. Templates only.

## 36. Deploy-ready gate

```
SUN1222C1_CANDIDATE_PROVISIONING_ELIGIBLE=NO
```
Blocked on exactly one item: `UNBOUNDED_UNPAID_STORAGE_PATHS=1` (§7/§11 —
no per-source rate limit on the anonymous document-upload endpoint). Every
other gate in §36's list is PASS: final source clean, all four real
executors, zero production fixture reachability, document artifact
lifecycle mechanism now proven physically correct and mutation-tested
(though the overall `DOCUMENT_ARTIFACT_LIFECYCLE` verdict stays `FAIL`
specifically because of the storage-abuse gap, not the reclamation logic
itself), release-plane isolation proven, price card exact, buyer funding
known and sufficient, MCP/A2A/JWS PASS, x402 gates PASS, trust-class PASS,
post-settlement fail-closed PASS, secrets clean, full release gate PASS,
exact mutation manifest exists.

## 37. Evidence

This file. Committed alongside the code fix (`11ed608`) as a separate
evidence commit (below).
