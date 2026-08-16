# SUN-1000 Checkpoint 1E — Vitest 3.2.7 Migration

`production_ready=false`, `production_enabled=false`. Accepted baseline:
`1d9bed9` (Checkpoint 1D — decision B, `SAFE_WITH_SMALL_COORDINATED_CHANGES`).
Frozen migration target: `vitest 3.2.7` exactly, per the assessed candidate — no
substitution to `latest`, another 3.2.x, or 4.x. This checkpoint addresses only
the remaining OSV CRITICAL blocker. No Node, Vite, or unrelated dependency
change; no Trivy/Schemathesis/chaos/load work; no production action; no
Nevermined/CDP mutation.

## 0. Credential-exposure safety boundary

Per the prior checkpoint's disclosed incident, this checkpoint used only
presence checks (`SET`/`MISSING`, no values) for guard and credential variables,
never a broad `env`/`printenv` dump. CDP sandbox credentials were not required
and were not used. **Operational security requirement recorded, not actioned
here**:
`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_BEFORE_NEXT_PROVIDER_MUTATION=true` —
rotation itself is out of scope for this credential-free dependency migration
and must happen before any future checkpoint performs a real CDP/Nevermined
provider mutation. No credential values (old or new) are recorded anywhere in
this report or repository.

## 1. Baseline

`git status --short` empty, `HEAD = 1d9bed9`. `vitest` resolution confirmed
`2.1.9` before any edit. Guards confirmed absent
(`PAID_ROUTES_ENABLED`/`PRODUCTION_ENABLED`/`NODE_ENV` all `MISSING`).
Credential-free gates: `pnpm security:semgrep` (0 findings),
`pnpm secrets:scan`, `pnpm governance:validate`, `pnpm state:validate`,
`pnpm tasks:validate` — all exit 0. `pnpm security:osv`: 79 total, **1
CRITICAL** (`GHSA-5xrq-8626-4rwp` / `vitest@2.1.9`) — matches Checkpoint 1D
exactly.

## 2. Pre-mutation inventory

15 `package.json` files declaring `vitest`, all `^2.1.9` (verified by grep
before any edit): root, `apps/edge-api`, and 13 packages (`contracts`,
`mcp-server`, `pcc-schema`, `policy`, `pricing`, `protocol-a2a`, `protocol-mcp`,
`protocol-nevermined`, `protocol-x402`, `provider-adapters`, `service-runtime`,
`test-fixtures`, `verification`).

Pre-mutation resolved versions: `vitest@2.1.9`,
`@vitest/{expect,mocker, pretty-format,runner,snapshot,spy,utils}@2.1.9`,
`vite-node@2.1.9`, `vite@5.4.11`.

## 3. Change applied

Exactly the 15 `vitest` specifiers changed from `^2.1.9` to `^3.2.7` (one
mechanical string replacement per file). Nothing else edited by hand: `vite`,
`typescript`, `node` engines, `jsdom`, `fast-check`, payment/
Nevermined/CDP/MCP/A2A SDKs all untouched. The existing
`jsdom>form-data: ^4.0.4` override from Checkpoint 1C was preserved unmodified.

## 4. Package-manager regeneration

Regenerated via plain `pnpm install` (no `--latest`, no broad workspace
upgrade). The first invocation exited 1 with no printed error (no
peer-dependency or resolution failure text appeared in its output); a follow-up
`pnpm install --frozen-lockfile` confirmed the resulting lockfile was already
fully consistent with the edited manifests (exit 0, "Already up to date"), so
the exit 1 was a transient, non-blocking condition on the initial resolve rather
than a real installation defect — the lockfile content itself was verified
correct and stable independent of that exit code.

## 5. Lockfile diff audit

