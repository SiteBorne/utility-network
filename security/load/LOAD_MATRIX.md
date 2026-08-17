# SUN-1000 Checkpoint 1N-B — v2 Load / Capacity Matrix

Machine-readable-enough index of every profile in
`apps/edge-api/tests/load-v2.test.ts`, executed by `pnpm security:load`
(`scripts/security/run-load.ts`). Every profile is a named, deterministic `it()`
block against a real local `@hono/node-server` HTTP listener on a real ephemeral
port — not `app.request()` in-process calls, not a rerun of Chaos. `run-load.ts`
fails closed unless every row below both ran and passed, not merely that the
overall process exited 0.

Target: the forward v2 service family exclusively (`company_evidence_graph.v2`,
`web_context_verified.v2`, `document_evidence_json.v2`,
`verify_agent_output.v2`) and their real `/v2/...` HTTP routes, via the real 402
→ decode → pay → 200/202 lifecycle (`decodePaymentRequiredHeaderSafe` /
`buildBuyerPaymentIdentifierExtensions` / `encodePaymentSignatureHeaderSafe`,
the same accepted synthetic buyer-signature fixture pattern already used by
`security:chaos` and `security:schemathesis`). Credential-free throughout: zero
Nevermined calls, zero CDP calls, zero live settlements, zero DNS/production
mutation.

## Release-gate threshold (not a production SLA)

No governed numeric load/latency/throughput threshold exists anywhere in this
repository for the SUN-1000 load criterion specifically —
`governance/RUBRIC.yaml` mentions "p95 latency under SLA" with no number;
`governance/PROMOTION_STATES.yaml`'s "1x"/"3x expected traffic" language governs
a different axis (the per-service production-promotion ladder) and never
numerically defines "expected traffic" either. Per directive §3, this gate
therefore derives its own `RELEASE_GATE_THRESHOLD` empirically, from the run's
own measured `WARMUP` profile, rather than fabricating a production number:

```
releaseGateThresholdMs = max(warmupStats.p95 * 10, 2000)
```

A deliberately generous 10× multiplier over the same run's own warm p95, with a
2000ms floor for CI-machine variability — computed fresh every run from real
local measurement. This is a **regression guard**, disclosed as such: a detector
for a large capacity regression versus this codebase's own current local
baseline, never a customer-facing capacity guarantee.

## Profiles

| Profile ID                | Services                    | Concurrency | Requests | ID strategy            | Expected responses                      | Latency guard                        | Error guard                     |
| ------------------------- | --------------------------- | ----------- | -------- | ---------------------- | --------------------------------------- | ------------------------------------ | ------------------------------- |
| `WARMUP`                  | all 4                       | 2           | 8        | unique per request     | 100% 200/202                            | establishes `releaseGateThresholdMs` | 0 unexpected failures           |
| `STEADY_CONCURRENCY`      | all 4 (even split)          | 8           | 40       | unique per request     | 100% 200/202                            | p95 < `releaseGateThresholdMs`       | 0 unexpected failures           |
| `BURST`                   | `company_evidence_graph.v2` | 16          | 16       | unique per request     | 100% 200/202                            | none (disclosed capacity baseline)   | 0 unexpected failures           |
| `D1_CONTENTION`           | `company_evidence_graph.v2` | 15          | 20       | unique per request     | 100% 200/202, single result class       | none (disclosed capacity baseline)   | 0 unexpected failures           |
| `MIXED_SERVICE`           | all 4 (6 each)              | 8           | 24       | unique per request     | 100% 200/202, even distribution         | none                                 | 0 unexpected failures           |
| `DUPLICATE_ID_CONTENTION` | `company_evidence_graph.v2` | 10          | 10       | **one shared** binding | 100% 200/202, ≤1 distinct success class | n/a                                  | 0 unexpected failures           |
| `RESOURCE_STABILITY`      | n/a (measures process RSS)  | n/a         | n/a      | n/a                    | n/a                                     | n/a                                  | RSS growth < 5x across campaign |

`DUPLICATE_ID_CONTENTION` deliberately mirrors Chaos's already-accepted
`CONCURRENT_DUPLICATE_REQUEST` shape: **one** real 402 challenge is fetched
first (a single `quote_id`/binding), then 10 concurrent pay attempts reuse that
exact challenge — the genuine "same logical request replayed concurrently" case.
Fetching a fresh 402 challenge per concurrent task instead would bind each
attempt to a _different_ quote under the same Payment-Identifier, which the
system correctly treats as an unrelated `duplicate_conflict`, not this scenario.

Total campaign real-request count: 118 (8+40+16+20+24+10, `RESOURCE_STABILITY`
adds no requests of its own). Total measured wall time: ~57s locally — within
directive §15's "must finish in reasonable CI time" guidance
(`NO_LONG_SOAK_REQUIRED_BY_POLICY`).

## Local preproduction capacity baseline (disclosed, not remediated)

Fixture-mode local measurements (Miniflare D1 + real Ed25519 signing pipeline)
show latency growing meaningfully under concurrency — `WARMUP` p95≈950-1070ms,
`STEADY_CONCURRENCY` p95≈4000-4230ms, `BURST` p95≈7400-12200ms, `D1_CONTENTION`
p95≈7250-10380ms (both directives runs recorded; exact figures vary
machine-to-machine). This is disclosed as a real
`LOCAL_PREPRODUCTION_CAPACITY_BASELINE` finding — legitimate evidence that
CPU-bound work (crypto signing/hashing, Miniflare's single-connection-like D1
behavior) dominates under concurrency in this environment — not a defect
silently patched by reducing concurrency without justification (directive §33).

**Total profiles: 7.** Every row corresponds 1:1 to a named `it()` block in
`load-v2.test.ts` and a required-scenario-name entry in
`scripts/security/run-load.ts`'s `REQUIRED_LOAD_SCENARIOS`.
