# SUN-1222C-R3-COMPANY-LIVE-DIAGNOSIS — Sixth real paid attempt, R10 fix deployed

## 0. Authorization

Exactly one production deployment (R10 observability fix, commit `39b97f1`) +
exactly one fresh real paid qualification attempt for `company_evidence_graph.v2`.
Human operator performed the one signing action and one paid POST. No retry
authorized regardless of outcome.

## 1. Deployment

`siteborne-paid-continuation-runtime` deployed from clean HEAD `39b97f1`
(release-clean working tree) → active version
`453dd8f7-2fa0-44d6-9541-6a79c7fbc80a`, 100% traffic, 2026-09-07T22:41Z.
No other production mutation (public API Worker unchanged: `db7054c9`@100% /
`a064477f`@0%; no secret, D1, or traffic change).

## 2. The sixth real attempt

| Field | Value |
|---|---|
| Payment identifier | `pay_1be0e6752e094e2aa5ae6eb2c9d54bbc` |
| Job ID | `d6563fbb-71ba-4509-8c01-a9e674cba52d` |
| Request input hash | `sha256:7a3ac15e...` (unchanged canonical Apple Inc./CIK 0000320193 body) |
| Job created_at → updated_at | `2026-09-07T23:38:33.935Z` → `2026-09-07 23:38:42` (~8.3s) |
| Job final state | `REJECTED` |
| Payment lifecycle_stage | `verified` |
| `x402_service_results` rows | 0 |
| `payment_attempts.cdp_facilitator_settle_attempt_count` | 0 (row confirms `lifecycle_stage='verified'`, `consumed_at=NULL`) |
| Client-observed result | `{"submission_result":"ambiguous","http_status":502}` |
| Buyer balance before/after | 79,727 / 79,727 atomic (unchanged) |
| Seller balance before/after | 28,000 / 28,000 atomic (unchanged) |
| Economic effect | **0** |

Identical failure signature to the five prior real attempts. **The R6
header-forwarding fix and the R10 observability fix did not change the
outcome.**

## 3. Live observability capture (new this checkpoint)

A `wrangler tail` was attached to `siteborne-paid-continuation-runtime`
*before* the paid POST. It captured the exact invocation for this attempt:

```json
{
  "wallTime": 5670,
  "cpuTime": 83,
  "outcome": "ok",
  "tailAttributes": {
    "workflowName": "siteborne-paid-continuation",
    "instanceId": "siteborne-wf-c57bdaf57173fd4c345921de1ad0e17ff091157f9109a0c9"
  },
  "scriptVersion": { "id": "453dd8f7-2fa0-44d6-9541-6a79c7fbc80a" },
  "entrypoint": "PaidContinuationWorkflow",
  "exceptions": [],
  "logs": [],
  "event": { "rpcMethod": "run" }
}
```

This proves definitively, for this exact attempt: the Workflow's `run()`
method **returned normally** (`outcome: "ok"`) in 5.67 seconds, **threw no
exception**, and ran on the correct post-fix script version. This is not a
crash. The R10 diagnosis's conclusion (business rejection, not lost
exception) is reconfirmed live, not just inferred from D1.

## 4. New finding: the classified detail never reaches durable storage

The R10 fix makes `CompanyEvidenceGraphService` preserve `error.code` /
`error.message` in its `limitations` field instead of discarding them.
But `limitations` is a field on the **service result object**, and that
object is only persisted to `x402_service_results` *after* a settlement
attempt. Every one of the six real attempts (this one included) rejects
**before** settlement, so `x402_service_results` stays empty by design and
the improved classified detail — though correctly computed in-memory —
never lands anywhere durable. The fix is real and correct, but it cannot be
observed from D1 for a pre-settlement rejection. This was not anticipated in
R10's design.

## 5. New finding: the client-observed 502 does not originate in the waiter

`apps/edge-api/src/control-plane/continuation/waiter.ts` — the module that
polls the Workflow instance's `status()` after handoff — is a
**no-timeout** poller by explicit product decision (see its own header
comment, SUN-1221E6R-H2AWI-3): it only returns on a terminal `InstanceStatus`
or the caller's own `AbortSignal`. It never manufactures a 502 on its own.
Given the Workflow instance completed cleanly in 5.67s with `outcome: "ok"`
(§3), a poller with no timeout should have observed `status: 'complete'`
and returned the real classified body to the client well within that
window. The client instead received a bare `502` with no structured body.
That gap — a clean, fast, exception-free Workflow completion versus a raw
gateway-level 502 at the client — is **unexplained** and is a distinct
question from "why did SEC reject the request." It has not been diagnosed
this checkpoint (out of scope: read-only, one attempt, no retry) and is the
correct next thread to pull.

## 6. Reconciliation

```
COMPANY_V2_REAL_PAID_QUALIFICATION=FAIL
FINAL_RECONCILIATION_CLASS=FAIL_RECONCILED_NO_SETTLEMENT
COMPANY_V2_REAL_ATTEMPTS_TOTAL=6
COMPANY_V2_SUCCESSFUL_REAL_ATTEMPTS_TOTAL=0
COMPANY_V2_SUCCESSFUL_SETTLEMENTS_TOTAL=0
PRODUCTION_MUTATIONS=1 (Workflow-host deployment only)
PAYMENT_RETRIES=0
SETTLEMENT_RETRIES=0
BUYER_DELTA_ATOMIC=0
SELLER_DELTA_ATOMIC=0
ECONOMIC_EFFECT_USDC=0
```

No retry performed, per authorization. Working tree unchanged this
checkpoint (docs-only commit).

## 7. Next required checkpoint

`SUN-1222C-R4-EDGE-RESPONSE-PATH-DIAGNOSIS` — read-only: trace the actual
paid-POST route handler in `x402-service.ts` to confirm it really calls
`waitForWorkflowResult`, find where the client-facing `502` actually
originates (Cloudflare platform limit vs. a different/dead polling path vs.
an intermediate proxy), and only then design any further remediation. No
further payment attempt until that gap is closed.
