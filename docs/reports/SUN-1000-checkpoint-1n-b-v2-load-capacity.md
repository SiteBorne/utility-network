# SUN-1000 Checkpoint 1N-B — v2 Load / Capacity Release Gate

**Status:** Load/capacity gate implementation, credential-free. No chaos rerun,
no credential rotation, no external provider mutation.

---

## 0. Wording addendum carried forward from 1N-A2 (no code change)

1N-A2's accepted report describes checkpoint 1M's live `/v2/...` HTTP wiring as
"deliberately, **permanently** CDP-only." That word is too strong and is
corrected here, as directed, without reopening 1N-A2: the wiring is CDP-only in
**Phase 1 / current state**. The accepted checkpoint 1L migration architecture
explicitly reserves **Phase 2 / checkpoint 1O** for real v2 Nevermined
agent/plan registration and MCP/A2A public wiring — at which point
Nevermined-rail v2 traffic becomes reachable through that same live wiring,
inheriting every guarantee 1N-A/1N-A2's chaos matrix already proved for a real
`.v2` identity via `createX402ServiceRoute` directly. No file in this repository
asserted the permanent phrasing in code or governance — this is a
documentation-only correction, recorded here as 1N-B evidence per instruction.

## 1. Scope: load/capacity, not chaos

This checkpoint is deliberately narrow. Chaos is complete (1N-A/1N-A2: 18/18
scenarios, `FAIL_INTERNAL -> PASS`, unmodified). 1N-B adds a **separate**,
bounded, deterministic load/capacity campaign against the real,
credential-independent v2 HTTP/runtime architecture: sustained successful
request handling, concurrent request handling, D1/payment-state contention,
latency distribution, throughput, error rate, resource stability, service
isolation/fairness, and zero duplicate economic/service side effects under load.
No chaos scenario is rerun as a load-generation mechanism; the load suite is
architecturally independent of `chaos-v2.test.ts` /
`chaos-v2-settlement-recovery.test.ts` (no shared test file, no shared scenario
names).

## 2. No governed numeric load/latency/throughput threshold exists

Searched `governance/RUBRIC.yaml` and `governance/PROMOTION_STATES.yaml`
directly (not inferred): `RUBRIC.yaml` mentions "p95 latency under SLA" with no
number anywhere. `PROMOTION_STATES.yaml`'s `EXECUTABLE_CANDIDATE` /
`EXECUTABLE_VERIFIED` states mention "Load test passes at 1x expected traffic" /
"3x expected traffic," but "expected traffic" is never itself defined
numerically anywhere in this repository, and both entries govern a **different**
axis entirely — the per-service/per-rule production-promotion ladder
(`DRAFT -> ... -> EXECUTABLE_VERIFIED -> RETIRED -> TOMBSTONED`), not the
SUN-1000 security-release-gate criterion. No production SLA is fabricated to
fill this gap.

## 3. `RELEASE_GATE_THRESHOLD` — a regression guard, not a production SLA

```
releaseGateThresholdMs = max(warmupStats.p95 * 10, 2000)
```

Derived empirically from the campaign's own `WARMUP` profile every run — a
deliberately generous 10× multiplier over the measured warm p95, with a 2000ms
floor for CI-machine variability. Disclosed explicitly as a regression guard
against this codebase's own current local capacity, never a customer-facing
capacity guarantee. See `security/load/LOAD_MATRIX.md` for the full profile
matrix and rationale.

## 4. Architecture: one self-contained Vitest file, a real local listener

Unlike Schemathesis (an external, non-Vitest CLI process requiring the
`.security-tools/`-style ready-info/stop-sentinel file coordination that
`schemathesis-server-host.test.ts` needs), the load campaign involves no
external non-JS tool. `@siteborne/protocol-x402` cannot be imported from a bare
`tsx` script (confirmed directly: `MODULE_NOT_FOUND`, no built `dist/` output,
only Vitest's transform pipeline resolves this repo's workspace-linked
TS/ESM/path-mapped graph — the same finding already established at checkpoint 1I
for `buildPaidServicesApp`). The entire campaign therefore lives in one
self-contained file, `apps/edge-api/tests/load-v2.test.ts`: it boots the same
real Miniflare-backed D1 database and real `buildPaidServicesApp` Hono app used
throughout the accepted suites, bound to a real ephemeral local TCP port via
`@hono/node-server` (the same pattern `schemathesis-server-host.test.ts`
established at checkpoint 1I) — a genuine local HTTP listener, not
`app.request()` in-process calls — then runs the profile matrix against it via
real `fetch()`.

