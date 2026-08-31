# SUN-1221E6R-H2AWI-4P — Explicit Cloudflare Workflow Resource Provisioning

## Why this checkpoint exists

H2AWI-4R created Worker qualification candidate `6895532e-9106-4a39-a300-c4c35a1ea529`
at 0% traffic (known-good `de70bf98-f304-4d7f-b189-4ae2401041a0` at 100%) and
provisioned one dedicated `PAYMENT_CONTINUATION_ENCRYPTION_KEY` secret. The
candidate's binding table correctly recognized `env.PAID_CONTINUATION_WORKFLOW
(PaidContinuationWorkflow) → Workflow`, but `wrangler workflows describe
siteborne-paid-continuation` returned `workflow.not_found` (code 10200). No
corrective mutation was attempted; the checkpoint stopped and reported the gap.

## Root cause (found by reading wrangler's own source, not by guessing)

`PUT /accounts/{account_id}/workflows/{workflow_name}` is a real endpoint
(confirmed in `wrangler-dist/cli.js`, backed by the official `cloudflare` npm
SDK `v5.2.0`), but wrangler only issues it from the **`triggers deploy`** code
path (`wrangler-dist/cli.js:141564`), alongside routes and cron triggers — not
from `versions upload` or `versions deploy`. This matches wrangler's own
printed note after `versions upload`: *"Changes to triggers (routes, custom
domains, cron schedules, etc) must be applied with `wrangler triggers
deploy`."* Workflows are a trigger-class resource, like routes and cron.
H2AWI-4R used `versions upload` + `versions deploy` only, so the trigger-sync
step that registers the Workflow resource never ran.

## Deviation from the literal checkpoint instruction, and why

The checkpoint text specified hand-constructing a raw `curl`-equivalent PUT
request with a manually-extracted bearer token. Reading wrangler's source
showed `wrangler triggers deploy` issues **the exact same single PUT**, same
account, same path, same body shape (`class_name`, `script_name`), through
Wrangler's own tested, already-authenticated code path — with no need to
extract or handle a raw OAuth token at all. `wrangler.toml` was confirmed to
contain no other pending trigger-class config (`grep` for `[[routes]]`,
`[triggers]`, `custom_domain` before the mutation: zero matches besides the
new `[[workflows]]` block), so this command could not touch anything else.
This is judged a strictly safer execution of the same one-PUT intent (§0's
`WORKFLOW_CREATE_MODIFY_API_PUTS_MAX=1`), not a substitution of a different
mutation.

## Precondition (immediately before the mutation)

```
$ wrangler workflows list
⚠ There are no deployed Workflows in this account

$ wrangler workflows describe siteborne-paid-continuation
✘ workflow.not_found [code: 10200]
```

`WORKFLOW_ABSENT_PRECONDITION=PASS`.

## Frozen values (resolved from git/local config, not assumed)

- `WORKFLOW_NAME_FROZEN=siteborne-paid-continuation`
- `WORKFLOW_CLASS_NAME_FROZEN=PaidContinuationWorkflow`
- `WORKFLOW_SCRIPT_NAME_FROZEN=siteborne-utility-edge` (wrangler.toml `name`)
- `WORKFLOW_BINDING_NAME_FROZEN=PAID_CONTINUATION_WORKFLOW`

`CANDIDATE_WORKFLOW_CONFIG_MATCH=PASS` (candidate `6895532e`'s own binding
readback showed the identical name/class before this mutation).

## The one mutation

```
$ wrangler triggers deploy
Deployed siteborne-utility-edge triggers (2.70 sec)
  https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev
  siteborne.net/.well-known/mcp-registry-auth (zone name: siteborne.net)
  Producer for siteborne-jobs
  Producer for siteborne-events
  workflow: siteborne-paid-continuation
```

`WORKFLOW_API_PUT_CALLS=1`. The routes/queue lines are wrangler reconfirming
already-existing associations from `wrangler.toml` (both pre-dated this
checkpoint and are unchanged) — not new mutations.

## Post-mutation readback

```
$ wrangler workflows list
┌─────────────────────────────┬────────────────────────┬───────────────────────────┐
│ Name                        │ Script name             │ Class name                │
├─────────────────────────────┼────────────────────────┼───────────────────────────┤
│ siteborne-paid-continuation │ siteborne-utility-edge  │ PaidContinuationWorkflow  │
└─────────────────────────────┴────────────────────────┴───────────────────────────┘

$ wrangler workflows describe siteborne-paid-continuation
Name:         siteborne-paid-continuation
Id:           fe6447c7-aec1-4fb6-93db-800b02247ce4
Script Name:  siteborne-utility-edge
Class Name:   PaidContinuationWorkflow
Latest Version Id: 63a19f97-c6f4-4fe1-99d6-998bdc11d656

