# SITEBORNE Service Contract Compatibility Policy

**Policy Version:** contract-compatibility-v1 **Schema Draft:** JSON Schema
2020-12 **OpenAPI Version:** 3.1.0 **Status:** Normative **Effective:**
2026-08-05

---

## 1. Purpose

This policy defines deterministic rules for classifying changes to SITEBORNE
service contracts, determining required version bumps, and enforcing
compatibility guarantees for autonomous buyers. The policy ensures that future
changes cannot silently break existing consumers.

---

## 2. Version Model

### 2.1 Three Distinct Version Identities

| Identity                     | Current Value | Description                                                             |
| ---------------------------- | ------------- | ----------------------------------------------------------------------- |
| **PCC Schema Release**       | 1.0.1         | Package/schema release (patch correcting extension_container)           |
| **PCC Document Version**     | 1.0.0         | Content-compatibility version carried in every PCC result               |
| **Service Contract Release** | 1.0.0         | Covers all 17 canonical schemas, generated artifacts, OpenAPI, metadata |
| **Service API Versions**     | `.v1`         | Stable public service-major identities (4 services)                     |

### 2.2 Service Contract Release 1.0.0 Scope

- 9 common schemas
- 8 service input/output schemas
- Generated TypeScript models (18 files)
- Generated Python models (18 files)
- 3 OpenAPI artifacts
- 4 service metadata records
- Semantic validator contract behavior
- Public examples and compatibility fixtures

### 2.3 Individual Service API Versions

```
company_evidence_graph.v1
web_context_verified.v1
document_evidence_json.v1
verify_agent_output.v1
```

The `.v1` suffix is the **stable public service-major identity**. Release
version `1.0.0` may receive compatible patch/minor releases within service major
`v1`. A breaking change requires a new service-major identifier (`.v2`) or
formally supported parallel major-version surface.

---

## 3. Compatibility Policy

### 3.1 Patch-Compatible Changes (1.0.0 → 1.0.1)

A patch release may include **only**:

- Documentation clarifications with no schema effect
- Typo corrections in descriptions
- Correction of invalid examples without changing valid instance semantics
- Generator bug fixes producing semantically identical models
- Validator corrections enforcing already documented behavior
- Non-semantic metadata corrections
- Security hardening rejecting behavior already explicitly forbidden
- Deterministic formatting changes when schema hashes are intentionally
  regenerated and consumers do not bind raw formatting bytes
- Test additions
- Internal tooling changes

**A patch release must NOT:**

- Add a required field
- Remove a field
- Rename a field
- Narrow an accepted enum
- Change field meaning
- Change canonicalization
- Change signature preimages
- Change money semantics
- Change identifier semantics
- Change an accepted input into a rejected input (unless already explicitly
  invalid)
- Change a rejected input into accepted behavior with material consequences
- Alter pricing semantics
- Alter verification decisions
- Change service identity

### 3.2 Minor-Compatible Changes (1.0.0 → 1.1.0)

A minor release may include **carefully controlled backward-compatible
additions**:

- New optional field with safe absence semantic
- New optional extension namespace
- New optional metadata field
- New non-required capability metadata
- New optional response property that old consumers can ignore
- New optional request feature that does not alter old requests
- New error code within explicitly extensible error-code family
- Additional examples
- Additional protocol metadata marked disabled or planned

**Minor compatibility must be evaluated from both directions:**

| Direction                                   | Requirement                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Existing producer → New consumer**        | Old valid outputs must continue to validate and behave correctly                               |
| **New producer → Existing strict consumer** | If old consumers reject unknown enum values or unknown properties, adding them may be breaking |

**Therefore:**

- Closed-enum expansion is **breaking** unless the contract explicitly requires
  unknown-value handling
- Adding properties to objects with strict `additionalProperties: false` can be
  breaking for consumers using older schemas
- A new optional field is **not automatically safe** for schema-validating
  consumers

The policy identifies compatibility as:

- `producer-backward-compatible`
- `consumer-backward-compatible`
- `bidirectionally compatible`
- `source compatible only`
- `wire compatible only`
- `incompatible`

### 3.3 Major Changes (1.0.0 → 2.0.0 / .v2)

A major release is **required** for:

- Required-field additions
- Field removals
- Field renames
- Type changes
- Semantic reinterpretation
- Identifier-format changes
- Hash-format changes
- Canonicalization changes
- Signature-preimage changes
- Money-format changes
- Currency-semantics changes
- Narrowing valid bounds
- Widening values in a way strict consumers reject
- Closed-enum additions
- Changes to deterministic-failure rules
- Changes that make previous pass results fail
- Changes that make previous fail results pass materially
- Changed service identity
- Changed PCC dependency incompatible with existing service results
- Changed extension namespace
- Changed output/PCC pairing rules
- Changed pricing scheme semantics
- Changed exact versus upto meaning

