# SUN-1222C-R4-DEPLOYMENT-RETRY

**Checkpoint class:** two production deployments (public API candidate at 0% traffic,
Workflow host at 100%), zero economic activity.

## 1. D2 manifest reconstruction

No standalone `SUN-1222C-R4-D2` evidence file exists in the repository — D2 halted
during its own regression re-run (before reaching its evidence-writing stage) when it
found the SUN-1221E2D public-contract regression, and was reported only in chat, not
committed. The manifest below is reconstructed from three concrete, unambiguous
sources rather than "closest prior pattern":

1. The user's standalone `SUN-1222C-R4-FIX` authorization text (still in this
   conversation), which explicitly scoped: *"exactly one corrective deployment of
   `siteborne-paid-continuation-runtime` if source/deployment tracing proves that this
   is the only live runtime requiring deployment... I authorize no public API
   deployment, candidate upload, or traffic mutation. If any additional production
   deployment is required, stop and request expanded authorization."*
2. My own D2 chat finding (call-site trace) that `x402-service.ts`'s
   `respondFromWorkflowResult` — where the R4/D3 fix lives — is bundled into the
   **public API Worker** (`siteborne-utility-edge`) via
   `production-company-evidence-v2-cdp-route.ts` → `index.ts`, not the host, meaning
   the fix requires **two** deployment targets, not one.
3. The `SUN-1222C-R4-D3` evidence report (`docs/reports/SUN-1222C-R4-D3-public-error-contract-reconciliation.md`),
   which documents the exact corrected diff and its two touched runtime surfaces
   (`paid-continuation-workflow.ts` — host; `x402-service.ts` — public API).

Reconstructed manifest:

```
D2_SOURCE_HEAD                    = 9f282e4 (R4-FIX), later superseded by 17d7ba7 (R4-D3)
D2_PUBLIC_WORKER_TARGET           = siteborne-utility-edge
D2_HOST_WORKER_TARGET             = siteborne-paid-continuation-runtime
D2_WORKERS_TO_DEPLOY              = [siteborne-utility-edge, siteborne-paid-continuation-runtime]
D2_EXPECTED_DEPLOYMENT_COUNT      = 2
D2_EXPECTED_PRE_DEPLOY_TRAFFIC    = db7054c9-76ee-4830-aabe-8a4542261b6a @ 100% (public API)
D2_EXPECTED_POST_DEPLOY_TRAFFIC   = db7054c9 @ 100% unchanged (public API)
D2_EXPECTED_CANDIDATE_TRAFFIC     = 0% (new public API candidate, replacing a064477f)
D2_SERVICE_ACTIVATION_STATE       = unchanged — same four v2 services, same economics
D2_EXPECTED_VARS                  = unchanged (see §7 wrangler dry-run bindings, both Workers)
D2_EXPECTED_SECRET_NAMES          = unchanged (13 on host, +2 on public API — same as every prior checkpoint this session)
D2_EXPECTED_BINDINGS              = unchanged (DB, ARTIFACTS, CATALOG, JOBS, EVENTS, BROWSER, AI, PAID_CONTINUATION_WORKFLOW)
D2_EXPECTED_D1_MIGRATIONS         = none — this fix touches no schema
D2_EXPECTED_EXTERNAL_RESOURCES    = none new
D2_EXPECTED_ECONOMICS             = unchanged (0.0312 / 0.008 / 0.0098 / 0.017 USDC for the four v2 services)
D2_EXPECTED_PAID_ROUTE_STATE      = unchanged (12 paid routes, all structurally gated pre-payment)
D2_EXPECTED_POST_DEPLOY_QUALIFICATION = non-economic candidate probes only; no payment
D2_STOP_BOUNDARY                  = stop before any real 402/payment/settlement
```

`D2_DEPLOYMENT_MANIFEST_RECONSTRUCTED = YES` (source: authorization text + call-site
trace + D3 report, not inference from an unrelated prior pattern).

## 2. Authorization gate

`SUN1222C_R4_DEPLOYMENT_RETRY_AUTHORIZATION = PRESENT` — standalone, explicit,
first-person authorization received immediately preceding this checkpoint's protocol
text, naming `SUN-1222C-R4-DEPLOYMENT-RETRY` and the exact two-target scope.

## 3. Current source lineage

```
CURRENT_HEAD                = 17d7ba7
COMMITS_SINCE_D2_FREEZE      = 1 (17d7ba7 only)
D3_INCLUDED_IN_CURRENT_HEAD  = YES
WORKING_TREE_CLEAN           = YES (verified before and after all commands)
```

