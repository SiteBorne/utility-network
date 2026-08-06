import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryIdempotencyRepository,
  InMemoryJobsRepository,
  InMemoryJobAttemptsRepository,
  InMemoryStateEventsRepository,
} from '../src/control-plane/repositories/in-memory';
import { IdempotencyRecord, Job, JobAttempt, JobState } from '../src/control-plane/types';

describe('Idempotency Repository', () => {
  let repo: InMemoryIdempotencyRepository;
  let jobsRepo: InMemoryJobsRepository;

  beforeEach(() => {
    repo = new InMemoryIdempotencyRepository();
    jobsRepo = new InMemoryJobsRepository();
  });

  it('acquires idempotency record for first request', async () => {
    const record: IdempotencyRecord = {
      id: crypto.randomUUID(),
      idempotency_key: 'key-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      original_job_id: 'job-123',
    };

    const result = await repo.acquire(record);
    expect(result.ok).toBe(true);
    expect(result.value.idempotency_key).toBe('key-123');
  });

  it('rejects duplicate idempotency key', async () => {
    const record: IdempotencyRecord = {
      id: crypto.randomUUID(),
      idempotency_key: 'key-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      original_job_id: 'job-123',
    };

    await repo.acquire(record);
    const result = await repo.acquire(record);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('returns original record for exact duplicate', async () => {
    const record: IdempotencyRecord = {
      id: crypto.randomUUID(),
      idempotency_key: 'key-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      original_job_id: 'job-123',
    };

    await repo.acquire(record);
    const result = await repo.getByKeyAndInput('key-123', 'sha256:abc123', 'sha256:schema123');
    expect(result.ok).toBe(true);
    expect(result.value).not.toBeNull();
    expect(result.value?.original_job_id).toBe('job-123');
  });

  it('rejects same key with changed input hash', async () => {
    const record: IdempotencyRecord = {
      id: crypto.randomUUID(),
      idempotency_key: 'key-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      original_job_id: 'job-123',
    };

    await repo.acquire(record);
    const result = await repo.getByKeyAndInput('key-123', 'sha256:different', 'sha256:schema123');
    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
  });

  it('rejects same key with changed schema hash', async () => {
    const record: IdempotencyRecord = {
      id: crypto.randomUUID(),
      idempotency_key: 'key-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      original_job_id: 'job-123',
    };

    await repo.acquire(record);
    const result = await repo.getByKeyAndInput('key-123', 'sha256:abc123', 'sha256:different');
    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
  });
});

describe('Jobs Repository', () => {
  let repo: InMemoryJobsRepository;

  beforeEach(() => {
    repo = new InMemoryJobsRepository();
  });

  it('creates job', async () => {
    const job: Job = {
      id: 'job-123',
      request_id: 'req-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      output_schema_hash: 'sha256:output123',
      idempotency_key: 'key-123',
      contract_release: '1.0.0',
      pcc_dependency: '1.0.1',
      current_state: 'RECEIVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      attempt_count: 0,
      production_enabled: false,
    };

    const result = await repo.create(job);
    expect(result.ok).toBe(true);
    expect(result.value.id).toBe('job-123');
  });

  it('gets job by id', async () => {
    const job: Job = {
      id: 'job-123',
      request_id: 'req-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      output_schema_hash: 'sha256:output123',
      idempotency_key: 'key-123',
      contract_release: '1.0.0',
      pcc_dependency: '1.0.1',
      current_state: 'RECEIVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      attempt_count: 0,
      production_enabled: false,
    };

    await repo.create(job);
    const result = await repo.getById('job-123');
    expect(result.ok).toBe(true);
    expect(result.value).not.toBeNull();
  });

  it('gets job by idempotency key', async () => {
    const job: Job = {
      id: 'job-123',
      request_id: 'req-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      output_schema_hash: 'sha256:output123',
      idempotency_key: 'key-123',
      contract_release: '1.0.0',
      pcc_dependency: '1.0.1',
      current_state: 'RECEIVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      attempt_count: 0,
      production_enabled: false,
    };

    await repo.create(job);
    const result = await repo.getByIdempotencyKey('key-123');
    expect(result.ok).toBe(true);
    expect(result.value).not.toBeNull();
    expect(result.value?.id).toBe('job-123');
  });

  it('updates job state', async () => {
    const job: Job = {
      id: 'job-123',
      request_id: 'req-123',
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_hash: 'sha256:abc123',
      input_schema_hash: 'sha256:schema123',
      output_schema_hash: 'sha256:output123',
      idempotency_key: 'key-123',
      contract_release: '1.0.0',
      pcc_dependency: '1.0.1',
      current_state: 'RECEIVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      attempt_count: 0,
      production_enabled: false,
    };

    await repo.create(job);
    const result = await repo.updateState('job-123', 'VALIDATED', 1);
    expect(result.ok).toBe(true);
    expect(result.value.current_state).toBe('VALIDATED');
    expect(result.value.attempt_count).toBe(1);
  });
});

describe('Job Attempts Repository', () => {
  let repo: InMemoryJobAttemptsRepository;

  beforeEach(() => {
    repo = new InMemoryJobAttemptsRepository();
  });

  it('creates attempt', async () => {
    const attempt: JobAttempt = {
      id: 'attempt-123',
      job_id: 'job-123',
      attempt_number: 1,
      state: 'RECEIVED',
      dispatched_at: new Date().toISOString(),
    };

    const result = await repo.create(attempt);
    expect(result.ok).toBe(true);
    expect(result.value.attempt_number).toBe(1);
  });

  it('gets attempt by job id and attempt number', async () => {
    const attempt: JobAttempt = {
      id: 'attempt-123',
      job_id: 'job-123',
      attempt_number: 1,
      state: 'RECEIVED',
      dispatched_at: new Date().toISOString(),
    };

    await repo.create(attempt);
    const result = await repo.getByJobIdAndAttempt('job-123', 1);
    expect(result.ok).toBe(true);
    expect(result.value).not.toBeNull();
  });

  it('lists attempts by job id in order', async () => {
    const attempt1: JobAttempt = {
      id: 'attempt-1',
      job_id: 'job-123',
      attempt_number: 1,
      state: 'RECEIVED',
      dispatched_at: new Date().toISOString(),
    };
    const attempt2: JobAttempt = {
      id: 'attempt-2',
      job_id: 'job-123',
      attempt_number: 2,
      state: 'RECEIVED',
      dispatched_at: new Date().toISOString(),
    };

    await repo.create(attempt2);
    await repo.create(attempt1);
    const result = await repo.listByJobId('job-123');
    expect(result.ok).toBe(true);
    expect(result.value.length).toBe(2);
    expect(result.value[0].attempt_number).toBe(1);
    expect(result.value[1].attempt_number).toBe(2);
  });
});

describe('State Events Repository', () => {
  let repo: InMemoryStateEventsRepository;

  beforeEach(() => {
    repo = new InMemoryStateEventsRepository();
  });

  it('creates state event', async () => {
    const event = {
      id: 'event-123',
      job_id: 'job-123',
      attempt_number: 1,
      from_state: 'RECEIVED' as JobState,
      to_state: 'VALIDATED' as JobState,
      reason: 'VALIDATION_PASSED' as any,
      actor: 'SYSTEM' as any,
      timestamp: new Date().toISOString(),
      attempt_hash: 'hash123',
    };

    const result = await repo.create(event);
    expect(result.ok).toBe(true);
  });

  it('gets events by job id in chronological order', async () => {
    const event1 = {
      id: 'event-1',
      job_id: 'job-123',
      attempt_number: 1,
      from_state: 'RECEIVED' as JobState,
      to_state: 'VALIDATED' as JobState,
      reason: 'VALIDATION_PASSED' as any,
      actor: 'SYSTEM' as any,
      timestamp: new Date(Date.now() - 1000).toISOString(),
      attempt_hash: 'hash1',
    };
    const event2 = {
      id: 'event-2',
      job_id: 'job-123',
      attempt_number: 1,
      from_state: 'VALIDATED' as JobState,
      to_state: 'QUOTED' as JobState,
      reason: 'QUOTE_GENERATED' as any,
      actor: 'SYSTEM' as any,
      timestamp: new Date().toISOString(),
      attempt_hash: 'hash2',
    };

    await repo.create(event2);
    await repo.create(event1);
    const result = await repo.getByJobId('job-123');
    expect(result.ok).toBe(true);
    expect(result.value.length).toBe(2);
    expect(result.value[0].from_state).toBe('RECEIVED');
    expect(result.value[1].from_state).toBe('VALIDATED');
  });
});