**A major service change must use a new public service-major identifier
(`.v2`).**

---

## 4. Change Taxonomy

Every change is classified into one of the following types, each with a default
compatibility classification, minimum required version bump, and review
requirements:

| Change Type                   | Default Compatibility | Min Bump | Human Review | Runtime Migration | Parallel Major |
| ----------------------------- | --------------------- | -------- | ------------ | ----------------- | -------------- |
| documentation_only            | patch                 | patch    | No           | No                | No             |
| example_only                  | patch                 | patch    | No           | No                | No             |
| annotation_change             | patch                 | patch    | No           | No                | No             |
| optional_property_added       | minor_candidate       | minor    | Yes          | No                | No             |
| required_property_added       | major                 | major    | Yes          | Yes               | Yes            |
| property_removed              | major                 | major    | Yes          | Yes               | Yes            |
| property_renamed              | major                 | major    | Yes          | Yes               | Yes            |
| property_type_changed         | major                 | major    | Yes          | Yes               | Yes            |
| enum_value_added              | major                 | major    | Yes          | No                | Yes            |
| enum_value_removed            | major                 | major    | Yes          | Yes               | Yes            |
| minimum_increased             | major                 | major    | Yes          | Yes               | Yes            |
| minimum_decreased             | minor_candidate       | minor    | Yes          | No                | No             |
| maximum_increased             | minor_candidate       | minor    | Yes          | No                | No             |
| maximum_decreased             | major                 | major    | Yes          | Yes               | Yes            |
| pattern_changed               | major                 | major    | Yes          | Yes               | Yes            |
| format_changed                | major                 | major    | Yes          | Yes               | Yes            |
| default_changed               | patch                 | patch    | Yes          | No                | No             |
| additional_properties_changed | major                 | major    | Yes          | No                | Yes            |
| required_list_changed         | major                 | major    | Yes          | Yes               | Yes            |
| one_of_changed                | major                 | major    | Yes          | Yes               | Yes            |
| any_of_changed                | major                 | major    | Yes          | Yes               | Yes            |
| all_of_changed                | major                 | major    | Yes          | Yes               | Yes            |
| reference_target_changed      | major                 | major    | Yes          | Yes               | Yes            |
| identifier_changed            | major                 | major    | Yes          | Yes               | Yes            |
| service_version_changed       | major                 | major    | Yes          | Yes               | Yes            |
| pcc_dependency_changed        | major                 | major    | Yes          | Yes               | Yes            |
| semantic_validator_changed    | major                 | major    | Yes          | Yes               | Yes            |
| openapi_operation_changed     | major                 | major    | Yes          | Yes               | Yes            |
| error_contract_changed        | major                 | major    | Yes          | Yes               | Yes            |
| pricing_semantics_changed     | major                 | major    | Yes          | Yes               | Yes            |
| signature_binding_changed     | major                 | major    | Yes          | Yes               | Yes            |

**Unknown change types fail closed.**

---

## 5. Compatibility Modes

The policy enforces distinct consumer compatibility models:

```yaml
compatibility_modes:
  schema_strict_consumer:
    unknown_properties: reject
    unknown_enum_values: reject
    default_for_enforcement: true

  tolerant_consumer:
    unknown_properties: ignore_when_allowed
    unknown_enum_values: preserve_or_fail_safely

  existing_producer:
    sends_only_baseline_fields: true

  new_producer:
    may_send_new_optional_fields: version_dependent
```

**Default release enforcement assumes strict machine consumers** unless a
contract explicitly states otherwise. This prevents unsafe claims that an
optional property or enum expansion is universally backward compatible.

---

## 6. Service-Specific Freeze Rules

### 6.1 Company Evidence Graph

Frozen: service ID, extension namespace, identity-signal rules, supported field
groups, evidence-linking rules, completeness semantics, verified-absence
semantics, no real-time market-data promise, launch price metadata, output/PCC
pairing.

**Field group changes are compatibility-sensitive.** Adding a new field group is
not automatically minor-compatible because strict consumers may reject unknown
enum values.

### 6.2 Verified Web Context

Frozen: service ID, extension namespace, retrieval modes, output modes, URL
input semantics, public-target restrictions, structured-output requirements,
redirect bounds, prompt-injection result semantics, direct/rendered distinction,
launch pricing metadata.

**New retrieval or output modes are treated as potentially breaking closed-enum
changes.**

### 6.3 Document Evidence JSON

Frozen: service ID, extension namespace, exactly-one document reference mode,
accepted media types, 10 MB limit, 10-page limit, page classifications, pricing
units, $0.19 maximum, upto pricing semantics, authorization classes, evidence
locator rules.

**Any changed file, page, media-type, or price limit requires explicit
compatibility classification.**

### 6.4 Agent Output Verification

Frozen: service ID, extension namespace, standard and independent-reproduction
modes, deterministic-failure semantics, reproduction requirements, score range,
failed-requirement references, candidate-output hash semantics, launch price
metadata.

