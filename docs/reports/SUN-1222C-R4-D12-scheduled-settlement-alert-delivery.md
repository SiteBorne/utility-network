# SUN-1222C-R4-D12 — Scheduled Unresolved-Settlement Sweep + Operator Webhook

## Result

```
SUN1222C_R4_D12_SCHEDULED_SETTLEMENT_ALERT_DELIVERY=PASS_IMPLEMENTATION_READY_PENDING_SECRET
SUN1222C_R4_D12_AUTHORIZATION=GRANTED_IMPLEMENTATION_ONLY
D12_PRODUCTION_DEPLOYMENT_AUTHORIZATION=ABSENT
D12_WEBHOOK_SECRET_PROVISIONING_AUTHORIZATION=ABSENT

FUNCTIONAL_SOURCE_MUTATIONS=4 (new files; zero existing production file touched)
NEW_WORKERS_CREATED=0 (source/config defined only — not deployed)
CRON_TRIGGERS_CREATED=0 (production)
NEW_SECRETS_CREATED=0
DEPLOYMENTS=0
REAL_WEBHOOK_CALLS=0
TEST_DOUBLE_WEBHOOK_CALLS=17 (10 sweep-module tests + 7 transport tests)
```

D11 (Class D) proved SITEBORNE had no deployed operator-delivery mechanism
for `ambiguous_unresolved` settlements. D12 designs and implements — but
does **not** deploy — the smallest viable component that closes that gap:
a fourth, dedicated, economically-powerless Cloudflare Worker that sweeps
the existing `listUnresolvedSettlements()` discovery query on a cron and
POSTs one generic JSON payload per unresolved incident to an
operator-controlled HTTPS webhook.

## §2 Start-state / drift proof

```
D12_START_HEAD=e2a3301
D11_EVIDENCE_COMMIT_REACHABLE=YES
WORKING_TREE_RELEASE_CLEAN=YES
D12_PRE_HOST_VERSION_ID=d62011b9-6219-47e1-8cf9-5006776cfb50 @ 100%
D12_HOST_DRIFT=NONE
D12_PUBLIC_API_DRIFT=NONE (db7054c9 @ 100%, d3472f58 @ 0%)
D12_TRAFFIC_DRIFT=NONE
```

## §4 D11 input contract re-proven

`listUnresolvedSettlements()`
(`apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts:572`)
re-read directly from source:

```
D12_BACKLOG_QUERY_PRESENT=YES
D12_BACKLOG_QUERY_READ_ONLY=YES (`.all()`, no `.run()` anywhere in the method)
D12_BACKLOG_QUERY_RESOLVED_EXCLUSION=PASS
  — filters strictly on `lifecycle_stage = 'settlement_pending'`; any
    resolution transitions the row's own `lifecycle_stage` away from that
    value, so resolved rows are excluded by construction, not by a
    separate exclusion clause.
```

Returns `paymentIdentifier` (stable incident key),
`settlementTransactionReference`, `settlementOutcomeKind`,
`cdpFacilitatorSettleAttemptCount`, `settlementPendingAt`, ordered
`ASC`, bounded by an optional `limit` (default 100) and an optional
`olderThanMs` age filter. The existing query was reused verbatim — no
duplicate SQL was written anywhere in D12 (§4 requirement).

## §5/§22 Trust boundary and static capability audit

```
D12_WORKER_BINDINGS=[DB (D1, read-only codepath)]
D12_SETTLEMENT_CAPABILITY=0
D12_PAYMENT_SIGNING_CAPABILITY=0
D12_EXECUTOR_CAPABILITY=0
D12_CHAIN_WRITE_CAPABILITY=0

D12_ALERT_WORKER_SETTLE_CALLSITES=0
D12_ALERT_WORKER_VERIFY_CALLSITES=0
D12_ALERT_WORKER_EXECUTOR_CALLSITES=0
D12_ALERT_WORKER_CHAIN_WRITE_CALLSITES=0
D12_ALERT_WORKER_REFUND_CALLSITES=0
```

