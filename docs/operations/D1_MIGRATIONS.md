# D1 Migrations Guide

## Overview

This document describes the D1 migrations for the control plane foundation.

## Migration Files

### 0001_control_plane_foundation.sql

Creates all control plane tables with proper constraints, indexes, and foreign
keys.

## Tables

### services

Service catalog entries.

- `id` (TEXT PRIMARY KEY) - Service ID (e.g., company_evidence_graph.v1)
- `version` (TEXT) - Service version
- `title` (TEXT) - Human-readable title
- `description` (TEXT) - Service description
- `input_schema` (TEXT) - Input schema reference
- `output_schema` (TEXT) - Output schema reference
- `price_usd` (TEXT) - Price in USD (decimal string)
- `production_enabled` (INTEGER) - Boolean flag
- `production_ready` (INTEGER) - Boolean flag
- `protocol_status` (TEXT) - 'preproduction' or 'production'
- `created_at`, `updated_at` (TEXT) - ISO 8601 timestamps

**Indexes**: Unique on `id`

### service_versions

Service version details with schema hashes.

- `id` (TEXT PRIMARY KEY)
- `service_id` (TEXT) - FK to services
- `version` (TEXT)
- `input_schema_hash` (TEXT) - SHA-256 of input schema
- `output_schema_hash` (TEXT) - SHA-256 of output schema
- `contract_release` (TEXT) - Contract release version
- `pcc_dependency` (TEXT) - PCC schema version
- `created_at`, `deprecated_at` (TEXT) - Timestamps

**Indexes**: Unique on (service_id, version), index on service_id

### jobs

Job records for each customer request.

- `id` (TEXT PRIMARY KEY) - UUID
- `request_id` (TEXT) - Request correlation ID
- `service_id` (TEXT) - FK to services
- `service_version` (TEXT)
- `input_hash` (TEXT) - SHA-256 of input
- `input_schema_hash` (TEXT) - SHA-256 of input schema
- `output_schema_hash` (TEXT) - SHA-256 of output schema
- `idempotency_key` (TEXT) - Client-provided idempotency key
- `contract_release` (TEXT)
- `pcc_dependency` (TEXT)
- `current_state` (TEXT) - Orchestration state
- `created_at`, `updated_at`, `expires_at` (TEXT)
- `attempt_count` (INTEGER)
- `max_authorized_cost` (TEXT) - Optional
- `production_enabled` (INTEGER)

**Indexes**:

- Unique on `idempotency_key`
- Unique on (service_id, request_id) for marketplace/external_job_id
- Index on `current_state`, `expires_at`, `service_id`, `created_at`

### job_attempts

Individual execution attempts for a job.

- `id` (TEXT PRIMARY KEY) - UUID
- `job_id` (TEXT) - FK to jobs
- `attempt_number` (INTEGER) - 1-based
- `state` (TEXT) - Current state
- `input_artifact_ref`, `output_artifact_ref` (TEXT) - Artifact references
- `error_code`, `error_message` (TEXT) - Error details
- `dispatched_at`, `started_at`, `completed_at` (TEXT) - Timestamps
- `worker_id`, `trace_context` (TEXT) - Execution metadata

**Indexes**: Unique on (job_id, attempt_number), index on job_id, state

### job_state_events

Audit trail of state transitions.

- `id` (TEXT PRIMARY KEY) - UUID
- `job_id` (TEXT) - FK to jobs
- `attempt_number` (INTEGER)
- `from_state`, `to_state` (TEXT)
- `reason` (TEXT) - Transition reason
- `actor` (TEXT) - SYSTEM, CLIENT, PAYMENT_PROVIDER, VERIFIER, ADMIN
- `evidence_ref`, `previous_state_hash`, `attempt_hash` (TEXT)
- `timestamp` (TEXT) - ISO 8601

**Indexes**: On job_id, (job_id, attempt_number), timestamp

### idempotency_records

Idempotency keys with input binding.

- `id` (TEXT PRIMARY KEY) - UUID
- `idempotency_key` (TEXT) - Client key
- `service_id`, `service_version` (TEXT)
- `input_hash`, `input_schema_hash` (TEXT)
- `requester_identity_class` (TEXT) - Optional
- `quote_id` (TEXT) - Optional
- `created_at`, `expires_at` (TEXT)
- `original_job_id` (TEXT) - FK to jobs
- `original_result_ref` (TEXT) - Optional

**Indexes**: Unique on `idempotency_key`, index on expires_at, (service_id,
service_version), (input_hash, input_schema_hash)

### payment_quotes

Payment quotes for future compatibility (not implemented in SUN-0200).

