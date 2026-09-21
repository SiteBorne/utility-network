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
import { runSettlementAlertSweep } from '../src/control-plane/alerting/settlement-alert-sweep';
import type { SettlementAlertPayload } from '../src/control-plane/alerting/settlement-alert-sweep';

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

describe('listUnresolvedSettlements job derivation (SETTLEMENT-ALERT-PROJECTION-READ-FIX-01)', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  let repo: D1PaymentAttemptRepository;

  const SERVICE_ID = 'company_evidence_graph.v2';

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-alert-job-linkage-'));
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
    await db
      .prepare(
        `INSERT INTO services (id, version, title, description, input_schema, output_schema, price_usd)
         VALUES (?, 'v2', 't', 'd', '{}', '{}', '0.01')`
      )
      .bind(SERVICE_ID)
      .run();
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const INPUT_HASH = 'sha256:' + '1'.repeat(64);

  async function insertJob(
    jobId: string,
    idempotencyKey: string,
    overrides: { serviceId?: string; inputHash?: string } = {}
  ): Promise<void> {
    if (overrides.serviceId && overrides.serviceId !== SERVICE_ID) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO services (id, version, title, description, input_schema, output_schema, price_usd)
           VALUES (?, 'v2', 't', 'd', '{}', '{}', '0.01')`
        )
        .bind(overrides.serviceId)
        .run();
    }
    await db
      .prepare(
        `INSERT INTO jobs (id, request_id, service_id, service_version, input_hash, input_schema_hash,
           output_schema_hash, idempotency_key, contract_release, pcc_dependency, current_state, expires_at)
         VALUES (?, ?, ?, 'v2', ?, 'h', 'h', ?, '1.0.0', 'pcc', 'RECEIVED', '2099-01-01T00:00:00.000Z')`
      )
      .bind(
        jobId,
        'req-' + jobId,
        overrides.serviceId ?? SERVICE_ID,
        overrides.inputHash ?? INPUT_HASH,
        idempotencyKey
      )
      .run();
  }

  async function driveToSettlementPending(
    id: string,
    bindingOverrides: Partial<PaymentAttemptBinding> = {}
  ): Promise<void> {
    await acquirePaymentAttempt(repo, {
      binding: binding({
        payment_identifier: id,
        request_input_hash: INPUT_HASH,
        ...bindingOverrides,
      }),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    await repo.transitionLifecycleStage(id, 'acquired', 'verified');
    await repo.transitionLifecycleStage(id, 'verified', 'executed');
    await repo.recordSettlementPending(id, {});
  }

  async function storedJobId(id: string): Promise<string | null> {
    const row = await db
      .prepare(`SELECT job_id FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(id)
      .first<{ job_id: string | null }>();
    return row?.job_id ?? null;
  }

  // A + B
  it('derives the canonical job id for a linked job while payment_attempts.job_id stays null', async () => {
    const id = 'pay_' + '1'.repeat(28);
    await driveToSettlementPending(id);
    await insertJob('job-linked-0001', id);

    const row = (await repo.listUnresolvedSettlements()).find((r) => r.paymentIdentifier === id)!;
    expect(row.jobId).toBe('job-linked-0001');
    expect(row.jobLinkage).toBe('derived_from_jobs_idempotency_key');
    expect(await storedJobId(id)).toBeNull();
  });

  // C
  it('does not change the stored binding, so a legitimate replay is still an identical duplicate', async () => {
    const id = 'pay_' + '2'.repeat(28);
    await driveToSettlementPending(id);
    await insertJob('job-linked-0002', id);
    const before = await db
      .prepare(`SELECT binding_digest FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(id)
      .first<{ binding_digest: string }>();

    await repo.listUnresolvedSettlements();

    const after = await db
      .prepare(`SELECT binding_digest, job_id FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(id)
      .first<{ binding_digest: string; job_id: string | null }>();
    expect(after!.binding_digest).toBe(before!.binding_digest);
    expect(after!.job_id).toBeNull();

    const replay = await acquirePaymentAttempt(repo, {
      binding: binding({ payment_identifier: id, request_input_hash: INPUT_HASH }),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    expect(replay.status).not.toBe('duplicate_conflict');
    expect(replay.status).not.toBe('repository_error');
    expect(replay.status).not.toBe('first_seen');
  });

  // D
  it('returns null with not_found when no job is linked (never guesses another job)', async () => {
    const id = 'pay_' + '3'.repeat(28);
    await driveToSettlementPending(id);
    await insertJob('job-unrelated-0003', 'pay_' + '9'.repeat(28));

    const row = (await repo.listUnresolvedSettlements()).find((r) => r.paymentIdentifier === id)!;
    expect(row.jobId).toBeNull();
    expect(row.jobLinkage).toBe('not_found');
  });

  // E — structural: the UNIQUE index makes two jobs per key impossible…
  it('cannot have two jobs for one payment identifier (UNIQUE idempotency_key)', async () => {
    const id = 'pay_' + '4'.repeat(28);
    await driveToSettlementPending(id);
    await insertJob('job-first-0004', id);
    await expect(insertJob('job-second-0004', id)).rejects.toThrow(/UNIQUE/);

    const rows = (await repo.listUnresolvedSettlements()).filter((r) => r.paymentIdentifier === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.jobId).toBe('job-first-0004');
  });

  // …and a same-key job that disagrees on a guard is not a match.
  it('treats a same-key job with a different input hash as no linkage', async () => {
    const id = 'pay_' + '5'.repeat(28);
    await driveToSettlementPending(id);
    await insertJob('job-mismatch-0005', id, { inputHash: 'sha256:' + '2'.repeat(64) });

    const row = (await repo.listUnresolvedSettlements()).find((r) => r.paymentIdentifier === id)!;
    expect(row.jobId).toBeNull();
    expect(row.jobLinkage).toBe('not_found');
  });

  it('treats a same-key job under a different service as no linkage', async () => {
    const id = 'pay_' + '6'.repeat(28);
    await driveToSettlementPending(id);
    await insertJob('job-mismatch-0006', id, { serviceId: 'other_service.v2' });

    const row = (await repo.listUnresolvedSettlements()).find((r) => r.paymentIdentifier === id)!;
    expect(row.jobId).toBeNull();
    expect(row.jobLinkage).toBe('not_found');
  });

  it('reports conflict (null) when the attempt job_id and the derived job disagree', async () => {
    const id = 'pay_' + '7'.repeat(28);
    await driveToSettlementPending(id);
    await insertJob('job-derived-0007', id);
    await insertJob('job-other-0007', 'pay_' + '8'.repeat(28));
    // Simulates a hypothetical future/foreign populated binding job_id; the
    // repository itself never writes this column after acquire.
    await db
      .prepare(`UPDATE payment_attempts SET job_id = ? WHERE payment_identifier = ?`)
      .bind('job-other-0007', id)
      .run();

    const row = (await repo.listUnresolvedSettlements()).find((r) => r.paymentIdentifier === id)!;
    expect(row.jobId).toBeNull();
    expect(row.jobLinkage).toBe('conflict');
  });

  // G — retained counter, documented limitation
  it('leaves cdpFacilitatorSettleAttemptCount unchanged (0 for a settlement_pending row)', async () => {
    const id = 'pay_' + 'a1'.repeat(14);
    await driveToSettlementPending(id);
    await insertJob('job-linked-0010', id);

    const row = (await repo.listUnresolvedSettlements()).find((r) => r.paymentIdentifier === id)!;
    expect(row.cdpFacilitatorSettleAttemptCount).toBe(0);
  });

  it('a row that gains a recorded outcome leaves the list (so the counter is structurally 0 here)', async () => {
    const id = 'pay_' + 'b2'.repeat(14);
    await driveToSettlementPending(id);
    await repo.recordCdpSettlementOutcome(id, 'settlement_pending', 'ambiguous', undefined);
    expect(
      (await repo.listUnresolvedSettlements()).find((r) => r.paymentIdentifier === id)
    ).toBeUndefined();
  });

  // H — alert serialization
  it('alert payload has exactly the documented keys and never exposes jobLinkage or private fields', async () => {
    const id = 'pay_' + 'c3'.repeat(14);
    await driveToSettlementPending(id);
    await insertJob('job-linked-0011', id);

    const delivered: SettlementAlertPayload[] = [];
    await runSettlementAlertSweep({
      source: repo,
      transport: async (p) => {
        delivered.push(p);
        return { delivered: true };
      },
      nowUnixMs: Date.now() + 10 * 60 * 1000,
    });
    const payload = delivered.find((p) => p.payment_identifier === id)!;
    expect(payload.job_id).toBe('job-linked-0011');
    expect(Object.keys(payload).sort()).toEqual(
      [
        'event',
        'first_observed_at',
        'job_id',
        'last_observed_at',
        'payment_identifier',
        'reconciliation_attempts',
        'recovery_stage',
        'transaction_reference_present',
      ].sort()
    );
  });
});
