# SUN-1222C PCC Coordinated Cutover — Operator Plan

> ## ⛔ PERCENTAGE CANARY IS RETIRED
>
> The former executable 5% → 25% → 50% → 100% sequence is superseded and must
> not be run. Baseline `db7054c9` and feature-scoped candidate `b6b7477f` expose
> different MCP and price contracts. SITEBORNE has no universal stable
> pre-routing client identity, so IP/cookie/header affinity cannot eliminate the
> proven cross-version skew for ordinary machine agents.
>
> The selected atomic public cutover completed and passed stabilization on
> 2026-09-11: `db7054c9@100% + b6b7477f@0%` became
> `b6b7477f@100% + db7054c9@0%`. The baseline remains the exact pre-paid-runtime
> restoration target. This document remains a plan for every subsequent stage,
> not authorization to quiesce, drain, or deploy the paid runtime.
>
> **NOT AUTHORIZED FOR AUTOMATIC EXECUTION.** Only steps explicitly recorded as
> completed may be treated as completed; every remaining upload, deployment,
> traffic, qualification, drain, and paid-runtime action requires its named
> human authorization checkpoint.
>
> Evidence: `docs/reports/SUN-1222C-pcc-canary-version-skew-remediation.md`.

## Frozen identities and boundaries

```text
PUBLIC_BASELINE=db7054c9-76ee-4830-aabe-8a4542261b6a
FEATURE_SCOPED_CANDIDATE=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
OLD_PAID_RUNTIME=d62011b9-6219-47e1-8cf9-5006776cfb50
CANDIDATE_ENABLED=verify_agent_output.v2,web_context_verified.v2
CANDIDATE_DISABLED=company_evidence_graph.v2,document_evidence_json.v2,document-artifact-upload
PERCENTAGE_CANARY_RETIRED=YES
```

The quiescence prebuild and atomic public cutover authorities are complete.
Independent authority remains mandatory for:

1. quiescence 0% membership and exact-version qualification;
2. quiescence promotion and drain; and
3. paid-runtime cutover after the authoritative drain reaches zero.

Approval of one does not authorize another. Do not create a Transform Rule,
change routes/DNS, upload a public version, move traffic, deploy the paid
runtime, submit payment, call a provider, create a Workflow, settle, or activate
mTLS without the checkpoint that names that mutation.

After the paid runtime becomes new, public-only rollback is forbidden. Restore
the paid runtime to `d62011b9` first, prove new public + old paid healthy, and
only then restore public baseline traffic if still required.

## Preflight — read only

```bash
set -euo pipefail
cd "/Users/meta4ickal/SITEBORNE Utility Network"
git rev-parse HEAD
git status --short
npx wrangler --version
npx wrangler deployments status --name siteborne-utility-edge
npx wrangler deployments status \
  --name siteborne-paid-continuation-runtime \
  --config wrangler.paid-continuation-runtime.toml
```

Expected after the completed atomic cutover: clean `main`; Wrangler `4.119.0`;
public composition exactly `b6b7477f...@100% + db7054c9...@0%`; paid runtime
exactly `d62011b9...@100%`. Stop on any drift.

## Stage A — prebuild quiescence derivative unassigned

**Required checkpoint:** `SUN-1222C-PCC-QUIESCENCE-CANDIDATE-PREBUILD`

Create exactly one immutable public-Worker version from the same runtime source
and bindings as `b6b7477f`, with exactly one ordinary-variable delta:

```text
PAID_ROUTES_ENABLED=true -> false
```

All other variables, secret names, bindings, source, routes, and domains must
match. This stage completed on 2026-09-11: immutable version
`d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1` (version 63, tag
`sun1222c-pcc-feature-scoped-quiescence-candidate`) was uploaded exactly once
and remains unassigned. Its script etag, bindings, secret names, and
compatibility settings match b6; its only ordinary-variable delta is the one
shown above. Local/config qualification passed, but exact runtime qualification
is deliberately deferred until deployment membership. Evidence:
`docs/reports/SUN-1222C-pcc-quiescence-candidate-prebuild.md`.

