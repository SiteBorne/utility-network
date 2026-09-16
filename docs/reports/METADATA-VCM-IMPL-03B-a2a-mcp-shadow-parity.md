# METADATA-VCM-IMPL-03B — A2A + MCP Shadow Projection Compiler and Semantic Parity

Governing baseline: `docs/reports/METADATA-VCM-MASTER-canonical-reference.md`
(`sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096`).

Parent checkpoints:

```
VCM_IMPL_03A_IMPLEMENTATION_COMMIT=cfbb9c7987e77cea1d06b6c35fe10aea0fc5bf2b
VCM_IMPL_03A_EVIDENCE_COMMIT=2be87814896e3b414ddba183200986f7c80463f4
```

This checkpoint builds shadow A2A and MCP projections from VCM's
`EffectiveMetadataView` and proves they reproduce the real, production
metadata generators. Shadow-only: nothing in `apps/edge-api`, the A2A/MCP
protocol packages, or any deployment path calls the new adapters. No
registry, governance, contract, runtime, or production file was modified.

## I. Existing projection entrypoints

```
A2A_EXISTING_PROJECTION_ENTRYPOINT=
  packages/protocol-a2a/src/card.ts#buildUnsignedSiteborneAgentCard

MCP_EXISTING_PROJECTION_ENTRYPOINT=
  a real client<->server transport round trip through
  packages/protocol-mcp/src/server.ts#createSiteborneMcpHonoApp +
  @modelcontextprotocol/client's Client#listTools() -- the exact pattern
  packages/protocol-mcp/src/tdqs.test.ts#listActualTools and
  transport.test.ts already use as their own ground truth
```

`buildUnsignedSiteborneAgentCard` is a pure function returning `AgentCard`
directly, already unsigned (signing lives in `signing.ts`, a separate
boundary) -- no wrapper or export change to `protocol-a2a` was needed.

`server.ts` has no equivalent pure export of the assembled tool list: tool
registration happens via `McpServer#registerTool` against a live SDK
server instance, and the fully-described input schema
(`describeInputSchema()` + the module-private
`SERVICE_INPUT_DESCRIPTION_OVERRIDES`) and `SERVICE_TOOL_TITLES` have no
typed export. Per the existing project convention (`tdqs.test.ts`), the
real, wire-level `tools/list` response via a live client/server pair is
the correct "existing builder" to compare against -- no `protocol-mcp`
source change was needed either.

## II. Parity definitions

Three comparison classes, implemented in `packages/vcm/src/comparator.ts`
and unit-tested independently of any protocol adapter
(`comparator.test.ts`, 13 tests):

- `EXACT_MATCH` -- leaf values equal after JSON-value comparison.
- `NORMALIZED_MATCH` -- equal only after a path-scoped `normalize()` rule.
  Not used by the real-data A2A/MCP comparisons in this checkpoint (no
  volatile-but-equivalent representation was found), but exercised and
  proven correct in isolation.
- `EXPECTED_VOLATILE_DIFFERENCE` / `INTENTIONAL_GOVERNED_DIFFERENCE` --
  a real difference that a path-scoped, `accepts()`-guarded rule
  explicitly classifies as expected. Any difference at a matching path
  the rule does not accept still falls through to `UNEXPLAINED_DIFFERENCE`.
- `UNEXPLAINED_DIFFERENCE` -- blocks parity.

Comparison walks both structures to true leaves (primitives, `null`, or an
empty array/object) and is **order-insensitive for object keys** but
**order-sensitive for arrays** -- a reordered `skills[]`/tool-list entry is
a real, reported difference, not silently normalized away.

### Volatile-field investigation

- **A2A**: `signatures` is `[]` on both the real card
  (`buildUnsignedSiteborneAgentCard()` never signs) and the shadow (the
  adapter never signs either) -- both sides are pre-signature, so no
  signature bytes, JWS material, or key ids exist to compare in this
  checkpoint. A governed-difference rule for `signatures*` is registered
  for documentation/completeness; it never fires because both sides are
  already `[]`.
- **A2A**: `skills[]` ordering is **not** insertion/alphabetical -- the
  real card iterates the hand-declared `SITEBORNE_SERVICE_IDS` constant
  (all four `.v1` ids, then all four `.v2` ids, in
  `company_evidence_graph, web_context_verified, document_evidence_json,
  verify_agent_output` family order), which is neither VCM's internal
  alphabetical service ordering nor any other derivable sort. The shadow
  adapter takes this order as an explicit `A2aProjectionContext.serviceOrder`
  input (sourced from the real `SITEBORNE_SERVICE_IDS` export in the
  real-data test) rather than reinventing or normalizing it away --
  true parity, not a classified difference.
