# METADATA-VCM-IMPL-01 — Truth Core + Legacy Registry Parity

**Status: BLOCKED** (not PASS — see §VII). Shadow implementation only. No existing metadata
consumer changed. No registry, governance, protocol-projection, runtime, or production file
was mutated.

## Frozen design authority

```
FROZEN_DESIGN_DOCUMENT = docs/reports/METADATA-VCM-MASTER-canonical-reference.md
FROZEN_DESIGN_DIGEST   = sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096
FROZEN_BASELINE_DIGEST_MATCH = YES (packages/vcm/src/baseline.test.ts recomputes this digest
                                     directly from the document on every test run)
```

Parts I–III and Master Synthesis were treated as immutable throughout. No section of that
document was edited. The reserved post-freeze ideas (machine-routing vocabulary, Bazaar-native
economics, `server/discover`, external-evidence separation, supersession semantics,
timeout/rate-limit metadata, caller-visible error taxonomy) were **not** implemented here.

## I. What was built

```
packages/vcm/
  package.json, tsconfig.json
  src/
    index.ts             -- public API
    baseline.ts           -- VCM_BASELINE provenance constant
    sentinels.ts           -- Unknown_/Unmeasured/NotConfigured/NotApplicable
    primitives.ts           -- SemVer/Sha256Digest/IsoTimestamp/GitSha/UriString/EvmAddress/UsdAmount
    versions.ts              -- the 9 constructible version namespaces
    service-id.ts             -- ServiceFamily/CanonicalServiceId/CanonicalServiceIdValue
    types.ts                   -- CanonicalStaticModel and everything under it
    evidence.ts                  -- EvidenceRef, MetadataRelease
    runtime-overlay.ts            -- RuntimeStateOverlay and its sub-types
    effective-view.ts               -- project() resolver, EffectiveMetadataView
    canonical.ts                     -- reuse of @siteborne/pcc-schema's JCS canonicalizer
    digests.ts                        -- the 5 frozen digest functions
    validators.ts                      -- validateCanonicalModel/EconomicConstraints/
                                           SecurityTruthConstraints/RuntimeOverlay/DigestIntegrity
    legacy/
      types.ts                          -- faithful LegacyRegistryServiceFile shape
      pricing-map.ts                     -- CanonicalServiceId -> @siteborne/pricing PricingKey
      contract-map.ts                     -- generation -> {contractReleaseVersion, pccSchemaRelease}
      import-registry.ts                   -- legacyRegistryToVCM()
      project-registry.ts                   -- vcmToLegacyRegistry()
      parity.ts                              -- checkRegistryParity()
    *.test.ts colocated next to every module above (repo convention, not a separate test/ dir)
```

Shared, additive-only registration (no other line touched):

```
tsconfig.base.json  +1 line: "@siteborne/vcm": ["packages/vcm/src"]
vitest.config.ts    +1 line: '@siteborne/vcm': path.resolve(__dirname, 'packages/vcm/src')
```

`git status --short` confirms these are the only two pre-existing files touched, plus the
expected `pnpm-lock.yaml` update from registering the new workspace package.

## II. Mechanical open items resolved (§V)

Direct repository inspection, not architecture redesign. `MECHANICAL_OPEN_ITEMS_RESOLVED=4`
(the four named in the implementation prompt) `+1` (discovered while building the importer,
resolved the same way).

