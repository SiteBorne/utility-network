# METADATA-VCM-IMPL-05 vcm_primary_compare Implementation Plan

Goal:

Implement the reversible VCM-primary / legacy-reference qualification mode for
A2A and MCP without authority inversion or execution-authority changes.

Architecture:

Use the already-approved independent VCM and legacy producers. Select VCM only
after successful validation and normalized semantic equality; otherwise safely
use the independent legacy result where permitted. Preserve A2A signing after
selection and preserve all existing MCP executable handlers.

Spec:

`docs/reports/METADATA-VCM-08-vcm-primary-compare-architecture-and-implementation-design.md`

> For agentic workers: REQUIRED SKILL: Use superpowers:executing-plans to
> execute this plan task by task.

**Tech stack:** TypeScript 5.5, Vitest 3.2.7, Hono, `@a2a-js/sdk@1.0.1`,
`@modelcontextprotocol/server@2.0.0`, Zod 4 in `@siteborne/protocol-mcp`, pnpm
9, and Turborepo 2.

## 1. Frozen starting point and constraints

- Repository: `/Users/meta4ickal/SITEBORNE Utility Network`
- Branch: `metadata-vcm-qualification`
- Planning baseline: `620ab84dcce95f0d126ad3f02b08ca590c4e810d`
- Local and `origin/metadata-vcm-qualification` both resolve to that commit.
- `METADATA_VCM_08=PASS`.
- Production stays in `shadow_compare` for A2A and MCP throughout the
  implementation checkpoint.
- The deployed stable/candidate split stays `100% / 0%`.
- `vcm_only` remains unservable.
- No registry, governance, pricing, contract, OpenAPI, schema, Worker
  configuration, route, payment, authentication, signing-key, scheduled-job,
  queue, D1, R2, KV, workflow, service-binding, protocol-version, upload,
  deployment, or traffic change is part of the implementation.
- The only digest classes remain model, service, runtime-overlay,
  effective-view, and projection digests.
- The canonical MCP version remains `2026-07-28`.
- `PAID_ROUTES_ENABLED` remains false for local and any later candidate
  qualification.

The source audit found no contradiction with METADATA-VCM-08. The plan therefore
implements that architecture without reopening its decisions.

## 2. Source-grounded architecture audit

### 2.1 Required call chains

**Mode gate**

```text
Env.A2A_METADATA_PROJECTION_MODE or Env.MCP_METADATA_PROJECTION_MODE
  -> parseMetadataProjectionMode
  -> resolveAuthorizedMetadataProjectionMode
  -> the surface route
```

The parser already recognizes all four values. Only the authorization resolver
refuses `vcm_primary_compare`.

**A2A**

```text
apps/edge-api/src/index.ts
  -> a2aRoute
  -> resolveA2aApp
  -> runtime production/mTLS resolvers
  -> one synchronously assigned cache promise
  -> resolveAgentCardSigningIdentity
  -> createSiteborneA2aHonoApp
  -> identity.sign
  -> identity.verify
  -> GET Agent Card and POST A2A publication
```

The independent legacy unsigned producer is `buildUnsignedSiteborneAgentCard`.
The VCM producer is `projectA2aFromVcm` with `buildRealA2aShadowContext`. Today,
`createSiteborneA2aHonoApp` always builds the legacy unsigned card internally.

**MCP**

```text
apps/edge-api/src/index.ts
  -> mcpRoute
  -> bounded-body and runtime-status resolution
  -> createMcpX402ServiceBoundary and optional quote configuration
  -> mode authorization
  -> createSiteborneMcpHonoApp
  -> createSiteborneMcpHandler
  -> per-request createSiteborneMcpServer
  -> six registerTool calls
  -> official JSON/SSE transport
```

Current shadow comparison happens after the real response only for `tools/list`,
using `extractToolsListFromResponse`, `buildRealMcpShadowContext`, and
`runShadowComparison`. Primary selection must happen before server construction
and must leave that shadow observer unchanged.

### 2.2 Planned production-file edits

