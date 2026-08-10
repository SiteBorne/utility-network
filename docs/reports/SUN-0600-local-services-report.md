# SUN-0600 — Local Service Implementations: Acceptance Report

## Summary

Implements the four frozen v1 services as local, credential-independent
orchestration in a new `packages/service-runtime`, composing already-accepted
SUN-0300 (provider adapters), SUN-0400A (document worker), and SUN-0500
(verification mesh + receipts) rather than reimplementing any of them (see
[ADR 0037](../decisions/0037-service-runtime-composition-boundary.md)).

## Compatibility fix landed first

Integrating `verify_agent_output.v1` (and every other service, since all four
route through the same `verifyAndSign` step) was the first code to actually run
`runMesh()` and validate its resulting document against the real frozen output
schema via ajv — SUN-0500's own tests validated hand-built fixture documents
instead. This surfaced a genuine defect: `mesh.ts` wrote a `sha256:...`-shaped
policy _hash_ into the frozen `verification.policy` field, which is actually
typed as a `policy_id` (`^pol_[a-z0-9]{24}$`). Fixed as commit `ab0d3b4`
(`fix(verification): align verification.policy with the frozen policy_id shape`),
documented in
[ADR 0036](../decisions/0036-mesh-policy-id-vs-policy-hash-fix.md). The diff is
a one-field rename plus its call sites; verifier logic, mesh aggregation,
receipt canonicalization, and signature behavior are unchanged. All 76
pre-existing SUN-0500 tests, its 5-row fixture matrix, and its 3 property tests
pass unchanged after the fix. SUN-0500's ledger acceptance record is unchanged —
this is a follow-up fix, not a new acceptance.

## What was built

- **Shared runtime** (`src/types.ts`, `src/context.ts`, `src/registry.ts`,
  `src/dispatcher.ts`): closed `ServiceExecutionResult` union,
  `LocalService<TInput,TOutput>` interface, a `ServiceRegistry` that enforces
  unique IDs and `production_enabled: false` at registration, and a pure/local
  `executeLocalService` dispatcher that converts any escaping exception or
  budget timeout into a closed result and never creates a payment challenge,
  settles payment, invokes x402, dispatches a queue job, or exposes a public
  route.
- **Shared PCC layer** (`src/pcc/`): `buildDraftDocument` (the single place
  every service assembles a PCC document), `verifyAndSign` (runs SUN-0500's
  mesh, issues a receipt, assembles the final document, and re-validates it
  against the frozen schema — used identically by all four services),
  deterministic ID generation, and a documented candidate/receipt-shape bridge
  between this package's types and SUN-0500's (`candidate-conversion.ts`,
  `receipt-mapping.ts`).
- **`company_evidence_graph.v1`**: real `SecSubmissionsAdapter` calls for
  `sec_submissions`/`recent_filings`, real `PublicHttpAdapter` calls for
  `website_evidence`, deterministic identity resolution (exact CIK > domain >
  name, never fuzzy-merged, ticker never treated as globally unique).
  Unimplemented field groups (`xbrl_facts`, `regulatory_mentions`,
  `public_repository_signals`) are reported `unavailable` with a truthful
  limitation.
- **`web_context_verified.v1`**: real `PublicHttpAdapter` calls for
  `retrieval_mode: 'direct'`; `rendered` mode returns `dependency_unavailable`
  truthfully (Browser Rendering is blocked_external) — proven never to touch the
  network (`httpClient.callCount === 0`) in both the unit test and the fixture
  matrix.
- **`document_evidence_json.v1`**: composes SUN-0400A via a new
  `DocumentWorkerBridge` boundary. `SubprocessDocumentWorkerBridge` is the real,
  production-shaped implementation (spawns
  `python -m modal_worker.local_runner`) and is exercised end-to-end by one real
  integration test, auto-skipped when the document-worker's venv is absent.
  `FixtureDocumentWorkerBridge` replays `WorkerResult` JSON actually captured
  from real runs of that same CLI against SUN-0400A's own fixtures
  (`fixtures/document-worker-results/*.json`) — never a hand-authored fake
  result.
