# SUN-1222C-R4-D5 — Observability Deployment (Host-Only) + Live-Qualification Impossibility Proof

**Status: PASS (deployment + regression scope). Live-instance qualification (§§14–18 of the authorizing checkpoint) was not attempted — §13 proved no safe path exists.**

## 0. Lineage

- Prior checkpoint: `SUN-1222C-R4-D4-CONTINUED` (commit `aaf51ad`), which corrected an earlier
  diagnostic mistake (job/state-event durability was never actually broken) and proved the real,
  narrower defect: `deriveErrorDetail()`'s bounded/sanitized rejection detail was computed but
  never persisted to the durable state-event trail.
- This checkpoint (`R4-D5`) deploys that fix to the one runtime that needed it
  (`siteborne-paid-continuation-runtime`, the dedicated Workflow host) and re-proves the fix from
  source and from the existing mutation-proven unit suite.
- Authorization: standalone, explicit, first-person message received this turn, scoped to exactly
  one host deployment (source `aaf51ad`) plus the non-economic qualification design in §§13–19 of
  the authorizing checkpoint text — not open-ended.

## 1–2. Authorization gate & source reconciliation

```
SUN1222C_R4_D5_AUTHORIZATION=GRANTED
D5_START_HEAD=aaf51ad690e79cb6332bce148f72893dc2924546
D4_COMMIT_REACHABLE=YES
WORKING_TREE_RELEASE_CLEAN=YES
```

## 3. Source-level re-proof of the D4 fix

Full data-flow trace, confirmed by direct source read (not re-derived from memory):

1. `deriveErrorDetail()` — `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:410-421`
   Reads `result.failure?.message`, falling back to the last entry of `result.limitations`;
   bounded via `boundedDetail()` (line 394-398, 500-char cap with `…(truncated)` suffix).
2. Two call sites pass the derived detail as `evidenceRef` into `transitionJobState()`:
   - `executor_rejected` branch, line 787-804 (`result_class !== 'success'`)
   - `executor_timeout` branch, line 760-780 (thrown executor error, same `boundedDetail()` applied
     to `e.message`)
3. `transitionJobState()` (line 428-464) forwards `evidenceRef` unchanged into `createStateEvent()`.
4. `createStateEvent()` (`apps/edge-api/src/control-plane/state-machine/index.ts:47-79`) maps the
   parameter directly onto `StateEvent.evidence_ref` (line 73).
5. `D1JobStatePersistence.appendStateEvent()` (`production-dependencies.ts:239-246`) delegates to
   the real repository `this.stateEvents.create(event)` — no mock, no silent drop.
6. `apps/edge-api/src/control-plane/repositories/d1/jobs.ts:277-289` binds `event.evidence_ref ?? null`
   directly into the D1 `INSERT` statement's parameter list.

```
DERIVE_ERROR_DETAIL_FILE=apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:410-421
STATE_EVENT_WRITE_FILE=apps/edge-api/src/control-plane/repositories/d1/jobs.ts:277-289
EVIDENCE_REF_PASSTHROUGH_PRESENT=YES
```

Bounded: YES (500 chars, `boundedDetail()`). Sanitized: YES (service-authored `failure.message` or
`limitations` entries only — never raw upstream headers/body/payment material). Reaches the
intended terminal transitions: YES (both `QUARANTINED` and `REJECTED` in both failure branches).

## 4. Schema / migration check

`evidence_ref TEXT` already exists as a nullable column, defined in
`migrations/0001_control_plane_foundation.sql:101` — the very first control-plane migration. No
new migration is included in or required by this fix.

```
D5_SCHEMA_CHANGE_REQUIRED=NO
D5_MIGRATION_REQUIRED=NO
```

## 5. D4 test re-confirmation

```
D5_TARGETED_TESTS=41/41 PASS  (apps/edge-api/tests/paid-continuation-workflow.test.ts)
D5_WORKFLOW_TESTS=78/78 PASS  (+ apps/edge-api/tests/x402-service-route.test.ts)
```

