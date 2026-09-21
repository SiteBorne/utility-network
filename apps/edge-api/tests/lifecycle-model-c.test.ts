import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  D1LifecycleReconciliationRepository,
  RECONCILIATION_CLASSIFICATIONS,
} from '../src/control-plane/repositories/d1/lifecycle-reconciliation';
import { D1WorkflowOwnerIntentRepository } from '../src/control-plane/repositories/d1/workflow-owner-intents';
import { D1PaymentFinalizationRepository } from '../src/control-plane/repositories/d1/payment-finalization';
import {
  dispatchWorkflowOwnerIntent,
  recoverPendingWorkflowOwnerIntents,
} from '../src/control-plane/continuation/owner-recovery';
import type {
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/control-plane/continuation/handoff';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

async function runMigrations(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = sql
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

async function seedAttempt(db: D1Database, id: string, identifier: string, stage = 'acquired') {
  const now = '2026-09-11T00:00:00.000Z';
  await db
    .prepare(
      `INSERT INTO payment_attempts (
    id, payment_identifier, binding_digest, quote_id, requirement_id, service_id,
    service_version, contract_release, request_input_hash, resource_id, scheme,
    network, asset, amount, payee, created_at, expires_at, lifecycle_stage
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      identifier,
      'sha256:' + 'a'.repeat(64),
      'q-' + id,
      'r-' + id,
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
      now,
      '2026-09-11T01:00:00.000Z',
      stage
    )
    .run();
}

class Instance implements WorkflowInstanceLike {
  constructor(readonly id: string) {}
  async status() {
    return { status: 'running' as const };
  }
}

function workflowDouble(options: { timeoutAfterCreate?: boolean } = {}) {
  const instances = new Map<string, Instance>();
  let createCalls = 0;
  const binding: WorkflowBindingLike = {
    async create({ id }) {
      createCalls += 1;
      if (instances.has(id)) throw new Error('already exists');
      const instance = new Instance(id);
      instances.set(id, instance);
      if (options.timeoutAfterCreate) throw new Error('transport timeout after create');
      return instance;
    },
    async get(id) {
      const instance = instances.get(id);
      if (!instance) throw new Error('not found');
      return instance;
    },
  };
  return {
    binding,
    instances,
    get createCalls() {
      return createCalls;
    },
  };
}

describe('SUN-1222C Model C lifecycle remediation', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-model-c-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { fetch() { return new Response('ok') } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses the explicit eight-class legacy/current taxonomy', () => {
    expect(RECONCILIATION_CLASSIFICATIONS).toEqual([
      'legacy_execution_failed_unsettled',
      'legacy_verified_unrouted_unsettled',
      'legacy_execution_outcome_unknown',
      'legacy_settled_external_finalization_incomplete',
      'active_workflow_owned',
      'current_execution_failed_unsettled',
      'current_settlement_finalization_unresolved',
      'unreconciled',
    ]);
  });

  it('keeps reconciliation append-only and resolves supersession by monotonic sequence', async () => {
    await seedAttempt(db, 'attempt-append', 'pay-append', 'verified');
    const repo = new D1LifecycleReconciliationRepository(db);
    const first = await repo.append({
      id: 'rec-append-1',
      paymentAttemptId: 'attempt-append',
      classification: 'unreconciled',
      actionability: 'actionable',
      ownerKind: 'none',
      reasonCode: 'awaiting_review',
      evidenceRef: 'report:5ee2729#attempt-append',
      source: 'operator',
      dedupeKey: 'attempt-append:v1',
      createdAt: '2026-09-11T00:00:00.000Z',
    });
    await repo.append({
      id: 'rec-append-2',
      paymentAttemptId: 'attempt-append',
      classification: 'legacy_verified_unrouted_unsettled',
      actionability: 'non_actionable',
      ownerKind: 'none',
      reasonCode: 'forensic_review_complete',
      evidenceRef: 'report:5ee2729#attempt-append',
      source: 'operator',
      dedupeKey: 'attempt-append:v2',
      supersedesReconciliationId: first.id,
      createdAt: '2026-09-11T00:00:00.000Z',
    });
    expect((await repo.getEffectiveByAttemptId('attempt-append'))?.id).toBe('rec-append-2');
    expect('update' in repo).toBe(false);
    expect('remove' in repo).toBe(false);
  });

  it('atomically commits verified plus one durable owner intent', async () => {
    await seedAttempt(db, 'attempt-owner', 'pay-owner');
    const repo = new D1WorkflowOwnerIntentRepository(db);
    const input = {
      envelope: { v: 1, key_id: 'k', iv_b64: 'a', ciphertext_b64: 'b', aad_fingerprint: 'c' },
      metadata: {
        job_id: 'job',
        payment_identifier: 'pay-owner',
        service: 'verify_agent_output.v2',
        network: 'eip155:8453',
        asset: '0xasset',
        pay_to: '0xpayee',
        amount_atomic: '10000',
        valid_before_unix: 2_000_000_000,
      },
      request_id: 'req',
    } as const;
    const result = await repo.commitVerifiedWithIntent({
      paymentIdentifier: 'pay-owner',
      intentId: 'intent-owner',
      workflowInstanceId: 'workflow-owner',
      workflowInput: input,
      createdAt: '2026-09-11T00:00:00.000Z',
    });
    expect(result.status).toBe('committed');
    expect(await repo.getByPaymentIdentifier('pay-owner')).toMatchObject({ status: 'pending' });
    const stage = await db
      .prepare(`SELECT lifecycle_stage FROM payment_attempts WHERE id='attempt-owner'`)
      .first<{ lifecycle_stage: string }>();
    expect(stage?.lifecycle_stage).toBe('verified');
    await expect(
      repo.commitVerifiedWithIntent({
        paymentIdentifier: 'pay-owner',
        intentId: 'different',
        workflowInstanceId: 'different',
        workflowInput: input,
        createdAt: '2026-09-11T00:00:01.000Z',
      })
    ).resolves.toMatchObject({ status: 'already_committed' });
    await repo.markCompletedByPaymentIdentifier('pay-owner', '2026-09-11T00:00:02.000Z');
  });

  it('repairs ambiguous create by get and never creates a second logical Workflow', async () => {
    await seedAttempt(db, 'attempt-ambiguous', 'pay-ambiguous');
    const repo = new D1WorkflowOwnerIntentRepository(db);
    const input = {
      envelope: { v: 1, key_id: 'k', iv_b64: 'a', ciphertext_b64: 'b', aad_fingerprint: 'c' },
      metadata: {
        job_id: 'job',
        payment_identifier: 'pay-ambiguous',
        service: 'verify_agent_output.v2',
        network: 'eip155:8453',
        asset: '0xasset',
        pay_to: '0xpayee',
        amount_atomic: '10000',
        valid_before_unix: 2_000_000_000,
      },
      request_id: 'req',
    } as const;
    await repo.commitVerifiedWithIntent({
      paymentIdentifier: 'pay-ambiguous',
      intentId: 'intent-ambiguous',
      workflowInstanceId: 'wf-ambiguous',
      workflowInput: input,
      createdAt: '2026-09-11T00:00:00.000Z',
    });
    const workflow = workflowDouble({ timeoutAfterCreate: true });
    const outcome = await dispatchWorkflowOwnerIntent(
      repo,
      workflow.binding,
      'pay-ambiguous',
      () => '2026-09-11T00:00:01.000Z'
    );
    expect(outcome.outcome).toBe('joined_after_ambiguous_create');
    expect(workflow.createCalls).toBe(1);
    expect((await repo.getByPaymentIdentifier('pay-ambiguous'))?.status).toBe('workflow_created');
  });

  it('allows concurrent recovery actors but retains one logical owner', async () => {
    await seedAttempt(db, 'attempt-concurrent', 'pay-concurrent');
    const repo = new D1WorkflowOwnerIntentRepository(db);
    const input = {
      envelope: { v: 1, key_id: 'k', iv_b64: 'a', ciphertext_b64: 'b', aad_fingerprint: 'c' },
      metadata: {
        job_id: 'job',
        payment_identifier: 'pay-concurrent',
        service: 'verify_agent_output.v2',
        network: 'eip155:8453',
        asset: '0xasset',
        pay_to: '0xpayee',
        amount_atomic: '10000',
        valid_before_unix: 2_000_000_000,
      },
      request_id: 'req',
    } as const;
    await repo.commitVerifiedWithIntent({
      paymentIdentifier: 'pay-concurrent',
      intentId: 'intent-concurrent',
      workflowInstanceId: 'wf-concurrent',
      workflowInput: input,
      createdAt: '2026-09-11T00:00:00.000Z',
    });
    const workflow = workflowDouble();
    await Promise.all([
      recoverPendingWorkflowOwnerIntents(repo, workflow.binding, {
        now: () => '2026-09-11T00:00:01.000Z',
      }),
      recoverPendingWorkflowOwnerIntents(repo, workflow.binding, {
        now: () => '2026-09-11T00:00:01.000Z',
      }),
    ]);
    expect(workflow.instances.size).toBe(1);
    expect((await repo.getByPaymentIdentifier('pay-concurrent'))?.status).toBe('workflow_created');
  });

  it('keeps raw 17 while the gate falls from 17 to zero only after explicit inert classifications', async () => {
    const repo = new D1LifecycleReconciliationRepository(db);
    const before = await repo.getDrainGateMetrics();
    for (let index = 0; index < 17; index += 1) {
      const id = `legacy-${index}`;
      await seedAttempt(db, id, `pay-${id}`, index === 8 ? 'settled_external' : 'verified');
    }
    const withLegacy = await repo.getDrainGateMetrics();
    expect(withLegacy.rawNonterminalLifecycleCount - before.rawNonterminalLifecycleCount).toBe(17);
    expect(withLegacy.activeCutoverBlockingWorkCount - before.activeCutoverBlockingWorkCount).toBe(
      17
    );
    for (let index = 0; index < 17; index += 1) {
      const classification =
        index === 8
          ? 'legacy_settled_external_finalization_incomplete'
          : index === 5
            ? 'legacy_verified_unrouted_unsettled'
            : index === 4
              ? 'legacy_execution_outcome_unknown'
              : 'legacy_execution_failed_unsettled';
      await repo.append({
        id: `rec-legacy-${index}`,
        paymentAttemptId: `legacy-${index}`,
        classification,
        actionability: 'non_actionable',
        ownerKind: 'none',
        reasonCode: 'governed_legacy_review',
        evidenceRef: `report:5ee2729#legacy-${index}`,
        source: 'operator',
        dedupeKey: `legacy-${index}:model-c-v1`,
        createdAt: '2026-09-11T00:00:00.000Z',
      });
    }
    const metrics = await repo.getDrainGateMetrics();
    expect(metrics.rawNonterminalLifecycleCount - before.rawNonterminalLifecycleCount).toBe(17);
    expect(metrics.activeCutoverBlockingWorkCount).toBe(before.activeCutoverBlockingWorkCount);
  });

  it('requires durable signed link/receipt evidence before settled and finalizes idempotently', async () => {
    await seedAttempt(db, 'attempt-finalize', 'pay-finalize', 'settled_external');
    const repo = new D1PaymentFinalizationRepository(db);
    await expect(repo.finalizeSettled('pay-finalize', '2026-09-11T00:00:01.000Z')).rejects.toThrow(
      'durable link evidence'
    );
    const paymentServiceLink = {
      link_version: 2,
      payment_rail: 'cdp',
      payment_provider: 'cdp',
      payment_identifier: 'pay-finalize',
      quote_id: 'q',
      requirement_id: 'r',
      service_id: 'verify_agent_output.v2',
      service_version: 'v2',
      request_input_hash: 'sha256:' + '1'.repeat(64),
      job_id: 'job-finalize',
      service_output_hash: 'sha256:' + '2'.repeat(64),
      verification_receipt_id: 'receipt-provider',
      verification_receipt_hash: 'sha256:' + '3'.repeat(64),
      verification_evidence_hash: 'sha256:' + '4'.repeat(64),
      settlement_evidence_hash: 'sha256:' + '5'.repeat(64),
      link_id: 'lnk-finalize',
      link_hash: 'sha256:' + '6'.repeat(64),
    } as never;
    await repo.persistLinkEvidence({
      paymentIdentifier: 'pay-finalize',
      jobId: 'job-finalize',
      paymentServiceLink,
      settlementTransactionReference: '0xtx',
      settlementEvidenceHash: 'sha256:' + '5'.repeat(64),
      linkEvidenceInputs: {
        receiptId: 'receipt-provider',
        signingKeyId: 'kid_aaaaaaaaaaaaaaaaaaaaaaaa',
        signature: 'A'.repeat(86),
        buyerReceiptHash: 'sha256:' + 'b'.repeat(64),
      },
      buyerReceiptId: 'receipt-workflow',
      createdAt: '2026-09-11T00:00:01.000Z',
    });
    await repo.finalizeSettled('pay-finalize', '2026-09-11T00:00:02.000Z');
    await repo.finalizeSettled('pay-finalize', '2026-09-11T00:00:03.000Z');
    const row = await db
      .prepare(`SELECT lifecycle_stage FROM payment_attempts WHERE id='attempt-finalize'`)
      .first<{ lifecycle_stage: string }>();
    expect(row?.lifecycle_stage).toBe('settled');
  });

  it('makes a current terminal provider failure non-actionable without rewriting verified', async () => {
    await seedAttempt(db, 'attempt-provider-failed', 'pay-provider-failed', 'verified');
    const ownerRepo = new D1WorkflowOwnerIntentRepository(db);
    await db
      .prepare(
        `INSERT INTO payment_workflow_owner_intents (
        id, payment_attempt_id, payment_identifier, workflow_instance_id,
        workflow_input_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'workflow_created', ?, ?)`
      )
      .bind(
        'intent-provider-failed',
        'attempt-provider-failed',
        'pay-provider-failed',
        'wf-provider-failed',
        JSON.stringify({}),
        '2026-09-11T00:00:00.000Z',
        '2026-09-11T00:00:00.000Z'
      )
      .run();
    const repo = new D1PaymentFinalizationRepository(db);
    await repo.recordProviderFailure({
      paymentIdentifier: 'pay-provider-failed',
      jobId: 'job-provider-failed',
      reasonCode: 'executor_rejected:provider_failed',
      createdAt: '2026-09-11T00:00:01.000Z',
    });
    expect((await ownerRepo.getByPaymentIdentifier('pay-provider-failed'))?.status).toBe(
      'completed'
    );
    const payment = await db
      .prepare(`SELECT lifecycle_stage FROM payment_attempts WHERE id = ?`)
      .bind('attempt-provider-failed')
      .first<{ lifecycle_stage: string }>();
    expect(payment?.lifecycle_stage).toBe('verified');
    expect(
      (
        await new D1LifecycleReconciliationRepository(db).getEffectiveByAttemptId(
          'attempt-provider-failed'
        )
      )?.classification
    ).toBe('current_execution_failed_unsettled');
  });
});
