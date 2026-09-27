/**
 * R3-A3-PROVIDER-EXECUTION-AUTHORITY-41 — the production provider dispatch
 * claim (`payment_workflow_owner_intents.provider_dispatched_at`, migration
 * 0014) against real Miniflare D1 with every migration applied.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { D1WorkflowOwnerIntentRepository } from '../src/control-plane/repositories/d1/workflow-owner-intents';

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

async function seedVerifiedIntent(db: D1Database, key: string): Promise<void> {
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
  await new D1WorkflowOwnerIntentRepository(db).commitVerifiedWithIntent({
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
}

const dispatchedAt = (db: D1Database, paymentIdentifier: string) =>
  db
    .prepare(
      'SELECT provider_dispatched_at FROM payment_workflow_owner_intents WHERE payment_identifier = ?'
    )
    .bind(paymentIdentifier)
    .first();

describe('A3-41 durable provider dispatch claim (real D1, migration 0014)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let dir: string;
  let repo: D1WorkflowOwnerIntentRepository;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'a3-41-'));
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response(null); } }',
      d1Databases: { DB: 'a3-41' },
      d1Persist: dir,
    });
    db = (await mf.getD1Database('DB')) as unknown as D1Database;
    await runMigrations(db);
    repo = new D1WorkflowOwnerIntentRepository(db);
  });

  afterAll(async () => {
    await mf.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('migration 0014 is additive: a freshly committed intent has no dispatch claim', async () => {
    await seedVerifiedIntent(db, 'fresh');
    expect(await dispatchedAt(db, 'pay-fresh')).toEqual({ provider_dispatched_at: null });
    expect((await repo.getByPaymentIdentifier('pay-fresh'))?.status).toBe('pending');
  });

  it('concurrent claimers: exactly one acquires the single provider dispatch', async () => {
    await seedVerifiedIntent(db, 'race');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        repo.claimProviderDispatch('pay-race', `2026-09-11T00:00:0${i}.000Z`)
      )
    );
    expect(results.filter((r) => r === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r === 'already_dispatched')).toHaveLength(7);
  });

  it('the claim never expires or reopens, however much later a retry arrives', async () => {
    await seedVerifiedIntent(db, 'sticky');
    expect(await repo.claimProviderDispatch('pay-sticky', '2026-09-11T00:00:00.000Z')).toBe(
      'claimed'
    );
    expect(await repo.claimProviderDispatch('pay-sticky', '2099-01-01T00:00:00.000Z')).toBe(
      'already_dispatched'
    );
    expect(await dispatchedAt(db, 'pay-sticky')).toEqual({
      provider_dispatched_at: '2026-09-11T00:00:00.000Z',
    });
  });

  it('a payment with no verified owner intent can never claim a dispatch', async () => {
    expect(await repo.claimProviderDispatch('pay-never-verified', '2026-09-11T00:00:00.000Z')).toBe(
      'missing'
    );
  });

  it('an unrelated payment’s claim is independent', async () => {
    await seedVerifiedIntent(db, 'iso-a');
    await seedVerifiedIntent(db, 'iso-b');
    expect(await repo.claimProviderDispatch('pay-iso-a', '2026-09-11T00:00:00.000Z')).toBe(
      'claimed'
    );
    expect(await repo.claimProviderDispatch('pay-iso-b', '2026-09-11T00:00:00.000Z')).toBe(
      'claimed'
    );
  });

  it('existing owner-intent operations are unaffected by the new column', async () => {
    await seedVerifiedIntent(db, 'legacy-ops');
    await repo.claimProviderDispatch('pay-legacy-ops', '2026-09-11T00:00:00.000Z');
    await repo.markCompletedByPaymentIdentifier('pay-legacy-ops', '2026-09-11T00:05:00.000Z');
    expect((await repo.getByPaymentIdentifier('pay-legacy-ops'))?.status).toBe('completed');
  });
});
