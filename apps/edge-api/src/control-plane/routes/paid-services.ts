/**
 * Wires the four frozen SITEBORNE services onto
 * `createX402ServiceRoute` (SUN-0700A checkpoint 5, directive §5). Each
 * service's per-request execution is a small `ServiceExecutor` closure
 * over a shared, module-scope `buildFixtureRegistry` registry (SUN-0600,
 * already accepted) — service execution always goes through
 * `executeLocalService`, never a direct `service.execute()` call
 * (directive §23).
 *
 * Fixture-mode wiring is fixed, canned adapter data (the exact fixtures
 * `packages/service-runtime/scripts/verify-fixtures.ts` already uses for
 * its own accepted `*-success` scenarios) — this checkpoint proves the
 * payment/lifecycle/linkage boundary drives real service execution
 * correctly, not that these four services can process arbitrary live
 * buyer input (that remains each service's own existing, already-proven
 * fixture-mode behavior). `document_evidence_json.v1`'s route therefore
 * only accepts the one pre-seeded fixture artifact reference
 * (`artifact_id: 'doc/native-fixture.pdf'`) — documented in
 * X402_HTTP_VERTICAL_SLICE.md.
 */
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  ALL_BAZAAR_SERVICE_IDS,
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  PAYTO_NOT_CONFIGURED,
  REGISTRY_SERVICES,
} from '@siteborne/protocol-x402';
import {
  NEVERMINED_DECLARATIONS,
  NEVERMINED_ROUTES,
  type NeverminedDelegationLookupClient,
} from '@siteborne/protocol-nevermined';
import { calculateDocumentUsage, documentUsageToAtomicUnits } from '@siteborne/pricing';
import { D1ServicesRepository } from '../repositories/d1/services';
import type { PaymentEvidenceMode, PaymentEvidenceProvider } from '@siteborne/protocol-x402';
import {
  FixtureDocumentWorkerBridge,
  buildFixtureRegistry,
  buildServiceContext,
  createFixtureSigner,
  createTestArtifactStore,
  createTestClock,
  createTestServiceAuditSink,
  executeLocalService,
  registerFixtureScenario,
} from '@siteborne/service-runtime';
import type { ServiceId, WorkerResult } from '@siteborne/service-runtime';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import type { InjectedHttpClient } from '@siteborne/provider-adapters';
// The exact accepted SUN-0300/SUN-0600 fixture
// (packages/service-runtime/scripts/verify-fixtures.ts's
// 'company-identity-exact-cik-sec-submissions' scenario) — real,
// structurally correct SEC EDGAR submissions JSON, never a hand-rolled
// approximation that would only exercise the identity path.
import SEC_EDGAR_FIXTURE from '../../../../../packages/provider-adapters/fixtures/sec-edgar/submissions-success.json' with { type: 'json' };
// The exact accepted SUN-0400A/SUN-0600 fixture
// (packages/service-runtime/scripts/verify-fixtures.ts's
// 'document-native-text-success' scenario) — a real, structurally
// complete WorkerResult, never a hand-rolled approximation missing
// fields the service actually reads.
import DOCUMENT_FIXTURE_WORKER_RESULT_JSON from '../../../../../packages/service-runtime/fixtures/document-worker-results/native-text-success.json' with { type: 'json' };
import { createX402ServiceRoute } from './x402-service';
import type { ExecutorOutcome } from './x402-service';

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

const DOCUMENT_FIXTURE_ARTIFACT_ID = 'doc/native-fixture.pdf';
const DOCUMENT_FIXTURE_BYTES = registerFixtureScenario(new Uint8Array([9]), 'x402-http-native');
const DOCUMENT_FIXTURE_WORKER_RESULT =
  DOCUMENT_FIXTURE_WORKER_RESULT_JSON as unknown as WorkerResult;

/**
 * `jobs.service_id` carries a real `FOREIGN KEY REFERENCES services(id)`
 * (migration 0001) — a job cannot be created until each of the four
 * services has a row. Seeds idempotently (ignores an already-exists
 * error) from `REGISTRY_SERVICES` (checkpoint 4's canonical registry
 * source), never a second hand-typed service list.
 */
