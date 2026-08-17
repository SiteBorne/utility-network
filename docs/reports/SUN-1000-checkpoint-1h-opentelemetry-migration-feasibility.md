# SUN-1000 Checkpoint 1H — OpenTelemetry Migration Feasibility

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`df42de1` (Checkpoint 1G — Trivy `FAIL_INTERNAL`, CRITICAL=0, HIGH=3, all
OpenTelemetry). **This checkpoint is feasibility/migration-design only.** Zero
dependency, lockfile, override, or source mutation. No Schemathesis, chaos, or
load work, no scanner policy change, no production action, no Nevermined/CDP
mutation.

## 0. Credential safety

No provider credentials required. Guard/credential presence checked via
`SET`/`MISSING` output only. The CDP sandbox rotation requirement remains open,
unaffected, not inspected here.

## 1. Baseline

`git status --short` empty, `HEAD = df42de1`. `pnpm security:semgrep` PASS.
`pnpm security:osv` PASS, CRITICAL=0. `pnpm security:trivy` (via the accepted
external cache): **14 total, CRITICAL=0, HIGH=3, MEDIUM=9, LOW=2** — matches
Checkpoint 1G exactly, no material difference. `pnpm secrets:scan`,
`governance:validate`, `state:validate`, `tasks:validate`, full `pnpm check` —
all exit 0.

## 2. Checkpoint 1G frozen

Not reopened: `axios`, `lodash`, `path-to-regexp`, `base-x`, `fast-uri`, `glob`
remediations. Not changed: `vitest@3.2.7`, the `jsdom>form-data` override,
Semgrep policy, OSV's CRITICAL-only policy, Trivy's `{CRITICAL, HIGH}` blocking
policy. The frozen remaining issue is exactly one coupled OpenTelemetry
dependency family.

## 3. The three remaining HIGH findings (re-verified from live Trivy JSON)

| Advisory         | Package                              | Installed | Fixed     |
| ---------------- | ------------------------------------ | --------- | --------- |
| `CVE-2026-44902` | `@opentelemetry/exporter-prometheus` | `0.203.0` | `0.217.0` |
| `CVE-2026-59892` | `@opentelemetry/propagator-jaeger`   | `2.0.1`   | `2.9.0`   |
| `CVE-2026-44902` | `@opentelemetry/sdk-node`            | `0.203.0` | `0.217.0` |

Identical to Checkpoint 1G's findings — same advisories, same versions.

## 4. Complete OpenTelemetry graph (real `pnpm why` evidence)

`@traceloop/node-server-sdk` is **not** declared directly by SITEBORNE anywhere
— it is transitive, brought in solely by `@nevermined-io/payments@1.10.0`
(`"@traceloop/node-server-sdk": "^0.26.0"`).

The lockfile already contains **multiple coexisting OpenTelemetry version
families** — not introduced by this checkpoint, pre-existing in the accepted
graph: `@opentelemetry/core@{2.0.1, 2.7.0, 2.10.0}`,
`@opentelemetry/resources@{2.0.1, 2.7.0, 2.10.0}`,
`@opentelemetry/sdk-trace-base@{2.0.1, 2.7.0, 2.10.0}`,
`@opentelemetry/api-logs@{0.203.0, 0.215.0}`,
`@opentelemetry/otlp-transformer@{0.203.0, 0.215.0}`. Traced via `pnpm why`:

- The `2.10.0` line of `core`/`resources`/`sdk-trace-base` arrives via
  `@traceloop/node-server-sdk → @google-cloud/opentelemetry-cloud-trace-exporter@3.0.0 → @google-cloud/opentelemetry-resource-util@3.0.0`,
  which declares these as **peer** dependencies (not regular dependencies) — a
  looser, version-tolerant relationship.
- The `0.215.0` line of `exporter-trace-otlp-http`/`otlp-transformer`/
  `api-logs`/`sdk-logs` arrives via a **separate, direct** dependency of
  `@nevermined-io/payments` itself
  (`@opentelemetry/exporter-trace-otlp-http@0.215.0`), independent of
  Traceloop's own `0.203.0`-pinned line entirely.

This confirms the dependency graph already tolerates multiple OpenTelemetry
version families side by side via peer-dependency looseness — relevant context
for §17, but does **not** change the core blocker: `sdk-node` is a **regular**
(non-peer) dependency of Traceloop, and
`propagator-jaeger`/`exporter-prometheus` are **exact** (non-caret) regular
dependencies of `sdk-node` itself.

## 5. True root dependency

