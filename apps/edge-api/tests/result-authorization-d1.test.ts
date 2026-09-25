import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type { PaymentAttemptRecord } from '@siteborne/protocol-x402';
import type { Job } from '../src/control-plane/types';
import { D1ResultAuthorizationRepository } from '../src/control-plane/repositories/d1/result-authorization';
import type {
  ResultResourceV1,
  ResultSubjectBindingV1,
} from '../src/control-plane/security/result-authorization';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

async function runMigrations(
  db: D1Database,
  include: (name: string) => boolean = () => true
): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && include(name))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter(Boolean)) {
      await db.exec(statement);
    }
  }
}

const binding: ResultSubjectBindingV1 = {
  schema_version: 'result_subject_binding.v1',
  binding_id: 'rb-1',
  operation_scope_ref: `sha256:${'1'.repeat(64)}`,
  owner_subject_ref: `k1:${'2'.repeat(64)}`,
  binding_policy_version: 'result_binding_policy.v1',
  creation_authority: 'siteborne:request-admission',
  created_at: '2026-09-22T12:00:00.000Z',
  authority_context_id: 'ac-1',
  policy_evaluation_id: 'pe-1',
};

const resource: ResultResourceV1 = {
  schema_version: 'result_resource.v1',
  operation_id: 'job-1',
  result_id: 'res-1',
  artifact_id: 'r2:results/pcc/sha256-aaaa',
  pcc_document_hash: `sha256:${'a'.repeat(64)}`,
  service_id: 'document_evidence_json.v3',
  service_version: 'v3',
  contract_release: '3.0.0',
  confidentiality_class: 'BUYER_AUTHORIZED',
  result_binding_id: binding.binding_id,
};

function candidateJob(id: string, paymentIdentifier: string): Job {
  return {
    id,
    request_id: `req-${id}`,
    service_id: 'document_evidence_json.v3',
    service_version: 'v3',
    input_hash: 'in',
    input_schema_hash: 'is',
    output_schema_hash: 'os',
    idempotency_key: paymentIdentifier,
    contract_release: '3.0.0',
    pcc_dependency: '2.0.0',
    current_state: 'RECEIVED',
    created_at: binding.created_at,
    updated_at: binding.created_at,
    expires_at: '2026-09-22T13:00:00.000Z',
    attempt_count: 1,
    production_enabled: false,
  };
}

function candidateAttempt(paymentIdentifier: string): PaymentAttemptRecord {
  return {
    payment_identifier: paymentIdentifier,
    binding_digest: `sha256:${'a'.repeat(64)}`,
    binding: {
      binding_version: 2,
      payment_rail: 'cdp',
      payment_provider: 'cdp-facilitator@1.55.0',
      payment_identifier: paymentIdentifier,
      quote_id: 'quote-test',
      requirement_id: 'requirement-test',
      service_id: 'document_evidence_json.v3',
      service_version: 'v3',
      contract_release: '3.0.0',
      request_input_hash: 'in',
      resource_id: 'https://utility.siteborne.net/v3/document/evidence-json',
      scheme: 'upto',
      network: 'eip155:84532',
      asset: '0x0000000000000000000000000000000000000001',
      amount: '100000',
      payee: '0x0000000000000000000000000000000000000002',
    },
    created_at: binding.created_at,
    expires_at: '2026-09-22T13:00:00.000Z',
    consumed: false,
  };
}

