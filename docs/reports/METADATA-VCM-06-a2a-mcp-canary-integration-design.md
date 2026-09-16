# METADATA-VCM-06 — A2A + MCP Canary Integration and Authority-Inversion Safety Design

Design + evidence only. No runtime, registry, governance, contract, or production mutation. No code changes; this report is the only authorized file.

Governing baseline: `docs/reports/METADATA-VCM-MASTER-canonical-reference.md` (`sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096`).

Parent checkpoints:

```
PARENT_VCM_IMPL_03B=623cb10
PARENT_VCM_IMPL_03B_EVIDENCE=55e2570
```

## I. Mission

Design the safest migration path from today's two hand-authored metadata producers (A2A Agent Card, MCP tool list) to VCM-generated projections, without changing what either surface serves until each transition is explicitly qualified and authorized. This document answers the seven questions in the directive (equivalence proof in the deployed runtime, avoiding two authorities, the 0%-traffic boundary, rollback, required evidence per transition, what counts as a blocking mismatch, and when the old producer may be deleted) and is structured so that serving an unqualified VCM projection, letting the two producers drift, treating offline parity as production activation, conflating signing/runtime state with static metadata, or creating two long-lived authorities are all structurally difficult, not merely discouraged by convention.

## III. Live call graphs

### A2A_LIVE_CALL_GRAPH

1. **Route** — `apps/edge-api/src/index.ts:110-113`: one handler, `a2aRoute`, serves `POST /a2a`, `GET /.well-known/agent-card.json`, and `GET /.well-known/jwks.json`.
2. **Handler** — `apps/edge-api/src/routes/a2a.ts:127-129` calls `resolveA2aApp(context.env)`, then `.fetch(context.req.raw)` on the returned Hono sub-app.
3. **Card construction** — inside `createSiteborneA2aHonoApp` (`packages/protocol-a2a/src/transport.ts:126-131`), `buildUnsignedSiteborneAgentCard()` is called with `effectiveProductionStatusByServiceId` and `mtlsProductionActive`. Both are computed in `routes/a2a.ts:81-85`: `resolveEffectiveProductionStatusByServiceId(env, hasDb)` (`production-payment.ts:445-458`, iterating per-service resolvers gated on D1 presence, `PAID_ROUTES_ENABLED` + per-service `_V2_CDP_ROUTE_ENABLED` flags, `isProductionPaymentAuthorized`, presence of `PAID_RECEIPT_SIGNING_PRIVATE_KEY`/`_KEY_ID`, and `checkProductionBindingsPresent`) and `resolveMtlsProductionActive(env)` (`mtls-production-capability.ts:37-39`, exact-string `env.MTLS_PRODUCTION_ACTIVE === 'true'`). Every input is a Worker env var/binding; D1 is consulted only for presence, never content, at card-build time.
4. **Signing** — invoked at `transport.ts:125-132`. The identity comes from `resolveAgentCardSigningIdentity(env)` (`agent-card-signing.ts:45-78`), reading `AGENT_CARD_SIGNING_PRIVATE_KEY` (a serialized private JWK) and `AGENT_CARD_SIGNING_KEY_ID`. If both are absent, `transport.ts:125` falls back to `createLocalA2aSigningIdentity()` (`signing.ts:52-82`) — an ephemeral, non-exportable ES256 keypair generated in memory per isolate. If only one of the two env vars is set, `AgentCardSigningConfigError` is thrown (fail-closed, no fallback). If both are set but malformed, `InvalidAgentCardSigningKeyError`/`AgentCardSigningConfigError` is thrown. Nothing in `a2aRoute` catches this, so a real misconfiguration surfaces as a 500, never a silent wrong card.
5. **JWS/JWKS** — `generateAgentCardSignature` (`signing.ts:73-78,209-214`) signs with `jku` fixed to `SITEBORNE_A2A_JWKS_URL` (`constants.ts:9`). The same route serves that JWKS (`transport.ts:155-160`) from `identity.jwks` — the public half of whichever identity (ephemeral or configured) was resolved.
6. **Caching** — `routes/a2a.ts:20-21,92-115` keeps a module-level `cachedA2aAppPromise` keyed by a cache key built from the signing key/keyId plus the two overlay booleans. The card is built and signed once per unique (signing config, overlay) combination — effectively once per running isolate — and reused across requests. A fresh `DefaultRequestHandler`/`InMemoryTaskStore`/executor is created per `POST /a2a` request (`transport.ts:184-188`), but the signed card itself is not rebuilt per request.
7. **Response headers** — Agent Card: `content-type: application/a2a+json`, `A2A-Version`, `cache-control: no-store` (`transport.ts:147-153`). JWKS: `content-type: application/jwk-set+json`, `cache-control: no-store` (`transport.ts:155-160`).

