# SUN-1222B-S3 — Company Evidence Graph v2 Price-Governance Boundary

**Result: price-governance implementation PASS; canonical aggregate gate PARTIAL
because of unchanged repository-wide formatting debt.** The bounded code,
economic, protocol, real-workerd, generated-artifact, contract, secret, and
production-preflight gates pass. No Cloudflare, D1, traffic, secret, provider,
402, signing, payment, settlement, or chain mutation occurred.

## 1. Authority and scope

- Start HEAD: `c9672ace65b7019098039d702f3b95ea9e4c980a`.
- Service changed: `company_evidence_graph.v2` only.
- Previous price: `$0.039` / `39,000` atomic Base USDC.
- Implemented experiment price: `$0.0312` / `31,200` atomic Base USDC.
- Atomic delta: `-7,800`.
- Existing policy: `price_change_per_experiment_pct: 20`.
- Exact change: `(39,000 - 31,200) * 100 / 39,000 = 20%`.
- Rejected hypothesis: `$0.023` / `23,000` would be a `41.0256410256%` reduction
  and is outside the one-experiment cap.

The $0.0312 value is the
`OPTIMAL_CURRENT_GOVERNANCE_PERMITTED_SINGLE_STEP_PRICE`; it is not asserted to
be the permanent market-clearing optimum. A possible long-run `$0.023` target
remains a hypothesis requiring fresh evidence and a later, independently
authorized experiment. No automatic staircase is authorized.

## 2. Genuine RED evidence

The initial attempt reused the shared `company_evidence_graph` key. The genuine
pre-fix RED was preserved in `packages/pricing/src/service-prices.test.ts`:

- `isolates the company_evidence_graph.v2 experiment from the frozen v1 price`
  failed because the v2 key did not exist (`UnknownPricingKeyError`) while the
  shared v1 key had been incorrectly changed to `0.0312`.
- Result: 3 failed / 14 passed in the first pricing run.

A second focused RED in `packages/pricing/src/pricing.test.ts` proved the exact
atomic boundary guard was absent: `validateAtomicPriceChange is not a function`
(1 failed / 29 passed). Downstream REDs then showed the old 39,000 value in MCP,
Nevermined, and Bazaar v2 representations. These were actual test failures, not
hypothetical descriptions.

## 3. Economic sources of truth

The two production price authorities are:

1. `governance/RISK_LIMITS.yaml` →
   `financial_limits.max_price_usd_per_service.company_evidence_graph_v2`. This
   is the canonical policy authority and now contains `0.0312`.
2. `packages/pricing/src/service-prices.ts` →
   `EMBEDDED_PRICING.company_evidence_graph_v2`. This is the runtime-safe Worker
   mirror; `pnpm pricing:check` mechanically proves it matches the YAML.

Runtime consumers use the typed `@siteborne/pricing` resolver. The v2 registry
entry is an immutable projection of that resolver. Frozen
`registry/services/*.json` and contract-release snapshots remain historical
contract inputs, not independent current economic authority. Rewriting the
frozen JSON would trigger a correctly enforced major-version contract decision,
so this bounded checkpoint did not do that. The historical, unwired company-v1
maximum remains a separately tracked hardening issue.

The packaged MCP server exposed one real regression during qualification: the
new registry projection invoked pricing during module initialization, and an
installed tarball has no adjacent repository `governance/` directory. The
installed executable therefore exited with `ENOENT`. The pricing loader now uses
its mechanically checked embedded mirror only for `ENOENT`/`ENOTDIR` and still
fails closed for malformed YAML or other I/O errors. The offline packed install
subsequently passed with six tools and governed health/quote behavior.

## 4. Exact boundary and mutation proof

`validateAtomicPriceChange` uses safe integers plus `BigInt` cross
multiplication; floating-point arithmetic is not settlement or policy authority.

| Transition      |              Exact result | Policy result |
| --------------- | ------------------------: | ------------- |
| 39,000 → 31,200 |             20% reduction | ALLOW         |
| 39,000 → 31,199 |          greater than 20% | REJECT        |
| 39,000 → 23,000 |     41.025641…% reduction | REJECT        |
| 39,000 → 39,000 |                        0% | ALLOW         |
| 39,000 → 46,800 |              20% increase | ALLOW         |
| 39,000 → 46,801 | greater than 20% increase | REJECT        |

Mutation proof changed the v2 governed value temporarily to `0.023`. The
service-price and Bazaar checks failed with expected `0.0312`/`31,200` versus
observed `0.023`/`23,000`. The canonical value was restored to `0.0312`, and the
pricing/pricing-service/Bazaar suite returned 62/62 green. The 20% risk cap was
never changed.

## 5. Cross-surface coherence

The new key flows through:

- production CDP composition and v2 paid-route configuration;
- v2 Nevermined declaration and route configuration;
- x402 exact `PaymentRequirements` and quote binding;
- Bazaar discovery and immutable runtime registry projection used by catalog/D1
  service seeding;
- MCP exact/upto quote metadata;
- real-workerd CDP and Nevermined v2 test phases;
- the guarded one-shot company qualification client.

