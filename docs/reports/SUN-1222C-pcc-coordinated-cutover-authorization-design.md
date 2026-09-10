# SUN-1222C PCC Coordinated Cutover — Authorization Design

**Checkpoint class:** governance/design only. Zero uploads, zero traffic
mutations, zero paid-runtime deploys, zero var/secret mutations, zero
payments, zero settlements. Every command below is a **future, unexecuted**
proposal pending explicit human authorization at the granularity defined in
§13/§30.

## 0. Repository integrity

```
BRANCH=main
HEAD=9a8e6f9f96c4bde6fa7169ef569b65f5222ac0ba
WORKING_TREE=CLEAN
PLAN_COMMIT_EXISTS=YES
PLAN_COMMIT_REACHABLE=YES
```

## 1. Compatibility matrix — reconfirmed from code, not prose

| Pair | Public consumer expects | Paid producer emits | Result |
|---|---|---|---|
| A. OLD_PUBLIC + OLD_PAID | `body.output` (flat envelope) | flat envelope with `.output` | **SAFE** |
| B. NEW_PUBLIC + OLD_PAID | full PCC doc OR flat envelope (NEW_PUBLIC's read path handles both — verified `x402-service.ts` post-`ac642cb` unwraps PCC-shaped `durableEvidence.pcc` when present, falls back to legacy `.output` otherwise) | flat envelope with `.output` | **SAFE** |
| C. OLD_PUBLIC + NEW_PAID | `body.output` | full PCC document, no `.output` field | **INCOMPATIBLE — proven** |
| D. NEW_PUBLIC + NEW_PAID | full PCC doc | full PCC document | **SAFE** |

`PAIR_C_INCOMPATIBILITY_PROVEN=YES` — `db7054c9`'s bundled source predates
`cad721c`/`ac642cb` entirely (tagged `h2bf5-final-candidate`, created
2026‑09‑01, seven days before the PCC governance change). Its
`x402-service.ts`/`x402-mcp-adapter.ts` read `body.output`; the new paid
runtime's `DurableCachedResult.body` is the governed PCC document, which has
no `.output` field. Result for an already-paid caller: `result: undefined`.
A same-object shim (emit both shapes in one document) is **not available**:
`contracts/releases/2.0.0` requires `additionalProperties: false` at the PCC
document's own top level (confirmed directly in
`contracts/releases/2.0.0/openapi/service-contracts.openapi.json` and
`COMPATIBILITY_REPORT.json`), and `db7054c9` is an immutable already-uploaded
version — it can never be changed to read a new field.

## 2. No-source-change dual-routing — ruled out

`PAID_CONTINUATION_WORKFLOW` is a single named Workflow binding
(`wrangler.toml:221`, `wrangler.paid-continuation-runtime.toml:149`).
Cloudflare Workflows deploy as a single script — there is no percentage/
version-split traffic model for Workflows the way Worker *versions* support
(this is precisely why the paid runtime uses a plain `wrangler deploy`, never
`versions upload` + `versions deploy`, unlike the public API). Every
`env.PAID_CONTINUATION_WORKFLOW.create()` call, regardless of which public-API
version issued it, always targets whichever Workflow script is currently
deployed — there is no binding-level or caller-aware version pinning
available without a source change.

```
DUAL_PAID_RUNTIME_ROUTING_AVAILABLE_WITHOUT_SOURCE_CHANGE=NO
```

Confirms §1 of the checkpoint's own analysis: the only source-unchanged path
requires `NEW_PUBLIC=100%, OLD_PUBLIC=0%` before the paid-runtime deploy.

```
PARTIAL_TRAFFIC_SUFFICIENT_BEFORE_PAID_DEPLOY=NO
PUBLIC_NEW_TRAFFIC_REQUIRED_BEFORE_PAID_DEPLOY=100%
PUBLIC_OLD_TRAFFIC_REQUIRED_BEFORE_PAID_DEPLOY=0%
```

## 3. Candidate upload is a separate, zero-effect stage

