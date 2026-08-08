# SUN-0300 — Credential-Independent Public-Data Adapters — Completion Report

## Summary

SUN-0300 implements six credential-independent provider adapters (SEC EDGAR
submissions, SEC EDGAR company facts, OpenAlex, Crossref, GitHub public, direct
public HTTP), a source-shape drift detector, a machine- readable fixture
behavior matrix, terms/rate/cache/circuit enforcement, SSRF protection, RFC 7231
`Retry-After` handling, real `fast-check` property tests, and six
disabled-by-default optional live smoke gates. Production remains disabled; no
provider is `production_verified`; paid services remain `not_implemented`.

## Audit correction: prior test stubs were invalid

An earlier pass of this task left `src/tests/*.tests.ts` (adapter execution,
SSRF, terms/rate/cache/circuit, fast-check, live-gates) as non-functional stubs:
syntax errors that failed to compile, `{} as any` fake dependencies that would
throw at runtime if actually executed, and `expect(true).toBe(true)` placeholder
assertions. They were never exercised — the package's own `vitest`/`tsc` never
ran clean against them.

This completion run replaced all five files with real tests that call each
adapter's public `execute()` through injected fake clocks, HTTP clients,
artifact stores, and audit sinks (zero real network calls; zero real sleeping;
deterministic under fake time). Running the _real_ tests against the _real_
source surfaced five genuine defects, all fixed in this same pass:

1. **IPv6 SSRF gap** — `validateUrl()` only ever validated the IPv4 branch;
   `::1`, `fe80::/10`, `fc00::/7` (both halves), and IPv4-mapped IPv6 literals
   passed unchecked. Fixed in `policy/network-policy.ts`.
2. **Dropped `warnings`/`limitations`** in the OpenAlex, Crossref, and Federal
   Register adapters — computed inside `fetchAndNormalize()` but discarded at
   the return site in favor of hardcoded arrays (GitHub's adapter did not have
   this bug). Fixed in all three.
3. **SEC company-facts empty-array filter bug** — an empty
   `concepts`/`taxonomies` array (meant as "no filter") matched nothing instead
   of everything, inconsistent with the existing `forms` array convention.
   Fixed.
4. **A real ~3s sleep** in `rate-limit/limiter.test.ts`'s backoff test despite
   an injected clock. Fixed to resolve via the fake clock.
5. **Root/package script bugs**: a self-referential `adapters:test` infinite
   loop, duplicate `package.json` keys, a nonexistent `secret-scan` binary, and
   a missing `vitest.property.config.ts` / package-local `vitest.config.ts`.
   Fixed.

No acceptance claim in this report, or in `PROJECT_STATE.yaml`/ `TASKS.yaml`,
relies on the prior stub tests.

## Drift implementation

`packages/provider-adapters/src/drift/{types,shape,compare,classify,index}.ts`.
See [ADR 0005](../adrs/0005-source-drift-and-quarantine.md) for the full design.
Covers the required change classifications (optional field added, required field
missing, field type changed, array/object shape changed, enum-like value
changed, pagination shape changed, identifier/timestamp format changed, wrapper
added/removed, content-type changed, excessive nesting, result-item shape
changed) with dedicated cases for SEC submissions, SEC company facts, OpenAlex,
Crossref, GitHub, and Federal Register (`src/drift/drift.test.ts`, 19 tests;
`src/drift/provider-drift.test.ts`, 13 tests).

## Fixture behavior matrix

`packages/provider-adapters/fixtures/FIXTURE_MATRIX.yaml` — 103 scenario rows
across 11 categories (common, sec_company_facts, terms, rate_limit,
circuit_breaker, cache, ssrf, drift, property, live_gate, html_runtime),
cross-checked by `scripts/verify-fixture-matrix.ts`
(`pnpm --filter @siteborne/provider-adapters run fixture-matrix:verify`, folded
into `fixtures:verify`), which fails the build if a scenario_id is duplicated,
an `expected_result_class` isn't a valid closed `AdapterResultClass`, a
referenced fixture file doesn't exist, or a referenced test file doesn't contain
a matching `it(...)`. Verified against an injected negative case (a scenario row
with a deliberately-nonexistent test anchor) to confirm the check actually fails
when coverage is missing.

