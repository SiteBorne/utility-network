# SUN-1222C Cross-Track Production State Reconciliation

**Checkpoint class:** read-only reconciliation/evidence only. Zero deploys, zero
traffic mutation, zero var/secret mutation, zero payment, zero settlement.

## 0. Why this checkpoint exists

The prior checkpoint (deployment-dependency-and-mTLS-truthfulness-remediation)
discovered live production state — an existing traffic split and ADR-0055 vars
already live — that this conversation's own working memory had no record of.
This report traces that state to its actual origin: a fully-evidenced, already
-authorized prior release track (**R4/R5/R6**) that exists in this repo's own
git history and `docs/reports/`, not an unknown or unauthorized actor.

## 1. Integrity

```
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=d1176dd679cde58422b7818c5ee4da7e054119e5
WORKING_TREE=CLEAN (only the known untracked runbook doc)
```

## 2. R4/R5/R6 repository evidence located

All of the following are real, committed evidence reports already in this
repo (not reconstructed, not inferred):

| Checkpoint | Report | Commit |
|---|---|---|
| R4-D1..D17 | `docs/reports/SUN-1222C-R4-*.md` (17 reports) | `8d8b973`..`c1e6cd4` |
| R4-DEPLOYMENT-RETRY | `docs/reports/SUN-1222C-R4-deployment-retry.md` | `0dc8f03` |
| R5 | `docs/reports/SUN-1222C-R5-candidate-activation-and-harness-target-diagnosis.md` | `f05f065` |
| R6 | `docs/reports/SUN-1222C-R6-activation-remediation.md` | `cad721c` (harness fix), `0e543e7` (evidence report) |

This was always discoverable via `git log --all --grep` and `docs/reports/` —
it was missing from this conversation's own carried-forward context, not from
the repository.

## 3. Release lineage reconstructed

```
R4_SOURCE_COMMIT        = 17d7ba7 (SUN-1222C-R4-D3), later superseded within
                          R4 itself through D4-D17 (see below)
R4_PUBLIC_API_VERSION   = db7054c9 (h2bf5-final-candidate — actually predates
                          R4's own D-series; R4 operated on the paid-runtime
                          host almost exclusively, see §15)
R4_PAID_RUNTIME_VERSION = d62011b9-6219-47e1-8cf9-5006776cfb50 (source 5365a3c,
                          D10 — the last host redeploy in the R4 series;
                          D11-D17 performed no further host redeploys, see §15)

R5_SOURCE_COMMIT        = read-only diagnosis, no source change (f05f065)
R5_PUBLIC_API_VERSION   = diagnosed ade29047 (defective candidate, now retired
                          from traffic, retained immutably in version history)
R5_FAILURE_OR_CHANGE    = DEPLOYMENT_PROCEDURE_ONLY — R4-DEPLOYMENT-RETRY's
                          bare `wrangler versions upload` (no `--var`
                          overrides) dropped 10 activation vars that every
                          prior real candidate had supplied at upload time.
                          wrangler.toml's own committed `[vars]` comment
                          documents this exact behavior as intentional
                          (fail-closed by design). Zero source defect.

R6_SOURCE_COMMIT        = cad721c7404d890b2ced0d5111289362b9a3aa03
R6_PUBLIC_API_VERSION   = d3472f58-f578-4a8f-992b-0d0956c9b561
R6_CANDIDATE_STATUS     = qualified, immutable, 0% traffic — never promoted
                          to 100%, no real payment taken
```

`R6_RELEASE_STATE = QUALIFICATION_CANDIDATE` — d3472f58 is fully proven
(all 4 v2 services activation/ready, MCP/A2A/discovery coherence, economics
byte-identical to governance limits) under an explicit, standalone,
first-person authorization ("R6_AUTHORIZATION=PRESENT"), but was deliberately
left at 0% traffic pending a future, separately-authorized cutover decision.
Live readback in this checkpoint confirms **nothing has changed since**:
traffic is still exactly `db7054c9@100% / d3472f58@0%`.

