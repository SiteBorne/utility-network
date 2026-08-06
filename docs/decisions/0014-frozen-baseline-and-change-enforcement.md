# ADR 0014: Frozen Baseline and Change Enforcement

**Status:** Accepted **Date:** 2026-08-05 **Decision Makers:** Architect
**Consulted:** Governance validation

## Context

SUN-0102 requires an immutable, content-addressed compatibility baseline for
service-contract release 1.0.0. The baseline must be verifiable independent of
Git history and must detect any unauthorized modifications.

## Decision

We create a frozen baseline snapshot at `contracts/releases/1.0.0/` containing:

```
contracts/releases/1.0.0/
├── CONTRACT_RELEASE.yaml          # Canonical release descriptor
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

### Baseline Requirements

1. **Exact accepted canonical artifacts** — no generated files, no temporary
   files
2. **Deterministic generation** — copied from canonical locations at freeze time
3. **SHA-256 for every file** — recorded in `SHA256SUMS`
4. **No Git history dependency** — baseline is a standalone directory
5. **No secrets/credentials** — verified by secret scanner
6. **Read-only by policy** — modifications require explicit release process

### Enforcement Mechanism

Three commands enforce baseline integrity:

- `pnpm contracts:baseline:verify` — verifies all baseline files exist and
  hashes match
- `pnpm contracts:compat:check` — compares current contracts to baseline, fails
  on any unclassified change
- `pnpm contracts:release:verify` — verifies release descriptor internal
  consistency

These run as part of `pnpm check` and CI.

### Baseline Modification Process

Changing the frozen baseline requires:

1. Explicit release process (new version directory: `contracts/releases/1.1.0/`
   or `2.0.0/`)
2. Decision record documenting the change
3. Compatibility classification for every change
4. Human approval
5. New `SHA256SUMS` and `COMPATIBILITY_REPORT.json`

## Rationale

- Git history alone is insufficient — commits can be rewritten, tags moved
- Content-addressed baseline ensures exact reproducibility
- SHA256SUMS enables automated verification in CI without human inspection
- Read-only policy prevents accidental drift during development
- Explicit release process ensures all changes are classified and approved

## Consequences

- Baseline snapshot is committed to repository (not gitignored)
- Any modification to `contracts/releases/1.0.0/` after acceptance fails CI
- New releases create new version directories, never modify existing ones
- Compatibility tooling compares current `schemas/`, `registry/services/`,
  `packages/contracts/generated/openapi/` against baseline

## Revisit Condition

When service contract release 1.1.0 or 2.0.0 is created, or if baseline
verification reveals a genuine defect in the frozen artifacts.
