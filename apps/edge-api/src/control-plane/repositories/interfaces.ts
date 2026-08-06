import type {
  Job,
  JobAttempt,
  StateEvent,
  IdempotencyRecord,
  ArtifactRecord,
  QueueDispatch,
  QuotaReservation,
  AuditEvent,
  SecurityEvent,
  ServiceMetadata,
  ServiceVersion,
} from '../types';

export interface RepositoryResult<T> {
  ok: true;
  value: T;
}

export interface RepositoryError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type RepositoryResponse<T> = RepositoryResult<T> | RepositoryError;

export function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

export function err(code: string, message: string, details?: unknown): RepositoryError {
  return { ok: false, error: { code, message, details } };
}

export interface JobsRepository {
  create(job: Job): Promise<RepositoryResponse<Job>>;
  getById(id: string): Promise<RepositoryResponse<Job | null>>;
  getByIdempotencyKey(key: string): Promise<RepositoryResponse<Job | null>>;
  updateState(
    id: string,
    state: Job['current_state'],
    attemptCount?: number
  ): Promise<RepositoryResponse<Job>>;
  updateTimestamps(id: string): Promise<RepositoryResponse<Job>>;
  listByState(state: Job['current_state'], limit?: number): Promise<RepositoryResponse<Job[]>>;
}

export interface JobAttemptsRepository {
  create(attempt: JobAttempt): Promise<RepositoryResponse<JobAttempt>>;
  getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<RepositoryResponse<JobAttempt | null>>;
  update(attempt: JobAttempt): Promise<RepositoryResponse<JobAttempt>>;
  listByJobId(jobId: string): Promise<RepositoryResponse<JobAttempt[]>>;
}

export interface StateEventsRepository {
  create(event: StateEvent): Promise<RepositoryResponse<StateEvent>>;
  getByJobId(jobId: string): Promise<RepositoryResponse<StateEvent[]>>;
  getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<RepositoryResponse<StateEvent[]>>;
}

export interface IdempotencyRepository {
  acquire(record: IdempotencyRecord): Promise<RepositoryResponse<IdempotencyRecord>>;
  getByKey(key: string): Promise<RepositoryResponse<IdempotencyRecord | null>>;
  getByKeyAndInput(
    key: string,
    inputHash: string,
    inputSchemaHash: string
  ): Promise<RepositoryResponse<IdempotencyRecord | null>>;
  updateResult(key: string, resultRef: string): Promise<RepositoryResponse<IdempotencyRecord>>;
  deleteExpired(): Promise<RepositoryResponse<number>>;
}

export interface ArtifactsRepository {
  create(artifact: ArtifactRecord): Promise<RepositoryResponse<ArtifactRecord>>;
  getById(id: string): Promise<RepositoryResponse<ArtifactRecord | null>>;
  getByContentHash(hash: string): Promise<RepositoryResponse<ArtifactRecord | null>>;
  getByJobId(jobId: string): Promise<RepositoryResponse<ArtifactRecord[]>>;
  delete(id: string): Promise<RepositoryResponse<boolean>>;
  deleteExpired(): Promise<RepositoryResponse<number>>;
}

export interface QueueDispatchRepository {
  create(dispatch: QueueDispatch): Promise<RepositoryResponse<QueueDispatch>>;
  getById(id: string): Promise<RepositoryResponse<QueueDispatch | null>>;
  getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<RepositoryResponse<QueueDispatch | null>>;
  updateRetryCount(id: string, retryCount: number): Promise<RepositoryResponse<QueueDispatch>>;
  listPending(limit?: number): Promise<RepositoryResponse<QueueDispatch[]>>;
}

export interface QuotaRepository {
  create(reservation: QuotaReservation): Promise<RepositoryResponse<QuotaReservation>>;
  getByJobId(jobId: string): Promise<RepositoryResponse<QuotaReservation | null>>;
  getByResourceClass(resourceClass: string): Promise<RepositoryResponse<QuotaReservation[]>>;
  release(jobId: string): Promise<RepositoryResponse<boolean>>;
  deleteExpired(): Promise<RepositoryResponse<number>>;
}

export interface AuditRepository {
  create(event: AuditEvent): Promise<RepositoryResponse<AuditEvent>>;
  getByJobId(jobId: string): Promise<RepositoryResponse<AuditEvent[]>>;
  getByCorrelationId(correlationId: string): Promise<RepositoryResponse<AuditEvent[]>>;
  list(limit?: number): Promise<RepositoryResponse<AuditEvent[]>>;
}

export interface SecurityRepository {
  create(event: SecurityEvent): Promise<RepositoryResponse<SecurityEvent>>;
  getByJobId(jobId: string): Promise<RepositoryResponse<SecurityEvent[]>>;
  list(limit?: number): Promise<RepositoryResponse<SecurityEvent[]>>;
}

export interface ServicesRepository {
  create(service: ServiceMetadata): Promise<RepositoryResponse<ServiceMetadata>>;
  getById(serviceId: string): Promise<RepositoryResponse<ServiceMetadata | null>>;
  getAll(): Promise<RepositoryResponse<ServiceMetadata[]>>;
  updateProductionEnabled(
    serviceId: string,
    enabled: boolean
  ): Promise<RepositoryResponse<ServiceMetadata>>;
}

export interface ServiceVersionsRepository {
  create(version: ServiceVersion): Promise<RepositoryResponse<ServiceVersion>>;
  getByServiceIdAndVersion(
    serviceId: string,
    version: string
  ): Promise<RepositoryResponse<ServiceVersion | null>>;
  listByServiceId(serviceId: string): Promise<RepositoryResponse<ServiceVersion[]>>;
}
