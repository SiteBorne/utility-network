# SUN-1221E6R-H2BF2 — Non-Economic Qualification: STOPPED (unexpected state)

## Outcome

`SUN1221E6R_H2BF2_NONECON_QUALIFICATION=BLOCKED_UNEXPECTED_STATE`

All authorized mutations were performed exactly once, in order, as
authorized. The resulting Workflow instance state is unexpected and
inconsistent with either hypothesis this checkpoint set out to test.
Per the authorization's explicit instruction, I stopped without retry,
second upload, second `triggers deploy`, or second instance.

## Pre-mutation proof (executed, not just read)

Before any Cloudflare mutation, built a synthetic
`WorkflowContinuationInput` payload with a structurally-valid envelope
(correct IV/ciphertext/fingerprint lengths and encoding) but
undecryptable ciphertext (random bytes, sealed under no real key), and
ran it through the actual, unmodified `runPaidContinuationWorkflow`
function locally with a throwaway AES-256-GCM key and fully-instrumented
fake dependencies that throw on any call:

- `open-envelope` step ran for real, threw `EnvelopeOpenError` (GCM
  auth-tag mismatch) — the exact same failure a real key would produce
  against garbage ciphertext.
- Result: `status: 'workflow_internal_error'`.
- `stepCalls === ['open-envelope']` — no other step ever ran.
- `executorCalls === 0`, `settleCalls === 0`.
- `jobWrites === 0` — `getJob()` itself was never even called, because
  `transitionJobState`/`finalizeTerminalState` are only reached after
  step 0 returns successfully.

This proves the chosen payload is structurally incapable of reaching
the executor, settlement, or any D1 write (economic or otherwise) —
satisfying the authorization's pre-mutation proof requirement. Test
file was local-only, never committed, deleted after the proof ran.

## Mutations performed (exactly as authorized, in order)

1. `wrangler versions upload --tag h2bf2-candidate --keep-vars` from
   verified H2BF1 HEAD `4709b48` (fix commit `bc46d0e`) →
   **`855ee345-3ef8-4ded-91f8-d2f1fcca84d8`**.
2. `wrangler versions deploy de70bf98@100 855ee345@0 --yes` → succeeded,
   replacing failed candidate `6895532e-9106-4a39-a300-c4c35a1ea529` in
   the active deployment.
3. `wrangler triggers deploy` → succeeded, Workflow `Modified` timestamp
   updated to `2026-08-31T20:58:13Z` (confirmed via `workflows list`).
4. `wrangler workflows trigger siteborne-paid-continuation '<payload>' --id h2bf2-nonecon-probe-01`
   → instance queued successfully.

## Result: unexpected

```
Instance Id:    h2bf2-nonecon-probe-01
Version Id:     ae57d91e-4d84-4736-abe6-a456feebf203
Status:         Errored
Start/End:      8/31/2026, 3:58:33 PM (0 seconds)
Error:          TypeError: The RPC receiver does not implement the method "run".
Steps:          (none — 0 executed)
```

**Zero steps executed** — not even `open-envelope`. This means the
platform's RPC dispatch layer failed before ever entering the
deployed `PaidContinuationWorkflow.run()` body at all — the exact same
failure signature as the original H2B attempt, despite the fix being
locally proven, present in the uploaded bundle (worker-runtime's own
bundle-reachability gate independently confirms this — see H2BF1
evidence), and now live at commit `bc46d0e` / version `855ee345`.

## Read-only reconciliation

- `wrangler versions view ae57d91e-4d84-4736-abe6-a456feebf203` →
  **404, "Worker version could not be found"**. This ID does not exist
  in the Worker Versions API at all.
- `wrangler versions list` (10 most recent) confirms `855ee345` is a
  real, listed version; `ae57d91e` never appears.

**This disproves the specific "routed to `de70bf98`" hypothesis H2BF1
flagged as defect candidate B** — the instance's reported "Version Id"
isn't `de70bf98` either. It appears to be a distinct, Workflow-engine-
internal identifier (a different ID namespace than Worker Script
Versions), not a Worker version at all. I could not determine what it
actually refers to using only the read-only tools available in this
checkpoint (`wrangler versions`/`deployments`/`workflows` subcommands
have no lookup for this ID). This is a genuinely unresolved platform
question, not a code defect in this repository provable from source —
which is exactly why I am stopping rather than guessing at another fix.

## What did NOT happen (zero economic law)

```
NEW_WORKER_UPLOADS=1        (authorized: 1)
NEW_DEPLOYMENTS=1           (authorized: 1)
TRIGGERS_DEPLOY_CALLS=1     (authorized: 1)
WORKFLOW_INSTANCE_CREATIONS=1 (authorized: 1)
SECOND_UPLOAD=0
SECOND_DEPLOYMENT=0
SECOND_TRIGGERS_DEPLOY=0
SECOND_INSTANCE=0
LIVE_402_REQUESTS=0
EIP3009_AUTHORIZATIONS_CREATED=0
SIGNER_CALLS=0
PAID_REQUESTS=0
FACILITATOR_SETTLE_CALLS=0
SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
SECRET_MUTATIONS=0
D1_MUTATIONS=0 (proven: 0 Workflow steps executed, so the pure
  orchestration function's own D1 writes were never reached; the
  platform-level RPC failure happened even before that)
H1_JOB_MUTATIONS=0
H2B_FORENSIC_EVIDENCE_MUTATIONS=0 (siteborne-wf-60276963... instance,
  the original H2B evidence, untouched -- confirmed still listed)
CANDIDATE_NORMAL_TRAFFIC=0% (855ee345, confirmed via deployments list)
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
```

## Next required checkpoint

`SUN-1221E6R-H2BF3` — read-only investigation into what
`ae57d91e-4d84-4736-abe6-a456feebf203` actually is (likely requires
Cloudflare Workflows platform documentation/support research beyond
this repository's own source, since it is not a Worker Script Version
and this codebase has no other record of it) before any further
Cloudflare mutation is authorized.

`SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE=NO`