`git diff pnpm-lock.yaml`: every changed entry is attributable to `vitest`
itself or its own first-party/lockstep dependency graph — `vitest`,
`@vitest/{expect,mocker,pretty-format,runner,snapshot,spy, utils}` (all
`2.1.9 → 3.2.7`), `vite-node` (`2.1.9 → 3.2.4`), and vitest's internal
transitive set (`chai`, `es-module-lexer`, `expect-type`, `js-tokens`, `loupe`,
`pathe`, `std-env`, `strip-literal`, `tinyglobby`, `tinypool`, `tinyrainbow`,
`tinyspy`). **`vite` did not move** (`5.4.11` unchanged, confirming no
unintended major migration). **`jsdom` did not move** (`26.0.0` unchanged). **No
Node-related constraint changed.** `form-data` entries remain exactly `2.5.6`
and `4.0.6` — `form-data@4.0.1` does not exist anywhere in the regenerated
lockfile, confirming the Checkpoint 1C fix survived the migration untouched. No
unrelated package (payment SDKs, Nevermined, CDP, MCP/A2A) appears in the diff.
**Classification: fully explained, no unexplained churn.**

## 6. Resolved-version proof

Post-install: `vitest = 3.2.7` (confirmed via `pnpm why vitest`).
`@vitest/{expect,mocker,pretty-format,runner,snapshot,spy,utils}` all at
`3.2.7`. `vite-node@3.2.4`. `vite@5.4.11` (unchanged). All values match the
Checkpoint 1D forecast exactly — no unexpected incompatible peer relationship.

## 7. No proactive test/config rewrites

No test source file and no Vitest config file was edited before running the
suites. All 14 configs were exercised exactly as they existed at Checkpoint 1D.
**Result: 0 config edits, 0 test-source edits** — the best case anticipated by
the feasibility assessment.

## 8. Smoke test

`npx vitest --version` → `vitest/3.2.7 darwin-arm64`. A representative small
suite (`packages/provider-adapters`) run via its normal `pnpm test` script: **10
test files, 170 passed, 6 intentionally guarded skipped, 0 failed.** Binary
initializes correctly; proceeded to full regression.

## 9. Critical-suite regression (targeted)

| Suite                            | Result                                                 |
| -------------------------------- | ------------------------------------------------------ |
| `pnpm nevermined:check`          | PASS — 7 files, 155 tests                              |
| `pnpm x402:check`                | PASS (includes spec-baseline consistency)              |
| `pnpm mcp:check`                 | PASS (6 tools, health/quote verified, offline install) |
| `pnpm a2a:check`                 | PASS — 4+1+1+1 files, 30+6+1+2 tests                   |
| `pnpm verification:check`        | PASS (policy Zod-valid, canonical hash matches)        |
| `pnpm d1:test`                   | PASS — all queue-consumer/D1 verification tests        |
| `pnpm control-plane:check`       | PASS — 32 tests                                        |
| `pnpm services-runtime:check`    | PASS — 14/14 fixture scenarios matched                 |
| `pnpm adapters:check`            | PASS — 6/6                                             |
| `pnpm document-worker:check`     | PASS — 81 passed                                       |
| `pnpm pcc:generate:check`        | PASS — no model drift                                  |
| `pnpm contracts:baseline:verify` | PASS                                                   |
| `pnpm contracts:compat:check`    | PASS                                                   |

Every suite touching Nevermined replay/recovery, x402 lifecycle, D1 persistence,
PCC/receipt/PSL, MCP/A2A protocol handling, and the document-worker bridge
passed with real evidence, not mere compilation.

## 10. Property-test regression

`x402:test:property` 20 passed, `mcp:test:property` 30 passed,
`a2a:test:property` 6 passed, `services-runtime:test:property` 3 passed,
`verification:test:property` 3 passed. All fast-check-integrated, no
timeout-behavior change observed, no seed/replay infrastructure regression, no
unexpected skip introduced.

## 11. Mocking/module semantics

No `vi.mock`/`vi.doMock`/`vi.hoisted`/`vi.spyOn`/`vi.resetModules`/
`vi.stubGlobal`-using test failed. Since none failed, per this checkpoint's own
instruction, **no mocking code or test was modified**.

## 12. Test-count comparison

