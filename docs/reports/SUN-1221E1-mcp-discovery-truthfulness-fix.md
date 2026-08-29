# SUN-1221E1 — MCP Discovery Truthfulness Fix

Root-cause-constrained fix, TDD implementation, mutation proof, full
regression. No Worker upload, no deployment, no traffic shift, no live
request, no payment, no economic action.

## Root cause

SUN-1221E's zero-traffic qualification of the `web_context_verified.v2`
candidate stopped before any payment step because the official MCP client's
`siteborne_get_service_health` tool returned hardcoded, stale values —
`production_enabled: false` globally and, per service, `implementation:
'local_fixture_verified'`, `production: 'production_disabled'`, `external:
'not_live'` — for every service, regardless of actual runtime state. At the
same instant, REST `/catalog`, `/services/<id>`, the agent card, and `/ready`
all correctly reported both `verify_agent_output.v2` and
`web_context_verified.v2` as truthfully production-active on the exact same
candidate. This is the same class of defect SUN-1220P1/P2 and SUN-1220Q1/Q2
fixed for REST discovery and `/ready` — MCP was simply never brought into
either fix's scope (`packages/protocol-mcp/src/server.ts` predates both).

## Fix

One new shared resolution layer in `production-payment.ts`:

- `resolveEffectiveServiceRuntimeStatus(serviceId, env, hasDb)` — returns
  `{ hasProductionExecutor, productionEnabled, externalConfigured }` by
  delegating to the exact same `EFFECTIVE_DISCOVERY_RESOLVERS` registry
  every other surface already used. `externalConfigured` is deliberately
  defined as the resolver's own synchronous dependency-presence result — no
  live provider call is ever made from a public discovery request.
- `resolveEffectiveProductionStatusByServiceId(env, hasDb)` — the aggregate
  map form, now the single implementation `catalog.ts`, `a2a.ts`, and
  `readiness.ts` all consume (previously each had its own thin wrapper over
  `EFFECTIVE_DISCOVERY_RESOLVERS`; this consolidates them without changing
  any of their observable behavior).

`mcp.ts` now builds its `services` health map from
`resolveEffectiveServiceRuntimeStatus` for every `MCP_SERVICE_TOOLS` entry,
and its aggregate `production_enabled` from whether any resolved service is
active. `protocol-mcp`'s `McpHealthConfiguration`/`McpServiceHealthStatus`
types and `createSiteborneMcpServer` were widened from literal `false`/
per-field literals to real booleans/enums with the previous hardcoded values
kept only as the *default* when no `health.services` override is supplied
(preserving every other MCP consumer's existing behavior byte-for-byte).
`production_ready: false` stays a hardcoded literal — unchanged, matching
`/ready`'s own established distinction between broader platform-readiness
narrative and this-service runtime state (SUN-1220Q1 §9/§4D).

## TDD

`multi-service-discovery.test.ts` gained MCP-specific coherence assertions
(the file grew from 13 to 25 tests) using the repository's own official
`@modelcontextprotocol/client`/`StreamableHTTPClientTransport`, not a
hand-rolled JSON-RPC client — proving MCP agrees with REST catalog/agent-card/
readiness across the full gate-permutation matrix already established for
those surfaces, plus that MCP performs zero provider-network calls.

A new mutation-proof script, `scripts/test-mcp-coherence-mutation-caught.mts`,
proves 12 deliberate mutations (hardcoded disabled/not-live values
reintroduced, service-identity ignored, gates ignored, MCP/REST divergence in
either direction, one service left stale while the other is fixed, an
unsupported service accidentally advertised active, Nevermined leaking into
CDP health, the shared resolver bypassed with bespoke MCP-only logic) are all
individually caught, then restores byte-for-byte and re-confirms green:

```
[mcp-coherence-mutation-proof] 12/12 caught
[mcp-coherence-mutation-proof] PASS
```

`scripts/test-worker-runtime.mts` gained **PHASE 9** — the real-workerd
counterpart: boots the real production entrypoint under candidate-equivalent
gates for both services, calls the official MCP tool over real HTTP, and
proves `production_enabled: true` aggregate, both services
`real_executor`/`production_enabled`/`configured`, unsupported services stay
`production_disabled`/`not_live`, and zero requests reach any external
provider host during the call (grepped from the real dev-server log).

## Regression

```
LINT=PASS
TYPECHECK=PASS
TESTS=2305 passed, 0 failed, 37 skipped
WORKER_RUNTIME=92/92 (was 88/88; +4 new PHASE 9 scenarios)
PRODUCTION_PREFLIGHT=PASS
```

Pre-existing mutation-proof scripts re-run clean after the `catalog.ts`/
`readiness.ts` consolidation onto the new shared functions:

```
discovery-truthfulness: 10/10 caught
readiness-truthfulness: 16/16 caught
web-context-v2:         19/19 caught
mcp-coherence:          12/12 caught
```

## Production state

Untouched throughout — this is a source-only fix. Confirmed unchanged at the
version SUN-1221E's own mandatory restoration left it at:

```
FINAL_PRODUCTION_VERSION = de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC = 100%
ACTIVE_DEPLOYMENT_VERSION_COUNT = 1
PRODUCTION_PREFLIGHT = PASS
```

## Secrets scan

```
NEW_SECRET_FINDINGS = 0
```

(Same pre-existing `BASESCAN_TOKEN_CONTRACT` public-contract-address false
positive documented since SUN-1220P2, unrelated to this checkpoint.)

## Next step

This fix closes the exact gap SUN-1221E's own report identified as "the
smallest exact next gap." A fresh zero-traffic qualification of
`2044d898-0e42-4d3a-b7c1-d080b463e91e` — and, if that passes, the real paid
E2E for `web_context_verified.v2` — requires its own new, explicit human
authorization; SUN-1221E's authorization was already consumed and this report
does not renew or extend it. No live request, deployment, or payment step was
performed in this checkpoint.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
