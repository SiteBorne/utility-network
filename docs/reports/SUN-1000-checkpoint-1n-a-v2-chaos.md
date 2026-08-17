# SUN-1000 Checkpoint 1N-A — v2 Deterministic Chaos / Failure-Injection Gate

**Status:** Chaos criterion implementation and execution, credential-free. No
load testing, no credential rotation, no external provider mutation.

---

## 0. Checkpoint 1M acceptance addendum

Checkpoint 1M's stop-report item 29 stated "Runtime 400 behavior changed? No,"
while the same checkpoint's headline correctly reported a real malformed-input
path that previously produced an unexpected 500 and was fixed for the shared
v1/v2 route handler. Reconciled against the actual evidence (checkpoint 1M
report §31, the Schemathesis before/after logs):

- **Valid-request semantics:** unchanged.
- **Success-response semantics:** unchanged.
- **Payment economics:** unchanged.
- **Malformed-input behavior:** changed narrowly. Before: an
  out-of-JS-safe-integer-range numeric literal that passed AJV's loose
  `type: integer` structural check reached `hashPaymentObject`'s JCS
  canonicalization, which threw an uncaught exception — this escaped the request
  handler as an **unexpected `500`**. After: the same input is caught and
  returns a documented **`400 invalid_request`**, the same public error contract
  already used for malformed JSON one line above. Exact before/after status:
  **`500` (unexpected, uncaught) → `400` (documented, `invalid_request`)** —
  confirmed directly from the checkpoint 1M Schemathesis logs
  (`/tmp/1m-schemathesis.log`: `Server error: 2` on the first run;
  `/tmp/1m-schemathesis3.log`: `1512 generated, 1512 passed`, 0 failures, after
  the fix).
- **Shared handler, both majors benefit:**
  `apps/edge-api/src/control-plane/routes/x402-service.ts`'s
  `createX402ServiceRoute` is the one route builder both `.v1` and `.v2` routes
  are constructed from — the fix applies identically to both, confirmed by the
  full v1+v2 regression suite (both checkpoint 1M's and this checkpoint's)
  passing unchanged.

No 1M code was modified for this bookkeeping correction, and
`docs/reports/SUN-1000-checkpoint-1m-internal-service-v2-implementation.md` is
left as the accepted historical record; this section is the addendum.

## 1. Baseline

`git status --short`: empty. `git rev-parse --short HEAD`: `06ddd4b`.
`pnpm check`: exit 0. Semgrep: PASS, 0 findings. OSV: PASS, CRITICAL=0. Trivy:
`BLOCKED_EXTERNAL`, CRITICAL=0/HIGH=3 (unchanged). Schemathesis: **PASS**,
exit 0. `pnpm secrets:scan`, `pnpm governance:validate` (77/77),
`pnpm state:validate` (30/30), `pnpm tasks:validate` (252/252): all PASS. No
accepted criterion regressed before chaos work began.

## 2. Literal chaos criterion

`TASKS.yaml`'s SUN-1000 `acceptance_tests` lists exactly: `'Chaos suite passes'`
— no further elaboration exists anywhere else in the repository (searched for
"chaos"/"fault injection"/"resilience"/"exactly-once" across `docs/`,
`governance/`, ADRs — no dedicated governing document exists; this was correctly
identified by checkpoint 1A as one of the six originally FAIL_INTERNAL criteria
for "no chaos suite exists anywhere," not a criterion with its own detailed
frozen specification). **Chaos PASS condition** (defined this checkpoint, since
none existed): a bounded, deterministic, named fault-injection matrix targeting
the forward v2 architecture exists, is credential-free, is proven capable of
catching a real invariant violation (negative control), and a real execution of
the full matrix passes with zero unresolved invariant violations.

## 3. Existing failure-injection capability inventory

