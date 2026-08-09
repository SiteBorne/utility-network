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

- `company_evidence_graph.v1` implements 3 of 7 field groups for real
  (`identity`, `sec_submissions`/`recent_filings`, `website_evidence`); the
  other 4 are recognized-but-unavailable.
- `verified_absent` claim construction is implemented and unit-tested
  (`src/claims/builder.test.ts`) but not yet exercised end-to-end by any service
  — no field group in this increment performs a genuine bounded absence search
  (see ADR 0038).
- The fixture matrix covers 11 representative scenarios (identity resolution,
  field-group selection, direct/rendered web modes, prompt injection,
  native/table/malformed documents, standard/independent verification), not the
  full ~70-scenario enumeration in the source directive's per-service test
  gates.
- Cross-service, chaos, and property test suites are each a focused set (4, 3,
  and 3 respectively) proving the stated invariants concretely, not an
  exhaustive enumeration of every listed scenario.

## Validation performed

All from repo root unless noted:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` — pass (18/18 turbo
  packages, including the new `@siteborne/service-runtime`).
- `pnpm test` — 657 tests passed, 6 skipped (pre-existing live-gate opt-ins), 0
  failed, across 52 test files including all 12 new `packages/service-runtime`
  files.
- `pnpm services-runtime:check` — format/lint/typecheck/test/
  test:property/fixtures:verify, all pass (45 unit/integration tests + 3
  property tests + 1 real subprocess integration test + 11-scenario
  fixture-matrix regression gate).
- `pnpm verification:check` — unaffected by the SUN-0600 integration beyond the
  disclosed `policy_id` fix; 76/76 tests, 5/5 fixtures, 3/3 properties.
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
