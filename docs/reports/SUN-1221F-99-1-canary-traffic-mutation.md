# SUN-1221F — 99/1 Production Canary Traffic Mutation

Lineage: H2B2-R4 (`66e9592`, `SUN1221F_CANARY_ELIGIBLE=YES_WITH_DOCUMENTED_R3_GOVERNANCE_DEVIATION`,
`NEXT_REQUIRED_CHECKPOINT=SUN-1221F`) → this checkpoint.

## Authorization

In-conversation, exact-form authorization per [[release-authorization-authority]]:
one production canary traffic mutation setting `de70bf98-f304-4d7f-b189-4ae2401041a0`
(known-good) to 99% and `db7054c9-76ee-4830-aabe-8a4542261b6a` (candidate) to 1%,
followed by a non-economic observation period of at least 300 continuous seconds
with version-attributed safe probes and production-health monitoring; at most one
rollback mutation authorized only if a material candidate-attributed abnormality
occurred, after which the checkpoint must stop. Explicitly **not** authorized:
any intentional 402 request, payment authorization, signing action, paid POST,
settlement test, USDC transfer, source-code change, host redeployment, API
candidate upload, traffic above 1%, or final production promotion. Authorization
expires when SUN-1221F stops.

## Phase A — pre-mutation baseline (read-only)

- `wrangler versions deploy --dry-run`: confirmed exactly 2 versions, no drift
  since H2B2-R4 — `de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100%,
  `db7054c9-76ee-4830-aabe-8a4542261b6a` @ 0%, no third version.
- `/health` → `200 {"status":"ok",...}`.
- `/ready` → `200`, `production_services_enabled:true`, 3 blockers present
  (`ionos_dns_migration`, `nevermined_credentials`, `registry_publication`) —
  unchanged baseline.
- `/catalog`, `/.well-known/agent-card.json`, `/openapi.json`,
  `/services/verify_agent_output.v2` all `200`.

## Phase B — the one authorized mutation

```
pnpm exec wrangler versions deploy \
  de70bf98-f304-4d7f-b189-4ae2401041a0@99 \
  db7054c9-76ee-4830-aabe-8a4542261b6a@1 \
  --message "SUN-1221F: authorized 99/1 canary traffic mutation" -y
