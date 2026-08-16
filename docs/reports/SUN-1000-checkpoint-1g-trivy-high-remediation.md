# SUN-1000 Checkpoint 1G — Trivy HIGH Dependency Remediation

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`1796f8f` (Checkpoint 1F — Trivy `FAIL_INTERNAL`, CRITICAL=0, HIGH=13). Frozen
security policy unchanged: Semgrep 1.173.0, OSV-Scanner 2.5.0, Trivy 0.74.0, the
Trivy cache mechanism, OSV's CRITICAL-only criterion, and Trivy's
`{CRITICAL, HIGH}` blocking policy. This checkpoint changes dependencies only.
No Schemathesis/chaos/load work, no scanner redesign, no production action, no
CDP/Nevermined mutation.

## 1. Baseline

`git status --short` empty, `HEAD = 1796f8f`. Guards confirmed absent
(presence-only checks, no values printed). `pnpm security:semgrep` PASS.
`pnpm security:osv` PASS, CRITICAL=0. `pnpm security:trivy` (via the accepted
external cache): **35 total, CRITICAL=0, HIGH=13, MEDIUM=20, LOW=2** — matches
Checkpoint 1F exactly. `pnpm secrets:scan`, `governance:validate`,
`state:validate`, `tasks:validate`, full `pnpm check` — all exit 0.

## 2. Security policy frozen

Not modified: scanner versions, the Trivy cache mechanism (`resolveCacheDir`),
OSV's CRITICAL-only exit-code policy, Trivy's `{CRITICAL, HIGH}` blocking set.
This checkpoint's only edits are dependency manifests, the lockfile, and this
report.

## 3. Normalized HIGH findings (from real Trivy JSON)

```
Raw HIGH advisories:                13
Unique advisory/pkg/version tuples: 13 (no duplication)
Unique affected package-versions:    9
Unique packages:                     9
```

| Advisory              | Package                              | Installed | Fixed     |
| --------------------- | ------------------------------------ | --------- | --------- |
| `CVE-2026-44902`      | `@opentelemetry/exporter-prometheus` | `0.203.0` | `0.217.0` |
| `CVE-2026-59892`      | `@opentelemetry/propagator-jaeger`   | `2.0.1`   | `2.9.0`   |
| `CVE-2026-44902`      | `@opentelemetry/sdk-node`            | `0.203.0` | `0.217.0` |
| `GHSA-gcfj-64vw-6mp9` | `axios`                              | `1.16.0`  | `1.18.0`  |
| `CVE-2025-27611`      | `base-x`                             | `5.0.0`   | `5.0.1`   |
| `CVE-2026-13676`      | `fast-uri`                           | `3.0.5`   | `3.1.3`+  |
| `CVE-2026-16221`      | `fast-uri`                           | `3.0.5`   | `3.1.4`+  |
| `CVE-2026-18446`      | `fast-uri`                           | `3.0.5`   | `3.1.5`+  |
| `CVE-2026-6321`       | `fast-uri`                           | `3.0.5`   | `3.1.1`+  |
| `CVE-2026-6322`       | `fast-uri`                           | `3.0.5`   | `3.1.2`+  |
| `CVE-2025-64756`      | `glob`                               | `11.0.1`  | `11.1.0`  |
| `CVE-2026-4800`       | `lodash`                             | `4.17.21` | `4.18.0`  |
| `CVE-2026-4867`       | `path-to-regexp`                     | `0.1.12`  | `0.1.13`  |

## 4. Dependency ancestry (real `pnpm why` evidence)

| Package                              | Scope                                                                         | Root dependency                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `axios`                              | `TRANSITIVE_PRODUCTION`                                                       | `@coinbase/cdp-sdk` (direct + `axios-retry` peer), `@nevermined-io/payments`                                                     |
| `lodash`                             | `TRANSITIVE_PRODUCTION` (deep)                                                | `@nevermined-io/payments → @traceloop/node-server-sdk → @traceloop/instrumentation-llamaindex`                                   |
| `path-to-regexp`                     | `TRANSITIVE_PRODUCTION` (vulnerable instance) + `DEV_TOOLING` (safe instance) | `@a2a-js/sdk → express (peer)` (vulnerable `0.1.12`); `wrangler` resolves an independent, already-safe `6.3.0` — untouched       |
| `base-x`                             | `TRANSITIVE_PRODUCTION`                                                       | `@coinbase/cdp-sdk → bs58`                                                                                                       |
| `glob`                               | `DIRECT_PRODUCTION`                                                           | `packages/provider-adapters`'s own declared dependency (first-party choice, not a third-party SDK)                               |
| `fast-uri`                           | `TRANSITIVE_PRODUCTION` (multiple paths)                                      | `ajv` (declared directly in 6 workspace `package.json` files, and transitively via `@coinbase/cdp-sdk → @x402/extensions → ajv`) |
| `@opentelemetry/sdk-node`            | `TRANSITIVE_PRODUCTION` (deep)                                                | `@nevermined-io/payments → @traceloop/node-server-sdk`                                                                           |
| `@opentelemetry/exporter-prometheus` | `TRANSITIVE_PRODUCTION`                                                       | pinned **exact** (`0.203.0`, no caret) by `@opentelemetry/sdk-node` itself                                                       |
| `@opentelemetry/propagator-jaeger`   | `TRANSITIVE_PRODUCTION`                                                       | pinned **exact** (`2.0.1`, no caret) by `@opentelemetry/sdk-node` itself                                                         |

