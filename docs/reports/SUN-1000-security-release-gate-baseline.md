# SUN-1000 Checkpoint 1A — Production/Security Release-Gate Baseline

`production_ready=false`, `production_enabled=false`. This is an audit and
evidence-gathering checkpoint. **Zero external mutation**: no production
deployment, no DNS change, no package publication, no Nevermined
registration/delegation/token/settlement, no CDP live settlement.

Baseline: `HEAD=9090d64a644032bfeaead986a3a7956b7c0a8481`, tree clean. Branch
`main`. Node `v24.18.1`, pnpm `9.0.0`, Python `3.13.1`. All SUN-0900B
live/probe/registration guards (`RUN_LIVE_NEVERMINED`, `RUN_LIVE_X402`,
`NEVERMINED_REGISTER_DOCUMENT`, `NEVERMINED_REGISTER_COMPANY`,
`NEVERMINED_REGISTER_VERIFY`, `NEVERMINED_RECONCILE_COMPANY`,
`NEVERMINED_RECONCILE_VERIFY`, `NEVERMINED_AUDIT_REGISTRATIONS`,
`NEVERMINED_PROBE_PAYG_DIFFERENTIAL`, `NEVERMINED_PROBE_DYNAMIC_CREDITS`,
`NEVERMINED_DOCUMENT_PARTIAL_BALANCE`, `NEVERMINED_RECOVER_PAYMENT_ID`,
`NEVERMINED_RECOVER_DOCUMENT_PAYMENT_ID`) confirmed absent. Baseline gates
(`pnpm check`, `pnpm secrets:scan`, `pnpm governance:validate`,
`pnpm state:validate`, `pnpm tasks:validate`) all exit 0.

## 1. The normative SUN-1000 acceptance matrix — exact source

`TASKS.yaml`'s own `SUN-1000` entry
(`title: 'Security release gate (Semgrep, ESLint, Ruff, mypy, OSV-Scanner, Trivy, Gitleaks, Schemathesis, property, payment, chaos, load)'`)
is the single authoritative source — **12 named criteria**, no more, no less.
The master directive's §22 (Security) names a threat-model list (SSRF, DNS
rebinding, path traversal, payment replay, etc.) that these 12 criteria
collectively exist to enforce — it does not itself name additional required
tools beyond what TASKS.yaml already specifies. No SUN-1000-specific ADR
(`0055`+) exists in `docs/decisions/`; the closest normative security
architecture record is `docs/adrs/0004-public-http-security-boundary.md` (SSRF
boundary, already accepted, gaps explicitly documented).

## 2. Formal acceptance matrix