| File                                                                         | Exact current symbols and responsibility                                                              | Callers and downstream consumers                          | Existing coverage                                    | Minimal planned change                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/edge-api/src/control-plane/config/metadata-projection-mode.ts`         | `METADATA_PROJECTION_MODES`, `parseMetadataProjectionMode`, `resolveAuthorizedMetadataProjectionMode` | A2A and MCP routes                                        | co-located mode test; both shadow integration suites | Widen the authorized return union and pass through `vcm_primary_compare`; continue refusing `vcm_only`.                                                                               |
| `apps/edge-api/src/control-plane/metadata/primary-comparison-selector.ts`    | New file                                                                                              | A2A cache construction and MCP pre-registration selection | new co-located unit test                             | Add the generic, protocol-free build/validate/compare/select policy.                                                                                                                  |
| `apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts` | `recordMetadataProjectionComparison`, private `safeLog`                                               | shadow runner; new primary selector; A2A signing boundary | co-located telemetry and shadow-runner tests         | Add closed primary lifecycle events and optional comparison mode/reason fields without adding payloads or a new sink.                                                                 |
| `packages/protocol-a2a/src/types.ts`                                         | `CreateSiteborneA2aOptions`                                                                           | protocol transport and edge A2A route                     | protocol transport/typecheck                         | Add only `unsignedAgentCard?: AgentCard`.                                                                                                                                             |
| `packages/protocol-a2a/src/transport.ts`                                     | `createSiteborneA2aHonoApp`                                                                           | edge route and protocol tests                             | transport, signing, card, property tests             | Select supplied unsigned content or the current legacy builder, reject a non-empty signature set, then run the existing one-sign/one-verify path.                                     |
| `apps/edge-api/src/routes/a2a.ts`                                            | `scheduleA2aShadowComparison`, cache variables, `resolveA2aApp`, `a2aRoute`                           | edge router; public Agent Card, JWKS, and A2A POST        | A2A shadow, adversarial, route, discovery tests      | Add primary build/validation/selection inside the existing single cache promise before one signer call; retain legacy and shadow branches.                                            |
| `packages/protocol-mcp/src/types.ts`                                         | `CreateSiteborneMcpOptions` and existing execution/quote/health types                                 | protocol server and edge route                            | protocol transport/typecheck                         | Add definition-only and authority-input types plus `toolDefinitions?`; expose no handler-bearing option.                                                                              |
| `packages/protocol-mcp/src/server.ts`                                        | schemas, title/description helpers, `createSiteborneMcpServer`, six handler closures                  | Hono handler, stdio package, edge route                   | transport, property, TDQS, fixture/spec tests        | Extract typed leaf inputs, pure legacy definitions, exact-set validation, and internal handler records; register one selected definition and one existing handler per canonical name. |
| `packages/vcm/src/projections/mcp-real-context.ts`                           | `buildRealMcpShadowContext`                                                                           | shadow route and VCM tests                                | `mcp-shadow.test.ts`                                 | Keep response-derived shadow context and add `buildCurrentMcpProjectionContext` over typed protocol authority inputs.                                                                 |
| `packages/vcm/src/index.ts`                                                  | explicit projection-context exports                                                                   | edge route and tests                                      | VCM build/typecheck                                  | Export the new current context helper.                                                                                                                                                |
| `apps/edge-api/src/routes/mcp.ts`                                            | JSON/SSE extractor, `scheduleMcpShadowComparison`, `mcpRoute`                                         | edge router and official SDK transport                    | MCP shadow, adversarial, route, payment tests        | Add pre-registration primary selection and pass definitions into one MCP app; leave request handling and the R3 observer intact.                                                      |

`packages/protocol-a2a/src/index.ts` and `packages/protocol-mcp/src/index.ts`
require no edit: both already use `export *` for the affected modules. No
configuration file requires a change.

### 2.3 Exact audit coverage for requested boundaries

| Audit item                       | Resolved symbol/path                                                     | Plan task               |
| -------------------------------- | ------------------------------------------------------------------------ | ----------------------- |
| A. projection-mode authorization | `resolveAuthorizedMetadataProjectionMode`                                | 1                       |
| B. mode parsing                  | `parseMetadataProjectionMode`                                            | 1 regression only       |
| C. structural refusal            | authorization resolver’s refusal branch                                  | 1                       |
| D. shadow runner                 | `runShadowComparison`                                                    | 2 and 8 regression only |
| E. telemetry                     | `recordMetadataProjectionComparison` / `safeLog`                         | 2                       |
| F. A2A legacy builder            | `buildUnsignedSiteborneAgentCard`                                        | 3–4                     |
| G. VCM A2A projector             | `projectA2aFromVcm`                                                      | 4                       |
| H. effective view                | `getRuntimeEffectiveView`                                                | 4, 6, 7                 |
| I. signing/verification          | `SiteborneA2aSigningIdentity.sign/verify` in `createSiteborneA2aHonoApp` | 3–4                     |
| J. A2A cache                     | `cachedA2aAppPromise`, cache key, async IIFE                             | 4                       |
| K. A2A publication               | captured `signedCard` in GET and POST routes                             | 3–4                     |
| L. legacy MCP definitions        | inline objects in `createSiteborneMcpServer`                             | 5                       |
| M. VCM MCP projection            | `projectMcpToolsFromVcm`                                                 | 6–7                     |
| N. current authority context     | new builder beside `buildRealMcpShadowContext`                           | 5–6                     |
| O. `registerTool` call sites     | service loop, quote registration, health registration                    | 5                       |
| P. handler closures              | service boundary, `buildCanonicalQuote`, health closures                 | 5                       |
| Q. JSON tools/list               | official SDK plus R3 JSON extractor branch                               | 5, 7, 8                 |
| R. SSE tools/list                | official SDK plus R3 SSE extractor branch                                | 5, 7, 8                 |
| S. normalization/equality        | `compareProjections`, `summarizeDifferences`                             | 2                       |
| T. refusal tests                 | mode and surface shadow suites                                           | 1, 4, 7                 |
| U. economic tests                | protocol MCP quote tests; VCM economic and registry tests                | 5, 8                    |
| V. schema/governance tests       | VCM validators plus repository drift/contract commands                   | 8                       |

## 3. Exact interfaces to introduce

### 3.1 Authorized mode

`resolveAuthorizedMetadataProjectionMode` returns:

```ts
'legacy' | 'shadow_compare' | 'vcm_primary_compare';
```

The parser stays four-valued. `vcm_only` remains a recognized but refused value.

### 3.2 Generic primary selector

Create these closed contracts in `primary-comparison-selector.ts`:

```ts
export type PrimaryProjectionSurface = 'a2a' | 'mcp';

export type PrimarySelectionReason =
  | 'semantic_match'
  | 'semantic_mismatch'
  | 'primary_projection_failure'
  | 'primary_validation_failure'
  | 'comparison_failure';

export type PrimarySelectionResult<T> =
  | {
      readonly selectedProducer: 'vcm';
      readonly selected: T;
      readonly primary: T;
      readonly legacy: T;
      readonly reason: 'semantic_match';
      readonly differenceSummary: DifferenceSummary;
    }
  | {
      readonly selectedProducer: 'legacy';
      readonly selected: T;
      readonly primary?: T;
      readonly legacy: T;
      readonly reason: Exclude<PrimarySelectionReason, 'semantic_match'>;
      readonly differenceSummary?: DifferenceSummary;
    };

export interface SelectPrimaryProjectionParams<T> {
  readonly surface: PrimaryProjectionSurface;
  readonly buildLegacy: () => T | Promise<T>;
  readonly buildPrimary: () => T | Promise<T>;
  readonly validatePrimary: (candidate: T) => void | Promise<void>;
  readonly governedDifferences?: ComparatorConfig['governedDifferences'];
}

export function selectPrimaryProjection<T>(
  params: SelectPrimaryProjectionParams<T>
): Promise<PrimarySelectionResult<T>>;
```

Required order:

1. Emit a safe legacy-reference attempt and build the independent legacy value.
2. If legacy construction fails, emit only bounded failure telemetry and
   rethrow. Never build or serve unqualified VCM output.
3. Emit a primary attempt, build primary, and validate primary.
4. Projector or validation failure returns the already-built legacy object.
5. Compare `legacy` as expected and `primary` as actual with the existing
   comparator.
6. Any unexplained difference returns the whole legacy object.
7. A comparator exception returns the whole legacy object.
8. A clean semantic match returns the whole primary object.
9. Telemetry calls are enclosed so their failure cannot change steps 2–8.

No branch spreads, merges, patches, or copies properties across producers.

### 3.3 Primary telemetry

Add a closed
`MetadataProjectionTelemetryMode = 'shadow_compare' | 'vcm_primary_compare'` and
closed failure/reason unions limited to:

- `projector`
- `validation`
- `mismatch`
- `comparator`
- `legacy_reference`
- `both_producers`
- `signing`
- `handler_construction`

Keep `recordMetadataProjectionComparison`; permit it to receive
`mode?: MetadataProjectionTelemetryMode` and `fallbackReason?` so existing
shadow call sites remain source-compatible while primary events include
`mode=vcm_primary_compare`.

Add one bounded `recordMetadataProjectionLifecycle` entry point whose event
union contains exactly:

- `metadata_projection_primary_attempt_total`
- `metadata_projection_primary_success_total`
- `metadata_projection_primary_failure_total`
- `metadata_projection_legacy_reference_attempt_total`
- `metadata_projection_comparator_failure_total`
- `metadata_projection_validation_failure_total`
- `metadata_projection_fallback_total`
- `metadata_projection_signing_failure_total`

The existing comparison helper continues emitting compare, match, and mismatch.
Fields are limited to `surface`, `mode`, a closed `failureClass` or `reason`,
`domain`, and bounded counts. No request, card, tool, signature, key,
authorization, client, address, IP, TLS, or raw error value enters telemetry.

### 3.4 A2A transport seam and validator

Add `unsignedAgentCard?: AgentCard` to `CreateSiteborneA2aOptions`. The
transport:

- uses that value when supplied;
- calls `buildUnsignedSiteborneAgentCard` only when it is absent;
- rejects supplied content whose `signatures` array is non-empty;
- calls the existing selected `SiteborneA2aSigningIdentity.sign` once;
- calls `verify` once;
- publishes only the verified result.

Add a private `validateVcmUnsignedAgentCard` in `routes/a2a.ts`. It must:

- round-trip with `AgentCard.toJSON` and `AgentCard.fromJSON`;
- require an empty signatures array;
- require one unique canonical skill ID per current SITEBORNE service;
- require the existing A2A JSON-RPC interface and protocol version;
- reject an unsupported security/capability widening;
- return nothing and throw a bounded validation error on failure.

Semantic equality still comes from the shared VCM comparator, not this
structural validator.

### 3.5 MCP definition and authority types

Add definition-only types in `packages/protocol-mcp/src/types.ts`:

```ts
export interface SiteborneMcpToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaType;
  readonly outputSchema: JsonSchemaType;
  readonly annotations: ToolAnnotations;
  readonly _meta?: Readonly<Record<string, unknown>>;
}

