import type {
  AuditEvent,
  SecurityEvent,
  AuditRepository,
  SecurityRepository,
} from '../repositories/interfaces';
import type { ActorClass } from '../types';

export const AuditEventTypes = {
  REQUEST_RECEIVED: 'request_received',
  REQUEST_REJECTED: 'request_rejected',
  IDEMPOTENCY_ACQUIRED: 'idempotency_acquired',
  IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
  JOB_CREATED: 'job_created',
  ATTEMPT_CREATED: 'attempt_created',
  STATE_CHANGED: 'state_changed',
  QUOTA_RESERVED: 'quota_reserved',
  QUOTA_REJECTED: 'quota_rejected',
  DISPATCH_CREATED: 'dispatch_created',
  DUPLICATE_DISPATCH_IGNORED: 'duplicate_dispatch_ignored',
  ARTIFACT_STORED: 'artifact_stored',
  ARTIFACT_REJECTED: 'artifact_rejected',
  CONFIGURATION_FAILURE: 'configuration_failure',
  SECURITY_POLICY_FAILURE: 'security_policy_failure',
} as const;

export const SecurityEventTypes = {
  INVALID_STATE_TRANSITION: 'invalid_state_transition',
  ALTERED_IDEMPOTENT_REQUEST: 'altered_idempotent_request',
  OVERSIZED_PAYLOAD: 'oversized_payload',
  INVALID_SCHEMA_HASH: 'invalid_schema_hash',
  UNKNOWN_SERVICE: 'unknown_service',
  ATTEMPT_REPLAY: 'attempt_replay',
  QUEUE_REPLAY: 'queue_replay',
  ARTIFACT_HASH_MISMATCH: 'artifact_hash_mismatch',
  PRODUCTION_DISABLED_EXECUTION_ATTEMPT: 'production_disabled_execution_attempt',
} as const;

export function createAuditEvent(
  eventType: string,
  options: {
    jobId?: string;
    attemptNumber?: number;
    serviceId?: string;
    actor: ActorClass;
    details: Record<string, unknown>;
    correlationId?: string;
  }
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    event_type: eventType,
    job_id: options.jobId,
    attempt_number: options.attemptNumber,
    service_id: options.serviceId,
    actor: options.actor,
    details: sanitizeDetails(options.details),
    timestamp: new Date().toISOString(),
    correlation_id: options.correlationId,
  };
}

export function createSecurityEvent(
  eventType: string,
  options: {
    jobId?: string;
    attemptNumber?: number;
    serviceId?: string;
    details: Record<string, unknown>;
    correlationId?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }
): SecurityEvent {
  return {
    id: crypto.randomUUID(),
    event_type: eventType,
    job_id: options.jobId,
    attempt_number: options.attemptNumber,
    service_id: options.serviceId,
    details: sanitizeDetails(options.details),
    timestamp: new Date().toISOString(),
    correlation_id: options.correlationId,
    severity: options.severity,
  };
}

