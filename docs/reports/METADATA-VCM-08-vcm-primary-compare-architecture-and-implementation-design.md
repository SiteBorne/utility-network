# METADATA-VCM-08 — VCM Primary-Compare Architecture and Implementation Design

**Checkpoint:** METADATA-VCM-08

**Date:** 2026-09-16

**Mode:** Architecture, design, and evidence only

**Result:** PASS — safe to implement in METADATA-VCM-IMPL-05 under the
boundaries below

## 1. Decision

The next reversible metadata runtime state is:

```text
VCM projection attempt
  + independently built legacy reference
  + one shared semantic equivalence law
  -> serve VCM only on a valid match
  -> otherwise serve the already-built legacy result
```

This is the meaning of **vcm_primary_compare** for pre-cutover qualification. It
makes VCM the attempted metadata-content producer while retaining the legacy
producer as an executable reference, per-request or per-cache-build fallback,
and immutable-version rollback target.

It does not make VCM authoritative for handlers, payments, prices, routes,
authentication, signing keys, durable state, scheduled execution, queues,
storage, or service bindings. It does not authorize vcm_only, remove either
legacy producer, alter registry artifacts, or perform authority inversion.

The source audit found no implementation blocker. It did find one required MCP
refactor: the six metadata definitions are currently written inline beside their
handler closures. IMPL-05 must expose a narrow, typed definition input while
constructing the same handlers internally. VCM must have no API through which it
can supply a handler.

## 2. Authoritative starting state

| Item                       | Authoritative value                          |
| -------------------------- | -------------------------------------------- |
| Repository                 | /Users/meta4ickal/SITEBORNE Utility Network  |
| Branch                     | metadata-vcm-qualification                   |
| Starting local HEAD        | 1d290d52e68d393cdd5ad8778008d9d9d7b3d50a     |
| Starting remote HEAD       | 1d290d52e68d393cdd5ad8778008d9d9d7b3d50a     |
| Remote 07C-R1 provenance   | PASS                                         |
| Active deployment          | 97a76f46-a580-4529-8c76-36e9ac35383f         |
| Stable Worker version      | 38cbf4dd-52fd-4afc-ad34-626a2e6454d3 at 100% |
| Qualified shadow candidate | 1a3ea07b-5885-49d2-9cd0-d176c4313bd0 at 0%   |
| A2A candidate mode         | shadow_compare                               |
| MCP candidate mode         | shadow_compare                               |
| Paid routes                | false                                        |
| Real production cutover    | NO                                           |
| VCM primary serving        | NO                                           |
| Authority inversion        | NO                                           |

Git inspection at the start of this checkpoint confirmed the requested branch,
matching local and remote commits, and an otherwise clean worktree.

The current qualified rollback/reference baseline remains:

- A2A: legacy unsigned card is built, signed, cached, and served; VCM is
  generated only for comparison.
- MCP: legacy definitions enter the real six registerTool calls; VCM is
  generated only after a tools/list response for comparison.
- R3 accepts both JSON and SSE tools/list observation representations without
  changing the served response.

## 3. Exact source architecture trace

### 3.1 Mode gate and telemetry

The closed four-value vocabulary is already present in
apps/edge-api/src/control-plane/config/metadata-projection-mode.ts:

- METADATA_PROJECTION_MODES
- parseMetadataProjectionMode
- resolveAuthorizedMetadataProjectionMode

The parser recognizes legacy, shadow_compare, vcm_primary_compare, and vcm_only.
Missing or invalid text resolves to legacy. The authorization function currently
permits only legacy and shadow_compare; both future values resolve to legacy
with structured telemetry.

IMPL-05 needs no new environment variable and no configuration schema change. It
changes only the authorization result so vcm_primary_compare passes through.
vcm_only must continue resolving to legacy with a not-authorized event.

Existing comparison execution is centralized in
apps/edge-api/src/control-plane/metadata/shadow-comparison-runner.ts:

- runShadowComparison returns Promise<void>.
- It builds the VCM side, calls compareProjections and summarizeDifferences, and
  emits bounded telemetry.
- Its result is structurally unusable as a served response.
- Projector, comparator, and telemetry failures cannot affect legacy serving.

Existing telemetry is in
apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts:

- metadata_projection_compare_total
- metadata_projection_match_total
- metadata_projection_mismatch_total
- metadata_projection_fallback_total

Primary selection needs a separate, small selector because serving depends on
the result. runShadowComparison must retain its void, observation-only safety
property.

### 3.2 A2A live call graph

```text
apps/edge-api/src/index.ts
  -> apps/edge-api/src/routes/a2a.ts:a2aRoute
  -> resolveA2aApp
       -> resolveEffectiveProductionStatusByServiceId
       -> resolveMtlsProductionActive
       -> parseMetadataProjectionMode
       -> resolveAuthorizedMetadataProjectionMode
       -> resolveAgentCardSigningIdentity
       -> scheduleA2aShadowComparison
       -> createSiteborneA2aHonoApp
  -> packages/protocol-a2a/src/transport.ts
       -> buildUnsignedSiteborneAgentCard
       -> identity.sign
       -> identity.verify
       -> cached Hono application
       -> GET /.well-known/agent-card.json
```

The legacy content producer is
packages/protocol-a2a/src/card.ts:buildUnsignedSiteborneAgentCard.

The VCM producer is
packages/vcm/src/projections/a2a-shadow.ts:projectA2aFromVcm. Its real context
comes from buildRealA2aShadowContext in a2a-real-context.ts.

resolveA2aApp computes production-status and mTLS inputs once for the cache key.
It assigns an async promise synchronously before the first await. That prevents
concurrent requests from creating different ephemeral signing identities and
mismatched card/JWKS pairs.

createSiteborneA2aHonoApp currently builds the legacy card internally, signs it
once, verifies it, then captures the immutable signed card and identity inside
the Hono application. The GET endpoint serializes that captured object through
AgentCard.toJSON. POST /a2a also passes the same signed card to the SDK request
handler.

Current shadow comparison occurs at the same cache-rebuild point but is
scheduled in the background. It compares unsigned legacy and VCM content.

### 3.3 MCP live call graph

```text
apps/edge-api/src/index.ts
  -> apps/edge-api/src/routes/mcp.ts:mcpRoute
       -> readBoundedMcpRequest
       -> resolveEffectiveServiceRuntimeStatus for four v2 services
       -> createMcpX402ServiceBoundary
       -> resolve quote network/asset only when seller configuration exists
       -> parse/authorize metadata mode
       -> createSiteborneMcpHonoApp(options).fetch(request)
       -> for shadow tools/list only:
            readJsonRpcMethod
            extractToolsListFromResponse (JSON or SSE)
            buildRealMcpShadowContext
            projectMcpToolsFromVcm
            runShadowComparison
  -> packages/protocol-mcp/src/server.ts
       -> createSiteborneMcpHandler
       -> createSiteborneMcpServer for each request
       -> six registerTool calls
       -> official MCP SDK JSON/SSE transport
```

The four service metadata definitions are assembled inline in the loop at
server.ts:createSiteborneMcpServer from:

- MCP_SERVICE_TOOLS
- SERVICE_TOOL_TITLES
- serviceToolDescription
- describeInputSchema
- MCP_SERVICE_OUTPUT_SCHEMAS
- MCP_SERVICE_SCHEMA_METADATA
- fixed annotations and payment-required metadata

