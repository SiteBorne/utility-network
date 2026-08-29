# SUN-1221A — Post-Release Stabilization + Next Paid Service Selection

Read-only production audit, evidence-integrity reconciliation, and next-slice
design only. No new service activation, no Worker upload, no deployment, no
traffic shift, no payment, no economic mutation.

## §1 — Q6 final evidence reconciliation

```
$ git rev-parse 05527c4
05527c40c5b872be0cdff2444a19fdc546d50f09
$ git status --short
(clean)
$ git rev-parse HEAD
05527c40c5b872be0cdff2444a19fdc546d50f09
```

`SUN1220Q6_EVIDENCE_COMMIT_SHA=05527c40c5b872be0cdff2444a19fdc546d50f09`. HEAD
matches; tree clean.

The committed Q6 report contains literal evidence for every required fact:
candidate ID (`de70bf98-f304-4d7f-b189-4ae2401041a0`), 100% read-back,
normal-production attribution PASS, `/ready`/catalog/service-detail/agent-card
truthfulness PASS, other-11-route and Nevermined isolation (404), exactly one
unpaid 402 with exact economic-contract match, zero agent economic actions,
a 3980.9s (~66.3 min, exceeding the 600s floor) observation window with zero
exceptions/zero unexpected 5xx, final preflight PASS, and
`ROLLBACK_PERFORMED=NO (not required)`. Nothing is absent.
`SUN1221A_STARTING_RELEASE_RECONCILIATION=NOT_BLOCKED`.

## §2 — Current production read-back

```
$ wrangler deployments list  (latest entry)
Created:     2026-08-29T03:25:43.517Z
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
```

`ACTIVE_DEPLOYMENT_VERSION_COUNT=1`,
`CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0`,
`CURRENT_PRODUCTION_TRAFFIC=100%` — unchanged since Q6, no drift, no
intervening deployment.

`pnpm production:preflight` → **PASS** (all 9 checks, identical to Q6's
post-promotion run). `CURRENT_PRODUCTION_PREFLIGHT=PASS`. No deployment
mutation performed.

## §3 — Safe current production health (normal routing only)

| Check | Result |
|---|---|
| `GET /health` | `200 {"status":"ok",...}` |
| `GET /ready` | `200`, `production_services_enabled:true`, stale blockers absent, unproven blockers preserved — identical to Q6 §3/§7 |
| `GET /catalog` | only `verify_agent_output.v2` `production_enabled:true`; all 7 others `false` |
| `GET /services/verify_agent_output.v2` | matches catalog exactly |
| `GET /.well-known/agent-card.json` | per-service `verify_agent_output.v2` → `productionEnabled:true`; all others `false`; top-level `productionEnabled:false` (known platform-scope flag, Q4-established) |
| `GET /openapi.json` | only generic discovery paths listed, no per-service availability claim, no contradiction possible |

```
POST_RELEASE_HEALTH_HTTP=200
POST_RELEASE_READY_TRUTHFUL=YES
POST_RELEASE_CATALOG_TRUTHFUL=YES
POST_RELEASE_SERVICE_DETAIL_TRUTHFUL=YES
POST_RELEASE_AGENT_CARD_TRUTHFUL=YES
```

No paid-route POST sent; no second 402 obtained. No material contradiction —
production unaltered.

## §4 — Post-release error/incident check