async function seedServices(db: D1Database): Promise<void> {
  const repo = new D1ServicesRepository(db);
  for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
    const entry = REGISTRY_SERVICES[serviceId];
    const result = await repo.create({
      service_id: serviceId,
      version: entry.service_version,
      title: entry.title,
      description: entry.description,
      input_schema: entry.input_schema_uri,
      output_schema: entry.output_schema_uri,
      price_usd: entry.maximum_price.amount,
      production_enabled: false,
      production_ready: false,
      protocol_status: 'preproduction',
    });
    if (!result.ok && result.error.code !== 'DUPLICATE_SERVICE') {
      throw new Error(`failed to seed service "${serviceId}": ${result.error.message}`);
    }
  }
}

export interface PaidServicesConfig {
  db: D1Database;
  evidenceMode: PaymentEvidenceMode;
  evidenceProvider?: PaymentEvidenceProvider;
  payTo?: string;
  clock?: () => string;
  /** Internal/additive route-family selector. The public open-route builder
   * defaults to CDP; the Nevermined wrapper below selects its own paths. */
  rail?: 'cdp' | 'nevermined';
  /** Optional, Nevermined-only: enables restart recovery for a payment
   * stuck in `SETTLEMENT_PENDING` (SUN-0900B checkpoint 1B route-recovery
   * wiring). Ignored on the CDP rail. Omitted entirely, recovery on
   * restart is skipped and the pre-existing `202 processing` behavior is
   * unchanged — so every deployment that hasn't supplied one keeps its
   * exact prior behavior. */
  neverminedReconciliationClient?: NeverminedDelegationLookupClient;
}

/**
 * Builds the four paid-service routes on a fresh Hono sub-app. Returns
 * the app rather than mounting on a shared instance directly, so a
 * caller (index.ts) mounts it behind an explicit config gate (directive
 * §6) — this function itself does not decide whether payment execution
 * is reachable in production.
 */
