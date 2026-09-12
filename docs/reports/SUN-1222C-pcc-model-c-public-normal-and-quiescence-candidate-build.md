# SUN-1222C PCC — Model-C Public Normal and Quiescence Candidate Build

**Checkpoint:** `SUN-1222C-PCC-MODEL-C-PUBLIC-NORMAL-AND-QUIESCENCE-CANDIDATE-BUILD`
**Authorized action:** exactly two `wrangler versions upload` operations against
`siteborne-utility-edge`, both unassigned to any deployment, no traffic change,
no D1 write, no trigger activation.
**Result:** `PASS`. Both immutable versions uploaded exactly once each, read
back, and confirmed unassigned.

## Source authority and evidence binding

```text
MODEL_C_SOURCE_AUTHORITY=896d75a343d5a4ac2690cf60e1259828482a8a63
LATEST_EVIDENCE_COMMIT=d1a3c8c115f523083197fb15e499958953817e27 (repo HEAD at execution time)
BRANCH=main
WORKING_TREE=CLEAN
```

`git diff --stat 896d75a..HEAD` (excluding no paths — full diff) touches only
five files, all under `docs/reports/` or `docs/runbooks/`, insertions only:

```text
docs/reports/SUN-1222C-mcp-tool-definition-quality-remediation.md          | 209 ++
docs/reports/SUN-1222C-pcc-model-c-legacy-backfill-remediation.md          | 329 ++
docs/reports/...-production-migration-and-legacy-classification-....md    | 390 ++
docs/reports/SUN-1222C-tdqs-v1.2-credentialed-score.md                    | 453 ++
docs/runbooks/SUN-1222C-pcc-coordinated-cutover-operator-plan.md          | 108 ++
5 files changed, 1489 insertions(+)
```

```text
PRODUCTION_RUNTIME_DIFF_FROM_896D75A=EMPTY
RUNTIME_DEPENDENCY_DIFF_FROM_896D75A=EMPTY
PUBLIC_WORKER_CONFIG_DIFF_FROM_896D75A=EMPTY
```

No `apps/`, `packages/`, `migrations/`, `wrangler.toml`, or lockfile delta
exists between the candidate source authority and the commit this checkpoint
built from. The upload used the current working tree (`HEAD`), which is
byte-identical to `896d75a` for every bundled/runtime path.

## TDQS binding reconfirmation

Rebuilt the MCP tools export from the current source tree
(`packages/protocol-mcp/scripts/export-tdqs-tools.mjs`) and recomputed its
SHA-256 independently:

```text
TDQS_EXPORT_HASH_MATCH=YES
computed_sha256=587e3c992a18eeb4d99fd726acb3dc8ec378b4f415eedcc8dedb86037d821316
expected_sha256=587e3c992a18eeb4d99fd726acb3dc8ec378b4f415eedcc8dedb86037d821316
MCP_TOOL_COUNT=6
```

Tool names (exact, unchanged):

```text
siteborne_company_evidence_graph
siteborne_web_context_verified
siteborne_document_evidence_json
siteborne_verify_agent_output
siteborne_get_quote
siteborne_get_service_health
```

```text
TDQS_REPORT_UID=rl1ev4t9pz
TDQS_REPORT_URL=https://tdqs.dev/reports/rl1ev4t9pz
TDQS_OVERALL_SCORE=4.4
TDQS_OVERALL_TIER=A
TDQS_REPORT_STILL_BOUND_TO_CANDIDATE_SOURCE=YES
```

No rescore was required or performed: source metadata is unchanged from the
already-scored authority.

## Model-C production database precondition (read-only)

Per the prior `SUN-1222C-pcc-model-c-production-migration-and-legacy-classification-reauthorization`
checkpoint, carried forward unchanged and reconfirmed read-only:

```text
MIGRATION_0010_APPLIED=YES
PRODUCTION_RECONCILIATION_ROWS=17
RAW_NONTERMINAL_LIFECYCLE_COUNT=17
GLOBAL_ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0
GLOBAL_OWNER_INTENT_PENDING_COUNT=0
GLOBAL_ACTIVE_WORKFLOW_OWNED_ATTEMPTS=0
GLOBAL_UNRECONCILED_ACTIONABLE_ATTEMPTS=0
GLOBAL_UNRESOLVED_SETTLEMENT_FINALIZATION_COUNT=0
```

No D1 read or write was performed by this checkpoint beyond what was already
recorded by that prior authority; this section restates it for completeness.

## Live topology readback (independently reconfirmed via Cloudflare)