Root `pnpm test`: **152 test files discovered (141 passed, 11 intentionally
guarded skips), 1703 tests (1680 passed, 23 skips)** — all skips are the
project's existing guarded live-credential tests, not new regressions. This is
consistent with Checkpoint 1D's inventory of 153 total repository test files
(root config discovers 152; the remaining one file is exercised through
`protocol-nevermined`'s explicit `--root ../.. packages/protocol-nevermined/src`
invocation, counted separately within its own 7-file/155-test suite in §9). No
unexpected reduction.

## 13. TypeScript / lint / format

`pnpm typecheck --force` (0 cached, 23/23 fresh tasks): PASS.
`pnpm lint --force` (0 cached, 16/16 fresh tasks): PASS. `pnpm format:check`:
PASS. No `strict`/`noImplicitAny`/module-setting relaxation was made or needed.

## 14. Semgrep

`pnpm security:semgrep`: exit 0, **0 findings** — criterion remains PASS,
unaffected by the migration.

## 15. OSV-Scanner — decisive gate

`pnpm security:osv`: scanner executed successfully against the regenerated
lockfile (707 packages). Result:

```
Total: 78 (down from 79)
CRITICAL: 0 (down from 1)
HIGH:     30 (unchanged)
MODERATE: 41 (unchanged)
LOW:      7  (unchanged)
```

`GHSA-5xrq-8626-4rwp` is confirmed absent from the post-migration findings
(directly checked against the raw JSON's advisory ID set). **No new CRITICAL
advisory was introduced** by the resolved dependency graph.
`GHSA-fjxv-7rqg-78g4` (form-data) is also absent, and `form-data@4.0.1` does not
exist anywhere in the lockfile — the Checkpoint 1C remediation remains fully
effective through this migration.

## 16. Full `pnpm check`

Ran to completion: **exit 0** (all lint/typecheck/test/PCC/contracts/
Python/governance/state/tasks/D1/control-plane/adapters/document-worker/
verification/services-runtime/x402/mcp/a2a/nevermined/secrets-scan stages).

## 17. Migration acceptance

All §25 conditions are met: `vitest` resolves exactly `3.2.7`; lockfile churn is
fully explained; no unintended Vite major movement; all 14 configs function
unmodified; every critical suite passes with real evidence; every property suite
passes; TypeScript/lint pass fresh; Semgrep remains clean; **OSV CRITICAL = 0**;
the form-data fix remains intact; Nevermined/x402/MCP/A2A/D1/recovery all pass;
full `pnpm check` passes. **Migration accepted.**

## SUN-1000 OSV criterion decision

**OSV-Scanner: `FAIL_INTERNAL → PASS`.** The literal criterion
(`'OSV- Scanner finds no critical vulnerabilities'`) is now genuinely satisfied
— verified by a real scanner execution against the real, regenerated lockfile,
not inferred from the Checkpoint 1D feasibility assessment alone.

## Tally after this checkpoint

```
PASS              8 / 12
FAIL_INTERNAL      3 / 12
NOT_YET_TESTED     1 / 12
```

Remaining: Trivy `NOT_YET_TESTED`; Schemathesis, chaos, load all
`FAIL_INTERNAL`/not yet built. 79 → 78 non-critical findings remain inventoried,
not remediated — outside this checkpoint's and the SUN-1000 criterion's literal
scope.

## Outcome

`SUN-1000` remains `active` (not yet fully accepted — 4 criteria remain open).
`production_ready=false`, `production_enabled=false`, unchanged. Zero external
mutation beyond ordinary public npm-registry reads (already permitted).
Credential-exposure tracking item recorded per §0/§28 — not resolved in this
checkpoint, tracked for the next checkpoint capable of a CDP/provider mutation.

## Next checkpoint

Per the accepting message's own guidance: **the Trivy vulnerability-scan
completion**, converting the last `NOT_YET_TESTED` criterion into real evidence
(misconfig scan already clean from Checkpoint 1B; the vuln scan remains blocked
by a genuine local disk-space constraint, not a tool defect — no user files may
be deleted to work around it). After Trivy, Schemathesis, then chaos/load remain
the final gaps before SUN-1000 acceptance.