```
NEW_PUBLIC_CANDIDATE_REQUIRED=YES
NEW_PUBLIC_CANDIDATE_INITIAL_TRAFFIC=0%
NEW_PUBLIC_CANDIDATE_SOURCE=HEAD (9a8e6f9f96c4bde6fa7169ef569b65f5222ac0ba)
CANDIDATE_UPLOAD_PRODUCTION_EFFECT=NO_TRAFFIC_CODE_ARTIFACT_ONLY
ZERO_TRAFFIC_CANDIDATE_UPLOAD_SAFE_AS_SEPARATE_STAGE=YES
```
Uploading a new immutable version via `wrangler versions upload` never
touches existing versions, traffic splits, or vars on other versions — it is
a pure code-artifact stage, independent of everything that follows. Do not
reuse `d3472f58`; do not modify `db7054c9`.

## 4. 0%-traffic qualification gate (reuses R6's proven mechanism)

Health/ready, Agent Card, JWS crypto (`verifyAgentCardAgainstTrustedJwks`),
JWKS, A2A (SDK `SendMessage`, expect `TASK_STATE_INPUT_REQUIRED`), MCP
discovery, x402 unpaid `PaymentRequired`, structural PCC shape on REST/A2A/MCP,
all five service-family activation flags read back exactly, mTLS truthfulness
(`securitySchemes.mtls` absent while `MTLS_PRODUCTION_ACTIVE≠'true'`), and
settlement topology (`0/0/1/1`) — every check runs via `--dry-run`-equivalent
preview-URL requests against the 0%-traffic version, never via live-domain
routing. `REAL_PAYMENT=0, PROVIDER_CALL=0, SETTLEMENT=0` throughout.
```
ZERO_TRAFFIC_QUALIFICATION_COMPLETE_GATE=ALL_ABOVE_PASS
```

## 5. Staged public traffic canary (old paid runtime remains live throughout)

```
RECOMMENDED_PUBLIC_TRAFFIC_STAGES=5%, 25%, 50%, 100%
```
Four stages, not six: the candidate has already passed full 0%-traffic
functional qualification (§4) — canary stages exist to surface *live-traffic*
conditions (real client mixes, cache warm-up, rate limits, Cloudflare edge
behavior) that 0%-traffic preview requests cannot exercise, not to
re-discover functional bugs. Each stage:
```
DURATION_OR_REQUEST_GATE=  30 min minimum AND ≥500 requests observed
ERROR_RATE_GATE=           5xx rate on new version ≤ 5xx rate on db7054c9 (trailing 24h)
A2A_GATE=                  live SendMessage probe against new version returns TASK_STATE_INPUT_REQUIRED
MCP_GATE=                  live MCP discovery/list-tools against new version matches 0%-stage shape
x402_UNPAID_GATE=          live unpaid POST to a paid route on new version returns 402 PaymentRequired, unchanged body shape
ROLLBACK_TRIGGER=          any gate fails, or any operator-observed anomaly
```
```
PAID_RUNTIME_MUTATION_DURING_PUBLIC_CANARY=PROHIBITED
```
Because Pair B (NEW_PUBLIC + OLD_PAID) and Pair A (OLD_PUBLIC + OLD_PAID) are
both safe, mixed public traffic at any percentage is safe as long as the paid
runtime stays `d62011b9`.

## 6. 100% promotion gate and its true classification

```
PAID_RUNTIME_DEPLOYMENT_GATE_PUBLIC_TRAFFIC=NEW=100%,OLD=0%
PUBLIC_100_PERCENT_SHIFT_CLASS=PRODUCTION_CUTOVER
```
This is not "candidate qualification" — it is a real, user-facing production
cutover of the public API, and — critically — of every paid service family
whose activation flag rides along on the same candidate version.

## 7. Candidate-only features become production-active at 100% — UNCLEAR authority