The two utility metadata definitions are also inline:

- siteborne_get_quote uses quoteInputSchema and quoteOutputSchema.
- siteborne_get_service_health uses an empty input schema and
  healthOutputSchema.

The six executable handler sources are distinct from their definitions:

- Four service handlers close over the existing McpServiceExecutionBoundary,
  reject hostile keys, extract the official x402 payment payload, and call
  boundary.execute with the mapped v2 service ID.
- The quote handler calls buildCanonicalQuote and requires options.quote.
- The health handler reads only the already-resolved health options.

All six meet at McpServer.registerTool(name, definition, handler). This is the
boundary IMPL-05 must preserve.

MCP server and handler construction are per request. The SDK uses legacy:
stateless for compatibility. Request framing, protocol negotiation, JSON/SSE
selection, malformed input, and unknown-method behavior are owned by the
existing SDK path and must remain untouched.

### 3.4 VCM construction and authority inputs

packages/vcm/src/runtime-model.ts statically imports the eight accepted registry
JSON files and calls legacyRegistryToVCM. The import is build-time content, not
runtime filesystem I/O and not a ninth hand-maintained copy.

getRuntimeEffectiveView:

1. imports registry release evidence into CanonicalStaticModel;
2. sources current governed prices through the pricing package during import;
3. applies emptyOverlay, which narrows activation/publication/security facts to
   disabled or unknown;
4. returns a cached EffectiveMetadataView per runtime source commit.

The current runtime projection deliberately injects runtime-dependent public
facts through the same typed edge resolvers used by the legacy producers:

- A2A productionEnabled comes from resolveEffectiveProductionStatusByServiceId.
- A2A mTLS declaration comes from resolveMtlsProductionActive.
- MCP production status comes from resolveEffectiveServiceRuntimeStatus.
- MCP schema/prose leaf inputs currently come from the real served tool list in
  shadow mode.

The VCM projection builders are pure:

- projectA2aFromVcm(effective, context)
- projectMcpToolsFromVcm(effective, context)

The comparator is packages/vcm/src/comparator.ts. It is object-key-order
insensitive, array-order sensitive, distinguishes missing from null, and uses
one path-based classification vocabulary. No primary-specific comparator is
permitted.

The five and only five digest classes are in packages/vcm/src/digests.ts:

1. model digest
2. service digest
3. runtime-overlay digest
4. effective-view digest
5. projection digest

Validators in packages/vcm/src/validators.ts enforce model structure, service
identity, exposure, economics, overlay narrowing, security ceilings, and digest
integrity.

## 4. Current and proposed producer graphs

### 4.1 Qualified shadow_compare

```text
A2A
legacy card builder -> signing -> cache -> served card
         |
         +-> unsigned reference
VCM effective view -> VCM projection -> background semantic comparison

MCP
legacy inline definitions + existing handlers -> registerTool -> served response
                                              |
                                              +-> JSON/SSE tools list
VCM effective view + observed real definitions -> VCM projection -> comparison
```

### 4.2 Proposed vcm_primary_compare

```text
A2A cache construction
resolved runtime facts
  -> legacy unsigned card -------------------------+
  -> VCM effective view -> VCM unsigned card       |
                              -> validation         |
                              -> same comparator <--+
                                   match -> select VCM
                                mismatch -> select legacy
                   selected unsigned card -> sign once -> verify -> cache -> serve

MCP per-request server construction
resolved runtime facts
  -> independent legacy definition builder --------+
  -> VCM effective view + typed leaf authorities    |
       -> VCM six-definition projection             |
       -> exact-set/schema validation                |
       -> same comparator ---------------------------+
            match -> select VCM definitions
         mismatch -> select legacy definitions
  selected definitions + internally built existing handlers
       -> one registerTool call per canonical name
       -> unchanged official SDK transport
```

The primary selector must return a selected metadata value and a bounded
decision. It must not know about Agent Card signing, MCP handlers, payments,
Hono, or Cloudflare. Surface code applies the selected content at the existing
boundary.

## 5. Mode state machine

| Configured mode     | Authorized in IMPL-05 | Primary producer | Comparator         | Served output                       | Failure/mismatch behavior                                                         |
| ------------------- | --------------------- | ---------------- | ------------------ | ----------------------------------- | --------------------------------------------------------------------------------- |
| legacy              | yes                   | legacy           | none               | legacy                              | existing behavior                                                                 |
| shadow_compare      | yes                   | legacy           | VCM shadow         | legacy                              | observation never affects response                                                |
| vcm_primary_compare | yes                   | VCM attempt      | independent legacy | VCM only after validation and match | legacy fallback; fail closed only if legacy is unavailable or final signing fails |
| vcm_only            | no                    | none             | none               | legacy after authorization refusal  | log refusal; never serve VCM-only                                                 |

There is no runtime transition within an immutable Worker version. The mode is
version configuration. A change to a different mode requires a new immutable
version and separately authorized deployment.

Accidental vcm_only configuration remains safe because the parser recognizes it
but the authorization gate refuses it to legacy. Invalid, empty, or
case-mismatched values also resolve to legacy.

## 6. A2A primary-compare architecture

### 6.1 Exact content, signing, and cache boundaries

The safe source-aligned order is:

1. Resolve production-status and mTLS facts using the existing resolvers.
2. Build the independent legacy unsigned card.
3. Obtain the cached VCM EffectiveMetadataView.
4. Build the VCM unsigned card with buildRealA2aShadowContext.
5. Validate the VCM card as an unsigned SDK-compatible AgentCard:
   - SDK JSON round trip succeeds;
   - signatures is exactly empty before signing;
   - protocol interface/version shape is valid;
   - skill/service IDs are unique and canonical;
   - no unsupported capability is introduced.
6. Compare legacy as expected and VCM as actual using compareProjections with
   the already-qualified pre-signature semantics.
7. Select VCM only if validation succeeds and unexplained differences equal
   zero. Otherwise select the already-built legacy card.
8. Pass exactly one selected unsigned AgentCard into createSiteborneA2aHonoApp.
9. The existing identity signs exactly once and immediately verifies.
10. Only the fully constructed app promise is published through the existing
    isolate cache.

The smallest protocol-a2a seam is an optional
CreateSiteborneA2aOptions.unsignedAgentCard. When absent, transport.ts continues
calling buildUnsignedSiteborneAgentCard exactly as today. When present, it signs
that supplied, validated unsigned card. The option must accept content only; it
cannot accept signatures or a replacement signer.

There is no sign-legacy-then-substitute path, no post-sign mutation, no unsigned
fallback, and no second signing attempt after a failed signature.

Comparison happens during the single cache-promise construction, before the
selected card is signed and before a Hono app can be returned. The existing
synchronous assignment of the async promise remains. Concurrent callers see the
same pending promise and cannot publish mixed variants.

### 6.2 A2A failure semantics

