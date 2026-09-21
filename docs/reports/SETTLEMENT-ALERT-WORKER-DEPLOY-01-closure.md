# SETTLEMENT-ALERT-WORKER-DEPLOY-01 — Closure

Status: **PASS_WITH_NOT_EXERCISED_LIVE_PATH** — the qualified
minimal-remediation source was deployed to `siteborne-settlement-alert`, the
next natural scheduled empty sweep completed successfully on the new version,
and no rollback condition was observed. No legitimate unresolved settlement
existed, so the live `job_id` projection path was deliberately not manufactured
or exercised.

## 1. Authorization and exact deployed source

Human authorization was granted to deploy only the qualified alert Worker from
the exact minimal-remediation source:

```text
MINIMAL_REMEDIATION_SOURCE_SHA=4472f3fcbedae0d88051c77927170a11a34252ff
DEPLOYED_BASE_SOURCE=20302f6b5af4fa88ebefbe1b07459de47d9306f7
```

Before deployment, `/private/tmp/alert-min-wt` was clean and was detached from
the documentation-only commit onto exactly:

```text
HEAD=4472f3fcbedae0d88051c77927170a11a34252ff
WORKING_TREE=CLEAN
WRANGLER_VERSION=4.119.0
```

The qualified production-code delta remained limited to:

- `apps/edge-api/src/control-plane/alerting/settlement-alert-sweep.ts`
- `apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`

The later report-only commit `cbee7ede81559c08206eb6f2f3cdcc4eb3d729d1` was not
the checkout used for deployment.

## 2. Qualified artifact relationship

| Artifact                       | SHA-256                                                            |     Bytes |
| ------------------------------ | ------------------------------------------------------------------ | --------: |
| Exact `20302f6` baseline       | `f23db3af77441b200f790be38928a0fdfb7f0b108370477b2cb0edec6dc35812` | 1,167,276 |
| `4472f3fc` minimal remediation | `a5da7f9f408ce66c8a404a489d91f623475c131fefa595a8280fef39b5ad6b16` | 1,168,761 |

```text
BUNDLE_DELTA_BYTES=1485
TOTAL_MODULES=249
UNCHANGED_MODULES=247
ADDED_MODULES=[]
REMOVED_MODULES=[]
CHANGED_MODULES=[
  apps/edge-api/src/control-plane/alerting/settlement-alert-sweep.ts,
  apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts
]
MINIMAL_REMEDIATION_ARTIFACT_SCOPE=PASS
```

The Worker was not rebuilt or modified after deployment.

## 3. Exact deployment command and result

The single authorized mutation was:

```sh
pnpm exec wrangler deploy \
  --config wrangler.settlement-alert-worker.toml \
  --message "SETTLEMENT-ALERT-MINIMAL-REMEDIATION-LINEAGE-01 source=4472f3fcbedae0d88051c77927170a11a34252ff"
```

Wrangler exited 0. Exact deployment output, excluding ANSI color control bytes:

```text
 ⛅️ wrangler 4.119.0
────────────────────
▲ [WARNING] Import "default" will always be undefined because there is no matching export in "node_modules/.pnpm/unenv@2.0.0-rc.24/node_modules/unenv/dist/runtime/npm/whatwg-url/index.mjs" [import-is-undefined]

    required-unenv-alias:whatwg-url:6:27:
      6 │         "default" in esm ? esm.default : {}
        ╵                                ~~~~~~~

▲ [WARNING] Import "default" will always be undefined because there is no matching export in "node_modules/.pnpm/unenv@2.0.0-rc.24/node_modules/unenv/dist/runtime/npm/whatwg-url/webidl2js-wrapper.mjs" [import-is-undefined]

    required-unenv-alias:whatwg-url/webidl2js-wrapper:6:27:
      6 │         "default" in esm ? esm.default : {}
        ╵                                ~~~~~~~

Total Upload: 1141.37 KiB / gzip: 198.75 KiB
Worker Startup Time: 30 ms
Your Worker has access to the following bindings:
Binding                         Resource
env.DB (siteborne-utility)      D1 Database

Uploaded siteborne-settlement-alert (2.82 sec)
Deployed siteborne-settlement-alert triggers (0.75 sec)
  schedule: */15 * * * *
Current Version ID: 465daf70-b3b7-4265-9d69-39cc02d890fe
```