## 5. OSV cross-reference

All 9 packages' pre-remediation vulnerable versions also appeared in
OSV-Scanner's own broader (dev+prod) findings — **`SHARED_WITH_OSV`** for all 9;
0 `TRIVY_ONLY`. Trivy's frozen gate (not OSV's) is what governs this criterion;
no finding was dismissed on severity-label mismatch between the two tools.

## 6. Fix-path determination

| Package                                                           | Min fixed         | Nearest real published version                                      | Classification                                                                  |
| ----------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `axios`                                                           | `1.18.0`          | `1.19.0` (via caret range, `@coinbase/cdp-sdk` pins exact `1.16.0`) | `NARROW_OVERRIDE`                                                               |
| `lodash`                                                          | `4.18.0`          | `4.18.1`                                                            | `NARROW_OVERRIDE`                                                               |
| `path-to-regexp`                                                  | `0.1.13`          | `0.1.13` (`express` pins exact `0.1.12`)                            | `NARROW_OVERRIDE`                                                               |
| `base-x`                                                          | `5.0.1`           | `5.0.1` (`bs58` declares `^5.0.0`, already permits)                 | `NARROW_OVERRIDE` (needed to force movement past the already-locked resolution) |
| `glob`                                                            | `11.1.0`          | `11.1.0` (own `^11.0.0` range already permitted it)                 | `PATCH` (direct declaration bump)                                               |
| `fast-uri` (all 5 CVEs)                                           | `3.1.5`           | `3.1.5` — **see §7 correction**                                     | `NARROW_OVERRIDE`                                                               |
| `@opentelemetry/{sdk-node,exporter-prometheus,propagator-jaeger}` | `0.217.0`/`2.9.0` | n/a                                                                 | `MAJOR_MIGRATION` (see §7)                                                      |

## 7. Major-migration stop gate

**One genuine stop, one corrected false alarm:**

- **`@opentelemetry/sdk-node` family — real stop.**
  `@opentelemetry/sdk-node@0.203.0` itself pins `propagator-jaeger` and
  `exporter-prometheus` at **exact** versions (no caret) — the three packages
  move only as one coupled family. `sdk-node` itself is capped by
  `@traceloop/node-server-sdk`'s own `^0.203.0` range — npm caret semantics on a
  pre-1.0 package permit **patch-only** movement (`>=0.203.0 <0.204.0`). The fix
  (`0.217.0`) is 14 minor versions outside that range. Forcing it via override
  would desync the entire OpenTelemetry family from the SDK that controls their
  compatible version set — a well-known OpenTelemetry failure mode
  (cross-package version skew). **Not attempted.** Affected surface:
  telemetry/tracing paths inside `@nevermined-io/payments`'s dependency tree,
  not first-party code.

- **`fast-uri` — initially misclassified as a stop, corrected before any edit
  was finalized.** `npm view fast-uri versions` returned a stale/ cached list
  showing the 3.x line stopping at `3.1.3`, which would have left 2 of 5 CVEs
  (`CVE-2026-16221`, `CVE-2026-18446`, whose advertised fixes are
  `3.1.4`/`3.1.5`) apparently unfixable without a major jump to `4.x`
  (incompatible with `ajv`'s own `^3.0.1` range, confirmed via `ajv@8.20.0` —
  latest — still declaring `^3.0.1`). **Directly verified against the real npm
  registry API** (`GET /fast-uri/3.1.4`, `GET /fast-uri/3.1.5` — both
  `HTTP 200`, valid signed tarballs) that both versions are genuinely published;
  `npm view`'s version-list cache was simply out of date. The scoped override
  (`^3.1.3`) correctly resolved to the real latest safe patch, `3.1.5`, closing
  **all 5** CVEs within the 3.x line — no major migration was actually required
  for this package.

## 8. Proposed minimal change set (established before mutation)

