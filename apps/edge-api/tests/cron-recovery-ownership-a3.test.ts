import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  D1WorkflowOwnerIntentRepository,
  type WorkflowOwnerIntent,
} from '../src/control-plane/repositories/d1/workflow-owner-intents';
import { recoverPendingWorkflowOwnerIntents } from '../src/control-plane/continuation/owner-recovery';
import type {
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/control-plane/continuation/handoff';
import { reclaimStaleArtifacts } from '../src/control-plane/artifacts/artifact-reclamation';
import { InMemoryArtifactStore } from '../src/control-plane/artifacts/store';
import { InMemoryArtifactsRepository } from '../src/control-plane/repositories/in-memory';
import { D1ArtifactsRepository } from '../src/control-plane/repositories/d1/artifacts';
import type { ArtifactsRepository } from '../src/control-plane/repositories/interfaces';
import type { ArtifactRecord } from '../src/control-plane/types';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

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

async function seedIntent(db: D1Database, key: string): Promise<D1WorkflowOwnerIntentRepository> {
  await db
    .prepare(
      `INSERT INTO payment_attempts (
    id, payment_identifier, binding_digest, quote_id, requirement_id, service_id,
    service_version, contract_release, request_input_hash, resource_id, scheme,
    network, asset, amount, payee, created_at, expires_at, lifecycle_stage
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'acquired')`
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
      '2026-09-11T00:00:00.000Z',
      '2026-09-11T01:00:00.000Z'
    )
    .run();
  const repo = new D1WorkflowOwnerIntentRepository(db);
  await repo.commitVerifiedWithIntent({
    paymentIdentifier: `pay-${key}`,
    intentId: `intent-${key}`,
    workflowInstanceId: `wf-${key}`,
    workflowInput: {
      envelope: { v: 1, key_id: 'k', iv_b64: 'a', ciphertext_b64: 'b', aad_fingerprint: 'c' },
      metadata: {
        job_id: `job-${key}`,
        payment_identifier: `pay-${key}`,
        service: 'verify_agent_output.v2',
        network: 'eip155:8453',
        asset: '0xasset',
        pay_to: '0xpayee',
        amount_atomic: '10000',
        valid_before_unix: 2_000_000_000,
      },
      request_id: 'req',
    },
    createdAt: '2026-09-11T00:00:00.000Z',
  });
  return repo;
}

class Instance implements WorkflowInstanceLike {
  constructor(readonly id: string) {}
  async status() {
    return { status: 'running' as const };
  }
}

/** Platform-faithful double: `create` rejects a duplicate instance id. */
function workflowDouble(options: { createBarrier?: number; unreachable?: boolean } = {}) {
  const instances = new Map<string, Instance>();
  let createCalls = 0;
  let arrived = 0;
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => (release = resolve));
  const binding: WorkflowBindingLike = {
    async create({ id }) {
      createCalls += 1;
      if (options.unreachable) throw new Error('workflow binding unreachable');
      if (options.createBarrier) {
        arrived += 1;
        if (arrived >= options.createBarrier) release();
        await barrier;
      }
      if (instances.has(id)) throw new Error('instance already exists');
      const instance = new Instance(id);
      instances.set(id, instance);
      return instance;
    },
    async get(id) {
      if (options.unreachable) throw new Error('workflow binding unreachable');
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

/** A sweep holding a stale `listRecoverable` snapshot (e.g. an older Worker
 * version whose scan ran before another actor advanced the intent). */
function staleSnapshotRepo(
  repo: D1WorkflowOwnerIntentRepository,
  snapshot: WorkflowOwnerIntent
): D1WorkflowOwnerIntentRepository {
  return Object.assign(Object.create(repo) as D1WorkflowOwnerIntentRepository, {
    listRecoverable: async () => [snapshot],
  });
}

describe('A3 cron recovery ownership: recoverPendingWorkflowOwnerIntents', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-a3-cron-'));
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

  it('two version-skewed sweeps that both select the same intent and both reach create() yield exactly one Workflow instance and one owner transition', async () => {
    const repo = await seedIntent(db, 'interleave');
    const workflow = workflowDouble({ createBarrier: 2 });

    const [a, b] = await Promise.all([
      recoverPendingWorkflowOwnerIntents(repo, workflow.binding, {
        now: () => '2026-09-11T00:00:01.000Z',
        maxAttempts: 12,
      }),
      recoverPendingWorkflowOwnerIntents(repo, workflow.binding, {
        now: () => '2026-09-11T00:00:01.500Z',
        maxAttempts: 3,
      }),
    ]);

    expect(workflow.createCalls).toBe(2);
    expect(workflow.instances.size).toBe(1);
    expect([...a, ...b].map((r) => r.outcome).sort()).toEqual([
      'created',
      'joined_after_ambiguous_create',
    ]);
    const intent = await repo.getByPaymentIdentifier('pay-interleave');
    expect(intent?.status).toBe('workflow_created');
    expect(intent?.dispatchAttemptCount).toBe(1);
  });

  it('a stale sweep cannot regress a completed intent or create a second instance', async () => {
    const repo = await seedIntent(db, 'stale-completed');
    const snapshot = (await repo.getByPaymentIdentifier('pay-stale-completed'))!;
    const workflow = workflowDouble();
    await workflow.binding.create({ id: snapshot.workflowInstanceId, params: snapshot.workflowInput });
    await repo.markCompletedByPaymentIdentifier('pay-stale-completed', '2026-09-11T00:00:02.000Z');

    const results = await recoverPendingWorkflowOwnerIntents(
      staleSnapshotRepo(repo, snapshot),
      workflow.binding,
      { now: () => '2026-09-11T00:00:03.000Z' }
    );

    expect(results.map((r) => r.outcome)).toEqual(['already_owned']);
    expect(workflow.createCalls).toBe(1);
    expect(workflow.instances.size).toBe(1);
    expect((await repo.getByPaymentIdentifier('pay-stale-completed'))?.status).toBe('completed');
  });

  it('a stale sweep whose Workflow binding is unreachable cannot record a failure against an already-owned intent', async () => {
    const repo = await seedIntent(db, 'stale-owned');
    const snapshot = (await repo.getByPaymentIdentifier('pay-stale-owned'))!;
    await repo.markWorkflowCreated(snapshot.id, '2026-09-11T00:00:02.000Z');
    const before = (await repo.getByPaymentIdentifier('pay-stale-owned'))!;

    const results = await recoverPendingWorkflowOwnerIntents(
      staleSnapshotRepo(repo, snapshot),
      workflowDouble({ unreachable: true }).binding,
      { now: () => '2026-09-11T00:00:03.000Z', maxAttempts: 1 }
    );

    expect(results.map((r) => r.outcome)).toEqual(['retry_scheduled']);
    const after = (await repo.getByPaymentIdentifier('pay-stale-owned'))!;
    expect(after.status).toBe('workflow_created');
    expect(after.dispatchAttemptCount).toBe(before.dispatchAttemptCount);
  });

  it('two concurrent reclamation passes over the same stale D1 artifact reclaim it exactly once and never throw', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new D1ArtifactsRepository(db);
    const record = await seedStaleArtifact(store, repo, 'art-dup');
    const deps = { artifactStore: store, artifactsRepository: repo, nowIso: () => NOW_ISO };

    const [a, b] = await Promise.all([reclaimStaleArtifacts(deps), reclaimStaleArtifacts(deps)]);

    expect(a.reclaimed + b.reclaimed).toBe(1);
    expect(a.r2_delete_failures + b.r2_delete_failures).toBe(0);
    expect(await repo.getById(record.id)).toMatchObject({ ok: true, value: null });
    expect(await store.getContentByContentHash(record.content_hash)).toBeNull();
  });
});

const NOW_ISO = '2026-09-04T00:00:00.000Z';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3]);