```text
PREVIOUS_ALERT_WORKER_VERSION=8fe32c69-d906-4369-9c0a-49b2cc406e8e
DEPLOYED_ALERT_WORKER_VERSION=465daf70-b3b7-4265-9d69-39cc02d890fe
DEPLOYED_ALERT_WORKER_CREATED_AT=2026-09-21T03:06:09.438026Z
DEPLOYMENT_CREATED_AT=2026-09-21T03:06:10.061281Z
```

## 4. Deployment metadata and source attribution

Read-only `wrangler deployments status --json` returned one active alert-Worker
version at 100%:

```text
DEPLOYMENT_ID=815a4a5b-7980-42cc-b042-b4cd94f4cf80
DEPLOYED_ALERT_WORKER_VERSION=465daf70-b3b7-4265-9d69-39cc02d890fe
DEPLOYED_ALERT_WORKER_PERCENTAGE=100
DEPLOYMENT_MESSAGE_SOURCE=4472f3fcbedae0d88051c77927170a11a34252ff
```

Cloudflare version metadata records the exact deployment message and
`source=wrangler`, but it does not expose a Git commit identity or a
provider-side SHA-256 of the locally qualified JavaScript bundle. Its script
resource exposes provider etag
`0e2585861a375becb928eff26fbd2651312f42c73a859bad8f59d1c23e682b47`, which is not
treated as a Git or local bundle identity.

The local deploy process was independently proven to start from detached, clean
`4472f3fc...`, but provider-verifiable source attribution is limited to the
persisted message:

```text
PROVIDER_VERIFIED_SOURCE=NOT_EXPOSED
DEPLOYMENT_SOURCE_ATTRIBUTION=MESSAGE_ONLY
```

## 5. Only the alert Worker changed

Read-only deployment status after the alert deployment:

| Worker                                | Active version(s)                                                                            | Result            |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------- |
| `siteborne-utility-edge`              | `3b35f9e7-6fb8-47e4-acff-c5736eff6da6` at 100%; `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` at 0% | unchanged         |
| `siteborne-paid-continuation-runtime` | `9b1e9b10-beed-4ff3-914c-2221aada9b45` at 100%                                               | unchanged         |
| `siteborne-settlement-alert`          | `465daf70-b3b7-4265-9d69-39cc02d890fe` at 100%                                               | intended mutation |

```text
PUBLIC_WORKER_VERSION=3b35f9e7-6fb8-47e4-acff-c5736eff6da6
PUBLIC_WORKER_ROLLBACK_VERSION=369b4bf5-c2f7-4e05-8454-7f5514a3bd45
PUBLIC_WORKER_UNCHANGED=YES
CONTINUATION_HOST_VERSION=9b1e9b10-beed-4ff3-914c-2221aada9b45
CONTINUATION_HOST_UNCHANGED=YES
```

## 6. Alert Worker configuration preservation

Read-only `wrangler versions view` for the new version returned:

- D1 binding `DB`, database ID `efe23c42-cbcc-47c2-9b28-922a541bdcdd`;
- secret binding name `SETTLEMENT_ALERT_WEBHOOK_URL`, type `secret_text`;
- handlers `scheduled` and `fetch`;
- compatibility date `2026-08-05` and flag `nodejs_compat`.

Read-only `wrangler secret list` independently returned exactly the webhook
secret name and type. No secret value was requested or printed. No secret was
rotated, replaced, or rewritten.

```text
ALERT_DB_BINDING_PRESERVED=YES
ALERT_WEBHOOK_SECRET_BINDING_PRESERVED=YES
CLOUD_SECRET_MUTATIONS=0
```