export async function buildPaidServicesApp(config: PaidServicesConfig): Promise<Hono> {
  await seedServices(config.db);
  const app = new Hono();
  const { signer, registry: keyRegistry } = await createFixtureSigner();
  const clock = config.clock ?? (() => new Date().toISOString());
  const rail = config.rail ?? 'cdp';

  function paymentRoute(serviceId: (typeof ALL_BAZAAR_SERVICE_IDS)[number], cdpPath: string) {
    if (rail === 'nevermined') {
      const declaration = NEVERMINED_DECLARATIONS[serviceId];
      return {
        rail,
        network: 'eip155:84532' as const,
        asset: 'nevermined:credits',
        payTo: 'siteborne:nevermined-publisher-not-registered',
        path: NEVERMINED_ROUTES[serviceId],
        nevermined: {
          agentId: declaration.agent.local_agent_id,
          planId: declaration.plan.local_plan_id,
        },
        neverminedReconciliationClient: config.neverminedReconciliationClient,
      };
    }
    return {
      rail,
      network: 'eip155:8453' as const,
      asset: '0xUSDC',
      payTo: config.payTo ?? PAYTO_NOT_CONFIGURED,
      path: cdpPath,
    };
  }

  /** SUN-1000 checkpoint 1M: the four v2 routes are deliberately always
   * CDP — never routed through `paymentRoute()`'s nevermined branch,
   * regardless of this app's configured `rail`. Nevermined-rail v2 must
   * fail closed until Phase 2 binds real, externally-registered v2
   * agent/plan resources (checkpoint 1L section 12); wiring v2 through
   * the shared nevermined branch would let it silently "succeed" against
   * the local-only, unregistered declarations checkpoint 1M's
   * declarations.ts builds for descriptive purposes only. */
  function v2CdpRoute(path: string) {
    return {
      rail: 'cdp' as const,
      network: 'eip155:8453' as const,
      asset: '0xUSDC',
      payTo: config.payTo ?? PAYTO_NOT_CONFIGURED,
      path,
    };
  }

  function freshContext(serviceId: ServiceId) {
    return buildServiceContext(serviceId, {
      clock: createTestClock(),
      artifact_store: createTestArtifactStore(),
      audit: createTestServiceAuditSink(),
      execution_mode: 'fixture',
    });
  }

  // ---- company_evidence_graph.v1 (exact) ----
  createX402ServiceRoute(app, {
    serviceId: 'company_evidence_graph.v1',
    scheme: 'exact',
    pricingKey: 'company_evidence_graph',
    ...paymentRoute('company_evidence_graph.v1', '/v1/company/evidence-graph'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['company_evidence_graph.v1'] as Record<
      string,
      unknown
    >,
    contractRelease: '1.0.0',
    inputSchemaHash: 'sha256:8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
    outputSchemaHash: 'sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
    pccDependency: '1.0.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('company_evidence_graph.v1');
      const httpClient = jsonHttpClient(SEC_EDGAR_FIXTURE);
      const registry = buildFixtureRegistry({
        httpClient,
        context,
        worker: new FixtureDocumentWorkerBridge(new Map()),
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(
        registry,
        'company_evidence_graph.v1',
        input,
        context
      );
      return { result };
    },
  });

  // ---- web_context_verified.v1 (exact) ----
  createX402ServiceRoute(app, {
    serviceId: 'web_context_verified.v1',
    scheme: 'exact',
    pricingKey: 'web_context_verified_direct',
    ...paymentRoute('web_context_verified.v1', '/v1/web/context'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['web_context_verified.v1'] as Record<
      string,
      unknown
    >,
    contractRelease: '1.0.0',
    inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
    outputSchemaHash: 'sha256:7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0',
    pccDependency: '1.0.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('web_context_verified.v1');
      const httpClient: InjectedHttpClient = {
        async fetch() {
          return new Response(
            '<html><head><title>Fixture Page</title></head><body>hello</body></html>',
            { status: 200, headers: { 'content-type': 'text/html' } }
          );
        },
      };
      const registry = buildFixtureRegistry({
        httpClient,
        context,
        worker: new FixtureDocumentWorkerBridge(new Map()),
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(registry, 'web_context_verified.v1', input, context);
      return { result };
    },
  });

  // ---- document_evidence_json.v1 (upto) ----
  createX402ServiceRoute(app, {
    serviceId: 'document_evidence_json.v1',
    scheme: 'upto',
    pricingKey: 'document_evidence_json_max_job',
    ...paymentRoute('document_evidence_json.v1', '/v1/document/evidence-json'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['document_evidence_json.v1'] as Record<
      string,
      unknown
    >,
    contractRelease: '1.0.0',
    inputSchemaHash: 'sha256:19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
    outputSchemaHash: 'sha256:df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde',
    pccDependency: '1.0.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('document_evidence_json.v1');
      // The single fixture artifact this vertical slice's document route
      // accepts (see module doc) — pre-seeded into a fresh artifact
      // store every request, keyed by the same content hash the fixture
      // worker result declares.
      await context.artifact_store.put(
        {
          id: DOCUMENT_FIXTURE_ARTIFACT_ID,
          contentHash: DOCUMENT_FIXTURE_WORKER_RESULT.document!.sha256,
          media_type: 'application/pdf',
          byte_length: DOCUMENT_FIXTURE_BYTES.length,
        },
        DOCUMENT_FIXTURE_BYTES
      );
      const worker = new FixtureDocumentWorkerBridge(
        new Map([['x402-http-native', DOCUMENT_FIXTURE_WORKER_RESULT]])
      );
      const registry = buildFixtureRegistry({
        httpClient: jsonHttpClient({}),
        context,
        worker,
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(
        registry,
        'document_evidence_json.v1',
        input,
        context
      );
      if (result.result_class !== 'success') {
        return { result };
      }
      // Real per-page usage calculation (checkpoint 2's document-usage
      // module) from the fixture worker result's own pages — never a
      // guessed actual amount.
      const usage = calculateDocumentUsage(
        DOCUMENT_FIXTURE_WORKER_RESULT.pages.map((p) => ({
          page_number: p.page_number,
          ocr_used: p.ocr_used,
          table_count: p.tables.length,
        }))
      );
      const actualAmountAtomic = documentUsageToAtomicUnits(usage, 6);
      return {
        result,
        actualAmountAtomic,
        resourceMetrics: {
          page_count: DOCUMENT_FIXTURE_WORKER_RESULT.pages.length,
          pages: DOCUMENT_FIXTURE_WORKER_RESULT.pages.map((page) => ({
            page_number: page.page_number,
            ocr_used: page.ocr_used,
            table_count: page.tables.length,
          })),
          page_costs: usage.page_costs,
          subtotal_usd_micro: usage.subtotal_usd_micro,
          max_job_usd_micro: usage.max_job_usd_micro,
          total_usd_micro: usage.total_usd_micro,
          capped: usage.capped,
        },
      };
    },
  });

  // ---- verify_agent_output.v1 (exact) ----
  createX402ServiceRoute(app, {
    serviceId: 'verify_agent_output.v1',
    scheme: 'exact',
    pricingKey: 'verify_agent_output_standard',
    ...paymentRoute('verify_agent_output.v1', '/v1/verify/agent-output'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['verify_agent_output.v1'] as Record<string, unknown>,
    contractRelease: '1.0.0',
    inputSchemaHash: 'sha256:66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34',
    outputSchemaHash: 'sha256:a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679',
    pccDependency: '1.0.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('verify_agent_output.v1');
      const registry = buildFixtureRegistry({
        httpClient: jsonHttpClient({}),
        context,
        worker: new FixtureDocumentWorkerBridge(new Map()),
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(registry, 'verify_agent_output.v1', input, context);
      return { result };
    },
  });

  // ================================================================
  // SUN-1000 checkpoint 1M — v2 (contract release 2.0.0, checkpoint
  // 1K-B/1L's frozen CONTRACT_2_AND_SERVICE_V2_REQUIRED decision).
  // Identical business logic/executors to their v1 counterparts
  // (checkpoint 1L section 7 — request/success semantics unchanged);
  // only the service-major identity, path, contract release, and the
  // declared 400/402 response contract (packages/pcc-schema/scripts/
  // generate-openapi.ts) differ. Always CDP (v2CdpRoute) — see its own
  // doc comment for why Nevermined-rail v2 is not wired this checkpoint.
  // ================================================================

  // ---- company_evidence_graph.v2 (exact) ----
  createX402ServiceRoute(app, {
    serviceId: 'company_evidence_graph.v2',
    scheme: 'exact',
    pricingKey: 'company_evidence_graph',
    ...v2CdpRoute('/v2/company/evidence-graph'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['company_evidence_graph.v2'] as Record<
      string,
      unknown
    >,
    contractRelease: '2.0.0',
    inputSchemaHash: 'sha256:8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
    outputSchemaHash: 'sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
    pccDependency: '1.1.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('company_evidence_graph.v2');
      const httpClient = jsonHttpClient(SEC_EDGAR_FIXTURE);
      const registry = buildFixtureRegistry({
        httpClient,
        context,
        worker: new FixtureDocumentWorkerBridge(new Map()),
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(
        registry,
        'company_evidence_graph.v2',
        input,
        context
      );
      return { result };
    },
  });

  // ---- web_context_verified.v2 (exact) ----
  createX402ServiceRoute(app, {
    serviceId: 'web_context_verified.v2',
    scheme: 'exact',
    pricingKey: 'web_context_verified_direct',
    ...v2CdpRoute('/v2/web/context'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['web_context_verified.v2'] as Record<
      string,
      unknown
    >,
    contractRelease: '2.0.0',
    inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
    outputSchemaHash: 'sha256:7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0',
    pccDependency: '1.1.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('web_context_verified.v2');
      const httpClient: InjectedHttpClient = {
        async fetch() {
          return new Response(
            '<html><head><title>Fixture Page</title></head><body>hello</body></html>',
            { status: 200, headers: { 'content-type': 'text/html' } }
          );
        },
      };
      const registry = buildFixtureRegistry({
        httpClient,
        context,
        worker: new FixtureDocumentWorkerBridge(new Map()),
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(registry, 'web_context_verified.v2', input, context);
      return { result };
    },
  });

  // ---- document_evidence_json.v2 (upto) ----
  createX402ServiceRoute(app, {
    serviceId: 'document_evidence_json.v2',
    scheme: 'upto',
    pricingKey: 'document_evidence_json_max_job',
    ...v2CdpRoute('/v2/document/evidence-json'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['document_evidence_json.v2'] as Record<
      string,
      unknown
    >,
    contractRelease: '2.0.0',
    inputSchemaHash: 'sha256:19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
    outputSchemaHash: 'sha256:df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde',
    pccDependency: '1.1.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('document_evidence_json.v2');
      await context.artifact_store.put(
        {
          id: DOCUMENT_FIXTURE_ARTIFACT_ID,
          contentHash: DOCUMENT_FIXTURE_WORKER_RESULT.document!.sha256,
          media_type: 'application/pdf',
          byte_length: DOCUMENT_FIXTURE_BYTES.length,
        },
        DOCUMENT_FIXTURE_BYTES
      );
      const worker = new FixtureDocumentWorkerBridge(
        new Map([['x402-http-native', DOCUMENT_FIXTURE_WORKER_RESULT]])
      );
      const registry = buildFixtureRegistry({
        httpClient: jsonHttpClient({}),
        context,
        worker,
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(
        registry,
        'document_evidence_json.v2',
        input,
        context
      );
      if (result.result_class !== 'success') {
        return { result };
      }
      const usage = calculateDocumentUsage(
        DOCUMENT_FIXTURE_WORKER_RESULT.pages.map((p) => ({
          page_number: p.page_number,
          ocr_used: p.ocr_used,
          table_count: p.tables.length,
        }))
      );
      const actualAmountAtomic = documentUsageToAtomicUnits(usage, 6);
      return {
        result,
        actualAmountAtomic,
        resourceMetrics: {
          page_count: DOCUMENT_FIXTURE_WORKER_RESULT.pages.length,
          pages: DOCUMENT_FIXTURE_WORKER_RESULT.pages.map((page) => ({
            page_number: page.page_number,
            ocr_used: page.ocr_used,
            table_count: page.tables.length,
          })),
          page_costs: usage.page_costs,
          subtotal_usd_micro: usage.subtotal_usd_micro,
          max_job_usd_micro: usage.max_job_usd_micro,
          total_usd_micro: usage.total_usd_micro,
          capped: usage.capped,
        },
      };
    },
  });

  // ---- verify_agent_output.v2 (exact) ----
  createX402ServiceRoute(app, {
    serviceId: 'verify_agent_output.v2',
    scheme: 'exact',
    pricingKey: 'verify_agent_output_standard',
    ...v2CdpRoute('/v2/verify/agent-output'),
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['verify_agent_output.v2'] as Record<string, unknown>,
    contractRelease: '2.0.0',
    inputSchemaHash: 'sha256:66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34',
    outputSchemaHash: 'sha256:a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679',
    pccDependency: '1.1.0',
    db: config.db,
    clock,
    evidenceMode: config.evidenceMode,
    evidenceProvider: config.evidenceProvider,
    executor: async (input): Promise<ExecutorOutcome> => {
      const context = freshContext('verify_agent_output.v2');
      const registry = buildFixtureRegistry({
        httpClient: jsonHttpClient({}),
        context,
        worker: new FixtureDocumentWorkerBridge(new Map()),
        signer,
        keyRegistry,
      });
      const result = await executeLocalService(registry, 'verify_agent_output.v2', input, context);
      return { result };
    },
  });

  return app;
}

export interface NeverminedPaidServicesConfig extends Omit<PaidServicesConfig, 'rail'> {
  evidenceProvider: PaymentEvidenceProvider;
}

/** Exactly four additive Nevermined-only routes, all driven by the same route
 * lifecycle and the same service executors as the accepted CDP family. */
export function buildNeverminedPaidServicesApp(
  config: NeverminedPaidServicesConfig
): Promise<Hono> {
  return buildPaidServicesApp({ ...config, rail: 'nevermined' });
}

export { DOCUMENT_FIXTURE_ARTIFACT_ID };
export type { Signer, KeyRegistry };