State classification: signing identity + built/signed card + JWKS are **isolate-scoped** (cached); per-request state is only the task store/executor; the two overlay inputs are **environment-scoped** (Worker vars/bindings), never KV/D1-content-backed.

### MCP_LIVE_CALL_GRAPH

1. **Route** — `apps/edge-api/src/index.ts:110`: `app.all('/mcp', mcpRoute)`.
2. **Instantiation** — `mcpRoute` calls `createSiteborneMcpHonoApp()` **fresh on every HTTP request** (`routes/mcp.ts:159`; no module-level cache, unlike A2A). That wraps `createMcpHandler(() => createSiteborneMcpServer(options), { legacy: 'stateless' })` (`server.ts:688-690`); the SDK invokes the factory to build a fresh `McpServer` per request, and `createSiteborneMcpServer` mints a new `serverInstanceId` each call (`server.ts:538-543`).
3. **Tool registration** — all six `server.registerTool(name, definition, handler)` calls bind the definition and its handler at the same call site: the four service tools in a loop (`server.ts:547-606`), plus `siteborne_get_quote` (`server.ts:608-628`) and `siteborne_get_service_health` (`server.ts:630-666`). There is no separate name-to-handler lookup table anywhere.
4. **`tools/list`** — served purely by the SDK's own enumeration of whatever was registered on that request's `McpServer`; no SITEBORNE code overrides it.
5. **Protocol version** — `MCP_PROTOCOL_VERSION = '2026-07-28'` (`constants.ts:3`) is reported in tool metadata/health output only; actual `initialize` negotiation across the legacy (2025-11-25) and modern eras is handled entirely inside `@modelcontextprotocol/server` via `legacy: 'stateless'` (`server.ts:688-690`, changed deliberately from `legacy: 'reject'` per the SUN-1222A comment at `server.ts:672-687`).
6. **Session state** — none. `legacy: 'stateless'` plus a fresh Hono app per HTTP request means there is no cross-request session store anywhere in this path.
7. **Utility tools** — `siteborne_get_quote` (`server.ts:608-628`, `buildCanonicalQuote` at `469-536`) calls into `@siteborne/protocol-x402` (`buildQuote`, `buildExactPaymentRequirement`/`buildUptoPaymentRequirement`, `resolveServiceMaxPriceUsd`, `usdToAtomicUnits`); network/asset/payee come from `options.quote`, populated in `routes/mcp.ts:137-157` via `resolveProductionAuthorizationInput(env)`, gated on `env.SELLER_WALLET_ADDRESS`. `siteborne_get_service_health` (`server.ts:630-666`) reports `options.health`, computed per-request in `routes/mcp.ts:104-117` via `resolveEffectiveServiceRuntimeStatus` (same D1-presence + env-flag gates as A2A). Neither the live pricing resolver nor the health resolver is modeled by VCM today, and this design does not propose modeling them — they stay entirely on the runtime-overlay side of the static/runtime boundary. Actual paid execution for the four service tools reuses the exact same REST v2 CDP production route functions via `createMcpX402ServiceBoundary` (`apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts:83-178`) — no separate settlement logic exists for MCP.
8. **Caching** — none at any layer. Full app, server, tool registration, and tool descriptions (which read `options.health`) are rebuilt every single request.

State classification: everything is **request-scoped** except the underlying env/D1-presence bindings (environment-scoped) and the downstream REST routes' own persistence, which this adapter never touches directly.

## IV. Projection generation vs. execution behavior

```
A2A:  VCM semantic projection  !=  signing (signing.ts/agent-card-signing.ts)  !=  transport/task execution (transport.ts)
MCP:  VCM tool-definition projection  !=  tool handler closures (registerTool call sites)  !=  service execution (x402-mcp-adapter.ts -> REST v2 CDP routes)  !=  quote/health computation
```

In every state this design allows, VCM supplies only the **definition content** — title, description, input/output schema references, tags, annotations, x402 extension params for A2A, `_meta` for MCP. It never supplies a private key, never calls `registerTool()` itself, and never becomes a second implementation of quote/health/settlement logic. Concretely, for MCP the target integration point is: the existing `registerTool(name, definition, handler)` call sites keep their `handler` argument completely untouched; only the `definition` argument's fields are, in `vcm_primary_compare`/`vcm_only` mode, sourced from `projectMcpToolsFromVcm(...)` instead of the local `describeInputSchema()`/`SERVICE_TOOL_TITLES` helpers. For A2A, the target integration point is inside `buildUnsignedSiteborneAgentCard()`'s replacement: it becomes a thin caller of `projectA2aFromVcm(effectiveView, context)`, and the *result* of that call is what gets passed into the unchanged `identity.sign()` call in `transport.ts`. Nothing about the signing call, the task executor, the x402 settlement boundary, or the quote/health resolvers changes in any state defined here.

## V. Migration state machine

