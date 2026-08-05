# PCC Compatibility Policy

## Version

1.0.0

## Overview

This document defines the compatibility policy for the Proof-Carrying Context
(PCC) schema. The policy is frozen at Phase 0 and governs all future schema
evolution.

## Rules

### 1. Additive Evolution Only

- New optional fields may be added to any object
- New enum values may be added
- Default values may be provided for new fields

### 2. No Breaking Changes Without Version Bump

The following require a version bump (minor for additive, major for breaking):

- Removing or renaming any field
- Changing a field's type in a narrowing way
- Removing enum values
- Changing required/optional status of existing fields
- Changing field constraints (e.g., making a pattern stricter)

### 3. Type Compatibility

- Widening types is allowed (e.g., `string` → `string | null`)
- Narrowing types is forbidden (e.g., `string | null` → `string`)
- Object shapes may gain properties but not lose them

### 4. Versioning Scheme

- Patch (1.0.1): Bug fixes to schema documentation only
- Minor (1.1.0): Additive changes (new optional fields, new enum values)
- Major (2.0.0): Any breaking change

### 5. Validation

All schema changes must pass compatibility tests before promotion to
EXECUTABLE_VERIFIED:

- Forward compatibility: v1.0.0 consumers accept v1.1.0 payloads
- Backward compatibility: v1.1.0 consumers accept v1.0.0 payloads
- Round-trip: Serialize → parse → serialize produces equivalent canonical form