Q6's own tail process was intentionally stopped at the end of that
checkpoint (`SUN1220Q6_OWN_TAIL_STOPPED=YES`); no Logpush is configured
(`logpush: false`, confirmed again by this checkpoint's own preflight run);
no new observability process was started here (this checkpoint forbids
stimulating/observing beyond what already exists). There is therefore **no
persistent HTTP-request-level log** covering the gap between Q6's
observation window ending and this checkpoint — total request volume and
raw exception/5xx counts for that specific gap are genuinely **UNPROVEN**,
not zero, and are reported as such rather than assumed.

What *is* provable, from the one persistent, already-existing, non-stimulated
observability surface — the production D1 database itself, queried read-only
(`wrangler d1 execute --remote`, `SELECT`-only, zero writes) — is the
**economic** dimension in full:

```
$ wrangler d1 execute siteborne-utility --remote --command \
  "SELECT COUNT(*) FROM payment_attempts WHERE created_at >= '2026-08-29T03:25:43.517Z';"
→ 0

$ ... "SELECT COUNT(*) FROM x402_service_results WHERE created_at >= '...';"
→ 0

$ ... "SELECT COUNT(*) FROM x402_quotes WHERE created_at >= '...';"
→ 1   (exactly Q6's own single authorized 402 check; quote_id matches)

$ ... "SELECT event_type, COUNT(*) FROM audit_events WHERE timestamp >= '...' GROUP BY event_type;"
→ payment_required_created: 1   (same single event)

$ ... "SELECT event_type, severity, COUNT(*) FROM security_events WHERE timestamp >= '...' GROUP BY event_type, severity;"
→ (empty — zero rows)
```

```
POST_RELEASE_REQUEST_COUNT=UNPROVEN (no persistent HTTP-level log surface exists for this gap)
POST_RELEASE_UNHANDLED_EXCEPTIONS=UNPROVEN (no persistent exception log surface; D1 security_events, the closest available error-log table, shows 0 rows)
POST_RELEASE_UNEXPECTED_5XX=UNPROVEN (same reasoning)
POST_RELEASE_D1_ERRORS=0 (D1 itself responds correctly to every read issued here; no D1-error-logging table exists, but a live, responsive, correctly-answering database is itself evidence against a D1 outage)
POST_RELEASE_PROVIDER_ERRORS=0 (security_events: 0 rows of any type since Q6)
POST_RELEASE_RECEIPT_SIGNER_ERRORS=0 (same table, same result)
POST_RELEASE_EXTERNAL_PAID_REQUESTS=0 (payment_attempts: 0 rows — authoritative, persisted, non-stimulated)
POST_RELEASE_EXTERNAL_SETTLEMENTS=0 (payment_attempts + x402_service_results: 0 rows)
POST_RELEASE_DUPLICATE_SETTLEMENT_PATTERN=NO (trivial — 0 rows admits no duplicates)
```

## §5 — First service remains the only active paid service

```
$ wrangler d1 execute siteborne-utility --remote --command "SELECT id, production_enabled FROM services;"
→ all 8 rows: production_enabled = 0   (including verify_agent_output.v2 itself)
```

This is **expected, confirming evidence, not a contradiction**: per the
P1/P2 architecture, the D1 static row is deliberately left at its seeded
`false` floor forever; the *effective*, truthfully-served value is computed
per-request by the version-local runtime overlay
(`resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`), which never
writes to D1. All 8 rows reading `0` — including the released service's own
row — is direct proof that `D1_WRITES=0` has held for the entire release,
exactly as designed.

The live, truthful, *effective* state (§3) and current production
`wrangler versions view` (no `NEVERMINED_ROUTES_ENABLED` var present at all)
together give:

```
VERIFY_AGENT_OUTPUT_V2_CDP_ACTIVE=YES
OTHER_11_PAID_SERVICES_PRODUCTION_ACTIVE=NO
NEVERMINED_PRODUCTION_ACTIVE=NO
```

No accidental activation detected. No production anomaly.

## §6 — Historical SUN-1220P3 evidence-defect forensic analysis

```
$ wc -c docs/reports/SUN-1220P3-discovery-fixed-candidate-upload.md
458
$ git log --follow --oneline -- docs/reports/SUN-1220P3-discovery-fixed-candidate-upload.md
a14910e SUN-1220P3: record discovery-fixed qualification candidate   (only commit)
$ git diff a14910e -- docs/reports/SUN-1220P3-discovery-fixed-candidate-upload.md
(no diff — byte-identical to the working tree today)
```

Byte-level inspection (`od -c`) confirms the file's real content ends after
three literal header lines with:

```
SOURCE_HEAD_SHA (at upload
… [elided ~5089 chars — call bookmark_read("bm_2a1a26f5e12ea5da") for the full content] ⟦bm_2a1a26f5e12ea5da⟧
```

```
P3_CORRUPTED_REPORT_PATH=docs/reports/SUN-1220P3-discovery-fixed-candidate-upload.md
P3_CORRUPTION_PRESENT=YES
P3_CORRUPTION_TYPE=unresolved session-memory-condensation bookmark placeholder committed verbatim in place of real report content
P3_PLACEHOLDER_LITERAL=… [elided ~5089 chars — call bookmark_read("bm_2a1a26f5e12ea5da") for the full content] ⟦bm_2a1a26f5e12ea5da⟧
P3_CORRUPTION_FIRST_COMMIT_SHA=a14910ec001afcadcb7d9b329561c786950e5726
P3_CORRUPTION_INTRODUCED_AT=file creation, this file's only commit — never amended or repaired since
```

**Facts-recovery check** — the two load-bearing facts P3's own truncated
header claims (`SUN1220P1_DESIGN_EVIDENCE_COMMIT_SHA=664427d...`,
`SUN1220P2_IMPLEMENTATION_COMMIT_SHA=83d7e2d...`, and the start of
`SOURCE_HEAD_SHA`) are independently **re-asserted, not merely assumed**,
by the very next checkpoint's own committed evidence chain
(`docs/reports/SUN-1220P4-discovery-fixed-candidate-live-qualification.md`,
lines 8–9):

```
SOURCE_HEAD_SHA (unchanged throughout)      = a14910ec001afcadcb7d9b329561c786950e5726
CANDIDATE_VERSION_ID                        = 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
```

More importantly, `docs/reports/SUN-1220Q3-ready-fixed-candidate-upload.md`
(lines 189–195) explicitly states it treated `wrangler versions view
8a1cdfe1...` **as the source of truth** for that candidate's exact
qualification vars — i.e. a later, independent checkpoint deliberately
bypassed P3's (corrupted) prose in favor of re-querying Cloudflare directly.
This checkpoint just repeated that same re-query, live, right now:

```
$ wrangler versions view 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
Created: 2026-08-28T22:36:59.486Z   Message: SUN-1220P3 discovery-truthfulness qualification candidate
PAID_ROUTES_ENABLED=true, VERIFY_V2_CDP_ROUTE_ENABLED=true, PAYMENT_ENVIRONMENT=production,
PRODUCTION_ENABLED=true, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true, PRODUCTION_CDP_CREDENTIALS_APPROVED=true
6/6 required secrets present; CDP_WALLET_SECRET absent.
```

Cloudflare's own version metadata is permanent, immutable, and independent
of any report's prose — it is not something P3's corruption could have
touched, and it still answers every configuration question P3 would have
recorded.

```
P3_AUTHORITATIVE_FACTS_RECOVERABLE=PARTIAL
```
(PARTIAL, not YES: the *configuration/identity* facts — candidate ID, source
HEAD, qualification vars, secret presence — are fully recoverable and
independently re-confirmed from Cloudflare's live, permanent version
metadata and from P4/Q3's own committed cross-references. The *narrative*
content specific to P3 itself — its exact command transcripts, any
reasoning or observations unique to that checkpoint's own execution — is
permanently lost and cannot be reconstructed without fabrication.)

```
P3_CORRUPTION_AFFECTS_CURRENT_PRODUCTION_TRUST=NO
P3_CORRUPTION_AFFECTS_Q6_RELEASE_VALIDITY=NO
```
Q6's evidence chain (Q1→Q2→Q3→Q4→Q5R→Q6) never cites P3's prose as its
evidentiary basis for any economic or configuration fact — Q3 explicitly
re-derived them from live Cloudflare state instead. The completed release's
validity does not depend on the corrupted file.

## §7 — Recommended P3 evidence-repair method (design only, not executed)

| Approach | Assessment |
|---|---|
| A — append-only forensic correction (new report, original left byte-for-byte) | Preserves the historical record honestly — the corruption itself becomes part of the audit trail rather than being hidden. Cites only facts independently recoverable from Cloudflare + later committed reports (§6). Fabricates nothing. |
| B — restore from an earlier exact git object | Not applicable — `git log --follow` shows exactly one commit for this file; no earlier, uncorrupted git object exists to restore from. |
| C — mark corrupted/superseded, no reconstruction | Loses the recoverable facts (§6) unnecessarily; strictly worse than A for a case where partial recovery *is* possible. |
| D — other | Not identified as superior to A. |

```
RECOMMENDED_P3_EVIDENCE_REPAIR_APPROACH=A (append-only forensic correction report, citing only independently-recoverable facts from Cloudflare version metadata and later committed reports; never fabricating P3's lost narrative content)
P3_REPAIR_EXECUTION_REQUIRES_SEPARATE_CHECKPOINT=YES
```

## §8 — Stale `wrangler tail` process inventory (read-only, none touched)

```
$ ps -eo pid,ppid,lstart,etime,command | grep -i "wrangler.*tail"
```

| PID | PPID | Started | Elapsed | Likely owner |
|---|---|---|---|---|
| 19976 | 1 | Sat Aug 22 23:09:01 2026 | 6d06:26:36 | OLDER |
| 19982 | 19976 | Sat Aug 22 23:09:01 2026 | 6d06:26:36 | OLDER |
| 20173 | 1 | Sat Aug 22 23:11:21 2026 | 6d06:24:16 | OLDER |
| 20179 | 20173 | Sat Aug 22 23:11:21 2026 | 6d06:24:16 | OLDER |
| 20279 | 1 | Sat Aug 22 23:12:36 2026 | 6d06:23:01 | OLDER |
| 20285 | 20279 | Sat Aug 22 23:12:36 2026 | 6d06:23:01 | OLDER |
| 20356 | 1 | Sat Aug 22 23:13:43 2026 | 6d06:21:54 | OLDER |
| 20362 | 20356 | Sat Aug 22 23:13:43 2026 | 6d06:21:54 | OLDER |
| 20414 | 1 | Sat Aug 22 23:14:26 2026 | 6d06:21:11 | OLDER |
| 20420 | 20414 | Sat Aug 22 23:14:26 2026 | 6d06:21:11 | OLDER |
| 80209 | 1 | Sat Aug 22 19:37:20 2026 | 6d09:58:17 | OLDER |
| 80216 | 80209 | Sat Aug 22 19:37:20 2026 | 6d09:58:17 | OLDER |
| 83145 | 1 | Sat Aug 22 20:12:13 2026 | 6d09:23:24 | OLDER |
| 83152 | 83145 | Sat Aug 22 20:12:13 2026 | 6d09:23:24 | OLDER |

All 14 PIDs (7 process trees) started **Saturday, six-plus days** before the
P4 checkpoint chain even began (Aug 28–29), so all classify unambiguously as
`OLDER` — none are plausibly Q4/Q5R/Q6-owned. Cross-checked against every
checkpoint that recorded its own tail PID and its own stop confirmation
(Q4: `PID 17639`, confirmed stopped this session's predecessor turn; Q5R:
`PID 13835`, confirmed stopped; Q6: `PID 17639`, confirmed stopped in its
own report) — zero overlap.

```
STALE_WRANGLER_TAIL_PROCESS_COUNT=7 (process trees) / 14 (raw PIDs)
CURRENTLY_ACTIVE_REQUIRED_TAIL_COUNT=0
CLEARLY_STALE_TAIL_COUNT=7
UNKNOWN_OWNERSHIP_TAIL_COUNT=0
```

No `pkill -f` proposed. Nothing killed in this checkpoint. A future cleanup
checkpoint should target these 14 exact PIDs individually.

## §9–§12 — Paid-route inventory, readiness matrix, executor reality, provider split

Canonical service-ID list (`packages/protocol-a2a/src/constants.ts`,
`SITEBORNE_SERVICE_IDS`): 8 base service/version pairs. Actual routing
surface (`apps/edge-api/src/index.ts`) adds the two Nevermined wildcard
families, giving the historical **12** route configurations: 8
CDP/direct + 4 Nevermined (`/v1/nevermined/*`, `/v2/nevermined/*` each
notionally covering the 2 services that had Nevermined variants
historically discussed). Re-derived from source now, not assumed from
memory.

**Critical routing-architecture finding, direct from `index.ts`'s own
comments (SUN-1218 checkpoint X):** `/v1/*` and `/v2/*` (every path except
the one carved-out `POST /v2/verify/agent-output`) are **unconditional
`c.notFound()` wildcards — no flag, no env var, no request value can ever
reach them.** This is a deliberate, permanent architectural decision (to
stop a shared flag from ever accidentally reactivating an unrelated route
again, per the SUN-1220P/P1 incident), not a temporary gate. A new service
can **only** ever go live the same way `verify_agent_output.v2` did: pulled
out into its own exact route, mounted before the wildcard, with its own
two-level gate — never by flipping a flag the wildcard already checks.

The Nevermined wildcards, even if `NEVERMINED_ROUTES_ENABLED=true`, resolve
to `productionServiceExecutorUnavailable` (governed 503) — the code's own
comment states plainly: *"The repository has no complete governed
Worker-compatible paid-service executor, so every enabled family stops at
the same deterministic 503."* Confirmed current: no `NEVERMINED_ROUTES_ENABLED`
var is set on production at all (`wrangler versions view` — absent).

| SERVICE_ID | PRICE | SCHEME | PROVIDER | EXECUTOR SOURCE | REAL/FIXTURE | WORKER ROUTE | DISCOVERY | PRODUCTION ACTIVATION |
|---|---|---|---|---|---|---|---|---|
| `verify_agent_output.v2` | $0.019 | exact | CDP | `verify-agent-output-v2-{production-executor,cdp-composition}.ts` | **REAL** | `POST /v2/verify/agent-output` (carved-out exact route) | truthful, active | **RELEASED** |
| `verify_agent_output.v1` | $0.019 | exact | CDP | same real executor exists, but v1 path is architecturally unreachable | REAL (unreachable) | `/v1/*` → unconditional 404 | inactive | none — cannot be activated without a new exact route (v1 wildcard is permanently dead) |
| `web_context_verified.v1`/`.v2` | $0.009 | exact | CDP | `packages/service-runtime/src/services/web-context/service.ts` (`WebContextVerifiedService`) | **REAL** — composes real `PublicHttpAdapter`, real PCC build/sign; `rendered` mode honestly reports `dependency_unavailable` rather than faking it | `/v2/*` → unconditional 404 (not yet carved out) | inactive (D1 row `false`, matches reality) | **UNWIRED** |
| `company_evidence_graph.v1`/`.v2` | $0.039 | exact | CDP | `packages/service-runtime/src/services/company-evidence/service.ts` (`CompanyEvidenceService`) | **REAL** — composes real SEC-submissions + direct-HTTP adapters, real PCC build/sign; optional Federal Register field group honestly reports `unavailable` if unwired | `/v2/*` → unconditional 404 (not yet carved out) | inactive (D1 row `false`, matches reality) | **UNWIRED** |
| `document_evidence_json.v1`/`.v2` | $0.012 | **upto** (not `exact`) | CDP | `packages/service-runtime/src/services/document-evidence/service.ts` + `worker-bridge.ts` | **REAL, but requires `node:child_process.spawn` of a real external Python/Modal CLI** — structurally incompatible with the Workers runtime as written; a genuinely different execution model (a live call out to the separate Modal worker service, not just a route mount) | `/v2/*` → unconditional 404 | inactive | **UNWIRED + externally-blocked execution model** |
| all 4 base services × Nevermined variant | n/a | n/a | Nevermined | none exist — `productionServiceExecutorUnavailable` unconditionally | **SYNTHETIC/PLACEHOLDER** (deliberate governed 503, explicitly documented as "no complete governed executor") | `/v1|v2/nevermined/*` | inactive | not activatable — no executor exists for any Nevermined route |

Required bindings/secrets for any new CDP-provider service: identical to
the released one (`DB`, `AGENT_CARD_SIGNING_*`, `PAID_RECEIPT_SIGNING_*`,
`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `SELLER_WALLET_ADDRESS`) — the same
CDP buyer/seller identity and `createX402ServiceRoute` machinery is
provider-generic, not `verify_agent_output`-specific (confirmed by reading
`verify-agent-output-v2-cdp-composition.ts`'s own imports: `resolvePaymentNetwork`,
`resolvePaymentAsset`, `resolveProductionCdpEvidenceProvider`,
`isProductionPaymentAuthorized` — all shared, none service-specific). No new
secret or binding class is required for a same-scheme CDP service; only a
new route-specific flag (mirroring `VERIFY_V2_CDP_ROUTE_ENABLED`) and a new
~150-line composition+route file (mirroring the 146-line
`production-verify-v2-cdp-route.ts`) are structurally required.

Test coverage (unit-level, service-logic only — none of the three unwired
services has Worker-runtime coverage in `test:worker-runtime`, since none
is bundle-reachable yet):

| Service | Unit test file | Lines |
|---|---|---|
| `web-context` | `service.test.ts` | 158 |
| `company-evidence` | `service.test.ts` | 140 |
| `document-evidence` | `service.test.ts` + `worker-bridge.subprocess.test.ts` | 294 |

```
REAL_EXECUTOR_COUNT=4   (verify_agent_output [released], web_context_verified, company_evidence_graph, document_evidence_json — all real, non-fixture business logic)
FIXTURE_EXECUTOR_COUNT=0
SYNTHETIC_EXECUTOR_COUNT=4   (the 4 Nevermined route families — deliberate governed placeholder 503, no real logic behind any of them)
UNWIRED_EXECUTOR_COUNT=3   (web_context_verified, company_evidence_graph, document_evidence_json — real executor exists but zero Worker route reaches it)
EXTERNAL_BLOCKED_EXECUTOR_COUNT=1   (document_evidence_json — real executor exists but requires an external Python/Modal subprocess call, a materially different integration than a route mount)
UNKNOWN_EXECUTOR_COUNT=0

CDP_REMAINING_SERVICE_COUNT=3   (web_context_verified, company_evidence_graph, document_evidence_json — each has a real CDP-provider-compatible economic policy entry)
NEVERMINED_REMAINING_SERVICE_COUNT=4   (route-family count; zero real executors)
CDP_PROVIDER_PRODUCTION_FOUNDATION_PROVEN=YES   (real, proven, live for verify_agent_output.v2; generic, reusable machinery confirmed by source inspection)
NEVERMINED_PROVIDER_PRODUCTION_FOUNDATION_PROVEN=NO   (no real executor exists for any Nevermined route; the code's own comments say so explicitly; NVM_ENVIRONMENT=sandbox on the current production candidate; NEVERMINED_ROUTES_ENABLED absent from production)
```

## §13–§14 — Ranking

Ranked by safest-shortest-production-path criteria (real executor first,
minimal source change, proven-foundation reuse, no new provider, no
economic ambiguity, smallest blast radius):

| Rank | Service | Provider | Readiness class | Real executor | Scheme parity w/ released service | Primary blocker |
|---|---|---|---|---|---|---|
| 1 | `web_context_verified.v2` | CDP | R1 (real executor unwired) | YES | YES (`exact`) | Needs a new carved-out exact route + composition file (mirrors proven pattern exactly); no new secrets/bindings/provider |
| 2 | `company_evidence_graph.v2` | CDP | R1 (real executor unwired) | YES | YES (`exact`) | Same as #1, plus more moving parts (SEC + optional Federal Register adapters) and a higher price ($0.039 vs $0.009) — larger surface, same class |
| 3 | `document_evidence_json.v2` | CDP | R1, but externally-blocked execution model | YES (but subprocess-dependent) | **NO** (`upto`, not `exact`) | Requires a live call to a separate Python/Modal service (not just a route mount) *and* a different, unproven settlement scheme (`upto` — authorization-phase, never proven end-to-end) |

```
RANK_1: SERVICE=web_context_verified.v2 PROVIDER=CDP CURRENT_READINESS_CLASS=R1_REAL_EXECUTOR_UNWIRED REAL_EXECUTOR=YES
  SOURCE_CHANGES_REQUIRED=1 new production-executor/composition file (~150 lines, mirrors production-verify-v2-cdp-route.ts) + 1 new route-specific env flag + 1 new line in index.ts
  NEW_SECRETS_REQUIRED=NONE  NEW_BINDINGS_REQUIRED=NONE  NEW_PROVIDER_WORK_REQUIRED=NONE
  ECONOMIC_PATH_REUSE=FULL (same scheme, same CDP identity, same signer/PCC infrastructure)
  REAL_PAID_E2E_REPEAT_LIKELY_REQUIRED=YES (new price + new service-specific execution proof, even though the payment RAIL itself transfers — see §16)
  ESTIMATED_RELEASE_CHECKPOINT_COUNT=6-7 (design→TDD→upload→0%-qualify→canary→promote, collapsible where evidence permits)
  PRIMARY_BLOCKER=none structural; needs the same disciplined design/TDD/qualify sequence already proven for the first release

RANK_2: SERVICE=company_evidence_graph.v2 PROVIDER=CDP CURRENT_READINESS_CLASS=R1_REAL_EXECUTOR_UNWIRED REAL_EXECUTOR=YES
  SOURCE_CHANGES_REQUIRED=same shape as RANK_1, larger surface (2 adapters, optional 3rd)
  NEW_SECRETS_REQUIRED=NONE  NEW_BINDINGS_REQUIRED=NONE  NEW_PROVIDER_WORK_REQUIRED=NONE
  ECONOMIC_PATH_REUSE=FULL
  REAL_PAID_E2E_REPEAT_LIKELY_REQUIRED=YES
  ESTIMATED_RELEASE_CHECKPOINT_COUNT=6-7
  PRIMARY_BLOCKER=larger surface area than RANK_1 for no lower risk; no reason to prefer over RANK_1

RANK_3: SERVICE=document_evidence_json.v2 PROVIDER=CDP CURRENT_READINESS_CLASS=R1_REAL_EXECUTOR_UNWIRED_EXTERNALLY_BLOCKED REAL_EXECUTOR=YES (subprocess-dependent)
  SOURCE_CHANGES_REQUIRED=route/composition file PLUS a real network call to a separately-deployed Modal service PLUS `upto`-scheme settlement logic never yet proven in production
  NEW_SECRETS_REQUIRED=likely (Modal service auth) NEW_BINDINGS_REQUIRED=likely (outbound service binding/URL)
  NEW_PROVIDER_WORK_REQUIRED=YES (materially different integration shape than a route mount)
  ECONOMIC_PATH_REUSE=PARTIAL (provider/network/asset same; settlement scheme differs)
  REAL_PAID_E2E_REPEAT_LIKELY_REQUIRED=YES, and specifically must prove the `upto` scheme, which the historical tx never exercised
  ESTIMATED_RELEASE_CHECKPOINT_COUNT=9+ (materially larger scope)
  PRIMARY_BLOCKER=external Python/Modal execution dependency + unproven `upto` settlement scheme
```

## §15 — Selected next slice

```
RECOMMENDED_NEXT_PAID_SERVICE=web_context_verified.v2
RECOMMENDED_NEXT_PROVIDER=CDP
```

**Rationale:** it is the only remaining service with (a) a real,
non-fixture executor, (b) the exact same payment scheme (`exact`) as the
one already proven end-to-end in production, (c) zero new secrets,
bindings, or provider integrations, (d) the smallest, simplest adapter
surface (one direct-HTTP fetch adapter, no SEC/Federal-Register/subprocess
dependencies), and (e) the lowest price ($0.009), minimizing blast radius
of any economic-path mistake. `company_evidence_graph.v2` is a legitimate,
close second on identical structural grounds but with strictly more moving
parts for no offsetting risk reduction. `document_evidence_json.v2` is
disqualified from being "next" by two independent, real blockers (external
subprocess execution model; unproven `upto` settlement scheme) — selecting
it now would mean re-deriving both a new execution integration and a new
economic proof simultaneously, the opposite of "smallest, shortest, safest
path." No Nevermined route is selectable: zero real executors exist for
any of them, confirmed directly from the routing source's own documentation
of that fact, not inferred.

## §16 — Real-paid-E2E requirement for the selected service

```
PAYMENT_RAIL_EVIDENCE_TRANSFERABLE=PARTIAL
```
The historical transaction (`0x612efe6f...`) proves the CDP/x402/Base-mainnet/
USDC/`exact`-scheme payment **rail** — same facilitator, same seller wallet,
same asset, same network, same signing/settlement machinery. That proof
transfers structurally to any other `exact`-scheme CDP service, including
`web_context_verified.v2`.

It does **not** transfer service-specific execution proof (that this
particular executor, at this particular price, produces a real receipt for
a real request) or price-specific economics (a different `amount`/quote for
a different `price_usd`). Per this checkpoint's own §16 rule — a changed
price is itself sufficient to require a fresh proof, independent of scheme.

```
NEW_REAL_PAYMENT_REQUIRED_FOR_NEXT_SERVICE=YES
```
A new, small, one-shot real paid E2E (analogous to SUN-1220O) will be
needed for `web_context_verified.v2` specifically — the rail is proven, the
service-specific settlement is not.

## §17 — Next release-train design (not implemented)

```
NEXT_RELEASE_CHECKPOINT_SEQUENCE=
  SUN-1221B — web_context_verified.v2/CDP: design + root-cause of the
    unwired-route gap (mirrors the SUN-1216/SUN-1218 pattern already proven;
    largely a "what changes, what doesn't" design given the executor
    already exists)
  SUN-1221C — TDD implementation: new production-executor/composition file,
    new route-specific flag, index.ts route carve-out, mutation-proof,
    full regression (mirrors Q2's own TDD discipline)
  SUN-1221D — immutable candidate upload (mirrors Q3)
  SUN-1221E — 0%-traffic live qualification, including the one new real
    paid E2E required by §16 (collapses Q4's zero-traffic-qualification
    checkpoint with the new payment proof, since both need the same
    temporary 100/0 deployment and can share one authorization)
  SUN-1221F — 1% public canary, ≥300s / ≥5-sample governing floor (mirrors
    Q5/Q5R)
  SUN-1221G — 100% promotion + release closure (mirrors Q6)

NEXT_RELEASE_CHECKPOINT_COUNT=6
```
(Collapsed from the illustrative 7-checkpoint shape by merging the new
real-paid-E2E proof into the zero-traffic qualification checkpoint, since
SITEBORNE's own SUN-1220 history shows those two concerns already share a
single temporary-deployment window whenever both are needed together.)

## §18 — First-service stability decision

Based on §§1–5: production read-back matches Q6 exactly, no drift; all safe
health checks truthful; D1-provable economic activity is zero external paid
requests and zero settlements since release; the only recorded activity of
any kind since Q6 is this checkpoint's own single historical Q6 check;
`verify_agent_output.v2` remains the sole active paid service; no other
route or provider is accidentally active.

```
FIRST_SERVICE_POST_RELEASE_STATE=STABLE
NEXT_SERVICE_ACTIVATION_ELIGIBLE=YES
```

## §21 — Mutation accounting

```
SOURCE_RUNTIME_FILES_CHANGED=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
D1_WRITES=0
LIVE_PAID_ROUTE_POSTS=0
LIVE_402_REQUESTS=0
SIGN_TYPED_DATA_CALLS=0
PAYMENT_PAYLOADS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
PROCESS_TERMINATIONS=0
```

All D1 access this checkpoint was `SELECT`-only (`payment_attempts`,
`x402_quotes`, `x402_service_results`, `audit_events`, `security_events`,
`services`, plus one `PRAGMA table_info` schema read) — zero `INSERT`/
`UPDATE`/`DELETE`, confirmed by each command's own `"changes": 0`,
`"rows_written": 0`, `"changed_db": false` response metadata.

## Final packet

```
SUN1221A_POST_RELEASE_AUDIT=PASS
SUN1220Q6_EVIDENCE_COMMIT_SHA=05527c40c5b872be0cdff2444a19fdc546d50f09
SUN1221A_EVIDENCE_COMMIT_SHA=<set at commit time, below>
CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
CURRENT_PRODUCTION_TRAFFIC=100%
CURRENT_PRODUCTION_PREFLIGHT=PASS
FIRST_SERVICE_POST_RELEASE_STATE=STABLE
VERIFY_AGENT_OUTPUT_V2_CDP_ACTIVE=YES
OTHER_11_PAID_SERVICES_PRODUCTION_ACTIVE=NO
NEVERMINED_PRODUCTION_ACTIVE=NO
POST_RELEASE_UNHANDLED_EXCEPTIONS=UNPROVEN (no persistent HTTP-level log for the gap; D1 error-adjacent tables show 0)
POST_RELEASE_UNEXPECTED_5XX=UNPROVEN (same reasoning)
POST_RELEASE_EXTERNAL_PAID_REQUESTS=0
POST_RELEASE_EXTERNAL_SETTLEMENTS=0
P3_CORRUPTION_PRESENT=YES
P3_CORRUPTION_AFFECTS_CURRENT_PRODUCTION_TRUST=NO
P3_CORRUPTION_AFFECTS_Q6_RELEASE_VALIDITY=NO
P3_AUTHORITATIVE_FACTS_RECOVERABLE=PARTIAL
RECOMMENDED_P3_EVIDENCE_REPAIR_APPROACH=A (append-only forensic correction)
STALE_WRANGLER_TAIL_PROCESS_COUNT=7
CLEARLY_STALE_TAIL_COUNT=7
UNKNOWN_OWNERSHIP_TAIL_COUNT=0
CURRENT_PAID_ROUTE_CONFIGURATION_COUNT=12 (8 CDP/direct + 4 Nevermined route families)
REMAINING_PAID_SERVICE_COUNT=11 (12 minus the 1 released)
REAL_EXECUTOR_COUNT=4
FIXTURE_EXECUTOR_COUNT=0
SYNTHETIC_EXECUTOR_COUNT=4
UNWIRED_EXECUTOR_COUNT=3
CDP_REMAINING_SERVICE_COUNT=3
NEVERMINED_REMAINING_SERVICE_COUNT=4
RANK_1=web_context_verified.v2 (CDP)
RANK_2=company_evidence_graph.v2 (CDP)
RANK_3=document_evidence_json.v2 (CDP, blocked)
RECOMMENDED_NEXT_PAID_SERVICE=web_context_verified.v2
RECOMMENDED_NEXT_PROVIDER=CDP
PAYMENT_RAIL_EVIDENCE_TRANSFERABLE=PARTIAL
NEW_REAL_PAYMENT_REQUIRED_FOR_NEXT_SERVICE=YES
NEXT_RELEASE_CHECKPOINT_SEQUENCE=SUN-1221B design -> SUN-1221C TDD implementation -> SUN-1221D candidate upload -> SUN-1221E 0%-qualification+new real paid E2E -> SUN-1221F 1% canary -> SUN-1221G 100% promotion
NEXT_RELEASE_CHECKPOINT_COUNT=6
NEXT_SERVICE_ACTIVATION_ELIGIBLE=YES
NEW_SECRET_FINDINGS=0
SOURCE_RUNTIME_FILES_CHANGED=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
D1_WRITES=0
LIVE_402_REQUESTS=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
PROCESS_TERMINATIONS=0
```

**STOP.** No next service activated. No Worker version uploaded. No
historical P3 repair executed. No stale process killed. No payment made.