Two independent, per-surface closed enums — not a shared boolean, and not one enum shared across A2A and MCP, because the two surfaces have unrelated blast radii (A2A involves a trust-bearing signature and an isolate-scoped cache; MCP involves neither, and rebuilds everything per request) and must be independently rollback-able.

```
type MetadataProjectionMode =
  | 'legacy'               // only the existing hand-authored producer runs; nothing else changes
  | 'shadow_compare'       // legacy serves; VCM also builds a projection and it is compared; mismatch is evidence-only, never blocks or alters the response
  | 'vcm_primary_compare'  // VCM serves; legacy also builds a projection and it is compared, for continued drift detection
  | 'vcm_only'             // VCM is the sole producer in the serving path; legacy code path is not invoked
```

Per state:

| State | Producer served | Second producer runs | Compared | Mismatch blocks response | Mismatch is evidence-only | Traffic eligibility | Qualification required | Rollback target |
|---|---|---|---|---|---|---|---|---|
| `legacy` | legacy | no | no | n/a | n/a | any | none (default) | n/a |
| `shadow_compare` | legacy | yes (VCM) | yes | no | yes | 0% only (candidate) | none to *enter*; PASS required to *leave* | `legacy` |
| `vcm_primary_compare` | VCM | yes (legacy) | yes | yes, per §XVI | also yes, in addition to the fallback | canary → 100% | full qualification + canary PASS | `shadow_compare` or `legacy` |
| `vcm_only` | VCM | no | no | n/a | n/a | 100% | soak period in `vcm_primary_compare` with zero unexplained mismatches | `vcm_primary_compare` |

Illegal direct transitions are enforced simply by there being no code path that reads the mode enum and skips straight from `legacy` behavior to `vcm_only` behavior — the enum is read once per build/request and dispatches to exactly one of the four branches above; reaching `vcm_only` requires a human to have set that literal string in a Worker Version's vars, and the qualification gates in §XIV/§XIX are what *should* gate that decision, not the code itself. This is a process control, not a type-system one — see §VII for why that is the correct place to draw this particular line.

## VI. Configuration shape

```
A2A_METADATA_PROJECTION_MODE: 'legacy' | 'shadow_compare' | 'vcm_primary_compare' | 'vcm_only'
MCP_METADATA_PROJECTION_MODE: 'legacy' | 'shadow_compare' | 'vcm_primary_compare' | 'vcm_only'
```

Two independent closed-enum vars, not `USE_VCM=true`, and not one shared var — precisely because A2A and MCP must be promotable, canaried, and rolled back independently (§XIII decision below). Parsed through one strict allow-list function (`parseMetadataProjectionMode(raw: string | undefined): MetadataProjectionMode`) shared by both call sites, so there is exactly one place that can ever produce a value outside the four literals.

## VII. Fail-closed default

```
MIGRATION_CONFIG_ABSENT_BEHAVIOR = parseMetadataProjectionMode returns 'legacy' when the env var is undefined.
MIGRATION_CONFIG_INVALID_BEHAVIOR = any string not exactly one of the four literals (including "true", "false", "", "VCM_ONLY" wrong-case, a typo) also returns 'legacy', and additionally emits one structured console.error line naming the surface and the invalid raw value, so a real typo is visible in platform logs without ever being able to escalate serving behavior.
```

This mirrors the existing `MTLS_PRODUCTION_ACTIVE === 'true'` exact-match pattern already in the codebase (`mtls-production-capability.ts:37-39`) rather than introducing a new parsing convention. A malformed value can only ever *fail toward* `legacy`, never toward any VCM-serving state.

## VIII–IX. Dual-render comparison design and execution point

Request-time dual rendering on every request is not assumed to be optimal, and the two call graphs justify different answers:

**A2A** — the legacy producer already only rebuilds once per isolate (§III, `cachedA2aAppPromise`). The correct execution point is therefore **at that same rebuild**, not per request: when the cache is (re)built, also build the VCM projection using the identical `effectiveProductionStatusByServiceId`/`mtlsProductionActive` values already computed for the legacy path (so both producers see byte-identical overlay inputs), run `compareProjections`, and attach the comparison result to the cache entry. Overhead is paid once per isolate lifetime, not once per response — effectively zero in steady state.

`A2A_COMPARE_EXECUTION_POINT = at the existing per-isolate cache (re)build point in routes/a2a.ts (the same call that currently produces cachedA2aAppPromise), never per request.`

**MCP** — there is no cache to hook; the legacy producer already rebuilds everything every request. Running the VCM projection and comparator inline is therefore the only available hook point, but comparing on literally every production request once real traffic exists would double a small amount of work at every request under load with no corresponding benefit once the pair has already been proven stable. The design is: compare on every call while `shadow_compare` (0% traffic, so 100% sampling is free) and while qualification is running; once in `vcm_primary_compare` with real traffic, apply a bounded deterministic sample (for example, 1-in-N based on a hash of the request id) purely to keep collecting drift evidence at low marginal cost. The exact sample rate for that later phase is not fixed here.

