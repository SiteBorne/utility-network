/**
 * SUN-1222C0-R1 — real D1 implementation of `DocumentIngressAdmissionRepository`.
 *
 * The `admitAndIncrement` statement is the load-bearing part of this whole
 * checkpoint's concurrency guarantee (§17): `INSERT ... ON CONFLICT(window_key)
 * DO UPDATE SET count = count + 1 WHERE count < ?`. SQLite (D1's underlying
 * engine) evaluates the `WHERE` guard against the CURRENT (pre-update) row
 * when a conflict occurs; if it is false, the `DO UPDATE` is skipped
 * entirely (the row is left untouched, `meta.changes` is 0) — otherwise it
 * fires and `meta.changes` is 1. Because D1 serializes writes to a single
 * logical database (one writer, not "eventually consistent" per-colo state
 * the way Cloudflare's native Workers Rate Limiting binding documents
 * itself as being — see `document-ingress-admission-control.ts`'s module
 * doc comment for the full comparison), two concurrent callers racing the
 * same `window_key` at exactly the last remaining slot cannot both observe
 * `meta.changes === 1`: SQLite executes one statement fully before the
 * other begins. This is what makes "at most `limit` admits per window,
 * even under concurrency" a real, provable property of this repository
 * rather than an approximation.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { DocumentIngressAdmissionRepository, RepositoryResponse } from '../interfaces';
import { ok, err } from '../interfaces';
import { getD1Failure } from './shared';

export class D1DocumentIngressAdmissionRepository implements DocumentIngressAdmissionRepository {
  constructor(private db: D1Database) {}

  async admitAndIncrement(
    windowKey: string,
    scope: string,
    windowStartMs: number,
    limit: number
  ): Promise<RepositoryResponse<{ admitted: boolean }>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO document_ingress_admission_windows (window_key, scope, count, window_start_ms)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(window_key) DO UPDATE SET count = count + 1
        WHERE document_ingress_admission_windows.count < ?
      `);
      const result = await stmt.bind(windowKey, scope, windowStartMs, limit).run();
      const failure = getD1Failure(result);
      if (failure) {
        return err('DATABASE_ERROR', failure);
      }
      // A fresh row (first request of a window) always inserts (1 <=
      // limit as long as limit >= 1) and a guarded update either fires
      // (admitted) or is suppressed by the WHERE clause (not admitted) —
      // `meta.changes` distinguishes the two without a second read.
      return ok({ admitted: result.meta.changes === 1 });
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async deleteWindowsOlderThan(cutoffMs: number): Promise<RepositoryResponse<number>> {
    try {
      const stmt = this.db.prepare(
        `DELETE FROM document_ingress_admission_windows WHERE window_start_ms < ?`
      );
      const result = await stmt.bind(cutoffMs).run();
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