## 4. Version → source commit mapping (verified, not inferred)

```
DB7054C9_SOURCE_COMMIT = 8f25a29 / 4b1363c lineage (SUN-1221E6R-H2BF5-FINAL,
                         "cross-script Workflow candidate, dedicated host
                         qualified" — predates the R4 series entirely)
D3472F58_SOURCE_COMMIT = cad721c7404d890b2ced0d5111289362b9a3aa03
D62011B9_SOURCE_COMMIT = 5365a3c (SUN-1222C-R4-D10)
```

Ancestry (git merge-base, read-only):

```
git merge-base --is-ancestor cad721c HEAD    -> YES (ancestor)
git merge-base --is-ancestor 5365a3c HEAD    -> YES (ancestor, confirmed
                                                 earlier checkpoint)
git merge-base --is-ancestor cad721c ac642cb -> YES (cad721c precedes the
                                                 PCC fix, same line)
git merge-base --is-ancestor ac642cb cad721c -> NO
```

**All three live/candidate source commits are clean, linear ancestors of
current HEAD.** This is a single, non-diverging line of history — current
HEAD is strictly *ahead* of everything currently live or candidate, on both
Workers. Nothing live is on an orphaned or conflicting branch.

## 5. Public API — authoritative var inventory

`wrangler versions view` on both, read-only:

**Baseline (`db7054c9`, 100%)** — the September-1 H2BF5-FINAL release,
predates the `company_evidence_graph.v2`/document-v2/etc. service family
entirely. 6 base vars only (`PCC_VERSION`, `ENVIRONMENT`, `LOG_LEVEL`,
`AGENT_CARD_SIGNING_KEY_ID`, `NVM_ENVIRONMENT`, `SELLER_WALLET_ADDRESS`).

**R6 candidate (`d3472f58`, 0%)** — the 6 base vars plus the 10 restored
activation vars (from R6 report §4-6, reproduced exactly, live-confirmed):

```
PAID_ROUTES_ENABLED=true
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
PAYMENT_ENVIRONMENT=production
COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=true
WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true
DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED=true
VERIFY_V2_CDP_ROUTE_ENABLED=true
DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED=true
```

```
COMMON_VARS         = the 6 base vars (identical values on both)
BASELINE_ONLY_VARS  = none
CANDIDATE_ONLY_VARS = the 10 vars above
VALUE_DIFFERENCES   = none among common vars
```

## 6. Paid runtime — authoritative var inventory

`d62011b9` (live, 100%) vars: `SELLER_WALLET_ADDRESS`, `PAYMENT_ENVIRONMENT`,
`PRODUCTION_ENABLED`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED` (5 vars) + 11 named secrets.

```
PAID_RUNTIME_LIVE_VARS        = 5 vars listed above (all ADR-0055 gates true)
PAID_RUNTIME_LOCAL_VARS       = identical 5 vars, identical values
                                 (wrangler.paid-continuation-runtime.toml
                                 [vars], set under SUN-1221E6R-H2BF5-FINAL
                                 explicit authorization per its own comment)