`MCP_COMPARE_EXECUTION_POINT = inline in mcpRoute immediately after the real tool list is available, 100% sampled in shadow_compare, sampled at a rate marked REQUIRES_MEASUREMENT once real traffic exists in vcm_primary_compare.`

## X. Comparison domains

Three domains are kept structurally separate, never merged into one pass/fail bit:

```
STATIC_SEMANTIC_CONTENT   -- title/description/schema-refs/tags/annotations/capabilities. Gate: exact digest equality (03B already proved this).
EFFECTIVE_RUNTIME_CONTENT -- fields that depend on the same runtime overlay input (e.g. whether the mTLS securityScheme is present, the production-status sentence in a tool description). Gate: semantic equality after both producers are given the identical overlay input -- not digest equality, since prose may legitimately differ in wording while asserting the same fact, which is exactly why the comparator's governed-difference classification exists.
SIGNED_ENVELOPE (A2A only) -- verification-equivalent, never byte-equivalent, because ES256 signatures are nondeterministic even over identical input. The gate is "identity.verify() succeeds against the published JWKS," not "signature bytes match."
```

MCP additionally keeps `TOOL_HANDLER_BINDING_PARITY` separate from `STATIC_SEMANTIC_CONTENT` (§XII) — a projection can be content-correct while still being wrongly wired to a handler if a future change ever lets VCM influence registration itself; today it cannot (§IV), so this domain's qualification check is currently a structural guarantee rather than a runtime test, and stays listed as its own domain so that guarantee is never silently assumed away later.

## XI. A2A signing safety

Target call flow:

```
VCM semantic projection (projectA2aFromVcm)
      |
existing signing boundary (transport.ts's identity.sign(), unchanged)
      |
signed Agent Card (unchanged shape)
```

VCM never reads `AGENT_CARD_SIGNING_PRIVATE_KEY`, never reads `AGENT_CARD_SIGNING_KEY_ID`, and never constructs a signing identity of its own — `packages/vcm` has no dependency capable of it today, and this design adds none. Qualification for promoting past `shadow_compare` must prove, using the real (not ephemeral) signer:

1. Same semantic card — `STATIC_SEMANTIC_CONTENT` digest match against the 03B baseline.
2. Same declared key id — trivially preserved, because the key id is attached by the signing boundary *after* projection and VCM never touches it.
3. Valid signature — call the real `identity.sign()` on VCM's projected content in the candidate environment and confirm `identity.verify()` succeeds.
4. Published JWKS verifies it — fetch the candidate's real `/.well-known/jwks.json` and verify the signature against it with a standard JWS verifier, independent of the signing code path itself.
5. No fallback/ephemeral identity leak — qualification must assert `AGENT_CARD_SIGNING_PRIVATE_KEY` and `AGENT_CARD_SIGNING_KEY_ID` are both actually present and well-formed in the candidate's environment before promotion is considered; a candidate running on the ephemeral fallback key may qualify content-wise but must never be promoted past `shadow_compare` on that evidence alone.

No live secret is read as part of this design checkpoint — items 3-5 are specified as future qualification-time actions in a real candidate environment, not performed here.

## XII. MCP handler binding safety

The invariant "definition-name set == registered-handler-name set" holds today only because both come from the same six `registerTool()` call sites (§III.3). This design preserves that by construction rather than by a runtime check: in every state defined here, VCM supplies *only* the `definition` argument's content to an existing, unmoved `registerTool(name, definition, handler)` call; the `handler` argument is never touched, generated, or looked up separately. There is therefore no code path in which "definition says tool A, handler executes tool B" or "VCM adds a definition without a handler" can occur, because VCM never adds a registration — it only supplies data into one that already exists. The mechanical proof required at qualification time is narrower and simpler than a generated-registration world would need: confirm that VCM's projected tool-name set (six names) is exactly equal to the real, live `tools/list` name set, which 03B's comparator already does. `siteborne_get_quote` and `siteborne_get_service_health` remain first-class in every state, since `projectMcpToolsFromVcm` already treats them as first-class utility tools distinct from service tools (03B, `mcp-shadow.ts`).

## XIII. The 0%-traffic candidate

**Separate candidates for A2A and MCP**, not one combined candidate — the two call graphs have unrelated caching models, unrelated blast radii (a bad A2A candidate risks a bad signature or a 500 on every card fetch; a bad MCP candidate risks a bad tool description or schema on every `tools/list`), and unrelated rollback needs. Combining them would force a rollback of the healthy surface whenever the other regresses.

