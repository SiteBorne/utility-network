/**
 * SUN-1222C2-Q1-R2 — real D1 implementation of `SecRateWindowRepository`.
 *
 * `tryAdmit`'s second statement is the load-bearing part of the aggregate
 * guarantee: `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?`.
 * SQLite evaluates the whole statement — including the correlated
 * subquery's COUNT — as one atomic unit; two concurrent callers racing
 * the last remaining slot cannot both observe a COUNT below the ceiling
 * and both insert, because D1 serializes writes to one logical database
 * (the same single-writer-SQLite property
 * `d1/document-ingress-admission.ts`'s own doc comment already documents
 * and this migration's doc comment cites). Batched with a same-transaction
 * DELETE of this provider's expired rows first, so the table never grows
 * unbounded and the COUNT never has to scan stale rows.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { SecRateWindowRepository, RepositoryResponse } from '../interfaces';
import { ok, err } from '../interfaces';
import { getD1Failure } from './shared';

export class D1SecRateWindowRepository implements SecRateWindowRepository {
  constructor(private db: D1Database) {}

  async tryAdmit(
    providerId: string,
    nowMs: number,
    windowStartMs: number,
    ceiling: number
  ): Promise<RepositoryResponse<{ admitted: boolean }>> {
    try {
      const deleteExpired = this.db
        .prepare(`DELETE FROM provider_rate_window WHERE provider_id = ? AND requested_at_ms < ?`)
        .bind(providerId, windowStartMs);

      const admit = this.db
        .prepare(
          `
        INSERT INTO provider_rate_window (id, provider_id, requested_at_ms)
        SELECT ?, ?, ?
        WHERE (
          SELECT COUNT(*) FROM provider_rate_window
          WHERE provider_id = ? AND requested_at_ms >= ?
        ) < ?
      `
        )
        .bind(
          `${providerId}:${nowMs}:${crypto.randomUUID()}`,
          providerId,
          nowMs,
          providerId,
          windowStartMs,
          ceiling
        );

      const results = await this.db.batch([deleteExpired, admit]);
      const admitResult = results[1];
      const failure = getD1Failure(admitResult);
      if (failure) {
        return err('DATABASE_ERROR', failure);
      }
      return ok({ admitted: admitResult.meta.changes === 1 });
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }
}
