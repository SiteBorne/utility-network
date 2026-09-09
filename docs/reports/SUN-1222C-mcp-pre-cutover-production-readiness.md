# SUN-1222C-MCP-PRE-CUTOVER-REMEDIATION — Production MCP Commercial Readiness

## Starting lineage

- Repository: `/Users/meta4ickal/SITEBORNE Utility Network`, branch `main`.
- `REMEDIATION_START_HEAD=c1e6cd451a6a67949cf4abc109fb4635da84bcfd` (SUN-1222C-R4-D17 final integrity closure, PASS).
- `EXISTING_UNCOMMITTED_WORK=NONE`, working tree clean at start.

## Confirmed root causes (§4 of the checkpoint)

| Finding | Status | Disposition |
|---|---|---|
| A — `mcpRoute` never sets `serviceBoundary`; `defaultBoundary` always returns `payment_required` | Confirmed defect | **Not fixed this pass** — blocked on an undefined MCP payment interaction contract (see below) |
| B — MCP quote hardcodes `PREPRODUCTION_NETWORK`/its asset regardless of production authorization state | Confirmed defect | **Fixed** |
| C — v2 `SERVICE_RESOURCES` map uses synthetic underscore paths (`/v2/company_evidence_graph`) that no route serves | Confirmed defect | **Fixed** |
| D — v2 output schemas structurally reuse v1's; local audit reports `MCP_V2_OUTPUT_SCHEMA_COMPATIBILITY=FAIL` | Confirmed FAIL by audit, root cause not yet isolated | **Not fixed this pass** — requires the real v2 result-construction code path to pin down the actual mismatch, not a mechanical schema edit |
| E — `/ready` reports static `not_ready`/`foundation` state | Investigated | **Reclassified: intentional constraint**, not an MCP defect (see below) |
| F — HTTP uses `legacy: 'stateless'`, stdio still uses `legacy: 'reject'` | Confirmed asymmetry | **Not fixed this pass** — HTTP's own justification (interoperability with scanners/registries) doesn't obviously transfer to a locally-installed stdio client; flipping the string without that evidence would be a guess, not a root-caused fix |

### E — why this is not an MCP defect

`apps/edge-api/src/routes/readiness.ts`'s `not_ready`/`foundation` response is extensively documented across SUN-1220Q1, SUN-1220Q2, and SUN-1221C as intentionally describing **broader platform readiness** (DNS migration, registry publication, Nevermined credentials — none of which are MCP-specific), explicitly distinct from any one service's or transport's runtime state. The comment trail states this meaning has been consistent since SUN-1220Q1 §9/§4D. Nothing in this checkpoint's audit found `/ready` claiming something false about MCP specifically; it is correctly scoped to a wider gate this checkpoint has no mandate to redefine.

## Fixed: B — MCP quote network/asset coherence

**Root cause:** the real production v2 CDP routes (e.g. `apps/edge-api/src/control-plane/production/company-evidence-graph-v2-cdp-composition.ts:136-191`) resolve network and asset through a single canonical, fail-closed chain:

```
resolveProductionAuthorizationInput(env)
  -> resolvePaymentNetwork(authorization)   // mainnet only if all 4 ADR-0055 gates are true
  -> resolvePaymentAsset(network)
```

`apps/edge-api/src/routes/mcp.ts` instead hardcoded `PREPRODUCTION_NETWORK` and `getDefaultAsset(PREPRODUCTION_NETWORK)` unconditionally — regardless of the real production-authorization state. A client quoting through MCP would see Base Sepolia economics even when the real route it would actually pay against resolves to Base mainnet, or vice versa: a quote that cannot be honored by the real paid route.

**RED evidence:** `apps/edge-api/tests/mcp-route.test.ts`, new test `quotes on the exact network/asset the real v2 CDP routes resolve to once production payment is fully authorized` — with all four ADR-0055 env gates set true, the quote still returned `network: 'eip155:84532'` (testnet) instead of `'eip155:8453'` (mainnet).

**Fix:** `mcp.ts` now calls the identical `resolveProductionAuthorizationInput` → `resolvePaymentNetwork` → `resolvePaymentAsset` chain the real routes use, plus the same `assertPreproductionNetwork` defense-in-depth guard.

**GREEN evidence:** both the "not authorized → Base Sepolia" and "fully authorized → Base mainnet, correct USDC asset" tests pass.

