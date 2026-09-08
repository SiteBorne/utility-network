/**
 * SUN-1222C-R4-D10 — `listUnresolvedSettlements` discovery-surface proof.
 *
 * D10's audit found the durable fact of an unresolved ambiguous settlement
 * already exists (`payment_attempts.lifecycle_stage = 'settlement_pending'`,
 * already indexed by `idx_payment_attempts_settlement_pending`, migration
 * 0006_settlement_recovery.sql) but no deterministic, documented way to
 * enumerate it (`D10_UNRESOLVED_DISCOVERY_SURFACE=NONE`). This is the
 * regression proof for the read-only remediation: real D1/Miniflare, no
 * mock, no schema change (no migration file touched by this checkpoint).
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { acquirePaymentAttempt } from '@siteborne/protocol-x402';
import type { PaymentAttemptBinding } from '@siteborne/protocol-x402';
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

function binding(overrides: Partial<PaymentAttemptBinding> = {}): PaymentAttemptBinding {
  return {
    payment_identifier: 'pay_' + Math.random().toString(16).slice(2).padEnd(28, '0'),
    quote_id: 'qte_' + '1'.repeat(24),
    requirement_id: 'req_' + '1'.repeat(24),
    service_id: 'company_evidence_graph.v2',
    service_version: 'v1',
    contract_release: '1.0.0',
    request_input_hash: 'sha256:' + '1'.repeat(64),
    resource_id: 'https://api.siteborne.dev/v2/company/evidence-graph',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '31200',
    payee: '0xPayee',
    ...overrides,
  };
}

const NOW = '2026-09-09T00:00:00.000Z';
const TTL_MS = 5 * 60 * 1000;

describe('D1PaymentAttemptRepository.listUnresolvedSettlements (SUN-1222C-R4-D10)', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  let repo: D1PaymentAttemptRepository;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-unresolved-settlements-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
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

  async function driveToSettlementPending(id: string): Promise<void> {
    await acquirePaymentAttempt(repo, { binding: binding({ payment_identifier: id }), nowIso: NOW, ttlMs: TTL_MS });
    await repo.transitionLifecycleStage(id, 'acquired', 'verified');
    await repo.transitionLifecycleStage(id, 'verified', 'executed');
    await repo.recordSettlementPending(id, {});
  }

  it('an executed (never claimed for settlement) row is excluded', async () => {
    const id = 'pay_' + 'a'.repeat(28);
    await acquirePaymentAttempt(repo, { binding: binding({ payment_identifier: id }), nowIso: NOW, ttlMs: TTL_MS });
    await repo.transitionLifecycleStage(id, 'acquired', 'verified');
    await repo.transitionLifecycleStage(id, 'verified', 'executed');

    const rows = await repo.listUnresolvedSettlements();
    expect(rows.find((r) => r.paymentIdentifier === id)).toBeUndefined();
  });

  it('a genuinely unresolved settlement_pending row is included with safe correlation fields', async () => {
    const id = 'pay_' + 'b'.repeat(28);
    await driveToSettlementPending(id);

    const rows = await repo.listUnresolvedSettlements();
    const row = rows.find((r) => r.paymentIdentifier === id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      paymentIdentifier: id,
      serviceId: 'company_evidence_graph.v2',
      network: 'eip155:8453',
      amount: '31200',
      payee: '0xPayee',
    });
    expect(row!.settlementPendingAt).not.toBeNull();
  });

  it('a resolved settled_external row is excluded (does not accidentally include resolved rows)', async () => {
    const id = 'pay_' + 'c'.repeat(28);
    await driveToSettlementPending(id);
    await repo.recordSettledExternal(id, '0xdeadbeef');

    const rows = await repo.listUnresolvedSettlements();
    expect(rows.find((r) => r.paymentIdentifier === id)).toBeUndefined();
  });

  it('a definitively rejected settlement_failed row is excluded', async () => {
    const id = 'pay_' + 'd'.repeat(28);
    await driveToSettlementPending(id);
    await repo.recordCdpSettlementOutcome(id, 'settlement_pending', 'explicit_rejection', undefined);

    const rows = await repo.listUnresolvedSettlements();
    expect(rows.find((r) => r.paymentIdentifier === id)).toBeUndefined();
  });

  it('olderThanMs restricts results to rows pending longer than the threshold', async () => {
    const id = 'pay_' + 'e'.repeat(28);
    await driveToSettlementPending(id);

    const now = Date.now();
    const notYetStale = await repo.listUnresolvedSettlements({ olderThanMs: 10 * 60 * 1000, nowUnixMs: now });
    expect(notYetStale.find((r) => r.paymentIdentifier === id)).toBeUndefined();

    const definitelyStale = await repo.listUnresolvedSettlements({
      olderThanMs: 1,
      nowUnixMs: now + 60_000,
    });
    expect(definitelyStale.find((r) => r.paymentIdentifier === id)).toBeDefined();
  });

  it('never returns a secret/private/authorization field (safe-field-shape proof)', async () => {
    const id = 'pay_' + 'f'.repeat(28);
    await driveToSettlementPending(id);

    const rows = await repo.listUnresolvedSettlements();
    const row = rows.find((r) => r.paymentIdentifier === id)!;
    const keys = Object.keys(row).map((k) => k.toLowerCase());
    for (const forbidden of ['private', 'secret', 'authorization', 'signature', 'token', 'apikey']) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
  });
});
