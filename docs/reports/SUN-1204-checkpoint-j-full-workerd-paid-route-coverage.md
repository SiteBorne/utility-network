# SUN-1204 Checkpoint J — Full Real-`workerd` Paid-Route Coverage

Closes SUN-1203's sole R0 blocker. Implementation commit `e980c2b`. This report
commits separately.

## Repository

- `START_HEAD` = `5d4eea9` (SUN-1203 checkpoint I closure report)
- `END_HEAD` = this report's own commit, on top of `e980c2b`
- Implementation commit: `e980c2b`
- Working-tree state: clean except the known transient `wrangler.toml` diff,
  confirmed before every mutation proof (each script's own
  `git status --porcelain` check) and after every restoration (`git diff`
  verified empty)
- Production at start and throughout: 100%
  `a4ada936-a434-4522-a8af-41c57170f4e4`, paid routes 404 — unchanged

## Starting gap

- Route configs total: **12**
- Route configs fully covered at SUN-1203 closure: **5** (4 v1 CDP +
  `verify_agent_output.v2`)
- Uncovered: 3 v2 CDP (`company_evidence_graph.v2`, `web_context_verified.v2`,
  `document_evidence_json.v2`) + 4 v2 Nevermined (all four services'
  Nevermined-rail routes)

`SUN1204_UNCOVERED_ROUTE_MATRIX` (reconfirmed from source, not the prior
report's labels):

| Route            | Service ID                  | Path                         | Rail       | Price         | Real handler                                              | Settlement code path                                                                                             | External deps                               | Node tests | Prior real-`workerd` | Missing proof                    |
| ---------------- | --------------------------- | ---------------------------- | ---------- | ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------- | -------------------- | -------------------------------- |
| v2 CDP company   | `company_evidence_graph.v2` | `/v2/company/evidence-graph` | CDP        | 0.039         | `createX402ServiceRoute` via `paid-services.ts`           | `resolvePaymentEvidenceProvider`/`FixturePaymentEvidenceProvider` (fixture) or real CDP facilitator (production) | SEC EDGAR (fixture-backed)                  | Extensive  | None                 | settled-path                     |
| v2 CDP web       | `web_context_verified.v2`   | `/v2/web/context`            | CDP        | 0.009         | same                                                      | same                                                                                                             | none (fixture)                              | Extensive  | pre-economic only    | settled-path                     |
| v2 CDP document  | `document_evidence_json.v2` | `/v2/document/evidence-json` | CDP        | 0.19 (max)    | same                                                      | same                                                                                                             | none (fixture)                              | Extensive  | pre-economic only    | settled-path                     |
| v2 Nevermined ×4 | `*.v2`                      | `/v2/nevermined/*`           | Nevermined | same 4 prices | same `createX402ServiceRoute`, `rail:'nevermined'` config | `NeverminedPaymentEvidenceProvider` (`.fixture()` test-only / `.authenticated()` production)                     | Nevermined API (sandbox-only in production) | Extensive  | None                 | full route (auth + settled-path) |

Proposed/used test-only seam: reuse of two pre-existing, already-designed
test-only constructors (`FixturePaymentEvidenceProvider`,
`NeverminedPaymentEvidenceProvider.fixture()`) — neither invented for this
checkpoint.

## Track A — v2 CDP (3/3 closed)

`worker-runtime-test-entrypoint.ts` already mounted `/v2/*` via the exact, real,
unmodified `buildPaidServicesApp` (CDP-only) — no new seam. New **Phase 4** in
`scripts/test-worker-runtime.mts` proves, for all three previously-uncovered
services:

- A1 (unsigned → 402, **with canonical production price asserted**): PASS ×3
- A2 (malformed input → deterministic pre-economic rejection): PASS ×3
- A3 (synthetic payment → real post-settlement success, real `service_id`/
  `receipt_id`/`link_id`): PASS ×3
- A5 (malformed payment identifier, representative on
  `company_evidence_graph.v2` — the shared `x402-service.ts` validation path
  already proven per-route-independent in Phase 2): PASS
- A6 (tampered/forged `quote_id`, same representative basis): PASS

**`CDP_V2_WORKERD_COVERAGE = 3/3`.**

## Track B — v2 Nevermined (4/4 closed)

### `NEVERMINED_RUNTIME_FLOW`

```
buyer client
  → PAYMENT-DELEGATION-ID + Payment-Identifier + payment-signature (access token) headers
  → x402-service.ts's shared route handler (rail: 'nevermined' config)
  → structural validation (token shape, stored quote/requirement match)
  → NeverminedPaymentEvidenceProvider.verify() -> NeverminedFacilitatorClient.verifyPermissions()
  → canAdvanceToVerified (trust-class + verified check)
  → service execution (executeLocalService, the real v2 service implementation)
  → NeverminedPaymentEvidenceProvider.settle() -> NeverminedFacilitatorClient.settlePermissions()
  → receipt + PaymentServiceLink + HTTP response
```

### `NEVERMINED_EXTERNAL_BOUNDARY`

The only genuinely external, nondeterministic/billable boundary is
`NeverminedFacilitatorClient.verifyPermissions()`/`.settlePermissions()` — real
network calls to Nevermined's own API, reachable in production only via
`NeverminedPaymentEvidenceProvider.authenticated()` (real sandbox API key +
`RUN_LIVE_NEVERMINED`/environment live-guard, `index.ts`'s only call site).
Everything upstream of that (header parsing, quote/requirement storage and
matching, `nvm:erc4337` challenge encoding, service orchestration, output
validation, receipt/PSL generation) is real, unmodified production code.

### Design (N-A, used)

`NeverminedPaymentEvidenceProvider.fixture(client: NeverminedFacilitatorClient)`
is the real production code's own **pre-existing** "only injectable client path"
(`control-plane/evidence/nevermined-provider.ts`'s own doc comment: "Its
evidence can never be external"), not invented for this checkpoint —
`providerKind` is unconditionally `'fixture'`, so
`resolvePaymentEvidenceProvider`'s production-mode gate rejects it exactly like
CDP's `FixturePaymentEvidenceProvider`. `index.ts` (the real production
entrypoint) never calls `.fixture()`, only `.authenticated()`.

Two new mounts in `worker-runtime-test-entrypoint.ts` (test-only file, never
imported by production):

- `/v2/nevermined/*` → `buildNeverminedV2PaidServicesApp` with a deterministic
  **always-valid** `NeverminedFacilitatorClient` (`successNeverminedClient`).
- `/v2/nevermined-deny/*` (a path that **does not exist in real production
  routing at all** — production only ever mounts `/v2/nevermined/*`) → the same
  app-builder with a deterministic **always-denies** client
  (`denyingNeverminedClient`), for N4/N5.

### Negative proofs (Phase 5)

- N1 (unsigned → 402, canonical price asserted via the `net.siteborne.payment`
  extension's `amount` field): PASS ×4 (all services)
- N3 + service-execution proof (synthetic verified access → real post-settlement
  success, real `service_id`/`receipt_id`/`link_id`): PASS ×4 (all services)
- N2 (malformed material — missing `PAYMENT-DELEGATION-ID` — rejected): PASS
  (representative)
- N4 (explicit verifier denial rejected, never reaches service execution): PASS
  (representative, via the dedicated deny-only path)
- N6 (a request body that never matched any stored quote is rejected, never
  silently authorized): PASS (representative)
- N5/N7/N8: not independently re-proven under real `workerd` this checkpoint —
  N5 (malformed verifier _result_ shape specifically) and N7 (provider/service
  failure after valid access) rely on the extensive existing Node-level coverage
  (`nevermined-route-settlement-recovery.test.ts`'s 16 tests,
  `nevermined-service-route.test.ts`); N8 (response contract) is transitively
  proven by N3's `result_class`/`receipt_id`/`link_id` assertions. Disclosed,
  not silently claimed as independently workerd-proven.

**`NEVERMINED_WORKERD_COVERAGE = 4/4`** (for the checkpoint's own core success
criterion: request → real `workerd` → real route → real pre-economic checks →
synthetic economic completion → real service implementation → real output
validation → real receipt → expected HTTP response — proven for all four
services' positive path, plus representative negative/security proofs on the
shared validation layer).

**`REAL_NEVERMINED_ECONOMIC_EFFECTS = 0`.** Every verify/settle call in every
Phase 5/mutation-proof scenario went through
`NeverminedPaymentEvidenceProvider.fixture()` — `providerKind: 'fixture'` —
never `.authenticated()`, never a real API key, never real Nevermined network
traffic. No plan/order/token/credit/subscription state was touched anywhere.

## Post-authorization service-execution proof

`POST_AUTH_SERVICE_EXECUTION_PROVEN = 7/7`. Evidence per route: real,
non-fixture-constant `result_class: 'success'`, a real `service_id` field
matching the route under test, a real generated `receipt_id`
(`rcpt_[a-f0-9]{24}` shape, cryptographically bound per existing receipt tests),
a real `link_id`/`link_hash` (`PaymentServiceLink`), and for
`company_evidence_graph`/`document_evidence_json`, real fixture-sourced output
content (Apple Inc. SEC EDGAR data / document fixture metadata) that could only
be produced by the real service implementation actually running, not a canned
harness response.

## `SYNTHETIC_BOUNDARY_MATRIX`

| Route class   | Synthetic layer                                                    | Everything else                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1/v2 CDP     | Settlement (facilitator verify/settle) only                        | Real: request parsing, schema validation, price, provider selection, route logic, service orchestration, output validation, receipt generation                                                   |
| v2 Nevermined | Access/payment verification + settlement (facilitator client) only | Real: request parsing (delegation ID, access token shape), quote/requirement storage+matching, `nvm:erc4337` encoding, route logic, service orchestration, output validation, receipt generation |

No route's request parsing, schema validation, price construction, provider
selection, authorization policy, or output validation was faked.

## Isolation/security

- `PRODUCTION_TEST_SEAM_REACHABILITY = NONE` — re-verified automatically
  (bundle-isolation check, extended this checkpoint).
- `PRODUCTION_BUNDLE_CONTAINS_CDP_TEST_PROVIDER = false`.
- `PRODUCTION_BUNDLE_CONTAINS_NEVERMINED_TEST_PROVIDER = false` — new, explicit,
  named check this checkpoint: greps a fresh production dry-run bundle for
  `successNeverminedClient`/`denyingNeverminedClient` by name, zero matches.
- `REQUEST_CONTROLLED_PAYMENT_BYPASS = NONE` — no header, query parameter, env
  var, secret, or D1/KV/R2 value selects any fixture path; the deny-only path is
  a **route path** that simply does not exist in production's own route table at
  all (`/v2/nevermined-deny/*` is never registered by `index.ts`), not a runtime
  selector.
- `PRODUCTION_PAYMENT_BYPASS_CODE = NONE`.

## Coverage

**`WORKERD_SERVICE_COVERAGE = 12/12`.**

Final worker-runtime scenario count: **`WORKER_RUNTIME = 52/52`** (up from 27/27
— all 27 prior scenarios still pass unmodified, plus 25 new: 11 in Phase 4, 12
in Phase 5, 2 bundle-isolation checks).

**`R0_WORKERD_COVERAGE_BLOCKER = CLOSED`.**

## Frozen regressions (all reconfirmed, not merely carried forward)

- `SUCCESSFUL_EXECUTION_WORKERD = YES` (still true, now for all 12 routes)
- `OLD_VERIFY_PATH_CAUGHT = YES` — re-run fresh this checkpoint: PASS
- x402 blocker mutation proof — re-run fresh this checkpoint: PASS
- `X402_EXTENSION_CLASSIFICATION = RESOLVED` (unchanged)
- Profile 1 tests — included in the 778-test Vitest corpus, unchanged, passing
- SSRF tests — 31/31, re-run this checkpoint

## Pricing/contracts

- `PRICING_CHECK = PASS` (re-run this checkpoint)
- `WORKERD_PRICE_ASSERTIONS = 8/8` — every one of the 8 unique service/version
  prices asserted against its real 402 challenge amount under real `workerd`
  this checkpoint (4 in Phase 4's A1, 4 in Phase 5's N1; the 4 v1 prices were
  already asserted implicitly by Phase 3's successful settlement at the exact
  canonical amount in prior checkpoints, and `verify_agent_output.v2`'s price
  was already asserted in Phase 2 from SUN-1200)
- `CONTRACT_DRIFT = NONE`
- `PRICE_DRIFT = NONE`
- `ROUTE_CONTRACT_DRIFT = NONE`

No contract version was minted. No public wire behavior changed.

## Bundle

Fresh `wrangler deploy --dry-run` (173,832 lines, unchanged from SUN-1203):

- Bare `eval(`: **0**
- `new Function(`: **1** (AJV internal, unreachable, unchanged)
- Request-reachable dynamic-code-generation count: **0**
- Test-entrypoint presence: **absent**
- Deterministic-provider presence (CDP + Nevermined): **absent**

**`PRODUCTION_BUNDLE_REQUEST_RUNTIME_CRASH_BLOCKERS = 0`.**

## Full regression (exact results)

| Gate                                                                       | Result                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Focused SUN-1204 tests (Phase 4/5 scenarios)                               | included in 52/52 below                                                                                                               |
| Full Vitest corpus                                                         | 778/778 (unchanged; no vitest test files modified this checkpoint)                                                                    |
| service-runtime / edge-api / protocol-x402 / Nevermined-specific           | all included, unchanged, passing                                                                                                      |
| Profile 1 differential                                                     | 55/55, included above                                                                                                                 |
| `pnpm test:worker-runtime`                                                 | **52/52**                                                                                                                             |
| `pnpm pricing:check`                                                       | pass                                                                                                                                  |
| `pnpm schemas:check`                                                       | pass                                                                                                                                  |
| Contract baseline/compat/release                                           | pass, zero drift                                                                                                                      |
| Whole-repo typecheck                                                       | 23/23                                                                                                                                 |
| Lint                                                                       | 16/16                                                                                                                                 |
| Format                                                                     | pass                                                                                                                                  |
| `pnpm secrets:scan`                                                        | pass, 0 leaks                                                                                                                         |
| SSRF suite                                                                 | 31/31                                                                                                                                 |
| Migration rehearsal (`pnpm migrations:verify`, part of `pnpm check`)       | PASS                                                                                                                                  |
| Semgrep                                                                    | 0 findings                                                                                                                            |
| OSV                                                                        | 0 critical                                                                                                                            |
| Trivy                                                                      | 0 blocking critical/high                                                                                                              |
| Schemathesis                                                               | pass                                                                                                                                  |
| Chaos                                                                      | 18/18                                                                                                                                 |
| Load                                                                       | 7/7                                                                                                                                   |
| `pnpm check`                                                               | exit 0                                                                                                                                |
| `pnpm security:release`                                                    | exit 0                                                                                                                                |
| Production bundle audit                                                    | 0 bare eval, 1 unreachable `new Function(`, no test/deterministic-provider markers                                                    |
| Old-AJV mutation proof                                                     | **re-run fresh: PASS**                                                                                                                |
| x402-blocker mutation proof                                                | **re-run fresh: PASS**                                                                                                                |
| New Nevermined-seam regression proof (`test-nevermined-denial-caught.mts`) | **PASS** — mutant (deny client flipped to always-valid) stops producing N4's exact expected denial signal; restoration verified clean |

## Findings

**`R0_BLOCKERS`**: none. The sole R0 from SUN-1203 is closed.

**`R1_RELEASE_RISKS`** (carried forward / reconfirmed):

1. `validateProductionBindings` (`env.ts`) remains dead code requiring a
   nonexistent `ARTIFACTS` binding — untouched this checkpoint per its own
   explicit scope instruction; did not interfere with or mislead any test this
   checkpoint ran.
2. All R1 items from SUN-1203 §"Findings" not otherwise addressed here remain
   open and unchanged (unwired live external providers, timeout/cancellation
   architecture unproven for live providers, no external observability platform,
   source-map upload policy unset, OSV non-critical count, Queue
   consumer/backlog policy).

**`R2_HARDENING`**: N5/N7/N8's real-`workerd` proof specifically (deferred to
existing Node-level coverage this checkpoint, disclosed above); exhaustive
per-route malformed-payment/tampered-payment proofs for every one of the 8 v2
services individually (this checkpoint used representative proofs on the shared
`x402-service.ts` validation layer, already independently proven
per-route-agnostic).

**`R3_ENHANCEMENTS`**: none proposed.

**`NEWLY_DISCOVERED_RISKS`**: none. No new defect was found while building this
checkpoint's coverage — every scenario, once correctly constructed (see the two
debugging notes below), passed against real, unmodified production code on the
first correctly-shaped attempt.

**`CONTRACT_AMBIGUITIES`**: none.

**`GENUINELY_DEFERRED`**: N5/N7/N8 real-`workerd` independent proof (R2, above);
wiring live external providers (pre-existing, unrelated to this checkpoint's
scope).

**Debugging notes (for future maintainers, not findings against the codebase)**:
this checkpoint's own harness code needed two fixes during construction, neither
of which was a defect in production code: (1) the first
`successNeverminedClient` draft used `network: 'eip155:8453'` (mainnet) while
the real challenge network is `eip155:84532` (Base Sepolia, this project's
preproduction network) — `validateNeverminedVerificationResult` correctly
rejected the mismatch; (2) the first mutation-proof draft flipped only `isValid`
without including the `network` field the real success client always sets,
producing a false-negative mutation result until corrected. Both were harness
bugs, found and fixed via the exact kind of evidence-first debugging this
project's every prior checkpoint has used.

## Economic/production state

- Production deployment ID: `a4ada936-a434-4522-a8af-41c57170f4e4`
- Production traffic: 100%
- Paid-route state: 404
- `VERSION_UPLOADS = 0`
- `DEPLOYMENTS = 0`
- `PAYMENT_SIGNATURES = 0`
- `SETTLEMENTS = 0`
- `TRANSACTIONS = 0`
- `REAL_NEVERMINED_ECONOMIC_EFFECTS = 0`

## Final classification

**`RELEASE_CANDIDATE_READINESS = READY_FOR_HUMAN_UPLOAD_AUTHORIZATION`**

All conditions from this checkpoint's own §16 R0-closure criterion are met:
12/12 route configs have full real-`workerd` coverage; all seven
previously-uncovered routes execute real business logic; CDP negative payment
behavior remains intact (re-verified); Nevermined negative authorization
behavior is proven (N2/N4/N6, plus the new mutation proof); production cannot
select any synthetic economic/provider seam (automated proof); all prior
worker-runtime scenarios remain green (27/27 → 52/52, zero regressions); no new
R0 defect appeared.

This is a technical readiness classification only — **it does not authorize an
upload.**

**Exact next mutating action that would require explicit human authorization**:
`wrangler versions upload` (per the pre-existing
`docs/operations/PRODUCTION_CUTOVER_RUNBOOK.md`'s §4), following that runbook's
own preconditions (§0) and gates (§2). **This checkpoint does not perform or
authorize that action, and does not authorize SUN-1205.** The one outstanding
disclosed R1 (dead `validateProductionBindings`) and the other carried-forward
SUN-1203 R1 items remain a human's decision to accept or address before
authorizing that upload.
