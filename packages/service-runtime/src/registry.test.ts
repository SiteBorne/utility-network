import { describe, expect, it, beforeAll } from 'vitest';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import { ServiceRegistry } from './registry';
import { executeLocalService } from './dispatcher';
import { CompanyEvidenceGraphService } from './services/company-evidence/service';
import { SecSubmissionsAdapter, PublicHttpAdapter } from '@siteborne/provider-adapters';
import type { AuditEventSink as AdapterAuditEventSink } from '@siteborne/provider-adapters';
import { buildTestServiceContext, createFixtureSigner, jsonHttpClient } from './tests/support';

const noopAdapterAudit: AdapterAuditEventSink = { async log() {}, getEvents: () => [], clear() {} };

describe('ServiceRegistry', () => {
  let signer: Signer;
  let keyRegistry: KeyRegistry;
  beforeAll(async () => {
    ({ signer, registry: keyRegistry } = await createFixtureSigner());
  });

  it('rejects registering the same service_id twice', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient({});
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
      keyRegistry,
    });
    const registry = new ServiceRegistry();
    const entry = {
      serviceId: 'company_evidence_graph.v1' as const,
      implementationVersion: '0.1.0',
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified' as const,
      productionEnabled: false as const,
      service,
    };
    registry.register(entry);
    expect(() => registry.register(entry)).toThrowError(/duplicate service registration/);
  });

  it('refuses to register a service with productionEnabled !== false', () => {
    const registry = new ServiceRegistry();
    const invalidEntry = {
      serviceId: 'company_evidence_graph.v1',
      implementationVersion: '0.1.0',
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified',
      productionEnabled: true, // deliberately invalid for the test
      service: {} as never,
    };
    expect(() =>
      registry.register(invalidEntry as unknown as Parameters<typeof registry.register>[0])
    ).toThrowError(/refusing to register/);
  });

  it('lists exactly what was registered', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient({});
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
    expect(registry.list()).toHaveLength(1);
    expect(registry.has('company_evidence_graph.v1')).toBe(true);
    expect(registry.has('not_a_real_service.v1')).toBe(false);
  });
});

describe('executeLocalService (dispatcher)', () => {
  let signer: Signer;
  let keyRegistry: KeyRegistry;
  beforeAll(async () => {
    ({ signer, registry: keyRegistry } = await createFixtureSigner());
  });

  it('fails closed with unknown_service for an unregistered service_id', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const registry = new ServiceRegistry();
    const result = await executeLocalService(registry, 'not_a_real_service.v1', {}, context);
    expect(result.result_class).toBe('rejected');
    expect(result.failure?.code).toBe('unknown_service');
  });

  it('dispatches to a registered service and returns its result unmodified on success', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient({});
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
      { identifiers: { cik: '0000320193' }, requested_field_groups: ['identity'] },
      context
    );
    expect(result.result_class).toBe('success');
  });

  it('converts a service exception into a closed internal_error result rather than throwing', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const throwingService = {
      serviceId: 'company_evidence_graph.v1' as const,
      serviceVersion: 'v1' as const,
      execute: () => {
        throw new Error('boom');
      },
    };
    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'company_evidence_graph.v1',
      implementationVersion: '0.1.0',
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified',
      productionEnabled: false,
      service: throwingService,
    });

    const result = await executeLocalService(registry, 'company_evidence_graph.v1', {}, context);
    expect(result.result_class).toBe('internal_verification_failed');
    expect(result.failure?.code).toBe('internal_error');
  });

  it('converts a service that exceeds the total execution budget into a closed, retryable timeout result', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1', {
      budget: {
        totalTimeoutMs: 10,
        maxDependencyCalls: 20,
        maxArtifacts: 20,
        maxClaims: 200,
        maxEvidenceItems: 200,
        maxResultBytes: 5_000_000,
      },
    });
    const slowService = {
      serviceId: 'company_evidence_graph.v1' as const,
      serviceVersion: 'v1' as const,
      execute: () => new Promise((resolve) => setTimeout(resolve, 200)) as never,
    };
    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'company_evidence_graph.v1',
      implementationVersion: '0.1.0',
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified',
      productionEnabled: false,
      service: slowService,
    });

    const result = await executeLocalService(registry, 'company_evidence_graph.v1', {}, context);
    expect(result.failure?.code).toBe('execution_timeout');
    expect(result.failure?.retryable).toBe(true);
  });
});
