import type {
  AuditEventSink,
  InjectedClock,
  VerificationBudget,
  VerificationContext,
  VerificationMode,
} from './types';

export const DEFAULT_BUDGET: VerificationBudget = {
  totalTimeoutMs: 30_000,
  perVerifierTimeoutMs: 5_000,
  maxEvidenceItems: 200,
  maxClaims: 200,
  maxArtifacts: 100,
  maxLocatorResolutions: 500,
  maxResultBytes: 5_000_000,
};

export function createTestClock(): InjectedClock {
  const currentMs = Date.now();
  return {
    nowMs: () => currentMs,
    nowIso: () => new Date(currentMs).toISOString(),
  };
}

/** A test clock whose time can be advanced deterministically, matching the
 * pattern in packages/provider-adapters/src/context.ts::createTestClock. */
export function createAdvanceableTestClock(
  startMs = 0
): InjectedClock & { advance(ms: number): void } {
  let currentMs = startMs;
  return {
    nowMs: () => currentMs,
    nowIso: () => new Date(currentMs).toISOString(),
    advance(ms: number) {
      currentMs += ms;
    },
  };
}

export function createTestAuditSink(): AuditEventSink {
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

export function buildContext(overrides: Partial<VerificationContext> = {}): VerificationContext {
  const clock = overrides.clock ?? createTestClock();
  return {
    request_id: overrides.request_id ?? crypto.randomUUID(),
    job_id: overrides.job_id ?? crypto.randomUUID(),
    service_id: overrides.service_id ?? 'document_evidence_json.v1',
    service_version: overrides.service_version ?? 'v1',
    contract_release: overrides.contract_release ?? '1.0.0',
    pcc_schema_release: overrides.pcc_schema_release ?? '1.0.1',
    pcc_schema_hash:
      overrides.pcc_schema_hash ??
      'sha256:f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5',
    policy_version: overrides.policy_version ?? '1.0.0',
    policy_hash: overrides.policy_hash ?? 'sha256:' + '0'.repeat(64),
    mode: (overrides.mode ?? 'standard') as VerificationMode,
    budget: overrides.budget ?? DEFAULT_BUDGET,
    clock,
    audit: overrides.audit ?? createTestAuditSink(),
    cancellation_signal: overrides.cancellation_signal,
  };
}
