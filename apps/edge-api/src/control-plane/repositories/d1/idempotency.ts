import type { D1Database } from '@cloudflare/workers-types';
import type { IdempotencyRecord } from '../../types';
import type { IdempotencyRepository, RepositoryResponse } from '../interfaces';
import { ok, err } from '../interfaces';
import {
  getD1Failure,
  mapIdempotencyRecord,
  toRequiredRepositoryResponse,
  toSingleRepositoryResponse,
} from './shared';

export class D1IdempotencyRepository implements IdempotencyRepository {
  constructor(private db: D1Database) {}

  async acquire(record: IdempotencyRecord): Promise<RepositoryResponse<IdempotencyRecord>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO idempotency_records (
          id, idempotency_key, service_id, service_version, input_hash, input_schema_hash,
          requester_identity_class, quote_id, created_at, expires_at, original_job_id, original_result_ref
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          record.id,
          record.idempotency_key,
          record.service_id,
          record.service_version,
          record.input_hash,
          record.input_schema_hash,
          record.requester_identity_class ?? null,
          record.quote_id ?? null,
          record.created_at,
          record.expires_at,
          record.original_job_id,
          record.original_result_ref ?? null
        )
        .run();

      const failure = getD1Failure(result);
      if (failure) {
        if (failure.includes('UNIQUE constraint')) {
          return err('IDEMPOTENCY_CONFLICT', 'Idempotency key already exists');
        }
        return err('DATABASE_ERROR', failure);
      }
      return ok(record);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getByKey(key: string): Promise<RepositoryResponse<IdempotencyRecord | null>> {
    const stmt = this.db.prepare(`SELECT * FROM idempotency_records WHERE idempotency_key = ?`);
    const result = await stmt.bind(key).all();
    return toSingleRepositoryResponse(result, mapIdempotencyRecord);
  }

  async getByKeyAndInput(
    key: string,
    inputHash: string,
    inputSchemaHash: string
  ): Promise<RepositoryResponse<IdempotencyRecord | null>> {
    const stmt = this.db.prepare(`
      SELECT * FROM idempotency_records
      WHERE idempotency_key = ? AND input_hash = ? AND input_schema_hash = ?
    `);
    const result = await stmt.bind(key, inputHash, inputSchemaHash).all();
    return toSingleRepositoryResponse(result, mapIdempotencyRecord);
  }

  async updateResult(
    key: string,
    resultRef: string
  ): Promise<RepositoryResponse<IdempotencyRecord>> {
    try {
      const stmt = this.db.prepare(`
        UPDATE idempotency_records SET original_result_ref = ? WHERE idempotency_key = ?
      `);
      const result = await stmt.bind(resultRef, key).run();

      const failure = getD1Failure(result);
      if (failure) {
        return err('DATABASE_ERROR', failure);
      }
      if (result.meta.changes === 0) {
        return err('IDEMPOTENCY_NOT_FOUND', 'Idempotency record not found');
      }

      const getStmt = this.db.prepare(
        `SELECT * FROM idempotency_records WHERE idempotency_key = ?`
      );
      const getResult = await getStmt.bind(key).all();
      return toRequiredRepositoryResponse(
        getResult,
        mapIdempotencyRecord,
        'IDEMPOTENCY_NOT_FOUND',
        'Idempotency record not found'
      );
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async deleteExpired(): Promise<RepositoryResponse<number>> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM idempotency_records WHERE expires_at < datetime('now')
      `);
      const result = await stmt.run();

      const failure = getD1Failure(result);
      if (failure) {
        return err('DATABASE_ERROR', failure);
      }
      return ok(result.meta.changes);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }
}
