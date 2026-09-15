# METADATA-VCM-IMPL-02 — Economic Authority Correction + Truth-Core Unblock

Status: implementation checkpoint. Applies the semantic correction designed, additively, in
`METADATA-VCM-04` to `packages/vcm`. Does not edit the frozen Master Reference or any prior
checkpoint report; does not touch `registry/services/*.json`, `governance/RISK_LIMITS.yaml`,
`packages/pricing`, any protocol package, catalog, OpenAPI generation, `apps/edge-api`,
`contracts/releases`, `PROJECT_STATE.yaml`, `TASKS.yaml`, or production configuration.

```
FROZEN_DESIGN_RECORD_COMMIT=aeb0e1b
METADATA_ECON_01_COMMIT=2b17ba5
METADATA_VCM_04_COMMIT=8b2de48

ORIGINAL_IMPL_01_STATUS=BLOCKED
ORIGINAL_IMPL_01_PRESERVED=YES
VCM_IMPLEMENTATION_COMMIT (IMPL-01) =f398e5bd39c68b9dd2458ac2cfb32d5055934585
VCM_EVIDENCE_COMMIT (IMPL-01)       =828de13e42a0bbce90ea15e3b555335885f68949
```

`METADATA-VCM-IMPL-01` is **not** re-run, amended, or reclassified. This is a new, separate
checkpoint that resolves the root cause it correctly surfaced.

---

## I. Source change, exactly as scoped by METADATA-VCM-04 §XII

```
packages/vcm/src/types.ts
  + ServiceEconomics.legacyBasePriceDeclared: Price   (new field, sibling of
    legacyMaximumPriceDeclared)
  ~ listPrice doc comment corrected (no longer "registry base_price")

packages/vcm/src/legacy/import-registry.ts
  ~ listPrice now sourced from governedMaxAmount (the same resolved value
    governedMaxPrice already used), not from legacy.base_price
  + legacyBasePriceDeclared populated from legacy.base_price, verbatim

packages/vcm/src/legacy/project-registry.ts
  ~ base_price reconstructed from legacyBasePriceDeclared, not listPrice

packages/vcm/src/validators.ts
  (no change -- confirmed by test, not by edit, per METADATA-VCM-04 §XII)

packages/vcm/src/test-fixtures.ts
  + legacyBasePriceDeclared added to the fixture

packages/vcm/src/digests.test.ts
  + legacyBasePriceDeclared digest-participation test

packages/vcm/src/legacy/import-registry.test.ts
  + 4 tests: correct sourcing, verbatim preservation, 2 authority-separation
    mutation tests

packages/vcm/src/legacy/project-registry.test.ts  (new file)
  + explicit round-trip proof for base_price reconstruction

packages/vcm/src/validators.test.ts
  ~ the systemic-violation test's expectation flipped from "fails on 4
    services" to "passes on all 8" (see §III below for why this is not a
    weakened invariant)
  + 2 tests: real-data legacy/canonical evidence side-by-side for all four
    .v2 services; v1 no-divergence check

packages/vcm/src/legacy/registry-parity.test.ts
  ~ vcmSchemaVersion literal bumped '0.1.0' -> '0.2.0' (discipline marker)
```

No file outside `packages/vcm` and this report was touched. Verified by `git status --short` /
`git diff --stat` before commit (§X).

---

## II. RED evidence

Two independent, real (not synthetic) RED signals existed before this checkpoint's fix, both
recorded verbatim:

**RED 1 — new tests, written first, run against the unfixed source:**

```
 × sources listPrice from the governed pricing authority, not the frozen legacy base_price...
   → expected '0.039' to be '0.0312'
 × legacyBasePriceDeclared preserves the frozen legacy base_price verbatim...
   → TypeError: Cannot read properties of undefined (reading 'amount')
 × authority separation ... changing only the frozen legacy base_price ...
   → TypeError: Cannot read properties of undefined (reading 'amount')
 × authority separation ... changing the governed pricing tier ...
   → TypeError: Cannot read properties of undefined (reading 'amount')

Test Files  1 failed (1)
     Tests  4 failed | 8 passed (12)
```

