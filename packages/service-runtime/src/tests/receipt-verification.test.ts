/**
 * Establishes, once, for the entire service registry (not per-service),
 * that a successful result's receipt cryptographically verifies through
 * the shared dispatcher boundary — and that no service/dispatcher success
 * can be produced from an invalid or tampered receipt. Uses the same
 * shared `verifyServiceReceipt` boundary as every per-service test (see
 * pcc/receipt-verification.ts) — never a bespoke reimplementation.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Signer, VerificationReceipt } from '@siteborne/verification';
import { buildFixtureRegistry } from '../wiring';
import { executeLocalService } from '../dispatcher';
import { verifyServiceReceipt } from '../pcc';
import {
  FixtureDocumentWorkerBridge,
  registerFixtureScenario,
} from '../services/document-evidence/worker-bridge';
import type { WorkerResult } from '../services/document-evidence/worker-result-types';
import {
  buildTestServiceContext,
  createFixtureSigner,
  jsonHttpClient,
  textHttpClient,
} from './support';
import type { ServiceExecutionContext, ServiceId } from '../types';

const WORKER_FIXTURES_DIR = fileURLToPath(
  new URL('../../fixtures/document-worker-results', import.meta.url)
);
function loadWorkerResult(name: string): WorkerResult {
  return JSON.parse(readFileSync(`${WORKER_FIXTURES_DIR}/${name}.json`, 'utf-8')) as WorkerResult;
}

interface Scenario {
  serviceId: ServiceId;
  build: (signer: Signer) => Promise<{
    input: unknown;
    registry: ReturnType<typeof buildFixtureRegistry>;
    context: ServiceExecutionContext;
  }>;
}

const SCENARIOS: Scenario[] = [
  {
    serviceId: 'company_evidence_graph.v1',
    build: async (signer) => {
      const context = await buildTestServiceContext('company_evidence_graph.v1');
      const httpClient = textHttpClient(
        '<html><head><title>Fixture</title></head><body>hi</body></html>'
      );
      const worker = new FixtureDocumentWorkerBridge(new Map());
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer });
      // website_evidence alone reaches 'complete' status without needing an
      // authoritative CIK (unlike identity/sec_submissions), so the result
      // is a clean 1/1 requested/supported success.
      return {
        input: {
          company_name: 'Acme',
          buyer_urls: ['https://acme.example/'],
          requested_field_groups: ['website_evidence'],
        },
        registry,
        context,
      };
    },
  },
  {
    serviceId: 'web_context_verified.v1',
    build: async (signer) => {
      const context = await buildTestServiceContext('web_context_verified.v1');
      const httpClient = textHttpClient(
        '<html><head><title>Fixture</title></head><body>hi</body></html>'
      );
      const worker = new FixtureDocumentWorkerBridge(new Map());
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer });
      return {
        input: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
        registry,
        context,
      };
    },
  },
  {
    serviceId: 'document_evidence_json.v1',
    build: async (signer) => {
      const context = await buildTestServiceContext('document_evidence_json.v1');
      const httpClient = jsonHttpClient({});
      const workerResult = loadWorkerResult('native-text-success');
      const bytes = registerFixtureScenario(new Uint8Array([9]), 'cross-service-native');
      await context.artifact_store.put(
        {
          id: 'doc/cross.pdf',
          contentHash: workerResult.document!.sha256,
          media_type: 'application/pdf',
          byte_length: bytes.length,
        },
        bytes
      );
      const worker = new FixtureDocumentWorkerBridge(
        new Map([['cross-service-native', workerResult]])
      );
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer });
      return {
        input: {
          artifact_reference: {
            artifact_id: 'doc/cross.pdf',
            media_type: 'application/pdf',
            size_bytes: bytes.length,
          },
        },
        registry,
        context,
      };
    },
  },
  {
    serviceId: 'verify_agent_output.v1',
    build: async (signer) => {
      const context = await buildTestServiceContext('verify_agent_output.v1');
      const httpClient = jsonHttpClient({});
      const worker = new FixtureDocumentWorkerBridge(new Map());
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer });
      return {
        input: {
          verification_contract: {
            claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
            deterministic_requirements: [],
          },
          candidate_output: { total: 42 },
          required_schema: {},
          verification_mode: 'standard',
        },
        registry,
        context,
      };
    },
  },
];

describe('Cross-service receipt cryptographic verification (dispatcher boundary, all 4 registry services)', () => {
  it.each(SCENARIOS)(
    '$serviceId: a deterministic successful fixture produces a receipt that cryptographically verifies',
    async (scenario) => {
      const { signer: fixtureSigner, registry: keyRegistry } = await createFixtureSigner();
      const { input, registry: serviceRegistry, context } = await scenario.build(fixtureSigner);

      const result = await executeLocalService(serviceRegistry, scenario.serviceId, input, context);

      expect(result.result_class).toBe('success');
      expect(result.receipt).toBeDefined();
      const verification = await verifyServiceReceipt({
        receipt: result.receipt as VerificationReceipt,
        keyRegistry,
        expectedServiceId: scenario.serviceId,
        expectedOutputHash: result.output_hash,
      });
      expect(verification.valid).toBe(true);
    }
  );

  it.each(SCENARIOS)(
    '$serviceId: a tampered receipt can never be reported as a valid, successful service result',
    async (scenario) => {
      const { signer: fixtureSigner, registry: keyRegistry } = await createFixtureSigner();
      const { input, registry: serviceRegistry, context } = await scenario.build(fixtureSigner);

      const result = await executeLocalService(serviceRegistry, scenario.serviceId, input, context);
      expect(result.result_class).toBe('success');

      const tampered: VerificationReceipt = {
        ...(result.receipt as VerificationReceipt),
        decision: 'fail',
      };
      const verification = await verifyServiceReceipt({
        receipt: tampered,
        keyRegistry,
        expectedServiceId: scenario.serviceId,
      });
      expect(verification.valid).toBe(false);
      // The dispatcher itself never re-derives result_class from a receipt —
      // result_class already reflects the mesh's own decision at execution
      // time. This asserts the *cryptographic* channel independently detects
      // tampering, which is what a caller must additionally check before
      // trusting a receipt received out-of-band.
    }
  );
});