## 6. Full predeploy regression

```
TYPECHECK=PASS
BUILD=PASS (12/12 turbo tasks)
LINT=PASS
```

Full suite, first parallel run: **3 test files failed** —
`apps/edge-api/tests/load-v2.test.ts` (two P95-latency-ceiling assertions) and
`packages/service-runtime/src/services/document-evidence/worker-bridge.subprocess.test.ts`
(60s subprocess timeout). Re-ran both files in isolation (not part of the full parallel run):
**10/10 tests PASS**, confirming these are the same pre-existing resource-contention flakes
observed and reconfirmed in every prior R4 sub-checkpoint (D2, D3, D4, deployment-retry) — not a
regression introduced by this change.

```
FULL_TESTS=2966/3047 PASS, 78 skipped, 3 failed under parallel contention (reconfirmed 10/10 PASS in isolation)
PROTOCOL_X402_CHECK=PASS
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
SECRETS_SCAN=2 pre-existing findings, both dated commit 1e3e3d0 (2026-09-03), 0 new
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS (both apps/edge-api default config and wrangler.paid-continuation-runtime.toml)
```

## 7. Settlement-owner invariant

Static grep of every non-test `.settle(` call site in `apps/edge-api/src/`:

- `evidence/cdp-provider.ts:161` — the `evidenceProvider.settle()` method's own implementation
  body (definition, not a second caller).
- `workflows/paid-continuation-workflow.ts:644` — the sole production invocation.
- `testing/in-process-workflow-binding.ts:172` — test harness only.

`x402-service.ts` contains zero executable `.settle(` calls (only comments documenting that it
deliberately never does).

```
PUBLIC_API_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

Unchanged from every prior checkpoint's baseline — this fix touches only the rejection/timeout
branches, both of which `return` before reaching the settle call site at line 644.

## 8. Predeploy host readback

```
PRE_D5_HOST_VERSION_ID=89bc86b2-b09a-4ec6-831d-15f5176539cc
```

11 secret names present (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `MODAL_DOCWORKER_ENDPOINT_URL`,
`MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET`, `MODAL_WEBCTX_ENDPOINT_URL`,
`MODAL_WEBCTX_PROXY_KEY`, `MODAL_WEBCTX_PROXY_SECRET`, `PAID_RECEIPT_SIGNING_KEY_ID`,
`PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAYMENT_CONTINUATION_ENCRYPTION_KEY`) — `CDP_WALLET_SECRET`
absent, as required. 4 ADR-0055 vars exact (`PAYMENT_ENVIRONMENT="production"`,
`PRODUCTION_ENABLED="true"`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP="true"`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED="true"`). `Workflow` binding present
(`PAID_CONTINUATION_WORKFLOW`). No public HTTP route defined in this config.

```
PRE_D5_HOST_CONFIGURATION=PASS
```

## 9. Public release containment (before)

```
ACTIVE_PUBLIC_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
ACTIVE_PUBLIC_TRAFFIC=100%
CANDIDATE=d3472f58-f578-4a8f-992b-0d0956c9b561 @ 0% (unchanged, SUN-1222C-R6)
D5_PUBLIC_API_DEPLOYMENTS=0
D5_TRAFFIC_MUTATIONS=0
```

## 10–12. Host deployment

Exactly one deployment executed:

```
npx wrangler deploy --config wrangler.paid-continuation-runtime.toml \
  --message "SUN-1222C-R4-D5-OBSERVABILITY-DEPLOYMENT: host redeploy carrying durable
             verification-rejection detail persistence (evidence_ref passthrough), source aaf51ad"
