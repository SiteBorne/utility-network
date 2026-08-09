/**
 * Assembles the four services into a ServiceRegistry with fixture-mode
 * (never real network/subprocess) dependencies — used by tests,
 * scripts/verify-fixtures.ts, and scripts/benchmark.ts so registry
 * construction isn't duplicated four times.
 */
import { SecSubmissionsAdapter, PublicHttpAdapter } from '@siteborne/provider-adapters';
import type {
  AuditEventSink as AdapterAuditEventSink,
  InjectedHttpClient,
} from '@siteborne/provider-adapters';
import type { ReproductionInput, Signer } from '@siteborne/verification';
import { ServiceRegistry } from './registry';
import { CompanyEvidenceGraphService } from './services/company-evidence/service';
import { WebContextVerifiedService } from './services/web-context/service';
import { DocumentEvidenceJsonService } from './services/document-evidence/service';
import type { DocumentWorkerBridge } from './services/document-evidence/worker-bridge';
import { VerifyAgentOutputService } from './services/agent-verification/service';
import type { ServiceExecutionContext } from './types';

export interface FixtureWiringDeps {
  httpClient: InjectedHttpClient;
  context: ServiceExecutionContext;
  worker: DocumentWorkerBridge;
  signer: Signer;
  reproduction?: ReproductionInput | null;
}

const NOOP_ADAPTER_AUDIT: AdapterAuditEventSink = {
  async log() {},
  getEvents: () => [],
  clear() {},
};
const SCHEMA_HASH_PLACEHOLDER_A = 'sha256:' + '1'.repeat(64);
const SCHEMA_HASH_PLACEHOLDER_B = 'sha256:' + '2'.repeat(64);

export function buildFixtureRegistry(deps: FixtureWiringDeps): ServiceRegistry {
  const registry = new ServiceRegistry();

  registry.register({
    serviceId: 'company_evidence_graph.v1',
    implementationVersion: '0.1.0',
    contractRelease: '1.0.0',
    inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
    outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
    implementationStatus: 'local_fixture_verified',
    productionEnabled: false,
    service: new CompanyEvidenceGraphService({
      httpClient: deps.httpClient,
      secSubmissions: new SecSubmissionsAdapter(
        deps.httpClient,
        deps.context.clock,
        deps.context.artifact_store,
        NOOP_ADAPTER_AUDIT
      ),
      publicHttp: new PublicHttpAdapter(
        deps.httpClient,
        deps.context.clock,
        deps.context.artifact_store,
        NOOP_ADAPTER_AUDIT
      ),
      signer: deps.signer,
    }),
  });

  registry.register({
    serviceId: 'web_context_verified.v1',
    implementationVersion: '0.1.0',
    contractRelease: '1.0.0',
    inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
    outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
    implementationStatus: 'local_fixture_verified',
    productionEnabled: false,
    service: new WebContextVerifiedService({
      httpClient: deps.httpClient,
      publicHttp: new PublicHttpAdapter(
        deps.httpClient,
        deps.context.clock,
        deps.context.artifact_store,
        NOOP_ADAPTER_AUDIT
      ),
      signer: deps.signer,
    }),
  });

  registry.register({
    serviceId: 'document_evidence_json.v1',
    implementationVersion: '0.1.0',
    contractRelease: '1.0.0',
    inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
    outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
    implementationStatus: 'local_fixture_verified',
    productionEnabled: false,
    service: new DocumentEvidenceJsonService({ worker: deps.worker, signer: deps.signer }),
  });

  registry.register({
    serviceId: 'verify_agent_output.v1',
    implementationVersion: '0.1.0',
    contractRelease: '1.0.0',
    inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
    outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
    implementationStatus: 'local_fixture_verified',
    productionEnabled: false,
    service: new VerifyAgentOutputService({ signer: deps.signer, reproduction: deps.reproduction }),
  });

  return registry;
}
