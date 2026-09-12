import type { D1Database } from '@cloudflare/workers-types';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OPERATOR_CHECKPOINT,
  loadGovernedPlan,
  parseGovernedPlan,
  resolveEvidenceReference,
  runOperator,
  type GovernedPlanRow,
  type OperatorDatabase,
} from './reconcile-payment-attempts-core';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = resolve(ROOT, 'migrations');
const PLAN_PATH = resolve(ROOT, 'scripts/data/sun1222c-legacy-17-model-c-plan.json');
const PLAN = loadGovernedPlan(PLAN_PATH);
const SOURCE_PATH = resolve(ROOT, 'scripts/reconcile-payment-attempts-core.ts');
const FORENSIC_REPORT = resolve(
  ROOT,
  'docs/reports/SUN-1222C-pcc-lifecycle-model-production-migration-and-legacy-classification.md'
);

const activeMiniflare = new Set<Miniflare>();

afterEach(async () => {
  await Promise.all([...activeMiniflare].map((instance) => instance.dispose()));
  activeMiniflare.clear();
});

describe('operator command entrypoint', () => {
  it('loads under the repository CommonJS package before enforcing explicit mode flags', () => {
    const result = spawnSync('pnpm', ['tsx', 'scripts/reconcile-payment-attempts.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('choose exactly one of --dry-run or --apply');
    expect(result.stderr).not.toContain('Top-level await is currently not supported');
  });
});

function migrationStatements(file: string): string[] {
  return readFileSync(resolve(MIGRATIONS, file), 'utf8')
    .split(';')
    .map((raw) =>
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('--'))
        .join(' ')
        .trim()
    )
    .filter(Boolean);
}

async function createDatabase(options: { schema10?: boolean } = {}): Promise<{
  db: D1Database;
  adapter: OperatorDatabase;
}> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  activeMiniflare.add(mf);
  const db = await mf.getD1Database('DB');
  const migrations = [
    '0001_control_plane_foundation.sql',
    '0002_payment_attempt_replay.sql',
    '0003_payment_lifecycle_stage.sql',
    '0004_x402_quotes.sql',
    '0005_payment_rail_binding.sql',
    '0006_settlement_recovery.sql',
    '0007_cdp_settlement_recovery.sql',
    '0008_document_ingress_admission_windows.sql',
    '0009_sec_rate_window.sql',
    ...(options.schema10 === false
      ? []
      : ['0010_lifecycle_reconciliation_and_workflow_ownership.sql']),
  ];
  for (const migration of migrations) {
    for (const statement of migrationStatements(migration)) await db.exec(statement);
  }
  const adapter: OperatorDatabase = {
    async query(sql) {
      return (await db.prepare(sql).all<Record<string, unknown>>()).results;
    },
    async batch(statements) {
      const results = await db.batch(statements.map((statement) => db.prepare(statement)));
      return { changes: results.map((result) => Number(result.meta.changes ?? 0)) };
    },
  };
  return { db, adapter };
}

function rawPaymentIdentifiers(): Map<string, string> {
  const report = readFileSync(FORENSIC_REPORT, 'utf8');
  const values = new Map<string, string>();
  for (const match of report.matchAll(/`([0-9a-f]{8}-[0-9a-f-]{27})`\s*\|\s*`(pay_[0-9a-f]+)`/g)) {
    values.set(match[1], match[2]);
  }
  if (values.size !== 17)
    throw new Error(`expected 17 forensic payment identifiers, got ${values.size}`);
  return values;
}

