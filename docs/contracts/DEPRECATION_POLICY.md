# Service Contract Deprecation Policy

**Policy Version:** contract-compatibility-v1 **Effective:** 2026-08-05

---

## Lifecycle States

```
ACTIVE
    ↓ (deprecation announced)
DEPRECATED
    ↓ (replacement available, migration period elapsed)
RETIRED
    ↓ (no further support, schemas archived)
TOMBSTONED
```

---

## State Definitions

### ACTIVE

- Current production or preproduction version
- Fully supported
- New buyers can integrate

### DEPRECATED

- **Wire behavior unchanged** — no alteration to current schema or validation
- Replacement version exists OR explicit reason documented
- New buyers directed to replacement
- Existing integrations continue to work
- Migration timeline communicated (minimum 90 days)

### RETIRED

- No new integrations accepted
- Existing paid receipts remain verifiable
- Frozen schemas remain available for verification
- No runtime support (if service was implemented)
- Security patches only if critical

### TOMBSTONED

- Service ID permanently retired
- **Cannot be reused** — `.v1` cannot be repointed to `.v2`
- Historical schemas and verification material remain retrievable
- Only archive access

---

## Rules

1. **Deprecation does not alter current wire behavior** — schemas, validation,
   and PCC pairing remain identical

2. **Deprecation requires a replacement or explicit reason** — cannot deprecate
   without path forward

3. **Major versions may coexist** — `.v1` and `.v2` can run in parallel during
   transition

4. **Existing paid receipts remain verifiable after retirement** — PCC
   verification material preserved

5. **Frozen schemas remain available after retirement** — baseline snapshots
   immutable

6. **Tombstoned service IDs cannot be reused** — `.v1` cannot be silently
   repointed to `.v2`

7. **Buyers must be able to retrieve historical schemas and verification
   material** — baseline snapshots serve this purpose

---

## Deprecation Process

1. **Decision Record** — ADR documenting reason, replacement, timeline
2. **Communication** — Machine-readable (catalog, metadata) and human-readable
3. **Migration Period** — Minimum 90 days from deprecation announcement
4. **Retirement** — After migration period, if replacement adopted
5. **Tombstoning** — After retirement period (minimum 1 year), service ID
   tombstoned

---

## Current Status (Release 1.0.0)

All four services are **ACTIVE** at preproduction:

- `company_evidence_graph.v1` — `production_enabled: false`,
  `promotion_state: executable_candidate`
- `web_context_verified.v1` — `production_enabled: false`,
  `promotion_state: executable_candidate`
- `document_evidence_json.v1` — `production_enabled: false`,
  `promotion_state: executable_candidate`
- `verify_agent_output.v1` — `production_enabled: false`,
  `promotion_state: executable_candidate`

**No services are deprecated, retired, or tombstoned in this release.**

---

## Compatibility with Versioning

| Lifecycle Event   | Version Impact                    |
| ----------------- | --------------------------------- |
| Deprecation       | No version change (metadata only) |
| Retirement        | No version change (metadata only) |
| Replacement (.v2) | New service-major identifier      |
| Tombstoning       | No version change (metadata only) |

The `.v1` identifier remains stable throughout the lifecycle. Only a breaking
change replacement creates `.v2`.
