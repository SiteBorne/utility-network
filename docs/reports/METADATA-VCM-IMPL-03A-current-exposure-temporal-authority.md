# METADATA-VCM-IMPL-03A — Code-Derived Current Exposure + Temporal Authority Inputs

Status: implementation checkpoint. Applies the temporal authority split designed in
`METADATA-VCM-05` to `packages/vcm`. Does not edit the frozen Master Reference or any prior
checkpoint report; does not touch `registry/services/*.json`, `governance/RISK_LIMITS.yaml`,
`packages/pricing`, any protocol package's *behavior*, catalog, edge-api routes, contracts,
schemas, CI, or production configuration.

```
PARENT_VCM_IMPL_02=cc46c3a87781824ac2fc56e5d86966cd0c137ad0
PARENT_VCM_05=4b48888b323939d92783f6c3e18bd7ee914eaedf
```

## I. Parent authority

`METADATA-VCM-05` (evidence commit `4b48888`) is the governing authority for this checkpoint's
temporal semantics: release declaration, current static exposure, operational activation, and
external publication are four distinct facts and must never collapse into one boolean. VCM-05's
`RECOMMENDED_NEXT_PATH=PATH_B` and `SAFE_TO_BEGIN_SHADOW_PROJECTION_PARITY=NO` gated this
checkpoint; this report re-evaluates that gate in §XIV.

## II. Scope discipline

Every changed file is under `packages/vcm/` (plus `pnpm-lock.yaml`, updated automatically by
adding three workspace dependencies — see §VI). No protocol package's source was modified. This
was verified, not assumed: `git show --stat` on the implementation commit lists only
`packages/vcm/**` and `pnpm-lock.yaml`.

```
REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
CONTRACT_MUTATIONS=0
PROTOCOL_BEHAVIOR_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0
```

`packages/vcm/package.json` gained three workspace dependencies — `@siteborne/protocol-a2a`,
`@siteborne/protocol-mcp`, `@siteborne/protocol-x402` — exactly the "tiny export... without
changing behavior" case anticipated in §II of the directive: VCM *reads* each package's existing
typed exports (`SITEBORNE_SERVICE_IDS`, `MCP_SERVICE_TOOLS`, `MCP_TOOL_NAMES`,
`SUPPORTED_X402_VERSION`, `SITEBORNE_SUPPORTED_X402_SCHEMES`, `ALL_BAZAAR_SERVICE_IDS`); none of
those packages' own files changed.

## III. Field rename (release/current temporal naming)

Repository-wide search before renaming found zero non-VCM consumers of `@siteborne/vcm` and zero
references to the three transitional fields outside `packages/vcm/`. The rename was therefore
entirely internal and safe:

```
RELEASE_PROTOCOL_FIELD_NAME    = releaseProtocolExposureDeclared   (was legacyProtocolExposureDeclared)
RELEASE_BASE_PRICE_FIELD_NAME  = releaseBasePriceDeclared          (was legacyBasePriceDeclared)
RELEASE_MAXIMUM_PRICE_FIELD_NAME = releaseMaximumPriceDeclared     (was legacyMaximumPriceDeclared)
```

`legacyProductionEnabledDeclared` and `legacyUpdatedAt` were left unrenamed — VCM-05 scoped the
rename to the three protocol/pricing declaration fields specifically; these two remain frozen,
transitional, non-normative fields under their existing names (types.ts:293-299 documents why:
they exist only for lossless legacy projection, never as canonical fact).

Registry round-trip parity after the rename: **8/8 PASS** (unchanged from METADATA-VCM-IMPL-02;
verified in §XI).

## IV. Protocol-status vocabulary correction

Direct inspection of `schemas/common/service-metadata.schema.json:147-176` (the actual registry
schema) shows the legal vocabulary is:

```
REGISTRY_PROTOCOL_STATUS_VALUES = ["planned", "scaffolded", "tested", "enabled", "not_enabled"]
```

— five values, not the two-value `planned`/`live` vocabulary an earlier informal characterization
had assumed. Direct inspection of all 8 `registry/services/*.json` files confirms every current
file uses exactly one value today: `"planned"` (verified by parsing every file's `protocols`
block and collecting distinct values: `{'planned'}`).

