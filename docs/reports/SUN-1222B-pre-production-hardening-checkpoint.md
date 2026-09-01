# SUN-1222B — Pre-Production Hardening Checkpoint

Repository-only. **Zero production mutations**: no deploy, no traffic-split change,
no secret/var change, no production-enabled flag flipped, no registry/DNS/website
change. Production remains exactly where SUN-1221G left it:
`db7054c9-76ee-4830-aabe-8a4542261b6a` @ 100%, `de70bf98-...` @ 0% (rollback,
retained). Still serving `legacy: 'reject'` in production until a separately
authorized deploy ships this checkpoint's fix.

```
HEAD=5c1a1d1e8f0e85f5463a0092fd5b69b2a6f0047e
WORKING_TREE=clean
```

Lineage this checkpoint closes out: `52838da` (SUN-1222A, read-only baseline) →
`88078b9` (R1 fix) → `9d63690` (R2/R3 fix, part 1) → `5c1a1d1` (R3 fix, part 2 +
doc). SUN-1222A's own risk register (R1–R5) is the backlog this checkpoint works
against.

## What this checkpoint fixed

### R1 (P0) — MCP legacy-handshake rejection

**Before:** `packages/protocol-mcp/src/server.ts` configured
`createMcpHandler(..., { legacy: 'reject' })`. Confirmed live against production:
a bare 2025-11-25 `initialize` request (no `_meta` envelope, no
`MCP-Protocol-Version` header — the lifecycle the MCP Registry client and most
current MCP directories/scanners use) is answered `-32022 Unsupported protocol
version: 2025-11-25`.

