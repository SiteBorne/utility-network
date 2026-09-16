# METADATA-VCM-IMPL-04A — A2A/MCP Dual-Render Integration, Compare-Only Mode, Fail-Safe Legacy Serving

Implementation checkpoint. Governing design authority: `docs/reports/METADATA-VCM-06-a2a-mcp-canary-integration-design.md` (VCM-06), implemented without redesign.

```
PARENT_VCM_IMPL_03B_IMPLEMENTATION=623cb10
PARENT_VCM_IMPL_03B_EVIDENCE=55e2570
PARENT_VCM_06=cc27824
```

## I. Scope

This checkpoint adds runtime integration plumbing only. `A2A_SERVED_PRODUCER=LEGACY` and `MCP_SERVED_PRODUCER=LEGACY` in every state exercised here, including `shadow_compare`. No candidate Worker Version, no deployment, no traffic change, no environment-variable mutation on any live target.

## II. Files changed

```
apps/edge-api/package.json                                          -- add @siteborne/vcm workspace dependency
apps/edge-api/src/control-plane/config/env.ts                       -- add A2A_METADATA_PROJECTION_MODE / MCP_METADATA_PROJECTION_MODE (both optional string)
apps/edge-api/src/control-plane/config/metadata-projection-mode.ts  -- NEW: parseMetadataProjectionMode / resolveAuthorizedMetadataProjectionMode
apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts -- NEW: the four bounded structured-log counters
apps/edge-api/src/control-plane/metadata/shadow-comparison-runner.ts -- NEW: the one shared, never-throwing comparison entry point both surfaces call
apps/edge-api/src/routes/a2a.ts                                      -- wire comparison at the existing per-isolate cache-rebuild point
apps/edge-api/src/routes/mcp.ts                                      -- wire comparison inline, only for tools/list responses
packages/vcm/src/runtime-model.ts                                    -- NEW: Worker-safe (no node:fs) bootstrap of the real EffectiveMetadataView via static JSON imports of registry/services/*.json
packages/vcm/src/projections/a2a-real-context.ts                     -- NEW: real A2aProjectionContext builder (typed exports + the 5 literals card.ts hardcodes)
packages/vcm/src/projections/mcp-real-context.ts                     -- NEW: real McpProjectionContext builder, from the tool list already served on the current response
packages/vcm/src/index.ts                                            -- export comparator/projections/runtime-model (previously internal-only to 03B's own tests)
pnpm-lock.yaml                                                       -- workspace dependency link
```

Plus test files: `metadata-projection-mode.test.ts`, `metadata-projection-telemetry.test.ts`, `shadow-comparison-runner.test.ts`, `runtime-model.test.ts`, `apps/edge-api/tests/{a2a,mcp}-metadata-shadow-{compare,adversarial}.test.ts`.

No file under `packages/protocol-a2a`, `packages/protocol-mcp`, `packages/protocol-x402`, `registry/`, `governance/`, `packages/contracts`, `schemas/`, or `wrangler.toml` was touched (`git status --short` confirmed; full list in §XXII).

## III. A design gap this checkpoint had to resolve mechanically

VCM-06 specifies *where* comparison must run but not how a Cloudflare Worker (no `node:fs`) obtains a real `CanonicalStaticModel` at all — `legacyRegistryToVCM()` is a pure function of an already-parsed `LegacyRegistryServiceFile[]`; every existing registry-parity test supplies that array via `node:fs`, which does not exist in `workerd`. Two established repo precedents were considered:

- `@siteborne/pricing`'s `EMBEDDED_PRICING`: a hand-maintained literal mirror with a `node:fs` primary path and an embedded fallback, CI-validated for drift.
- A static ES module JSON import (`resolveJsonModule: true` already set in `tsconfig.base.json`).

