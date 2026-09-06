/**
 * SUN-1222B-S3R — the production executor for `company_evidence_graph.v2`
 * / CDP, mirroring `web-context-v2-production-executor.ts`'s exact pattern:
 * a real (`execution_mode: 'live'`) `ServiceExecutionContext` calling
 * `executeLocalService` against the real, unmodified
 * `CompanyEvidenceGraphService` -- never `buildFixtureRegistry`, never a
 * canned/fake `InjectedHttpClient` or `SEC_EDGAR_FIXTURE`.
 *
 * `CompanyEvidenceGraphService` needs `SecSubmissionsAdapter`,
 * `PublicHttpAdapter`, and (optionally) `FederalRegisterAdapter` -- all
 * three constructed here from the SAME injected `httpClient`, exactly as
 * the service's own `deps.httpClient`/`buildAdapterContext` wiring expects
 * (SUN-1222B-S3R root trace: SEC submissions, Federal Register search, and
 * `website_evidence`'s buyer-supplied-URL fetch all go through this one
 * shared client).
 *
 * `website_evidence` fetches an arbitrary buyer-supplied URL
 * (`input.buyer_urls`), the exact same "arbitrary public URL, potentially
 * SSRF-relevant" profile `web_context_verified.v2`'s direct retrieval mode
 * has (SUN-1221E5Q6E/F/G). This executor therefore requires the SAME
 * off-Cloudflare Modal safe-egress `InjectedHttpClient` be injected here,
 * never a raw platform `fetch()` or a direct `cloudflare:sockets` dial --
 * see the composition module's own doc comment for why this reuses the
 * already-deployed `MODAL_WEBCTX_*` endpoint rather than standing up a
 * second, redundant safe-egress deployment for an identical egress need.
 *
 * `context.artifact_store` is required by the `ServiceExecutionContext`
 * type but never invoked by `CompanyEvidenceGraphService` (confirmed by
 * direct source inspection during SUN-1222B-S3R: the service builds its
 * PCC document and signs a receipt without touching artifact storage,
 * exactly like `WebContextVerifiedService`) -- the stub below throws on any
 * actual call, deliberately, matching the established
 * `unreachableArtifactStore` pattern.
 */
import {
  buildServiceContext,
  DEFAULT_SERVICE_BUDGET,
  executeLocalService,
  ServiceRegistry,
  CompanyEvidenceGraphService,
  type ServiceAuditEventSink,
} from '@siteborne/service-runtime';
import {
  PublicHttpAdapter,
  SecSubmissionsAdapter,
  FederalRegisterAdapter,
} from '@siteborne/provider-adapters';
import type {
  ArtifactStore,
  AuditEventSink,
  InjectedClock,
  InjectedHttpClient,
} from '@siteborne/provider-adapters';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import type { D1Database } from '@cloudflare/workers-types';
import type { ServiceExecutor } from '../routes/x402-service';
import { buildSecD1RateCoordinator } from '../rate-limit/sec-d1-rate-coordinator';

function unreachableArtifactStore(): ArtifactStore {
  const fail = (method: string) => (): never => {
    throw new Error(
      `unreachable_artifact_store: company_evidence_graph.v2 does not persist artifacts -- ` +
        `${method} should never be called; a call means the service's dependencies changed ` +
        `since this executor was written and this stub must be replaced with a real store`
    );
  };
  return {
    put: fail('put'),
    getMetadata: fail('getMetadata'),
    getContent: fail('getContent'),
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

/** No-op for the adapters' own `_auditSink` constructor param -- identical
 * documented no-op pattern `web-context-v2-production-executor.ts` already
 * uses for `PublicHttpAdapter`, reused verbatim here for all three
 * provider adapters. */
function unusedAuditSink(): AuditEventSink {
  const events: Array<{
    type: string;
    details: Record<string, unknown>;
    correlationId?: string;
    timestamp: number;
  }> = [];
  return {
    async log(event) {
      events.push({ ...event, timestamp: Date.now() });
    },
    getEvents() {
      return events;
    },
    clear() {
      events.length = 0;
    },
  };
}

/**
 * See `verify-agent-output-v2-production-executor.ts`'s own doc comment
 * for why `productionEnabled: false` / `implementationStatus:
 * 'local_fixture_verified'` below are a permanently-scoped, unrelated
 * SUN-0600 dispatch-registry gate, not a statement that this execution is
 * a fixture. `context.execution_mode: 'live'`, the real signer, and the
 * Modal-safe-egress `httpClient` are what actually govern real vs. fixture
 * behavior here.
 */
export function buildCompanyEvidenceGraphV2ProductionExecutor(
  signer: Signer,
  keyRegistry: KeyRegistry,
  httpClient: InjectedHttpClient,
  db: D1Database
): ServiceExecutor {
  return async (input, ctx) => {
    const clock = realClock();
    const context = buildServiceContext('company_evidence_graph.v2', {
      job_id: ctx.job_id,
      request_id: ctx.request_id,
      clock,
      artifact_store: unreachableArtifactStore(),
      audit: requestScopedAuditSink(),
      budget: DEFAULT_SERVICE_BUDGET,
      execution_mode: 'live',
    });

    // SUN-1222C2-Q1-R2: a real, D1-backed, cross-isolate aggregate rate
    // coordinator against SEC's own published fair-access ceiling --
    // see sec-d1-rate-coordinator.ts's own doc comment for the full
    // coordination-scope analysis. `db` is already this route's own
    // required dependency (buildCompanyEvidenceGraphV2CdpProductionRouteConfig
    // 404s without it) -- no new binding introduced.
    const secSubmissions = new SecSubmissionsAdapter(
      httpClient,
      clock,
      unreachableArtifactStore(),
      unusedAuditSink(),
      buildSecD1RateCoordinator(db)
    );
    const publicHttp = new PublicHttpAdapter(
      httpClient,
      clock,
      unreachableArtifactStore(),
      unusedAuditSink()
    );
    const federalRegister = new FederalRegisterAdapter(
      httpClient,
      clock,
      unreachableArtifactStore(),
      unusedAuditSink()
    );

    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'company_evidence_graph.v2',
      contractRelease: '2.0.0',
      productionEnabled: false,
      service: new CompanyEvidenceGraphService({
        httpClient,
        secSubmissions,
        publicHttp,
        federalRegister,
        signer,
        keyRegistry,
      }),
      implementationVersion: '0.1.0',
      inputSchemaHash: 'sha256:' + '8'.repeat(64),
      outputSchemaHash: 'sha256:' + '9'.repeat(64),
      implementationStatus: 'local_fixture_verified',
    });

    const result = await executeLocalService(registry, 'company_evidence_graph.v2', input, context);
    return { result };
  };
}