async function seedStaleArtifact(
  store: InMemoryArtifactStore,
  repo: ArtifactsRepository,
  id: string
): Promise<ArtifactRecord> {
  const bytes = new Uint8Array([...PDF, ...new TextEncoder().encode(id)]);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash =
    'sha256:' +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const record: ArtifactRecord = {
    id,
    content_hash: hash,
    media_type: 'application/pdf',
    byte_length: bytes.length,
    created_at: '2026-09-01T00:00:00.000Z',
    expires_at: '2026-09-01T00:15:00.000Z',
    authorization_class: 'buyer_authorized',
    retention_class: 'ephemeral',
    artifact_type: 'input',
  };
  await store.put(record, bytes);
  await repo.create(record);
  return record;
}

describe('A3 cron recovery ownership: reclaimStaleArtifacts', () => {
  // A3-CRON-GAP-1 (closed by R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34): a dedup
  // `refreshExpiry` landing after `listReclaimable` used to be followed by
  // unconditional R2/D1 deletes of the renewed row. Deletion now requires an
  // atomic claim against current D1 state, which the renewal makes lose.
  // Full matrix: `artifact-reclaim-ownership-a3.test.ts`.
  it('a dedup refresh between listing and delete must keep the renewed artifact and its bytes', async () => {
    const store = new InMemoryArtifactStore();
    const inner = new InMemoryArtifactsRepository();
    const record = await seedStaleArtifact(store, inner, 'art-renewed');
    const renewedUntil = '2026-09-04T00:15:00.000Z';
    const racingRepo = Object.assign(Object.create(inner) as InMemoryArtifactsRepository, {
      listReclaimable: async (olderThanIso: string, nowIso: string) => {
        const listed = await inner.listReclaimable(olderThanIso, nowIso);
        await inner.refreshExpiry(record.id, renewedUntil);
        return listed;
      },
    });

    await reclaimStaleArtifacts({
      artifactStore: store,
      artifactsRepository: racingRepo,
      nowIso: () => NOW_ISO,
    });

    const row = await inner.getById(record.id);
    expect(row.ok && row.value?.expires_at).toBe(renewedUntil);
    expect(await store.getContentByContentHash(record.content_hash)).not.toBeNull();
  });
});
