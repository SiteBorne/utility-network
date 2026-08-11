import type { D1Database } from '@cloudflare/workers-types';
import type { Job, JobAttempt, StateEvent, IdempotencyRecord, AuditEvent } from '../../types';
import type { Clock } from './shared';
import { getD1Failure, systemClock } from './shared';
import { randomUUID } from 'crypto';

export type AcquisitionOutcome = 'acquired' | 'duplicate' | 'conflict';

export interface AcquisitionInput {
  idempotencyKey: string;
  serviceId: string;
  serviceVersion: string;
  inputHash: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  contractRelease: string;
  pccDependency: string;
  requesterIdentityClass?: string;
  quoteId?: string;
  maxAuthorizedCost?: string;
  expiresAt: string;
  traceContext?: string;
}

export interface AcquisitionResult {
  outcome: AcquisitionOutcome;
  job?: Job;
  attempt?: JobAttempt;
  idempotencyRecord?: IdempotencyRecord;
  stateEvent?: StateEvent;
  auditEvent?: AuditEvent;
}

export interface AcquisitionError {
  code: string;
  message: string;
  retryable: boolean;
}

export async function acquireJob(
  db: D1Database,
  input: AcquisitionInput,
  clock: Clock = systemClock
): Promise<{ ok: true; value: AcquisitionResult } | { ok: false; error: AcquisitionError }> {
  const now = clock.now();
  const jobId = randomUUID();
  const attemptId = randomUUID();
  const idempotencyId = randomUUID();
  const stateEventId = randomUUID();
  const auditEventId = randomUUID();

  // First, check if an idempotency record already exists
  const checkStmt = db.prepare(`
    SELECT * FROM idempotency_records
    WHERE idempotency_key = ?
  `);
  const checkResult = await checkStmt.bind(input.idempotencyKey).all();

  if (!checkResult.success) {
    return {
      ok: false,
      error: {
        code: 'DATABASE_ERROR',
        message: checkResult.error ?? 'Failed to check idempotency',
        retryable: true,
      },
    };
  }

  if (checkResult.results.length > 0) {
    const existing = checkResult.results[0] as Record<string, unknown>;

    // Check if it's an exact duplicate (same input hash and schema hash)
    if (
      existing.input_hash === input.inputHash &&
      existing.input_schema_hash === input.inputSchemaHash
    ) {
      // Exact duplicate - return the original job
      const jobStmt = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
      const jobResult = await jobStmt.bind(existing.original_job_id).all();

      if (!jobResult.success || jobResult.results.length === 0) {
        return {
          ok: false,
          error: {
            code: 'INCONSISTENT_STATE',
            message: 'Idempotency record exists but job not found',
            retryable: false,
          },
        };
      }

      const job = jobResult.results[0] as Record<string, unknown>;
      const attemptStmt = db.prepare(`
        SELECT * FROM job_attempts WHERE job_id = ? AND attempt_number = 1
      `);
      const attemptResult = await attemptStmt.bind(job.id).all();

      const attempt = attemptResult.results[0] as Record<string, unknown> | undefined;
      const stateStmt = db.prepare(`
        SELECT * FROM job_state_events WHERE job_id = ? AND attempt_number = 1 ORDER BY timestamp LIMIT 1
      `);
      const stateResult = await stateStmt.bind(job.id).all();

      const stateEvent = stateResult.results[0] as Record<string, unknown> | undefined;

      return {
        ok: true,
        value: {
          outcome: 'duplicate',
          job: mapJob(job),
          attempt: attempt ? mapJobAttempt(attempt) : undefined,
          idempotencyRecord: mapIdempotencyRecord(existing),
          stateEvent: stateEvent ? mapStateEvent(stateEvent) : undefined,
        },
      };
    }

    // Altered duplicate - same key but different input
    // Record security event
    const securityStmt = db.prepare(`
      INSERT INTO security_events (id, event_type, job_id, attempt_number, service_id, details, timestamp, correlation_id, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    await securityStmt
      .bind(
        randomUUID(),
        'IDEMPOTENCY_CONFLICT',
        null,
        null,
        input.serviceId,
        JSON.stringify({
          idempotency_key: input.idempotencyKey,
          expected_input_hash: existing.input_hash,
          expected_input_schema_hash: existing.input_schema_hash,
          provided_input_hash: input.inputHash,
          provided_input_schema_hash: input.inputSchemaHash,
        }),
        now,
        null,
        'high'
      )
      .run();

    return {
      ok: true,
      value: {
        outcome: 'conflict',
      },
    };
  }

  // No existing idempotency record - proceed with atomic acquisition
  // Use D1 batch for transactional execution
  const statements = [
    // 1. Insert idempotency record
    db
      .prepare(
        `
      INSERT INTO idempotency_records (
        id, idempotency_key, service_id, service_version, input_hash, input_schema_hash,
        requester_identity_class, quote_id, created_at, expires_at, original_job_id, original_result_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        idempotencyId,
        input.idempotencyKey,
        input.serviceId,
        input.serviceVersion,
        input.inputHash,
        input.inputSchemaHash,
        input.requesterIdentityClass ?? null,
        input.quoteId ?? null,
        now,
        input.expiresAt,
        jobId,
        null
      ),

    // 2. Insert job
    db
      .prepare(
        `
      INSERT INTO jobs (
        id, request_id, service_id, service_version, input_hash, input_schema_hash,
        output_schema_hash, idempotency_key, contract_release, pcc_dependency,
        current_state, created_at, updated_at, expires_at, attempt_count,
        max_authorized_cost, production_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        jobId,
        randomUUID(), // request_id
        input.serviceId,
        input.serviceVersion,
        input.inputHash,
        input.inputSchemaHash,
        input.outputSchemaHash,
        input.idempotencyKey,
        input.contractRelease,
        input.pccDependency,
        'RECEIVED',
        now,
        now,
        input.expiresAt,
        0,
        input.maxAuthorizedCost ?? null,
        0 // production_enabled = false
      ),

    // 3. Insert first job attempt
    db
      .prepare(
        `
      INSERT INTO job_attempts (
        id, job_id, attempt_number, state, input_artifact_ref, output_artifact_ref,
        error_code, error_message, dispatched_at, started_at, completed_at,
        worker_id, trace_context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        attemptId,
        jobId,
        1,
        'RECEIVED',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        input.traceContext ?? null
      ),

    // 4. Insert initial state event
    db
      .prepare(
        `
      INSERT INTO job_state_events (
        id, job_id, attempt_number, from_state, to_state, reason, actor,
        evidence_ref, previous_state_hash, timestamp, attempt_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        stateEventId,
        jobId,
        1,
        'RECEIVED',
        'RECEIVED',
        'VALIDATION_PASSED',
        'SYSTEM',
        null,
        null,
        now,
        null
      ),

    // 5. Insert audit event
    db
      .prepare(
        `
      INSERT INTO audit_events (
        id, event_type, job_id, attempt_number, service_id, actor, details, timestamp, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        auditEventId,
        'JOB_ACQUIRED',
        jobId,
        1,
        input.serviceId,
        'SYSTEM',
        JSON.stringify({
          idempotency_key: input.idempotencyKey,
          input_hash: input.inputHash,
          input_schema_hash: input.inputSchemaHash,
        }),
        now,
        input.traceContext ?? null
      ),
  ];

  try {
    const batchResult = await db.batch(statements);

    // Check if any statement failed
    for (const result of batchResult) {
      const failure = getD1Failure(result);
      if (failure) {
        // Check for unique constraint violations that could indicate race conditions
        if (failure.includes('UNIQUE constraint')) {
          if (failure.includes('idx_idempotency_key')) {
            // Race condition - another request acquired the same key
            // Retry the whole operation
            return acquireJob(db, input, clock);
          }
        }
        return {
          ok: false,
          error: {
            code: 'ACQUISITION_FAILED',
            message: failure,
            retryable: !failure.includes('constraint'),
          },
        };
      }
    }

    // All succeeded - fetch the created records
    const jobStmt = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
    const jobResult = await jobStmt.bind(jobId).all();
    const job = mapJob(jobResult.results[0] as Record<string, unknown>);

    const attemptStmt = db.prepare(`SELECT * FROM job_attempts WHERE id = ?`);
    const attemptResult = await attemptStmt.bind(attemptId).all();
    const attempt = mapJobAttempt(attemptResult.results[0] as Record<string, unknown>);

    const idempotencyStmt = db.prepare(`SELECT * FROM idempotency_records WHERE id = ?`);
    const idempotencyResult = await idempotencyStmt.bind(idempotencyId).all();
    const idempotencyRecord = mapIdempotencyRecord(
      idempotencyResult.results[0] as Record<string, unknown>
    );

    const stateStmt = db.prepare(`SELECT * FROM job_state_events WHERE id = ?`);
    const stateResult = await stateStmt.bind(stateEventId).all();
    const stateEvent = mapStateEvent(stateResult.results[0] as Record<string, unknown>);

    const auditStmt = db.prepare(`SELECT * FROM audit_events WHERE id = ?`);
    const auditResult = await auditStmt.bind(auditEventId).all();
    const auditEvent = mapAuditEvent(auditResult.results[0] as Record<string, unknown>);

    return {
      ok: true,
      value: {
        outcome: 'acquired',
        job,
        attempt,
        idempotencyRecord,
        stateEvent,
        auditEvent,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'DATABASE_ERROR',
        message: e instanceof Error ? e.message : 'Unknown error',
        retryable: true,
      },
    };
  }
}

// Helper functions (inline to avoid circular deps)
function mapJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    request_id: row.request_id as string,
    service_id: row.service_id as string,
    service_version: row.service_version as string,
    input_hash: row.input_hash as string,
    input_schema_hash: row.input_schema_hash as string,
    output_schema_hash: row.output_schema_hash as string,
    idempotency_key: row.idempotency_key as string,
    contract_release: row.contract_release as string,
    pcc_dependency: row.pcc_dependency as string,
    current_state: row.current_state as Job['current_state'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    expires_at: row.expires_at as string,
    attempt_count: row.attempt_count as number,
    max_authorized_cost: row.max_authorized_cost as string | undefined,
    production_enabled: Boolean(row.production_enabled),
  };
}

function mapJobAttempt(row: Record<string, unknown>): JobAttempt {
  return {
    id: row.id as string,
    job_id: row.job_id as string,
    attempt_number: row.attempt_number as number,
    state: row.state as JobAttempt['state'],
    input_artifact_ref: row.input_artifact_ref as string | undefined,
    output_artifact_ref: row.output_artifact_ref as string | undefined,
    error_code: row.error_code as string | undefined,
    error_message: row.error_message as string | undefined,
    dispatched_at: row.dispatched_at as string | undefined,
    started_at: row.started_at as string | undefined,
    completed_at: row.completed_at as string | undefined,
    worker_id: row.worker_id as string | undefined,
    trace_context: row.trace_context as string | undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapStateEvent(row: Record<string, unknown>): StateEvent {
  return {
    id: row.id as string,
    job_id: row.job_id as string,
    attempt_number: row.attempt_number as number,
    from_state: row.from_state as StateEvent['from_state'],
    to_state: row.to_state as StateEvent['to_state'],
    reason: row.reason as StateEvent['reason'],
    actor: row.actor as StateEvent['actor'],
    evidence_ref: row.evidence_ref as string | undefined,
    previous_state_hash: row.previous_state_hash as string | undefined,
    timestamp: row.timestamp as string,
    attempt_hash: row.attempt_hash as string | undefined,
  };
}

function mapIdempotencyRecord(row: Record<string, unknown>): IdempotencyRecord {
  return {
    id: row.id as string,
    idempotency_key: row.idempotency_key as string,
    service_id: row.service_id as string,
    service_version: row.service_version as string,
    input_hash: row.input_hash as string,
    input_schema_hash: row.input_schema_hash as string,
    requester_identity_class: row.requester_identity_class as string | undefined,
    quote_id: row.quote_id as string | undefined,
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    original_job_id: row.original_job_id as string,
    original_result_ref: row.original_result_ref as string | undefined,
  };
}

function mapAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: row.id as string,
    event_type: row.event_type as string,
    job_id: row.job_id as string | undefined,
    attempt_number: row.attempt_number as number | undefined,
    service_id: row.service_id as string | undefined,
    actor: row.actor as AuditEvent['actor'],
    details: JSON.parse(row.details as string) as Record<string, unknown>,
    timestamp: row.timestamp as string,
    correlation_id: row.correlation_id as string | undefined,
  };
}
