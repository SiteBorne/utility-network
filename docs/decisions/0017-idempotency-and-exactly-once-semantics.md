# ADR 0017: Idempotency and Exactly-Once Semantics

## Status

Accepted

## Context

The control plane must guarantee that duplicate requests with the same
idempotency key do not create duplicate jobs or executions. This is critical for
payment safety and operational correctness.

## Decision

Idempotency is implemented at the database transaction level with the following
guarantees:

### Exactly-Once Job Creation

- Within the authoritative D1 transaction boundary, exactly one job is created
  per unique (idempotency_key, service_id, service_version, input_hash,
  input_schema_hash) tuple
- The idempotency record is acquired atomically with job creation
- Concurrent duplicate requests are serialized by the database unique constraint
  on idempotency_key

### Duplicate Request Handling

1. **First valid request**: Acquires idempotency record, creates one job,
   creates one initial attempt, permits one dispatch
2. **Exact duplicate** (same key, same input hash, same schema hash): Returns
   original job identity, does not create another attempt, does not enqueue
   another dispatch
3. **Same key, changed input**: Rejected as conflict (IDEMPOTENCY_CONFLICT),
   emits security audit event
4. **Concurrent duplicates**: Exactly one request wins the unique constraint;
   others resolve to original job or deterministic conflict result

### At-Least-Once Queue Delivery

- Queue messages may be delivered multiple times (at-least-once)
- Consumer checks authoritative job state before processing
- Duplicate dispatch detection via (job_id, attempt_number) unique constraint
- Duplicate deliveries are safely ignored with audit logging

### No Distributed Global Exactly-Once

The implementation does not claim distributed global exactly-once semantics
beyond:

- Exactly-once job creation within authoritative D1 transaction boundary
- At-least-once queue delivery tolerated through idempotent consumption
- No duplicate logical execution after consumer idempotency checks

## Implementation Details

- Idempotency record includes: idempotency_key, service_id, service_version,
  input_hash, input_schema_hash, requester_identity_class, quote_id, created_at,
  expires_at, original_job_id, original_result_ref
- Unique constraint on idempotency_key enforces serialization
- Expired idempotency records are cleaned up periodically
- Result reference stored for future duplicate responses

## Testing

- Property-based tests for concurrent duplicate scenarios
- Concurrency tests with repeated simultaneous attempts
- Verification that duplicate execution count remains zero