PAID_RUNTIME_LIVE_ONLY_VARS   = NONE
PAID_RUNTIME_LOCAL_ONLY_VARS  = NONE
PAID_RUNTIME_VALUE_MISMATCHES = NONE
```

Exact parity. `PAID_RUNTIME_ADR0055_VARS_ALREADY_LIVE=YES` reconfirmed.

## 7. Var authority classification — public API

| Var | Baseline | R6 candidate | Local wrangler.toml | Authority class | Evidence | Safe future value |
|---|---|---|---|---|---|---|
| `PCC_VERSION`,`ENVIRONMENT`,`LOG_LEVEL`,`AGENT_CARD_SIGNING_KEY_ID`,`NVM_ENVIRONMENT`,`SELLER_WALLET_ADDRESS` | present | present | present | A. REQUIRED_LIVE_PRODUCTION_BASELINE | wrangler.toml `[vars]` lines 69-91, matches both live versions | keep as-is |
| `PAID_ROUTES_ENABLED` | absent | `true` | absent | B. APPROVED_R6_CANDIDATE_ONLY | R6 report §4-6, R6_AUTHORIZATION=PRESENT | `true` (re-apply at upload) |
| `PRODUCTION_ENABLED` | absent | `true` | absent | B | same | `true` |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | absent | `true` | absent | B | same | `true` |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | absent | `true` | absent | B | same | `true` |
| `PAYMENT_ENVIRONMENT` | absent | `production` | absent | B | same | `production` |
| `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` | absent | `true` | absent | B | same | `true` |
| `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` | absent | `true` | absent | B | same | `true` |
| `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` | absent | `true` | absent | B | same | `true` |
| `VERIFY_V2_CDP_ROUTE_ENABLED` | absent | `true` | absent | B | same | `true` |
| `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED` | absent | `true` | absent | B | same | `true` |

No `C` (governance-pending), `D` (deprecated), or `E` (unknown) vars found —
every observed var traces to explicit evidence.

## 8. Document-v2 reconciliation (§8 of the checkpoint prompt)

```
DOCUMENT_V2_R6_AUTHORITY         = CANDIDATE_ONLY (current traffic state:
  sits on d3472f58 @ 0%, never promoted) — but the *value itself* carries
  PRODUCTION_APPROVED lineage: it is a byte-identical restoration of the
  same var, at the same value, that was already live and authorized on
  `a064477f` (the immediately-prior real production candidate) before
  R4-DEPLOYMENT-RETRY's bare upload accidentally dropped it (R5 §13, "not a
  source or wrangler.toml regression"). R6's own report opens with
  "R6_AUTHORIZATION=PRESENT — standalone first-person authorization
  received." This is not an accidental config carry-forward; it is a
  deliberate, human-authorized restoration, currently held at candidate
  (0%) traffic pending cutover.
DOCUMENT_ARTIFACT_UPLOAD_R6_AUTHORITY = CANDIDATE_ONLY (identical reasoning
  and evidence trail — same 10-var restoration, same authorization).
COMPANY_V2_R6_AUTHORITY               = CANDIDATE_ONLY (same).
```

None of these were "normalized from candidate presence into authorization" —
each is backed by an explicit `R6_AUTHORIZATION=PRESENT` statement plus a
named prior production-approved reference value (`a064477f`).

## 9. Authoritative production config source model

```
PRODUCTION_CONFIG_AUTHORITY_MODEL = C
  (candidate deployment process injects/freezes activation vars separately,
  per-candidate, via `--var` overrides at `wrangler versions upload` time —
  never committed to wrangler.toml)
```

Every production var traces to one of:
- **repo config** (`wrangler.toml [vars]`) — the 6 base vars only.
- **candidate freeze manifest** (a named evidence report's var table, e.g.
  R6 §4-6) — the 10 activation vars, for whichever version currently holds
  them.
- **Cloudflare version metadata** (`wrangler versions view`) — the
  ground truth for what is actually live at any moment; must always be
  read before deploying, never assumed from the repo file alone.

## 10. R6 var freeze artifact

```
R6_VAR_FREEZE_ARTIFACT = docs/reports/SUN-1222C-R6-activation-remediation.md
                         (§4-6 table)
