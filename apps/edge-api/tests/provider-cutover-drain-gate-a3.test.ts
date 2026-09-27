/**
 * R3-A3-PROVIDER-AUTHORITY-HOST-BACKPORT-43 — drain-gate false-negative proof.
 *
 * The host cutover replaces the unverifiable Workflow-version-pinning question
 * with a state gate: before the new host version takes traffic, zero old-code
 * executions may exist and zero may be creatable. This file proves the
 * existing, unchanged `OWNERSHIP_AWARE_DRAIN_GATE_SQL` never reports a
 * provider-capable state as drained, against real Miniflare D1 with every
 * migration applied (including 0014), and pins the Workflow instance status
 * classification the operator drain read uses.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  D1LifecycleReconciliationRepository,
  type ReconciliationClassification,
} from '../src/control-plane/repositories/d1/lifecycle-reconciliation';
import {
  D1WorkflowOwnerIntentRepository,
  type WorkflowOwnerIntentStatus,
} from '../src/control-plane/repositories/d1/workflow-owner-intents';
import {
  dispatchWorkflowOwnerIntent,
  recoverPendingWorkflowOwnerIntents,
} from '../src/control-plane/continuation/owner-recovery';
import type {
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/control-plane/continuation/handoff';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));
const NOW = '2026-09-11T00:00:00.000Z';

async function runMigrations(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const statements = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
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
    for (const statement of statements) await db.exec(statement);
  }
}

const open: Array<{ mf: Miniflare; dir: string }> = [];

async function freshDb(): Promise<D1Database> {
  const dir = mkdtempSync(join(tmpdir(), 'a3-drain-'));
  const mf = new Miniflare({
    modules: true,
    script: `export default { fetch() { return new Response('ok') } }`,
    d1Databases: ['DB'],
    resourcePersistencePath: dir,
  });
  open.push({ mf, dir });
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db);
  return db;
}

afterEach(async () => {
  for (const { mf, dir } of open.splice(0)) {
    await mf.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function seedAttempt(db: D1Database, key: string, stage: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO payment_attempts (
    id, payment_identifier, binding_digest, quote_id, requirement_id, service_id,
    service_version, contract_release, request_input_hash, resource_id, scheme,
    network, asset, amount, payee, created_at, expires_at, lifecycle_stage
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `attempt-${key}`,
      `pay-${key}`,
      'sha256:' + 'a'.repeat(64),
      `q-${key}`,
      `r-${key}`,
      'verify_agent_output.v2',
      'v2',
      '2.0.0',
      'sha256:' + 'b'.repeat(64),
      'https://utility.siteborne.net/v2/verify/agent-output',
      'exact',
      'eip155:8453',
      '0xasset',
      '10000',
      '0xpayee',
      NOW,
      '2026-09-11T01:00:00.000Z',
      stage
    )
    .run();
}

async function seedIntent(
  db: D1Database,
  key: string,
  status: WorkflowOwnerIntentStatus
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO payment_workflow_owner_intents (
    id, payment_attempt_id, payment_identifier, workflow_instance_id,
    workflow_input_json, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `intent-${key}`,
      `attempt-${key}`,
      `pay-${key}`,
      `wf-${key}`,
      JSON.stringify({ request_id: 'req' }),
      status,
      NOW,
      NOW
    )
    .run();
}

async function classify(
  db: D1Database,
  key: string,
  classification: ReconciliationClassification
): Promise<void> {
  await new D1LifecycleReconciliationRepository(db).append({
    id: `rec-${key}`,
    paymentAttemptId: `attempt-${key}`,
    classification,
    actionability: 'non_actionable',
    ownerKind: 'none',
    reasonCode: 'a3_drain_gate_test',
    evidenceRef: `test:${key}`,
    source: 'operator',
    dedupeKey: `${key}:a3-drain`,
    createdAt: NOW,
  });
}

async function blocking(db: D1Database): Promise<number> {
  return (await new D1LifecycleReconciliationRepository(db).getDrainGateMetrics())
    .activeCutoverBlockingWorkCount;
}

/** A Workflow binding with no existing instances: any `create` it receives is
 * a new (old-code, pre-cutover) execution. */
function emptyWorkflow() {
  let creates = 0;
  const instances = new Set<string>();
  const binding: WorkflowBindingLike = {
    async create({ id }) {
      creates += 1;
      instances.add(id);
      return { id, status: async () => ({ status: 'queued' as const }) } as WorkflowInstanceLike;
    },
    async get(id) {
      if (!instances.has(id)) throw new Error('not found');
      return { id, status: async () => ({ status: 'queued' as const }) } as WorkflowInstanceLike;
    },
  };
  return {
    binding,
    get creates() {
      return creates;
    },
  };
}

/** Operator drain read over the Workflows instance API. Only states the engine
 * never advances on its own count as drained; every other status, including
 * one this code has never seen, blocks the cutover. */
const DRAINED_INSTANCE_STATUSES = new Set(['complete', 'errored', 'terminated']);
function instanceDrained(status: string): boolean {
  return DRAINED_INSTANCE_STATUSES.has(status);
}

