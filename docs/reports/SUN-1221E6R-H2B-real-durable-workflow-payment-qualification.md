# SUN-1221E6R-H2B — Real Durable-Workflow Payment Qualification

## Outcome

`SUN1221E6R_H2B_REAL_PAYMENT_QUALIFICATION=FAIL_RECONCILED_NO_SETTLEMENT`

The one authorized real-payment attempt did not settle. Zero economic effect
is independently proven (not inferred) via on-chain balance and Workflow
instance evidence. The client-side tool correctly reported `ambiguous`
(it cannot see server-side state) and correctly did not retry; this
checkpoint's read-only reconciliation resolves that ambiguity to a
definitive, non-economic failure.

## Human authorization

Present, in-chat, standalone, scoped exactly to candidate
`6895532e-9106-4a39-a300-c4c35a1ea529`, one 402/authorization/signature/paid
submission/settlement attempt, 0.009 USDC / 9000 atomic, `web_context_verified.v2`.

## Pre-payment containment (all PASS, see prior message in this turn)

- `PREPAY_PRODUCTION_TRAFFIC=100%` (`de70bf98-f304-4d7f-b189-4ae2401041a0`)
- `PREPAY_CANDIDATE_TRAFFIC=0%` (`6895532e-9106-4a39-a300-c4c35a1ea529`)
- `PREPAY_WORKFLOW_READINESS=PASS` (resource exists, correct name/class/script, 0 instances)
- Route wiring proven from source: both production routes propagate `workflow` and `continuationEnvelopeKey`
- `PREPAY_SINGLE_SETTLEMENT_OWNER=PASS` (0 HTTP settle callsites, 1 Workflow settle callsite, 0 other)
- Critical local tests: 85/85; worker-runtime 95/95
- `BUYER_USDC_BALANCE_BEFORE_ATOMIC=28197`
- Fixed an unrelated but load-bearing defect before handoff: the operator
  test's Vitest default 5000ms timeout (the exact cause of the earlier H1
  incident, job `de147124`) was never actually fixed despite being
  identified in the H1A report. Fixed to 120s in commit `317bd7f` before
  handoff, to avoid repeating that incident against a path that now
  includes a real Modal executor (≤35s) in the synchronous wait.

## Human-executed attempt

Command run by the operator:

```
RUN_LOCAL_WEB_CONTEXT_FIRST_PAID_E2E=1 CDP_API_KEY_ID=*** CDP_API_KEY_SECRET=*** CDP_WALLET_SECRET=*** pnpm web-context-first-paid-e2e
```

Sanitized result (verbatim, as printed by the tool — no signature/key material):

```json
{"ok":false,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,"payment_material_created":true,"paid_request_submitted":true,"submission_result":"ambiguous","http_status":500}
```

