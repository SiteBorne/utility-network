# SUN-1217 Checkpoint W — Verify v2/CDP Executable Candidate: 0%-Traffic Production Edge Smoke, Authoritative Attribution, Mandatory Restoration

Status: **complete.** The exact SUN-1216 executable candidate
(`f39acc84-f574-4676-8f78-171ff7402c66`) was placed into the active production
deployment at 0% traffic, authoritatively version-attributed and smoke-tested at
the real Cloudflare edge, and the temporary deployment was then restored to
known-good-only. No paid route was activated, no signer executed, no economic
behavior occurred, and the payment-evidence R0 remains open exactly as carried
forward.

## 1. Starting repository/live state

```
START_HEAD=bf9f6b041595ec84eb25c029ac54a95022b5aba7
WORKING_TREE=CLEAN
```

Read the final SUN-1216 report from repository authority
(`docs/reports/SUN-1216-checkpoint-v-verify-v2-cdp-production-bundle-integration-candidate-freeze.md`).
Independently re-verified, live: current production
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` @ 100%; candidate
`f39acc84-f574-4676-8f78-171ff7402c66` exists, undeployed,
`CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`.

## 2. Frozen candidate identity

```
CANDIDATE_VERSION_ID=f39acc84-f574-4676-8f78-171ff7402c66
compatibility_date=2026-08-05
compatibility_flags=[nodejs_compat]
DB binding=present
NVM_ENVIRONMENT=sandbox
```

All 6 secret names present (`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`,
`PAID_RECEIPT_SIGNING_KEY_ID`) — values never read, retrieved, or printed.
`CANDIDATE_ACTIVATION_VARS_PRESENT=0`. Preview routing disabled.

**Source/bundle freeze verification** — recomputed all four identity hashes
fresh from the current repo and compared against the SUN-1216 report's frozen
values:

```
LOCKFILE_SHA256        = b95d04c58768f6e047edc5717cc03ccd82865240083767984683eda7eb1d923d  (MATCH)
WRANGLER_CONFIG_SHA256 = 10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387  (MATCH)
BUNDLE_SHA256           = d19287066896d6db58cc90dab6a7d7d872015a2fcae34441bb1709ea8e0a4fb7  (MATCH)
```

```
CANDIDATE_SOURCE_IDENTITY=PASS
CANDIDATE_BUNDLE_IDENTITY=PASS
CANDIDATE_CONFIG_IDENTITY=PASS
CANDIDATE_LOCKFILE_IDENTITY=PASS
```

## 3. Starting production reconciliation (§4)

Live-verified before any mutation: `GET /health`=200, `GET /ready`=200,
`GET /mcp`=405, all 12/12 paid REST routes (including `/v2/verify/agent-output`)
=404. `pnpm production:preflight` → PASS.

```
SUN1217_START_PREFLIGHT=PASS
```

## 4. Attribution authority

The existing authenticated `wrangler tail --format json` OAuth session was
tested first and confirmed sufficient — a probe request against `/health`
returned a fully attributable event (Ray ID, `scriptVersion.id`, `outcome`,
`status`, `cpuTime`/`wallTime`, `exceptions: []`) with zero additional
credential provisioning.

```
TEMP_OBSERVABILITY_TOKEN_CREATED=NO
```

## 5. Pre-deployment attribution calibration

One ordinary `GET /health` sent before any deployment mutation. Captured Ray ID
`a2f7...5620` attributed to `siteborne-utility-edge` →
`scriptVersion.id f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` → `outcome: ok`.

```
PREDEPLOY_ATTRIBUTION_BASELINE=PASS
```

## 6. Deployment A — temporary 100/0 deployment

Executed on your explicit authorization, exactly once, unambiguous output — no
repeat:

```bash
pnpm exec wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100% \
  f39acc84-f574-4676-8f78-171ff7402c66@0% \
  --name siteborne-utility-edge \
  --message "SUN-1217 zero-traffic executable candidate smoke" \
  -y
