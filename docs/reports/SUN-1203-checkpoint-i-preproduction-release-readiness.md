# SUN-1203 Checkpoint I — Pre-Production Release-Candidate Readiness

Answers one question with evidence: is SITEBORNE Utility Network genuinely ready
for a human-authorized candidate upload and cutover? Implementation commit
`be5db59`. `END_HEAD` = this report's own (amended) commit.

## Repository

- `START_HEAD` = `b740520` (SUN-1202 checkpoint H closure report)
- Working tree at start: clean except the known transient `wrangler.toml` diff —
  confirmed.
- Production at start: 100% `a4ada936-a434-4522-a8af-41c57170f4e4`, paid routes
  404 — confirmed, unchanged throughout this checkpoint.

## Production (read-only, throughout)

- Current deployment ID: `a4ada936-a434-4522-a8af-41c57170f4e4`
- Traffic percentage: 100%
- Paid-route state: 404 (structurally disabled)
- `VERSION_UPLOADS = 0`, `DEPLOYMENTS = 0` (this checkpoint performed none)

## Economic

`PAYMENT_SIGNATURES = 0`, `SETTLEMENTS = 0`, `TRANSACTIONS = 0` — every payment
rehearsed this checkpoint used the SUN-1201 structurally-isolated
`FixturePaymentEvidenceProvider` test seam, never real infrastructure.

## 1. Canonical release inventory — `PAID_SERVICE_RELEASE_MATRIX`

Built directly from `apps/edge-api/src/control-plane/routes/paid-services.ts`
and `governance/RISK_LIMITS.yaml` (not from memory). **12 route configurations,
8 unique service/version identities, across 2 rails for v2:**

| Service ID                  | Route(s)                                                                      | Method | Scheme | Price (USD) | Contract release | Rail(s)          | Test coverage                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- | ------ | ------ | ----------- | ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `company_evidence_graph.v1` | `POST /v1/company/evidence-graph`                                             | POST   | exact  | 0.039       | 1.0.0            | CDP              | Extensive Node (`x402-service-route.test.ts`) + **real workerd P1/P2/P3 this checkpoint**                             |
| `web_context_verified.v1`   | `POST /v1/web/context`                                                        | POST   | exact  | 0.009       | 1.0.0            | CDP              | Extensive Node + **real workerd P1/P2/P3 this checkpoint**                                                            |
| `document_evidence_json.v1` | `POST /v1/document/evidence-json`                                             | POST   | upto   | 0.19 (max)  | 1.0.0            | CDP              | Extensive Node + **real workerd P1/P2/P3 this checkpoint**                                                            |
| `verify_agent_output.v1`    | `POST /v1/verify/agent-output`                                                | POST   | exact  | 0.019       | 1.0.0            | CDP              | Extensive Node + **real workerd P1-P6 (SUN-1201/1202)**                                                               |
| `company_evidence_graph.v2` | `POST /v2/company/evidence-graph` (+ `/v2/nevermined/company/evidence-graph`) | POST   | exact  | 0.039       | 2.0.0            | CDP + Nevermined | Extensive Node only — **not independently proven under real workerd this checkpoint** (code-identical executor to v1) |
| `web_context_verified.v2`   | `POST /v2/web/context` (+ Nevermined)                                         | POST   | exact  | 0.009       | 2.0.0            | CDP + Nevermined | Node + real-workerd **pre-economic only** (existing Phase 1); settled path not independently proven under workerd     |
| `document_evidence_json.v2` | `POST /v2/document/evidence-json` (+ Nevermined)                              | POST   | upto   | 0.19 (max)  | 2.0.0            | CDP + Nevermined | Node + real-workerd **pre-economic only**; settled path not independently proven under workerd                        |
| `verify_agent_output.v2`    | `POST /v2/verify/agent-output` (+ Nevermined)                                 | POST   | exact  | 0.019       | 2.0.0            | CDP + Nevermined | Node + **real workerd P1-P6 (SUN-1200-1202)**; Nevermined rail not proven under workerd                               |

