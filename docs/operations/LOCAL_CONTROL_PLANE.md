# Local Control Plane Development Guide

## Overview

This guide describes how to develop and test the SITEBORNE Utility Network
control plane locally without Cloudflare credentials.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Python 3.13+ (for modal-worker)

## Quick Start

### Install Dependencies

```bash
pnpm install
```

### Run All Tests

```bash
pnpm test
```

### Run Control Plane Tests Only

```bash
cd apps/edge-api && pnpm test
```

### Run Specific Test Suites

```bash
# State machine tests
pnpm test -- apps/edge-api/tests/state-machine.test.ts

# Repository tests
pnpm test -- apps/edge-api/tests/repositories.test.ts

# Artifact/Queue tests
pnpm test -- apps/edge-api/tests/artifacts-queue.test.ts

# Quota/Cost tests
pnpm test -- apps/edge-api/tests/quota.test.ts

# Audit tests
pnpm test -- apps/edge-api/tests/audit.test.ts

# Route tests
pnpm test -- apps/edge-api/tests/routes.test.ts
```

### Type Checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
```

### Formatting

```bash
pnpm format
```

## Local Development Commands

### Start Edge API (Hono on Node.js)

```bash
cd apps/edge-api && pnpm dev
```

This starts a local Hono server on port 8787 (or configured port).

### Test Endpoints

```bash
# Health check
curl http://localhost:8787/health

# Readiness check
curl http://localhost:8787/ready

# Service catalog
curl http://localhost:8787/catalog

# Service metadata
curl http://localhost:8787/services/company_evidence_graph.v1

# Schema references
curl http://localhost:8787/schemas

# OpenAPI document
curl http://localhost:8787/openapi.json
```

## Control Plane Architecture

### In-Memory Implementations

All control plane components use in-memory implementations for local
development:

- **Repositories**: Map-based stores with full constraint enforcement
- **Artifact Store**: Content-addressed storage with SHA-256 verification
- **Queue**: In-memory message queue with duplicate delivery simulation
- **Quota**: Resource tracking with scarcity multipliers
- **Audit/Security**: Event logging with PII redaction

### Configuration

Local development uses `createTestConfig()` or `createDevelopmentConfig()`
which:

- Sets `productionEnabled: false`
- Sets `paidOverflowEnabled: false`
- Uses relaxed limits for testing
- No Cloudflare bindings required

### Environment Variables

No environment variables required for local development. The control plane
detects test mode automatically.

## Running Migrations Locally

### D1 Migrations

The control plane includes D1-compatible migrations in
`migrations/0001_control_plane_foundation.sql`.

For local testing, migrations are not applied to a real D1 database. The
in-memory repositories simulate the schema constraints.

To verify migrations locally:

```bash
# Check migration file syntax
sqlite3 :memory: < migrations/0001_control_plane_foundation.sql
```

## Testing Patterns

### Idempotency Testing

```bash
# Test exact duplicate handling
# First request
curl -X POST http://localhost:8787/jobs \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -d '{"service_id": "company_evidence_graph.v1", "input": {...}}'

# Duplicate request (same key, same input)
curl -X POST http://localhost:8787/jobs \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -d '{"service_id": "company_evidence_graph.v1", "input": {...}}'
# Returns original job identity
```

### Concurrency Testing

```bash
# Run concurrent duplicate requests
for i in {1..10}; do
  curl -X POST http://localhost:8787/jobs \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: concurrent-test" \
    -d '{"service_id": "company_evidence_graph.v1", "input": {...}}' &
done
wait
# Exactly one job created
```

### Quota Testing

```bash
# Test quota exhaustion
# Request more units than available
curl -X POST http://localhost:8787/jobs \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: quota-test" \
  -d '{"service_id": "company_evidence_graph.v1", "input": {...}, "resource_units": 1000}'
# Returns QUOTA_EXCEEDED error
```

## Debugging

### Enable Debug Logging

```bash
LOG_LEVEL=debug pnpm dev
```

### Inspect In-Memory State

Add debug endpoints or use Node.js inspector:

```bash
node --inspect apps/edge-api/src/index.ts
```

## CI/CD Integration

### GitHub Actions

The repository includes a CI workflow that runs:

1. `pnpm install`
2. `pnpm format:check`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm python:test:pcc`
7. `pnpm governance:validate`
8. `pnpm state:validate`
9. `pnpm tasks:validate`
10. `pnpm contracts:baseline:verify`
11. `pnpm contracts:compat:check`
12. `pnpm contracts:release:verify`

All steps must pass for merge.

## Troubleshooting

### Tests Failing

1. Run `pnpm format` to fix formatting
2. Run `pnpm lint --fix` to fix linting
3. Check Node.js version (must be 22+)
4. Clear pnpm cache: `pnpm store prune`

### Type Errors

1. Run `pnpm typecheck` for full type checking
2. Check for missing `@siteborne/contracts` types
3. Regenerate types if contracts changed:
   `pnpm --filter @siteborne/pcc-schema generate:services`

### Migration Issues

1. Verify SQLite syntax:
   `sqlite3 :memory: < migrations/0001_control_plane_foundation.sql`
2. Check for D1-specific syntax not supported by SQLite
3. Ensure all constraints are properly defined

## Next Steps

After local development:

1. Run full check suite: `pnpm check`
2. Create commit with conventional message
3. Push to remote (when configured)
4. Deploy to Cloudflare Workers (requires account setup)
