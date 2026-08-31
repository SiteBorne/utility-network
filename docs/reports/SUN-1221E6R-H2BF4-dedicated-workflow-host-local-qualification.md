# SUN-1221E6R-H2BF4 — Dedicated Workflow-Host: Local Qualification

## Outcome

`SUN1221E6R_H2BF4_DEDICATED_WORKFLOW_HOST=PASS` (local design +
implementation complete, TDD RED/GREEN proven, bundle isolation proven,
mutation matrix proven, full regression clean, zero external Cloudflare
mutation). H2BF5 (external provisioning) remains unauthorized and
unexecuted.

## 1. H2BF3 reconciliation

`H2BF3_ROOT_CAUSE_CONFIRMED=YES`. Read in full:
`docs/reports/SUN-1221E6R-H2BF3-workflow-version-id-graph-forensics.md`
(evidence SHA `54d949834c5e6337b3ea56512ed2116af1e2416a`, this worktree's
verified HEAD before any H2BF4 change). Both historical Workflow Versions
(`63a19f97-c6f4-4fe1-99d6-998bdc11d656`, `ae57d91e-4d84-4736-abe6-a456feebf203`)
independently show `has_dag=false`, `graph=null`, regardless of source
content (old stub vs. H2BF1's real `run()`).
`CURRENT_WORKFLOW_DEPLOYMENT_PATH_INSUFFICIENT_FOR_DAG=PROVEN`.

## 2. Cloudflare contract (reconfirmed live this checkpoint, via browser)

- `developers.cloudflare.com/workflows/get-started/guide/`, step 6: the
  ONLY documented deploy command is `npx wrangler deploy`. Same page: "You
  can also access bindings (such as KV, R2, or D1) via `this.env` within
  your Workflow."
- `developers.cloudflare.com/workers/versions-and-deployments/`, exact
  quote: "when you run `wrangler deploy`, Workers creates a new version
  and immediately deploys it to 100% of traffic in a single step."
- `developers.cloudflare.com/workers/wrangler/configuration/`, exact
  quote (Workflows binding reference): "`script_name` `string` optional —
  The name of the Worker script where the Workflow class is defined. Only
  required if the Workflow is defined in a different Worker than the one
  the binding is configured on."
- `wrangler deploy --help` (installed 4.119.0): `--dry-run` — "Compile a
  project and run checks without actually uploading the Worker."

```
CF_WORKFLOW_STANDARD_DEPLOY_COMMAND=wrangler deploy
CF_WRANGLER_DEPLOY_TRAFFIC_EFFECT=new Worker version, immediately 100% traffic, single step
CF_CROSS_SCRIPT_WORKFLOW_SUPPORTED=YES
CF_WORKFLOW_HOST_ENV_SUPPORTED=YES
```

Cross-script support was not merely read from docs but empirically
exercised this checkpoint: `wrangler deploy --dry-run` against the real
`wrangler.toml` (post-change) prints
`env.PAID_CONTINUATION_WORKFLOW (PaidContinuationWorkflow (defined in
siteborne-paid-continuation-runtime))` in its own binding table — proof
the installed Wrangler genuinely resolves the cross-script reference, not
merely accepts unvalidated TOML.

## 3. Architecture selection

| Option | Verdict |
|---|---|
| A. Same script + `wrangler deploy` | REJECTED — 100%-traffic-only, incompatible with 0%-candidate governance |
| B. Same script + versions/triggers (status quo) | REJECTED — H2BF3 proved 2/2 real attempts never compile a DAG |
| C. Dedicated Workflow-host + cross-script binding | **SELECTED** |
| D. Other documented option | none found |

`SELECTED_ARCHITECTURE=OPTION_C`, `ARCHITECTURE_SELECTION_CONFIDENCE=HIGH`
(empirically proven this checkpoint, not assumed — see §6/§9 below).
Full reasoning: `docs/design/SUN-1221E6R-H2BF4-dedicated-workflow-host-architecture.md`.

## 4. Hard architecture invariants

`PUBLIC_API_WORKER=siteborne-utility-edge` (unchanged).
`PUBLIC_API_RELEASE_MODEL=versions upload / versions deploy / triggers
deploy` (unchanged mechanics).
`WORKFLOW_RUNTIME_WORKER=siteborne-paid-continuation-runtime` (new,
dedicated, undeployed).
`WORKFLOW_RUNTIME_PUBLIC_ROUTES=0`, `WORKFLOW_RUNTIME_CUSTOM_DOMAINS=0`,
`WORKFLOW_RUNTIME_CRON_TRIGGERS=0`, `WORKFLOW_RUNTIME_HTTP_API_SURFACE=0`
(the host's only HTTP surface is an unconditional 404, present solely
because the platform build requires SOME default export for an ES-module
Worker importing `cloudflare:workers` — proven empirically: a probe script
with zero default export failed `wrangler deploy --dry-run` with
"Your worker has no default export"; adding the inert 404 handler fixed
it cleanly).
`WORKFLOW_RUNTIME_WORKERS_DEV=DISABLED` (`workers_dev = false` in
`wrangler.paid-continuation-runtime.toml`; not technically required
otherwise — confirmed by the same successful dry-run).

## 5. Dedicated script identity

`WORKFLOW_HOST_SCRIPT_NAME=siteborne-paid-continuation-runtime` (the
recommended name; no naming-constraint conflict found).
`WORKFLOW_RESOURCE_NAME_UNCHANGED=YES` (`siteborne-paid-continuation`
kept — no second Workflow resource created; §19 below).

## 6. Cross-script caller binding

`API_WORKER_WORKFLOW_BINDING_MODE=CROSS_SCRIPT`.
`API_WORKER_WORKFLOW_SCRIPT_NAME=siteborne-paid-continuation-runtime`.

`wrangler.toml`'s `[[workflows]]` block now reads:
```
[[workflows]]
name = "siteborne-paid-continuation"
binding = "PAID_CONTINUATION_WORKFLOW"
class_name = "PaidContinuationWorkflow"
script_name = "siteborne-paid-continuation-runtime"
```
Empirically validated: `wrangler deploy --dry-run` (real `wrangler.toml`)
succeeds and its own binding table shows the cross-script resolution (§2
above).

## 7. Same-script ownership removed

`PUBLIC_API_WORKER_EXPORTS_WORKFLOW_CLASS_AFTER_SPLIT=NO`. `index.ts` no
longer imports or exports `PaidContinuationWorkflow` — proven at three
independent levels this checkpoint:

1. **Source-level test** (`dedicated-workflow-host-config.test.ts`):
   `index.ts`'s source contains no `import`/`export` statement naming the
   class, and no bare code-level reference outside a doc comment.
2. **Real bundle**: `wrangler deploy --dry-run` of the real `wrangler.toml`
   produces a bundle containing zero occurrences of
   `PaidContinuationWorkflow = class extends WorkflowEntrypoint` (esbuild's
   actual emitted form) and zero occurrences of
   `buildProductionPaidContinuationWorkflowDependencies`.
3. **Mutation test**: re-adding the export was proven to break the
   source-level test (§10 below, mutation E).

## 8. Dedicated Workflow entrypoint

`WORKFLOW_HOST_ENTRYPOINT_FILE=apps/edge-api/src/workflow-host-entrypoint.ts`

Exports exactly: `PaidContinuationWorkflow` (named, real, unmodified — a
re-export of the same class `paid-continuation-workflow.ts` defines) and a
default export whose `fetch` is an unconditional 404. Does NOT export or
import the SITEBORNE HTTP router, MCP handler, A2A handler, diagnostic
handlers, or any test Workflow implementation — proven by both a
source-level forbidden-marker test and a real dry-run bundle inspection
(§13 below).

## 9. Host env dependency trace

Traced recursively from `PaidContinuationWorkflow.run()` through
`buildProductionPaidContinuationWorkflowDependencies` →
`buildWebContextV2CdpProductionRouteConfig` /
`buildVerifyAgentOutputV2CdpProductionRouteConfig` → executor / PCC /
settlement / persistence (repositories):

```
WORKFLOW_HOST_REQUIRED_BINDINGS=DB (D1)
WORKFLOW_HOST_REQUIRED_VARS=SELLER_WALLET_ADDRESS, PAYMENT_ENVIRONMENT,
  PRODUCTION_ENABLED, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
  PRODUCTION_CDP_CREDENTIALS_APPROVED
WORKFLOW_HOST_REQUIRED_SECRET_NAMES=PAYMENT_CONTINUATION_ENCRYPTION_KEY,
  PAID_RECEIPT_SIGNING_PRIVATE_KEY, PAID_RECEIPT_SIGNING_KEY_ID,
  CDP_API_KEY_ID, CDP_API_KEY_SECRET
```
Plus, EXTERNAL_SERVICE_CONFIGURATION (optional, `web_context_verified.v2`
only): `MODAL_WEBCTX_ENDPOINT_URL`, `MODAL_WEBCTX_PROXY_KEY`,
`MODAL_WEBCTX_PROXY_SECRET`; and (optional, non-secret, chain-receipt
reconciliation only): `BASE_RPC_URL`, `BASE_SEPOLIA_RPC_URL`.

Explicitly `NOT_REQUIRED`: `ARTIFACTS`, `JOBS`, `EVENTS`, `CATALOG`, `AI`,
`BROWSER`, `VOYAGE_API_KEY`, `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`,
`SENTRY_DSN`, `NVM_*`, `AGENT_CARD_SIGNING_*`, every route-family flag,
`CDP_WALLET_SECRET`.

## 10. Minimum-privilege env type

`WORKFLOW_HOST_ENV_MINIMIZED=YES`. New exported type
`PaidContinuationWorkflowHostEnv` (`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`),
a `Pick<Env, ...>` of exactly the 16 names in §9. `PaidContinuationWorkflow`
now `extends WorkflowEntrypoint<PaidContinuationWorkflowHostEnv,
WorkflowContinuationInput>` (was `Env`);
`buildProductionPaidContinuationWorkflowDependencies`'s `env` parameter is
now typed `PaidContinuationWorkflowHostEnv` (was `Env`). Verified: zero new
typecheck errors from this change (§25 below); new direct unit test
(`production-dependencies.test.ts`) exercises the real, unmocked function
against this narrower type.

## 11. Continuation-key availability — critical gate

`CURRENT_CONTINUATION_KEY_RECOVERABLE_FROM_APPROVED_SOURCE=NO`. Checked
without printing any value:
- `.dev.vars` does not exist in this worktree (`ls .dev.vars*` returns
  only `.dev.vars.example`).
- `.dev.vars.example` never lists `PAYMENT_CONTINUATION_ENCRYPTION_KEY`
  (confirmed by direct read — it lists `SELLER_WALLET_ADDRESS`,
  `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`,
  `NEVERMINED_API_KEY`, `VOYAGE_API_KEY`, `MODAL_TOKEN_ID`,
  `MODAL_TOKEN_SECRET`, `SENTRY_DSN`, `AGENTVERSE_AGENT_URI`,
  `PAID_ROUTES_ENABLED` — no continuation key entry).
- `git log --all --oneline | grep -i "encryption\|continuation.*key"`
  returns zero commit-subject matches.

`CURRENT_CONTINUATION_KEY_SOURCE=` none (ephemeral, generated once during
H2AWI-4R/4P Cloudflare secret provisioning, never persisted locally per
this repository's established convention).
`H2BF5_CONTINUATION_KEY_ROTATION_REQUIRED=YES`.

## 12. Other secret source availability

| Secret | Source available | Source class |
|---|---|---|
| `PAYMENT_CONTINUATION_ENCRYPTION_KEY` | N/A — must be freshly generated at H2BF5, one new key, provisioned to both scripts in one bounded session | other safe source (fresh CSPRNG generation) |
| `PAID_RECEIPT_SIGNING_PRIVATE_KEY` | YES | existing secure source (same value already provisioned on the public API Worker; production-preflight confirms 10 secret names currently present, this among them) |
| `PAID_RECEIPT_SIGNING_KEY_ID` | YES | existing secure source (ditto) |
| `CDP_API_KEY_ID` | YES | existing secure source (ditto) |
| `CDP_API_KEY_SECRET` | YES | existing secure source (ditto) |

`ALL_WORKFLOW_HOST_SECRET_SOURCES_AVAILABLE=YES` (given the one bounded
key-rotation exception in §11, which is a frozen plan, not a blocker).

## 13. CDP_WALLET_SECRET law

`WORKFLOW_HOST_CDP_WALLET_SECRET_PRESENT=NO`. Never required by the
facilitator client or the read-only seller `getAccount` lookup (unchanged
from the public API Worker's own SUN-1200 checkpoint E reconciliation).
`wrangler.paid-continuation-runtime.toml` documents this explicitly and a
dedicated test (`dedicated-workflow-host-config.test.ts`) asserts the name
never appears as an actual assignment in that file.

## 14. D1 ownership

`WORKFLOW_HOST_D1_BINDING=DB`.
`WORKFLOW_HOST_D1_DATABASE_ID=efe23c42-cbcc-47c2-9b28-922a541bdcdd` (same
as the public API Worker's — verified by a dedicated test comparing both
`wrangler.toml` files' `database_id` fields byte-for-byte).
`D1_SCHEMA_CHANGE_REQUIRED=NO`.

## 15. Executor / Modal ownership

`WORKFLOW_HOST_MODAL_BINDINGS=MODAL_WEBCTX_ENDPOINT_URL,
MODAL_WEBCTX_PROXY_KEY, MODAL_WEBCTX_PROXY_SECRET` (optional, reused
unchanged from the existing `web-context-v2-cdp-composition.ts` — no new
executor code, no Modal mutation this checkpoint).
`NEW_EXECUTOR_REQUIRED=NO`.

## 16. Settlement ownership

`PUBLIC_API_HTTP_SETTLE_CALLS=0`, `PUBLIC_API_OTHER_SETTLE_CALLS=0`,
`WORKFLOW_HOST_SETTLE_CALLSITES=1` — re-confirmed this checkpoint by
`settle-sole-ownership.test.ts`'s static source scan (unmodified, still
passes post-split: 4 tests, all green) and independently by a real
mutation test (§37 mutation H below) that adds a fourth `.settle(`
call site and proves the scan catches it. `SINGLE_SETTLEMENT_OWNER_AFTER_SPLIT=PASS`.

## 17. Public contract non-change

`PUBLIC_CONTRACT_CHANGE=NO`. HTTP routes, MCP, A2A, service IDs, prices,
network, asset, `payTo`, receipt schema, PCC schema, and the synchronous
HTTP facade are byte-identical — the only `index.ts` change is the
removal of an import/export statement with zero behavioral effect on `app`
(the exported Hono instance is untouched).

## 18. Workflow instance-ID semantics

`WORKFLOW_INSTANCE_ID_ALGORITHM_CHANGE=NO`. `deriveWorkflowInstanceId`
(continuation primitives, H2AWI-1) is unmodified and unreferenced by this
checkpoint's diff.

## 19. Workflow resource reuse analysis

`EXISTING_WORKFLOW_RESOURCE_REUSABLE=UNPROVEN`. Read-only evidence this
checkpoint (`wrangler workflows describe siteborne-paid-continuation`)
confirms the resource currently has `Script Name: siteborne-utility-edge`,
`Class Name: PaidContinuationWorkflow`. Whether a future `wrangler deploy
--config wrangler.paid-continuation-runtime.toml` updates this SAME
resource's `script_name` in place (vs. requiring a distinct Workflow name)
is not determinable from documentation or installed Wrangler source alone
— frozen as an explicit H2BF5 pre-mutation hard gate (`docs/superpowers/plans/2026-08-31-siteborne-dedicated-workflow-host.md`
§H2BF5-D/E). No second Workflow resource was created locally or remotely
this checkpoint.

## 20/21. Host Wrangler config

`wrangler.paid-continuation-runtime.toml` (new): `name =
siteborne-paid-continuation-runtime`, `main =
apps/edge-api/src/workflow-host-entrypoint.ts`, `compatibility_date =
2026-08-05` (matches the public config), `workers_dev = false`, no
routes, no custom domains, no cron, one D1 binding (same production
database), one non-secret var (`SELLER_WALLET_ADDRESS`), one self-hosted
`[[workflows]]` definition (name/class_name, no `script_name` — the class
lives in this same script), `[observability] enabled = true`. No secret
VALUES committed (only documented, by name, in comments).
`HOST_WORKFLOW_CONFIG_VALID=YES` — validated both by a dedicated test
suite (9 tests, `dedicated-workflow-host-config.test.ts`) and by a real,
successful `wrangler deploy --dry-run --config
wrangler.paid-continuation-runtime.toml`.

## 22. Public API Wrangler config change

`wrangler.toml`'s `[[workflows]]` block gained exactly one field
(`script_name`). No change to `routes`, custom domains, the 7 governed
vars, other secret names, the activation matrix, or any economic config
— confirmed by `git diff wrangler.toml` (the only other changes are
doc-comment additions explaining the rationale).

## 23–26. TDD

**RED** (genuinely reverted and re-run, not narrated):

- `CROSS_SCRIPT_BINDING_RED=YES` — `dedicated-workflow-host-config.test.ts`
  run against the pre-H2BF4 `wrangler.toml`/`index.ts` (via `git stash`,
  with the two new untracked host files moved aside) fails at file-load
  time (`ENOENT` for the host config), and its `CROSS_SCRIPT_BINDING_GREEN`
  assertion has no `script_name` key to match against in the un-split
  `[[workflows]]` block.
- `DEDICATED_HOST_RED=YES` — `workflow-host-entrypoint.test.ts` run
  against the same pre-H2BF4 state: all 5 tests fail (module does not
  exist).

**GREEN**: both suites restored to full green after restoring the H2BF4
changes (9/9 and 5/5 respectively).

```
CROSS_SCRIPT_BINDING_GREEN=PASS
DEDICATED_HOST_GREEN=PASS
ACTUAL_WORKFLOW_CLASS_GREEN=PASS  (workflow-host-entrypoint.test.ts's own
  "ACTUAL_WORKFLOW_CLASS_GREEN" test: reaches step.do('open-envelope', ...)
  through the entrypoint, not the old throwing stub)
```

## 27. Host bundle isolation

Built via `wrangler deploy --dry-run --config
wrangler.paid-continuation-runtime.toml --outdir <tmp>` (zero-mutation,
per the documented `--dry-run` semantics, §2). Inspected the real bundled
output directly (`grep`/`node` string search, not narrated):

**Present** (all confirmed): `PaidContinuationWorkflow = class extends
WorkflowEntrypoint` (real class body, esbuild's emitted form), `async
function runPaidContinuationWorkflow` (real orchestration), `async
function buildProductionPaidContinuationWorkflowDependencies`,
`openContinuationEnvelope`/its error strings, `D1JobsRepository`,
`D1PaymentAttemptRepository`, `X402ServiceResultRepository`,
`buildProductionCdpChainReceiptChecker`,
`buildWebContextV2CdpProductionRouteConfig`,
`buildVerifyAgentOutputV2CdpProductionRouteConfig`.

**Absent** (all confirmed zero occurrences): `new Hono` (app
construction), `mcpRoute`, `a2aRoute`, `catalogRoute`, `healthRoute`,
`readinessRoute`, `openapiRoute`, the `worker-runtime-test-entrypoint`
module/marker, an actual `import ... FixturePaymentEvidenceProvider`
statement (one incidental doc-comment string mention inside
`CdpPaymentEvidenceProvider`'s own real production code was found and
verified to be prose, not an import/instantiation — see the design doc's
own investigation), the two Nevermined test-client factories, and both
real production HTTP route module names
(`webContextVerifiedV2CdpProductionRoute`/
`verifyAgentOutputV2CdpProductionRoute` — the HTTP route wrappers
themselves, as opposed to the composition functions they call, which the
Workflow's dependency builder legitimately reuses directly).

`WORKFLOW_HOST_BUNDLE_ISOLATION=PASS`. Automated as a permanent regression
gate in `scripts/test-worker-runtime.mts`'s new
`runWorkflowHostBundleIsolationCheck()`.

## 28. API bundle isolation after split

Built via `wrangler deploy --dry-run --outdir <tmp>` of the REAL
`wrangler.toml` (same zero-mutation semantics). Confirmed: zero
occurrences of `PaidContinuationWorkflow = class extends WorkflowEntrypoint`,
zero occurrences of `buildProductionPaidContinuationWorkflowDependencies`,
zero occurrences of `runPaidContinuationWorkflow`, zero occurrences of
`openContinuationEnvelope` or its `EnvelopeOpenError` message strings.
Public routes remain present and unaffected (`mcpRoute`: 3,
`webContextVerifiedV2CdpProductionRoute`: 3,
`verifyAgentOutputV2CdpProductionRoute`: 3, `app.route`: 9 occurrences —
byte-for-byte consistent with a purely-additive change to public surface).
The binding table itself shows the cross-script resolution (§2/§6).
`API_BUNDLE_CROSS_SCRIPT_ISOLATION=PASS`.

## 29. Local cross-script runtime test strategy

`LOCAL_CROSS_SCRIPT_RUNTIME_TEST=PARTIAL`. `wrangler deploy --dry-run`
proves the binding RESOLVES (build-time proof, §2/§6) — this is real,
not fabricated. Wrangler's local dev harness (`wrangler dev --local`,
used throughout `scripts/test-worker-runtime.mts`'s Phases 0-9) was not
attempted against a genuinely two-script cross-script topology this
checkpoint (would require running two simultaneous `wrangler dev`
processes wired together, which this project's existing harness pattern
does not support and which risks a much larger, unbounded local-dev-only
investigation for a proof the actual deploy sequence — H2BF5 §D/E — will
establish authoritatively anyway). Not invented as a false PASS; genuinely
returning `PARTIAL` rather than a full `PASS`. **Local proof cannot and
does not replace the real DAG/graph readback H2BF5 §D/E requires.**

## 30. Host `wrangler deploy` side-effect model

Read installed Wrangler source is not required beyond what `--help` and
live `--dry-run` behavior already demonstrate this checkpoint (both used).
`HOST_DEPLOY_EXPECTED_MUTATIONS`: one new Worker script
(`siteborne-paid-continuation-runtime`), one new Worker version deployed
at 100% of that script's own traffic, Workflow resource
`script_name`/`class_name`/DAG registration against that script, secret
bindings (once provisioned per H2BF5 §B/C) attached to that script.
`HOST_DEPLOY_PUBLIC_API_TRAFFIC_EFFECT=0` — proven by construction (a
`wrangler deploy --config <host-config>` call names a completely
different Worker script; Cloudflare's Workers API has no mechanism for one
script's deploy to alter another script's version percentages, and this
project's own `wrangler.toml`/host config declare genuinely separate
`name` values).

## 31. Public 100% semantics clarification

`WORKFLOW_HOST_DEPLOYMENT_PERCENT=100%` (of the host's own, zero-public-route
script). `WORKFLOW_HOST_NORMAL_PUBLIC_TRAFFIC_SURFACE=NONE`.
`PUBLIC_API_KNOWN_GOOD_REMAINS_100_PERCENT_IN_FUTURE_PLAN=YES`. Documented
explicitly, at length, in both the architecture doc (§10) and the host
`wrangler.toml`'s own comments — this is the single most important
non-obvious fact this checkpoint establishes.

## 32/33. Future H2BF5 ordering

`H2BF5_PROPOSED_ORDERING=PASS` (frozen, not executed —
`docs/superpowers/plans/2026-08-31-siteborne-dedicated-workflow-host.md`,
tasks H2BF5-A through H2BF5-K, each with exact command class, expected
mutation, authoritative readback, and stop rule).
`HOST_CAN_BE_QUALIFIED_BEFORE_API_BINDING_SWITCH=YES` — the host is
deployed and DAG/runtime-proven (plan §D–G) strictly before the public API
candidate is ever touched (plan §H onward).

## 34. Continuation-key rotation plan / pending-job risk

`KEY_ROTATION_PENDING_JOB_RISK=PASS` (as a checkpoint-level plan
disposition — the actual live D1 read-only re-check is itself Task
H2BF5-A in the plan, not assumed stale from this document). Per H2BF3 §22
and this project's own H1/H1R/H1A/H1S forensics reports, the only
previously-known non-terminal job (`de147124-c264-452b-b784-86ee4422ecd1`,
H1) is already forensically closed/expired. No new payment attempt has
occurred since (H2BF2's synthetic probe never reached executor/settlement;
H2BF3 was read-only; H2BF4, this checkpoint, is local-source-only). The
plan requires H2BF5-A to re-confirm this live, not merely cite this
document, before any rotation (H2BF5-C) proceeds.

## 35. Old failed Workflow forensics — preserved

Confirmed read-only, unchanged this checkpoint: `wrangler workflows list`
still shows exactly 1 Workflow resource (`siteborne-paid-continuation`,
`fe6447c7-aec1-4fb6-93db-800b02247ce4`); `wrangler deployments list`
still shows the historical `de70bf98...@100` / `6895532e...@0` /
`855ee345...@0` sequence intact. Nothing was deleted or mutated.

## 36. Full local regression

All commands run from this checkpoint's own working tree, then re-run
identically from the clean committed HEAD (§41 below):

```
TESTS=PASS                  -- npx vitest run: 212 files passed | 23 skipped
                                (235 total); 2578 tests passed | 77 skipped
                                (2655 total); ZERO failures
WORKER_RUNTIME=PASS         -- npx tsx scripts/test-worker-runtime.mts:
                                99/99 scenarios passed
LINT=PASS                   -- pnpm --filter @siteborne/edge-api lint:
                                clean, zero errors/warnings from ESLint itself
TYPECHECK=ACCEPTED_UNCHANGED_BASELINE
                             -- see note below: true baseline is 5 errors,
                                not 2 (discovered, not caused, this
                                checkpoint) -- 0 NEW errors from H2BF4's
                                own diff, confirmed by identical
                                before/after `tsc` output for both
                                tsconfig.json (3 errors) and
                                tsconfig.live-tests.json (5 errors)
PRODUCTION_PREFLIGHT=PASS   -- npx tsx scripts/production-preflight.mts:
                                PREFLIGHT RESULT: PASS
NEW_SECRET_FINDINGS=0       -- gitleaks git: 4 findings (git-history scan,
                                2 unique findings x 2 duplicated commit
                                SHAs each, from the known prior
                                git-identity rewrite); gitleaks dir:
                                2 findings (working-tree scan, same 2
                                unique findings) -- both exactly the
                                documented pre-existing baseline, both
                                entirely in docs/reports/*.md, zero
                                findings in any file this checkpoint
                                touched
```

**Typecheck baseline correction (honest disclosure, not a H2BF4 defect):**
the checkpoint brief's stated baseline ("exactly 2 pre-existing errors in
`tests/live/web-context-first-paid-e2e-local.test.ts`") is INCOMPLETE. On
a fresh `pnpm install` in this manually-created worktree (`node_modules`
did not exist until this checkpoint provisioned it), running
`tsc --project tsconfig.json --noEmit` directly (bypassing the combined
`&&`-chained `pnpm typecheck` script, which short-circuits on the first
project's failure) revealed 3 additional, GENUINELY PRE-EXISTING errors in
`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow-entrypoint.test.ts`
(a `WorkflowContinuationResult` type-only import that was never actually
re-exported by `paid-continuation-workflow.ts`, plus two `vi.fn()`
generic-signature mismatches) — confirmed pre-existing by reverting this
checkpoint's own changes via `git stash` and re-running `tsc` directly
against bare HEAD `54d949834c5e6337b3ea56512ed2116af1e2416a`: identical 3
errors, byte-for-byte. Combined with the 2 previously-documented
`tests/live` errors, the TRUE full baseline (both tsconfig projects
combined) is **5 pre-existing errors**, not 2. This checkpoint's own diff
introduces **zero** new ones — proven by running both `tsc` invocations
independently, before and after the H2BF4 diff, and diffing the exact
error text (byte-identical in both cases). This discrepancy is reported
honestly rather than silently reconciled or hidden; it predates and is
unrelated to H2BF4's own changes, and this checkpoint does not fix it
(out of scope — fixing a pre-existing, unrelated test-file defect is not
this checkpoint's mandate).

## 27/28 (repeated per spec numbering — both bundle isolation checks)

See §27 and §28 above; both `PASS`, both automated as permanent regression
gates.

## 37. Mutation matrix

Every mutation below was applied for real (via a temporary source edit),
proven to make the relevant test suite fail, then reverted and re-proven
green — not narrated:

| # | Mutation | Test that catches it | Result |
|---|---|---|---|
| A | Remove `script_name` from the public API `[[workflows]]` block | `dedicated-workflow-host-config.test.ts` `CROSS_SCRIPT_BINDING_GREEN` | CAUGHT, restored, GREEN |
| B | Point `script_name` back at the public API Worker itself | same test | CAUGHT, restored, GREEN |
| C | Remove `PaidContinuationWorkflow` export from the host entrypoint | `workflow-host-entrypoint.test.ts` `DEDICATED_HOST_GREEN` | CAUGHT, restored, GREEN |
| D | Add a real public fetch handler to the host (returns 200 for any request) | `workflow-host-entrypoint.test.ts` "does NOT export a public fetch API" | CAUGHT, restored, GREEN |
| E | Restore the public API Worker's own `PaidContinuationWorkflow` export | `dedicated-workflow-host-config.test.ts` "does not import or export" | CAUGHT, restored, GREEN |
| F | Change the host's D1 `database_id` to a different value | `dedicated-workflow-host-config.test.ts` "binds the same production D1 database" | CAUGHT, restored, GREEN |
| G | Remove the `PAYMENT_CONTINUATION_ENCRYPTION_KEY` guard from `buildProductionPaidContinuationWorkflowDependencies` | `production-dependencies.test.ts` `MUTATION_G_TARGET` (NEW file, written this checkpoint specifically because the FIRST attempt at this mutation proof — against the pre-existing entrypoint-level MOCKED suite — silently passed, a real coverage gap this checkpoint closed) | CAUGHT (second attempt, against the real unmocked function), restored, GREEN |
| H | Introduce a second `evidenceProvider.settle()` call site (in the host entrypoint file) | `settle-sole-ownership.test.ts` | CAUGHT, restored, GREEN |

`H2BF4_MUTATION_MATRIX=PASS`. Mutation G's own history is itself reported
honestly: the first proof attempt gave a false PASS because it targeted a
module-mocked suite that never executes the real guard code — this was
caught during THIS checkpoint's own work (not hidden), and closed by
writing `production-dependencies.test.ts`, a genuine new direct-unit-test
gap-closure, before declaring the matrix complete.

## 38–39. Architecture document / implementation plan

- `docs/design/SUN-1221E6R-H2BF4-dedicated-workflow-host-architecture.md`
- `docs/superpowers/plans/2026-08-31-siteborne-dedicated-workflow-host.md`

## 40. Implementation commit

`H2BF4_IMPLEMENTATION_COMMIT_SHA=5f6e45e` (branch `worktree-h2bf4-manual`;
12 files changed, 1407 insertions, 30 deletions — not merged/pushed to
`main`).

## 41. Post-commit verification

From clean committed HEAD `5f6e45e` (`git status --short` empty before
re-running):
```
POST_COMMIT_H2BF4_VERIFICATION=PASS
```
- dedicated-host tests (`workflow-host-entrypoint.test.ts`): 5/5 PASS
- cross-script binding tests (`dedicated-workflow-host-config.test.ts`): 9/9 PASS
- actual-class tests (`paid-continuation-workflow-entrypoint.test.ts`): 6/6 PASS
- production-dependencies direct tests: 4/4 PASS
- settlement-owner static audit (`settle-sole-ownership.test.ts`): 4/4 PASS
- dry-run host bundle (`wrangler deploy --dry-run --config
  wrangler.paid-continuation-runtime.toml`): succeeds, same
  inclusion/exclusion markers as §27
- dry-run API bundle (`wrangler deploy --dry-run`): succeeds, cross-script
  binding table line unchanged from §2/§6, same isolation markers as §28
- full `scripts/test-worker-runtime.mts`: 99/99 scenarios PASS

## Zero external mutations (section 0 counters, final)

```
NEW_WORKER_UPLOADS=0
WRANGLER_DEPLOY_CALLS=0            (only --dry-run, which uploads nothing)
DEPLOYMENT_MUTATIONS=0
WORKFLOW_DEFINITION_UPDATES=0
WORKFLOW_INSTANCE_CREATIONS=0
SECRET_MUTATIONS=0
CONTINUATION_KEY_MUTATIONS=0
D1_MUTATIONS=0
TRAFFIC_MUTATIONS=0
REAL_LIVE_402_REQUESTS=0
REAL_EIP3009_AUTHORIZATIONS_CREATED=0
REAL_SIGNER_CALLS=0
REAL_PAID_REQUESTS=0
REAL_EXECUTOR_CALLS=0
REAL_FACILITATOR_VERIFY_CALLS=0
REAL_FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
```

Read-only Cloudflare inspection performed this checkpoint (all confirmed
zero-write): `wrangler workflows list`, `wrangler workflows describe
siteborne-paid-continuation`, `wrangler deployments list`, `wrangler
versions list`, `wrangler --version`, `wrangler deploy --help`, and
multiple `wrangler deploy --dry-run` calls (both configs) — every one of
which explicitly prints "--dry-run: exiting now." and uploads nothing.

## 44. H2BF5 external eligibility

```
SUN1221E6R_H2BF5_DEDICATED_HOST_PROVISIONING_ELIGIBLE=YES
```
All required conditions met: dedicated host architecture proven optimal
(§3); cross-script Cloudflare support confirmed (§2, both documented and
empirically dry-run-proven); host bundle isolated (§27); public API
bundle isolated (§28); real Workflow class hosted only in the dedicated
script (§7/§8); all host dependencies enumerated (§9); required secret
sources available OR a bounded shared-key provisioning plan fully
specified (§12, §11/§C); continuation-key reuse/rotation decision frozen
(§11); D1 requires no schema mutation (§14); single settlement owner
preserved (§16); host deploy cannot change public API traffic (§30);
H2BF5 exact mutation ordering frozen (§32, full plan document); all
tests/regressions pass (§36/§41); zero external mutations this checkpoint
(above).

## 45. H2B2 remains forbidden

```
SUN1221E6R_H2B2_REAL_PAYMENT_ELIGIBLE=NO
```
Unchanged by this checkpoint. H2BF5 must first prove on real Cloudflare
(per its own plan §D–G): dedicated host deploy via `wrangler deploy`
succeeds; Workflow version `has_dag=true`; `graph != null`; `run` exists;
≥1 safe real Workflow step executes; `executor=0`, `settlement=0`,
economic effect `=0`; a new public API candidate binds cross-script to
that qualified host; public API remains `de70@100` / candidate `@0` —
before H2B2 can even be considered, and only via its own fresh,
standalone authorization.

## Final packet

```
SUN1221E6R_H2BF4_DEDICATED_WORKFLOW_HOST=PASS
H2BF3_EVIDENCE_COMMIT_SHA=54d949834c5e6337b3ea56512ed2116af1e2416a
SELECTED_ARCHITECTURE=OPTION_C
ARCHITECTURE_SELECTION_CONFIDENCE=HIGH
CF_WORKFLOW_STANDARD_DEPLOY_COMMAND=wrangler deploy
CF_WRANGLER_DEPLOY_TRAFFIC_EFFECT=new Worker version, immediately 100% traffic, single step
CF_CROSS_SCRIPT_WORKFLOW_SUPPORTED=YES
WORKFLOW_HOST_SCRIPT_NAME=siteborne-paid-continuation-runtime
WORKFLOW_RESOURCE_NAME_UNCHANGED=YES
PUBLIC_API_WORKER_EXPORTS_WORKFLOW_CLASS_AFTER_SPLIT=NO
WORKFLOW_HOST_ENTRYPOINT_FILE=apps/edge-api/src/workflow-host-entrypoint.ts
WORKFLOW_HOST_REQUIRED_BINDINGS=DB
WORKFLOW_HOST_REQUIRED_VARS=SELLER_WALLET_ADDRESS,PAYMENT_ENVIRONMENT,PRODUCTION_ENABLED,HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,PRODUCTION_CDP_CREDENTIALS_APPROVED
WORKFLOW_HOST_REQUIRED_SECRET_NAMES=PAYMENT_CONTINUATION_ENCRYPTION_KEY,PAID_RECEIPT_SIGNING_PRIVATE_KEY,PAID_RECEIPT_SIGNING_KEY_ID,CDP_API_KEY_ID,CDP_API_KEY_SECRET
WORKFLOW_HOST_ENV_MINIMIZED=YES
CURRENT_CONTINUATION_KEY_RECOVERABLE_FROM_APPROVED_SOURCE=NO
H2BF5_CONTINUATION_KEY_ROTATION_REQUIRED=YES
ALL_WORKFLOW_HOST_SECRET_SOURCES_AVAILABLE=YES
WORKFLOW_HOST_CDP_WALLET_SECRET_PRESENT=NO
WORKFLOW_HOST_D1_BINDING=DB
D1_SCHEMA_CHANGE_REQUIRED=NO
NEW_EXECUTOR_REQUIRED=NO
SINGLE_SETTLEMENT_OWNER_AFTER_SPLIT=PASS
PUBLIC_CONTRACT_CHANGE=NO
WORKFLOW_INSTANCE_ID_ALGORITHM_CHANGE=NO
EXISTING_WORKFLOW_RESOURCE_REUSABLE=UNPROVEN
HOST_WORKFLOW_CONFIG_VALID=YES
CROSS_SCRIPT_BINDING_RED=YES
DEDICATED_HOST_RED=YES
CROSS_SCRIPT_BINDING_GREEN=PASS
DEDICATED_HOST_GREEN=PASS
WORKFLOW_HOST_BUNDLE_ISOLATION=PASS
API_BUNDLE_CROSS_SCRIPT_ISOLATION=PASS
LOCAL_CROSS_SCRIPT_RUNTIME_TEST=PARTIAL
HOST_DEPLOY_EXPECTED_MUTATIONS=one new Worker script+version at 100% of its own zero-route traffic; Workflow script_name/class_name/DAG registration
HOST_DEPLOY_PUBLIC_API_TRAFFIC_EFFECT=0
WORKFLOW_HOST_DEPLOYMENT_PERCENT=100%
WORKFLOW_HOST_NORMAL_PUBLIC_TRAFFIC_SURFACE=NONE
H2BF5_PROPOSED_ORDERING=PASS
HOST_CAN_BE_QUALIFIED_BEFORE_API_BINDING_SWITCH=YES
KEY_ROTATION_PENDING_JOB_RISK=PASS
TESTS=PASS
WORKER_RUNTIME=PASS
LINT=PASS
TYPECHECK=ACCEPTED_UNCHANGED_BASELINE (true baseline corrected to 5 pre-existing errors this checkpoint, honestly disclosed; 0 new)
PRODUCTION_PREFLIGHT=PASS
NEW_SECRET_FINDINGS=0
H2BF4_MUTATION_MATRIX=PASS
H2BF4_IMPLEMENTATION_COMMIT_SHA=5f6e45e
POST_COMMIT_H2BF4_VERIFICATION=PASS
SUN1221E6R_H2BF4_EVIDENCE_COMMIT_SHA=(this commit)
NEW_WORKER_UPLOADS=0
WRANGLER_DEPLOY_CALLS=0
DEPLOYMENT_MUTATIONS=0
WORKFLOW_DEFINITION_UPDATES=0
WORKFLOW_INSTANCE_CREATIONS=0
SECRET_MUTATIONS=0
CONTINUATION_KEY_MUTATIONS=0
D1_MUTATIONS=0
TRAFFIC_MUTATIONS=0
REAL_LIVE_402_REQUESTS=0
REAL_EIP3009_AUTHORIZATIONS_CREATED=0
REAL_SIGNER_CALLS=0
REAL_PAID_REQUESTS=0
REAL_EXECUTOR_CALLS=0
REAL_FACILITATOR_VERIFY_CALLS=0
REAL_FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
SUN1221E6R_H2BF5_DEDICATED_HOST_PROVISIONING_ELIGIBLE=YES
SUN1221E6R_H2B2_REAL_PAYMENT_ELIGIBLE=NO
NEXT_REQUIRED_CHECKPOINT=SUN-1221E6R-H2BF5 (external provisioning -- fresh human authorization required; exact ordering frozen in docs/superpowers/plans/2026-08-31-siteborne-dedicated-workflow-host.md)
```