Reused rather than duplicated: the real Miniflare/D1 harness and `app.request()`
pattern already established and accepted in `x402-service-route.test.ts`
(SUN-0700A checkpoint 5) and `nevermined-route-settlement-recovery.test.ts`
(SUN-0900B checkpoint 1B). The one real, already-exposed fault-injection seam
this codebase has is `PaymentEvidenceProvider` (`verify`/`settle`,
dependency-injected via `config.evidenceProvider`) plus the service executor
closures — no lower-level D1-driver failure seam is exposed to route-level
callers by design (`D1PaymentAttemptRepository` takes a real `D1Database`, never
an injectable failure wrapper). `D1_TRANSIENT_ACQUIRE_FAILURE` therefore uses an
undecodable `PAYMENT-SIGNATURE` as the real, deterministic proxy for "the
request is rejected before any persistence occurs" — the actually observable
acquire-boundary invariant — rather than fabricating a D1-driver mock this
architecture does not support. `SETTLEMENT_PENDING` durability, post-settlement
uncertainty, and reconciliation-read-failure are **already** extensively,
genuinely covered for the shared lifecycle code by the accepted
`nevermined-route-settlement-recovery.test.ts` (18 tests) — not duplicated here
per the directive's own §26 instruction not to inflate case count with identical
coverage, since v2 executes the identical shared code those tests already prove.

## 4–5. v2-only forward target / credential-free

All 13 scenarios target `/v2/...` routes exclusively (v1 used only once, in
`CROSS_MAJOR_COLLISION`, as the _other_ side of a cross-major proof).
`evidenceMode: 'fixture'` throughout; zero Nevermined calls, zero CDP calls,
zero live settlements — confirmed directly, no external client is ever imported
into `chaos-v2.test.ts`.

## 6–8. Fault taxonomy / injection mechanism / no randomness

See `security/chaos/CHAOS_MATRIX.md` for the full taxonomy-coverage table. Every
fault is an explicit, named, deterministic `it()` block — a scripted
`PaymentEvidenceProvider` (`ScriptedEvidenceProvider`, dependency-injected,
never global monkeypatching) or a real, deterministic executor-rejection input.
No probability-based fuzzing is used as the authoritative gate;
`pnpm security:schemathesis`'s own fuzzing phase (already accepted) remains the
place randomized exploration lives.

## 9–26. Invariant coverage

Detailed per-scenario expected provider calls/results are the `CHAOS_MATRIX.md`
table. Summary of invariants proven:

- **Exactly-once:** `CONCURRENT_DUPLICATE_REQUEST` (10 concurrent
  identical-binding requests → ≤1 receipt, ≤1 settle call, every response
  200-or-202, mirroring the accepted v1 20-concurrent pattern exactly).
- **Acquire-first / no false success:** `D1_TRANSIENT_ACQUIRE_FAILURE`,
  `VERIFY_REJECTED`, `VERIFY_TIMEOUT`.
- **Provider verify failure (explicit vs. transport):** `VERIFY_REJECTED`
  (evidence-level `verified: false`) distinctly from `VERIFY_TIMEOUT` (thrown
  transport failure) — proven as genuinely different code paths, neither
  producing a false success.
- **Service execution failure:** `SERVICE_EXECUTION_ERROR`,
  `DOCUMENT_WORKER_FAILURE`.
- **Settlement rejection:** `SETTLEMENT_REJECTED`.
- **Replay:** `REPLAY_AFTER_SUCCESS` (reconstructs, no second settlement).
- **Cross-major collision:** `CROSS_MAJOR_COLLISION` — proves checkpoint 1M's
  frozen global Payment-Identifier uniqueness holds under a real attempted
  collision, not just by inspection of the SQL schema.
- **v2 Nevermined fail-closed:** `V2_NEVERMINED_FAIL_CLOSED` — a
  Nevermined-shaped signature against a v2 route is rejected outright, never
  silently accepted, never falls back to CDP.
- **Model D rail isolation:** `MODEL_D_RAIL_ISOLATION` — a
  Nevermined-_configured_ app still settles v2 exclusively via the real CDP
  network/rail, end-to-end, not just by code inspection.
- **Process restart / persistence-only recovery:**
  `PROCESS_RESTART_AT_PERSISTED_BOUNDARY`.
- **No secret/internal-material leak:** `NO_SECRET_LEAK`.

## 27. HTTP error contract

Every failure scenario asserts a documented status range (`>=400`), no stack
traces, no internal file paths, no unexpected `2xx`. The 2.0.0 OpenAPI contract
itself is unchanged by this checkpoint — confirmed via `openapi:generate:check`
passing with zero drift throughout.

## 28. Chaos matrix artifact