The R6 frozen set (live-verified on `d3472f58`, inherited unchanged by the new
candidate) already has all five service-family flags at `'true'`:
`VERIFY_V2_CDP_ROUTE_ENABLED`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`,
`COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`,
`DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED`,
`DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED`.
```
PUBLIC_100_PROMOTION_ACTIVATES_R6_CANDIDATE_ONLY_FEATURES=YES
```
Activated features at 100%: `verify_agent_output.v2`, `web_context_verified.v2`,
`company_evidence_graph.v2`, `document_evidence_json.v2` (contingent on real
`ARTIFACTS`/`MODAL_DOCWORKER_*` bindings, absent today per
`index.ts`'s own comment — falls back to `unavailable: true` until those
exist), and the buyer-facing document-artifact-upload endpoint.

The prior R6 evidence report authorizes **candidate qualification at 0%
traffic** — it does not, on its own text, authorize promoting these five
paid-service families to live 100% production traffic for the first time.
```
R6_CANDIDATE_FEATURE_CUTOVER_AUTHORITY=UNCLEAR
```
This must be explicit, named content in the human authorization (§10 below),
not an implied side-effect of "the PCC cutover."

```
DOCUMENT_EVIDENCE_JSON_V2_AT_100_PERCENT=ACTIVE (falls back to unavailable:true — no ARTIFACTS/MODAL_DOCWORKER_* bindings live today)
DOCUMENT_ARTIFACT_UPLOAD_AT_100_PERCENT=ACTIVE
COMPANY_EVIDENCE_GRAPH_V2_AT_100_PERCENT=ACTIVE
```

## 8. Rollback while paid runtime is still OLD

```
PRE_PAID_DEPLOY_TRAFFIC_ROLLBACK_SAFE=YES
```
`new public → 0%`, `db7054c9 → 100%` is Pair A/B territory throughout —
reversible at any point before the paid-runtime deploy, via
`wrangler versions deploy PUBLIC_API_PRE_VERSION@100 --name siteborne-utility-edge --message "..."`.

## 9. Point of no simple public-only rollback

```
POST_PAID_DEPLOY_PUBLIC_ONLY_ROLLBACK_SAFE=NO
```
Once paid runtime is NEW, rolling public traffic back to `db7054c9` alone
recreates Pair C. Must be prominent in the operator runbook (it is — see the
runbook's own boxed warning).

## 10. Paid-job admission quiescence — existing mechanism found, no source change needed

`PAID_ROUTES_ENABLED` (`apps/edge-api/src/index.ts`, `production-payment.ts`,
`document-artifact-upload-route.ts`) is checked live, per-request, at the
entry of every one of the five paid POST handlers:
`env.PAID_ROUTES_ENABLED === 'true'` — literal string check, fail-closed.
When false, every paid route returns `c.notFound()` before any
`env.PAID_CONTINUATION_WORKFLOW.create()` call — byte-identical to
pre-activation behavior. It has zero effect on already-running Workflow
instances (those execute independently on the paid-continuation-runtime
Worker) and zero effect on health/Agent Card/JWKS/A2A/MCP/discovery surfaces.
It is already part of the R6-authorized activation set — using it as a
temporary admission gate is not a new capability, only a new *use* of an
existing, already-governed flag.

```
PAID_JOB_ADMISSION_QUIESCE_MECHANISM=PAID_ROUTES_ENABLED (existing var, temporary override on one short-lived version)
PAID_ROUTES_ENABLED_CAN_QUIESCE_NEW_PAID_JOBS=YES
QUIESCENCE_REMEDIATION_REQUIRED=NO
```

Mechanics: after NEW_PUBLIC reaches 100% and is stable, upload one additional
version (`NEW_PUBLIC_QUIESCED`) — identical source to the live 100% version,
`--var PAID_ROUTES_ENABLED:false` overriding only that one var — and deploy it
to 100% traffic. This is a genuine version/traffic mutation, itemized as its
own stage (S4 below), not folded silently into anything else.

## 11. Atomicity gap — eliminated by ordering, not claimed instantaneous

```
INFLIGHT_ZERO_TO_DEPLOY_RACE=NO (subject to one bounded settle-wait)
```
With `NEW_PUBLIC_QUIESCED` at 100%, no *new* Workflow instance can be created
— admission is closed before any in-flight count is read, so the D1 count is
monotonically non-increasing from that point. The one residual case is
ordinary deploy-tail latency: HTTP requests already admitted by the
*previous* (non-quiesced) 100% version can still complete and call
`.create()` for a few seconds after the traffic switch, before Cloudflare
fully drains that version's in-flight requests. Mitigation: wait 60 seconds
after `NEW_PUBLIC_QUIESCED` reaches 100% before starting the zero-inflight
poll — a bounded operational pause, not a new mechanism.

## 12. Settlement invariant — held at every stage

```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```
Unaffected by any stage below — settlement authority lives solely in
`paid-continuation-workflow.ts`, never in the public API or MCP adapter.

## 13. Authoritative coordinated sequence

```
S0. upload NEW_PUBLIC candidate @ 0% (source: HEAD, R6 frozen 10-var set, MTLS_PRODUCTION_ACTIVE unset/false)
S1. 0%-traffic qualification (§4) — full pass required
S2. staged public canary: 5% → 25% → 50% → 100%, OLD paid runtime throughout (§5)
S3. NEW_PUBLIC=100%, db7054c9=0%, d3472f58=0% — 100%-qualification gate (§6) — full pass required
S4. upload + deploy NEW_PUBLIC_QUIESCED @ 100% (PAID_ROUTES_ENABLED='false' override only) (§10)
S5. wait 60s settle, then poll D1 in-flight query to zero (7 nonterminal lifecycle stages)
S6. deploy paid-runtime PCC fix (plain `wrangler deploy`, capture PAID_RUNTIME_PRE_VERSION=d62011b9 first)
S7. qualify NEW_PUBLIC_QUIESCED + NEW_PAID (paid-route smoke test with a real x402-flow up to but not executing settlement, or at minimum: worker-to-worker binding health + PCC-shape structural check)
S8. upload + deploy NEW_PUBLIC (PAID_ROUTES_ENABLED='true' restored — the original, already-qualified 100% version, no new upload needed, redeploy its existing version ID) @ 100%
S9. STOP — no further automatic action
```

## 14. Failure matrix

| Case | Immediate action | Traffic action | Paid-runtime action | Rollback order | Stop condition |
|---|---|---|---|---|---|
| F1 candidate upload fails | abort | none (still 0%) | none | n/a | Wrangler error surfaced, fix and retry |
| F2 0% qualification fails | abort | none | none | n/a | any check in §4 fails |
| F3 first canary stage (5%) fails | halt canary | new→0%, old→100% | none | trivial (§8) | any gate in §5 fails |
| F4 mid-canary (25/50%) fails | halt canary | new→0%, old→100% | none | trivial (§8) | any gate in §5 fails |
| F5 100% promotion fails | halt | new→0%, old→100% | none | trivial (§8) | any check in §6 fails |
| F6 quiesce deploy (S4) fails | halt, paid routes remain open on last-good 100% version | no change needed (was already NEW=100%) | none | redeploy prior 100% version if quiesce version itself is broken | Wrangler error, or quiesce version fails health check |
| F7 in-flight never drains (stuck job) | investigate stuck `payment_attempts` row directly, do not force-deploy | none | none | n/a — do not proceed to S6 until resolved | drain exceeds a reasonable bound (operator judgment, e.g. 30 min) |
| F8 paid-runtime deploy command fails | halt | none | roll back paid runtime to `d62011b9` (no-op if deploy never took effect — confirm via `deployments status`) | 1. confirm paid runtime is `d62011b9`  2. confirm NEW_PUBLIC_QUIESCED still 100% | Wrangler error |
| F9 paid-runtime deploy succeeds, qualification (S7) fails | halt, do not restore paid admission | keep NEW_PUBLIC_QUIESCED @ 100% (admission stays closed) | rollback paid runtime → `d62011b9` via `wrangler rollback` | 1. paid runtime → `d62011b9`  2. verify NEW_PUBLIC + OLD_PAID healthy (Pair B)  3. restore NEW_PUBLIC (PAID_ROUTES_ENABLED=true) @ 100% | any check in S7 fails |
| F10 NEW/NEW pair has unexpected PCC behavior post-restore | halt, treat as production incident | keep NEW_PUBLIC @ 100% (public side is fine) | rollback paid runtime → `d62011b9` (creates a temporary Pair C window for any *new* paid attempt until public is also rolled back or fixed forward) | 1. paid runtime → `d62011b9` immediately  2. escalate — Pair C is now live until a forward/back decision is made; this is the one state this whole design exists to avoid reaching, treat as `BLOCKER_CHECKPOINT` | first anomalous PCC-shaped result observed live |
| F11 settlement ownership changes (any stage) | halt everything immediately | freeze at current state | freeze at current state | full incident response, not a rollback recipe | `settle-sole-ownership` invariant violated at any live check |
| F12 mTLS unexpectedly advertised (any stage) | halt, treat as truthfulness-gate regression | freeze | freeze | investigate `resolveMtlsProductionActive` resolution live | `securitySchemes.mtls` appears in a live Agent Card fetch while `MTLS_PRODUCTION_ACTIVE≠'true'` |

## 15. Recommended authorization boundaries

```
RECOMMENDED_AUTHORIZATION_BOUNDARIES=
  AUTHORIZATION A: upload NEW_PUBLIC candidate @0% + qualify (S0-S1) — low risk, reversible, no user-facing effect
  AUTHORIZATION B: staged public canary 5%→100% (S2-S3) — real user traffic, real production cutover of 5 paid-service families (§7) — needs its own explicit sign-off distinct from A
  AUTHORIZATION C: quiesce + drain + paid-runtime deploy + qualify + restore (S4-S8) — the only stage touching the paid runtime and real in-flight payment jobs — needs its own explicit sign-off distinct from A/B