async function seedProductionShape(db: D1Database): Promise<void> {
  for (const serviceId of ['web_context_verified.v2', 'company_evidence_graph.v2']) {
    await db
      .prepare(
        `INSERT INTO services (id, version, title, description, input_schema, output_schema, price_usd, production_enabled, production_ready, protocol_status)
         VALUES (?, 'v2', ?, 'fixture', '{}', '{}', '0.01', 1, 1, 'production')`
      )
      .bind(serviceId, serviceId)
      .run();
  }
  const identifiers = rawPaymentIdentifiers();
  for (const row of PLAN) {
    const paymentIdentifier = identifiers.get(row.payment_attempt_id);
    if (!paymentIdentifier) throw new Error(`missing fixture identifier for ${row.sequence}`);
    await db
      .prepare(
        `INSERT INTO jobs (
          id, request_id, service_id, service_version, input_hash, input_schema_hash,
          output_schema_hash, idempotency_key, contract_release, pcc_dependency,
          current_state, created_at, updated_at, expires_at, attempt_count, production_enabled
        ) VALUES (?, ?, ?, 'v2', ?, ?, ?, ?, '2.0.0', 'pcc-v1', ?, ?, ?, ?, 1, 1)`
      )
      .bind(
        row.expected_correlated_job_id,
        `request-${row.sequence}`,
        row.expected_service_id,
        `input-${row.sequence}`,
        `input-schema-${row.sequence}`,
        `output-schema-${row.sequence}`,
        paymentIdentifier,
        row.expected_correlated_job_state,
        row.expected_created_at,
        row.expected_created_at,
        '2030-01-01T00:00:00.000Z'
      )
      .run();
    await db
      .prepare(
        `INSERT INTO payment_attempts (
          id, payment_identifier, binding_digest, quote_id, requirement_id, service_id,
          service_version, contract_release, request_input_hash, resource_id, scheme,
          network, asset, amount, payee, created_at, expires_at, lifecycle_stage,
          settlement_transaction_reference
        ) VALUES (?, ?, ?, ?, ?, ?, 'v2', '2.0.0', ?, ?, 'exact',
          'eip155:8453', 'USDC', '10000', '0x0000000000000000000000000000000000000001',
          ?, '2030-01-01T00:00:00.000Z', ?, ?)`
      )
      .bind(
        row.payment_attempt_id,
        paymentIdentifier,
        `binding-${row.sequence}`,
        `quote-${row.sequence}`,
        `requirement-${row.sequence}`,
        row.expected_service_id,
        `input-${row.sequence}`,
        `https://utility.siteborne.net/fixture-${row.sequence}`,
        row.expected_created_at,
        row.expected_lifecycle_stage,
        row.expected_settlement_reference_present ? '0xsettlement-reference' : null
      )
      .run();
  }
  await db
    .prepare(
      `INSERT INTO payment_attempts (
        id, payment_identifier, binding_digest, quote_id, requirement_id, service_id,
        service_version, contract_release, request_input_hash, resource_id, scheme,
        network, asset, amount, payee, created_at, expires_at, lifecycle_stage
      ) VALUES (
        '00000000-0000-4000-8000-000000000018', 'terminal-fixture-18', 'binding-18',
        'quote-18', 'requirement-18', 'web_context_verified.v2', 'v2', '2.0.0',
        'input-18', 'https://utility.siteborne.net/fixture-18', 'exact', 'eip155:8453',
        'USDC', '10000', '0x0000000000000000000000000000000000000001',
        '2026-09-08T14:00:00.000Z', '2030-01-01T00:00:00.000Z', 'settled'
      )`
    )
    .run();
}

function exactEventValues(row: GovernedPlanRow): readonly unknown[] {
  return [
    row.reconciliation_id,
    row.payment_attempt_id,
    row.classification,
    row.actionability,
    row.owner_kind,
    row.reason_code,
    row.evidence_ref,
    OPERATOR_CHECKPOINT,
    JSON.stringify({ job_id: row.expected_correlated_job_id }),
    row.dedupe_key,
    `2026-09-11T00:00:${String(row.sequence).padStart(2, '0')}.000Z`,
  ];
}

async function insertExactEvents(db: D1Database, count: number): Promise<void> {
  const sql = `INSERT INTO payment_attempt_reconciliations (
    id, payment_attempt_id, classification, actionability, owner_kind, reason_code,
    evidence_ref, source, operator_checkpoint, metadata_json, dedupe_key, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'operator', ?, ?, ?, ?)`;
  for (const row of PLAN.slice(0, count)) {
    await db
      .prepare(sql)
      .bind(...exactEventValues(row))
      .run();
  }
}