SITEBORNE controls neither `@traceloop/node-server-sdk` nor any
`@opentelemetry/*` package directly — the only dependency SITEBORNE actually
declares in this chain is `@nevermined-io/payments@1.10.0` itself (already the
latest available release, verified in §6).

## 6. Official version/fix reconciliation (verified against the real registry API, not CLI cache)

Per this checkpoint's own instruction and the lesson learned in Checkpoint 1G
(`npm view`'s version-list cache was stale for `fast-uri`), every version claim
below was verified directly against `registry.npmjs.org`, not a local CLI cache:

- `@traceloop/node-server-sdk` real published versions: 180 total; latest stable
  **`0.27.0`**.
- `@traceloop/node-server-sdk@0.27.0`'s own declared dependencies (fetched
  live): `@opentelemetry/sdk-node: ^0.203.0` — **identical to `0.26.0`**. The
  latest available Traceloop release has **not** moved its OpenTelemetry family
  at all.
- `@nevermined-io/payments`: 109 total versions; latest is **`1.10.0`** — the
  exact version already installed. No newer release exists to pick up a
  different Traceloop range even if one existed.
- `@opentelemetry/sdk-node@0.217.0` itself: queried OSV directly (`api.osv.dev`)
  — **zero known vulnerabilities** against this specific version; it would be a
  clean target if reachable.

## 7. Candidate Traceloop upgrade paths

```
CURRENT_TRACELOOP_VERSION:    0.26.0 (via @nevermined-io/payments ^0.26.0)
MINIMUM_SECURITY_CANDIDATE:   none released
RECOMMENDED_CANDIDATE:        none released
```

**No released Traceloop version — including the current latest, `0.27.0` —
declares a `sdk-node` dependency range that includes `0.217.0`.** This is
recorded explicitly, not assumed: the parent-upgrade strategy has no available
target today.

## 8. Direct OpenTelemetry upgrade possibility (leaf override)

SITEBORNE does not directly declare any of the three vulnerable packages, so a
"direct upgrade" is not literally available — the only mechanism would be a
`pnpm.overrides` entry forcing `sdk-node` (and, by extension, its own
exact-pinned `propagator-jaeger`/ `exporter-prometheus`) to `0.217.0` against
Traceloop's own tested `^0.203.0` contract.

- **Would it violate a parent range contract?** Yes — `sdk-node` is a regular
  (non-peer) dependency of Traceloop; Traceloop's compiled code calls `sdk-node`
  APIs directly, and Traceloop has never been tested or released against
  `0.217.0`.
- **Would it create multiple incompatible copies?** The graph already tolerates
  multiple otel-family versions via _peer_ relationships (§4), but `sdk-node`
  itself is a _regular_ dependency, not a peer — forcing it would not slot
  cleanly into that existing tolerance pattern; it would instead override the
  one otel package Traceloop actually directly instantiates and configures at
  startup.
- **Would shared global SDK registration become unsafe?** OpenTelemetry SDKs
  register global trace/meter providers at process startup; Traceloop's own
  initialization code (never seen or controlled by SITEBORNE, §11) is the only
  caller of `sdk-node`'s API surface here. Forcing a version 14 minor releases
  beyond what that code was written against, with no compatibility proof
  available (no test suite, because SITEBORNE has zero first-party telemetry
  code, §11), cannot be verified safe by static analysis — the same standard
  already applied to reject this exact override in Checkpoint 1G.

**Rejected as unsafe** — consistent with, not a re-litigation of, Checkpoint
1G's original classification.

## 9. OpenTelemetry version-family coherence