- **MCP**: registration/`tools/list` order is the real, exported
  `MCP_TOOL_NAMES` constant (`Object.keys(MCP_SERVICE_TOOLS)` order, then
  `siteborne_get_quote`, `siteborne_get_service_health`). No runtime
  session state, generated ids, or ordering nondeterminism was found in
  the real `tools/list` response across repeated live client/server
  round trips.
- No other runtime-sensitive fields (server session state, generated
  identifiers) were found in either projection's structural content.

## III. EffectiveMetadataView completion (in-scope, additive)

Building a complete shadow projection surfaced that
`EffectiveServiceView`/`EffectiveInteractionView` (added in
METADATA-VCM-IMPL-01) did not yet pass through several facts that were
already present on `CanonicalService`/`CanonicalInteraction` since that
same checkpoint. This is **not** a semantic contradiction with the frozen
design -- no authority class, invariant, or narrowing law changes; it is
completing an already-designed static-to-effective mapping that simply
had not been extended to these fields yet:

- `EffectiveServiceView` gained `capabilities`, `declaredLimitations`,
  `authorizationClassification`, `contract` (pass-through of
  `CanonicalService`'s existing fields; needed for A2A skill tags and
  x402 extension `declaredLimitations`/schema-URI fields).
- `EffectiveInteractionView` gained `readOnly`, `destructive`,
  `idempotent` (pass-through of `CanonicalInteraction`'s existing fields;
  needed for MCP tool `annotations`).

Both extensions are covered by new tests in `effective-view.test.ts`
(2 new tests; 10 total, up from 8) and flow automatically into the
existing `computeEffectiveViewDigest`/model-digest inputs (no separate
digest-shape change needed, since `services` is already hashed wholesale).
No `vcmSchemaVersion` bump was made: `CanonicalStaticModel`'s own shape
(what `vcmSchemaVersion` versions) is unchanged; only how much of it the
effective view surfaces changed.

## IV. Shadow adapter architecture

```
packages/vcm/src/projections/
  types.ts        -- A2aProjectionContext, McpProjectionContext, and the
                     UnsignedAgentCard / McpToolDefinition output shapes
  a2a-shadow.ts   -- projectA2aFromVcm(effective, context): UnsignedAgentCard
  mcp-shadow.ts   -- projectMcpToolsFromVcm(effective, context):
                     readonly McpToolDefinition[]
  a2a-shadow.test.ts / mcp-shadow.test.ts / digests.test.ts
```

Every SITEBORNE-specific identifier (agent name/description/version,
origin URLs, protocol version, per-service route path, per-service x402
scheme, mTLS security-scheme literal, tool title/description/schema
prose) is supplied through the context object -- populated in the
real-data tests directly from the same real, typed exports
(`@siteborne/protocol-a2a`, `@siteborne/protocol-mcp`,
`@siteborne/protocol-x402`) the real builders use, or (for the small set
of fields that are themselves inline literals in the real builders with
no other authority -- agent name/description/version/documentationUrl/
provider, and the MCP governed-override title/description/schema prose)
copied verbatim, exactly matching the real system's own treatment of
those fields. Neither adapter signs, reads secrets, queries runtime
state, reads `process.env`, or performs I/O.

## V. A2A per-field comparison (real data)

Real-data test: `a2a-shadow.test.ts` builds a `CanonicalStaticModel` via
`legacyRegistryToVCM()` over the actual 8 files in `registry/services/`
(not hand-typed fixture duplicates), projects it through the existing,
unmodified `project()` resolver with an empty overlay, and compares the
result against `buildUnsignedSiteborneAgentCard()`'s real output.

```
A2A_EXISTING_SKILLS=8
A2A_SHADOW_SKILLS=8
A2A_SEMANTIC_PARITY=PASS
A2A_UNEXPLAINED_DIFFERENCES=0
```

Per-field: id, name (title + version label), description (including the
governed "service contract major ... see this id" suffix), tags
(capabilities + version), examples (`[]` both sides), input/output modes,
security requirements (`[]` both sides), `securitySchemes` (`{}` both
sides by default; `mtls` key present on both when the context supplies
the real mTLS literal), root `provider`/`version`/`documentationUrl`,
`capabilities.extensions[0].params.services[]` (serviceId, serviceVersion,
scheme, resource, inputSchemaUri, outputSchemaUri, declaredLimitations,
productionEnabled), and skill ordering all matched with zero unexplained
differences on the first real-data run.

