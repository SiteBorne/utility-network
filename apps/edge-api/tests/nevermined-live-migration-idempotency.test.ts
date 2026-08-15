/**
 * SUN-0900B checkpoint 1B — migration-idempotency safety audit
 * (post-`e855a1a`). Credential-free, no live Nevermined call, no
 * `RUN_LIVE_NEVERMINED`. Proves the live harness's migration runner
 * (`apps/edge-api/tests/live/nevermined-live-exact.test.ts`'s
 * `runMigrationsFromDir`/`columnExists`, exported solely for this file)
 * is genuinely idempotent via real-schema introspection — never broad
 * error-message suppression — and that a real, unrelated migration
 * failure still fails closed rather than being silently swallowed.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { columnExists, runMigrationsFromDir } from './live/nevermined-live-exact.test';

const REAL_MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

describe('live-harness migration idempotency (migration-safety audit, SUN-0900B checkpoint 1B)', () => {
  let tempDir: string;
  let miniflare: Miniflare;
  let db: D1Database;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-migration-idempotency-audit-'));
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
  });

  afterEach(async () => {
    await miniflare.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('positive control: a fresh database migrates cleanly (real migrations)', async () => {
    await runMigrationsFromDir(db, REAL_MIGRATIONS_DIR);
    expect(await columnExists(db, 'payment_attempts', 'lifecycle_stage')).toBe(true);
    expect(await columnExists(db, 'payment_attempts', 'nevermined_delegation_id')).toBe(true);
  });

  it('positive control: re-running migrations against an ALREADY-migrated persistent database succeeds — proves e855a1a/this repair', async () => {
    await runMigrationsFromDir(db, REAL_MIGRATIONS_DIR);
    // Dispose and reopen at the SAME persistent path — genuine
    // cross-process reuse, not merely calling the function twice on one
    // in-memory instance.
    await miniflare.dispose();
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');
    await expect(runMigrationsFromDir(db, REAL_MIGRATIONS_DIR)).resolves.not.toThrow();
    // A third pass, for good measure — exactly reproduces payment-attempt
    // #4 -> #5's real sequence.
    await miniflare.dispose();
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');
    await expect(runMigrationsFromDir(db, REAL_MIGRATIONS_DIR)).resolves.not.toThrow();
    expect(await columnExists(db, 'payment_attempts', 'lifecycle_stage')).toBe(true);
  });

  it('columnExists reads the REAL schema, not a side-table — proves this is genuine introspection, never a guessed/tracked ledger that could drift from reality', async () => {
    expect(await columnExists(db, 'payment_attempts', 'lifecycle_stage')).toBe(false);
    await runMigrationsFromDir(db, REAL_MIGRATIONS_DIR);
    expect(await columnExists(db, 'payment_attempts', 'lifecycle_stage')).toBe(true);
    // A column that will never exist stays false even after full migration.
    expect(await columnExists(db, 'payment_attempts', 'this_column_never_existed')).toBe(false);
  });

  it('negative control (the mandatory audit requirement): a genuinely broken, unapplied migration still fails closed — never silently swallowed', async () => {
    const brokenDir = mkdtempSync(join(tmpdir(), 'siteborne-broken-migration-'));
    try {
      writeFileSync(
        join(brokenDir, '0001_broken.sql'),
        `CREATE TABLE this_is_fine (id TEXT PRIMARY KEY);\n` +
          // A real, unrelated failure: referencing a table that does not
          // exist. This must NEVER match the ADD-COLUMN-introspection
          // fast path (it isn't an ADD COLUMN statement at all) and must
          // NEVER be masked by any error-message pattern (there is none
          // in this implementation) — it has to throw.
          `ALTER TABLE table_that_does_not_exist ADD COLUMN whatever TEXT;\n`
      );
      await expect(runMigrationsFromDir(db, brokenDir)).rejects.toThrow();
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });

  it('negative control: a broken migration that also happens to try adding an already-existing column to an EXISTING table is not masked by the ADD-COLUMN fast path — the fast path only ever SKIPS a statement, it never suppresses a different failing one', async () => {
    await runMigrationsFromDir(db, REAL_MIGRATIONS_DIR);
    const brokenDir = mkdtempSync(join(tmpdir(), 'siteborne-broken-migration-2-'));
    try {
      writeFileSync(
        join(brokenDir, '0001_broken.sql'),
        // lifecycle_stage already exists on the real, already-migrated
        // payment_attempts table — the fast path correctly SKIPS this
        // one statement (proven above) — but the very next statement in
        // the same file references a genuinely nonexistent table, and
        // that one must still throw.
        `ALTER TABLE payment_attempts ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'acquired';\n` +
          `ALTER TABLE table_that_does_not_exist ADD COLUMN whatever TEXT;\n`
      );
      await expect(runMigrationsFromDir(db, brokenDir)).rejects.toThrow();
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });
});