`RELEASE_PROTOCOL_EXPOSURE_VALUES` in `types.ts:223-229` now matches the schema's five-value
enum exactly. `LegacyProtocolsBlock` in `legacy/types.ts:15-23` types each surface field as
`ReleaseProtocolExposureValue`, so the importer accepts exactly the release schema's legal
vocabulary and no other. Negative tests confirm an unsupported value (`'live'`, the value the
previous, informal characterization incorrectly assumed was legal) is rejected by the type
system / parser rather than silently accepted.

Critically, per §IV of the directive: **no current exposure fact is inferred from this
vocabulary any more.** `releaseProtocolExposureDeclared` is preserved as compatibility evidence
only; `currentStaticExposures` is derived exclusively from the adapters in §VI/§VII, never from
this block. `registry-parity.test.ts`'s new test (`'derives current A2A and MCP exposure
independently of frozen planned declarations'`) is the direct proof: it asserts 8 current A2A
exposures and 4 current MCP service exposures exist on real data *while every service's*
`releaseProtocolExposureDeclared.a2a`/`.mcp` *is still* `'planned'`.

## V. Temporal fact types introduced

`types.ts` adds the minimum closed vocabulary needed to keep the four temporal domains distinct:

- `CurrentStaticProtocolExposure` (surface, registrationId, operationId, exposureShape,
  provenance) — **current static exposure**, per §V's requirement to identify protocol surface,
  service/interaction identity, exposure shape, and derivation provenance.
- `CurrentStaticUtilityExposure` — extends the above with `utilityKind: 'quote_request' |
  'health_check'`, for MCP interactions that are not service-backed (§VII, §VIII).
- `CurrentExposureProvenance` (sourcePackage, sourceModule, sourceRegistrationId,
  runtimeSourceCommit, derivationMethod) — deliberately has **no timestamp field**, satisfying
  §X's "do not add timestamps to canonical static exposure if they would introduce digest
  volatility."
- `CurrentX402ProtocolCapability` and `CurrentBazaarProjectionSupport` — the two typed current
  inputs resolved in §XIII/§XIV.
- Operational activation (`ProtocolActivation` on `RuntimeStateOverlay`) and external publication
  (`ExternalPublicationState`, an `Unmeasured`-sentinel-backed field) remain separate types,
  living on the overlay/effective-view layer, never on `CanonicalService` — this is what makes
  `CURRENT_STATIC_EXPOSURE != CURRENT_OPERATIONAL_ACTIVATION` a structural, not just documented,
  invariant (§IX).

`EXPOSURE_SHAPES = ['standalone_tool', 'standalone_endpoint', 'inline_operation', 'skill']` — the
smallest closed vocabulary justified by current surfaces (§VIII): A2A skills use `'skill'`, MCP
tools use `'standalone_tool'`, and `'inline_operation'`/`'standalone_endpoint'` are reserved for
the REST/x402 paid-flow and future standalone-route distinction respectively (neither is
populated by any adapter in this checkpoint — no REST route manifest exists yet, see §XII — but
the vocabulary is pre-declared so §VIII's `get_quote` semantics, once a REST adapter exists, do
not require another type change).

## VI. A2A current exposure — derived from actual code

**Registration source**: `@siteborne/protocol-a2a`'s exported `SITEBORNE_SERVICE_IDS` (the same
typed array the real Agent Card builder (`card.ts`) iterates to build skills — confirmed by
reading `card.ts`, which maps this exact array to `AgentSkill` entries; no second array exists in
the A2A package).

`current-exposure.ts`'s `currentRegistrationFacts()` maps each id in `SITEBORNE_SERVICE_IDS`
directly to a `CurrentRegistrationFact` with `exposureShape: 'skill'` — no retyping, no
hand-copied array, no text parsing of `card.ts`'s source.

```
A2A_REGISTRATION_AUTHORITY=@siteborne/protocol-a2a#SITEBORNE_SERVICE_IDS (src/constants.ts)
A2A_REGISTERED_EXPOSURES=8
VCM_A2A_CURRENT_EXPOSURES=8
A2A_CURRENT_EXPOSURE_PARITY=PASS
```

Verified against real data in `registry-parity.test.ts`: importing all 8 real registry files and
deriving current exposure from the real `SITEBORNE_SERVICE_IDS` export yields exactly 8 A2A
`currentStaticExposures` entries across the 8 canonical services — a 1:1 parity, and every one
carries `provenance.sourcePackage = '@siteborne/protocol-a2a'`.

## VII. MCP current exposure — derived from actual code, not forced into the A2A model