| Item | Source | Observed | Semantic design change required? |
|---|---|---|---|
| `LifecycleState` | `governance/PROMOTION_STATES.yaml:4-84` | **8** states: `DRAFT, CASE_SUPPORTED, MULTI_CASE_SUPPORTED, VERIFIED_PATTERN, EXECUTABLE_CANDIDATE, EXECUTABLE_VERIFIED, RETIRED, TOMBSTONED`. The frozen Master Reference's own prose listed 7 and omitted `EXECUTABLE_CANDIDATE`. | NO — filling in an already-designed closed union. |
| `LatencyClass` | `registry/services/*.json`, all 8 files | `{"slow", "variable"}` only. No `"fast"` anywhere. | NO |
| `AuthorizationClassification` | same | `{"buyer_authorized", "public"}` | NO |
| mTLS capability | `packages/protocol-a2a/src/card.ts:126-182` | Already implements exactly the IMPLEMENTED/CONFIGURED-vs-ACTIVE gate the frozen design requires: `mtlsProductionActive` (default `false`) controls whether `securitySchemes.mtlsSecurityScheme` is ever emitted. | NO — `'mtls'` added as a closed `SecurityMechanism.kind` member. |
| Pricing-tier key mapping (discovered while building the importer, not one of the 4 named items) | `governance/RISK_LIMITS.yaml:11-26` cross-referenced against all 8 registry files' `base_price`/`maximum_price` | Not a slug transform — an irregular per-family lookup (`legacy/pricing-map.ts`). `document_evidence_json` has 3 priced sub-operations + 1 shared unversioned ceiling key; the other 3 families have one "primary" tier key per generation. `company_evidence_graph` has no governance key at all for its `maximum_price`. | NO for the mapping shape (mechanical, implemented as a lookup table) — **but see §III**, a related real-data question was escalated rather than resolved unilaterally. |

`SEMANTIC_DESIGN_DELTAS_DISCOVERED=1` (§III below).

No live Cloudflare query was performed for A2A key activation, per instruction — `mtls`/`a2a_card_signing` are both imported as static-ceiling-only (`IMPLEMENTED`/`CONFIGURED`), never `ACTIVE`/`VERIFIED`.

## III. SEMANTIC_DESIGN_DELTA_DISCOVERED=YES — real, present-day economic-ceiling violation

While building `legacyRegistryToVCM()`'s economic-ceiling validation, real data (not a
synthetic test case) was found to violate the frozen invariant `listPrice <= governedMaxPrice`.
This was escalated to the user before writing the importer, per this checkpoint's explicit
instruction to stop rather than silently reinterpret the design. **The initial escalation
under-scoped the finding as a single isolated case (`company_evidence_graph.v2` only); running
the validator against the complete 8-file registry (not a hand-picked file) revealed it is
systemic:**

```
ECONOMIC_CEILING_VIOLATION x4 (confirmed by packages/vcm/src/validators.test.ts, real registry data):

  company_evidence_graph.v2:   base_price 0.039 USD  >  governed ceiling 0.0312 USD  (company_evidence_graph_v2)
  document_evidence_json.v2:   base_price 0.012 USD  >  governed ceiling 0.0098 USD  (document_evidence_json_native_v2)
  verify_agent_output.v2:      base_price 0.019 USD  >  governed ceiling 0.017  USD  (verify_agent_output_standard_v2)
  web_context_verified.v2:     base_price 0.009 USD  >  governed ceiling 0.008  USD  (web_context_verified_direct_v2)
```

Pattern: **all four `.v2` registry files' `base_price` are byte-identical to their `.v1`
counterparts**, while `governance/RISK_LIMITS.yaml`'s dedicated `_v2` governance ceiling for
every one of them is lower. This strongly suggests none of the four `.v2` registry files' list
prices were ever updated when their generation-specific (lower) governance ceilings were
introduced — a single root cause across all four, not four independent problems.

Per the user's explicit resolution:

```
SEMANTIC_DESIGN_DELTA_DISCOVERED=YES
IMPLEMENTATION_BLOCKED_BY_DESIGN_DELTA=YES
ECONOMIC_CEILING=FAIL
AUTHORITY_INVERSION=NO
REGISTRY_MUTATIONS=0
```

**`LEGACY_PARITY ≠ CANONICAL_VALIDITY`.** `legacyRegistryToVCM()` does **not** throw on this —
it preserves and reports the real observed values, so the round-trip parity proof (a distinct
concern: "did we reproduce what exists") can still run to completion (§VI: 8/8 PASS).
`validateEconomicConstraints()` is a separate, non-fatal-to-import validation pass that
correctly detects and reports all four violations, and that is what drives this checkpoint's
overall `BLOCKED` status. This package does **not** choose among the four possible
explanations (base_price is a different concept that's allowed to exceed this ceiling / the
registry value is stale / the governed ceiling is stale / the frozen economic model mis-mapped
these two fields) — that decision requires a separate, governed checkpoint.

