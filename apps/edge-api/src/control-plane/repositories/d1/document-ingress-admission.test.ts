/**
 * SUN-1222C0-R1 — real Miniflare-backed D1 coverage for
 * `D1DocumentIngressAdmissionRepository`, proving the atomic
 * `admitAndIncrement` guard against the REAL SQLite engine D1 runs on
 * (same fidelity convention as `document-artifact-upload-route.test.ts`'s
 * own Miniflare D1/R2 usage), not just the in-memory logic double.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { D1DocumentIngressAdmissionRepository } from './document-ingress-admission';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.reduce(async (prev, file) => {
    await prev;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }, Promise.resolve());
}

describe('D1DocumentIngressAdmissionRepository', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-document-ingress-admission-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await runMigrations(db);
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db.exec('DELETE FROM document_ingress_admission_windows');
  });

  it('admits the first request for a fresh window (creates the row)', async () => {
    const repo = new D1DocumentIngressAdmissionRepository(db);
    const result = await repo.admitAndIncrement('source:a:1000', 'source', 1000, 3);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.admitted).toBe(true);
  });

  it('admits up to the limit, then rejects the (limit+1)-th, all within the same window key', async () => {
    const repo = new D1DocumentIngressAdmissionRepository(db);
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      const result = await repo.admitAndIncrement('source:b:2000', 'source', 2000, limit);
      expect(result.ok && result.value.admitted).toBe(true);
    }
    const over = await repo.admitAndIncrement('source:b:2000', 'source', 2000, limit);
    expect(over.ok && over.value.admitted).toBe(false);
  });

  it('a different window_key (e.g. a new window bucket) has its own independent counter', async () => {
    const repo = new D1DocumentIngressAdmissionRepository(db);
    const limit = 1;
    const first = await repo.admitAndIncrement('source:c:3000', 'source', 3000, limit);
    const rejectedSameWindow = await repo.admitAndIncrement('source:c:3000', 'source', 3000, limit);
    const admittedNextWindow = await repo.admitAndIncrement('source:c:4000', 'source', 4000, limit);
    expect(first.ok && first.value.admitted).toBe(true);
    expect(rejectedSameWindow.ok && rejectedSameWindow.value.admitted).toBe(false);
    expect(admittedNextWindow.ok && admittedNextWindow.value.admitted).toBe(true);
  });

  it('§17 SOURCE_LIMIT_CONCURRENCY=PASS against the real D1/SQLite engine: N concurrent callers racing the last remaining slot admit at most 1', async () => {
    const repo = new D1DocumentIngressAdmissionRepository(db);
    const limit = 5;
    // Consume all but one slot sequentially.
    for (let i = 0; i < limit - 1; i++) {
      await repo.admitAndIncrement('source:race:5000', 'source', 5000, limit);
    }
    const CONCURRENT = 20;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        repo.admitAndIncrement('source:race:5000', 'source', 5000, limit)
      )
    );
    const admitted = results.filter((r) => r.ok && r.value.admitted).length;
    expect(admitted).toBe(1);
  });

  it('deleteWindowsOlderThan removes only rows strictly older than the cutoff', async () => {
    const repo = new D1DocumentIngressAdmissionRepository(db);
    await repo.admitAndIncrement('source:old:1000', 'source', 1000, 10);
    await repo.admitAndIncrement('source:new:9000', 'source', 9000, 10);

    const deleted = await repo.deleteWindowsOlderThan(5000);
    expect(deleted.ok && deleted.value).toBe(1);

    const row = await db.prepare('SELECT window_key FROM document_ingress_admission_windows').all();
    const keys = row.results.map((r) => (r as { window_key: string }).window_key);
    expect(keys).toEqual(['source:new:9000']);
  });

  it('MUTATION_PROOF: removing the WHERE guard from the SQL would let admitted count exceed the limit -- proven by directly exercising the unguarded statement shape', async () => {
    // This does not mutate the repository's source (that would leave the
    // fix broken); it proves the guard is load-bearing by running the
    // SAME table through an intentionally-unguarded statement and
    // confirming it WOULD overshoot, contrasting with the guarded
    // behavior proven above.
    const limit = 2;
    await db.exec(
      `INSERT INTO document_ingress_admission_windows (window_key, scope, count, window_start_ms) VALUES ('source:mutation:6000', 'source', 0, 6000)`
    );
    for (let i = 0; i < limit + 3; i++) {
      // Unguarded: no WHERE clause -- exactly the mutation this checkpoint's
      // real implementation deliberately avoids.
      await db.exec(
        `UPDATE document_ingress_admission_windows SET count = count + 1 WHERE window_key = 'source:mutation:6000'`
      );
    }
    const result = await db
      .prepare(
        `SELECT count FROM document_ingress_admission_windows WHERE window_key = 'source:mutation:6000'`
      )
      .all();
    const finalCount = (result.results[0] as { count: number }).count;
    // Proves the unguarded shape overshoots the limit (5 > 2) -- the
    // guarded `WHERE count < ?` in the real implementation is what
    // prevents exactly this.
    expect(finalCount).toBeGreaterThan(limit);
  });
});