Proof method: `grep -nE
"\.settle\(|\.verify\(|Executor|chainWrite|refund|recordSettlementPending|
recordSettledExternal|\.acquire\(|CdpFacilitator|PaidContinuationWorkflow"`
across all three new source files returned zero code matches (two matches
were inside this file's own doc-comment prose describing what is *not*
called). `settlement-alert-sweep.ts` — the module that actually decides
what gets sent — has **zero runtime imports of any kind**; it depends only
on two locally-defined structural interfaces
(`UnresolvedSettlementSource`, `SettlementAlertTransport`), so it cannot
reach any other repository method even if the concrete object passed in
had one.

One honest caveat: the entrypoint (`settlement-alert-worker-entrypoint.ts`)
constructs a concrete `D1PaymentAttemptRepository` — the same class that
also implements `recordSettlementPending`/`recordSettledExternal`/`acquire`
— rather than a hand-rolled read-only wrapper, per D12 §4's explicit
instruction not to duplicate the repository query. The static proof above
is therefore at the *callsite* level (nothing in this Worker's code ever
invokes those other methods) and is enforced by `runSettlementAlertSweep`'s
own narrow parameter type (`UnresolvedSettlementSource`, which declares
only `listUnresolvedSettlements`) — not by the entrypoint holding a
structurally narrower object at runtime. §25 records the same caveat one
level down, at the D1 binding itself.

```
D12_TOTAL_PRODUCTION_SETTLE_CALLSITES=1 (unchanged — dedicated Workflow host only)
```

## §6 Topology selection

```
D12_SELECTED_TOPOLOGY=A (dedicated scheduled Worker)
D12_TOPOLOGY_REASON=Both existing deployed hosts carry economic
  authority/credentials (`wrangler.toml`: SELLER_WALLET_ADDRESS,
  PAID_CONTINUATION_WORKFLOW binding, JOBS/EVENTS queue producers;
  `wrangler.paid-continuation-runtime.toml`: SELLER_WALLET_ADDRESS,
  PRODUCTION_CDP_CREDENTIALS_APPROVED, the sole settle() callsite) and
  neither currently has a cron trigger — adding one to either would put a
  new, independently-triggered code path inside a script that already
  holds settlement authority, directly contradicting D12 §1's "must not
  compromise economic isolation for operational convenience." A dedicated
  third script has zero such credentials by construction (§5) and, being a
  wholly separate `wrangler deploy` target (same pattern already proven
  safe by the public-API/Workflow-host split — H2BF4), can never be
  redeployed as a side effect of deploying either existing script. Queue
  consumer (D) was not selected: no consumer exists for the two producer
  -only queues today, and introducing one would be new infrastructure
  broader than "one dedicated scheduled Worker."
```

## §7/§8 Webhook contract and secret

Generic `POST <configured URL>` / `Content-Type: application/json`, no
vendor-specific schema
(`apps/edge-api/src/control-plane/alerting/settlement-alert-webhook-transport.ts`).

```
D12_NEW_SECRET_REQUIRED=YES
D12_NEW_SECRET_NAME=SETTLEMENT_ALERT_WEBHOOK_URL
```

Not provisioned. No placeholder or fabricated URL was used anywhere,
including in tests (all 17 test-double calls use
`https://example.invalid/...`-style fixture strings that never leave the
test process).

## §9 Incident identity

```
D12_INCIDENT_KEY=payment_identifier
D12_INCIDENT_KEY_STABLE=YES — sourced directly from the durable D1 row's
  own natural key; identical across repeated sweeps, Worker restarts, and
  deployments by construction (no derived/computed key).
```

## §10 Payload design

```
D12_ALERT_PAYLOAD_FIELDS=[event, payment_identifier, job_id,
  recovery_stage, first_observed_at, last_observed_at,
  reconciliation_attempts, transaction_reference_present]
D12_ALERT_PAYLOAD_SAFE=YES
```