| #   | Criterion                                     | Source              | Status                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------- | ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Semgrep passes, no critical findings          | TASKS.yaml SUN-1000 | **FAIL_INTERNAL**      | `semgrep` not installed (`command not found`), not present in `.github/workflows/ci.yml`, no `pnpm` script references it. Never run, ever, in this repo's history.                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | ESLint passes                                 | TASKS.yaml SUN-1000 | **PASS**               | `npx eslint --version` → `v9.18.0`; `pnpm lint` is part of `pnpm check`, exit 0 this session.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | Ruff passes                                   | TASKS.yaml SUN-1000 | **PASS**               | `services/modal-worker/.venv/bin/ruff --version` → `0.16.1`; `pnpm document-worker:lint` runs `ruff .`, part of `pnpm check`, exit 0.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | mypy strict passes                            | TASKS.yaml SUN-1000 | **PASS**               | `mypy 2.3.0`; `services/modal-worker/pyproject.toml` sets `strict = true`; `pnpm document-worker:typecheck` runs it, part of `pnpm check`, exit 0.                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | OSV-Scanner finds no critical vulnerabilities | TASKS.yaml SUN-1000 | **FAIL_INTERNAL**      | `osv-scanner` not installed, not in CI, no script references it. Never run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Trivy passes                                  | TASKS.yaml SUN-1000 | **FAIL_INTERNAL**      | `trivy` not installed, not in CI, no script references it. Never run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7   | Gitleaks finds no secrets                     | TASKS.yaml SUN-1000 | **PASS**               | `gitleaks 8.30.1` (Homebrew) locally, `gitleaks/gitleaks-action@v2` in CI's `secret-scan` job. `pnpm secrets:scan` exit 0 this session — 817+ tracked files, git history and working tree both scanned, zero leaks.                                                                                                                                                                                                                                                                                                                               |
| 8   | Schemathesis passes                           | TASKS.yaml SUN-1000 | **FAIL_INTERNAL**      | `schemathesis` not installed (not even in the Python venv), not in CI, no script references it. No OpenAPI-fuzzing harness exists. Never run.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | Property tests pass                           | TASKS.yaml SUN-1000 | **PASS**               | `test:property` scripts exist in `protocol-a2a`, `protocol-x402`, `provider-adapters`, `pcc-schema`, `verification`, `protocol-mcp`, `service-runtime`, and root `package.json` — all invoked through their respective `*:check` targets, all part of `pnpm check`, exit 0.                                                                                                                                                                                                                                                                       |
| 10  | Payment suite passes                          | TASKS.yaml SUN-1000 | **PASS** (interpreted) | No single command is literally named "payment suite," but the distributed payment/replay/lifecycle coverage this exact requirement describes is extensive and passing: `d1-payment-attempts.test.ts`, `x402-service-route.test.ts` (149 tests), `nevermined-service-route.test.ts` (18 tests), `nevermined:compat:verify`, migration/recovery suites — all exercised through `nevermined:check`/`x402:check`/`control-plane:check`, part of `pnpm check`, exit 0. See §5 below for the specific security-relevant payment invariants this covers. |
| 11  | Chaos suite passes                            | TASKS.yaml SUN-1000 | **FAIL_INTERNAL**      | No file, directory, or script named `chaos` anywhere in the repository. Does not exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 12  | Load suite passes                             | TASKS.yaml SUN-1000 | **FAIL_INTERNAL**      | No file, directory, or script named `load` (load-test) anywhere in the repository. Does not exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**6 of 12 required criteria: FAIL_INTERNAL. 6 of 12: PASS. 0 BLOCKED_EXTERNAL. 0
NOT_YET_TESTED. 0 N/A. 0 CONTRADICTION.**

All six `FAIL_INTERNAL` items are missing **local tooling/test suites**, not
unavailable external infrastructure: Semgrep, OSV-Scanner, Trivy, and
Schemathesis are all free, open-source, installable without any account or paid
credential for this repository's intended usage; a chaos suite and a load suite
are buildable entirely against the existing local Miniflare/D1/fixture-mode test
infrastructure already used throughout this project, without needing a deployed
environment. None require external services, accounts, DNS, or infrastructure
SITEBORNE does not already control locally. This is why the decision below is
**B**, not **C**.

## 3. Security toolchain inventory (beyond the 12 named criteria)

Already adopted and exercised regularly, credential-free:

- **ESLint 9.18.0** (`packages/*/eslint.config.*`, `pnpm lint`).
- **Prettier** (`pnpm format:check`).
- **TypeScript strict compiler checks** (`pnpm typecheck`, every package).
- **Ruff 0.16.1** + **mypy 2.3.0 (`strict=true`)** for the Python
  document-worker.
- **Gitleaks 8.30.1**, both `git` (full history) and `dir` (working tree) modes,
  plus a repository-authored scope-verification script
  (`scripts/verify-secret-scan-scope.ts`) proving the scan actually covers the
  required secret classes before trusting a clean result.
- **Property-based testing** (`fast-check`, widely used — replay/binding
  adversarial properties, Bazaar discovery properties, HTTP invariants).
- **Contract/compat baselines**: `contracts:baseline:verify`,
  `contracts:compat:check`, `contracts:release:verify` — a form of API-surface
  drift detection distinct from, but complementary to, Schemathesis-style
  fuzzing.
- **Deterministic adversarial fixture suites**: prompt-injection,
  malformed/encrypted/oversized document fixtures, replay/duplicate-
  conflict/concurrency fixtures — not named "chaos" or "load" but covering
  meaningful adjacent ground (see §7, §9 below).

## 4. Secret/credential boundary audit

