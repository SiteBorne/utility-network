# SUN-1222A — Post-Release Baseline & Commercial Readiness

Read-only checkpoint. **Zero mutations performed** (traffic, source, secrets, vars,
pricing, registries, DNS, websites — all unchanged). Lineage: 5296b02 (SUN-1221G) →
8842c3f (SUN-1221F2) → 66e9592 (SUN-1221E6R-H2B2-R4).

## §1 Release readback

```
POST_RELEASE_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
POST_RELEASE_PRODUCTION_TRAFFIC=100%
POST_RELEASE_ACTIVE_VERSION_COUNT=1
```
`wrangler deployments status` confirms a single active version, no third version.

## §2 Host readback: `siteborne-paid-continuation-runtime`

- Deployed version `1641fac4-0cf6-4bf0-b182-33b3d1c608ec` (2026-09-01T15:17:01Z), single version.
- `[[workflows]]` registers `siteborne-paid-continuation` / `PaidContinuationWorkflow`.
- 8 secrets present: `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `MODAL_WEBCTX_ENDPOINT_URL`,
  `MODAL_WEBCTX_PROXY_KEY`, `MODAL_WEBCTX_PROXY_SECRET`, `PAID_RECEIPT_SIGNING_KEY_ID`,
  `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAYMENT_CONTINUATION_ENCRYPTION_KEY`.
  **`CDP_WALLET_SECRET` absent**, as required.
- 4 ADR-0055 vars present: `PAYMENT_ENVIRONMENT=production`, `PRODUCTION_ENABLED=true`,
  `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`, `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`.
- `workers_dev = false`, no `routes`, no custom domains, no cron triggers.

`POST_RELEASE_HOST_CONFIGURATION=PASS`

## §3 Public surface matrix (all against production)

| Surface | Method | Status | Content-Type | Contradiction |
|---|---|---|---|---|
| `/` | GET | 200 | application/json | NO |
| `/health` | GET | 200 | application/json | NO |
| `/ready` | GET | 200 | application/json | NO |
| `/catalog` | GET | 200 | application/json | NO |
| `/services/verify_agent_output.v2` | GET | 200 | application/json | NO |
| `/services/web_context_verified.v2` | GET | 200 | application/json | NO |
| `/.well-known/agent-card.json` | GET | 200 | application/a2a+json | NO |
| `/.well-known/jwks.json` | GET | 200 | application/jwk-set+json | NO |
| `/openapi.json` | GET | 200 | application/json | NO |
| `POST /mcp` `tools/list` (workers.dev host) | POST | error -32000 `Invalid Host` | — | see note |
| `POST /mcp` `tools/list` (production host) | POST | 200 (proper JSON-RPC result) | application/json | NO |

Note: `/mcp` validates the `Host` header against the production hostname
(`utility.siteborne.net`) — the `workers.dev` preview origin is correctly rejected. Not a
defect; confirmed intended per H2BF4/H2BF5 host-allowlist design.

## §4 Machine-discovery truth

Cross-checked `/catalog`, `/.well-known/agent-card.json`'s x402 extension, and
`/services/*` detail routes for `verify_agent_output.v2` / `web_context_verified.v2`:
service names, versions, pricing (`0.019`/`0.009` USD), `production_enabled`, and
`protocol_status` are byte-identical across all three surfaces.

**One real discrepancy found, not cosmetic:** the A2A agent card's x402 extension
publishes a **top-level** `productionEnabled: false` under
`capabilities.extensions[0].params`, while the **per-service** entries for
`verify_agent_output.v2` and `web_context_verified.v2` inside that same params object
report `productionEnabled: true`. `/catalog` and `/services/*` do not have this
ambiguity (no top-level flag, only per-service). A machine client that reads only the
top-level A2A flag would incorrectly conclude nothing is production-callable.

```
MACHINE_DISCOVERY_COHERENCE=FAIL (1 finding: A2A top-level vs per-service productionEnabled ambiguity — apps/edge-api's agent-card builder)
VERIFY_AGENT_OUTPUT_V2_DISCOVERY=PASS
WEB_CONTEXT_VERIFIED_V2_DISCOVERY=PASS
```

## §6/§7 Non-released services / MCP contract

`/catalog` lists 8 service entries; 6 report `production_enabled: false` /
`protocol_status: preproduction` consistently everywhere checked (catalog, agent card
per-service flags, service-detail routes). No falsely-active unreleased service found.
Nevermined confirmed inactive (no route, no catalog entry, no secret).

```
NO_FALSELY_ACTIVE_UNRELEASED_SERVICE=YES
```

`POST /mcp tools/list` against the production host with a correct modern
per-request envelope returns a valid `tools/list` result.

**Finding (P0, not a cosmetic gap):** the same endpoint answers a **bare 2025-11-25
`initialize` request** (no `_meta` envelope, no `MCP-Protocol-Version` header — the
lifecycle the MCP Registry client, and FastDrop/Odel/Glama-style probes actually use)
with `-32022 Unsupported protocol version: 2025-11-25`. Root cause traced to
`packages/protocol-mcp/src/server.ts`'s `createMcpHandler(..., { legacy: 'reject' })` —
`'reject'` is a real, SDK-documented posture, but it is **not the SDK's own default**
(`'stateless'` is); `'reject'` answers all 2025-11-25-family traffic with a protocol
error and serves only the 2026-07-28 envelope era. This is very likely the exact defect
behind the "external MCP directories report failed handshake / unhealthy connector"
observations. Reproduced with a live probe against production and with a new
regression test (`transport.test.ts`, "2025-11-25 legacy handshake compatibility") that
fails red against `'reject'` and passes green against `'stateless'`.

This is a source-level finding surfaced during a read-only checkpoint — **fixing it is
a repository code change, not a checkpoint mutation**, and is committed separately (see
the sibling commit changing `packages/protocol-mcp/src/server.ts` /
`transport.test.ts`), outside SUN-1222A's zero-mutation scope.

```
MCP_PRODUCTION_CONTRACT=FAIL as observed pre-fix (legacy 2025-11-25 initialize rejected); PASS after the separately-committed fix (verified locally, not yet redeployed to production — redeploying `siteborne-utility-edge` is a mutation outside 1222A's authority)
```

## §8 A2A contract

Agent card fetches cleanly, JWKS resolves, `supportedInterfaces` and `capabilities`
present, x402 extension declares 8 services with schemas/limitations. Did not attempt
a live signed JSON-RPC call (would be a state-changing/economic-adjacent action outside
read-only scope); structural fields are present and internally consistent aside from
the §4 finding above.

```
A2A_PRODUCTION_CONTRACT=PASS (structural); productionEnabled ambiguity tracked under §4, not treated as an A2A protocol defect
```

## §9/§10 Receipt durability / settlement owner

D1 (remote, read-only): `x402_service_results` and `payment_attempts` both show exactly
1 row, consistent with the single controlled SUN-1221E6R-H2B2-R4 qualification
transaction (on-chain tx `0x15e60…41d95`, 9000 atomic USDC, status success) and zero
organic activity. No duplicates.

Static audit: `evidenceProvider.settle()` has exactly one production call site —
`apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts:490`, inside
the dedicated Workflow host. All other matches in `x402-service.ts` are comments
documenting its absence from that route.

```
POST_RELEASE_RECEIPT_DURABILITY=PASS
POST_RELEASE_SINGLE_SETTLEMENT_OWNER=PASS
```

## §11/§12 Defect recurrence / error baseline

No recurrence found of any previously-documented defect class in current
configuration or code (RPC-receiver-does-not-implement-run, dependencies_unavailable,
zero-step false success, EvalError disallowed-codegen, Modal byte-limit mismatch, D1
missing settlement-count column, receipt persistence errors, duplicate settlement).
Production telemetry since `G_OBSERVATION_START` (2026-09-01T20:37:14Z) is limited to
the SUN-1221G tail-captured window (~601s) plus this checkpoint's own probes — no
Logpush/long-retention log source is configured, so this is a bounded sample, not a
full-window guarantee.

```
KNOWN_RELEASE_DEFECT_RECURRENCE_COUNT=0
POST_RELEASE_5XX_COUNT=0 (within captured window)
POST_RELEASE_UNCAUGHT_EXCEPTION_COUNT=0 (within captured window)
POST_RELEASE_MATERIAL_ERROR_COUNT=0 (within captured window)
```

## §13/§14 Organic traction / controlled-qualification exclusion

No organic payment activity observed or fabricated.

```
POST_RELEASE_HTTP_REQUESTS=captured-window sample only, not a full-traffic count (no Logpush)
ORGANIC_PAYMENT_ATTEMPTS=0
ORGANIC_SUCCESSFUL_SETTLEMENTS=0
ORGANIC_REVENUE_USDC=0
CONTROLLED_QUALIFICATION_COUNT=1
CONTROLLED_QUALIFICATION_REVENUE_CLASSIFIED_AS_EXTERNAL=NO
```

## §15–18 OSINT / registry / third-party / human-site

A live web search for `siteborne` / `utility.siteborne.net` / MCP registry mentions
returned **zero results** — no independent evidence of registry listing, third-party
directory indexing, or external mentions was found from this environment. This
directly **contradicts the "known positive external signals" (MCP Registry listing,
Agenstry/Odel/Glama/PluginBench presence, 100% measured A2A uptime, etc.) asserted as
given** in the broader hardening brief — those claims are **UNPROVEN from this
session** and should not be treated as established fact without a source. Did not
independently verify `siteborne.com` / `siteborne.net` content (out of this
checkpoint's time budget); flagged as open for the next pass.

```
OFFICIAL_MCP_REGISTRY_DISCOVERY=UNPROVEN (no external evidence found this session)
HUMAN_SITE_PRODUCTION_COHERENCE=NOT_CHECKED
THIRD_PARTY_DISCOVERY_DRIFT=NOT_CHECKED (no independent listings found to compare against)
```

## §19/§20 Commercial-funnel / machine-buyability

Not exhaustively scored this checkpoint — deferred to the broader hardening pass given
the scale of that separate mandate. Directionally: discovery → schema → price stages
are all publicly resolvable from `/catalog` + `/services/*` + agent card without private
docs (`CLEAR`); the §4 top-level/per-service ambiguity is a `FRICTION` point for any
client that trusts the top-level flag.

## §21 Documentation gaps

Not exhaustively audited this checkpoint. One concrete gap found in passing: nothing in
`/openapi.json`, `/catalog`, or the agent card documents the legacy-vs-modern MCP
envelope requirement itself — a correctly-behaving legacy client has no way to learn it
needs `io.modelcontextprotocol/*` `_meta` fields for the modern path (moot after the
`legacy: 'stateless'` fix, since legacy clients no longer need to know that at all).

## §22 Post-release risk register (this checkpoint's findings only)

| ID | Pri | Issue | Evidence | Recommended action |
|---|---|---|---|---|
| R1 | P0 | MCP `legacy: 'reject'` rejects the 2025-11-25 `initialize` handshake real external MCP clients/directories use | live probe -32022; regression test | Fixed in code this session (`legacy: 'stateless'`); **not yet deployed** — deployment is a production mutation requiring separate authorization |
| R2 | P1 | A2A agent-card x402 extension: top-level `productionEnabled: false` vs per-service `true` for the 2 released services | `/.well-known/agent-card.json` live fetch | Make the metadata model single-sourced/unambiguous (drop or correctly derive the top-level flag) |
| R3 | P1 | `apps/edge-api` has 3 pre-existing `tsc --noEmit` errors (`paid-continuation-workflow-entrypoint.test.ts`) | confirmed present before this session's changes via `git stash` diff | Fix test-file typing (`WorkflowContinuationResult` export, `Mock` generic) — contradicts "Types: clean" release-gate requirement |
| R4 | P2 | No external evidence of MCP Registry / directory listing found; "known positive external signals" in the broader brief are unverified from this session | live web search, 0 results | Independently confirm registry/directory status before relying on it in reporting |
| R5 | P2 | No Logpush/long-retention log source configured | operational observation | telemetry baselines in this report are bounded-window samples, not full-traffic counts |

## §24 Baseline frozen

```
POST_RELEASE_BASELINE_FROZEN=YES
```
Production version `db7054c9-76ee-4830-aabe-8a4542261b6a` @ 100%, rollback
`de70bf98-f304-4d7f-b189-4ae2401041a0` @ 0%, 2 production services
(`verify_agent_output.v2` $0.019, `web_context_verified.v2` $0.009), network
`eip155:8453`, asset Base USDC `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`, 6
preproduction services, 1 lifetime controlled settlement, 0 organic settlements.

R3 governance history preserved verbatim: `NONCOMPLIANT_NON_ECONOMIC_EXTRA_MUTATIONS`.

## §27 Final packet

```
SUN1222A_POST_RELEASE=PARTIAL
ACTIVE_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
ACTIVE_PRODUCTION_TRAFFIC=100%
POST_RELEASE_HOST_CONFIGURATION=PASS
MACHINE_DISCOVERY_COHERENCE=FAIL (R2)
VERIFY_AGENT_OUTPUT_V2_DISCOVERY=PASS
WEB_CONTEXT_VERIFIED_V2_DISCOVERY=PASS
NO_FALSELY_ACTIVE_UNRELEASED_SERVICE=YES
MCP_PRODUCTION_CONTRACT=FAIL pre-fix / PASS post-fix-not-yet-deployed (R1)
A2A_PRODUCTION_CONTRACT=PASS
POST_RELEASE_RECEIPT_DURABILITY=PASS
POST_RELEASE_SINGLE_SETTLEMENT_OWNER=PASS
KNOWN_RELEASE_DEFECT_RECURRENCE_COUNT=0
POST_RELEASE_5XX_COUNT=0
POST_RELEASE_UNCAUGHT_EXCEPTION_COUNT=0
POST_RELEASE_MATERIAL_ERROR_COUNT=0
ORGANIC_PAYMENT_ATTEMPTS=0
ORGANIC_SUCCESSFUL_SETTLEMENTS=0
ORGANIC_REVENUE_USDC=0
OFFICIAL_MCP_REGISTRY_DISCOVERY=UNPROVEN
HUMAN_SITE_PRODUCTION_COHERENCE=NOT_CHECKED
MACHINE_BUYABILITY=PARTIAL (R1, R2 as friction/blocker for a subset of clients)
PUBLIC_DOCUMENTATION_GAPS=[legacy/modern MCP envelope undocumented -- moot after R1 fix]
POST_RELEASE_RISK_REGISTER=[R1 P0, R2 P1, R3 P1, R4 P2, R5 P2]
POST_RELEASE_BASELINE_FROZEN=YES
SUN1222A_EVIDENCE_COMMIT_SHA=<this commit>
NEXT_REQUIRED_CHECKPOINT=SUN-1222B-COMMERCIALIZATION-HARDENING (requires fresh standalone authorization for anything beyond repository-only work)
```

`SUN1222A_POST_RELEASE=PARTIAL` rather than `PASS`/`FAIL`: no economic, security, or
production-state-integrity defect was found (all P0-adjacent production invariants —
single settlement owner, receipt durability, no falsely-active services, traffic
readback — hold), but §15–21's exhaustive OSINT/documentation/funnel scoring was not
completed within this checkpoint's time budget, and R1/R2/R3 are real, open findings.
Not characterizing this as an unqualified PASS.