`transaction_reference_present` is a boolean (never the raw reference —
§10's default preference, no operational justification was found for
transmitting the raw value). `recovery_stage` maps
`settlementOutcomeKind` (`'explicit_rejection'` / `'ambiguous'` / `null`
→ `'unknown'`) — never a raw error string, secret, or signed payment
object. Proven by test (`settlement-alert-sweep.test.ts`): the payload
never contains a synthetic transaction hash, a string matching
`/private[_-]?key/i`, or a string matching `/signature/i`.

## §11–§13 Delivery, economic-effect, and dedup semantics

```
D12_DELIVERY_SEMANTICS=AT_LEAST_ONCE_RECOVERABLE_BY_SWEEP
D12_ALERT_DELIVERY_ECONOMIC_EFFECT=NONE
D12_DEDUP_MODEL=BOUNDED_REPEAT
```

The D1 `settlement_pending` row is the only durable source of truth;
`runSettlementAlertSweep` never mutates it (proven by test: economic
state is asserted unchanged in both the webhook-success and
webhook-failure cases). No new alert-state table was added (§13
explicitly forbids inventing one), and `settlementPendingAt` was
deliberately **not** repurposed as a last-alerted timestamp — it records
when the row *entered* the pending state, not when it was last notified,
and reusing it for suppression would misrepresent that field's own
meaning. The honest resulting semantics: every sweep that finds an
incident still unresolved sends exactly one webhook attempt for it: a
new reminder every cron interval for as long as the incident stays
unresolved, and the incident disappears from all future sweeps the
instant its `lifecycle_stage` leaves `settlement_pending` (via
reconciliation or manual operator action) — no separate "resolved"
signal is needed.

## §14 Sweep cadence

```
D12_SWEEP_CADENCE=*/15 * * * * (15 minutes)
D12_SWEEP_CADENCE_REASON=`lifecycle_stage='settlement_pending'` is set
  immediately before the sole settle() call and cleared by
  recordSettledExternal moments later on any clean outcome; D9's
  reconciliation engine is a synchronous, bounded 5-retry read that
  resolves (or gives up) within that same Workflow step invocation, not
  across separate sweeps. A row still pending by the time this Worker
  observes it has already exhausted every automatic recovery path — 15
  minutes gives wide margin above that resolution window (seconds) while
  staying timely for a condition D9/D10 established should be rare.
```

## §15 Pagination / bounded work

```
D12_MAX_RECORDS_PER_SWEEP=100 (listUnresolvedSettlements's own default limit)
D12_BACKLOG_PAGINATION=NOT_REQUIRED — no cursor beyond `limit` exists on
  the query; at current/expected backlog scale (D9/D10: this path is rare)
  100 is not a realistic ceiling. Not widened without test-first proof,
  per §15's own instruction.
```

## §16–§18 Partial failure, attempts, and response handling

```
D12_PARTIAL_FAILURE_POLICY=isolated per-record (a `try`/`catch` around
  each transport call; one failing/throwing destination does not stop or
  hide delivery to the remaining incidents in the same sweep — proven by
  test S8)
D12_WEBHOOK_ATTEMPTS_PER_INCIDENT_PER_SWEEP=1
```

Response classification (`settlement-alert-webhook-transport.ts`): 2xx →
delivered; everything else (non-2xx status, redirect, timeout, thrown
network error) → not delivered, backlog row untouched, next sweep
retries. `redirect: 'manual'` is passed explicitly — `fetch`'s own
default (`'follow'`) would silently retarget the configured destination
to whatever host a 3xx `Location` header names, which would defeat the
secret-URL-as-destination model; a 3xx response is therefore classified
as a delivery failure rather than followed (§18: "otherwise failure").
One 8-second bounded timeout per attempt (`AbortController`, matching the
existing `NeverminedHttpError` pattern in
`control-plane/evidence/nevermined-http-client.ts`).

## §19 Webhook URL policy

