---
id: '0002'
title: 'Proof-Carrying Context Boundary'
status: 'accepted'
date: '2026-08-05'
question:
  'What does PCC freeze at Phase 0 vs Phase 3, and what constitutes the
  normative schema?'
options:
  - label:
      'Phase 0 freezes name, version, required semantic fields,
      compatibility/canonicalization/signing policies; Phase 3 freezes complete
      normative JSON Schema'
    description:
      'Semantic field inventory and policies frozen early; wire format schema
      validated and frozen after compatibility tests pass'
  - label: 'Full JSON Schema frozen at Phase 0'
    description: 'Complete PCC wire format frozen immediately with all fields'
  - label: 'No PCC freeze until Phase 3'
    description: 'Everything remains fluid until full validation'
selected:
  'Phase 0 freezes name, version, required semantic fields,
  compatibility/canonicalization/signing policies; Phase 3 freezes complete
  normative JSON Schema'
rubric_score: 92
evidence:
  - "Master directive section 3: 'Core data standard: Proof-Carrying Context,
    version 1.0.0' with required fields listed"
  - "Master directive section 30: 'All schemas are versioned' as completion
    condition"
  - "Phase 3 task: 'Define PCC schema... Freeze version 1.0.0'"
assumptions:
  - 'Required semantic fields list in directive section 3 is complete and stable'
  - 'Compatibility policy: additive fields only, no breaking changes without
    version bump'
  - 'Canonicalization: JSON Canonicalization Scheme (RFC 8785/JCS) for signing'
  - 'Signing: Ed25519 over canonical(output_hash + policy_hash)'
revisit_condition:
  'Schema compatibility tests fail or new required semantic field identified'
---

# Decision Record 0002: Proof-Carrying Context Boundary

## Phase 0 Freeze (Immutable)

- **Name**: Proof-Carrying Context
- **Abbreviation**: PCC
- **Version**: 1.0.0
- **Required semantic fields** (from directive section 3):
  - Contract (service_id, input_hash, schema_hash, maximum_price_usd,
    minimum_quality, freshness_seconds)
  - Input hash (SHA-256)
  - Output schema hash (SHA-256)
  - Subject identity (type, canonical_name, identifiers)
  - Claims (claim_id, predicate, value, confidence, evidence_ids)
  - Evidence (evidence_id, source_uri, retrieved_at, content_hash, locator)
  - Source locators (json_pointer, xpath, css_selector, byte_range, page_range)
  - Retrieval timestamps (ISO 8601 UTC)
  - Freshness metadata (freshness_seconds, retrieved_at)
  - Completeness measurements (requested/populated/supported fields, score,
    missing)
  - Provenance (routes, software_versions, model_routes)
  - Verification results (schema_valid, all_material_claims_supported,
    source_accessibility, cross_source_agreement, policy, decision)
  - Output hash (SHA-256)
  - Policy hash (SHA-256)
  - Ed25519 signed receipt

## Policies Frozen at Phase 0

- **Compatibility**: Additive evolution only. New optional fields permitted.
  Required fields never removed. Breaking changes require version bump (1.1.0,
  2.0.0).
- **Canonicalization**: JSON Canonicalization Scheme (RFC 8785 / JCS) for
  deterministic serialization before hashing/signing.
- **Signing**: Ed25519 signature over `canonical(output_hash || policy_hash)`.
  Signature included in receipt.

## Phase 3 Freeze

- Complete normative JSON Schema (`proof-carrying-context.schema.json`) with all
  field definitions, constraints, examples.
- Validation: schema compatibility tests pass, property-based tests pass, no
  drift from TypeScript/Python models.
- After Phase 3: schema is production-immutable; changes follow compatibility
  policy.

## Current State (SUN-0001)

- `packages/pcc-schema` contains: PCC_VERSION constant, semantic field
  inventory, policy documents, **pre-normative draft schema** (explicitly marked
  `pre_normative: true`).
- The draft schema is NOT the frozen normative schema. It will be validated and
  frozen in Phase 3.
