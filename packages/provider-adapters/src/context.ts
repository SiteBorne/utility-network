import type {
  AdapterExecutionContext,
  AdapterHealthContext,
  ArtifactStore,
  RateLimiter,
  InjectedClock,
  InjectedHttpClient,
  AuditEventSink,
} from './types';
export type { ArtifactStore, RateLimiter, InjectedClock, InjectedHttpClient, AuditEventSink };

export interface AdapterContextDependencies {
  clock: InjectedClock;
  httpClient: InjectedHttpClient;
  rateLimiter: RateLimiter;
  artifactStore: ArtifactStore;
  auditSink: AuditEventSink;
}

export function createTestClock(): InjectedClock {
  let currentTime = Date.now();
  const timeouts = new Map<unknown, { callback: () => void; triggerAt: number }>();

  return {
    now() {
      return new Date(currentTime);
    },
    nowMs() {
      return currentTime;
    },
    setTimeout(callback, delay) {
      const id = Symbol('timeout');
      timeouts.set(id, { callback, triggerAt: currentTime + delay });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    advance(ms: number) {
      currentTime += ms;
      const toFire: Array<{ callback: () => void }> = [];
      for (const [id, timeout] of timeouts.entries()) {
        if (timeout.triggerAt <= currentTime) {
          toFire.push({ callback: timeout.callback });
          timeouts.delete(id);
        }
      }
      for (const { callback } of toFire) {
        try {
          callback();
        } catch (e) {
          console.error('Timeout callback error:', e);
        }
      }
    },
    getCurrentTime() {
      return currentTime;
    },
    setTime(ms: number) {
      currentTime = ms;
    },
  };
}

export function createTestHttpClient(responses: Map<string, Response>): InjectedHttpClient {
  return {
    async fetch(input, _init) {
      const url = input instanceof URL ? input.toString() : input.toString();
      const response = responses.get(url);
      if (!response) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
      return response.clone();
    },
  };
}

export function createTestAuditSink(): AuditEventSink {
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

export function createExecutionContext(
  dependencies: AdapterContextDependencies,
  overrides: Partial<AdapterExecutionContext> = {}
): AdapterExecutionContext {
  return {
    request_id: overrides.request_id || crypto.randomUUID(),
    correlation_id: overrides.correlation_id || crypto.randomUUID(),
    job_id: overrides.job_id,
    service_id: overrides.service_id,
    source_policy_version: overrides.source_policy_version || '1.0.0',
    timeout_ms: overrides.timeout_ms || 30000,
    max_response_bytes: overrides.max_response_bytes || 10 * 1024 * 1024,
    freshness_requirement_ms: overrides.freshness_requirement_ms,
    cache_policy: overrides.cache_policy || 'read_write',
    cancellation_signal: overrides.cancellation_signal || { aborted: false },
    injected_clock: dependencies.clock,
    injected_http_client: dependencies.httpClient,
    injected_rate_limiter: dependencies.rateLimiter,
    injected_artifact_store: dependencies.artifactStore,
    audit_event_sink: dependencies.auditSink,
    execution_mode: overrides.execution_mode || 'test',
  };
}

export function createHealthContext(
  dependencies: Pick<AdapterContextDependencies, 'clock' | 'httpClient'>,
  overrides: Partial<AdapterHealthContext> = {}
): AdapterHealthContext {
  return {
    request_id: overrides.request_id || crypto.randomUUID(),
    correlation_id: overrides.correlation_id || crypto.randomUUID(),
    injected_clock: dependencies.clock,
    injected_http_client: dependencies.httpClient,
  };
}