Pure statistics/concurrency helpers (`scripts/security/load-stats.ts`:
`percentile`, `computeLatencyStats`, `throughputPerSecond`,
`runWithConcurrency`) have no I/O and are unit-tested directly against known
samples, independent of any real HTTP campaign (16 self-tests, all passing).

## 5. Profile matrix

Full detail in `security/load/LOAD_MATRIX.md`. Seven named, deterministic
profiles against the real 402 → decode → pay → 200/202 lifecycle, targeting only
the 4 v2 routes: `WARMUP`, `STEADY_CONCURRENCY`, `BURST`, `D1_CONTENTION`,
`MIXED_SERVICE`, `DUPLICATE_ID_CONTENTION`, `RESOURCE_STABILITY`. Total
real-request count: 118. Total measured wall time: ~57s locally, within
directive §15's "must finish in reasonable CI time" guidance.

### A genuine test-authoring bug found and fixed during construction

The first `DUPLICATE_ID_CONTENTION` draft had each of the 10 concurrent tasks
independently fetch its own fresh 402 challenge before paying — so all 10 ended
up bound to _different_ `quote_id`s despite sharing one Payment-Identifier,
which the system correctly rejected as a genuine binding mismatch
(`409 duplicate_conflict`) for several of them, failing the test. This was a
test bug, not an application defect: fixed by fetching **one** shared 402
challenge first, then running 10 concurrent pay attempts that reuse that exact
challenge — the real "same logical request replayed concurrently" case, exactly
mirroring the already-accepted `CONCURRENT_DUPLICATE_REQUEST` scenario in
`chaos-v2.test.ts` and the historical 20-concurrent pattern in
`x402-service-route.test.ts`. After the fix: all 10 concurrent pay attempts
against the single shared binding resolve to `200`/`202`, with at most one
distinct successful result class.

## 6. Local preproduction capacity baseline (disclosed, not remediated)