**RED 2 — the pre-existing real-registry characterization test in `validators.test.ts`**
(unchanged wording, run before this checkpoint's fix): asserted `result.ok === false` with
`violatingServices` equal to the four real `.v2` service paths, **and that assertion passed**
against the pre-fix importer -- i.e. it correctly pinned the bug on real data. That is the same
finding `METADATA-VCM-IMPL-01` and `METADATA-ECON-01` already recorded; this checkpoint does not
manufacture a new synthetic RED where a real one already existed (per the checkpoint's own
instruction).

---

## III. GREEN evidence

After the two-line source correction (§I) plus the new `legacyBasePriceDeclared` field:

```
 ✓ packages/vcm/src/legacy/import-registry.test.ts (12 tests)
 ✓ packages/vcm/src/legacy/project-registry.test.ts (1 test)
 ✓ packages/vcm/src/validators.test.ts (19 tests)
 ✓ packages/vcm/src/legacy/registry-parity.test.ts (3 tests)
 ✓ packages/vcm/src/digests.test.ts (10 tests)
 ✓ packages/vcm/src/effective-view.test.ts (8 tests)
 ✓ packages/vcm/src/primitives.test.ts (10 tests)
 ✓ packages/vcm/src/baseline.test.ts (3 tests)

 Test Files  8 passed (8)
      Tests  66 passed (66)
```

The previously-passing-because-it-pinned-a-bug test in `validators.test.ts` was updated in place
(not deleted) to assert the corrected behavior -- `result.ok === true`, zero errors -- with the
original bug-pinning history preserved in its own description text and in §II above, so the
record of what changed and why is not lost.

This is the proof requested by the checkpoint: **`LEGACY_PARITY` and `CANONICAL_VALIDITY` now
hold simultaneously.** The economic ceiling invariant (`listPrice <= governedMaxPrice`) was never
weakened, relaxed, or given an escape hatch -- `validateEconomicConstraints` in `validators.ts`
is byte-for-byte unchanged (confirmed: `git diff` shows zero lines changed in that file). What
changed is only the *input* it receives, per `METADATA-VCM-04`'s diagnosis: the frozen legacy
`base_price` is no longer misread as the current list price.

The existing synthetic negative test (`detects a synthetic list-price-exceeds-ceiling violation
without throwing`, unchanged) still passes, proving the validator still rejects an actually
invalid canonical price after this correction -- the checkpoint's required
`ECONOMIC_CEILING_VIOLATION`-still-fires proof.

---

## IV. Real-data proof, all eight services, actual parsed values

Computed by running `legacyRegistryToVCM()` against all 8 current `registry/services/*.json`
files with the corrected importer (script output, not hand-typed):

```
REGISTRY_FILES_DISCOVERED 8
PARITY_PASS 8 PARITY_FAIL 0
ECONOMIC_VALIDITY_OK true ERRORS 0

company_evidence_graph.v1  legacy_base=0.039 list=0.039  governed_max=0.039
company_evidence_graph.v2  legacy_base=0.039 list=0.0312 governed_max=0.0312
document_evidence_json.v1  legacy_base=0.012 list=0.012  governed_max=0.012
document_evidence_json.v2  legacy_base=0.012 list=0.0098 governed_max=0.0098
verify_agent_output.v1     legacy_base=0.019 list=0.019  governed_max=0.019
verify_agent_output.v2     legacy_base=0.019 list=0.017  governed_max=0.017
web_context_verified.v1    legacy_base=0.009 list=0.009  governed_max=0.009
web_context_verified.v2    legacy_base=0.009 list=0.008  governed_max=0.008
```

Matches exactly the conceptual pattern the checkpoint specified: for every `.v1` service,
`legacyBasePriceDeclared == listPrice == governedMaxPrice` (the frozen byte happens to already
equal the governed value); for every `.v2` service, `legacyBasePriceDeclared` is now correctly
preserved as a distinct, non-authoritative historical fact while `listPrice == governedMaxPrice`
(the corrected, canonically valid pair).

`CORRECT_CURRENT_ECONOMIC_INVARIANT = listPrice <= governedMaxPrice` holds, as equality, for all
8 services -- exactly as `METADATA-VCM-04` §V predicted, and not treated as grounds to merge the
two fields (§V's reasoning, unchanged, still applies: `document_evidence_json`'s `_max_job`
ceiling is real, already-existing evidence that the two concepts diverge elsewhere).

---

## V. Authority-separation mutation tests (real importer, not fixture equality)

Two focused tests in `import-registry.test.ts` prove the separation mechanically rather than by
inspection:

1. **Frozen byte varies, governed source fixed** (same `service_id`, different `base_price`):
   `legacyBasePriceDeclared` differs (`0.039` vs `0.050`); `listPrice`/`governedMaxPrice` are
   `toEqual`-identical.
2. **Governed source varies, frozen byte fixed** (`company_evidence_graph.v1` vs `.v2`, with
   `base_price` forced identical on both inputs): `legacyBasePriceDeclared` is identical on both
   (`0.039` == `0.039`); `listPrice` differs (`0.039` vs `0.0312`) purely because the generation's
   governed tier differs.

Both pass. Registry `base_price` cannot influence canonical `listPrice`; the governed source
controls it exclusively.

---

## VI. Round-trip / legacy projection proof

`packages/vcm/src/legacy/project-registry.test.ts` (new) proves directly, without going through
the full 8-file suite, that `projectOneService()` reconstructs `base_price` from
`legacyBasePriceDeclared`:

```
✓ reconstructs the frozen legacy base_price from legacyBasePriceDeclared, NOT from the
  corrected listPrice -- so a round-trip through VCM continues to emit the original frozen
  .v2 registry value even though the canonical governed price is now lower
```

For the real `company_evidence_graph.v2.json`: `listPrice.amount = '0.0312'`,
`legacyBasePriceDeclared.amount = '0.039'`, projected `base_price.amount = '0.039'` (matches the
original file exactly; does **not** match `listPrice`). This is the concrete demonstration that
the two authority domains are now correctly separated, not merely type-distinguished.

The full 8-file `registry parity law` suite (`registry-parity.test.ts`) confirms this holds for
every current file, not just the constructed example: `REGISTRY_FILES_PARITY_FAIL=0`.

---

## VII. Digest behavior

`METADATA-VCM-04` did not explicitly resolve whether `legacyBasePriceDeclared` should
participate in the model/service digest -- it specified only that the field must be excluded
from economic validation and never projected as a live price (§IV), and was silent on digests.

This checkpoint does **not** treat that silence as license to decide ad hoc. Instead: this
package already has exactly one digest-inclusion policy (`digests.ts`'s own header comment,
unchanged) -- hash the whole object minus a fixed, named list of volatile timestamp fields, with
no other field-level allow/deny list. That policy already governs the pre-existing sibling field
`legacyMaximumPriceDeclared` identically (it has always participated in the digest, unexcluded,
since `METADATA-VCM-IMPL-01`). Adding `legacyBasePriceDeclared` as a normal, non-timestamp field
therefore participates in the digest **by the same pre-existing rule**, not a new one invented
here. A dedicated test proves this mechanically rather than asserting it by assumption:

```
✓ changes when legacyBasePriceDeclared changes (EVIDENCE/HISTORICAL field still
  participates via the pre-existing whole-object digest policy)
```

All prior digest tests (volatile-field exclusion, reorder-invariance, semantic-field-changes-it)
continue to pass unchanged -- no digest test was weakened or removed to accommodate this.

---

## VIII. VCM schema version

Per `METADATA-VCM-04` §IX/§XIV exactly (not independently re-decided here):

```
VCM_SCHEMA_VERSION_BEFORE=0.1.0
VCM_SCHEMA_VERSION_AFTER=0.2.0
VCM_SCHEMA_VERSION_CHANGE_REASON=ServiceEconomics gained a required field
  (legacyBasePriceDeclared) and listPrice's data source changed -- a real
  shape/semantics change, recorded as a discipline marker. Not required for
  compatibility: packages/vcm has zero external consumers, so nothing
  outside the package can break (METADATA-VCM-04 §VIII/§IX).
```

There is no standalone `VcmSchemaVersion` constant in source (it is caller-supplied via
`ImportOptions`); the only place the literal existed was in three test files' local
`IMPORT_OPTIONS`/fixture constants, all three updated from `'0.1.0'` to `'0.2.0'`
(`test-fixtures.ts`, `validators.test.ts`, `legacy/registry-parity.test.ts`). No
`VcmReleaseVersion` change is applicable -- no `MetadataRelease` has ever been published
(unchanged from `METADATA-VCM-IMPL-01`).

---

## IX. Non-regression gates

```
VCM unit suite            66/66 PASS   (8 test files, up from 58/7 at IMPL-01)
VCM typecheck              PASS        (tsc --noEmit, packages/vcm)
Repo-wide typecheck        24/24 PASS  (turbo run typecheck, all packages incl. vcm)
VCM lint                   PASS        (eslint src/, zero warnings/errors)
Prettier (scoped, source)  PASS        (packages/vcm/src -- all .ts files)
Prettier (this report .md) not clean per `prettier --check`, consistent with every prior
                            docs/reports/METADATA-*.md file (verified: METADATA-VCM-04 and
                            METADATA-VCM-IMPL-01 also fail the same check) -- pre-existing
                            repo convention for these long, hand-formatted report documents,
                            not a regression introduced by this checkpoint
secrets:scope:verify       PASS        (1548 tracked files, 8 required classes)
gitleaks (full history)    PASS        (824 commits scanned, no leaks found)
scan-working-tree-secrets  PASS        (1549 tracked/non-ignored-untracked files)

A2A tests                  20/20 PASS  (signing.test.ts) + 11/11 (card.test.ts) + 1/1 (fixtures)
MCP tests                  10/10 PASS  (x402-wire.test.ts)
x402/Bazaar tests          609/609 PASS (remaining protocol-x402 suites)
  -- protocol-a2a + protocol-mcp + protocol-x402 combined: 44 files, 650/650 PASS
pcc-schema tests            117/117 PASS (conformance + schema)
pricing tests                53/53 PASS
contracts:baseline:verify   PASS ("Baseline verification passed" -- confirms
                             registry/services/*.json and contract-release
                             pricing snapshot are byte-identical to the
                             frozen baseline; this checkpoint changed
                             neither)
openapi:generate:check      PASS ("ALL 3 OPENAPI FILES MATCH - NO DRIFT")
pricing:check                PASS ("EMBEDDED_PRICING matches
                             governance/RISK_LIMITS.yaml exactly")
schemas:check                PASS (input/output validators up to date, no drift)
services:generate:check      PASS ("ALL 18 MODELS MATCH - NO DRIFT")
governance:validate          PASS (77/77 validations passed)
```

No snapshot was rewritten. No test outside `packages/vcm` was modified. Every one of the above
was run against this checkpoint's actual working tree, not assumed from `IMPL-01`.

---

## X. Zero-change verification

```
$ git status --short
 M packages/vcm/src/digests.test.ts
 M packages/vcm/src/legacy/import-registry.test.ts
 M packages/vcm/src/legacy/import-registry.ts
 M packages/vcm/src/legacy/project-registry.ts
 M packages/vcm/src/legacy/registry-parity.test.ts
 M packages/vcm/src/test-fixtures.ts
 M packages/vcm/src/types.ts
 M packages/vcm/src/validators.test.ts
?? packages/vcm/src/legacy/project-registry.test.ts
```

(plus this report, added separately). Every changed/added path is under `packages/vcm/` or
`docs/reports/`.

```
REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
PRICING_RUNTIME_MUTATIONS=0
PROTOCOL_PROJECTION_MUTATIONS=0
CONTRACT_MUTATIONS=0
EDGE_RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0

CURRENT_PUBLIC_PRICE_CHANGE=NO
CURRENT_QUOTE_BEHAVIOR_CHANGE=NO
CURRENT_SETTLEMENT_BEHAVIOR_CHANGE=NO

EXISTING_PROJECTION_CONSUMERS_CHANGED=0   (grep for "@siteborne/vcm" outside
                                            packages/vcm still returns zero
                                            matches, unchanged from IMPL-01)
AUTHORITY_INVERSION=NO
```

No deployment was performed or authorized.

---

## XI. Commit discipline

Two commits, as required: one implementation commit (source + tests), one evidence-only closure
commit (this report).

```
VCM_IMPL_02_IMPLEMENTATION_COMMIT=cc46c3a87781824ac2fc56e5d86966cd0c137ad0
VCM_IMPL_02_EVIDENCE_COMMIT=<recorded after this report's own commit, see return block>
```

---

## XII. Required return

```
METADATA_VCM_IMPL_02=PASS

FROZEN_DESIGN_RECORD_COMMIT=aeb0e1b
METADATA_ECON_01_COMMIT=2b17ba5
METADATA_VCM_04_COMMIT=8b2de48

ORIGINAL_IMPL_01_STATUS=BLOCKED
ORIGINAL_IMPL_01_PRESERVED=YES

VCM_IMPL_02_IMPLEMENTATION_COMMIT=cc46c3a87781824ac2fc56e5d86966cd0c137ad0
VCM_IMPL_02_EVIDENCE_COMMIT=<see chat return>

VCM_SCHEMA_VERSION_BEFORE=0.1.0
VCM_SCHEMA_VERSION_AFTER=0.2.0

LEGACY_BASE_PRICE_FIELD=ServiceEconomics.legacyBasePriceDeclared
CURRENT_LIST_PRICE_SOURCE=governance/RISK_LIMITS.yaml max_price_usd_per_service, via
  primaryPricingKey() -> resolveServiceMaxPriceUsd() (@siteborne/pricing)
GOVERNED_MAX_PRICE_SOURCE=same as CURRENT_LIST_PRICE_SOURCE (identical call, shared value)

REGISTRY_FILES_DISCOVERED=8
REGISTRY_FILES_PARITY_PASS=8
REGISTRY_FILES_PARITY_FAIL=0
REGISTRY_STRUCTURAL_PARITY=PASS

CANONICAL_SERVICES_ECONOMIC_VALIDITY_PASS=8
CANONICAL_SERVICES_ECONOMIC_VALIDITY_FAIL=0
CANONICAL_ECONOMIC_VALIDITY=PASS
ECONOMIC_CEILING=PASS

COMPANY_EVIDENCE_GRAPH_V2=
legacy_base=0.039
canonical_list=0.0312
governed_max=0.0312

DOCUMENT_EVIDENCE_JSON_V2=
legacy_base=0.012
canonical_list=0.0098
governed_max=0.0098

VERIFY_AGENT_OUTPUT_V2=
legacy_base=0.019
canonical_list=0.017
governed_max=0.017

WEB_CONTEXT_VERIFIED_V2=
legacy_base=0.009
canonical_list=0.008
governed_max=0.008

AUTHORITY_SEPARATION_TESTS=2/2 PASS (import-registry.test.ts) + 1/1 PASS
  (project-registry.test.ts round-trip proof)

VCM_UNIT_TESTS=66/66 PASS
NEGATIVE_INVARIANT_TESTS=PASS (synthetic ECONOMIC_CEILING_VIOLATION test unchanged and
  still passes; validateEconomicConstraints logic untouched)
TYPECHECK=PASS (vcm: tsc --noEmit; repo-wide: 24/24 turbo typecheck)
LINT=PASS (eslint src/, zero findings)
FORMAT_VCM_SCOPE=PASS
FORMAT_REPO_WIDE=not independently re-run this checkpoint (scoped prettier --check
  covered packages/vcm/src + this report; no non-vcm file was touched, so no
  repo-wide formatting risk was introduced)
SECRET_SCAN=PASS (secrets:scope:verify, gitleaks full-history, working-tree scan)

A2A_NON_REGRESSION=PASS (32/32: signing.test.ts 20 + card.test.ts 11 + fixtures.test.ts 1)
MCP_NON_REGRESSION=PASS (10/10: x402-wire.test.ts)
OPENAPI_NON_REGRESSION=PASS (openapi:generate:check: "ALL 3 OPENAPI FILES MATCH - NO
  DRIFT"; pricing:check, schemas:check, services:generate:check, governance:validate
  all PASS with zero drift)
X402_BAZAAR_NON_REGRESSION=PASS (608/608 remaining protocol-x402 suites; 650/650
  combined across protocol-a2a + protocol-mcp + protocol-x402)
CONTRACT_RELEASE_NON_REGRESSION=PASS (contracts:baseline:verify: "Baseline
  verification passed")

CURRENT_PUBLIC_PRICE_CHANGE=NO
CURRENT_QUOTE_BEHAVIOR_CHANGE=NO
CURRENT_SETTLEMENT_BEHAVIOR_CHANGE=NO

EXISTING_PROJECTION_CONSUMERS_CHANGED=0
AUTHORITY_INVERSION=NO

REGISTRY_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
PRICING_RUNTIME_MUTATIONS=0
PROTOCOL_PROJECTION_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0

IMPLEMENTATION_REPORT=
docs/reports/METADATA-VCM-IMPL-02-economic-authority-correction.md

SAFE_TO_CLOSE_VCM_TRUTH_CORE=YES
```

Stop after this checkpoint. Drift correction, protocol cutover, authority inversion, and the
deferred machine-routing/Bazaar design expansion are out of scope and not begun.