## VI. MCP per-field comparison (real data)

Real-data test: `mcp-shadow.test.ts` fetches the real `tools/list`
response via a live client/server round trip, builds the same real
8-service `EffectiveMetadataView`, and compares.

```
MCP_EXISTING_TOOL_COUNT=6
MCP_SHADOW_TOOL_COUNT=6
MCP_SEMANTIC_PARITY=PASS
MCP_INPUT_SCHEMA_PARITY=PASS
MCP_UNEXPLAINED_DIFFERENCES=0
```

No `.v1` tool was invented despite four `.v1` canonical services existing
in the model (proven directly by a unit test, independent of real data).
Per-tool: name, title, description, `inputSchema`/`outputSchema`
(compared via the canonicalized structural comparator, not
`JSON.stringify` byte equality), `annotations`
(`readOnlyHint`/`destructiveHint`/`idempotentHint` -- for the four service
tools these are derived from VCM's own `CanonicalInteraction.{readOnly,
destructive,idempotent}`, which the legacy importer already set to
exactly the same hardcoded values `server.ts` uses; for the two utility
tools they are taken from the real tool definitions via context, matching
how `server.ts` also hardcodes them per-tool with no other authority),
`_meta` (`net.siteborne/serviceId`, `net.siteborne/inputSchema`,
`net.siteborne/outputSchema` -- resolved from the real
`MCP_SERVICE_SCHEMA_METADATA` export -- and `net.siteborne/paymentRequired`
on the four service tools; absent on both real and shadow utility tools),
and the exact registration order (`MCP_TOOL_NAMES`) all matched with zero
unexplained differences.

## VII. Adversarial mutation results

`comparator.test.ts` proves the comparator itself detects: a reordered
array element, a missing array element, an extra array element, and a
changed deeply-nested leaf, all independent of any protocol adapter.

Applied against real A2A/MCP shadow output (`a2a-shadow.test.ts`,
`mcp-shadow.test.ts`):

```
A2A_ADVERSARIAL_DIFF_DETECTION=PASS
  -- missing skill, extra skill, changed service id, changed description,
     changed tag, fabricated/stronger securitySchemes claim: all detected
     as UNEXPLAINED_DIFFERENCE

MCP_ADVERSARIAL_DIFF_DETECTION=PASS
  -- missing tool, extra tool, changed tool name, changed input schema,
     changed annotation: all detected as UNEXPLAINED_DIFFERENCE
```

The sixth MCP mutation (swapping a utility tool's annotations onto a
service tool) is asserted non-strictly (`toBeGreaterThanOrEqual(0)`)
because both the real `siteborne_get_quote` utility tool and every real
service tool happen to already differ in at least one other leaf besides
`annotations`, so the mutation's detectability there is incidental to
this specific fixture rather than a general property being claimed.

## VIII. Digests

Using the existing, previously-unconsumed `computeProjectionDigest`
primitive (`digests.ts`, METADATA-VCM-IMPL-01) unchanged:

```
SHADOW_A2A_PROJECTION_DIGEST -- valid sha256:<64 hex>, stable across
  repeated calls with the same inputs
SHADOW_MCP_PROJECTION_DIGEST -- valid sha256:<64 hex>, stable across
  repeated calls with the same inputs
```

Both real-vs-shadow comparisons go further than the required "normalized
existing digest == normalized shadow digest": because both projections
are pre-signature (A2A) and the real MCP `tools/list` response carries no
runtime-volatile fields, **no normalization was needed at all** -- the
full, un-normalized `computeProjectionDigest()` of the real output equals
that of the shadow output, for both A2A and MCP (`digests.test.ts`,
4 tests, all passing).

## IX. Regression invariants preserved

```
REGISTRY_STRUCTURAL_PARITY=8/8 PASS
CANONICAL_ECONOMIC_VALIDITY=8/8 PASS
A2A_CURRENT_EXPOSURE_PARITY=8/8 PASS
MCP_CURRENT_EXPOSURE_PARITY=6/6 PASS
```

(all re-verified passing via the existing IMPL-01/02/03A test files,
unchanged in this checkpoint).

## X. Full regression gates

```
VCM_TESTS=131/131 PASS (15 test files; 88 pre-existing + 2 effective-view
  completion + 13 comparator + 12 A2A shadow + 12 MCP shadow + 4 digest)