describe('result authorization D1 persistence', () => {
  let directory: string;
  let miniflare: Miniflare;
  let db: D1Database;
  let repository: D1ResultAuthorizationRepository;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'siteborne-result-auth-'));
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: directory,
    });
    db = await miniflare.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    await db
      .prepare(
        `INSERT INTO services (id, version, title, description, input_schema, output_schema, price_usd)
       VALUES ('document_evidence_json.v3', 'v3', 'd', 'd', '{}', '{}', '0')`
      )
      .run();
    await db
      .prepare(
        `INSERT INTO jobs (
        id, request_id, service_id, service_version, input_hash, input_schema_hash,
        output_schema_hash, idempotency_key, contract_release, pcc_dependency,
        current_state, created_at, updated_at, expires_at, attempt_count, production_enabled
      ) VALUES ('job-1', 'req-1', 'document_evidence_json.v3', 'v3', 'in', 'is', 'os',
        'idk-1', '3.0.0', '2.0.0', 'RECEIVED', '2026-09-22T12:00:00.000Z',
        '2026-09-22T12:00:00.000Z', '2026-09-22T13:00:00.000Z', 1, 0)`
      )
      .run();
    repository = new D1ResultAuthorizationRepository(db);
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates an immutable subject binding once and returns it by operation', async () => {
    expect(await repository.createSubjectBinding('job-1', binding)).toBe('created');
    expect(await repository.createSubjectBinding('job-1', binding)).toBe('already_exists');
    expect(await repository.getSubjectBindingByOperation('job-1')).toEqual(binding);
    await expect(
      repository.createSubjectBinding('job-1', {
        ...binding,
        owner_subject_ref: `k1:${'3'.repeat(64)}`,
      })
    ).rejects.toThrow('result_subject_binding_conflict');
  });

  it('rejects unsupported or corrupt stored binding policy and creation authority', async () => {
    await db
      .prepare(
        "UPDATE result_subject_bindings SET binding_policy_version = 'unsupported' WHERE operation_id = 'job-1'"
      )
      .run();
    await expect(repository.getSubjectBindingByOperation('job-1')).rejects.toThrow(
      'result_subject_binding_policy_invalid'
    );
    await db
      .prepare(
        "UPDATE result_subject_bindings SET binding_policy_version = 'result_binding_policy.v1', creation_authority = 'untrusted' WHERE operation_id = 'job-1'"
      )
      .run();
    await expect(repository.getSubjectBindingByOperation('job-1')).rejects.toThrow(
      'result_subject_binding_policy_invalid'
    );
    await db
      .prepare(
        "UPDATE result_subject_bindings SET creation_authority = 'siteborne:request-admission' WHERE operation_id = 'job-1'"
      )
      .run();
  });

  it('atomically acquires payment, job, and immutable owner binding', async () => {
    const id = 'atomic-payment-1';
    const job = candidateJob('atomic-job-1', id);
    const atomicBinding = { ...binding, binding_id: 'rb-atomic-1' };
    expect(
      await repository.acquireBuyerAuthorizedOperation(candidateAttempt(id), job, atomicBinding)
    ).toBe('acquired');
    expect(await repository.getSubjectBindingByOperation(job.id)).toEqual(atomicBinding);
    expect(
      await db
        .prepare('SELECT payment_identifier FROM payment_attempts WHERE payment_identifier = ?')
        .bind(id)
        .first()
    ).toBeTruthy();
    expect(
      await repository.acquireBuyerAuthorizedOperation(candidateAttempt(id), job, atomicBinding)
    ).toBe('conflict');

    const badId = 'atomic-payment-rollback';
    await expect(
      repository.acquireBuyerAuthorizedOperation(
        candidateAttempt(badId),
        candidateJob('atomic-job-rollback', badId),
        atomicBinding
      )
    ).rejects.toThrow();
    expect(
      await db
        .prepare('SELECT payment_identifier FROM payment_attempts WHERE payment_identifier = ?')
        .bind(badId)
        .first()
    ).toBeNull();
    expect(
      await db.prepare("SELECT id FROM jobs WHERE id = 'atomic-job-rollback'").first()
    ).toBeNull();
  });

  it('rejects resource creation when no immutable subject binding exists', async () => {
    await expect(
      repository.createResultResource(
        {
          ...resource,
          operation_id: 'job-without-binding',
          result_id: 'res-without-binding',
          artifact_id: 'r2:results/pcc/sha256-missing',
          pcc_document_hash: `sha256:${'b'.repeat(64)}`,
        },
        binding.created_at
      )
    ).rejects.toThrow('result_subject_binding_missing');
  });

  it('creates a resource only after its immutable binding exists and rejects substitution', async () => {
    expect(await repository.createResultResource(resource, binding.created_at)).toBe('created');
    expect(await repository.createResultResource(resource, binding.created_at)).toBe(
      'already_exists'
    );
    expect(await repository.getResultResourceByOperation('job-1')).toEqual(resource);
    await expect(
      repository.createResultResource(
        { ...resource, artifact_id: 'r2:substitute' },
        binding.created_at
      )
    ).rejects.toThrow('result_resource_conflict');
  });

  it('stores no raw credential, payer, wallet, payment identifier, email, or username columns', async () => {
    for (const table of ['result_subject_bindings', 'result_resources']) {
      const rows = await db.prepare(`PRAGMA table_info(${table})`).all();
      const columns = rows.results.map((row) => String((row as { name: unknown }).name));
      expect(columns).not.toEqual(
        expect.arrayContaining([
          'raw_jwt',
          'oauth_token',
          'api_key',
          'payer',
          'wallet',
          'payment_identifier',
          'email',
          'username',
        ])
      );
    }
  });

  it('persists a subject revocation and reports it in the revoked set', async () => {
    const subjectRef = `k1:${'9'.repeat(64)}`;
    expect(await repository.isSubjectRevoked(subjectRef)).toBe(false);
    expect(await repository.revokedSubjectRefs()).not.toContain(subjectRef);

    expect(
      await repository.revokeSubject(subjectRef, {
        revokedAt: '2026-09-23T00:00:00.000Z',
        reasonCode: 'compromised_credential',
        revokingAuthority: 'siteborne:security-operations',
      })
    ).toBe('revoked');
    expect(await repository.isSubjectRevoked(subjectRef)).toBe(true);
    expect(await repository.revokedSubjectRefs()).toContain(subjectRef);
  });

  it('is idempotent: a repeated revoke of the same subject is a no-op', async () => {
    const subjectRef = `k1:${'8'.repeat(64)}`;
    expect(
      await repository.revokeSubject(subjectRef, { revokedAt: '2026-09-23T00:00:00.000Z' })
    ).toBe('revoked');
    expect(
      await repository.revokeSubject(subjectRef, {
        revokedAt: '2099-01-01T00:00:00.000Z',
        reasonCode: 'different_second_call',
      })
    ).toBe('already_revoked');
    const row = await db
      .prepare('SELECT revoked_at, reason_code FROM result_subject_revocations WHERE subject_ref = ?')
      .bind(subjectRef)
      .first<{ revoked_at: string; reason_code: string | null }>();
    // First-write-wins: the second, later "revoke" of an already-revoked
    // subject changes no state -- same semantic outcome as a single call.
    expect(row?.revoked_at).toBe('2026-09-23T00:00:00.000Z');
    expect(row?.reason_code).toBeNull();
    expect(
      await repository
        .revokedSubjectRefs()
        .then((refs) => refs.filter((ref) => ref === subjectRef).length)
    ).toBe(1);
  });

  it('stores no raw credential, token, or payer identity for a revocation', async () => {
    const rows = await db.prepare('PRAGMA table_info(result_subject_revocations)').all();
    const columns = rows.results.map((row) => String((row as { name: unknown }).name));
    expect(columns).toEqual(['subject_ref', 'revoked_at', 'reason_code', 'revoking_authority']);
  });

  it('fails closed: a repository failure surfaces as a thrown error, never an empty revoked list', async () => {
    const failingDb = {
      prepare: () => ({
        all: async () => ({ success: false, results: [] }),
      }),
    } as unknown as D1Database;
    const failingRepository = new D1ResultAuthorizationRepository(failingDb);
    await expect(failingRepository.revokedSubjectRefs()).rejects.toThrow(
      'result_subject_revocation_lookup_failed'
    );
  });

  it('applies cleanly as an additive upgrade from the preceding local schema', async () => {
    const upgradeDirectory = mkdtempSync(join(tmpdir(), 'siteborne-result-auth-upgrade-'));
    const upgrade = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: upgradeDirectory,
    });
    try {
      const upgradeDb = await upgrade.getD1Database('DB');
      await upgradeDb.exec('PRAGMA foreign_keys = ON');
      await runMigrations(upgradeDb, (name) => name !== '0011_result_authorization.sql');
      expect(
        await upgradeDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'result_subject_bindings'"
          )
          .first()
      ).toBeNull();
      await runMigrations(upgradeDb, (name) => name === '0011_result_authorization.sql');
      const rows = await upgradeDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('result_subject_bindings', 'result_resources') ORDER BY name"
        )
        .all();
      expect(rows.results.map((row) => row.name)).toEqual([
        'result_resources',
        'result_subject_bindings',
      ]);
    } finally {
      await upgrade.dispose();
      rmSync(upgradeDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it('applies the revocation migration cleanly as an additive upgrade', async () => {
    const upgradeDirectory = mkdtempSync(join(tmpdir(), 'siteborne-result-auth-revocation-upgrade-'));
    const upgrade = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: upgradeDirectory,
    });
    try {
      const upgradeDb = await upgrade.getD1Database('DB');
      await upgradeDb.exec('PRAGMA foreign_keys = ON');
      await runMigrations(upgradeDb, (name) => name !== '0012_result_subject_revocation.sql');
      expect(
        await upgradeDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'result_subject_revocations'"
          )
          .first()
      ).toBeNull();
      await runMigrations(upgradeDb, (name) => name === '0012_result_subject_revocation.sql');
      expect(
        await upgradeDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'result_subject_revocations'"
          )
          .first()
      ).toBeTruthy();
      // Idempotent/re-runnable: applying the same migration again must not
      // error (`CREATE TABLE IF NOT EXISTS`).
      await runMigrations(upgradeDb, (name) => name === '0012_result_subject_revocation.sql');
    } finally {
      await upgrade.dispose();
      rmSync(upgradeDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