## Stage B — final exact-version candidate qualification

**Read-only after separate qualification authority.** Keep normal topology at
100%/0%. Use a documented version override and authoritative `cf-ray`/tail
correlation to `b6b7477f` for:

- `/health` and `/ready`;
- Agent Card, JWKS, and JWS verification;
- MCP modern and legacy initialize/list plus bounded unpaid payment boundary;
- A2A discovery and closed SendMessage liveness;
- verify/web enabled at exactly 17000/8000 atomic; and
- company/document/artifact surfaces disabled before state.

Do not submit payment, call a useful provider, create a Workflow, or settle.

## Stage C — baseline metrics and lifecycle snapshot

Before traffic authority is exercised, capture:

- current public and paid-runtime deployments;
- active JSON tail with script-version attribution;
- baseline health/ready/MCP/A2A/HTTP outcome rates;
- PaymentRequired, quote, audit, payment-attempt, Workflow, provider, and
  settlement-alert state; and
- this read-only lifecycle query:

```bash
npx wrangler d1 execute siteborne-utility --remote --command \
  "SELECT lifecycle_stage, COUNT(*) AS n FROM payment_attempts WHERE lifecycle_stage IN ('acquired','verified','executed','settlement_pending','settled_external','link_verified','settlement_failed') GROUP BY lifecycle_stage ORDER BY lifecycle_stage;"
```

Existing in-flight rows do not block the public-only transition while the old
paid runtime remains, but they continue to block paid-runtime deployment.

## Stage D — atomic public cutover

**Required checkpoint:** `SUN-1222C-PCC-ATOMIC-PUBLIC-CUTOVER-AUTHORIZATION`

**Completed and stabilized on 2026-09-11.** Both commands were dry-run proven.
The following cutover command was executed exactly once:

```bash
npx wrangler versions deploy \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@100% \
  db7054c9-76ee-4830-aabe-8a4542261b6a@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C atomic public cutover: qualified feature-scoped b6b7477f 100%; retain baseline db7054c9 0% for immediate pre-paid-runtime restore; percentage canary retired" \
  --yes
```

The exact emergency restoration command is:

```bash
npx wrangler versions deploy \
  db7054c9-76ee-4830-aabe-8a4542261b6a@100% \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C atomic public restore: db7054c9 100%; b6b7477f 0%" \
  --yes
```

Deployment `037ae834-3b1e-4eae-b5c0-7befa09856c1` was created at
`2026-09-11T11:58:11.996898Z`. Immediate and final readback were exactly
`b6b7477f@100% + db7054c9@0%`. The restoration command was not executed. Do not
use generic rollback if it would collapse the explicit two-version composition.

## Stage E — immediate normal-routing smoke

Against normal `https://utility.siteborne.net` routing, require 100% tail
attribution to `b6b7477f` and:

```text
HEALTH=PASS
READY=PASS
AGENT_CARD=PASS
JWKS=PASS
JWS=PASS
MCP_MODERN=PASS
MCP_LEGACY=PASS
A2A=PASS
VERIFY_PRICE_ATOMIC=17000
WEB_PRICE_ATOMIC=8000
COMPANY_DISABLED=YES
DOCUMENT_DISABLED=YES
ARTIFACT_DISABLED=YES
```

Only bounded, zero-economic probes are allowed unless another checkpoint says
otherwise. Any wrong version, protocol, price, feature, or safety result invokes
the Stage D emergency restoration immediately.

**Completed on 2026-09-11.** Normal-routing health, truthful readiness, Agent
Card, JWKS/JWS, MCP initialize/list, A2A, price, mTLS, and disabled-feature
checks all passed and were attributed to `b6b7477f`. Evidence:
`docs/reports/SUN-1222C-pcc-atomic-public-cutover.md`.

## Stage F — governed public stabilization

Both floors are mandatory:

```text
MIN_DURATION=60 minutes
MIN_CANDIDATE_ATTRIBUTABLE_NORMAL_REQUESTS=1000
```