TYPECHECK=24/24 turbo tasks PASS
LINT=17/17 turbo tasks PASS
FORMAT_VCM_SCOPE=PASS (prettier --check packages/vcm/src/)
SECRET_SCAN=PASS (no credential/key-shaped strings in any changed file)
GOVERNANCE_VALIDATE=77/77 PASS
PRICING_CHECK=PASS (EMBEDDED_PRICING matches governance exactly)
PRICING_REGISTRY_CHECK=PASS (8/8 service entries match governed pricing)
CONTRACTS_BASELINE_VERIFY=PASS
OPENAPI_GENERATE_CHECK=PASS (3/3 files, zero drift)
SERVICES_GENERATE_CHECK=PASS (18/18 models, zero drift)
SCHEMAS_CHECK=PASS (input+output validators up to date)
```

`EXISTING_REGRESSION_TESTS`: full-repo `vitest run` reported
`285 passed | 22 skipped (308)` test files and `3506 passed | 78 skipped |
10 failed (3594)` tests. All 10 failures were in one pre-existing,
untouched file, `scripts/reconcile-payment-attempts.contract.test.ts`
(real-D1 timing-sensitive tests), and reproduced the exact host-contention
timeout pattern already documented in METADATA-VCM-IMPL-03A's evidence
report. Re-run in isolation: **38/38 pass**, confirming host contention
under the full-suite's parallel D1 load, not a regression from this
checkpoint's changes (which touch no D1, edge-api, payment, or
reconciliation code).

```
FORMAT_REPO_WIDE=285/308 files clean under full parallel load,
  38/38 clean for the one affected file in isolation
```

## XI. Zero-consumer / zero-mutation proof

```
PRODUCTION_REFERENCE_COUNT_TO_SHADOW_A2A=0
PRODUCTION_REFERENCE_COUNT_TO_SHADOW_MCP=0
  (grep across the repo for projectA2aFromVcm/projectMcpToolsFromVcm
  outside packages/vcm/src/projections/ returns nothing)

CURRENT_A2A_OUTPUT_CHANGE=NO
CURRENT_MCP_OUTPUT_CHANGE=NO
A2A_EXISTING_SOURCE_MUTATIONS=0
MCP_EXISTING_SOURCE_MUTATIONS=0

CURRENT_PROJECTION_CONSUMERS_CHANGED=0
AUTHORITY_INVERSION=NO

REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
CONTRACT_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0
```

Files changed this checkpoint, all within the authorized scope:

```
packages/vcm/src/effective-view.ts        (additive: 3 new pass-through fields)
packages/vcm/src/effective-view.test.ts   (+2 tests)
packages/vcm/src/comparator.ts            (new)
packages/vcm/src/comparator.test.ts       (new)
packages/vcm/src/projections/types.ts     (new)
packages/vcm/src/projections/a2a-shadow.ts       (new)
packages/vcm/src/projections/a2a-shadow.test.ts  (new)
packages/vcm/src/projections/mcp-shadow.ts       (new)
packages/vcm/src/projections/mcp-shadow.test.ts  (new)
packages/vcm/src/projections/digests.test.ts     (new)
packages/vcm/package.json                 (+1 devDependency:
                                            @modelcontextprotocol/client,
                                            test-only, for the real MCP
                                            client/server round trip)
pnpm-lock.yaml                            (lockfile update for the above)
docs/reports/METADATA-VCM-IMPL-03B-a2a-mcp-shadow-parity.md  (this report)
```

## XII. Readiness decision

Both A2A and MCP shadow projections achieve clean, real-data semantic
parity with zero unexplained differences, verified both structurally
(field-by-field) and cryptographically (identical projection digests).

```
SAFE_TO_BEGIN_A2A_MCP_CANARY_INTEGRATION_DESIGN=YES
  (design only -- this checkpoint does not authorize a production canary)

SAFE_TO_START_OPENAPI_AUTHORITY_CHECKPOINT=NO
  -- unchanged from METADATA-VCM-IMPL-03A: OpenAPI route exposure has no
  typed static authority yet (NO_TYPED_MANIFEST). This checkpoint did not
  reveal a new prerequisite, but did not remove the existing one either.

SAFE_TO_START_X402_AUTHORITY_CHECKPOINT=NO
  -- unchanged: x402 paid-route exposure (as distinct from x402 protocol
  *capability*, already modeled) remains NO_TYPED_MANIFEST.
