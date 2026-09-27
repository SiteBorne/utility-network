/**
 * R3-A3-DRAIN-BLOCKER-RECONCILIATION-ANALYSIS-45 — LOCAL, UNCOMMITTED proof.
 *
 * Runs against the OLD production host source (3ed1b1e). Establishes:
 *   1. the old Workflow has no payment-stage / job-state fence before
 *      invoke-executor (a fresh run of a settlement_failed + REFUND_REQUIRED
 *      payment reaches the provider), so execution terminality rests solely
 *      on no old-code instance being creatable or live;
 *   2. which owner-intent states the real old owner-recovery code can turn
 *      into a Workflow create();
 *   3. a proposed provider-drain predicate has zero false negatives.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import { D1LifecycleReconciliationRepository } from '../src/control-plane/repositories/d1/lifecycle-reconciliation';
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
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
  TEST_JOB_ID,
} from './support/paid-continuation-workflow-fixtures';

// ---------------------------------------------------------------------------
// Part 1 — old runtime execution gate
// ---------------------------------------------------------------------------

describe('A3-45 old runtime (3ed1b1e): execution gate for settlement_failed', () => {
  it('a fresh run of a settlement_failed + REFUND_REQUIRED payment reaches invoke-executor', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      seedSettlement: {
        lifecycleStage: 'settlement_failed',
        settlementOutcomeKind: 'explicit_rejection',
        cdpFacilitatorSettleAttemptCount: 1,
      },
      seedJob: { id: TEST_JOB_ID, current_state: 'REFUND_REQUIRED' },
      clock: () => metadata.valid_before_unix - 1,
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();
    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(step.calls.map((c) => c.name)).toContain('invoke-executor');
    expect(deps.executor).toHaveBeenCalledTimes(1);
    // settle() is fenced by the existing settlement_failed row, never re-called.
    expect(deps.settle).not.toHaveBeenCalled();
    expect(result.status).toBe('settlement_rejected');
    // job state is a projection: illegal REFUND_REQUIRED -> ROUTED is a silent no-op.
    expect(deps.jobPersistence.jobs.get(TEST_JOB_ID)?.current_state).toBe('REFUND_REQUIRED');
  });

  it('once valid_before has passed, the same fresh run stops before invoke-executor', async () => {
    const metadata = buildTestMetadata();
    const deps = await buildTestDependencies({
      seedSettlement: { lifecycleStage: 'settlement_failed', settlementOutcomeKind: 'explicit_rejection' },
      seedJob: { id: TEST_JOB_ID, current_state: 'REFUND_REQUIRED' },
      clock: () => metadata.valid_before_unix,
    });
    const input = await sealTestInput(metadata, { key: deps.envelopeKey });
    const step = new FakeWorkflowStep();
    const result = await runPaidContinuationWorkflow({ payload: input }, step, deps);

    expect(step.calls.map((c) => c.name)).not.toContain('invoke-executor');
    expect(deps.executor).not.toHaveBeenCalled();
    expect(result.status).toBe('authorization_expired');
  });
});

// ---------------------------------------------------------------------------
// Part 2 — owner-intent re-entry and drain predicate (real D1, real old code)
// ---------------------------------------------------------------------------

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
  const dir = mkdtempSync(join(tmpdir(), 'a3-45-'));
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

async function seedIntent(db: D1Database, key: string, status: WorkflowOwnerIntentStatus) {
  await db
    .prepare(
      `INSERT INTO payment_workflow_owner_intents (
    id, payment_attempt_id, payment_identifier, workflow_instance_id,
    workflow_input_json, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(`intent-${key}`, `attempt-${key}`, `pay-${key}`, `wf-${key}`, '{}', status, NOW, NOW)
    .run();
}

type CfState = 'absent' | 'lookup_error' | 'queued' | 'running' | 'waiting' | 'paused'
  | 'complete' | 'errored' | 'terminated';

/** Cloudflare Workflows binding fake. `absent` = instance.not_found. */
function cloudflare(initial: Record<string, CfState>) {
  const state = new Map(Object.entries(initial));
  let creates = 0;
  const instance = (id: string) =>
    ({ id, status: async () => ({ status: state.get(id) }) }) as unknown as WorkflowInstanceLike;
  const binding: WorkflowBindingLike = {
    async create({ id }) {
      creates += 1;
      state.set(id, 'queued');
      return instance(id);
    },
    async get(id) {
      const s = state.get(id) ?? 'absent';
      if (s === 'absent') throw new Error('instance.not_found');
      if (s === 'lookup_error') throw new Error('upstream 503');
      return instance(id);
    },
  };
  /** Operator lookup via the Workflows instance API, as the drain read sees it. */
  const lookup = (id: string): CfState => state.get(id) ?? 'absent';
  return { binding, lookup, get creates() { return creates; } };
}

