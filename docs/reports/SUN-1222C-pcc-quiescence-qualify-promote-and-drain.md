# SUN-1222C PCC Quiescence Qualification, Promotion, and Drain

**Checkpoint:** `SUN-1222C-PCC-QUIESCENCE-QUALIFY-PROMOTE-AND-DRAIN`

**Evidence date:** 2026-09-11 (America/Chicago)

**Decision:** `DRAINABILITY_BLOCKED_PRE_PROMOTION`

**Prior evidence authority:** `43e40fff9d8d58677f50760aaa9acd5d2a5a2141`

**Runtime source authority:** `8cc7222bb4aa3525824cf8f42e9938bb84fa8bbb`

## Outcome

The authorized Stage A membership change completed exactly once. Deployment
`72a81c44-8957-4f54-a010-3d0837b9c587` replaced only the 0% legacy baseline
member with immutable quiescence version `d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1`.
Normal traffic remained entirely on qualified version
`b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca`.

Exact-version override qualification of d28 passed. However, the mandatory
pre-promotion audit found that all 17 records in the frozen nonterminal set are
stale orphans with no active Workflow, scheduled reconciliation, or bounded
automatic retry owner. The youngest record was 76.94 hours old and the oldest
was 312.13 hours old at final audit. Therefore the backlog is not naturally
drainable, Stage B was not executed, normal paid admission was not closed, and
the safe final public topology remains:

```text
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @100%
d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @0%
```

This is a lifecycle-backlog governance stop, not a d28 runtime failure.

## Repository and live preflight

The literal repository pre-state was:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=43e40fff9d8d58677f50760aaa9acd5d2a5a2141
WORKING_TREE=CLEAN
PRIOR_EVIDENCE_COMMIT_EXISTS=YES
PRIOR_EVIDENCE_COMMIT_REACHABLE=YES
RUNTIME_SOURCE_AUTHORITY_EXISTS=YES
RUNTIME_AFFECTING_DELTA_FROM_PRIOR_EVIDENCE=EMPTY
WRANGLER_VERSION=4.119.0
```

Fresh pre-mutation readback matched the authorized topology:

```text
PUBLIC_DEPLOYMENT_ID_PRE=037ae834-3b1e-4eae-b5c0-7befa09856c1
PUBLIC_NORMAL_VERSION_PRE=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
PUBLIC_NORMAL_TRAFFIC_PRE=100%
PUBLIC_ROLLBACK_VERSION_PRE=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_ROLLBACK_TRAFFIC_PRE=0%
QUIESCENCE_VERSION=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
QUIESCENCE_VERSION_NUMBER=63
QUIESCENCE_VERSION_UNASSIGNED_PRE=YES
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
PREVIEW_URLS_ENABLED=NO
MTLS_PRODUCTION_ACTIVE_EFFECTIVE=FALSE
```

Direct immutable readback reconfirmed b6/d28 script-etag, compatibility-date,
compatibility-flag, secret-name, and non-secret-binding parity. Their ordinary
variable maps differ only in `PAID_ROUTES_ENABLED=true` on b6 versus `false` on
d28. Verify and web flags remain true. Company, document, and artifact flags
remain false.

```text
D28_IMMUTABLE_PARITY_RECONFIRMED=YES
```

## Stage A command proof and execution

The exact pre-Stage-A restoration command was dry-run successfully and retained
as an emergency path; it was not executed:

```bash
npx wrangler versions deploy \
  'b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@100%' \
  'db7054c9-76ee-4830-aabe-8a4542261b6a@0%' \
  --name siteborne-utility-edge \
  --message 'SUN-1222C pre-Stage-A restore: stabilized b6b7477f 100%; legacy baseline db7054c9 0%' \
  --yes
```

The authorized Stage A command was also dry-run successfully and then executed
once without retry:

```bash
npx wrangler versions deploy \
  'b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@100%' \
  'd28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@0%' \
  --name siteborne-utility-edge \
  --message 'SUN-1222C quiescence qualification membership: b6b7477f 100%; d28f30c5 0%; replace only old baseline rollback member; no quiescence traffic' \
  --yes