| Case                                                  | Served output / HTTP behavior                                                    | Fallback                   | Telemetry                                     | Severity and rollback                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| VCM and legacy build; validation and comparison match | Signed VCM card, normal status                                                   | no                         | primary attempt/success, compare, match       | expected; no rollback                                                               |
| Both build; semantic mismatch                         | Sign and serve legacy                                                            | yes                        | mismatch with bounded count/digests, fallback | critical qualification failure; return candidate to shadow_compare before promotion |
| VCM projector throws; legacy exists                   | Sign and serve legacy                                                            | yes                        | primary failure class projector, fallback     | critical; rollback if repeated                                                      |
| VCM validation fails; legacy exists                   | Sign and serve legacy                                                            | yes                        | validation failure, fallback                  | critical; rollback if repeated                                                      |
| Comparison engine throws after both outputs exist     | Sign and serve legacy                                                            | yes                        | comparator failure, fallback                  | critical; rollback if repeated                                                      |
| Legacy builder fails while VCM succeeds               | No unqualified VCM serving; cache construction rejects and request fails closed  | unavailable                | legacy-reference failure                      | immediate investigation/rollback                                                    |
| Both producers fail                                   | cache construction rejects; no card                                              | unavailable                | both-producers failure                        | immediate rollback                                                                  |
| Final signing or verification fails                   | fail closed; no unsigned or stale response                                       | no second signing fallback | signing failure                               | immediate rollback                                                                  |
| Telemetry sink throws                                 | selected output is still signed and served                                       | unchanged                  | best effort only                              | investigate; metadata serving continues                                             |
| Concurrent cache construction                         | all callers share one promise, one identity, one selected card                   | n/a                        | at most one decision per cache key            | safe; race test required                                                            |
| Raw runtime input absent/malformed                    | existing strict resolvers narrow to false/disabled; invalid mode resolves legacy | as governed                | invalid-input/mode telemetry already used     | no capability widening                                                              |
| Runtime resolver itself throws                        | cache construction fails closed; no guessed metadata                             | no                         | resolver failure                              | investigate/rollback                                                                |

A rejected cache promise remains stable for that isolate/cache key. IMPL-05 must
not clear and race-rebuild it inside the same request wave. A new isolate or
immutable version may retry. This favors deterministic failure over
race-dependent signed identities.

## 7. MCP definition/handler separation

### 7.1 Required narrow refactor

protocol-mcp must define an internal typed metadata definition shape containing
only:

- canonical tool name;
- title and description;
- JSON-schema-compatible input and output definitions;
- annotations; and
- bounded \_meta.

CreateSiteborneMcpOptions may gain one optional field such as toolDefinitions.
It must not gain a handler field, callback map, execution boundary replacement,
quote function, or arbitrary register hook.

createSiteborneMcpServer must:

1. construct the existing six executable handler closures internally from
   options.serviceBoundary, options.quote, and options.health;
2. choose supplied definitions or the legacy builder's definitions;
3. validate exact canonical name-set equality, uniqueness, schema presence, and
   one definition per MCP_TOOL_NAMES entry;
4. iterate MCP_TOOL_NAMES once;
5. call registerTool(name, selectedDefinition, existingHandlerForName) once per
   name.

Fallback chooses a definition array before server construction. It never builds
two live servers, registers a handler twice, or invokes a handler.

The MCP SDK accepts JSON Schema through fromJsonSchema. IMPL-05 should keep VCM
projection schemas in their existing wire-comparison JSON form and wrap the
selected schemas at the registerTool boundary. Utility Zod schemas must be
converted through the SDK/Zod standard JSON-schema path from the existing
quoteInputSchema, quoteOutputSchema, and healthOutputSchema authorities; no
hand-copied replacement schema is allowed. Exact tools/list regression tests
must prove that this mechanical representation step changes no public schema.

If the SDK-native conversion cannot reproduce the existing utility wire schema
exactly, implementation must retain both values in a typed leaf-authority
record: the existing SDK registration schema for execution and its SDK-produced
JSON representation for comparison. It must not author a second schema. This is
an implementation proof step, not an architectural blocker.

### 7.2 Independent producer rule

Extract a pure legacy metadata builder from the current inline registration
objects. It remains independently callable and remains the default when no
definition override is supplied.

Primary VCM context must not be made from a served VCM response or from the
legacy final definition array. Add a typed current-authority context builder
that reads the existing protocol-mcp leaf authorities:

- names and order from MCP_TOOL_NAMES/MCP_SERVICE_TOOLS;
- titles and descriptions from the existing protocol-mcp constants/functions;
- service schemas and URIs from frozen-contracts and
  MCP_SERVICE_SCHEMA_METADATA;
- utility schemas from the existing Zod schemas through the SDK's JSON-schema
  conversion;
- runtime production wording from the same health options.

The VCM projector remains responsible for selecting the four current service
exposures, associating service IDs, adding canonical annotations and \_meta, and
combining the two utility interactions in canonical order.

The legacy builder independently assembles the final six definitions. Sharing
typed leaf authorities such as the one real schema is acceptable and necessary;
deriving the legacy final output from VCM is prohibited. This preserves at least
the diagnostic independence already present in qualified shadow mode, where
prose and schemas are intentionally injected context while VCM governs exposure
selection and assembly.

### 7.3 Six-tool authority table

| Tool                             | Legacy definition source                                                    | VCM definition source                                                              | Existing handler source                                                         | Economic/schema boundary                                                      |
| -------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| siteborne_company_evidence_graph | service loop, title/description helpers, v2 frozen schemas, schema metadata | current VCM MCP exposure for company_evidence_graph.v2 plus typed protocol context | existing service closure calling boundary.execute for company_evidence_graph.v2 | schemas remain frozen-contracts; payment gate remains service boundary        |
| siteborne_web_context_verified   | same loop for web_context_verified.v2                                       | current VCM exposure plus typed context                                            | same existing closure with web_context_verified.v2                              | same                                                                          |
| siteborne_document_evidence_json | same loop for document_evidence_json.v2                                     | current VCM exposure plus typed context                                            | same existing closure with document_evidence_json.v2                            | same                                                                          |
| siteborne_verify_agent_output    | same loop for verify_agent_output.v2                                        | current VCM exposure plus typed context                                            | same existing closure with verify_agent_output.v2                               | same                                                                          |
| siteborne_get_quote              | inline utility definition and existing Zod schemas                          | VCM current utility exposure plus typed utility context                            | existing buildCanonicalQuote closure                                            | price remains resolveServiceMaxPriceUsd at invocation; no VCM price execution |
| siteborne_get_service_health     | inline utility definition and health schema                                 | VCM current utility exposure plus typed utility context                            | existing health closure                                                         | reads resolved health only; no execution or price                             |

### 7.4 MCP comparison and lifecycle

Primary comparison occurs at definition selection immediately before
createSiteborneMcpHonoApp, per request, because the current server is rebuilt
per request and registration requires the selected definitions before the SDK
can produce tools/list or accept tools/call.

There is no separate primary comparison at response extraction time. That would
be too late to choose what was registered. The JSON/SSE extractor remains for
shadow_compare and for live observational tests.

The comparison direction remains legacy expected versus VCM actual in both
modes. Served/reference roles are telemetry attributes, not a reason to reverse
arguments or change normalization. Equality is symmetric, while keeping a stable
argument order preserves path diagnostics.

Every MCP request in vcm_primary_compare builds and validates the selection
before server registration. This is deliberately simpler than adding a new cache
or sampling mechanism. It ensures tools/call never uses unqualified definitions.
Performance must be measured on a 0% candidate; optimization is not authorized
until evidence shows it is needed.

