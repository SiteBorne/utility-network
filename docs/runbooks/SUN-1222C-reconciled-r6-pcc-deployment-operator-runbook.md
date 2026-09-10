# SUN-1222C Reconciled R6 → PCC Deployment — Operator Runbook

> ## ⛔ NOT AUTHORIZED FOR EXECUTION
> This runbook is blocked at the planning stage. See
> `docs/reports/SUN-1222C-reconciled-r6-pcc-deployment-plan.md` §12 (the HARD
> gate): deploying the paid-runtime PCC fix while the live public API baseline
> remains `db7054c9` (pre-PCC code) creates a proven `result: undefined`
> regression for already-paid MCP callers, and no same-object shape can
> satisfy both the old and new consumer because `contracts/releases/2.0.0`
> requires `additionalProperties: false` at the PCC document's own top level.
> **A separate, explicit cutover-authorization checkpoint is required before
> any command in this file may run.** Do not execute anything below until
> that checkpoint reaches PASS and this banner is removed.

All commands are illustrative/future and use the same frozen 10-var set,
mechanism, and metadata established in
`docs/reports/SUN-1222C-reconciled-r6-pcc-deployment-plan.md` §7-§9.

## Stage 0 — new public-API candidate (0% traffic, safe to run any time)

```bash
wrangler versions upload \
  --name siteborne-utility-edge \
  --tag sun1222c-pcc-r7-candidate \
  --message "SUN-1222C-PCC-R7: HEAD b277a91 (MCP wiring + PCC governed wire-result + mTLS truthfulness gate), same source lineage as cad721c, 10 R6 activation vars reapplied, still 0% traffic, production unchanged" \
  --var PAID_ROUTES_ENABLED:true \
  --var PRODUCTION_ENABLED:true \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
  --var PAYMENT_ENVIRONMENT:production \
  --var SELLER_WALLET_ADDRESS:<exact live value from §4.1 versions view — do not retype, copy> \
  --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true \
  --var COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true
```
STOP_IF: any output shows a binding/secret table different from the current
`db7054c9`/`d3472f58` table (§4.1), or prompts to create a secret. Rollback:
none needed — this is an upload, not a deploy; it never touches traffic.
Verify immediately after with `wrangler deployments status --name
siteborne-utility-edge` and confirm the new version shows 0%.

## Stage 1 — paid-runtime PCC deploy

**⛔ Blocked. See banner above.** Do not run until the cutover-authorization
checkpoint (§12/§13 of the plan doc) reaches PASS. When it does, the exact
command is:

```bash
wrangler deploy --config wrangler.paid-continuation-runtime.toml
```
Pre-version capture, rollback command, and post-deploy readback are as
specified in the prior `SUN-1222C-manual-pcc-two-worker-deployment` runbook
§18-19, unchanged.

## Everything else

No traffic promotion, no rollback execution, no var/secret mutation, and no
payment step is authorized by this document. This file exists only to hold
the exact future command text so the operator never has to improvise syntax.
