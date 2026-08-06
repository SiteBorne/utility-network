import type { D1Database } from '@cloudflare/workers-types';
import type { ArtifactRecord, QueueDispatch } from '../types';
import type {
  ArtifactsRepository,
  QueueDispatchRepository,
  RepositoryResponse,
} from './interfaces';
import { ok, err } from './interfaces';
import {
  mapArtifactRecord,
  mapQueueDispatch,
  toSingleRepositoryResponse,
  toRepositoryResponse,
} from './shared';

export class D1ArtifactsRepository implements ArtifactsRepository {
  constructor(private db: D1Database) {}

  async create(artifact: ArtifactRecord): Promise<RepositoryResponse<ArtifactRecord>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO job_artifacts (
          id, content_hash, media_type, byte_length, created_at, expires_at,
          authorization_class, retention_class, job_id, artifact_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          artifact.id,
          artifact.content_hash,
          artifact.media_type,
          artifact.byte_length,
          artifact.created_at,
          artifact.expires_at ?? null,
          artifact.authorization_class,
          artifact.retention_class,
          artifact.job_id ?? null,
          artifact.artifact_type
        )
        .run();

      if (!result.success) {
        if (result.error?.includes('UNIQUE constraint')) {
          return err('DUPLICATE_ARTIFACT', 'Artifact already exists');
        }
        return err('DATABASE_ERROR', result.error ?? 'Failed to create artifact');
      }
      return ok(artifact);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getById(id: string): Promise<RepositoryResponse<ArtifactRecord | null>> {
    const stmt = this.db.prepare(`SELECT * FROM job_artifacts WHERE id = ?`);
    const result = await stmt.bind(id).all();
    return toSingleRepositoryResponse(result, mapArtifactRecord);
  }

  async getByContentHash(hash: string): Promise<RepositoryResponse<ArtifactRecord | null>> {
    const stmt = this.db.prepare(`SELECT * FROM job_artifacts WHERE content_hash = ?`);
    const result = await stmt.bind(hash).all();
    return toSingleRepositoryResponse(result, mapArtifactRecord);
  }

  async getByJobId(jobId: string): Promise<RepositoryResponse<ArtifactRecord[]>> {
    const stmt = this.db.prepare(`SELECT * FROM job_artifacts WHERE job_id = ?`);
    const result = await stmt.bind(jobId).all();
    return toRepositoryResponse(result, mapArtifactRecord);
  }

  async delete(id: string): Promise<RepositoryResponse<boolean>> {
    try {
      const stmt = this.db.prepare(`DELETE FROM job_artifacts WHERE id = ?`);
      const result = await stmt.bind(id).run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to delete artifact');
      }
      return ok(result.meta.changes > 0);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async deleteExpired(): Promise<RepositoryResponse<number>> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM job_artifacts WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
      `);
      const result = await stmt.run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to delete expired artifacts');
      }
      return ok(result.meta.changes);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }
}

export class D1QueueDispatchRepository implements QueueDispatchRepository {
  constructor(private db: D1Database) {}

  async create(dispatch: QueueDispatch): Promise<RepositoryResponse<QueueDispatch>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO queue_dispatches (
          id, job_id, attempt_number, service_id, service_version, input_artifact_ref,
          contract_hash, trace_context, dispatched_at, expires_at, retry_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          dispatch.id,
          dispatch.job_id,
          dispatch.attempt_number,
          dispatch.service_id,
          dispatch.service_version,
          dispatch.input_artifact_ref,
          dispatch.contract_hash,
          dispatch.trace_context,
          dispatch.dispatched_at,
          dispatch.expires_at,
          dispatch.retry_count
        )
        .run();

      if (!result.success) {
        if (result.error?.includes('UNIQUE constraint')) {
          return err('DUPLICATE_DISPATCH', 'Dispatch already exists');
        }
        return err('DATABASE_ERROR', result.error ?? 'Failed to create dispatch');
      }
      return ok(dispatch);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getById(id: string): Promise<RepositoryResponse<QueueDispatch | null>> {
    const stmt = this.db.prepare(`SELECT * FROM queue_dispatches WHERE id = ?`);
    const result = await stmt.bind(id).all();
    return toSingleRepositoryResponse(result, mapQueueDispatch);
  }

  async getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<RepositoryResponse<QueueDispatch | null>> {
    const stmt = this.db.prepare(`
      SELECT * FROM queue_dispatches WHERE job_id = ? AND attempt_number = ?
    `);
    const result = await stmt.bind(jobId, attemptNumber).all();
    return toSingleRepositoryResponse(result, mapQueueDispatch);
  }

  async updateRetryCount(
    id: string,
    retryCount: number
  ): Promise<RepositoryResponse<QueueDispatch>> {
    try {
      const stmt = this.db.prepare(`
        UPDATE queue_dispatches SET retry_count = ? WHERE id = ?
      `);
      const result = await stmt.bind(retryCount, id).run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to update retry count');
      }
      if (result.meta.changes === 0) {
        return err('DISPATCH_NOT_FOUND', 'Dispatch not found');
      }

      const getStmt = this.db.prepare(`SELECT * FROM queue_dispatches WHERE id = ?`);
      const getResult = await getStmt.bind(id).all();
      return toSingleRepositoryResponse(getResult, mapQueueDispatch);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async listPending(limit = 100): Promise<RepositoryResponse<QueueDispatch[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM queue_dispatches ORDER BY dispatched_at LIMIT ?
    `);
    const result = await stmt.bind(limit).all();
    return toRepositoryResponse(result, mapQueueDispatch);
  }
}
