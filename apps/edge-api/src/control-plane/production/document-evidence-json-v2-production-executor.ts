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
import type { D1Database } from '@cloudflare/workers-types';
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
import type {
  DocumentWorkerBridge,
  DocumentWorkerRequest,
  WorkerResult,
} from '@siteborne/service-runtime';
import type { ServiceExecutor } from '../routes/x402-service';
import { toExecutorOutcomeResult } from './finalized-outcome';
import type { ArtifactStore as EdgeApiArtifactStore } from '../artifacts/store';
import { D1ArtifactsRepository } from '../repositories/d1/artifacts';
import { isAllowedMediaType } from '../artifacts/document-upload';

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
interface UploadReferenceShape {
  upload_id?: unknown;
  media_type?: unknown;
  size_bytes?: unknown;
  content_hash?: unknown;
}

interface DocumentInputShape {
  artifact_reference?: unknown;
  upload_reference?: UploadReferenceShape;
}

/**
 * SUN-1222B-S3-R2 — resolves `input.upload_reference` (the buyer-facing
 * capability minted by `POST /v2/artifacts/documents`) into bytes, WITHOUT
 * ever modifying `DocumentEvidenceJsonService` itself (see this file's own
 * top-of-file doc comment for why: `service.ts` is D1-agnostic/portable by
 * design, and this is the layer that already knows about D1/R2).
 *
 * Returns `{ rejected: reason }` for anything that fails deterministically
 * BEFORE the (expensive, billable) Modal worker is ever invoked — missing
 * reference, expired, or a declared media_type/size_bytes/content_hash
 * that disagrees with what was actually stored (§24 pre-economic
 * validation, §11 buyer-declared dimensions are never trusted on their
 * own). Returns `{ bytes, mediaType }` on success — the caller substitutes
 * these into an ordinary `artifact_reference`-shaped input so
 * `service.ts`'s existing, unmodified code path runs unchanged from here.
 */
async function resolveUploadReference(
  ref: UploadReferenceShape,
  db: D1Database,
  edgeApiArtifactStore: EdgeApiArtifactStore,
  nowMs: number
): Promise<{ rejected: string } | { bytes: Uint8Array; mediaType: string; uploadId: string }> {
  const uploadId = typeof ref.upload_id === 'string' ? ref.upload_id : undefined;
  if (!uploadId) {
    return { rejected: 'upload_reference.upload_id was missing or not a string' };
  }

  const repo = new D1ArtifactsRepository(db);
  const looked = await repo.getById(uploadId);
  if (!looked.ok) {
    return { rejected: `artifact metadata lookup failed: ${looked.error.message}` };
  }
  const record = looked.value;
  if (!record) {
    return { rejected: `no artifact was found for upload_id "${uploadId}"` };
  }
  if (record.expires_at && new Date(record.expires_at).getTime() <= nowMs) {
    return { rejected: `artifact "${uploadId}" expired at ${record.expires_at}` };
  }

  const declaredMediaType = typeof ref.media_type === 'string' ? ref.media_type : undefined;
  const declaredSizeBytes = typeof ref.size_bytes === 'number' ? ref.size_bytes : undefined;
  const declaredHash = typeof ref.content_hash === 'string' ? ref.content_hash : undefined;

  if (declaredMediaType !== undefined && declaredMediaType !== record.media_type) {
    return {
      rejected:
        `upload_reference.media_type "${declaredMediaType}" does not match the stored ` +
        `artifact's media type`,
    };
  }
  if (declaredSizeBytes !== undefined && declaredSizeBytes !== record.byte_length) {
    return {
      rejected:
        `upload_reference.size_bytes ${declaredSizeBytes} does not match the stored ` +
        `artifact's byte length`,
    };
  }
  if (declaredHash !== undefined && declaredHash !== record.content_hash) {
    return {
      rejected: `upload_reference.content_hash does not match the stored artifact's content hash`,
    };
  }
  if (!isAllowedMediaType(record.media_type)) {
    return { rejected: `stored artifact has an unsupported media type "${record.media_type}"` };
  }

  const bytes = await edgeApiArtifactStore.getContentByContentHash(record.content_hash);
  if (!bytes) {
    return {
      rejected: `artifact "${uploadId}" metadata exists but its content is missing from storage`,
    };
  }
  return { bytes, mediaType: record.media_type, uploadId };
}

