# SUN-1222C PCC Coordinated Cutover — Operator Plan

> ## ⛔ NOT AUTHORIZED FOR EXECUTION
> **2026-09-10 R6 GOVERNANCE HOLD:** Do not execute this plan with candidate
> `f7bf204d-5041-45c0-bb8c-4c3f776d7c9e`. The feature-authorization review
> in `docs/reports/SUN-1222C-r6-feature-cutover-authorization.md` authorized
> only `verify_agent_output.v2` and `web_context_verified.v2`; it blocked
> `company_evidence_graph.v2`, `document_evidence_json.v2`, and
> `document-artifact-upload`. Because all five flags are true in the immutable
> candidate, a new feature-scoped candidate is required before any canary or
> cutover operation. The command examples below are historical design material,
> not current operator commands.
>
> No stage below may run until the specific authorization it requires
> (see `docs/reports/SUN-1222C-pcc-coordinated-cutover-authorization-design.md`
> §15-16) has been explicitly given. This plan spans three independent
> authorization boundaries — A (candidate upload), B (traffic cutover), C
> (paid-runtime deploy) — do not treat approval of one as approval of another.
>
> **`POST_PAID_DEPLOY_PUBLIC_ONLY_ROLLBACK_SAFE=NO`** — once Stage 3 (paid-
> runtime deploy) executes, rolling public traffic back to `db7054c9` alone
> recreates the proven `result: undefined` regression. If Stage 3 must be
> undone, roll back the **paid runtime first** (to `d62011b9`), confirm
> NEW_PUBLIC + OLD_PAID is healthy, only then consider any public-side change.

## Pre-flight (read-only, any time)

```bash
set -euo pipefail
cd "/Users/meta4ickal/SITEBORNE Utility Network"
git rev-parse HEAD
git status --short
npx wrangler deployments status --name siteborne-utility-edge
npx wrangler deployments status --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml
```
Expected: HEAD reachable from main, tree clean, public API 100% on
`db7054c9`, paid runtime 100% on `d62011b9`. If either differs from the plan
document's recorded topology, STOP — re-run the reconciliation checkpoint
before proceeding.

---

## STAGE A — new candidate upload (0% traffic) — requires Authorization A

```
STEP=A.1
COMMAND=npx wrangler versions upload --name siteborne-utility-edge \
  --tag sun1222c-pcc-cutover-candidate \
  --message "SUN-1222C PCC cutover candidate: HEAD 9a8e6f9f... + R6 frozen 10-var set" \
  --var PAID_ROUTES_ENABLED:true \
  --var PRODUCTION_ENABLED:true \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
  --var PAYMENT_ENVIRONMENT:production \
  --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED:true \
  --var DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED:true \
  --var COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED:true \
  --var SELLER_WALLET_ADDRESS:<exact live value from d3472f58 readback>
EXPECTED_OUTPUT=New Version ID printed; 0% traffic (no deployment created yet)
STOP_IF=command errors, or any --var value does not match the live-verified R6 set exactly
ROLLBACK_COMMAND=none needed — an unused 0%-traffic version has no live effect; simply do not deploy it
```

```
STEP=A.2 (read-only)
COMMAND=npx wrangler versions view <NEW_VERSION_ID> --name siteborne-utility-edge
EXPECTED_OUTPUT=all 11 vars present, values match A.1 exactly
HOW_TO_INTERPRET=this is the frozen artifact that stages B/C will reference by ID — record <NEW_VERSION_ID> literally, do not re-derive it later
```

## STAGE B — qualify at 0%, then staged public cutover — requires Authorization B

```
STEP=B.1 (read-only)
COMMAND=curl -s https://<preview-url-for-NEW_VERSION_ID>/.well-known/agent-card.json | jq .
EXPECTED_OUTPUT=valid Agent Card JSON, securitySchemes.mtls ABSENT
HOW_TO_INTERPRET=if mtls scheme present, STOP — truthfulness gate regression, do not proceed to any traffic stage
```
Repeat equivalent read-only probes for: `/health`, `/ready`, `/.well-known/jwks.json`,
JWS verify, A2A `SendMessage` (expect `TASK_STATE_INPUT_REQUIRED`), MCP
discovery, and one unpaid POST per paid route (expect `402 PaymentRequired`).
All must pass before B.2.

```
STEP=B.2
COMMAND=npx wrangler versions deploy <NEW_VERSION_ID>@5 db7054c9-76ee-4830-aabe-8a4542261b6a@95 --name siteborne-utility-edge --message "SUN-1222C stage B.2: 5% canary"
EXPECTED_OUTPUT=traffic split confirmed 5/95
STOP_IF=command errors, or post-deploy `deployments status` doesn't show 5/95
ROLLBACK_COMMAND=npx wrangler versions deploy db7054c9-76ee-4830-aabe-8a4542261b6a@100 --name siteborne-utility-edge --message "SUN-1222C stage B rollback: revert to db7054c9"
```
Observe for the gate window in the plan doc §5 (≥30 min, ≥500 requests,
5xx-rate check, live A2A/MCP/x402-unpaid probes). On pass, repeat B.2's
pattern for 25%, then 50%, then:

```
STEP=B.3
COMMAND=npx wrangler versions deploy <NEW_VERSION_ID>@100 --name siteborne-utility-edge --message "SUN-1222C stage B.3: 100% cutover, db7054c9 -> 0%"
EXPECTED_OUTPUT=100/0 confirmed; db7054c9 and d3472f58 both at 0%
STOP_IF=any post-cutover health/Agent Card/A2A/MCP/x402 check fails
ROLLBACK_COMMAND=npx wrangler versions deploy db7054c9-76ee-4830-aabe-8a4542261b6a@100 --name siteborne-utility-edge --message "SUN-1222C stage B.3 rollback"
```
This is the point at which `verify_agent_output.v2`, `web_context_verified.v2`,
`company_evidence_graph.v2`, `document_evidence_json.v2`, and the
document-artifact-upload endpoint become live production surfaces for the
first time — confirm Authorization item §16.3 was given before B.3, not
just Authorization A/B generally.

## STAGE C — quiesce, drain, deploy paid runtime, restore — requires Authorization C

```
STEP=C.1
COMMAND=npx wrangler versions upload --name siteborne-utility-edge \
  --tag sun1222c-pcc-cutover-quiesced \
  --message "SUN-1222C stage C.1: temporary paid-admission quiesce" \
  --var PAID_ROUTES_ENABLED:false \
  [... all other --var flags identical to STAGE A.1 ...]
EXPECTED_OUTPUT=New Version ID printed (<QUIESCE_VERSION_ID>), 0% traffic
STOP_IF=any --var besides PAID_ROUTES_ENABLED differs from the live 100% version
ROLLBACK_COMMAND=none — unused version, no live effect until deployed
```
```
STEP=C.2
COMMAND=npx wrangler versions deploy <QUIESCE_VERSION_ID>@100 --name siteborne-utility-edge --message "SUN-1222C stage C.2: close paid-route admission for in-flight drain"
EXPECTED_OUTPUT=100% traffic on quiesce version; a live unpaid/paid POST to any of the 5 paid routes now returns 404 (c.notFound()); health/Agent Card/A2A/MCP/discovery unaffected
STOP_IF=anything other than the 5 paid routes changes behavior
ROLLBACK_COMMAND=npx wrangler versions deploy <NEW_VERSION_ID>@100 --name siteborne-utility-edge --message "SUN-1222C stage C.2 rollback: restore paid admission, abort quiesce"
```
```
STEP=C.3 (read-only, wait 60s after C.2 before running)
COMMAND=wrangler d1 execute <DB_BINDING_NAME> --remote --command "SELECT lifecycle_stage, COUNT(*) AS n FROM payment_attempts WHERE lifecycle_stage IN ('acquired','verified','executed','settlement_pending','settled_external','link_verified','settlement_failed') GROUP BY lifecycle_stage;"
EXPECTED_OUTPUT=empty result set (all counts zero)
HOW_TO_INTERPRET=re-run this query every few minutes until it returns empty; do not proceed to C.4 while any nonterminal row exists. If stuck >30 min, treat as F7 in the plan's failure matrix — investigate the specific row, do not force-deploy.
```
```
STEP=C.4
COMMAND=npx wrangler deployments status --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml
EXPECTED_OUTPUT=confirms current 100% version = d62011b9-6219-47e1-8cf9-5006776cfb50 (capture this literally as PAID_RUNTIME_PRE_VERSION before C.5)
HOW_TO_INTERPRET=this is the exact rollback target if C.5/C.6 fails
```
```
STEP=C.5
COMMAND=cd apps/paid-runtime && npx wrangler deploy --config wrangler.paid-continuation-runtime.toml
EXPECTED_OUTPUT=new 100% version deployed (paid runtime has no traffic-split model — plain deploy is all-or-nothing); record the new Version ID
STOP_IF=command errors, or post-deploy `deployments status` doesn't show the new version at 100%
ROLLBACK_COMMAND=npx wrangler rollback <PAID_RUNTIME_PRE_VERSION> --name siteborne-paid-continuation-runtime --config wrangler.paid-continuation-runtime.toml --message "SUN-1222C stage C.5 rollback: restore d62011b9"
```
```
STEP=C.6 (read-only)
COMMAND=(worker-to-worker binding health check + one structural PCC-shape probe against the new paid runtime, via a diagnostic path that does not create a real payment)
EXPECTED_OUTPUT=binding reachable, PCC document shape matches contracts/releases/2.0.0
STOP_IF=binding unreachable, or shape does not validate — roll back per C.5's ROLLBACK_COMMAND immediately, then keep paid admission closed (do not run C.7) until resolved
```
```
STEP=C.7
COMMAND=npx wrangler versions deploy <NEW_VERSION_ID>@100 --name siteborne-utility-edge --message "SUN-1222C stage C.7: restore paid-route admission, PAID_ROUTES_ENABLED=true, Pair D live"
EXPECTED_OUTPUT=100% traffic restored to the original (non-quiesced) candidate; paid routes respond normally again
STOP_IF=any post-restore anomaly in PCC shape or settlement topology — this is failure case F10 in the plan document: roll back paid runtime to d62011b9 immediately and escalate, do not attempt a scripted fix
```

## Post-cutover confirmation (read-only)

```
STEP=D.1
COMMAND=re-run the full 0%-qualification probe set (B.1) against the now-100% NEW_PUBLIC, plus the settle-sole-ownership invariant and an mTLS-absence check
EXPECTED_OUTPUT=all pass; PUBLIC_API_SETTLE_CALLSITES=0, MCP_ADAPTER_SETTLE_CALLSITES=0, DEDICATED_WORKFLOW_SETTLE_CALLSITES=1, TOTAL=1; securitySchemes.mtls absent
HOW_TO_INTERPRET=this is the final structural qualification of Pair D (NEW_PUBLIC + NEW_PAID) in live production
```

STOP after D.1. Do not provision mTLS. Do not begin legal-identity work. Do
not intentionally generate a real payment to "test" any of the above.