The pricing pattern trades a real duplicate for an `fs`-available primary path; a JSON import has neither problem, since the bundler (Vite/Vitest for tests, esbuild for the real Wrangler build) inlines the literal file's bytes at build time — there is no second copy to drift, and no runtime `fs` call at all. `packages/vcm/src/runtime-model.ts` uses eight static imports of `registry/services/*.json`, feeds them through the existing, unmodified `legacyRegistryToVCM()` + `project()` (with `emptyOverlay`, since only `STATIC_SEMANTIC_CONTENT` parity is in scope per VCM-06 §X), and memoizes the result once per isolate (module-level, matching `routes/a2a.ts`'s own `cachedA2aAppPromise` pattern). This is additive to `packages/vcm` only — no change to the importer, its tests, or the frozen design.

`SEMANTIC_DESIGN_CHANGE_REQUIRED=NO` — this fills an implementation gap the design left open by construction (it explicitly deferred "how does a Worker get real registry content" to implementation), not a reinterpretation of any VCM-06 decision.

## IV. Migration-mode implementation

```
A2A_PROJECTION_MODE_VALUES = legacy | shadow_compare | vcm_primary_compare | vcm_only
MCP_PROJECTION_MODE_VALUES = legacy | shadow_compare | vcm_primary_compare | vcm_only
```

One shared parser (`metadata-projection-mode.ts`), one strict allow-list, both surfaces call it with their own name for logging:

```
A2A_CONFIG_ABSENT_BEHAVIOR  = legacy, no log
A2A_CONFIG_INVALID_BEHAVIOR = legacy, one console.error line naming surface+rawValue
MCP_CONFIG_ABSENT_BEHAVIOR  = legacy, no log
MCP_CONFIG_INVALID_BEHAVIOR = legacy, one console.error line naming surface+rawValue
```

A second function, `resolveAuthorizedMetadataProjectionMode`, narrows the closed four-value type down to the two states this checkpoint may ever *serve differently on* (`legacy`, `shadow_compare`). `vcm_primary_compare`/`vcm_only` are real, recognized members of the parsed type (the enum stays closed and four-valued, per VCM-06 §V) but are refused here with an explicit `NOT_AUTHORIZED_IN_IMPL_04A` log line and resolved to `legacy` — never silently conflated with a malformed string, so a future authorization checkpoint only has to change this one function.

RED evidence (`metadata-projection-mode.test.ts`, captured before implementation):

```
Error: Cannot find module './metadata-projection-mode' imported from '.../metadata-projection-mode.test.ts'
Test Files  1 failed (1)
```

GREEN: 11/11 tests pass.

## V. A2A integration

```
A2A_LIVE_CALL_GRAPH (unchanged) = apps/edge-api/src/routes/a2a.ts#resolveA2aApp -> protocol-a2a/src/transport.ts (card build + sign, isolate-cached) -> signing.ts/agent-card-signing.ts
A2A_COMPARE_EXECUTION_POINT = inside resolveA2aApp's existing cache-(re)build block, immediately after computing effectiveProductionStatusByServiceId/mtlsProductionActive, before createSiteborneA2aHonoApp(options) -- exactly the point VCM-06 §IX names
```

The resolved, *authorized* mode (`legacy` | `shadow_compare`) is now included in the cache key alongside every other computed input, for the identical reason `mtlsProductionActive` already is (a real deployment never changes `env` mid-isolate; this keeps a test exercising multiple modes against the same imported `app` singleton correctly re-entering the cache-rebuild block). In `shadow_compare`:

1. `existing` = `buildUnsignedSiteborneAgentCard(effectiveProductionStatusByServiceId, mtlsProductionActive)` — the exact same call `transport.ts` already makes, invoked a second time here purely for comparison, on the identical inputs.
2. `buildShadow` = `getRuntimeEffectiveView(...)` → `projectA2aFromVcm(effective, buildRealA2aShadowContext(effectiveProductionStatusByServiceId, mtlsProductionActive))`.
3. Both are handed to `runShadowComparison` (§VII), scheduled via `context.executionCtx.waitUntil(...)` when available, a floating (but internally fail-safe) promise otherwise — matching `x402-service.ts`'s own `safeGetExecutionCtx` defensive pattern for tests with no bound `ExecutionContext`.