- **`verify_agent_output.v1`**: composes SUN-0500's `runMesh`/ `issueReceipt`
  directly for both `standard` and `independent_reproduction` modes. Separately
  evaluates the buyer's `verification_contract` (claims + deterministic
  requirements) against `candidate_output`, including a real ajv compile of the
  buyer-supplied `required_schema` (`schema_valid`) and a real SHA-256
  comparison (`hash_match`) — the other four deterministic checks
  (`signature_valid`/`evidence_resolves`/`no_pii`/`no_secrets`) are recognized
  but return a failed, `unverifiable_assertions`-flagged result rather than a
  silent pass.
- **Fixtures**: `fixtures/SERVICE_FIXTURE_MATRIX.yaml` (11 scenarios)
  cross-checked 1:1 against `scripts/verify-fixtures.ts`'s TS scenario list;
  reuses already-accepted SUN-0300 fixtures
  (`packages/provider-adapters/fixtures/**`) and real captured SUN-0400A
  `WorkerResult`s rather than duplicating fixture corpora.
- **Documentation**: 3 ADRs (0037–0039) plus ADR 0036's fix; 4 operations guides
  (`LOCAL_SERVICES.md`, `SERVICE_FIXTURES.md`, `SERVICE_PARTIAL_RESULTS.md`,
  `VERIFIED_ABSENCE.md`).
- **Root wiring**:
  `services-runtime:{test,test:property,fixtures:verify, benchmark,check}`
  scripts, folded into root `pnpm check`; CI step added.

## "Real SEC data" — what it actually means

Every company-evidence test injects a fake `InjectedHttpClient` that returns a
canned `Response` — no test in this package performs a real network request. The
fixture used
(`packages/provider-adapters/fixtures/sec-edgar/submissions-success.json`,
genuine Apple Inc. EDGAR response shape, CIK `0000320193`) is an
already-committed, already-accepted SUN-0300 fixture, not something fetched live
during this session. No provider's `terms_review_status` or live-activation
state was touched; `company_evidence_graph.v1` is accepted as
`local_fixture_verified`, not `live_provider_verified`.

## Scope reductions (disclosed, not silently claimed)

Given the scale of the full four-service directive, this increment implements a
representative, real, but narrower slice than every scenario enumerated in the
source directive:

- `company_evidence_graph.v1` implements 4 of 7 field groups for real
  (`identity`, `sec_submissions`/`recent_filings`, `website_evidence`,
  `regulatory_mentions` — see the closure pass below); the other 3
  (`xbrl_facts`, `public_repository_signals`, and the two not listed) are
  recognized-but-unavailable.
- Cross-service, chaos, and property test suites are each a focused set (4, 3,
  and 3 respectively) proving the stated invariants concretely, not an
  exhaustive enumeration of every listed scenario.
- Not covered even after both closure passes: ticker-only/domain-only identity
  fixtures beyond the CIK-exact path, `xbrl_facts`/GitHub signal field groups,
  document-service table/page hash tampering and byte/page-limit fixtures, and
  agent-verification signer-failure/receipt-tamper at the service level
  (SUN-0500 already covers signer/receipt tamper directly — 15 tests in
  `packages/verification/src/tests/receipt.test.ts`; this package's own
  cryptographic-verification and tamper coverage, added in the second closure
  pass below, covers `company_evidence_graph.v1` specifically, not yet the other
  three services).

## Closure pass: verified-absence end-to-end + fixture-matrix audit

A first acceptance pass left two gaps disclosed above the original
scope-reduction list: (1) verified-absence was tested only at the shared
claim-builder level, not through an actual service, and (2) the fixture matrix
(11 rows) could not represent the required per-service and cross-service
acceptance surface. Both are closed here:

1. **`regulatory_mentions` field group implemented for real**
   (`company-evidence/service.ts`), composing SUN-0300's
   `FederalRegisterAdapter` in `search` mode with an explicit, bounded,
   deterministic date window (730 days trailing the injected clock). A genuine
   zero-match search now produces a `verified_absences` entry via
   `buildVerifiedAbsentClaim` — the entry's `claim` text is scoped to exactly
   what was searched (term + window), never a broad proposition like "no
   regulatory issues" that a finite search cannot support. A non-empty search
   instead produces `regulatory_references` entries and an ordinary claim; a
   source failure (`not_found`, `retryable_failure`, `policy_blocked`,
   `source_changed`) never produces an absence claim — proven by 4 dedicated
   tests using a stub adapter to reach each result class deterministically.