R6_FROZEN_VAR_SET       = the exact 10 vars in §7 above, values as shown
```

## 11. Why local wrangler.toml omits these vars

```
PUBLIC_WRANGLER_VAR_OMISSION_INTENT = FAIL_CLOSED_BY_DESIGN
```

The file's own comment (SUN-1205 checkpoint K, lines 81-88) states this
explicitly: "deliberately absent from the frozen pre-upload candidate. Every
consumer is fail-closed on absence... An upload of this candidate cannot
activate paid routes or authorize economics." R5 and R6 both independently
re-confirmed this design intent empirically. **Plain `wrangler deploy`
without preserving/injecting the live activation vars is categorically
unsafe** — it would silently delete all 10 already-authorized vars from
whichever version is live at deploy time.

## 12. Recommended safe deployment mechanism

```
RECOMMENDED_PUBLIC_API_DEPLOYMENT_MECHANISM = C
```

**Why:** this is the exact, already-proven, already-audited mechanism this
repo has used for every real candidate to date (`a064477f`, R5's diagnosis of
`ade29047`, R6's `d3472f58`): `wrangler versions upload` (never bare `deploy`)
with explicit `--var` overrides matching the frozen 10-var set from §10,
producing a new immutable version at 0% traffic, followed by a separate,
explicit `wrangler versions deploy <old>@<split> <new>@<split>` traffic
decision. This:
- cannot delete live activation vars (upload only adds a new version; it
  never touches the currently-live version's vars);
- cannot accidentally activate anything beyond the frozen, named set (no
  bare upload, no unreviewed vars);
- is deterministic and auditable (every real candidate to date has its own
  named evidence report with the exact var table);
- is rollback-safe (old version remains immutable and at 100% until an
  explicit traffic-split command is run);
- preserves the existing 0%/100% candidate-qualification pattern this repo
  already uses.

`wrangler deploy --keep-vars` (option A) was considered but rejected: it is
not the mechanism this repo's own release history actually uses, and `deploy`
(vs. `versions upload` + `versions deploy`) collapses upload and traffic-cutover
into one step, removing the qualify-at-0%-first pattern R5/R6 both depended on
to catch this exact class of defect before it reached production traffic.

## 13. Do not destroy the existing 0% candidate

```
CAN_CURRENT_PCC_WORK_BE_MERGED_INTO_EXISTING_R6_CANDIDATE = REQUIRES_NEW_CANDIDATE
```

`d3472f58` is an immutable Cloudflare Worker version — it cannot be edited in
place. Current HEAD is a strict, non-diverging descendant of `d3472f58`'s
source (`cad721c`), so no work is at risk of being lost; a **new** candidate
version built from current HEAD, carrying the same 10 frozen vars, is the
correct continuation — exactly the same pattern R6 itself used when it
superseded `ade29047` (retired from traffic, retained immutably in version
history, never deleted). `d3472f58` must not be promoted, deleted, or
overwritten by this or any future checkpoint in this reconciliation; it stays
exactly where it is until a future, separately-authorized cutover checkpoint
addresses it directly.

## 14. Candidate lineage merge analysis

`git log --oneline cad721c..HEAD` = 35 commits. Grouped:

| Group | Commits | Classification |
|---|---|---|
| R4-D4 through D17 (paid-runtime hardening, settlement-alert Worker, workflow-host-entrypoint fixture fix) | `2a3e29e`..`c1e6cd4` | Already released independently via R4's own checkpoint chain, to `siteborne-paid-continuation-runtime` and `siteborne-settlement-alert` respectively (see §15) — not new public-API content, `REQUIRES_SEPARATE_RELEASE` (already done) for those Workers |
| MCP pre-cutover remediation, payment-design correction, wire carriers, Architecture C, four-service acceptance, MCP/fourth-service diagnosis | `f3eec3c`..`5bdc7b4` | `SAFE_TO_INCLUDE` — public-API/MCP-adapter functional code, not yet in any live or candidate public-API version (predates `d3472f58`'s freeze at `cad721c`) |
| PCC governance decision + wire-result implementation | `a76142e`, `ac642cb` | `SAFE_TO_INCLUDE` — the intended deployment payload of this whole reconciliation; touches `x402-service.ts`/`x402-mcp-adapter.ts` response mapping (public API) and `paid-continuation-workflow.ts` (paid runtime) |
| Agent Trust 100 design + implementation (mTLS types/schema) | `c8518b8`, `106b828` | `SAFE_TO_INCLUDE` — source/schema only, zero live routes wired, gated |
| mTLS provisioning plan | `f450bf0` | `DOC_ONLY` |
| x402 baseline test-assertion disposition | `cf0a113` | `TEST_ONLY` |
| Deployment-dependency + mTLS-truthfulness fix | `d1176dd` | `SAFE_TO_INCLUDE` — fixes the real Agent Card truthfulness bug (unconditional `mtls` scheme), fail-closed behind `MTLS_PRODUCTION_ACTIVE` |

`CURRENT_HEAD_DELTA_FROM_R6_SOURCE` = all of the above; a **new** public-API
candidate from current HEAD is not simply "redeploy `d3472f58`" — it carries
materially more functional content (MCP wiring, PCC wire-result shape, mTLS
truthfulness gate) and needs its **own** fresh qualification pass (four-service
activation proof + MCP/A2A/discovery coherence + PCC wire-shape proof),
analogous to what R6 did for `d3472f58`, before any traffic decision.

## 15. Paid runtime R4 lineage reconciliation

```
git diff --stat 5365a3c c1e6cd4 -- \
  apps/edge-api/src/control-plane/workflows/ \
  apps/edge-api/src/workflow-host-entrypoint.ts \
  apps/edge-api/wrangler.paid-continuation-runtime.toml