### 7.5 MCP failure semantics

| Case                                          | Served output / HTTP behavior                                       | Fallback    | Telemetry                                      | Severity and rollback          |
| --------------------------------------------- | ------------------------------------------------------------------- | ----------- | ---------------------------------------------- | ------------------------------ |
| Valid VCM and legacy definitions match        | one server registers VCM definitions with existing handlers         | no          | primary success, compare, match                | expected                       |
| Semantic mismatch                             | one server registers legacy definitions with existing handlers      | yes         | mismatch and fallback                          | critical qualification failure |
| VCM projector throws                          | legacy definitions register                                         | yes         | projector failure and fallback                 | critical if repeated           |
| VCM validation fails                          | legacy definitions register                                         | yes         | validation failure and fallback                | critical                       |
| Comparator throws after both exist            | legacy definitions register                                         | yes         | comparator failure and fallback                | critical                       |
| Legacy definition builder fails; VCM succeeds | do not register unqualified VCM; fail closed before server creation | unavailable | legacy-reference failure                       | immediate rollback             |
| Both producers fail                           | fail closed before registration                                     | unavailable | both-producers failure                         | immediate rollback             |
| Handler-map construction fails                | existing request fails; no alternate VCM handler exists             | no          | handler-construction failure                   | immediate rollback             |
| Telemetry throws                              | selected definitions register normally                              | unchanged   | best effort                                    | investigate                    |
| Duplicate, missing, extra, or unknown name    | VCM validation fails and legacy registers                           | yes         | validation failure with low-cardinality reason | critical                       |

## 8. MCP transport invariants

IMPL-05 must leave all of these unchanged:

- route /mcp;
- MCP_PROTOCOL_VERSION = 2026-07-28;
- legacy: stateless compatibility;
- official SDK request parsing and JSON-RPC behavior;
- application/json and text/event-stream response negotiation;
- JSON and SSE tools/list framing;
- one-megabyte edge request bound and 413 behavior;
- malformed JSON handling;
- forbidden object-key defense;
- unknown-method behavior;
- service handler invocation;
- official x402 payment metadata extraction;
- quote behavior;
- health behavior;
- unauthenticated unpaid behavior;
- allowed hosts/origins.

The primary selector runs before SDK server construction and supplies only the
definition argument. It does not inspect or rewrite request bodies, responses,
protocol headers, or transport framing.

## 9. Temporal and runtime authority model

| Fact family                                                            | Class                       | Real authority in this runtime                                                | VCM primary rule                                                                        |
| ---------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| service ID, title, description, capability, contract/schema references | STATIC                      | canonical static model compiled from accepted inputs and typed code authority | may project                                                                             |
| current A2A/MCP mounted exposure                                       | STATIC / PROTOCOL_DERIVED   | current registration manifests represented in VCM current exposure            | may select and project; cannot infer activation                                         |
| registry protocols/base/maximum price declarations                     | RELEASE_DECLARED            | frozen accepted registry JSON                                                 | preserve for round-trip only; never use as current serving authority                    |
| productionEnabled and service availability                             | RUNTIME_DERIVED             | existing edge production/payment resolvers and route gates                    | inject the same resolved boolean; absence narrows false                                 |
| paid-route activation                                                  | RUNTIME_DERIVED / ECONOMIC  | PAID_ROUTES_ENABLED plus existing route-specific gates                        | metadata cannot enable it                                                               |
| listPrice and governed maximum                                         | ECONOMICALLY_GOVERNED       | pricing package/governance mapping                                            | VCM may describe governed truth where a surface supports it; cannot set execution price |
| transaction quote amount                                               | TRANSACTION_TIME / ECONOMIC | buildCanonicalQuote and x402 governed pricing                                 | remains handler-owned and outside static projection                                     |
| mTLS public declaration                                                | SECURITY_DERIVED            | resolveMtlsProductionActive                                                   | declare only when resolver says active                                                  |
| Agent Card signature/key ID/JWKS                                       | SECURITY_DERIVED            | injected signing identity                                                     | always applied after content selection                                                  |
| external publication                                                   | EXTERNAL EVIDENCE           | measured publication evidence                                                 | never infer from mounted code                                                           |
| v1/v2 canonical identities                                             | STATIC                      | canonical service IDs and current exposure manifests                          | preserve exact IDs; no collision/collapse                                               |

The runtime model currently applies emptyOverlay. That is intentionally
fail-closed and prevents static registration from becoming a claim of runtime
activation, publication, or verified security. IMPL-05 should not fabricate a
new overlay merely to make primary serving appear more complete. It should use
the already-qualified projection contexts for runtime-derived surface fields. A
later checkpoint may unify those values into a measured overlay, with its own
parity proof.

Runtime may narrow but cannot widen. A missing activation means false. A missing
publication measurement means unmeasured. An IMPLEMENTED mechanism cannot be
promoted to ACTIVE by an overlay; CONFIGURED is a prerequisite.

## 10. Economic authority proof

| Price-bearing concept            | Source of truth                                                                                             | Transformation                                  | Public projection in A2A/MCP                                      | Legacy comparator source                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| Canonical listPrice              | @siteborne/pricing through primaryPricingKey and resolveServiceMaxPriceUsd during VCM import                | USD Price                                       | neither current A2A card nor MCP tools/list emits a numeric price | no numeric field on these metadata surfaces         |
| governedMaxPrice                 | same governed pricing source                                                                                | USD ceiling                                     | not emitted numerically on these two surfaces                     | none                                                |
| releaseBasePriceDeclared         | frozen registry base_price                                                                                  | verbatim evidence                               | never emitted as current price                                    | frozen registry round-trip only                     |
| releaseMaximumPriceDeclared      | frozen registry maximum_price                                                                               | verbatim evidence                               | never emitted as current price                                    | frozen registry round-trip only                     |
| A2A payment scheme/resource      | BAZAAR_PAYMENT_POLICY and resolveServiceRoute                                                               | typed context into x402 extension               | scheme/resource only, not amount                                  | legacy card uses the same current typed authorities |
| MCP quote amount                 | protocol-mcp buildCanonicalQuote -> exact/upto pricing key -> resolveServiceMaxPriceUsd -> usdToAtomicUnits | transaction-bound quote and payment requirement | returned only when the existing quote handler is invoked          | existing handler itself                             |
| Paid REST requirement/settlement | existing x402 route and payment boundary                                                                    | current governed route logic                    | outside metadata producer selection                               | unchanged                                           |

VCM primary definition selection cannot invoke buildCanonicalQuote or
boundary.execute. PAID_ROUTES_ENABLED remains false during pre-cutover
qualification. No paid call is required. Economic side-effect delta is NONE.

## 11. Security authority proof

The enforced progression remains:

```text
IMPLEMENTED -> CONFIGURED -> ACTIVE -> VERIFIED
```

- Canonical static types can express only IMPLEMENTED or CONFIGURED.
- Runtime evidence may narrow/raise only within the static ceiling.
- emptyOverlay cannot claim ACTIVE or VERIFIED.
- A2A mTLS is emitted only from resolveMtlsProductionActive.
- Agent Card signing keys remain in resolveAgentCardSigningIdentity and the
  protocol-a2a signing identity. VCM never receives key material.
