# SUN-1222C0-R1 — Document-Ingress Storage-Abuse Remediation

## 0. Lineage / authoritative state

- C0 evidence commit: `de9af60` (`docs/reports/SUN-1222C0-final-live-release-manifest-and-isolation.md`)
- C0 verdict: `SUN1222C0=PARTIAL`, `SUN1222C1_CANDIDATE_PROVISIONING_ELIGIBLE=NO`, `UNBOUNDED_UNPAID_STORAGE_PATHS=1`
- R1 start HEAD: `de9af60` (clean working tree, no intervening commits)
- The blocker: `POST /v2/artifacts/documents` accepts anonymous, unauthenticated document uploads with no distributed per-source or aggregate admission limit — only a per-object byte cap (`DOCUMENT_UPLOAD_MAX_BYTES` = 10,485,760 bytes) existed. An anonymous caller could accumulate unbounded R2/D1 storage without ever paying.
- C0's own artifact-lifecycle work (`artifact-reclamation.ts`, commit `11ed608`) is preserved untouched by this checkpoint; no regression to `ArtifactStore.deleteByContentHash`, `listReclaimable`, or reclamation idempotency.

## 1. The abuse invariant

The release invariant is: **an unpaid anonymous caller cannot create unbounded storage cost.** Before this checkpoint:

- (A) strict per-object byte bounds — EXISTED (`DOCUMENT_UPLOAD_MAX_BYTES`)
- (B) distributed per-source admission limits — MISSING
- (C) bounded aggregate/global admission behavior — MISSING
- (D) finite pre-consumption artifact lifetime — EXISTED (`DOCUMENT_UPLOAD_TTL_SECONDS` / `ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS`)
- (E) physical R2 reclamation — EXISTED (C0, `reclaimStaleArtifacts`)
- (F) fail-closed on admission-control-unavailable — MISSING (nothing to fail closed on)
- (G) admission rejection before durable persistence — MISSING (no admission check existed at all)

This checkpoint closes (B), (C), (F), (G).

## 2. Ingress call graph (traced from source)

```
POST /v2/artifacts/documents
  → route flag gate (PAID_ROUTES_ENABLED && DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED) + DB/ARTIFACTS bound
  → declared Content-Length pre-check (cheap, no I/O, no distributed state)      [unchanged]
  → [NEW] extractDocumentIngressSourceKey(CF-Connecting-IP) — fail closed (503) if absent
  → [NEW] checkDocumentIngressAdmission — per-source axis, then global axis     [fail closed (503) on repository error]
       ├─ rejected → 429 (or 503 if limiter_unavailable), zero further work
       └─ admitted → continue
  → readBoundedBody (bounded stream read)                                       [unchanged]
  → storeDocumentUpload → R2 put + D1 insert                                    [unchanged]
  → 201 response (opaque capability only)
```

The admission check runs strictly before `readBoundedBody`, the R2 write, and the D1 artifact insert — a rejected request never reaches `storeDocumentUpload` at all (structural, not conventional: the handler `return`s before that call exists in the control flow).

Ordering rationale (§21/§12): the free Content-Length check runs first — a guaranteed-413 request costs the caller nothing and should not consume distributed admission state either. Per-source is checked before global, so one abusive source is rejected without spending down the shared global budget legitimate, diverse traffic depends on.

## 3. Design choice — D1, not Cloudflare's native Rate Limiting binding

The native Workers Rate Limiting binding (`[[ratelimits]]`, `env.<BINDING>.limit()`) was evaluated first, per this checkpoint's own "inspect existing architecture, prefer the smallest native mechanism" directive. It was fetched and read live during this checkpoint (`developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/`) and rejected for three reasons documented directly in Cloudflare's own docs, not a stylistic preference:

1. **Locality** — limits are enforced *per Cloudflare location (colo)*, not globally: "this would only apply to requests served in Sydney." A botnet, or even one source whose requests land in different colos, faces an independent budget per colo — undermining both the per-source and global axes this checkpoint requires.
2. **Accuracy** — the binding is explicitly "permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system," meaning even the per-source axis cannot honestly be proven to "never exceed" under concurrency (§17's own requirement).
3. **Window granularity** — `simple.period` "must be either 10 or 60" seconds, unable to express a window aligned with this system's real 86,400s retention horizon without compounding 1,440 independent 60s windows into a much looser bound.

Instead, this checkpoint reuses the `DB` (D1) binding — already a required, always-present dependency of this exact route — via one atomic SQL statement (`INSERT ... ON CONFLICT(window_key) DO UPDATE SET count = count + 1 WHERE count < ?`). D1 is a single logical database (not per-colo), and SQLite's single-writer serialization makes the increment genuinely atomic under concurrent callers. This satisfies §17 **honestly, in production**, for both axes — not only at a test-double layer while production runs on a best-effort primitive.

Trade-off accepted and documented: a D1 round-trip carries real per-request latency the native binding's locally-cached design avoids. Accepted because this route already performs a D1 read and write on every accepted request; this simply gates that same work.

Net result: **zero new external resources, zero new bindings, zero new secrets.** `wrangler deploy --dry-run` for both the public API Worker and the dedicated Workflow host were re-run this checkpoint and show no new bindings of any kind (see §12 below).

## 4. Source identity

`extractDocumentIngressSourceKey` trusts **only** `CF-Connecting-IP` — `X-Forwarded-For`, `Forwarded`, and any other caller-suppliable header are never read (not filtered after the fact; structurally never consulted). Absence fails closed (503), exactly like a limiter-unavailable outcome — this should never happen through Cloudflare's real edge; local/test harnesses inject the header directly.

`normalizeSourceKey` canonicalizes IPv4 (strips leading zeros) and IPv6 (case, `::` expansion to 8 groups, IPv4-mapped forms, zone-id stripping) so trivially-equivalent representations of the same address share one quota identity, without collapsing genuinely different addresses.

```
DOCUMENT_INGRESS_SOURCE_KEY = normalizeSourceKey(CF-Connecting-IP)
SOURCE_KEY_SPOOFABLE_BY_CALLER = NO
```

## 5. Limits and the storage-cost derivation

Both axes use one fixed window: `DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS = 86,400` (24h) — deliberately identical to `ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS`, so "how much can accumulate before a reclamation pass could plausibly have cleared it" has one clean answer.

| Axis | Limit/window | Worst-case retained bytes/window | R2 storage cost (worst case, sustained) |
|---|---|---|---|
| Per-source | 50 | 50 × 10,485,760 = 524,288,000 B (500 MiB) | ~$0.0075/month per abusive source |
| Global | 2,000 | 2,000 × 10,485,760 = 20,971,520,000 B (~19.53 GiB) | ~$0.29/month worst case |

Per-source (50/day) is generous for legitimate automated-buyer retry/re-upload behavior across a busy integration day while meaningfully bounding one abusive source. Global (2,000/day) gives large headroom over actual pre-launch commercial volume (zero real buyers today for this service) while remaining a hard, finite, budgetable ceiling against a many-source botnet or NAT/source-rotation pattern.

**Honest scope limit (not new, not hidden):** this bounds the *acceptance rate* — finite and proven atomic. The *total* storage bound over an unbounded time horizon is finite only if physical reclamation (`reclaimStaleArtifacts`) actually executes at least once per retention window. That function exists and is proven (C0), but is **not wired to a live Cron Trigger anywhere in this repository** — confirmed by trace (no `scheduled` export in `index.ts`). This is C0's own, separately flagged, deliberately-deferred follow-up (`artifact-reclamation.ts`'s own doc comment), not a new discovery, and it does not gate C1 eligibility any differently than it already did after C0 — this checkpoint's own scope is exactly the admission-control gap, not cron wiring.

## 6. RED → GREEN → mutation-proof evidence

**RED (module level):** `document-ingress-admission-control.test.ts` and `document-artifact-upload-route.test.ts` were written first against the (nonexistent) admission-control code; every new test failed to compile/run before the module existed.

**RED (route-wiring mutation, live-reproduced this checkpoint):** with the admission-control block temporarily removed from `document-artifact-upload-route.ts` (restoring immediately after), the full route test file was re-run:

