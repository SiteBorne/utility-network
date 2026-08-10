import type { D1Database } from '@cloudflare/workers-types';
import type { Job, JobAttempt, StateEvent } from '../../types';
import type {
  JobsRepository,
  JobAttemptsRepository,
  StateEventsRepository,
  RepositoryResponse,
} from '../interfaces';
import { ok, err } from '../interfaces';
import {
  mapJob,
  mapJobAttempt,
  mapStateEvent,
  toSingleRepositoryResponse,
  toRepositoryResponse,
} from './shared';

export class D1JobsRepository implements JobsRepository {
  constructor(private db: D1Database) {}

  async create(job: Job): Promise<RepositoryResponse<Job>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO jobs (
          id, request_id, service_id, service_version, input_hash, input_schema_hash,
          output_schema_hash, idempotency_key, contract_release, pcc_dependency,
          current_state, created_at, updated_at, expires_at, attempt_count,
          max_authorized_cost, production_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          job.id,
          job.request_id,
          job.service_id,
          job.service_version,
          job.input_hash,
          job.input_schema_hash,
          job.output_schema_hash,
          job.idempotency_key,
          job.contract_release,
          job.pcc_dependency,
          job.current_state,
          job.created_at,
          job.updated_at,
          job.expires_at,
          job.attempt_count,
          job.max_authorized_cost ?? null,
          job.production_enabled ? 1 : 0
        )
        .run();

      if (!result.success) {
        if (result.error?.includes('UNIQUE constraint')) {
          if (result.error.includes('idx_jobs_idempotency_key')) {
            return err('DUPLICATE_IDEMPOTENCY_KEY', 'Idempotency key already exists');
          }
          if (result.error.includes('idx_jobs_marketplace_external')) {
            return err('DUPLICATE_MARKETPLACE_JOB', 'Marketplace job already exists');
          }
          return err('DUPLICATE_JOB', 'Job already exists');
        }
        return err('DATABASE_ERROR', result.error ?? 'Failed to create job');
      }
      return ok(job);
    } catch (e) {
      // Real D1/Miniflare throws on a UNIQUE constraint violation rather
      // than returning `{ success: false }` — see the identical fix in
      // ./services.ts's create() and ADR 0045.
      const message = e instanceof Error ? e.message : 'Unknown error';
      if (message.includes('UNIQUE constraint')) {
        if (message.includes('idx_jobs_idempotency_key')) {
          return err('DUPLICATE_IDEMPOTENCY_KEY', 'Idempotency key already exists');
        }
        if (message.includes('idx_jobs_marketplace_external')) {
          return err('DUPLICATE_MARKETPLACE_JOB', 'Marketplace job already exists');
        }
        return err('DUPLICATE_JOB', 'Job already exists');
      }
      return err('DATABASE_ERROR', message);
    }
  }

  async getById(id: string): Promise<RepositoryResponse<Job | null>> {
    const stmt = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`);
    const result = await stmt.bind(id).all();
    return toSingleRepositoryResponse(result, mapJob);
  }

  async getByIdempotencyKey(key: string): Promise<RepositoryResponse<Job | null>> {
    const stmt = this.db.prepare(`SELECT * FROM jobs WHERE idempotency_key = ?`);
    const result = await stmt.bind(key).all();
    return toSingleRepositoryResponse(result, mapJob);
  }

  async updateState(
    id: string,
    state: Job['current_state'],
    attemptCount?: number
  ): Promise<RepositoryResponse<Job>> {
    try {
      let sql = `UPDATE jobs SET current_state = ?, updated_at = datetime('now')`;
      const params: unknown[] = [state];

      if (attemptCount !== undefined) {
        sql += `, attempt_count = ?`;
        params.push(attemptCount);
      }

      sql += ` WHERE id = ?`;
      params.push(id);

      const stmt = this.db.prepare(sql);
      const result = await stmt.bind(...params).run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to update job state');
      }
      if (result.meta.changes === 0) {
        return err('JOB_NOT_FOUND', 'Job not found');
      }

      const getStmt = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`);
      const getResult = await getStmt.bind(id).all();
      return toSingleRepositoryResponse(getResult, mapJob);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async updateTimestamps(id: string): Promise<RepositoryResponse<Job>> {
    try {
      const stmt = this.db.prepare(`
        UPDATE jobs SET updated_at = datetime('now') WHERE id = ?
      `);
      const result = await stmt.bind(id).run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to update timestamps');
      }
      if (result.meta.changes === 0) {
        return err('JOB_NOT_FOUND', 'Job not found');
      }

      const getStmt = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`);
      const getResult = await getStmt.bind(id).all();
      return toSingleRepositoryResponse(getResult, mapJob);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async listByState(state: Job['current_state'], limit = 100): Promise<RepositoryResponse<Job[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs WHERE current_state = ? ORDER BY created_at LIMIT ?
    `);
    const result = await stmt.bind(state, limit).all();
    return toRepositoryResponse(result, mapJob);
  }
}