## 7. Safe live-case determination

One aggregate-only, read-only production D1 query used the exact guarded
linkage:

```sql
SELECT COUNT(*) AS unresolved_count,
       COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN 1 ELSE 0 END), 0)
         AS canonically_linked_count,
       COALESCE(SUM(CASE
         WHEN pa.job_id IS NOT NULL AND j.id IS NOT NULL AND pa.job_id <> j.id
         THEN 1 ELSE 0 END), 0) AS conflict_count,
       COALESCE(SUM(CASE WHEN j.id IS NULL THEN 1 ELSE 0 END), 0)
         AS not_derived_count
  FROM payment_attempts pa
  LEFT JOIN jobs j
    ON j.idempotency_key = pa.payment_identifier
   AND j.service_id = pa.service_id
   AND j.input_hash = pa.request_input_hash
 WHERE pa.lifecycle_stage = 'settlement_pending';
```

Result:

```text
unresolved_count=0
canonically_linked_count=0
conflict_count=0
not_derived_count=0
rows_written=0
changed_db=false
```

No row identifiers, payment identifiers, secret values, or signed material were
printed. Because no legitimate unresolved settlement existed, no failure,
payment, reconciliation condition, D1 row, or webhook was manufactured.

```text
PRODUCTION_ALERT_JOB_ID_PROJECTION=NOT_EXERCISED_NO_SAFE_LIVE_CASE
```

## 8. Immediate runtime observation

A version-filtered read-only tail observed the next natural `*/15 * * * *`
scheduled invocation. It was not synthetically triggered. The event ran exactly
version `465daf70-b3b7-4265-9d69-39cc02d890fe` and reported:

```json
{
  "outcome": "ok",
  "scriptVersion": {
    "id": "465daf70-b3b7-4265-9d69-39cc02d890fe"
  },
  "scriptName": "siteborne-settlement-alert",
  "exceptions": [],
  "logs": [
    {
      "message": [
        "{\"event\":\"settlement_alert_sweep_complete\",\"considered_count\":0,\"delivered_count\":0,\"failed_count\":0}"
      ],
      "level": "warn",
      "timestamp": 1789960500514
    }
  ],
  "eventTimestamp": 1789960500313,
  "event": {
    "cron": "*/15 * * * *",
    "scheduledTime": 1789960500000
  }
}
```

This live event proves module load, scheduled-handler execution, and the empty
D1 sweep completed without a startup failure, uncaught exception, binding error,
SQL/join error, or D1 query failure. Because zero rows were considered, it does
not exercise or prove webhook delivery or live `job_id` projection.

```text
ALERT_RUNTIME_HEALTH=PASS
LIVE_SCHEDULED_SWEEP=PASS_EMPTY
LIVE_WEBHOOK_PATH_EXERCISED=NO
```

## 9. Linkage, payload, replay, and economic invariants

The deployed source semantics retain all four internal linkage classifications:

- `derived_from_jobs_idempotency_key`
- `binding_recorded`
- `conflict`
- `not_found`

The canonical derivation remains:

```text
jobs.idempotency_key = payment_attempts.payment_identifier
+ jobs.service_id = payment_attempts.service_id
+ jobs.input_hash = payment_attempts.request_input_hash
```

The unique `jobs.idempotency_key` constraint preserves one-to-one cardinality. A
derived/binding disagreement emits `jobId=null` with internal classification
`conflict`; a guarded mismatch does not select another job.

`job_id` was already part of `manual_intervention_required`; the fix changes its
read-side value, not the payload shape. `jobLinkage` remains internal.
`reconciliation_attempts` remains unchanged because there is no authoritative
persisted count for the in-memory reconciliation executions on unresolved
`settlement_pending` rows.