**Not covered**: the original completion-plan's full exhaustive scenario list
(e.g. SEC malformed-accession/former-names rows individually, HTTP
compressed/decompressed-size-overflow rows, GitHub renamed-repository metadata,
Crossref ambiguous bibliographic search) is broader than what exists as
executable tests today. The matrix intentionally only contains rows grounded in
a real, passing test — it does not claim coverage ahead of its test.

## Test accounting

### TypeScript (root `pnpm test`)

**536 passed, 6 skipped, 542 total, across 27 test files.** This is the
whole-monorepo Vitest run; SUN-0300's tests are included in this total, not
additional to it.

### SUN-0300 (subset of the above; `pnpm adapters:test`)

**170 passed, 6 skipped, 176 total, across 10 test files:**

| File                                         | Tests          |
| -------------------------------------------- | -------------- |
| `src/sec/identifiers.test.ts`                | 17             |
| `src/drift/drift.test.ts`                    | 19             |
| `src/drift/provider-drift.test.ts`           | 13             |
| `src/tests/http-ssrf.test.ts`                | 31             |
| `src/tests/terms-rate-cache-circuit.test.ts` | 33             |
| `src/tests/live-gates.test.ts`               | 12 (6 skipped) |
| `src/tests/adapter-execution.test.ts`        | 20             |
| `src/rate-limit/limiter.test.ts`             | 10             |
| `src/tests/fast-check.test.ts`               | 16             |
| `src/html/html-worker-runtime.test.ts`       | 5              |

### Python

- PCC/contracts (`pnpm python:test:pcc`): **91 passed**.
- modal-worker (`pnpm python:test:modal`): **7 passed**.

### Non-unit assertions (kept separate from the unit-test counts above)

- Fixture matrix (`fixture-matrix:verify`): 103/103.
- Fixture verification (`fixtures:verify`, legacy check): 11/11.
- Manifest verification (`manifests:verify`): 6/6.
- Governance validation: 77/77.
- State validation: 28/28.
- Task validation: 209/209.
- `pnpm pcc:generate:check` / `services:generate:check` /
  `openapi:generate:check`: no drift.
- Contracts baseline/compat/release verify: pass.
- Migrations verify / D1 test: pass, temp dirs cleaned up.
- Secret scan (`gitleaks`): no leaks found; confirmed it correctly fails against
  an injected fake secret in an isolated `/tmp` negative test, with no residue
  left afterward.

## TermsGuard, rate/retry, cache, circuit breaker, SSRF

Covered in `src/tests/terms-rate-cache-circuit.test.ts` (33 tests) and
`src/tests/http-ssrf.test.ts` (31 tests). Highlights:

- Terms: `test` mode bypasses the guard entirely; `live` mode with no recorded
  review, a `pending_review` review, or a `blocked` review all return
  `policy_blocked` with **zero** network calls; a changed `terms_hash` re-blocks
  a previously-verified provider.
- Retry-After: RFC 7231 delta-seconds and HTTP-date forms are both parsed
  (`rate-limit/backoff.ts:parseRetryAfterMs`) via the injected clock — a past
  date resolves to an immediate retry (0ms), a malformed value falls back to
  bounded exponential backoff, and both forms are capped at the configured
  maximum. No real sleeping in any test.
- Cache: key canonicalization is order-independent for canonicalized input;
  positive TTL, explicit-miss-on-expiry, LRU eviction, and not-cached-as-absence
  for `invalid_request`/`policy_blocked` are all tested with a fake clock.
- Circuit breaker: closed→open→half_open→closed and half_open-failure→open
  transitions are tested, plus per-instance independence.