- The final selected unsigned card is signed and verified once.
- Root and skill securityRequirements stay as the existing public semantics.
- x402 payment authorization is not client authentication and must not be
  described as mTLS, OAuth, or verified caller identity.
- MCP definition selection cannot relax request validation, payment extraction,
  host/origin checks, or service boundary enforcement.

Security authority changes: NONE.

## 12. Digest use

No new digest class and no public contract field is required.

Primary-compare may use existing digests internally:

- EffectiveMetadataView.digest identifies the effective input view.
- computeProjectionDigest over normalized VCM and legacy unsigned/definition
  outputs distinguishes projection drift without logging content.
- model, service, and runtime-overlay digests remain available to offline
  qualification evidence when the corresponding values are present.

Structured diagnostic events may include fixed-format SHA-256 digests as fields,
never metric labels. They must not include metadata payloads. A mismatch with
equal model/effective digests but differing projection digests points to adapter
drift. A changed effective digest points upstream to static or overlay inputs;
offline model and overlay digests then separate those domains.

Timestamps remain excluded under existing digest law. No digest is used as an
authorization decision by itself; validation plus semantic comparison decides.

## 13. Mismatch and failure policy decision

Options evaluated:

| Option                                   | Assessment                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Fall back to legacy on mismatch       | Selected for pre-cutover primary_compare. Maximizes diagnostic evidence while preventing public metadata regression.                                                             |
| B. Fail closed on every mismatch         | Safer than serving bad metadata but causes avoidable outage while a qualified legacy result is already available. Reserved for loss of the legacy reference or signing boundary. |
| C. Serve VCM and emit critical telemetry | Rejected. It silently makes an unexplained VCM difference public authority.                                                                                                      |
| D. Distinguish mismatch classes          | Used through the existing comparator. Exact, normalized, volatile, and governed differences may pass; any UNEXPLAINED_DIFFERENCE falls back.                                     |

Frozen policies:

```text
MISMATCH_SERVING_POLICY=FALLBACK_TO_INDEPENDENT_LEGACY
PROJECTOR_FAILURE_POLICY=FALLBACK_TO_INDEPENDENT_LEGACY
VALIDATION_FAILURE_POLICY=FALLBACK_TO_INDEPENDENT_LEGACY
COMPARATOR_FAILURE_POLICY=FALLBACK_TO_LEGACY_IF_ALREADY_BUILT;_OTHERWISE_FAIL_CLOSED
LEGACY_REFERENCE_FAILURE_POLICY=FAIL_CLOSED;_DO_NOT_SERVE_UNCOMPARED_VCM
SIGNING_FAILURE_POLICY=FAIL_CLOSED;_NEVER_SERVE_UNSIGNED_OR_REUSE_STALE_CONTENT
TELEMETRY_FAILURE_POLICY=CONTINUE_WITH_ALREADY_SELECTED_OUTPUT
```

Fallback does not mean a candidate passes. Any unexplained mismatch or primary
failure is a qualification failure and blocks promotion even when callers
receive a healthy legacy response.

## 14. Telemetry design

Reuse the existing safe structured logger and comparison events. Extend events
with mode=vcm_primary_compare and add only the lifecycle signals needed to
distinguish attempts from silent bypasses:

| Event                                              | Fields                                 |
| -------------------------------------------------- | -------------------------------------- |
| metadata_projection_primary_attempt_total          | surface, mode                          |
| metadata_projection_primary_success_total          | surface, mode                          |
| metadata_projection_primary_failure_total          | surface, mode, failureClass            |
| metadata_projection_legacy_reference_attempt_total | surface, mode                          |
| metadata_projection_compare_total                  | surface, mode                          |
| metadata_projection_match_total                    | surface, mode                          |
| metadata_projection_mismatch_total                 | surface, mode, domain, differenceCount |
| metadata_projection_comparator_failure_total       | surface, mode, failureClass            |
| metadata_projection_validation_failure_total       | surface, mode, failureClass            |
| metadata_projection_fallback_total                 | surface, mode, reason                  |
| metadata_projection_signing_failure_total          | surface=a2a, mode                      |

Allowed failureClass/reason values must be a closed low-cardinality enum such as
projector, validation, mismatch, comparator, legacy_reference, signing, or
handler_construction. Digests may be bounded JSON fields but never labels.

No event may include request bodies, full cards/tools, signatures, private keys,
auth material, client IPs, TLS fingerprints, secrets, or dynamic error text that
could create high cardinality. Error messages remain bounded or mapped to closed
classes.

R2 established an explicit liveness requirement: a valid supported
representation must produce attempt and comparison telemetry. Primary MCP
selection occurs before transport, so this proof is independent of JSON/SSE; the
live tools/list response is still checked in candidate tests to prove the
selected definitions reached the transport.

## 15. Recovery layers

### 15.1 In-process fallback

Fallback selects the independently built legacy unsigned card or definition
array before signing/registration:

- A2A signs exactly one selected card.
- MCP constructs exactly one server and registers each existing handler once.
- No response is partially emitted before selection.
- No fallback invokes a handler, quote, payment, queue, storage, workflow, or
  scheduled path.

### 15.2 Operational rollback

Operational rollback uses immutable Worker versions, not mutable production
editing:

1. stop after read-only evidence;
2. human authorizes a separate mutation checkpoint;
3. deploy a previously qualified shadow_compare/legacy-serving version or a
   newly built immutable version with both surface modes shadow_compare;
4. inspect deployment and exact version attribution;
5. re-run controlled read-only probes.

The current R3 shadow candidate is a qualified reference configuration, not an
authorization to deploy it or change traffic in this checkpoint.

## 16. Adversarial failure-mode matrix