```

```
DEPLOYMENT_A_CREATED_AT=2026-08-23T04:07:08.503Z
```

(Wrangler 4.119.0's `deployments status`/`deployments list` expose no separate
numeric/UUID deployment identifier — Created timestamp + message is the identity
it prints; recorded literally as such.)

## 7. Deployment A read-back

`wrangler deployments status` (read-only), immediately after:

```
(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
(0%)   f39acc84-f574-4676-8f78-171ff7402c66
```

```
KNOWN_GOOD_IN_ACTIVE_DEPLOYMENT=YES
KNOWN_GOOD_PERCENT=100
CANDIDATE_IN_ACTIVE_DEPLOYMENT=YES
CANDIDATE_PERCENT=0
ZERO_TRAFFIC_DEPLOYMENT_VERIFIED=YES
```

## 8. Ordinary-routing proof before overrides

Two ordinary requests (`GET /health`, `GET /ready`) sent with no override
header, under a fresh `wrangler tail` session:

| Path      | Ray ID             | scriptVersion.id | Status |
| --------- | ------------------ | ---------------- | ------ |
| `/health` | `a2f7407eb8445620` | `f4f20676-...`   | 200    |
| `/ready`  | `a2f740858c9e1d72` | `f4f20676-...`   | 200    |

Both attributed to known-good, not candidate.

```
ORDINARY_ROUTING_DURING_ZERO_PERCENT=KNOWN_GOOD
```

## 9. First candidate override attribution

One `GET /health` with
`Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="f39acc84-f574-4676-8f78-171ff7402c66"`:

```
Ray ID a2f7415bea512080 → siteborne-utility-edge → scriptVersion.id f39acc84-f574-4676-8f78-171ff7402c66 → HTTP 200 → outcome ok → exceptions: []
```

```
CANDIDATE_OVERRIDE_ATTRIBUTION=PASS
```

## 10. Candidate public surface smoke

All 7 governed public surfaces, via candidate override:

```
/health                         200
/ready                          200
/                                200
/.well-known/agent-card.json    200
/.well-known/jwks.json          200
/catalog                        200
/openapi.json                   200
GET /mcp                        405
```

```
CANDIDATE_PUBLIC_SURFACES=PASS
```

## 11. Candidate readiness truthfulness

Candidate `/ready` body (via override), verbatim:

```json
{
  "status": "not_ready",
  "phase": "foundation",
  "production_services_enabled": false,
  "blocked_external": [
    "cloudflare_account_configuration",
    "ionos_dns_migration",
    "seller_wallet",
    "cdp_credentials",
    "nevermined_credentials",
    "registry_publication"
  ],
  "reason": "Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available."
}
```

```
CANDIDATE_READINESS_TRUTHFUL=YES
```

## 12. Candidate 12-route paid containment

All 12 paid REST routes, via candidate override, no payment material:

```
/v1/company/evidence-graph                  404
/v1/web/context                             404
/v1/document/evidence-json                  404
/v1/verify/agent-output                     404
/v2/company/evidence-graph                  404
/v2/web/context                             404
/v2/document/evidence-json                  404
/v2/verify/agent-output                     404   <- the exact newly-bundled route, first real-edge proof
/v2/nevermined/company/evidence-graph       404
/v2/nevermined/web/context                  404
/v2/nevermined/document/evidence-json       404
/v2/nevermined/verify/agent-output          404
```

```
CANDIDATE_PAID_ROUTES_DISABLED=12/12
CANDIDATE_VERIFY_V2_CDP_STATUS=404
CANDIDATE_PAYMENT_CHALLENGES=0
CANDIDATE_SERVICE_EXECUTIONS=0
CANDIDATE_SIGNER_EXECUTIONS=0
```

## 13. Candidate MCP boundary

Discovery via the official `@modelcontextprotocol/client` SDK (matching this
repository's existing qualified pattern —
`versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } }`, transport `fetch`
override adding the candidate version-override header) run from a temporary
script placed inside `packages/protocol-mcp/scripts/` (a real workspace package
directory, needed for module resolution — matching this project's established
workaround for bare scripts outside the pnpm workspace) and deleted immediately
after use; confirmed via `git status --short` clean afterward.

```
TOOLS_COUNT=6
TOOL_NAMES=siteborne_company_evidence_graph, siteborne_web_context_verified,
  siteborne_document_evidence_json, siteborne_verify_agent_output,
  siteborne_get_quote, siteborne_get_service_health