The single commit since the D2 source freeze (`9f282e4`) is `17d7ba7`, classified
`D3_SECURITY_FIX`. No `EVIDENCE_ONLY` or `UNRELATED` commits exist in that range —
confirmed via `git log --oneline 9f282e4..HEAD` and `git diff 9f282e4..HEAD -- wrangler.toml
wrangler.paid-continuation-runtime.toml` (empty diff — no config drift).

## 4–5. Security-contract re-proof

Re-ran `apps/edge-api/tests/x402-service-route.test.ts` (targeted): **37/37 PASS**,
including the strengthened SUN-1221E2D test (`failure.message` shape) and the new
SUN-1222C-R4-D3 test (`limitations`-only shape). Neither response carries `details`,
`error_detail`, or any provider/internal text.

```
D3_PUBLIC_ERROR_DETAIL_LEAK      = NO
SUN1221E2D_SECURITY_CONTRACT     = PRESERVED
```

`paid-continuation-workflow.test.ts`'s three R4 `error_detail` tests (internal
representation) are untouched and still pass, confirming the internal generation
survives independently of the public non-leak fix:

```
INTERNAL_ERROR_DETAIL_GENERATION      = PASS
INTERNAL_ERROR_DETAIL_PUBLICLY_EXPOSED = NO
```

## 6–8. Full deployment-critical gate (re-run at `17d7ba7`)

| Gate | Result |
|---|---|
| Typecheck | PASS (23/23 turbo tasks) |
| Build | PASS (12/12 turbo tasks) |
| Lint | PASS (16/16 turbo tasks) |
| Full test suite | 265/266 files, 2955/3033 tests, 78 skipped; 2 pre-existing resource-contention flakes (`production-cdp-full-stack-mock.test.ts` §22, `worker-bridge.subprocess.test.ts`), both reconfirmed passing standalone in isolation — neither touches this diff |
| `x402-service-route.test.ts` targeted | 37/37 PASS |
| `mcp:check` | PASS |
| `x402:check` | PASS |
| `a2a:check` | 2/2 PASS |
| `test:worker-runtime` | 99/99 scenarios PASS |
| `secrets:scan` | 2 findings, both the pre-existing `3a74686d-bad8-4fb0-b6b8-604292145d69` Worker-version-UUID `generic-api-key` false positive in two historical evidence docs (commits `3cbee0e`, `1e3e3d0`, predating this checkpoint) — 0 new |
| `production:preflight` | PASS |
| `wrangler deploy --dry-run` (public API) | clean, bindings unchanged |
| `wrangler deploy --dry-run` (host) | clean, bindings unchanged (pre-existing benign `unenv`/`whatwg-url` warning only) |

`NEW_SECRET_FINDINGS = 0`. No regression introduced by this checkpoint; the two flakes
are identical in signature and file to ones already reconfirmed passing earlier this
session.

## 9. Pre-retry live production readback

```
PRE_RETRY_PUBLIC_DEPLOYMENT_STATE  = db7054c9-76ee-4830-aabe-8a4542261b6a @ 100%, a064477f-7b74-46c5-a5b6-799df114b252 @ 0% (no third version)
PRE_RETRY_HOST_DEPLOYMENT_STATE    = 453dd8f7-2fa0-44d6-9541-6a79c7fbc80a @ 100% (deployed during SUN-1222C-R3, carries R10 fix 39b97f1 — predates R4-FIX and D3)
PRE_RETRY_TRAFFIC_STATE            = unchanged from every prior checkpoint this session
PRE_RETRY_SERVICE_ACTIVATION_STATE = 4 v2 services active, same economics
PRE_RETRY_D1_STATE                 = unaffected by this fix (no migration involved)
```

## 10. D2 baseline drift check

Both deployment targets were exactly where D2's manifest expected them:
- Public API candidate (`a064477f`) predates R3/R10/R4-FIX/D3 entirely (created
  2026-09-07T06:03Z) — confirms the public candidate genuinely never had any of this
  work, exactly as D2 assumed.
- Host (`453dd8f7`) has R10 (`39b97f1`) but not R4-FIX's Workflow-side `error_detail`
  generation (`9f282e4`) or D3 — confirms the host redeploy is still required, exactly
  as D2 assumed (it was already redeployed once for R10 earlier in the session, which
  is `EXPECTED_D2_LINEAGE`, not drift).

`MATERIAL_D2_BASELINE_DRIFT = NO`.

## 11–12. External dependencies / document-worker state

Not applicable — this fix touches no document-service, R2, or Modal-credential path.
`DEPENDENCY_READINESS = N/A (fix is scoped entirely to x402-service.ts response
construction and Workflow-side error_detail generation)`.

## 13. Immutable deployment input freeze