Common to all: input/output schema per `contracts/releases/{1.0.0,2.0.0}`;
`Payment-Identifier` extension (SUN-1202-fixed); idempotency via
`payment_attempts`/`x402_service_results` D1 binding (`replay/binding.ts`);
receipt via `packages/verification`'s Ed25519-signed `VerificationReceipt`; PCC
document + `PaymentServiceLink`; D1 tables: `services`, `payment_attempts`,
`x402_quotes`, `x402_service_results`, `jobs`, `state_events`, `audit_events`;
no R2/KV/AI/ Browser binding used by any of these four service implementations
directly (Workers AI/Browser Rendering bindings exist on the Worker but are not
invoked by any of the four paid services' current fixture-backed executors —
confirmed by grep, no `env.AI`/`env.BROWSER` reference in `paid-services.ts`'s
executor closures); external providers: SEC EDGAR (company, fixture-backed
today), none live for web-context/document in the current fixture executors;
timeout/size limits: `createBodySizeMiddleware` (global),
`MAX_DECODED_HEADER_BYTES=64KB` (x402 headers), Profile 1's 9 resource limits
(verify_agent_output only); concurrency: proven via
`x402-service-route.test.ts`'s 20-concurrent-retry and 10-concurrent-binding
property tests; failure/status mapping: `service_execution_failed`(502)/
`malformed_payment_signature`(400)/`payment_verification_rejected`(402)/
`expired_quote`(402)/`authorization_exceeded`(rejected, `upto` only); release
blocker status: see §"Findings" below — v2/Nevermined real-workerd coverage gap
is the one concrete blocker.

## 2. Contract freeze and drift proof

- `pnpm contracts:baseline:verify` / `compat:check` / `release:verify` — all
  pass, zero drift.
- `pnpm schemas:check` — pass.
- **New this checkpoint**: `pnpm pricing:check`
  (`scripts/check-embedded-pricing-drift.mts`) — found and closed a real,
  previously-unguarded gap: `packages/pricing/src/service-prices.ts`'s
  `EMBEDDED_PRICING` constant (the price table the real bundled Worker actually
  uses — `getRiskLimitsPath()`'s `import.meta.url`-relative path does not
  survive esbuild bundling, the same `UNPROVEN_BUNDLE_PATH_DEPENDENCY` class as
  `schema-registry.ts` had) had NO automated check proving it matches
  `governance/RISK_LIMITS.yaml`, despite a doc comment claiming it was
  validated. Currently in sync (confirmed); now permanently guarded, wired into
  `pnpm check`.

**`CONTRACT_DRIFT = NONE`**. **`PRICE_DRIFT = NONE`** (now actively guarded, not
merely currently-true). **`ROUTE_CONTRACT_DRIFT = NONE`** (every route above is
contract-release-declared; no orphan route or orphan contract found).
**`UNVERSIONED_PUBLIC_BEHAVIOR = NONE`** found.

No contract version was minted this checkpoint (no public wire change).

## 3. Full real-`workerd` paid-service rehearsal

`scripts/test-worker-runtime.mts` extended with **Phase 3**: P1/P2/P3 for
`company_evidence_graph.v1`, `web_context_verified.v1`,
`document_evidence_json.v1` (real 402, real deterministic pre-economic
rejection, real post-settlement success with real `receipt_id`/`link_id`),
reusing the exact same structurally-isolated SUN-1201 test-only entrypoint — no
new test seam introduced. `verify_agent_output.v1`/`.v2` already had P1-P6
real-workerd coverage from SUN-1200-1202.

**`WORKERD_SERVICE_COVERAGE`**:

- v1 CDP (4/4 services): **P1/P2/P3 proven this checkpoint**;
  `verify_agent_output.v1` additionally has P4-P6 from prior checkpoints.
- v2 CDP (4/4 services): pre-economic (P1/P2/P6/P8-equivalent via Profile 1
  Cases C-F) proven under real workerd for `verify_agent_output.v2` only; the
  other three v2 CDP services' pre-economic behavior was NOT independently
  re-verified under real workerd this checkpoint (though they share the
  identical route-construction code, `createX402ServiceRoute`, with the ones
  that were). Settled (P3+) behavior for v2 CDP was NOT proven under real
  workerd for any of the four services this checkpoint — only
  `verify_agent_output.v2`'s Node-level and `verify_agent_output.v1`'s
  real-workerd coverage exist.
- v2 Nevermined (4/4 services): extensively covered in Node
  (`nevermined-service-route.test.ts`, `chaos-v2-settlement-recovery.test.ts`,
  `model-d-v2-nevermined.test.ts`), but **zero real-workerd coverage**, this
  checkpoint or any prior one. The Nevermined evidence provider requires real
  API-key-shaped construction
  (`NeverminedPaymentEvidenceProvider.authenticated`), a materially different
  seam than the CDP `FixturePaymentEvidenceProvider` path already proven —
  extending real-workerd proof there is new, non-trivial scope this checkpoint
  did not build.

**Numerically: 12/12 route configs have real-`workerd` PRE-ECONOMIC coverage is
FALSE** (only 5 of 12 configs — v1×4 + v2 CDP `verify_agent_output` — were
exercised under real workerd this checkpoint or a prior one for even the
unsigned/pre-economic path; the other 7 rely on Node-level proof only).
**Settled (post-payment) real-`workerd` coverage: 5/12** (v1×4 +
`verify_agent_output.v2` via the schema-echoing proof).