```
✓ 14 passed (pre-existing tests, unaffected)
✗ §7 fails closed (503) when CF-Connecting-IP is absent            — got 201
✗ §16/§17/§12 exceeding the per-source limit returns 429            — got 201
✗ two different textual representations of the same address ... 429 — got 201
```

Exactly the three new admission-control tests failed; nothing else regressed. The route file was restored byte-for-byte and re-verified GREEN (54/54 across the four affected test files).

**GREEN:** 54 new/updated tests pass:
- `document-ingress-admission-control.test.ts` — 21 tests (normalization, source extraction, per-source/global axes, ordering, window reset, fail-closed on repository error)
- `repositories/d1/document-ingress-admission.test.ts` — 6 tests, against **real Miniflare D1/SQLite**, including the exact concurrency race
- `routes/document-artifact-upload-route.test.ts` — 17 tests (6 pre-existing tests updated to supply `CF-Connecting-IP`; 3 new admission-control tests)
- `index.document-upload-real-app.test.ts` — 10 tests (fake D1 double updated to return `meta.changes: 1`, matching its own stated purpose of proving requests reach the R2 seam, not admission-control semantics)

**Mutation proof (D1 statement itself):** `document-ingress-admission.test.ts`'s own `MUTATION_PROOF` test runs the *unguarded* SQL shape (`UPDATE ... SET count = count + 1` with no `WHERE count < ?`) directly against the same real table and shows it overshoots a limit of 2 (reaches 5) — proving the `WHERE` guard in the real implementation is load-bearing, not decorative.

**Concurrency proof (§17), against the real engine, not just a double:** 20 concurrent `admitAndIncrement` calls racing the single remaining slot on real Miniflare-backed D1/SQLite admit exactly 1. The same property is proven at the in-memory logic-double layer (25 concurrent callers, exactly 1 admitted) and at the composed `checkDocumentIngressAdmission` layer.

## 7. Fail-closed proof (§14)

Two dedicated tests construct a `DocumentIngressAdmissionRepository` whose `admitAndIncrement` returns a `DATABASE_ERROR` — one on the per-source axis, one on the global axis (reached only after per-source admits). Both produce `{ allowed: false, scope: 'limiter_unavailable' }`, mapped by the route to HTTP 503 with zero further work. No code path returns `{ allowed: true }` on a repository error.

## 8. Public error-shape / no leakage (§13)

The rejected-request response body is `{ error: 'rate_limited' | 'temporarily_unavailable', message: '...' }` — identical shape regardless of which axis (per-source vs. global) rejected the request. A dedicated test asserts the response text never contains the caller's real source IP nor the words `per_source`, `global`, `d1`, `r2`, or `sqlite` (case-insensitive). `Retry-After` is set to the full window length (86,400s) — a conservative upper bound, not a precise countdown, since the fixed-window design cannot cheaply expose exact remaining time without a second read.

## 9. Payment separation (§25)

`document-ingress-admission-control.ts` imports nothing from x402/payment/PCC/service-registry; `document-artifact-upload-route.ts`'s existing structural test (`never imports x402/payment/PCC/service-registry machinery`) continues to pass unmodified. `UPLOAD_SETTLEMENT_CALLS=0`, `UPLOAD_PROVIDER_PAYMENT_CALLS=0` — the admission check is a pure pre-payment gate, never itself an authorization signal.

## 10. Non-regression

- MCP/A2A/x402 protocol checks: unaffected (this module has zero import-path overlap; re-run this checkpoint, both PASS — see §12).
- `SERVICE_TOOL_MATRIX`, Agent Card JWS, pricing: unaffected — `pricing:check` re-run, PASS, no drift.
- Reclamation idempotency (`artifact-reclamation.test.ts`): untouched, re-run in the full suite, PASS.
- Active-artifact reclamation safety: unaffected — this checkpoint added no new deletion path; `reclaimStaleArtifacts` is unmodified.
- Document paid-service lookup for an already-admitted, already-stored artifact: unaffected — `storeDocumentUpload`/`resolveUploadReference` are unmodified.

## 11. Full release gate (exact counts, this checkpoint's HEAD)