2. **`packages/service-runtime/src/services/company-evidence/verified-absence.test.ts`**
   (7 new tests) exercises the full pipeline — service input → real adapter
   observation → PCC builder → SUN-0500 mesh → signed receipt → frozen-schema
   validation — for the bounded-absence case, the positive-result case, the
   no-dependency-wired case, and all four disqualifying result classes.
3. **Two real gaps this surfaced and fixed**:
   - `verify-and-sign.ts` never threaded a service's declared
     `freshness_seconds` into the mesh's `freshness_requirement_ms` (freshness
     scoring silently defaulted to 24h regardless of what a service's contract
     declared). Fixed as a one-line addition.
   - `recent_filings` was listed in `company-evidence`'s `DEFAULT_FIELD_GROUPS`
     and had real handling code (bundled with `sec_submissions`), but was
     missing from `IMPLEMENTED_FIELD_GROUPS` — the top-level dispatch gate
     checked that list first, so every default-mode request silently routed
     `recent_filings` into the "not implemented" branch and never reached its
     own working code. Fixed by adding it to `IMPLEMENTED_FIELD_GROUPS`;
     confirmed via manual verification that a default-groups request now
     populates `recent_filings` correctly. All existing tests still pass after
     both fixes.
4. **Fixture matrix expanded from 11 to 48 rows**, cataloging effectively every
   distinct scenario across all `packages/service-runtime` test files (company,
   web, document, agent, registry/dispatcher, cross-service, chaos, property),
   not only the ones re-executed by `scripts/verify-fixtures.ts`. Each row
   carries `test_reference` (verified to exist by the script) and
   `executed_by_script` (13 rows re-executed by the script itself as a
   regression gate; the remainder covered by their referenced vitest file, which
   `pnpm services-runtime:test` runs on every check). This is a coverage
   correction, not an arbitrary count target.

## Second closure pass: stale-vs-absence end-to-end + cryptographic receipt verification

A second review found two further gaps in the first closure pass's own evidence:
(1) "stale source != verified absence" was disclosed as untested above, with a
stated architectural reason; and (2) every "receipt verified" assertion in the
new tests only pattern-matched `receipt_id` against `/^rcpt_[a-f0-9]{24}$/`,
never calling SUN-0500's actual `verifyReceipt()` against a real `KeyRegistry`.
Both are closed here.

1. **The architectural reason for "no seam to inject staleness" turned out to be
   surmountable.** `FederalRegisterAdapter` stamps evidence `retrieved_at` from
   a real `new Date()` call (not the injected `ServiceExecutionContext` clock —
   a pre-existing SUN-0300 characteristic). Rather than needing to advance a
   clock _between_ the adapter call and the mesh run within one synchronous
   `execute()`, `freshness.test.ts` injects an **offset clock**: `nowMs()`
   always returns real wall-clock time plus a fixed, test-chosen offset. Since
   the adapter's `retrieved_at` is anchored to real time and the mesh's
   `nowMs()` is real time plus the offset, the age delta the
   `freshness_verifier` computes is deterministic and fully test-controlled — no
   sleeping, no system-clock mutation, no post-hoc editing of a "stale" flag;
   the service and mesh derive staleness themselves from ordinary real
   timestamps.
2. **`company-evidence/freshness.test.ts`** (6 tests) proves, through the real
   service pipeline: stale evidence is scored stale by the mesh
   (`result.verification.freshness < 1`) yet the result stays `success` with a
   valid, cryptographically-verified receipt and no `verified_absences` entry
   (freshness is a reported score, never itself a blocking gate, per the mesh's
   existing non-voting design); a fresh/stale threshold regression (same
   observation, `freshness_seconds` large → score `1`, small → score `0`);
   deterministic repeatability; and the `recent_filings` regression (requested →
   SEC dependency runs and populates a contract-valid result; not requested →
   zero dependency calls).