Read directly from `wrangler deployments list` / `wrangler versions view`
against account `29a264a25ccfd13882defe49ed3e17b1` (`hello@siteborne.com`),
immediately before and immediately after the two uploads:

```text
PUBLIC (siteborne-utility-edge):
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @ 100%
  d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @ 0%

PAID RUNTIME (siteborne-paid-continuation-runtime):
  d62011b9-6219-47e1-8cf9-5006776cfb50 @ 100%

SETTLEMENT ALERT (siteborne-settlement-alert):
  8fe32c69-d906-4369-9c0a-49b2cc406e8e @ 100%

PUBLIC_TOPOLOGY_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
SETTLEMENT_ALERT_DRIFT=NO
```

Cron schedules on `siteborne-utility-edge`, read directly via
`GET /accounts/{account}/workers/scripts/siteborne-utility-edge/schedules`,
before and after both uploads:

```text
CURRENT_PUBLIC_SCHEDULED_TRIGGERS=[] (empty)
EXPECTED_POST_UPLOAD_SCHEDULED_TRIGGERS=[] (empty)
```

Identical before and after. `wrangler versions upload`'s own completion output
states explicitly: *"Changes to triggers (routes, custom domains, cron
schedules, etc) must be applied with the command `wrangler triggers deploy`"*
— confirming trigger sync is a separate, unauthorized, unexecuted operation.

```text
VERSION_UPLOAD_MUTATES_SCHEDULED_TRIGGERS=NO
SCHEDULED_TRIGGER_MUTATIONS_PLANNED=0
SCHEDULED_TRIGGER_MUTATIONS=0
```

## Immutable b6 / d28 config readback

Read directly (`wrangler versions view <id> --name siteborne-utility-edge`),
not reconstructed from prior reports:

```text
B6_CONFIG_READBACK_COMPLETE=YES
D28_CONFIG_READBACK_COMPLETE=YES
Compatibility Date: 2026-08-05
Compatibility Flags: nodejs_compat
Bindings: PAID_CONTINUATION_WORKFLOW (Workflow), CATALOG (KV), EVENTS (Queue),
  JOBS (Queue), DB (D1, efe23c42-cbcc-47c2-9b28-922a541bdcdd),
  ARTIFACTS (R2), BROWSER, AI
Secrets (names only, 13): AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID,
  CDP_API_KEY_SECRET, MODAL_DOCWORKER_ENDPOINT_URL,
  MODAL_DOCWORKER_PROXY_KEY, MODAL_DOCWORKER_PROXY_SECRET,
  MODAL_WEBCTX_ENDPOINT_URL, MODAL_WEBCTX_PROXY_KEY,
  MODAL_WEBCTX_PROXY_SECRET, NVM_API_KEY, PAID_RECEIPT_SIGNING_KEY_ID,
  PAID_RECEIPT_SIGNING_PRIVATE_KEY, PAYMENT_CONTINUATION_ENCRYPTION_KEY
Ordinary vars (16): AGENT_CARD_SIGNING_KEY_ID, COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED,
  DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED, DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED,
  ENVIRONMENT, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP, LOG_LEVEL, NVM_ENVIRONMENT,
  PAID_ROUTES_ENABLED, PAYMENT_ENVIRONMENT, PCC_VERSION,
  PRODUCTION_CDP_CREDENTIALS_APPROVED, PRODUCTION_ENABLED, SELLER_WALLET_ADDRESS,
  VERIFY_V2_CDP_ROUTE_ENABLED, WEB_CONTEXT_V2_CDP_ROUTE_ENABLED
mTLS: absent on both (no mTLS certificate binding)
B6_VS_D28_ONLY_ORDINARY_VAR_DELTA=PAID_ROUTES_ENABLED:true→false (reconfirmed)
```

## New candidate configuration definitions