- SSRF: see the [Public HTTP Security Guide](../guides/public-http-security.md)
  for the full validated/tested vs. not-yet-proven breakdown. In short: URL and
  IP-literal validation (IPv4, IPv6, IPv4-mapped IPv6) and redirect revalidation
  are implemented and tested; DNS-answer validation and connection pinning /
  DNS-rebinding protection are not implemented, and production execution of
  arbitrary caller URLs stays disabled until they are.

## HTMLRewriter production path / JSDOM test-only role

See `packages/provider-adapters/PARSER_PARITY.md` for the full behavior
comparison. In summary: `createWorkerHtmlParser()` is the sole production path
and throws explicitly (`WorkerHtmlRewriterUnavailableError`) rather than
silently falling back to JSDOM when `HTMLRewriter` is unavailable.
`src/html/html-worker-runtime.test.ts` proves this against a local Miniflare
Workers runtime (5 tests). JSDOM (`createNodeHtmlParser()`) is reachable only
from the Node test runtime and throws (`JSDOMInProductionError`) if invoked
outside it.

## Fast-check properties

**16 real property tests** (`src/tests/fast-check.test.ts`), each a genuine
`fc.assert(fc.property(...))` / `fc.assert(fc.asyncProperty(...))` call against
real package functions — none are example tests mislabeled as properties. 15
properties run fast-check's default 100 cases each; the HTML normalization
stability property runs 5 (JSDOM parse cost), for **1,505 total generated
cases** across the suite. No fixed seed is pinned; a failing case is shrunk and
reported by fast-check itself with a reproducible seed in the failure output.
Zero properties currently skipped. Covers: CIK/accession normalization
idempotence, invalid-CIK rejection, cache-key canonicalization and sensitivity,
SSRF policy over generated prohibited IPv4 addresses, backoff cap/monotonicity,
rate-limiter token non-negativity, circuit-breaker state-machine closure,
content-hash identity/sensitivity, HTML normalization stability,
evidence-locator determinism, SEC decimal-fact string preservation, and SEC
company-facts result-array bounds under a generated concept allow-list.

One earlier draft of two properties used `fc.string().filter(...)` with a
near-zero acceptance predicate (an "all-digits" or "all-letters" filter over a
general-alphabet string generator), which made fast-check spin effectively
forever trying to satisfy the filter. Both were rewritten to use dedicated
digit/letter generators instead of filtering a general string.

## Optional live gates

Six gates (`RUN_LIVE_SEC`, `RUN_LIVE_OPENALEX`, `RUN_LIVE_CROSSREF`,
`RUN_LIVE_GITHUB_PUBLIC`, `RUN_LIVE_FEDERAL_REGISTER`, `RUN_LIVE_PUBLIC_HTTP`),
all disabled by default (`src/tests/live-gates.test.ts`). Because every
manifest's terms review is `pending_review`, the always-on companion assertion
for each gate proves `policy_blocked` with zero network calls even when forced
into `execution_mode: 'live'` — skipped or policy-blocked is the expected and
verified outcome, per design. No credentials are used anywhere in this file.
Manifest terms status was not modified to make any gate run live.

## Per-provider status

Adapter implementation and live activation are recorded as two separate
dimensions, per the source directive. No provider is `production_verified`.

| Provider           | Adapter verification | Live activation  |
| ------------------ | -------------------- | ---------------- |
| SEC EDGAR          | `fixture_verified`   | `policy_blocked` |
| Direct public HTTP | `fixture_verified`   | `policy_blocked` |
| OpenAlex           | `fixture_verified`   | `policy_blocked` |
| Crossref           | `fixture_verified`   | `policy_blocked` |
| GitHub public      | `fixture_verified`   | `policy_blocked` |
| Federal Register   | `fixture_verified`   | `policy_blocked` |

## External blockers

None specific to SUN-0300's own scope. Production activation of any provider
requires (a) a recorded terms review (ADR 0002) and (b), for
`direct-public-http` specifically, DNS-rebinding/connection-pinning protection
(ADR 0004) — both are out of scope for this task and tracked as later,
dependency-safe follow-on work.
