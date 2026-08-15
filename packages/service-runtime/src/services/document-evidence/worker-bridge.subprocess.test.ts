/**
 * Real end-to-end integration test for SubprocessDocumentWorkerBridge —
 * actually spawns the SUN-0400A Python worker via local_runner.py. Skipped
 * automatically when the document-worker's venv is not present, mirroring
 * packages/provider-adapters' live-gate pattern (opt-in, never a hard
 * dependency of the fast default `pnpm test` path or CI's Node validate
 * job — the Python worker is validated separately by
 * `pnpm document-worker:check` in CI's python-validate job).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VerificationReceipt } from '@siteborne/verification';
import { describe, expect, it } from 'vitest';
import { verifyServiceReceipt } from '../../pcc';
import { buildTestServiceContext, createFixtureSigner } from '../../tests/support';
import { DocumentEvidenceJsonService } from './service';
import type { WorkerResult } from './worker-result-types';
import { SubprocessDocumentWorkerBridge } from './worker-bridge';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const WORKER_CWD = join(REPO_ROOT, 'services', 'modal-worker');
const PYTHON = join(WORKER_CWD, '.venv', 'bin', 'python');
const FIXTURE_PDF = join(WORKER_CWD, 'fixtures', 'pdf', 'native_text_one_page.pdf');
const MAXIMUM_OCR_FIXTURE_PDF = join(WORKER_CWD, 'fixtures', 'pdf', 'scanned_ten_page.pdf');

const venvAvailable = existsSync(PYTHON) && existsSync(FIXTURE_PDF);

describe.skipIf(!venvAvailable)(
  'SubprocessDocumentWorkerBridge (real subprocess, requires services/modal-worker/.venv)',
  () => {
    it('runs the real SUN-0400A local_runner CLI against a real fixture PDF and returns a matching WorkerResult', async () => {
      const bridge = new SubprocessDocumentWorkerBridge(PYTHON, WORKER_CWD);
      const bytes = readFileSync(FIXTURE_PDF);
      const result = await bridge.run({
        bytes,
        mediaType: 'application/pdf',
        ocrPolicy: 'if_needed',
        tablePolicy: 'extract',
      });

      expect(result.status).toBe('success');
      expect(result.document?.media_type).toBe('application/pdf');
      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.pages[0]!.page_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }, 30_000);

    it('produces a signed receipt for the ten-page OCR checkpoint-2I service input', async () => {
      expect(existsSync(MAXIMUM_OCR_FIXTURE_PDF)).toBe(true);
      const bytes = readFileSync(MAXIMUM_OCR_FIXTURE_PDF);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        'd0b09ad4ccceb8dbaad8647fe0eb19f13793a11fcb5ca91a047b0b8576d3750f'
      );
      const context = await buildTestServiceContext('document_evidence_json.v1');
      await context.artifact_store.put(
        {
          id: 'doc/scanned-ten-page-fixture.pdf',
          contentHash: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
          media_type: 'application/pdf',
          byte_length: bytes.length,
        },
        bytes
      );
      let workerResult: WorkerResult | undefined;
      const bridge = new SubprocessDocumentWorkerBridge(PYTHON, WORKER_CWD);
      const { signer, registry } = await createFixtureSigner();
      const service = new DocumentEvidenceJsonService({
        worker: {
          async run(request) {
            workerResult = await bridge.run(request);
            return workerResult;
          },
        },
        signer,
        keyRegistry: registry,
      });
      const result = await service.execute(
        {
          artifact_reference: {
            artifact_id: 'doc/scanned-ten-page-fixture.pdf',
            media_type: 'application/pdf',
            size_bytes: bytes.length,
          },
          ocr_permission: true,
        },
        context
      );

      expect(workerResult).toBeDefined();
      expect(workerResult!.status).toBe('success');
      expect(workerResult!.document?.page_count).toBe(10);
      expect(workerResult!.pages).toHaveLength(10);
      expect(workerResult!.pages.every((page) => page.ocr_used)).toBe(true);
      expect(workerResult!.pages.every((page) => page.extraction_method === 'ocr')).toBe(true);
      expect(workerResult!.pages.every((page) => page.tables.length === 0)).toBe(true);
      expect(result.result_class).toBe('success');
      expect(result.receipt_id).toMatch(/^rcpt_[a-f0-9]{24}$/);
      expect(
        await verifyServiceReceipt({
          receipt: result.receipt as VerificationReceipt,
          keyRegistry: registry,
          expectedServiceId: 'document_evidence_json.v1',
          expectedOutputHash: result.output_hash,
        })
      ).toMatchObject({ valid: true });
    }, 60_000);

    it('rejects the same OCR-only fixture without explicit OCR permission and emits no signed receipt', async () => {
      const bytes = readFileSync(MAXIMUM_OCR_FIXTURE_PDF);
      const context = await buildTestServiceContext('document_evidence_json.v1');
      await context.artifact_store.put(
        {
          id: 'doc/scanned-ten-page-fixture-ocr-disabled.pdf',
          contentHash: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
          media_type: 'application/pdf',
          byte_length: bytes.length,
        },
        bytes
      );
      const bridge = new SubprocessDocumentWorkerBridge(PYTHON, WORKER_CWD);
      const { signer, registry } = await createFixtureSigner();
      const service = new DocumentEvidenceJsonService({
        worker: bridge,
        signer,
        keyRegistry: registry,
      });
      const result = await service.execute(
        {
          artifact_reference: {
            artifact_id: 'doc/scanned-ten-page-fixture-ocr-disabled.pdf',
            media_type: 'application/pdf',
            size_bytes: bytes.length,
          },
        },
        context
      );

      expect(result).toMatchObject({
        result_class: 'rejected',
        failure: {
          code: 'ocr_permission_required',
          retryable: false,
        },
      });
      expect(result.output_hash).toBeUndefined();
      expect(result.receipt_id).toBeUndefined();
      expect(result.receipt).toBeUndefined();
      expect(result.verification).toBeUndefined();
    }, 30_000);
  }
);
