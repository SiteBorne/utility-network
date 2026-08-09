/**
 * Real end-to-end integration test for SubprocessDocumentWorkerBridge —
 * actually spawns the SUN-0400A Python worker via local_runner.py. Skipped
 * automatically when the document-worker's venv is not present, mirroring
 * packages/provider-adapters' live-gate pattern (opt-in, never a hard
 * dependency of the fast default `pnpm test` path or CI's Node validate
 * job — the Python worker is validated separately by
 * `pnpm document-worker:check` in CI's python-validate job).
 */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SubprocessDocumentWorkerBridge } from './worker-bridge';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const WORKER_CWD = join(REPO_ROOT, 'services', 'modal-worker');
const PYTHON = join(WORKER_CWD, '.venv', 'bin', 'python');
const FIXTURE_PDF = join(WORKER_CWD, 'fixtures', 'pdf', 'native_text_one_page.pdf');

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
  }
);
