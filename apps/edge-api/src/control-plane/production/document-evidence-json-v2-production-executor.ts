/**
 * SUN-1222B-S3R — the production executor for `document_evidence_json.v2`
 * / CDP, mirroring `company-evidence-graph-v2-production-executor.ts`'s
 * pattern: a real (`execution_mode: 'live'`) `ServiceExecutionContext`
 * calling `executeLocalService` against the real, unmodified
 * `DocumentEvidenceJsonService` -- never `FixtureDocumentWorkerBridge`,
 * never `SubprocessDocumentWorkerBridge` (`node:child_process` does not
 * exist in the Workers runtime).
 *
 * Unlike `company_evidence_graph.v2`/`web_context_verified.v2`,
 * `DocumentEvidenceJsonService.execute` genuinely calls
 * `context.artifact_store.getContent(...)` (SUN-1222B-S3R root trace,
 * `service.ts` line 66) -- the `unreachableArtifactStore` stub those two
 * executors use would make every real request fail. `artifactStore` here
 * is a real, injected R2-backed store (`R2ArtifactStoreAdapter`, already
 * implemented in `../artifacts/store.ts`, previously unused/unwired in
 * production) -- only `getContent` is ever called by this service (root
 * trace confirmed no other method is reachable), so `put`/`getMetadata`/
 * `exists` are stubbed `unreachable`, exactly mirroring the OTHER two
 * executors' own stub for their (genuinely unused) artifact store.
 */
import {
  buildServiceContext,
  DEFAULT_SERVICE_BUDGET,
  executeLocalService,
  ServiceRegistry,
  DocumentEvidenceJsonService,
  type ServiceAuditEventSink,
} from '@siteborne/service-runtime';
import { calculateDocumentUsage, documentUsageToAtomicUnits } from '@siteborne/pricing';
import type { ArtifactStore, InjectedClock } from '@siteborne/provider-adapters';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import type { DocumentWorkerBridge, DocumentWorkerRequest, WorkerResult } from '@siteborne/service-runtime';
import type { ServiceExecutor } from '../routes/x402-service';
import type { ArtifactStore as EdgeApiArtifactStore } from '../artifacts/store';

/**
 * SUN-1222B-S3R — `scheme: 'upto'` (see `x402-service.ts`'s own doc
 * comment) requires the executor to return `actualAmountAtomic`/
 * `resourceMetrics` computed from the REAL worker output's real page
 * metrics -- mirroring `paid-services.ts`'s fixture route exactly
 * (`calculateDocumentUsage`/`documentUsageToAtomicUnits`), just computed
 * from the real `WorkerResult` this wrapper captures rather than
 * `DOCUMENT_FIXTURE_WORKER_RESULT`. `executeLocalService` never exposes
 * the intermediate `WorkerResult` itself (only the final PCC-wrapped
 * extension) -- this thin capturing wrapper is the one place that sees
 * it, without changing `DocumentWorkerBridge`'s own interface or
 * `DocumentEvidenceJsonService`'s composition.
 */
function capturingWorkerBridge(worker: DocumentWorkerBridge): {
  bridge: DocumentWorkerBridge;
  getLastResult: () => WorkerResult | undefined;
} {
  let last: WorkerResult | undefined;
  return {
    bridge: {
      async run(request: DocumentWorkerRequest): Promise<WorkerResult> {
        const result = await worker.run(request);
        last = result;
        return result;
      },
    },
    getLastResult: () => last,
  };
}

/**
 * Adapts edge-api's own richer `ArtifactStore` (`../artifacts/store.ts`,
 * `R2ArtifactStoreAdapter`) to the narrower `@siteborne/provider-adapters`
 * `ArtifactStore` shape `ServiceExecutionContext` expects. Structurally
 * distinct interfaces (different `put`/`getMetadata` signatures) --
 * `getContent(id): Promise<Uint8Array | null>` is identical on both, the
 * only method this service ever calls (see this file's own doc comment),
 * so this wrapper delegates that one real call and throws loudly,
 * deliberately, on the others -- a call to any of them means this
 * service's dependencies changed since this adapter was written.
 */