export const PROVIDER_DRAIN_SQL = `
WITH latest AS (
  SELECT r.* FROM payment_attempt_reconciliations r
  JOIN (SELECT payment_attempt_id, MAX(sequence) AS s FROM payment_attempt_reconciliations
        GROUP BY payment_attempt_id) l
    ON l.payment_attempt_id = r.payment_attempt_id AND l.s = r.sequence
)
SELECT p.payment_identifier, p.lifecycle_stage, i.status, i.workflow_instance_id
FROM payment_attempts p
LEFT JOIN payment_workflow_owner_intents i ON i.payment_attempt_id = p.id
LEFT JOIN latest r ON r.payment_attempt_id = p.id
WHERE i.status IN ('pending', 'retry_exhausted', 'workflow_created')
   OR (i.id IS NULL
       AND p.lifecycle_stage IN ('acquired', 'verified', 'executed', 'settlement_pending')
       AND (r.classification IS NULL OR r.actionability <> 'non_actionable'
            OR r.classification NOT IN ('legacy_execution_failed_unsettled',
              'legacy_verified_unrouted_unsettled', 'legacy_execution_outcome_unknown')))`;

const TERMINAL_CF = new Set<CfState>(['complete', 'errored', 'terminated']);
/** Payment stages the provider step has already been passed and no settle()
 * can be re-issued from; only these let a workflow_created row be stale. */
const POST_PROVIDER_TERMINAL_STAGES = ['settlement_failed', 'settled'];

/**
 * PROPOSED SAFE PROVIDER-DRAIN PREDICATE. A payment is an old-provider risk if:
 *   (a) its owner intent is creatable by old code: pending | retry_exhausted
 *       (payment stage deliberately ignored — old code has no stage fence); or
 *   (b) its owner intent is workflow_created and NOT all of:
 *         Cloudflare lookup is definite not_found or a terminal status, AND
 *         payment stage is post-provider terminal (settlement_failed|settled); or
 *   (c) the attempt is at a pre/in-provider stage with no owner intent and its
 *       latest reconciliation is not an explicit non_actionable legacy class
 *       (ownerless and unexplained fails closed).
 * Plus, independently: any nonterminal Cloudflare instance blocks.
 */
async function proposedBlockers(
  db: D1Database,
  lookup: (id: string) => CfState
): Promise<string[]> {
  const rows = await db
    .prepare(
      `${PROVIDER_DRAIN_SQL}`
    )
    .all<{
      payment_identifier: string;
      lifecycle_stage: string;
      status: string | null;
      workflow_instance_id: string | null;
    }>();
  const out: string[] = [];
  for (const row of rows.results) {
    if (row.status !== 'workflow_created') {
      out.push(row.payment_identifier);
      continue;
    }
    const cf = lookup(row.workflow_instance_id as string);
    const instanceDead = cf === 'absent' || TERMINAL_CF.has(cf);
    const stageTerminal = POST_PROVIDER_TERMINAL_STAGES.includes(row.lifecycle_stage);
    if (!(instanceDead && stageTerminal)) out.push(row.payment_identifier);
  }
  return out;
}

interface Case {
  readonly n: string;
  readonly stage: string;
  readonly intent?: WorkflowOwnerIntentStatus;
  readonly cf: CfState;
  /** Ground truth from code: can OLD provider code still run for this payment? */
  readonly reentry: boolean;
  readonly legacy?: boolean;
}