async function execute(
  adapter: OperatorDatabase,
  mode: 'dry-run' | 'apply',
  plan: readonly GovernedPlanRow[] = PLAN
) {
  return runOperator({
    database: adapter,
    plan,
    repositoryRoot: ROOT,
    databaseName: 'isolated-test',
    remote: false,
    mode,
  });
}

async function reconciliationCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM payment_attempt_reconciliations')
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe('governed plan and commit-pinned evidence contract', () => {
  it('validates 17 complete, canonical, unique plan rows and resolvable evidence targets', () => {
    expect(PLAN).toHaveLength(17);
    expect(PLAN.map((row) => row.sequence)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    const resolutions = PLAN.map((row) => resolveEvidenceReference(row.evidence_ref, row, ROOT));
    expect(resolutions.every((result) => result.ok)).toBe(true);
    expect(new Set(resolutions.map((result) => result.entry?.evidence_id)).size).toBe(17);
  });

  it.each([
    [
      'missing file',
      (row: GovernedPlanRow) =>
        row.evidence_ref.replace('SUN-1222C-pcc-legacy-17-evidence-index.json', 'missing.json'),
    ],
    [
      'missing evidence id',
      (row: GovernedPlanRow) => row.evidence_ref.replace(/#[^#]+$/, '#missing-id'),
    ],
    ['wrong attempt evidence', () => PLAN[1].evidence_ref],
    [
      'wrong commit identity',
      (row: GovernedPlanRow) =>
        row.evidence_ref.replace(/[0-9a-f]{40}/, '0000000000000000000000000000000000000000'),
    ],
    ['malformed reference', () => 'not-an-evidence-reference'],
    [
      'unsupported location',
      (row: GovernedPlanRow) => row.evidence_ref.replace('docs/evidence/', 'docs/reports/'),
    ],
  ])('fails closed for %s', (_label, mutate) => {
    expect(resolveEvidenceReference(mutate(PLAN[0]), PLAN[0], ROOT).ok).toBe(false);
  });

  it('fails closed when a commit-pinned evidence ID is duplicated', () => {
    const repository = mkdtempSync(join(tmpdir(), 'siteborne-evidence-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repository });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repository });
      execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repository });
      mkdirSync(join(repository, 'docs/evidence'), { recursive: true });
      const entry = {
        evidence_id: 'duplicate',
        payment_attempt_id: PLAN[0].payment_attempt_id,
        correlated_job_id: PLAN[0].expected_correlated_job_id,
        classification: PLAN[0].classification,
        reason_code: PLAN[0].reason_code,
      };
      writeFileSync(
        join(repository, 'docs/evidence/index.json'),
        JSON.stringify({
          schema_version: 'sun1222c-legacy-evidence-v1',
          source_forensic_commit: '5ee27296557a8b181ca350ea4bdbf077a83d62b7',
          source_report: 'docs/reports/source.md',
          entries: [entry, entry],
        })
      );
      execFileSync('git', ['add', '.'], { cwd: repository });
      execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository });
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim();
      expect(
        resolveEvidenceReference(
          `git-evidence:v1:${commit}:docs/evidence/index.json#duplicate`,
          PLAN[0],
          repository
        ).ok
      ).toBe(false);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it('rejects strict-schema mutations, duplicates, contradictory settlement, and wrong size', () => {
    expect(() => parseGovernedPlan(PLAN.slice(0, 16))).toThrow();
    expect(() => parseGovernedPlan([...PLAN, PLAN[0]])).toThrow();
    expect(() =>
      parseGovernedPlan(PLAN.map((row, index) => (index ? row : { ...row, unknown: true })))
    ).toThrow();
    expect(() =>
      parseGovernedPlan(
        PLAN.map((row, index) => (index ? row : { ...row, classification: 'unknown' }))
      )
    ).toThrow();
    expect(() =>
      parseGovernedPlan(
        PLAN.map((row, index) =>
          index ? row : { ...row, expected_settlement_reference_present: true }
        )
      )
    ).toThrow();
    expect(() =>
      parseGovernedPlan(
        PLAN.map((row, index) => (index ? row : { ...row, dedupe_key: PLAN[1].dedupe_key }))
      )
    ).toThrow();
  });

  it('contains no silent governed conflict skip', () => {
    expect(readFileSync(SOURCE_PATH, 'utf8')).not.toMatch(
      /ON\s+CONFLICT\s*\([^)]*\)\s+DO\s+NOTHING/i
    );
  });
});

describe('actual isolated D1 operator flow', () => {
  it('performs a fresh exact-17 apply and truthful idempotent no-op', async () => {
    const { db, adapter } = await createDatabase();
    await seedProductionShape(db);
    const attemptsBefore = (await db.prepare('SELECT * FROM payment_attempts ORDER BY id').all())
      .results;
    const jobsBefore = (await db.prepare('SELECT * FROM jobs ORDER BY id').all()).results;

    const dryRun = await execute(adapter, 'dry-run');
    expect(dryRun).toMatchObject({
      whole_plan_state: 'FRESH_APPLY',
      rows_to_insert: 17,
      rows_already_reconciled: 0,
      preimage_conflicts: 0,
      evidence_ref_failures: 0,
    });
    const applied = await execute(adapter, 'apply');
    expect(applied.actual_insert_count).toBe(17);
    expect(applied.post_apply_exact_expected_event_count).toBe(17);
    expect(await reconciliationCount(db)).toBe(17);

    const after = await execute(adapter, 'dry-run');
    expect(after).toMatchObject({
      whole_plan_state: 'EXACT_IDEMPOTENT_NOOP',
      rows_to_insert: 0,
      rows_already_reconciled: 17,
      preimage_conflicts: 0,
      no_mutation_required: true,
    });
    const secondApply = await execute(adapter, 'apply');
    expect(secondApply.actual_insert_count).toBe(0);
    expect(secondApply.no_mutation_required).toBe(true);
    expect(await reconciliationCount(db)).toBe(17);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM payment_workflow_owner_intents')
          .first<{ n: number }>()
      )?.n
    ).toBe(0);
    expect(
      (await db.prepare('SELECT COUNT(*) AS n FROM payment_attempts').first<{ n: number }>())?.n
    ).toBe(18);
    expect((await db.prepare('SELECT * FROM payment_attempts ORDER BY id').all()).results).toEqual(
      attemptsBefore
    );
    expect((await db.prepare('SELECT * FROM jobs ORDER BY id').all()).results).toEqual(jobsBefore);
  });

  it('fails when trustworthy result metadata does not prove exactly 17 inserts', async () => {
    const { db, adapter } = await createDatabase();
    await seedProductionShape(db);
    const wrongCountAdapter: OperatorDatabase = {
      query: adapter.query,
      async batch(statements) {
        const result = await adapter.batch(statements);
        return { changes: result.changes.map((value, index) => (index === 0 ? value - 1 : value)) };
      },
    };
    await expect(execute(wrongCountAdapter, 'apply')).rejects.toThrow(
      'post-apply assertion failed: changes=16'
    );
    expect(await reconciliationCount(db)).toBe(17);
  });

  it('distinguishes exact preimage readiness from missing Model-C schema', async () => {
    const { db, adapter } = await createDatabase({ schema10: false });
    await seedProductionShape(db);
    const result = await execute(adapter, 'dry-run');
    expect(result.rows_with_preimage_match).toBe(17);
    expect(result.reconciliation_apply_ready).toBe('NO_SCHEMA_MISSING');
    expect(result.whole_plan_state).toBe('CONFLICT');
    await expect(execute(adapter, 'apply')).rejects.toThrow('NO_SCHEMA_MISSING');
  });
});