```

```text
PRE_STAGE_A_RESTORE_DRY_RUN=PASS
STAGE_A_DRY_RUN=PASS
STAGE_A_EXIT_CODE=0
STAGE_A_DEPLOYMENT_ID=72a81c44-8957-4f54-a010-3d0837b9c587
STAGE_A_CREATED_AT=2026-09-11T17:56:34.258159Z
WOULD_UPLOAD_NEW_VERSION=NO
WOULD_CHANGE_VARS=NO
WOULD_CHANGE_SECRETS=NO
WOULD_CHANGE_BINDINGS=NO
NORMAL_TRAFFIC_PERCENTAGE_MUTATIONS=0
```

Immediate and final readback both showed b6 at 100% and d28 at 0%. Immutable
readback of `db7054c9` remained available after it left current deployment
membership.

## Exact d28 runtime qualification

Every candidate request used Cloudflare's structured version-override header:

```text
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1"
```

An authoritative self-filtered JSON Tail attributed the candidate probes to
exactly d28. A normal no-header `/health` control was independently attributed
to b6. This matches Cloudflare's documented requirement that an override target
must be a member of the current deployment.

| Probe                    | Result                         | `cf-ray`                                                 | Evidence                                                          |
| ------------------------ | ------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| d28 `/health`            | HTTP 200                       | `a3988e41bdc55f98-ATL`                                   | Tail `scriptVersion.id=d28f30c5...`                               |
| d28 `/ready`             | HTTP 200, truthful `not_ready` | `a3988e44b9ac5f98-ATL`                                   | Production services disabled; known blockers only                 |
| d28 Agent Card           | HTTP 200, signed               | `a3988e44eac45f98-ATL`                                   | All v2 services report `productionEnabled=false`; mTLS absent     |
| d28 JWKS                 | HTTP 200                       | `a3988e456be1bffe-ATL`                                   | One public key; private material absent                           |
| d28 JWS verification     | PASS                           | card `a3988ed57914a0f6-ATL`; JWKS `a3988ed91b5cbaf0-ATL` | Signature verified against served JWKS                            |
| d28 catalog              | HTTP 200                       | `a3988e4b3bfa5f98-ATL`                                   | All v2 services preproduction/production-disabled                 |
| d28 MCP initialize       | HTTP 200                       | `a3988e4b9da25f98-ATL`                                   | Protocol `2025-11-25` negotiated                                  |
| d28 MCP tools/list       | HTTP 200                       | `a3988e4be97bbffe-ATL`                                   | Six tools listed                                                  |
| d28 service health tool  | HTTP 200                       | `a3988e4cba0e5f98-ATL`                                   | `production_ready=false`; services `production_disabled/not_live` |
| normal `/health` control | HTTP 200                       | `a3988e4dcde75f98-ATL`                                   | Tail `scriptVersion.id=b6b7477f...`                               |

The minimum pre-state rejection probes all reached d28 and returned 404:

| Surface                     | `cf-ray`               | Result                  |
| --------------------------- | ---------------------- | ----------------------- |
| `verify_agent_output.v2`    | `a3988e4cea5fbffe-ATL` | PASS — 404 before state |
| `web_context_verified.v2`   | `a3988e4d1b755f98-ATL` | PASS — 404 before state |
| `company_evidence_graph.v2` | `a3988e4d4acfbffe-ATL` | PASS — 404 before state |
| `document_evidence_json.v2` | `a3988e4d7ccf5f98-ATL` | PASS — 404 before state |
| `document-artifact-upload`  | `a3988e4d9b34bffe-ATL` | PASS — 404 before state |

Pre/post remote D1 snapshots were identical: `payment_attempts=18`,
`x402_quotes=73`, `audit_events=171`, `jobs=18`, and `queue_dispatches=0`,
including identical latest timestamps. Tail contained no relevant exception. No
quote, audit, payment-attempt, job, queue, provider, payment verification,
Workflow, settlement, R2, or other state change was caused by qualification.

```text
D28_EXACT_VERSION_REACHABILITY=PASS
D28_EXACT_RUNTIME_QUALIFICATION=PASS
D28_DISCOVERY_TRUTHFUL=YES
VERIFY_QUIESCENCE_RUNTIME_REJECTION=PASS
WEB_QUIESCENCE_RUNTIME_REJECTION=PASS
COMPANY_D28_DISABLED=PASS
DOCUMENT_D28_DISABLED=PASS
ARTIFACT_D28_DISABLED=PASS
```

## Mandatory backlog ownership audit

The authoritative query covered exactly the frozen stages `acquired`,
`verified`, `executed`, `settlement_pending`, `settled_external`,
`link_verified`, and `settlement_failed`.

```text
CURRENT_INFLIGHT_BY_STAGE={verified:16,settled_external:1}
CURRENT_INFLIGHT_TOTAL=17
YOUNGEST_AGE_HOURS=76.94
OLDEST_AGE_HOURS=312.13
```

`payment_attempts` has no `updated_at` column, so that requested field is
`NOT_STORED` for every row. The following table contains every matching row and
only sanitized lifecycle metadata:

| Payment-attempt ID                     | Service | Stage            | Created at               | Age (h) | Payment ID present | Settlement ref present | Classification |
| -------------------------------------- | ------- | ---------------- | ------------------------ | ------: | ------------------ | ---------------------- | -------------- |
| `57a2bcdb-3d47-4369-b871-2d7befec555c` | web     | verified         | 2026-08-29T17:54:27.958Z |  312.13 | Yes                | No                     | D              |
| `a5928987-1c4c-4fd0-8e91-5095b955dda6` | web     | verified         | 2026-08-29T22:35:32.413Z |  307.45 | Yes                | No                     | D              |
| `bff2bc21-3b12-417c-ac35-4be05c212936` | web     | verified         | 2026-08-29T23:27:39.862Z |  306.58 | Yes                | No                     | D              |
| `e8d2607b-c3e3-4690-825a-b919bdaa9a48` | web     | verified         | 2026-08-30T01:24:30.515Z |  304.63 | Yes                | No                     | D              |
| `3a728ffc-5f1b-4b12-8145-c84f25fc9330` | web     | verified         | 2026-08-31T04:46:24.078Z |  277.27 | Yes                | No                     | D              |
| `123c4f61-2090-40fb-b918-7b2e1f187af0` | web     | verified         | 2026-08-31T20:10:40.909Z |  261.86 | Yes                | No                     | D              |
| `abc98f87-9164-4d97-98d3-c24d4367f0a6` | web     | verified         | 2026-09-01T12:40:04.749Z |  245.37 | Yes                | No                     | D              |
| `eddedd77-86c0-47c6-8ec3-11f1354dddc5` | web     | verified         | 2026-09-01T13:10:06.014Z |  244.87 | Yes                | No                     | D              |
| `56d84294-eff5-4f92-ae91-d61ceca5339a` | web     | settled_external | 2026-09-01T13:39:25.906Z |  244.38 | Yes                | Yes                    | D              |
| `3706d9a9-789e-4e07-bab5-7b3174e11f24` | company | verified         | 2026-09-06T05:06:51.691Z |  132.92 | Yes                | No                     | D              |
| `f964e050-abd4-4f27-b04e-dc06eaf219ed` | company | verified         | 2026-09-07T16:56:12.319Z |   97.10 | Yes                | No                     | D              |
| `7176fb23-7c68-451e-b0a3-1e93f54ef8fe` | company | verified         | 2026-09-07T18:13:20.736Z |   95.82 | Yes                | No                     | D              |
| `0ada4abc-a437-428e-803f-3dfb68f915f9` | company | verified         | 2026-09-07T21:27:10.226Z |   92.59 | Yes                | No                     | D              |
| `d275356c-f6f8-46f7-8a2a-cabe26d32185` | company | verified         | 2026-09-07T22:30:30.359Z |   91.53 | Yes                | No                     | D              |
| `ab07fd69-e50c-4abf-ae5b-1fb8476230b8` | company | verified         | 2026-09-07T23:38:33.935Z |   90.40 | Yes                | No                     | D              |
| `5be6b110-62fb-40a4-8bda-cf4698645d71` | company | verified         | 2026-09-08T05:40:30.686Z |   84.36 | Yes                | No                     | D              |
| `22d6df47-41db-49a6-8eff-3750bd5539c9` | company | verified         | 2026-09-08T13:05:49.043Z |   76.94 | Yes                | No                     | D              |

For every row, the remaining requested ownership fields have the same exact
result:

```text
UPDATED_AT=NOT_STORED
JOB_ID=NONE
WORKFLOW_ID_OR_DURABLE_OWNER=NONE
LATEST_STATE_EVENT=NONE
LATEST_EVENT_AT=NONE
EVIDENCE_REF_PRESENT=NO
ACTIVE_WORKFLOW_INSTANCE=NO
SCHEDULED_RECONCILIATION_OWNER=NO
KNOWN_RETRY_OWNER=NO
EXPECTED_NEXT_TRANSITION=NONE_AUTOMATIC;_SEPARATE_RECONCILIATION_REQUIRED
MAX_LEGITIMATE_REMAINING_RETRY_HORIZON=NONE;_NO_AUTOMATIC_OWNER
```

The lone `settled_external` record has one historical successful-economic-
settlement count and a settlement reference, but no job, state event, receipt
evidence, or Workflow owner capable of advancing it through `link_verified` to
`settled`. The other 16 records have zero facilitator-settle attempts and zero
successful-economic-settlement counts.

Cloudflare Workflow readback listed exactly one historical instance,
`h2bf2-nonecon-probe-01`, created 2026-08-31 and already `Errored`; it is not
correlated to any audited row. No running, queued, or paused instance exists.

The source architecture independently confirms the ownership result:

- the public route creates a Workflow only inside a paid request after payment
  verification; retries are `get()`-only and never create a missing instance;
- the paid-runtime configuration has no cron or Workflow schedule;
- the settlement-alert cron only reads unresolved settlement rows and sends an
  operator webhook; it has no Workflow binding and cannot mutate lifecycle
  state; and
- post-settlement reconciliation is synchronous inside an existing Workflow
  invocation. The accepted recovery design explicitly has no scheduled
  reconciliation sweep or admin endpoint; later recovery needs an errored
  platform retry or separately authorized operator reconciliation.

Fresh semantic regression coverage passed: 3 files, 25 tests, including exact
settlement ownership, dedicated Workflow-host configuration, and the alert
sweep's read-only behavior.

```text
ACTIVE_PREEXISTING_WORKFLOW_COUNT=0
ACTIVE_SCHEDULED_RECONCILIATION_COUNT=0
WAITING_WITH_PROVEN_AUTOMATIC_OWNER_COUNT=0
STALE_ORPHAN_COUNT=17
UNKNOWN_OWNERSHIP_COUNT=0
PREEXISTING_BACKLOG_NATURALLY_DRAINABLE=NO
MAX_NATURAL_DRAIN_HORIZON=NOT_DERIVABLE_NO_AUTOMATIC_OWNER
DRAIN_OBSERVATION_DEADLINE=NOT_SET
```

## Hard-gate disposition

Section 16 required both stale-orphan and unknown-ownership counts to be zero,
with a bounded automatic owner for every remaining row. That gate failed
deterministically. In accordance with the checkpoint:

- Stage B was not dry-run or executed;
- d28 was not promoted;
- normal admission was not closed;
- no drain observation window was started;
- no payment, Workflow, provider, facilitator, settlement, or lifecycle mutation
  was initiated; and
- the paid runtime was not deployed.

```text
QUIESCENCE_PROMOTION_EXECUTED=NO
QUIESCENCE_DEPLOYMENT_ID=NOT_CREATED
QUIESCENCE_PROPAGATION_CONFIRMED=NOT_APPLICABLE
QUIESCENCE_EFFECTIVE_AT=NOT_SET
NORMAL_PUBLIC_QUIESCENCE_SMOKE=NOT_RUN_PRE_PROMOTION_GATE_BLOCKED
VERIFY_NORMAL_PUBLIC_ADMISSION_CLOSED=NO_NOT_PROMOTED
WEB_NORMAL_PUBLIC_ADMISSION_CLOSED=NO_NOT_PROMOTED
PAID_ADMISSION_CLOSED_AT=NOT_SET
DRAIN_T0_BY_STAGE={verified:16,settled_external:1}
DRAIN_T0_TOTAL=17
DRAIN_FINAL_BY_STAGE={verified:16,settled_external:1}
DRAIN_FINAL_TOTAL=17
ALL_PREEXISTING_NONTERMINAL_ROWS_TERMINAL=NO
ZERO_INFLIGHT_FIRST_OBSERVED_AT=NOT_OBSERVED
ZERO_INFLIGHT_SECOND_CHECK_TOTAL=NOT_RUN
ZERO_INFLIGHT_STABLE=NO
INFLIGHT_PAID_JOBS_TOTAL=17
```

## Final topology and accounting

Final live readback confirmed:

```text
PUBLIC_DEPLOYMENT_ID_FINAL=72a81c44-8957-4f54-a010-3d0837b9c587
PUBLIC_VERSION_FINAL=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
PUBLIC_TRAFFIC_FINAL=100%
PUBLIC_ROLLBACK_VERSION_FINAL=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
PUBLIC_ROLLBACK_TRAFFIC_FINAL=0%
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
SETTLEMENT_ALERT_VERSION=8fe32c69-d906-4369-9c0a-49b2cc406e8e
SETTLEMENT_ALERT_TRAFFIC=100%
SETTLEMENT_ALERT_WORKER_UNCHANGED=YES
```

No active alert-history read interface was used, so the report does not claim
that no webhook alert fired. No D1 lifecycle state changed during the
checkpoint, and no pre-existing Workflow was active; therefore no pre-existing
provider execution, settlement, or economic effect was observed during this
checkpoint.

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1

VERSION_UPLOADS=0
STAGE_A_DEPLOYMENT_MUTATIONS=1
QUIESCENCE_PROMOTION_DEPLOYMENT_MUTATIONS=0
TOTAL_PRODUCTION_DEPLOYMENT_MUTATIONS=1
DEPLOYMENT_MEMBERSHIP_MUTATIONS=1
NORMAL_TRAFFIC_PERCENTAGE_MUTATIONS=0
EXISTING_VERSION_VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
DNS_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
PAID_RUNTIME_DEPLOYMENTS=0
MANUAL_D1_LIFECYCLE_MUTATIONS=0
MANUAL_R2_MUTATIONS=0

CHECKPOINT_GENERATED_NEW_REAL_PAYMENTS=0
CHECKPOINT_GENERATED_NEW_PAYMENT_AUTHORIZATIONS=0
CHECKPOINT_GENERATED_NEW_PAID_WORKFLOWS=0
CHECKPOINT_GENERATED_NEW_USEFUL_PROVIDER_EXECUTIONS=0
CHECKPOINT_GENERATED_NEW_SETTLEMENTS=0
PREEXISTING_INFLIGHT_PROVIDER_EXECUTIONS=0
PREEXISTING_INFLIGHT_SETTLEMENTS=0
PREEXISTING_INFLIGHT_ECONOMIC_EFFECT=0
```

## Decision

```text
SUN1222C_PCC_QUIESCENCE_QUALIFY_PROMOTE_AND_DRAIN=DRAINABILITY_BLOCKED_PRE_PROMOTION
PAID_RUNTIME_PRECONDITIONS_FROM_QUIESCENCE=FAIL_NOT_QUIESCED_NOT_DRAINED
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-LIFECYCLE-BACKLOG-RECONCILIATION
```

The next checkpoint must classify and safely reconcile the 17 historical
orphaned lifecycle records without fabricating terminal state or duplicating an
economic effect. Until that occurs, keep b6 at 100%, d28 at 0%, and the paid
runtime at `d62011b9@100%`.