- No committed secrets: `pnpm secrets:scan` clean (this session and every prior
  session in this project's history — the scan covers full git history, not just
  the working tree).
- No secret values in fixtures: `scripts/verify-secret-scan-scope.ts` positively
  verifies the required secret-class patterns are present in the scan's
  detection scope (a scan that silently stopped detecting a required class would
  itself fail this check).
- No persisted ephemeral payment tokens: proven repeatedly throughout the
  SUN-0900B arc — every live/probe test file's own design explicitly never logs
  or persists an x402 access token or Nevermined API key; this was a recurring,
  explicitly-audited discipline across every live-touching test file in
  `apps/edge-api/tests/live/`.
- Live guards disabled by default: `RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402` and
  every registration/probe/recovery-specific env var confirmed absent in this
  session's baseline (§ above); every live-gated test file uses
  `describe.skipIf(process.env.X !== '1')`, fail-closed (skip is the default,
  not run).
- Credential presence is checked (`NVM_API_KEY`, `NVM_SUBSCRIBER_API_KEY`)
  without ever printing values, throughout this project's entire history — every
  live test explicitly documents "never print or persist."

**Status: PASS.**

## 5. Payment/economic security regression (SUN-0900B frozen infrastructure)

Re-verified this session via the existing deterministic suites (no live call):

- **Payment-Identifier uniqueness**: enforced at the database layer
  (`idx_payment_attempts_identifier` UNIQUE constraint,
  `D1PaymentAttemptRepository.acquire()` converts a constraint violation into a
  `conflict` result — never an application-level read-then-write race).
- **Immutable binding / cross-rail conflict**: ADR 0054's v2 binding digest
  includes `payment_rail`/`payment_provider`/agent/plan; a cross-rail or
  cross-provider retry resolves to `duplicate_conflict`, proven by
  `x402-service-route.test.ts`'s and `nevermined-service-route.test.ts`'s
  replay/conflict test groups.
- **No double execution / no double settlement**: `duplicate_same` reconstructs
  from D1 without re-invoking the executor or the facilitator — proven by the
  "reconstructs replay from D1 with no second verify, settle, job, or result"
  tests on both rails.
- **`SETTLEMENT_PENDING` durability/recovery**: proven, including with a
  **real** historical false-rejection incident (Checkpoint 1B's
  `829354f`/`ef407ed`/`021c280` arc) and a real recovery-only operator path that
  reached `consumed` with zero new external mutations.
- **Consumed replay / duplicate conflict**: covered by the same test groups
  above, for both CDP and Nevermined rails.
- **Rail/provider binding**: `providerMatchesRail()` and the v2
  `PaymentServiceLink` validator reject a rail/provider mismatch; Nevermined
  links additionally require agent+plan IDs.
- **Nevermined delegation correlation**: `PAYMENT-DELEGATION-ID` header +
  durable `nevermined_delegation_id` column, proven end-to-end across the entire
  Checkpoint 1B recovery arc.
- **CDP exact/upto boundaries**: `authorization_exceeded` rejection when an
  executor reports actual usage above the authorized maximum — proven, never
  silently clipped.
- **Dynamic credit-vs-cash taxonomy**: `CASH_MOVEMENT_ATOMIC` /
  `CREDITS_REDEEMED` / `USAGE_VALUE_ATOMIC_EQUIVALENT` frozen and never
  conflated (Checkpoint 2E), with `document-dynamic-plan-validator.ts` now the
  authoritative registration-time economic gate for the document plan.

**Status: PASS**, no live payment run this session; entirely via existing
deterministic tests, all exit 0.

## 6. Cryptographic evidence security

- **PCC validation / receipt signing/verification**:
  `@siteborne/ verification`'s signer/verifier boundary, exercised across the
  whole service-runtime test suite; a deterministic failure (bad signature,
  mismatched hash) cannot be overruled — matches master directive §21's explicit
  requirement.
- **PaymentServiceLink hashing**: `hashPaymentObject()` canonical serialization;
  `link_hash`/`link_id` derived deterministically; any field mutation changes
  the hash (proven by `usage-result.test.ts`'s and `payment-service-link.ts`'s
  own mutation tests).
