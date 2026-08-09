/**
 * The pure/local execution dispatcher (directive §32). Resolves a known
 * service, enforces the execution budget's total timeout, calls the
 * service, and converts any escaping exception into a closed
 * `internal_error` result — nothing thrown crosses this boundary. Never
 * creates a payment challenge, settles payment, invokes x402, dispatches a
 * queue job, or exposes a public paid route; this is strictly the local
 * application-service boundary the control plane will later call into
 * after its own payment/state-machine gating (directive §33 — that
 * integration itself is not wired in SUN-0600).
 */
import type {
  ServiceExecutionContext,
  ServiceExecutionResult,
  ServiceFailure,
  ServiceId,
} from './types';
import type { ServiceRegistry } from './registry';

class TimeoutMarker extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutMarker(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

export async function executeLocalService(
  registry: ServiceRegistry,
  serviceId: string,
  input: unknown,
  context: ServiceExecutionContext
): Promise<ServiceExecutionResult> {
  const startedMs = context.clock.nowMs();
  const registered = registry.get(serviceId);

  if (!registered) {
    return closedFailure(serviceId as ServiceId, context, startedMs, {
      code: 'unknown_service',
      message: `no local service is registered for service_id "${serviceId}"`,
      retryable: false,
    });
  }

  context.audit.emit({
    type: 'service_execution_started',
    details: { service_id: serviceId },
    correlation_id: context.request_id,
  });

  try {
    const result = await withTimeout(
      registered.service.execute(input, context),
      context.budget.totalTimeoutMs
    );
    context.audit.emit({
      type:
        result.result_class === 'success'
          ? 'service_execution_completed'
          : 'service_execution_failed',
      details: { service_id: serviceId, result_class: result.result_class },
      correlation_id: context.request_id,
    });
    return result;
  } catch (err) {
    const timedOut = err instanceof TimeoutMarker;
    context.audit.emit({
      type: 'service_execution_failed',
      details: { service_id: serviceId, error: String(err), timed_out: timedOut },
      correlation_id: context.request_id,
    });
    return closedFailure(serviceId as ServiceId, context, startedMs, {
      code: timedOut ? 'execution_timeout' : 'internal_error',
      message: timedOut
        ? `service execution exceeded ${context.budget.totalTimeoutMs}ms budget`
        : `internal exception: ${String(err)}`,
      retryable: timedOut,
    });
  }
}

function closedFailure(
  serviceId: ServiceId,
  context: ServiceExecutionContext,
  startedMs: number,
  failure: ServiceFailure
): ServiceExecutionResult {
  return {
    result_class: failure.code === 'unknown_service' ? 'rejected' : 'internal_verification_failed',
    service_id: serviceId,
    service_version: 'v1',
    contract_release: context.contract_release,
    request_id: context.request_id,
    job_id: context.job_id,
    input_hash: 'sha256:' + '0'.repeat(64),
    warnings: [],
    limitations: [],
    audit_references: [],
    metrics: {
      elapsed_ms: context.clock.nowMs() - startedMs,
      dependency_calls: 0,
      claims_produced: 0,
      evidence_produced: 0,
      output_bytes: 0,
    },
    failure,
  };
}