3. **Real cryptographic receipt verification** added to the highest-value
   existing scenarios (identity+SEC success, bounded absence, positive
   regulatory result, stale-evidence result) via `@siteborne/verification`'s
   actual `verifyReceipt(receipt, registry, expectedContext)` against the same
   `KeyRegistry` the fixture signer registered with — not a
   service-runtime-local reimplementation of Ed25519 verification. A new tamper
   test mutates a signed receipt's `decision` field and proves verification then
   fails. `verifyAndSign`'s result type and `ServiceExecutionResult` both gained
   a `receipt` field (the full `VerificationReceipt`, not just its ID) and a
   `verification` summary (mesh decision/scores) to make this possible — a
   small, shared API addition used identically by all four services, not a
   one-off.
4. **`scripts/verify-fixtures.ts`** gained its own live cryptographic
   verification step: rows marked `receipt_crypto_verified: true` (5 of the
   matrix's 55 rows; 4 of them also `executed_by_script: true`) are verified
   against a real `KeyRegistry` as part of the script's own regression gate, not
   just inside vitest.
5. **Fixture matrix grew from 48 to 55 rows** (7 new: the stale scenario, its
   deterministic-repeat variant, the fresh/stale threshold pair, the two
   `recent_filings` regression scenarios, and the receipt-tamper scenario);
   `executed_by_script: true` rows grew from 13 to 14.
6. Terminology correction: no fixture-matrix or script wording calls in-process
   test execution "live" — `executed_by_script` / `fixture_replayed` are used
   throughout; no provider live-activation status was touched by any of this.

## Third closure pass: real `verifyReceipt()` coverage across all four services + shared boundary

A third review found the second closure pass had only proven real cryptographic
receipt verification for `company_evidence_graph.v1`; the other three services
still only pattern-matched `receipt_id` (or, for `verify_agent_output.v1`'s
`independent_reproduction` success path, checked nothing about the receipt at
all). Closed here, using one shared boundary rather than four separate
reimplementations:

1. **`verifyServiceReceipt()`** (`src/pcc/receipt-verification.ts`) is the one
   shared boundary every caller uses to cryptographically verify a service
   receipt; it delegates entirely to `@siteborne/verification`'s own
   `verifyReceipt()` against a real `KeyRegistry` — no second Ed25519
   implementation. Its own closed-failure-mode suite
   (`src/pcc/receipt-verification.test.ts`, 9 tests) proves every one of invalid
   signature, altered signed payload field, output-hash mismatch, wrong expected
   `service_id`, wrong expected `contract_release`, unknown signing key, revoked
   key, and a malformed (empty-signature) receipt fails closed —
   `resolves.toMatchObject({ valid: false })` in every case, so no cryptographic
   exception ever escapes as an ordinary caller error.
2. **Per-service coverage** — `web-context/service.test.ts`,
   `document-evidence/service.test.ts`, and `agent-verification/service.test.ts`
   each gained a real `verifyServiceReceipt()` assertion on their successful
   path, plus a dedicated tamper test (mutating the receipt's bound `decision`
   or `output_hash` field and proving verification then fails).
   `verify_agent_output.v1` gained this for **both** `standard` and
   `independent_reproduction` modes separately — the reproduction-mode success
   path is not silently downgraded to the standard-mode check.
3. **`src/tests/receipt-verification.test.ts`** establishes the invariant once
   for the entire registry rather than once per service: a parameterized
   (`it.each`) pair of tests drives all four registry services through the real
   `executeLocalService(...)` dispatcher, proving (a) a deterministic successful
   fixture's receipt cryptographically verifies, and (b) a receipt tampered with
   after a successful dispatch can never be reported as valid — success is never
   based on `receipt_id` pattern or signature presence alone. Building this test
   surfaced and fixed two real scenario bugs (not production defects): the
   `company_evidence_graph.v1` scenario requested a field group that could only
   reach `partial` without a CIK, and the `document_evidence_json.v1` scenario
   constructed two separate `ServiceExecutionContext` instances with different
   `artifact_store`s so the dispatcher never found the artifact. Both were fixed
   in the test's own scenario setup; no service or dispatcher code changed.
4. **`ALL_SERVICE_IDS`** (`src/types.ts`) is now the single canonical inventory
   of implemented service IDs. `scripts/verify-fixtures.ts` reads it in place of
   a hand-maintained `KNOWN_SERVICE_IDS` set, and now additionally asserts every
   ID in `ALL_SERVICE_IDS` has at least one matrix row with both
   `executed_by_script: true` and `receipt_crypto_verified: true` — if a fifth
   service is ever registered without a cryptographically verified success
   fixture, this check fails automatically rather than relying on someone
   remembering to add coverage.
5. **Fixture matrix grew from 55 to 77 rows** (22 new rows document the new
   per-service tamper tests, the parameterized cross-service dispatcher test's 8
   scenarios, and the shared boundary's 9 closed-failure-mode scenarios; no
   pre-existing row was altered or removed). Reconciled count, matrix and script
   as source of truth: **77 total matrix rows; 22 rows carry
   `receipt_crypto_verified: true`, covering all 4 implemented services; 7 of
   those 22 are also `executed_by_script: true`** (one script-verified crypto
   fixture per service, satisfying the coverage gate above).
6. Terminology: no fixture-matrix row or script wording calls fixture-replayed
   or in-process execution "live"; `executed_by_script` / `fixture_replayed` are
   used throughout for locally-executed, no-network scenarios, and "live" is
   reserved for wording that describes a real external network request (none of
   which changed here). No provider live-activation status was touched by any of
   this pass.
7. `packages/service-runtime` test suite grew from 59 to 80 tests (14 test
   files, all passing): +9 shared-boundary failure-mode tests, +8 cross-service
   dispatcher tests, +4 per-service crypto/tamper tests distributed across
   web-context (+1), document-evidence (+1), and agent-verification (+2,
   standard and independent_reproduction).

## Fourth closure pass: runtime receipt-verification boundary (not merely a test postcondition)

A fourth review found a genuine architectural gap the third closure pass's own
report undersold: `5525f31` proved that a **test** could call
`verifyServiceReceipt()` on a receipt a service had already returned — it did
not prove the **runtime execution boundary** itself (`executeLocalService(...)`
-> `service.execute(...)` -> `verifyAndSign(...)`) ever refused to report
`success` for a receipt that fails cryptographic verification. Every service
computed `result_class` purely from `signed.verdict.decision`, which was set
from the mesh's verdict alone — the receipt's own cryptographic validity was
never itself a precondition for `success`. `5525f31` added
`src/pcc/receipt-verification.ts` (the shared `verifyServiceReceipt()` boundary)
alongside its tests/fixtures/scripts/docs, so it is more accurately described as
**receipt-verification coverage and shared verification helper** than as purely
test/fixture/script/doc-only — the helper it added was correct and is reused
unchanged by this pass, but it was not itself wired into the runtime success
path until now. This pass is the one that changes service-runtime implementation
code to actually call that helper before reporting success. See
[ADR 0040](../decisions/0040-runtime-receipt-verification-boundary.md) for the
full design.

1. **`verifyAndSign()`** (`src/pcc/verify-and-sign.ts`) — the one shared
   finalization step every service already called identically — now
   self-verifies the receipt it just issued immediately after `issueReceipt()`,
   using the same `verifyServiceReceipt()` boundary every test already used. On
   failure, `verdict.decision` is forced to `'fail'` before it is returned;
   since every service derives `result_class` from that decision, **no
   service-specific success/failure logic had to change** — enforcement is
   concentrated entirely in the one shared step.
2. `VerifyAndSignParams` gained a required `keyRegistry: KeyRegistry`; all four
   services' `Deps` interfaces gained a matching field, threaded identically to
   how `signer` already was; `wiring.ts::buildFixtureRegistry` threads one
   shared `keyRegistry` to all four services.
3. **Runtime failure-injection tests**
   (`src/tests/receipt-verification.test.ts`, +8 tests, parameterized across all
   4 registry services): a signer whose key doesn't match its declared
   `KeyRegistry` entry, and a `KeyRegistry` that doesn't contain the signing key
   at all, both force `executeLocalService(...)` to return
   `result_class: 'internal_verification_failed'` — proven through the real
   dispatcher path, not a post-hoc assertion on an already-returned receipt. A
   genuine runtime _context_ mismatch (wrong `service_id`/`contract_release`
   reaching the self-check) cannot be manufactured through normal execution,
   since the self-check's expected values are derived from the same candidate
   that was just signed; that failure mode is proven at
   `verifyServiceReceipt()`'s own unit level instead (already covered in
   `src/pcc/receipt-verification.test.ts`).
