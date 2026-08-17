# SUN-1000 Checkpoint 1N-B2 — Freeze Load Capacity Baseline

**Status:** Load-gate completion, credential-free. No chaos rerun, no credential
rotation, no external provider mutation, no Phase 2/1O work.

---

## 1. Baseline

Confirmed: `git status --short` empty, `git rev-parse --short HEAD` = `5bc6c4d`.
Ran `pnpm security:load`, `pnpm security:chaos`, `pnpm security:schemathesis`,
`pnpm check` against the accepted 1N-B state before any threshold-policy change
— all green, matching the accepted checkpoint's own reported results. Full
pre-change per-profile/per-service/aggregate metrics were captured across three
real, unmodified campaigns against the harness committed at `5bc6c4d` (collected
across this checkpoint and 1N-B itself, since 1N-B's own logging did not print
p99/max/per-service figures) — recorded verbatim in
`security/load/CAPACITY_BASELINE.json`'s `measured_p95_evidence_ms` and
`official_baseline_freeze_campaign` fields, not summarized away.

## 2. Adaptive-threshold defect confirmed

Direct inspection of the accepted `apps/edge-api/tests/load-v2.test.ts` (commit
`5bc6c4d`) confirmed the exact code:

```ts
releaseGateThresholdMs = Math.max(warmupStats.p95 * 10, 2000);
// ...
expect(result.stats.p95).toBeLessThan(releaseGateThresholdMs);
```

`warmupStats` is assigned from the **same candidate run's own** `WARMUP` result,
and `STEADY_CONCURRENCY`'s pass/fail ceiling is computed directly from it, every
run. Classification: **`SELF_NORMALIZING_REGRESSION_THRESHOLD`**, confirmed
exactly as described. This is a real gate-design defect, not merely a reporting
overstatement — corrected below.

## 3. Frozen baseline artifact

`security/load/CAPACITY_BASELINE.json` — committed, human-reviewable. Records:
`baseline_id`/`baseline_version`,
`environment_classification: LOCAL_PREPRODUCTION_CAPACITY_BASELINE`,
`source_commit_parent: 5bc6c4d`, `not_a_production_sla: true`, the full
worst-observed p95 evidence per profile across 4 real campaigns, one official
post-instrumentation baseline-freeze campaign's complete aggregate + per-service
metrics (118 requests, p50/p95/p99/max/throughput, RSS before/after), the
derived fixed thresholds with their exact derivation formula, the throughput
policy, the resource guard, and an explicit `update_policy`.

## 4. Fixed release limits — derivation

```
fixed_p95_ceiling_ms = max(worst_observed_p95 * margin, floor_ms)
margin = 3
floor_ms = 5000
```

`margin=3` is applied to the **worst** observed p95 per profile (not the typical
one) across 4 independent real campaigns — evidence that already shows real
same-machine run-to-run variance up to ~1.6× on its own (`STEADY_CONCURRENCY`:
4011.8–6367.2ms). A further 3× on top of the worst point gives generous headroom
for CI-machine variability while still catching a genuine multi-x regression;
`floor_ms=5000` matches 1N-B's original floor rationale, applied uniformly.
Values rounded **up** to the nearest 500ms for a small extra margin, never down.
These are fixed values committed to the repository — no candidate run recomputes
them.

## 5. Per-profile ceilings

Profiles differ materially (`WARMUP` ~1s vs `BURST`/`D1_CONTENTION` ~7–8s), so
per-profile p95 ceilings are frozen individually rather than one global
aggregate gate:

| Profile              | Worst observed p95 (ms) | Fixed ceiling (ms) |
| -------------------- | ----------------------- | ------------------ |
| `WARMUP`             | 1550.3                  | 5000               |
| `STEADY_CONCURRENCY` | 6367.2                  | 19500              |
| `BURST`              | 8132.5                  | 24500              |
| `D1_CONTENTION`      | 7780.4                  | 23500              |
| `MIXED_SERVICE`      | 5028.1                  | 15500              |

`DUPLICATE_ID_CONTENTION` remains correctness-focused (no latency gate, matching
1N-B's original design — it asserts binding/duplicate-execution invariants, not
capacity).

## 6. Throughput policy

`THROUGHPUT_MEASURED_NOT_RELEASE_BLOCKING`. Measured throughput (~1.8–2.2 req/s
per profile) is recorded as evidence on every run
(`security/output/load-campaign-metrics.json`), but it is bounded by this
harness's own deliberately small concurrency settings (2–16) and real
per-request cryptographic/D1 work — not by any system-wide capacity ceiling. No
trustworthy cross-machine minimum QPS can be justified from this evidence alone,
so none is enforced. Latency (§4–5), correctness (0 unexpected
failures/duplicates), and the resource guard (§7) are what release-gate this
criterion.