A candidate is: one immutable Worker Version (`wrangler versions upload`) built from a specific, recorded source commit, with exactly one new var set (`A2A_METADATA_PROJECTION_MODE=shadow_compare` or `MCP_METADATA_PROJECTION_MODE=shadow_compare`) and nothing else different — `PAID_ROUTES_ENABLED`, `SELLER_WALLET_ADDRESS`, `AGENT_CARD_SIGNING_PRIVATE_KEY`/`_KEY_ID`, and every other economic or security var are carried forward unchanged from the currently-live Version. The candidate receives 0% of production traffic via `wrangler versions deploy`'s gradual-deployment traffic split (the existing mechanism this repo already uses; see §XVII/§XVIII), so `shadow_compare` mode running inside it never affects a real response — the legacy producer is what any of the 0% traffic that does reach it would see, matching `shadow_compare`'s own definition.

## XIV. Candidate qualification gates

**A2A** (9 gates):

```
1. /health unchanged
2. /ready unchanged
3. Agent Card schema valid
4. skill count = 8
5. STATIC_SEMANTIC_CONTENT digest matches the approved 03B baseline
6. signing succeeds under the candidate's real (non-ephemeral) signer
7. signature verifies against the candidate's published JWKS
8. no unsupported/stronger security claim than the effective view supports
9. no release-time vs. current-state temporal leakage (i.e. VCM's projection never substitutes a frozen releaseProtocolExposureDeclared value where the real card requires current static exposure, or vice versa)
```

**MCP** (10 gates):

```
1. initialize handshake unchanged
2. protocol version unchanged
3. tools/list count = 6
4. STATIC_SEMANTIC_CONTENT digest matches the approved 03B baseline
5. input schemas match (canonicalized structural comparison, not byte equality)
6. annotations match
7. tool -> handler binding set matches (the six registered names == the six projected names)
8. siteborne_get_quote fixture behavior unchanged
9. siteborne_get_service_health fixture behavior unchanged
10. malformed/unknown tool-name behavior unchanged
```

None of these are executed by this checkpoint; they are the specification for METADATA-VCM-IMPL-04A and the candidate qualification step after it.

## XV. Candidate baseline digest binding

A `QualificationRecord` must bind, as separate named fields (never conflated with each other):

```
vcmModelDigest            -- CanonicalStaticModel digest (digests.ts#computeModelDigest)
vcmEffectiveViewDigest    -- EffectiveMetadataView digest
a2aProjectionDigest       -- STATIC_SEMANTIC_CONTENT digest of the A2A shadow output
mcpProjectionDigest       -- STATIC_SEMANTIC_CONTENT digest of the MCP shadow output
runtimeSourceCommit       -- git SHA the running code was built from
vcmImplementationCommit   -- git SHA of the VCM package version in use (e.g. 623cb10)
contractReleaseVersion    -- e.g. 2.0.0
cloudflareWorkerVersionId -- the Cloudflare-assigned Version UUID the candidate was deployed as
```

A git commit SHA and a Cloudflare Worker Version id are never interchangeable and must both be recorded; §XXVII restates this for release evidence generally.

## XVI. Mismatch behavior