export function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...details };
  const redactedKeys = [
    'secret',
    'password',
    'token',
    'key',
    'authorization',
    'credential',
    'private_key',
    'wallet',
    'signature',
    'signed_payload',
    'document',
    'content',
    'payload',
    'body',
    'input',
    'output',
  ];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (redactedKeys.some((rk) => lowerKey.includes(rk))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

export class AuditLogger {
  constructor(
    private auditRepo: AuditRepository,
    private securityRepo: SecurityRepository
  ) {}

  async logRequestReceived(
    correlationId: string,
    serviceId: string,
    actor: ActorClass
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.REQUEST_RECEIVED, {
        serviceId,
        actor,
        details: { action: 'request_received' },
        correlationId,
      })
    );
  }

  async logRequestRejected(
    correlationId: string,
    serviceId: string,
    actor: ActorClass,
    reason: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.REQUEST_REJECTED, {
        serviceId,
        actor,
        details: { action: 'request_rejected', reason },
        correlationId,
      })
    );
  }

  async logIdempotencyAcquired(
    jobId: string,
    serviceId: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.IDEMPOTENCY_ACQUIRED, {
        jobId,
        serviceId,
        actor,
        details: { action: 'idempotency_acquired' },
        correlationId,
      })
    );
  }

  async logIdempotencyConflict(
    serviceId: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.IDEMPOTENCY_CONFLICT, {
        serviceId,
        actor,
        details: { action: 'idempotency_conflict' },
        correlationId,
      })
    );
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.ALTERED_IDEMPOTENT_REQUEST, {
        serviceId,
        actor,
        details: { action: 'altered_idempotent_request' },
        correlationId,
        severity: 'high',
      })
    );
  }

  async logJobCreated(
    jobId: string,
    serviceId: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.JOB_CREATED, {
        jobId,
        serviceId,
        actor,
        details: { action: 'job_created' },
        correlationId,
      })
    );
  }

  async logAttemptCreated(
    jobId: string,
    attemptNumber: number,
    serviceId: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.ATTEMPT_CREATED, {
        jobId,
        attemptNumber,
        serviceId,
        actor,
        details: { action: 'attempt_created' },
        correlationId,
      })
    );
  }

  async logStateChanged(
    jobId: string,
    attemptNumber: number,
    fromState: string,
    toState: string,
    reason: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.STATE_CHANGED, {
        jobId,
        attemptNumber,
        actor,
        details: { action: 'state_changed', from_state: fromState, to_state: toState, reason },
        correlationId,
      })
    );
  }

  async logQuotaReserved(
    jobId: string,
    resourceClass: string,
    units: number,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.QUOTA_RESERVED, {
        jobId,
        actor,
        details: { action: 'quota_reserved', resource_class: resourceClass, units },
        correlationId,
      })
    );
  }

  async logQuotaRejected(
    jobId: string,
    resourceClass: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.QUOTA_REJECTED, {
        jobId,
        actor,
        details: { action: 'quota_rejected', resource_class: resourceClass },
        correlationId,
      })
    );
  }

  async logDispatchCreated(
    jobId: string,
    attemptNumber: number,
    serviceId: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.DISPATCH_CREATED, {
        jobId,
        attemptNumber,
        serviceId,
        actor,
        details: { action: 'dispatch_created' },
        correlationId,
      })
    );
  }

  async logDuplicateDispatchIgnored(
    jobId: string,
    attemptNumber: number,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.DUPLICATE_DISPATCH_IGNORED, {
        jobId,
        attemptNumber,
        actor: 'SYSTEM',
        details: { action: 'duplicate_dispatch_ignored' },
        correlationId,
      })
    );
  }

  async logArtifactStored(
    jobId: string,
    artifactId: string,
    artifactType: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.ARTIFACT_STORED, {
        jobId,
        actor,
        details: {
          action: 'artifact_stored',
          artifact_id: artifactId,
          artifact_type: artifactType,
        },
        correlationId,
      })
    );
  }

  async logArtifactRejected(
    jobId: string,
    reason: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.ARTIFACT_REJECTED, {
        jobId,
        actor,
        details: { action: 'artifact_rejected', reason },
        correlationId,
      })
    );
  }

  async logConfigurationFailure(
    serviceId: string,
    details: Record<string, unknown>,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.CONFIGURATION_FAILURE, {
        serviceId,
        actor,
        details: { action: 'configuration_failure', ...details },
        correlationId,
      })
    );
  }

  async logSecurityPolicyFailure(
    jobId: string,
    policy: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.auditRepo.create(
      createAuditEvent(AuditEventTypes.SECURITY_POLICY_FAILURE, {
        jobId,
        actor,
        details: { action: 'security_policy_failure', policy },
        correlationId,
      })
    );
  }

  async logInvalidStateTransition(
    jobId: string,
    attemptNumber: number,
    fromState: string,
    toState: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.INVALID_STATE_TRANSITION, {
        jobId,
        attemptNumber,
        actor,
        details: { action: 'invalid_state_transition', from_state: fromState, to_state: toState },
        correlationId,
        severity: 'high',
      })
    );
  }

  async logOversizedPayload(
    serviceId: string,
    size: number,
    limit: number,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.OVERSIZED_PAYLOAD, {
        serviceId,
        actor,
        details: { action: 'oversized_payload', size, limit },
        correlationId,
        severity: 'medium',
      })
    );
  }

  async logInvalidSchemaHash(
    jobId: string,
    expectedHash: string,
    actualHash: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.INVALID_SCHEMA_HASH, {
        jobId,
        actor,
        details: { action: 'invalid_schema_hash', expected: expectedHash, actual: actualHash },
        correlationId,
        severity: 'high',
      })
    );
  }

  async logUnknownService(
    serviceId: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.UNKNOWN_SERVICE, {
        serviceId,
        actor,
        details: { action: 'unknown_service' },
        correlationId,
        severity: 'high',
      })
    );
  }

  async logAttemptReplay(
    jobId: string,
    attemptNumber: number,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.ATTEMPT_REPLAY, {
        jobId,
        attemptNumber,
        actor,
        details: { action: 'attempt_replay' },
        correlationId,
        severity: 'critical',
      })
    );
  }

  async logQueueReplay(
    jobId: string,
    attemptNumber: number,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.QUEUE_REPLAY, {
        jobId,
        attemptNumber,
        actor,
        details: { action: 'queue_replay' },
        correlationId,
        severity: 'critical',
      })
    );
  }

  async logArtifactHashMismatch(
    jobId: string,
    artifactId: string,
    expectedHash: string,
    actualHash: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.ARTIFACT_HASH_MISMATCH, {
        jobId,
        actor,
        details: {
          action: 'artifact_hash_mismatch',
          artifact_id: artifactId,
          expected: expectedHash,
          actual: actualHash,
        },
        correlationId,
        severity: 'critical',
      })
    );
  }

  async logProductionDisabledExecutionAttempt(
    jobId: string,
    serviceId: string,
    actor: ActorClass,
    correlationId?: string
  ): Promise<void> {
    await this.securityRepo.create(
      createSecurityEvent(SecurityEventTypes.PRODUCTION_DISABLED_EXECUTION_ATTEMPT, {
        jobId,
        serviceId,
        actor,
        details: { action: 'production_disabled_execution_attempt' },
        correlationId,
        severity: 'high',
      })
    );
  }
}