```
SOURCE_HEAD                = 17d7ba7
EXPECTED_BINDINGS          = unchanged (confirmed via both wrangler dry-runs, §6)
EXPECTED_VARS              = unchanged (confirmed via both wrangler dry-runs, §6)
EXPECTED_SECRET_NAMES      = unchanged (13 host / +2 public API, name-only, confirmed via production:preflight)
EXPECTED_SERVICE_ACTIVATION = unchanged, 4 v2 services
EXPECTED_ECONOMICS         = unchanged (0.0312 / 0.008 / 0.0098 / 0.017 USDC)
EXPECTED_TRAFFIC_AFTER_DEPLOY = public API: 100%/0% unchanged split; host: 100% (single-version, no split)
```

D3 alters only the intended public error-detail behavior, matching §13's constraint
exactly.

## 14. Economic immutability

Post-deploy candidate `/catalog` probe (via `Cloudflare-Workers-Version-Overrides`)
confirms exact frozen prices, byte-for-byte unchanged from the pre-deploy baseline:

```
company_evidence_graph.v2  = 0.0312 USD
web_context_verified.v2    = 0.008  USD
document_evidence_json.v2  = 0.0098 USD
verify_agent_output.v2     = 0.017  USD
```

`ECONOMIC_DRIFT_FROM_D2 = NO`.

## 15. Settlement ownership

Re-confirmed via the full `x402-service-route.test.ts` pass (§6) and prior source
audit: `PUBLIC_API_SETTLE_CALLSITES = 0`, `DEDICATED_WORKFLOW_SETTLE_CALLSITES = 1`,
`TOTAL_PRODUCTION_SETTLE_CALLSITES = 1`. No regression — this checkpoint's diff never
touched settlement code.

## 16. Public diagnostic leak static audit

