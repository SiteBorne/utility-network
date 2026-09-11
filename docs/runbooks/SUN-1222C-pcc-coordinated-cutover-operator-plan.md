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
executed, is:

```bash
npx wrangler versions deploy \
  b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca@100% \
  d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1@0% \
  --name siteborne-utility-edge \
  --message "SUN-1222C post-atomic quiescence qualification membership: b6b7477f 100%; d28f30c5 0%; no normal quiescence traffic" \
  --yes
```

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

## Stage I — drain

After propagation, repeat the lifecycle query until the separately defined drain
predicate is satisfied. Do not force-deploy around stuck rows. Investigate and
stop if the drain exceeds its governed bound.

The 2026-09-11 prebuild snapshot was `verified=16`, `settled_external=1`,
total 17. This count does not block the public-only atomic cutover. After
quiescence reaches 100%, wait the deployment-tail safety interval and require
zero rows in every frozen nonterminal stage (`acquired`, `verified`, `executed`,
`settlement_pending`, `settled_external`, `link_verified`, `settlement_failed`)
before paid-runtime deployment.

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
QUIESCENCE_VERSION_DEPLOYED=NO
QUIESCENCE_EXACT_RUNTIME_QUALIFICATION=DEFERRED_UNTIL_CURRENT_DEPLOYMENT_MEMBERSHIP
QUIESCENCE_STILL_REQUIRED_BEFORE_PAID_RUNTIME_DEPLOY=YES
ATOMIC_PUBLIC_CUTOVER_EXECUTED=YES
ATOMIC_PUBLIC_CUTOVER_DEPLOYMENT_ID=037ae834-3b1e-4eae-b5c0-7befa09856c1
ATOMIC_PUBLIC_STABILIZATION=PASS
PUBLIC_NORMAL_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
PUBLIC_NORMAL_TRAFFIC=100%
PUBLIC_ROLLBACK_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_ROLLBACK_TRAFFIC=0%
NEXT_TRAFFIC_STAGE_AUTHORIZED=NO
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-QUIESCENCE-QUALIFY-PROMOTE-AND-DRAIN
```
