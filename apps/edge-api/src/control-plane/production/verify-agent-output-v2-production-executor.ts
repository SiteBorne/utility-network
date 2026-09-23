/**
 * SUN-1214 checkpoint T — the production executor for
 * `verify_agent_output.v2` / CDP. Builds a real
 * (`execution_mode: 'live'`) `ServiceExecutionContext` and calls
 * `executeLocalService` against the real, unmodified
 * `VerifyAgentOutputService` -- never `buildFixtureRegistry`, never
 * `createFixtureSigner`, never any test artifact store/audit sink/clock.
 *
 * `context.artifact_store` is still required by the `ServiceExecutionContext`
 * type, but `VerifyAgentOutputService` (and everything it calls: the claim
 * builder, the evidence builder, the PCC construction/signing pipeline)
 * never invokes it -- confirmed by direct source inspection during design
 * (see
 * docs/superpowers/specs/2026-08-22-verify-v2-cdp-production-execution-composition-design.md
 * §2.2/§5.5). Its stub implementation below throws on any actual call,
 * deliberately: this is stricter than a silent in-memory no-op and would
 * surface, loudly and immediately, any future change to
 * `VerifyAgentOutputService` that started depending on it -- catching a
 * real regression instead of letting it silently "work" with unvalidated
 * fake semantics.
 *
 * `context.audit`, by contrast, genuinely IS called -- not by
 * `VerifyAgentOutputService` itself, but by `executeLocalService` (the
 * dispatcher) directly, which unconditionally emits
 * `service_execution_started`/`completed`/`failed` bookkeeping events for
 * every execution regardless of which service runs (discovered by this
 * checkpoint's own TDD process: the differential test failed against a
 * throw-on-use stub, revealing this real dispatcher-level call site this
 * design's source review had not traced). This is a separate,
 * per-execution-scoped channel from the *durable* paid-execution audit
 * trail, which is `x402-service.ts`'s existing `D1AuditRepository` path --
 * unaffected by, and external to, this executor. A real (in-memory,
 * request-scoped, non-durable) sink below satisfies the dispatcher's own
 * bookkeeping need without claiming any durability this executor was never
 * meant to provide.
 *
 * `context.clock` genuinely is used (the dispatcher itself calls
 * `clock.nowMs()`), so it is a real, working clock backed by the
 * platform's actual time -- never `createTestClock`.
 */
import {
  buildServiceContext,
  DEFAULT_SERVICE_BUDGET,
  executeLocalService,
  ServiceRegistry,
  VerifyAgentOutputService,
  type ServiceAuditEventSink,
} from '@siteborne/service-runtime';
import type { ArtifactStore, InjectedClock } from '@siteborne/provider-adapters';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import type { ServiceExecutor } from '../routes/x402-service';
import { toExecutorOutcomeResult } from './finalized-outcome';

function unreachableArtifactStore(): ArtifactStore {
  const fail = (method: string) => (): never => {
    throw new Error(
      `unreachable_artifact_store: verify_agent_output.v2 does not persist artifacts -- ` +
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

/** Real (working, non-throwing) but explicitly non-durable dispatcher
 * bookkeeping sink -- see the module doc comment above for why this is
 * not the durable audit path and does not need to be. */
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
 * `productionEnabled: false` and `implementationStatus:
 * 'local_fixture_verified'` below are NOT claims that this executor is a
 * fixture -- `ServiceRegistry.register()` (packages/service-runtime/src/
 * registry.ts) types `productionEnabled` as the literal `false` and
 * throws on any other value ("production activation is out of SUN-0600
 * scope"), and `RegisteredService.implementationStatus` has no
 * "production" option at all. This is a permanently-scoped, unrelated
 * older gate covering this dispatch registry specifically, not a
 * statement about whether the underlying execution is real. The
 * `context.execution_mode: 'live'` and the real production signer below
 * are what actually govern real vs. fixture behavior for this executor.
 * Do not "fix" this into a type error -- see the approved SUN-1214
 * design and implementation plan for the full reconciliation.
 */
export function buildVerifyAgentOutputV2ProductionExecutor(
  signer: Signer,
  keyRegistry: KeyRegistry,
  serviceId: 'verify_agent_output.v2' | 'verify_agent_output.v3' = 'verify_agent_output.v2'
): ServiceExecutor {
  return async (input, ctx) => {
    const context = buildServiceContext(serviceId, {
      job_id: ctx.job_id,
      request_id: ctx.request_id,
      clock: realClock(),
      artifact_store: unreachableArtifactStore(),
      audit: requestScopedAuditSink(),
      budget: DEFAULT_SERVICE_BUDGET,
      execution_mode: 'live',
    });

    const registry = new ServiceRegistry();
    registry.register({
      serviceId,
      contractRelease: serviceId.endsWith('.v3') ? '3.0.0' : '2.0.0',
      productionEnabled: false,
      service: new VerifyAgentOutputService({ signer, keyRegistry }),
      implementationVersion: '0.1.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      implementationStatus: 'local_fixture_verified',
    });

    const result = await executeLocalService(registry, serviceId, input, context);
    return toExecutorOutcomeResult(result);
  };
}