Fixture-mode measurements show latency growing meaningfully under concurrency
(`WARMUP` p95≈950–1070ms up to `BURST`/`D1_CONTENTION` p95≈7400–12200ms across
runs). This is disclosed as a real `LOCAL_PREPRODUCTION_CAPACITY_BASELINE`
finding — legitimate evidence that CPU-bound work (Ed25519 signing/hashing,
Miniflare's single-connection-like D1 behavior) dominates under concurrency in
this local environment — not a defect silently patched by reducing concurrency
without justification (directive §33). Per-profile request counts were sized to
keep total campaign wall time reasonable for CI while still exercising genuine
concurrency (directive §15).

## 7. Orchestrator and self-tests

`scripts/security/run-load.ts` mirrors `run-chaos.ts`'s proven pattern exactly:
shells out to `vitest run apps/edge-api/tests/load-v2.test.ts --reporter=json`,
then fails closed unless every one of the 7 named required scenarios
(`REQUIRED_LOAD_SCENARIOS`, hardcoded in the runner itself, not derived from the
report alone) both ran and passed — not merely that the overall process exit
code was 0. `scripts/security/run-load.test.ts` (6 self-tests) proves the
runner's own `evaluateLoadReport` logic fails closed on a missing scenario, a
failed scenario, a skipped scenario, an empty report, and that unrelated passing
tests never mask a genuinely missing required one — mirroring
`run-chaos.test.ts`'s already-accepted pattern exactly. Wired as
`pnpm security:load`, appended to `pnpm security:release`.

## 8. Negative controls

**Correctness control:** temporarily changed `RESOURCE_STABILITY`'s own
growth-factor assertion to a deliberately impossible bound
(`toBeLessThan(0.001)`). `pnpm security:load` correctly failed (exit 1, the
named problem identifying exactly `RESOURCE_STABILITY`). Restored the file
exactly (byte-identical, `md5` and `diff`-confirmed); re-ran — clean 7/7 pass
again.

**Threshold control:** temporarily forced `releaseGateThresholdMs = 1`
(deliberately impossible, 1ms) inside `WARMUP`. `pnpm security:load` correctly
failed (exit 1, the named problem identifying exactly `STEADY_CONCURRENCY`'s
p95-vs-threshold assertion, the profile that actually enforces the threshold).
Restored the file exactly (byte-identical `diff`-confirmed); re-ran — clean 7/7
pass again.

Both controls prove the gate can detect the two distinct failure classes it
exists to catch — a broken invariant and a genuinely-exceeded performance
threshold — not merely that `vitest` exits non-zero for unrelated reasons.

## 9. Real completed load campaign

`pnpm security:load`: **7/7 profiles passed**, 0 failed, 0 unexpected failures
across 118 real HTTP requests. `WARMUP` established `releaseGateThresholdMs`
fresh from measured p95; `STEADY_CONCURRENCY`'s p95 stayed within it.
`DUPLICATE_ID_CONTENTION`: 10/10 concurrent pay attempts against one shared
binding resolved 200/202, ≤1 distinct successful result class, 0 duplicate
executions/settlements. `RESOURCE_STABILITY`: RSS growth well under the 5×
catastrophic-growth guard (measured 1.68×–2.15× across runs). 0 Model-D fallback
violations, 0 external provider calls throughout.

## 10. Full regression

Chaos: **PASS**, 18/18 scenarios, unchanged. Schemathesis: **PASS**, unchanged
(exit 0). Semgrep: **PASS**, 0 findings. OSV-Scanner: **PASS**, CRITICAL=0.
Trivy: unchanged, `BLOCKED_EXTERNAL`, HIGH=3 — rechecked truthfully, no
remediation attempted (see §11). `pnpm x402:check`, `pnpm nevermined:check`
(155/155), `pnpm mcp:check`, `pnpm a2a:check` — all PASS.
`pnpm governance:validate` (77/77), `pnpm state:validate` (30/30),
`pnpm tasks:validate` (252/252, pre-update baseline), `pnpm secrets:scan` clean.
Full **`pnpm check`** (format/lint/typecheck/test/PCC/services/ openapi
generate-checks/Python tests/governance/state/tasks
validate/contracts/migrations/D1/control-plane/adapters/document-worker/
verification/services-runtime/x402/mcp/a2a/nevermined/secrets-scan) — **exit
0**, confirmed twice.

## 11. End-of-checkpoint Trivy recheck (§41)

Rerun via `pnpm security:trivy`: unchanged — CRITICAL=0, HIGH=3, 0
misconfigurations. Recorded truthfully as `BLOCKED_EXTERNAL` per the checkpoint
1H/1I taxonomy decision (the scanner executes and reports truthfully;
remediation requires an upstream `@traceloop/node-server-sdk` release compatible
with a fixed `@opentelemetry/sdk-node`, which does not yet exist — reconfirmed
at checkpoint 1H, not reattempted here). No remediation attempted this
checkpoint, per instruction.

## 12. Load criterion transition

**Load: FAIL_INTERNAL → PASS.**

## 13. §42 next-frontier decision (researched, not guessed)

Read `TASKS.yaml`'s actual governance semantics directly rather than assuming.
Across the entire file, exactly **one** task carries `state: 'active'` at any
time (SUN-1000 itself) — every other task is `accepted`, `superseded`,
`blocked_external`, or `pending`. This is a single-active-task, strictly serial
governance model, matching this project's overall execution pattern.

`SUN-1100` ("Public registry launch") depends on **both** `SUN-1000` and
`SUN-0800B`. `SUN-0800B` ("External MCP/A2A Publication and Public
Verification") is independently `blocked_external` (requires public npm registry
access and a reachable public remote MCP endpoint — genuine external
infrastructure this project does not control locally), regardless of SUN-1000's
outcome. `SUN-1200` ("First unknown paid transaction") depends on `SUN-1100`
alone, so it is transitively gated the same way. No other task exists in
`TASKS.yaml` outside the fully-accepted/superseded history.

**Conclusion:** reaching 11/12 PASS on SUN-1000 does **not** unlock any other
task as the new legal frontier — `SUN-1100` remains blocked independent of
SUN-1000's own Trivy gap, since `SUN-0800B` blocks it too. **SUN-1000 remains
the correct active task**, now internally complete except for the single
externally-blocked Trivy criterion. The only next legal frontier _within_
SUN-1000 is its own next checkpoint, **1O** (Phase 2 of the checkpoint 1L
two-phase plan: credential rotation, then real Nevermined v2 agent/plan
registration, live v2 sandbox payment-path proof, MCP/A2A public wiring) —
separately authorized, not started, and **explicitly not begun by this
checkpoint**. Credential rotation is a genuine open item (flagged, not yet
actioned, since checkpoint 1D's diagnostic env-dump exposure) and remains an
explicit prerequisite immediately before 1O — not performed here, per this
checkpoint's own prohibition.

## Final tally

```
PASS               11 / 12
BLOCKED_EXTERNAL     1 / 12   (Trivy)

Schemathesis        PASS
Chaos               PASS
Load                PASS   (FAIL_INTERNAL -> PASS, this checkpoint)
Trivy               BLOCKED_EXTERNAL
```

## External mutations

Nevermined registrations: 0. Nevermined payments: 0. CDP mutations: 0. Live
payments: 0. Credential rotation: 0. Production deployment: 0. DNS mutation: 0.
Price/economics changes: 0. Contract/PCC release version changes: 0.
Schemathesis/Chaos/Trivy weakened: 0.