Zero failures in 1,000 idealized independent requests corresponds to an
approximate 95% upper bound of 0.3% for an unseen failure rate. Traffic is not
perfectly independent, so this is a minimum, not a guarantee. Sixty minutes adds
a time-based window for asynchronous Workflow/alert behavior. Continue until
both floors pass; do not waive the request floor because the clock expired.

Require throughout:

- candidate normal attribution 100%, baseline normal attribution 0%;
- health/ready/Agent Card/JWKS/JWS/MCP/A2A pass;
- verify and web remain enabled with exact final prices;
- company, document, and artifact remain disabled;
- no unexpected 5xx increase or semantic MCP/A2A error;
- no price inconsistency, payment-ownership anomaly, provider/Workflow anomaly,
  or settlement-alert anomaly; and
- paid runtime remains `d62011b9@100%`.

Any hard failure restores Stage D's exact baseline composition immediately;
there is no minimum wait before rollback.

**Completed on 2026-09-11.** The observed interval was 60 minutes 18.075
seconds. It included 1,317 successful normal public client requests and 1,075
conservatively Tail-delivered b6-attributed requests, with zero baseline
attribution, 5xx, or runtime exceptions in the governed interval. D1 aggregates
and lifecycle state were unchanged; no organic or checkpoint-generated payment,
provider, Workflow, or settlement activity occurred. Evidence:
`docs/reports/SUN-1222C-pcc-atomic-public-cutover.md`.

## Stage G — introduce and qualify quiescence derivative

Only after Stage F passes, use a separately authorized deployment to replace the
0% baseline member with `d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@0%` while keeping
`b6b7477f@100%`. Exact-version qualify the quiescence derivative. This changes
deployment membership but not normal traffic and requires its own command proof.

The prebuilt command shape, dry-run successfully under Wrangler 4.119.0 but not
executed during prebuild, is:

```bash
npx wrangler versions deploy \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@100% \
  d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C quiescence qualification membership: b6b7477f 100%; d28f30c5 0%; replace only old baseline rollback member; no quiescence traffic" \
  --yes
```

**Stage G completed on 2026-09-11.** The command was freshly dry-run and then
executed exactly once, creating deployment
`72a81c44-8957-4f54-a010-3d0837b9c587`. Final readback is
`b6b7477f@100% + d28f30c5@0%`; `db7054c9` remains immutable but is no longer a
current deployment member. Exact override health, readiness, Agent Card,
JWKS/JWS, catalog, MCP, A2A, mTLS truthfulness, verify/web admission rejection,
and company/document/artifact rejection all passed with authoritative Tail
attribution to d28. No qualification state or economic write occurred.

The mandatory pre-promotion ownership audit classified all 17 frozen nonterminal
payment attempts as `STALE_ORPHAN_NO_AUTOMATIC_OWNER`. A subsequent forensic
checkpoint corrected that audit's cross-table join: all 17 do have a real job
through `jobs.idempotency_key = payment_attempts.payment_identifier` despite
`payment_attempts.job_id` being null, and all have job-state events. That
correction does not make them naturally drainable: no active Workflow, scheduled
reconciler, or retry owner exists. Fourteen jobs are `REJECTED`, one is stranded
at `EXECUTING`, one at `LOCKED`, and the economically settled row is
`DELIVERED`. None has a truthful current terminal payment-attempt state.
Evidence: `docs/reports/SUN-1222C-pcc-quiescence-qualify-promote-and-drain.md`
followed chronologically by
`docs/reports/SUN-1222C-pcc-lifecycle-backlog-reconciliation.md`.

## Stage H — quiesce paid admission

Under separate authority, atomically deploy the qualified quiescence version at
100%, retaining `b6b7477f@0%` as the exact restoration target. Prove every paid
route is closed while discovery and zero-economic health surfaces remain
correct. Restore `b6b7477f@100%` immediately on unexpected behavior.

Design only; do not run without that separate authority:

```bash
npx wrangler versions deploy \
  d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@100% \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C quiesce public paid admission: d28f30c5 100%; retain b6b7477f 0% for immediate restore" \
  --yes
```

**BLOCKED — DO NOT RUN.** The 2026-09-11
`SUN-1222C-PCC-QUIESCENCE-QUALIFY-PROMOTE-AND-DRAIN` authority expressly
required a naturally drainable backlog before promotion. That gate failed with
17 stale orphans and zero automatic owners. A separate
`SUN-1222C-PCC-LIFECYCLE-BACKLOG-RECONCILIATION` checkpoint then proved the
current terminal model cannot represent any of the 17 without falsification; it
performed no D1 mutation. Stage H remains blocked pending
`SUN-1222C-PCC-LIFECYCLE-MODEL-GAP-REMEDIATION`.

## Stage I — drain

After propagation, repeat the lifecycle query until the separately defined drain
predicate is satisfied. Do not force-deploy around stuck rows. Investigate and
stop if the drain exceeds its governed bound.

The 2026-09-11 forensic readback remains `verified=16`, `settled_external=1`,
total 17. The current model has only `verification_failed` and `settled` as
terminal stages. Neither can represent these records truthfully: successful
verification cannot become `verification_failed`, and the settled-external row
lacks durable governed link-verification evidence. Closing admission cannot
drain them. Do not begin a drain clock, claim a bounded natural horizon, or
promote d28 until Model C (the selected append-only reconciliation
classification plus ownership-aware drain gate) and recurrence fixes are
separately authorized, implemented, deployed, and used to reconcile the exact
records. Preserve all original attempt IDs, timestamps, verified history,
payment-identifier ownership, quotes, requirements, and settlement evidence.

The recurrence fix must also close the current non-atomic
`verified`-to-Workflow-create window and add durable CDP link-finalization from
`settled_external` through `link_verified` to `settled`. A historical data-only
cleanup is insufficient. After any future quiescence reaches 100%, wait the
deployment-tail safety interval and require the revised, governed active-work
gate to be zero before paid-runtime deployment.

## Stage J — paid-runtime cutover

Only after quiescence and drain, deploy the new paid runtime under its own
checkpoint and record the new immutable version. On failure, roll the paid
runtime back to `d62011b9` first. Keep paid admission closed until worker-to-
worker health, Workflow/PCC structure, provider boundaries, and settlement
ownership are proven.

## Stage K — restore admission and final confirmation

Only after the new paid runtime qualifies, restore `b6b7477f@100%`. Re-run the
candidate smoke set and settlement invariant:

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

Stop after final readback. Do not provision mTLS or create a real payment merely
to test the release.

```text
QUIESCENCE_PREBUILD_EXECUTED=YES
QUIESCENCE_VERSION_ID=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
QUIESCENCE_VERSION_NUMBER=63
QUIESCENCE_VERSION_DEPLOYED=YES_AT_0_PERCENT_ONLY
QUIESCENCE_EXACT_RUNTIME_QUALIFICATION=PASS
QUIESCENCE_STILL_REQUIRED_BEFORE_PAID_RUNTIME_DEPLOY=YES
ATOMIC_PUBLIC_CUTOVER_EXECUTED=YES
ATOMIC_PUBLIC_CUTOVER_DEPLOYMENT_ID=037ae834-3b1e-4eae-b5c0-7befa09856c1
ATOMIC_PUBLIC_STABILIZATION=PASS
PUBLIC_NORMAL_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
PUBLIC_NORMAL_TRAFFIC=100%
PUBLIC_ROLLBACK_VERSION=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
PUBLIC_ROLLBACK_TRAFFIC=0%
NEXT_TRAFFIC_STAGE_AUTHORIZED=NO
PREEXISTING_BACKLOG_NATURALLY_DRAINABLE=NO
STALE_ORPHAN_COUNT=17
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-LIFECYCLE-MODEL-GAP-REMEDIATION
```

## Model-C lifecycle remediation — implemented locally, not deployed

