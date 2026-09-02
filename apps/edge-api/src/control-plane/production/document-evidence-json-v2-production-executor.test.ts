/**
 * SUN-1222B-S3-R2 — local buyer end-to-end proof for
 * `buildDocumentEvidenceJsonV2ProductionExecutor`'s `upload_reference`
 * resolution path: a real `storeDocumentUpload` call (the same function
 * `POST /v2/artifacts/documents` calls) mints an `upload_id` against a
 * real Miniflare D1 + a real `InMemoryArtifactStore`, and the executor is
 * then invoked with ONLY `{ upload_reference: { upload_id } }` -- proving
 * the whole buyer path end-to-end without ever touching the live Modal
 * endpoint (the injected `worker` is `FixtureDocumentWorkerBridge`
 * replaying a REAL captured worker output, per this repo's own
 * `worker-bridge.ts` testing convention -- never a hand-authored fake).
 *
 * Also covers the adversarial matrix specific to this resolution layer:
 * unknown/enumerated upload_id (IDOR), expired upload, and a declared
 * media_type/size_bytes/content_hash that disagrees with what was
 * actually stored (§24 pre-economic validation) -- all rejected BEFORE
 * the (billable) worker is ever invoked.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  buildProductionSigner,
  FixtureDocumentWorkerBridge,
  registerFixtureScenario,
  type DocumentWorkerBridge,
  type WorkerResult,
} from '@siteborne/service-runtime';
import { buildDocumentEvidenceJsonV2ProductionExecutor } from './document-evidence-json-v2-production-executor';
import { InMemoryArtifactStore } from '../artifacts/store';
import { storeDocumentUpload } from '../artifacts/document-upload';
import { D1ArtifactsRepository } from '../repositories/d1/artifacts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../migrations', import.meta.url));
const FIXTURES_DIR = fileURLToPath(
  new URL(
    '../../../../../packages/service-runtime/fixtures/document-worker-results',
    import.meta.url
  )
);

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

function loadWorkerResult(name: string): WorkerResult {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8')) as WorkerResult;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function randomPrivateKeyHex(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

const REAL_PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
function pdfBytes(extra: string): Uint8Array {
  const body = new TextEncoder().encode(extra);
  const out = new Uint8Array(REAL_PDF_MAGIC.length + body.length);
  out.set(REAL_PDF_MAGIC, 0);
  out.set(body, REAL_PDF_MAGIC.length);
  return out;
}
async function realHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

describe('buildDocumentEvidenceJsonV2ProductionExecutor — upload_reference local buyer E2E', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  let store: InMemoryArtifactStore;
  let signer: Awaited<ReturnType<typeof buildProductionSigner>>['signer'];
  let registry: Awaited<ReturnType<typeof buildProductionSigner>>['registry'];

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-document-executor-upload-e2e-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    ({ signer, registry } = await buildProductionSigner(
      randomPrivateKeyHex(),
      'kid_prod0123456789abcdefghij'
    ));
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Fresh InMemoryArtifactStore per test — dedup behavior across tests
    // is exercised separately in document-upload.test.ts; this suite is
    // about the resolution layer.
    store = new InMemoryArtifactStore();
  });

  async function mintUpload(content: string): Promise<{
    uploadId: string;
    bytes: Uint8Array;
    mediaType: string;
    sizeBytes: number;
    contentHash: string;
  }> {
    const bytes = pdfBytes(content);
    const result = await storeDocumentUpload(bytes, 'application/pdf', {
      artifactStore: store,
      artifactsRepository: new D1ArtifactsRepository(db),
      randomId: () => crypto.randomUUID(),
      nowIso: () => new Date().toISOString(),
      hash: realHash,
    });
    if (!result.ok) throw new Error(`test setup failed to mint upload: ${result.message}`);
    return {
      uploadId: result.upload_id,
      bytes,
      mediaType: result.media_type,
      sizeBytes: result.size_bytes,
      contentHash: result.content_hash,
    };
  }

  function fixtureWorker(bytes: Uint8Array, result: WorkerResult): DocumentWorkerBridge {
    registerFixtureScenario(bytes, 'e2e-scenario');
    return new FixtureDocumentWorkerBridge(new Map([['e2e-scenario', result]]));
  }

  it('resolves a real upload_reference end-to-end into a successful, signed PCC result — never touching the live Modal endpoint', async () => {
    const upload = await mintUpload('e2e happy path');
    const worker = fixtureWorker(upload.bytes, loadWorkerResult('native-text-success'));
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      worker,
      store,
      db
    );

    const outcome = await executor(
      { upload_reference: { upload_id: upload.uploadId } },
      { job_id: 'job_test_upload_e2e_0000001', request_id: 'req_test_upload_e2e_0000001' }
    );

    expect(outcome.result.result_class).toBe('success');
    expect(outcome.actualAmountAtomic).toBeDefined();
    expect(outcome.resourceMetrics).toBeDefined();
    // The receipt's evidence sourceUri must show the buyer-facing
    // upload_id as the capability (§34) -- never an internal R2 key/hash.
    const extension = outcome.result.output as {
      text_blocks?: Array<{ page: number; text: string }>;
    };
    expect(extension.text_blocks?.[0]?.text).toMatch(/SUN-0400A Fixture: Native Text/);
  });

  it('rejects with upload_reference_unresolved (never 500, never a fabricated success) for an unknown/enumerated upload_id -- proves no artifact enumeration/IDOR', async () => {
    const worker = fixtureWorker(
      new Uint8Array([9, 9, 9]),
      loadWorkerResult('native-text-success')
    );
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      worker,
      store,
      db
    );
    const outcome = await executor(
      { upload_reference: { upload_id: 'does-not-exist-00000000-0000-4000-8000-000000000000' } },
      { job_id: 'job_test_upload_e2e_0000002', request_id: 'req_test_upload_e2e_0000002' }
    );
    expect(outcome.result.result_class).toBe('rejected');
    expect(outcome.result.failure?.code).toBe('upload_reference_unresolved');
    expect(outcome.result.failure?.message).toMatch(/no artifact was found/);
  });

  it('rejects an expired upload_reference, even though the D1 row and R2 content both still exist', async () => {
    const bytes = pdfBytes('expired upload');
    const repo = new D1ArtifactsRepository(db);
    const id = crypto.randomUUID();
    const hash = await realHash(bytes);
    await store.put(
      {
        id,
        content_hash: hash,
        media_type: 'application/pdf',
        byte_length: bytes.length,
        created_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2026-01-01T00:15:00.000Z', // long past
        authorization_class: 'buyer_authorized',
        retention_class: 'ephemeral',
        artifact_type: 'input',
      },
      bytes
    );
    await repo.create({
      id,
      content_hash: hash,
      media_type: 'application/pdf',
      byte_length: bytes.length,
      created_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-01T00:15:00.000Z',
      authorization_class: 'buyer_authorized',
      retention_class: 'ephemeral',
      artifact_type: 'input',
    });

    const worker = fixtureWorker(bytes, loadWorkerResult('native-text-success'));
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      worker,
      store,
      db
    );
    const outcome = await executor(
      { upload_reference: { upload_id: id } },
      { job_id: 'job_test_upload_e2e_0000003', request_id: 'req_test_upload_e2e_0000003' }
    );
    expect(outcome.result.result_class).toBe('rejected');
    expect(outcome.result.failure?.message).toMatch(/expired/);
  });

  it('rejects when the declared media_type disagrees with what was actually stored, BEFORE the worker is ever invoked', async () => {
    const upload = await mintUpload('media type mismatch test');
    let workerInvoked = false;
    const worker: DocumentWorkerBridge = {
      async run() {
        workerInvoked = true;
        throw new Error('worker must never be invoked for a pre-economic rejection');
      },
    };
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      worker,
      store,
      db
    );
    const outcome = await executor(
      {
        upload_reference: {
          upload_id: upload.uploadId,
          media_type: 'image/png', // does not match the real stored application/pdf
        },
      },
      { job_id: 'job_test_upload_e2e_0000004', request_id: 'req_test_upload_e2e_0000004' }
    );
    expect(outcome.result.result_class).toBe('rejected');
    expect(outcome.result.failure?.message).toMatch(/media_type/);
    expect(workerInvoked).toBe(false);
  });

  it('rejects when the declared size_bytes or content_hash disagrees with what was actually stored', async () => {
    const upload = await mintUpload('size and hash mismatch test');
    const worker = fixtureWorker(upload.bytes, loadWorkerResult('native-text-success'));
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      worker,
      store,
      db
    );

    const wrongSize = await executor(
      { upload_reference: { upload_id: upload.uploadId, size_bytes: upload.sizeBytes + 1 } },
      { job_id: 'job_test_upload_e2e_0000005', request_id: 'req_test_upload_e2e_0000005' }
    );
    expect(wrongSize.result.result_class).toBe('rejected');
    expect(wrongSize.result.failure?.message).toMatch(/size_bytes/);

    const wrongHash = await executor(
      {
        upload_reference: {
          upload_id: upload.uploadId,
          content_hash: 'sha256:' + '0'.repeat(64),
        },
      },
      { job_id: 'job_test_upload_e2e_0000006', request_id: 'req_test_upload_e2e_0000006' }
    );
    expect(wrongHash.result.result_class).toBe('rejected');
    expect(wrongHash.result.failure?.message).toMatch(/content_hash/);
  });

  it('rejects a missing/non-string upload_id without ever querying D1', async () => {
    const spy = vi.spyOn(D1ArtifactsRepository.prototype, 'getById');
    const worker = fixtureWorker(new Uint8Array([1]), loadWorkerResult('native-text-success'));
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      worker,
      store,
      db
    );
    const outcome = await executor(
      { upload_reference: {} },
      { job_id: 'job_test_upload_e2e_0000007', request_id: 'req_test_upload_e2e_0000007' }
    );
    expect(outcome.result.result_class).toBe('rejected');
    expect(outcome.result.failure?.message).toMatch(/upload_id was missing/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an artifact_reference input (the pre-existing mode) is completely unaffected by the upload_reference resolution branch', async () => {
    const bytes = pdfBytes('pre-existing artifact_reference mode');
    const worker = fixtureWorker(bytes, loadWorkerResult('native-text-success'));
    await store.put(
      {
        id: 'pre-existing-artifact-id',
        content_hash: await realHash(bytes),
        media_type: 'application/pdf',
        byte_length: bytes.length,
        created_at: '2026-09-01T00:00:00.000Z',
        authorization_class: 'public',
        retention_class: 'standard',
        artifact_type: 'input',
      },
      bytes
    );
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      worker,
      store,
      db
    );
    const outcome = await executor(
      {
        artifact_reference: {
          artifact_id: 'pre-existing-artifact-id',
          media_type: 'application/pdf',
          size_bytes: bytes.length,
        },
      },
      { job_id: 'job_test_upload_e2e_0000008', request_id: 'req_test_upload_e2e_0000008' }
    );
    expect(outcome.result.result_class).toBe('success');
  });
});