`AGENT_CARD_SIGNING_PRIVATE_KEY`/`AGENT_CARD_SIGNING_KEY_ID` are read only by `resolveAgentCardSigningIdentity`, called separately inside the same async block; `scheduleA2aShadowComparison` and everything it calls (`buildRealA2aShadowContext`, `getRuntimeEffectiveView`, `projectA2aFromVcm`) receive neither value. `VCM_SIGNING_SECRET_ACCESS=0` (confirmed by source-reference audit, §XXII).

## VI. MCP integration

```
MCP_LIVE_CALL_GRAPH (unchanged) = apps/edge-api/src/routes/mcp.ts#mcpRoute -> createSiteborneMcpHonoApp (fresh per request) -> protocol-mcp/src/server.ts registerTool x6, stateless SDK handler
```

Direct inspection (not assumed) of a real `tools/list` call against the running app showed the transport serves **every** response, including a plain `tools/list`, as `text/event-stream`:

```
event: message
data: {"result":{"tools":[...]}}
```

`MCP_COMPARE_EXECUTION_POINT` is therefore: clone `boundedRequest` *before* the real `.fetch()` consumes it (safe — the body is already a fully-buffered `Uint8Array` from `readBoundedMcpRequest`, so both clones are independently readable), call the real app, clone the resulting `response` *before* returning it up the stack (nothing has begun reading it yet), then — only in `shadow_compare` — sniff the cloned request's JSON-RPC `method`. If it is not exactly `tools/list`, no comparison runs (confirmed by test: an `initialize` call in `shadow_compare` emits zero `metadata_projection_*` log lines). If it is, the cloned response's SSE body is parsed for the one `data:` line's `result.tools` array, and that real array — not a second synthetic client↔server transport round trip — becomes both the comparison's `existing` value and the source `buildRealMcpShadowContext` draws real tool bodies/schemas from.

`registerTool()`'s six call sites in `packages/protocol-mcp/src/server.ts` are untouched (confirmed: `git status --short` shows no changes anywhere under `packages/protocol-mcp`). VCM never receives a `handler` argument and never calls `registerTool` itself — the mechanical proof required by VCM-06 §XII ("definition-name set == registered-handler-name set") continues to hold by the same construction it always has (both come from the same six call sites), unchanged by this checkpoint.

RED evidence for both A2A and MCP wiring (captured before implementation, `apps/edge-api/tests/{a2a,mcp}-metadata-shadow-compare.test.ts`):

```
A2A: 2 failed (compare_total/match_total assertions; vcm_only-refusal assertion) — 3 passed (behavior already true under unmodified legacy code)
MCP: 2 failed (compare_total/match_total assertions; vcm_only-refusal assertion) — 3 passed (same reason)
```

GREEN after implementation: 5/5 (A2A), 5/5 (MCP).

## VII. Comparator reuse and the shared runner

`shadow-comparison-runner.ts#runShadowComparison` is the one place both surfaces call. It:

- Reuses `@siteborne/vcm`'s `compareProjections`/`summarizeDifferences` unchanged (`OFFLINE_COMPARATOR_RUNTIME_COMPARATOR_SAME_SEMANTICS=YES` — no independently authored normalization logic exists in either route file).
- Returns `Promise<void>` — there is no code path, by construction, through which its result could be served; the shadow value never leaves this function.
- Swallows every failure mode internally: a synchronously-throwing `buildShadow`, an asynchronously-rejecting one, and a throwing telemetry sink are all caught and degrade to, at most, one `metadata_projection_compare_error` log line.