```text
JOB_LINKAGE_CARDINALITY=ONE_TO_ONE
JOB_LINKAGE_AMBIGUITY=NO
AMBIGUOUS_JOB_LINKAGE_FAILS_CONSERVATIVELY=YES
ALERT_PAYLOAD_SHAPE_CHANGED=NO
JOB_LINKAGE_CLASSIFICATION_PUBLICLY_EXPOSED=NO
RECONCILIATION_ATTEMPTS_FIX=BLOCKED_BY_SEMANTIC_AMBIGUITY

PAYMENT_ATTEMPT_JOB_ID_WRITE_CHANGED=NO
BINDING_DIGEST_INPUTS_CHANGED=NO
REPLAY_SEMANTICS_CHANGED=NO
ECONOMIC_WRITE_PATH_CHANGED=NO
SETTLEMENT_WRITE_PATH_CHANGED=NO
RECONCILIATION_WRITE_PATH_CHANGED=NO
HASHED_EVIDENCE_CHANGED=NO
PUBLIC_CONTRACT_CHANGED=NO
```

The post-deployment checks made no payment, settlement, reconciliation,
evidence, replay, or public-contract mutation.

## 10. Rollback gate

Read-only `wrangler versions view` confirmed rollback version
`8fe32c69-d906-4369-9c0a-49b2cc406e8e` remains available and retains the D1 and
webhook-secret-name bindings. No material regression was observed, so the
rollback command was not executed.

```text
ALERT_WORKER_ROLLBACK_EXECUTED=NO
```

## 11. Cloud mutation accounting

```text
ALERT_WORKER_UPLOADS=1
ALERT_WORKER_DEPLOYMENT_MUTATIONS=1

PUBLIC_WORKER_UPLOADS=0
PUBLIC_WORKER_DEPLOYMENT_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENT_MUTATIONS=0

PUBLIC_TRAFFIC_MUTATIONS=0
CLOUD_SECRET_MUTATIONS=0
D1_WRITE_MUTATIONS_FOR_TESTING=0
REAL_PAYMENT_ATTEMPTS=0
```

The only mutation in this checkpoint was one `siteborne-settlement-alert`
upload/deployment. Read-only state checks, log tailing, secret-name listing, and
the aggregate D1 query performed no mutations.
`D1_WRITE_MUTATIONS_FOR_TESTING=0` refers to production/cloud D1; the aggregate
query metadata independently reported `rows_written=0` and `changed_db=false`.

## 12. Final result

```text
SETTLEMENT_ALERT_WORKER_DEPLOY_01=PASS_WITH_NOT_EXERCISED_LIVE_PATH

MINIMAL_REMEDIATION_SOURCE_SHA=4472f3fcbedae0d88051c77927170a11a34252ff
PREVIOUS_ALERT_WORKER_VERSION=8fe32c69-d906-4369-9c0a-49b2cc406e8e
DEPLOYED_ALERT_WORKER_VERSION=465daf70-b3b7-4265-9d69-39cc02d890fe
DEPLOYMENT_SOURCE_ATTRIBUTION=MESSAGE_ONLY

ALERT_DB_BINDING_PRESERVED=YES
ALERT_WEBHOOK_SECRET_BINDING_PRESERVED=YES
ALERT_RUNTIME_HEALTH=PASS
PRODUCTION_ALERT_JOB_ID_PROJECTION=NOT_EXERCISED_NO_SAFE_LIVE_CASE
AMBIGUOUS_JOB_LINKAGE_FAILS_CONSERVATIVELY=YES

PUBLIC_WORKER_VERSION=3b35f9e7-6fb8-47e4-acff-c5736eff6da6
PUBLIC_WORKER_UNCHANGED=YES
CONTINUATION_HOST_VERSION=9b1e9b10-beed-4ff3-914c-2221aada9b45
CONTINUATION_HOST_UNCHANGED=YES

ALERT_WORKER_ROLLBACK_EXECUTED=NO
NEXT_RECOMMENDED_CHECKPOINT=REPLAY-CALLER-BINDING-SHADOW-AUDIT-01
```