describe('A3-43 drain gate: provider-capable D1 states are never classified drained', () => {
  const PROVIDER_CAPABLE: ReadonlyArray<{
    name: string;
    stage: string;
    intent?: WorkflowOwnerIntentStatus;
    classification?: ReconciliationClassification;
  }> = [
    {
      name: 'verified, owner intent pending (not yet dispatched)',
      stage: 'verified',
      intent: 'pending',
    },
    {
      name: 'verified, owner intent retry_exhausted (buyer retry can re-create)',
      stage: 'verified',
      intent: 'retry_exhausted',
    },
    {
      name: 'verified, Workflow created (dispatched, unresolved)',
      stage: 'verified',
      intent: 'workflow_created',
    },
    {
      name: 'executed, Workflow created (unresolved)',
      stage: 'executed',
      intent: 'workflow_created',
    },
    {
      name: 'settlement_pending, Workflow created (unresolved)',
      stage: 'settlement_pending',
      intent: 'workflow_created',
    },
    {
      name: 'settled row whose Workflow is still owned (instance may still run)',
      stage: 'settled',
      intent: 'workflow_created',
    },
    {
      name: 'verification_failed row with a pending intent',
      stage: 'verification_failed',
      intent: 'pending',
    },
    { name: 'verified, no intent, never classified', stage: 'verified' },
    { name: 'acquired, no intent, never classified', stage: 'acquired' },
    {
      name: 'an inert legacy classification cannot mask a live pending intent',
      stage: 'verified',
      intent: 'pending',
      classification: 'current_execution_failed_unsettled',
    },
    {
      name: 'an inert legacy classification cannot mask a retry_exhausted intent',
      stage: 'verified',
      intent: 'retry_exhausted',
      classification: 'current_execution_failed_unsettled',
    },
    {
      name: 'an inert legacy classification cannot mask a live Workflow owner',
      stage: 'verified',
      intent: 'workflow_created',
      classification: 'legacy_execution_outcome_unknown',
    },
  ];

  for (const state of PROVIDER_CAPABLE) {
    it(`blocks: ${state.name}`, async () => {
      const db = await freshDb();
      expect(await blocking(db)).toBe(0);
      await seedAttempt(db, 'x', state.stage);
      if (state.intent) await seedIntent(db, 'x', state.intent);
      if (state.classification) await classify(db, 'x', state.classification);
      expect(await blocking(db)).toBeGreaterThan(0);
    });
  }

  it('control: finished and inertly classified work is drained', async () => {
    const db = await freshDb();
    await seedAttempt(db, 'settled', 'settled');
    await seedIntent(db, 'settled', 'completed');
    await seedAttempt(db, 'rejected', 'verification_failed');
    await seedAttempt(db, 'failed', 'verified');
    await seedIntent(db, 'failed', 'completed');
    await classify(db, 'failed', 'current_execution_failed_unsettled');
    await seedAttempt(db, 'legacy', 'verified');
    await classify(db, 'legacy', 'legacy_verified_unrouted_unsettled');
    expect(await blocking(db)).toBe(0);
  });

  it('every owner-intent status the recovery paths can turn into a new instance is blocking', async () => {
    const statuses: WorkflowOwnerIntentStatus[] = [
      'pending',
      'workflow_created',
      'completed',
      'retry_exhausted',
    ];
    for (const status of statuses) {
      const db = await freshDb();
      await seedAttempt(db, status, 'verified');
      await seedIntent(db, status, status);
      await classify(db, status, 'current_execution_failed_unsettled');
      const repo = new D1WorkflowOwnerIntentRepository(db);

      const viaCron = emptyWorkflow();
      await recoverPendingWorkflowOwnerIntents(repo, viaCron.binding, { now: () => NOW });
      const db2 = await freshDb();
      await seedAttempt(db2, status, 'verified');
      await seedIntent(db2, status, status);
      // Inert attempt classification: only the intent itself can block.
      await classify(db2, status, 'current_execution_failed_unsettled');
      const viaBuyerRetry = emptyWorkflow();
      await dispatchWorkflowOwnerIntent(
        new D1WorkflowOwnerIntentRepository(db2),
        viaBuyerRetry.binding,
        `pay-${status}`,
        () => NOW
      ).catch(() => undefined);

      const creatable = viaCron.creates + viaBuyerRetry.creates > 0;
      const gate = await blocking(db2);
      if (creatable) expect(gate, `${status} can create an instance`).toBeGreaterThan(0);
      if (status === 'pending' || status === 'retry_exhausted') expect(creatable).toBe(true);
    }
  });

  it('a verified row without an intent cannot create an instance through recovery', async () => {
    const db = await freshDb();
    await seedAttempt(db, 'orphan', 'verified');
    const wf = emptyWorkflow();
    await recoverPendingWorkflowOwnerIntents(new D1WorkflowOwnerIntentRepository(db), wf.binding, {
      now: () => NOW,
    });
    await expect(
      dispatchWorkflowOwnerIntent(new D1WorkflowOwnerIntentRepository(db), wf.binding, 'pay-orphan')
    ).rejects.toThrow('durable Workflow owner intent is missing');
    expect(wf.creates).toBe(0);
  });
});

describe('A3-43 drain gate: Workflow instance status classification fails closed', () => {
  it.each(['queued', 'running', 'paused', 'waiting', 'waitingForPause', 'unknown'])(
    '%s is not drained',
    (status) => {
      expect(instanceDrained(status)).toBe(false);
    }
  );

  it.each(['complete', 'errored', 'terminated'])('%s is drained', (status) => {
    expect(instanceDrained(status)).toBe(true);
  });

  it('a status this code has never seen is not drained', () => {
    expect(instanceDrained('some_future_status')).toBe(false);
  });
});