```

`SUCCESS  Deployed siteborne-utility-edge version de70bf98-f304-4d7f-b189-4ae2401041a0
at 99% and version db7054c9-76ee-4830-aabe-8a4542261b6a at 1%`. Read back via
`wrangler versions deploy --dry-run` immediately after: `(99%) de70bf98-...`,
`(1%) db7054c9-...`, no third version. `TRAFFIC_MUTATION_COUNT=1`.

## Phase C — observation window

- Fresh tail (`wrangler tail siteborne-utility-edge --format json`, own PID,
  not reused from any prior checkpoint) attached cleanly (no stderr) before
  the mutation and ran through the full sampler window.
- Sampler: safe non-economic GET rotation across `/health`, `/ready`,
  `/catalog`, `/.well-known/agent-card.json`, `/services/verify_agent_output.v2`,
  `/openapi.json`, one request every 4s, no override header, no POST anywhere.
- Three prior sampler attempts were each cut short at exactly 120s by the tool
  runtime's own default command timeout (not a production or traffic issue) and
  are recorded as `INCOMPLETE` and **not** counted toward the floor, per the
  same non-stitching rule applied in SUN-1220Q5's attempt 1. A fourth attempt,
  run with an explicit longer tool timeout, completed as one continuous window.
- **SUN1221F_DURATION_SECONDS = 334** (>= 300s floor), start
  `2026-09-01T19:12:59Z` (epoch `1788289979`).
- **Sampler-observed: 81/81 requests HTTP 200, 0 non-200, 0 timeouts.**
- Tail-based version attribution across the full tail window (190 events
  captured, superset of the sampler window):
  - `de70bf98-f304-4d7f-b189-4ae2401041a0` (known-good): 188 events —
    `{200: 181, 400: 5, 404: 1, 202: 1}`, all `outcome:"ok"`, 0 exceptions.
    The 400/404/202 responses are ordinary real third-party production
    traffic (not our sampler, not candidate-attributed) and match the
    Worker's normal baseline behavior — irrelevant to candidate qualification.
  - `db7054c9-76ee-4830-aabe-8a4542261b6a` (candidate): **2 events**, both
    identified as our own sampler (`user-agent: curl/8.7.1`) —
    `GET /services/verify_agent_output.v2 → 200` (`wallTime:21ms`) and
    `GET /health → 200` (`wallTime:7ms`). Both `outcome:"ok"`, `exceptions:[]`.
    Attribution rate (2/190 ≈ 1.05%) is consistent with the configured 1%
    split at this sample size.
- **CANDIDATE_ATTRIBUTED_EXCEPTIONS = 0. CANDIDATE_ATTRIBUTED_5XX = 0.
  CANDIDATE_ATTRIBUTED_ABNORMALITY = NO.**
- Zero 5xx anywhere in the tail window, on either version.
- Post-window health re-check: `/health` → `200`; `/ready` → `200`, identical
  body to the Phase A baseline. `wrangler versions deploy --dry-run` re-read:
  traffic split unchanged at `99%/1%`.

## Rollback

Not triggered — no material candidate-attributed abnormality occurred.
**ROLLBACK_MUTATIONS_PERFORMED = 0.**

## Agent economic counters

`LIVE_SIGN_TYPED_DATA_CALLS=0`, `PAYMENT_SIGNATURES_CREATED=0`,
`LIVE_PAID_REQUESTS=0`, `SETTLEMENTS=0`, `TRANSACTIONS=0`,
`R_ECONOMIC_EFFECT_USDC=0`. No selected-route POST was ever sent. No source
code was changed. No host was redeployed. No API candidate was uploaded.
Traffic never exceeded 1% for the candidate. No final production promotion
was performed.

## Final stop packet

```
SUN1221F_AUTHORIZATION=PRESENT (in-conversation, exact form)
SUN1221F_TRAFFIC_MUTATION_COUNT=1
SUN1221F_PRE_MUTATION_STATE=de70bf98@100% / db7054c9@0%
SUN1221F_POST_MUTATION_STATE=de70bf98@99% / db7054c9@1%
SUN1221F_MUTATION_READBACK=PASS
SUN1221F_DURATION_SECONDS=334
SUN1221F_SAMPLER_REQUESTS=81
SUN1221F_SAMPLER_NON_200=0
SUN1221F_TAIL_EVENTS_TOTAL=190
SUN1221F_TAIL_EVENTS_KNOWN_GOOD=188
SUN1221F_TAIL_EVENTS_CANDIDATE=2
SUN1221F_CANDIDATE_EXCEPTIONS=0
SUN1221F_CANDIDATE_UNEXPECTED_5XX=0
SUN1221F_CANDIDATE_ABNORMALITY=NO
SUN1221F_ROLLBACK_PERFORMED=NO
SUN1221F_FINAL_TRAFFIC=de70bf98@99% / db7054c9@1%
POST_WINDOW_HEALTH=PASS
POST_WINDOW_READY=PASS (unchanged from baseline)
LIVE_SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
R_ECONOMIC_EFFECT_USDC=0
SOURCE_CODE_CHANGES=0
HOST_REDEPLOYMENTS=0
API_CANDIDATE_UPLOADS=0
TRAFFIC_ABOVE_1_PERCENT=NO
FINAL_PRODUCTION_PROMOTION_PERFORMED=NO
SUN1221F_AUTHORIZATION_STATUS=EXPIRED (checkpoint stopped)
```

STOP. Production traffic remains at `de70bf98@99% / db7054c9@1%` — this was
the authorized end-state of a clean (no-abnormality) window; no restoration-
to-100% mutation was authorized in this checkpoint's scope, so none was
performed. Any further mutation (restore to 100%, extend the canary, or
promote) requires fresh, explicit in-conversation authorization naming the
new scope.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
