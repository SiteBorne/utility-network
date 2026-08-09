/**
 * Local timing benchmark for each of the four services (no network, no
 * subprocess for the default set — the document-worker benchmarks use the
 * captured-fixture bridge, matching the discipline in
 * packages/verification/scripts/benchmark.ts). Never calls a live SEC
 * endpoint and never claims production latency.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecSubmissionsAdapter, PublicHttpAdapter } from '@siteborne/provider-adapters';
import type {
  AuditEventSink as AdapterAuditEventSink,
  InjectedHttpClient,
} from '@siteborne/provider-adapters';
import { generateTestKeypair, KeyRegistry, type Signer } from '@siteborne/verification';
import { CompanyEvidenceGraphService } from '../src/services/company-evidence/service';
import { WebContextVerifiedService } from '../src/services/web-context/service';
import { DocumentEvidenceJsonService } from '../src/services/document-evidence/service';
import {
  FixtureDocumentWorkerBridge,
  registerFixtureScenario,
} from '../src/services/document-evidence/worker-bridge';
import type { WorkerResult } from '../src/services/document-evidence/worker-result-types';
import { VerifyAgentOutputService } from '../src/services/agent-verification/service';
import {
  buildServiceContext,
  createTestArtifactStore,
  createTestClock,
  createTestServiceAuditSink,
} from '../src/context';
import { deterministicId } from '../src/pcc/ids';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const noopAdapterAudit: AdapterAuditEventSink = { async log() {}, getEvents: () => [], clear() {} };
const ITERATIONS = 50;

function jsonHttpClient(body: unknown): InjectedHttpClient {
  return {
    async fetch() {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}
function loadAdapterFixture(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(
      join(REPO_ROOT, 'packages', 'provider-adapters', 'fixtures', relativePath),
      'utf-8'
    )
  );
}
function loadWorkerResult(name: string): WorkerResult {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'document-worker-results', `${name}.json`), 'utf-8')
  ) as WorkerResult;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function timeIt(label: string, run: () => Promise<unknown>): Promise<void> {
  const durations: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await run();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  console.log(
    `${label} (${ITERATIONS} iterations): p50=${percentile(durations, 50).toFixed(2)}ms p95=${percentile(durations, 95).toFixed(2)}ms max=${durations[durations.length - 1]!.toFixed(2)}ms`
  );
}

async function main(): Promise<void> {
  const keypair = await generateTestKeypair(deterministicId('kid', 'service-runtime-benchmark'));
  const registry = new KeyRegistry();
  registry.register({
    key_id: keypair.keyId,
    algorithm: 'Ed25519',
    public_key: keypair.publicKey,
    status: 'active',
    valid_from: '2026-01-01T00:00:00Z',
    purpose: 'service_runtime_fixture_receipt',
    environment: 'test',
  });
  const signer: Signer = { keyId: keypair.keyId, privateKey: keypair.privateKey };

  await timeIt('company_evidence_graph.v1 (fixture SEC submissions)', async () => {
    const context = buildServiceContext('company_evidence_graph.v1', {
      clock: createTestClock(),
      artifact_store: createTestArtifactStore(),
      audit: createTestServiceAuditSink(),
      execution_mode: 'fixture',
    });
    const httpClient = jsonHttpClient(loadAdapterFixture('sec-edgar/submissions-success.json'));
    const service = new CompanyEvidenceGraphService({
      httpClient,
      secSubmissions: new SecSubmissionsAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      publicHttp: new PublicHttpAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      signer,
    });
    return service.execute(
      {
        identifiers: { cik: '0000320193' },
        requested_field_groups: ['identity', 'sec_submissions'],
      },
      context
    );
  });

  await timeIt('web_context_verified.v1 (direct mode, fixture page)', async () => {
    const context = buildServiceContext('web_context_verified.v1', {
      clock: createTestClock(),
      artifact_store: createTestArtifactStore(),
      audit: createTestServiceAuditSink(),
      execution_mode: 'fixture',
    });
    const httpClient: InjectedHttpClient = {
      async fetch() {
        return new Response(
          '<html><head><title>Benchmark</title></head><body>content</body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      },
    };
    const service = new WebContextVerifiedService({
      httpClient,
      publicHttp: new PublicHttpAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      signer,
    });
    return service.execute(
      { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
      context
    );
  });

  await timeIt('document_evidence_json.v1 (native-text, captured SUN-0400A fixture)', async () => {
    const context = buildServiceContext('document_evidence_json.v1', {
      clock: createTestClock(),
      artifact_store: createTestArtifactStore(),
      audit: createTestServiceAuditSink(),
      execution_mode: 'fixture',
    });
    const worker = loadWorkerResult('native-text-success');
    const bytes = registerFixtureScenario(new Uint8Array([1]), 'bench-native');
    await context.artifact_store.put(
      {
        id: 'doc/bench.pdf',
        contentHash: worker.document!.sha256,
        media_type: 'application/pdf',
        byte_length: bytes.length,
      },
      bytes
    );
    const service = new DocumentEvidenceJsonService({
      worker: new FixtureDocumentWorkerBridge(new Map([['bench-native', worker]])),
      signer,
    });
    return service.execute(
      {
        artifact_reference: {
          artifact_id: 'doc/bench.pdf',
          media_type: 'application/pdf',
          size_bytes: bytes.length,
        },
      },
      context
    );
  });

  await timeIt('verify_agent_output.v1 (standard mode)', async () => {
    const context = buildServiceContext('verify_agent_output.v1', {
      clock: createTestClock(),
      artifact_store: createTestArtifactStore(),
      audit: createTestServiceAuditSink(),
      execution_mode: 'fixture',
    });
    const service = new VerifyAgentOutputService({ signer });
    return service.execute(
      {
        verification_contract: {
          claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
          deterministic_requirements: [{ requirement_id: 'schema', check: 'schema_valid' }],
        },
        candidate_output: { total: 42 },
        required_schema: { type: 'object' },
        verification_mode: 'standard',
      },
      context
    );
  });

  console.log('\nAll benchmarks are local-fixture timings, not production latency measurements.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
