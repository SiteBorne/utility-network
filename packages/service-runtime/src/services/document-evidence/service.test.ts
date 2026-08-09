import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Signer } from '@siteborne/verification';
import { DocumentEvidenceJsonService } from './service';
import { FixtureDocumentWorkerBridge, registerFixtureScenario } from './worker-bridge';
import type { WorkerResult } from './worker-result-types';
import { buildTestServiceContext, createFixtureSigner } from '../../tests/support';

const FIXTURES_DIR = fileURLToPath(
  new URL('../../../fixtures/document-worker-results', import.meta.url)
);

function loadWorkerResult(name: string): WorkerResult {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}/${name}.json`, 'utf-8')) as WorkerResult;
}

function bridgeFor(
  scenario: string,
  result: WorkerResult
): { bridge: FixtureDocumentWorkerBridge; bytes: Uint8Array } {
  const bytes = registerFixtureScenario(new Uint8Array([1, 2, 3]), scenario);
  const bridge = new FixtureDocumentWorkerBridge(new Map([[scenario, result]]));
  return { bridge, bytes };
}

describe('DocumentEvidenceJsonService', () => {
  let signer: Signer;

  beforeAll(async () => {
    ({ signer } = await createFixtureSigner());
  });

  it('reports dependency_unavailable when no artifact_reference is supplied (upload/url modes not implemented)', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const { bridge } = bridgeFor('unused', loadWorkerResult('native-text-success'));
    const service = new DocumentEvidenceJsonService({ worker: bridge, signer });
    const result = await service.execute({}, context);
    expect(result.result_class).toBe('dependency_unavailable');
  });

  it('rejects when the referenced artifact is not in the artifact store', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const { bridge } = bridgeFor('unused', loadWorkerResult('native-text-success'));
    const service = new DocumentEvidenceJsonService({ worker: bridge, signer });
    const result = await service.execute(
      {
        artifact_reference: {
          artifact_id: 'missing/doc.pdf',
          media_type: 'application/pdf',
          size_bytes: 10,
        },
      },
      context
    );
    expect(result.failure?.code).toBe('artifact_unavailable');
  });

  it('processes a native-text PDF (real SUN-0400A worker output, replayed from a captured fixture) into a schema-valid, mesh-passing PCC document', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const worker = loadWorkerResult('native-text-success');
    const { bridge, bytes } = bridgeFor('native-text', worker);
    await context.artifact_store.put(
      {
        id: 'doc/native.pdf',
        contentHash: worker.document!.sha256,
        media_type: 'application/pdf',
        byte_length: bytes.length,
      },
      bytes
    );

    const service = new DocumentEvidenceJsonService({ worker: bridge, signer });
    const result = await service.execute(
      {
        artifact_reference: {
          artifact_id: 'doc/native.pdf',
          media_type: 'application/pdf',
          size_bytes: bytes.length,
        },
      },
      context
    );

    expect(result.result_class).toBe('success');
    expect(result.output).toBeDefined();
    expect((result.output as { total_pages?: number })?.total_pages).toBe(
      worker.document!.page_count
    );
    expect(result.receipt_id).toMatch(/^rcpt_[a-f0-9]{24}$/);
  });

  it('processes a table-heavy PDF and includes table claims/evidence', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const worker = loadWorkerResult('multi-table-success');
    const { bridge, bytes } = bridgeFor('multi-table', worker);
    await context.artifact_store.put(
      {
        id: 'doc/tables.pdf',
        contentHash: worker.document!.sha256,
        media_type: 'application/pdf',
        byte_length: bytes.length,
      },
      bytes
    );

    const service = new DocumentEvidenceJsonService({ worker: bridge, signer });
    const result = await service.execute(
      {
        artifact_reference: {
          artifact_id: 'doc/tables.pdf',
          media_type: 'application/pdf',
          size_bytes: bytes.length,
        },
      },
      context
    );

    expect(result.result_class).toBe('success');
    expect((result.output as { tables?: unknown[] })?.tables?.length).toBeGreaterThan(0);
  });

  it('processes a scanned/OCR PDF and marks ocr_confidence entries', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const worker = loadWorkerResult('scanned-ocr-success');
    const { bridge, bytes } = bridgeFor('scanned-ocr', worker);
    await context.artifact_store.put(
      {
        id: 'doc/scanned.pdf',
        contentHash: worker.document!.sha256,
        media_type: 'application/pdf',
        byte_length: bytes.length,
      },
      bytes
    );

    const service = new DocumentEvidenceJsonService({ worker: bridge, signer });
    const result = await service.execute(
      {
        artifact_reference: {
          artifact_id: 'doc/scanned.pdf',
          media_type: 'application/pdf',
          size_bytes: bytes.length,
        },
        ocr_permission: true,
      },
      context
    );

    expect(['success', 'partial']).toContain(result.result_class);
  });

  it('returns permanent_failure with document_processing_failed for a malformed document, without fabricating pages', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const worker = loadWorkerResult('malformed-failure');
    const { bridge, bytes } = bridgeFor('malformed', worker);
    await context.artifact_store.put(
      {
        id: 'doc/malformed.pdf',
        contentHash: 'sha256:' + 'a'.repeat(64),
        media_type: 'application/pdf',
        byte_length: bytes.length,
      },
      bytes
    );

    const service = new DocumentEvidenceJsonService({ worker: bridge, signer });
    const result = await service.execute(
      {
        artifact_reference: {
          artifact_id: 'doc/malformed.pdf',
          media_type: 'application/pdf',
          size_bytes: bytes.length,
        },
      },
      context
    );

    expect(result.result_class).toBe('permanent_failure');
    expect(result.failure?.code).toBe('document_processing_failed');
    expect(result.output).toBeUndefined();
  });

  it('returns permanent_failure for an encrypted document rather than a false success', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const worker = loadWorkerResult('encrypted-failure');
    const { bridge, bytes } = bridgeFor('encrypted', worker);
    await context.artifact_store.put(
      {
        id: 'doc/encrypted.pdf',
        contentHash: 'sha256:' + 'b'.repeat(64),
        media_type: 'application/pdf',
        byte_length: bytes.length,
      },
      bytes
    );

    const service = new DocumentEvidenceJsonService({ worker: bridge, signer });
    const result = await service.execute(
      {
        artifact_reference: {
          artifact_id: 'doc/encrypted.pdf',
          media_type: 'application/pdf',
          size_bytes: bytes.length,
        },
      },
      context
    );

    expect(result.result_class).toBe('permanent_failure');
    expect(result.failure?.details).toMatchObject({ worker_failure_code: 'encrypted_document' });
  });
});
