# SUN-1222C-MCP-PAYMENT-INTERACTION-DESIGN

Design-only checkpoint. Zero production source changes, zero deployment, zero economic effect.

## 1. Lineage

- `START_HEAD=f3eec3c120b9fc4d19b7dbd6d6d4208d60ad58ff` (SUN-1222C-MCP-PRE-CUTOVER-REMEDIATION: B+C fixed).
- Verified live via `git rev-parse HEAD`, `git status --short`, `git diff --stat`: exact match, clean tree, zero drift since the prior checkpoint.
- Re-ran `apps/edge-api/tests/mcp-route.test.ts` (7 tests) and `packages/protocol-mcp/src/transport.test.ts` (42 tests): 49/49 pass. B (canonical quote network/asset resolution) and C (four v2 `resource_id` paths) both confirmed **PRESERVED**, not regressed.
- The full repository release gate (build, full monorepo suite, secrets-scan, preflight, wrangler dry-runs) was **not** re-run this checkpoint — not required for a documentation-only change, and the prior checkpoint was explicit that it had not run the full gate either.

## 2. Production call graph: /mcp → payment → settlement

Traced directly from source, not from memory:

1. **MCP tool registration** — `packages/protocol-mcp/src/server.ts`'s `createSiteborneMcpServer`/`createSiteborneMcpHonoApp` registers six tools (four service tools + `siteborne_get_quote` + `siteborne_get_service_health`) via the official `@modelcontextprotocol/server` SDK (`McpServer`, `createMcpHandler`).
2. **Invocation context** — `packages/protocol-mcp/src/types.ts`'s `McpInvocationContext` carries only `protocol_version`, `client_name`, `client_version`. **There is no field anywhere in this interface for a payment authorization, signature, or proof of payment.**
3. **Service boundary** — `McpServiceExecutionBoundary.execute(serviceId, input, context)` is the sole extension point a caller (`apps/edge-api/src/routes/mcp.ts`) can supply. Today `mcp.ts` never sets `options.serviceBoundary`, so `defaultBoundary` always applies and unconditionally returns `payment_required` — this was root cause A from the prior checkpoint, still open.
4. **REST payment validation** (the real, accepted mechanism) — `apps/edge-api/src/control-plane/routes/x402-service.ts`'s `createX402ServiceRoute`: reads the `PAYMENT-SIGNATURE` HTTP header via `decodePaymentSignatureHeaderSafe`, validates it against a server-issued, D1-persisted quote (`X402QuoteRepository`), acquires a durable `payment_identifier` (`acquirePaymentAttempt`, `PAYMENT_IDENTIFIER_HEADER`), and only then proceeds.
5. **Durable continuation handoff** — after `PAYMENT_VERIFIED`, the route hands off to the dedicated `PaidContinuationWorkflow` (`env.PAID_CONTINUATION_WORKFLOW`, `WorkflowBindingLike`) and long-polls via `waitForWorkflowResult` (`apps/edge-api/src/control-plane/continuation/waiter.ts`).
6. **Sole settlement owner** — `paid-continuation-workflow.ts`'s single `evidenceProvider.settle()` call site (confirmed unchanged throughout the entire R4 sequence: 1 production settle callsite, dedicated Workflow only, 0 in public API, 0 in any MCP-related file).
7. **Result/receipt persistence** — `X402ServiceResultRepository` (D1), keyed by the same durable `payment_identifier`/job identity established at step 4.
8. **Result retrieval** — currently only via the original REST response (synchronous return, or the same long-poll waiter on retry with the same `Payment-Identifier` header). No MCP-facing retrieval path exists today.

## 3. Classification of applicable payment mechanisms

Direct inspection of the exact vendored, pinned packages — not assumption:

- `@modelcontextprotocol/server@2.0.0` (official MCP TypeScript SDK v2, implementing the 2026-07-28 spec): its own README (`node_modules/.pnpm/@modelcontextprotocol+server@2.0.0/node_modules/@modelcontextprotocol/server/README.md`) contains **zero** mentions of "payment", "x402", or "elicit". **OFFICIAL_STABLE_PROTOCOL** for tools/resources/prompts; **UNSPECIFIED** for any payment mechanism.
- `@x402/extensions@2.21.0`: its README lists exactly six extensions — Bazaar discovery, builder-code (ERC-8021), Sign-In-With-X, offer/receipt, payment-identifier, EIP-2612/ERC-20 gas sponsoring. The Bazaar discovery row explicitly states it catalogs "paid HTTP **or MCP** tools from server-declared input/output hints" — confirming MCP's *official* role in the x402 ecosystem is **discovery/cataloging only**. None of the other five extensions define an MCP tool-call-argument or MCP-transport carrier for a signed payment payload; all are HTTP-header/HTTP-transport oriented. **OFFICIAL_STABLE_PROTOCOL** for "MCP as a paid-resource discovery surface" (Bazaar); **UNSPECIFIED** for "MCP as a paid-execution surface."
- No `x402-mcp` or equivalent adapter package exists anywhere in `node_modules`.
- Conclusion: there is currently no official, stable, or even draft mechanism, in either the MCP SDK or the x402 extensions the project already depends on, for a generic MCP client to autonomously submit a signed x402 payment authorization through an MCP tool call. This is a genuine ecosystem gap, not an artifact of incomplete SITEBORNE implementation.

## 4. Recommended payment interaction

**Primary approach: client-mediated handoff to the existing REST purchase path, plus a new authorized result-retrieval tool.**

- `siteborne_get_quote` (already implemented, already fixed for network/asset coherence this checkpoint's predecessor) continues to return the exact 402 challenge/quote bound to the real REST `resource_id` (also already fixed).
- The MCP boundary's `execute()` for the four service tools, when called **without** proof of payment, continues to return `payment_required` (today's behavior, unchanged) — this is intentionally not "useless": it now returns a *coherent* quote (post-B/C fix) a payment-aware caller can act on.
- The actual signed payment is submitted by the calling agent/wallet as a normal HTTP POST directly against the real REST endpoint (`/v2/company/evidence-graph` etc.), using the existing, already-hardened `x402-service.ts` flow verbatim — MCP never touches signing, never touches funds, never becomes a second settlement owner.
- A **new**, read-only MCP tool (e.g. `siteborne_get_result`) accepts the durable `payment_identifier` obtained from that REST purchase and returns the already-settled, already-persisted result via `X402ServiceResultRepository` — giving MCP-native callers (including tools that only speak MCP, not raw HTTP) a way to retrieve what they already paid for.

**Why this fits supported clients:** any MCP client that also has plain HTTP fetch capability (true of essentially every current agent framework) can complete the purchase itself; MCP stays exactly what the x402 ecosystem's own Bazaar extension says it should be — a discovery/quoting surface, with retrieval added on top.

**What a payment-naive client experiences:** identical to today — `payment_required` with a coherent quote. No regression, no silent failure.

**Which clients need payment-aware middleware:** only clients that want to complete a purchase from within an MCP-only surface (no raw HTTP fetch capability) need such middleware — this recommendation does not require SITEBORNE to build that middleware itself.

**Preserves existing settlement architecture:** zero new economic contract. Zero new settlement owner. Zero new signing surface. The dedicated Workflow's single `settle()` call site is untouched.