## IV. Exact VCM public API

See `packages/vcm/src/index.ts` for the full re-export surface. Root types:
`CanonicalStaticModel`, `RuntimeStateOverlay`, `EffectiveMetadataView`; root functions:
`project()`, `legacyRegistryToVCM()`, `vcmToLegacyRegistry()`, `checkRegistryParity()`,
`validateCanonicalModel()`, `validateEconomicConstraints()`, `validateSecurityTruthConstraints()`,
`validateRuntimeOverlay()`, `validateDigestIntegrity()`.

## V. Digest rules implemented

Exactly the five frozen classes (`packages/vcm/src/digests.ts`), each reusing
`@siteborne/pcc-schema`'s JCS canonicalizer via `packages/vcm/src/canonical.ts` (mirrors
`packages/verification/src/canonical.ts`'s own reuse pattern — no second canonicalization
implementation introduced). `modelDigest` excludes `compiledAt`/`vcmReleaseVersion`/itself;
`runtimeOverlayDigest` excludes `observedAt`/`measuredAt`; `effectiveViewDigest` excludes
`generatedAt`. Verified by `digests.test.ts`: timestamp-only changes produce identical digests;
semantic changes (title, economic ceiling, schema digest) change the digest; service-array
reorder does not change `modelDigest` (canonically set-like, sorted before hashing).

## VI. Registry parity law — the central acceptance test

```
REGISTRY_FILES_DISCOVERED   = 8
REGISTRY_FILES_PARITY_PASS  = 8
REGISTRY_FILES_PARITY_FAIL  = 0
REGISTRY_STRUCTURAL_PARITY  = PASS
```

`packages/vcm/src/legacy/registry-parity.test.ts` runs `legacyRegistryToVCM` →
`vcmToLegacyRegistry` → `checkRegistryParity` against every real file in
`registry/services/*.json` (not fixtures) and asserts JCS-canonicalized structural equality —
the strongest feasible law for this transition, since the on-disk files were never themselves
run through the canonicalizer (byte equality is a documented, not-yet-taken, follow-on hardening
step). This passes independently of §III's economic-ceiling finding: importing preserves the
real (violating) values losslessly rather than rejecting them.

## VII. Negative / mutation tests

`RED -> implementation -> GREEN` discipline followed throughout — each test below was
confirmed to fail against a stub/no-op implementation before the real logic was written.

| Required case | Test |
|---|---|
| malformed service id | `legacy/import-registry.test.ts` |
| family/generation mismatch | `legacy/import-registry.test.ts` |
| duplicate service id | `validators.test.ts` |
| duplicate operation id within service | `validators.test.ts` |
| malformed SHA-256 digest | `validators.test.ts`, `primitives.test.ts` |
| malformed URI / EVM address / SemVer / GitSha / IsoTimestamp / UsdAmount | `primitives.test.ts` |
| list price > governed maximum | `validators.test.ts` (synthetic case) **and the real 4-violation case** |
| unsupported payment scheme/network | `validators.test.ts` |
| unknown overlay service | `validators.test.ts` |
| unknown overlay operation | `validators.test.ts` |
| overlay attempts to widen protocol exposure | `effective-view.test.ts` |
| overlay price > governed ceiling | `validators.test.ts` |
| ACTIVE claim without supporting operational evidence | `validators.test.ts`, `effective-view.test.ts` |
| VERIFIED claim without verification evidence | `effective-view.test.ts` (UNMEASURED falls back to static ceiling) |
| nondeterministic input ordering | `digests.test.ts` (service-array reorder) |
| self-inconsistent model digest | `validators.test.ts` |
| duplicate evidence references where forbidden | **not implemented** — `MetadataRelease`/evidence-list construction is not exercised by this checkpoint's importer (no adapter constructs one yet); flagged as a gap rather than falsely claimed covered. |
| schema hash mismatch / missing referenced schema | **not implemented** — this checkpoint trusts the registry's own recorded digest rather than re-fetching and re-hashing referenced schema documents (explicitly out of scope for a metadata transformation, per §XVII's three named input sources). |