| Failure or variation                  | Expected safe behavior                                                                   | Required IMPL-05 proof             |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| Malformed VCM projection              | validation fails; legacy selected                                                        | unit plus surface adversarial test |
| Missing canonical model section       | projector/validator fails; legacy selected                                               | VCM/selector test                  |
| Malformed raw runtime input           | existing resolver narrows false or mode to legacy                                        | config and surface test            |
| Runtime resolver throws               | surface fails closed before guessed metadata                                             | surface test                       |
| Stale overlay                         | effective/projection digest differs or runtime facts remain narrowed; never widen        | digest/overlay test                |
| Object field-order difference         | semantic match under object-key-insensitive comparator                                   | comparator test                    |
| Array-order difference                | unexplained mismatch; legacy selected                                                    | comparator and surface test        |
| Undefined versus null                 | unexplained mismatch; legacy selected                                                    | comparator test                    |
| Numeric versus string                 | unexplained mismatch unless an existing explicit normalization says otherwise            | comparator test                    |
| v1/v2 identity collision              | validation fails; legacy selected                                                        | VCM identity test                  |
| Incorrect A2A/MCP protocol version    | mismatch/validation failure; legacy selected                                             | surface test                       |
| Missing MCP tool                      | validation or mismatch; legacy selected                                                  | MCP adversarial test               |
| Extra MCP tool                        | validation or mismatch; legacy selected                                                  | MCP adversarial test               |
| Duplicate MCP tool                    | validation failure before registration                                                   | protocol-mcp test                  |
| Unknown MCP tool                      | validation failure before registration                                                   | protocol-mcp test                  |
| Schema difference                     | unexplained mismatch; legacy selected                                                    | MCP test                           |
| Description difference                | unexplained mismatch; legacy selected                                                    | MCP test                           |
| Economic field difference             | unexplained mismatch; legacy selected; no execution                                      | VCM/economic test                  |
| Security-state difference             | mismatch/validation; legacy selected                                                     | A2A security test                  |
| A2A signature input difference        | detected pre-signature; legacy selected                                                  | signing-order test                 |
| Comparator exception                  | legacy selected when available                                                           | selector and surface test          |
| Telemetry exception                   | selected output still served                                                             | surface adversarial test           |
| A2A cache race                        | one promise, one signer, one selected card/JWKS pair                                     | concurrent transport test          |
| Concurrent MCP requests               | independent per-request server; same deterministic definition decision                   | concurrency test                   |
| Isolate restart                       | deterministic rebuild from immutable code/config; no durable metadata state              | cold-start repeat test             |
| JSON tools/list                       | selected definitions appear in valid JSON response                                       | MCP integration test               |
| SSE tools/list                        | selected definitions appear in valid SSE response                                        | MCP integration test               |
| Legacy compatibility request          | legacy: stateless behavior unchanged                                                     | existing 2025-11-25 test           |
| Invalid MCP request                   | SDK error/status unchanged; no handler execution                                         | transport test                     |
| Malformed JSON-RPC                    | existing parsing/status unchanged                                                        | transport test                     |
| Unknown MCP method                    | existing SDK response unchanged                                                          | transport test                     |
| Paid tool while paid routes disabled  | existing boundary rejects/returns governed unavailable/payment result; no free execution | edge/x402 test                     |
| Unauthenticated unpaid tool request   | zero provider invocation and existing payment-required/rejected behavior                 | MCP payment test                   |
| Handler-map mismatch                  | fail before registration; VCM cannot supply replacement                                  | protocol-mcp unit test             |
| Worker restart                        | reconstruct safely; no queue/storage mutation                                            | repeated cold-start test           |
| Version split                         | each immutable version uses its own mode/config; no shared metadata cache                | candidate qualification            |
| Candidate override                    | exact version proves VCM result, telemetry, signature/handler invariants                 | future 0% live test                |
| Accidental vcm_only                   | authorization refuses to legacy and logs                                                 | mode/integration test              |
| A2A signing failure                   | fail closed; no unsigned or old response                                                 | signing adversarial test           |
| Legacy builder failure with valid VCM | fail closed; VCM ineligible without reference                                            | selector/surface test              |
| Both producers fail                   | fail closed                                                                              | selector/surface test              |

## 17. Test architecture for METADATA-VCM-IMPL-05

### 17.1 Unit

- Exact four-value mode parsing; invalid/empty fail to legacy.
- Authorization permits vcm_primary_compare and still refuses vcm_only.
- Primary selector: match, mismatch, projector failure, validation failure,
  comparator failure, legacy failure, telemetry failure.
- Existing comparator normalization remains identical in shadow and primary.
- Exact-set MCP validation rejects missing, extra, duplicate, unknown, and
  noncanonical definitions.
- Security ceiling and empty-overlay narrowing.
- Governed pricing versus frozen release price.
- All five digest laws, including projection digest change on semantic change.

### 17.2 A2A

- VCM match becomes the unsigned content passed to the one signer.
- Legacy and VCM remain independently constructed.
- Comparison and validation occur before sign.
- Signature verifies and published JWKS matches.
- No mutation after signing.
- Match returns exact semantic Agent Card behavior.
- Mismatch, projector error, validation error, and comparator error sign and
  serve legacy exactly once.
- Legacy failure and signing failure fail closed.
- Cache promise is assigned before await and shared by concurrent requests.
- No mixed signed variants across concurrent requests.
- Missing/malformed runtime inputs cannot advertise production or mTLS.
- Existing host/origin, protocol, request-size, JSON-RPC, executor, and
  ephemeral/configured signing tests remain green.

### 17.3 MCP

- Exactly six VCM definitions in canonical MCP_TOOL_NAMES order.
- Four v2 service bindings; canonical v1 identities do not create v1 tools.
- Existing handler record is constructed internally and the same selected
  handler reference is passed to registerTool independent of metadata mode.
- VCM has no handler-bearing type or option.
- Match registers VCM definitions once.
- Mismatch/failure registers legacy definitions once.
- Legacy failure registers nothing and fails closed.
- JSON and SSE tools/list contain identical selected semantics.
- Exact protocol version 2026-07-28 and legacy stateless compatibility.
- Malformed input, unknown method, hostile keys, request-size limit, host and
  origin behavior unchanged.
- Paid routes disabled and unauthenticated requests invoke zero providers.
- Quote handler still resolves governed pricing only when invoked.
- Health handler remains read-only.
- Definition selection cannot call any handler.

### 17.4 Cross-cutting regression

- VCM suite.
- A2A package check and edge A2A shadow/primary suites.
- MCP package check and edge MCP shadow/primary/adversarial suites.
- x402/Bazaar suite.
- edge-api full suite.
- repository typecheck and lint.
- changed-file formatting plus git diff --check.
- secret scan.
- OpenAPI/service-model/pricing drift checks.
- governance/schema/contract/release checks.
- registry structural parity and canonical economic validity.

### 17.5 Future immutable-candidate qualification

After IMPL-05 passes locally, a separately authorized checkpoint may:

1. upload an immutable 0% candidate;
2. inspect source provenance, modes, 14 secret binding names, 16 ordinary
   variables, resources, compatibility, handlers, and paid-route state;
3. keep stable traffic at 100% and candidate at 0%;
4. target the exact candidate by version override;
5. prove A2A VCM-selected content is signed and matches legacy;
6. prove MCP VCM-selected definitions produce six JSON and SSE tools and the
   existing handlers;
7. prove primary attempt, success, compare, and match telemetry for both;
8. prove mismatch/failure fallback in local adversarial tests, not by corrupting
   a live candidate;
9. recheck production non-regression and scheduled safety.

No artificial 12–24 hour organic canary is required before real production
cutover. A genuine post-cutover canary remains separately required and must use
fresh observed traffic.

## 18. Final mode decision tables

### 18.1 A2A

| Mode                | Primary producer    | Comparator         | Served output                                                   | Failure policy                                                          | Mismatch policy                     | Signing/cache boundary                                        | Telemetry                                           | Rollback                         |
| ------------------- | ------------------- | ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| legacy              | legacy card builder | none               | signed legacy                                                   | existing fail-closed signing                                            | n/a                                 | legacy unsigned -> one sign -> isolate cache                  | invalid-mode/signing logs as existing               | immutable legacy version         |
| shadow_compare      | legacy              | VCM observation    | signed legacy                                                   | shadow failures contained                                               | legacy already serves               | legacy signed/cached; unsigned compare at cache build         | existing compare/match/mismatch                     | legacy or shadow version         |
| vcm_primary_compare | VCM attempt         | independent legacy | signed VCM only after validation/match; otherwise signed legacy | fallback where legacy exists; fail closed if legacy/signing unavailable | unexplained mismatch selects legacy | select unsigned before one sign; cache only final app promise | primary lifecycle plus existing comparison/fallback | shadow_compare immutable version |
| vcm_only            | SERVABLE=NO         | none               | authorization refusal resolves legacy                           | fail-safe refusal                                                       | n/a                                 | no VCM-only signing path                                      | not-authorized                                      | legacy                           |

