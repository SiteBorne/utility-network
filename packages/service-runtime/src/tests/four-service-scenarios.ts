/**
 * Deterministic four-service (v2) scenario runner shared by the wire
 * characterization and internal-artifact tests. Callers pin Date/process
 * globals themselves when they need byte-stable output.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import { buildFixtureRegistry } from '../wiring';
import { executeLocalService } from '../dispatcher';
import { buildProductionSigner } from '../pcc';
import { getGovernedMetadata } from '../pcc';
import {
  FixtureDocumentWorkerBridge,
  registerFixtureScenario,
} from '../services/document-evidence/worker-bridge';
import type { WorkerResult } from '../services/document-evidence/worker-result-types';
import { buildTestServiceContext, jsonHttpClient, textHttpClient } from './support';
import type { ServiceExecutionResult, ServiceId } from '../types';

const WORKER_FIXTURES_DIR = fileURLToPath(
  new URL('../../fixtures/document-worker-results', import.meta.url)
);
export const FIXED_TIME = Date.UTC(2026, 8, 1, 12, 0, 0);
export const KEY_HEX = '11'.repeat(32);
export const KEY_ID = 'kid_' + 'a'.repeat(24);

export const FOUR_V2_SERVICES: ServiceId[] = [
  'company_evidence_graph.v2',
  'web_context_verified.v2',
  'document_evidence_json.v2',
  'verify_agent_output.v2',
];

export const FOUR_V3_SERVICES: ServiceId[] = [
  'company_evidence_graph.v3',
  'web_context_verified.v3',
  'document_evidence_json.v3',
  'verify_agent_output.v3',
];

export async function runScenario(
  serviceId: ServiceId,
  options: { verifyExpectedValue?: number; verifyCandidateValue?: number } = {}
): Promise<{ result: ServiceExecutionResult; signer: Signer; keyRegistry: KeyRegistry }> {
  const { signer, registry: keyRegistry } = (await buildProductionSigner(KEY_HEX, KEY_ID)) as {
    signer: Signer;
    registry: KeyRegistry;
  };
  const governed = getGovernedMetadata(serviceId);
  const context = await buildTestServiceContext(serviceId, {
    request_id: 'req-fixed-0001',
    job_id: 'job-fixed-0001',
    ...(serviceId.endsWith('.v3')
      ? {
          contract_release: governed.contractRelease,
          pcc_schema_release: governed.pccSchemaRelease,
          pcc_schema_hash: governed.pccSchemaHash,
          policy_hash: governed.policyHash,
        }
      : {}),
  });
  (context.clock as { setTime(ms: number): void }).setTime(FIXED_TIME);
  const worker = new FixtureDocumentWorkerBridge(new Map());
  let httpClient = textHttpClient(
    '<html><head><title>Fixture</title></head><body>hi</body></html>'
  );
  let input: unknown;
  let registryWorker = worker;
  if (serviceId.startsWith('company')) {
    input = {
      company_name: 'Acme',
      buyer_urls: ['https://acme.example/'],
      requested_field_groups: ['website_evidence'],
    };
  } else if (serviceId.startsWith('web')) {
    input = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
  } else if (serviceId.startsWith('document')) {
    httpClient = jsonHttpClient({});
    const workerResult = JSON.parse(
      readFileSync(`${WORKER_FIXTURES_DIR}/native-text-success.json`, 'utf-8')
    ) as WorkerResult;
    const bytes = registerFixtureScenario(new Uint8Array([9]), 'characterization-native');
    await context.artifact_store.put(
      {
        id: 'doc/char.pdf',
        contentHash: workerResult.document!.sha256,
        media_type: 'application/pdf',
        byte_length: bytes.length,
      },
      bytes
    );
    registryWorker = new FixtureDocumentWorkerBridge(
      new Map([['characterization-native', workerResult]])
    );
    input = {
      artifact_reference: {
        artifact_id: 'doc/char.pdf',
        media_type: 'application/pdf',
        size_bytes: bytes.length,
      },
    };
  } else {
    input = {
      verification_contract: {
        claims: [
          {
            claim_id: 'total',
            predicate: 'equals',
            expected_value: options.verifyExpectedValue ?? 42,
          },
        ],
        deterministic_requirements: [],
      },
      candidate_output: { total: options.verifyCandidateValue ?? 42 },
      required_schema: {},
      verification_mode: 'standard',
    };
  }
  const services = buildFixtureRegistry({
    httpClient,
    context,
    worker: registryWorker,
    signer,
    keyRegistry,
  });
  const result = await executeLocalService(services, serviceId, input, context);
  return { result, signer, keyRegistry };
}