**Registration source**: `@siteborne/protocol-mcp`'s exported `MCP_SERVICE_TOOLS` (a typed
`Record<toolName, serviceId>` map — the same map `server.ts`'s tool-registration loop consumes)
and `MCP_TOOL_NAMES` (the full list of registered tool names, service-backed and utility alike).

VCM-05 established MCP exposure is *not* congruent with A2A: 4 primary **`.v2`** service tools
plus 2 utility tools (`siteborne_get_quote`, `siteborne_get_service_health`) that have no
corresponding canonical service at all. `current-exposure.ts` models this explicitly rather than
forcing a one-to-one service model:

- `MCP_SERVICE_TOOLS`'s 4 entries become `CurrentRegistrationFact`s of
  `target.kind: 'service_interaction'` (attached to a real `CanonicalService`).
- `MCP_TOOL_NAMES` entries *not* in `MCP_SERVICE_TOOLS`'s keys become
  `target.kind: 'utility_interaction'`, classified by name (`'siteborne_get_quote'` →
  `utilityKind: 'quote_request'`; `'siteborne_get_service_health'` → `'health_check'`). An
  unrecognized utility name throws `UNKNOWN_UTILITY_INTERACTION` rather than being silently
  dropped or guessed at — this is deliberately fail-closed against a future MCP package adding a
  new tool this adapter doesn't yet know how to classify.

```
MCP_REGISTRATION_AUTHORITY=@siteborne/protocol-mcp#MCP_SERVICE_TOOLS + #MCP_TOOL_NAMES (src/constants.ts)
MCP_REGISTERED_INTERACTIONS=6  (4 service tools + siteborne_get_quote + siteborne_get_service_health)
VCM_MCP_CURRENT_INTERACTIONS=6
MCP_CURRENT_EXPOSURE_PARITY=PASS
```

`registry-parity.test.ts`'s real-data assertion: `serviceExposures.filter(surface === 'mcp')` has
length **4** (the 4 `.v2` service tools, attached to their 4 `.v2` canonical services — never to
the corresponding `.v1` services, which have zero MCP `currentStaticExposures`), and
`model.currentStaticUtilityExposures.filter(surface === 'mcp')` has length **2**. The explicit
requirement "prove the model correctly represents that `.v1` service identities existing
canonically does not imply MCP currently exposes four `.v1` tools" is satisfied structurally: the
adapter only ever emits an exposure for a `serviceId` that is a *value* in `MCP_SERVICE_TOOLS`,
and every one of those 4 values is a `.v2` id — no `.v1` id appears in that map, so no `.v1`
service can ever receive an MCP `currentStaticExposure` through this derivation path.

## VIII. Exposure shape precision (`get_quote`)

`siteborne_get_quote`'s MCP exposure is modeled as `exposureShape: 'standalone_tool'` +
`utilityKind: 'quote_request'` — a real, standalone MCP interaction, consistent with the
previously-proven fact that MCP exposes `get_quote` as its own tool while REST/OpenAPI does not
expose a standalone `/quotes/{service_id}` endpoint (confirmed still `x-implementation-status:
'not_implemented'` per METADATA-VCM-IMPL-01 discovery; unchanged by this checkpoint). No REST
adapter exists yet (§XII), so `'inline_operation'` is not populated by any current adapter in
this checkpoint — it remains a reserved, pre-declared vocabulary member for the future REST
adapter to use once a typed route manifest exists, rather than something this checkpoint has to
invent a value for today.

## IX. Operational activation kept structurally separate

`RuntimeStateOverlay` gained `protocolActivations: ProtocolActivation[]` (surface,
registrationId, runtimeEnabled, economicAdmissionEnabled) — a *new* overlay-only fact, distinct
from `CanonicalService.currentStaticExposures`. `effective-view.ts`'s `project()` merges the two:
a registered interaction's `currentStaticExposures` entry always survives into the
`EffectiveMetadataView` with `runtimeEnabled`/`economicAdmissionEnabled` attached from the
overlay (defaulting to `false` when no activation record exists — narrowing-only, per the
pre-existing runtime-overlay law).

`temporal-authority.test.ts` proves this with real assertions (not just types):

- `'keeps a registered interaction statically exposed while its runtime gate is false'` — a
  registered MCP tool with `runtimeEnabled: false` still appears in the effective view's
  `currentStaticExposures`, with `runtimeEnabled: false` attached, not removed.
