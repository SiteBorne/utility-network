/**
 * Establishes, once, for the entire service registry (not per-service),
 * that a successful result's receipt cryptographically verifies through
 * the shared dispatcher boundary — and, more importantly, that the
 * boundary itself (verifyAndSign, called identically by all four
 * services) refuses to let a service report `success` when the receipt it
 * just produced does not cryptographically verify. This is a runtime
 * invariant, not merely a test-time postcondition: `executeLocalService`
 * -> `service.execute` -> `verifyAndSign` -> receipt issuance ->
 * `verifyServiceReceipt` self-check -> only then is `verdict.decision`
 * (which every service's result_class derives from) allowed to stay
 * 'pass'. See docs/decisions/0040-runtime-receipt-verification-boundary.md.
 * Uses the same shared `verifyServiceReceipt` boundary as every
 * per-service test (see pcc/receipt-verification.ts) — never a bespoke
 * reimplementation.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KeyRegistry,
  generateTestKeypair,
  type Signer,
  type VerificationReceipt,
} from '@siteborne/verification';
import { buildFixtureRegistry } from '../wiring';
import { executeLocalService } from '../dispatcher';
import { verifyServiceReceipt } from '../pcc';
import { deterministicId } from '../pcc/ids';
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
  build: (
    signer: Signer,
    keyRegistry: KeyRegistry
  ) => Promise<{
    input: unknown;
    registry: ReturnType<typeof buildFixtureRegistry>;
    context: ServiceExecutionContext;
  }>;
}

const SCENARIOS: Scenario[] = [
  {
    serviceId: 'company_evidence_graph.v1',
    build: async (signer, keyRegistry) => {
      const context = await buildTestServiceContext('company_evidence_graph.v1');
      const httpClient = textHttpClient(
        '<html><head><title>Fixture</title></head><body>hi</body></html>'
      );
      const worker = new FixtureDocumentWorkerBridge(new Map());
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer, keyRegistry });
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
    build: async (signer, keyRegistry) => {
      const context = await buildTestServiceContext('web_context_verified.v1');
      const httpClient = textHttpClient(
        '<html><head><title>Fixture</title></head><body>hi</body></html>'
      );
      const worker = new FixtureDocumentWorkerBridge(new Map());
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer, keyRegistry });
      return {
        input: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
        registry,
        context,
      };
    },
  },
  {
    serviceId: 'document_evidence_json.v1',
    build: async (signer, keyRegistry) => {
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
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer, keyRegistry });
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
    build: async (signer, keyRegistry) => {
      const context = await buildTestServiceContext('verify_agent_output.v1');
      const httpClient = jsonHttpClient({});
      const worker = new FixtureDocumentWorkerBridge(new Map());
      const registry = buildFixtureRegistry({ httpClient, context, worker, signer, keyRegistry });
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
      const {
        input,
        registry: serviceRegistry,
        context,
      } = await scenario.build(fixtureSigner, keyRegistry);

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
      const {
        input,
        registry: serviceRegistry,
        context,
      } = await scenario.build(fixtureSigner, keyRegistry);

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

describe('Runtime receipt-verification boundary: the dispatcher cannot return success for a receipt that fails cryptographic self-verification', () => {
  // Directive seed 1: "signer producing an invalid signature" — the
  // signer's declared keyId matches a real KeyRegistry entry, but the
  // actual private key used to sign is a *different* real Ed25519
  // keypair. issueReceipt() succeeds mechanically (any 32-byte key signs
  // successfully), but the resulting signature does not match the
  // registered public key for that keyId — verifyAndSign's internal
  // self-check (verifyServiceReceipt -> @siteborne/verification's
  // verifyReceipt) must catch this and force verdict.decision to 'fail'
  // *before* the service ever computes a result_class.
  it.each(SCENARIOS)(
    '$serviceId: a signer whose key does not match its declared registry entry never produces success (runtime invalid-signature rejection)',
    async (scenario) => {
      const { signer: correctSigner, registry: keyRegistry } = await createFixtureSigner();
      const otherKeypair = await generateTestKeypair(
        deterministicId('kid', `runtime-boundary-mismatched-signer:${scenario.serviceId}`)
      );
      // Same declared keyId (so the registry lookup succeeds and finds a
      // real, active record) but signs with a different private key — a
      // structurally valid signature that does not verify against that
      // record's public key.
      const mismatchedSigner: Signer = {
        keyId: correctSigner.keyId,
        privateKey: otherKeypair.privateKey,
      };

      const {
        input,
        registry: serviceRegistry,
        context,
      } = await scenario.build(mismatchedSigner, keyRegistry);
      const result = await executeLocalService(serviceRegistry, scenario.serviceId, input, context);

      expect(result.result_class).not.toBe('success');
      expect(result.result_class).toBe('internal_verification_failed');
      expect(JSON.stringify(result.failure?.details ?? '')).toContain(
        'receipt_cryptographic_verification_failed'
      );
    }
  );

  // Directive seed 2: "key registry lacking the signer key" / "wrong key
  // registry" — the signer signs with a real, valid keypair, but the
  // KeyRegistry verifyAndSign checks against is empty, so the runtime
  // self-check cannot find any record for the signing key at all.
  it.each(SCENARIOS)(
    '$serviceId: a key registry that does not contain the signing key never produces success (runtime unknown-key rejection)',
    async (scenario) => {
      const { signer } = await createFixtureSigner();
      const emptyKeyRegistry = new KeyRegistry();

      const {
        input,
        registry: serviceRegistry,
        context,
      } = await scenario.build(signer, emptyKeyRegistry);
      const result = await executeLocalService(serviceRegistry, scenario.serviceId, input, context);

      expect(result.result_class).not.toBe('success');
      expect(result.result_class).toBe('internal_verification_failed');
      expect(JSON.stringify(result.failure?.details ?? '')).toContain(
        'receipt_cryptographic_verification_failed'
      );
    }
  );

  // Seed 3 ("service/context mismatch") is proven at the shared boundary's
  // own unit level in src/pcc/receipt-verification.test.ts ("a wrong
  // expected service_id fails closed", "a wrong expected contract_release
  // fails closed") — the exact same verifyServiceReceipt() function this
  // runtime self-check calls. A genuine *runtime* context mismatch cannot
  // be manufactured through normal service execution: verifyAndSign's
  // self-check derives its expectedServiceId/expectedContractRelease
  // directly from the same candidate that was just signed, so they are
  // self-consistent by construction — divergence would require corrupting
  // internal state between issuance and self-check, which is not a real
  // caller-reachable failure mode.
});