## 7. Resource guard

`RESOURCE_STABILITY`'s guard (`rss_after / rss_before < 5`) was already a fixed
constant, not derived from any candidate run's own measurement — **retained
unchanged**, not part of this checkpoint's correction. Measured growth evidence
across 5 real campaigns: 1.68×, 2.01×, 2.02×, 2.12×, 2.15× — comfortably under
the 5× catastrophic-growth guard, with real headroom for normal Node/V8 heap
variance.

## 8. Load runner update

`WARMUP` still runs first in every campaign (it removes real startup/JIT/
connection noise from the measurement) but no longer computes its own release
ceiling. Every latency-gated profile (`WARMUP` itself included — now checked
against the same fixed ceiling every other run is checked against, not a special
case) imports `FIXED_P95_CEILING_MS` from the new
`scripts/security/load-thresholds.ts`, which loads
`security/load/CAPACITY_BASELINE.json` directly — a plain, committed JSON read,
never computed from the current run. Real HTTP, Miniflare/D1, v2-only forward
surface, 7 profiles, credential-free providers, and every existing correctness
invariant are unchanged.

## 9. Baseline update policy

Recorded directly in `CAPACITY_BASELINE.json`'s own `update_policy` field: a
normal `pnpm security:load` run never rewrites or loosens this file or any
threshold derived from it — there is no "learn mode" in ordinary release
execution. Updating the baseline is a separate, deliberate, human-reviewed
action (a new checkpoint, exactly like this one), requiring fresh measured
evidence and an explicit commit reviewing the new numbers against the old ones.
The gate fails first; baseline change is always a distinct, later, intentional
act.

## 10. Performance negative control

Temporarily set `STEADY_CONCURRENCY`'s committed ceiling to `1` (ms) in
`CAPACITY_BASELINE.json`. `pnpm security:load` correctly failed (exit 1), naming
exactly `STEADY_CONCURRENCY`'s latency-threshold assertion as the failed
scenario. Restored the file exactly (`diff`-confirmed byte-identical, `md5`
matched); re-ran — clean 7/7 pass. This proves the **frozen threshold itself**
is enforced, not merely that the comparison code executes.

## 11. Global-slowdown negative control (decisive)

Set `LOAD_TEST_ARTIFICIAL_DELAY_MS=2500` (an env-var-only, test-only hook
applied identically inside `runPaidLifecycle` to every real request — warmup and
candidate traffic alike; no file mutated). Result:

```
[load:WARMUP] p95=6126.2ms  (fixed ceiling: 5000ms)
[load:STEADY_CONCURRENCY] p95=9013.1ms  (fixed ceiling: 19500ms — still passes)
AssertionError: expected 6126.2005 to be less than 5000
LOAD: gate failed. See security/output/load.json
```

`pnpm security:load` correctly failed (exit 1), identifying `WARMUP`'s own
now-fixed latency ceiling. This is the decisive proof the defect is closed:
under the **old** self-normalizing formula, this same delayed `WARMUP` run
(p95=6126.2ms) would have produced
`releaseGateThresholdMs = max(6126.2×10, 2000) = 61262ms`, and
`STEADY_CONCURRENCY`'s equally-delayed p95 of 9013.1ms would have **passed**
against that self-inflated threshold — completely masking a genuine ~2.3×
uniform latency regression across the whole system. Under the **new** frozen
baseline, the regression is caught immediately by `WARMUP`'s own fixed ceiling,
and no other fixed ceiling moves with it. Removed the env var (no file to
restore — the hook is inert with it unset); re-ran — clean 7/7 pass, confirming
full restoration.

## 12. Real campaign

Final clean campaign (post-restoration, `LOAD_TEST_ARTIFICIAL_DELAY_MS` unset):
**7/7 profiles PASS**, 118 real requests. 0 unexpected 4xx, 0 unexpected 5xx, 0
transport errors, 0 timeouts, 0 duplicate executions, 0 duplicate settlements, 0
wrong-service responses, 0 external provider calls. Aggregate: p50=4103.8ms,
p95=8100.7ms, p99=8111.0ms, max=8111.4ms, throughput=2.12req/s, duration=55.7s.
Per-service p95: `company` 8110.2ms (64 req, the only profile family exercising
`company` at BURST/D1_CONTENTION concurrency), `web` 4182.4ms, `document`
4158.4ms, `verify` 4070.3ms (18 req each). RESOURCE_STABILITY: RSS 313.5MB →
562.8MB, growth 1.80×. Every frozen latency/resource threshold passed with real
margin.

