import type { D1Database } from '@cloudflare/workers-types';
import type {
  Job,
  JobAttempt,
  StateEvent,
  IdempotencyRecord,
  ArtifactRecord,
  QueueDispatch,
  QuotaReservation,
  AuditEvent,
  SecurityEvent,
  ServiceMetadata,
  ServiceVersion,
} from '../types';
import type { RepositoryResponse } from './interfaces';
import { ok, err } from './interfaces';

export interface D1Bindings {
  DB: D1Database;
}

export interface Clock {
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export function mapJob(row: Record<string, unknown>): Job {
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

export function mapJobAttempt(row: Record<string, unknown>): JobAttempt {
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

export function mapStateEvent(row: Record<string, unknown>): StateEvent {
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

export function mapIdempotencyRecord(row: Record<string, unknown>): IdempotencyRecord {
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

export function mapArtifactRecord(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: row.id as string,
    content_hash: row.content_hash as string,
    media_type: row.media_type as string,
    byte_length: row.byte_length as number,
    created_at: row.created_at as string,
    expires_at: row.expires_at as string | undefined,
    authorization_class: row.authorization_class as ArtifactRecord['authorization_class'],
    retention_class: row.retention_class as ArtifactRecord['retention_class'],
    job_id: row.job_id as string | undefined,
    artifact_type: row.artifact_type as ArtifactRecord['artifact_type'],
  };
}

export function mapQueueDispatch(row: Record<string, unknown>): QueueDispatch {
  return {
    id: row.id as string,
    job_id: row.job_id as string,
    attempt_number: row.attempt_number as number,
    service_id: row.service_id as string,
    service_version: row.service_version as string,
    input_artifact_ref: row.input_artifact_ref as string,
    contract_hash: row.contract_hash as string,
    trace_context: row.trace_context as string,
    dispatched_at: row.dispatched_at as string,
    expires_at: row.expires_at as string,
    retry_count: row.retry_count as number,
  };
}

export function mapQuotaReservation(row: Record<string, unknown>): QuotaReservation {
  return {
    id: row.id as string,
    job_id: row.job_id as string,
    resource_class: row.resource_class as string,
    requested_units: row.requested_units as number,
    remaining_units: row.remaining_units as number,
    reserved_units: row.reserved_units as number,
    replacement_cost: row.replacement_cost as string,
    scarcity_multiplier: row.scarcity_multiplier as string,
    failure_risk_multiplier: row.failure_risk_multiplier as string,
    max_authorized_cost: row.max_authorized_cost as string,
    paid_overflow_enabled: Boolean(row.paid_overflow_enabled),
    reserved_at: row.reserved_at as string,
    expires_at: row.expires_at as string,
    released_at: row.released_at as string | undefined,
  };
}

export function mapAuditEvent(row: Record<string, unknown>): AuditEvent {
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

export function mapSecurityEvent(row: Record<string, unknown>): SecurityEvent {
  return {
    id: row.id as string,
    event_type: row.event_type as string,
    job_id: row.job_id as string | undefined,
    attempt_number: row.attempt_number as number | undefined,
    service_id: row.service_id as string | undefined,
    details: JSON.parse(row.details as string) as Record<string, unknown>,
    timestamp: row.timestamp as string,
    correlation_id: row.correlation_id as string | undefined,
    severity: row.severity as SecurityEvent['severity'],
  };
}

export function mapServiceMetadata(row: Record<string, unknown>): ServiceMetadata {
  return {
    service_id: row.id as string,
    version: row.version as string,
    title: row.title as string,
    description: row.description as string,
    input_schema: row.input_schema as string,
    output_schema: row.output_schema as string,
    price_usd: row.price_usd as string,
    production_enabled: Boolean(row.production_enabled),
    production_ready: Boolean(row.production_ready),
    protocol_status: row.protocol_status as ServiceMetadata['protocol_status'],
  };
}

export function mapServiceVersion(row: Record<string, unknown>): ServiceVersion {
  return {
    id: row.id as string,
    service_id: row.service_id as string,
    version: row.version as string,
    input_schema_hash: row.input_schema_hash as string,
    output_schema_hash: row.output_schema_hash as string,
    contract_release: row.contract_release as string,
    pcc_dependency: row.pcc_dependency as string,
    created_at: row.created_at as string,
    deprecated_at: row.deprecated_at as string | undefined,
  };
}

export class D1RepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'D1RepositoryError';
  }
}

export function toRepositoryResponse<T>(
  result: { success: boolean; results: T[]; error?: string },
  mapFn?: (row: Record<string, unknown>) => T
): RepositoryResponse<T | T[] | null> {
  if (!result.success) {
    const isRetryable =
      result.error?.includes('UNIQUE constraint') === false &&
      result.error?.includes('constraint') === false;
    return err('DATABASE_ERROR', result.error ?? 'Database operation failed', {
      retryable: isRetryable,
    });
  }
  if (mapFn) {
    return ok(result.results.map(mapFn));
  }
  return ok(result.results as T[]);
}

export function toSingleRepositoryResponse<T>(
  result: { success: boolean; results: T[]; error?: string },
  mapFn?: (row: Record<string, unknown>) => T
): RepositoryResponse<T | null> {
  if (!result.success) {
    const isRetryable =
      result.error?.includes('UNIQUE constraint') === false &&
      result.error?.includes('constraint') === false;
    return err('DATABASE_ERROR', result.error ?? 'Database operation failed', {
      retryable: isRetryable,
    });
  }
  if (result.results.length === 0) {
    return ok(null);
  }
  if (mapFn) {
    return ok(mapFn(result.results[0]));
  }
  return ok(result.results[0] as T);
}

export async function executeBatch(
  db: D1Database,
  statements: string[],
  bindingsList: unknown[][]
): Promise<{ success: boolean; results: Record<string, unknown>[]; error?: string }> {
  try {
    const batch = db.batch(statements.map((sql, i) => db.prepare(sql).bind(...bindingsList[i])));
    const results = await batch;
    const allRows: Record<string, unknown>[] = [];
    for (const r of results) {
      if (!r.success) {
        return { success: false, results: [], error: r.error ?? 'Batch failed' };
      }
      if (r.results) {
        allRows.push(...r.results);
      }
    }
    return { success: true, results: allRows };
  } catch (e) {
    return { success: false, results: [], error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