## VIII. Regression gates

```
VCM_UNIT_TESTS              = 58 passed, 0 failed (7 test files)
NEGATIVE_INVARIANT_TESTS    = included in the 58 (see §VII)
TYPECHECK                   = PASS (packages/vcm scoped: tsc --noEmit clean;
                                     repo-wide: `pnpm typecheck` via turbo, 24/24 tasks PASS)
LINT                        = PASS (packages/vcm scoped: eslint src/, 0 errors/warnings)
FORMAT_VCM_SCOPE             = PASS (prettier --check, after --write normalized 15 new files)
FORMAT_REPO_WIDE              = NOT_RE-VERIFIED (pre-existing repo-wide formatting backlog, if
                                  any, was not re-scanned this checkpoint — only the files this
                                  checkpoint touched were checked)
SECRET_SCAN                   = PASS (secrets:scope:verify PASS; gitleaks git --all PASS,
                                  0 leaks in 819 commits; scan-working-tree-secrets PASS)
GOVERNANCE_VALIDATE            = PASS (77/77, unaffected by this checkpoint's changes)
```

Existing generation/drift checks (proof that nothing this checkpoint's shared-config edits
touch actually changed):

```
OPENAPI_NON_REGRESSION   = PASS (`pnpm openapi:generate:check` — 3/3 files match, no drift)
PCC schema generation     = PASS (`pnpm pcc:generate:check` — TS + Python models match committed)
Service schema generation  = PASS (`pnpm services:generate:check` — 18/18 models match)
A2A_NON_REGRESSION          = PASS (`protocol-a2a` test suite — 54/54 tests, unchanged)
MCP_NON_REGRESSION           = PASS (`protocol-mcp` test suite — 78/78 tests, unchanged)
X402_NON_REGRESSION           = PASS (`protocol-x402` test suite — 512/512 tests, unchanged)
BAZAAR_NON_REGRESSION          = PASS (bazaar tests live inside the same protocol-x402 suite
                                   above: schema-bundle.test.ts, catalog-status.test.ts — both green)
CATALOG_NON_REGRESSION          = NOT_DIRECTLY_MEASURED (no dedicated catalog snapshot/check
                                   script exists in this repo; registry/services/*.json, the
                                   catalog's own source, is confirmed untouched by `git status`)
```

## IX. Explicit list of things NOT changed

```
registry/services/*.json           -- untouched (confirmed via git status)
governance/*.yaml                  -- untouched
PROJECT_STATE.yaml / TASKS.yaml    -- untouched
schemas/services/*                 -- untouched
packages/contracts/*               -- untouched
packages/protocol-{a2a,mcp,x402,nevermined}/*  -- untouched
existing catalog generation        -- untouched
OpenAPI generation                 -- untouched (drift-checked: no change)
edge-api runtime behavior          -- untouched
Cloudflare configuration / production variables / secrets / deployment state -- untouched,
                                        never read
pricing values / service ids / service descriptions / protocol-exposure values -- untouched
```

The only pre-existing files touched are `tsconfig.base.json` and `vitest.config.ts`, each by
exactly one additive line registering `@siteborne/vcm`'s path/alias — no existing package's
resolution changed.

## X. Next eligible checkpoint

This checkpoint does **not** clear the path to drift correction, projection cutover, authority
inversion, or `METADATA-VCM-04` on its own — it surfaces a real blocker that needs a decision
first:

1. **A new, narrowly-scoped governed checkpoint** to determine, for the four `.v2` economic
   violations found in §III, which of the four explanations is correct (base_price is a
   different concept / registry stale / governance stale / model mis-mapped) — this is a
   prerequisite for re-running this checkpoint to a real `PASS`.