**Root cause:** `'reject'` is a real `@modelcontextprotocol/server@2.0.0`
posture, but not its own default (`'stateless'` is — confirmed from the
package's own `dist/*.d.mts` doc comments). No ADR, code comment, or commit
message in this repo's history justified opting out of the default; `git log -S
"legacy: 'reject'"` shows only the original "add remote utility protocol
foundation" commit.

**Fix:** `legacy: 'stateless'` — the SDK's documented default. Serves
2025-11-25-family traffic from a fresh, per-request stateless instance of the
*exact same* tool factory the 2026-07-28 modern envelope path already uses. No
scanner/user-agent/host special-casing.

**Evidence:**
- New regression suite `transport.test.ts` → `describe('2025-11-25 legacy
  handshake compatibility (SUN-1222A)')`: 3 tests. Verified red against `'reject'`
  (both new tests fail with `-32022`/`-32022` before the fix — captured in the
  commit message), green against `'stateless'` (all 3 pass after).
- A same-suite guard (`'still serves the modern 2026-07-28 envelope path
  unchanged alongside legacy'`) proves the fix didn't regress the primary
  envelope path — it, and all 24 tests in the file, and all 33 in the package,
  pass.
- `tsc --noEmit` clean for `packages/protocol-mcp`.

### R2 (P1) — A2A agent-card `productionEnabled` ambiguity

**Before:** `packages/protocol-a2a/src/card.ts`'s x402 extension hardcoded a
top-level `productionEnabled: false` unconditionally, while the per-service
entries for `verify_agent_output.v2` / `web_context_verified.v2` — both promoted
to real production by SUN-1221G — correctly read `true` underneath it. Confirmed
live in the deployed agent card during SUN-1222A.

**Fix:** the top-level flag is now derived — `services.some(s =>
s.productionEnabled)` — instead of hand-set. One source of truth
(`effectiveProductionStatusByServiceId`, the map edge-api already injects from
its real ADR-0055/route gates); the aggregate can no longer silently disagree
with what it summarizes.

**Evidence:** new test `'derives the top-level x402 productionEnabled from the
per-service map, never independently'` — asserts the aggregate for zero-active,
one-active, and back-to-zero-active states, and that flipping one service true
never leaks `true` onto the others. `protocol-a2a`: 45/45 tests pass, `tsc
--noEmit` clean.

### R3 (P1) — `apps/edge-api` typecheck was not clean

Three pre-existing errors in `paid-continuation-workflow-entrypoint.test.ts`
(confirmed pre-existing via `git stash` before touching anything) plus two more
in `tests/live/web-context-first-paid-e2e-local.test.ts` (same confirmation),
found only once the *full* `typecheck` script — both `tsconfig.json` and
`tsconfig.live-tests.json` — was run instead of a bare `tsc --noEmit`.

- `WorkflowContinuationResult` was imported from `./paid-continuation-workflow`,
  which imports it internally but never re-exports it; fixed to import from its
  actual source, `../continuation/types`.
- Two `step.do` mock-typing errors: `PaidContinuationWorkflowStep['do']` is a
  generic method, `vi.fn`'s inferred mock type isn't — a known
  vitest/TypeScript limitation. Fixed with a narrow, commented, call-site-only
  cast; `doSpy`'s own type and its `.mock.calls` assertions are untouched.
- `signTypedData`'s mock return (`'0x' + '11'.repeat(65)`) was plain `string`
  against a branded `` `0x${string}` `` return type; rewritten as a genuine
  template-literal expression, which TypeScript checks structurally against the
  branded type without a cast.
- A 6-variant override array lost its members' branded `network`/`asset`
  literal types to union-array-literal widening; given an explicit
  `Array<Partial<PaymentRequirements>>` annotation instead of leaving it to
  inference.

All four are type-level fixes only — no runtime behavior changed in any of them
(confirmed by every affected test still passing, unchanged assertions).

## Full verification (this HEAD)

| Gate | Command | Result |
|---|---|---|
| Build | `turbo run build --force` | 12/12 tasks successful |
| Typecheck | `turbo run typecheck --force` | 23/23 packages clean |
| Lint | `turbo run lint --force` | 16/16 clean |
| Full test suite | `vitest run` (repo root) | **215/215 test files, 2596/2596 non-skipped tests pass**; 74 skipped (all intentionally live-gated — credentialed/network/subprocess tests that report `skipped`, perform zero network calls, and are `policy_blocked` if forced, per `live-gates.test.ts`) |
| Worker bundle | `wrangler deploy --dry-run` | Succeeds; 6314.90 KiB / gzip 1038.00 KiB; bindings unchanged (Workflow, KV, 2 queues, D1, Browser, AI, vars) |
| Secret scan | grep for common key/token patterns across `apps/`, `packages/`, `docs/` | 0 matches |
| MCP interop, targeted | `transport.test.ts` legacy-handshake suite (in-process, real Hono app + real `@modelcontextprotocol/server`) | 3/3 pass post-fix, reproduced-red pre-fix |
| SSRF / DNS-rebinding, targeted | `packages/provider-adapters` full suite | 308/314 pass, 6 skipped (same live-gate class); includes `http-ssrf.test.ts` (31 tests), `dns-rebinding.test.ts` (21 tests), fragmentation/premature-EOF/read-diagnostics suites |
| x402 economic safety, targeted | `apps/edge-api/tests/x402-service-route.test.ts` (already-existing coverage, re-verified this HEAD) | 36/36 pass — duplicate-payment-identifier replay, conflicting-binding rejection, 20-way concurrent same-binding dedup, upto-authorized-maximum-exceeded rejection, D1 cross-instance persistence, no-network proof, property tests |

## Findings this checkpoint did NOT fix (explicit, not hidden)

These were not part of SUN-1222A's risk register and were not independently
re-audited this checkpoint given its scope; listing them for completeness rather
than silently declaring the broader hardening brief complete:

- **R4 (P2, carried from 1222A):** no independent web evidence of MCP
  Registry/directory listing was found this session. Still unproven — do not
  rely on the "known positive external signals" claimed in the broader brief
  without an independent recheck.
- **R5 (P2, carried from 1222A):** no Logpush/long-retention log source is
  configured; production error/5xx counts in these reports are bounded-window
  samples, not full-traffic guarantees.
- **New, minor:** several packages emit an ESLint `[MODULE_TYPELESS_PACKAGE_JSON]`
  Node warning during lint (`eslint.config.js` reparsed as ESM every run,
  perf-only) — root `package.json` lacks `"type": "module"`. Cosmetic; not a
  correctness or security issue.
- **Not attempted this checkpoint:** the hardening brief's sections 15–45 as a
  whole (fuzz/property testing beyond what already existed, cryptographic/JWKS
  key-rotation audit, dependency/supply-chain vulnerability scan, CI/CD
  release-gate wiring for these new invariants, MCP Registry metadata
  preparation, human-site coherence check, adversarial red-team pass,
  documentation rewrite). The existing x402 and SSRF suites verified above are
  substantial pre-existing coverage for parts of sections 12 and 17, not new
  work from this checkpoint, and are called out as such rather than claimed as
  this session's own achievement.

## Minimal production deployment plan for R1 (the MCP fix)

Not executed. Sequence, if and when authorized:

1. `wrangler deploy --dry-run` against current `main` (already proven clean above).
2. Deploy as a **new version at 0% traffic** (do not cut over the existing 100%
   `db7054c9` directly) — standard canary discipline per the SUN-1221 lineage,
   even though this change is protocol-additive (legacy support is new
   surface, not a modification of the existing modern-envelope path the current
   100% version already serves).
3. Live probe the new version directly (bypassing the split) with both: (a) the
   existing modern-envelope smoke test, and (b) a bare legacy `initialize` →
   `tools/list` sequence — confirm the modern path is byte-identical to current
   production and the legacy path now returns a valid result instead of
   `-32022`.
4. Promote to 100% (single-version cutover, no canary split needed for a
   protocol-additive change with full regression coverage) once (3) is clean.
5. Re-verify externally: an actual MCP Registry client connection (or
   equivalent conforming client, e.g. the `@modelcontextprotocol/client`
   package used in this repo's own tests, driven from outside this
   environment) against production `/mcp`.

R2 (A2A metadata fix) ships in the same deploy — it's in the same Worker,
already proven not to regress A2A's own 45/45 test suite.

## Final packet

```
HEAD=5c1a1d1e8f0e85f5463a0092fd5b69b2a6f0047e
WORKING_TREE=clean
BUILD=PASS (12/12)
TYPECHECK=PASS (23/23)
LINT=PASS (16/16)
TEST_SUITE=PASS (215/215 files, 2596/2596 non-skipped tests, 74 intentional live-gated skips)
MCP_LEGACY_HANDSHAKE=FIXED, code-verified, NOT DEPLOYED
A2A_PRODUCTION_METADATA_AMBIGUITY=FIXED, code-verified, NOT DEPLOYED
EDGE_API_TYPECHECK=CLEAN (was FAIL at SUN-1222A time)
WORKER_BUNDLE_DRY_RUN=PASS
SECRET_SCAN=0 findings
PRODUCTION_STATE=UNCHANGED (db7054c9 @ 100%, de70bf98 @ 0%, legacy: 'reject' still live)
REMAINING_BLOCKERS=R4 (external discovery unproven), R5 (no long-retention logs) -- both P2, both operational/external, not code blockers
NEXT_REQUIRED_CHECKPOINT=explicit authorization for the R1/R2 production deploy described above, or continued repo-only work on the broader hardening brief's unstarted sections
```