```
D12_WEBHOOK_URL_POLICY=HTTPS required (non-`https://` values rejected as
  `not_delivered` before any network call is attempted, proven by test);
  no additional destination allow-listing. The Cloudflare Workers
  environment does not expose the deploying operator's internal network
  to outbound `fetch` in a way this repo's existing HTTP-client code
  (Nevermined, safe-egress) treats as requiring SSRF-specific pinning for
  an *operator-supplied* (not attacker-supplied) destination — this
  matches §19's own "do not overengineer" guidance.
```

## §20–§21 Test-first proof

Two new suites, 17 tests total:

- `apps/edge-api/tests/settlement-alert-sweep.test.ts` (10 tests) — S1
  delivery, S2 resolved-record exclusion is implicit in the source query
  so is instead proven at the boundary (only rows the fake source returns
  are ever considered), S3 webhook failure leaves economic state
  unchanged and record remains discoverable, S4 repeated-sweep
  bounded-repeat semantics, S5 multiple records / bounded processing /
  correct per-notification correlation, S6 payload sanitization
  (transaction reference never raw, no secret-shaped string), S8 isolated
  partial-failure handling, plus a `recovery_stage` mapping test.
- `apps/edge-api/tests/settlement-alert-webhook-transport.test.ts` (7
  tests) — successful POST body/headers, non-2xx → not delivered, network
  error → not delivered, timeout → not delivered, non-HTTPS URL rejected
  without a network call, 3xx not followed.

S7 (no secret configured → fails safely, no crash loop, no disclosure) is
proven directly in the entrypoint's own logic
(`logMisconfiguredNoSecret()` early-return path) rather than as a vitest
case, since it requires the Worker's `Env` shape rather than the sweep
module's own dependency-injected shape; verified by direct code read —
the function only ever emits the fixed string `SETTLEMENT_ALERT_WEBHOOK_URL
is not set`, never `env.SETTLEMENT_ALERT_WEBHOOK_URL`'s value.

```
D12_GENUINE_RED=PASS — both suites' core assertions (delivery,
  status-code classification) were mutated to a hardcoded stub
  (`{delivered: true}` unconditionally) and re-run: 7/10 sweep tests and
  3/7 transport tests failed, each with a real assertion diff, not a
  crash.
D12_GREEN=PASS — 17/17 after restoring the source exactly.
D12_MUTATION_PROOF=PASS
```

## §24–§26 New Worker configuration

`wrangler.settlement-alert-worker.toml` (new file, not deployed):

```
D12_PUBLIC_HTTP_ROUTE=ABSENT (workers_dev = false, no [[routes]], no custom domain)
D12_CRON_TRIGGER=*/15 * * * * (defined in config only — not activated in production)
D12_BINDINGS=[DB (D1)]
D12_PUBLIC_FETCH_HANDLER=ABSENT in spirit — a permanent 404 exists only to
  satisfy the platform's module-worker build requirement (same pattern
  `workflow-host-entrypoint.ts` already established for the same reason),
  and is unreachable given the above.
```

## §25 D1 access

```
D12_D1_TECHNICAL_CAPABILITY=READ_WRITE (Cloudflare does not offer a
  read-only D1 binding grant at the Worker level — documented rather than
  understated)