```

```
D5_HOST_DEPLOYMENT_FROZEN=YES
HOST_DEPLOYMENTS=1
D5_HOST_VERSION_ID=05e11cbd-1fd2-415a-bfb6-2c29b571b75d
```

Postdeploy readback: new version active at 100%, 11 secrets unchanged (recount matched), 4 ADR
vars unchanged, Workflow `siteborne-paid-continuation` registered, public API untouched.

```
D5_HOST_DEPLOY_READBACK=PASS
```

## 13. Safe qualification design check — no safe path exists

Enumerated every `transitionJobState()` call site in the deployed source (7 total). Only two carry
`evidenceRef` (the D5 target): the `executor_rejected` branch and the `executor_timeout` branch —
both require `executorOutcome` to already exist, i.e. `invoke-executor-1` must have already run
(and either returned a non-success result or thrown).

`PaidContinuationWorkflow` instances are created exclusively by `x402-service.ts`'s
`sendContinuation()` (`continuation/handoff.ts:40`), reached only after payment verification
succeeds. **No code path or trigger mechanism creates a `company_evidence_graph.v2` Workflow
instance without a preceding real, verified payment.** The Workflow is payment-gated by
architecture, not incidentally.

Therefore no live instance against the real deployed host can reach the target `evidenceRef` code
path while holding zero executor/settlement/chain-write capability — reaching it structurally
requires either a real payment (prohibited by this checkpoint) or a real executor invocation
(independently prohibited by §13's own criteria).

```
D5_SAFE_QUALIFICATION_PATH=NONE_EXISTS_FOR_LIVE_INSTANCE
D5_SAFE_PATH_EXECUTOR_CAPABILITY=N/A
D5_SAFE_PATH_SETTLEMENT_CAPABILITY=N/A
D5_SAFE_PATH_CHAIN_WRITE_CAPABILITY=N/A
```

Per the authorizing checkpoint's own explicit fallback — "If not [all three 0]: STOP after deploy
readback. Do not create the instance." — §§14–18 (live instance creation, D1 readback, exact
correlation proof) were **not executed**. The fix's correctness for the target code path is
instead qualified by the pre-existing, already mutation-proven in-process unit suite (§5 above:
41/41), which exercises the identical `deriveErrorDetail → transitionJobState → createStateEvent →
D1 evidence_ref` path against a controlled fake executor — architecturally the only way to test
this logic without a real payment.

```
D5_SAFE_WORKFLOW_INSTANCES=0
```

## 19. Zero economic effect

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
EXECUTOR_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
```

## 20–21. Regression telemetry & public containment (after)

No unexpected runtime regressions observed in the deployment output (clean bindings table, no
errors). Public production reconfirmed unchanged: `db7054c9` @ 100%, `d3472f58` @ 0%.

```
D5_UNEXPECTED_RUNTIME_REGRESSIONS=0
D5_PUBLIC_PRODUCTION_UNCHANGED=YES
D5_PUBLIC_API_DEPLOYMENTS=0
D5_TRAFFIC_MUTATIONS=0
```

## Additional finding (out of scope, flagged for a future checkpoint)

`paid-continuation-workflow.ts:838` — the PCC-validation rejection path
(`transitionJobState(jobId, 'REJECTED', 'VERIFICATION_FAILED', deps.persistence.job)`, terminal
`pcc_failed`) still has **no** `evidenceRef` passed. `pccResult.reason` reaches the terminal
HTTP-facing result but not the durable state-event trail. This is a distinct, narrower gap from
the one D4/D5 closed (which covers only `executor_rejected` / `executor_timeout`) and was not part
of this checkpoint's authorized scope.

## 22–24. Final gate

```
SUN1222C_R4_D5_OBSERVABILITY_DEPLOYMENT=PASS (deployment + regression scope)
```

Held to PASS on: correct source lineage, acceptable full regression (isolated re-run confirms no
new flakes), no migration required, exactly one host deployment, postdeploy readback PASS, public
production untouched, zero economic effect throughout. Live-instance qualification was correctly
not attempted once §13 proved no safe path exists — this is a pass on the checkpoint's own terms,
not a shortfall silently accepted.

```
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-R4-D6
```