Per this checkpoint's own explicit rule ("Anything below 100% is a
release-readiness blocker unless the route is provably dead/deprecated and
excluded from production release") — none of these routes are dead or deprecated
(all are live, priced, contract-declared, and would be enabled by the existing
`wrangler.toml` diff) — **this is classified as an R0 blocker below**, not
silently accepted.

## 4. Do not create a universal production bypass

No change was made to the test-seam architecture. Phase 3 reuses the exact same
`worker-runtime-test-entrypoint.ts`/`wrangler.worker-runtime-test.toml` SUN-1201
already built and SUN-1201/1202's own bundle-isolation check already proves
absent from the real production bundle — re-confirmed this checkpoint (see
§"Bundle" below). **`PRODUCTION_TEST_SEAM_REACHABILITY = NONE`**, proven
automatically (same check, re-run).

## 5. External-provider readiness (`PROVIDER_READINESS_MATRIX`)

| Provider                          | Service(s)                                                                                          | Sync/async                                | Production binding present?                                                                                                                     | Local fixture exists?                                       | Fail behavior                                                                    | Data sent externally                                                                                                                     | Release blocker?                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CDP facilitator (Coinbase)        | all 4 services, CDP rail                                                                            | async                                     | Yes, gated by 4 ADR 0055 conditions + 2 secrets (structurally unreachable without real credentials — confirmed every checkpoint since SUN-1200) | Yes, `FixturePaymentEvidenceProvider`                       | Falls back to fixture mode (never a crash) unless every gate passes              | Payment payload only, to Coinbase's own facilitator, never to SITEBORNE's own logs (confirmed, `evidence/provider.ts`'s own doc comment) | No                                                                                                                                                                                                                                                            |
| Nevermined                        | all 4 v2 services, Nevermined rail                                                                  | async                                     | Yes, gated by `NEVERMINED_ROUTES_ENABLED` + real API key + live-guard (sandbox-only, `live` hard-rejected)                                      | Yes (fixture-mode tests)                                    | 503 `nevermined_provider_not_configured`, never a fixture fallback in production | Access token to Nevermined's own API                                                                                                     | No (structurally sandbox-only)                                                                                                                                                                                                                                |
| SEC EDGAR (company evidence)      | `company_evidence_graph.*`                                                                          | N/A in current executors                  | N/A — current paid-services.ts executors are fixture-backed (`SEC_EDGAR_FIXTURE`), not live-fetching                                            | Yes (the fixture itself)                                    | N/A                                                                              | N/A                                                                                                                                      | **R1** — the real provider-adapter code (`packages/provider-adapters`) that WOULD live-fetch SEC EDGAR is not wired into the current paid route's executor; this is a known, pre-existing, deliberate scope limit, not a regression this checkpoint found new |
| Workers AI (`env.AI`)             | none of the 4 current paid-service executors                                                        | —                                         | Binding present                                                                                                                                 | —                                                           | —                                                                                | —                                                                                                                                        | No (unused by paid routes today)                                                                                                                                                                                                                              |
| Browser Rendering (`env.BROWSER`) | none of the 4 current paid-service executors                                                        | —                                         | Binding present                                                                                                                                 | —                                                           | —                                                                                | —                                                                                                                                        | No (unused by paid routes today)                                                                                                                                                                                                                              |
| D1                                | all services                                                                                        | sync (within-request)                     | Yes, real ID                                                                                                                                    | Yes (`--persist-to`, this checkpoint's migration rehearsal) | Route returns 500 `configuration_error` if absent                                | Full payment/service state                                                                                                               | No                                                                                                                                                                                                                                                            |
| KV (`CATALOG`)                    | not required by any of the 4 paid services (`env.ts` does not list `CATALOG` in `requiredBindings`) | —                                         | Yes, real ID                                                                                                                                    | —                                                           | —                                                                                | —                                                                                                                                        | No                                                                                                                                                                                                                                                            |
| Queues (`JOBS`/`EVENTS`)          | control-plane job dispatch (not the 4 x402 paid routes directly)                                    | producer-only, no consumer in this Worker | Yes                                                                                                                                             | —                                                           | —                                                                                | —                                                                                                                                        | R2 hardening — no consumer means messages accumulate; out of this checkpoint's narrow scope (pre-existing)                                                                                                                                                    |

No secret value was printed anywhere in this checkpoint's work.

## 6. Cloudflare binding reconciliation

From `wrangler.toml`: `DB` (D1), `CATALOG` (KV), `JOBS`/`EVENTS` (Queues,
producer-only), `AI`, `BROWSER`. `ARTIFACTS` (R2) is explicitly commented out
(never provisioned — `InMemoryArtifactStore` is the real, unconditional artifact
store; this is a pre-existing, documented product limitation, not new).

**Finding (new this checkpoint, R1):**
`apps/edge-api/src/control-plane/config/env.ts`'s `validateProductionBindings`
function declares `requiredBindings = ['DB', 'ARTIFACTS', 'JOBS', 'EVENTS']` —
**including `ARTIFACTS`**, which does not exist in the real `wrangler.toml`.
Confirmed via grep: **this function has zero callers anywhere in the real
Worker's request path** — it is dead code. It provides no actual protection
today (the Worker boots and serves 200s without R2, confirmed live against
production this checkpoint), but its existence could give a false impression
that production bindings are validated at startup when they are not. Not fixed
this checkpoint (not release-critical — the real code path never depended on
it), recorded as R1.

- `MISSING_PRODUCTION_BINDINGS` = none required by any live code path (ARTIFACTS
  is listed in dead validation code only, not by any reachable code).
- `UNUSED_PRODUCTION_BINDINGS` = `AI`, `BROWSER` (present, bound, unused by any
  current paid-service executor).
- `BINDING_NAME_DRIFT` = none found.
- `COMPATIBILITY_RISK` = none found (`compatibility_date = "2026-08-05"`,
  `nodejs_compat` — unchanged, already extensively proven this session).
- `PRODUCTION_SECRET_NAMES_MISSING` = not independently re-checked this
  checkpoint (would require `wrangler secret list` against real credentials —
  read-only but still an authenticated production call; deferred to the cutover
  runbook's own §3, to be run by a human operator at actual cutover time).

## 7. D1/storage migration rehearsal

`pnpm migrations:verify` (isolated, fresh `--persist-to` state): clean DB →
latest migrations → concurrency tests (exactly one acquisition succeeds among
concurrent duplicates) → queue-consumer validation tests (valid/
expired/retry-exhausted/unknown/attempt-mismatch/terminal/
production-disabled/duplicate-delivery, all correctly handled) → cleanup.
**`D1_MIGRATION_REHEARSAL = PASS`**. **`STORAGE_SCHEMA_READINESS = PASS`**.
**`DESTRUCTIVE_MIGRATIONS = NONE`** (all migrations in `migrations/` are
additive `CREATE TABLE`/`ALTER TABLE ADD COLUMN`-style, confirmed by directory
listing — no `DROP`/`DELETE` migration exists). **`ROLLBACK_DATA_RISK = NONE`**
— migrations are forward-only and additive; rolling back the Worker code to an
older version while D1 has newer columns/tables present is compatible (older
code simply does not reference the newer columns) — no destructive schema change
exists that would make old code incompatible with new data.

## 8. Economic correctness audit

Reused the existing, extensive `packages/pricing`/`x402-service-route.test.ts`
suite (778 tests from SUN-1202, unchanged) plus this checkpoint's new
`pricing:check`. Confirmed: price is read from one canonical source
(`resolveServiceMaxPriceUsd`), `usdToAtomicUnits` conversion is deterministic
and tested, `upto` scheme's actual-usage-exceeds-authorized-maximum case is
explicitly tested and rejected (`authorization_exceeded`, not silently clipped —
existing test, re-confirmed passing), replay/duplicate tests prove no
double-execution or double-settlement (`duplicate_same`/`duplicate_conflict`
semantics).

- `PRICE_CALCULATION_TESTS = PASS`
- `QUOTE_SETTLEMENT_AMOUNT_MATCH = PASS`
- `DOUBLE_CHARGE_RISK = NONE` (existing concurrency/replay test suite, re-run
  this checkpoint, all green)
- `CLIENT_PRICE_TAMPERING = REJECTED` (quote_id binding in `accepted.extra`; a
  forged/mismatched quote_id is rejected — existing `expired_quote` adversarial
  test, re-confirmed passing)

## 9. Receipt and evidence integrity

Reused `packages/verification/src/tests/receipt.test.ts` (15 tests) and
`packages/service-runtime`'s own tamper-detection tests (e.g. "tampering with a
bound receipt field (decision) invalidates cryptographic verification"). All
pass, unchanged this checkpoint.

- `RECEIPT_TAMPER_DETECTION = PASS`
- `INPUT_OUTPUT_BINDING = PASS` (input_hash/output_hash present and verified in
  every real-workerd Phase 2/3 response this checkpoint)
- `SERVICE_VERSION_BINDING = PASS`
- `PAYMENT_RECEIPT_BINDING = PASS` (`PaymentServiceLink`, `link_id` present in
  every real-workerd settled response this checkpoint)

## 10. Abuse and resource-boundary audit

Reused existing bounds: `createBodySizeMiddleware` (global request-size cap),
`MAX_DECODED_HEADER_BYTES=64KB` (x402 headers, `codec/headers.ts`), Profile 1's
9 explicit resource limits (`verify_agent_output` only). **Not independently
re-verified fresh this checkpoint** for the other three services'
document/URL/array-cardinality bounds beyond what the existing
adversarial/fast-check test suites already cover
(`packages/protocol-x402/src/tests/adversarial.test.ts`, 17 tests, unchanged,
re-run, passing).

- `UNBOUNDED_COST_PATHS` = none newly found; not exhaustively re-audited this
  checkpoint beyond existing coverage (R2 — worth a dedicated pass in a future
  checkpoint, not required to block this one given existing bounds).
- `UNBOUNDED_RUNTIME_PATHS` / `UNBOUNDED_MEMORY_PATHS` = same as above.
- `SSRF_REVIEW` = see below.
- `REDIRECT_POLICY` = covered by the SSRF test suite
  (redirect-into-private-range cases exist in `http-ssrf.test.ts`).
- `DOCUMENT_BOMB_REVIEW` = not independently re-verified this checkpoint.

## 11. SSRF / remote-fetch security

`packages/provider-adapters/src/tests/http-ssrf.test.ts` — **31/31 tests pass**,
re-run this checkpoint: loopback, private ranges (RFC1918), link-local, metadata
endpoints, redirect-into-private-range, unusual schemes all covered by the
existing `network-policy.ts` module.

**`SSRF_PROTECTION = PASS`** (pre-existing, comprehensive, re-verified — not
newly built this checkpoint).

## 12. Observability readiness

`createRequestTimingMiddleware`/`createAuditContextMiddleware` (index.ts)
provide request timing and audit-context correlation; `x402-service.ts`'s own
`audit()` calls emit `payment_verified`/`service_execution_started` events with
`job_id`/`payment_identifier`. Not independently re-verified this checkpoint
whether these are queryable in a real operational sense (no external log
aggregation exists in this repository to test against) — recorded as R1, not R0,
since the underlying data IS present in D1/audit events, just not yet piped to
an external observability platform.

- `CORRELATION_ID_AVAILABLE` = YES (`request_id`/`job_id` present in every
  response and D1 row)
- `PAYMENT_PHASE_OBSERVABLE` = YES (lifecycle_stage column, `payment_attempts`
  table)
- `PROVIDER_FAILURE_OBSERVABLE` = YES (`audit_events`,
  `service_execution_failed` error codes)
- `SECRET_LOGGING_FINDINGS` = none found (re-ran `pnpm secrets:scan`, 0 leaks,
  and `PaymentPayload`'s doc comment explicitly documents `payload` is never
  persisted beyond a single verify/settle call)
- `PII_PAYLOAD_LOGGING_FINDINGS` = none found in this pass; not exhaustively
  re-audited beyond existing test coverage

## 13. Error taxonomy audit

Reused the existing, extensive error-code inventory already proven by
`x402-service-route.test.ts`'s adversarial suite (§36) and this checkpoint's own
Phase 2/3 scenarios: `invalid_request`, `malformed_payment_signature`,
`payment_verification_rejected`, `expired_quote`, `settlement_rejected`,
`service_execution_failed`, `unsupported_required_schema`,
`required_schema_limit_exceeded`. No raw stack trace observed in any response
body across every scenario run this checkpoint (27 real-workerd scenarios + 778
vitest tests).

- `PUBLIC_STACK_TRACE_LEAK = NONE`
- `ERROR_CONTRACT_DRIFT = NONE`
- `RETRY_SAFETY_AMBIGUITIES` = the pre-existing, already-documented
  `SETTLEMENT_PENDING`/ambiguous-settlement class (SUN-0900B's own recovery
  design) — a known, intentional "ambiguous, never auto-retried" state, not a
  new finding.

## 14. Timeout, cancellation and orphan-work review

Not independently re-audited this checkpoint beyond confirming the four current
paid-service executors are fixture-backed (synchronous, in-process, no real
external fetch/AI/Browser call that could outlive a request). **R1**: this
conclusion would need re-verification the day any executor is wired to a real,
live external provider (SEC EDGAR live-fetch, real Browser Rendering, etc.) —
today it holds only because those integrations remain unwired, not because of
any explicit cancellation/timeout architecture proven this checkpoint.

- `ORPHAN_WORK_RISKS` = none identified for the current fixture-backed executors
  specifically; not applicable to real external providers since none are wired
  into the current paid routes.
- `TIMEOUT_COVERAGE` / `CANCELLATION_COVERAGE` = not exhaustively proven this
  checkpoint (R2 — revisit when/if a live provider is wired into a paid route's
  executor).

## 15. Concurrency, idempotency and replay

Reused existing, extensive coverage (`x402-service-route.test.ts`'s
concurrency/replay property tests, `d1-payment-attempts.test.ts`'s 20 concurrent
acquisitions test, `migrations:verify`'s own concurrency rehearsal this
checkpoint). All pass.

- `PAYMENT_REPLAY_PROTECTION` = enforced (`duplicate_same`/
  `duplicate_conflict`, immutable binding)
- `REQUEST_IDEMPOTENCY` = same-binding retry returns the same result without
  re-execution (existing test, re-confirmed)
- `CONCURRENT_DUPLICATE_BEHAVIOR` = exactly one execution wins among N
  concurrent identical requests (existing property test)
- `RETRY_AFTER_SETTLEMENT_BEHAVIOR` = `SETTLEMENT_PENDING` recovery reads real
  external state read-only before ever re-settling (SUN-0900B design, unchanged)

## 16. Release-build reproducibility

- Node: `v24.18.1` (this environment). pnpm: workspace-managed, lockfile present
  and unmodified. Wrangler: `4.119.0` (pinned, confirmed throughout this session
  — an update to 4.124.0 is available but not applied, consistent with "do not
  force-upgrade" guidance from every prior checkpoint). Compatibility date:
  `2026-08-05`.
- `pnpm install` (already run this session) reports no lockfile drift.
- `wrangler deploy --dry-run --outdir` succeeds cleanly, bundle size ~6.57MB
  (`index.js`), no untracked file required.

`LOCKFILE_DRIFT = NONE`. `GENERATED_ARTIFACT_DRIFT = NONE`
(`schemas:check`/`pricing:check`/`pcc:generate:check`/`services:generate:check`/
`openapi:generate:check` all pass). `RELEASE_BUILD_REPRODUCIBLE = YES`.

## 17. Production-bundle attack-surface audit

Fresh `wrangler deploy --dry-run --outdir` (173,832-line bundle, unchanged line
count from SUN-1202):

- Bare `eval(` count: **0**
- `new Function(` count: **1** (AJV internal `_compile`, unreachable —
  unchanged, re-confirmed)
- Test-only entrypoint: **absent** (0 matches)
- `sanitizePaymentIdentifierExtensionForValidation`: present (3 occurrences —
  the SUN-1202 fix, confirmed reachable)
- Development/debug routes: none found (grep for `/debug`/`/__test`-style paths
  across `index.ts` and route files: zero matches)
- Source maps: `index.js.map` is a **local `--dry-run` audit artifact only** —
  `wrangler.toml` has no `upload_source_maps` setting, so a real
  `wrangler versions upload` does not publish it to Cloudflare by default (not
  independently re-verified against a real upload this checkpoint, since no
  upload is authorized — R2, worth an explicit `upload_source_maps = false` for
  clarity in a future checkpoint)
- Credentials: none found (re-ran `pnpm secrets:scan`)
- Fixtures: `SEC_EDGAR_FIXTURE`/`DOCUMENT_FIXTURE_WORKER_RESULT` are bundled —
  both non-secret, intentional, already-audited (SUN-0300/ SUN-0400A) test
  fixtures the real executors return deterministically; not new this checkpoint.

**`PRODUCTION_BUNDLE_REQUEST_RUNTIME_CRASH_BLOCKERS = 0`**.
**`PRODUCTION_PAYMENT_BYPASS_CODE = NONE`**.

## 18. Dependency/security reconciliation

Full `pnpm security:release` re-run this checkpoint (exit 0):

- Semgrep: 0 findings (50 rules, 529 files)
- OSV-Scanner: 77 total vulnerabilities, 0 critical, all 77 have fixes available
  (below the project's own documented blocking policy — "blocks only on
  CRITICAL-severity findings," an established, not-new policy from SUN-1000
  checkpoint 1F)
- Trivy: 7 total vulnerabilities, **0 blocking critical/high**, 0
  misconfigurations
- Schemathesis: 1512+ generated cases, all pass (exact count captured in the
  full log; consistent with every prior checkpoint this session)
- Chaos: 18/18
- Load: 7/7
- `pnpm test:worker-runtime`: 27/27 (up from 17/17 — 10 new Phase 3 scenarios)
- Secrets scan: 0 leaks

`CRITICAL_VULNERABILITIES = 0`. `HIGH_VULNERABILITIES = 0` (blocking threshold).
`UNJUSTIFIED_SECURITY_SUPPRESSIONS` = none found — the one existing "policy"
(OSV blocks only on critical) is documented, dated, and consistently applied,
not a blanket ignore-everything pattern.

## 19. Load and cost-envelope rehearsal

Reused `load-v2.test.ts` (7/7, re-run this checkpoint): steady concurrency,
burst, D1 contention, mixed-service, duplicate-identifier contention, resource
stability (RSS growth 1.67x across the full campaign, not runaway), all within
the existing release-gate thresholds. Not run against real `workerd`
(Node/Miniflare only, as this test suite has always been) — no new
real-`workerd` load rehearsal was built this checkpoint (R2 — existing coverage
judged sufficient for this pass, given the identical executor code already
proven correct under real workerd for 5/12 route configs).

- `LOAD_GATE = PASS`
- `BACKPRESSURE = ADEQUATE` for D1/payment-attempt contention (existing
  duplicate-identifier-contention test proves exactly one execution wins under
  10 concurrent identical requests); no explicit 429/backpressure mechanism
  exists for raw request volume beyond Cloudflare's own platform limits (not
  SITEBORNE-specific — R2)
- `COST_AMPLIFICATION_PATHS` = none identified for the current fixture-backed
  executors (no real external provider is called per request today)

## 20. Cutover rehearsal — without cutover

See the new `docs/operations/PRODUCTION_CUTOVER_RUNBOOK.md` (15 sections,
matching this checkpoint's own required list exactly). No mutating command in
that document was executed.

## 21. Rollback proof

- `KNOWN_GOOD_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4` (100%,
  confirmed live, re-checked immediately before writing this report)
- `ROLLBACK_PROCEDURE_DEFINED = YES` (`wrangler rollback` or explicit
  `wrangler versions deploy <known-good>@100% -y` — documented in the runbook)
- `ROLLBACK_DATA_COMPATIBILITY = COMPATIBLE` (migrations are additive-only,
  confirmed §7 — old code tolerates newer D1 columns/tables it doesn't
  reference)
- `ROUTE_DISABLE_PROCEDURE_DEFINED = YES` (flip `PAID_ROUTES_ENABLED`,
  documented in the runbook §13 — independent of a full code rollback)
- `IRREVERSIBLE_CUTOVER_ACTIONS` = a real, settled payment itself (once a real
  buyer pays and the facilitator settles, that transaction is on-chain and
  irreversible — this is inherent to any payment system, not a
  SITEBORNE-specific defect; the system's own idempotency/replay protections
  prevent SITEBORNE-side double-execution around that irreversible event,
  already proven §15)

## Regression (exact results)

| Gate                                                              | Result                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Focused SUN-1203 tests (pricing drift check)                      | pass                                                                                                     |
| Full Vitest corpus                                                | 778/778 (unchanged from SUN-1202; no test files modified this checkpoint)                                |
| service-runtime / edge-api / protocol-x402 / Profile 1            | all included above, unchanged, passing                                                                   |
| `pnpm test:worker-runtime`                                        | **27/27** (up from 17/17)                                                                                |
| x402 blocker mutation proof (`test-x402-blocker-caught.mts`)      | **re-run fresh this checkpoint: PASS** (mutant reproduced the exact blocker, restoration verified clean) |
| Historical AJV mutation proof (`test-old-verify-path-caught.mts`) | **re-run fresh this checkpoint: PASS** (mutant caught, restoration verified clean)                       |
| `pnpm schemas:check` / `pnpm pricing:check`                       | pass                                                                                                     |
| Contract baseline/compat/release                                  | pass, zero drift                                                                                         |
| Whole-repo typecheck                                              | 23/23                                                                                                    |
| Lint                                                              | 16/16                                                                                                    |
| Format                                                            | pass                                                                                                     |
| Secrets scan                                                      | pass, 0 leaks                                                                                            |
| Semgrep                                                           | 0 findings                                                                                               |
| OSV                                                               | 0 critical                                                                                               |
| Trivy                                                             | 0 blocking critical/high                                                                                 |
| Schemathesis                                                      | pass                                                                                                     |
| Chaos                                                             | 18/18                                                                                                    |
| Load                                                              | 7/7                                                                                                      |
| `pnpm check`                                                      | exit 0                                                                                                   |
| `pnpm security:release`                                           | exit 0                                                                                                   |
| Production bundle audit                                           | 0 bare eval, 1 unreachable `new Function(`, test entrypoint absent                                       |
| D1 migration rehearsal                                            | PASS                                                                                                     |
| Release-build dry run                                             | reproducible, no drift                                                                                   |

## Findings

**`R0_BLOCKERS`**:

1. **`WORKERD_SERVICE_COVERAGE` gap.** Only 5 of 12 real, live, priced route
   configurations have real-`workerd` proof of their settled (post-payment)
   path; only 5 of 12 have real-`workerd` proof of even their pre-economic path.
   The other 7 (v2 CDP for
   company_evidence_graph/web_context_verified/document_evidence_json, plus all
   4 v2 Nevermined routes) rely on Node/Miniflare-only evidence. Per this
   checkpoint's own explicit rule, this is a release blocker — none of these
   routes are dead/deprecated. **Not fixed this checkpoint**: extending
   real-`workerd` proof to the Nevermined rail specifically requires new
   test-seam work (a differently-shaped evidence provider) that was judged out
   of proportion to complete safely within this pass; extending it to v2 CDP for
   the other three services is smaller (identical pattern to Phase 3, just three
   more services under `/v2/*` instead of `/v1/*`) and is the more tractable
   next step.

**`R1_RELEASE_RISKS`** (explicitly recorded, not silently accepted):

1. `validateProductionBindings` (`env.ts`) is dead code requiring a nonexistent
   `ARTIFACTS` binding — gives a false impression of startup validation.
   Recommend either wiring it in (with `ARTIFACTS` removed from the required
   list) or removing it.
2. SEC EDGAR / other real external providers remain unwired behind the current
   fixture-backed executors — a pre-existing, known, deliberate scope limit (not
   new), but material to full release readiness for anyone expecting live data.
3. Timeout/cancellation/orphan-work architecture is unproven for the day a real
   external provider is wired in (currently moot, since none is).
4. No external log-aggregation/observability platform exists to verify
   `CORRELATION_ID_AVAILABLE`/etc. are actually _usable_ operationally, only
   that the underlying data exists.
5. Source-map upload policy not explicitly set (`upload_source_maps` unset in
   `wrangler.toml`) — default behavior not independently re-verified against a
   real upload.
6. OSV: 77 non-critical vulnerabilities with fixes available (accepted under the
   existing, documented critical-only blocking policy — this is a standing,
   not-new, item worth periodic dependency maintenance).
7. Queues (`JOBS`/`EVENTS`) are producer-only in this Worker with no consumer —
   messages accumulate; pre-existing, not evaluated for backlog risk this
   checkpoint.

**`R2_HARDENING`**: exhaustive fresh SSRF/resource-boundary/document-bomb
re-testing beyond existing coverage; real-`workerd` load rehearsal; explicit
`upload_source_maps` setting; Queue consumer/backlog policy.

**`R3_ENHANCEMENTS`**: none proposed — out of this checkpoint's scope by design.

**`NEWLY_DISCOVERED_RISKS`**: the pricing-drift monitoring gap (now closed) and
the dead `validateProductionBindings` function (R1, above) — both genuinely new
findings from this checkpoint's own inspection, not previously documented.

**`CONTRACT_AMBIGUITIES`**: none.

**`GENUINELY_DEFERRED`**: v2 Nevermined real-`workerd` proof; v2 CDP
real-`workerd` proof for the three non-`verify_agent_output` services; live
external-provider timeout/cancellation architecture (moot until one is wired
in).

## Final decision

**`RELEASE_CANDIDATE_READINESS = NOT_READY`**

Rationale: this checkpoint's own §4/definition-of-done explicitly treats
sub-100% real-`workerd` paid-service coverage as a release blocker unless the
uncovered routes are dead/deprecated — they are not. This is a genuine,
disclosed, currently-open gap, not a security or economic defect in what WAS
tested (everything tested — all 4 v1 services end-to-end under real workerd,
plus the extensive pre-existing Node-level suite for everything else — passed
cleanly, and no R0-severity security/payment/data defect was found anywhere in
this pass). The path to `READY` is narrow and concrete: extend Phase 3's exact
pattern to the three remaining v2 CDP services (small, tractable), and either
build or explicitly, consciously accept-as-R1 the Nevermined real-`workerd` gap
(larger, requires new test-seam design per this checkpoint's own "no universal
bypass" rule).

**Exact next action requiring human authorization**: none yet — the next
technical action is closing the R0 coverage gap (an engineering task, not a
mutating one), which does not itself require human authorization to attempt.
Only after `RELEASE_CANDIDATE_READINESS = READY_FOR_HUMAN_UPLOAD_AUTHORIZATION`
is reached would `wrangler versions upload` (per the runbook) become the next
action requiring explicit human authorization. **This checkpoint does not
authorize that action, and does not authorize SUN-1204.**
