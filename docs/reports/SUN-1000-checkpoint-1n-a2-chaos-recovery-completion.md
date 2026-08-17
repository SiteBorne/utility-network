# SUN-1000 Checkpoint 1N-A2 — Chaos Settlement/Recovery Completion

**Status:** Chaos gap-closure, credential-free. No load testing, no credential
rotation, no external provider mutation.

---

## 1. Why 1N-A was narrowly incomplete

Checkpoint 1N-A's `chaos-v2.test.ts` covered verify rejection/timeout, execution
failure, settlement rejection, concurrency, replay, cross-major collision, v2
Nevermined fail-closed, Model D isolation, an acquire-boundary proxy, process
restart, document-worker failure, and a secret-leak check — 13 real scenarios.
It did **not** exercise settlement*pending durability, post-settlement local
uncertainty, reconciliation-read behavior, or restart-from-settlement_pending
recovery for a real `.v2` identity. Citing the already-accepted v1 suite
(`nevermined-route-settlement-recovery.test.ts`) as coverage was correctly
rejected: it is evidence the \_shared* lifecycle implementation is correct, not
evidence the _chaos gate itself_ (`pnpm security:chaos`) exercises those
boundaries.

## 2. Reconciling the historical shared-lifecycle tests

`nevermined-route-settlement-recovery.test.ts` (SUN-0900B checkpoint 1B, 18
tests) was inspected directly, not assumed. Confirmed each of the following
genuinely injects the required fault (not a happy-path recovery test):

| Test                                                                              | Fault injected                                                                                                                               | Persistent pre-state | Persistent post-state                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `normal success writes SETTLEMENT_PENDING durably before the real settle call...` | None — proves the durable-write-before-settle _sequencing_ itself                                                                            | `executed`           | `settled`, `consumed_at` set                                                     |
| `crash scenario A: the durable-persistence write itself failing...`               | Row left at `acquired`, `recordSettlementPending` called directly against the real D1 repository                                             | `acquired`           | `illegal_transition` (settle never reached)                                      |
| `ambiguous settlement leaves lifecycle_stage at settlement_pending...`            | `settle()` returns `ambiguous_settlement`                                                                                                    | `settlement_pending` | `settlement_pending` (unchanged, never `settlement_failed`)                      |
| `crash scenario I: SETTLEMENT_PENDING already committed, "restart"...`            | `settle()` throws after pending persisted; real Miniflare `dispose()`+`new Miniflare()` at the same path; reconciliation reports NOT_SETTLED | `settlement_pending` | `settlement_pending` unchanged, `202`, zero re-verify/execute/settle             |
| `crash-after-provider-commit recovery: fresh Miniflare instance...`               | `settle()` throws after real provider success; real restart; reconciliation reports SUCCEEDED                                                | `settlement_pending` | `settled`, `consumed_at` set, PSL verified, `200`, zero re-verify/execute/settle |

All five are real fault injections against the real production
`createX402ServiceRoute` code path, confirmed genuine.

## 3. Shared v1/v2 lifecycle proof

Direct inspection of `apps/edge-api/src/control-plane/routes/x402-service.ts`:
every `if (rail === 'nevermined')` branch governing settlement_pending
persistence, ambiguous-settlement handling, and reconciliation is gated **by
`rail`**, and never references `config.serviceId`. The implementation is 100%
shared between `.v1` and `.v2` identities — service-major changes only which
`serviceId` string flows through the same functions.

