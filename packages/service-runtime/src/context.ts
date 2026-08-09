/**
 * Test/fixture context builders and cross-layer adapter bridges.
 *
 * provider-adapters, packages/verification, and this package each define
 * their own InjectedClock/AuditEventSink shape (established independently
 * per-package, per each package's own ADRs). Rather than force one shape on
 * every layer retroactively, this module provides small, pure bridge
 * functions so a single injected clock/audit-sink pair can drive all three.
 */
import {
  createTestClock as createAdapterTestClock,
  createTestAuditSink as createAdapterTestAuditSink,
} from '@siteborne/provider-adapters';
import type {
  InjectedClock as AdapterClock,
  ArtifactStore,
  AuditEventSink as AdapterAuditEventSink,
} from '@siteborne/provider-adapters';
import type {
  InjectedClock as VerificationClock,
  AuditEventSink as VerificationAuditEventSink,
} from '@siteborne/verification';
import { DEFAULT_SERVICE_BUDGET } from './types';
import type { ServiceAuditEventSink, ServiceExecutionContext, ServiceId } from './types';

export function toVerificationClock(clock: AdapterClock): VerificationClock {
  return {
    nowMs: () => clock.nowMs(),
    nowIso: () => new Date(clock.nowMs()).toISOString(),
  };
}

export function toAdapterAuditSink(sink: ServiceAuditEventSink): AdapterAuditEventSink {
  return {
    async log(event) {
      sink.emit({ type: event.type, details: event.details, correlation_id: event.correlationId });
    },
    getEvents() {
      return sink.getEvents().map((e) => ({
        type: e.type,
        details: e.details,
        correlationId: e.correlation_id,
        timestamp: e.timestamp,
      }));
    },
    clear() {
      // Service-level audit sinks in this package are append-only fakes;
      // clearing is a test-only capability provider-adapters' interface
      // exposes but this bridge does not need to support.
    },
  };
}

export function toVerificationAuditSink(sink: ServiceAuditEventSink): VerificationAuditEventSink {
  return {
    emit: (event) => sink.emit(event),
    getEvents: () => sink.getEvents(),
  };
}

export function createTestClock(): AdapterClock {
  return createAdapterTestClock();
}

export function createTestServiceAuditSink(): ServiceAuditEventSink {
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

export function createTestArtifactStore(): ArtifactStore {
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

/** Re-exported for callers that only need a bare provider-adapters audit
 * sink (e.g. wiring an adapter directly without going through a service). */
export { createAdapterTestAuditSink };

export function buildServiceContext(
  serviceId: ServiceId,
  overrides: Partial<ServiceExecutionContext> = {}
): ServiceExecutionContext {
  return {
    request_id: overrides.request_id ?? crypto.randomUUID(),
    job_id: overrides.job_id ?? crypto.randomUUID(),
    idempotency_key: overrides.idempotency_key,
    service_id: serviceId,
    contract_release: overrides.contract_release ?? '1.0.0',
    pcc_schema_release: overrides.pcc_schema_release ?? '1.0.1',
    pcc_schema_hash:
      overrides.pcc_schema_hash ??
      'sha256:f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5',
    policy_id: overrides.policy_id ?? 'pol_' + '0'.repeat(24),
    policy_hash: overrides.policy_hash ?? 'sha256:' + '0'.repeat(64),
    clock: overrides.clock ?? createTestClock(),
    artifact_store: overrides.artifact_store ?? createTestArtifactStore(),
    audit: overrides.audit ?? createTestServiceAuditSink(),
    budget: overrides.budget ?? DEFAULT_SERVICE_BUDGET,
    mode: overrides.mode ?? 'standard',
    execution_mode: overrides.execution_mode ?? 'fixture',
    cancellation_signal: overrides.cancellation_signal,
  };
}
