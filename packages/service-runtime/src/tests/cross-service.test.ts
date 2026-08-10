import { describe, expect, it, beforeAll } from 'vitest';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import { buildFixtureRegistry } from '../wiring';
import { executeLocalService } from '../dispatcher';
import {
  FixtureDocumentWorkerBridge,
  registerFixtureScenario,
} from '../services/document-evidence/worker-bridge';
import type { WorkerResult } from '../services/document-evidence/worker-result-types';
import {
  buildTestServiceContext,
  createFixtureSigner,
  jsonHttpClient,
  loadAdapterFixture,
  textHttpClient,
} from './support';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKER_FIXTURES_DIR = fileURLToPath(
  new URL('../../fixtures/document-worker-results', import.meta.url)
);
function loadWorkerResult(name: string): WorkerResult {
  return JSON.parse(readFileSync(`${WORKER_FIXTURES_DIR}/${name}.json`, 'utf-8')) as WorkerResult;
}

describe('Cross-service invariants', () => {
  let signer: Signer;
  let keyRegistry: KeyRegistry;
  beforeAll(async () => {
    ({ signer, registry: keyRegistry } = await createFixtureSigner());
  });

  it('every registered service reports production_enabled: false', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    registerFixtureScenario(new Uint8Array([1]), 'native');
    const worker = new FixtureDocumentWorkerBridge(
      new Map([['native', loadWorkerResult('native-text-success')]])
    );
    const registry = buildFixtureRegistry({
      httpClient: jsonHttpClient({}),
      context,
      worker,
      signer,
      keyRegistry,
    });

    for (const entry of registry.list()) {
      expect(entry.productionEnabled).toBe(false);
    }
    expect(registry.list()).toHaveLength(4);
  });

  it('an unknown service_id fails closed through the shared dispatcher regardless of which registry built it', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const worker = new FixtureDocumentWorkerBridge(new Map());
    const registry = buildFixtureRegistry({
      httpClient: jsonHttpClient({}),
      context,
      worker,
      signer,
      keyRegistry,
    });
    const result = await executeLocalService(registry, 'not_a_real_service.v1', {}, context);
    expect(result.result_class).toBe('rejected');
  });

  it('mutating a successful service output changes its output_hash (receipt binding is content-sensitive)', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient(loadAdapterFixture('sec-edgar/submissions-success.json'));
    const worker = new FixtureDocumentWorkerBridge(new Map());
    const registry = buildFixtureRegistry({ httpClient, context, worker, signer, keyRegistry });

    const resultA = await executeLocalService(
      registry,
      'company_evidence_graph.v1',
      {
        identifiers: { cik: '0000320193' },
        requested_field_groups: ['identity', 'sec_submissions'],
      },
      context
    );
    const resultB = await executeLocalService(
      registry,
      'company_evidence_graph.v1',
      { identifiers: { cik: '0000320193' }, requested_field_groups: ['identity'] },
      context
    );

    expect(resultA.output_hash).not.toBe(resultB.output_hash);
  });

  it('each service produces a distinct output_hash namespace even given structurally similar inputs (no accidental cross-service ID collision)', async () => {
    const context1 = await buildTestServiceContext('web_context_verified.v1');
    const context2 = await buildTestServiceContext('verify_agent_output.v1');
    const worker = new FixtureDocumentWorkerBridge(new Map());
    const registryA = buildFixtureRegistry({
      httpClient: textHttpClient('<html></html>'),
      context: context1,
      worker,
      signer,
      keyRegistry,
    });
    const registryB = buildFixtureRegistry({
      httpClient: jsonHttpClient({}),
      context: context2,
      worker,
      signer,
      keyRegistry,
    });

    const webResult = await executeLocalService(
      registryA,
      'web_context_verified.v1',
      { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
      context1
    );
    const agentResult = await executeLocalService(
      registryB,
      'verify_agent_output.v1',
      {
        verification_contract: { claims: [], deterministic_requirements: [] },
        candidate_output: {},
        required_schema: {},
        verification_mode: 'standard',
      },
      context2
    );

    expect(webResult.service_id).toBe('web_context_verified.v1');
    expect(agentResult.service_id).toBe('verify_agent_output.v1');
    expect(webResult.output_hash).not.toBe(agentResult.output_hash);
  });
});
