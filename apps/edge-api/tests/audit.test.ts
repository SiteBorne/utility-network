import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuditLogger,
  AuditEventTypes,
  SecurityEventTypes,
  sanitizeDetails,
} from '../src/control-plane/audit/events';
import {
  InMemoryAuditRepository,
  InMemorySecurityRepository,
} from '../src/control-plane/repositories/in-memory';
import { ActorClass } from '../src/control-plane/types';

describe('Audit Events', () => {
  let auditRepo: InMemoryAuditRepository;
  let securityRepo: InMemorySecurityRepository;
  let logger: AuditLogger;

  beforeEach(() => {
    auditRepo = new InMemoryAuditRepository();
    securityRepo = new InMemorySecurityRepository();
    logger = new AuditLogger(auditRepo, securityRepo);
  });

  it('logs request received', async () => {
    await logger.logRequestReceived('corr-123', 'company_evidence_graph.v1', 'CLIENT');
    const events = await auditRepo.list();
    expect(events.ok).toBe(true);
    expect(events.value.length).toBe(1);
    expect(events.value[0].event_type).toBe('request_received');
  });

  it('logs request rejected', async () => {
    await logger.logRequestRejected(
      'corr-123',
      'company_evidence_graph.v1',
      'CLIENT',
      'invalid input'
    );
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('request_rejected');
    expect(events.value[0].details.reason).toBe('invalid input');
  });

  it('logs idempotency acquired', async () => {
    await logger.logIdempotencyAcquired(
      'job-123',
      'company_evidence_graph.v1',
      'SYSTEM',
      'corr-123'
    );
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('idempotency_acquired');
    expect(events.value[0].job_id).toBe('job-123');
  });

  it('logs idempotency conflict and security event', async () => {
    await logger.logIdempotencyConflict('company_evidence_graph.v1', 'CLIENT', 'corr-123');
    const auditEvents = await auditRepo.list();
    const securityEvents = await securityRepo.list();
    expect(auditEvents.value[0].event_type).toBe('idempotency_conflict');
    expect(securityEvents.value[0].event_type).toBe('altered_idempotent_request');
    expect(securityEvents.value[0].severity).toBe('high');
  });

  it('logs job created', async () => {
    await logger.logJobCreated('job-123', 'company_evidence_graph.v1', 'SYSTEM', 'corr-123');
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('job_created');
  });

  it('logs attempt created', async () => {
    await logger.logAttemptCreated('job-123', 1, 'company_evidence_graph.v1', 'SYSTEM', 'corr-123');
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('attempt_created');
    expect(events.value[0].attempt_number).toBe(1);
  });

  it('logs state changed', async () => {
    await logger.logStateChanged(
      'job-123',
      1,
      'RECEIVED',
      'VALIDATED',
      'VALIDATION_PASSED',
      'SYSTEM',
      'corr-123'
    );
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('state_changed');
    expect(events.value[0].details.from_state).toBe('RECEIVED');
    expect(events.value[0].details.to_state).toBe('VALIDATED');
  });

  it('logs quota reserved', async () => {
    await logger.logQuotaReserved('job-123', 'cpu_heavy', 5, 'SYSTEM', 'corr-123');
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('quota_reserved');
    expect(events.value[0].details.resource_class).toBe('cpu_heavy');
    expect(events.value[0].details.units).toBe(5);
  });

  it('logs dispatch created', async () => {
    await logger.logDispatchCreated(
      'job-123',
      1,
      'company_evidence_graph.v1',
      'SYSTEM',
      'corr-123'
    );
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('dispatch_created');
  });

  it('logs duplicate dispatch ignored', async () => {
    await logger.logDuplicateDispatchIgnored('job-123', 1, 'corr-123');
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('duplicate_dispatch_ignored');
  });

  it('logs artifact stored', async () => {
    await logger.logArtifactStored('job-123', 'artifact-123', 'input', 'SYSTEM', 'corr-123');
    const events = await auditRepo.list();
    expect(events.value[0].event_type).toBe('artifact_stored');
  });

  it('logs security events with correct severity', async () => {
    await logger.logInvalidStateTransition(
      'job-123',
      1,
      'DELIVERED',
      'RECEIVED',
      'SYSTEM',
      'corr-123'
    );
    const events = await securityRepo.list();
    expect(events.value[0].event_type).toBe('invalid_state_transition');
    expect(events.value[0].severity).toBe('high');
  });

  it('logs oversized payload', async () => {
    await logger.logOversizedPayload(
      'company_evidence_graph.v1',
      20000000,
      10000000,
      'CLIENT',
      'corr-123'
    );
    const events = await securityRepo.list();
    expect(events.value[0].event_type).toBe('oversized_payload');
    expect(events.value[0].severity).toBe('medium');
  });

  it('logs invalid schema hash', async () => {
    await logger.logInvalidSchemaHash(
      'job-123',
      'expected-hash',
      'actual-hash',
      'SYSTEM',
      'corr-123'
    );
    const events = await securityRepo.list();
    expect(events.value[0].event_type).toBe('invalid_schema_hash');
    expect(events.value[0].severity).toBe('high');
  });

  it('logs unknown service', async () => {
    await logger.logUnknownService('unknown_service.v1', 'CLIENT', 'corr-123');
    const events = await securityRepo.list();
    expect(events.value[0].event_type).toBe('unknown_service');
    expect(events.value[0].severity).toBe('high');
  });

  it('logs attempt replay', async () => {
    await logger.logAttemptReplay('job-123', 1, 'SYSTEM', 'corr-123');
    const events = await securityRepo.list();
    expect(events.value[0].event_type).toBe('attempt_replay');
    expect(events.value[0].severity).toBe('critical');
  });

  it('logs production disabled execution attempt', async () => {
    await logger.logProductionDisabledExecutionAttempt(
      'job-123',
      'company_evidence_graph.v1',
      'CLIENT',
      'corr-123'
    );
    const events = await securityRepo.list();
    expect(events.value[0].event_type).toBe('production_disabled_execution_attempt');
    expect(events.value[0].severity).toBe('high');
  });
});

describe('Detail Sanitization', () => {
  it('redacts secret fields', () => {
    const details = {
      api_key: 'secret123',
      password: 'pass123',
      token: 'token123',
      authorization: 'Bearer xyz',
      private_key: 'key123',
      wallet: 'wallet123',
      signature: 'sig123',
      normal_field: 'value',
    };

    const sanitized = sanitizeDetails(details);
    expect(sanitized.api_key).toBe('[REDACTED]');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.private_key).toBe('[REDACTED]');
    expect(sanitized.wallet).toBe('[REDACTED]');
    expect(sanitized.signature).toBe('[REDACTED]');
    expect(sanitized.normal_field).toBe('value');
  });

  it('redacts document and content fields', () => {
    const details = {
      document: 'sensitive document content',
      content: 'private content',
      payload: 'request payload',
      body: 'request body',
      input: 'user input',
      output: 'service output',
      normal: 'value',
    };

    const sanitized = sanitizeDetails(details);
    expect(sanitized.document).toBe('[REDACTED]');
    expect(sanitized.content).toBe('[REDACTED]');
    expect(sanitized.payload).toBe('[REDACTED]');
    expect(sanitized.body).toBe('[REDACTED]');
    expect(sanitized.input).toBe('[REDACTED]');
    expect(sanitized.output).toBe('[REDACTED]');
    expect(sanitized.normal).toBe('value');
  });
});