| Check | Result |
|---|---|
| Typecheck | 23/23 packages PASS |
| Build | 12/12 packages PASS |
| Lint | 16/16 packages PASS |
| Full test suite | 2,842 passed / 77 skipped (network-gated) / 0 failed, across 232 files (was 2,799/77/0 before this checkpoint's 43 net-new tests) |
| Worker-runtime (`test:worker-runtime`) | 99/99 scenarios PASS |
| Protocol — MCP (`mcp:check`) | PASS |
| Protocol — x402 (`x402:check`) | PASS |
| Protocol — A2A (`a2a:check`) | PASS |
| `migrations:verify` (D1 transaction/concurrency/queue-consumer harness) | ALL PASSED |
| `pricing:check` | PASS — EMBEDDED_PRICING matches `governance/RISK_LIMITS.yaml` exactly, no drift |
| `governance:validate` | 77/77 PASS |
| `production:preflight` | PASS |
| `secrets:scan` (scope-verify + gitleaks + working-tree scan) | PASS, 0 unexplained findings (one new false positive found and allowlisted this checkpoint — see §13) |
| `wrangler deploy --dry-run` — public API Worker | PASS, binding list unchanged (confirms zero new bindings) |
| `wrangler deploy --dry-run` — dedicated Workflow host | PASS, binding list unchanged |
| `format:check` | 451 pre-existing files with drift (unrelated to this checkpoint, pre-dates it); all 3 of this checkpoint's own new/touched TypeScript files are prettier-clean (fixed during this checkpoint) |

One pre-existing failure was found and fixed *during* this checkpoint (see §13.2), not left as a known-bad baseline.

## 12. Binding/config delta (proof of zero new external dependency)

`wrangler deploy --dry-run` binding lists, both configs, before vs. after this checkpoint's code: **identical** — `DB`, `ARTIFACTS`, `CATALOG`, `JOBS`, `EVENTS`, `AI`, `BROWSER`, `PAID_CONTINUATION_WORKFLOW`, and the existing `[vars]`. No `[[ratelimits]]` entry, no new KV/D1/R2 binding, no new secret name. The only repo-level addition is one new D1 table (`document_ingress_admission_windows`, migration `0008`), which the public API Worker's existing `DB` binding already reaches.

## 13. Incidental fixes made to reach a genuinely clean gate

**13.1 — Migration idempotency.** The new migration's `CREATE TABLE`/`CREATE INDEX` initially omitted `IF NOT EXISTS`, breaking `nevermined-live-migration-idempotency.test.ts`'s positive-control re-run of the full migration set against an already-migrated database (a real, reproduced failure — not assumed). Every other migration in this repo uses `IF NOT EXISTS` for exactly this reason; `0008` was corrected to match, and the test re-run GREEN.

**13.2 — Secrets-gate false positive.** `secrets:scan` flagged `PUBLIC_API_ACTIVE_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a @ 100%` in the C0 evidence report (committed `de9af60`, before this checkpoint) as a `generic-api-key` finding. Confirmed false positive: a Cloudflare Worker Version ID is a public identifier (visible via `wrangler deployments status`/`versions view` to anyone with account read access, analogous to a git commit SHA), never credential material. The identical UUID appears unflagged in 19 other already-committed evidence reports that don't happen to use this exact `KEY=value @ N%` line shape, confirming a match-context artifact of the `generic-api-key` rule rather than something inherent to the value. Allowlisted as one exact literal in `.gitleaks.toml` (same convention as the existing Modal `wk-...` entries) — not a UUID-shaped pattern, so a real secret that happened to be UUID-shaped would still be caught.

## 14. Candidate manifest delta (updates C0's own manifest)

| Field | C0 value | R1 value |
|---|---|---|
| `PUBLIC_API_DEPLOY_REQUIRED` | YES | YES (unchanged — same script) |
| `WORKFLOW_HOST_DEPLOY_REQUIRED` | NO | NO (unchanged — this fix lives entirely in the public API Worker) |
| `DOCUMENT_INGRESS_DEPLOY_REQUIRED` | YES | YES (unchanged, same public API script) |
| `NEW_RATE_LIMIT_RESOURCE_REQUIRED` | n/a | NO |
| `NEW_RATE_LIMIT_BINDING_REQUIRED` | n/a | NO |
| `D1_MIGRATION_REQUIRED` | NO | **YES** — migration `0008` (additive `CREATE TABLE IF NOT EXISTS`; does not alter any existing table; backward-compatible with the current 100%-traffic candidate, which does not reference the new table at all) |
| `R2_CONFIG_MUTATION_REQUIRED` | NO | NO (unchanged) |

**Isolation nuance, stated explicitly rather than glossed over:** unlike a binding-only change (which is version-scoped and inert on the 100%-traffic version until that specific version is promoted), a D1 migration is schema-level and shared across every Worker version pointing at the same database — applying migration `0008` is **not** confined to the 0%-traffic candidate the way `wrangler.toml` binding changes are. It is, however, purely additive (one new table, one new index, no existing table touched), so applying it ahead of or alongside candidate qualification does not alter current 100%-traffic production *behavior* at all — the current candidate's code never references the new table. `FINAL_CANDIDATE_ALL_CHANGED_PLANES_ISOLATED` therefore holds for the *code/binding* plane but not, strictly, for the *schema* plane — which is safe here only because the schema change is additive, not because it is version-scoped.

## 15. Final packet

```
SUN1222C0_R1=PASS
C0R1_START_HEAD=de9af60
C0R1_END_HEAD=d11ab52c9867b3860d046a17bf48f7ad3b88de21
DOCUMENT_INGRESS_SOURCE_KEY=normalizeSourceKey(CF-Connecting-IP)
SOURCE_KEY_SPOOFABLE_BY_CALLER=NO
SELECTED_RATE_LIMIT_PRIMITIVE=D1 (existing DB binding), atomic INSERT..ON CONFLICT DO UPDATE..WHERE
DISTRIBUTED_ACROSS_ISOLATES=YES (D1 is one logical database, not per-isolate/per-colo)
NEW_EXTERNAL_RESOURCE_REQUIRED=NO
PER_SOURCE_BOUND_PRESENT=YES
GLOBAL_BOUND_PRESENT=YES
PER_SOURCE_MAX_ACCEPTED_UPLOADS_PER_WINDOW=50
PER_SOURCE_WINDOW_SECONDS=86400
PER_SOURCE_RETENTION_WINDOW_MAX_BYTES=524288000
GLOBAL_MAX_ACCEPTED_UPLOADS_PER_WINDOW=2000
GLOBAL_WINDOW_SECONDS=86400
GLOBAL_RETENTION_WINDOW_MAX_BYTES=20971520000
UNBOUNDED_STORAGE_MATHEMATICALLY_ELIMINATED=RATE: YES (proven atomic, both axes) / TOTAL-OVER-UNBOUNDED-TIME: contingent on the pre-existing, separately-tracked reclamation-cron gap (not new, not in this checkpoint's scope) — see §5/§14 of report
INGRESS_ABUSE_RED=YES (reproduced live this checkpoint, see §6)
SOURCE_LIMIT_CONCURRENCY=PASS (proven against real D1/SQLite, not just a double)
SOURCE_SPOOFING_MATRIX=PASS
GLOBAL_ABUSE_BOUND=PASS
LIMITER_FAILURE_FAILS_CLOSED=YES
RATE_LIMIT_HTTP_STATUS=429 (503 for limiter_unavailable)
RATE_LIMIT_ERROR_CODE=rate_limited (temporarily_unavailable for limiter_unavailable)
RETRY_AFTER_SUPPORTED=YES (conservative full-window value, not a precise countdown)
R2_PUT_ON_REJECTED_REQUESTS=0
D1_WRITES_ON_REJECTED_REQUESTS=0 (job_artifacts table -- the admission-control table itself is written on every request by design)
DOCUMENT_INGRESS_PRODUCTION_COMPOSITION=PASS
INGRESS_ABUSE_MUTATION_PROOF=PASS (route-level RED reproduced live + D1-statement-level unguarded-shape proof)
ARTIFACT_RECLAMATION_IDEMPOTENCY=PASS (unchanged, re-verified)
ACTIVE_ARTIFACT_RECLAMATION_SAFETY=PASS (unchanged, unmodified code path)
DOCUMENT_INGESTION_SECURITY_MATRIX=PASS
UNBOUNDED_UNPAID_STORAGE_PATHS=0
DOCUMENT_ARTIFACT_LIFECYCLE=PASS
POST_FIX_PER_SOURCE_COST_BOUND=~$0.0075/month worst case (500 MiB @ R2 storage pricing)
POST_FIX_GLOBAL_COST_BOUND=~$0.29/month worst case (19.53 GiB @ R2 storage pricing)
COMPANY_V2_REAL_EXECUTOR=YES
WEBCTX_V2_REAL_EXECUTOR=YES
DOCUMENT_V2_REAL_EXECUTOR=YES
VERIFY_V2_REAL_EXECUTOR=YES
PRICE_SINGLE_SOURCE_OF_TRUTH=YES
PRICING_CHECK=PASS
QUALIFICATION_BUYER_BALANCE_ATOMIC=NOT_RECHECKED (no new read-only balance mechanism invoked this checkpoint; prior C0/D-resume figure of 79727 preserved as historical, not re-verified current fact)
TOTAL_FOUR_SERVICE_QUALIFICATION_ATOMIC=66000 (unchanged, source-verified this checkpoint via pricing:check)
QUALIFICATION_HEADROOM_ATOMIC=NOT_RECHECKED (depends on the balance figure above)
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=NOT_RECHECKED
TYPECHECK=23/23
BUILD=12/12
LINT=16/16
TESTS=2842 passed / 77 skipped / 0 failed (232 files)
WORKER_RUNTIME=99/99
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
SSRF_DNS_REBINDING=PASS (unaffected, unchanged, part of full suite)
X402_REPLAY_CONCURRENCY=PASS (unaffected, unchanged, part of full suite)
TRUST_CLASS_REGRESSION=PASS (unaffected, unchanged, part of full suite)
POST_SETTLEMENT_FAIL_CLOSED_REGRESSION=PASS (unaffected, unchanged, part of full suite)
PCC_GENERATION_CHECK=PASS (unaffected, unchanged, part of full suite)
GOVERNANCE_VALIDATION=77/77 PASS
UNEXPLAINED_SECRET_FINDINGS=0
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS (both configs, binding lists unchanged)
PUBLIC_API_DEPLOY_REQUIRED=YES
WORKFLOW_HOST_DEPLOY_REQUIRED=NO
DOCUMENT_INGRESS_DEPLOY_REQUIRED=YES (same public API script)
NEW_RATE_LIMIT_RESOURCE_REQUIRED=NO
NEW_RATE_LIMIT_BINDING_REQUIRED=NO
D1_MIGRATION_REQUIRED=YES (migration 0008, additive, not yet applied to production D1 -- repo-only this checkpoint)
R2_CONFIG_MUTATION_REQUIRED=NO
FINAL_CANDIDATE_ALL_CHANGED_PLANES_ISOLATED=YES for code/bindings; NOT STRICTLY for schema (additive migration is shared across versions -- see §14)
ZERO_PERCENT_QUALIFICATION_DOES_NOT_CHANGE_NORMAL_PRODUCTION_BEHAVIOR=YES (migration is additive; current 100% candidate code never references the new table)
SUN1222C1_CANDIDATE_PROVISIONING_ELIGIBLE=YES
C1_AUTHORIZATION_DRAFT_UPDATED=NOT DONE THIS CHECKPOINT -- out of R1's own stated scope (R1 = remediation + gate + eligibility recompute only); recommend doing this as the first step of SUN-1222C1 itself, sourced from C0's original draft plus this report's §14 delta
C0R1_EVIDENCE_COMMIT_SHA=d11ab52c9867b3860d046a17bf48f7ad3b88de21
WORKING_TREE=clean after commit
PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
NEXT_REQUIRED_CHECKPOINT=SUN-1222C1-FOUR-SERVICE-CANDIDATE-PROVISIONING
```
