# SUN-1221F2 — Canary Sample-Completion Extension

Lineage: `383327c` (SUN-1221F, 334s clean window, 2/2 candidate samples) →
`66e9592` (H2B2-R4) → `c1c386f` (H2B2-R3A) → this checkpoint.

## Why this checkpoint exists

SUN-1221F met the ≥300s time floor (334s continuous, 81/81 safe probes
HTTP 200) but only produced **2** candidate-attributed samples against a
frozen ≥5 sample gate — insufficient to mark the canary complete. SUN-1221F2
performs **no new traffic mutation** and exists solely to accumulate ≥5
*additional* candidate-attributed samples at the already-deployed 99/1 split.

## Authorization

In-conversation, exact-scope authorization per [[release-authorization-authority]]:
continue observing the existing 99/1 canary, no traffic change, safe
non-economic probes only, until ≥5 NEW candidate-attributed samples are
obtained (cap: 1,000 safe requests), with rollback-only-on-abnormality and a
hard stop before any SUN-1221G promotion work.

```
SUN1221F2_AUTHORIZATION=PRESENT
```

## §1 — Start-of-checkpoint readback

```
F2_START_TRAFFIC_READBACK=PASS
de70bf98-f304-4d7f-b189-4ae2401041a0 @ 99%
db7054c9-76ee-4830-aabe-8a4542261b6a @ 1%
THIRD_VERSION=NONE
F2_INITIAL_TRAFFIC_MUTATIONS=0
```

Read-only `wrangler versions deploy --dry-run`; no deploy command was issued
to reach this state — it is the state SUN-1221F already left production in.

## §2 — Observability attachment

