# METADATA-VCM-04 — Economic Authority Semantic Correction

Status: design/evidence checkpoint only. No mutation to `packages/vcm`, registry, governance,
pricing, runtime, protocol projections, or production is made by this document. It is an
**additive amendment** to the frozen baseline
(`sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096`), not an edit to it.
`METADATA-AUTHORITY-01`, `METADATA-VCM-02`, `METADATA-VCM-03`, and
`METADATA-VCM-MASTER-canonical-reference.md` are unmodified by this checkpoint.

```
FROZEN_MASTER_EDITED=NO
ADDITIVE_AMENDMENT=YES
```

This checkpoint incorporates the root cause proven, read-only, in
`docs/reports/METADATA-ECON-01-v2-pricing-reconciliation.md`
(evidence commit `2b17ba5`) and decides what the VCM schema/importer should become in the
*next* implementation checkpoint. It does not itself implement that correction.

---

## I. Root cause, restated as a design input (not re-derived)

```
PRICING_ROOT_CAUSE=MIXED
DOMINANT_CAUSE=VCM_SEMANTIC_MAPPING_ERROR
SAFE_TO_CORRECT_PRICING=NO   (nothing about the dollar values needs to change)
```

`registry/services/*.v2.json`'s `base_price` is a **frozen, release-scoped reference value**
— by explicit repository design, not oversight (`packages/protocol-x402/src/bazaar/registry-source.ts:9-11`:
*"Runtime economic amounts are projected from the governed pricing resolver below; the frozen
registry JSON is not an economic authority."*). `governance/RISK_LIMITS.yaml`'s
`max_price_usd_per_service` is the value every live consumer actually charges
(`ECON-01 §IV`: `DOES_REGISTRY_BASE_PRICE_AFFECT_REAL_CHARGE=NO`, confirmed for all 6 checked
public surfaces). `packages/vcm/src/legacy/import-registry.ts:254-255` reads the wrong one:

```ts
// packages/vcm/src/legacy/import-registry.ts:254-255 (current, incorrect)
listPrice: {
  amount: parseUsdAmount(legacy.base_price.amount),   // <- frozen release metadata
  currency: 'USD',
},
```

while `governedMaxPrice`, three lines earlier, already resolves correctly:

```ts
// packages/vcm/src/legacy/import-registry.ts:219 (current, correct)
const governedMaxAmount = resolveServiceMaxPriceUsd(pricingKey);
```

The fix is therefore narrow: make `listPrice` reuse the same resolved value `governedMaxPrice`
already uses, and give the frozen `base_price` bytes their own honestly-labeled home instead of
discarding them.

---

## II. Corrected authority classification

```
CONTRACT_RELEASE_PRICE_METADATA   (registry base_price / maximum_price)
  authority_class            = EVIDENCE / HISTORICAL (frozen release metadata)
  current_economic_authority = NO
  source                     = registry/services/*.json, frozen at contract-release time
  evidence                   = registry-source.ts:9-11 ("not an economic authority");
                                governance/CONTRACT_COMPATIBILITY.yaml:341,387
                                ("launch_price_metadata", compatibility_sensitive);
                                governance/CONTRACT_COMPATIBILITY.yaml:455 (prices_match,
                                part of the frozen contracts:baseline:verify snapshot)

CURRENT_GOVERNED_PRICE            (governance/RISK_LIMITS.yaml max_price_usd_per_service)
  authority_class            = NORMATIVE
  current_economic_authority = YES
  source                     = governance/RISK_LIMITS.yaml, revised under its own
                                20%-per-experiment governance cap
                                (price_change_per_experiment_pct, validateAtomicPriceChange)
  evidence                   = ECON-01 §IV (every live consumer resolves through this),
                                §X (embedded runtime mirror parity confirmed)

GOVERNED_MAX_PRICE                (same governance value, read as a ceiling)
  authority_class            = NORMATIVE (same fact as CURRENT_GOVERNED_PRICE, read twice
                                under two names -- see §V)
  current_economic_authority = YES

RUNTIME_EFFECTIVE_PRICE           (RuntimeStateOverlay.economics.effectiveRuntimePrice)
  authority_class            = DERIVED / OPERATIONAL
  derived_from                = CURRENT_GOVERNED_PRICE, narrowed by route enablement
                                (PAID_ROUTES_ENABLED and friends) -- unaffected by this
                                checkpoint, already correctly modeled in VCM-02/runtime-overlay.ts

QUOTED_TRANSACTION_AMOUNT         (a Quote's `amount`)
  authority_class            = transaction artifact
  VCM canonical state        = NO -- confirmed unaffected; still outside VCM entirely
                                (VCM-02 §"quotes excluded"; unchanged by this checkpoint)
```

`CURRENT_GOVERNED_PRICE` and `GOVERNED_MAX_PRICE` are named separately above only because the
frozen VCM-02 model asks for both a "what is charged" concept (`listPrice`) and a "what is the
ceiling" concept (`governedMaxPrice`). §V below determines whether that split earns its keep
for the data that exists today.

---

## III. Fate of `listPrice`

```
LIST_PRICE_DISPOSITION=B  (RETAIN, re-sourced from the current governed pricing authority)
```

Evaluated against the four options:

- **A. REMOVE** — rejected. `listPrice` ("the price a caller is normally charged") is a real,
  needed concept for every protocol projection that must answer "what does this cost" before
  invocation (VCM-03 §5: economics as first-class machine metadata). Removing it would leave
  no field answering that question.
- **B. RETAIN, re-source** — **chosen**. `listPrice` should resolve through the exact same
  path the runtime already uses for a live charge: `primaryPricingKey(family, generation)` →
  `resolveServiceMaxPriceUsd(...)` (the same call `governedMaxPrice` already makes). This is
  the smallest correction that makes the model match reality, and it requires touching exactly
  one field's data source, not the schema's shape.
- **C. RENAME** — rejected. The name `listPrice` is not the problem; its *source* is. Renaming
  without re-sourcing would still leave the field wrong.
- **D. SPLIT** — **also applies, but to a different fact.** The frozen registry bytes
  (`base_price`, and `maximum_price` for the three families where it is not already the
  `_max_job` ceiling) are a real, distinct, evidence-class fact that must not be discarded
  (needed for round-trip parity, §VII) and must not be confused with `listPrice`. See §IV.

So: **B for `listPrice` itself; D for the frozen bytes it used to be sourced from.** These are
not competing answers to the same question -- they are the correct answer to two different
questions the original design conflated.

---

## IV. Frozen release economics, modeled separately

Add one field to `ServiceEconomics`, a direct sibling of the `legacyMaximumPriceDeclared` field
that already exists for exactly this purpose (`packages/vcm/src/types.ts:86-95`):

```ts
export interface ServiceEconomics {
  readonly pricingPolicyVersion: PricingPolicyVersion;

  /** The price a caller is normally charged. Resolved from the current
   * governed pricing authority (governance/RISK_LIMITS.yaml via
   * primaryPricingKey()), NOT from the registry's frozen `base_price`.
   * See METADATA-VCM-04 §I-III. */
  readonly listPrice: Price;

  /** The governance ceiling for `listPrice`. Same resolution path as
   * `listPrice` today (see METADATA-VCM-04 §V on why these are not yet
   * observably different values, and why the fields remain distinct
   * anyway). */
  readonly governedMaxPrice: Price;

  /** EVIDENCE/HISTORICAL, transitional: the legacy registry's own frozen
   * `base_price`, preserved verbatim for lossless round-trip and
   * contract-release provenance. NOT validated against governedMaxPrice
   * (it is explicitly documented, in registry-source.ts, as not an
   * economic authority, and is allowed to diverge from the live governed
   * price by design -- see METADATA-VCM-04 §I). NOT projected as a
   * current live price by any protocol adapter. */
  readonly legacyBasePriceDeclared: Price;

  /** EVIDENCE/HISTORICAL, transitional: the legacy registry's own
   * `maximum_price`, preserved verbatim. Already present; unchanged by
   * this checkpoint. */
  readonly legacyMaximumPriceDeclared: Price;

  readonly supportedSchemes: readonly SchemeNetworkSupport[];
}
```

Requirements satisfied:

```
preserved losslessly for legacy parity        = YES (legacyBasePriceDeclared carries the byte)
clearly non-authoritative for current pricing  = YES (doc comment + excluded from validation)
provenance points to frozen release            = YES (doc comment cites registry-source.ts /
                                                        launch_price_metadata)
excluded from current economic ceiling validation = YES (validateEconomicConstraints only
                                                            reads listPrice/governedMaxPrice,
                                                            per §V; legacyBasePriceDeclared is
                                                            never passed to it)
not projected as current live price            = YES (no protocol adapter reads
                                                        legacyBasePriceDeclared -- confirmed
                                                        zero adapters exist yet, §VIII)
```

Not adopting the illustrative `ContractReleaseEconomicMetadata` nested-type shape from the
originating prompt: the repository already established the flat
`legacy<Field>Declared`-on-`ServiceEconomics` pattern for exactly this purpose
(`legacyMaximumPriceDeclared`), and `legacyBasePriceDeclared` as a direct sibling is the
smaller, more consistent correction. A separate `document_evidence_json`-specific dual
exact/upto economic model (ECON-01 §VI's secondary finding) is explicitly **out of scope**
here -- see §XII.

---

## V. Economic invariant -- unchanged in form

```
CORRECT_CURRENT_ECONOMIC_INVARIANT = listPrice <= governedMaxPrice   (unchanged)
```

The old invariant is not invalid in shape -- it was being evaluated against the wrong operand.
Per ECON-01 §VII: *"The invariant itself ... is correct and is, in fact, satisfied everywhere
in the live system today (charge == ceiling) ... It only appears violated in VCM's current
model because the model's `listPrice` input is sourced from the wrong field. Once `listPrice`
is sourced from the same governed value the runtime actually uses, the invariant holds
trivially."*

On whether `CURRENT_PRICE == GOVERNED_MAX` "by design today" (§V of the originating prompt):
**yes, structurally, for every one of the 8 currently-existing services** -- `listPrice` and
`governedMaxPrice` will, after this correction, both resolve through
`resolveServiceMaxPriceUsd(primaryPricingKey(family, generation))`, i.e. the identical function
call. This is not coincidence; it reflects that SITEBORNE's `exact`-scheme pricing has exactly
one governed number per service-generation today, used as both the ceiling and the charge --
there is no code path anywhere that charges less than that value.

This is **not** treated as grounds to collapse `listPrice` and `governedMaxPrice` into one
field, for two reasons:

1. They are conceptually distinct authorities even when numerically equal (charge vs. ceiling),
   and the frozen VCM-02 baseline deliberately modeled them separately -- collapsing them now
   would be an edit to that frozen reasoning, which this checkpoint may not make.
2. The distinction is not vestigial: `document_evidence_json_max_job` (ECON-01 §VI) is a real,
   already-existing case of a governed ceiling with genuine headroom below it for `upto`-scheme
   jobs. It is not yet correctly represented per-interaction in the frozen schema (a separate,
   smaller, explicitly deferred gap -- §XII), but its existence is itself proof that
   `listPrice != governedMaxPrice` is a real, reachable state in this domain, not a
   theoretical one kept only for symmetry.

So: two fields, expected to observably read as equal for all 8 current services immediately
after this correction (which is the healthy, expected post-fix state -- not a sign the fields
should merge), with schema room preserved for the cases (present today in `_max_job`, not yet
wired through) where they will not be equal.

---

## VI. Corrected three-layer flow

```
Frozen contract/release metadata (registry base_price / maximum_price)
       │
       └── legacyBasePriceDeclared / legacyMaximumPriceDeclared
           (EVIDENCE/HISTORICAL, provenance + round-trip parity only)

Current governed pricing authority (governance/RISK_LIMITS.yaml
  max_price_usd_per_service, via primaryPricingKey() -> PricingKey)
       │
       ▼
CanonicalStaticModel.services[].economics.{listPrice, governedMaxPrice}
       │
       ▼
runtime resolver (unaffected by this checkpoint -- already correctly
  modeled: RuntimeStateOverlay narrows, never widens)
       │
       ▼
RuntimeStateOverlay.economics.effectiveRuntimePrice / EffectiveMetadataView
       │
       ▼
public projections (none exist yet -- shadow implementation, §VIII) /
  quote construction (quotedTransactionAmount, still outside VCM)
```

`quotedTransactionAmount ∉ VCM` — unchanged, unaffected by this checkpoint.

---

## VII. Corrected importer semantics

`legacyRegistryToVCM()` (`packages/vcm/src/legacy/import-registry.ts`) must:

```
preserve registry base_price and maximum_price
  -> as legacyBasePriceDeclared / legacyMaximumPriceDeclared (release evidence, for parity)

NOT promote base_price into listPrice
  -> listPrice must come from resolveServiceMaxPriceUsd(primaryPricingKey(...)),
     the same call already used for governedMaxPrice (the two calls may in fact share
     one resolved value, computed once)

obtain current governed pricing from RISK_LIMITS.yaml (via @siteborne/pricing)
  -> already correct today, unchanged

validate current economic semantics against current authority
  -> validateEconomicConstraints() unchanged in logic (still checks
     listPrice <= governedMaxPrice); it now receives the correct listPrice input
```

`vcmToLegacyRegistry()` (`packages/vcm/src/legacy/project-registry.ts:38-44`) must be corrected
symmetrically -- it currently reconstructs the legacy `base_price` from `listPrice`
(`service.economics.listPrice.amount`), which will stop being byte-identical to the original
registry value once `listPrice` is re-sourced. It must instead reconstruct `base_price` from
the new `legacyBasePriceDeclared` field (mirroring exactly how it already reconstructs
`maximum_price` from `legacyMaximumPriceDeclared` on the next two lines):

```ts
// project-registry.ts -- corrected
base_price: {
  amount: service.economics.legacyBasePriceDeclared.amount,     // was: listPrice.amount
  currency: service.economics.legacyBasePriceDeclared.currency,
},
maximum_price: {
  amount: service.economics.legacyMaximumPriceDeclared.amount,  // unchanged
  currency: service.economics.legacyMaximumPriceDeclared.currency,
},
```

With this change, `LEGACY_PARITY` and `CANONICAL_VALIDITY` both hold simultaneously, exactly as
the originating prompt requires: the importer proves "I reproduced what exists"
(`legacyBasePriceDeclared` carries the original byte losslessly) while the validator
simultaneously proves "what exists is canonically valid" (`listPrice`, sourced correctly, no
longer exceeds `governedMaxPrice`).

```
LEGACY_PARITY_PRESERVED_BY_DESIGN=YES
CANONICAL_ECONOMIC_VALIDITY_RESTORED_BY_DESIGN=YES
```

---

## VIII. Migration compatibility

```
current public price changes   = 0   (no protocol adapter reads packages/vcm yet -- confirmed,
                                       grep of apps/edge-api, packages/protocol-* for
                                       "@siteborne/vcm" returns zero matches)
registry byte/value changes    = 0   (registry/services/*.json untouched by this or the next
                                       implementation checkpoint)
governance price changes       = 0   (governance/RISK_LIMITS.yaml untouched)
runtime charge changes         = 0   (resolveServiceMaxPriceUsd() / buildQuote() untouched --
                                       this correction only changes what packages/vcm's
                                       internal, unconsumed model reads)
quote behavior changes         = 0   (Quote construction does not import packages/vcm)
contract release changes       = 0   (registry/services/*.json, CONTRACT_RELEASE.yaml untouched)
```

This is possible specifically because the shadow VCM has zero current consumers -- the
correction is entirely internal to a package nothing yet depends on. This is also, per the
originating prompt, the ideal (and cheapest) time to make it.

---

## IX. VCM schema version impact

```
VCM_SCHEMA_VERSION_IMPACT = MINOR bump recommended (0.1.0 -> 0.2.0), not mechanical/required
```

Distinguishing the three version concepts named in the originating prompt:

- **Design-baseline amendment**: this document, `METADATA-VCM-04`, additive to the frozen
  master digest `sha256:32b61aa5...`. Does not itself carry a version number; it is a
  checkpoint identifier.
- **Implementation schema version** (`VcmSchemaVersion`, currently `0.1.0` per
  `packages/vcm/src/baseline.ts`): `ServiceEconomics` gains one required field
  (`legacyBasePriceDeclared`) and corrects `listPrice`'s data source. This is a shape change.
  Because `packages/vcm` is pre-1.0 and has **zero external consumers** (§VIII), a version bump
  is not required for compatibility reasons -- nothing outside the package can break. It is
  still recommended as a discipline marker (the shape genuinely changed from what
  `METADATA-VCM-IMPL-01` shipped), not because any consumer needs it.
- **Metadata release version** (`VcmReleaseVersion`): not yet applicable -- no VCM release has
  been cut (shadow implementation only, no `MetadataRelease` has been published).

Not treated as a "major" bump mechanically, per the explicit instruction not to do so absent an
external consumer.

---

## X. `METADATA-VCM-IMPL-01` is not reclassified

```
METADATA-VCM-IMPL-01=BLOCKED   (preserved, unchanged, not re-run)
VCM_IMPLEMENTATION_COMMIT=f398e5bd39c68b9dd2458ac2cfb32d5055934585
VCM_EVIDENCE_COMMIT=828de13e42a0bbce90ea15e3b555335885f68949
```

That result was correct against the frozen `VCM-02` semantics as implemented at that time. This
checkpoint does not rewrite it to `PASS`. It states the precise root cause for the historical
record:

```
BLOCKER_ROOT_CAUSE=FROZEN_MODEL_MAPPED_RELEASE_PRICE_METADATA_AS_CURRENT_LIST_PRICE
```

A future implementation checkpoint applying §IV/§VII's correction is what will supersede this
blocked interpretation -- not a retroactive edit of `METADATA-VCM-IMPL-01`'s own report or
commits.

---

## XI. Before / after

```
FIELD                      OLD SOURCE                  OLD AUTHORITY        PROBLEM
------------------------------------------------------------------------------------------
listPrice                  registry base_price         (mis-tagged as       Sources a value the
                            (import-registry.ts:255)     NORMATIVE via       repository explicitly
                                                          governedMaxPrice's  documents as "not an
                                                          sibling logic,      economic authority";
                                                          but actually        diverges from every
                                                          EVIDENCE)           real charge for all
                                                                              4 .v2 services

governedMaxPrice           governance/RISK_LIMITS.yaml  NORMATIVE            none -- already correct
                            via resolveServiceMaxPriceUsd

(no field)                 -- did not exist --          --                   registry base_price had
                                                                              nowhere honest to live
                                                                              once listPrice stopped
                                                                              reading it

legacyMaximumPriceDeclared registry maximum_price       EVIDENCE/HISTORICAL  none -- already correct,
                            (import-registry.ts:259-260)                     already unvalidated

pricing_policy_version     PricingPolicyVersion literal NORMATIVE (semver)   none -- unaffected


FIELD                      NEW SOURCE                          NEW AUTHORITY CLASS
--------------------------------------------------------------------------------------
listPrice                  resolveServiceMaxPriceUsd(           NORMATIVE (mirrors
                            primaryPricingKey(family,generation)) governedMaxPrice's source
                            -- same call governedMaxPrice makes  exactly, §V)

governedMaxPrice           unchanged                            NORMATIVE

legacyBasePriceDeclared    registry base_price, preserved       EVIDENCE/HISTORICAL
                            verbatim (new field)                 (excluded from
                                                                   validateEconomicConstraints;
                                                                   never projected as a live price)

legacyMaximumPriceDeclared unchanged                            EVIDENCE/HISTORICAL (unchanged)

pricing_policy_version     unchanged                            NORMATIVE (unchanged)

quotedTransactionAmount    n/a -- still outside VCM entirely     transaction artifact (unchanged)
```

---

## XII. Implementation delta for the next checkpoint

```
packages/vcm/src/types.ts
  - Add ServiceEconomics.legacyBasePriceDeclared: Price (sibling of
    legacyMaximumPriceDeclared, same doc-comment pattern)
  - Update listPrice's doc comment (no longer "registry base_price")

packages/vcm/src/legacy/import-registry.ts
  - Line ~254-255: source listPrice from the same resolved governedMaxAmount
    value already computed at line 219, not from legacy.base_price
  - Add: legacyBasePriceDeclared sourced from legacy.base_price (verbatim,
    parsed the same way legacyMaximumPriceDeclared already is)

packages/vcm/src/legacy/project-registry.ts
  - Lines 38-40: reconstruct base_price from legacyBasePriceDeclared,
    not from listPrice (mirrors the existing maximum_price/
    legacyMaximumPriceDeclared lines immediately below it)

packages/vcm/src/validators.ts
  - No logic change required (validateEconomicConstraints already compares
    listPrice <= governedMaxPrice by field access, not by hardcoded source
    assumption) -- re-verify by test, not by edit

packages/vcm/src/test-fixtures.ts, *.test.ts
  - Update fixtures/expectations that currently assert listPrice ==
    legacy base_price; assert listPrice == governedMaxPrice instead
  - Add fixture coverage for legacyBasePriceDeclared round-trip
  - Re-run the 8/8 registry parity suite -- expect REGISTRY_FILES_PARITY_FAIL=0
    AND ECONOMIC_CEILING=PASS simultaneously (not traded off against each other)

docs/reports/METADATA-VCM-IMPL-02-... (new, future)
  - Implementation report for the above, following the same TDD/evidence
    discipline as METADATA-VCM-IMPL-01
```

No existing protocol projection (A2A/MCP/OpenAPI/x402/Bazaar/Nevermined/catalog) requires any
change -- none of them consume `packages/vcm` yet (§VIII). This is confirmatory of, not a
warning against, the proposed correction: it stays entirely within a shadow package with no
external surface area.

**Explicitly deferred, not part of this correction:** `document_evidence_json`'s dual
exact-tier/`upto`-ceiling economic roles (ECON-01 §VI's secondary finding). Fixing `listPrice`'s
source does not require resolving that separately-scoped modeling gap, and folding it in here
would violate the "smallest correction" instruction. It remains a candidate for a later,
separately-numbered checkpoint.

---

## XIII. Acceptance gates

```
ROOT_CAUSE_INCORPORATED=YES

REGISTRY_RELEASE_METADATA_CLASSIFIED=YES   (EVIDENCE/HISTORICAL, §II/§IV)
CURRENT_ECONOMIC_AUTHORITY_IDENTIFIED=YES  (governance/RISK_LIMITS.yaml, §II)

CURRENT_PRICE_SEMANTICS_UNAMBIGUOUS=YES    (listPrice = resolved governed value, §III)
GOVERNED_MAX_SEMANTICS_UNAMBIGUOUS=YES     (unchanged, §II)

LEGACY_PARITY_PRESERVED_BY_DESIGN=YES      (§VII)
CURRENT_ECONOMIC_VALIDITY_RESTORED_BY_DESIGN=YES  (§VII)

QUOTE_REMAINS_TRANSACTION_ARTIFACT=YES     (§VI, unaffected)

PUBLIC_PRICE_CHANGE_REQUIRED=NO            (§VIII)
GOVERNANCE_PRICE_CHANGE_REQUIRED=NO        (§VIII)
REGISTRY_PRICE_CHANGE_REQUIRED=NO          (§VIII)

PRODUCTION_CHANGE_REQUIRED=NO              (§VIII)
```

All gates satisfied by design. `packages/vcm` itself is not modified by this checkpoint --
these gates describe what the *next* implementation checkpoint must (and, by this design, can)
achieve.

---

## XIV. Required return

```
METADATA_VCM_04=PASS

FROZEN_BASELINE=sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096

ADDITIVE_AMENDMENT=YES
FROZEN_MASTER_EDITED=NO

FROZEN_DESIGN_RECORD_COMMIT=aeb0e1b
ECON_01_EVIDENCE_COMMIT=2b17ba5

ROOT_CAUSE=VCM_SEMANTIC_MAPPING_ERROR_WITH_LEGACY_RELEASE_METADATA

REGISTRY_BASE_PRICE_AUTHORITY_CLASS=EVIDENCE/HISTORICAL
REGISTRY_MAXIMUM_PRICE_AUTHORITY_CLASS=EVIDENCE/HISTORICAL
CURRENT_PRICE_AUTHORITY=governance/RISK_LIMITS.yaml (max_price_usd_per_service, via
  primaryPricingKey -> resolveServiceMaxPriceUsd)
GOVERNED_MAX_AUTHORITY=governance/RISK_LIMITS.yaml (same source as CURRENT_PRICE_AUTHORITY)

LIST_PRICE_DISPOSITION=B (RETAIN, re-sourced) -- with D (SPLIT) applied separately to the
  frozen registry bytes it used to read (-> legacyBasePriceDeclared)

CORRECT_CURRENT_ECONOMIC_INVARIANT=listPrice <= governedMaxPrice (unchanged in form; input
  source corrected; resolves to equality for all 8 current services, expected and healthy)

LEGACY_PARITY_PRESERVED_BY_DESIGN=YES
CANONICAL_ECONOMIC_VALIDITY_RESTORED_BY_DESIGN=YES

REGISTRY_VALUE_CHANGES_REQUIRED=0
GOVERNANCE_VALUE_CHANGES_REQUIRED=0
PUBLIC_PRICE_CHANGES_REQUIRED=0
RUNTIME_PRICE_CHANGES_REQUIRED=0
PRODUCTION_MUTATIONS=0

VCM_SCHEMA_VERSION_IMPACT=MINOR bump recommended (0.1.0 -> 0.2.0), not required (zero
  external consumers); discipline marker only

NEXT_IMPLEMENTATION_SCOPE=
  packages/vcm/src/types.ts (add ServiceEconomics.legacyBasePriceDeclared),
  packages/vcm/src/legacy/import-registry.ts (re-source listPrice, add
    legacyBasePriceDeclared population),
  packages/vcm/src/legacy/project-registry.ts (reconstruct base_price from
    legacyBasePriceDeclared instead of listPrice),
  packages/vcm/src/test-fixtures.ts + *.test.ts (update/extend),
  new docs/reports/METADATA-VCM-IMPL-02-... implementation report.
  No protocol package, registry file, governance file, or production surface
  requires any change.

REPORT=docs/reports/METADATA-VCM-04-economic-authority-correction.md

SAFE_TO_IMPLEMENT_VCM_ECONOMIC_CORRECTION=YES
```

Stop there. `packages/vcm` is not modified by this checkpoint.
