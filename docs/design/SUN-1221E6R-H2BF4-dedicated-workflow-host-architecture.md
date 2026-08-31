# SUN-1221E6R-H2BF4 — Dedicated Workflow-Host Architecture

## 1. Problem statement

H2BF3 proved, with real read-only Cloudflare API evidence (two Workflow
Versions, `63a19f97...` and `ae57d91e...`), that:

```
has_dag = false
graph = null
```

for **every** Workflow Version this project has ever created, regardless of
whether the underlying Worker source held the old throwing stub or H2BF1's
real `run()` orchestration. The defect is therefore not a source-code defect
— it is a **deployment-methodology** defect: this project's release pipeline
(`wrangler versions upload` → `wrangler versions deploy` → `wrangler triggers
deploy`) has never once produced a compiled Workflow DAG, because `triggers
deploy` only registers Workflow *metadata* (`workflow_id` ↔ `script_name` ↔
`class_name`), never a compiled graph.

Cloudflare's own documentation states unambiguously
(`https://developers.cloudflare.com/workflows/get-started/guide/`, step 6):

> Deploy your Workflow: `npx wrangler deploy`

and separately
(`https://developers.cloudflare.com/workers/versions-and-deployments/`):

> when you run `wrangler deploy`, Workers creates a new version and
> immediately deploys it to 100% of traffic in a single step.

Running `wrangler deploy` directly against SITEBORNE's public API Worker
(`siteborne-utility-edge`) is incompatible with this project's own governance
— `de70bf98...@100% / 855ee345...@0%` — a single-version, 100%-traffic
command cannot coexist with a 0%-traffic non-economic candidate.

## 2. H2BF3 evidence (reconciled)

- `H2BF3_ROOT_CAUSE_CONFIRMED=YES`
- Both historical Workflow Versions: `has_dag=false`, `graph=null`
  (`63a19f97-c6f4-4fe1-99d6-998bdc11d656`, `ae57d91e-4d84-4736-abe6-a456feebf203`)
- `CURRENT_WORKFLOW_DEPLOYMENT_PATH_INSUFFICIENT_FOR_DAG=PROVEN`
- Evidence: `docs/reports/SUN-1221E6R-H2BF3-workflow-version-id-graph-forensics.md`
  (commit `54d949834c5e6337b3ea56512ed2116af1e2416a`)

## 3. Cloudflare documentation (reconfirmed this checkpoint)

Read live, via browser navigation, this checkpoint (not from memory):

- `developers.cloudflare.com/workflows/get-started/guide/` — the official
  Workflows quick-start. Step 6 ("Deploy your Workflow") is the ONLY
  deployment command documented anywhere in that guide:
  `npx wrangler deploy`. The same page states: "You can also access
  bindings (such as KV, R2, or D1) via `this.env` within your Workflow" —
  `CF_WORKFLOW_HOST_ENV_SUPPORTED=YES`.
- `developers.cloudflare.com/workers/versions-and-deployments/` — exact
  quote: "when you run `wrangler deploy`, Workers creates a new version and
  immediately deploys it to 100% of traffic in a single step."
- `developers.cloudflare.com/workers/wrangler/configuration/` — the
  Workflows binding reference. Exact quote for `script_name`:

  > `script_name` `string` optional — The name of the Worker script where
  > the Workflow class is defined. Only required if the Workflow is defined
  > in a different Worker than the one the binding is configured on.

  `CF_CROSS_SCRIPT_WORKFLOW_SUPPORTED=YES`.
- `wrangler deploy --help` (installed wrangler 4.119.0, this checkpoint):
  `--dry-run` — "Compile a project and run checks without actually
  uploading the Worker." Empirically confirmed zero-mutation this
  checkpoint: every `wrangler deploy --dry-run` call (both against the real
  `wrangler.toml` and the new `wrangler.paid-continuation-runtime.toml`)
  exits cleanly with "--dry-run: exiting now." and performs no upload.

## 4. Why same-script `wrangler deploy` is rejected