Fresh `wrangler tail siteborne-utility-edge --format json` session (new PID,
independent of SUN-1221F's tail), attached cleanly with no stderr output.

```
F2_VERSION_ATTRIBUTION_READY=YES
```

## §3 — Sampler

Two sequential rounds (a ~32s idle gap between them; tail stayed attached
throughout, only active probing paused), mixed rotation across the 6
already-approved HTTP surfaces plus one MCP-compatible surface:
`/health`, `/ready`, `/catalog`, `/.well-known/agent-card.json`,
`/services/verify_agent_output.v2`, `/openapi.json`, and `POST /mcp`
(`tools/list`, JSON-RPC 2.0, modern per-request `_meta` envelope with
`protocolVersion: "2026-07-28"` — the server's stateless MCP transport
rejects the legacy `initialize` handshake by design
(`createMcpHandler(..., { legacy: 'reject' })`,
[packages/protocol-mcp/src/server.ts:367](../../packages/protocol-mcp/src/server.ts)),
so `tools/list` is the correct non-economic modern-envelope call, not
`initialize`). Rate: 1 request / 0.8s (1.25 req/s, well under the 2 req/s
ceiling used in SUN-1220Q5R precedent). No POST beyond the MCP `tools/list`
call; no override header; no 402 sought; no paid route invoked.

```
Round 1: 2026-09-01T20:06:23Z start, 550s elapsed, 588 requests, 588/588 HTTP 200 (client-observed)
Round 2: 2026-09-01T20:16:05Z start, 350s elapsed, 378 requests, 378/378 HTTP 200 (client-observed)
F2_SAFE_REQUEST_COUNT=966
F2_OBSERVATION_SECONDS=900 (two rounds; not one unbroken window — reported honestly, not merged with F's 334s)
```

966 < 1,000 request cap — stop condition **A** (≥5 new candidate samples)
was reached before stop condition **C** (1,000-request budget exhaustion).

## §4 — Authoritative candidate attribution

Attribution is read directly from each Cloudflare Workers tail event's
`scriptVersion.id` field — never inferred from the 1% probability. Combined
tail capture across both rounds: 990 events total, 985 attributed to
`de70bf98...`, 5 attributed to `db7054c9...`.

| SAMPLE_ID | TIMESTAMP (UTC) | PATH | METHOD | HTTP_STATUS | HANDLING_VERSION | EXCEPTION | RESULT |
|---|---|---|---|---|---|---|---|
| 1 | 2026-09-01T20:07:28.473Z | /openapi.json | GET | 200 | db7054c9-76ee-4830-aabe-8a4542261b6a | none | ok |
| 2 | 2026-09-01T20:08:58.822Z | /services/verify_agent_output.v2 | GET | 200 | db7054c9-76ee-4830-aabe-8a4542261b6a | none | ok |
| 3 | 2026-09-01T20:13:33.909Z | /services/verify_agent_output.v2 | GET | 200 | db7054c9-76ee-4830-aabe-8a4542261b6a | none | ok |
| 4 | 2026-09-01T20:14:58.485Z | /services/verify_agent_output.v2 | GET | 200 | db7054c9-76ee-4830-aabe-8a4542261b6a | none | ok |
| 5 | 2026-09-01T20:18:39.209Z | /openapi.json | GET | 200 | db7054c9-76ee-4830-aabe-8a4542261b6a | none | ok |

All 5 requests carried `user-agent: curl/8.7.1` (our own sampler) —
confirmed not organic third-party traffic.

```
F2_NEW_CANDIDATE_SAMPLE_COUNT=5
FRESH_CANDIDATE_SAMPLE_COUNT_ORIGINAL=2
TOTAL_CANDIDATE_SAMPLES_ACROSS_F_AND_F2=7
```

## §5 — Candidate health

```
F2_CANDIDATE_5XX_COUNT=0
F2_CANDIDATE_EXCEPTION_COUNT=0
BINDING_FAILURES=0
WORKFLOW_HOST_ERRORS=0
DEPENDENCY_ERRORS=0
D1_SCHEMA_ERRORS=0
RECEIPT_DURABILITY_ERRORS=0
UNEXPECTED_ECONOMIC_BEHAVIOR=0
F2_CANDIDATE_HEALTH=PASS
```

## §6 — Control health / coherence

`de70bf98` (control) carried the remaining 985 events: 967×200, 11×400,
4×404, 3×202. This is ordinary background production traffic unrelated to
the sampler (all sampler requests independently logged client-side as
200/200) — the same class of baseline 4xx/202 noise seen in SUN-1221F's
window and every prior public-canary checkpoint. Not classified as a
candidate or control failure.

```
F2_CANARY_VS_CONTROL_COHERENCE=PASS
```

## §7 — Economic guardrail

No 402 was sought, no payment authorization, no signer call, no paid POST
(the sole POST route exercised was `/mcp` `tools/list`, which is closed to
paid execution by protocol-mcp's default boundary and returns tool
descriptions only), no settlement attempt. No organic paid traffic was
observed on the candidate slice during this window.

```
INTENTIONAL_402_REQUESTS=0
INTENTIONAL_PAYMENT_AUTHORIZATIONS=0
INTENTIONAL_SIGNER_CALLS=0
INTENTIONAL_PAID_POSTS=0
INTENTIONAL_SETTLEMENTS=0
```

## §8 — Abnormality / rollback

No material candidate-attributed abnormality occurred at any point.

```
F2_ROLLBACK_TRAFFIC_MUTATIONS=0
```

## §9 — End state

```
F2_END_PRODUCTION_TRAFFIC=99%
F2_END_CANDIDATE_TRAFFIC=1%
```

Verified by post-window `wrangler versions deploy --dry-run` readback
(§1-identical) and post-window `/health` (200) + `/ready` (200) checks.

## Final stop packet

```
SUN1221F2=PASS
SUN1221F2_AUTHORIZATION=PRESENT
F2_START_TRAFFIC_READBACK=PASS
F2_INITIAL_TRAFFIC_MUTATIONS=0
F2_SAFE_REQUEST_COUNT=966
F2_OBSERVATION_SECONDS=900
FRESH_CANDIDATE_SAMPLE_COUNT_ORIGINAL=2
F2_NEW_CANDIDATE_SAMPLE_COUNT=5
TOTAL_CANDIDATE_SAMPLES_ACROSS_F_AND_F2=7
F2_CANDIDATE_5XX_COUNT=0
F2_CANDIDATE_EXCEPTION_COUNT=0
F2_CANDIDATE_HEALTH=PASS
F2_CANARY_VS_CONTROL_COHERENCE=PASS
INTENTIONAL_402_REQUESTS=0
INTENTIONAL_PAYMENT_AUTHORIZATIONS=0
INTENTIONAL_SIGNER_CALLS=0
INTENTIONAL_PAID_POSTS=0
INTENTIONAL_SETTLEMENTS=0
F2_ROLLBACK_TRAFFIC_MUTATIONS=0
F2_END_PRODUCTION_TRAFFIC=99%
F2_END_CANDIDATE_TRAFFIC=1%
SUN1221F_CANARY=PASS
SUN1221G_FINAL_PRODUCTION_PROMOTION_ELIGIBLE=YES
SUN1221F2_EVIDENCE_COMMIT_SHA=(this commit)
NEXT_REQUIRED_CHECKPOINT=SUN-1221G
```

STOP. No G executed. No promotion. No traffic change above 1%. Production
left at `de70bf98@99%` / `db7054c9@1%`, exactly as SUN-1221F left it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