OpenAPI defines the route and schema, not a second price literal. A2A retains
the version-specific service identity and x402 capability metadata; it does not
own settlement arithmetic. Workflow, PCC, and receipt paths consume the
immutable payment requirement/quote binding rather than introducing another
service price. `pricing:registry:check` reports all eight runtime service
entries coherent with governed pricing.

Observed real-workerd evidence:

- CDP `company_evidence_graph.v2` unsigned request: expected `31,200`, observed
  `31,200`.
- Nevermined `company_evidence_graph.v2` unsigned request: expected `31,200`,
  observed `31,200`.
- Whole harness: 99/99 scenarios passed; its live-network phase remained
  disabled.

`company_evidence_graph.v1` remains `$0.039` / `39,000`; all web, document, and
verify prices remain unchanged. `SERVICE_TOOL_MATRIX` remains exactly the four
official v2 service/tool mappings.

## 6. Economic fail-closed proof

Focused x402 tests prove the 31,200 requirement succeeds only with an exact
binding. They reject:

- `31,199` underpayment;
- stale `39,000` amount;
- wrong network;
- wrong asset;
- wrong payee;
- expired authorization.

No payment material was created. Missing/invalid economics do not execute a real
provider. Because the amount changed, any prior 39,000-atomic qualification does
not qualify the final 31,200-atomic candidate. A later immutable candidate needs
a fresh, separately authorized controlled payment qualification.

## 7. Market and margin reconciliation

The closest like-for-like research anchor retained by the S3 analysis is a
knowledge-graph/entity export range around `$0.0225–$0.025`. At `$0.0312`,
SITEBORNE carries a 24.8% premium to the upper `$0.025` anchor (38.67% to
`$0.0225`), justified as an experiment by multi-source assembly, provenance/PCC,
bounded SSRF-safe execution, and receipt evidence. Relative to SITEBORNE's own
current `$0.039`, the experiment is a 20% market-entry discount.

The current S3 replacement-cost model estimates:

- P50 variable cost: approximately `$0.0011`;
- conservative P95 variable cost: approximately `$0.0015`;
- P95 variable gross margin at `$0.0312`:
  `(0.0312 - 0.0015) / 0.0312 = 95.1923077%`.

This exceeds the governed 60% launch floor and 70% target. The figures are model
estimates, not a measured distribution from a new live paid execution.

## 8. Verification evidence

- Targeted pricing/protocol/composition GREEN: 8 files, 142/142 tests.
- Post-packaging correction focus: 4 files, 100/100 tests.
- Mutation-restoration focus: 3 files, 62/62 tests.
- Root Vitest: 227 passed files, 22 skipped; 2,785 passed tests, 77 skipped.
- Typecheck: 23/23 packages PASS.
- Build: 12/12 packages PASS.
- Lint: 16/16 packages PASS.
- x402: 512/512 protocol tests + 20/20 property tests + fixture baseline PASS.
- MCP: 47/47 protocol tests (twice in property mode), 5/5 edge tests, 1/1
  package test, offline packed install PASS.
- A2A: 46/46 protocol + 6/6 property + 2/2 edge PASS.
- Nevermined: 243/243 protocol; compatibility 166 passed / 2 intentional skips.
- Worker runtime: 99/99 PASS.
- PCC Python: 91/91 PASS.
- Modal/document Python: 88/88 PASS.
- Provider adapters: 308 passed / 6 skipped, 16/16 property, 103/103 fixture
  matrix.
- Service runtime: 165/165, 3/3 property, 18/18 fixtures.
- Verification: 86/86, 3/3 property, five fixtures.
- Generated PCC, service models, OpenAPI, validators: no drift.
- Governance: 77/77 validations PASS; risk cap remains 20.
- Contracts, migrations, D1, production preflight: PASS.
- Secret scan: 675 commits and 1,335 tracked/non-ignored working-tree files; no
  leaks.
- Wrangler 4.119.0 dry-run: PASS, 6,421.63 KiB / 1,054.50 KiB gzip; no upload.

The canonical `pnpm check` is not green because its first root-wide
`prettier --check .` reports 449 pre-existing files, including nested historical
worktrees and unrelated main-worktree files. The same formatting baseline also
prevents the wrapper forms of `control-plane:check`, `adapters:check`, and
`services-runtime:check` from completing, although their substantive lint,
typecheck, test, property, fixture, and manifest components were run explicitly
and passed. Every file changed by this price checkpoint passes focused Prettier.
The checkpoint did not add ignores or mass-format unrelated history.

## 9. Mutation accounting and disposition

```text
PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
WORKER_VERSION_UPLOADS=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
SECRET_MUTATIONS=0
PRODUCTION_D1_MUTATIONS=0
LIVE_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS=0
PAYMENT_SIGNATURES=0
PAID_REQUESTS=0
SETTLEMENTS=0
ECONOMIC_TRANSACTIONS=0
```

The bounded price implementation is ready, but the broader four-service S3
readiness checkpoint remains unfinished and the canonical aggregate format gate
is still red. The next repo-only boundary is `CONTINUE-SUN-1222B-S3`; it is not
candidate upload or deployment.