```

Additional raw-HTTP boundary tests, all via candidate override:

```
GET /mcp                                405
malformed JSON body                     400
wrong content-type (text/plain)         415
oversize request (1MiB padding)         413
```

No paid MCP tool call was sent — per directive §22's own instruction ("an unpaid
paid-tool request may be tested only if repository authority proves it remains
pre-execution ... otherwise omit it"), this was omitted as the more conservative
choice rather than risk any ambiguity about whether the MCP dispatch path could
reach economics differently than the already-proven REST path.

```
CANDIDATE_MCP_DISCOVERY=PASS
CANDIDATE_MCP_SERVICE_EXECUTION=0
CANDIDATE_MCP_PROVIDER_CALLS=0
```

## 14. Candidate telemetry

Two `wrangler tail` capture windows covered the MCP boundary smoke (6 events)
and the full public-surface + 12-route smoke (20 events, 19 candidate + 1
unrelated ambient request to known-good, confirmed not mine by version/status
mismatch with anything I sent). Combined:

```
candidate invocation count = 25 (6 + 19)
status distribution: 200×9, 404×12, 405×2, 400×1, 415×1, 413×1
outcome distribution: ok×25 (100%)
exception count = 0
error count = 0
CPU median/max ≈ 5ms / 20ms
wall median/max ≈ 8ms / 56ms
```

```
CANDIDATE_UNHANDLED_EXCEPTIONS=0
CANDIDATE_TELEMETRY_ERRORS=0
CANDIDATE_REQUEST_RUNTIME_EVAL_FAILURES=0
CANDIDATE_PAYMENT_EVENTS=0
CANDIDATE_SETTLEMENT_EVENTS=0
CANDIDATE_TRANSACTIONS=0
CANDIDATE_LIVE_PROVIDER_EVENTS=0
CANDIDATE_FIXTURE_EXECUTIONS=0
```

Telemetry logs were also scanned for payment/settlement/transaction/
facilitator/signer/nevermined/CDP-provider literal terms — zero hits. The
`synthetic_fixture` string marker present in the frozen bundle's source (per
SUN-1216 §18a/§18b) was not itself treated as an execution event — no runtime
log, exception, or telemetry field referencing it appeared anywhere in this
smoke's captured events, consistent with it never being reachable while
`PAID_ROUTES_ENABLED` is absent.

## 15. Performance sanity

Candidate `/health`/`/ready` and every other smoke request stayed well under the
emergency thresholds (CPU > 100ms OR wall > 1000ms) — actual observed max CPU
20ms, max wall 56ms, both from the MCP oversize-rejection request (413), not
`/health`/`/ready` specifically (those were single-digit ms).

## 16. Payment/economic zero proof

No payment challenge, signature, settlement, transaction, provider invocation,
fixture execution, or paid D1 write was observed anywhere in the captured
telemetry or HTTP responses across the entire smoke. Every paid route returned
404 before any economics-adjacent code could run (confirmed architecturally in
SUN-1216: the gate check is the first statement in the new route handler, and
every other paid route's wildcard fallback checks the same flag before
constructing anything).

## 17. Restoration deployment

```bash
pnpm exec wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100% \
  --name siteborne-utility-edge \
  --message "SUN-1217 restore known-good after zero-traffic smoke" \
  -y
```

Executed once, unambiguous success. Read-back (`wrangler deployments status`):

```
CURRENT_ACTIVE_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_ACTIVE_TRAFFIC=100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
SUN1217_RESTORATION=PASS
```

## 18. Post-restoration attribution proof

One ordinary `GET /health` and one `GET /health` still carrying the now-stale
candidate override header, both sent after restoration:

| Request                  | Ray ID             | scriptVersion.id | Status |
| ------------------------ | ------------------ | ---------------- | ------ |
| ordinary                 | `a2f74aaaadd51646` | `f4f20676-...`   | 200    |
| stale candidate override | `a2f74ab17818de68` | `f4f20676-...`   | 200    |

The override header, sent against a candidate no longer in the active
deployment, resolved to known-good — proving the candidate provides no
attribution once removed, not merely that the HTTP body looked normal.

```
POST_SMOKE_CANDIDATE_NORMAL_ROUTING=NO
POST_SMOKE_RESTORATION_ATTRIBUTION=PASS
```

## 19. Final production preflight

```
pnpm production:preflight → PASS
GET /health = 200
GET /ready  = 200
GET /mcp    = 405
12/12 paid REST routes = 404
```

```
POST_SMOKE_PRODUCTION_PREFLIGHT=PASS
```

## 20. Payment-evidence R0 — carried forward literally

```
PAYMENT_EVIDENCE_R0_STANDING=YES
```

Not touched, not exercised, not closed, not worsened by this checkpoint.
SUN-1217 never enabled `PAID_ROUTES_ENABLED`, never reached the composition's
CDP evidence resolution, and the candidate's paid route returned 404 on every
single request — the economic lifecycle this R0 concerns was never entered. The
next checkpoint (SUN-1218) must begin with resolving this blocker before any
real paid transaction is accepted as release evidence, per your standing
instruction.

## 21. Mutation accounting

```
WORKER_VERSIONS_CREATED=0
CANDIDATE_UPLOADS=0