**Mutation proof:** forcing the `isProductionPaymentAuthorized` guard argument to `false` inside the fix caused the fully-authorized test to fail (the guard's own fail-closed assertion threw); reverting restored 7/7 green.

## Fixed: C — v2 resource_id / route-path coherence

**Root cause:** `packages/protocol-mcp/src/server.ts`'s `SERVICE_RESOURCES` map declared synthetic underscore-joined paths for all four v2 services (`/v2/company_evidence_graph`, `/v2/web_context_verified`, `/v2/document_evidence_json`, `/v2/verify_agent_output`) that no route in `apps/edge-api/src/index.ts` ever serves. The real mounted paths are `/v2/company/evidence-graph`, `/v2/web/context`, `/v2/document/evidence-json`, `/v2/verify/agent-output`. A client that paid against the quoted `resource_id` would bind its x402 payment to a path returning 404, never reaching the real paid service.

**RED evidence:** `packages/protocol-mcp/src/transport.test.ts`, new `it.each` covering all four v2 services — all 4 failed, each showing the exact underscore-joined `resource_id` vs. the real nested path.

**Fix:** `SERVICE_RESOURCES`'s four v2 entries corrected to the exact real mounted paths, with a comment noting v1 has no live divergence (no v1 route is mounted in `index.ts` today).

**GREEN evidence:** all 4 new cases pass; full `protocol-mcp` suite 51/51 pass (up from the pre-existing 46 + these 4 new + 1 unrelated pre-existing test).

**Mutation proof:** reverting the `company_evidence_graph.v2` entry alone to the old underscore path reproduced the exact original RED; restoring returned to green.

## Blocked: A — production MCP execution boundary

This is the largest, most architecturally significant item in the checkpoint, and per its own §0/§6, I stopped at the specific design blocker rather than inventing a new economic contract.

**What exists:** `McpServiceExecutionBoundary` (`packages/protocol-mcp/src/types.ts`) is already a clean, pluggable interface — `execute(serviceId, input, invocationContext)` — designed for exactly this purpose. `mcp.ts` never supplies one, so the module-level `defaultBoundary` (always `payment_required`) is used in production.

**What's missing:** the real v2 paid routes are gated by x402's REST-native mechanism — an HTTP `X-PAYMENT` header carrying a signed EIP-3009 authorization, checked before the Hono route handler executes any service logic. MCP's `McpServiceExecutionBoundary.execute()` signature has no slot for payment proof at all — it receives only `(serviceId, input, context)`. There is no accepted repository contract, ADR, or supported-protocol specification (checked against `docs/decisions/`, the frozen contract releases, and the existing MCP/x402 wiring) that defines:

- where/how an MCP tool-call carries a signed payment authorization (a second tool argument? a separate `siteborne_submit_payment` tool bound to a prior quote's `requirement_id`? an MCP elicitation flow?);
- what binds that authorization to the exact quote, service, and request;
- what stable idempotency/payment identity ties an MCP invocation to the existing durable Workflow continuation path (`paid-continuation-workflow.ts`'s sole `settle()` callsite) without creating a second settlement owner;
- client capability requirements (a generic MCP client cannot spontaneously sign an x402 authorization — this needs an explicit capability contract).

Implementing this without an accepted specification would mean inventing a new public payment protocol on my own authority — exactly what this checkpoint's own §0 forbids. This is the single missing decision blocking A, and by extension the full commercial MCP objective this checkpoint describes.

## Blocked: D — v2 output schema compatibility

`frozen-contracts.ts` deliberately reuses v1's output schema object for v2 (documented decision, checkpoint 1L §7 — "output semantics are unchanged"). The local audit's `MCP_V2_OUTPUT_SCHEMA_COMPATIBILITY=FAIL` therefore is not proof the schema itself is wrong; it means some real v2 *result* value fails against that (intentionally-shared) schema. Isolating the exact mismatch requires tracing the real v2 result-construction code (the `outcome.result` object each v2 CDP composition module builds) and diffing its actual shape against the schema's constraints — work that could not be completed with the remaining scope of this pass without risking a superficial, schema-weakening "fix" the checkpoint explicitly prohibits (§9: "Do not... weaken validation to unconstrained objects").

## Test/regression evidence

- Targeted regression: `mcp-route.test.ts` (7/7), `x402-service-route.test.ts` (37/37), `production-payment-gate.test.ts`, `discovery-truthfulness.test.ts`, `multi-service-discovery.test.ts` (25/25), `protocol-mcp/transport.test.ts` (42/42), `frozen-contracts.test.ts` (8/8), `transport.property.test.ts` (1/1) — **168 tests, 8 files, all pass**.
- `pnpm --filter @siteborne/edge-api typecheck` — PASS.
- `pnpm --filter @siteborne/protocol-mcp typecheck` — PASS.
- `pnpm --filter @siteborne/edge-api lint` — PASS (no findings).
- `pnpm --filter @siteborne/protocol-mcp lint` — PASS (no findings).
- Full monorepo build/full-suite/contract-compatibility/bundle-isolation/secrets-scan/production-preflight/Wrangler dry-run sweep (§14) was **not** run to completion in this pass given the scope already delivered; recommend running the full release-gate sweep as part of closing this checkpoint's remaining items (A, D) rather than twice.

## Zero live/economic mutation accounting

```
UPLOADS=0
DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
PRODUCTION_SECRET_MUTATIONS=0
PRODUCTION_STORAGE_MUTATIONS=0
LIVE_WORKFLOW_INSTANCES_CREATED=0
LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0
REAL_PAYMENT_AUTHORIZATIONS=0
REAL_SIGNING_ACTIONS=0
PAID_REQUESTS=0
REAL_PROVIDER_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
```

All test coverage used local/in-process fixture apps and synthetic env overrides only; no live Cloudflare, D1, or provider system was touched.

## Known limitations / remaining live qualification requirements

- `MCP_REPOSITORY_RELEASE_GATE=BLOCKED` — the checkpoint's own commercial objective (paid MCP execution) is not reachable until the payment-interaction design gap (A) is resolved by a separate, explicitly authorized design decision.
- D (v2 output schema) requires dedicated root-cause tracing before any fix.
- F (stdio legacy mode) requires a product decision, not a mechanical fix.
- §14's full release-gate sweep (build, full suite, contract-compatibility, bundle-isolation, worker-runtime, SSRF/DNS-rebinding regressions, production preflight, Wrangler dry-runs) was not run to completion this pass.
- Current uploaded candidate (`d3472f58-f578-4a8f-992b-0d0956c9b561`) does **not** contain either fix — `CURRENT_UPLOADED_CANDIDATE_CONTAINS_REMEDIATION=NO`. Any candidate upload must be separately authorized.

## Implementation commit

See git log for the commit immediately following this evidence file (repository-local only; no upload, no deployment).