describe('complete payment/job preimage mutation matrix', () => {
  const mutations: Array<[string, (db: D1Database, row: GovernedPlanRow) => Promise<unknown>]> = [
    [
      'lifecycle stage',
      (db, row) =>
        db
          .prepare('UPDATE payment_attempts SET lifecycle_stage = ? WHERE id = ?')
          .bind('executed', row.payment_attempt_id)
          .run(),
    ],
    [
      'service id',
      (db, row) =>
        db
          .prepare('UPDATE payment_attempts SET service_id = ? WHERE id = ?')
          .bind(
            row.expected_service_id === 'web_context_verified.v2'
              ? 'company_evidence_graph.v2'
              : 'web_context_verified.v2',
            row.payment_attempt_id
          )
          .run(),
    ],
    [
      'payment identifier',
      (db, row) =>
        db
          .prepare('UPDATE payment_attempts SET payment_identifier = ? WHERE id = ?')
          .bind('mutated-identifier', row.payment_attempt_id)
          .run(),
    ],
    [
      'correlated job id',
      (db, row) =>
        db
          .prepare('UPDATE jobs SET id = ? WHERE id = ?')
          .bind('00000000-0000-4000-8000-000000000099', row.expected_correlated_job_id)
          .run(),
    ],
    [
      'job state',
      (db, row) =>
        db
          .prepare('UPDATE jobs SET current_state = ? WHERE id = ?')
          .bind('QUEUED', row.expected_correlated_job_id)
          .run(),
    ],
    [
      'settlement presence',
      (db, row) =>
        db
          .prepare('UPDATE payment_attempts SET settlement_transaction_reference = ? WHERE id = ?')
          .bind(
            row.expected_settlement_reference_present ? null : 'unexpected',
            row.payment_attempt_id
          )
          .run(),
    ],
    [
      'created at',
      (db, row) =>
        db
          .prepare('UPDATE payment_attempts SET created_at = ? WHERE id = ?')
          .bind('2020-01-01T00:00:00.000Z', row.payment_attempt_id)
          .run(),
    ],
    [
      'attempt existence',
      (db, row) =>
        db.prepare('DELETE FROM payment_attempts WHERE id = ?').bind(row.payment_attempt_id).run(),
    ],
    [
      'job cardinality zero',
      (db, row) =>
        db.prepare('DELETE FROM jobs WHERE id = ?').bind(row.expected_correlated_job_id).run(),
    ],
    [
      'job cardinality duplicate',
      async (db, row) => {
        await db.exec('DROP INDEX idx_jobs_idempotency_key');
        const identifier = rawPaymentIdentifiers().get(row.payment_attempt_id);
        return db
          .prepare(
            `INSERT INTO jobs (
        id, request_id, service_id, service_version, input_hash, input_schema_hash,
        output_schema_hash, idempotency_key, contract_release, pcc_dependency,
        current_state, expires_at
      ) VALUES ('00000000-0000-4000-8000-000000000098', 'duplicate', ?, 'v2',
        'input', 'in-schema', 'out-schema', ?, '2.0.0', 'pcc-v1', ?, '2030-01-01')`
          )
          .bind(row.expected_service_id, identifier, row.expected_correlated_job_state)
          .run();
      },
    ],
  ];

  it.each(mutations)(
    'fails closed with zero reconciliation writes for %s drift',
    async (_label, mutate) => {
      const { db, adapter } = await createDatabase();
      await seedProductionShape(db);
      await mutate(db, PLAN[8]);
      const dryRun = await execute(adapter, 'dry-run');
      expect(dryRun.whole_plan_state).toBe('CONFLICT');
      expect(dryRun.preimage_conflicts).toBeGreaterThan(0);
      await expect(execute(adapter, 'apply')).rejects.toThrow('CONFLICT');
      expect(await reconciliationCount(db)).toBe(0);
    }
  );
});