**Rejected alternatives:**
- *Accepting a payment authorization as a tool-call argument* (a new `payment_authorization` field on each service tool's input): this would be a genuinely **new, local, unspecified payment protocol** — exactly what this checkpoint's own instructions forbid inventing without human approval. Not recommended without a separate, explicit authorization for that new contract.
- *MCP elicitation for payment*: the 2026-07-28 spec's elicitation feature is for structured user input, not signing infrastructure; using it to shuttle a wallet signature back to the server would still be a novel, unspecified use with no official precedent and its own threat-model burden (a server-initiated elicitation asking a client to produce a signed financial authorization is exactly the kind of interaction the "no server-side buyer custody, no automatic wallet signing" constraint most directly warns against).

If this recommendation is approved, the **one new public contract requiring human approval** is: the shape of `siteborne_get_result`'s input (a `payment_identifier` string) and output (either the persisted result, or a well-defined not-found/not-yet-settled/unauthorized state) — a much smaller, safer surface than a payment-carrier tool.

## 5. V2 output-schema root cause — proven, not guessed

Traced the real production result-construction path directly:

- `apps/edge-api/src/control-plane/production/company-evidence-graph-v2-cdp-composition.ts` builds the real route config with `contractRelease: '2.0.0'` and an `outputSchemaHash` explicitly computed from `contracts/releases/2.0.0/schemas/services/company-evidence-output.schema.json` — confirmed by the module's own comment, not inferred.
- That `2.0.0` release directory genuinely exists in the repository (`contracts/releases/2.0.0/schemas/services/`) and contains all eight input/output schemas (four services × input/output), already accepted, already what the real v2 CDP production routes validate against.
- Diffed `1.0.0` vs `2.0.0` output schemas for all four services directly: in every case the only difference is `service_id` widening from `const: "<service>.v1"` to `enum: ["<service>.v1", "<service>.v2"]`, and `service_version` widening from `const: "v1"` to `enum: ["v1", "v2"]`. Every other field is byte-identical.
- `packages/protocol-mcp/src/frozen-contracts.ts` imports **all eight** output schemas (v1 and v2 alike) from `contracts/releases/1.0.0/schemas/services/*.schema.json` — it never references `2.0.0` at all. A real v2 executor result (with `service_id: "...v2"`, `service_version: "v2"`) validates against `1.0.0`'s v1-only `const` fields and is correctly rejected by MCP's schema — this is the exact, fully explained mechanism behind the audit's finding that all four v2 tools reject real v2 result identities.

**Proposed correction:** point `frozen-contracts.ts`'s v2 output-schema entries at the already-existing, already-accepted `contracts/releases/2.0.0/schemas/services/*.schema.json` files, instead of `1.0.0`. This is not relabeling v2 as v1, not removing `outputSchema`, not discarding receipt fields, not loosening validation to an arbitrary object, and not editing any immutable historical release — `1.0.0` stays untouched; MCP simply starts referencing the release that already governs what real v2 results actually look like. `outputSchemaHash` values recorded in `frozen-contracts.ts` (if any pin to the `1.0.0` hash) need the corresponding update to the `2.0.0` hash. **SCHEMA_GOVERNANCE_ACTION_REQUIRED**: confirm the `2.0.0` release is the intended long-term source of truth for MCP's advertised v2 output schemas (it already is for REST), and confirm no v1-only consumer depends on MCP's current (incorrect) 1.0.0-sourced v2 entries.

## 6. Stdio — evidence, not assumption

- `packages/mcp-server/package.json` describes itself as: *"Local stdio shim for the SITEBORNE Utility Network MCP server."*
- Read `packages/mcp-server/src/stdio.ts` directly (6 lines of actual logic): it calls `createSiteborneMcpServer({ health: { production_ready: false, production_enabled: false } })` **in-process**, with **no `serviceBoundary` argument** — meaning it always falls to `defaultBoundary` (always `payment_required`) and **hardcodes** `production_enabled: false` unconditionally. It does not read any environment variable, does not make any network call, and does not proxy to the real production `/mcp` endpoint in any way.
- Ran the actual bounded local diagnostic (not merely reading the test file): built the real packed binary (`pnpm --filter @siteborne/mcp-server run build`) and ran its existing live-process test (`tests/stdio.test.ts`, spawning `dist/stdio.js` as a real child process over stdio). Result: **1/1 pass** — the real binary negotiates the modern 2026-07-28 handshake and lists the same six tools as HTTP. Zero economic effect (this is a pure discovery/handshake call).
- **STDIO_ACTUAL_BEHAVIOR**: a fully local, offline, discovery/schema-exploration shim. It can never execute a real paid service or reflect live production state today, regardless of any payment-interaction decision, because it never leaves the local process.
- **STDIO_RECOMMENDED_SCOPE**: keep it local-discovery-only for now (matches its own package description and current reality exactly; zero behavior change required). Evolving it into a genuine remote proxy to the real production `/mcp` endpoint is a distinct, separately-scoped implementation decision, independent of the payment-interaction design above.
- **ACTUAL_APPLICATIONS_TESTED**: NOT_TESTED. The MCP TypeScript SDK client/server round-trip and the packed stdio binary process spawn are both real, but no actual third-party application (Claude Desktop, Cursor, etc.) was launched against either transport this checkpoint.
- **F (stdio `legacy: 'reject'` vs HTTP's `legacy: 'stateless'`)**: left unchanged, as in the prior checkpoint. Since stdio never touches production or payment regardless of this setting, this remains a low-stakes compatibility-parity question for a future checkpoint with its own evidence about which older stdio clients (if any) need the older handshake — not a security-relevant defect.

## 7. Readiness semantics

`apps/edge-api/src/routes/readiness.ts`'s `not_ready`/`foundation` state is documented across SUN-1220Q1, SUN-1220Q2, and SUN-1221C as intentionally describing broader-platform readiness (an OR across every entry in `EFFECTIVE_DISCOVERY_RESOLVERS`), not any single service's or transport's state. This remains an intentional constraint, confirmed again this checkpoint — no change proposed or made.

**Proposed separate, evidence-backed states** (for a future checkpoint, not this one):
- `transport_readiness`: whether `/mcp` itself is reachable and negotiates correctly (already true today, proven by the existing `mcp-route.test.ts` suite).
- `discovery_readiness`: whether tool/schema listing is coherent (already true; this checkpoint's predecessor fixed B/C).
- `backend_configuration_readiness`: whether the four production-authorization gates (`PAYMENT_ENVIRONMENT`, `PRODUCTION_ENABLED`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`, `PRODUCTION_CDP_CREDENTIALS_APPROVED`) are satisfied — already tracked by `resolveProductionAuthorizationInput`/`isProductionPaymentAuthorized`, just not yet surfaced as an MCP-specific field.
- `purchasability_readiness`: whether an MCP caller can actually complete a purchase end-to-end (blocked today on the §4 decision above — this is the field that should remain `false` until that decision is approved and implemented).
- `platform_cutover_readiness`: the existing, broader `not_ready`/`foundation` semantics, left untouched.

Readiness is **not** set true anywhere in this checkpoint; no existing blocker gate is erased.

## 8. Frozen economics — unchanged, reconfirmed

```
company_evidence_graph.v2 = 31200 atomic
web_context_verified.v2   = 8000 atomic
document_evidence_json.v2 = 9800 atomic
verify_agent_output.v2    = 17000 atomic
Total = 66000 atomic USDC
```
No prices, governance limits, v1 economics, production activation, Nevermined scope, executors, SSRF policy, or settlement ownership were touched or proposed to change. B and C (from the prior checkpoint) remain preserved, reconfirmed live this checkpoint (49/49 tests pass).

## 9. Threat model of the proposed bridge (§6)

- **Unpaid useful execution**: prevented — `execute()` for the four service tools remains gated behind `defaultBoundary`/`payment_required` until A is implemented against a real REST-verified `payment_identifier`; the new `siteborne_get_result` tool only ever returns an *already-settled* result, keyed by an identifier the caller must already possess.
- **Forged/replayed authorization**: not MCP's concern under this design — all signature/authorization validation stays entirely inside the existing, already-hardened `x402-service.ts` (`decodePaymentSignatureHeaderSafe`, quote-matching, D1-backed `acquirePaymentAttempt`). MCP never parses or validates a signature.
- **Wrong service/request/economics binding**: the existing REST quote (already bound to exact `service_id`, canonical input hash, amount, network, asset, `payTo`, scheme, expiry, and `resource_id`) is untouched; MCP's `siteborne_get_quote` merely surfaces the same values (post B/C fix, now coherent with what REST will actually charge).
- **Confused deputy / open-proxy / SSRF**: `siteborne_get_result`'s only input is a caller-supplied `payment_identifier` — it does not accept a caller-supplied URL, destination, or arbitrary service argument, so it cannot be used to make the server fetch or act on attacker-chosen infrastructure.
- **Cross-caller result access**: the result-retrieval tool must authorize on the same `payment_identifier`/durable payment identity the REST purchase already established — no new authorization boundary is invented; it must reuse whatever authorization check (if any) the existing retry path (`Payment-Identifier` header re-submission) already performs before returning a result.
- **Signature/credential logging**: unaffected — MCP never sees a signature under this design, so there is nothing new to leak.
- **Accidental production fixture execution**: unaffected — `execute()`'s existing `defaultBoundary` remains the fail-closed default; a real `serviceBoundary` is only wired when A is separately implemented and approved.
- **Duplicate settlement**: unaffected — the sole `settle()` call site inside the dedicated Workflow is untouched; MCP never initiates settlement.
- **Transport ambiguity / cancellation after durable handoff**: not introduced by this design — MCP never initiates the durable handoff itself (REST does, exactly as it does today); an MCP client disconnecting mid-purchase has no different effect than an HTTP client disconnecting mid-purchase today, since the purchase itself never happens over the MCP transport.

## 10. Implementation plan (dependency-ordered)

1. **V2 output-schema correction** (independent of the payment-interaction decision; safest to land first)
   - Affected module: `packages/protocol-mcp/src/frozen-contracts.ts`.
   - RED: a synthetic test asserting a real v2-shaped result (`service_id: "company_evidence_graph.v2"`, `service_version: "v2"`, otherwise matching the frozen example) fails the current 1.0.0-sourced output schema.
   - Minimal implementation: repoint the four v2 output-schema imports from `contracts/releases/1.0.0/schemas/services/*.schema.json` to `contracts/releases/2.0.0/schemas/services/*.schema.json`; update any hardcoded `2.0.0` output-schema hash constants to match.
   - GREEN: the same synthetic v2 result now validates; existing v1 tests unchanged (v1 entries still source `1.0.0`).
   - Security mutation: revert the schema-source change, confirm the synthetic RED returns.
   - Commit boundary: this fix alone, no payment-interaction code.

2. **`payment_identifier`-authorized result retrieval** (requires §4 approval)
   - Affected modules: `packages/protocol-mcp/src/types.ts` (extend `McpServiceExecutionBoundary` or add a sibling interface), `packages/protocol-mcp/src/server.ts` (register `siteborne_get_result`), `apps/edge-api/src/routes/mcp.ts` (wire a boundary reading `X402ServiceResultRepository` via `context.env.DB`).
   - Contract/governance decision needed: exact input/output shape of `siteborne_get_result`, and which authorization check gates cross-caller access.
   - RED → minimal implementation → GREEN → security mutations (wrong `payment_identifier`, unsettled `payment_identifier`, another caller's `payment_identifier`) → commit boundary: this tool alone.

3. **Execute-side wiring (A)** — only after 2 is accepted and proven safe; requires its own dedicated checkpoint given its size (an adapter connecting `execute()` to the real REST-equivalent payment-verification path, without becoming a second settlement owner).

4. **Readiness semantics fields (§7)** — separate checkpoint; additive fields only, no existing gate removed.

5. **HTTP/stdio compatibility (F, and any stdio-as-proxy evolution)** — separate checkpoint, its own evidence gathering.

6. **Four-service local runtime acceptance** and **full final release gate** — only after 1–3 land, as the prior checkpoint already scoped.

Each numbered item is independently committable and independently revertible. No item requires a second generic research pass — the decisions each depends on are named explicitly above (§4 for items 2–3; §5's `SCHEMA_GOVERNANCE_ACTION_REQUIRED` for item 1).

## Final decision packet

```
MCP_PAYMENT_DESIGN=READY_FOR_APPROVAL

START_HEAD=f3eec3c120b9fc4d19b7dbd6d6d4208d60ad58ff
DESIGN_EVIDENCE_COMMIT_SHA=<to be filled after commit and literal git verification>

B_CANONICAL_QUOTE_RESOLUTION=PRESERVED
C_V2_RESOURCE_PATHS=PRESERVED

RECOMMENDED_PAYMENT_MECHANISM=client-mediated REST handoff + new payment_identifier-authorized MCP result-retrieval tool
PROTOCOL_STATUS=UNSPECIFIED (no official MCP-native payment carrier exists in the pinned MCP SDK or @x402/extensions; Bazaar covers discovery only)
SUPPORTED_CLIENT_REQUIREMENTS=any client capable of a plain HTTP POST against the existing REST paid route, plus MCP for discovery/quote/result-retrieval
PAYMENT_AUTHORIZATION_CARRIER=unchanged HTTP PAYMENT-SIGNATURE header on the existing REST route (x402-service.ts) — never carried over MCP
REQUEST_AND_ECONOMIC_BINDING=existing D1-persisted quote (X402QuoteRepository), unchanged
DURABLE_HANDOFF_INTERFACE=existing PaidContinuationWorkflow / WorkflowBindingLike, unchanged
RESULT_RETRIEVAL_AUTHORIZATION=new: payment_identifier-scoped read via X402ServiceResultRepository (design only, not implemented)
SINGLE_SETTLEMENT_OWNER_PRESERVED=YES

V2_OUTPUT_ROOT_CAUSE=frozen-contracts.ts sources all output schemas from contracts/releases/1.0.0/, but the real production v2 CDP routes already validate against the already-accepted contracts/releases/2.0.0/ release, which widens service_id/service_version from const to enum to admit v2 identities
PROPOSED_OUTPUT_REPRESENTATION=repoint frozen-contracts.ts's four v2 output-schema entries at the existing 2.0.0 release (no new schema authored, no historical release edited)
SCHEMA_GOVERNANCE_ACTION_REQUIRED=confirm 2.0.0 is the intended long-term source of truth for MCP's v2 output schemas (already true for REST) and that no consumer depends on MCP's current incorrect 1.0.0-sourced v2 entries

STDIO_ACTUAL_BEHAVIOR=fully local, offline, discovery-only shim; never proxies to production; confirmed via live packed-binary process test (1/1 pass)
STDIO_RECOMMENDED_SCOPE=keep local-discovery-only; evolving to a remote proxy is a separate future decision
ACTUAL_APPLICATIONS_TESTED=NOT_TESTED (SDK client/server and packed-binary process spawn tested; no third-party application launched)

READINESS_SEMANTICS_PROPOSAL=five separate fields (transport/discovery/backend_configuration/purchasability/platform_cutover), additive only, not implemented this checkpoint

NEW_PUBLIC_CONTRACT_DECISIONS=shape of siteborne_get_result (input: payment_identifier; output: settled result or a well-defined not-found/pending/unauthorized state)
EXACT_HUMAN_APPROVAL_REQUIRED=(1) approve the client-mediated-handoff-plus-retrieval-tool approach over inventing an MCP-native payment carrier; (2) approve siteborne_get_result's exact input/output contract; (3) confirm 2.0.0 as MCP's v2 output-schema source of truth
IMPLEMENTATION_TASK_COUNT=6
IMPLEMENTATION_PLAN=see §10 above

PRODUCTION_SOURCE_CHANGES=0
UPLOADS=0
DEPLOYMENTS=0
PRODUCTION_MUTATIONS=0
LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0
REAL_SIGNING=0
PAID_REQUESTS=0
REAL_PROVIDER_CALLS=0
REAL_SETTLEMENTS=0

MCP_REPOSITORY_RELEASE_GATE=STILL_BLOCKED
LIVE_PAID_ACCEPTANCE=NOT_EXECUTED
CUTOVER_AUTHORIZED=NO
```
