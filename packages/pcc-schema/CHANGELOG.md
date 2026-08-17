# Changelog

## 1.1.0 — 2026-08-17

### Added

- SUN-1000 checkpoint 1M: `service_id` enum gains 4 new `.v2` members
  (`company_evidence_graph.v2`, `web_context_verified.v2`,
  `document_evidence_json.v2`, `verify_agent_output.v2`), additive only —
  classified minor-compatible per `policy/COMPATIBILITY.md` section 1 ("new enum
  values may be added") and section 4 ("Minor (1.1.0): Additive changes... new
  enum values"), not the separate service-contract-release compatibility
  taxonomy (`docs/contracts/COMPATIBILITY_POLICY.md`), which does not govern
  this schema.
- The 4 existing `.v1` members are unchanged; all historical PCC documents
  carrying `.v1` service IDs remain valid under this schema.
- `pcc_version` (document content-compatibility version) is unchanged at
  `1.0.0`.

## 1.0.0 — 2026-08-05

### Added

- Normative PCC 1.0.0 schema with all required sections:
  - `pcc_version`, `job_id`, `contract`, `subject`, `claims`, `evidence`
  - `completeness`, `provenance`, `verification`, `receipt`
- Strict identifier formats (`job_`, `clm_`, `evd_`, `qte_`, `pol_`, `kid_`,
  `idk_`)
- Tagged hash format (`sha256:<64 lowercase hex>`)
- RFC 3339 UTC timestamp normalization
- Decimal-safe monetary representation
- Controlled extension mechanism (`ext_*` namespace)
- Ed25519 signing policy
- JCS (RFC 8785) canonicalization policy
- Semantic compatibility policy (semver-based)
- Zod runtime types generated from canonical schema
- Structural and semantic validation functions
- Cross-language canonicalization fixtures
- 14 normative test fixtures

### Changed

- Schema promoted from pre-normative to normative
- `pre_normative` field removed

### Fixed

- `claim.evidence_ids` no longer requires `minItems: 1` at schema level;
  enforced in semantic validation instead (allows unsupported claims)

## 0.1.0 — 2026-08-04

- Initial pre-normative draft