=> (empty — zero file changes)

git diff --stat 5365a3c HEAD -- wrangler.paid-continuation-runtime.toml
=> (empty — zero changes)
```

**Confirmed: R4-D11 through D17 made zero changes to paid-runtime source or
config.** (D12/D14's "settlement alert Worker" is a separate Worker,
`siteborne-settlement-alert`, deployed independently — confirmed live,
version `8fe32c69` @ 100%, most recent change 2026-09-09, out of scope for
this reconciliation and untouched by it.) The **only** functional delta
between what is live (`d62011b9`, source `5365a3c`) and current HEAD is
`ac642cb`'s `PCC_FIX`, confirmed by that commit's own message: "One shared
fix boundary... `paid-continuation-workflow.ts`."

```
PAID_RUNTIME_DELTA_FROM_LIVE = exactly ac642cb (PCC DurableCachedResult.body
  shape change). No other functional paid-runtime source or config changes
  are bundled.
```

## 16. Reconciled safe deployment sequence

Given: existing 0%-candidate governance pattern must be preserved (§13), a
new public-API candidate is required (§14), and the paid-runtime delta is a
single, already-audited fix (§15):

```
RECONCILED_SAFE_DEPLOYMENT_SEQUENCE =

1. Build a NEW public-API candidate from current HEAD via
   `wrangler versions upload` (not bare `deploy`) with the 10 frozen vars
   from §10 supplied via --var, producing version N1 @ 0% traffic.
   (d3472f58 remains untouched at 0%, db7054c9 remains untouched at 100%.)

2. Qualify N1 exactly as R6 qualified d3472f58: re-run the four-service
   activation/ready proof, MCP tools/list, A2A discovery, and additionally
   -- new to this candidate -- the PCC wire-result shape proof (REST/A2A/MCP
   all return the governed full PCC document) and the mTLS-truthfulness
   proof (Agent Card `securitySchemes.mtls` absent while
   MTLS_PRODUCTION_ACTIVE is unset/false).

3. Only after N1 passes qualification: paid-runtime deploy carrying
   ac642cb (single fix, already audited in §15), by the same reasoning
   already proven safe (public-API-first ordering avoids the
   already-proven `result: undefined` regression window for old public-API
   code reading the new PCC shape). This does not touch traffic on the
   public API.

4. Verify NEW_PUBLIC (N1, still @ 0%) + NEW_PAID compatibility.