- `'rejects operational activation that invents an unregistered static exposure'` — an overlay
  activation referencing a `registrationId` with no matching `CanonicalService.currentStaticExposures`
  entry fails `validateRuntimeOverlay()` with `OPERATIONAL_ACTIVATION_WITHOUT_STATIC_EXPOSURE`.
- `'keeps current static exposure unchanged when operational activation changes'` — toggling
  `runtimeEnabled` between two overlays never changes the exposure's identity fields
  (`registrationId`, `exposureShape`, `provenance`), only the attached activation state.
- `'does not infer external publication from mounted code'` — a registered exposure with no
  publication evidence supplied projects `externalPublication: { kind: 'UNMEASURED' }`, the
  existing `Unmeasured` sentinel (never `false`, never `true` by default) — satisfying §XIV's
  "do not assert external publication unless measured."

## X. Provenance

Every `CurrentStaticProtocolExposure`/`CurrentStaticUtilityExposure`/
`CurrentX402ProtocolCapability`/`CurrentBazaarProjectionSupport` carries a `provenance` object
naming the exact source package, module, registration id, and derivation method — e.g. A2A's
provenance reads `sourceModule: 'src/constants.ts#SITEBORNE_SERVICE_IDS -> src/card.ts#skills'`,
answering "why does VCM claim this is currently exposed?" without any reference to the frozen
registry declaration. `runtimeSourceCommit` (a `GitSha`, not a timestamp) is included per-call
(supplied by the importer's `ImportOptions`, the same mechanism `CurrentX402ProtocolCapability`
etc. already used) rather than a wall-clock time, so it does not introduce digest volatility.

## XI. Registry round-trip parity — still 8/8, current exposure does not leak

```
REGISTRY_FILES_DISCOVERED=8
REGISTRY_FILES_PARITY_PASS=8
REGISTRY_FILES_PARITY_FAIL=0
REGISTRY_STRUCTURAL_PARITY=8/8 PASS
```

The critical negative-test requirement from §XVII is implemented directly in
`legacy/project-registry.test.ts`'s `'projects the frozen release declaration even when current
MCP code is registered'`: a service is given a synthetic `currentStaticExposures` entry claiming
current MCP registration, then `projectOneService()` is called — the reconstructed legacy
`protocols.mcp` value is still `'planned'` (the frozen release declaration), proving
`vcmToLegacyRegistry()` emits the release declaration, never current exposure, regardless of what
current exposure the model carries.

## XII. OpenAPI current exposure — blocked, no typed manifest

Inspected `apps/edge-api/src/control-plane/routes/x402-service.ts` and the OpenAPI generator
(`packages/pcc-schema/scripts/generate-openapi.ts`, previously discovered in
METADATA-VCM-IMPL-01 to hand-derive `operationId`s and error shapes by direct reverse-engineering
of the route file). No exported, typed route/operation manifest exists that a pure adapter could
consume — the generator itself works by reading `schemas/common/` and `schemas/services/` plus
hand-authored constants, not a runtime route registry object.

```
OPENAPI_CURRENT_AUTHORITY=NO_TYPED_MANIFEST
```

Per §XII, this checkpoint does **not** parse route source text or duplicate the route table to
force a green result. The smallest future source change that would unblock this is exporting the
route table the OpenAPI generator's hand-authored `operationId`/error-shape mapping is already
implicitly derived from, as a typed const from `apps/edge-api` — that refactor falls outside
`packages/vcm` and is explicitly out of this checkpoint's scope (§II), so it is recorded here as
a blocker for a future protocol-package checkpoint, not implemented.

## XIII. x402 current capability — typed authority available, implemented

Inspected `@siteborne/protocol-x402`'s exports. Two facts have a single, already-typed,
already-authoritative source and needed only a pure adapter:

- **x402 protocol capability** (version + scheme×network support):
  `SUPPORTED_X402_VERSION` (`src/version.ts`) and `SITEBORNE_SUPPORTED_X402_SCHEMES`
  (`src/network/schemes.ts`) — the same constants the real x402 challenge/discovery code uses.
  `current-authority-inputs.ts`'s `deriveCurrentProtocolAuthorityInputs()` maps these directly
  into `CurrentX402ProtocolCapability`, reusing the existing scheme/network support authority
  and `x402Version` authority rather than copying values into VCM by hand.

```
X402_CURRENT_AUTHORITY=@siteborne/protocol-x402#SUPPORTED_X402_VERSION + #SITEBORNE_SUPPORTED_X402_SCHEMES
```

