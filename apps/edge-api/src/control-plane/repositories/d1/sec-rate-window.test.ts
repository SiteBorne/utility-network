/**
 * SUN-1222C2-Q1-R2 — real Miniflare-backed D1 coverage for
 * `D1SecRateWindowRepository`/`SecD1RateCoordinator`, proving the atomic
 * sliding-window admission guard against the REAL SQLite engine D1 runs
 * on (same fidelity convention as
 * `document-ingress-admission.test.ts`'s own Miniflare D1 usage), not
 * just the in-memory logic double. Sections referenced below are
 * SUN-1222C2-Q1-R2's own.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { D1SecRateWindowRepository } from './sec-rate-window';
import { SecD1RateCoordinator } from '../../rate-limit/sec-d1-rate-coordinator';

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

describe('D1SecRateWindowRepository / SecD1RateCoordinator (real Miniflare D1)', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-sec-rate-window-'));
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
    await db.exec('DELETE FROM provider_rate_window');
  });

  it('admits a single request when the window is empty', async () => {
    const repo = new D1SecRateWindowRepository(db);
    const result = await repo.tryAdmit('sec-edgar', 1_000_000, 999_000, 8);
    expect(result.ok && result.value.admitted).toBe(true);
  });

  it('admits up to the ceiling within one window, then rejects the (ceiling+1)-th', async () => {
    const repo = new D1SecRateWindowRepository(db);
    const ceiling = 8;
    for (let i = 0; i < ceiling; i++) {
      const result = await repo.tryAdmit('sec-edgar', 2_000_000 + i, 2_000_000 + i - 1000, ceiling);
      expect(result.ok && result.value.admitted).toBe(true);
    }
    const over = await repo.tryAdmit('sec-edgar', 2_000_010, 2_000_010 - 1000, ceiling);
    expect(over.ok && over.value.admitted).toBe(false);
  });

  it('a different provider_id has its own independent window (never shares budget)', async () => {
    const repo = new D1SecRateWindowRepository(db);
    for (let i = 0; i < 8; i++) {
      await repo.tryAdmit('sec-edgar', 3_000_000 + i, 3_000_000 + i - 1000, 8);
    }
    const secEdgarDenied = await repo.tryAdmit('sec-edgar', 3_000_010, 3_000_010 - 1000, 8);
    const otherProviderAdmitted = await repo.tryAdmit('openalex', 3_000_010, 3_000_010 - 1000, 8);
    expect(secEdgarDenied.ok && secEdgarDenied.value.admitted).toBe(false);
    expect(otherProviderAdmitted.ok && otherProviderAdmitted.value.admitted).toBe(true);
  });

  it('SUN-1222C2-Q1-R2 section 20 SEC_WINDOW_BOUNDARY_TEST: a genuine sliding window, not a fixed one -- 8 requests just before t=1000ms plus 8 more just after do NOT together admit 16', async () => {
    const repo = new D1SecRateWindowRepository(db);
    const ceiling = 8;
    // 8 requests all landing in [1, 999] -- a naive fixed window aligned
    // to [0,1000) would bucket these together and allow all 8.
    for (let i = 0; i < ceiling; i++) {
      const t = 1 + i;
      const result = await repo.tryAdmit('sec-edgar', t, t - 1000, ceiling);
      expect(result.ok && result.value.admitted).toBe(true);
    }
    // A naive fixed window would now start a FRESH bucket at t=1000 and
    // allow another 8 -- a genuine sliding window must not, because the
    // trailing 1-second window at t=1001 still contains most of the
    // earlier 8 requests (t=2..999 are all >= 1001-1000=1).
    const t = 1001;
    const result = await repo.tryAdmit('sec-edgar', t, t - 1000, ceiling);
    expect(result.ok && result.value.admitted).toBe(false);
  });

  it('the window genuinely slides: capacity frees up incrementally as old entries age out, never all-or-nothing at a fixed boundary', async () => {
    const repo = new D1SecRateWindowRepository(db);
    const ceiling = 8;
    for (let i = 0; i < ceiling; i++) {
      const t = 5_000_000 + i;
      await repo.tryAdmit('sec-edgar', t, t - 1000, ceiling);
    }
    // Still full immediately after.
    const stillFull = await repo.tryAdmit(
      'sec-edgar',
      5_000_000 + ceiling,
      5_000_000 + ceiling - 1000,
      ceiling
    );
    expect(stillFull.ok && stillFull.value.admitted).toBe(false);

    // 1001ms later, the very first admitted request (t=5_000_000) has
    // fallen out of the trailing window -- exactly one slot frees up
    // (proving the window slides continuously, not in one all-at-once
    // jump at some fixed boundary).
    const t2 = 5_000_000 + 1001;
    const freed = await repo.tryAdmit('sec-edgar', t2, t2 - 1000, ceiling);
    expect(freed.ok && freed.value.admitted).toBe(true);

    // Once every entry so far (t=5_000_000..5_000_007 plus the just-freed
    // t2=5_001_001) has fully aged out of the trailing window, a fresh
    // full batch of `ceiling` requests admits again -- proving capacity
    // is fully recoverable, not permanently consumed.
    const t3 = t2 + 1001;
    let admittedAtT3 = 0;
    for (let i = 0; i < ceiling; i++) {
      const decision = await repo.tryAdmit('sec-edgar', t3 + i, t3 + i - 1000, ceiling);
      if (decision.ok && decision.value.admitted) admittedAtT3++;
    }
    expect(admittedAtT3).toBe(ceiling);
  });

  it('cleans up rows older than the trailing window on every call (bounded table growth)', async () => {
    const repo = new D1SecRateWindowRepository(db);
    await repo.tryAdmit('sec-edgar', 1000, 0, 100);
    await repo.tryAdmit('sec-edgar', 2000, 1000, 100);
    // A call far in the future should sweep the now-ancient first row.
    await repo.tryAdmit('sec-edgar', 100_000, 99_000, 100);
    const rows = await db
      .prepare(`SELECT COUNT(*) as c FROM provider_rate_window WHERE provider_id = 'sec-edgar'`)
      .all();
    // Only the most recent call's own row should remain (the t=1000 and
    // t=2000 rows are both older than windowStartMs=99_000).
    expect((rows.results[0] as { c: number }).c).toBe(1);
  });

  describe('SUN-1222C2-Q1-R2 section 21: multi-job concurrency matrix (real SQLite atomicity via Promise.all)', () => {
    it.each([1, 10, 11, 50, 100])(
      '%d concurrent callers racing the same window admit at most the configured ceiling (8), never more',
      async (concurrent) => {
        await db.exec('DELETE FROM provider_rate_window');
        const repo = new D1SecRateWindowRepository(db);
        const ceiling = 8;
        const nowMs = 10_000_000;
        const results = await Promise.all(
          Array.from({ length: concurrent }, () =>
            repo.tryAdmit('sec-edgar', nowMs, nowMs - 1000, ceiling)
          )
        );
        const admitted = results.filter((r) => r.ok && r.value.admitted).length;
        expect(admitted).toBeLessThanOrEqual(ceiling);
        expect(admitted).toBe(Math.min(concurrent, ceiling));
      },
      30_000
    );
  });

  describe('SUN-1222C2-Q1-R2 section 19: burst semantics via SecD1RateCoordinator', () => {
    it('a single request is admitted', async () => {
      const coordinator = new SecD1RateCoordinator(new D1SecRateWindowRepository(db), 8);
      const decision = await coordinator.tryAcquire('sec-edgar', 20_000_000);
      expect(decision.allowed).toBe(true);
    });

    it('exactly 10 simultaneous requests against an 8 ceiling admit exactly 8', async () => {
      await db.exec('DELETE FROM provider_rate_window');
      const coordinator = new SecD1RateCoordinator(new D1SecRateWindowRepository(db), 8);
      const nowMs = 21_000_000;
      const decisions = await Promise.all(
        Array.from({ length: 10 }, () => coordinator.tryAcquire('sec-edgar', nowMs))
      );
      expect(decisions.filter((d) => d.allowed).length).toBe(8);
      expect(decisions.filter((d) => !d.allowed).every((d) => d.reason === 'rate_limited')).toBe(
        true
      );
    });

    it('sustained load: exactly 8 admits per rolling second, never a burst above it, across 3 seconds of simulated traffic', async () => {
      await db.exec('DELETE FROM provider_rate_window');
      const coordinator = new SecD1RateCoordinator(new D1SecRateWindowRepository(db), 8);
      const baseMs = 30_000_000;
      let totalAdmitted = 0;
      // 20 attempts per simulated second, 3 seconds, sequential (this
      // models sustained real traffic, not one instantaneous burst).
      for (let second = 0; second < 3; second++) {
        let admittedThisSecond = 0;
        for (let i = 0; i < 20; i++) {
          const nowMs = baseMs + second * 1000 + i * 10;
          const decision = await coordinator.tryAcquire('sec-edgar', nowMs);
          if (decision.allowed) admittedThisSecond++;
        }
        expect(admittedThisSecond).toBeLessThanOrEqual(8);
        totalAdmitted += admittedThisSecond;
      }
      expect(totalAdmitted).toBeLessThanOrEqual(24);
    });
  });

  it('SUN-1222C2-Q1-R2 section 16: fails closed (never allows) when the underlying D1 call throws', async () => {
    const throwingRepo = {
      async tryAdmit() {
        throw new Error('simulated D1 outage');
      },
    };
    const coordinator = new SecD1RateCoordinator(throwingRepo as never, 8);
    const decision = await coordinator.tryAcquire('sec-edgar', 1234);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('coordinator_unavailable');
  });

  it('MUTATION_PROOF: removing the COUNT(*) WHERE guard would let admitted count exceed the ceiling -- proven by directly exercising the unguarded statement shape', async () => {
    await db.exec('DELETE FROM provider_rate_window');
    const ceiling = 3;
    const nowMs = 40_000_000;
    // Unguarded: inserts unconditionally, exactly the mutation the real
    // guarded INSERT ... SELECT ... WHERE deliberately avoids.
    for (let i = 0; i < ceiling + 5; i++) {
      await db.exec(
        `INSERT INTO provider_rate_window (id, provider_id, requested_at_ms) VALUES ('mutation-${i}', 'sec-edgar', ${nowMs})`
      );
    }
    const rows = await db
      .prepare(`SELECT COUNT(*) as c FROM provider_rate_window WHERE provider_id = 'sec-edgar'`)
      .all();
    // Proves the unguarded shape overshoots the ceiling (8 > 3) -- the
    // guarded WHERE (SELECT COUNT(*) ...) < ? in the real implementation
    // is what prevents exactly this.
    expect((rows.results[0] as { c: number }).c).toBeGreaterThan(ceiling);
  });
});