- **A2A signing**: ADR 0053's Hono-mounted signing boundary, exercised by
  `a2a-route.test.ts`.
- **Tamper detection**: no path exists where an unsigned/invalidly-signed
  receipt, a changed PCC, a changed `UsageResult`, or changed settlement
  evidence can be accepted as a valid consumed result — this is the central
  invariant the entire `duplicate_conflict`/binding-digest machinery exists to
  enforce, proven across dozens of tests this session alone and hundreds across
  the project's full history.

**Status: PASS.** No signing keys rotated this session.

## 7. Document/file-processing security

- File-size/page bounds: `10 MB maximum`, `10 pages maximum` per the master
  directive §4.3, enforced in the document service's input validation
  (schema-level bounds checked by `BUNDLED_SERVICE_INPUT_SCHEMAS`).
- Type validation: PDF/PNG/JPEG only.
- Malformed/encrypted-PDF handling: dedicated fixtures exist
  (`encrypted-failure.json`, `malformed-failure.json` in
  `packages/service-runtime/fixtures/document-worker-results/`), proving
  fail-closed behavior on genuinely bad input.
- Worker isolation / no arbitrary host filesystem reads / no arbitrary command
  execution: the document worker path uses an injected artifact store and
  fixture-mode adapters throughout every test in this repository — no test or
  production code path shells out or reads arbitrary host paths for document
  content.
