/**
 * Bridges a ServiceExecutionContext into an AdapterExecutionContext so a
 * service can call a @siteborne/provider-adapters ProviderAdapter's public
 * execute() interface. The HTTP client itself is not part of
 * ServiceExecutionContext (directive §5: no arbitrary network client
 * exposed via context) — it is injected once into each service's
 * constructor at wiring time (fixture tests inject a canned fake; a future
 * live wiring would inject a real bounded client), and only used here to
 * build the one-shot context an adapter call needs.
 */
import { createExecutionContext } from '@siteborne/provider-adapters';
import type {
  AdapterExecutionContext,
  InjectedHttpClient,
  RateLimiter,
} from '@siteborne/provider-adapters';
import { toAdapterAuditSink } from '../context';
import type { ServiceExecutionContext } from '../types';

/** Adapters (SecSubmissionsAdapter, PublicHttpAdapter, etc.) construct and
 * manage their own internal rate limiter from their manifest's rate_policy
 * — this context field exists on AdapterExecutionContext's type surface but
 * is not consulted by any shipped adapter's execute(), matching the same
 * documented no-op in packages/provider-adapters/src/tests/support.ts. */
function unusedRateLimiter(): RateLimiter {
  return {
    async acquire() {},
    release() {},
    tryAcquire() {
      return true;
    },
    getState() {
      return { tokens: 1, lastRefill: 0, activeRequests: 0, queuedRequests: 0 };
    },
    getAvailableTokens() {
      return 1;
    },
  };
}

export function buildAdapterContext(
  context: ServiceExecutionContext,
  httpClient: InjectedHttpClient
): AdapterExecutionContext {
  return createExecutionContext(
    {
      clock: context.clock,
      httpClient,
      rateLimiter: unusedRateLimiter(),
      artifactStore: context.artifact_store,
      auditSink: toAdapterAuditSink(context.audit),
    },
    {
      request_id: context.request_id,
      job_id: context.job_id,
      service_id: context.service_id,
      timeout_ms: Math.min(context.budget.totalTimeoutMs, 30_000),
      max_response_bytes: 10 * 1024 * 1024,
      cache_policy: 'bypass',
      execution_mode: context.execution_mode === 'live' ? 'live' : 'test',
    }
  );
}
