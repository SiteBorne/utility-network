/**
 * SUN-1221C — the production executor for `web_context_verified.v2` / CDP,
 * mirroring `verify-agent-output-v2-production-executor.ts`'s exact
 * pattern: a real (`execution_mode: 'live'`) `ServiceExecutionContext`
 * calling `executeLocalService` against the real, unmodified
 * `WebContextVerifiedService` -- never `buildFixtureRegistry`, never a
 * canned/fake `InjectedHttpClient`.
 *
 * `WebContextVerifiedService` also needs a `PublicHttpAdapter` and its own
 * `httpClient` reference (SUN-1221B §4/§10) -- both constructed here from
 * the SAME injected, DNS-rebinding-safe `InjectedHttpClient`
 * (`SafeSocketHttpClient`, built by the caller and passed in) so every
 * outbound fetch this service ever makes goes through the safe
 * resolve-validate-connect pipeline, never the raw platform `fetch()`.
 *
 * `context.artifact_store` is required by the `ServiceExecutionContext`
 * type but never invoked by `WebContextVerifiedService` (confirmed by
 * direct source inspection during SUN-1221B/C: the service builds its PCC
 * document and signs a receipt without touching artifact storage) -- the
 * stub below throws on any actual call, deliberately, matching verify's
 * own `unreachableArtifactStore` pattern: stricter than a silent no-op,
 * so any future dependency change surfaces loudly instead of "working"
 * against unvalidated fake semantics.
 */
import {
  buildServiceContext,
  DEFAULT_SERVICE_BUDGET,
  executeLocalService,
  ServiceRegistry,
  WebContextVerifiedService,
  type ServiceAuditEventSink,
} from '@siteborne/service-runtime';
import { PublicHttpAdapter } from '@siteborne/provider-adapters';
import type {
  ArtifactStore,
  AuditEventSink,
  InjectedClock,
  InjectedHttpClient,
} from '@siteborne/provider-adapters';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import type { ServiceExecutor } from '../routes/x402-service';

function unreachableArtifactStore(): ArtifactStore {
  const fail = (method: string) => (): never => {
    throw new Error(
      `unreachable_artifact_store: web_context_verified.v2 does not persist artifacts -- ` +
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

/** No-op for the adapter's own `_auditSink` constructor param --
 * `PublicHttpAdapter`'s constructor explicitly names it `_auditSink`
 * (underscore-prefixed, never referenced by the constructor body, same
 * documented no-op pattern `adapter-context.ts` already covers for its
 * rate limiter). A real, functioning (if discarded) implementation of
 * the full interface -- not a partial/fake stub. */
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
 * DNS-rebinding-safe `httpClient` are what actually govern real vs.
 * fixture behavior here.
 */
export function buildWebContextV2ProductionExecutor(
  signer: Signer,
  keyRegistry: KeyRegistry,
  httpClient: InjectedHttpClient
): ServiceExecutor {
  return async (input, ctx) => {
    const clock = realClock();
    const context = buildServiceContext('web_context_verified.v2', {
      job_id: ctx.job_id,
      request_id: ctx.request_id,
      clock,
      artifact_store: unreachableArtifactStore(),
      audit: requestScopedAuditSink(),
      budget: DEFAULT_SERVICE_BUDGET,
      execution_mode: 'live',
    });

    const publicHttp = new PublicHttpAdapter(
      httpClient,
      clock,
      unreachableArtifactStore(),
      unusedAuditSink()
    );

    const registry = new ServiceRegistry();
    registry.register({
      serviceId: 'web_context_verified.v2',
      contractRelease: '2.0.0',
      productionEnabled: false,
      service: new WebContextVerifiedService({ httpClient, publicHttp, signer, keyRegistry }),
      implementationVersion: '0.1.0',
      inputSchemaHash: 'sha256:' + '3'.repeat(64),
      outputSchemaHash: 'sha256:' + '4'.repeat(64),
      implementationStatus: 'local_fixture_verified',
    });

    const result = await executeLocalService(registry, 'web_context_verified.v2', input, context);
    return { result };
  };
}