4. This boundary is reached both by `executeLocalService(...)` and by calling
   any service's `execute()` directly — the self-check lives inside
   `verifyAndSign`, which every service's `execute()` calls itself, not merely
   inside the dispatcher wrapper. `executeLocalService(...)` remains the only
   _supported_ service execution entry point; no service exposes an independent
   success path that bypasses it.
5. **Fixture matrix grew from 77 to 85 rows** (8 new rows document the runtime
   failure-injection scenarios, 2 defect types × 4 services; no pre-existing row
   was altered or removed). Matrix and script as source of truth: **85 total
   matrix rows; 22 rows carry `receipt_crypto_verified: true`, covering all 4
   implemented services; 7 of those 22 are also `executed_by_script: true`**
   (unchanged from the third closure pass — the 8 new rows are runtime rejection
   scenarios, not additional successful crypto-verified fixtures).
6. `packages/service-runtime` test suite grew from 80 to 88 tests (14 test
   files, all passing).

## Validation performed

All from repo root unless noted:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` — pass (18/18 turbo
  packages, including `@siteborne/service-runtime`).
- `pnpm test` — 700 tests passed, 6 skipped (pre-existing live-gate opt-ins), 0
  failed, across 56 test files including all 14 `packages/service-runtime`
  files.
- `pnpm services-runtime:check` — format/lint/typecheck/test/
  test:property/fixtures:verify, all pass (88 unit/integration tests + 3
  property tests + 1 real subprocess integration test + 14-scenario
  executed_by_script fixture regression gate — including one cryptographically
  verified success fixture per service — against an 85-row documented matrix).
- `pnpm verification:check` — unaffected by this pass; 76/76 tests, 5/5
  fixtures, 3/3 properties.
- `pnpm pcc:generate:check`, `services:generate:check`, `openapi:generate:check`
  — no drift.
- `pnpm contracts:baseline:verify`, `contracts:compat:check`,
  `contracts:release:verify`, `migrations:verify`, `d1:test`,
  `control-plane:check`, `adapters:check`, `document-worker:check` — all pass
  (pre-existing, unaffected; re-run as part of full `pnpm check`).
- `pnpm governance:validate` (77/77), `pnpm state:validate` (28/28),
  `pnpm tasks:validate` (221/221) — all pass.
- `pnpm secrets:scan` (gitleaks) — no leaks found (~644 MB scanned).
- Full `pnpm check` (root, all of the above end to end) — **passes**.
- `pnpm services-runtime:benchmark` — run separately; local-fixture timings only
  (p50 ~1–4ms per service), never claimed as production latency.

## Per-service final status

| Service                     | Implementation                                                                                                                                                   | Notes                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `company_evidence_graph.v1` | `local_fixture_verified`                                                                                                                                         | `production_enabled: false` |
| `web_context_verified.v1`   | `local_fixture_verified` (direct: `local_fixture_verified`; rendered: `blocked_external`/not implemented)                                                        | `production_enabled: false` |
| `document_evidence_json.v1` | `local_fixture_verified`                                                                                                                                         | `production_enabled: false` |
| `verify_agent_output.v1`    | `local_fixture_verified` (standard: `local_fixture_verified`; independent_reproduction: `local_fixture_verified`; live independent reproduction: `not_verified`) | `production_enabled: false` |

## Status

Accepted. `TASKS.yaml` SUN-0600 status updated to `accepted` with this commit's
ref; `PROJECT_STATE.yaml` `last_completed_increment` advanced to `SUN-0600`.
`SUN-0400B` remains `blocked_external`. `production_ready` and
`production_enabled` remain `false` throughout.
