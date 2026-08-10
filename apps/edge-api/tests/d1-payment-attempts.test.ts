/**
 * SUN-0700A checkpoint 2 closure — proves payment-identifier/replay
 * semantics through the authoritative local D1 persistence boundary, not
 * only InMemoryPaymentAttemptRepository. Uses the same credential-free,
 * local Miniflare-backed D1 mechanism already accepted for SUN-0200
 * (scripts/d1-verify.ts) — a real SQLite-backed D1Database with real
 * UNIQUE constraint enforcement, not a mock.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  computeBindingDigest,
  InMemoryPaymentAttemptRepository,
  acquirePaymentAttempt,
} from '@siteborne/protocol-x402';
import type { PaymentAttemptBinding, PaymentAttemptRepository } from '@siteborne/protocol-x402';
import { D1PaymentAttemptRepository } from '../src/control-plane/repositories/d1/payment-attempts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

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

function baseBinding(overrides: Partial<PaymentAttemptBinding> = {}): PaymentAttemptBinding {
  return {
    payment_identifier: 'pay_' + Math.random().toString(16).slice(2).padEnd(28, '0'),
    quote_id: 'qte_' + '1'.repeat(24),
    requirement_id: 'req_' + '1'.repeat(24),
    service_id: 'company_evidence_graph.v1',
    service_version: 'v1',
    contract_release: '1.0.0',
    request_input_hash: 'sha256:' + '1'.repeat(64),
    resource_id: 'https://api.siteborne.dev/v1/company_evidence_graph',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '39000',
    payee: '0xPayee',
    ...overrides,
  };
}

const NOW = '2026-08-09T00:00:00.000Z';
const TTL_MS = 5 * 60 * 1000;

describe('D1PaymentAttemptRepository — authoritative persistence (SUN-0700A checkpoint 2 closure)', () => {
  let tempDir: string;
  let dbPath: string;
  let mf: Miniflare;
  let db: D1Database;
  let repo: D1PaymentAttemptRepository;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-payment-attempts-'));
    dbPath = join(tempDir, 'test.db');
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      d1Persist: dbPath,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    repo = new D1PaymentAttemptRepository(db);
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('D1 fresh acquisition / duplicate_same / duplicate_conflict / consumed / expired', () => {
    it('a fresh payment_identifier is acquired (first_seen)', async () => {
      const outcome = await acquirePaymentAttempt(repo, {
        binding: baseBinding(),
        nowIso: NOW,
        ttlMs: TTL_MS,
      });
      expect(outcome.status).toBe('first_seen');
    });

    it('same identifier + identical binding -> duplicate_same', async () => {
      const binding = baseBinding();
      await acquirePaymentAttempt(repo, { binding, nowIso: NOW, ttlMs: TTL_MS });
      const outcome = await acquirePaymentAttempt(repo, {
        binding,
        nowIso: '2026-08-09T00:00:10.000Z',
        ttlMs: TTL_MS,
      });
      expect(outcome.status).toBe('duplicate_same');
    });

    it('same identifier + changed binding -> duplicate_conflict', async () => {
      const binding = baseBinding();
      await acquirePaymentAttempt(repo, { binding, nowIso: NOW, ttlMs: TTL_MS });
      const outcome = await acquirePaymentAttempt(repo, {
        binding: { ...binding, amount: '1' },
        nowIso: '2026-08-09T00:00:10.000Z',
        ttlMs: TTL_MS,
      });
      expect(outcome.status).toBe('duplicate_conflict');
    });

    it('a consumed identifier -> already_consumed', async () => {
      const binding = baseBinding();
      const first = await acquirePaymentAttempt(repo, { binding, nowIso: NOW, ttlMs: TTL_MS });
      expect(first.status).toBe('first_seen');
      await repo.markConsumed(binding.payment_identifier);
      const outcome = await acquirePaymentAttempt(repo, {
        binding,
        nowIso: '2026-08-09T00:00:10.000Z',
        ttlMs: TTL_MS,
      });
      expect(outcome.status).toBe('already_consumed');
    });

    it('an expired identifier -> expired, even with an identical binding retry', async () => {
      const binding = baseBinding();
      await acquirePaymentAttempt(repo, { binding, nowIso: NOW, ttlMs: TTL_MS });
      const outcome = await acquirePaymentAttempt(repo, {
        binding,
        nowIso: '2026-08-09T00:06:00.000Z', // past the 5-minute TTL
        ttlMs: TTL_MS,
      });
      expect(outcome.status).toBe('expired');
    });
  });

  describe('concurrency — real D1, no deliberate serialization', () => {
    it('20 concurrent acquisitions, same identifier + same binding -> exactly 1 first_seen, 19 duplicate_same', async () => {
      const binding = baseBinding();
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          acquirePaymentAttempt(repo, { binding, nowIso: NOW, ttlMs: TTL_MS })
        )
      );
      const firstSeen = results.filter((r) => r.status === 'first_seen');
      const duplicateSame = results.filter((r) => r.status === 'duplicate_same');
      expect(firstSeen).toHaveLength(1);
      expect(duplicateSame).toHaveLength(19);
    });

    it('concurrent acquisitions, same identifier + conflicting bindings -> exactly one authoritative owner, the rest duplicate_conflict', async () => {
      const identifier = 'pay_' + 'c'.repeat(28);
      const bindings = Array.from({ length: 10 }, (_, i) =>
        baseBinding({ payment_identifier: identifier, amount: String(i + 1) })
      );
      const results = await Promise.all(
        bindings.map((binding) =>
          acquirePaymentAttempt(repo, { binding, nowIso: NOW, ttlMs: TTL_MS })
        )
      );
      const firstSeen = results.filter((r) => r.status === 'first_seen');
      const conflicts = results.filter((r) => r.status === 'duplicate_conflict');
      expect(firstSeen).toHaveLength(1);
      expect(conflicts).toHaveLength(9);
      // No result for this identifier is ever a bare "duplicate_same" for
      // a losing binding — every non-winning attempt is a conflict.
      expect(results.filter((r) => r.status === 'duplicate_same')).toHaveLength(0);
    });
  });

  describe('repository-instance restart persistence', () => {
    it('a fresh repository instance over the same D1 database sees an already-acquired identifier as duplicate_same', async () => {
      const binding = baseBinding();
      const repoA = new D1PaymentAttemptRepository(db);
      const first = await acquirePaymentAttempt(repoA, { binding, nowIso: NOW, ttlMs: TTL_MS });
      expect(first.status).toBe('first_seen');

      // A brand-new repository object — nothing shared in memory with repoA
      // except the underlying D1Database connection.
      const repoB = new D1PaymentAttemptRepository(db);
      const outcome = await acquirePaymentAttempt(repoB, {
        binding,
        nowIso: '2026-08-09T00:00:05.000Z',
        ttlMs: TTL_MS,
      });
      expect(outcome.status).toBe('duplicate_same');
    });

    it('a third fresh instance with a different binding for the same identifier -> duplicate_conflict', async () => {
      const binding = baseBinding();
      const repoA = new D1PaymentAttemptRepository(db);
      await acquirePaymentAttempt(repoA, { binding, nowIso: NOW, ttlMs: TTL_MS });

      const repoC = new D1PaymentAttemptRepository(db);
      const outcome = await acquirePaymentAttempt(repoC, {
        binding: { ...binding, amount: '777' },
        nowIso: '2026-08-09T00:00:05.000Z',
        ttlMs: TTL_MS,
      });
      expect(outcome.status).toBe('duplicate_conflict');
    });
  });

  describe('InMemory <-> D1 parity', () => {
    it('the same operation sequence produces the same classifications on both repositories', async () => {
      const inMemory = new InMemoryPaymentAttemptRepository();
      const binding = baseBinding();

      const sequence: Array<{
        repository: PaymentAttemptRepository;
        binding: PaymentAttemptBinding;
        nowIso: string;
      }> = [
        { repository: inMemory, binding, nowIso: NOW },
        { repository: inMemory, binding, nowIso: '2026-08-09T00:00:05.000Z' },
        {
          repository: inMemory,
          binding: { ...binding, amount: '2' },
          nowIso: '2026-08-09T00:00:10.000Z',
        },
      ];

      const inMemoryResults = await Promise.all(
        sequence.map((step) =>
          acquirePaymentAttempt(step.repository, {
            binding: step.binding,
            nowIso: step.nowIso,
            ttlMs: TTL_MS,
          })
        )
      );

      // Same logical sequence, fresh D1 identifier so it doesn't collide
      // with other tests in this file.
      const d1Binding = baseBinding({ payment_identifier: 'pay_' + 'p'.repeat(28) });
      const d1Repo = repo;
      const d1Sequence = [
        { binding: d1Binding, nowIso: NOW },
        { binding: d1Binding, nowIso: '2026-08-09T00:00:05.000Z' },
        { binding: { ...d1Binding, amount: '2' }, nowIso: '2026-08-09T00:00:10.000Z' },
      ];
      const d1Results = [];
      for (const step of d1Sequence) {
        // Sequential on purpose — this is a parity check of classification
        // logic across repository implementations, not a concurrency test.
        d1Results.push(
          await acquirePaymentAttempt(d1Repo, {
            binding: step.binding,
            nowIso: step.nowIso,
            ttlMs: TTL_MS,
          })
        );
      }

      expect(inMemoryResults.map((r) => r.status)).toEqual(d1Results.map((r) => r.status));
      expect(inMemoryResults.map((r) => r.status)).toEqual([
        'first_seen',
        'duplicate_same',
        'duplicate_conflict',
      ]);
    });

    it('expiry boundary semantics match exactly (before / at / after)', async () => {
      const inMemory = new InMemoryPaymentAttemptRepository();
      const inMemoryBinding = baseBinding();
      await acquirePaymentAttempt(inMemory, {
        binding: inMemoryBinding,
        nowIso: NOW,
        ttlMs: TTL_MS,
      });

      const d1Binding = baseBinding({ payment_identifier: 'pay_' + 'e'.repeat(28) });
      await acquirePaymentAttempt(repo, { binding: d1Binding, nowIso: NOW, ttlMs: TTL_MS });

      const before = '2026-08-09T00:04:59.000Z';
      const atExpiry = '2026-08-09T00:05:00.000Z';
      const after = '2026-08-09T00:06:00.000Z';

      for (const nowIso of [before, atExpiry, after]) {
        const inMemoryOutcome = await acquirePaymentAttempt(inMemory, {
          binding: inMemoryBinding,
          nowIso,
          ttlMs: TTL_MS,
        });
        const d1Outcome = await acquirePaymentAttempt(repo, {
          binding: d1Binding,
          nowIso,
          ttlMs: TTL_MS,
        });
        expect(d1Outcome.status).toBe(inMemoryOutcome.status);
      }
    });
  });

  describe('failure injection', () => {
    it('an INSERT against a database missing the payment_attempts table fails closed (repository_error), never first_seen', async () => {
      const brokenMf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
      });
      try {
        const brokenDb = await brokenMf.getD1Database('DB');
        // Deliberately never run migrations — payment_attempts doesn't exist.
        const brokenRepo = new D1PaymentAttemptRepository(brokenDb);
        const outcome = await acquirePaymentAttempt(brokenRepo, {
          binding: baseBinding(),
          nowIso: NOW,
          ttlMs: TTL_MS,
        });
        expect(outcome.status).toBe('repository_error');
        if (outcome.status === 'repository_error') {
          expect(outcome.reason.length).toBeGreaterThan(0);
        }
      } finally {
        await brokenMf.dispose();
      }
    });

    it('a getByIdentifier against a database missing the table returns null rather than throwing', async () => {
      const brokenMf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
      });
      try {
        const brokenDb = await brokenMf.getD1Database('DB');
        const brokenRepo = new D1PaymentAttemptRepository(brokenDb);
        await expect(brokenRepo.getByIdentifier('pay_missing')).resolves.toBeNull();
      } finally {
        await brokenMf.dispose();
      }
    });
  });

  describe('binding digest is computed identically regardless of backing repository', () => {
    it('the digest algorithm itself does not depend on D1 at all (sanity check for the property/model test below)', async () => {
      const binding = baseBinding();
      const digest = await computeBindingDigest(binding);
      expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  describe('model-based parity: bounded operation sequences produce identical classifications on InMemory and D1', () => {
    type Op =
      | { kind: 'acquire'; bindingTag: 'A' | 'B'; nowIso: string }
      | { kind: 'consume'; nowIso: string };

    const SEQUENCES: Op[][] = [
      // acquire A, acquire A (retry), acquire B (conflict)
      [
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:00.000Z' },
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:01.000Z' },
        { kind: 'acquire', bindingTag: 'B', nowIso: '2026-08-09T00:00:02.000Z' },
      ],
      // acquire A, consume, acquire A again (already_consumed)
      [
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:00.000Z' },
        { kind: 'consume', nowIso: '2026-08-09T00:00:01.000Z' },
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:02.000Z' },
      ],
      // acquire A, expire, acquire A again (expired, not resurrected)
      [
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:00.000Z' },
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:06:00.000Z' },
      ],
      // acquire B, acquire A, acquire B (conflict, then conflict again)
      [
        { kind: 'acquire', bindingTag: 'B', nowIso: '2026-08-09T00:00:00.000Z' },
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:01.000Z' },
        { kind: 'acquire', bindingTag: 'B', nowIso: '2026-08-09T00:00:02.000Z' },
      ],
      // acquire A, acquire A, consume, acquire A (duplicate_same then already_consumed)
      [
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:00.000Z' },
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:01.000Z' },
        { kind: 'consume', nowIso: '2026-08-09T00:00:02.000Z' },
        { kind: 'acquire', bindingTag: 'A', nowIso: '2026-08-09T00:00:03.000Z' },
      ],
    ];

    async function runSequence(
      repository: PaymentAttemptRepository,
      identifier: string,
      ops: Op[]
    ): Promise<string[]> {
      const bindings = {
        A: baseBinding({ payment_identifier: identifier }),
        B: baseBinding({ payment_identifier: identifier, amount: '999999' }),
      };
      const statuses: string[] = [];
      for (const op of ops) {
        if (op.kind === 'consume') {
          await repository.markConsumed(identifier);
          continue;
        }
        const outcome = await acquirePaymentAttempt(repository, {
          binding: bindings[op.bindingTag],
          nowIso: op.nowIso,
          ttlMs: TTL_MS,
        });
        statuses.push(outcome.status);
      }
      return statuses;
    }

    it.each(SEQUENCES.map((seq, i) => [i, seq] as const))(
      'sequence %i produces identical classifications on InMemory and D1',
      async (index, ops) => {
        const inMemory = new InMemoryPaymentAttemptRepository();
        const inMemoryResults = await runSequence(
          inMemory,
          `pay_model_inmem_${index}`.padEnd(20, '0'),
          ops
        );

        const d1Results = await runSequence(repo, `pay_model_d1_${index}`.padEnd(20, '0'), ops);

        expect(d1Results).toEqual(inMemoryResults);
      }
    );
  });
});