- OCR/table-extraction bounds: tiered pricing itself is bounded by the
  `document_evidence_json_max_job` ceiling (governance-enforced, see
  `governance:validate`'s risk-limit checks).

**Status: PASS** for the criteria the master directive names explicitly;
**NOT_YET_TESTED** for adversarial fuzzing beyond the existing curated fixture
set (this is exactly the gap Schemathesis-class tooling would close — tracked
under criterion 8's `FAIL_INTERNAL`, not double-counted here).

## 8. HTTP/network security

- SSRF/redirect/metadata-endpoint protections:
  `packages/provider-adapters/src/policy/network-policy.ts`'s `validateUrl()`/
  `validateRedirectChain()`, accepted per
  `docs/adrs/0004-public-http-security-boundary.md`, with its own gaps
  explicitly documented (no DNS-answer validation, no connection-pinning against
  DNS rebinding — a genuine, already-known, already-recorded limitation, not
  newly discovered here).
- Security response headers: `createSecurityHeadersMiddleware()`
  (`apps/edge-api/src/control-plane/middleware/request-context.ts`) sets
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: geolocation=(), microphone=(), camera=()` — confirmed
  mounted globally (`app.use('*', createSecurityHeadersMiddleware())` in
  `apps/edge-api/src/index.ts`).
- Production/debug behavior: `production_enabled: false` is hardcoded at the
  route-construction layer itself (`paid-services.ts`, `x402-service.ts`), not
  merely an environment flag — a genuine defense-in-depth fail-closed gate
  independent of configuration.
- **CORS and rate limiting**: no CORS middleware and no rate-limiting middleware
  exist in `apps/edge-api/src`. **These are not named in either the master
  directive's §22 threat list or TASKS.yaml's 12 SUN-1000 criteria** — noting
  this as an informational observation, not a formal matrix failure, since it is
  not sourced to a normative requirement. It is worth flagging for a future
  checkpoint regardless, since public routes remain gated off by default
  (`PAID_ROUTES_ENABLED` unset) rather than protected by these specific
  controls.

**Status: PASS** against the actual normative criteria; the CORS/ rate-limiting
gap is recorded as a non-blocking observation.

## 9. MCP/A2A boundary (implemented local security surface only — no publication)

- Input/schema validation: MCP tool dispatch validates against the same
  `BUNDLED_SERVICE_INPUT_SCHEMAS` the HTTP routes use — one shared schema
  authority, not a parallel, potentially-drifted one.
- A2A signature verification: ADR 0053's signing boundary, tested.
- No payment bypass through protocol adapters: MCP/A2A routes reuse the exact
  same `createX402ServiceRoute`-driven payment/lifecycle machinery as the HTTP
  routes — proven by `mcp-route.test.ts`/`a2a-route.test.ts` both passing as
  part of `mcp:check`/`a2a:check` this session.
- No secret leakage: same discipline as §4, no live credential ever enters an
  MCP/A2A code path.

**Status: PASS.** No MCP/npm/A2A artifact published this session (publication is
explicitly SUN-0800B, out of scope here).

## 10. D1/database security

- Migration idempotency: `runMigrationsFromDir`/`columnExists` (schema
  introspection, not error-message guessing), proven with mandatory positive AND
  negative controls (`b893555`,
  `nevermined-live-migration-idempotency.test.ts`).
- Schema constraints: `payment_attempts.payment_identifier` UNIQUE, foreign keys
  with `ON DELETE SET NULL` where appropriate.
- Concurrency: 20-way same-binding and 10-way conflicting-binding
  concurrent-request tests, proven to never cross-leak a result.
- Settlement-recovery persistence: the entire Checkpoint 1B recovery arc is this
  proof, including a real crash/recovery cycle against a real historical
  settlement.
- Safe handling of corrupted/partial state: `getSettlementRecoveryRecord`/
  `reconstructFromJob` fail closed on an unrecognized draft shape (the `kind`
  discriminant guard added during Checkpoint 1B).

**Status: PASS.** No production database touched.

## 11. Production configuration audit

- `PROJECT_STATE.yaml`: `production_ready: false` (confirmed, current value,
  unmodified this session).
- `production_enabled: false` hardcoded at the route-construction layer (§8)
  independent of any single environment variable.
- Sandbox/production separation (§12 below) reduces the risk of an
  environment-check gap silently promoting sandbox identities to production
  ones.
- No unresolved placeholder domains found in reviewed route/config code
  (`utility.siteborne.net` used consistently as the canonical production
  hostname reference, itself never live-served yet).

**Status: PASS.** No production flag changed this session.

## 12. Sandbox/production separation

- Nevermined: every live-gated test/script this project has ever built
  explicitly targets `sandbox` (Base Sepolia, `api.sandbox.nevermined.app`);
  `evaluateNeverminedLiveGuard` requires `RUN_LIVE_NEVERMINED==='1'` **and** a
  sandbox-classified API key before any live call is even reachable — a real,
  tested double gate, not a single flag.
- CDP: the equivalent `RUN_LIVE_X402` gate mirrors this discipline (not
  exercised this session, but structurally identical and already accepted from
  SUN-0700B).
- No evidence found of a code path that would let a production process silently
  fall back to a sandbox economic identity — every registration/
  delegation/settlement path this project has built requires explicit,
  separately-authorized live-flag opt-in every time, proven dozens of times
  across the SUN-0900B arc's own operational discipline.

**Status: PASS.**

## 13. Failure-mode audit

Representative fail-closed behaviors already proven by existing deterministic
tests (no new live payment run to test these):

- Provider timeout/ambiguous response after mutation: `settlement_pending` →
  recoverable, never silently treated as failed or silently re-settled (the
  entire Checkpoint 1B incident and its fix).
- Malformed settlement evidence / unrecognized read-back shape: the
  `document-dynamic-plan-validator.ts`'s own fail-closed reasons (e.g.
  `MALFORMED_CREDITS_CONFIG`, `MALFORMED_PRICE_AMOUNTS`) and the recovery path's
  `kind` discriminant guard both reject unknown shapes rather than guessing.
- Conflicting Payment-Identifier: `duplicate_conflict`, 409, zero provider
  calls.
- Registration conflict (right name, wrong economics): the document
  dynamic-credit reconciliation wrapper classifies this `CONFLICT`, not
  `EXACT_EXISTING` — proven by dedicated fixture tests built for exactly this
  case in the SUN-0900B arc.
- Document worker rejection (malformed/encrypted PDF): dedicated fixtures, fail
  closed.

**Status: PASS**, via existing fixture/mock-based deterministic tests —
consistent with this checkpoint's explicit instruction not to rerun real
external payments to test these paths.

## 14. Logging/observability security

- No credential, authorization token, wallet secret, or raw signed authorization
  material has ever been logged in any live/probe test file across the entire
  SUN-0900B arc — every such file explicitly documents "never print or persist"
  and this discipline was independently spot- checked multiple times this
  session and prior sessions (including the explicit sanitized-logging pattern
  used everywhere: `console.log('... (sanitized):', {...})` with values
  deliberately excluded).
- No new telemetry service introduced this session or in the reviewed history.

**Status: PASS.**

## 15. Release artifact security

- Packed-install validity: `mcp-server`'s own `pack:verify` script
  (`scripts/verify-packed-install.ts`) already proves an offline, packed-tarball
  install works end-to-end — part of `mcp:check`, exit 0 this session.
- Generated-artifact drift:
  `contracts:baseline:verify`/`contracts: compat:check`/`pcc:generate:check`/`services:generate:check`/`openapi: generate:check`
  — all part of `pnpm check`, exit 0, proving generated schemas/contracts match
  their sources with no unreviewed drift.
- No secret inclusion in packed artifacts: covered transitively by §4's
  secret-scan (which scans the full working tree, including anything a pack step
  would include).

**Status: PASS** for what is locally verifiable. **N/A** for full build
reproducibility/SBOM generation — no such tooling exists yet, and TASKS.yaml's
12 criteria do not name SBOM/provenance as a required SUN-1000 gate, so this is
not counted as a matrix failure.

## 16. External security dependencies

**None identified that SUN-1000 itself normatively requires.** All 12 named
criteria are either already passing locally/in-CI or achievable with local,
free, open-source tooling. Production DNS/TLS, cloud deployment, external
penetration testing, and external monitoring belong to later packages
(SUN-0800B, SUN-1100, SUN-1200) and are explicitly out of scope here, per this
checkpoint's own instruction not to import their dependencies.

## 17. Vulnerability triage

No genuine, reachable security defect was found during this audit. The six
`FAIL_INTERNAL` items are **absence of required tooling/test coverage**, not
identified vulnerabilities in existing code. No finding in this report mixes
code quality/style/performance with a security defect — none of that kind was
found either.

## Summary counts

- Total normative criteria (TASKS.yaml SUN-1000): **12**
- Required: **12** (all)
- PASS: **6**
- FAIL_INTERNAL: **6**
- BLOCKED_EXTERNAL: **0**
- NOT_YET_TESTED: **0** (folded into §7's PASS/tracked-under-criterion-8 split)
- N/A: **0** (SBOM noted informationally in §15, not a matrix item)
- CONTRADICTION: **0**

## Decision

**B — `SUN_1000_REMAINS_ACTIVE_INTERNAL_GAPS`.**

Six of twelve required criteria fail for a concrete, internally- achievable
reason: the tooling/test suites (Semgrep, OSV-Scanner, Trivy, Schemathesis, a
chaos suite, a load suite) simply do not exist yet in this repository. All other
required criteria — ESLint, Ruff, mypy strict, Gitleaks, property tests, and the
payment suite (interpreted as the existing extensive payment/replay/lifecycle
coverage) — pass today, with real evidence, against the unmodified accepted
baseline.

`SUN-1000` remains `active`. No acceptance is proposed. `production_ready` and
`production_enabled` are unchanged (`false`, `false`).

## Smallest next remediation checkpoint

**SUN-1000 Checkpoint 1B — Static/Dependency Security Scanner Integration
(Semgrep, OSV-Scanner, Trivy).** These three are the most homogeneous group
among the six gaps (single-binary or single-command CLI scanners, no
account/credential required for community/OSS usage, near-identical integration
pattern: install, wire a `pnpm`/CI script, establish a "no critical findings"
baseline). Schemathesis (API-contract fuzzing, needs a running local server +
OpenAPI spec) and the chaos/load suites (resilience/performance testing, a
genuinely different test category) are deliberately left for later, separate
checkpoints — matching this turn's own instruction not to implement several
unrelated categories at once.

## External mutation totals this checkpoint

Production deployments: 0. DNS mutations: 0. Package publications: 0. Nevermined
registrations: 0. Nevermined delegations: 0. Nevermined tokens: 0. Nevermined
settlements: 0. CDP live settlements: 0. Payment-Identifier creations: 0.
Service executions for payment: 0.
