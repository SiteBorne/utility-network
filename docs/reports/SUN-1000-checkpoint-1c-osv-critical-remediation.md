# SUN-1000 Checkpoint 1C — OSV Critical Vulnerability Remediation

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`bea6bd8` (Checkpoint 1B — scanners integrated: 7/12 PASS, 4/12 FAIL_INTERNAL,
1/12 NOT_YET_TESTED). This checkpoint does not rewrite the historical Checkpoint
1B report. **Zero deployment, publication, DNS change, live payment, or
payment-provider mutation.**

## 1. The literal normative OSV criterion (re-confirmed, not reopened)

`TASKS.yaml`'s SUN-1000 entry states exactly:
**`'OSV-Scanner finds no critical vulnerabilities'`**. No other frozen source
(`governance/`, `docs/decisions/`, `docs/adrs/`) defines a stricter or different
threshold, a dev/prod scope carve-out, or an advisory-exception process.
**Blocking threshold: `CRITICAL` severity only.** Dev and transitive
dependencies remain in scope — the criterion does not exclude them. The prior
turn's "block on any finding with a fix available" behavior in `run-osv.ts`
remains an explicitly-labeled stand-in policy for the script's own exit code,
distinct from — and not confused with — this checkpoint's actual acceptance
decision, which follows the literal criterion precisely.

## 2. Initial evidence (re-confirmed baseline)

Raw vulnerability records: **82**. Deduplication check: 82 raw records = 82
unique `(advisory ID, package, version)` tuples — **no duplication**, every
record is already a distinct issue. Severity: 3 CRITICAL, 31 HIGH, 41 MODERATE,
7 LOW.

## 3. The three CRITICAL findings, traced precisely

| #   | Advisory              | Package/version   | Dependency path                     | Fixed version(s)                                                                                                                                                            | Scope                                                                                                             |
| --- | --------------------- | ----------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `GHSA-fjxv-7rqg-78g4` | `form-data@4.0.1` | `vitest → jsdom (peer) → form-data` | `2.5.4` / `3.0.4` / `4.0.4` (branch-specific)                                                                                                                               | `TEST_ONLY` / `DEV_TOOLING` (jsdom is vitest's DOM environment)                                                   |
| 2   | `GHSA-9crc-q9x8-hgqq` | `vitest@2.1.8`    | direct root devDependency           | `1.6.1` / `2.1.9` / `3.0.5` (branch-specific)                                                                                                                               | `DEV_TOOLING` — requires the Vitest API server actively listening                                                 |
| 3   | `GHSA-5xrq-8626-4rwp` | `vitest@2.1.8`    | direct root devDependency           | `3.2.6` / `4.1.0` only — **no 2.x fix exists** (advisory range: `introduced: 0, fixed: 3.2.6`, confirmed by inspecting the raw affected-ranges JSON directly, not inferred) | `DEV_TOOLING` — requires the Vitest UI/API server actively listening while the developer browses a malicious site |

Traced via `pnpm why vitest`/`pnpm why form-data --recursive` (real output, not
inferred): `form-data@4.0.1` is transitive, reached only through `vitest`'s
`jsdom` peer dependency. `vitest` itself is a direct root devDependency,
declared as `^2.0.0` in **every** workspace package.json (15 files) — already
permitting `2.1.9` without any version- specifier change.

**Two other `form-data` instances exist in the tree and were positively
confirmed already safe, not touched**: `2.5.6` (via
`@types/request → retry-request → google-gax`, already ≥ the 2.x fix boundary
`2.5.4`) and `4.0.6` (via `@coinbase/cdp-sdk → axios`, already ≥ the 4.x fix
boundary `4.0.4`).

## 4. Minimal remediation applied

**Rejected an overly broad first attempt**: `pnpm update vitest --recursive`
rewrote every workspace package.json's specifier from `^2.0.0` to `^2.1.8` (the
pre-update version, not actually bumping resolution) _and_ alphabetically
reordered unrelated dependency keys in several files — real, unwanted churn per
this checkpoint's own lockfile-churn-audit instruction. **Reverted entirely**
(`git checkout -- .`) before proceeding.

**Actual applied fix** (surgical, two changes):

1. `vitest`: `^2.0.0` → `^2.1.9` in all 15 workspace `package.json` files (a
   single, identical, mechanical string replacement — no other dependency
   reordering). `2.1.9` is confirmed (via `npm view vitest versions`) to be the
   **latest available 2.1.x release** — the smallest possible upgrade within the
   already-declared range.
2. `package.json`'s `pnpm.overrides`: added `"jsdom>form-data": "^4.0.4"` —
   scoped precisely to the vulnerable dependency path, **not** a bare
   `"form-data": "^4.0.4"` global override (which would have forced the
   already-safe `2.5.6` instance through an unnecessary, potentially breaking
   major-version change). pnpm resolved the override to the already-present,
   already-safe `4.0.6` (deduplicating with the axios instance) rather than
   installing a separate `4.0.4` — confirmed via
   `pnpm why form-data --recursive`: `form-data@4.0.1` is now gone entirely from
   the lockfile; the `2.5.6` chain is untouched.

Then `pnpm install` (never `pnpm update`, and never a hand-edited lockfile) to
regenerate `pnpm-lock.yaml` from the edited manifests.

## 5. Lockfile-churn audit