**The actual gap, more precisely stated:** it is not that v2's lifecycle code
differs — it doesn't. It is that checkpoint 1M's live `/v2/...` HTTP wiring
(`paid-services.ts`'s `v2CdpRoute()`) is deliberately, permanently CDP-only and
never sets `rail: 'nevermined'` for any v2 request — this is the correct,
accepted, disclosed Phase-1 fail-closed design (proven again by 1N-A's own
`MODEL_D_RAIL_ISOLATION`/`V2_NEVERMINED_FAIL_CLOSED` scenarios), not a defect.
This means **no live v2 HTTP route can reach the settlement_pending code
today**, through any path — not because the code can't handle v2, but because no
v2 route is currently allowed to select the Nevermined rail at all.

Given this, faithfully proving "the shared code is correct for v2" requires
calling the same underlying primitive (`createX402ServiceRoute`) directly with a
real `.v2` `serviceId` and `rail: 'nevermined'` explicitly — exactly what the
existing v1 suite already does for `.v1` — **without** going through (or
altering) `paid-services.ts`'s deliberately-restricted wiring. This is option 2
from the checkpoint directive ("adds the missing deterministic cases directly"),
applied at the correct layer.

## 4–8. New scenarios added

`apps/edge-api/tests/chaos-v2-settlement-recovery.test.ts` — 5 new scenarios,
reusing the exact harness pattern from
`nevermined-route-settlement-recovery.test.ts` (controllable
`PaymentEvidenceProvider`, fake `NeverminedDelegationLookupClient`, real
Miniflare `dispose()`+recreate for restart), parametrized with
`serviceId: 'company_evidence_graph.v2'`:

- **`SETTLEMENT_PENDING_PREWRITE_FAILURE`** — a v2 D1 row left at `acquired` can
  never be pushed into `settlement_pending`; `recordSettlementPending` returns
  `illegal_transition`; the real settle call is structurally never reached.
- **`SETTLEMENT_PENDING_POSTWRITE_DURABILITY`** — a normal successful v2 payment
  durably writes `settlement_pending` before the real settle call, then advances
  to `settled`/`consumed_at` set. `service_id`/ `service_version` columns
  confirmed to read back exactly `.v2`.
- **`POST_SETTLEMENT_LOCAL_FAILURE`** — an ambiguous settlement response for a
  v2 payment leaves `lifecycle_stage` at `settlement_pending`, never
  `settlement_failed`, never consumed.
- **`RESTART_FROM_SETTLEMENT_PENDING`** — a v2 payment stuck mid-settle (settle
  throws after `settlement_pending` persists) survives a real Miniflare
  `dispose()`+recreate at the same persistence path; NOT_SETTLED reconciliation
  leaves the row exactly where it was, with zero re-verify, re-execute, or
  re-settle.
- **`RECONCILIATION_READ_SUCCESS_PSL_FINALIZATION`** — the hardest case: a v2
  payment settled externally but crashed locally before the HTTP response
  completed. After a real restart, read-only reconciliation (reporting the
  transaction as SUCCEEDED) recovers to `settled`, `consumed_at` set, and a real
  `link_id` (independently-verified PaymentServiceLink) in the response — with
  zero new verify/execute/ settle calls.

## 9. Chaos matrix updated

`security/chaos/CHAOS_MATRIX.md` — new "Checkpoint 1N-A2" section with a
dedicated 5-row table, plus the taxonomy-coverage table corrected to reflect
genuine (not merely cited) coverage of `SETTLEMENT_PENDING_PERSIST_FAILURE`,
post-settlement uncertainty, `RECONCILIATION_READ_FAILURE`/read-recovery, and
PSL finalization.

## 10. Chaos runner integration (option A: direct execution)

`scripts/security/run-chaos.ts` updated: `TEST_FILES` (plural) now runs both
`chaos-v2.test.ts` and `chaos-v2-settlement-recovery.test.ts` together via a
single Vitest invocation; `REQUIRED_CHAOS_SCENARIOS` extended with the 5 new
named scenarios. The runner still fails closed unless every required scenario —
from either file — both ran and passed.

## 11. Negative control retention (and a second, targeted one)

Re-ran the original 1N-A negative control (unchanged) — still passes. Ran a
**second**, new negative control specifically inside the newly-integrated suite:
temporarily changed `POST_SETTLEMENT_LOCAL_FAILURE`'s own assertion to a
deliberately wrong `lifecycle_stage`. `pnpm security:chaos` **failed correctly**
(`vitest_exit_code: 1`, the named problem identifying exactly that scenario).
Restored the file exactly (`diff`-confirmed byte-identical); re-ran — clean
pass, 18/18. This proves the new integration is genuine, not cosmetic: the gate
can detect a real violation specifically within the newly-added
settlement/recovery coverage.

## 12. Real completed chaos campaign

`pnpm security:chaos`: **18/18 scenarios passed** (13 from 1N-A + 5 from 1N-A2),
0 failed. Settlement_pending scenarios: 2. Post-settlement uncertainty
scenarios: 1. Reconciliation scenarios: 2 (NOT_SETTLED and SETTLED cases).
Receipt/PSL scenario: 1 (folded into the SETTLED-recovery case, per §7 below).
Restart-from-pending scenarios: 2. Duplicate executions: 0. Duplicate
settlements: 0. False successes: 0. Unsafe terminal transitions: 0. External
provider calls: 0.

## 7. Receipt/PSL failure boundary

Evaluated independently-injectable receipt-signing and PSL-persistence failure
points: neither is separately exposed as a dependency-injectable seam in this
architecture (receipt construction happens inside the service executor's own
return value, already exercised by every scenario; PaymentServiceLink
construction/verification happens synchronously inside the same finalization
block settlement recovery already exercises). Rather than fabricate an
artificial failure point this architecture doesn't genuinely expose,
`RECONCILIATION_READ_SUCCESS_PSL_FINALIZATION` asserts a concrete,
independently-meaningful PSL proof: a real, non-null `link_id` is present in the
recovered response, confirming the link was actually (re)constructed and
self-verified during recovery, not merely inferred from the `payment_attempts`
row.

## 13. Chaos criterion transition

**Chaos: FAIL_INTERNAL → PASS.**

## 14. Regression

Schemathesis: PASS (1512/1512, unchanged). Semgrep: PASS, 0 findings. OSV: PASS,
CRITICAL=0. Trivy: unchanged, `BLOCKED_EXTERNAL`, HIGH=3. `pnpm x402:check`,
`pnpm nevermined:check` (155), `pnpm mcp:check`, `pnpm a2a:check` — all PASS.
Full `pnpm test`: **147 files, 1763 passed, 24 skipped** (up from 1758 — the 5
new scenarios, zero regressions). `pnpm governance:validate` (77/77),
`pnpm state:validate` (30/30), `pnpm tasks:validate` (252/252),
`pnpm secrets:scan`, and **`pnpm check`** — all exit 0.

## Final tally

```
PASS               10 / 12
FAIL_INTERNAL       1 / 12   (Load)
BLOCKED_EXTERNAL    1 / 12   (Trivy)

Schemathesis        PASS
Chaos               PASS
Load                FAIL_INTERNAL
Trivy               BLOCKED_EXTERNAL
```

## External mutations

Nevermined registrations: 0. Nevermined payments: 0. CDP mutations: 0. Live
payments: 0. Credential rotation: 0. Production deployment: 0.