export function buildDocumentEvidenceJsonV2ProductionExecutor(
  signer: Signer,
  keyRegistry: KeyRegistry,
  worker: DocumentWorkerBridge,
  edgeApiArtifactStore: EdgeApiArtifactStore,
  db: D1Database
): ServiceExecutor {
  return async (rawInput, ctx) => {
    const clock = realClock();

    // §22: this resolution step performs zero Modal/payment-verify/PCC/
    // settlement calls — only a D1 read and, on success, one R2 read.
    let input = rawInput as DocumentInputShape;
    // Narrow `ArtifactStore` (the shape `ServiceExecutionContext` expects)
    // built directly, not by spreading `edgeApiArtifactStore` — spreading a
    // class instance copies only its own enumerable properties, not
    // `R2ArtifactStoreAdapter`/`InMemoryArtifactStore`'s prototype methods,
    // which would silently drop `put`/`getMetadata`/`exists`'s real
    // implementations (currently unreachable here regardless, but building
    // the narrow shape explicitly keeps that true by construction, not by
    // accident of which methods happen to be called).
    let resolvedArtifactStore: ArtifactStore = serviceRuntimeArtifactStore(edgeApiArtifactStore);
    if (!input?.artifact_reference && input?.upload_reference) {
      const resolved = await resolveUploadReference(
        input.upload_reference,
        db,
        edgeApiArtifactStore,
        clock.nowMs()
      );
      if ('rejected' in resolved) {
        return {
          result: {
            result_class: 'rejected',
            service_id: 'document_evidence_json.v2',
            service_version: 'v2',
            contract_release: '2.0.0',
            request_id: ctx.request_id,
            job_id: ctx.job_id,
            input_hash:
              'sha256:' +
              (await crypto.subtle
                .digest('SHA-256', new TextEncoder().encode(JSON.stringify(rawInput)))
                .then((d) =>
                  Array.from(new Uint8Array(d))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('')
                )),
            warnings: [],
            limitations: [resolved.rejected],
            audit_references: [],
            metrics: {
              elapsed_ms: 0,
              dependency_calls: 0,
              claims_produced: 0,
              evidence_produced: 0,
              output_bytes: 0,
            },
            failure: {
              code: 'upload_reference_unresolved',
              message: resolved.rejected,
              retryable: false,
            },
          },
        };
      }
      // A synthetic single-use store: `service.ts` calls `getContent` with
      // exactly `input.artifact_reference.artifact_id`, which we set to
      // the buyer-facing upload_id below — so the receipt/evidence
      // (`subject.canonical_name`, `sourceUri: artifact://...`) show the
      // capability the buyer actually holds, never the internal R2 key
      // (§34). Only `getContent(uploadId)` is ever reachable from here.
      // Built directly against the narrow `ArtifactStore` shape (not
      // `EdgeApiArtifactStore`) — this in-memory single-key lookup is the
      // real, final store; there is no richer interface to preserve.
      const preResolvedBytes = resolved.bytes;
      const resolvedUploadId = resolved.uploadId;
      const fail = (method: string) => (): never => {
        throw new Error(
          `document_evidence_json.v2_upload_artifact_store_unreachable: ${method} should never be ` +
            `called on the single-use resolved-upload store`
        );
      };
      resolvedArtifactStore = {
        getContent: async (id: string) => (id === resolvedUploadId ? preResolvedBytes : null),
        put: fail('put'),
        getMetadata: fail('getMetadata'),
        exists: fail('exists'),
      };
      input = {
        ...input,
        upload_reference: undefined,
        artifact_reference: {
          artifact_id: resolvedUploadId,
          media_type: resolved.mediaType,
          size_bytes: preResolvedBytes.length,
        },
      };
    }

    const context = buildServiceContext('document_evidence_json.v2', {
      job_id: ctx.job_id,
      request_id: ctx.request_id,
      clock,
      artifact_store: resolvedArtifactStore,
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

    const result = await executeLocalService(registry, 'document_evidence_json.v2', input, context);

    if (result.result_class !== 'success') {
      return toExecutorOutcomeResult(result);
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
      ...toExecutorOutcomeResult(result),
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