- `id` (TEXT PRIMARY KEY)
- `job_id` (TEXT) - FK to jobs
- `service_id`, `service_version` (TEXT)
- `amount_usd`, `currency` (TEXT)
- `status` (TEXT) - pending, verified, settled, failed
- `payment_method`, `facilitator` (TEXT)
- `expires_at`, `created_at`, `verified_at`, `settled_at` (TEXT)

**Indexes**: On job_id, status, expires_at

### quota_reservations

Resource quota reservations.

- `id` (TEXT PRIMARY KEY)
- `job_id` (TEXT) - FK to jobs
- `resource_class` (TEXT) - cpu_heavy, storage, network, verification
- `requested_units`, `remaining_units`, `reserved_units` (INTEGER)
- `replacement_cost`, `scarcity_multiplier`, `failure_risk_multiplier` (TEXT)
- `max_authorized_cost` (TEXT)
- `paid_overflow_enabled` (INTEGER)
- `reserved_at`, `expires_at`, `released_at` (TEXT)

**Indexes**: Unique on job_id, index on resource_class, expires_at

### job_artifacts

Artifact storage records.

- `id` (TEXT PRIMARY KEY)
- `content_hash` (TEXT) - SHA-256
- `media_type`, `byte_length` (INTEGER)
- `created_at`, `expires_at` (TEXT)
- `authorization_class` (TEXT) - public, buyer_authorized, private
- `retention_class` (TEXT) - ephemeral, standard, archival
- `job_id` (TEXT) - FK to jobs (nullable)
- `artifact_type` (TEXT) - input, output, intermediate, receipt, audit

**Indexes**: Unique on content_hash, index on job_id, expires_at, artifact_type

### queue_dispatches

Queue dispatch records for worker coordination.

- `id` (TEXT PRIMARY KEY)
- `job_id`, `attempt_number` (TEXT, INTEGER)
- `service_id`, `service_version` (TEXT)
- `input_artifact_ref`, `contract_hash`, `trace_context` (TEXT)
- `dispatched_at`, `expires_at` (TEXT)
- `retry_count` (INTEGER)

**Indexes**: Unique on (job_id, attempt_number), index on job_id, expires_at,
retry_count

### audit_events

Structured audit events.

- `id` (TEXT PRIMARY KEY)
- `event_type` (TEXT)
- `job_id`, `attempt_number`, `service_id` (nullable)
- `actor` (TEXT)
- `details` (TEXT) - JSON
- `timestamp`, `correlation_id` (TEXT)

**Indexes**: On job_id, correlation_id, timestamp, event_type

### security_events

Security-relevant events.

- `id` (TEXT PRIMARY KEY)
- `event_type` (TEXT)
- `job_id`, `attempt_number`, `service_id` (nullable)
- `details` (TEXT) - JSON
- `timestamp`, `correlation_id` (TEXT)
- `severity` (TEXT) - low, medium, high, critical

**Indexes**: On job_id, correlation_id, timestamp, event_type, severity

## Migration Application

### Local Testing

```bash
# Verify migration syntax with SQLite
sqlite3 :memory: < migrations/0001_control_plane_foundation.sql
```

### Cloudflare D1

```bash
# Apply to local D1 (requires wrangler)
wrangler d1 execute siteborne-utility --local --file migrations/0001_control_plane_foundation.sql

# Apply to production D1
wrangler d1 execute siteborne-utility --remote --file migrations/0001_control_plane_foundation.sql
```

## Verification

### Schema Verification

```sql
-- Check all tables exist
SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';

-- Check unique constraints
SELECT * FROM sqlite_master WHERE type='index' AND sql LIKE '%UNIQUE%';

-- Check foreign keys
PRAGMA foreign_key_list(jobs);
```

### Constraint Testing

```sql
-- Test idempotency unique constraint
INSERT INTO idempotency_records (id, idempotency_key, ...) VALUES ('1', 'key1', ...);
INSERT INTO idempotency_records (id, idempotency_key, ...) VALUES ('2', 'key1', ...); -- Should fail

-- Test job attempt unique constraint
INSERT INTO job_attempts (id, job_id, attempt_number, ...) VALUES ('1', 'job1', 1, ...);
INSERT INTO job_attempts (id, job_id, attempt_number, ...) VALUES ('2', 'job1', 1, ...); -- Should fail

-- Test foreign key enforcement
INSERT INTO jobs (id, service_id, ...) VALUES ('job1', 'nonexistent', ...); -- Should fail
```

## Rollback

Migrations are forward-only. To rollback:

1. Restore from D1 backup
2. Or manually drop tables in reverse dependency order

## Notes

- All timestamps use ISO 8601 format (TEXT)
- Monetary values use decimal strings (no binary floating-point)
- SHA-256 hashes stored as `sha256:<hex>`
- UUIDs used for all primary keys
- Migration is idempotent (uses IF NOT EXISTS)