`security/chaos/CHAOS_MATRIX.md` — 13 scenarios, full taxonomy-coverage table.

## 29–30. Chaos runner / self-tests

`scripts/security/run-chaos.ts`, wired as `pnpm security:chaos` (and added to
`security:release`'s chain, mirroring `security:schemathesis`). Runs the real
matrix via Vitest's JSON reporter, then fails closed unless **every** named
required scenario (`REQUIRED_CHAOS_SCENARIOS`, hardcoded in the runner itself,
not derived from the report alone — so a scenario silently renamed or dropped
from the test file is a visible diff here too) both ran and passed — not merely
that the overall process exit code was 0.

6 self-tests (`scripts/security/run-chaos.test.ts`) exercise the runner's own
`evaluateChaosReport` evaluation logic directly, not tautologically: prove it
passes cleanly on a fully-passing report; fails closed when a required scenario
is entirely missing from the report; fails closed when a required scenario ran
but is marked `failed`; fails closed when a required scenario is only `skipped`;
an empty report produces exactly `required_scenario_count` problems; and extra,
unrelated passing tests in the report never mask a genuinely missing required
one.

## 31. Negative control

Before accepting the campaign result: temporarily changed
`CONCURRENT_DUPLICATE_REQUEST`'s own invariant assertion from
`toBeLessThanOrEqual(1)` to a deliberately impossible `toBeLessThanOrEqual(0)`.
Ran `pnpm security:chaos`: **failed correctly** — `vitest_exit_code: 1`,
`problems: ["required chaos scenario did not pass (status=failed): \"CONCURRENT_DUPLICATE_REQUEST...\""]`.
Restored the file exactly (`diff` against the pre-mutation backup confirmed
byte-identical). Re-ran `pnpm security:chaos`: **passed cleanly** — 13/13, 0
problems. No production architecture was touched to produce this control — only
the test file's own assertion was temporarily altered.

## 32. Case bounds

13 named scenarios, one 10-way concurrency case (not hundreds), no soak
duration, no throughput target — this is explicitly not the load criterion
(reserved for checkpoint 1N-B).

## 33. Real chaos campaign

`pnpm security:chaos`: **13/13 scenarios passed**, 0 failed, 0 unexpected
external calls, 0 duplicate executions, 0 duplicate settlements, 0 invariant
failures, ~7 second real Miniflare/D1-backed execution.

## 34. Defect handling

No genuine defect was discovered by this campaign (the one real defect this
whole v2 effort surfaced — the JCS-canonicalization 500 — was already found and
fixed by checkpoint 1M's own Schemathesis fuzzing phase, and is the exact
subject of this report's §0 addendum). Two test-authoring bugs in the chaos
scenarios themselves (an input that unintentionally failed schema validation
before reaching the intended semantic-rejection path, and an over-strict
concurrency assertion not matching the already-accepted 200-or-202 pattern) were
found and corrected during development — these were bugs in the new test file,
not the application.

## 35. Chaos criterion

**Chaos: FAIL_INTERNAL → PASS.**

## 36–39. Regression

Schemathesis: PASS (re-run after chaos work, exit 0, 1512/1512). Semgrep: PASS,
0 findings. OSV: PASS, CRITICAL=0. Trivy: unchanged, `BLOCKED_EXTERNAL`, HIGH=3
(no remediation attempted). `pnpm x402:check`, `pnpm nevermined:check` (155
tests), `pnpm mcp:check`, `pnpm a2a:check`, `pnpm d1:test`,
`pnpm verification:check` — all PASS. Full `pnpm test`: **146 files, 1758
passed, 24 skipped** (up from 1739 — the 13 chaos scenarios + 6 runner
self-tests, zero regressions). `pnpm governance:validate` (77/77),
`pnpm state:validate` (30/30), `pnpm tasks:validate` (252/252),
`pnpm secrets:scan`, and **`pnpm check`** — all exit 0.

## 40. Load remains unstarted

Not implemented, not started. Next checkpoint: **1N-B — v2 load/capacity gate.**
Checkpoint 1O remains reserved for Phase-2 provider-facing work.

## External mutations

Nevermined registrations: 0. Nevermined payments: 0. CDP mutations: 0. Live
payments: 0. Production deployment: 0. DNS mutation: 0. Package publication: 0.
