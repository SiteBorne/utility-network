# SUN-1222C-R4-D15 — Natural Cron Operational Verification

**Result: `PASS_WITH_TELEMETRY_LIMITATION`**
**Observability class: `C`** (Worker correctly configured; no historical or live telemetry
source available in this execution environment produced affirmative evidence of a natural
scheduled invocation; absence of evidence is not evidence of failure.)

## Purpose

D14 activated the `siteborne-settlement-alert` Worker's `*/15 * * * *` Cron Trigger in
production. D14-R reconciled the activation *sequence* against the originally authorized
order and found the deviation procedurally harmless. D15 exists to independently observe
whether the Cron Trigger **actually fires on its own**, in production, without any
manually created invocation — using only read-only inspection.

## Starting state

```
D15_START_HEAD=a834614
D14R_EVIDENCE_COMMIT_REACHABLE=YES
WORKING_TREE_RELEASE_CLEAN=YES
```

## Live production readback (no drift)

```
D15_ALERT_WORKER_VERSION=8fe32c69-d906-4369-9c0a-49b2cc406e8e
D15_ALERT_WORKER_DRIFT=NONE
D15_HOST_DRIFT=NONE                 (siteborne-paid-continuation-runtime: d62011b9 @ 100%)
D15_PUBLIC_API_DRIFT=NONE           (db7054c9 @ 100%, d3472f58 @ 0%)
D15_TRAFFIC_DRIFT=NONE
```

Cron schedule confirmed via live Cloudflare API: exactly one trigger, `*/15 * * * *`,
matching the audited D12 configuration exactly. Zero public routes, `workers_dev` disabled,
`DB` binding present, `SETTLEMENT_ALERT_WEBHOOK_URL` secret present by name only (value
never inspected, logged, or exposed).

## Telemetry attempted

1. **Cloudflare GraphQL Analytics** (`workersInvocationsAdaptive`) queried for the alert
   Worker across the window spanning a natural `*/15` boundary. **Zero rows returned.**
2. **Live `wrangler tail`** session run in the background, spanning the 02:30:00 UTC
   schedule boundary with margin on both sides (~5 minutes total observation, including an
   explicit wait past typical tail delivery lag). **Zero events captured.**
3. **Direct read-only D1 query** equivalent to `listUnresolvedSettlements()`: production
   currently holds **zero unresolved settlement records**. Per the Worker's own logic, a
   normal sweep against an empty backlog correctly produces zero webhook calls — so even a
   successful natural invocation would not necessarily be visible via webhook-side evidence.

No mechanism in this execution environment (no Cloudflare dashboard access, no
account-level Cron execution history API located) provided a definitive historical log of
past Cron Trigger firings independent of live tail capture.

## Findings

```
D15_NATURAL_CRON_INVOCATIONS_FOUND=0
D15_FIRST_OBSERVED_CRON_AT=N/A
D15_LAST_OBSERVED_CRON_AT=N/A
D15_CRON_TIMESTAMP_ALIGNMENT=N/A

D15_NATURAL_CRON_OUTCOME=UNKNOWN
D15_NATURAL_CRON_EXCEPTION_COUNT=UNKNOWN

D15_CURRENT_UNRESOLVED_SETTLEMENTS=0

D15_NATURAL_WEBHOOK_ATTEMPTS=0
D15_NATURAL_WEBHOOK_SUCCESSES=0
D15_NATURAL_WEBHOOK_FAILURES=0

D15_SECRET_EXPOSURE_IN_LOGS=NO
D15_SENSITIVE_PAYLOAD_EXPOSURE=NO
D15_SECRET_GATE_BEFORE_SWEEP=YES   (scheduled() checks SETTLEMENT_ALERT_WEBHOOK_URL
                                    before any D1 read or webhook call; confirmed by
                                    direct source read and by existing test S7)
```

**This absence of captured telemetry is not evidence that the Cron Trigger failed.** It
reflects the limits of the observability tooling reachable from this session (no dashboard
UI access, no located historical-execution API, and a live tail window that may simply not
have overlapped an actual delivery). The Worker's static configuration, fail-closed secret
gate, and D1 read-only codepath were all independently re-verified and are correct.

## Economic isolation (re-proven)

```
D15_ALERT_WORKER_SETTLE_CALLSITES=0
D15_ALERT_WORKER_VERIFY_CALLSITES=0
D15_ALERT_WORKER_EXECUTOR_CALLSITES=0
D15_ALERT_WORKER_REFUND_CALLSITES=0
D15_ALERT_WORKER_CHAIN_WRITE_CALLSITES=0

D15_PUBLIC_API_SETTLE_CALLSITES=0
D15_DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
D15_TOTAL_PRODUCTION_SETTLE_CALLSITES=1

D15_ALERT_WORKER_D1_CODEPATH=READ_ONLY
D15_D1_TECHNICAL_CAPABILITY=READ_WRITE   (shared binding; application codepath never
                                          writes — enforced by source construction, not
                                          by database permission)
```

## What was deliberately NOT done

No manual Cron trigger, synthetic scheduled execution, synthetic production D1 record, or
additional webhook smoke test was used to manufacture stronger proof of a natural
invocation. Per the D15 checkpoint's own instruction, forcing evidence this way was
explicitly out of scope — an honest `PASS_WITH_TELEMETRY_LIMITATION` was preferred over a
manufactured, non-natural confirmation.

```
D15_MANUAL_PRODUCTION_CRON_TRIGGERS=0
D15_SYNTHETIC_WEBHOOK_CALLS=0
PRODUCTION_D1_WRITES=0
```

## Component drift re-confirmation

```
D15_ALERT_WORKER_UNCHANGED=YES
D15_PAID_CONTINUATION_UNCHANGED=YES
D15_PUBLIC_API_UNCHANGED=YES
D15_PUBLIC_TRAFFIC_UNCHANGED=YES
```

## Economic counters

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
EXECUTOR_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENT_ATTEMPTS=0
REFUND_ATTEMPTS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
```

## Mutation counters

```
PRODUCTION_MUTATIONS=0
DEPLOYMENTS=0
SECRET_MUTATIONS=0
CRON_MUTATIONS=0
D15_FUNCTIONAL_SOURCE_MUTATIONS=0
```

## Disposition

`SUN1222C_R4_D15_NATURAL_CRON_OPERATIONAL_VERIFICATION=PASS_WITH_TELEMETRY_LIMITATION`

If future ordinary operational observability (e.g. dashboard access, an accumulated
non-empty unresolved-settlement backlog producing a visible webhook delivery, or expanded
telemetry tooling) later provides affirmative evidence of natural Cron execution, that
evidence may be appended as ordinary operational record-keeping. No further checkpoint is
required solely to force proof of a natural invocation, and no production mutation is
authorized or required by this result.

No further checkpoint (D16) is auto-triggered by this closure.