Built from the b6 readback above, changing only the source (pre-Model-C →
`896d75a343d5a4ac2690cf60e1259828482a8a63`). The committed `wrangler.toml`
`[vars]` block intentionally omits the ten activation/feature switches
(fail-closed by design — see the block's own SUN-1205 checkpoint K comment),
so all ten were supplied explicitly via `--var` on the upload command,
reproducing b6's exact readback rather than assuming defaults:

```text
PAID_ROUTES_ENABLED=true            (Normal) / false (Quiescence)
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
PAYMENT_ENVIRONMENT=production
VERIFY_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=false
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=false
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=false
```

Plus the six vars already declared in `wrangler.toml` (`PCC_VERSION`,
`ENVIRONMENT`, `LOG_LEVEL`, `AGENT_CARD_SIGNING_KEY_ID`, `NVM_ENVIRONMENT`,
`SELLER_WALLET_ADDRESS`) = 16 ordinary vars total, matching b6 exactly.
`MTLS_PRODUCTION_ACTIVE` remains absent/effective false on both.

```text
MODEL_C_NORMAL_VS_QUIESCENCE_ONLY_VAR_DELTA=PAID_ROUTES_ENABLED:true→false
```

## Model-C runtime/schema requirement

Traced `apps/edge-api/src/control-plane/continuation/owner-recovery.ts` and its
D1 access: the candidate source's owner-intent recovery scanner and
reconciliation paths read/write the migration-0010 tables
(`payment_attempt_reconciliations`, `payment_workflow_owner_intents`,
`payment_service_link_evidence`).

```text
MODEL_C_PUBLIC_WITH_SCHEMA_0010=SAFE
MODEL_C_PUBLIC_WITHOUT_SCHEMA_0010=FAILS_CLOSED
MODEL_C_PUBLIC_SCHEMA_PRECONDITION=PASS
```

Schema 0010 is live in production (confirmed above); no additional unapplied
migration is required by this candidate source.

## Owner-recovery source confirmation

The candidate source implements: transactional verified + owner-intent
persistence, deterministic Workflow ownership (dispatch/join-repair keyed by
payment identifier), same-payment owner repair without reverification, a
scheduled owner-intent recovery scanner (`index.ts`'s `scheduled()` export),
provider-failure reconciliation, and ownership-aware drain-gate support.

```text
MODEL_C_OWNER_RECOVERY_IMPLEMENTED_IN_CANDIDATE=YES
MODEL_C_OWNER_RECOVERY_SCHEDULE_ACTIVE_NOW=NO
```

The scanner's cron is not wired to any live Cloudflare schedule — no trigger
activation occurred (see the topology/schedules section above and the readback
below, both taken after the uploads).

## Paid-runtime compatibility

Traced the Workflow binding contract the candidate public source uses against
the still-live old paid runtime (`d62011b9`, `siteborne-paid-continuation-runtime`):
binding name (`PAID_CONTINUATION_WORKFLOW`), class name
(`PaidContinuationWorkflow`), and `script_name` target are unchanged from b6;
the deterministic Workflow-ID contract and payment-identifier contract used by
the candidate's owner-recovery dispatch/join path match what the currently
deployed paid runtime already accepts; no PCC/payment wire field is
introduced that the old paid runtime does not already tolerate; settlement
remains exclusively owned by the dedicated Workflow in the paid runtime.

```text
MODEL_C_NEW_PUBLIC_PLUS_OLD_PAID_RUNTIME=SAFE
```

## Public wire / feature scope / price

No public payment-requirement wire, MCP protocol version, MCP tool names/count/
schema semantics, A2A wire, PCC wire, price, seller, or service-activation
change relative to b6. Only the runtime recovery/lifecycle implementation and
already-qualified MCP descriptive metadata differ.

```text
MODEL_C_FEATURE_SCOPE_MATCHES_B6=YES
Enabled: verify_agent_output.v2, web_context_verified.v2
Disabled: company_evidence_graph.v2, document_evidence_json.v2, document-artifact-upload
Network: eip155:8453
Asset: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Seller/payTo: 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
PRICE_CONFIG_DRIFT=NO
```

## Settlement and provider ownership (independently grepped)

```text
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1   (paid-continuation-workflow.ts:714, its own
                                          doc comment: "The SOLE production
                                          evidenceProvider.settle() call site")
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
OWNER_RECOVERY_SETTLE_CALLSITES=0       (grepped owner-recovery.ts: no settle/
                                          facilitator/provider callsite)
PUBLIC_OWNER_RECOVERY_PROVIDER_CALLSITES=0
```

## Dry-run and upload execution

Pinned `wrangler 4.119.0` (confirmed via `npx wrangler --version`). Both
`--dry-run` invocations passed with correct bindings, 16 ordinary vars (values
hidden as expected for `--var`-supplied values), and no trigger mutation
warnings, immediately before the real uploads. Live topology was reconfirmed
unchanged directly beforehand.

### Normal

```text
MODEL_C_NORMAL_UPLOAD_DRY_RUN=PASS
tag=sun1222c-model-c-feature-scoped-normal-candidate
MODEL_C_NORMAL_VERSION_ID=0fd6d9bd-8d29-4b86-a0a6-22634ffeda04
MODEL_C_NORMAL_CREATED_AT=2026-09-12T17:22:50.118Z
MODEL_C_NORMAL_UPLOAD_EXIT_CODE=0
```

### Quiescence

```text
MODEL_C_QUIESCENCE_UPLOAD_DRY_RUN=PASS
tag=sun1222c-model-c-feature-scoped-quiescence-candidate
MODEL_C_QUIESCENCE_VERSION_ID=afe08ea7-4a64-49a2-a16c-e44fc4a50753
MODEL_C_QUIESCENCE_CREATED_AT=2026-09-12T17:23:16.003Z
MODEL_C_QUIESCENCE_UPLOAD_EXIT_CODE=0
```

## Immutable post-upload readback

Both versions were read back directly from Cloudflare with
`wrangler versions view`:

```text
MODEL_C_NORMAL_IMMUTABLE_READBACK=PASS
MODEL_C_QUIESCENCE_IMMUTABLE_READBACK=PASS
```

Both carry: Compatibility Date `2026-08-05`, flags `nodejs_compat`; identical
8 bindings (including `DB` resolving to the same D1 id
`efe23c42-cbcc-47c2-9b28-922a541bdcdd`); identical 13 secret names; identical
16 ordinary vars except the one intentional delta. Both additionally expose a
`scheduled` handler that neither b6 nor d28 has — expected, since it is the
candidate source's owner-recovery scanner code, present but unwired to any
live cron (confirmed above).

```text
NEW_NORMAL_VS_NEW_QUIESCENCE_SOURCE_PARITY=YES
NEW_NORMAL_VS_NEW_QUIESCENCE_BINDING_PARITY=YES
NEW_NORMAL_VS_NEW_QUIESCENCE_SECRET_PARITY=YES
NEW_NORMAL_VS_NEW_QUIESCENCE_COMPATIBILITY_PARITY=YES
NEW_NORMAL_VS_NEW_QUIESCENCE_FEATURE_SCOPE_PARITY=YES
NEW_NORMAL_VS_NEW_QUIESCENCE_ONLY_VAR_DELTA=PAID_ROUTES_ENABLED:true→false
```

Cloudflare's dashboard-facing version view does not expose a separate
content-addressed script etag distinct from the version ID itself in this
account/API surface; script identity is asserted here via the byte-identical
bundle size (`Total Upload: 4029.52 KiB / gzip: 659.74 KiB`, identical for both
uploads) and the identical source commit used for both.

## Deployment membership unaffected

Read directly after both uploads:

```text
PUBLIC: b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @ 100%; d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @ 0% (unchanged)
MODEL_C_NORMAL_CURRENT_DEPLOYMENT_MEMBER=NO
MODEL_C_QUIESCENCE_CURRENT_DEPLOYMENT_MEMBER=NO
MODEL_C_NORMAL_NORMAL_TRAFFIC=0%/UNASSIGNED
MODEL_C_QUIESCENCE_NORMAL_TRAFFIC=0%/UNASSIGNED
PAID RUNTIME: d62011b9-6219-47e1-8cf9-5006776cfb50 @ 100% (unchanged)
SETTLEMENT ALERT: 8fe32c69-d906-4369-9c0a-49b2cc406e8e @ 100% (unchanged)
```

## Runtime qualification status

Because both new versions are unassigned and no Preview URL was used:

```text
MODEL_C_NORMAL_EXACT_RUNTIME_QUALIFICATION=DEFERRED_UNTIL_DEPLOYMENT_MEMBERSHIP
MODEL_C_QUIESCENCE_EXACT_RUNTIME_QUALIFICATION=DEFERRED_UNTIL_DEPLOYMENT_MEMBERSHIP
LOCAL_SOURCE_CONFIG_AND_TEST_QUALIFICATION=PASS
```

```text
MODEL_C_PUBLIC_RUNTIME_LIVE=NO
MODEL_C_PAID_RUNTIME_LIVE=NO
CURRENT_LIVE_PUBLIC_CAN_STILL_CREATE_OWNERLESS_VERIFIED=YES
CURRENT_LIVE_PAID_CAN_STILL_CREATE_OWNERLESS_SETTLED_EXTERNAL=YES
```

This remains true until a later, separately authorized deployment-membership
checkpoint.

## Mutation and economic accounting

```text
PUBLIC_VERSION_UPLOADS=2
MODEL_C_NORMAL_VERSION_UPLOADS=1
MODEL_C_QUIESCENCE_VERSION_UPLOADS=1
PAID_VERSION_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
DEPLOYMENT_MEMBERSHIP_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
EXISTING_VERSION_VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
DNS_MUTATIONS=0
CUSTOM_DOMAIN_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
SCHEDULED_TRIGGER_MUTATIONS=0
MTLS_MUTATIONS=0
PRODUCTION_D1_WRITES=0

REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
PAYMENT_VERIFY_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
PRODUCTION_WORKFLOW_CREATIONS=0
NEW_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

## Next required checkpoint (design only, not executed)

`SUN-1222C-PCC-MODEL-C-PUBLIC-NORMAL-CUTOVER-AND-QUIESCENCE-QUALIFICATION`.
Per the runbook, that future checkpoint would first replace the current d28
0% deployment member with the new Model-C normal version at 0% (retaining
`b6b7477f@100%`), exact-version qualify it, and only then promote it to 100%.
A later stage would place the new Model-C quiescence version at 0% for its
own exact qualification before quiescing. No membership, traffic, cron, or
paid-runtime command was executed here; both are prepared but not run.

## Final decision packet

```text
SUN1222C_PCC_MODEL_C_PUBLIC_NORMAL_AND_QUIESCENCE_CANDIDATE_BUILD=PASS
MODEL_C_SOURCE_AUTHORITY=896d75a343d5a4ac2690cf60e1259828482a8a63
TDQS_REPORT_UID=rl1ev4t9pz
TDQS_OVERALL_SCORE=4.4
TDQS_EXPORT_HASH_MATCH=YES
MODEL_C_SCHEMA_LIVE=YES
LEGACY_RECONCILIATION_ROWS=17
RAW_NONTERMINAL_LIFECYCLE_COUNT=17
GLOBAL_ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0
MODEL_C_NEW_PUBLIC_PLUS_OLD_PAID_RUNTIME_SAFE=YES
MODEL_C_NORMAL_VERSION_ID=0fd6d9bd-8d29-4b86-a0a6-22634ffeda04
MODEL_C_NORMAL_VERSION_NUMBER=(see wrangler.com dashboard; not exposed by CLI text output)
MODEL_C_NORMAL_TAG=sun1222c-model-c-feature-scoped-normal-candidate
MODEL_C_NORMAL_CREATED_AT=2026-09-12T17:22:50.118Z
MODEL_C_NORMAL_UPLOAD_EXIT_CODE=0
MODEL_C_NORMAL_IMMUTABLE_READBACK=PASS
MODEL_C_QUIESCENCE_VERSION_ID=afe08ea7-4a64-49a2-a16c-e44fc4a50753
MODEL_C_QUIESCENCE_TAG=sun1222c-model-c-feature-scoped-quiescence-candidate
MODEL_C_QUIESCENCE_CREATED_AT=2026-09-12T17:23:16.003Z
MODEL_C_QUIESCENCE_UPLOAD_EXIT_CODE=0
MODEL_C_QUIESCENCE_IMMUTABLE_READBACK=PASS
NEW_NORMAL_VS_NEW_QUIESCENCE_ONLY_VAR_DELTA=PAID_ROUTES_ENABLED:true→false
MODEL_C_NORMAL_CURRENT_DEPLOYMENT_MEMBER=NO
MODEL_C_QUIESCENCE_CURRENT_DEPLOYMENT_MEMBER=NO
MODEL_C_NORMAL_EXACT_RUNTIME_QUALIFICATION=DEFERRED_UNTIL_DEPLOYMENT_MEMBERSHIP
MODEL_C_QUIESCENCE_EXACT_RUNTIME_QUALIFICATION=DEFERRED_UNTIL_DEPLOYMENT_MEMBERSHIP
CURRENT_PUBLIC_NORMAL_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
CURRENT_PUBLIC_NORMAL_TRAFFIC=100%
CURRENT_PUBLIC_QUIESCENCE_MEMBER=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
CURRENT_PUBLIC_QUIESCENCE_MEMBER_TRAFFIC=0%
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
MODEL_C_PUBLIC_RUNTIME_LIVE=NO
MODEL_C_PAID_RUNTIME_LIVE=NO
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
OWNER_RECOVERY_SETTLE_CALLSITES=0
PUBLIC_OWNER_RECOVERY_PROVIDER_CALLSITES=0
SCHEDULED_TRIGGER_MUTATIONS=0
PUBLIC_VERSION_UPLOADS=2
PAID_VERSION_UPLOADS=0
DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_TEST_PAYMENTS=0
USEFUL_PROVIDER_EXECUTIONS=0
PRODUCTION_WORKFLOW_CREATIONS=0
NEW_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-MODEL-C-PUBLIC-NORMAL-CUTOVER-AND-QUIESCENCE-QUALIFICATION
```

Neither new version was added to a deployment. Public traffic was not
changed. The owner-recovery cron was not activated. The paid runtime was not
touched. No payment, provider, Workflow, or settlement effect occurred.
Company/document/artifact activation was not touched. mTLS was not
provisioned.