`git diff pnpm-lock.yaml`: 15 `vitest` specifier/resolution bumps
(`2.0.0`/`2.1.8` → `2.1.9`), the matching first-party `@vitest/*` subpackage
version bumps (`expect`/`mocker`/`pretty-format`/`runner`/
`snapshot`/`spy`/`utils`, all `2.1.8` → `2.1.9`, required to stay in sync with
the main package), `vite-node` `2.1.8` → `2.1.9`, one new `overrides:` block,
and the `form-data@4.0.1` entries' removal (replaced by reuse of the
already-present `4.0.6`). **No unrelated package version changed.** No
dependency key reordering.

## 6. Targeted regression

`pnpm security:semgrep`: still clean, 0 findings (re-verified after the
dependency change, not merely assumed unaffected). Full ordinary regression
(`nevermined:check`, `x402:check`, `mcp:check`, `a2a:check`,
`governance:validate`, `state:validate`, `tasks:validate`, `secrets:scan`, full
`pnpm check`) — all exit 0 under vitest `2.1.9`, confirming the version bump
introduced no regression across this project's entire test suite (the most
direct possible "targeted test for the changed dependency," since vitest _is_
the test runner every other check already exercises).

## 7. Post-fix OSV evidence

```
Total: 79 (down from 82)
CRITICAL: 1 (down from 3)
HIGH:     30 (down from 31 — an incidental fix within the vitest 2.1.8→2.1.9 bump)
MODERATE: 41 (unchanged)
LOW:      7  (unchanged)
```

**Remaining CRITICAL**: `GHSA-5xrq-8626-4rwp`, `vitest@2.1.9`. Confirmed by
re-inspecting the raw OSV JSON: the advisory's only fix boundary for any pre-4.0
line is `3.2.6` — a real, unavoidable major-version jump from the
currently-installed `2.x` line. No 2.x patch closes it; none was invented or
assumed.

## 8. Remaining non-critical findings — not remediated, per this checkpoint's own scope

79 remaining findings (30 HIGH, 41 MODERATE, 7 LOW) are **not** addressed this
checkpoint. The literal SUN-1000 criterion is CRITICAL-only; no frozen source
requires zero findings at these severities, and none was independently
identified as an exploitable, reachable production defect warranting escalation
outside the scanner threshold. They remain inventoried in
`security/output/osv-scanner.json` (gitignored, regenerable via
`pnpm security:osv`) for a later, separately-scoped checkpoint if SITEBORNE
chooses to pursue broader dependency hygiene.

## 9. Suppressions

**None.** No OSV ignore file, advisory suppression, package exclusion, or
dev-dependency exclusion was added. The one remaining CRITICAL is reported
truthfully, not hidden.

## 10. Trivy — unchanged, not touched

Per this checkpoint's explicit instruction, no attempt was made to free local
disk space (no deletion of Docker data, caches, downloads, or any user file).
Trivy's vulnerability-scan portion remains **`NOT_YET_TESTED`**, exactly as
Checkpoint 1B left it. The existing wrapper's cache-directory behavior was not
modified this checkpoint — no generic improvement was identified as
clean/necessary enough to introduce alongside a security-remediation-scoped
turn.

## 11. Blocker classification for the remaining CRITICAL

Per this checkpoint's own §20: **the blocker is classified, not forced past.**
`GHSA-5xrq-8626-4rwp` requires vitest `≥ 3.2.6` (or `≥ 4.1.0`) — a real
major-version migration from the currently-installed `2.x` line, used throughout
this entire monorepo's test infrastructure (15 workspace packages, hundreds of
test files, multiple live-harness and payment-flow test suites built and proven
across the whole SUN-0900B arc). This is not "clearly compatible and bounded"
within this checkpoint's own conservative standard for major bumps — it is
deferred to a dedicated follow-up, not attempted here.

## SUN-1000 criterion decision

**OSV-Scanner: remains `FAIL_INTERNAL`.** `CRITICAL = 1`, not `0`. The literal
criterion (`no critical vulnerabilities`) is not yet satisfied — this is
reported honestly rather than forced to `PASS`, even though the Checkpoint 1B
framing anticipated a possible 3→0 outcome that the actual evidence does not
support.

## Tally after this checkpoint

```
PASS:           7/12  (unchanged: Semgrep, ESLint, Ruff, mypy strict, Gitleaks, property tests, payment suite)
FAIL_INTERNAL:  4/12  (OSV-Scanner remains here; Schemathesis, chaos, load unchanged)
NOT_YET_TESTED: 1/12  (Trivy vulnerability scan, unchanged)
```

## Outcome

`SUN-1000` remains `active`. `production_ready=false`,
`production_enabled=false`, unchanged. Zero external mutation beyond ordinary
public npm-registry/advisory-database reads (already permitted).

## Next checkpoint

**SUN-1000 Checkpoint 1D — vitest 2→3 major-version migration feasibility
assessment**, scoped narrowly to closing the one remaining CRITICAL
(`GHSA-5xrq-8626-4rwp`): read vitest 3.x's changelog/breaking- change notes,
assess compatibility across this monorepo's actual vitest usage (config shape,
mocking APIs, coverage config, workspace-mode behavior), and only then attempt
the bump with its own full regression pass — not bundled with any other scanner
or dependency work. Once `CRITICAL=0` is genuinely achieved, revisit Trivy's
vulnerability scan (pending local disk space) before Schemathesis, then
chaos/load.