- `LIVE_402_REQUESTS=1`
- `PAYMENT_CHALLENGE_VALID=PASS` (tool validates network/asset/amount/payTo/EIP-712 domain before signing; `challenge_validated:true`)
- `EIP3009_AUTHORIZATIONS_PREPARED=1`
- `SIGNER_CALLS=1` (`payment_material_created:true`)
- `PAYMENT_SIGNATURES_CREATED=1`
- `PAID_REQUESTS=1` (`paid_request_submitted:true`)
- `CLIENT_RESULT_CLASSIFICATION=AMBIGUOUS` (tool's own conservative classification — correct behavior, no retry attempted)

## Immediate read-only reconciliation (this checkpoint)

**Buyer balance**, live Base RPC read, both before handoff and after the attempt:

```
before: 28197 atomic
after:  28197 atomic
delta:  0
```

**Workflow instance** (`wrangler workflows instances list/describe`):

```
Instance Id: siteborne-wf-60276963a1d38678c3cfc70fcfa37747b1953914f54208ca
Version Id:  63a19f97-c6f4-4fe1-99d6-998bdc11d656
Status:      Errored
Queued:      2026-08-31T15:10:43
Start:       2026-08-31T15:10:45
End:         2026-08-31T15:10:45
Duration:    0 seconds
Error:       TypeError: The RPC receiver does not implement the method "run".
Steps:       (none)
```

Exactly one instance exists (matching the deterministic-instance-ID design —
no duplicate/retry instance was created). Zero steps executed means the
failure occurred before step 0 (input validation), before envelope
decryption, before the executor, before PCC, and before settlement.

## Root cause (read-only source inspection — no fix applied; out of scope for H2B)

`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`,
the `PaidContinuationWorkflow.run()` method actually invoked by the Cloudflare
platform, is a hard-coded stub:

```ts
export class PaidContinuationWorkflow extends WorkflowEntrypoint<Env, WorkflowContinuationInput> {
  async run(event, step): Promise<WorkflowContinuationResult> {
    void event;
    void step;
    throw new Error(
      'PaidContinuationWorkflow.run() dependency wiring is not implemented until H2AWI-3/4 -- ' +
        'this checkpoint (H2AWI-2) only implements and tests runPaidContinuationWorkflow() ' +
        'directly against injected fakes.'
    );
  }
}
```

The real, fully-tested implementation (`runPaidContinuationWorkflow()`,
line 475 of the same file) exists and was never wired into `run()`. The
comment explicitly deferred this to "H2AWI-3/4," but neither H2AWI-3
(which tested the free function directly against fakes/
`in-process-workflow-binding.ts`) nor H2AWI-4/4R/4P (which verified
infrastructure provisioning — resource existence, bindings, secrets — but
never triggered a real Workflow run) closed that gap. This H2B attempt is
the first time the real class was ever invoked by the real platform.

**Caveat, stated plainly:** the observed platform error
(`"The RPC receiver does not implement the method \"run\""`) does not
literally match the stub's own thrown message. Either the platform failed
before reaching the stub's `throw` (e.g. an export/class-binding issue
specific to how `WorkflowEntrypoint` subclasses are resolved by
`class_name`), or wrangler's reporting collapses different early failures
into this generic message. Both explanations are consistent with the
proven fact (0 steps, 0 duration) that execution never reached step 0. This
report does not claim a single, fully-confirmed root cause beyond that —
only that the stub is a real, separately-confirmed defect that would have
blocked correct operation regardless.

This is the same class of gap as E6P (Modal env propagation) and H2AWI-3F
(route wiring): a wiring/integration defect invisible to unit tests built
against fakes, only found by exercising real infrastructure.

## Result / receipt / D1

Not applicable — the Workflow never reached step 0, so no result, receipt,
job-state transition, or settlement-attempt record was created for this
instance. `RESULT_COUNT=0`, `RECEIPT_COUNT=0`.

## Final containment (fresh readback)

- `FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`
- `FINAL_PRODUCTION_TRAFFIC=100%`
- `FINAL_CANDIDATE_VERSION=6895532e-9106-4a39-a300-c4c35a1ea529`
- `FINAL_CANDIDATE_TRAFFIC=0%`
- `NEW_WORKER_UPLOADS=0`, `NEW_WORKER_DEPLOYMENTS=0`, `WORKFLOW_RESOURCE_MUTATIONS=0`,
  `SECRET_MUTATIONS=0`, `D1_SCHEMA_MUTATIONS=0`, `TRAFFIC_MUTATIONS=0`
- H1 forensic job (`de147124-…`): untouched
- Two source commits made this checkpoint, both narrow and disclosed:
  `09c0018` (operator tool candidate repoint) and `317bd7f` (operator tool
  timeout fix) — neither touches payment logic, economics, settlement
  order, or the Workflow itself.

## Authorization retirement

`H2B_AUTHORIZATION_RETIRED=YES`. No standing payment permission remains. A
further real-payment attempt requires a fresh standalone human
authorization, and should not be attempted until the `run()` wiring defect
is fixed and independently proven (e.g. a synthetic/non-economic trigger of
the deployed candidate's real Workflow reaching at least step 0) — the same
"fix, prove with real infrastructure, then re-authorize" pattern used for
E6P and H2AWI-3F.

## F eligibility

`SUN1221F_CANARY_ELIGIBLE=NO` — `H2B_REAL_PAYMENT_QUALIFICATION` did not
`PASS`.