```
package.json (root) — pnpm.overrides, 6 new scoped entries:
  @coinbase/cdp-sdk>axios:                        ^1.18.0
  @nevermined-io/payments>axios:                  ^1.18.0
  @traceloop/instrumentation-llamaindex>lodash:   ^4.18.0
  express>path-to-regexp:                         ^0.1.13
  bs58>base-x:                                    ^5.0.1
  ajv>fast-uri:                                   ^3.1.3

packages/provider-adapters/package.json — 1 direct bump:
  glob: ^11.0.0 -> ^11.1.0
```

10 of 13 raw HIGH findings collapse behind these 6 roots + 1 direct bump; the
remaining 3 (OpenTelemetry family) are deferred per §7.

## 9. Applied remediation

Exactly the change set in §8 — nothing else hand-edited. `vitest@3.2.7` and the
existing `jsdom>form-data` override (Checkpoint 1C) preserved unmodified.
Regenerated via plain `pnpm install` (never `pnpm update`, never a hand-edited
lockfile). The first install invocation exited 1 with no printed error;
`pnpm install --frozen-lockfile` immediately after confirmed the lockfile was
already fully consistent (exit 0, "Already up to date") — the same transient,
non-blocking pattern already observed and documented in Checkpoint 1E.

**Resolved versions after install**: `axios@1.19.0` (caret-satisfying, above the
`1.18.0` floor), `lodash@4.18.1`, `path-to-regexp@0.1.13` (vulnerable instance)
/ `6.3.0` (unrelated `wrangler` instance, untouched), `base-x@5.0.1`,
`glob@11.1.0`, `fast-uri@3.1.5`.

## 10. Lockfile audit

```
git diff --stat: package.json (+6/-0 override lines),
  packages/provider-adapters/package.json (1 line),
  pnpm-lock.yaml (61 insertions, 101 deletions)
```

Every changed lockfile entry classified:

- **`INTENDED_DIRECT`**: the 3 new override declarations (`ajv>fast-uri`,
  `bs58>base-x`, `express>path-to-regexp`); `glob` (direct package.json bump).
- **`REQUIRED_TRANSITIVE`**: `axios`/`axios-retry` (peer re-resolution),
  `base-x`, `fast-uri`, `lodash`, `path-to-regexp` (the actual version bumps);
  `jackspeak`, `foreground-child`, `ansi-regex`, `ansi-styles`,
  `eastasianwidth`, `emoji-regex`, `string-width`, `strip-ansi`, `wrap-ansi` —
  all confirmed via `pnpm why` to be `glob@11.1.0`'s own transitive dependency
  set (a newer internal dependency set than `glob@11.0.1` used), not independent
  movement.
- **`UNRELATED`: 0.** No payment SDK, Nevermined/CDP/MCP/A2A package,
  `vite`/`vitest` family member, or `form-data` instance moved.

A benign, unrelated observation: `glob@11.1.0` prints the same generic "old
versions unsupported" deprecation nag the maintainer attaches to essentially
every glob release including the version just installed
(`npm view glob@11.1.0 deprecated` and `glob@11.0.1 deprecated` both return the
identical message) — a known upstream marketing notice, not a real defect in the
version installed.

## 11. Source compatibility

None of the 6 remediated packages (`axios`, `lodash`, `path-to-regexp`,
`base-x`, `fast-uri`, `glob`) is imported anywhere in this repository's own
first-party `src/` code (`grep` returned zero matches for each) — all are
internal implementation details of third-party SDKs (`@coinbase/cdp-sdk`,
`@nevermined-io/payments`, `express` via `@a2a-js/sdk`, `ajv`) except `glob`,
which **is** used directly by two of `provider-adapters`'s own scripts
(`scripts/verify-manifests.ts`/`verify-fixtures.ts`) via a single, simple
`glob(pattern, options)` call — a stable, minor-version-bump-safe public API.
**0 source edits required or made.**

## 12. Targeted tests

| Ancestry                            | Test                                                                                                         | Result         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- |
| `glob`                              | `pnpm adapters:manifests:verify`                                                                             | PASS — 6/6     |
| `glob`                              | `pnpm adapters:fixtures:verify`                                                                              | PASS — 103/103 |
| `axios` (CDP/Nevermined HTTP paths) | `nevermined-reconciliation-client.test.ts`                                                                   | PASS — 9/9     |
| `axios`-adjacent property coverage  | `protocol-a2a` property suite                                                                                | PASS — 6/6     |
| `path-to-regexp`/routing            | `paid-routes-mounting.test.ts` + `x402-service-route.test.ts`                                                | PASS — 34/34   |
| `fast-uri`/`ajv` schema paths       | `verification` suite + MCP/A2A route tests                                                                   | PASS — 82/82   |
| `base-x`/`bs58`                     | no direct first-party usage found; covered indirectly by the full CDP-dependent Nevermined/x402 suites below | —              |