### 18.2 MCP

| Mode                | Primary definition producer           | Comparator                     | Served output                                                                          | Failure policy                                                                      | Mismatch policy                     | Handler boundary                                                           | Telemetry                                  | Rollback                         |
| ------------------- | ------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| legacy              | independent legacy definition builder | none                           | existing SDK response                                                                  | existing behavior                                                                   | n/a                                 | internal existing handlers registered once                                 | mode errors only                           | immutable legacy version         |
| shadow_compare      | legacy definitions                    | VCM from observed tools/list   | existing SDK response                                                                  | observer failures contained                                                         | legacy already serves               | unchanged inline/internal handlers                                         | existing JSON/SSE comparison               | legacy or shadow version         |
| vcm_primary_compare | VCM definitions                       | independent legacy definitions | SDK response from VCM definitions only after valid match; otherwise legacy definitions | fallback where legacy exists; fail closed before registration if legacy unavailable | unexplained mismatch selects legacy | VCM supplies definitions only; protocol-mcp builds and binds handlers once | primary lifecycle plus comparison/fallback | shadow_compare immutable version |
| vcm_only            | SERVABLE=NO                           | none                           | authorization refusal resolves legacy                                                  | fail-safe refusal                                                                   | n/a                                 | no VCM-only registration path                                              | not-authorized                             | legacy                           |

## 19. Authority-inversion barrier

The mandatory sequence remains:

1. import existing release evidence;
2. prove parity;
3. qualify VCM primary_compare;
4. collect real production evidence after actual cutover;
5. run an explicit authority-inversion checkpoint;
6. only then consider legacy runtime removal or vcm_only.

IMPL-05 must enforce:

```text
LEGACY_BUILDER_REMAINS_PRESENT=YES
LEGACY_COMPARATOR_REMAINS_EXECUTABLE=YES
VCM_ONLY_SERVABLE=NO
REGISTRY_RELEASE_ARTIFACTS_REMAIN_FROZEN=YES
AUTHORITY_INVERSION=NO
```

Code review must reject any change that:

- deletes or rewrites buildUnsignedSiteborneAgentCard;
- derives the legacy reference from VCM;
- lets VCM supply MCP handlers;
- authorizes vcm_only;
- makes comparison optional in vcm_primary_compare;
- serves VCM after an unexplained mismatch;
- uses registry release prices as current economics;
- signs before selection;
- registers both legacy and VCM handlers;
- changes public protocol or route behavior.

## 20. Expected smallest implementation delta

### 20.1 Expected production files

| File                                                                       | Expected narrow change                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| apps/edge-api/src/control-plane/config/metadata-projection-mode.ts         | authorize vcm_primary_compare; continue refusing vcm_only                                                  |
| apps/edge-api/src/control-plane/metadata/primary-comparison-selector.ts    | new small generic selection/fallback policy; no protocol or handler knowledge                              |
| apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts | primary lifecycle, failure-class, mode, fallback telemetry                                                 |
| apps/edge-api/src/routes/a2a.ts                                            | build both unsigned producers, validate/compare/select before one signing/cache construction               |
| packages/protocol-a2a/src/types.ts                                         | optional validated unsigned-card content input                                                             |
| packages/protocol-a2a/src/transport.ts                                     | sign supplied selected card or existing legacy default exactly once                                        |
| apps/edge-api/src/routes/mcp.ts                                            | pre-registration VCM/legacy definition selection; preserve shadow JSON/SSE observer                        |
| packages/protocol-mcp/src/types.ts                                         | metadata-definition-only option/type; no handler input                                                     |
| packages/protocol-mcp/src/server.ts                                        | extract legacy definitions and internal handler map; validate/select definitions; one register pass        |
| packages/protocol-mcp/src/index.ts                                         | export only the typed definition/current-authority APIs needed by edge/VCM                                 |
| packages/vcm/src/projections/mcp-real-context.ts                           | add typed current-authority context builder independent of served/VCM output; keep shadow response builder |
| packages/vcm/src/index.ts                                                  | export new typed context helper if required                                                                |

No change is expected in registry/services, governance, pricing, contracts,
OpenAPI, schemas, Worker configuration files, routes, cron, bindings, queues,
storage, payment execution, or service handlers.

### 20.2 Expected symbols

- resolveAuthorizedMetadataProjectionMode
- a new selectPrimaryProjection helper and closed decision types
- recordMetadataProjectionComparison plus bounded primary lifecycle helpers
- resolveA2aApp
- CreateSiteborneA2aOptions.unsignedAgentCard
- createSiteborneA2aHonoApp
- mcpRoute
- CreateSiteborneMcpOptions.toolDefinitions
- a local metadata-definition type
- buildLegacySiteborneMcpToolDefinitions
- buildSiteborneMcpDefinitionAuthorityInputs
- createSiteborneMcpServer
- buildCurrentMcpProjectionContext

Names may follow package conventions, but the dependency and authority
boundaries above are fixed.

### 20.3 Tests

One new focused unit file is justified:

- apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts

Extend existing:

- metadata-projection-mode.test.ts
- metadata-projection-telemetry.test.ts
- a2a-metadata-shadow-compare.test.ts
- a2a-metadata-shadow-adversarial.test.ts
- a2a-route.test.ts
- protocol-a2a transport.test.ts and signing tests where needed
- mcp-metadata-shadow-compare.test.ts
- mcp-metadata-shadow-adversarial.test.ts
- protocol-mcp transport.test.ts and property tests
- VCM mcp-shadow.test.ts, a2a-shadow.test.ts, effective-view, validator,
  temporal-authority, economics, and digest tests as needed

No parallel test framework is needed.

```text
CONFIG_SCHEMA_CHANGE_REQUIRED=NO
ENV_PARSER_CHANGE_REQUIRED=NO
AUTHORIZATION_GATE_CHANGE_REQUIRED=YES
TELEMETRY_CHANGE_REQUIRED=YES
NEW_PUBLIC_CONTRACT_REQUIRED=NO
```

The four-value parser already recognizes vcm_primary_compare, so it does not
change. Only the separate authorization resolver changes its allowed result; no
new variable or schema entry is required.

## 21. Ordered METADATA-VCM-IMPL-05 plan

1. Record RED tests for primary authorization, vcm_only refusal, selection
   policy, A2A sign ordering, and MCP definition/handler separation.
2. Add the primary selector with exact match/fallback/fail-closed decisions and
   no protocol dependencies.
3. Extend telemetry with closed mode/failure/reason fields; prove telemetry
   exceptions cannot change selection.
4. Authorize vcm_primary_compare only. Keep vcm_only refusal and all invalid
   input fail-safe behavior.
5. Add the protocol-a2a unsigned-content option without changing its default
   legacy behavior.
6. In resolveA2aApp, build the legacy reference and VCM projection from the same
   resolved runtime inputs; validate, compare, select, then pass one unsigned
   card to the unchanged signer.
7. Prove A2A match, mismatch, projector, validator, comparator, signer,
   telemetry, concurrency, cache, and no-post-sign-mutation behavior.
8. Extract protocol-mcp's current inline metadata into an independent pure
   legacy definition builder without changing tools/list bytes.
9. Extract the six existing handler closures into an internal exact-name map. Do
   not export it and do not add it to CreateSiteborneMcpOptions.