5. Traffic/cutover decision for N1 (whether to promote to 100%, and what
   happens to d3472f58 -- promote together, retire, or hold) is explicitly
   OUT OF SCOPE for this reconciliation and requires its own, separately
   authorized checkpoint, exactly as R6's own report already stipulated
   ("next controlled payment requires a new standalone human financial
   authorization").
```

No execution performed. This sequence supersedes the prior isolated
"public API -> paid runtime" order only in that it now (a) uploads a new
*candidate* rather than assuming a from-scratch first deployment, and
(b) explicitly preserves `d3472f58` and defers all traffic/cutover decisions.

## 17. In-flight job policy

Nonterminal `payment_attempts.lifecycle_stage` set (authoritative, from
`packages/protocol-x402/src/lifecycle/stage.ts`):

```sql
SELECT lifecycle_stage, COUNT(*) AS n
FROM payment_attempts
WHERE lifecycle_stage IN (
  'acquired', 'verified', 'executed', 'settlement_pending',
  'settled_external', 'link_verified', 'settlement_failed'
)
GROUP BY lifecycle_stage;
```

`INFLIGHT_POLICY_REMAINS_ZERO_REQUIRED=YES` — unchanged, still required
before any future paid-runtime deployment step. No D1 query executed this
checkpoint (no deployment is being performed).

## 18. Config preservation simulation

Simulated (not executed) against the recommended mechanism (§12, model C):
`wrangler versions upload --var` supplies exactly the 6 base + 10 frozen vars
as a new, independent version; it does not read or delete any existing
version's vars (Cloudflare versions are immutable and additive). Live
`db7054c9`/`d3472f58` vars are untouched by construction, not merely by
careful flag usage.

```
PUBLIC_API_CONFIG_PRESERVATION_SIMULATION = PASS
WOULD_DELETE_LIVE_AUTHORIZED_VARS         = NO
WOULD_ENABLE_UNAUTHORIZED_CANDIDATE_VARS  = NO
WOULD_CHANGE_PAYMENT_ECONOMICS            = NO
```

## 19. mTLS truthfulness

```
MTLS_PRODUCTION_ACTIVE       = FALSE (unchanged; confirmed absent from both
                                live public-API versions' vars/secrets)
PCC_DEPLOY_MTLS_ADVERTISEMENT = NO
```

No mTLS provisioning performed or proposed by this checkpoint.

## 20. Settlement invariant (unchanged, reconfirmed)

```
PUBLIC_API_SETTLE_CALLSITES      = 0
MCP_ADAPTER_SETTLE_CALLSITES     = 0
DEDICATED_WORKFLOW_SETTLE_CALLSITES = 1
TOTAL_PRODUCTION_SETTLE_CALLSITES  = 1
```

## 21. Zero mutation accounting

```
PRODUCTION_DEPLOYMENTS=0  TRAFFIC_MUTATIONS=0  VAR_MUTATIONS=0
SECRET_MUTATIONS=0  D1_WRITES=0  DNS_MUTATIONS=0  ROUTE_MUTATIONS=0
WAF_MUTATIONS=0  CERTIFICATE_MUTATIONS=0
LIVE_PAID_REQUESTS=0  REAL_PAYMENT_SIGNING_ACTIONS=0  REAL_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0  FACILITATOR_SETTLE_CALLS=0  REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0  ECONOMIC_EFFECT_USDC=0
```

All Cloudflare commands run this checkpoint were `wrangler deployments
list/status` and `wrangler versions view` (read-only) plus local, read-only
`git`/`grep`/`diff` commands. No `deploy`, `versions upload`, `versions
deploy`, `rollback`, `secret put`, or D1 write was executed.

## Final packet

```
SUN1222C_CROSS_TRACK_PRODUCTION_STATE_RECONCILIATION = READY_FOR_RECONCILED_DEPLOYMENT_PLAN
HEAD = d1176dd679cde58422b7818c5ee4da7e054119e5

R4_RELEASE_STATE = ACTIVE_BASELINE (closed, D17 final integrity audit PASS)
R5_RELEASE_STATE = ABANDONED (diagnosis only; ade29047 retired, superseded by R6)
R6_RELEASE_STATE = QUALIFICATION_CANDIDATE

DB7054C9_SOURCE_COMMIT = H2BF5-FINAL lineage (8f25a29/4b1363c), pre-R4
D3472F58_SOURCE_COMMIT = cad721c7404d890b2ced0d5111289362b9a3aa03
D62011B9_SOURCE_COMMIT = 5365a3c (SUN-1222C-R4-D10)

PUBLIC_API_BASELINE_VARS   = 6 base vars (see §5)
PUBLIC_API_R6_CANDIDATE_VARS = 6 base + 10 activation vars (see §5, §7)
PAID_RUNTIME_LIVE_VARS     = 5 vars, all ADR-0055 gates true (see §6)

R6_VAR_FREEZE_ARTIFACT = docs/reports/SUN-1222C-R6-activation-remediation.md
R6_FROZEN_VAR_SET      = 10 vars (see §10)

PRODUCTION_CONFIG_AUTHORITY_MODEL = C

DOCUMENT_V2_R6_AUTHORITY              = CANDIDATE_ONLY (production-approved value, not yet promoted)
DOCUMENT_ARTIFACT_UPLOAD_R6_AUTHORITY = CANDIDATE_ONLY (same)
COMPANY_V2_R6_AUTHORITY                = CANDIDATE_ONLY (same)

PUBLIC_WRANGLER_VAR_OMISSION_INTENT = FAIL_CLOSED_BY_DESIGN

RECOMMENDED_PUBLIC_API_DEPLOYMENT_MECHANISM = C

CAN_CURRENT_PCC_WORK_BE_MERGED_INTO_EXISTING_R6_CANDIDATE = REQUIRES_NEW_CANDIDATE

CURRENT_HEAD_DELTA_FROM_R6_SOURCE = 35 commits, see §14 table
PAID_RUNTIME_DELTA_FROM_LIVE      = exactly ac642cb (PCC fix), confirmed via
                                     empty diff for all other D11-D17 paths

RECONCILED_SAFE_DEPLOYMENT_SEQUENCE = see §16 (new public-API candidate ->
  qualify -> paid-runtime deploy -> verify -> defer cutover)

INFLIGHT_POLICY_REMAINS_ZERO_REQUIRED = YES

PUBLIC_API_CONFIG_PRESERVATION_SIMULATION = PASS
WOULD_DELETE_LIVE_AUTHORIZED_VARS = NO
WOULD_ENABLE_UNAUTHORIZED_CANDIDATE_VARS = NO

MTLS_PRODUCTION_ACTIVE = FALSE

PUBLIC_API_SETTLE_CALLSITES = 0
MCP_ADAPTER_SETTLE_CALLSITES = 0
DEDICATED_WORKFLOW_SETTLE_CALLSITES = 1
TOTAL_PRODUCTION_SETTLE_CALLSITES = 1

PRODUCTION_DEPLOYMENTS=0  TRAFFIC_MUTATIONS=0  VAR_MUTATIONS=0
SECRET_MUTATIONS=0  D1_WRITES=0

REAL_PAYMENTS=0  REAL_SETTLEMENTS=0  ECONOMIC_EFFECT_USDC=0

RECONCILIATION_EVIDENCE_COMMIT_SHA=<set at commit time, see chat response>
COMMIT_REACHABLE_FROM_MAIN=YES (post-commit)
WORKING_TREE=CLEAN (post-commit)

NEXT_REQUIRED_CHECKPOINT = SUN-1222C-RECONCILED-R6-PCC-DEPLOYMENT-PLAN
```

Do not deploy. Do not change traffic. Do not modify vars. Do not modify
secrets. Do not promote `d3472f58`. Do not activate/deactivate document-v2.
Do not perform payment. Do not settle.