## 13. Semgrep

`pnpm security:semgrep`: PASS, 0 findings.

## 14. OSV-Scanner

`pnpm security:osv`: PASS. **CRITICAL=0**. Total findings dropped from 78 to
**57** — an incidental benefit, since several of the remediated packages
(`axios`, `lodash`, `glob`, `fast-uri`) also appeared in OSV's broader
dev+prod-inclusive scan. No MODERATE/LOW findings were deliberately targeted;
this reduction is a side effect of the HIGH remediation, not separate work.

## 15. Decisive Trivy gate

Real scan via the accepted external cache:

```
Total: 14 (down from 35)
CRITICAL: 0
HIGH:     3 (down from 13) — all 3 are the pre-identified, deferred
           OpenTelemetry family (§7); no new HIGH introduced
MEDIUM:   9 (down from 20)
LOW:      2 (unchanged)
```

**Trivy remains `FAIL_INTERNAL`** — 3 genuine HIGH findings still block under
the unchanged `{CRITICAL, HIGH}` policy. Not suppressed, not forced to PASS.

## 16. Vulnerability regression

New CRITICAL introduced: **0**. New HIGH introduced: **0** — the 3 remaining
HIGH findings are exactly the pre-existing, pre-classified OpenTelemetry
findings from the baseline, not a replacement or a new advisory.

## 17. Remaining MEDIUM/LOW (recorded truthfully, not remediated)

9 MEDIUM (`@opentelemetry/core` ×2, `ajv`, `qs` ×2, `uuid` ×3, `yaml`), 2 LOW
(`body-parser`, `qs`) remain, inventoried in `security/output/trivy.json`. None
independently violates another frozen SUN-1000 criterion; not remediated per
this checkpoint's own explicit "no MEDIUM/LOW-for-cosmetics" instruction.

## 18. Suppressions

**0.** No `.trivyignore`, no path/dependency exclusion, no severity weakening.

## 19. Aggregate security gate

`pnpm security:release` (Semgrep → OSV → Trivy): genuinely executes all three
(Semgrep PASS, OSV PASS, Trivy exits 1 honestly on its 3 real remaining HIGH
findings). Not forced green; policy unchanged.

## 20. Complete regression

`pnpm nevermined:check`, `pnpm x402:check`, `pnpm mcp:check`, `pnpm a2a:check`,
`pnpm governance:validate`, `pnpm state:validate`, `pnpm tasks:validate`,
`pnpm secrets:scan`, `pnpm d1:test` — all exit 0. Full `pnpm check` — see stop
report for exact result. No live economic or provider operation performed.

## Trivy criterion decision

**Remains `FAIL_INTERNAL`.** 10 of 13 HIGH findings genuinely eliminated with
minimal, narrowly-scoped changes; 3 remain, correctly deferred to a dedicated
OpenTelemetry-family migration-feasibility checkpoint rather than forced through
an incompatible override. This is the honest outcome per this checkpoint's own
§22 provision for exactly this scenario — not the "all HIGH eliminated" best
case, but a real, well-evidenced, majority reduction.

## Tally after this checkpoint

```
PASS              8 / 12
FAIL_INTERNAL      4 / 12   (Trivy remains here — reduced, not closed; Schemathesis, chaos, load unchanged)
NOT_YET_TESTED     0 / 12
```

## Outcome

`SUN-1000` remains `active`. `production_ready=false`,
`production_enabled=false`, unchanged. Zero external mutation beyond ordinary
public npm-registry reads (already permitted, including the two direct
registry-API verification calls in §7). CDP sandbox credential-rotation tracking
item unaffected, still open.

## Next checkpoint

**SUN-1000 Checkpoint 1H — OpenTelemetry family migration feasibility**, scoped
narrowly to the 3 remaining Trivy HIGH findings: assess whether
`@traceloop/node-server-sdk` has (or will soon have) a release compatible with
`@opentelemetry/sdk-node ≥ 0.217.0`, or whether an alternative telemetry-SDK
version pin is available upstream — analysis only, matching the discipline
already used for the Vitest 3 (Checkpoints 1D→1E) migration. If no safe path
exists, Trivy's HIGH gap may need to be accepted as a documented,
upstream-blocked residual risk rather than something this project can
unilaterally resolve. Independently, and not blocking the above: proceed to
**Schemathesis** as the first of the three genuinely-missing test systems, since
it does not depend on the OpenTelemetry question.