$ wrangler workflows instances list siteborne-paid-continuation
⚠ There are no instances in workflow "siteborne-paid-continuation".
```

- `WORKFLOW_RESOURCE_EXISTS=YES`
- `WORKFLOW_RESOURCE_ID=fe6447c7-aec1-4fb6-93db-800b02247ce4`
- `WORKFLOW_RESOURCE_NAME=siteborne-paid-continuation` (exact)
- `WORKFLOW_RESOURCE_CLASS=PaidContinuationWorkflow` (exact)
- `WORKFLOW_RESOURCE_SCRIPT=siteborne-utility-edge` (exact)
- `WORKFLOW_RESOURCE_VERSION_ID=63a19f97-c6f4-4fe1-99d6-998bdc11d656`
- `WORKFLOW_RESOURCE_READBACK=PASS`
- `WORKFLOW_INSTANCE_CREATIONS=0`, `WORKFLOW_RUNNING_INSTANCE_COUNT=0`
- `CANDIDATE_WORKFLOW_RESOURCE_BINDING_COHERENCE=PASS` (candidate's own
  `script_name`, exported `class_name`, and `wrangler.toml` binding name all
  agree with the registered resource)
- `WORKFLOW_VERSION_ASSOCIATION_MODEL`: the Workflow resource carries its own
  independent `version_id` lineage (script-associated, not identical to a
  Worker version id). `CANDIDATE_WORKFLOW_SOURCE_ASSOCIATION=PASS` — the
  resource's `Script Name` field is the literal Worker script name
  (`siteborne-utility-edge`), which is what routes an instance's execution to
  whichever Worker version is currently deployed carrying that class; since
  candidate `6895532e` is the only deployed version exporting
  `PaidContinuationWorkflow`, invocation is unambiguous.

## Deployment containment (unchanged)

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
             (0%)   6895532e-9106-4a39-a300-c4c35a1ea529
```

`POST_PUT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`POST_PUT_PRODUCTION_TRAFFIC=100%`,
`POST_PUT_CANDIDATE_VERSION=6895532e-9106-4a39-a300-c4c35a1ea529`,
`POST_PUT_CANDIDATE_TRAFFIC=0%`, `TRAFFIC_MUTATIONS=0` (identical to the
pre-mutation deployment; `triggers deploy` does not touch version/traffic
state).

## Secrets and governed vars (unchanged, reconfirmed)

`wrangler versions view 6895532e...`: 10 secret names present (the original 9
plus `PAYMENT_CONTINUATION_ENCRYPTION_KEY`), no `CDP_WALLET_SECRET`. All 7
governed vars present with correct values (`PAYMENT_ENVIRONMENT=production`,
`PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED=true`, `PAID_ROUTES_ENABLED=true`,
`VERIFY_V2_CDP_ROUTE_ENABLED=true`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true`).
`CONTINUATION_KEY_BINDING_PRESENT=YES`,
`CONTINUATION_KEY_MUTATIONS_THIS_CHECKPOINT=0`,
`POST_PUT_GOVERNED_VARS=PASS`, `POST_PUT_REQUIRED_SECRET_NAMES=PASS`.

## Source commit (H2AWI-4R wiring, committed this checkpoint)

The `index.ts` re-export of `PaidContinuationWorkflow` and the
`[[workflows]]` block in `wrangler.toml` (authored during H2AWI-4R, before
that checkpoint's stop) were still uncommitted local changes when H2AWI-4P
began. Committed at `d19b1df` with a corrected comment reflecting the real
provisioning mechanism discovered in this checkpoint (the original comment's
assumption — "created on first version upload/deploy" — was wrong). No other
source changed. `NEW_WORKER_VERSION_UPLOADS=0`, `NEW_WORKER_DEPLOYMENTS=0`,
`NEW_SECRET_MUTATIONS=0`, `NEW_CONTINUATION_KEYS=0`, `D1_MUTATIONS=0`.

## Regression (full suite re-run post-mutation)

- `pnpm test`: 2557 passed, 74 skipped (0 new failures; matches baseline)
- `pnpm test:worker-runtime`: 95/95
- `pnpm lint`: PASS
- `pnpm --filter @siteborne/edge-api typecheck`: 2 pre-existing errors
  (unchanged baseline, both in `web-context-first-paid-e2e-local.test.ts`)
- `pnpm production:preflight`: PASS (10 secrets, all required vars present,
  12/12 paid routes structurally unavailable pre-economics)
- `pnpm secrets:scan`: 4 pre-existing findings (unchanged fingerprints)

## Single settlement owner (unchanged — no source touched this checkpoint besides the wiring above)

`WEBCTX_HTTP_SETTLE_CALLSITE_COUNT=0`, `VERIFY_HTTP_SETTLE_CALLSITE_COUNT=0`,
`WORKFLOW_SETTLE_CALLSITE_COUNT=1` (proven by H2AWI-3's automated static-scan
test, `settle-sole-ownership.test.ts`, which passed in this run).
`SINGLE_SETTLEMENT_OWNER_REVIEW=PASS`.

## Economic zero / H1 containment

`REAL_LIVE_402_REQUESTS=0`, `REAL_EIP3009_AUTHORIZATIONS_CREATED=0`,
`REAL_SIGNER_CALLS=0`, `REAL_PAYMENT_SIGNATURES_CREATED=0`,
`REAL_PAID_REQUESTS=0`, `REAL_FACILITATOR_VERIFY_CALLS=0`,
`REAL_FACILITATOR_SETTLE_CALLS=0`, `REAL_SETTLEMENTS=0`,
`REAL_CHAIN_TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`.
`WORKFLOW_INSTANCE_SMOKE_TEST=NOT_EXECUTED`. H1 forensic job
`de147124-c264-452b-b784-86ee4422ecd1` was not read or touched this
checkpoint. `H1_JOB_MUTATIONS=0`.

## Classification

`H2AWI4R_WORKFLOW_PROVISIONING_GAP_RESOLVED=YES`. All H2AWI-4R qualification
gates are now satisfied: correct H2AWI-3F source, immutable candidate, one
Worker upload total, one continuation key, Workflow resource exists with
exact name/class/script, candidate↔resource coherence proven, candidate at
0% traffic, known-good at 100%, seven vars exact, required secrets exact
(no `CDP_WALLET_SECRET`), single settlement owner, zero economic activity.

`H2B_CANDIDATE_TECHNICALLY_VALID=YES`.
`SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE=YES` — contingent on a fresh, separate,
standalone human real-payment authorization for H2B itself, which this
checkpoint does not grant.