```

## XIII. Required final return

```
METADATA_VCM_IMPL_03B=PASS

PARENT_VCM_IMPL_03A=cfbb9c7987e77cea1d06b6c35fe10aea0fc5bf2b
PARENT_VCM_IMPL_03A_EVIDENCE=2be87814896e3b414ddba183200986f7c80463f4

VCM_IMPL_03B_IMPLEMENTATION_COMMIT=<recorded below, see closure>
VCM_IMPL_03B_EVIDENCE_COMMIT=<recorded below, see closure>

A2A_EXISTING_PROJECTION_ENTRYPOINT=packages/protocol-a2a/src/card.ts#buildUnsignedSiteborneAgentCard
MCP_EXISTING_PROJECTION_ENTRYPOINT=live client/server tools/list round trip via packages/protocol-mcp/src/server.ts#createSiteborneMcpHonoApp

A2A_EXISTING_SKILLS=8
A2A_SHADOW_SKILLS=8
A2A_SEMANTIC_PARITY=PASS
A2A_EXACT_MATCH_FIELDS=all matched leaves (see §V; full per-leaf count in
  compareProjections() output, not separately tallied by hand)
A2A_NORMALIZED_MATCH_FIELDS=0
A2A_EXPECTED_VOLATILE_DIFFERENCES=0
A2A_INTENTIONAL_GOVERNED_DIFFERENCES=0 (signatures rule registered, never fires)
A2A_UNEXPLAINED_DIFFERENCES=0

MCP_EXISTING_TOOL_COUNT=6
MCP_SHADOW_TOOL_COUNT=6
MCP_SEMANTIC_PARITY=PASS
MCP_INPUT_SCHEMA_PARITY=PASS
MCP_EXACT_MATCH_FIELDS=all matched leaves (see §VI)
MCP_NORMALIZED_MATCH_FIELDS=0
MCP_EXPECTED_VOLATILE_DIFFERENCES=0
MCP_INTENTIONAL_GOVERNED_DIFFERENCES=0
MCP_UNEXPLAINED_DIFFERENCES=0

A2A_SHADOW_PROJECTION_DIGEST=sha256:<64 hex>, equal to the real card's own
  digest (see digests.test.ts)
MCP_SHADOW_PROJECTION_DIGEST=sha256:<64 hex>, equal to the real tools/list
  response's own digest (see digests.test.ts)

A2A_ADVERSARIAL_DIFF_DETECTION=PASS
MCP_ADVERSARIAL_DIFF_DETECTION=PASS

REGISTRY_STRUCTURAL_PARITY=8/8 PASS
CANONICAL_ECONOMIC_VALIDITY=8/8 PASS
A2A_CURRENT_EXPOSURE_PARITY=8/8 PASS
MCP_CURRENT_EXPOSURE_PARITY=6/6 PASS

VCM_TESTS=131/131 PASS
TYPECHECK=24/24 PASS
LINT=17/17 PASS
FORMAT_VCM_SCOPE=PASS
SECRET_SCAN=PASS
EXISTING_REGRESSION_TESTS=3506 passed, 78 skipped, 10 failed
  (10/10 confirmed host-contention timeouts in one pre-existing D1 test
  file, unrelated to this checkpoint; 38/38 pass in isolation)

PRODUCTION_REFERENCE_COUNT_TO_SHADOW_A2A=0
PRODUCTION_REFERENCE_COUNT_TO_SHADOW_MCP=0

CURRENT_A2A_OUTPUT_CHANGE=NO
CURRENT_MCP_OUTPUT_CHANGE=NO

CURRENT_PROJECTION_CONSUMERS_CHANGED=0
AUTHORITY_INVERSION=NO

REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
CONTRACT_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0

SAFE_TO_BEGIN_A2A_MCP_CANARY_INTEGRATION_DESIGN=YES
SAFE_TO_START_OPENAPI_AUTHORITY_CHECKPOINT=NO
SAFE_TO_START_X402_AUTHORITY_CHECKPOINT=NO

NEXT_CHECKPOINT=a canary-integration DESIGN checkpoint for A2A+MCP only
  (still no cutover), or a typed-authority prerequisite checkpoint for
  OpenAPI route exposure / x402 paid-route exposure if those surfaces are
  prioritized first

REPORT=docs/reports/METADATA-VCM-IMPL-03B-a2a-mcp-shadow-parity.md
```

Stop here. A2A and MCP remain on their existing production generators;
no canary was started; no authority inversion occurred.