D12_D1_CODEPATH_CAPABILITY=READ_ONLY (proven by the §22 static audit: the
  only D1 call anywhere in this Worker's import graph is
  `listUnresolvedSettlements()`'s single `.all()`)
```

## §27–§28 Qualification and secret-provisioning gate

```
REAL_WEBHOOK_CALLS=0
TEST_DOUBLE_WEBHOOK_CALLS=17
D12_WEBHOOK_SECRET_PROVISIONED=NO
D12_PRODUCTION_ACTIVATION=BLOCKED_PENDING_SECRET
```

No placeholder/fabricated webhook URL was used or invented anywhere.
Chose §28 option A (build/test only, no deploy until secret exists) —
the safer of the two offered options, and the one your authorization's
own required-outcome language specifies by default.

## §29 Predeployment gates

```
TYPECHECK=PASS (full monorepo: pnpm typecheck, 23/23 tasks)
BUILD=PASS (full monorepo: pnpm build, 12/12 tasks)
LINT=PASS (0 errors, 0 warnings after fixing one console.log→console.warn
  to match repo convention — only warn/error permitted)
FULL_TEST_SUITE=2999/3080 passed, 78 intentionally skipped, 3 failed
  — see below
PROTOCOL_X402_CHECK=PASS
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
SECRETS_SCAN=2 pre-existing findings (commit 3cbee0e4547107b6, both
  reconfirmed with identical fingerprints to D10's own report; zero in
  any D12 file — confirmed separately via the working-tree-only scanner)
PRODUCTION_PREFLIGHT=PASS (public API `wrangler.toml`, unaffected by D12)
WRANGLER_DRY_RUN=PASS for all three configs — the new
  `wrangler.settlement-alert-worker.toml` (single `env.DB` binding, no
  other bindings), and both pre-existing configs (public API,
  paid-continuation-runtime), confirmed unaffected by the new file's
  presence

D12_SECRETS_SCAN_NEW=0
```

3 full-suite failures, all confirmed unrelated to D12:

1. `apps/edge-api/src/workflow-host-entrypoint.test.ts` —
   `TypeError: persistence.getJob is not a function` inside
   `paid-continuation-workflow.ts`. Reproduced identically at clean D11
   HEAD (`e2a3301`) with **both** tracked and untracked changes fully
   stashed (`git stash -u`) — pre-existing, unrelated to D12, and out of
   D12's authorized scope to fix (D12 must not touch
   `paid-continuation-workflow.ts`). Flagged for a future checkpoint.
2. `production-cdp-full-stack-mock.test.ts` §22 — timed out under full
   -suite parallel load; 2/2 pass in isolation (2.5s). Matches the
   established D7–D10 resource-contention pattern.
3. `worker-bridge.subprocess.test.ts` (OCR checkpoint-2I) — timed out
   under full-suite parallel load; 3/3 pass in isolation (17.9s). Same
   pattern.

## §33 Zero economic effect

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
EXECUTOR_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENT_ATTEMPTS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
REAL_WEBHOOK_CALLS=0
TEST_DOUBLE_WEBHOOK_CALLS=17
```

## §34 File scope

```
D12_SCOPE_AUDIT=PASS
D12_UNRELATED_CHANGES=0
```

New files only:

- `apps/edge-api/src/control-plane/alerting/settlement-alert-sweep.ts`
- `apps/edge-api/src/control-plane/alerting/settlement-alert-webhook-transport.ts`
- `apps/edge-api/src/settlement-alert-worker-entrypoint.ts`
- `apps/edge-api/tests/settlement-alert-sweep.test.ts`
- `apps/edge-api/tests/settlement-alert-webhook-transport.test.ts`
- `wrangler.settlement-alert-worker.toml`
- this report

Zero lines changed in `paid-continuation-workflow.ts`, any public API
route, any state-machine file, or any migration.

## Deployment boundary

```
D12_ALERT_WORKER_DEPLOY_READBACK=N/A (not deployed)
```

Per your authorization's own required-outcome language: no webhook URL
was supplied or separately authorized for provisioning, so D12 closes as
implementation-ready rather than deployed. Activating this component
(provisioning `SETTLEMENT_ALERT_WEBHOOK_URL`, running `wrangler deploy
--config wrangler.settlement-alert-worker.toml`, and a bounded synthetic
-alert smoke test with no real payment data) is future work requiring its
own separate, standalone authorization.

## Next checkpoint

D13 not auto-triggered, per instruction. Candidate future scope: (a)
webhook-secret provisioning + activation of the alert Worker built here,
(b) the pre-existing, unrelated `workflow-host-entrypoint.test.ts`
regression noted above.