Before VCM ever serves traffic (`shadow_compare`): a mismatch never touches the response (legacy is already what's served) and simply fails the candidate's qualification — it cannot be promoted to `vcm_primary_compare` until the mismatch is resolved and qualification is re-run clean.

During `vcm_primary_compare` (VCM already serving, legacy kept running only for comparison): on a `STATIC_SEMANTIC_CONTENT` mismatch, **fail closed to legacy for that response, automatically, and alert** — not "serve VCM but alert." The reasoning is specific to what this surface is for: these endpoints exist so autonomous machine callers can trust what they read (identity, capability, pricing, security posture); serving a metadata document that is wrong about any of those is a worse outcome than a visibly-down endpoint, because it can silently misroute or miscontract an agent while every application health check stays green. A mismatch confined to `EFFECTIVE_RUNTIME_CONTENT` wording (governed-difference territory) does not trigger fallback, since the comparator already classifies that as expected, non-blocking variation rather than a real disagreement.

## XVII. Canary strategy

Canary is layered on Cloudflare Workers' existing gradual-deployment traffic split between two Versions of the same deployment (`wrangler versions deploy`), not a percentage invented in application code. Because static metadata is highly deterministic given the same overlay inputs, the strongest and cheapest qualification signal is **synthetic, digest-verified monitoring at 0% real traffic over a soak period** — repeatedly polling the candidate's own endpoints and confirming the digest still matches the approved baseline — performed *before* any real traffic is risked at all. A small, short real-traffic canary (on the order of 1-5%) is still worth running afterward, but its purpose is narrower: confirming the traffic-split mechanism itself routes correctly and that nothing about being under real load (rather than synthetic polling) changes behavior — not because the metadata content is expected to vary by which request served it.

## XVIII. Rollback

```
ROLLBACK_TARGET = the previously-deployed Worker Version (already running in legacy or shadow_compare mode)
ROLLBACK_REQUIRES_CODE_CHANGE = NO
ROLLBACK_REQUIRES_REGISTRY_CHANGE = NO
```

Achieved by `wrangler versions deploy` reverting the traffic split to 100% on the prior Version id. One nuance specific to Cloudflare Workers: environment variables are baked into a Version at creation time and cannot be hot-edited in a live Version, so flipping `A2A_METADATA_PROJECTION_MODE` back to `legacy` is *not* a faster path than the traffic-split revert — it would itself require uploading a new Version. The traffic-split revert to an already-`legacy`-mode prior Version is therefore the actual fastest rollback lever, and the one this design recommends exercising as proof before final promotion (§XIX).

## XIX. Authority inversion gate

```
AUTHORITY_INVERSION_GATE = ALL of:
  1. 03B offline parity PASS (already true)
  2. runtime/candidate dual-render parity PASS (new, per this design)
  3. full candidate qualification PASS (§XIV, both surfaces independently)
  4. canary soak PASS with zero unexplained mismatches
  5. rollback actually exercised and proven on this specific candidate, not merely designed
  6. QualificationRecord (§XV) committed as evidence
  7. governance approval recorded, following the same human-sign-off pattern already established in governance/PROMOTION_STATES.yaml / HARD_GATES.yaml for other production-affecting changes
```

None of these six are satisfied by this checkpoint; this checkpoint only defines them.

## XX. Legacy producer retirement

```
LEGACY_PRODUCER_RETIREMENT_GATE =
  vcm_only has run in production for an explicit observation period with zero fallback triggers
  AND at least one full release cycle has completed with VCM as sole producer
  AND explicit governance approval for retirement specifically (distinct from the approval in §XIX)
```

Nothing is deleted at that point either: the legacy builder (`buildUnsignedSiteborneAgentCard`'s current internals, `server.ts`'s `describeInputSchema`/`SERVICE_TOOL_TITLES`) is demoted to a verification fixture retained in the test suite — exactly the role it already plays in 03B's real-data parity tests — so future releases can keep proving parity against a known-good reference. Deleting the legacy *runtime* code path (not the test fixture) is a separate, later, explicitly authorized checkpoint of its own.

## XXI. Avoiding circular authority

```
canonical fact authorities (registry/services/*.json, governance/RISK_LIMITS.yaml, typed code exports)
        |
       VCM (packages/vcm)
        |
  protocol adapters (a2a-shadow.ts, mcp-shadow.ts)
        |
   public projections (Agent Card, MCP tools/list)
```

This stays a one-directional DAG only as long as VCM's output is fed into *existing* registration call sites as a content substitution (§IV, §XII) and never used to programmatically generate new `registerTool()` calls or new entries in `SITEBORNE_SERVICE_IDS`/`MCP_SERVICE_TOOLS`. The moment VCM output starts generating registration code, `current-exposure.ts`'s derivation of VCM's own static exposure *from* those same registration constants (IMPL-03A) would become circular. No state defined in this document crosses that line; §XXII addresses whether a future checkpoint should.

## XXII. Long-term registration ownership

**Recommendation: registration remains code-owned; CI enforces bidirectional parity** (i.e., keep today's direction) — not "generate registration from VCM."

```
                    circularity risk   runtime coupling   type safety   handler-binding safety   drift prevention   rollback simplicity
code-owned + CI parity     none              none            full         trivial (§XII)         already achieved      simplest
VCM-generates registration  real (§XXI)      new               weaker unless heavily tooled   reintroduces the exact risk this checkpoint designs against   no better than CI parity   more moving parts
```

Generating registration would reopen exactly the handler-binding risk class §XII closes by construction, would create the circularity §XXI warns against, and buys nothing that CI-enforced comparator parity (already proven working in 03B) doesn't already deliver. This is a recommendation for a future checkpoint to accept or revisit, not something this design implements.

```
LONG_TERM_A2A_REGISTRATION_OWNER = code (SITEBORNE_SERVICE_IDS + card.ts's skill loop stay authoritative for A2A attachment; VCM owns only projected content)
LONG_TERM_MCP_REGISTRATION_OWNER = code (protocol-mcp's registerTool() call sites stay authoritative for tool existence; VCM owns only projected definition content)
```

## XXIII. Telemetry

The repository's only existing observability primitive on this path is structured `console.error`/`console.log` JSON lines flowing to Cloudflare platform logs/Logpush (`apps/edge-api/src/index.ts:313`) — there is no Analytics Engine dataset binding today. This design reuses that mechanism rather than proposing a new binding:

```
metadata_projection_compare_total{surface}              -- purpose: count of comparisons run. cardinality: 2 (a2a|mcp). retention: standard log retention. carried by: existing structured console logging.
metadata_projection_match_total{surface}                 -- same shape.
metadata_projection_mismatch_total{surface,domain}        -- domain in {static_semantic, effective_runtime, signed_envelope}. cardinality: 2x3=6.
metadata_projection_fallback_total{surface}               -- count of vcm_primary_compare responses that fell back to legacy per §XVI.
```

No secrets, no signature bytes, no full request/response bodies, and no payment credentials are logged in any of these — only digests, booleans, and counts, matching the existing repo-wide logging discipline observed in the call-graph trace (§III).

## XXIV. Performance budget

**A2A**: comparison runs once per isolate cache rebuild (§IX), so steady-state per-request overhead is ≈0; the one-time cost of building and comparing the VCM projection at cache-build time is `REQUIRES_MEASUREMENT` but bounded by the size of an 8-skill JSON document plus one comparator pass over it.

**MCP**: comparison runs inline per request (at least during `shadow_compare`), so overhead is `REQUIRES_MEASUREMENT` — no existing latency budget for `/mcp` was surfaced by the call-graph trace to measure against. Structurally the added work is small (assembling a 6-entry array and running the comparator over already-small JSON documents), and this design recommends measuring it directly inside the 0%-traffic candidate itself before ever setting a sample rate for a real-traffic phase, rather than presenting an invented threshold as a proven requirement.

## XXV. Security review

VCM adds no new secret-reading authority: it never touches `AGENT_CARD_SIGNING_PRIVATE_KEY`, `AGENT_CARD_SIGNING_KEY_ID`, `MTLS_PRODUCTION_ACTIVE`, `SELLER_WALLET_ADDRESS`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, or D1 — every one of those stays exactly where it is today, read only by `routes/a2a.ts`, `routes/mcp.ts`, `signing.ts`, `agent-card-signing.ts`, `mtls-production-capability.ts`, and `production-payment.ts`. Trust boundaries are unchanged: VCM is a pure function of registry files and typed code exports, the same trust level `card.ts`/`server.ts` already operate at. It introduces no new untrusted-input surface (it never sees a live request), no new metadata-injection vector (its inputs are versioned repository content, not live user input), and it adds a net-positive capability — a verifiable projection digest — rather than removing any existing protection.

```
VCM_REQUIRES_SIGNING_SECRET_ACCESS = NO
```

## XXVI. Deployment configuration safety

```
Variable:        A2A_METADATA_PROJECTION_MODE / MCP_METADATA_PROJECTION_MODE
Type:            string, closed enum
Allowed values:  legacy | shadow_compare | vcm_primary_compare | vcm_only
Default:         legacy
Invalid value:   treated as legacy, logged once (§VII)
Ordinary wrangler upload: yes, included -- deliberately an ordinary (not out-of-band) var, precisely so it can never be confused with or accidentally gate the intentionally out-of-band economic vars utility-edge already relies on
Omission behavior: fails safe to legacy
```

No economic var (`PAID_ROUTES_ENABLED`, `SELLER_WALLET_ADDRESS`, any CDP credential) is read, written, or reinterpreted anywhere in this design; the new var is fully orthogonal to all of them by construction, which is why `ECONOMIC_CONFIGURATION_CHANGE_REQUIRED=NO` holds structurally rather than by promise. Deployment procedure for every transition in §V is `wrangler versions upload` (build the immutable candidate) followed by `wrangler versions deploy` (set or adjust the traffic split) and `wrangler versions view`/`wrangler deployments list` (inspect current state); `wrangler triggers deploy` is not used anywhere in this design.

## XXVII. Source-control / release evidence

Distinct identifiers that must never be treated as interchangeable:

```
VCM implementation commit          -- e.g. 623cb10 (03B)
canary-integration implementation commit -- the future IMPL-04A commit
candidate source commit            -- the exact commit a given candidate Worker Version was built from
evidence/report commit             -- this document's own commit
Cloudflare Worker Version id       -- a Cloudflare-assigned UUID, unrelated to git, carried in QualificationRecord.cloudflareWorkerVersionId (§XV)
```

## XXVIII. Preconditions for implementation

```
A2A_INTEGRATION_BOUNDARY_UNAMBIGUOUS = YES (§IV, §XI)
MCP_INTEGRATION_BOUNDARY_UNAMBIGUOUS = YES (§IV, §XII)
DUAL_RENDER_ARCHITECTURE_SAFE = YES (§VIII-§X)
FAIL_CLOSED_DEFAULT_DEFINED = YES (§VII)
SIGNING_BOUNDARY_PRESERVED = YES (§XI)
MCP_HANDLER_BINDING_PRESERVED = YES (§XII)
CANDIDATE_0_PERCENT_DESIGNED = YES (§XIII)
QUALIFICATION_GATES_COMPLETE = YES (§XIV)
CANARY_DESIGNED = YES (§XVII)
ROLLBACK_DESIGNED = YES (§XVIII)
AUTHORITY_INVERSION_GATE_DEFINED = YES (§XIX)
LEGACY_RETIREMENT_GATE_DEFINED = YES (§XX)
ECONOMIC_CONFIG_UNTOUCHED = YES (§XXVI)
```

## XXIX. Next implementation checkpoint

```
METADATA-VCM-IMPL-04A -- A2A/MCP Dual-Render Integration, Legacy Served, VCM Compared
```

Scope: (a) add the two closed-enum config vars, defaulted to `legacy` everywhere so behavior is unchanged the moment this ships; (b) wire `compareProjections` at A2A's per-isolate cache-build point and inline in MCP's request handler (100% sampled, since traffic eligibility is 0% by construction until a candidate is deployed); (c) emit the four telemetry counters via existing structured logging; (d) build the `QualificationRecord` evidence shape; (e) no candidate Worker Version, no deployment, no traffic change — purely code, tested in the existing dev/CI environment. Candidate deployment and qualification (§XIII-§XIV) become their own, later checkpoint once 04A is code-complete and tested.

## XXXI. Required final return

```
METADATA_VCM_06=PASS

PARENT_VCM_IMPL_03B=623cb10
PARENT_VCM_IMPL_03B_EVIDENCE=55e2570

A2A_LIVE_CALL_GRAPH=apps/edge-api/src/routes/a2a.ts -> resolveA2aApp -> protocol-a2a/src/transport.ts (card build + sign, isolate-cached) -> signing.ts/agent-card-signing.ts
MCP_LIVE_CALL_GRAPH=apps/edge-api/src/routes/mcp.ts -> createSiteborneMcpHonoApp (fresh per request) -> protocol-mcp/src/server.ts registerTool x6, stateless SDK handler

MIGRATION_STATES=legacy, shadow_compare, vcm_primary_compare, vcm_only (per surface, independent)

A2A_PROJECTION_MODE_CONFIG=A2A_METADATA_PROJECTION_MODE (closed enum, default legacy)
MCP_PROJECTION_MODE_CONFIG=MCP_METADATA_PROJECTION_MODE (closed enum, default legacy)

CONFIG_ABSENT_BEHAVIOR=legacy
CONFIG_INVALID_BEHAVIOR=legacy + logged, never escalates

A2A_COMPARE_EXECUTION_POINT=at the existing per-isolate cache rebuild (routes/a2a.ts), not per request
MCP_COMPARE_EXECUTION_POINT=inline per request, 100% sampled pre-traffic, sampled rate REQUIRES_MEASUREMENT once real traffic exists

A2A_SIGNING_BOUNDARY=VCM projects content only; identity.sign()/agent-card-signing.ts untouched and never invoked by VCM
MCP_HANDLER_BINDING_BOUNDARY=VCM supplies only the definition argument to existing registerTool() call sites; handler argument never touched

ZERO_PERCENT_CANDIDATE_MODEL=one immutable Worker Version per surface via wrangler versions upload, 0% traffic via wrangler versions deploy, only the one new mode var changed

A2A_QUALIFICATION_GATES=9
MCP_QUALIFICATION_GATES=10

CANARY_MODEL=Cloudflare Workers gradual-deployment traffic split; synthetic digest-verified 0%-traffic soak first, small short real-traffic canary second
ROLLBACK_MODEL=wrangler versions deploy revert to prior Version's 100% traffic; no code or registry change required

AUTHORITY_INVERSION_GATE=defined, six-part, per §XIX; none satisfied yet
LEGACY_PRODUCER_RETIREMENT_GATE=defined, per §XX; legacy code demoted to test fixture, not deleted, until its own separate checkpoint

LONG_TERM_A2A_REGISTRATION_OWNER=code, CI-parity-enforced
LONG_TERM_MCP_REGISTRATION_OWNER=code, CI-parity-enforced

TELEMETRY_FIELDS=metadata_projection_compare_total, metadata_projection_match_total, metadata_projection_mismatch_total, metadata_projection_fallback_total (via existing structured console logging)
PERFORMANCE_OVERHEAD_STRATEGY=A2A ~0 steady-state (isolate-scoped); MCP REQUIRES_MEASUREMENT in the 0%-traffic candidate before any real-traffic sample rate is set

VCM_REQUIRES_SIGNING_SECRET_ACCESS=NO

ECONOMIC_CONFIG_CHANGES_REQUIRED=0
REGISTRY_CHANGES_REQUIRED=0
CONTRACT_CHANGES_REQUIRED=0

NEXT_IMPLEMENTATION_CHECKPOINT=METADATA-VCM-IMPL-04A -- A2A/MCP Dual-Render Integration, Legacy Served, VCM Compared

DESIGN_REPORT=docs/reports/METADATA-VCM-06-a2a-mcp-canary-integration-design.md

RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0

SAFE_TO_IMPLEMENT_DUAL_RENDER_INTEGRATION=YES
```