The source/schema/recovery checkpoint implemented additive migration `0010`,
append-only `payment_attempt_reconciliations`, durable
`payment_workflow_owner_intents`, durable `payment_service_link_evidence`, the
scheduled deterministic owner-intent scanner, provider-failure reconciliation,
and idempotent `settled_external → link_verified → settled` finalization.
Evidence: `docs/reports/SUN-1222C-pcc-lifecycle-model-gap-remediation.md`.

This runbook remains **NOT AUTHORIZED FOR AUTOMATIC EXECUTION**. Migration 0010
has not been applied to production; no legacy classification has been inserted;
and the new public/paid source and recovery cron have not been deployed.

The old runtimes are compatible with migration 0010. The new runtimes fail
closed without it. Under a future explicit production checkpoint, the order is:

1. `npx wrangler d1 migrations apply siteborne-utility --remote`;
2. prove old public/paid runtime health and topology unchanged;
3. run the 17-row tool with `--dry-run --remote`, review all preimages, then
   separately authorize the same command with `--apply --remote`;
4. require `RAW_NONTERMINAL_LIFECYCLE_COUNT=17` and
   `ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0` for the explicit governed legacy set;
5. upload/qualify and deploy the remediated public normal/quiescence lineage,
   including the public owner-recovery cron;
6. close paid admission; and
7. require the ownership-aware gate below before paid-runtime deployment.

```text
PUBLIC_PAID_ADMISSION_CLOSED=YES
OWNER_INTENT_PENDING_COUNT=0
ACTIVE_WORKFLOW_OWNED_ATTEMPTS=0
UNRECONCILED_ACTIONABLE_ATTEMPTS=0
UNRESOLVED_SETTLEMENT_FINALIZATION_COUNT=0
ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0
```

Never substitute `RAW_NONTERMINAL_LIFECYCLE_COUNT=0`: the reviewed 17 retain
their truthful historical stages. Unknown, unclassified, ownerless-new, pending,
retry-exhausted, active-owned, and current settlement-finalization records all
block. Age is never an exception.

## Production migration/classification preflight — blocked before mutation

The 2026-09-11 production checkpoint reached an exact read-only preimage match
for all 17 governed attempts and confirmed Wrangler 4.119.0 would apply only
migration 0010. It then stopped before applying the migration because the
controlled legacy-reconciliation operator did not meet its required production
contract:

- all 17 generated forensic-report fragments referenced missing
  `#attempt-<UUID>` anchors;
- the tool did not compare the displayed preimage with expected lifecycle,
  service, payment-identifier, job, and settlement-presence values;
- successful `ON CONFLICT DO NOTHING` or zero-row `INSERT ... SELECT` statements
  could produce fewer than 17 events without failing the command; and
- its repeated dry-run could not distinguish 0 rows to insert from 17 rows
  already reconciled.

Cloudflare documents the `/query` multi-statement batch as transactional; the
blocker is exact-count/preimage/evidence validation, not rollback behavior.
Migration 0010 remains unapplied, the new tables remain absent, the raw
nonterminal count remains 17, and production runtimes/topology are unchanged.
Evidence:
`docs/reports/SUN-1222C-pcc-lifecycle-model-production-migration-and-legacy-classification.md`.

This runbook remains **NOT AUTHORIZED FOR AUTOMATIC EXECUTION**. Do not apply
migration 0010 or run the classification apply command until
`SUN-1222C-PCC-MODEL-C-LEGACY-BACKFILL-REMEDIATION` produces a fail-closed,
exact-count, evidence-resolvable operator and a new production checkpoint is
authorized.

## Model-C legacy-backfill operator remediation — completed locally

The required operator remediation completed in two commit-addressed layers:

```text
EVIDENCE_COMMIT_SHA=21afdd282c5ed2d1e94f35c607c8350f2dbe5dca
OPERATOR_REMEDIATION_COMMIT_SHA=9b39a826fe4271303b0abc3be08daea0b0a293c8
```