Explicitly **not** collapsed into `x402=true`: paid REST route exposure (blocked, §XII, same
missing manifest), runtime economic admission (already modeled as an overlay-only fact via
`economicAdmissionEnabled`, unchanged by this checkpoint), and Bazaar publication (§XIV, kept
separate) are each their own fact.

## XIV. Bazaar publication semantics

`@siteborne/protocol-x402`'s `ALL_BAZAAR_SERVICE_IDS` (`src/bazaar/registry-source.ts`) is a real,
typed, already-existing source: the exact list of canonical service ids Bazaar projection *can*
be locally constructed for today. `deriveCurrentProtocolAuthorityInputs()` validates every id in
that list resolves to a real canonical service (`UNKNOWN_BAZAAR_SERVICE` otherwise — a negative
test, §XX) and produces:

```
CurrentBazaarProjectionSupport {
  projectionSupported: true,   // a local Bazaar record CAN be constructed
  serviceIds: [... 8 ids ...],
  provenance: { sourcePackage: '@siteborne/protocol-x402', ... }
}
```

`externalPublication` (whether that record has actually been submitted to / is indexed by a real
Bazaar listing service) is **not** asserted anywhere by this fact — no such evidence source
exists in the repository, so it is not fabricated. `projectionSupported: true` answers only "can
a Bazaar record be built," which is exactly the `CURRENT_STATIC` half of §XIV's required split;
the `OPERATIONAL`/external-evidence half is left `UNMEASURED` by construction (no field asserts
publication at all — the type has no boolean for it), consistent with the `Unmeasured` sentinel
pattern used everywhere else in this checkpoint for unmeasured facts.

```
BAZAAR_CURRENT_AUTHORITY=@siteborne/protocol-x402#ALL_BAZAAR_SERVICE_IDS (projection-capability only; external publication not modeled — no source exists)
```

## XV. Catalog semantics — blocked, no typed manifest

Inspected `apps/edge-api/src/control-plane/routes/catalog.ts` and
`apps/edge-api/tests/catalog-d1-wiring.test.ts`. Catalog membership is runtime-filtered through a
D1-backed route handler at request time (environment/database-dependent), not derived from a
static, typed, service-set membership list VCM could import as a pure current-static fact.

```
CATALOG_CURRENT_AUTHORITY=NO_TYPED_MANIFEST (runtime/D1-filtered, OPERATIONAL_NOT_STATIC)
```

Per §XI's classification requirement, this is `OPERATIONAL_NOT_STATIC`, not merely a missing
typed source — catalog eligibility is inherently a runtime fact (route + database state), so no
future *static* source refactor would make it a `CanonicalStaticModel` fact; it belongs on the
runtime overlay in a future checkpoint, not here.

## XVI. Registry architecture preserved (TARGET_D)

No code in this checkpoint writes to `registry/services/*.json`. The flow implemented is exactly:

```
ACCEPTED RELEASE REGISTRY (registry/services/*.json, immutable evidence)
        |  legacyRegistryToVCM()
        v
CanonicalStaticModel.releaseProtocolExposureDeclared  (preserved verbatim)
CanonicalStaticModel.currentStaticExposures            (derived from current code, §VI/§VII)
        |
        v
EffectiveMetadataView (adds operational activation, §IX)
```

`vcmToLegacyRegistry()` reads only the `release*` fields when reconstructing a legacy file (§XI);
it has no code path that could read `currentStaticExposures` into a projected file.

## XVII. Digest semantics

