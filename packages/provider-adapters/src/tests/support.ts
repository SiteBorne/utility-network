/**
 * Shared test support for adapter execution suites.
 *
 * Not a test file itself (no `.test.ts` suffix) — it will not be picked up by
 * vitest's `include` glob. It builds real fake dependencies (deterministic
 * clock, counting HTTP client, in-memory artifact store, audit sink) that are
 * injected into adapters through their public constructor/execute() surface.
 * No test in this package performs a real network request: every
 * `InjectedHttpClient` here is a plain function that never touches a socket.
 */
import { createTestClock, createTestAuditSink } from '../context';
import type {
  AdapterExecutionContext,
  ArtifactStore,
  InjectedClock,
  InjectedHttpClient,
  AuditEventSink,
} from '../types';

export function fakeClock(): InjectedClock {
  return createTestClock();
}

export function fakeAuditSink(): AuditEventSink {
  return createTestAuditSink();
}

export function fakeArtifactStore(): ArtifactStore {
  const store = new Map<
    string,
    { meta: { contentHash: string; media_type: string; byte_length: number }; content: Uint8Array }
  >();
  return {
    async put(artifact, content) {
      store.set(artifact.id, {
        meta: {
          contentHash: artifact.contentHash,
          media_type: artifact.media_type,
          byte_length: artifact.byte_length,
        },
        content,
      });
    },
    async getMetadata(id) {
      return store.get(id)?.meta ?? null;
    },
    async getContent(id) {
      return store.get(id)?.content ?? null;
    },
    async exists(id) {
      return store.has(id);
    },
  };
}

/**
 * A fake InjectedHttpClient that counts calls and returns a canned Response
 * for every request, regardless of URL. This is sufficient (and preferable
 * for readability) for adapter-level tests that assert on result class,
 * provenance, and call counts rather than exact request routing.
 */
export interface CountingHttpClient extends InjectedHttpClient {
  readonly callCount: number;
  readonly calledUrls: string[];
}

export function jsonHttpClient(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): CountingHttpClient {
  const calledUrls: string[] = [];
  const client = {
    async fetch(input: RequestInfo | URL) {
      calledUrls.push(input instanceof URL ? input.toString() : input.toString());
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json', ...init.headers },
      });
    },
    get callCount() {
      return calledUrls.length;
    },
    get calledUrls() {
      return calledUrls;
    },
  };
  return client;
}

export function textHttpClient(
  body: string,
  contentType = 'text/html',
  init: { status?: number; headers?: Record<string, string> } = {}
): CountingHttpClient {
  const calledUrls: string[] = [];
  const client = {
    async fetch(input: RequestInfo | URL) {
      calledUrls.push(input instanceof URL ? input.toString() : input.toString());
      return new Response(body, {
        status: init.status ?? 200,
        headers: { 'content-type': contentType, ...init.headers },
      });
    },
    get callCount() {
      return calledUrls.length;
    },
    get calledUrls() {
      return calledUrls;
    },
  };
  return client;
}

/** An InjectedHttpClient that must never be called — throws if it is. */
export function unreachableHttpClient(): CountingHttpClient {
  const calledUrls: string[] = [];
  const client = {
    async fetch(input: RequestInfo | URL) {
      calledUrls.push(input instanceof URL ? input.toString() : input.toString());
      throw new Error('unreachableHttpClient: no network access should occur for this scenario');
    },
    get callCount() {
      return calledUrls.length;
    },
    get calledUrls() {
      return calledUrls;
    },
  };
  return client;
}

export function buildContext(
  overrides: Partial<AdapterExecutionContext> & {
    injected_clock: InjectedClock;
    injected_http_client: InjectedHttpClient;
  }
): AdapterExecutionContext {
  return {
    request_id: overrides.request_id ?? crypto.randomUUID(),
    correlation_id: overrides.correlation_id ?? crypto.randomUUID(),
    job_id: overrides.job_id,
    service_id: overrides.service_id,
    source_policy_version: overrides.source_policy_version ?? '1.0.0',
    timeout_ms: overrides.timeout_ms ?? 30000,
    max_response_bytes: overrides.max_response_bytes ?? 10 * 1024 * 1024,
    freshness_requirement_ms: overrides.freshness_requirement_ms,
    cache_policy: overrides.cache_policy ?? 'read_write',
    cancellation_signal: overrides.cancellation_signal ?? { aborted: false },
    injected_clock: overrides.injected_clock,
    injected_http_client: overrides.injected_http_client,
    injected_rate_limiter: overrides.injected_rate_limiter ?? unusedRateLimiter(),
    injected_artifact_store: overrides.injected_artifact_store ?? fakeArtifactStore(),
    audit_event_sink: overrides.audit_event_sink ?? fakeAuditSink(),
    execution_mode: overrides.execution_mode ?? 'test',
  };
}

function unusedRateLimiter(): AdapterExecutionContext['injected_rate_limiter'] {
  // Adapters construct their own internal rate limiter from the manifest; this
  // context field exists on the type surface but is not consulted by any
  // shipped adapter's execute(). Provide a trivially-correct implementation.
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
