# SUN-1100 Checkpoint 1 — Registry Launch Verification

**Starting HEAD:** `0f9ca75` (housekeeping reconciliation of SUN-0800B
checkpoint 3) **Ending HEAD:** `7e02dd8` (this checkpoint's own fixes)
**Classification:** `BLOCKED_EXTERNAL` — 7 of 9 literal criteria PASS, 2 require
direct user action

## Scope correction (governance)

`SUN-1100` was proposed to this checkpoint under a "production cutover
preparation" framing. Per this repository's own `TASKS.yaml`, the literal
`SUN-1100` entry is titled **"Public registry launch (MCP Registry, Agentverse,
Nevermined, npm, GitHub, A2A, OpenAPI, catalog, benchmark, health)"**, phase
`phase_13_registry_launch`, with nine literal `acceptance_tests`. The user
confirmed proceeding against the literal criteria only. This report evaluates
exactly those nine.

## Literal criteria — final status

| #   | Criterion                       | Status               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MCP Registry entry visible      | **BLOCKED_EXTERNAL** | Confirmed `NO_MATCH`: `GET https://registry.modelcontextprotocol.io/v0/servers?search=siteborne` returns `servers: []`. Publishing requires the `mcp-publisher` CLI with GitHub OAuth **device-flow interactive login** (`mcp-publisher --login`), or GitHub OIDC (CI-workflow only). Neither is something this session can perform — same class of constraint as `npm login` earlier this project.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2   | Agentverse registration visible | **BLOCKED_EXTERNAL** | Confirmed `NO_MATCH`: no web-search or documentation evidence of any existing SITEBORNE Agentverse registration. Registration requires an Agentverse account and an `AGENTVERSE_KEY` obtained from that account's dashboard — account creation is outside what this session may perform.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3   | Nevermined plans visible        | **PASS**             | Real, already-registered, already-accepted canonical agent/plan pairs exist on the Nevermined sandbox platform for both v1 (`docs/reports/SUN-0900B-final-completeness-audit.md`, 4/4 `EXACT_EXISTING`) and v2 (`docs/reports/SUN-1000-checkpoint-1o-b1-v2-nevermined-registration-freeze.md`, 4/4 registered with real agent/plan IDs). No new Nevermined call was made this checkpoint (no registration, no verify, no settlement) — this criterion is satisfied entirely from existing, previously-accepted repository evidence, per instruction not to reinterpret "plans visible" as "successful settlement" and not to trigger a new provider call. `NEVERMINED_V2_PROVIDER_STATUS=BLOCKED_EXTERNAL_PROVIDER` is unchanged and is a separate operational concern (live verify/settle), not this registration-visibility criterion. |
| 4   | npm package published           | **PASS** (unchanged) | `@siteborne/mcp-server@0.1.0` confirmed live on the npm registry, license `Apache-2.0`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | A2A Agent Card valid            | **PASS** (unchanged) | `https://utility.siteborne.net/.well-known/agent-card.json` returns 200, `signatures` present, verifies against the live JWKS (`kid: siteborne-agent-card-2026-08`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | OpenAPI document accessible     | **PASS** (unchanged) | `https://utility.siteborne.net/openapi.json` returns 200; now also documents `/benchmarks` (added this checkpoint).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Public catalog endpoint works   | **PASS — repaired**  | **Contradictory evidence found and fixed.** `GET /catalog` returned 200 but `services: []` — confirmed live before the fix. Root cause: `apps/edge-api/src/index.ts` unconditionally wired `/catalog`/`/services/:id` to a module-level in-memory repository that starts empty on every Worker isolate and nothing ever populates. The real D1 `services` table (queried directly via `wrangler d1 execute --remote`) has 8 correctly seeded rows. Fixed by preferring a `D1ServicesRepository(env.DB)` whenever the binding is present. Redeployed once; read-after-write confirms `GET /catalog` now returns all 8 services (4 v1 + 4 v2) and `GET /services/company_evidence_graph.v1` returns 200.                                                                                                                                   |
| 8   | Benchmark endpoint works        | **PASS — repaired**  | Confirmed 404 both locally and live before the fix (`GET /benchmarks` was never implemented, despite being listed as a required free endpoint in `docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md` section 5). Added `apps/edge-api/src/control-plane/routes/benchmarks.ts`, exposing only fixed, already-disclosed local measurement evidence (document-worker OCR benchmarks from `docs/operations/DOCUMENT_BENCHMARKS.md`; the SUN-1000 v2 load-capacity baseline from `security/load/LOAD_MATRIX.md`) — never a live per-request benchmark, never a fabricated production SLA. Redeployed; read-after-write confirms 200 with the expected payload.                                                                                                                                                                        |
| 9   | Health endpoint works           | **PASS** (unchanged) | `https://utility.siteborne.net/health` returns 200.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Summary: 7 passed, 0 failed, 2 blocked_external.**

## External mutations this checkpoint

Two real, additive Cloudflare Worker redeployments (`wrangler deploy`, account
`29a264a25ccfd13882defe49ed3e17b1`, already authenticated from SUN-0800B
checkpoint 3 — no new credential entry), each preceded by a local `--dry-run`
and followed by read-after-write verification against the live custom domain:

1. Added the `GET /benchmarks` route (criterion 8 repair).
2. Fixed `/catalog`/`/services/:id` D1 wiring (criterion 7 repair, found while
   re-verifying criterion 7 as "already-proven" per instruction — contradictory
   evidence, so investigated and fixed rather than blindly preserved).

No MCP Registry submission, no Agentverse submission, no Nevermined
registration/verify/settlement call, no npm publish, no DNS mutation. Zero
economic mutations of any kind.

## Regression

Full `pnpm check` (format, lint, typecheck, all tests including two new test
files — `apps/edge-api/tests/catalog-d1-wiring.test.ts`, additions to
`apps/edge-api/tests/routes.test.ts` — contracts, governance/ state/tasks
validate, `secrets:scan`) passed clean, twice (once before each deploy).
`pnpm tasks:validate` / `governance:validate` / `state:validate` pass against
this report's own `TASKS.yaml` update.

## What remains (both require the user directly)

- **MCP Registry**: run `mcp-publisher --login` (GitHub OAuth device flow,
  interactive) from a real terminal, then `mcp-publisher publish` with a
  `server.json` naming the package under the verified `io.github.SiteBorne/*`
  namespace. This session can prepare `server.json` and the exact commands, but
  cannot complete the interactive login step.
- **Agentverse**: create an Agentverse account, generate an `AGENTVERSE_KEY`
  from its dashboard, then run the registration script
  (`register_with_agentverse`) with that key. This session cannot create
  accounts.

## Final classification

**SUN-1100 = `blocked_external`** (not `accepted` — 2 of 9 literal criteria are
not yet satisfied). `production_ready=false`, `production_enabled=false`
throughout, both unaffected by this checkpoint's fixes.

Per the user's own governing instruction: stop here, do not begin any further
task in this checkpoint. The literal next task from repository authority (once
SUN-1100 is unblocked and accepted) is `SUN-1200` — "First unknown paid
transaction (Level 3 launch success)" — which itself remains blocked
(`blocker: 'Market demand (cannot be forced)'`) and is explicitly not begun
here.