```
```
RECOMMENDED_EXECUTION_CHECKPOINT_STRUCTURE=B (three separate checkpoints: candidate-upload, traffic-cutover, paid-runtime-deploy)
```
Rationale: A is reversible and inert; B is a real, irreversible-in-spirit
production cutover with its own distinct blast radius (5 paid-service
families, real end users) that deserves review on its own merits, separate
from the mechanical PCC-compatibility problem; C is the only stage that
touches money-adjacent state (in-flight payment jobs, the paid-runtime
Worker) and has its own distinct failure matrix (§14, F6-F12). Bundling all
three into one authorization would let compatibility mechanics quietly wave
through the two decisions (production feature cutover, live payment-runtime
mutation) that most need independent human attention.

## 16. Human authorization content (draft — for the operator to countersign at each boundary, not pre-approved here)

1. Uploads one new immutable public-API candidate version at 0% traffic (inert).
2. Approves a staged live-traffic public cutover: 5%→25%→50%→100%, replacing `db7054c9`.
3. Explicitly authorizes production activation (not just candidate qualification) of: `verify_agent_output.v2`, `web_context_verified.v2`, `company_evidence_graph.v2`, `document_evidence_json.v2` (currently falls back to `unavailable:true` — no live `ARTIFACTS`/`MODAL_DOCWORKER_*`), and the document-artifact-upload endpoint.
4. Confirms `db7054c9` reaches 0% traffic (fully superseded, not deleted).
5. Approves a temporary paid-admission quiesce (new short-lived 100% version with `PAID_ROUTES_ENABLED=false`) to safely drain in-flight jobs before the paid-runtime deploy.
6. Approves the paid-runtime PCC-fix deploy (`ac642cb`), once in-flight jobs reach zero.
7. Approves restoring paid-route admission once NEW_PUBLIC + NEW_PAID (Pair D) is qualified.
8. Confirms zero intentional test payments/settlements will be performed to validate any of the above — qualification uses unpaid/structural checks only; any real payment during this window is organic user/agent traffic, not test traffic.
9. Confirms `MTLS_PRODUCTION_ACTIVE` remains `FALSE`/absent throughout — no mTLS provisioning is part of this cutover.
10. Confirms this cutover excludes any legal-identity-binding work.
11. Acknowledges the failure matrix (§14) and, specifically, that F10 (post-restore NEW/NEW anomaly) is the one state this whole design exists to avoid, requiring escalation rather than a scripted rollback.

## 17. mTLS / security boundary — unchanged

```
MTLS_PRODUCTION_ACTIVE=FALSE
```
No mTLS provisioning, certificate issuance, or Agent Card `mutualTLS`
advertisement is part of this design.

## 18. Zero mutation accounting for this checkpoint

```
PRODUCTION_VERSION_UPLOADS=0
PRODUCTION_DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
ROLLBACKS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
D1_WRITES=0
REAL_TEST_PAYMENTS=0
REAL_PAYMENT_SIGNING_ACTIONS=0
REAL_TEST_PROVIDER_CALLS=0
REAL_TEST_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
```