## 13. Load criterion

**Load: FAIL_INTERNAL → PASS.**

```
PASS               11 / 12
FAIL_INTERNAL        0 / 12
BLOCKED_EXTERNAL     1 / 12

Schemathesis        PASS
Chaos               PASS
Load                PASS
Trivy               BLOCKED_EXTERNAL

SUN-1000 remains active while the required Trivy criterion remains unsatisfied.
production_ready=false
production_enabled=false
```

## 14. Regression

`pnpm security:load`: PASS, 7/7. `pnpm security:chaos`: PASS, 18/18, unchanged.
`pnpm security:schemathesis`: PASS, unchanged. `pnpm security:semgrep`: PASS, 0
findings. `pnpm security:osv`: PASS, CRITICAL=0. `pnpm security:trivy`:
unchanged, `BLOCKED_EXTERNAL`, HIGH=3 — rechecked truthfully, no remediation
attempted. `pnpm x402:check`, `pnpm nevermined:check` (155/155),
`pnpm mcp:check`, `pnpm a2a:check` — all PASS. `pnpm governance:validate`
(77/77), `pnpm state:validate` (30/30), `pnpm tasks:validate` (252/252),
`pnpm secrets:scan` clean. Full `pnpm check` — exit 0.

## 15. Next-frontier policy (retained + 1O legal-status research)

Retained from the accepted 1N-B finding, re-verified unchanged: single active
task; `SUN-1100` depends on both `SUN-1000` and `SUN-0800B`; `SUN-0800B` is
independently `blocked_external`; `SUN-1200` depends on `SUN-1100`.
`SUN-1100`/`SUN-1200` are **not** activated by this checkpoint.

**Is checkpoint 1O legally executable while Trivy remains `BLOCKED_EXTERNAL`?**
Read the actual governing text directly rather than assuming either answer.
`TASKS.yaml`'s `state: 'active'` is precisely the state in which SUN-1000's own
iterative checkpoint work has always happened — every checkpoint from 1A through
this one (1N-B2) executed _while_ SUN-1000 remained `active` and its 12 criteria
were still incomplete; nothing in `TASKS.yaml`'s schema or in
`governance/*.yaml` requires all 12 criteria to pass before further internal
checkpoint work proceeds under an `active` task. `PROJECT_STATE.yaml`'s
`execution.frontier_status: 'executable'` and `blocked_on: []` describe SUN-1000
as the current executable frontier with no recorded external blocker on the
_task_ itself. Searched `governance/HARD_GATES.yaml` and
`governance/RISK_LIMITS.yaml` directly for any rule tying provider mutation,
credential rotation, or Phase-2 work to the Trivy criterion specifically — found
none. The only actual constraint governing 1O is self-imposed by this project's
own checkpoint 1L/1N architecture: 1O requires credential rotation _first_ (an
existing, separately tracked open item since checkpoint 1D's diagnostic
exposure), which is unrelated to Trivy.

**Conclusion:** 1O is a legal next sub-checkpoint of the still-active SUN-1000
task — the governing text does not require Trivy (or the other 11 criteria) to
reach PASS before further internal checkpoint work continues. What Trivy's
`BLOCKED_EXTERNAL` status _does_ block is SUN-1000 ever reaching
`state: 'accepted'` / `production_ready: true` — a distinct question from
whether 1O can execute. This checkpoint (1N-B2) does **not** begin 1O regardless
of this finding, per its own explicit scope.

## 16. Credential rotation

`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_BEFORE_NEXT_PROVIDER_MUTATION=true`
preserved, unactioned. Not rotated in 1N-B2. If 1O becomes the next executed
checkpoint, credential rotation remains a hard first gate inside/before 1O's
first provider mutation.

## Final tally

```
PASS               11 / 12
BLOCKED_EXTERNAL     1 / 12   (Trivy)

Schemathesis        PASS
Chaos               PASS
Load                PASS
Trivy               BLOCKED_EXTERNAL

SUN-1000            active (not accepted)
production_ready    false
production_enabled  false
```

## External mutations

Nevermined registrations: 0. Nevermined payments: 0. CDP mutations: 0. Live
payments: 0. Credential rotation: 0. Production deployment: 0. DNS mutation: 0.
Price/economics changes: 0. Contract/PCC release version changes: 0.
Schemathesis/Chaos/Trivy weakened: 0. Phase-2/1O work begun: 0.