describe('preexisting reconciliation state matrix', () => {
  it.each([1, 8, 16])('classifies %i exact preexisting rows as conflict', async (count) => {
    const { db, adapter } = await createDatabase();
    await seedProductionShape(db);
    await insertExactEvents(db, count);
    const summary = await execute(adapter, 'dry-run');
    expect(summary.whole_plan_state).toBe('CONFLICT');
    expect(summary.rows_already_reconciled).toBe(count);
    await expect(execute(adapter, 'apply')).rejects.toThrow('CONFLICT');
    expect(await reconciliationCount(db)).toBe(count);
  });

  it('recognizes 17 exact rows as the only idempotent no-op', async () => {
    const { db, adapter } = await createDatabase();
    await seedProductionShape(db);
    await insertExactEvents(db, 17);
    expect(await execute(adapter, 'dry-run')).toMatchObject({
      whole_plan_state: 'EXACT_IDEMPOTENT_NOOP',
      rows_to_insert: 0,
      rows_already_reconciled: 17,
      no_mutation_required: true,
    });
  });

  it.each([
    ['classification', "classification = 'unreconciled'"],
    ['evidence_ref', "evidence_ref = 'wrong'"],
    ['actionability', "actionability = 'actionable'"],
    ['owner_kind', "owner_kind = 'workflow', owner_reference = 'unexpected-owner'"],
    ['dedupe identity', "dedupe_key = 'unexpected-dedupe'"],
  ])('rejects 17 rows with one wrong %s', async (_label, assignment) => {
    const { db, adapter } = await createDatabase();
    await seedProductionShape(db);
    await insertExactEvents(db, 17);
    await db.exec(
      `UPDATE payment_attempt_reconciliations SET ${assignment} WHERE id = '${PLAN[8].reconciliation_id}'`
    );
    const summary = await execute(adapter, 'dry-run');
    expect(summary.whole_plan_state).toBe('CONFLICT');
    expect(summary.rows_already_reconciled).toBe(16);
  });

  it('rejects an additional superseding conflicting effective event', async () => {
    const { db, adapter } = await createDatabase();
    await seedProductionShape(db);
    await insertExactEvents(db, 17);
    await db
      .prepare(
        `INSERT INTO payment_attempt_reconciliations (
        id, payment_attempt_id, classification, actionability, owner_kind, reason_code,
        evidence_ref, source, supersedes_reconciliation_id, metadata_json, dedupe_key, created_at
      ) VALUES ('extra-event', ?, 'unreconciled', 'actionable', 'none', 'unexpected',
        'unexpected', 'operator', ?, '{}', 'extra-dedupe', '2026-09-11T01:00:00.000Z')`
      )
      .bind(PLAN[8].payment_attempt_id, PLAN[8].reconciliation_id)
      .run();
    expect((await execute(adapter, 'dry-run')).whole_plan_state).toBe('CONFLICT');
  });
});