| Option | DAG compilation | 0%-candidate compatible | Verdict |
|---|---|---|---|
| A. Same public API Worker + `wrangler deploy` | YES (documented) | **NO** — single-version, 100%-traffic-only command; cannot coexist with `de70@100/candidate@0` governance | REJECTED |
| B. Same public API Worker + versions/triggers path (status quo) | **NO** — H2BF3 proved 2/2 real attempts produced `has_dag:false` | YES | REJECTED (does not solve the problem) |
| C. Dedicated Workflow-host Worker + cross-script binding | YES (host gets its own plain `wrangler deploy`) | YES (host has zero public routes; its own 100% traffic is meaningless to the public API's split) | **SELECTED** |
| D. Other documented option | none found (Cloudflare documents no third deployment path for Workflows) | n/a | not applicable |

`SELECTED_ARCHITECTURE=OPTION_C`
`ARCHITECTURE_SELECTION_CONFIDENCE=HIGH` — proven, not assumed: this
checkpoint empirically confirmed the cross-script binding resolves
(`wrangler deploy --dry-run`'s own binding table read
`env.PAID_CONTINUATION_WORKFLOW (PaidContinuationWorkflow (defined in
siteborne-paid-continuation-runtime))` against the real `wrangler.toml`),
and that a Workflow-only host script builds and validates cleanly with a
`--dry-run` of its own dedicated config.

## 5. Dedicated-host architecture

```
                    ┌─────────────────────────────────────┐
                    │  Public API Worker                    │
                    │  siteborne-utility-edge (wrangler.toml)│
                    │                                        │
                    │  index.ts (Hono app, MCP, A2A, 12 paid │
                    │  routes) -- NO PaidContinuationWorkflow│
                    │  export                                │
                    │                                        │
                    │  [[workflows]]                         │
                    │    name = siteborne-paid-continuation  │
                    │    binding = PAID_CONTINUATION_WORKFLOW│
                    │    class_name = PaidContinuationWorkflow│
                    │    script_name = siteborne-paid-        │
                    │                  continuation-runtime  │
                    │                                        │
                    │  Release plane: versions upload /      │
                    │  versions deploy / triggers deploy      │
                    │  (unchanged -- candidate qualification │
                    │  preserved)                             │
                    └───────────────┬─────────────────────────┘
                                     │ cross-script Workflow binding
                                     │ (env.PAID_CONTINUATION_WORKFLOW
                                     │  .create() / .get())
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  Dedicated Workflow-host Worker        │
                    │  siteborne-paid-continuation-runtime   │
                    │  (wrangler.paid-continuation-runtime   │
                    │   .toml)                                │
                    │                                        │
                    │  workflow-host-entrypoint.ts:           │
                    │    export { PaidContinuationWorkflow }  │
                    │    export default { fetch: () => 404 }  │
                    │      (inert -- platform build           │
                    │       requirement only, empirically      │
                    │       confirmed this checkpoint)         │
                    │                                        │
                    │  [[workflows]]                          │
                    │    name = siteborne-paid-continuation   │
                    │    binding = PAID_CONTINUATION_WORKFLOW │
                    │    class_name = PaidContinuationWorkflow│
                    │    (no script_name -- self-hosted)      │
                    │                                        │
                    │  Release plane: plain `wrangler deploy` │
                    │  (100% of THIS script's own traffic --  │
                    │  zero public routes, so meaningless      │
                    │  to the public API's own split)          │
                    │                                        │
                    │  workers_dev=false, no routes, no        │
                    │  custom domains, no cron                 │
                    └─────────────────────────────────────┘
```

## 6. Secret / binding matrix

Traced recursively from `PaidContinuationWorkflow.run()` through
`buildProductionPaidContinuationWorkflowDependencies` →
`buildWebContextV2CdpProductionRouteConfig` /
`buildVerifyAgentOutputV2CdpProductionRouteConfig` → executor / PCC /
settlement / persistence:

| Name | Class | Required by host? |
|---|---|---|
| `DB` | D1_BINDING | YES |
| `PAYMENT_CONTINUATION_ENCRYPTION_KEY` | WORKFLOW_RUNTIME_SECRET | YES |
| `PAID_RECEIPT_SIGNING_PRIVATE_KEY` | WORKFLOW_RUNTIME_SECRET | YES |
| `PAID_RECEIPT_SIGNING_KEY_ID` | WORKFLOW_RUNTIME_SECRET | YES |
| `SELLER_WALLET_ADDRESS` | WORKFLOW_RUNTIME_VAR (non-secret) | YES |
| `CDP_API_KEY_ID` | WORKFLOW_RUNTIME_SECRET | YES |
| `CDP_API_KEY_SECRET` | WORKFLOW_RUNTIME_SECRET | YES |
| `PAYMENT_ENVIRONMENT` | WORKFLOW_RUNTIME_VAR | YES (absent today, matches public Worker) |
| `PRODUCTION_ENABLED` | WORKFLOW_RUNTIME_VAR | YES (absent today) |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | WORKFLOW_RUNTIME_VAR | YES (absent today) |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | WORKFLOW_RUNTIME_VAR | YES (absent today) |
| `MODAL_WEBCTX_ENDPOINT_URL` / `_PROXY_KEY` / `_PROXY_SECRET` | EXTERNAL_SERVICE_CONFIGURATION | YES (web_context_verified.v2 only) |
| `BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL` | EXTERNAL_SERVICE_CONFIGURATION (non-secret) | YES (optional; falls back to viem default) |
| `CDP_WALLET_SECRET` | — | **NOT_REQUIRED** (never required by the facilitator client or the read-only seller lookup; §"CDP_WALLET_SECRET law") |
| `ARTIFACTS`/`JOBS`/`EVENTS`/`CATALOG`/`AI`/`BROWSER` | — | NOT_REQUIRED (zero references in the Workflow's dependency chain) |
| `VOYAGE_API_KEY`/`MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`/`SENTRY_DSN`/`NVM_*`/`AGENT_CARD_SIGNING_*`/route-family flags | — | NOT_REQUIRED |

`WORKFLOW_HOST_ENV_MINIMIZED=YES` — enforced by a real TypeScript type,
`PaidContinuationWorkflowHostEnv` (`Pick<Env, ...>` of exactly the 16 names
above), which `PaidContinuationWorkflow` now `extends
WorkflowEntrypoint<PaidContinuationWorkflowHostEnv, ...>` against and
`buildProductionPaidContinuationWorkflowDependencies` now takes as its `env`
parameter type (narrowed from the full public `Env`). Any future accidental
dependency on an unlisted `Env` field is now a compile error, not a runtime
surprise.

## 7. Continuation-key sourcing / rotation decision

`CURRENT_CONTINUATION_KEY_RECOVERABLE_FROM_APPROVED_SOURCE=NO`. Confirmed
this checkpoint by: (a) `.dev.vars` does not exist in this worktree (only
the values-free `.dev.vars.example`, which never lists
`PAYMENT_CONTINUATION_ENCRYPTION_KEY` at all — confirmed by direct grep);
(b) `git log --all` grep for the key name and for
"encryption"/"continuation.*key" in commit subjects returns zero matches —
the key was never committed, generated, or referenced in any commit
message; (c) H2AWI-4P's own evidence report (provisioning checkpoint)
documents the secret being set via `wrangler secret put`, an operation that
by this repository's own established convention never persists the
generated value anywhere retrievable.

`CURRENT_CONTINUATION_KEY_SOURCE=` none (ephemeral, generated once during
H2AWI-4R/4P provisioning, never persisted).

`H2BF5_CONTINUATION_KEY_ROTATION_REQUIRED=YES`. Per the frozen future
sequence (§9 below): exactly one new 256-bit CSPRNG key, generated once,
provisioned to BOTH the new public API candidate and the dedicated
Workflow-host Worker in the same bounded H2BF5 provisioning checkpoint.
Never rotate only one side. `KEY_ROTATION_PENDING_JOB_RISK` analysis:
per H2BF3 §22 and the H1/H1R/H1A/H1S forensics reports this project's prior
checkpoints already produced, the only known non-terminal job
(`de147124-c264-452b-b784-86ee4422ecd1`, from H1) is already forensically
closed/expired. A fresh read-only check of `payment_attempts.lifecycle_stage`
for any non-terminal row is required at the START of H2BF5 itself (not
assumed stale from this document) before any rotation proceeds — see the
implementation plan.

## 8. D1 ownership

`WORKFLOW_HOST_D1_BINDING=DB`,
`WORKFLOW_HOST_D1_DATABASE_ID=efe23c42-cbcc-47c2-9b28-922a541bdcdd` — the
SAME authoritative production database the public API Worker binds (no
migration, no new database). This is a hard requirement of the split: the
Workflow reads/writes the exact same `jobs`/`state_events`/
`payment_attempts`/`x402_service_results` tables its pre-split, same-script
incarnation always used. `D1_SCHEMA_CHANGE_REQUIRED=NO`.

## 9. Settlement ownership

Unchanged by this split: `evidenceProvider.settle()` remains callable from
exactly one production call site
(`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`'s
`runSettlementStep`), now bundled exclusively into the dedicated host, never
duplicated into the public API Worker (confirmed: public API dry-run bundle
contains zero occurrences of `buildProductionPaidContinuationWorkflowDependencies`
or the Workflow class body) and never duplicated within the host itself
(`settle-sole-ownership.test.ts`'s static source scan, re-run this
checkpoint, still finds exactly the same three pre-existing call sites —
proven, not merely unchanged by omission, via a real mutation test that
introduces then removes a fourth). `SINGLE_SETTLEMENT_OWNER_AFTER_SPLIT=PASS`.

## 10. Deployment planes

Two genuinely independent Cloudflare deployment planes after this split:

1. **Public API release plane** — `wrangler.toml` /
   `versions upload` → `versions deploy` → `triggers deploy`. Unchanged
   mechanics, unchanged governance (`de70@100` / candidate `@0`), unchanged
   public contract. The only content change: the `[[workflows]]` block's
   `script_name` now points cross-script.
2. **Workflow-host release plane** — `wrangler.paid-continuation-runtime.toml`
   / plain `wrangler deploy`. A single-version, 100%-traffic command, but
   applied to a script with `WORKFLOW_RUNTIME_PUBLIC_ROUTES=0` — its own
   100% has no public-traffic meaning. `HOST_DEPLOY_PUBLIC_API_TRAFFIC_EFFECT=0`,
   proven by construction (a `wrangler deploy --config
   wrangler.paid-continuation-runtime.toml` call addresses a completely
   different Worker script by name; Cloudflare's Workers API has no
   mechanism for one script's deploy to alter another script's version
   percentages).

`WORKFLOW_HOST_DEPLOYMENT_PERCENT=100%` (of its own script).
`WORKFLOW_HOST_NORMAL_PUBLIC_TRAFFIC_SURFACE=NONE`.
`PUBLIC_API_KNOWN_GOOD_REMAINS_100_PERCENT_IN_FUTURE_PLAN=YES`.

## 11. Future H2BF5 mutation ordering (design only — not executed)

See the companion implementation plan,
`docs/superpowers/plans/2026-08-31-siteborne-dedicated-workflow-host.md`,
for the exact command-by-command sequence, expected mutation, authoritative
readback, and stop rule for every H2BF5 action. Summary:

A. Read production state (read-only).
B. Provision required host secrets/bindings.
C. If rotating: generate exactly one new continuation key, hold transiently.
D. Deploy the dedicated host exactly once (`wrangler deploy --config
   wrangler.paid-continuation-runtime.toml`).
E. Immediately read back the Workflow version: require `has_dag=true`,
   `graph != null`, `class_name=PaidContinuationWorkflow`, `run` present,
   step graph ≥ 1.
F. Create exactly one proven-safe, non-economic Workflow instance directly
   against the Workflow resource.
G. Require ≥ 1 real step executed, executor/settlement/economic effect = 0.
H. Only after the host passes F/G: upload exactly one NEW public API
   candidate containing the cross-script binding.
I. If rotating the key: provision the same new value to the candidate in
   that one candidate operation.
J. Place `de70@100` / new candidate `@0`.
K. Read back the candidate's binding: confirm
   `PAID_CONTINUATION_WORKFLOW → siteborne-paid-continuation →
   script_name=siteborne-paid-continuation-runtime`.

`HOST_CAN_BE_QUALIFIED_BEFORE_API_BINDING_SWITCH=YES` — this ordering is
deliberately frozen: the host is deployed and DAG/runtime-proven (steps
D–G) BEFORE the public API candidate is ever touched (step H), giving real
platform proof before altering the public API's own topology.

## 12. Rollback strategy

- **Host deploy fails / produces `has_dag=false` again**: no public API
  change has been made yet (ordering above) — nothing to roll back on the
  public side. The host script itself has no traffic anything else depends
  on; it can be redeployed, reconfigured, or abandoned without touching
  `de70bf98...@100`.
- **Host qualifies but the new public API candidate fails its own
  qualification** (H2BF-series non-economic probe): the candidate stays at
  0% (never promoted), `de70bf98...@100` is untouched, exactly this
  project's existing rollback posture for every prior candidate.
- **Continuation-key rotation in flight**: old API Worker versions retain
  the old key (never rotated); the new candidate + new host form a
  self-consistent new pair. No in-flight continuation from an old key can
  resume against a rotated host (by design — §7's `KEY_ROTATION_PENDING_JOB_RISK`
  gate exists specifically to make this safe).
