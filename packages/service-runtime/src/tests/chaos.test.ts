import { describe, expect, it, beforeAll } from 'vitest';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import { SecSubmissionsAdapter, PublicHttpAdapter } from '@siteborne/provider-adapters';
import type {
  AuditEventSink as AdapterAuditEventSink,
  InjectedHttpClient,
} from '@siteborne/provider-adapters';
import { ServiceRegistry } from '../registry';
import { executeLocalService } from '../dispatcher';
import { CompanyEvidenceGraphService } from '../services/company-evidence/service';
import { DocumentEvidenceJsonService } from '../services/document-evidence/service';
import type { DocumentWorkerBridge } from '../services/document-evidence/worker-bridge';
import { buildTestServiceContext, createFixtureSigner } from './support';

const noopAdapterAudit: AdapterAuditEventSink = { async log() {}, getEvents: () => [], clear() {} };

const throwingHttpClient: InjectedHttpClient = {
  async fetch() {
    throw new Error('simulated network failure');
  },
};

describe('Chaos: dependency/internal failures never produce a false success', () => {
  let signer: Signer;
  let keyRegistry: KeyRegistry;
  beforeAll(async () => {
    ({ signer, registry: keyRegistry } = await createFixtureSigner());
  });

  it('an adapter that throws during company_evidence_graph.v1 never crashes the dispatcher and never returns success', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1', {
      budget: {
        totalTimeoutMs: 2000,
        maxDependencyCalls: 20,
        maxArtifacts: 20,
        maxClaims: 200,
        maxEvidenceItems: 200,
        maxResultBytes: 5_000_000,
      },
    });
    const service = new CompanyEvidenceGraphService({
      httpClient: throwingHttpClient,
      secSubmissions: new SecSubmissionsAdapter(
        throwingHttpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      publicHttp: new PublicHttpAdapter(
        throwingHttpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      signer,
      keyRegistry,
    });
    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'company_evidence_graph.v1',
      implementationVersion: '0.1.0',
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified',
      productionEnabled: false,
      service,
    });

    const result = await executeLocalService(
      registry,
      'company_evidence_graph.v1',
      { identifiers: { cik: '0000320193' }, requested_field_groups: ['sec_submissions'] },
      context
    );

    expect(result.result_class).not.toBe('success');
  }, 10_000);

  it('a document worker bridge that throws never crashes the dispatcher and never returns success', async () => {
    const context = await buildTestServiceContext('document_evidence_json.v1');
    const throwingWorker: DocumentWorkerBridge = {
      async run() {
        throw new Error('simulated worker crash');
      },
    };
    await context.artifact_store.put(
      {
        id: 'doc/x.pdf',
        contentHash: 'sha256:' + '0'.repeat(64),
        media_type: 'application/pdf',
        byte_length: 3,
      },
      new Uint8Array([1, 2, 3])
    );
    const service = new DocumentEvidenceJsonService({
      worker: throwingWorker,
      signer,
      keyRegistry,
    });
    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'document_evidence_json.v1',
      implementationVersion: '0.1.0',
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified',
      productionEnabled: false,
      service,
    });

    const result = await executeLocalService(
      registry,
      'document_evidence_json.v1',
      {
        artifact_reference: {
          artifact_id: 'doc/x.pdf',
          media_type: 'application/pdf',
          size_bytes: 3,
        },
      },
      context
    );

    expect(result.result_class).toBe('internal_verification_failed');
    expect(result.failure?.code).toBe('internal_error');
  });

  it('a signer that always fails never produces a success result with a fabricated receipt_id', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const failingSigner: Signer = {
      keyId: 'kid_' + '0'.repeat(24),
      privateKey: new Uint8Array(31),
    }; // wrong length -> @noble/ed25519 signAsync throws
    const service = new CompanyEvidenceGraphService({
      httpClient: {
        async fetch() {
          return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
      secSubmissions: new SecSubmissionsAdapter(
        {
          async fetch() {
            return new Response('{}');
          },
        },
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      publicHttp: new PublicHttpAdapter(
        {
          async fetch() {
            return new Response('{}');
          },
        },
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      signer: failingSigner,
      keyRegistry,
    });
    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'company_evidence_graph.v1',
      implementationVersion: '0.1.0',
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified',
      productionEnabled: false,
      service,
    });

    const result = await executeLocalService(
      registry,
      'company_evidence_graph.v1',
      { company_name: 'Acme', requested_field_groups: [] },
      context
    );

    expect(result.result_class).not.toBe('success');
    expect(result.receipt_id).toBeUndefined();
  });
});