**Any change permitting a deterministic failure to pass is major and forbidden
within v1.**

---

## 7. Common Contract Freeze Rules

### 7.1 Money

Breaking without major: decimal representation change, scientific notation
acceptance, negative value acceptance, changed normalization, precision change,
currency semantic change.

### 7.2 Quotes

Breaking without major: exact/upto reinterpretation, changed expiration
semantics, changed hash binding fields, contradictory quote behavior, changed
maximum-price meaning.

### 7.3 Errors

Compatibility-sensitive: category removal, category reinterpretation,
retryability semantic changes, error-code reuse, field removal, original receipt
reference changes.

### 7.4 Async Jobs

Compatibility-sensitive: state removal, state reinterpretation, terminal-state
changes, result-reference meaning, retry/refund semantic changes.

---

## 8. OpenAPI Compatibility

OpenAPI artifacts are included in release compatibility. Checks include:
operation IDs, path templates, request-body schemas, response schemas, status
codes, error references, quote references, service IDs, schema hashes, examples,
preproduction status, production-enabled status.

Classified as breaking: path removal, operation removal, request requirement
tightening, success-response schema incompatibility, removed status response,
changed operation meaning, changed authentication/payment requirements without
versioning, changed identifier binding.

---

## 9. Service Metadata Compatibility

All four metadata records are included in the frozen release. Enforced: schema
hashes match, service IDs match, prices match, bounds match schemas, PCC
dependency matches, contract version matches, production remains false, protocol
statuses remain honest, no publication IDs unless genuinely assigned, no enabled
protocol status without implementation evidence.

Metadata changes affecting machine selection must receive compatibility
classification.

---

## 10. Generated Artifact Compatibility

Generated TypeScript and Python models must:

- Derive from frozen canonical schemas
- Contain release-source metadata
- Match baseline semantics
- Have no drift
- Not independently introduce defaults or coercion
- Not accept values rejected by canonical schema
- Not reject values accepted by canonical schema without documented runtime
  policy

Cross-language baseline fixtures prove: baseline valid instances remain valid,
baseline invalid instances remain invalid, TypeScript and Python agree,
generated models remain deterministic.

Distinction documented between: artifact-byte stability, wire-schema stability,
semantic stability.

---

## 11. Deprecation and Retirement Policy

```
ACTIVE → DEPRECATED → RETIRED → TOMBSTONED
```

Rules:

- Deprecation does not alter current wire behavior
- Deprecation requires a replacement or explicit reason
- Major versions may coexist
- Existing paid receipts remain verifiable after retirement
- Frozen schemas remain available after retirement
- Tombstoned service IDs cannot be reused
- `.v1` cannot be silently repointed to `.v2`
- Buyers must be able to retrieve historical schemas and verification material

---

## 12. Human Approval Requirements

| Classification                                                        | Approval                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| Patch (documentation_only, example_only, annotation_change)           | Automated if classification matches                  |
| Patch (default_changed)                                               | Human review required                                |
| Minor (optional_property_added, minimum_decreased, maximum_increased) | Human review required                                |
| Major (all others)                                                    | Human approval required + new service major identity |

---

## 13. Baseline Snapshot

The frozen baseline for release 1.0.0 is located at:

```
contracts/releases/1.0.0/
├── CONTRACT_RELEASE.yaml
├── schemas/
│   ├── proof-carrying-context.schema.json
│   ├── common/ (9 files)
│   └── services/ (8 files)
├── openapi/ (3 files)
├── metadata/ (4 files)
├── examples/
├── manifests/
│   └── MANIFEST.json
├── COMPATIBILITY_REPORT.json
└── SHA256SUMS
```

**Requirements:**

1. Snapshot contains exact accepted canonical artifacts
2. Files generated/copied deterministically
3. Every file has SHA-256 entry
4. Snapshot does not depend on Git history alone
5. Compatibility checks compare current contracts to this baseline
6. Snapshot contains no secrets, credentials, or temporary files
7. Baseline is read-only by policy after acceptance
8. Changing baseline requires: explicit release process, new version directory,
   decision record, compatibility classification, human approval
9. Validation detects any modification to frozen baseline

---

## 14. Enforcement Commands

```bash
pnpm contracts:compat          # Compare current to baseline
pnpm contracts:compat:check    # Strict enforcement (CI)
pnpm contracts:baseline:verify # Verify baseline integrity
pnpm contracts:release:verify  # Verify release descriptor consistency
```

These commands run as part of `pnpm check` and GitHub Actions CI.

---

## 15. Revisit Conditions

This policy must be revisited when:

- A new service-major version (`.v2`) is introduced
- PCC schema release moves beyond 1.0.1
- A compatibility classification proves incorrect in production
- Consumer compatibility mode requirements change
- Regulatory or marketplace requirements mandate policy changes
