# Queue Dispatch Operations

## Overview

The queue dispatch system provides reliable job dispatch to workers with
at-least-once delivery semantics and duplicate detection.

## Interface

### QueueProducer

```typescript
interface QueueProducer {
  send(message: QueueDispatchMessage): Promise<void>;
}
```

### QueueConsumer

```typescript
interface QueueConsumer {
  receive(
    batchSize?: number,
    waitTimeSeconds?: number
  ): Promise<QueueDispatchMessage[]>;
  acknowledge(message: QueueDispatchMessage): Promise<void>;
  release(message: QueueDispatchMessage): Promise<void>;
}
```

### QueueDispatchMessage

```typescript
interface QueueDispatchMessage {
  job_id: string; // UUID
  attempt_number: number; // 1-based
  service_id: string; // Service identifier
  service_version: string; // Service version
  input_artifact_ref: string; // Artifact store reference
  contract_hash: string; // Contract schema hash
  trace_context: string; // Distributed trace context
  dispatched_at: string; // ISO 8601
  expires_at: string; // ISO 8601
  retry_count: number; // 0-based
}
```

## Implementations

### InMemoryQueueProducer/Consumer (Local/Test)

- Array-based queue
- Simulates duplicate delivery
- Immediate acknowledgment
- Configurable batch size

### R2QueueProducerAdapter/ConsumerAdapter (Production)

- Cloudflare Queues integration
- Auto-acknowledgment on successful handler
- Retry with exponential backoff
- Dead letter queue for failed messages

## QueueDispatchHandler

### Dispatching a Job

```typescript
const handler = new QueueDispatchHandler(producer, repository);

const dispatch = await handler.dispatch(
  jobId,
  attemptNumber,
  serviceId,
  serviceVersion,
  inputArtifactRef,
  contractHash,
  traceContext,
  expiresAt
);
```

### Handling Duplicate Delivery

```typescript
const result = await handler.handleDuplicateDelivery(message);
if (result.isDuplicate) {
  // Log and ignore - already dispatched
  await auditLogger.logDuplicateDispatchIgnored(
    message.job_id,
    message.attempt_number
  );
  return;
}
// Process new dispatch
```

### Message Validation

```typescript
const validation = await handler.validateMessage(message);
if (!validation.valid) {
  // Reject expired or max-retried messages
  await auditLogger.logQueueReplay(message.job_id, message.attempt_number);
  return;
}
```

## Delivery Semantics

### At-Least-Once Delivery

- Messages may be delivered multiple times
- Consumer MUST be idempotent
- Duplicate detection via (job_id, attempt_number) unique constraint

### Duplicate Handling

1. Consumer receives message
2. Checks repository for existing dispatch record
3. If exists: log duplicate, acknowledge, return
4. If not exists: create dispatch record, process job

### Expiration

- Messages have `expires_at` timestamp
- Expired messages rejected before processing
- Expired dispatches cleaned by background job

### Retry Logic

- `retry_count` incremented on each retry
- Max retries: 5 (configurable)
- Exponential backoff: 2^retry_count seconds
- After max retries: move to dead letter queue

### Dead Letter Queue

- Messages exceeding max retries
- Messages failing validation
- Messages for unknown/terminal jobs
- Manual inspection required

## Message Schema

Bounded and closed - no arbitrary fields:

- job_id (UUID)
- attempt_number (integer)
- service_id (string)
- service_version (string)
- input_artifact_ref (string)
- contract_hash (string)
- trace_context (string)
- dispatched_at (ISO 8601)
- expires_at (ISO 8601)
- retry_count (integer)

No full documents or large payloads in queue messages.

## Consumer Implementation

### Pre-Processing Checks

1. Validate message schema
2. Check expiration
3. Check retry count
4. Verify job exists and not terminal
5. Verify attempt number matches
6. Check for existing dispatch record

### Processing Flow

```
receive()
  → validateMessage()
  → handleDuplicateDelivery()
  → if duplicate: acknowledge, return
  → create dispatch record
  → update job state to ROUTED
  → acknowledge
```

### Error Handling

- Validation errors: log, acknowledge, don't retry
- Dispatch creation errors: log, release for retry
- Job state errors: log security event, acknowledge

## Monitoring

### Metrics

- Queue depth
- Message age
- Dispatch rate
- Duplicate rate
- Retry rate
- Dead letter rate

### Health Checks

- Queue accessible
- Producer can send
- Consumer can receive
- Dispatch records consistent

## Testing

```bash
# Run queue tests
pnpm test -- apps/edge-api/tests/artifacts-queue.test.ts
```

## Production Deployment

1. Create Cloudflare Queue: `wrangler queues create siteborne-jobs`
2. Configure binding in wrangler.toml
3. Deploy Worker with Queue bindings
4. Configure consumer Worker
5. Set up dead letter queue
6. Configure alerts for queue depth and dead letters