All 17 plan rows now use unique, commit-pinned machine-readable evidence IDs;
carry complete attempt/job/settlement preimages; and are processed by an
exactly-three-state operator (`FRESH_APPLY`, `EXACT_IDEMPOTENT_NOOP`, or
`CONFLICT`). Apply has no `ON CONFLICT DO NOTHING`, reasserts every precondition
inside one D1 batch, and accepts success only when both D1 change metadata and
the immediate exact postimage equal 17. Partial preexisting state and every
mismatch fail closed. The isolated operator suite passed 38/38, including actual
D1 rollback at early/middle/late rows and truthful second dry-run/apply no-op
behavior.

The production dry-run was read-only and matched all 17 source preimages. It
reported `NO_SCHEMA_MISSING`, as expected because migration 0010 remains
unapplied. It planned zero mutations and performed zero writes. Full evidence:
`docs/reports/SUN-1222C-pcc-model-c-legacy-backfill-remediation.md`.

This runbook remains **NOT AUTHORIZED FOR AUTOMATIC EXECUTION**. The repaired
operator does not revive the expired production mutation authority. A fresh
checkpoint must separately authorize migration 0010 and the exact 17-row apply.

## MCP TDQS pre-upload gate — metadata implemented, score blocked

Before any new public Model-C Worker version upload, use MCP metadata source
authority:

```text
MCP_METADATA_SOURCE_AUTHORITY=896d75a343d5a4ac2690cf60e1259828482a8a63
```

The six tool names are unchanged. Actual generated definitions now explicitly
disambiguate company, single-URL web, document, and supplied-output verification
work; state production-disabled behavior; describe paid, read-only, and
quote-only boundaries and semantic returns; and document every meaningful input
property. `siteborne_get_quote` does not execute a service, and
`siteborne_get_service_health` does not perform paid evidence work.

TDQS v1.2 deterministic lint and the full MCP regression pass. The official
model-graded score is still blocked because no scorer endpoint credential is
available and the hosted playground requires GitHub sign-in. Do not claim the
requested A / at-least-4.0 release gate and do not upload a new public Worker
until this exact generated definition set passes a credentialed:

```bash
cd packages/protocol-mcp
pnpm run build
node scripts/export-tdqs-tools.mjs /tmp/siteborne-tdqs-v1.2-tools-list.json
npx -y mcp-tdqs@0.1.0 score \
  --file /tmp/siteborne-tdqs-v1.2-tools-list.json \
  --fail-under A
```

See `docs/reports/SUN-1222C-mcp-tool-definition-quality-remediation.md`. This
runbook remains **NOT AUTHORIZED FOR AUTOMATIC EXECUTION**.

## Model-C production migration and legacy classification — completed

Under fresh, explicit production-data authority, migration 0010 applied once and
the repaired controlled operator inserted exactly 17 append-only, non-actionable
legacy reconciliation events. The immediate pre-apply state was `FRESH_APPLY`
with 17 to insert, zero already present, and zero conflicts. D1 change metadata
and exact postimage both proved 17. The required second dry-run returned
`EXACT_IDEMPOTENT_NOOP`, zero to insert, 17 already reconciled, zero conflicts,
and no mutation required.

Raw historical lifecycle state intentionally remains 16 `verified` plus one
`settled_external` (17 total). The exact global Model-C ownership-aware gate is
now zero active cutover-blocking work, with zero pending owner intents, zero
active Workflow-owned attempts, zero unreconciled actionable attempts, and zero
unresolved settlement-finalization attempts. No payment-attempt, job, owner
intent, payment, provider, Workflow, settlement, Worker, deployment, traffic, or
configuration state was changed beyond the two authorized D1 operations.

The public and paid runtimes remain pre-Model-C and can still create new
ownerless legacy-shaped state. No runtime cutover is authorized. Before any new
public Worker upload, the independent TDQS v1.2 hosted score blocker must still
be cleared with a locally provided TDQS account key.

Full evidence:
`docs/reports/SUN-1222C-pcc-model-c-production-migration-and-legacy-classification-reauthorization.md`.
This runbook remains **NOT AUTHORIZED FOR AUTOMATIC EXECUTION** beyond completed
steps.
