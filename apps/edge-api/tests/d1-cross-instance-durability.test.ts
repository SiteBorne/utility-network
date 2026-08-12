/**
 * SUN-0900B checkpoint 1B — proves the real root cause of the D1
 * persistence defect found during live testing, and that the fix
 * actually works. `d1Persist: <file path>` is not a recognized option on
 * the installed Miniflare version (5.20260801.0-alpha) — it was silently
 * ignored, so every `apps/edge-api/tests/live/*-live-*.test.ts` run's D1
 * state vanished the instant the process exited (confirmed: every
 * `siteborne-d1-*-live-*` tempdir was empty after real live runs). The
 * real, current option is the shared, top-level `resourcePersistencePath`
 * — a directory Miniflare itself manages, not a single sqlite file path.
 *
 * This test proves cross-*instance* durability (a fresh `new Miniflare()`
 * after the previous one fully disposed, pointed at the same directory)
 * — the same guarantee a real process crash-and-restart needs. It does
 * not merely reuse the same in-memory Miniflare instance/db object,
 * which the already-accepted "D1 persistence survives a fresh app/
 * repository instance" test in x402-service-route.test.ts does instead
 * (proving something different: that a fresh app/repository wrapper
 * around the *same* underlying D1 binding sees committed state — not
 * that state survives the underlying storage engine being torn down and
 * recreated).
 */
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';

describe('D1 cross-instance durability (SUN-0900B checkpoint 1B)', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-durability-'));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('confirms the old d1Persist option name never wrote anything to disk (root-cause regression)', async () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-durability-stale-'));
    const mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      // Deliberately the OLD, wrong option name — proves it's a no-op.
      d1Persist: join(staleDir, 'test.db'),
    } as ConstructorParameters<typeof Miniflare>[0]);
    const db = await mf.getD1Database('DB');
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    await db.prepare('INSERT INTO t (id) VALUES (1)').run();
    await mf.dispose();

    // Nothing was ever written to staleDir — the exact defect that made
    // every historical live run's D1 state unrecoverable after the fact.
    expect(readdirSync(staleDir)).toHaveLength(0);
    rmSync(staleDir, { recursive: true, force: true });
  });

  it('proves state survives a full dispose + fresh Miniflare instance at the same resourcePersistencePath', async () => {
    // --- "process" A: write, then fully tear down ---
    const instanceA = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    const dbA = await instanceA.getD1Database('DB');
    await dbA.exec(
      'CREATE TABLE durability_fixture (payment_identifier TEXT PRIMARY KEY, state TEXT NOT NULL)'
    );
    await dbA
      .prepare('INSERT INTO durability_fixture (payment_identifier, state) VALUES (?, ?)')
      .bind('pay_durability_test', 'SETTLEMENT_PENDING')
      .run();
    await instanceA.dispose();

    // The persistence directory must now actually contain something —
    // the exact assertion that would have caught the original defect.
    expect(readdirSync(tempDir).length).toBeGreaterThan(0);

    // --- "process" B: fresh instance, same directory, no shared memory ---
    const instanceB = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    const dbB = await instanceB.getD1Database('DB');
    const row = await dbB
      .prepare('SELECT state FROM durability_fixture WHERE payment_identifier = ?')
      .bind('pay_durability_test')
      .first<{ state: string }>();
    expect(row).toEqual({ state: 'SETTLEMENT_PENDING' });
    await instanceB.dispose();
  });
});
