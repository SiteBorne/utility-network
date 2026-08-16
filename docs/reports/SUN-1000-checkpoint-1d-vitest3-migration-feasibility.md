# SUN-1000 Checkpoint 1D — Vitest 3.x Migration Feasibility Assessment

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`2229c60` (Checkpoint 1C — OSV-Scanner FAIL_INTERNAL, 1 CRITICAL remains:
`GHSA-5xrq-8626-4rwp` on `vitest@2.1.9`). **This checkpoint is
assessment-only.** No dependency, lockfile, config, Node, or Vite change was
made. No Trivy/Schemathesis/chaos/load work was started. No production action.

## 1. Baseline

`git status --short` empty, `HEAD = 2229c60` before this checkpoint's own
report/prettier-formatting work began. All live/payment/deployment/ registration
guards confirmed absent: `PAID_ROUTES_ENABLED`, `PRODUCTION_ENABLED`, `NODE_ENV`
are all unset in the shell. (CDP sandbox credentials —
`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/`CDP_WALLET_SECRET` — are present in the
local shell environment; these are the pre-existing sandbox-facilitator
credentials already established during SUN-0900B's live-harness testing, not a
new production signal, and this checkpoint made no use of them.)

`pnpm security:semgrep`: exit 0, 0 findings. `pnpm security:osv`: exit 1
(expected — findings present), 79 total, re-confirmed **1 CRITICAL**
(`GHSA-5xrq-8626-4rwp` / `vitest@2.1.9`), matching Checkpoint 1C exactly.
`pnpm secrets:scan`, `pnpm governance:validate`, `pnpm state:validate`,
`pnpm tasks:validate`: all exit 0.

`pnpm check` failed once, at `format:check`, on
`docs/reports/SUN-1000-checkpoint-1c-osv-critical-remediation.md` — a genuine
pre-existing Prettier formatting defect in the prior checkpoint's own report
file (not a dependency, environment, or tooling error). Corrected via
`prettier --write` on that single file (a mechanical formatting fix, not a
reopening of Checkpoint 1C's remediation content or decisions). Full
`pnpm check` re-run afterward.

## 2. Checkpoint 1C freeze

Not reopened: the `jsdom>form-data` override, the `vitest 2.1.8 → 2.1.9` bump,
Semgrep's clean result, or any existing regression. The frozen remaining blocker
is exactly `GHSA-5xrq-8626-4rwp` on the direct root devDependency
`vitest@2.1.9`. Current criterion: OSV `FAIL_INTERNAL`.

## 3. Advisory reconfirmation (from real OSV JSON, not memory)

`GHSA-5xrq-8626-4rwp` (`CVE-2026-47429`, CVSS 3.1
`AV:N/AC:L/PR:N/UI:N/ S:U/C:H/I:H/A:H`, severity `CRITICAL`) has exactly two
independent `affected[].ranges[]` entries in the raw advisory data:

- `{ introduced: "4.0.0", fixed: "4.1.0" }` — a regression reintroduced in the
  4.x line, fixed at `4.1.0`.
- `{ introduced: "0", fixed: "3.2.6" }` — covers **every** version from the
  package's inception up to (not including) `3.2.6`. This range includes the
  entire 2.x line, including the installed `2.1.9`.

**No patched 2.x release exists.** The only way out of the vulnerable range is
crossing the 3.0.0 major boundary to `≥ 3.2.6`, or to `≥ 4.1.0` on the 4.x line.
This is the same conclusion Checkpoint 1C reached; independently re-verified
here from the raw advisory JSON, not assumed.

The vulnerability itself: an arbitrary-file-read (and effectively
arbitrary-script-execution via the UI's test-rerun/file-write features) in
Vitest's UI/API server, exploitable only when that server is explicitly exposed
to the network (`--api.host`) or on Windows with the UI/Browser Mode running.
**This repository's test suites never start the Vitest UI or API server** (no
`--ui`, no `api.host` config anywhere in any of the 8 config files) — the
finding is real per OSV's package-level scan but not reachable in this
repository's actual CI/local invocation pattern. This does not change the OSV
pass/fail criterion (the criterion is package-version-based, not
reachability-based), but it is relevant context for risk-prioritizing the
migration.

## 4. Minimum candidate selection

Queried the real npm registry (`npm view vitest versions`):

- **`MINIMUM_SECURITY_VERSION = 3.2.6`** — the exact version named as the fix
  boundary in the advisory's own range data.
- 3.x stable releases at/after the fix: `3.2.6`, `3.2.7` (latest 3.x stable). No
  `3.2.8+` exists.
- **`RECOMMENDED_MIGRATION_VERSION = 3.2.7`** — one trivial patch above the
  minimum, and the latest available release on the 3.x line. Chosen over the
  bare minimum `3.2.6` only because it is the newest patch in the already-fixed
  minor line (lowest realistic regression risk of any 3.x candidate, not a
  broader/riskier choice); chosen over jumping to 4.x because 4.x is a second,
  larger major-version step with its own independent breaking-change surface not
  required to close this specific advisory.
- Latest 4.x stable: `4.1.10` (`4.1.0` is the 4.x-line fix boundary). Not
  recommended for this checkpoint's purpose — it would combine two major
  migrations into one change when only one is required to close the CRITICAL
  finding.

## 5. Official migration documentation

Vitest's own registry metadata for `3.2.7` confirms:

- `engines.node`: `^18.0.0 || ^20.0.0 || >=22.0.0`
- `dependencies.vite`: `^5.0.0 || ^6.0.0 || ^7.0.0-0`
- `dependencies.vite-node`: `3.2.4` (pinned by vitest itself)
- Coupled first-party packages pinned in lockstep: `@vitest/expect`,
  `@vitest/mocker`, `@vitest/pretty-format`, `@vitest/runner`,
  `@vitest/snapshot`, `@vitest/spy`, `@vitest/utils`, all at `3.2.7` (mirroring
  the exact pattern already observed for the 2.1.8→2.1.9 bump in Checkpoint 1C).
- Peer dependencies: `jsdom`/`happy-dom`/`@edge-runtime/vm` (`*`, all
  optional/DOM-environment peers — irrelevant here, see §9), `@vitest/ui` and
  `@vitest/browser` pinned to the same `3.2.7` (both unused in this repository,
  see §17).

The major-version-relevant breaking-change areas Vitest 3 is publicly known for
(config-shape stabilization of `workspace`→`projects`, pool/ worker default
adjustments, snapshot-format/coverage-default changes, browser-mode API changes,
some `vi.mock` auto-mocking edge cases) were each checked against this
repository's actual usage in §9–§17 below, rather than assumed to apply.

## 6. Node compatibility

Repository `engines.node`: `>=22.0.0`. CI (`.github/workflows/ci.yml`):
`node-version: 22` (both jobs). Candidate `3.2.7` requires Node
`^18.0.0 || ^20.0.0` or `22.0.0` and above. **Classification: `COMPATIBLE`.** No
Node version change needed or implied.

## 7. Vite compatibility

Current resolved Vite version across the entire workspace (verified via
`pnpm why vite --recursive` and `pnpm-lock.yaml`): a single consistent
`vite@5.4.11`, present only as a transitive dependency of `vitest`/
`vite-node`/`@vitest/mocker` — **no package.json in this repository declares
`vite` directly**. Candidate `3.2.7` requires `^5.0.0 || ^6.0.0 || ^7.0.0-0`.
`5.4.11` satisfies this range directly. **Classification: no Vite change
required — `vite` stays on the same major version (possibly the same exact
version, pending actual lockfile resolution at implementation time).**

## 8. Workspace Vitest inventory (verified, not assumed)

**15** `package.json` files declare `vitest` (confirmed via
`grep -rl "\"vitest\""`), matching Checkpoint 1C exactly: root, `apps/edge-api`,
and 13 packages (`contracts`, `mcp-server`, `pcc-schema`, `policy`, `pricing`,
`protocol-a2a`, `protocol-mcp`, `protocol-nevermined`, `protocol-x402`,
`provider-adapters`, `service-runtime`, `test-fixtures`, `verification`).

**8** `vitest.config.ts` files exist: root plus 7 packages (`mcp-server`,
`protocol-a2a`, `protocol-mcp`, `protocol-x402`, `provider-adapters`,
`service-runtime`, `verification`). The remaining 7 declaring packages
(`contracts`, `pcc-schema`, `policy`, `pricing`, `test-fixtures`,
`protocol-nevermined`, `apps/edge-api`) have no local config and resolve to the
root `vitest.config.ts` (or, for `protocol-nevermined`, an explicit
`--root ../.. packages/protocol-nevermined/src` invocation against the same root
config) — a single shared config governs those seven. **6 additional
`vitest.property.config.ts` files** exist (`provider-adapters`,
`service-runtime`, `verification`, `protocol-a2a`, `protocol-x402`,
`protocol-mcp` — the last via `mergeConfig(base, ...)` layered on its own
`vitest.config.ts`), for fast-check property-suite isolation. Total distinct
Vitest config files: **14**.

Every config uses `environment: 'node'` (never `jsdom`/`happy-dom`),
`globals: true` (mostly), simple `include`/`exclude` globs, and in several cases
a `resolve.alias`-equivalent `test.alias` map for cross-package `@siteborne/*`
source imports. Root config additionally sets
`coverage: { provider: 'v8', ... }` and `typecheck.tsconfig`. No config sets
`pool`, `poolOptions`, `isolate`, `reporters`, or a `workspace`/`projects` key.

**153** `*.test.ts` files exist repository-wide (excluding
`node_modules`/`dist`).

## 9. Configuration compatibility audit

| Config file                          | Notable options                                                                                                               | Classification         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `./vitest.config.ts` (root)          | `globals`, `environment: node`, `include`/`exclude`, `coverage.provider: v8` (unused, see §15), `alias`, `typecheck.tsconfig` | `UNCHANGED_COMPATIBLE` |
| `mcp-server/vitest.config.ts`        | `globals`, `environment: node`, `include`/`exclude`                                                                           | `UNCHANGED_COMPATIBLE` |
| `protocol-a2a/vitest.config.ts`      | `environment: node`, `include`/`exclude`, `alias`                                                                             | `UNCHANGED_COMPATIBLE` |
| `protocol-mcp/vitest.config.ts`      | `globals`, `environment: node`, `include`/`exclude`, `alias`                                                                  | `UNCHANGED_COMPATIBLE` |
| `protocol-x402/vitest.config.ts`     | `globals`, `environment: node`, `include`/`exclude`, `alias`                                                                  | `UNCHANGED_COMPATIBLE` |
| `provider-adapters/vitest.config.ts` | `globals`, `environment: node`, `include`/`exclude`                                                                           | `UNCHANGED_COMPATIBLE` |
| `service-runtime/vitest.config.ts`   | `globals`, `environment: node`, `include`/`exclude`, `alias`                                                                  | `UNCHANGED_COMPATIBLE` |
| `verification/vitest.config.ts`      | `globals`, `environment: node`, `include`/`exclude`, `alias`                                                                  | `UNCHANGED_COMPATIBLE` |
| 6 × `vitest.property.config.ts`      | same shape, one uses `mergeConfig`                                                                                            | `UNCHANGED_COMPATIBLE` |

None of the 14 configs uses any option renamed, removed, or behaviorally altered
between Vitest 2 and 3 (no `workspace` key, no pool/worker overrides, no
reporters, no browser/UI options). No config file requires editing to remain
valid under Vitest 3 — this audit did not edit any file, consistent with the
checkpoint's scope.

## 10. Source API usage audit (real repository grep, not assumed)

| API                                                                | Files using it                                                                                                                                                     | Count |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `vi.mock` / `vi.doMock`                                            | `apps/edge-api/tests/nevermined-provider.test.ts`, `scripts/verify-secret-scan-scope.regression.test.ts`                                                           | 2     |
| `vi.hoisted`                                                       | same two files above                                                                                                                                               | 2     |
| `vi.spyOn`                                                         | `packages/protocol-a2a/src/signing.test.ts`, `packages/protocol-a2a/src/protocol.property.test.ts`, `apps/edge-api/tests/nevermined-reconciliation-client.test.ts` | 3     |
| `vi.stubGlobal`                                                    | `packages/protocol-a2a/src/transport.test.ts`, `packages/protocol-x402/src/tests/no-network.test.ts`, `packages/protocol-mcp/src/transport.test.ts`                | 3     |
| `vi.resetModules`                                                  | `scripts/verify-secret-scan-scope.regression.test.ts`                                                                                                              | 1     |
| `vi.useFakeTimers` / `vi.setSystemTime` / `vi.advanceTimersByTime` | none found                                                                                                                                                         | 0     |
| `vi.importActual` / `vi.importMock`                                | none found (factory functions use plain `importOriginal` param, the stable pattern)                                                                                | 0     |
| `toMatchSnapshot` / `toMatchInlineSnapshot`                        | none found                                                                                                                                                         | 0     |
| `test.each`                                                        | 30 files                                                                                                                                                           | 30    |
| `fast-check` (`fc.assert`/`fc.property`)                           | 8 files                                                                                                                                                            | 8     |

All five mocking-family APIs used (`vi.mock` with an explicit factory,
`vi.hoisted`, `vi.spyOn`, `vi.stubGlobal`, `vi.resetModules`) are long-stable,
core Vitest APIs unaffected by the 2→3 breaking-change list; none of the two
`vi.mock` call sites uses factory-less auto-mocking (the one narrow area with
documented 3.x auto-mock behavioral changes).

## 11. Mocking-semantics risk

Reviewed each of the 8 files from §10 individually:

- `apps/edge-api/tests/nevermined-provider.test.ts`: mocks
  `@nevermined-io/payments` via `vi.hoisted` + `vi.mock(..., () => ({...}))`
  with an explicit factory — the stable, documented pattern; unaffected.
- `scripts/verify-secret-scan-scope.regression.test.ts`: mocks
  `node:crypto`/`node:child_process` via
  `vi.mock(..., async (importOriginal) => ({...}))` partial-mock pattern —
  stable across 2→3.
- `packages/protocol-a2a/{signing,protocol.property}.test.ts`:
  `vi.spyOn(console, 'debug')` — trivial output-suppression spy, no semantic
  dependency on mock timing.
- `apps/edge-api/tests/nevermined-reconciliation-client.test.ts`:
  `vi.spyOn(globalThis, 'fetch')` — network-call interception for a
  recovery-client test; behaviorally identical spy API in 3.x.
- `{protocol-a2a,protocol-x402,protocol-mcp}` transport/no-network tests:
  `vi.stubGlobal('fetch', ...)` — global replacement, stable API, used to prove
  SSRF/no-network guarantees; no 3.x behavioral change to this API.

**No payment, recovery, D1, signing, or document-worker-bridge test relies on
fake timers, snapshot serialization, or factory-less auto-mocking** — the three
specific areas where Vitest 3 introduced genuine semantic changes. Conclusion:
**no identified semantic- equivalence risk** in this category for this
repository's actual test suite.

## 12. Timing / fake-timer risk

`grep` for `vi.useFakeTimers`, `vi.setSystemTime`, `vi.advanceTimersByTime`
across the entire repository (`*.ts`, excluding `node_modules`) returned **zero
matches**. No settlement-timeout, recovery-timeout, retry/backoff, or
`Date`-mocking test uses Vitest's fake-timer facility anywhere in this
repository. **Risk: none identified** — this entire risk category does not
apply.

## 13. Snapshot / serialization risk

`grep` for `toMatchSnapshot`/`toMatchInlineSnapshot` returned **zero matches**.
No `__snapshots__` directories exist. PCC/receipt/PSL/Agent
Card/A2A/MCP/contracts assertions all use explicit `expect(...).toEqual`/
`toBe`/structural assertions (confirmed by the complete absence of any snapshot
API call), not snapshot-based comparison. **Risk: none identified** — this
entire risk category does not apply to this repository's testing style.

## 14. Property-test integration

`fast-check` is declared at `^3.17.0` in 8 package.json files (`edge-api`,
`pcc-schema`, `protocol-x402`, `protocol-mcp`, `protocol-a2a`,
`service-runtime`, `verification`, `provider-adapters`) — a plain
peer-independent library, not a Vitest plugin; it integrates purely through
`fc.assert(fc.property(...))` calls inside ordinary `test()` blocks and carries
no direct dependency on Vitest's internal version. The 6 dedicated
`vitest.property.config.ts` files (§8) use only stable, unaffected config
options. Vitest 3.2.7's `test.each`/async-test execution model is unchanged from
2.x for this usage pattern. **Classification: compatible, no coordinated
fast-check version change anticipated.**

## 15. Coverage tooling

Root `vitest.config.ts` declares `coverage: { provider: 'v8', ... }`, but **no
`@vitest/coverage-v8` package appears anywhere in `pnpm-lock.yaml`**, and **no
`package.json` script in the entire repository invokes `vitest --coverage` or
any coverage-triggering flag** (verified by grepping every `package.json` for
`--coverage`). The coverage block is present in config but
**dormant/unexercised** by any command this repository actually runs (including
`pnpm check`). **Classification: `NO_CHANGE`** — coverage tooling has no live
coordination requirement because it is not currently invoked; a future
coverage-enablement effort would need to add `@vitest/coverage-v8@3.2.7` at that
time, but that is independent of this migration.

## 16. TypeScript compatibility

Current repository TypeScript: `^5.5.0` (root `package.json`). Vitest `3.2.7`'s
own published type surface targets modern TS (5.x) consistent with its
`@types/node` peer range (`^18 || ^20 || >=22`, matching the already-installed
`@types/node@22`). No repository `tsconfig.json` references Vitest-internal
types beyond the standard `vitest/globals` ambient types already relied upon
(confirmed via `globals: true` usage in every config, the standard integration
point, unchanged between 2.x/3.x). **Classification: compatible; no expected
compile/type regressions,** though this cannot be proven with certainty without
actually installing the candidate (see §22 rollback / §23 gates for how the
future checkpoint verifies this empirically rather than by inference).

## 17. Plugin / peer-dependency matrix

| Package                 | Current                                             | Vitest 3.2.7 requirement                | Delta                                                                                                       | Reason                                                                                              |
| ----------------------- | --------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `vite`                  | `5.4.11` (transitive only)                          | `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0-0`      | none                                                                                                        | already satisfies range                                                                             |
| `vite-node`             | `2.1.9` (locked to vitest)                          | `3.2.4` (vitest-pinned)                 | major bump, but internal/automatic — moves in lockstep with the vitest bump itself, not a separate decision | required coupled bump                                                                               |
| `@vitest/expect`        | `2.1.9`                                             | `3.2.7`                                 | major, automatic                                                                                            | required coupled bump                                                                               |
| `@vitest/mocker`        | `2.1.9`                                             | `3.2.7`                                 | major, automatic                                                                                            | required coupled bump                                                                               |
| `@vitest/pretty-format` | `2.1.9`                                             | `3.2.7`                                 | major, automatic                                                                                            | required coupled bump                                                                               |
| `@vitest/runner`        | `2.1.9`                                             | `3.2.7`                                 | major, automatic                                                                                            | required coupled bump                                                                               |
| `@vitest/snapshot`      | `2.1.9`                                             | `3.2.7`                                 | major, automatic                                                                                            | required coupled bump (unused feature, see §13)                                                     |
| `@vitest/spy`           | `2.1.9`                                             | `3.2.7`                                 | major, automatic                                                                                            | required coupled bump                                                                               |
| `@vitest/utils`         | `2.1.9`                                             | `3.2.7`                                 | major, automatic                                                                                            | required coupled bump                                                                               |
| `@vitest/ui`            | not installed                                       | `3.2.7` peer (optional)                 | n/a                                                                                                         | unused, no action                                                                                   |
| `@vitest/browser`       | not installed                                       | `3.2.7` peer (optional)                 | n/a                                                                                                         | unused, no action                                                                                   |
| `@vitest/coverage-v8`   | not installed                                       | not a vitest core dep; separate package | n/a                                                                                                         | unused, no action (§15)                                                                             |
| `jsdom`                 | `4.0.6`-chain resolution (peer, unused environment) | `*` (any)                               | none required                                                                                               | never selected as `environment` anywhere (§9)                                                       |
| `happy-dom`             | not installed                                       | `*` (optional peer)                     | n/a                                                                                                         | unused                                                                                              |
| `@edge-runtime/vm`      | not installed                                       | `*` (optional peer)                     | n/a                                                                                                         | unused                                                                                              |
| `fast-check`            | `^3.17.0`                                           | no coupling (independent library)       | none                                                                                                        | §14                                                                                                 |
| `chai`                  | transitive (via vitest)                             | `^5.2.0`                                | automatic, internal to vitest                                                                               | required coupled bump, no direct repository usage of `chai` API found outside vitest's own `expect` |

This matrix is the true scope: it is dominated entirely by vitest's own
first-party `@vitest/*` family moving in lockstep (the same pattern already
proven safe in Checkpoint 1C's 2.1.8→2.1.9 bump, just now across a major-version
boundary), plus `vite-node`. No third-party plugin, coverage provider, UI
package, or browser package is installed, so none requires coordination.

## 18. Lockfile impact forecast (no lockfile change made)

Expected to move: `vitest` (15 declaration sites), `@vitest/expect`,
`@vitest/mocker`, `@vitest/pretty-format`, `@vitest/runner`, `@vitest/snapshot`,
`@vitest/spy`, `@vitest/utils` (all 3.2.7, lockstep-pinned), `vite-node`
(3.2.4), and `chai` (vitest's internal assertion dependency, `^5.2.0`). **`vite`
itself is not expected to move** (current `5.4.11` already satisfies vitest
3.2.7's declared range) though pnpm could still choose a marginally newer `5.x`
patch at resolution time if the range permits — this would be a genuine,
explainable, non-major side effect, not scope creep. No other package family
(jsdom, form-data, axios, google-gax, etc.) is expected to move, since none of
them is version-coupled to vitest's major version. **Classification: `SMALL`** —
the blast radius is essentially identical in shape to the 2.1.8→2.1.9 bump
already proven safe in Checkpoint 1C (same package family, same lockstep-pinning
pattern), just crossing one additional major-version boundary within that same
family.

## 19. Security effect

Migrating to `vitest@3.2.7` removes `GHSA-5xrq-8626-4rwp` from the resolved
dependency graph (the fixed range `≥ 3.2.6` directly covers `3.2.7`). Assuming
no new CRITICAL advisory is introduced by the moved package set (see §20), this
is expected to reduce OSV CRITICAL count `1 → 0`. **This checkpoint does not
claim the OSV criterion will PASS.** That determination requires the actual
future `pnpm security:osv` run after the real migration is implemented
(Checkpoint 1E), not this assessment's prediction.

## 20. Other advisory regression risk

The package set expected to move (§18) is entirely vitest's own first-party
family plus `vite-node` and `chai` — packages with no history of independent
CRITICAL findings surfaced in this repository's Checkpoint 1B/1C OSV scans
(`chai`, `vite-node`, and the `@vitest/*` family do not appear as the
`package.name` of any of the 79 currently-open findings, confirmed by
cross-referencing `security/output/osv-scanner.json`). No speculative broader
upgrade is proposed. **No known tradeoff was identified** where fixing
`GHSA-5xrq-8626-4rwp` would introduce a different advisory in this specific
package set — but this is inference from currently-visible package metadata, not
a guarantee; the future implementation checkpoint's own post-migration OSV scan
is the actual gate (§23).

## 21. Test-suite migration blast radius

- Workspace packages with a `vitest` declaration: **15**
- Distinct Vitest config files: **14** (8 main + 6 property)
- Total `*.test.ts` files: **153**
- Tests potentially affected: all 153, in the sense that the test runner itself
  changes major version — but see §9–§17: none exercises a feature Vitest 3 is
  documented to have changed.
- Critical architecture suites in scope: `protocol-nevermined` (21 test files),
  `protocol-x402` (33), `apps/edge-api/tests` (38, includes D1/
  payment/recovery/reconciliation suites), `verification` (15), `protocol-a2a`
  (5), `protocol-mcp` (3).

**Classification: `LOW`.** Rationale, evidence-based: zero fake-timer usage,
zero snapshot usage, zero UI/browser-mode usage, zero
`workspace`/`projects`/pool/reporter customization, all mocking APIs used are
the stable/unaffected subset, Node/Vite both already satisfy the candidate's
requirements with no change, and the expected lockfile blast radius (§18)
mirrors the already-proven-safe pattern from Checkpoint 1C's own within-family
bump.

## 22. Rollback design (for the future Checkpoint 1E, not implemented now)

Implement as **one isolated commit** containing exactly: the `vitest` version
bump (`^2.1.9` → the selected 3.x specifier) in all 15 `package.json` files, no
other dependency change, no config edits unless §9's audit is contradicted by
real installation behavior (in which case the minimal required config edit is
included in the same commit with an explicit note), and the resulting
`pnpm-lock.yaml` regenerated via plain `pnpm install` (never
`pnpm update --recursive`, per the lesson already learned in Checkpoint 1C).
Rollback is a single `git revert` of that one commit — no other checkpoint's
work is touched, so revert is clean and total.

## 23. Future implementation acceptance gates (for Checkpoint 1E)

At minimum, all of the following must exit 0 before Checkpoint 1E may close as
anything other than a documented blocker:

`pnpm install` (clean, no peer-conflict errors) · `pnpm typecheck` · targeted
Vitest self-tests (the security-scanner-manifest tests and any other test
exercising the test-runner's own behavior) · every workspace Vitest suite
(`pnpm test` at root plus every per-package `test` script) · every
`*:test:property` script · `pnpm nevermined:check` · `pnpm x402:check` ·
`pnpm mcp:check` · `pnpm a2a:check` · `pnpm d1:test` · `pnpm control-plane:test`
· `pnpm pcc:generate:check` · `pnpm document-worker:check` ·
`pnpm security:semgrep` · `pnpm secrets:scan` · full `pnpm check` ·
`pnpm security:osv` executing successfully with **CRITICAL = 0**. **If any of
these shows a semantic regression (a test that now passes for the wrong reason,
or a behavioral change not justified by an intentional, documented config edit),
the future migration must fail closed** — reverted via §22, not patched around.

## 24. Migration decision

**B. `SAFE_WITH_SMALL_COORDINATED_CHANGES`.**

Not `A` (a bare version-string bump alone), because crossing a major version
always carries residual behavioral risk that this assessment can bound but not
eliminate by static analysis alone (§16, §20) — the future checkpoint's real
installation and full-suite run is still required before declaring success, and
a small, bounded set of lockstep `@vitest/*`/`vite-node` package coordination is
mechanically required (§17). Not `C`, because no Vite major bump, no Node
change, and no broader toolchain/config rewrite is required — every config file
audited `UNCHANGED_COMPATIBLE` (§9), Vite and Node both already satisfy the
candidate's stated requirements (§6–§7), and the entire package-family delta is
vitest's own first-party lockstep set (§17–§18). Not `D`: a compatible,
non-blocked migration path clearly exists. Not `E`: no contradiction between the
zero-critical requirement and any frozen toolchain constraint — the constraint
set (Node 22, Vite 5.4.11, no UI/browser/coverage features in use) is fully
compatible with the fix.

## 25. Checkpoint 1E definition (not executed)

**SUN-1000 Checkpoint 1E — Vitest 3.2.7 migration implementation**, isolated to
exactly: bump `vitest` from `^2.1.9` to `^3.2.7` (or the latest 3.2.x patch
available at execution time, re-verified against npm at that point rather than
assumed stale) across all 15 `package.json` files identified in §8, regenerate
`pnpm-lock.yaml` via plain `pnpm install`, run every gate in §23, and — only if
every gate is green and `pnpm security:osv` genuinely reports `CRITICAL = 0` —
transition the OSV-Scanner criterion to `PASS`. Expected touched files: the same
15 `package.json` files plus `pnpm-lock.yaml`; **no config file is expected to
require edits** per §9's audit, but the checkpoint should still verify this
empirically rather than skip the check. No other package, no Trivy, no
Schemathesis, no chaos/load work bundled into that same checkpoint.

## 26–27. (N/A — decision is B, not C or D)

## 28. Production state

`production_ready=false`, `production_enabled=false` — unchanged. No production
action taken or proposed by this checkpoint.

## 29. Regression (post-report)

Re-ran after this report and the incidental Checkpoint-1C-report formatting fix:
`pnpm security:semgrep` (0 findings), `pnpm security:osv` (79 total, 1 CRITICAL
— unchanged, truthfully still failing), full `pnpm check` (see stop report for
exact result), `pnpm secrets:scan`, `pnpm governance:validate`,
`pnpm state:validate`, `pnpm tasks:validate`. No scanner policy was modified.

## 30. Outcome

`SUN-1000` remains `active`. OSV-Scanner remains `FAIL_INTERNAL` (1 CRITICAL) —
not reclassified from feasibility evidence alone, per this checkpoint's own §31
instruction. Trivy remains `NOT_YET_TESTED`. Schemathesis, chaos, and load
remain `FAIL_INTERNAL`/not-yet-built, untouched. Zero external mutation.