10. Add the metadata-definition-only option and exact-set validator. Register
    the selected definitions with the internally built handler references in one
    canonical pass.
11. Add typed current MCP projection inputs from existing authorities, including
    SDK-derived JSON schemas for utility tools. Keep the existing
    response-derived context for shadow_compare.
12. In mcpRoute, build legacy and VCM definitions before server construction,
    validate/compare/select, and construct exactly one MCP app with selected
    definitions. Keep the R3 JSON/SSE observer unchanged for shadow_compare.
13. Prove six names, v2 bindings, handler identity, definition-only VCM type,
    JSON/SSE response parity, compatibility behavior, malformed inputs, no
    provider invocation, quote economics, fallback, and fail-closed cases.
14. Run all VCM, A2A, MCP, edge, x402/Bazaar, typecheck, lint, formatting,
    secret, drift, governance, schema, registry, economics, and contract gates.
    Classify every failure.
15. Produce separate implementation and evidence commits with a clean worktree.
    Do not deploy during local implementation.
16. Stop for human authorization before any Worker upload, deployment, override
    probe, or traffic change.

## 22. Unresolved blockers and go/no-go

No architectural or authority blocker remains.

The MCP schema representation must be proven byte/semantic equivalent during
implementation because current service tools use fromJsonSchema while utility
tools use Zod directly. The SDK provides the required typed conversion path, and
exact current transport tests already expose the public result. This is a
bounded implementation proof, not a reason to invent a second schema or defer
the architecture.

The current runtime EffectiveMetadataView uses emptyOverlay and separate typed
projection contexts for measured runtime facts. That is already the qualified
shadow architecture and is safely narrow. Converting all runtime facts into a
single measured overlay is outside IMPL-05 and is not required to select content
safely.

Therefore:

```text
METADATA_VCM_08=PASS
IMPLEMENTATION_BLOCKERS=NONE
SAFE_TO_IMPLEMENT_VCM_PRIMARY_COMPARE=YES
NEXT_CHECKPOINT_RECOMMENDATION=METADATA-VCM-IMPL-05
```

This is permission to implement and test the bounded primary_compare mode in a
future checkpoint. It is not permission to upload, deploy, change traffic,
enable vcm_only, or invert metadata authority.

## 23. No-mutation attestation and final decision block

This checkpoint changes only this report. It performs no Cloudflare mutation,
upload, deployment, traffic change, secret/variable/configuration change,
runtime change, registry change, pricing change, protocol change, handler
change, signing change, or economic action.

```text
METADATA_VCM_08=PASS
STARTING_HEAD=1d290d52e68d393cdd5ad8778008d9d9d7b3d50a
STARTING_PROVENANCE=LOCAL_REMOTE_HEAD_MATCH;_REMOTE_07C_R1_PROVENANCE_PASS

CURRENT_A2A_MODE=shadow_compare
CURRENT_MCP_MODE=shadow_compare

TARGET_MODE=vcm_primary_compare
VCM_PRIMARY_SERVING_DESIGNED=YES
VCM_ONLY_SERVABLE=NO
AUTHORITY_INVERSION=NO

A2A_PRIMARY_PRODUCER=VCM_UNSIGNED_AGENT_CARD_AFTER_VALIDATION_AND_SEMANTIC_MATCH
A2A_COMPARATOR=INDEPENDENT_BUILDUNSIGNEDSITEBORNEAGENTCARD_PRE_SIGNATURE
A2A_SIGNING_BOUNDARY=ONE_FINAL_SELECTED_UNSIGNED_AGENT_CARD_ENTERING_EXISTING_IDENTITY_SIGN_AND_VERIFY
A2A_CACHE_BOUNDARY=COMPARE_AND_SELECT_INSIDE_SINGLE_ISOLATE_CACHE_PROMISE_BEFORE_SIGNING_AND_PUBLICATION
A2A_MISMATCH_POLICY=FALLBACK_TO_INDEPENDENT_LEGACY
A2A_PROJECTOR_FAILURE_POLICY=FALLBACK_TO_INDEPENDENT_LEGACY
A2A_COMPARATOR_FAILURE_POLICY=FALLBACK_TO_LEGACY_IF_BUILT;_OTHERWISE_FAIL_CLOSED

MCP_PRIMARY_DEFINITION_PRODUCER=VCM_PROJECTMCPTOOLSFROMVCM_USING_TYPED_CURRENT_AUTHORITY_CONTEXT
MCP_COMPARATOR=INDEPENDENT_LEGACY_SIX_DEFINITION_BUILDER_USING_SAME_NORMALIZED_EQUIVALENCE_LAW
MCP_HANDLER_PRODUCER=EXISTING_PROTOCOL_MCP_INTERNAL_SERVICE_QUOTE_AND_HEALTH_HANDLER_CLOSURES
MCP_HANDLER_IDENTITY_PRESERVED=YES
MCP_MISMATCH_POLICY=FALLBACK_TO_INDEPENDENT_LEGACY_DEFINITIONS
MCP_PROJECTOR_FAILURE_POLICY=FALLBACK_TO_INDEPENDENT_LEGACY_DEFINITIONS
MCP_COMPARATOR_FAILURE_POLICY=FALLBACK_TO_LEGACY_IF_BUILT;_OTHERWISE_FAIL_CLOSED

ECONOMIC_AUTHORITY_CHANGED=NO
SECURITY_AUTHORITY_CHANGED=NO
PROTOCOL_AUTHORITY_CHANGED=NO
STATEFUL_SIDE_EFFECT_DELTA=NONE
ECONOMIC_SIDE_EFFECT_DELTA=NONE

LEGACY_BUILDER_REMAINS_PRESENT=YES
LEGACY_COMPARATOR_REMAINS_EXECUTABLE=YES
ROLLBACK_TO_SHADOW_COMPARE_DESIGNED=YES

NEW_PUBLIC_CONTRACT_REQUIRED=NO
CONFIG_SCHEMA_CHANGE_REQUIRED=NO
TELEMETRY_CHANGE_REQUIRED=YES

IMPLEMENTATION_BLOCKERS=NONE
SAFE_TO_IMPLEMENT_VCM_PRIMARY_COMPARE=YES

EXPECTED_FILES_TO_CHANGE=METADATA_MODE_SELECTOR_TELEMETRY_A2A_ROUTE_AND_TRANSPORT_MCP_ROUTE_SERVER_TYPES_EXPORTS_VCM_MCP_CONTEXT_AND_SCOPED_TESTS
EXPECTED_TEST_SURFACES=UNIT_A2A_MCP_VCM_EDGE_X402_BAZAAR_TYPECHECK_LINT_FORMAT_SECRET_DRIFT_GOVERNANCE_SCHEMA_REGISTRY_ECONOMICS_CONTRACT

REPORT_PATH=docs/reports/METADATA-VCM-08-vcm-primary-compare-architecture-and-implementation-design.md
REPORT_ONLY_COMMIT=THE_GIT_COMMIT_CONTAINING_THIS_REPORT;_SHA_RETURNED_BY_CHECKPOINT
WORKING_TREE=CLEAN_AFTER_REPORT_ONLY_COMMIT
PUSH_PERFORMED=NO

NEXT_CHECKPOINT_RECOMMENDATION=METADATA-VCM-IMPL-05
```