Repeated from D3 (§17 of that report), unaffected by deployment: the only
introduction point (`x402-service.ts`'s `executor_rejected` branch) is corrected;
`error_detail`/`limitations` are read only in `paid-continuation-workflow.ts`
(generation) and a comment-only type declaration in `x402-service.ts`.
`PUBLIC_DIAGNOSTIC_LEAK_PATHS = 0`.

## 17. Dry-run

Both Workers dry-ran clean immediately before the real deploy (§6 table).
`D2_DEPLOYMENT_DRY_RUN = PASS`.

## 18. Mutation count freeze

```
MAX_PUBLIC_WORKER_DEPLOYMENTS   = 1
MAX_HOST_WORKER_DEPLOYMENTS     = 1
MAX_TOTAL_DEPLOYMENTS           = 2
MAX_TRAFFIC_MUTATIONS           = 1 (the public API 0%-candidate slot only; production's 100% stays pinned in the same command)
MAX_SECRET_MUTATIONS            = 0
MAX_D1_MUTATIONS                = 0
MAX_EXTERNAL_RESOURCE_CREATIONS = 0
```

## 19–20. Deployment execution and readback

**Public API:**
1. `wrangler versions upload` → new version `ade29047-9028-4f2a-873d-ea3c24e0b2ab`
   (tag `sun1222c-r4-d3-deploy-retry`), zero traffic at upload time.
2. `wrangler versions deploy db7054c9@100 ade29047@0` → confirmed:
   `Deployed siteborne-utility-edge version db7054c9-76ee-4830-aabe-8a4542261b6a at
   100% and version ade29047-9028-4f2a-873d-ea3c24e0b2ab at 0%`.

**Host:**
1. `wrangler deploy --config wrangler.paid-continuation-runtime.toml` → new version
   `89bc86b2-b09a-4ec6-831d-15f5176539cc`, deployed at 100% (single-version Worker, no
   traffic-split concept, matching every prior host deploy this session).

**Authoritative readback** (`wrangler deployments list`, both Workers, post-deploy):

```
PUBLIC API: (100%) db7054c9-76ee-4830-aabe-8a4542261b6a
            (0%)   ade29047-9028-4f2a-873d-ea3c24e0b2ab  [tag: sun1222c-r4-d3-deploy-retry]
HOST:       (100%) 89bc86b2-b09a-4ec6-831d-15f5176539cc
```

No third version on either Worker. `DEPLOYMENT_READBACK = PASS`.

| Target | Command class | Result | Version ID | Timestamp |
|---|---|---|---|---|
| siteborne-utility-edge | versions upload | success | ade29047-9028-4f2a-873d-ea3c24e0b2ab | 2026-09-08T04:11:54Z |
| siteborne-utility-edge | versions deploy (100/0 split) | success | db7054c9 @100 / ade29047 @0 | 2026-09-08T04:12:0xZ |
| siteborne-paid-continuation-runtime | deploy | success | 89bc86b2-b09a-4ec6-831d-15f5176539cc | 2026-09-08T04:12:16Z |

`PRODUCTION_DEPLOYMENTS_ACTUAL = 2`.

## 21. Traffic safety

```
CANDIDATE_TRAFFIC          = 0%
PRODUCTION_TRAFFIC         = 100% (db7054c9, unchanged)
TRAFFIC_STATE_MATCHES_D2   = YES
```

## 22. Non-economic candidate probes

Via `Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="ade29047-9028-4f2a-873d-ea3c24e0b2ab"`
against the live `workers.dev` origin:

```
/health                       -> 200
/ready                        -> 200
/catalog                      -> 200
/.well-known/agent-card.json  -> 200
/openapi.json                 -> 200
/.well-known/jwks.json        -> 200
```

`CANDIDATE_PUBLIC_GATES = PASS`.

## 23. D3 live security-contract probe

The `executor_rejected` response path is reachable only after a real verified
payment (verify → lock → route → execute → reject). No safe, non-economic way exists
to exercise it live without manufacturing payment material, which this checkpoint
does not authorize.

`D3_LIVE_PUBLIC_SECURITY_PROBE = NOT_EXECUTED_ECONOMIC_BOUNDARY` — relying instead on
the integration-level proof already established: 37/37 `x402-service-route.test.ts`
(including both `deriveErrorDetail` branches) plus the temporary-mutation proof in D3
(§10 of that report) that the exact deployed source, when the passthrough is
reintroduced, fails these same tests.

## 24–25. MCP / A2A candidate-specific behavior

Not applicable to this checkpoint's diff — R4 and D3 touch only
`x402-service.ts`'s `executor_rejected` response construction and
`paid-continuation-workflow.ts`'s internal `error_detail` generation; neither MCP
legacy-mode nor A2A skill-normalization code was changed. Both are already covered
generically by the passing `mcp:check`/`a2a:check` gates (§6) and by the candidate's
own `/.well-known/agent-card.json` (200) and `/openapi.json` (200) probes (§22).

```
CANDIDATE_MCP_INTEROP    = NOT_INCLUDED
CANDIDATE_A2A_DISCOVERY  = NOT_INCLUDED
```

## 26. Service activation truth

Candidate `/catalog` probe confirms all four v2 services present with unchanged,
correct pricing (§14). No `ACTIVE=YES` / executor-unavailable mismatch introduced —
this checkpoint's diff never touches service-activation or executor-availability
code.

`CANDIDATE_SERVICE_ACTIVATION_COHERENCE = PASS`.

## 27. Zero economic activity

```
INTENTIONAL_402_REQUESTS                       = 0
PAYMENT_AUTHORIZATIONS_CREATED                 = 0
SIGNER_CALLS                                   = 0
PAID_POSTS                                     = 0
FACILITATOR_VERIFY_CALLS_CREATED_BY_RETRY      = 0
FACILITATOR_SETTLE_CALLS_CREATED_BY_RETRY      = 0
CHAIN_TRANSACTIONS_CREATED_BY_RETRY            = 0
ECONOMIC_EFFECT_USDC                           = 0
```

All probes in §22 hit unauthenticated, non-paid, GET-only surfaces.

## 28. Mutation ceiling compliance

```
TRAFFIC_MUTATIONS_ACTUAL            = 1  (<= MAX_TRAFFIC_MUTATIONS = 1)
SECRET_MUTATIONS_ACTUAL             = 0  (<= 0)
D1_MUTATIONS_ACTUAL                 = 0  (<= 0)
EXTERNAL_RESOURCE_CREATIONS_ACTUAL  = 0  (<= 0)
PRODUCTION_DEPLOYMENTS_ACTUAL       = 2  (<= MAX_TOTAL_DEPLOYMENTS = 2)
```

No mutation class outside the reconstructed D2 manifest occurred.

## 29. Deployment retry pass gate

All preconditions of §29 are satisfied: manifest reconstructed, D3 included,
gates clean, security contract preserved, no public diagnostic leak, live baseline
coherent (no material drift), exact authorized deployment count (2), authoritative
readback PASS, traffic matches D2 (0% candidate, 100% production unchanged),
non-economic probes PASS, MCP/A2A not applicable, service activation truthful, zero
economic activity, zero unauthorized mutations.

`SUN1222C_R4_DEPLOYMENT_RETRY = PASS`.

## 30. Next checkpoint

The candidate (`ade29047`) is now qualified at 0% traffic with R4+D3 live and
non-economically verified. No source/regression/deployment work remains outstanding
for this fix. The next step in the original SUN-1222C plan is the real paid
qualification of `company_evidence_graph.v2` this fix was built to make diagnosable —
that is a real economic action and requires its own standalone financial
authorization.

`FRESH_STANDALONE_FINANCIAL_AUTHORIZATION_REQUIRED = YES`.