function serviceRuntimeArtifactStore(edgeApiStore: EdgeApiArtifactStore): ArtifactStore {
  const fail = (method: string) => (): never => {
    throw new Error(
      `document_evidence_json.v2_artifact_store_unreachable: ${method} should never be called -- ` +
        `only getContent is exercised by DocumentEvidenceJsonService.execute (SUN-1222B-S3R root trace); ` +
        `a call means the service's dependencies changed since this adapter was written`
    );
  };
  return {
    getContent: (id: string) => edgeApiStore.getContent(id),
    put: fail('put'),
    getMetadata: fail('getMetadata'),
    exists: fail('exists'),
  };
}

function requestScopedAuditSink(): ServiceAuditEventSink {
  const events: Array<{
    type: string;
    details: Record<string, unknown>;
    correlation_id?: string;
    timestamp: number;
  }> = [];
  return {
    emit(event) {
      events.push({ ...event, timestamp: Date.now() });
    },
    getEvents() {
      return events;
    },
  };
}

function realClock(): InjectedClock {
  const unsupported = (method: string) => (): never => {
    throw new Error(
      `real_clock_cannot_${method}: this is real platform time, not a test/fixture clock`
    );
  };
  return {
    now: () => new Date(),
    nowMs: () => Date.now(),
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    advance: unsupported('advance'),
    setTime: unsupported('setTime'),
    getCurrentTime: () => Date.now(),
  };
}

/**
 * See `verify-agent-output-v2-production-executor.ts`'s own doc comment
 * for why `productionEnabled: false` / `implementationStatus:
 * 'local_fixture_verified'` below are a permanently-scoped, unrelated
 * SUN-0600 dispatch-registry gate. `context.execution_mode: 'live'`, the
 * real signer, the real R2-backed artifact store, and `worker` (the real
 * `ModalDocumentWorkerBridge`, injected by the caller -- never
 * constructed here, so this executor never chooses fixture vs. real) are
 * what actually govern real vs. fixture behavior.
 */
export function buildDocumentEvidenceJsonV2ProductionExecutor(
  signer: Signer,
  keyRegistry: KeyRegistry,
  worker: DocumentWorkerBridge,
  edgeApiArtifactStore: EdgeApiArtifactStore
): ServiceExecutor {
  return async (input, ctx) => {
    const clock = realClock();
    const context = buildServiceContext('document_evidence_json.v2', {
      job_id: ctx.job_id,
      request_id: ctx.request_id,
      clock,
      artifact_store: serviceRuntimeArtifactStore(edgeApiArtifactStore),
      audit: requestScopedAuditSink(),
      budget: DEFAULT_SERVICE_BUDGET,
      execution_mode: 'live',
    });

    const { bridge: capturedWorker, getLastResult } = capturingWorkerBridge(worker);

    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'document_evidence_json.v2',
      contractRelease: '2.0.0',
      productionEnabled: false,
      service: new DocumentEvidenceJsonService({ worker: capturedWorker, signer, keyRegistry }),
      implementationVersion: '0.1.0',
      inputSchemaHash: 'sha256:' + '6'.repeat(64),
      outputSchemaHash: 'sha256:' + '7'.repeat(64),
      implementationStatus: 'local_fixture_verified',
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

    const workerResult = getLastResult();
    if (!workerResult || workerResult.status === 'failed') {
      // executeLocalService reported success without a captured real
      // worker result -- structurally shouldn't happen (the service only
      // reports success after a successful worker.run()). Never guess a
      // price for a real payment: throw rather than fabricate a
      // result_class value or silently charge an unmeasured amount.
      throw new Error(
        'document_evidence_json.v2_usage_measurement_invariant_violated: ' +
          'executeLocalService reported success but no successful WorkerResult was captured'
      );
    }

    const usage = calculateDocumentUsage(
      workerResult.pages.map((p) => ({
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
        page_count: workerResult.pages.length,
        pages: workerResult.pages.map((page) => ({
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
  };
}