2. Only after that: reviewed drift corrections (stale protocol exposure, pricing documentation,
   `PROJECT_STATE.yaml`/`TASKS.yaml` disposition, service-id-array duplication) — Master
   Reference Part I §14 steps 2+.
3. `METADATA-VCM-04` (machine-routing vocabulary, Bazaar-native economics, `server/discover`,
   external-evidence separation) remains explicitly out of scope until both of the above land.

## XI. Required final return

```
METADATA_VCM_IMPL_01=BLOCKED

FROZEN_DESIGN_DOCUMENT=docs/reports/METADATA-VCM-MASTER-canonical-reference.md
FROZEN_DESIGN_DIGEST=sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096
FROZEN_BASELINE_DIGEST_MATCH=YES

VCM_IMPLEMENTATION_COMMIT=<pending — see commit discipline note below>
VCM_EVIDENCE_COMMIT=NONE

PACKAGES_VCM_CREATED=YES

VCM_SCHEMA_VERSION=0.1.0
VCM_RELEASE_VERSION=intentionally-unreleased

MECHANICAL_OPEN_ITEMS_RESOLVED=5
SEMANTIC_DESIGN_DELTAS_DISCOVERED=1

STATIC_MODEL_VALIDATOR=PASS
RUNTIME_OVERLAY_VALIDATOR=PASS
EFFECTIVE_VIEW_RESOLVER=PASS
RUNTIME_CAN_ONLY_NARROW_STATIC=PASS

SECURITY_TRUTH_CEILING=PASS
ECONOMIC_CEILING=FAIL   -- 4 real violations (§III); detection is correct, source data is not

CANONICALIZATION=@siteborne/pcc-schema canonicalize()/hashCanonical() (JCS/RFC8785, reused not reimplemented)

MODEL_DIGEST_TESTS=PASS
SERVICE_DIGEST_TESTS=PASS
RUNTIME_OVERLAY_DIGEST_TESTS=PASS
EFFECTIVE_VIEW_DIGEST_TESTS=PASS
PROJECTION_DIGEST_PRIMITIVE_TESTS=PASS (generic primitive only -- no adapter wired)

REGISTRY_FILES_DISCOVERED=8
REGISTRY_FILES_PARITY_PASS=8
REGISTRY_FILES_PARITY_FAIL=0
REGISTRY_STRUCTURAL_PARITY=PASS

VCM_UNIT_TESTS=58 passed / 58 total
NEGATIVE_INVARIANT_TESTS=included above (see §VII for the 2 explicitly NOT covered)
EXISTING_REGRESSION_TESTS=PASS (A2A 54/54, MCP 78/78, x402 512/512, OpenAPI/PCC/schema-gen drift-checks all clean)
TYPECHECK=PASS (packages/vcm scoped + repo-wide 24/24)
LINT=PASS
FORMAT_VCM_SCOPE=PASS
FORMAT_REPO_WIDE=NOT_RE-VERIFIED
SECRET_SCAN=PASS

A2A_NON_REGRESSION=PASS
MCP_NON_REGRESSION=PASS
OPENAPI_NON_REGRESSION=PASS
X402_NON_REGRESSION=PASS
BAZAAR_NON_REGRESSION=PASS
CATALOG_NON_REGRESSION=NOT_DIRECTLY_MEASURED

EXISTING_PROJECTION_CONSUMERS_CHANGED=0
REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
PROTOCOL_PROJECTION_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0
AUTHORITY_INVERSION=NO

IMPLEMENTATION_REPORT=docs/reports/METADATA-VCM-IMPL-01-truth-core-and-registry-parity.md

SAFE_TO_BEGIN_REVIEWED_DRIFT_CORRECTIONS=NO -- the §III economic-ceiling question must be
  resolved by a dedicated governed checkpoint first; treating it as an ordinary "known drift"
  item would mean choosing among four possible explanations unilaterally, which this package
  explicitly declined to do.
```
