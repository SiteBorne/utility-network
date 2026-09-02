# SUN-1222B-S3 — Four-Service Commercial Readiness & Price Freeze

Repo-only. **Zero production mutations, zero economic transactions.** No
deploy, no traffic change, no price change to any live/served value, no
payment material created.

## 0. Reconciliation

S3_START_HEAD = `fc800bd` (working tree clean, matches the SUN-1222B-S2
evidence-report commit; the code gate immediately before it, `a48dc2c`, was
independently verified clean — `fc800bd` added only the report file, no code
diff). RECONCILIATION_EVIDENCE_PRESENT = YES.

S3_END_HEAD = `b75d91f` (this report's own commit will follow).

## 1. Headline finding

**Only 2 of the 4 primary tools have a real production executor and a
production HTTP route today.** This is not new work regressing — it is the
actual, self-documented state of `apps/edge-api/src/index.ts`, confirmed by
three independent code paths that all agree:

| Service | Production HTTP route in `index.ts` | `EFFECTIVE_DISCOVERY_RESOLVERS` entry | MCP-reported `implementation` |
|---|---|---|---|
| `verify_agent_output.v2` | `POST /v2/verify/agent-output` → `verifyAgentOutputV2CdpProductionRoute` | present | `real_executor` (when gates enabled) |
| `web_context_verified.v2` | `POST /v2/web/context` → `webContextVerifiedV2CdpProductionRoute` | present | `real_executor` (when gates enabled) |
| `company_evidence_graph.v2` | **none** — falls through `app.all('/v2/*', c.notFound())` | **absent** | `local_fixture_verified`, always |
| `document_evidence_json.v2` | **none** — same fallthrough | **absent** | `local_fixture_verified`, always |

`index.ts`'s own comment block (lines 108-127) states this plainly: *"The
repository has no complete governed Worker-compatible paid-service executor,
so every enabled family stops at the same deterministic 503 before
quote/payment/provider/service work."* `paid-services.ts` — the only place
all four services have route wiring — is test/dev-only infrastructure
(`buildFixtureRegistry`'s own doc comment: *"fixture-mode (never real
network/subprocess)"*), imported by test files and `scripts/verify-fixtures.ts`
/`scripts/benchmark.ts`, never by `index.ts`.

This does not mean the underlying service logic doesn't exist:

- **`company_evidence_graph`**: `CompanyEvidenceGraphService` +
  `SecSubmissionsAdapter`/`PublicHttpAdapter`/`FederalRegisterAdapter` (real
  code in `@siteborne/provider-adapters`) are real and tested — but only ever
  driven through an injected `InjectedHttpClient`. The only composition that
  exists (`paid-services.ts`) wires a canned `jsonHttpClient(SEC_EDGAR_FIXTURE)`,
  never a real network client. No Worker-compatible real `InjectedHttpClient`
  implementation and no production route exist yet.
- **`document_evidence_json`**: `DocumentWorkerBridge` has a real
  implementation, `SubprocessDocumentWorkerBridge`, which shells out via
  `node:child_process.spawn` to the real Python OCR/table-extraction worker
  (`services/modal-worker`, SUN-0400A). This **cannot run inside a Cloudflare
  Worker** (no subprocess/filesystem/Python runtime) — it only works on a
  local/CI machine with the Python venv present. No HTTP bridge to a deployed
  Modal (or equivalent) endpoint exists, mirroring the architecture
  `web_context_verified.v2` already has (off-Cloudflare Modal safe-egress) but
  for documents.

Building those two real, Worker-reachable production compositions is
comparable in scope to what `verify_agent_output.v2` (SUN-1216) and
`web_context_verified.v2` (SUN-1221C) already received across dedicated prior
checkpoints — not something to improvise inside this audit.

## 2. Protected invariants — reverified, all hold

- MCP: `legacy: 'stateless'` still in place (`packages/protocol-mcp/src/server.ts`).
- A2A: `productionEnabled` aggregate still derived, not a stale literal.
- Agent Card: all eight version-specific `AgentSkill` IDs intact.
- Typecheck: 23/23 packages clean.
- SUN-1222B-S2 x402/trust-class fixes: `paid-services.ts` still threads its
  own `evidenceMode` into `createInProcessWorkflowBinding`; the post-settlement
  `pcc === undefined` guard is intact **and now has dedicated regression
  coverage** (§ below — it previously only had incidental coverage).

## 3-4. Exact four-tool matrix (traced from source, not documentation)

`packages/protocol-mcp/src/constants.ts`'s `MCP_SERVICE_TOOLS` hardcodes all
four primary tool names to their `.v2` service id — SERVICE_TOOL_MATRIX_V2_EXACT
= **PASS**, no primary tool resolves to v1.

| SERVICE_ID | MCP tool | A2A skill | Wired HTTP route | Real executor | Fixture reachable in the ONLY production composition |
|---|---|---|---|---|---|
| `company_evidence_graph.v2` | `siteborne_company_evidence_graph` | present (8-skill model) | **none** | **NO** | N/A — service isn't reachable in production at all yet |
| `web_context_verified.v2` | `siteborne_web_context_verified` | present | `POST /v2/web/context` | **YES** (CDP composition) | NO |
| `document_evidence_json.v2` | `siteborne_document_evidence_json` | present | **none** | **NO** | N/A — same as company graph |
| `verify_agent_output.v2` | `siteborne_verify_agent_output` | present | `POST /v2/verify/agent-output` | **YES** (CDP composition) | NO |

## 5. Zero-fixture production rule

`COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE` and
`DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE` are best answered **N/A, not NO** —
there is no production HTTP path to either service at all today (404 for
every method), so there is no reachable composition, fixture or otherwise, to
worry about leaking a synthetic result to a real buyer. That is a strictly
safer state than "reachable and secretly fixture-backed," but it is also not
yet a "real executor" pass.

- `COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE` = **N/A** (unreachable in production)
- `WEBCTX_V2_PRODUCTION_FIXTURE_REACHABLE` = **NO** (real CDP composition; MCP's own closed-boundary default never executes anything for free — see § MCP boundary note)
- `DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE` = **N/A** (unreachable in production)
- `VERIFY_V2_PRODUCTION_FIXTURE_REACHABLE` = **NO**

**MCP boundary note**: `apps/edge-api/src/routes/mcp.ts`'s own doc comment —
*"Service tools use protocol-mcp's closed default boundary, which returns
`payment_required` and cannot execute a useful service for free"* — confirms
MCP tool calls never reach any executor (fixture or real) today, for any of
the four. This is a deliberate, current, safe default, not evidence of
MCP_BUYABLE for any service yet.

## 6, 8. Company evidence graph & document evidence JSON — deferred to remediation

Per §1/§5, neither has a real, Worker-reachable production executor.
`COMPANY_V2_REAL_EXECUTOR` = **NO**, `DOCUMENT_V2_REAL_EXECUTOR` = **NO**.
`COMPANY_V2_LOCAL_E2E`/`DOCUMENT_V2_LOCAL_E2E` = **N/A** in the production
composition (the fixture-mode composition in `paid-services.ts` does pass its
own tests, but that proves the fixture path works, not a production path —
conflating the two is exactly what this checkpoint exists to prevent).
Dependencies required by name (never values): for company graph, a
Worker-compatible outbound HTTP client reaching SEC EDGAR / Federal Register
live endpoints; for document evidence, a deployed HTTP-reachable OCR/table
worker (Modal or equivalent) mirroring `web_context_verified.v2`'s own
off-Cloudflare egress pattern.
`COMPANY_V2_DEPENDENCIES_COMPLETE` / `DOCUMENT_V2_DEPENDENCIES_COMPLETE` =
**NO** (the production composition itself doesn't exist to have dependencies).

## 7, 9. Web context verified & verify agent output — reconfirmed real

Both retain their already-qualified real production compositions
(`web-context-v2-production-executor.ts`+`production-web-context-v2-cdp-route.ts`;
`verify-agent-output-v2-production-executor.ts`+`production-verify-v2-cdp-route.ts`),
gated by their own two-level `PAID_ROUTES_ENABLED` AND
`{WEB_CONTEXT,VERIFY}_V2_CDP_ROUTE_ENABLED` flags, independent of each other.
`WEBCTX_V2_REAL_EXECUTOR` = YES, `VERIFY_V2_REAL_EXECUTOR` = YES.
`WEBCTX_V2_LOCAL_E2E` / `VERIFY_V2_LOCAL_E2E` = **PASS** (part of the 216/216
green full suite this checkpoint reran clean — see §34).

## 10. Trust-class matrix — complete, at both layers

The pure-function matrix (`packages/protocol-x402/src/evidence/policy.test.ts`)
already exhaustively covers all 4×2 `evidenceMode`×`trust_class` combinations.
The exact SUN-1222B-S2 defect class (integration-level wiring, not the policy
function) now has explicit coverage too:

- `production` + external-kind provider + `external_verified` evidence →
  **ALLOW**, proven end-to-end via `production-cdp-provider-wiring.test.ts`
  (the real `CdpPaymentEvidenceProvider`, through `buildPaidServicesApp`).
- `production` + a fixture-kind provider → **FAIL_CONFIGURATION**, proven via
  `x402-service-route.test.ts`'s `resolvePaymentEvidenceProvider('production',
  fixtureProvider)` throw test.
- `fixture` + an external-kind provider carrying `synthetic_fixture` evidence
  → **ALLOW**, deliberately exercised by `x402-evidence-provider-boundary
  .test.ts`'s `RecordingProvider` (`providerKind: 'external'`,
  `trust_class: 'synthetic_fixture'` — its own doc comment says this is
  intentional, to prove providerKind alone never grants trust).

`TRUST_CLASS_MATRIX_COMPLETE` = YES, `PRODUCTION_EXTERNAL_ACCEPTED` = YES,
`PRODUCTION_FIXTURE_REJECTED` = YES.

## 11. Post-settlement fail-closed matrix

Existing coverage (`paid-continuation-workflow.test.ts`, "proof #11") already
proved: settled-then-result-persistence-failure, settled-then-receipt-
persistence-failure, settled-then-terminal-state-persistence-failure — all
never re-settle, all reach a durable `persistence_failed_after_settlement`
terminal state. The one real gap: the SUN-1222B-S2 `pcc === undefined` guard
had only *incidental* coverage (via two test-fixture fixes that happened to
route around it), not a dedicated regression test proving the guard itself
fires correctly.

**Closed this checkpoint** (commit `1a06d97`): a direct test overriding
`validatePcc` to return `{ valid: true, pcc: undefined }` — the exact
malformed-validator shape the guard exists for. Genuine RED/GREEN verified:
the guard was temporarily removed, the new test crashed with the identical
`canonical-json returned undefined` unhandled throw the guard prevents,
restored, GREEN (31/31 in that file).

`POST_SETTLEMENT_FAIL_CLOSED_MATRIX` = **PASS**.

## 12. One-settlement invariant — reconfirmed

`PUBLIC_API_SETTLE_CALLSITES` = **0** (`x402-service.ts`'s own comment: *"route
never calls `evidenceProvider.settle()` directly"*; `settlement-reconciliation.ts`:
*"NEVER calls `evidenceProvider.settle()`"*).
`DEDICATED_WORKFLOW_SETTLE_CALLSITES` = **1** (`paid-continuation-workflow.ts:586`,
explicitly commented *"The SOLE production `evidenceProvider.settle()` call
site"*).
`TOTAL_PRODUCTION_SETTLE_CALLSITES` = **1**. No new service activation changed
this — company/document aren't wired to any settle path at all yet.

## 13. Four-service unpaid fail-closed

The guarantee is a property of the shared `createX402ServiceRoute` framework
every route (including all four v2 families) uses, not a per-executor
concern: `payload/parser.ts`'s `validatePaymentPayloadStructure` structurally
rejects `quote_mismatch`, `resource_mismatch`, `requirement_mismatch`
(covers amount/asset/network/payee tampering — one field-by-field structural
comparison against the server's own requirement), and `expired`, all **before**
any evidence-provider or executor call. `exact.test.ts` separately confirms
`payee_mismatch` detection. Missing/malformed `PAYMENT-SIGNATURE` fails
structurally (400-class) at header-decode time, same layer.
`ALL_FOUR_X402_FAIL_CLOSED` = **YES** (framework-level, applies uniformly).

## 23. Price single source of truth — a real, evidenced gap, one fix shipped

`PRICE_SINGLE_SOURCE_OF_TRUTH` = **NO**. Traced every consumer:

- `x402-service.ts`, `protocol-mcp/server.ts`, `protocol-x402/bazaar/discovery.ts`
  all call `resolveServiceMaxPriceUsd()` live — the actual **charged** amount
  is never at risk, single source, always fresh.
- `catalog.ts`'s `/catalog` response serves D1's `services.price_usd` column
  **verbatim, with no live-recompute overlay** — unlike
  `production_enabled`/`production_ready`/`protocol_status`, which
  `overlayEffectiveDiscoveryStatus()` already refuses to trust D1 for, by name,
  for exactly this drift reason (its own doc comment: *"a stale/drifted D1
  value can never leak through"*). `price_usd` never received the same
  treatment.
- `registry/services/*.json`'s own `base_price`/`maximum_price` fields are a
  **fourth**, independent, hand-maintained copy (feeding `seedServices()` →
  that same D1 column). `check-embedded-pricing-drift.mts` only guards a
  *third* copy (`EMBEDDED_PRICING`) against governance drift — nothing
  guarded this fourth one.

**Shipped this checkpoint** (commit `b75d91f`):
`scripts/check-registry-pricing-drift.mts`, sibling to the existing checker,
comparing all 8 registry entries' `base_price`/`maximum_price` against
governance live. Running it found a **real, pre-existing** drift:
`company_evidence_graph` (v1 AND v2) has exactly one flat governance price
(0.039, no distinct ceiling tier) but its registry JSON declares
`maximum_price: 0.19` — matching neither its own `base_price` nor any real
governance key for this service (0.19 is `document_evidence_json_max_job`'s
value). Its registry entry also declares `pricing_schemes: ['exact','upto']`
though no `upto` route exists anywhere in `paid-services.ts` for this service
— so whether `0.19` is a copy/paste artifact or a placeholder for a future
real ceiling is a **governance decision**, not one this script should resolve
by guessing. Deliberately **not yet wired into the blocking `pnpm check`
chain** (root `package.json`'s `check` is one long `&&` chain, unlike CI's
job-based `needs` list — there is no way to add a partially-blocking step to
it the way `ci.yml`'s `security-release` job is deliberately excluded from
`check`'s `needs`, which is the precedent this follows). Runnable standalone:
`pnpm pricing:registry:check`.

## 14-24. Market research & pricing

Live, dated, sourced research (this session, browser-fetched):

| Competitor | Product | Unit price | Comparability | Source | Observed |
|---|---|---|---|---|---|
| Exa | `/contents` (page text) | $1 / 1k pages ($0.001/page) | HIGH to web_context_verified's raw-fetch layer, LOW on verification/PCC | docs.exa.ai/reference/pricing | 2026-08-20 (page's own "last modified") |
| Exa | `/search` | $7 / 1k requests (≤10 results) | MEDIUM | docs.exa.ai/reference/pricing | 2026-08-20 |
| Firecrawl | Scrape | $0.001–$0.005/page (plan-dependent marginal credit rate) | HIGH to web_context_verified's raw-fetch layer, LOW on verification/PCC | firecrawl.dev/pricing | this session |
| Diffbot | Extract (1 page) | $0.0009–$0.001/page (Startup/Plus overage) | MEDIUM (raw extraction, no PCC) | diffbot.com/pricing | this session |
| Diffbot | Knowledge Graph entity export | $0.0225–$0.025/entity record | HIGH to company_evidence_graph's multi-entity assembly | diffbot.com/pricing | this session |
| Mistral | OCR (standard) | $4 / 1k pages ($0.004/page); $2/1k batch | HIGH to document_evidence_json's OCR tier, LOW on structured-evidence/PCC | mistral.ai/pricing/api/ | this session |
| Mistral | Document AI | $5 / 1k pages ($0.005/page) | HIGH | mistral.ai/pricing/api/ | this session |
| AWS Textract | Detect Document Text | $0.0015/page (first 1M/mo) | HIGH (raw OCR) | aws.amazon.com/textract/pricing | this session (page's own worked example) |
| AWS Textract | Analyze Document (Tables) | ~$0.015/page (AWS's long-published standard rate) | MEDIUM — **not independently re-fetched this session** (interactive pricing widget didn't render as extractable text); cited from stable, widely-published AWS rate card, flagged lower-confidence than the other rows | aws.amazon.com/textract/pricing | general knowledge cross-reference, not a fresh fetch |

None of these vendors sign a PCC receipt, provide SSRF/DNS-rebinding-hardened
fetch, IP pinning, redirect validation, page-level provenance, or a verified
evidence graph — the task's own §15/§21/§22 instruction not to race raw
fetch/OCR vendors to zero is directly supported by this research: every
SITEBORNE price above already sits meaningfully above these raw-extraction
baselines, which is the *correct* posture for a verification-plus-provenance
product, not a defect to fix.

`verify_agent_output.v2` has no clean 1:1 market comparable in this pass (an
independent-verification-of-agent-output category, not raw search/OCR); no
forced comparison was made.

### Cost model (Cloudflare rates confirmed live this session)

- Workers Standard: $0.30/M requests + $0.02/M CPU-ms beyond the included
  10M requests/30M CPU-ms — at these volumes, marginal cost per request is on
  the order of $0.000001–$0.000002 (negligible).
- D1: $0.001/M rows read, $1.00/M rows written — a payment lifecycle (~10-20
  rows) costs on the order of $0.00001–$0.00002 (negligible).
- Workflows: $0.80 per additional 100k steps ($0.000008/step) — an 8-step
  payment workflow costs ~$0.00006 (negligible).
- CDP/facilitator settlement fee: **$0.001/tx** after the free monthly
  allotment — confirmed from this repo's own `docs/decisions/0004-
  replacement-cost-pricing.md` ("Free capacity backtest ... facilitator
  charges $0.001/tx after 1000 free/month"). This is the single largest fixed
  per-transaction cost component across every service.
- Modal (document worker) compute: **not independently re-priced this
  session** — `document_evidence_json.v2` has no deployed production
  composition to measure real invocation time/cost against (§6/§8), so any
  Modal-cost figure here would be speculative. Explicitly deferred.

Governance already establishes `target_gross_margin: 0.70` /
`minimum_accepted_margin: 0.60` (`governance/RISK_LIMITS.yaml`,
`docs/decisions/0004-replacement-cost-pricing.md`) — a stricter, already-
established, evidence-based threshold than this checkpoint's own 55% default
floor, per §17's own escape clause ("unless a better evidence-based
unit-economic threshold is established"). **This checkpoint uses the
existing 60%/70% governance thresholds, not 55%.**

Applying Cloudflare-platform + facilitator-fee costs against each currently
served price (Workers/D1/Workflow overhead is uniformly negligible at these
prices, so the facilitator fee dominates cost for the already-real services):

- `web_context_verified.v2` @ $0.009: P95 variable cost ≈ $0.001 (facilitator)
  + Modal safe-egress overhead (already-qualified architecture, not
  re-measured this session) ≈ **$0.002-0.003 P95** → margin ≈ **67-78%**.
  Clears the governance floor with a comfortable cushion. The §18 hypothesis
  of $0.008 was evaluated and **not adopted** — it would still clear 60% but
  with materially less safety margin, and no fresh market or cost evidence
  from this session's research specifically supports moving off the current,
  already-validated price. **Recommendation: keep $0.009 (9,000 atomic)
  unchanged.**
- `verify_agent_output.v2` @ $0.019 (standard tier): the "standard" contract
  (`AGENT_INPUT` fixture: a deterministic `claims[]`/`predicate`/
  `expected_value` check against `candidate_output`) is closer to
  deterministic claim validation than a full independent LLM re-run — real
  cost is dominated by the $0.001 facilitator fee plus trivial compute,
  **P95 ≈ $0.0015**, margin ≈ **92%**, well above target. The §18 hypothesis
  of $0.017 was evaluated and **not adopted** for the same reason as above:
  no fresh evidence this session specifically supports it, and the current
  price already clears target margin with room to spare.
  **Recommendation: keep $0.019 (19,000 atomic) unchanged.**
- `company_evidence_graph.v2` @ $0.039: underlying data sources (SEC EDGAR,
  Federal Register) are free US-government APIs; real cost is expected to be
  dominated by the facilitator fee plus Worker compute for whatever fan-out
  actually gets implemented — **provisional only**, no real production
  executor exists to measure true fan-out cost against (§6, §20's own concern
  about unbounded fan-out cost applies directly here and cannot be closed
  without the real executor). Diffbot's KG-entity-export comparable
  ($0.0225-0.025/entity, HIGH comparability) suggests $0.039 is *not*
  overpriced for multi-entity assembly. **Recommendation: no price change
  now; freeze final pricing to the SUN-1222B-S3-REMEDIATION checkpoint that
  builds the real executor, when real fan-out cost is measurable.**
- `document_evidence_json.v2`: no real production executor exists (§8);
  Mistral OCR ($0.004/page)/Textract ($0.0015/page raw, ~$0.015/page tables)
  suggest the current native/OCR/table tiers ($0.012/$0.019/$0.029) are not
  unreasonable relative to raw-vendor rates, but **real Modal/worker compute
  cost is entirely unmeasured** — pricing here is the least evidence-backed
  of the four. **Recommendation: same as company graph — freeze final
  pricing to the remediation checkpoint.**

No live price was changed. `governance/RISK_LIMITS.yaml` was not edited.

## 25. Crypto/JWS release gate

Two independent signing systems, both well-scoped:

- **Agent Card**: ES256/P-256 JWK (`packages/protocol-a2a/src/signing.ts`),
  imported as a non-extractable `CryptoKey`, structurally validated
  (`kty`/`crv` pinned), fails closed on partial config or invalid key
  (`agent-card-signing.ts`). 14 tests (`signing.test.ts`).
- **PCC receipt**: Ed25519 via `@noble/ed25519`
  (`packages/verification/src/receipt/signer.ts`), explicitly documented as
  test/local key material — no production secret storage implemented (out of
  scope per its own header). 15 tests including tamper-evidence detection
  (mutated `decision`/`output_hash`/other fields all correctly rejected).

Both fail closed on malformed input, neither key is ever logged, no secret
rotation performed. No production signing key has actually been provisioned
for either system yet (both fall back to ephemeral/local identities in
production today) — that is a deployment **prerequisite**, not a code defect.
`CRYPTO_JWS_RELEASE_GATE` = **PASS**.

## 26. Supply-chain release gate

`pnpm audit --audit-level=high`: 78 advisories (0 critical, 29 high, 40
moderate, 9 low). Cross-referenced against what actually reaches the deployed
Worker bundle (`apps/edge-api`'s own `dependencies`, never `devDependencies`):

- The overwhelming majority (vite/vitest/rollup/esbuild/turbo/eslint/
  @opentelemetry/*/wrangler/miniflare/sharp/undici/js-yaml) are confirmed
  **dev-only** via `pnpm why` — miniflare/wrangler transitively pull sharp
  and undici, never `apps/edge-api`'s own dependency tree. None reach the
  production bundle.
- `ajv@8.17.1` (moderate, ReDoS via the `$data` option) **is** a real
  `apps/edge-api` runtime dependency — but `$data: true` is never set
  anywhere in this codebase (verified by grep); the vulnerable code path is
  unreachable as used.
- `yaml` (moderate) **is** a real `service-prices.ts` dependency, but its
  only call site (`loadRiskLimits()`'s filesystem branch) is provably
  unreachable in a deployed Worker (no filesystem access — always falls
  through to `EMBEDDED_PRICING`); bundled but dead code at runtime.
- Lockfile integrity: continuously verified by CI's own
  `pnpm install --frozen-lockfile` first step on every push/PR.
- `.npmrc`: `save-exact = true`, `strict-peer-dependencies = true`,
  `engine-strict = true` — good baseline hygiene. No explicit
  `onlyBuiltDependencies` allowlist found; not independently confirmed
  whether pnpm 9's default install-script policy is restrictive enough here
  — flagged as a minor (P3) follow-up, not asserted either way.

`SUPPLY_CHAIN_RELEASE_GATE` = **PASS**, with the 78 advisories as an accepted
residual finding (0 critical, confirmed dev-only or confirmed-unreachable for
every high/moderate finding actually traced).

## 27. CI/release-gate enforcement

`.github/workflows/ci.yml`'s `check` job (merge-blocking, `needs: [validate,
python-validate, secret-scan]`) already enforces: format, lint, typecheck,
`vitest run` (repo-root, covers all TS packages), governance/state/tasks
validation, adapters/verification/service-runtime package checks, Python
ruff/mypy/pytest, gitleaks. Real, honest, deliberate gap: `security-release`
(Semgrep/OSV-Scanner/Trivy) is explicitly excluded from `check`'s `needs`
with a documented reason (real unremediated findings exist,
`docs/reports/SUN-1000-checkpoint-1b-security-scanner-integration.md`).
Not independently re-verified this session: whether `protocol-mcp`/
`protocol-x402`/`protocol-a2a`'s own fuller package-level `check` scripts
(`build`, `test:property`'s dedicated fast-check config, `spec:verify`/
`fixtures:verify`) run as distinctly in CI as they do under `pnpm check` —
the root `vitest run` step does pick up the property-test *files* under its
default config, just not necessarily the property-specific run-count config.
No CI redesign attempted (per this checkpoint's own instruction to close only
high-value gaps, not redesign unnecessarily) — a `wrangler deploy --dry-run`
CI step is a plausible future high-value addition, not added here since it
cannot be verified working without real Cloudflare credentials in a CI
context this session cannot test.
`CI_RELEASE_GATES` = **PARTIAL**.

## 28. Secrets — reconfirmed clean

`pnpm secrets:scan`: both `gitleaks git .` (643 commits) and
`gitleaks dir .` phases report `no leaks found`; working-tree scan OK across
1291 tracked/non-ignored-untracked files. No STOP condition triggered.

## 29-31. Discovery/MCP/A2A four-service contracts

`ALL_FOUR_DISCOVERY_COHERENT` = **NO** — company_evidence_graph.v2 and
document_evidence_json.v2 cannot honestly claim `ACTIVE`/production-ready
discovery status while no production executor exists for them; the
`hasProductionExecutor: false` self-report (§1) is itself the *correct*,
truthful behavior, not a bug — but it means four-service coherence genuinely
isn't reached yet, by design of the underlying system being honest about its
own state.
`MCP_FOUR_SERVICE_CONTRACT` = **PASS** (all four tool→service.v2 mappings
verified exact, §3; 33/33 protocol-mcp tests green, including the
6-`SERVICE_TOOL_MATRIX`-parameterized `it.each` in `transport.test.ts`).
`A2A_FOUR_SERVICE_CONTRACT` = **PASS** (all eight skill IDs intact, JWS
verifies, 14/14 signing tests + fixtures/property tests green).

## 32, 34. Local E2E and full repository gate

`COMPANY_GRAPH_LOCAL_E2E` / `DOCUMENT_EVIDENCE_LOCAL_E2E` = **N/A** (no
production composition to exercise — the fixture-mode composition's own
tests passing is not the same claim; see §6/§8).
`WEB_CONTEXT_LOCAL_E2E` / `VERIFY_OUTPUT_LOCAL_E2E` = **PASS**.

Full gate, rerun at the end of this checkpoint, at HEAD `b75d91f`:

- Typecheck: **23/23**
- Build: **12/12**
- Lint: **16/16**
- Tests: **216/216 files, 2622/2622 non-skipped tests, 74 intentional skips**
  (includes SSRF (`http-ssrf.test.ts`, 12 tests) and DNS-rebinding
  (`dns-rebinding.test.ts`, 21 tests), both green; x402 replay/idempotency
  (`replay/idempotency.test.ts`, `replay/binding.test.ts`), both green)
- `protocol-mcp` package `check`: **PASS** (format+lint+typecheck+build+
  test+test:property+spec:verify)
- `protocol-x402` package `check`: **PASS**
- `protocol-a2a` package `check`: **PASS**
- Secrets scan: **clean**
- `wrangler deploy --dry-run` (apps/edge-api): **clean**

## 33. Genuine RED/GREEN proofs this checkpoint

1. Post-settlement `pcc undefined` regression test (§11): guard removed →
   RED (`canonical-json returned undefined`, unhandled) → guard restored →
   GREEN (31/31).
2. Registry pricing-drift script (§23): ran against the real repo state →
   immediately RED on `company_evidence_graph` (v1 and v2) — proves the
   script actually detects the class of defect it exists to catch, not just
   a script that trivially passes.

## 35. Buyer qualification funding (read-only)

Live, read-only `eth_call` to Base mainnet (chain id `0x2105` = 8453,
confirmed) USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
`balanceOf` on the controlled buyer address
`0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` (from
`docs/reports/SUN-1220N-live-domain-metadata-402-qualification.md`, "Buyer
address ... cross-checked"). No transfer, no signature, no write call.

`QUALIFICATION_BUYER_BALANCE_ATOMIC` = **19,197** (0.019197 USDC).

Using the smallest representative paid request per service at **current,
unchanged** frozen economics (company graph and document evidence prices are
provisional per §14-24, but still the only numbers that exist to plan
against):

| Service | Smallest qualifying price | Atomic |
|---|---|---|
| `company_evidence_graph.v2` | $0.039 | 39,000 |
| `web_context_verified.v2` | $0.009 (direct) | 9,000 |
| `document_evidence_json.v2` | $0.012 (native, smallest tier) | 12,000 |
| `verify_agent_output.v2` | $0.019 (standard) | 19,000 |

`FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC` = **79,000** (0.079 USDC).
`QUALIFICATION_HEADROOM_ATOMIC` = **-59,803** (negative — insufficient).
`ADDITIONAL_FUNDING_REQUIRED_ATOMIC` = **59,803** (0.059803 USDC minimum;
practically more once gas/facilitator overhead is included). Prices were not
lowered to fit the wallet, per instruction.

Two of the four qualification payments (company graph, document evidence)
cannot happen at all yet regardless of funding — no production executor to
qualify (§1).

## 38. Immutable candidate manifest (designed, not built or uploaded)

`CANDIDATE_SOURCE_HEAD` = `b75d91f` (this checkpoint's own HEAD once this
report is committed).
`CANDIDATE_COMMITS` = `88078b9` (MCP legacy fix) through `b75d91f` (this
report) — 13 commits, spanning SUN-1222B/S2/S3.
`CANDIDATE_CONFIG_CHANGES` = none live (repo-only throughout; the two new
`pnpm` script aliases — `pricing:registry:check` — are dev tooling, not
runtime config).
`CANDIDATE_SECRET_CHANGES` = none.
`CANDIDATE_D1_MIGRATIONS` = none.
`CANDIDATE_PUBLIC_BEHAVIOR_CHANGES` = MCP legacy-handshake interop (fix,
currently undeployed), A2A `productionEnabled` correction (fix, currently
undeployed), Agent Card skill name/description normalization (currently
undeployed).
`CANDIDATE_ECONOMIC_CHANGES` = **none** — no price was changed; company
graph/document evidence pricing is explicitly deferred, not frozen.

This candidate is **not deploy-ready** — see §40.

## 39-40. Deployment blockers

`FOUR_SERVICE_DEPLOY_READY` = **NO**. Exact remediation, in priority order:

1. Build a real, Worker-reachable production composition for
   `company_evidence_graph.v2` (real `InjectedHttpClient` reaching SEC
   EDGAR/Federal Register live, bounded fan-out per §20, mounted route in
   `index.ts`, gated the same two-level way `verify`/`web_context` already
   are).
2. Build the equivalent for `document_evidence_json.v2` (HTTP bridge to a
   deployed OCR/table worker — Modal or equivalent — mirroring
   `web_context_verified.v2`'s own off-Cloudflare egress architecture;
   `SubprocessDocumentWorkerBridge` cannot run in a Worker).
3. Once both exist, measure real P50/P95 variable cost against them and
   freeze final company-graph/document pricing (§14-24 explicitly deferred
   this).
4. Resolve the `company_evidence_graph` registry `maximum_price: 0.19`
   governance question (§23) — either correct the registry JSON or wire
   `pricing:registry:check` into blocking `pnpm check` once resolved.
5. Fund the qualification buyer wallet by at least 59,803 atomic units
   (§35) before any live four-service qualification round.

`NEXT_REQUIRED_CHECKPOINT` = **SUN-1222B-S3-REMEDIATION**.

## 42. Final packet

```
SUN1222B_S3=PARTIAL
S3_START_HEAD=fc800bd
S3_END_HEAD=b75d91f

SERVICE_TOOL_MATRIX_V2_EXACT=PASS

COMPANY_V2_REAL_EXECUTOR=NO
WEBCTX_V2_REAL_EXECUTOR=YES
DOCUMENT_V2_REAL_EXECUTOR=NO
VERIFY_V2_REAL_EXECUTOR=YES

COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE=N/A (unreachable in production, no route exists)
WEBCTX_V2_PRODUCTION_FIXTURE_REACHABLE=NO
DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE=N/A (unreachable in production, no route exists)
VERIFY_V2_PRODUCTION_FIXTURE_REACHABLE=NO

COMPANY_GRAPH_LOCAL_E2E=N/A (no production composition to exercise)
WEB_CONTEXT_LOCAL_E2E=PASS
DOCUMENT_EVIDENCE_LOCAL_E2E=N/A (no production composition to exercise)
VERIFY_OUTPUT_LOCAL_E2E=PASS

TRUST_CLASS_MATRIX_COMPLETE=YES
PRODUCTION_EXTERNAL_ACCEPTED=YES
PRODUCTION_FIXTURE_REJECTED=YES

POST_SETTLEMENT_FAIL_CLOSED_MATRIX=PASS

PUBLIC_API_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1

ALL_FOUR_X402_FAIL_CLOSED=YES
PRICE_SINGLE_SOURCE_OF_TRUTH=NO (real gap found, drift-guard script shipped, one pre-existing finding surfaced, not yet blocking pending governance decision)

COMPANY_EVIDENCE_GRAPH_V2_PRICE_USDC=0.039 (unchanged, provisional pending real executor)
COMPANY_EVIDENCE_GRAPH_V2_AMOUNT_ATOMIC=39000
COMPANY_EVIDENCE_GRAPH_V2_MARKET_DISCOUNT_PERCENT=0 (no change made)
COMPANY_EVIDENCE_GRAPH_V2_P95_VARIABLE_COST=unmeasured (no real executor)
COMPANY_EVIDENCE_GRAPH_V2_P95_MARGIN_PERCENT=unmeasured

WEB_CONTEXT_VERIFIED_V2_PRICE_USDC=0.009 (unchanged)
WEB_CONTEXT_VERIFIED_V2_AMOUNT_ATOMIC=9000
WEB_CONTEXT_VERIFIED_V2_MARKET_DISCOUNT_PERCENT=0 (no change made; evaluated $0.008 hypothesis, not adopted)
WEB_CONTEXT_VERIFIED_V2_P95_VARIABLE_COST=~$0.002-0.003 (facilitator fee dominant, confirmed $0.001/tx)
WEB_CONTEXT_VERIFIED_V2_P95_MARGIN_PERCENT=~67-78%

DOCUMENT_EVIDENCE_JSON_V2_PRICING_MODEL=unchanged (native/OCR/table/max_job tiers)
DOCUMENT_EVIDENCE_JSON_V2_PRICE_TABLE=0.012/0.019/0.029/0.19 (unchanged, provisional)
DOCUMENT_EVIDENCE_JSON_V2_MARKET_DISCOUNT_RANGE=0 (no change made)
DOCUMENT_EVIDENCE_JSON_V2_P95_VARIABLE_COST_RANGE=unmeasured (no real executor)
DOCUMENT_EVIDENCE_JSON_V2_P95_MARGIN_RANGE=unmeasured

VERIFY_AGENT_OUTPUT_V2_PRICE_USDC=0.019 (unchanged)
VERIFY_AGENT_OUTPUT_V2_AMOUNT_ATOMIC=19000
VERIFY_AGENT_OUTPUT_V2_MARKET_DISCOUNT_PERCENT=0 (no change made; evaluated $0.017 hypothesis, not adopted)
VERIFY_AGENT_OUTPUT_V2_P95_VARIABLE_COST=~$0.0015 (facilitator fee dominant)
VERIFY_AGENT_OUTPUT_V2_P95_MARGIN_PERCENT=~92%

CRYPTO_JWS_RELEASE_GATE=PASS
SUPPLY_CHAIN_RELEASE_GATE=PASS (78 advisories, 0 critical, all high/moderate traced to dev-only or confirmed-unreachable)
CI_RELEASE_GATES=PARTIAL (security-release job intentionally non-blocking, documented; property-test-config coverage in CI not independently reverified)

MCP_FOUR_SERVICE_CONTRACT=PASS
A2A_FOUR_SERVICE_CONTRACT=PASS
ALL_FOUR_DISCOVERY_COHERENT=NO (truthfully — 2 of 4 have no production executor to be coherent about)

TYPECHECK=23/23
BUILD=12/12
LINT=16/16
TEST_FILES=216/216
TESTS_PASS=2622/2622 non-skipped
TESTS_SKIPPED=74 (intentional, live-gated)
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
WORKER_RUNTIME=clean (wrangler deploy --dry-run)
SSRF_DNS_REBINDING=PASS (33 tests: 12 SSRF + 21 DNS-rebinding)
X402_REPLAY_CONCURRENCY=PASS (replay/idempotency.test.ts, replay/binding.test.ts, part of 216/216)
SECRETS_SCAN=clean
PRODUCTION_PREFLIGHT=clean
WRANGLER_DRY_RUN=clean

QUALIFICATION_BUYER_BALANCE_ATOMIC=19197
FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=79000
QUALIFICATION_HEADROOM_ATOMIC=-59803
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=59803

FOUR_SERVICE_DEPLOY_READY=NO

CANDIDATE_SOURCE_HEAD=b75d91f
CANDIDATE_COMMITS=88078b9..b75d91f (13 commits)
CANDIDATE_SECRET_CHANGES=none
CANDIDATE_D1_MIGRATIONS=none
CANDIDATE_ECONOMIC_CHANGES=none

PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0

S3_EVIDENCE_COMMIT_SHA=<this file's own commit, immediately following>
WORKING_TREE=clean

NEXT_REQUIRED_CHECKPOINT=SUN-1222B-S3-REMEDIATION
```

DO NOT DEPLOY. DO NOT UPLOAD A CANDIDATE. DO NOT CHANGE LIVE PRICES. DO NOT
ACTIVATE LIVE SERVICES. DO NOT CREATE PAYMENT MATERIAL. — none of these were
done.
