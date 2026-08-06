# ADR 0012: Service Contract Release Versioning

**Status:** Accepted **Date:** 2026-08-05 **Decision Makers:** Architect
**Consulted:** Governance validation

## Context

SUN-0102 freezes the SITEBORNE service-contract surface at version 1.0.0 and
implements deterministic compatibility enforcement. We need to define three
distinct version identities that are often conflated:

1. **PCC Schema Release** (1.0.1): The package/schema release version. This is a
   patch release correcting the `extension_container` schema behavior (adding
   `patternProperties` to allow service-specific extensions). The PCC document
   version (`pcc_version` field in every PCC result) remains 1.0.0 — this
   represents content-compatibility version carried in every signed receipt.

2. **Service Contract Release** (1.0.0): The release covering all 17 canonical
   schemas (9 common + 8 service input/output), generated TypeScript/Python
   models, OpenAPI artifacts, service metadata records, semantic validators, and
   compatibility fixtures.

3. **Individual Service API Versions** (`.v1`): The stable public service-major
   identifiers: `company_evidence_graph.v1`, `web_context_verified.v1`,
   `document_evidence_json.v1`, `verify_agent_output.v1`.

## Decision

We establish three distinct version identities with clear separation:

- **PCC schema release 1.0.1** — package version with schema patch;
  `pcc_version` in documents stays 1.0.0
- **Service contract release 1.0.0** — canonical release version for all service
  contracts
- **Service API versions `.v1`** — public major version identifiers; `.v2`
  required for breaking changes

The service contract release 1.0.0 explicitly depends on PCC schema release
1.0.1 and its SHA-256 hash.

## Rationale

- Conflating PCC schema release with PCC document version causes confusion about
  what "version" means in a signed receipt
- Service contracts depending on a specific PCC schema release (not just
  document version) ensures deterministic validation
- Public service API versions (`.v1`) provide a stable identity that autonomous
  buyers can depend on
- Semantic versioning (1.0.0) for the release allows patch/minor within `.v1`;
  breaking changes require `.v2`

## Consequences

- All version fields in schemas, metadata, and generated artifacts must
  reference the correct identity
- Compatibility tooling must evaluate changes against the correct baseline
- No silent reinterpretation of `.v1` is permitted

## Revisit Condition

If a new PCC schema release (1.0.2+) is issued, or if a service-major version
`.v2` is introduced.