export interface SiteborneMcpServiceDefinitionAuthorityInput
  extends SiteborneMcpToolDefinition {
  readonly name: keyof typeof MCP_SERVICE_TOOLS;
  readonly serviceId: SiteborneServiceId;
  readonly inputSchemaUri: string;
  readonly outputSchemaUri: string;
}

export interface SiteborneMcpUtilityDefinitionAuthorityInput
  extends SiteborneMcpToolDefinition {
  readonly name: 'siteborne_get_quote' | 'siteborne_get_service_health';
}

export interface SiteborneMcpDefinitionAuthorityInputs {
  readonly toolOrder: readonly SiteborneMcpToolName[];
  readonly serviceTools: readonly SiteborneMcpServiceDefinitionAuthorityInput[];
  readonly utilityTools: readonly SiteborneMcpUtilityDefinitionAuthorityInput[];
}
```

Use SDK-exported `JsonSchemaType` and `ToolAnnotations`; use the existing
`SiteborneMcpToolName`, `SiteborneServiceId`, and `MCP_SERVICE_TOOLS`
authorities. `CreateSiteborneMcpOptions` gains only:

```ts
readonly toolDefinitions?: readonly SiteborneMcpToolDefinition[];
```

No handler, callback map, register hook, payment function, quote replacement,
health replacement, or VCM executable type is added.

Add these functions to `server.ts`:

- `buildSiteborneMcpDefinitionAuthorityInputs(options)`
- `buildLegacySiteborneMcpToolDefinitions(options)`
- `assertValidSiteborneMcpToolDefinitions(definitions)`
- private `buildSiteborneMcpHandlers(options)`

Utility wire schemas are derived from the current Zod schemas through their
public Standard JSON Schema converter using target `draft-2020-12`:
`schema['~standard'].jsonSchema.input(...)` for input and `.output(...)` for
output. Service schemas continue using frozen-contract JSON. Registration wraps
selected wire schemas with `fromJsonSchema`; it does not hand-author utility
schema JSON.

The private handler record is keyed by `SiteborneMcpToolName` and uses SDK
`AnyToolHandler` / `StandardSchemaWithJSON` types. Keep the four service
closures, quote closure, and health closure inside `protocol-mcp`. Iterate
`MCP_TOOL_NAMES` once; for each name obtain one selected definition and its
internal handler and call `registerTool` once. A name-directed internal switch
may retain each input generic while the external option remains metadata-only.

`assertValidSiteborneMcpToolDefinitions` throws before registration for missing,
extra, duplicate, unknown, noncanonical, schemaless, or non-six-element input.
It never repairs an invalid array.

### 3.6 MCP current-authority context

Add:

```ts
export function buildCurrentMcpProjectionContext(
  authority: SiteborneMcpDefinitionAuthorityInputs
): McpProjectionContext;
```

It maps typed leaf authorities to the existing projection context. It must not
accept a served response or a final legacy definition array. Keep
`buildRealMcpShadowContext(realTools)` for `shadow_compare`.

## 4. Task 1 — Authorize only vcm_primary_compare

**Files**

- Modify: `apps/edge-api/src/control-plane/config/metadata-projection-mode.ts`
- Modify:
  `apps/edge-api/src/control-plane/config/metadata-projection-mode.test.ts`
- Create: none
- Test:
  `apps/edge-api/src/control-plane/config/metadata-projection-mode.test.ts`

**Interfaces**

- Consume: `MetadataProjectionMode`, `MetadataProjectionSurface`
- Change: `resolveAuthorizedMetadataProjectionMode`
- Produce: `'legacy' | 'shadow_compare' | 'vcm_primary_compare'`
- Callers: `resolveA2aApp`, `mcpRoute`

**RED**

Add exact table-driven tests:

- `authorizes legacy independently for a2a and mcp`
- `authorizes shadow_compare independently for a2a and mcp`
- `authorizes vcm_primary_compare independently for a2a and mcp`
- `refuses vcm_only to legacy independently for a2a and mcp`
- `invalid raw values still parse to legacy for both surfaces`
- `missing values still parse to legacy for both surfaces`

Run:

```bash
pnpm exec vitest run apps/edge-api/src/control-plane/config/metadata-projection-mode.test.ts
```

Expected RED: the primary authorization assertions receive `legacy` and the
resolver’s return type excludes `vcm_primary_compare`.

**GREEN**

- Pass through `legacy`, `shadow_compare`, and `vcm_primary_compare`.
- Refuse only `vcm_only` with the existing bounded structured event and an
  IMPL-05 reason.
- Update comments that currently say both future modes are refused.
- Do not change `METADATA_PROJECTION_MODES` or parser behavior.

Run the same focused command and require PASS.

**REFACTOR**

Remove duplicate assertions only if the table preserves both surfaces and all
six cases. Rerun the focused command.

**REGRESSION**

```bash
pnpm exec vitest run apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts
```

At this slice, surface primary behavior is not yet connected; these tests must
still prove legacy, shadow, and `vcm_only` behavior.

**COMMIT**

```bash
git add apps/edge-api/src/control-plane/config/metadata-projection-mode.ts apps/edge-api/src/control-plane/config/metadata-projection-mode.test.ts
git commit -m "METADATA-VCM-IMPL-05: authorize primary compare mode"
```

## 5. Task 2 — Add the primary selector and bounded lifecycle telemetry

**Files**

- Create:
  `apps/edge-api/src/control-plane/metadata/primary-comparison-selector.ts`
- Create:
  `apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts`
- Modify:
  `apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts`
- Modify:
  `apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.test.ts`
- Test: both co-located test files plus `shadow-comparison-runner.test.ts`

**Interfaces**

- Consume: `compareProjections`, `summarizeDifferences`, `ComparatorConfig`,
  `DifferenceSummary`
- Produce: `selectPrimaryProjection`, `PrimarySelectionResult`, closed telemetry
  types, `recordMetadataProjectionLifecycle`
- Callers: future A2A and MCP route tasks
- Preserve: `runShadowComparison(): Promise<void>`

**RED**

Write tests named:

- `selects the complete VCM object on validated semantic match`
- `selects the complete legacy object on semantic mismatch`
- `selects legacy when the primary projector throws`
- `selects legacy when primary validation throws`
- `fails closed when the legacy builder throws before a usable reference exists`
- `fails closed when both producer closures throw`
- `selects legacy when the shared comparator throws`
- `does not mix fields from the two producer objects`
- `keeps the safe selection when lifecycle telemetry throws`
- `emits the closed primary lifecycle and mode fields without payload content`

Run:

```bash
pnpm exec vitest run apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.test.ts
```

Expected RED: the new selector module and lifecycle helper do not exist.

**GREEN**

Implement the interfaces and exact sequencing from section 3. Do not catch a
missing legacy reference into a VCM success. Do not add protocol imports to the
selector. Make telemetry best-effort at both helper and caller boundaries.

Run the focused command and require PASS.

**REFACTOR**

Keep selection branches explicit and retain object identity assertions. Do not
replace them with a generic deep merge. Rerun the focused command.

**REGRESSION**

```bash
pnpm exec vitest run apps/edge-api/src/control-plane/metadata/shadow-comparison-runner.test.ts apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.test.ts apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts
```

**COMMIT**

```bash
git add apps/edge-api/src/control-plane/metadata/primary-comparison-selector.ts apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.test.ts
git commit -m "METADATA-VCM-IMPL-05: add fail-safe primary selector"
```

## 6. Task 3 — Add the one-card A2A transport seam

**Files**

- Modify: `packages/protocol-a2a/src/types.ts`
- Modify: `packages/protocol-a2a/src/transport.ts`
- Modify: `packages/protocol-a2a/src/transport.test.ts`
- Create: none
- Test: transport, signing, and card tests

**Interfaces**

- Consume: SDK `AgentCard`, `SiteborneA2aSigningIdentity`,
  `buildUnsignedSiteborneAgentCard`
- Change: `CreateSiteborneA2aOptions`, `createSiteborneA2aHonoApp`
- Produce: optional unsigned content input only
- Callers: edge `resolveA2aApp`; all current callers omit the new field and
  preserve legacy behavior

**RED**

Write cases named:

- `signs the supplied unsigned Agent Card instead of rebuilding legacy content`
- `keeps the legacy unsigned builder as the default when no card is supplied`
- `rejects supplied content that already contains a signature`
- `fails closed when signing rejects and does not attempt a second card`
- `fails closed when immediate signature verification rejects`
- `publishes one immutable signed card after the caller mutates its original unsigned object`

Use a controlled `SiteborneA2aSigningIdentity` with `vi.fn` for `sign` and
`verify`; assert one call each and assert the exact selected unsigned object
enters `sign`.

Run:

```bash
pnpm --filter @siteborne/protocol-a2a exec vitest run src/transport.test.ts
```

Expected RED: `CreateSiteborneA2aOptions` has no `unsignedAgentCard`, and
transport always calls the legacy builder.

**GREEN**

- Import `AgentCard` as a type in `types.ts`.
- Add only `unsignedAgentCard?: AgentCard`.
- In transport, choose one unsigned card, reject a non-empty signature array,
  sign once, verify once, and capture the verified result.
- Preserve the existing default builder arguments and every route/handler.
- Do not add fallback after signing begins.

Run the focused command and require PASS.

**REFACTOR**

Keep selection adjacent to the current signing lines. Do not add a second
transport factory or signer. Rerun the focused test.

**REGRESSION**

```bash
pnpm --filter @siteborne/protocol-a2a exec vitest run src/transport.test.ts src/signing.test.ts src/card.test.ts src/protocol.property.test.ts
```

**COMMIT**

```bash
git add packages/protocol-a2a/src/types.ts packages/protocol-a2a/src/transport.ts packages/protocol-a2a/src/transport.test.ts
git commit -m "METADATA-VCM-IMPL-05: accept selected unsigned A2A content"
```

## 7. Task 4 — Select A2A primary content inside the existing cache promise

**Files**

- Modify: `apps/edge-api/src/routes/a2a.ts`
- Modify: `apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts`
- Modify: `apps/edge-api/tests/a2a-metadata-shadow-adversarial.test.ts`
- Create: none
- Test: both metadata-mode files; `a2a-route.test.ts` remains an unchanged
  regression target

**Interfaces**

- Consume: `selectPrimaryProjection`, `AgentCard.toJSON/fromJSON`,
  `buildUnsignedSiteborneAgentCard`, `getRuntimeEffectiveView`,
  `buildRealA2aShadowContext`, `projectA2aFromVcm`, existing runtime resolvers
  and signer resolver
- Produce: one validated selected unsigned `AgentCard` passed through
  `CreateSiteborneA2aOptions.unsignedAgentCard`
- Change: private `resolveA2aApp`; add private `validateVcmUnsignedAgentCard`
- Downstream: existing protocol signer, verifier, cached Hono app, Agent
  Card/JWKS/A2A endpoints

**RED**

Extend the tests with exact cases:

1. `vcm_primary_compare passes the matched VCM unsigned card to the protocol transport`
2. `builds the legacy reference and VCM candidate independently before selection`
3. `signs and verifies the selected VCM card once`
4. `serves a signed independent legacy card on semantic mismatch`
5. `serves a signed independent legacy card when the VCM projector throws`
6. `serves a signed independent legacy card when VCM validation fails`
7. `serves a signed independent legacy card when comparison throws`
8. `fails closed when the legacy unsigned builder is unusable`
9. `fails closed when final signing rejects`
10. `does not mutate metadata after signing`
11. `shares one pending app promise and one final signed representation across concurrent callers`
12. `re-evaluates selection on a new cache key or module-isolate rebuild`
13. `keeps shadow_compare legacy-serving and observation-only`
14. `keeps legacy mode byte-equivalent apart from nondeterministic signatures`
15. `keeps vcm_only refused to legacy`
16. `keeps runtime production and mTLS narrowing on absent or malformed input`
17. `emits primary attempt/success/compare/match on a clean match`
18. `emits mismatch/failure/fallback without changing the signed fallback`
19. `keeps safe selection when telemetry throws`
20. `invokes no service execution boundary while building or serving discovery metadata`

Use module spies to capture the `unsignedAgentCard` option and producer calls.
Strip only `signatures` when comparing legacy-equivalent wire content. Do not
weaken the shared comparator.

Run:

```bash
pnpm exec vitest run apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts apps/edge-api/tests/a2a-metadata-shadow-adversarial.test.ts
```

Expected RED: the newly authorized primary mode reaches no primary-selection
branch and the protocol options contain no selected card.

**GREEN**

Within the already synchronously assigned async cache IIFE:

1. resolve the existing signing identity and runtime facts;
2. for `legacy`, call the existing protocol factory with no unsigned override;
3. for `shadow_compare`, retain the existing scheduled background comparison and
   legacy transport construction;
4. for `vcm_primary_compare`, invoke `selectPrimaryProjection` with:
   - legacy builder: `buildUnsignedSiteborneAgentCard` using the
     already-resolved production and mTLS inputs;
   - primary builder: `getRuntimeEffectiveView` → `buildRealA2aShadowContext` →
     `projectA2aFromVcm` → SDK round trip;
   - validator: `validateVcmUnsignedAgentCard`;
   - the existing pre-signature governed signature difference;
5. pass only `selection.selected` as `unsignedAgentCard`;
6. await one `createSiteborneA2aHonoApp` construction;
7. on that final construction rejection in primary mode, emit bounded
   signing-boundary failure telemetry and rethrow.

Keep mode in the existing cache key. Keep the cache promise assigned before the
first await. Never clear a rejected promise during the request wave.

Run the focused command and require PASS.

**REFACTOR**

Keep shadow scheduling separate from primary selection. Do not let
`scheduleA2aShadowComparison` return content. Rerun focused tests.

**REGRESSION**

```bash
pnpm exec vitest run apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts apps/edge-api/tests/a2a-metadata-shadow-adversarial.test.ts apps/edge-api/tests/a2a-route.test.ts apps/edge-api/tests/multi-service-discovery.test.ts
pnpm a2a:check
```

**COMMIT**

```bash
git add apps/edge-api/src/routes/a2a.ts apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts apps/edge-api/tests/a2a-metadata-shadow-adversarial.test.ts
git commit -m "METADATA-VCM-IMPL-05: select A2A primary content before signing"
```

## 8. Task 5 — Separate MCP definitions from internal handlers

**Files**

- Modify: `packages/protocol-mcp/src/types.ts`
- Modify: `packages/protocol-mcp/src/server.ts`
- Modify: `packages/protocol-mcp/src/transport.test.ts`
- Create: none
- Test: protocol transport, property, TDQS, and fixture/spec checks
- Inspect without editing: `packages/protocol-mcp/src/index.ts`; its current
  `export *` statements expose the new type/server symbols

**Interfaces**

- Consume: `MCP_TOOL_NAMES`, `MCP_SERVICE_TOOLS`, title/description helpers,
  frozen schemas, schema metadata, Zod utility schemas, SDK `JsonSchemaType`,
  `ToolAnnotations`, `StandardSchemaWithJSON`, `AnyToolHandler`,
  `fromJsonSchema`
- Produce: `SiteborneMcpToolDefinition`,
  `SiteborneMcpDefinitionAuthorityInputs`,
  `buildSiteborneMcpDefinitionAuthorityInputs`,
  `buildLegacySiteborneMcpToolDefinitions`,
  `assertValidSiteborneMcpToolDefinitions`
- Change: `CreateSiteborneMcpOptions.toolDefinitions`,
  `createSiteborneMcpServer`
- Preserve internally: service `boundary.execute`, `buildCanonicalQuote`, and
  health closures
- Downstream: official SDK tools/list and tools/call transports; edge and stdio
  callers

**RED**

Add protocol tests named:

- `the pure legacy definition builder reproduces the current six tools/list definitions`
- `authority inputs derive utility schemas through the SDK Standard JSON Schema path`
- `definition validation accepts exactly MCP_TOOL_NAMES once each`
- `definition validation rejects a missing canonical tool`
- `definition validation rejects an extra tool`
- `definition validation rejects a duplicate tool`
- `definition validation rejects an unknown tool name`
- `definition validation rejects missing input or output schema`
- `a supplied matching definition array reaches tools/list unchanged`
- `selected definitions register exactly once in MCP_TOOL_NAMES order`
- `definition selection cannot supply or invoke an executable handler`
- `all four selected service definitions retain their v2 service bindings`
- `selected metadata still dispatches each service call to the existing boundary closure`
- `selected metadata still dispatches quote calls through governed buildCanonicalQuote`
- `selected metadata leaves health read-only`
- `JSON and SSE tools/list preserve descriptions schemas annotations and meta`
- `modern and legacy tools/list each contain exactly the same six canonical names`

Include a typechecked negative assertion showing a handler-bearing member is not
assignable to `CreateSiteborneMcpOptions` or `SiteborneMcpToolDefinition`.

Run:

```bash
pnpm --filter @siteborne/protocol-mcp exec vitest run src/transport.test.ts
```

Expected RED: no pure definition builder, authority-input builder, validator, or
definition-only option exists.

**GREEN**

1. Hoist the inline empty health input schema to a named Zod constant.
2. Derive typed authority inputs from existing constants/functions and the
   Standard JSON Schema converter; do not copy schema JSON.
3. Build the independent six-element legacy definition array from those leaf
   inputs.
4. Construct the six existing handler closures internally in an exact-name
   record.
5. Select
   `options.toolDefinitions ?? buildLegacySiteborneMcpToolDefinitions(options)`.
6. Validate the selected array before creating registrations.
7. Iterate `MCP_TOOL_NAMES` once; wrap selected raw schemas with
   `fromJsonSchema`; call `registerTool` once with the existing internal handler
   for that name.
8. Preserve request validation, hostile-key checks, x402 extraction, quote
   pricing, health computation, server options, and transport code exactly.
9. Keep every handler type and object private to `server.ts`.

Run the focused command and require PASS.

**REFACTOR**

Remove the three old inline metadata objects only after their extracted legacy
output is proven wire-equivalent. Keep prose, schemas, metadata keys, and
handler bodies in the same authority module. Rerun the focused test.

**REGRESSION**

```bash
pnpm --filter @siteborne/protocol-mcp exec vitest run src/transport.test.ts src/transport.property.test.ts src/tdqs.test.ts src/frozen-contracts.test.ts src/x402-wire.test.ts
pnpm --filter @siteborne/protocol-mcp run typecheck
```

**COMMIT**

```bash
git add packages/protocol-mcp/src/types.ts packages/protocol-mcp/src/server.ts packages/protocol-mcp/src/transport.test.ts
git commit -m "METADATA-VCM-IMPL-05: separate MCP definitions from handlers"
```

## 9. Task 6 — Build MCP primary context from typed current authority

**Files**

- Modify: `packages/vcm/src/projections/mcp-real-context.ts`
- Modify: `packages/vcm/src/index.ts`
- Modify: `packages/vcm/src/projections/mcp-shadow.test.ts`
- Create: none
- Test: VCM MCP projection tests

**Interfaces**

- Consume: `SiteborneMcpDefinitionAuthorityInputs`, `MCP_TOOL_NAMES`,
  `MCP_SERVICE_TOOLS`, schema URIs and the existing `McpProjectionContext`
- Produce: `buildCurrentMcpProjectionContext(authority)`
- Preserve: `buildRealMcpShadowContext(realTools)`
- Callers: future primary branch in `mcpRoute`; current shadow branch remains on
  the response-derived builder

**RED**

Write cases named:

- `builds current context from typed authority inputs without a served response`
- `preserves MCP_TOOL_NAMES canonical order`
- `maps exactly four v2 service-backed interactions`
- `does not create four v1 tools from canonical v1 service identities`
- `maps quote and health as utility interactions`
- `projects six definitions equal to the independent legacy builder`
- `does not accept or expose a handler-bearing authority value`
- `keeps response-derived buildRealMcpShadowContext behavior unchanged`

Run:

```bash
pnpm exec vitest run packages/vcm/src/projections/mcp-shadow.test.ts
```

Expected RED: `buildCurrentMcpProjectionContext` is absent.

**GREEN**

Implement a pure adapter over `SiteborneMcpDefinitionAuthorityInputs`. Build
maps from its service and utility entries, preserve the declared tool order, and
throw on a missing requested service/utility entry. Do not call
`buildLegacySiteborneMcpToolDefinitions`, do not accept `tools/list`, and do not
add handlers.

Export the helper from `packages/vcm/src/index.ts`.

Run the focused command and require PASS.

**REFACTOR**

Keep both context builders in the same file but with separate names, parameters,
and doc comments stating their authority. Do not unify them behind an ambiguous
input union. Rerun focused tests.

**REGRESSION**

```bash
pnpm exec vitest run packages/vcm/src/projections/mcp-shadow.test.ts packages/vcm/src/current-exposure.test.ts packages/vcm/src/projections/digests.test.ts
```

**COMMIT**

```bash
git add packages/vcm/src/projections/mcp-real-context.ts packages/vcm/src/index.ts packages/vcm/src/projections/mcp-shadow.test.ts
git commit -m "METADATA-VCM-IMPL-05: derive MCP primary context from typed authority"
```

## 10. Task 7 — Select MCP definitions before one server construction

**Files**

- Modify: `apps/edge-api/src/routes/mcp.ts`
- Modify: `apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts`
- Modify: `apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts`
- Create: none
- Test: both metadata-mode files; existing `mcp-route.test.ts` and protocol
  tests remain regression targets

**Interfaces**

- Consume: `selectPrimaryProjection`, `buildLegacySiteborneMcpToolDefinitions`,
  `buildSiteborneMcpDefinitionAuthorityInputs`,
  `assertValidSiteborneMcpToolDefinitions`, `buildCurrentMcpProjectionContext`,
  `getRuntimeEffectiveView`, `projectMcpToolsFromVcm`
- Change: `mcpRoute`
- Produce: `options.toolDefinitions` selected before one
  `createSiteborneMcpHonoApp(options)`
- Preserve: `extractToolsListFromResponse`, `scheduleMcpShadowComparison`,
  bounded request handling, official transport, all executable closures

**RED**

Add exact cases:

1. `vcm_primary_compare selects six matching VCM definitions before app construction`
2. `passes only definition data and no executable handler from VCM`
3. `retains the six exact canonical names and four v2 service bindings`
4. `selects independent legacy definitions on semantic mismatch`
5. `selects independent legacy definitions when the VCM projector throws`
6. `selects independent legacy definitions when exact-set validation fails`
7. `selects independent legacy definitions when comparison throws`
8. `fails closed before app construction when the legacy definition builder fails`
9. `fails closed when both producers fail`
10. `keeps safe selection when telemetry throws`
11. `constructs exactly one MCP app and registers each handler once`
12. `serves selected definitions through application/json tools/list`
13. `serves selected definitions through text/event-stream tools/list`
14. `keeps MCP 2026-07-28 modern negotiation unchanged`
15. `keeps legacy stateless compatibility unchanged`
16. `keeps malformed JSON-RPC and unknown methods on the existing SDK path`
17. `keeps request bounds host and origin enforcement unchanged`
18. `keeps paid tools closed while paid routes are disabled`
19. `invokes zero providers for unauthenticated or unpaid qualification calls where already guaranteed`
20. `keeps shadow_compare legacy-serving with the R3 JSON and SSE observer`
21. `keeps vcm_only refused to legacy`
22. `emits primary attempt success compare and match for every valid primary tools/list`
23. `emits mismatch or failure and fallback when legacy is selected`

For the JSON primary test, mock only the transport response representation and
build its `result.tools` from the selected `options.toolDefinitions`; assert
application/json JSON-RPC 2.0 with six tools. For SSE, exercise the real SDK
response and parse its `data:` frame. Do not normalize away description, schema,
annotations, or `_meta` differences.

Run:

```bash
pnpm exec vitest run apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts
```

Expected RED: the route has no pre-registration primary branch and creates the
protocol app without selected definitions.

**GREEN**

After building the existing `CreateSiteborneMcpOptions` and authorizing mode:

- `legacy`: create the app exactly as before.
- `shadow_compare`: create the app exactly as before, then retain the R3
  response clone/extractor/background comparison.
- `vcm_primary_compare`:
  1. call `selectPrimaryProjection`;
  2. legacy closure calls the independent legacy builder and its validator;
  3. primary closure gets the effective view, builds fresh typed authority
     inputs, adapts them with `buildCurrentMcpProjectionContext`, and calls
     `projectMcpToolsFromVcm`;
  4. validation closure applies exact-set/schema validation;
  5. assign only `selection.selected` to `options.toolDefinitions`;
  6. construct exactly one Hono app and fetch exactly once.

Run primary selection for every MCP request in primary mode, before server
construction. Do not move it into the post-response tools/list observer. Keep
`requestForMethodSniffing` and response cloning limited to `shadow_compare`.

Run the focused command and require PASS.

**REFACTOR**

Keep mode branches visible. Do not combine shadow observation and primary
selection into one helper returning a response. Rerun focused tests.

**REGRESSION**

```bash
pnpm exec vitest run apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts apps/edge-api/tests/mcp-route.test.ts apps/edge-api/tests/mcp-four-service-acceptance.test.ts apps/edge-api/tests/paid-routes-mounting.test.ts
pnpm mcp:check
```

**COMMIT**

```bash
git add apps/edge-api/src/routes/mcp.ts apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts
git commit -m "METADATA-VCM-IMPL-05: select MCP definitions before registration"
```

## 11. Full local qualification and evidence closure

**Files**

- Create after every gate passes:
  `docs/reports/METADATA-VCM-IMPL-05-vcm-primary-compare-local-qualification.md`
- Modify runtime/tests: none in this task
- Test: all commands below

**Interfaces and invariants to inspect**

- `LEGACY_BUILDER_REMAINS_PRESENT=YES`: direct source reference and passing
  legacy-mode tests for `buildUnsignedSiteborneAgentCard` and
  `buildLegacySiteborneMcpToolDefinitions`.
- `LEGACY_COMPARATOR_REMAINS_EXECUTABLE=YES`: mismatch and failure tests
  exercise both independent legacy builders.
- `VCM_ONLY_SERVABLE=NO`: unit and both surface tests refuse it.
- `MCP_HANDLER_IDENTITY_PRESERVED=YES`: definition-only option has no handler
  member; all six tools/call behaviors reach the existing internal closures.
- `A2A_EXISTING_SIGNER_PRESERVED=YES`: one selected unsigned card enters the
  existing identity and verifies.
- `ECONOMIC_AUTHORITY_CHANGED=NO`: governed pricing/registry tests and quote
  tests pass.
- `SECURITY_AUTHORITY_CHANGED=NO`: empty-overlay and security-ceiling tests
  pass; auth source has no diff.
- `PROTOCOL_AUTHORITY_CHANGED=NO`: protocol constants, routes, framing, and
  compatibility tests pass.
- `AUTHORITY_INVERSION=NO`: production config remains untouched; `vcm_only`
  remains refused; legacy producers remain executable.

**Focused primary tests**

```bash
pnpm exec vitest run apps/edge-api/src/control-plane/config/metadata-projection-mode.test.ts apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.test.ts apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts apps/edge-api/tests/a2a-metadata-shadow-adversarial.test.ts apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts
```

**VCM**

```bash
pnpm exec vitest run packages/vcm/src
pnpm exec vitest run packages/vcm/src/legacy/registry-parity.test.ts packages/vcm/src/legacy/import-registry.test.ts packages/vcm/src/legacy/project-registry.test.ts packages/vcm/src/validators.test.ts
```

The second command records the explicit 8/8 structural registry parity and
canonical economic validity evidence. Counts are captured from actual output and
are not predeclared.

**A2A**

```bash
pnpm a2a:check
```

This includes format, lint, typecheck, unit, property, fixture, spec, and edge
route checks for the package’s current script.

**MCP**

```bash
pnpm mcp:check
```

This includes protocol format/lint/typecheck/build/unit/property/spec, edge
route, and stdio package checks through the repository’s current script.

**x402 and Bazaar**

```bash
pnpm x402:check
```

The protocol-x402 test/fixture suite contains the Bazaar coverage used by prior
VCM checkpoints.

**Full edge suite**

```bash
pnpm exec vitest run apps/edge-api --maxWorkers=1
```

Use one worker to avoid repeating the previously classified host-contention
timeout artifact. Any failure is still investigated and classified before
proceeding.

**Repository typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

**Changed-file formatting**

```bash
pnpm exec prettier --check apps/edge-api/src/control-plane/config/metadata-projection-mode.ts apps/edge-api/src/control-plane/config/metadata-projection-mode.test.ts apps/edge-api/src/control-plane/metadata/primary-comparison-selector.ts apps/edge-api/src/control-plane/metadata/primary-comparison-selector.test.ts apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.ts apps/edge-api/src/control-plane/telemetry/metadata-projection-telemetry.test.ts apps/edge-api/src/routes/a2a.ts apps/edge-api/src/routes/mcp.ts apps/edge-api/tests/a2a-metadata-shadow-compare.test.ts apps/edge-api/tests/a2a-metadata-shadow-adversarial.test.ts apps/edge-api/tests/mcp-metadata-shadow-compare.test.ts apps/edge-api/tests/mcp-metadata-shadow-adversarial.test.ts packages/protocol-a2a/src/types.ts packages/protocol-a2a/src/transport.ts packages/protocol-a2a/src/transport.test.ts packages/protocol-mcp/src/types.ts packages/protocol-mcp/src/server.ts packages/protocol-mcp/src/transport.test.ts packages/vcm/src/projections/mcp-real-context.ts packages/vcm/src/projections/mcp-shadow.test.ts packages/vcm/src/index.ts docs/reports/METADATA-VCM-IMPL-05-vcm-primary-compare-local-qualification.md
git diff --check 620ab84dcce95f0d126ad3f02b08ca590c4e810d
```

Do not substitute repository-wide Prettier as a required gate; its unrelated
historical baseline remains separately reported.

**Secret scan**

```bash
pnpm secrets:scan
```

**Generated, drift, governance, schema, state, pricing, and contract gates**

```bash
pnpm pcc:generate:check
pnpm services:generate:check
pnpm openapi:generate:check
pnpm schemas:check
pnpm pricing:check
pnpm pricing:registry:check
pnpm governance:validate
pnpm state:validate
pnpm tasks:validate
pnpm contracts:baseline:verify
pnpm contracts:compat:check
pnpm contracts:release:verify
```

**Static authority and scope audit**

```bash
git diff --name-status 620ab84dcce95f0d126ad3f02b08ca590c4e810d
git diff --stat 620ab84dcce95f0d126ad3f02b08ca590c4e810d
git diff 620ab84dcce95f0d126ad3f02b08ca590c4e810d -- registry governance packages/pricing packages/contracts packages/protocol-x402 apps/edge-api/wrangler.toml wrangler.toml
rg -n "vcm_only|buildUnsignedSiteborneAgentCard|buildLegacySiteborneMcpToolDefinitions|registerTool|identity\.sign|identity\.verify|MCP_PROTOCOL_VERSION" apps/edge-api/src packages/protocol-a2a/src packages/protocol-mcp/src
```

The scoped diff command must be empty. The symbol scan is evidence that the
legacy builders, handler boundary, signer, refusal, and protocol version remain
present.

**Evidence contents**

Record:

- starting and ending commits;
- RED commands and expected failure reasons for each task;
- GREEN and regression results;
- exact test counts from actual output;
- source files and test files changed;
- five digest classes unchanged;
- A2A signer/cache proof;
- MCP definition/handler proof;
- economics/security/protocol authority proof;
- production configuration untouched;
- Cloudflare mutations, uploads, deployments, and traffic changes all zero;
- final diff and worktree state.

**COMMIT**

After all implementation gates pass, create the implementation commits described
in Tasks 1–7 if they were not already created locally. Do not push them. Then
stage only the completed evidence report:

```bash
git add docs/reports/METADATA-VCM-IMPL-05-vcm-primary-compare-local-qualification.md
git commit -m "docs(vcm): close primary-compare local qualification"
```

Stop. A Worker upload or live candidate requires a separate human-authorized
checkpoint.

## 12. Required behavioral matrix

### 12.1 Mode authorization

| Input                 | A2A                                    | MCP                                    |
| --------------------- | -------------------------------------- | -------------------------------------- |
| missing               | legacy                                 | legacy                                 |
| invalid               | legacy plus bounded invalid-mode event | legacy plus bounded invalid-mode event |
| `legacy`              | legacy                                 | legacy                                 |
| `shadow_compare`      | legacy served, VCM observed            | legacy served, VCM observed            |
| `vcm_primary_compare` | qualified pre-sign selection           | qualified pre-registration selection   |
| `vcm_only`            | refused to legacy                      | refused to legacy                      |

### 12.2 Primary selector

| Condition                                  | Result                          |
| ------------------------------------------ | ------------------------------- |
| VCM valid, legacy valid, semantic match    | exact VCM object selected       |
| VCM valid, legacy valid, semantic mismatch | exact legacy object selected    |
| VCM projector throws, legacy valid         | exact legacy object selected    |
| VCM validation throws, legacy valid        | exact legacy object selected    |
| VCM valid, legacy unavailable              | reject; no output               |
| both unavailable                           | reject; no output               |
| comparator throws, legacy valid            | exact legacy object selected    |
| telemetry throws                           | otherwise-safe result unchanged |

### 12.3 A2A

- Match: VCM unsigned card → existing signer once → verify once → cache final
  app → serve.
- Mismatch or primary failure: independent legacy unsigned card → same signer
  once → verify once → cache final app → serve.
- Legacy loss: reject before signing VCM.
- Signing or verification loss: reject; no unsigned, stale, or second attempt.
- Cache concurrency: one promise, one identity, one selected card.
- Shadow and legacy: current qualified behavior unchanged.

### 12.4 MCP

- Match: six VCM metadata definitions + six internal existing handlers → one
  server.
- Mismatch or primary failure: six independent legacy definitions + the same
  internal existing handlers → one server.
- Legacy loss: reject before server construction.
- VCM cannot carry a handler through type or runtime option.
- JSON/SSE framing, modern/legacy protocol negotiation, malformed request
  handling, and tools/call execution remain the official SDK’s existing
  behavior.

## 13. Economics, security, protocol, and digest proof

### 13.1 Price authority

The implementation must not change any pricing source. Prove with:

- `packages/vcm/src/legacy/import-registry.test.ts`: frozen
  `releaseBasePriceDeclared` cannot override `listPrice` or `governedMaxPrice`;
- `packages/vcm/src/validators.test.ts`: canonical economic constraints remain
  valid;
- `packages/protocol-mcp/src/transport.test.ts`: quote amounts still come from
  `buildCanonicalQuote` → `resolveServiceMaxPriceUsd`;
- `pnpm pricing:check` and `pnpm pricing:registry:check`;
- no diff in pricing, governance, registry, or x402 execution files.

### 13.2 Security authority

Prove:

- `packages/vcm/src/effective-view.test.ts` preserves IMPLEMENTED → CONFIGURED →
  ACTIVE → VERIFIED ceilings and narrowing;
- malformed or absent runtime inputs cannot advertise production or mTLS;
- the existing A2A signer and key resolver remain the only signing authority;
- no auth source changes;
- no secret-bearing value appears in telemetry or diffs.

### 13.3 Protocol authority

Prove:

- `MCP_PROTOCOL_VERSION` remains `2026-07-28`;
- route names and A2A/MCP transport factories remain unchanged;
- JSON/SSE response selection remains SDK-owned;
- legacy MCP compatibility remains `legacy: 'stateless'`;
- public A2A semantics differ only by qualified unsigned producer provenance;
- no executable handler changes.

### 13.4 Digests

Run existing digest tests. If telemetry needs a digest, use
`computeProjectionDigest` or an already-computed existing digest as a bounded
field. Add no digest type, persistent digest, or public digest contract.

## 14. Authority-inversion barriers

The implementation review must explicitly reject any diff that:

- deletes or bypasses `buildUnsignedSiteborneAgentCard`;
- deletes or makes `buildLegacySiteborneMcpToolDefinitions` unreachable;
- permits `vcm_only`;
- lets VCM supply an MCP handler or registration callback;
- signs before producer selection;
- substitutes metadata after signing;
- creates two signed cards for fallback;
- creates two MCP servers or registers two handler sets for fallback;
- derives the legacy comparator from VCM;
- derives primary MCP context from VCM’s final output or from the final legacy
  definition array;
- changes price, security, protocol, route, payment, auth, state, or deployment
  authority.

Passing parity never authorizes deletion of legacy code.

## 15. Commit sequence for the implementation checkpoint

1. `METADATA-VCM-IMPL-05: authorize primary compare mode`
2. `METADATA-VCM-IMPL-05: add fail-safe primary selector`
3. `METADATA-VCM-IMPL-05: accept selected unsigned A2A content`
4. `METADATA-VCM-IMPL-05: select A2A primary content before signing`
5. `METADATA-VCM-IMPL-05: separate MCP definitions from handlers`
6. `METADATA-VCM-IMPL-05: derive MCP primary context from typed authority`
7. `METADATA-VCM-IMPL-05: select MCP definitions before registration`
8. `docs(vcm): close primary-compare local qualification`

Each implementation commit must be locally working at its stated boundary. Do
not push any of them until the complete local checkpoint passes and a later
instruction authorizes a push.

## 16. METADATA-VCM-08 requirement coverage

| METADATA-VCM-08 requirement                                         | Concrete coverage                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| Primary only after build, validation, independent legacy, and match | selector Task 2 plus both surface tasks              |
| Mismatch/projector/validator/comparator fallback                    | selector unit matrix and surface adversarial suites  |
| Legacy loss fails closed                                            | selector plus A2A/MCP surface tests                  |
| Telemetry failure cannot affect serving                             | telemetry unit plus both surface adversarial suites  |
| A2A one final unsigned selection before signing                     | Tasks 3–4                                            |
| A2A sign and verify once                                            | transport spies and route integration                |
| A2A cache one promise                                               | concurrent/cold rebuild tests in Task 4              |
| MCP definitions only from VCM                                       | Tasks 5–7 and negative type assertion                |
| Existing MCP handlers remain internal                               | Task 5 map, tools/call behavioral proof, scope audit |
| One MCP server / one registration pass                              | Tasks 5 and 7                                        |
| Typed current authority independent from final legacy output        | Task 6                                               |
| JSON and SSE support                                                | Tasks 5 and 7                                        |
| Runtime/effective narrowing                                         | A2A tests plus VCM effective-view regression         |
| Governed pricing remains authoritative                              | Section 11 economic proof                            |
| Security and auth unchanged                                         | Section 11 security proof and diff audit             |
| Protocol version/framing/compatibility unchanged                    | MCP package and edge regressions                     |
| Five digest classes only                                            | existing digest suite and source inspection          |
| `vcm_only` prohibited                                               | Task 1 and both surface tests                        |
| Legacy builders remain executable                                   | mismatch/failure tests and symbol inspection         |
| No production config or deployment change                           | scoped diff and final evidence                       |
| Future local end state remains production shadow mode               | no configuration edit; report assertion              |

Coverage is complete; no METADATA-VCM-08 requirement remains unassigned.

## 17. Plan execution gate

Implementation may start only from a clean worktree on the committed plan.
During execution:

1. write the stated RED test first;
2. run the exact focused command and capture the expected failure;
3. write the smallest GREEN source change;
4. rerun focused tests;
5. perform only necessary cleanup;
6. rerun focused and nearby regression tests;
7. commit the independently working slice;
8. stop at the first invariant conflict rather than weakening a test or
   authority boundary.

The future implementation checkpoint is PASS only after every Section 11 gate
passes, the report is committed separately, the worktree is clean, production
configuration is unchanged, and all Cloudflare mutation counters remain zero.

## 18. Expected implementation end state

- Local source supports `vcm_primary_compare` for A2A and MCP.
- VCM content is eligible only after independent legacy equality.
- A2A signs one final selected unsigned card with the existing signer.
- MCP uses VCM for metadata definitions only; existing handlers execute.
- Legacy producers and comparators remain present and executable.
- `vcm_only` remains refused.
- Production still runs `shadow_compare`.
- No Worker is uploaded or deployed.
- No traffic changes.
- No authority inversion.
- The next checkpoint after local PASS is a separately authorized immutable
  0%-candidate qualification design/activation checkpoint, not an automatic
  deployment.