describe('transactional exactly-17-or-zero enforcement on actual D1', () => {
  it.each([0, 8, 16])(
    'rolls back all governed inserts when row %i drifts after preflight',
    async (index) => {
      const { db, adapter } = await createDatabase();
      await seedProductionShape(db);
      const racingAdapter: OperatorDatabase = {
        query: adapter.query,
        async batch(statements) {
          await db
            .prepare('UPDATE payment_attempts SET lifecycle_stage = ? WHERE id = ?')
            .bind('executed', PLAN[index].payment_attempt_id)
            .run();
          return adapter.batch(statements);
        },
      };
      await expect(execute(racingAdapter, 'apply')).rejects.toThrow();
      expect(await reconciliationCount(db)).toBe(0);
    }
  );

  it('rolls back earlier statements when a conflicting event appears after preflight', async () => {
    const { db, adapter } = await createDatabase();
    await seedProductionShape(db);
    const racingAdapter: OperatorDatabase = {
      query: adapter.query,
      async batch(statements) {
        await insertExactEvents(db, 1);
        return adapter.batch(statements);
      },
    };
    await expect(execute(racingAdapter, 'apply')).rejects.toThrow();
    expect(await reconciliationCount(db)).toBe(1);
    const governed = await db
      .prepare('SELECT COUNT(*) AS n FROM payment_attempt_reconciliations WHERE id <> ?')
      .bind(PLAN[0].reconciliation_id)
      .first<{ n: number }>();
    expect(Number(governed?.n ?? 0)).toBe(0);
  });
});