export class D1JobAttemptsRepository implements JobAttemptsRepository {
  constructor(private db: D1Database) {}

  async create(attempt: JobAttempt): Promise<RepositoryResponse<JobAttempt>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO job_attempts (
          id, job_id, attempt_number, state, input_artifact_ref, output_artifact_ref,
          error_code, error_message, dispatched_at, started_at, completed_at,
          worker_id, trace_context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          attempt.id,
          attempt.job_id,
          attempt.attempt_number,
          attempt.state,
          attempt.input_artifact_ref ?? null,
          attempt.output_artifact_ref ?? null,
          attempt.error_code ?? null,
          attempt.error_message ?? null,
          attempt.dispatched_at ?? null,
          attempt.started_at ?? null,
          attempt.completed_at ?? null,
          attempt.worker_id ?? null,
          attempt.trace_context ?? null
        )
        .run();

      if (!result.success) {
        if (result.error?.includes('UNIQUE constraint')) {
          return err('DUPLICATE_ATTEMPT', 'Attempt already exists');
        }
        return err('DATABASE_ERROR', result.error ?? 'Failed to create attempt');
      }
      return ok(attempt);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<RepositoryResponse<JobAttempt | null>> {
    const stmt = this.db.prepare(`
      SELECT * FROM job_attempts WHERE job_id = ? AND attempt_number = ?
    `);
    const result = await stmt.bind(jobId, attemptNumber).all();
    return toSingleRepositoryResponse(result, mapJobAttempt);
  }

  async update(attempt: JobAttempt): Promise<RepositoryResponse<JobAttempt>> {
    try {
      const stmt = this.db.prepare(`
        UPDATE job_attempts SET
          state = ?, input_artifact_ref = ?, output_artifact_ref = ?,
          error_code = ?, error_message = ?, dispatched_at = ?,
          started_at = ?, completed_at = ?, worker_id = ?, trace_context = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `);
      const result = await stmt
        .bind(
          attempt.state,
          attempt.input_artifact_ref ?? null,
          attempt.output_artifact_ref ?? null,
          attempt.error_code ?? null,
          attempt.error_message ?? null,
          attempt.dispatched_at ?? null,
          attempt.started_at ?? null,
          attempt.completed_at ?? null,
          attempt.worker_id ?? null,
          attempt.trace_context ?? null,
          attempt.id
        )
        .run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to update attempt');
      }
      if (result.meta.changes === 0) {
        return err('ATTEMPT_NOT_FOUND', 'Attempt not found');
      }
      return ok(attempt);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async listByJobId(jobId: string): Promise<RepositoryResponse<JobAttempt[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_number
    `);
    const result = await stmt.bind(jobId).all();
    return toRepositoryResponse(result, mapJobAttempt);
  }
}

export class D1StateEventsRepository implements StateEventsRepository {
  constructor(private db: D1Database) {}

  async create(event: StateEvent): Promise<RepositoryResponse<StateEvent>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO job_state_events (
          id, job_id, attempt_number, from_state, to_state, reason, actor,
          evidence_ref, previous_state_hash, timestamp, attempt_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          event.id,
          event.job_id,
          event.attempt_number,
          event.from_state,
          event.to_state,
          event.reason,
          event.actor,
          event.evidence_ref ?? null,
          event.previous_state_hash ?? null,
          event.timestamp,
          event.attempt_hash ?? null
        )
        .run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to create state event');
      }
      return ok(event);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getByJobId(jobId: string): Promise<RepositoryResponse<StateEvent[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM job_state_events WHERE job_id = ? ORDER BY timestamp
    `);
    const result = await stmt.bind(jobId).all();
    return toRepositoryResponse(result, mapStateEvent);
  }

  async getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<RepositoryResponse<StateEvent[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM job_state_events WHERE job_id = ? AND attempt_number = ? ORDER BY timestamp
    `);
    const result = await stmt.bind(jobId, attemptNumber).all();
    return toRepositoryResponse(result, mapStateEvent);
  }
}
