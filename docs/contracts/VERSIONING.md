# Service Contract Versioning

**Policy Version:** contract-compatibility-v1 **Effective:** 2026-08-05

---

## Three Version Identities

### 1. PCC Schema Release

- **Current:** 1.0.1
- **Scope:** Package/schema release version
- **PCC 1.0.1** is a patch release correcting `extension_container` schema
  behavior (added `patternProperties` for service-specific extensions)

### 2. PCC Document Version

- **Current:** 1.0.0
- **Scope:** Content-compatibility version carried in every PCC result
  (`pcc_version` field)
- **Unchanged** by PCC schema patch releases

### 3. Service Contract Release

- **Current:** 1.0.0
- **Scope:** All 17 canonical schemas + generated artifacts + OpenAPI + metadata
- Follows semantic versioning within service major `.v1`

### 4. Individual Service API Versions

- `company_evidence_graph.v1`
- `web_context_verified.v1`
- `document_evidence_json.v1`
- `verify_agent_output.v1`
- **Stable public service-major identity** — `.v1` suffix
- Breaking changes require `.v2` (or parallel major)

---

## Versioning Rules

### Service Contract Release (1.0.0)

| Change Type      | Version Bump  | Example                                         |
| ---------------- | ------------- | ----------------------------------------------- |
| Patch-compatible | 1.0.0 → 1.0.1 | Documentation, examples, generator fixes        |
| Minor-compatible | 1.0.0 → 1.1.0 | New optional fields (strict-consumer evaluated) |
| Major-breaking   | 1.0.0 → 2.0.0 | Required fields, enum changes, type changes     |

### Service API Versions (.v1)

| Change                 | Action                                        |
| ---------------------- | --------------------------------------------- |
| Compatible patch/minor | Stays `.v1`, release version bumps            |
| Breaking change        | **New service ID: `.v2`** (or parallel major) |

---

## Dependency Declaration

Service contract release 1.0.0 explicitly depends on:

- PCC schema release: 1.0.1
- PCC schema SHA-256:
  `f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5`
- PCC document version: 1.0.0

---

## Canonical Version Source

Single source of truth: `contracts/CONTRACT_RELEASE.yaml`

Contains:

- Release identity and metadata
- PCC dependency
- All 4 service contracts with schema hashes
- All 9 common schemas with hashes
- Artifact manifest paths
- Compatibility policy reference

---

## Baseline Snapshot

Frozen at: `contracts/releases/1.0.0/`

Immutable after acceptance. Modifications require:

1. Explicit release process
2. New version directory
3. Decision record
4. Compatibility classification
5. Human approval

---

## Enforcement Commands

```bash
pnpm contracts:baseline:verify   # Verify frozen baseline integrity
pnpm contracts:compat            # Compare current to baseline (report)
pnpm contracts:compat:check      # Strict enforcement (CI)
pnpm contracts:release:verify    # Verify release descriptor consistency
```

All run via `pnpm check` and GitHub Actions CI.