`^0.203.0` on a pre-1.0 package restricts to `>=0.203.0 <0.204.0` — patch-level
only, confirmed directly from the real registry dependency data in §6, not
assumed from the version numbers alone. `0.203.0 → 0.217.0` is **not** an
ordinary minor bump; it crosses 14 minor releases on a package line that treats
every minor release as a potential breaking change (npm's own 0.x semver
convention, which Traceloop's own `^0.203.0` declaration explicitly relies on).

## 10. Traceloop breaking-change audit

Not reached — no candidate release exists to audit (§7). There is nothing to
compare initialization/configuration/lifecycle behavior against, since the only
real candidate path (a future Traceloop release) does not currently exist.

## 11. SITEBORNE usage inventory

`grep` across all of `apps/edge-api/src`, `apps/edge-api/tests`, and every
`packages/*/src` for `traceloop` or `@opentelemetry`: **zero matches, in source
and in tests.** No environment variable (`TRACELOOP_*`, `OTEL_*`) is set or
referenced anywhere in the repository. **SITEBORNE's own code never imports,
configures, or tests any part of this telemetry stack** — it is entirely opaque,
internal wiring inside `@nevermined-io/payments`'s own SDK, invoked
automatically at import/construction time with zero SITEBORNE-controlled
surface.

## 12. Initialization semantics

Not directly observable or controllable from SITEBORNE's own code (§11) —
Traceloop's SDK is initialized entirely within `@nevermined-io/payments`'s own
internals, outside any first-party file this repository owns.

## 13. Fail-open/fail-closed telemetry behavior

Not independently verifiable from SITEBORNE's side for the same reason (§11) —
no first-party code path branches on telemetry success or failure. This is
itself a relevant risk note for any future migration checkpoint: since SITEBORNE
cannot observe or test Traceloop's internal failure behavior, a version change
to this dependency (were one ever released) would need Nevermined's own release
notes or a live-sandbox smoke test to validate, not source inspection alone.

## 14. Node compatibility

Repository: `>=22.0.0`. `@opentelemetry/sdk-node@0.217.0` requires
`^18.19.0 || >=20.6.0` — **`COMPATIBLE`**. `@traceloop/node-server- sdk@0.27.0`
requires `>=18.0.0` — **`COMPATIBLE`**. Node is not the blocker; the blocker is
purely the Traceloop→sdk-node dependency-range mismatch (§6–§9).

## 15. TypeScript/module compatibility

Not assessable — no candidate release exists to compare against (§7), and
SITEBORNE has no first-party code touching these APIs (§11) whose types could be
affected either way.

## 16. Peer-dependency matrix

| Package                                                    | Current                                         | Candidate `0.217.0`/`2.9.0` peer requirement | Compatibility                                       |
| ---------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `@opentelemetry/sdk-node`                                  | `0.203.0` (regular dep of Traceloop `^0.203.0`) | n/a — the blocker itself                     | `INCOMPATIBLE` with the only real controlling range |
| `@opentelemetry/api`                                       | `1.9.1`                                         | `0.217.0`'s own peer: `>=1.3.0 <1.10.0`      | would remain satisfied — not the constraint         |
| `@opentelemetry/exporter-prometheus` / `propagator-jaeger` | exact-pinned by `sdk-node` itself               | n/a                                          | coupled to `sdk-node`, not independently resolvable |

## 17. Multiple-OpenTelemetry-copy risk

Real, but pre-existing and peer-mediated (§4) — not something this checkpoint's
analysis introduces or needs to resolve. The specific risk for a hypothetical
forced `sdk-node` override is different in kind: it would not add a new
peer-tolerant version line, it would substitute the one package Traceloop's own
code directly instantiates, with no compatibility evidence available. Treated as
a real, unresolved gate per §8.

## 18. Lockfile blast-radius forecast

Not modeled in detail — no safe candidate path exists to forecast against (§7).
Had a Traceloop release existed with a wider `sdk-node` range, the expected
blast radius would likely have been `MODERATE` (the
`sdk-node`/`propagator-jaeger`/`exporter-prometheus` family plus whatever
`@opentelemetry/api`/`core`/`resources` versions that release declared),
estimated from the existing multi-family pattern already in the lockfile (§4) —
but this is not a real forecast against a real target and is not treated as one.

## 19. Source-edit forecast

**0 source edits** would be required for the dependency change itself (SITEBORNE
has no first-party code touching this API surface, §11). Whether a hypothetical
future Traceloop release would require new first-party configuration is unknown
without that release's own migration notes, which do not exist yet.

## 20. Test blast radius

Since no first-party code imports or configures this stack, the only regression
surface is indirect: any suite that exercises `@nevermined-io/payments`'s own
runtime behavior end-to-end (`nevermined:check`, `x402:check` insofar as it
shares the same edge-api process, `d1:test`) would be the practical smoke-test
surface for a future migration attempt — not because they test telemetry
directly, but because they exercise the process Traceloop initializes within.

## 21. Telemetry-specific test coverage

**None exists**, confirmed by §11's zero-match search. This is itself a gap
worth noting for any future implementation checkpoint: without a released
Traceloop version to test against, and without any existing first-party
telemetry test, a future migration (if one ever becomes possible) would need to
rely primarily on Nevermined's own release notes plus the existing indirect
end-to-end suites (§20), not a dedicated telemetry test this checkpoint could
define now.

## 22. Security effect

If a compatible Traceloop release is ever published, migrating would be expected
to move `sdk-node`/`exporter-prometheus` to `0.217.0` (confirmed clean of known
advisories via direct OSV API query, §6) and `propagator-jaeger` to `2.9.0`,
closing all three findings. **This checkpoint does not claim Trivy will reach
`HIGH=0`** — that requires an actual future migrated scan, contingent on a
release that does not currently exist.

## 23. OSV effect

Forecast: neutral to positive. None of the three affected packages currently
contributes an OSV CRITICAL (OSV's CRITICAL=0 state is already independent of
this Trivy-specific finding set, confirmed in §1). A future migration is not
expected to introduce a new OSV CRITICAL, but this is not independently
verifiable without a real release to scan.

## 24. Strategy comparison

| Strategy                                                                | Result                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Upgrade Traceloop parent to a compatible secure release**          | **Unavailable** — no released version (including the current latest, `0.27.0`) declares a compatible `sdk-node` range (§7).                                                                                                                        |
| **B. Upgrade SITEBORNE direct OpenTelemetry declarations**              | **N/A** — SITEBORNE does not directly declare any of the three packages (§5).                                                                                                                                                                      |
| **C. Narrow OpenTelemetry overrides while retaining current Traceloop** | **Rejected as unsafe** — would force a regular (non-peer) dependency 14 minor releases beyond its declared, tested range, with zero compatibility evidence and zero first-party test coverage to validate against (§8, §21).                       |
| **D. Replace/remove affected telemetry integration**                    | **Not evaluated as necessary** — no normative source requires replacing Nevermined's own bundled telemetry, and doing so would be a architecture-level decision requiring its own dedicated checkpoint, not something to select unilaterally here. |
| **E. Wait for upstream compatible release**                             | **This is the actual current state** — genuinely blocked pending a Traceloop (or Nevermined) release that raises the `sdk-node` floor.                                                                                                             |

## 25. Migration risk

Not applicable to rate in the LOW/MODERATE/HIGH sense — there is no
implementable migration to risk-rate today. If a compatible release ever
appears, the _future_ risk would depend entirely on that release's own changelog
(§10, not currently obtainable).

## Migration decision

**D. `UPSTREAM_RELEASE_REQUIRED`.**

Not `A`/`B`: no released package (own direct dependency,
`@nevermined- io/payments@1.10.0`, or transitive
`@traceloop/node-server-sdk@0.27.0`, both verified as the current latest)
provides a compatible path. Not `C`: forcing the leaf packages would violate a
real, tested, non-peer dependency contract with no compatibility evidence
obtainable (no first-party code, no first-party tests, no Traceloop release to
check against). Not `E`: no normative source indicates the current telemetry
integration must be replaced. Not `F`: this is a straightforward, evidence-based
external blocker, not a contradiction between two frozen requirements — the
Trivy `HIGH=0` aspiration and the "don't force unsafe overrides" constraint are
both real and both still hold; they simply cannot both be satisfied _today_,
pending upstream action.

Per project task semantics (§29 of the directive), this is classified as the
Trivy criterion remaining **`FAIL_INTERNAL`**, not `BLOCKED_EXTERNAL` — the
criterion itself (`'Trivy passes'`) is a local, internally-executed tooling gate
whose current result is a genuine, evidenced fail, not a criterion that cannot
even be attempted due to external infrastructure/credentials (the actual
established meaning of `BLOCKED_EXTERNAL` in this project's own task-frontier
semantics, reserved for missing credentials/registry access, not
upstream-package availability). The scanner executes and reports truthfully; the
finding is real and currently unresolvable in-repo.

## SUN-1000 status (unchanged)

```
PASS              8 / 12
FAIL_INTERNAL      4 / 12   (Trivy, Schemathesis, chaos, load)
NOT_YET_TESTED     0 / 12
```

Trivy `FAIL_INTERNAL` (CRITICAL=0, HIGH=3, unchanged by this analysis- only
checkpoint). Semgrep PASS. OSV PASS. Schemathesis/chaos/load `FAIL_INTERNAL`,
unchanged. `SUN-1000` remains `active`. `production_ready=false`,
`production_enabled=false`, unchanged.

## Next checkpoint

**Proceed to Schemathesis** — the first of the three genuinely-missing test
systems, entirely independent of the OpenTelemetry question, which is now
correctly classified as pending an upstream release rather than an
internally-executable next step. The Trivy HIGH=3 gap should be re-checked
periodically (e.g., whenever `@nevermined-io/payments` or
`@traceloop/node-server-sdk` cuts a new release) rather than retried as an
active checkpoint with no new evidence to act on.