Unit test evidence (`shadow-comparison-runner.test.ts`, 6/6 pass): perfect match → `fellBackToLegacy: false`; real mismatch → `fellBackToLegacy: true` but return value still `undefined`; sync throw in `buildShadow` → resolves `undefined`, never rejects; async rejection in `buildShadow` → same; throwing telemetry sink → same; caller-supplied `governedDifferences` (e.g. A2A's pre-signature `signatures[]` rule) are honored.

## VIII. Telemetry

```
metadata_projection_compare_total{surface}
metadata_projection_match_total{surface}
metadata_projection_mismatch_total{surface,domain}      -- domain is always "static_semantic" in this checkpoint (the only domain modeled)
metadata_projection_fallback_total{surface}
```

All four routed through `console.error` (this repo's `no-console` ESLint rule permits only `warn`/`error`; the repo's own established convention — e.g. the registry-parity suite's `REGISTRY_FILES_PARITY_FAIL` line — already routes non-error informational structured JSON through `console.error`, not `console.log`). Verified by test: no full projection content (`skills`, `tools`, `inputSchema`, `outputSchema`) appears in any emitted line; a throwing `console.error` implementation is caught internally and never propagates.

## IX. Default/absent-config output parity

```
A2A_LEGACY_VS_SHADOW_SERVED_OUTPUT_PARITY = PASS (real assertion: card content with mode absent === card content with mode explicitly "legacy", byte-identical apart from the inherently nondeterministic ES256 signature)
MCP_LEGACY_VS_SHADOW_SERVED_OUTPUT_PARITY = PASS (real assertion: six real tools returned unchanged in both legacy and shadow_compare)
CURRENT_PUBLIC_A2A_OUTPUT_CHANGE = NO
CURRENT_PUBLIC_MCP_OUTPUT_CHANGE = NO
```

Both confirmed by dedicated tests, not by inspection alone. Legacy/absent mode also confirmed to run zero VCM machinery at all (no `metadata_projection_*` log line of any kind) — the "steady-state ≈0" claim in VCM-06 §XXIV is not just latency-cheap, it performs no comparison work whatsoever when unconfigured.

## X. Adversarial integration tests (beyond the pure comparator/runner unit tests)

Real route-level tests (`@siteborne/vcm` module-mocked per test file, Vitest's per-file isolation, so no other test's real-data assertions are affected):

**A2A** (`a2a-metadata-shadow-adversarial.test.ts`, 2/2 pass):
- `projectA2aFromVcm` mocked to drop one skill → served card still has all 8 real skills; `metadata_projection_fallback_total{surface:a2a}` and a `metadata_projection_mismatch_total` with `differenceCount > 0` are both recorded.
- `projectA2aFromVcm` mocked to throw → served card unaffected (8 skills, 1 real signature); no propagation into the response.

**MCP** (`mcp-metadata-shadow-adversarial.test.ts`, 2/2 pass):
- `projectMcpToolsFromVcm` mocked to drop one tool → served response still has all 6 real tools; fallback + mismatch (`differenceCount > 0`) recorded.
- `projectMcpToolsFromVcm` mocked to throw → served response unaffected (6 tools).

## XI. Registry/temporal-authority invariants (re-run, unchanged)

```
REGISTRY_STRUCTURAL_PARITY  = 8/8 PASS (legacy/registry-parity.test.ts, unmodified by this checkpoint)
CANONICAL_ECONOMIC_VALIDITY = 8/8 PASS (validators.test.ts, unmodified)
A2A_CURRENT_EXPOSURE_PARITY = 8/8 PASS (current-exposure.test.ts, unmodified)
MCP_CURRENT_EXPOSURE_PARITY = 6/6 PASS (current-exposure.test.ts / mcp-shadow.test.ts, unmodified)
```

No importer, projector, or parity-checking code was touched; these are re-runs of 03A/03B's own unmodified test files, included here as evidence they still hold after this checkpoint's additions.

## XII. Source-reference audit

```
scheduleA2aShadowComparison  -> apps/edge-api/src/routes/a2a.ts only (definition + one call site)
scheduleMcpShadowComparison  -> apps/edge-api/src/routes/mcp.ts only (definition + one call site)
runShadowComparison          -> routes/a2a.ts, routes/mcp.ts, shadow-comparison-runner.{ts,test.ts} only
recordMetadataProjectionComparison -> shadow-comparison-runner.{ts,test.ts}, metadata-projection-telemetry.{ts,test.ts} only
parseMetadataProjectionMode / resolveAuthorizedMetadataProjectionMode -> routes/a2a.ts, routes/mcp.ts, metadata-projection-mode.{ts,test.ts} only
getRuntimeEffectiveView      -> routes/a2a.ts, routes/mcp.ts, runtime-model.{ts,test.ts}, packages/vcm/src/index.ts (re-export) only
projectA2aFromVcm (edge-api) -> routes/a2a.ts + its adversarial test only
projectMcpToolsFromVcm (edge-api) -> routes/mcp.ts + its adversarial test only
A2A_METADATA_PROJECTION_MODE / MCP_METADATA_PROJECTION_MODE -> env.ts (declaration), routes/a2a.ts, routes/mcp.ts, and test files only -- zero occurrences in wrangler.toml or any deployment config
```

No route, service, or unrelated module imports any new symbol. `git status --short` (full list, §II) confirms zero changes under `packages/protocol-a2a`, `packages/protocol-mcp`, `packages/protocol-x402`, `registry/`, `governance/`, `packages/contracts`, `schemas/`, `wrangler.toml`, or any production/economic configuration.

## XIII. Regression gates

```
Focused RED/GREEN integration tests: all captured above, all GREEN
VCM package suite:      148/148 pass (packages/vcm/src/**)
Edge-API test suite:    1461 pass / 72 skipped, 136/136 files (apps/edge-api/tests/**, apps/edge-api/src/control-plane/**)
  -- includes unmodified a2a-route.test.ts, mcp-route.test.ts, mcp-four-service-acceptance.test.ts,
     x402-service-route.test.ts (37/37), load-v2.test.ts (7/7) -- all pass with zero regression
Repo-wide typecheck (apps/edge-api, packages/vcm): PASS, zero errors
Repo-wide lint (apps/edge-api, packages/vcm):      PASS, zero warnings/errors
Prettier format check (all touched files):          PASS
Secret scan (secrets:scope:verify + scan-working-tree-secrets.ts + gitleaks working-tree scan): PASS, no leaks found
OpenAPI generation:      zero drift (pcc:generate:check, services:generate:check, openapi:generate:check)
Pricing:                 zero drift (pricing:check, pricing:registry:check)
Governance/state:        PASS (governance:validate, state:validate)
Contract baseline/compat/release: PASS (contracts:baseline:verify, contracts:compat:check, contracts:release:verify)
```

### Aggregate-timeout note

One aggregate full-suite run (~1758 tests across 172 files run together) showed a single failure: `load-v2.test.ts`'s `WARMUP` p95-latency assertion (5380ms vs. a fixed 5000ms ceiling) — a real-latency load test wholly unrelated to A2A/MCP/VCM code, run under heavy concurrent host load from the many preceding `vitest`/`tsc` invocations in this same session. Re-run in isolation immediately after: `7/7 pass`, `WARMUP` p95 = 4500ms. Per this checkpoint's own instruction, this is recorded as `FORMAT_VCM_SCOPE=PASS` / `FORMAT_REPO_WIDE=host-contention, non-reproducible in isolation, unrelated file` rather than a blocking regression.

## XIV. Zero-deployment proof

```
DEPLOYMENT_PERFORMED = NO
TRAFFIC_CHANGE_PERFORMED = NO
PRODUCTION_CONFIG_MUTATIONS = 0
ECONOMIC_CONFIG_MUTATIONS = 0
```

No `wrangler` command of any kind was run. `wrangler.toml` is unmodified (confirmed by `git status`). Neither new env var was added to any environment; both are read via `context.env?.…`, which is `undefined` on every currently-live Worker Version, resolving to `legacy` everywhere until a human explicitly sets one in a future Version's vars.

## XV. Required final return

```
METADATA_VCM_IMPL_04A=PASS

PARENT_VCM_IMPL_03B_IMPLEMENTATION=623cb10
PARENT_VCM_IMPL_03B_EVIDENCE=55e2570
PARENT_VCM_06=cc27824

VCM_IMPL_04A_IMPLEMENTATION_COMMIT=eab1f41
VCM_IMPL_04A_EVIDENCE_COMMIT=<this report's own commit; see repository log for this file's commit>

A2A_PROJECTION_MODE_VALUES=legacy, shadow_compare, vcm_primary_compare, vcm_only
MCP_PROJECTION_MODE_VALUES=legacy, shadow_compare, vcm_primary_compare, vcm_only

A2A_CONFIG_ABSENT_BEHAVIOR=legacy
A2A_CONFIG_INVALID_BEHAVIOR=legacy + logged, never escalates
MCP_CONFIG_ABSENT_BEHAVIOR=legacy
MCP_CONFIG_INVALID_BEHAVIOR=legacy + logged, never escalates

A2A_COMPARE_EXECUTION_POINT=resolveA2aApp's existing per-isolate cache-(re)build block
MCP_COMPARE_EXECUTION_POINT=inline in mcpRoute, only for tools/list responses, 100% sampled

A2A_SHADOW_COMPARE_INTEGRATION=PASS
MCP_SHADOW_COMPARE_INTEGRATION=PASS

A2A_SERVED_PRODUCER=legacy
MCP_SERVED_PRODUCER=legacy

A2A_LEGACY_VS_SHADOW_SERVED_OUTPUT_PARITY=PASS
MCP_LEGACY_VS_SHADOW_SERVED_OUTPUT_PARITY=PASS

A2A_SIGNING_BOUNDARY_UNCHANGED=PASS
VCM_SIGNING_SECRET_ACCESS=0

MCP_HANDLER_BINDING_UNCHANGED=PASS
MCP_HANDLER_SET_PARITY=PASS

A2A_MISMATCH_TESTS=2/2 pass (missing-skill mismatch recorded + never served; throwing projector never propagates)
MCP_MISMATCH_TESTS=2/2 pass (missing-tool mismatch recorded + never served; throwing projector never propagates)

TELEMETRY_EVENTS_OR_COUNTERS=metadata_projection_compare_total, metadata_projection_match_total, metadata_projection_mismatch_total, metadata_projection_fallback_total
TELEMETRY_FAILURE_NON_BLOCKING=PASS

PREMATURE_VCM_PRIMARY_ACTIVATION=IMPOSSIBLE

REGISTRY_STRUCTURAL_PARITY=8/8 PASS
CANONICAL_ECONOMIC_VALIDITY=8/8 PASS
A2A_CURRENT_EXPOSURE_PARITY=8/8 PASS
MCP_CURRENT_EXPOSURE_PARITY=6/6 PASS

VCM_TESTS=148/148 pass
A2A_TESTS=pass (a2a-route.test.ts unmodified + a2a-metadata-shadow-{compare,adversarial}.test.ts new, all pass)
MCP_TESTS=pass (mcp-route.test.ts, mcp-four-service-acceptance.test.ts unmodified + mcp-metadata-shadow-{compare,adversarial}.test.ts new, all pass)
OTHER_REGRESSION_TESTS=1461 pass / 72 skipped across 136 files (apps/edge-api), including x402-service-route.test.ts (37/37) and load-v2.test.ts (7/7, isolated run)
TYPECHECK=PASS
LINT=PASS
FORMAT_SCOPE=PASS
SECRET_SCAN=PASS

REPORT_CONTENT_VERIFIED_BEFORE_COMMIT=YES

CURRENT_PUBLIC_A2A_OUTPUT_CHANGE=NO
CURRENT_PUBLIC_MCP_OUTPUT_CHANGE=NO

CURRENT_PROJECTION_CONSUMERS_CHANGED=0
AUTHORITY_INVERSION=NO

DEPLOYMENT_PERFORMED=NO
TRAFFIC_CHANGE_PERFORMED=NO
PRODUCTION_CONFIG_MUTATIONS=0
ECONOMIC_CONFIG_MUTATIONS=0

SAFE_TO_BUILD_ZERO_PERCENT_METADATA_CANDIDATE=YES

NEXT_CHECKPOINT=METADATA-VCM-IMPL-04B -- Immutable 0%-Traffic Candidate Qualification

REPORT=docs/reports/METADATA-VCM-IMPL-04A-dual-render-compare-only.md
```