const CASES: readonly Case[] = [
  { n: '1 pending + verified', stage: 'verified', intent: 'pending', cf: 'absent', reentry: true },
  { n: '2 workflow_created + verified (live)', stage: 'verified', intent: 'workflow_created', cf: 'running', reentry: true },
  { n: '3 workflow_created + executed (live)', stage: 'executed', intent: 'workflow_created', cf: 'waiting', reentry: true },
  { n: '4 workflow_created + settlement_pending (live)', stage: 'settlement_pending', intent: 'workflow_created', cf: 'running', reentry: true },
  { n: '5 workflow_created + settlement_failed + not_found (PRODUCTION SHAPE)', stage: 'settlement_failed', intent: 'workflow_created', cf: 'absent', reentry: false },
  { n: '6 workflow_created + settled + complete', stage: 'settled', intent: 'workflow_created', cf: 'complete', reentry: false },
  { n: '7a workflow_created + verified + not_found', stage: 'verified', intent: 'workflow_created', cf: 'absent', reentry: false },
  { n: '7b workflow_created + settlement_failed + errored', stage: 'settlement_failed', intent: 'workflow_created', cf: 'errored', reentry: false },
  { n: '8 workflow_created + settlement_failed + live instance', stage: 'settlement_failed', intent: 'workflow_created', cf: 'running', reentry: true },
  { n: '8b workflow_created + settlement_failed + paused', stage: 'settlement_failed', intent: 'workflow_created', cf: 'paused', reentry: true },
  { n: '8c workflow_created + settlement_failed + lookup error', stage: 'settlement_failed', intent: 'workflow_created', cf: 'lookup_error', reentry: true },
  { n: '9a pending + settlement_failed (REFUND_REQUIRED shape)', stage: 'settlement_failed', intent: 'pending', cf: 'absent', reentry: true },
  { n: '9b retry_exhausted + settlement_failed', stage: 'settlement_failed', intent: 'retry_exhausted', cf: 'absent', reentry: true },
  { n: '10 completed + verified (provider failure)', stage: 'verified', intent: 'completed', cf: 'absent', reentry: false },
  { n: '11 ownerless verified attempt, unclassified', stage: 'verified', cf: 'absent', reentry: true },
  { n: '12 ownerless verified attempt, legacy non_actionable (16 in production)', stage: 'verified', cf: 'absent', reentry: false, legacy: true },
];

describe('A3-45 provider-drain predicate vs real old owner-recovery code', () => {
  const report: string[] = [];
  let fn = 0;
  let fp = 0;
  let currentFn = 0;

  for (const c of CASES) {
    it(c.n, async () => {
      const db = await freshDb();
      await seedAttempt(db, 'x', c.stage);
      if (c.intent) await seedIntent(db, 'x', c.intent);
      if (c.legacy) {
        await new D1LifecycleReconciliationRepository(db).append({
          id: 'rec-x', paymentAttemptId: 'attempt-x',
          classification: 'legacy_execution_failed_unsettled', actionability: 'non_actionable',
          ownerKind: 'none', reasonCode: 'a3_45', evidenceRef: 'test:x', source: 'operator',
          dedupeKey: 'x:a3-45', createdAt: NOW,
        });
      }
      const cf = cloudflare({ 'wf-x': c.cf });

      // Every old-code owner path: scheduled recovery + request-path dispatch.
      const repo = new D1WorkflowOwnerIntentRepository(db);
      await recoverPendingWorkflowOwnerIntents(repo, cf.binding, { now: () => NOW }).catch(() => []);
      if (c.intent) {
        await dispatchWorkflowOwnerIntent(repo, cf.binding, 'pay-x', () => NOW).catch(() => null);
      }
      const liveBefore = !['absent', ...TERMINAL_CF].includes(c.cf);
      // The request path for a payment with no owner intent is get()-only
      // (joinExistingPaidContinuation); nothing can create for it.
      const observedReentry = cf.creates > 0 || liveBefore;
      // Ownerless attempts have no code-level owner; fail closed by definition.
      if (c.intent) expect(observedReentry, 'ground truth must match code').toBe(c.reentry);

      // workflow_created is never moved back to pending and never re-created.
      if (c.intent === 'workflow_created') {
        expect(cf.creates).toBe(0);
        expect((await repo.getByPaymentIdentifier('pay-x'))?.status).toBe('workflow_created');
      }

      const blocked = (
        await proposedBlockers(db, (id) => (id === 'wf-x' ? cf.lookup(id) : 'absent'))
      ).includes('pay-x') || liveBefore;
      const current =
        (await new D1LifecycleReconciliationRepository(db).getDrainGateMetrics())
          .activeCutoverBlockingWorkCount > 0;
      if (c.reentry && !blocked) fn += 1;
      if (!c.reentry && blocked) fp += 1;
      if (c.reentry && !current) currentFn += 1;
      report.push(
        `${c.n} | REENTRY=${c.reentry ? 'YES' : 'NO'} | PROPOSED_BLOCKS=${blocked ? 'YES' : 'NO'} | CURRENT_BLOCKS=${current ? 'YES' : 'NO'}`
      );
      expect(blocked || !c.reentry, 'false negative').toBe(true);
    });
  }

  it('summary: zero false negatives', () => {
    console.log(['', ...report, `PROPOSED_FN=${fn} PROPOSED_FP=${fp} CURRENT_FN=${currentFn}`].join('\n'));
    expect(fn).toBe(0);
    expect(currentFn).toBe(0);
  });
});