Applying the pre-existing digest law from METADATA-VCM-IMPL-02 (§ Digest behavior: "whole object
minus named volatile fields, nothing else is excluded") mechanically, without ad hoc decisions:

- `currentStaticExposures` is a normal field on `CanonicalService` (no volatility — its only
  identity-shaped content is `surface`/`registrationId`/`operationId`/`exposureShape`/
  `provenance`, and `provenance` deliberately excludes any timestamp per §V/§X) → **participates
  in `computeServiceDigest`/`computeModelDigest`**, same as every other static field.
- `currentStaticUtilityExposures` and the two current-protocol-authority-input fields
  (`currentX402ProtocolCapability`, `currentBazaarProjectionSupport`) live on
  `CanonicalStaticModel` directly (model-level, not per-service, since they are not
  service-scoped facts) → **participate in `computeModelDigest`** by the same rule.
- `protocolActivations` on `RuntimeStateOverlay` → **participates in
  `computeRuntimeOverlayDigest`** (an operational fact, correctly excluded from the static-side
  digests).

`digests.test.ts` proves all three required behaviors with real assertions, not just following
the rule by inspection:

```
it('changes the model digest when current static exposure changes')      -> PASS
it('changes the model digest when a release declaration value changes')  -> PASS (existing test, re-verified)
it('does NOT change the model digest when operational activation changes only') -> PASS
it('changes the runtime overlay digest when protocolActivations change') -> PASS
```

14 digest tests total (was 10 after METADATA-VCM-IMPL-02), all passing.

## XVIII. TDD — RED before GREEN

RED was recorded for the actual, real pre-implementation failures, not manufactured:

1. `current-exposure.test.ts` and `temporal-authority.test.ts` were written first, importing
   `deriveCurrentCodeExposure`/temporal types that did not yet exist — RED confirmed by running
   both files against the pre-implementation source (module-not-found / type errors surfaced as
   real test failures).
2. `import-registry.test.ts`'s new vocabulary test (asserting `'live'` is rejected and the real
   5-value schema vocabulary is accepted) initially failed because the pre-checkpoint
   `LegacyProtocolsBlock` type had not yet been narrowed to `ReleaseProtocolExposureValue`.
3. `registry-parity.test.ts`'s `'derives current A2A and MCP exposure independently of frozen
   planned declarations'` test failed before the adapters existed (no `currentStaticExposures`
   field on the imported model at all).

