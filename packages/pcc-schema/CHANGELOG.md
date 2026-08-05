# Changelog

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
