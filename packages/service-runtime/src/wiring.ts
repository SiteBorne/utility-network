/**
 * Assembles the four services into a ServiceRegistry with fixture-mode
 * (never real network/subprocess) dependencies — used by tests,
 * scripts/verify-fixtures.ts, and scripts/benchmark.ts so registry
 * construction isn't duplicated four times.
 */
import {
  SecSubmissionsAdapter,
  PublicHttpAdapter,
  FederalRegisterAdapter,
} from '@siteborne/provider-adapters';
import type {
  AuditEventSink as AdapterAuditEventSink,
  InjectedHttpClient,
} from '@siteborne/provider-adapters';
import type { KeyRegistry, ReproductionInput, Signer } from '@siteborne/verification';
import { ServiceRegistry } from './registry';
import type { RegisteredService } from './registry';
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
  /** The registry `signer`'s key is (or, for a deliberately-broken test
   * fixture, is not) registered in — threaded to every service so
   * verifyAndSign can cryptographically self-verify each receipt before
   * reporting success (see ADR 0040). */
  keyRegistry: KeyRegistry;
  reproduction?: ReproductionInput | null;
}

const NOOP_ADAPTER_AUDIT: AdapterAuditEventSink = {
  async log() {},
  getEvents: () => [],
  clear() {},
};
const SCHEMA_HASH_PLACEHOLDER_A = 'sha256:' + '1'.repeat(64);
const SCHEMA_HASH_PLACEHOLDER_B = 'sha256:' + '2'.repeat(64);

/** Registers one service instance under both its `.v1` and `.v2` registry
 * keys (SUN-1000 checkpoint 1M) — identical business logic per checkpoint
 * 1L's frozen `PREPRODUCTION_V2_REPLACEMENT` decision, so v2 reuses the
 * same instance rather than constructing a second, semantically-duplicate
 * one. `contractRelease` differs per major (v1 stays pinned to its frozen
 * `1.0.0`; v2 declares the new `2.0.0` release) since that field records
 * which contract release governs the request, not the implementation. */
function registerAllMajors(
  registry: ServiceRegistry,
  base: string,
  service: RegisteredService['service'],
  overrides: Pick<
    RegisteredService,
    'implementationVersion' | 'inputSchemaHash' | 'outputSchemaHash' | 'implementationStatus'
  >
): void {
  registry.register({
    serviceId: `${base}.v1` as RegisteredService['serviceId'],
    contractRelease: '1.0.0',
    productionEnabled: false,
    service,
    ...overrides,
  });
  registry.register({
    serviceId: `${base}.v3` as RegisteredService['serviceId'],
    contractRelease: '3.0.0',
    productionEnabled: false,
    service,
    ...overrides,
  });
  registry.register({
    serviceId: `${base}.v2` as RegisteredService['serviceId'],
    contractRelease: '2.0.0',
    productionEnabled: false,
    service,
    ...overrides,
  });
}

export function buildFixtureRegistry(deps: FixtureWiringDeps): ServiceRegistry {
  const registry = new ServiceRegistry();

  registerAllMajors(
    registry,
    'company_evidence_graph',
    new CompanyEvidenceGraphService({
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
      federalRegister: new FederalRegisterAdapter(
        deps.httpClient,
        deps.context.clock,
        deps.context.artifact_store,
        NOOP_ADAPTER_AUDIT
      ),
      signer: deps.signer,
      keyRegistry: deps.keyRegistry,
    }),
    {
      implementationVersion: '0.1.0',
      inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
      outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
      implementationStatus: 'local_fixture_verified',
    }
  );

  registerAllMajors(
    registry,
    'web_context_verified',
    new WebContextVerifiedService({
      httpClient: deps.httpClient,
      publicHttp: new PublicHttpAdapter(
        deps.httpClient,
        deps.context.clock,
        deps.context.artifact_store,
        NOOP_ADAPTER_AUDIT
      ),
      signer: deps.signer,
      keyRegistry: deps.keyRegistry,
    }),
    {
      implementationVersion: '0.1.0',
      inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
      outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
      implementationStatus: 'local_fixture_verified',
    }
  );

  registerAllMajors(
    registry,
    'document_evidence_json',
    new DocumentEvidenceJsonService({
      worker: deps.worker,
      signer: deps.signer,
      keyRegistry: deps.keyRegistry,
    }),
    {
      implementationVersion: '0.1.0',
      inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
      outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
      implementationStatus: 'local_fixture_verified',
    }
  );

  registerAllMajors(
    registry,
    'verify_agent_output',
    new VerifyAgentOutputService({
      signer: deps.signer,
      keyRegistry: deps.keyRegistry,
      reproduction: deps.reproduction,
    }),
    {
      implementationVersion: '0.1.0',
      inputSchemaHash: SCHEMA_HASH_PLACEHOLDER_A,
      outputSchemaHash: SCHEMA_HASH_PLACEHOLDER_B,
      implementationStatus: 'local_fixture_verified',
    }
  );

  return registry;
}