DEPLOYMENTS=2
  temporary 100/0 deployment  (Created 2026-08-23T04:07:08.503Z)
  mandatory known-good restoration  (Created 2026-08-23T04:14:12.203Z)

MAX_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
FINAL_CANDIDATE_TRAFFIC_PERCENT=0

CANDIDATE_OVERRIDE_REQUESTS=26
ORDINARY_REQUESTS=5 (1 pre-deploy baseline, 2 during zero-traffic window, 2 post-restoration)

SECRET_CHANGES=0
BINDING_CHANGES=0
PREVIEW_CHANGES=0
ACTIVATION_VAR_CHANGES=0

PAID_ROUTE_ACTIVATIONS=0

PRODUCTION_MIGRATIONS=0

PAYMENT_SIGNATURES=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
LIVE_PROVIDER_CALLS=0

BOUND_SIGNER_RUNTIME_EXECUTIONS=0
```

D1 activity: not independently measured via direct D1 query during this
checkpoint (no read-only D1 inspection tool was invoked); every request observed
returned before any D1-touching code path could be reached (404 for paid routes,
static/governed responses for public surfaces, protocol-level rejections for MCP
boundary tests) — reported as "not directly measured, architecturally expected
to be zero," not asserted as a directly-verified zero count, per the directive's
own instruction not to claim zero without measurement or guarantee.

## 22. Repository mutation boundary

Expected: evidence report only. Confirmed: `git status --short` clean both
before and after this checkpoint's live work, aside from this one new report
file. No runtime/config source change occurred. The one temporary local script
used for the MCP SDK probe was created inside `packages/protocol-mcp/scripts/`
and deleted immediately after use, confirmed via a clean `git status --short`
afterward — never committed.

---

## SUN-1217 FINAL CLASSIFICATION

```
SUN1217_ZERO_TRAFFIC_EDGE_SMOKE_GATE=PASS

CANDIDATE_EDGE_RUNTIME_PROVEN=YES
CANDIDATE_OVERRIDE_ATTRIBUTION=PASS

CANDIDATE_PUBLIC_SURFACES=PASS
CANDIDATE_READINESS_TRUTHFUL=YES

CANDIDATE_PAID_ROUTES_DISABLED=12/12
CANDIDATE_VERIFY_V2_CDP_STATUS=404

CANDIDATE_MCP_DISCOVERY=PASS

CANDIDATE_UNHANDLED_EXCEPTIONS=0
CANDIDATE_TELEMETRY_ERRORS=0
CANDIDATE_PAYMENT_EVENTS=0
CANDIDATE_SETTLEMENT_EVENTS=0
CANDIDATE_LIVE_PROVIDER_EVENTS=0
CANDIDATE_FIXTURE_EXECUTIONS=0

BOUND_SIGNER_RUNTIME_EXECUTION_PROVEN=NO

PAYMENT_EVIDENCE_R0_STANDING=YES

SUN1217_RESTORATION=PASS

FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%

CONTROLLED_PAID_QUALIFICATION_ELIGIBLE=YES

PAID_ROUTE_ACTIVATION_ELIGIBLE=NO
```

`CONTROLLED_PAID_QUALIFICATION_ELIGIBLE=YES` means only: the exact executable
candidate is edge-qualified sufficiently to proceed to _designing_ a controlled
paid-service test. It does not mean the route may be publicly activated, that
the payment-evidence R0 is closed, that the production signer has been
exercised, or that economic safety is fully proven.

Proposing **SUN-1218 — Payment-Evidence Production Trust Closure + Controlled
Verify v2/CDP Paid-Qualification Design**, beginning with resolution of the
`synthetic_fixture` settlement-evidence blocker before any tightly bounded real
paid end-to-end test is designed. Not started automatically, per your
instruction.