Each was driven to GREEN by implementing only the code needed to satisfy it, in the order:
temporal types → A2A/MCP adapters → operational/publication split → x402/Bazaar typed inputs →
digest law → registry-wide reconciliation. No test was weakened to pass; the systemic-violation
test pattern from METADATA-VCM-IMPL-02 (update the assertion to the corrected behavior, keep the
historical record in the test's own description) was reused for the vocabulary test.

## XIX. Negative tests (§XX requirement)

All ten required negative tests are implemented across `current-exposure.test.ts`,
`current-authority-inputs.test.ts`, `temporal-authority.test.ts`, and
`legacy/import-registry.test.ts`:

| Requirement                                                     | Test | Error code |
|---|---|---|
| frozen release declaration cannot set current exposure           | registry-parity.test.ts (real-data, §IV/§XI) | n/a — structural, no field reads it |
| current code exposure cannot alter frozen registry round-trip    | project-registry.test.ts (§XI)     | n/a — structural |
| runtime activation cannot alter current static exposure          | temporal-authority.test.ts (§IX)   | n/a — structural, proven by digest law too |
| unknown service registration rejected                            | current-exposure.test.ts           | `UNKNOWN_SERVICE` |
| duplicate current interaction registration rejected               | current-exposure.test.ts           | `DUPLICATE_REGISTRATION` |
| duplicate protocol+operation exposure rejected                   | current-exposure.test.ts           | `DUPLICATE_PROTOCOL_OPERATION` |
| current exposure referring to nonexistent canonical service rejected | current-exposure.test.ts        | `UNKNOWN_SERVICE` |
| unsupported exposure shape rejected                               | current-exposure.test.ts           | `UNSUPPORTED_EXPOSURE_SHAPE` |
| operational activation cannot invent static exposure              | temporal-authority.test.ts         | `OPERATIONAL_ACTIVATION_WITHOUT_STATIC_EXPOSURE` |
| external publication cannot be inferred from mounted code         | temporal-authority.test.ts         | n/a — asserts `UNMEASURED` |
| (bonus) unknown Bazaar-declared service rejected                  | current-authority-inputs.test.ts   | `UNKNOWN_BAZAAR_SERVICE` |
| (bonus) unsupported registry protocol-status value rejected       | import-registry.test.ts            | type-level / parse rejection |

## XX. Regression suite (all run this session, isolation-verified)

```
VCM unit tests               88/88 PASS  (11 files)
Repo typecheck                24/24 PASS (turbo, all cached except vcm)
Repo lint (vcm)                    PASS  (eslint src/, zero warnings)
Prettier (packages/vcm/src)        PASS
Secret scan (scope verify)         PASS  (1556 tracked files)
Secret scan (gitleaks, full history) PASS (828 commits, no leaks)
Secret scan (working tree)         PASS  (1556 files)

A2A/MCP/x402/Bazaar tests    650/650 PASS (44 files)
OpenAPI generate:check             PASS  ("ALL 3 OPENAPI FILES MATCH - NO DRIFT")
pricing:check                      PASS  ("EMBEDDED_PRICING matches governance/RISK_LIMITS.yaml exactly")
schemas:check                      PASS  (validators up to date, no drift)
services:generate:check            PASS  ("ALL 18 MODELS MATCH - NO DRIFT")
governance:validate                PASS  (77/77 validations)
contracts:baseline:verify          PASS  ("Baseline verification passed")
catalog tests (x402 + edge-api)    9/9 PASS (3 files)
```

**Aggregate-suite timeout note**: an earlier `pnpm test` run across the full 304-file suite
reported 17 timeout/performance failures (15 D1-reconciliation cases at a 5s ceiling, one OCR
subprocess at a 60s ceiling, one burst-load p95 ceiling) — none in a file this checkpoint's diff
touches. This session re-ran the three representative files by name in isolation
(`apps/edge-api/tests/settlement-reconciliation.test.ts`,
`packages/service-runtime/src/services/document-evidence/worker-bridge.subprocess.test.ts`,
`apps/edge-api/tests/load-v2.test.ts`) and all **17/17 passed** with no timeout, confirming
shared-host resource contention from running all 304 files concurrently, not a regression
introduced by this checkpoint (whose entire diff is `packages/vcm/**` + `pnpm-lock.yaml`).

```
CANONICAL_ECONOMIC_VALIDITY=8/8 PASS (unchanged from METADATA-VCM-IMPL-02)
REGISTRY_STRUCTURAL_PARITY=8/8 PASS
```

## XXI. Zero-behavior-change proof

```
git diff --stat` (both commits): every changed path is under packages/vcm/, plus pnpm-lock.yaml.

A2A_PUBLIC_OUTPUT_CHANGE=NO       (protocol-a2a source unchanged; its own tests still pass unchanged)
MCP_PUBLIC_OUTPUT_CHANGE=NO       (protocol-mcp source unchanged; its own tests still pass unchanged)
OPENAPI_PUBLIC_OUTPUT_CHANGE=NO   (openapi:generate:check: zero drift)
X402_PUBLIC_OUTPUT_CHANGE=NO      (protocol-x402 source unchanged; 650/650 x402/Bazaar tests unchanged)
BAZAAR_PUBLIC_OUTPUT_CHANGE=NO    (same)
CATALOG_PUBLIC_OUTPUT_CHANGE=NO   (catalog route/tests unchanged, 9/9 pass)

CURRENT_PROJECTION_CONSUMERS_CHANGED=0
AUTHORITY_INVERSION=NO
```

No production code imports `@siteborne/vcm` (verified: `grep -r "@siteborne/vcm"` outside
`packages/vcm/` returns nothing).

## XXII. Shadow-readiness re-evaluation (VCM-05 gate)

```
SHADOW_A2A_PROJECTION      = READY   (current exposure derived from real code, 8/8 parity, provenance-backed)
SHADOW_MCP_PROJECTION      = READY   (current exposure derived from real code, 6/6 parity, service/utility split correct)
SHADOW_OPENAPI_PROJECTION  = BLOCKED_BY_NO_TYPED_SOURCE_AUTHORITY   (§XII)
SHADOW_X402_PROJECTION     = BLOCKED_BY_NO_TYPED_SOURCE_AUTHORITY   (paid-route exposure only; protocol capability itself is now typed and available, §XIII)
SHADOW_BAZAAR_PROJECTION   = BLOCKED_BY_OPERATIONAL_EVIDENCE        (projection-capability is READY-equivalent; external publication is unmeasured, §XIV)
SHADOW_CATALOG_PROJECTION  = BLOCKED_BY_OPERATIONAL_EVIDENCE        (§XV — inherently runtime, not a missing-source problem)
```

Per §XXII, the checkpoint passes because A2A and MCP are both READY; the remaining four surfaces
are honestly blocked by real, documented gaps rather than fabricated authority.

## XXIII. Schema version

```
VCM_SCHEMA_VERSION_BEFORE=0.2.0
VCM_SCHEMA_VERSION_AFTER=0.3.0
```

A shape change (temporal split adds multiple new fields to `CanonicalService` and
`CanonicalStaticModel`) under the same discipline-marker policy established in
METADATA-VCM-IMPL-02 §IX — zero external consumers, so no compatibility break is possible; the
bump is a marker, not a compatibility gate.

## XXIV. Commit discipline

```
VCM_IMPL_03A_IMPLEMENTATION_COMMIT=cfbb9c7987e77cea1d06b6c35fe10aea0fc5bf2b
VCM_IMPL_03A_EVIDENCE_COMMIT=<this report's own commit, recorded after commit>
```

## XXV. Required final return

```
METADATA_VCM_IMPL_03A=PASS

PARENT_VCM_IMPL_02=cc46c3a87781824ac2fc56e5d86966cd0c137ad0
PARENT_VCM_05=4b48888b323939d92783f6c3e18bd7ee914eaedf

VCM_IMPL_03A_IMPLEMENTATION_COMMIT=cfbb9c7987e77cea1d06b6c35fe10aea0fc5bf2b
VCM_IMPL_03A_EVIDENCE_COMMIT=<see chat return>

VCM_SCHEMA_VERSION_BEFORE=0.2.0
VCM_SCHEMA_VERSION_AFTER=0.3.0

RELEASE_PROTOCOL_FIELD_NAME=releaseProtocolExposureDeclared
RELEASE_BASE_PRICE_FIELD_NAME=releaseBasePriceDeclared
RELEASE_MAXIMUM_PRICE_FIELD_NAME=releaseMaximumPriceDeclared

REGISTRY_PROTOCOL_STATUS_VALUES=["planned","scaffolded","tested","enabled","not_enabled"]

A2A_REGISTRATION_AUTHORITY=@siteborne/protocol-a2a#SITEBORNE_SERVICE_IDS
A2A_REGISTERED_EXPOSURES=8
VCM_A2A_CURRENT_EXPOSURES=8
A2A_CURRENT_EXPOSURE_PARITY=PASS

MCP_REGISTRATION_AUTHORITY=@siteborne/protocol-mcp#MCP_SERVICE_TOOLS+#MCP_TOOL_NAMES
MCP_REGISTERED_INTERACTIONS=6
VCM_MCP_CURRENT_INTERACTIONS=6
MCP_CURRENT_EXPOSURE_PARITY=PASS

OPENAPI_CURRENT_AUTHORITY=NO_TYPED_MANIFEST
X402_CURRENT_AUTHORITY=@siteborne/protocol-x402#SUPPORTED_X402_VERSION+#SITEBORNE_SUPPORTED_X402_SCHEMES (protocol capability only; paid-route exposure NO_TYPED_MANIFEST)
BAZAAR_CURRENT_AUTHORITY=@siteborne/protocol-x402#ALL_BAZAAR_SERVICE_IDS (projection-capability only; external publication UNMEASURED, no source exists)
CATALOG_CURRENT_AUTHORITY=NO_TYPED_MANIFEST (OPERATIONAL_NOT_STATIC)

REGISTRY_STRUCTURAL_PARITY=8/8 PASS
CANONICAL_ECONOMIC_VALIDITY=8/8 PASS

VCM_UNIT_TESTS=88/88 PASS
TYPECHECK=PASS (24/24)
LINT=PASS
FORMAT_VCM_SCOPE=PASS
SECRET_SCAN=PASS
EXISTING_REGRESSION_TESTS=650/650 PASS (A2A/MCP/x402/Bazaar) + 9/9 (catalog) + zero-drift (OpenAPI/pricing/schemas/services/governance/contracts)

SHADOW_A2A_PROJECTION=READY
SHADOW_MCP_PROJECTION=READY
SHADOW_OPENAPI_PROJECTION=BLOCKED_BY_NO_TYPED_SOURCE_AUTHORITY
SHADOW_X402_PROJECTION=BLOCKED_BY_NO_TYPED_SOURCE_AUTHORITY
SHADOW_BAZAAR_PROJECTION=BLOCKED_BY_OPERATIONAL_EVIDENCE
SHADOW_CATALOG_PROJECTION=BLOCKED_BY_OPERATIONAL_EVIDENCE

SAFE_TO_BEGIN_SHADOW_PROJECTION_PARITY=YES (scoped to A2A + MCP only)

NEXT_IMPLEMENTATION_CHECKPOINT=METADATA-VCM-IMPL-03B (A2A + MCP shadow projection parity only; OpenAPI/x402-route/Bazaar-publication/catalog remain blocked pending the source refactors identified in §XII/§XV of this report)

CURRENT_PROJECTION_CONSUMERS_CHANGED=0
AUTHORITY_INVERSION=NO

REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
CONTRACT_MUTATIONS=0
PROTOCOL_BEHAVIOR_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0

REPORT=docs/reports/METADATA-VCM-IMPL-03A-current-exposure-temporal-authority.md
```
