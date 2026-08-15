/**
 * The composition boundary onto SUN-0400A (services/modal-worker). Never
 * reimplements PDF/OCR/table extraction in TypeScript — every
 * implementation of DocumentWorkerBridge either delegates to the real
 * Python worker (SubprocessDocumentWorkerBridge, via the already-existing
 * `local_runner.py` CLI, itself Modal-independent per ADR 0025/0029) or, in
 * tests, replays a WorkerResult captured from a real run of that same CLI
 * (fixtures/document-worker-results/*.json — see
 * scripts/capture-document-worker-fixtures.sh) rather than a hand-authored
 * fake.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerResult } from './worker-result-types';

export interface DocumentWorkerRequest {
  bytes: Uint8Array;
  mediaType: 'application/pdf' | 'image/png' | 'image/jpeg';
  ocrPolicy?: 'always' | 'if_needed' | 'never';
  tablePolicy?: 'extract' | 'skip';
}

export interface DocumentWorkerBridge {
  run(request: DocumentWorkerRequest): Promise<WorkerResult>;
}

const MEDIA_TYPE_EXTENSION: Record<DocumentWorkerRequest['mediaType'], string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

const OCR_POLICY_CLI_VALUE: Record<
  NonNullable<DocumentWorkerRequest['ocrPolicy']>,
  'required' | 'if_needed' | 'forbidden'
> = {
  always: 'required',
  if_needed: 'if_needed',
  never: 'forbidden',
};

/**
 * The production-shaped bridge: writes the artifact to a temp file and
 * shells out to `python -m modal_worker.local_runner`, the same
 * Modal-independent CLI entry point SUN-0400A ships
 * (services/modal-worker/src/modal_worker/local_runner.py). Requires the
 * document-worker's Python venv to exist — not exercised by the fast
 * default `pnpm test` path (see service.subprocess.test.ts, gated on the
 * venv's presence, mirroring provider-adapters' live-gate pattern).
 */
export class SubprocessDocumentWorkerBridge implements DocumentWorkerBridge {
  constructor(
    private readonly pythonExecutable: string,
    private readonly workerCwd: string
  ) {}

  async run(request: DocumentWorkerRequest): Promise<WorkerResult> {
    const dir = await mkdtemp(join(tmpdir(), 'siteborne-document-worker-'));
    const filePath = join(dir, `artifact${MEDIA_TYPE_EXTENSION[request.mediaType]}`);
    try {
      await writeFile(filePath, request.bytes);
      const args = ['-m', 'modal_worker.local_runner', filePath];
      if (request.ocrPolicy) args.push('--ocr-policy', OCR_POLICY_CLI_VALUE[request.ocrPolicy]);
      if (request.tablePolicy) args.push('--table-policy', request.tablePolicy);

      const stdout = await runProcess(this.pythonExecutable, args, this.workerCwd);
      return JSON.parse(stdout) as WorkerResult;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function runProcess(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      // local_runner.py exits 1 on a `failed` WorkerResult, which is a
      // normal, closed outcome (JSON is still on stdout) — only a missing
      // stdout payload is treated as a real invocation failure.
      if (stdout.trim().length > 0) {
        resolve(stdout);
      } else {
        reject(new Error(`document worker subprocess exited ${code}: ${stderr}`));
      }
    });
  });
}

/** Test-only bridge that replays a pre-captured WorkerResult, keyed by a
 * caller-chosen scenario name — never spawns a process, never touches the
 * filesystem beyond what the caller already provided as `bytes`. */
export class FixtureDocumentWorkerBridge implements DocumentWorkerBridge {
  constructor(private readonly fixtureByArtifactId: Map<string, WorkerResult>) {}

  async run(request: DocumentWorkerRequest): Promise<WorkerResult> {
    const key = fixtureKeyForBytes(request.bytes);
    const fixture = this.fixtureByArtifactId.get(key);
    if (!fixture) {
      throw new Error(`FixtureDocumentWorkerBridge has no fixture registered for key "${key}"`);
    }
    return fixture;
  }
}

/** The fixture bridge is keyed by an explicit scenario name registered
 * alongside the bytes (via registerFixture), not by content-hash — content
 * hashing here would just re-derive an identity already available from the
 * artifact_id the caller supplied, adding no value in a test-only path. */
const scenarioKeys = new WeakMap<Uint8Array, string>();

export function registerFixtureScenario(bytes: Uint8Array, scenarioName: string): Uint8Array {
  scenarioKeys.set(bytes, scenarioName);
  return bytes;
}

function fixtureKeyForBytes(bytes: Uint8Array): string {
  const key = scenarioKeys.get(bytes);
  if (!key) throw new Error('bytes were not registered via registerFixtureScenario');
  return key;
}
