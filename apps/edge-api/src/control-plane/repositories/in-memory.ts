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
import type {
  JobsRepository,
  JobAttemptsRepository,
  StateEventsRepository,
  IdempotencyRepository,
  ArtifactsRepository,
  QueueDispatchRepository,
  QuotaRepository,
  AuditRepository,
  SecurityRepository,
  ServicesRepository,
  ServiceVersionsRepository,
} from './interfaces';
import { ok, err } from './interfaces';

class InMemoryStore<T extends { id: string }> {
  private store = new Map<string, T>();

  async create(item: T): Promise<T> {
    if (this.store.has(item.id)) {
      throw new Error(`Duplicate key: ${item.id}`);
    }
    this.store.set(item.id, item);
    return item;
  }

  async get(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async update(id: string, updater: (item: T) => T): Promise<T> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Not found: ${id}`);
    }
    const updated = updater(existing);
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async list(): Promise<T[]> {
    return Array.from(this.store.values());
  }

  entries(): IterableIterator<[string, T]> {
    return this.store.entries();
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryJobsRepository implements JobsRepository {
  private store = new InMemoryStore<Job>();
  private byIdempotencyKey = new Map<string, string>();

  async create(job: Job): Promise<ReturnType<JobsRepository['create']>> {
    try {
      await this.store.create(job);
      if (job.idempotency_key) {
        this.byIdempotencyKey.set(job.idempotency_key, job.id);
      }
      return ok(job);
    } catch {
      return err('DUPLICATE_JOB', 'Job already exists');
    }
  }

  async getById(id: string): Promise<ReturnType<JobsRepository['getById']>> {
    const job = await this.store.get(id);
    return ok(job);
  }

  async getByIdempotencyKey(
    key: string
  ): Promise<ReturnType<JobsRepository['getByIdempotencyKey']>> {
    const jobId = this.byIdempotencyKey.get(key);
    if (!jobId) return ok(null);
    const job = await this.store.get(jobId);
    return ok(job);
  }

  async updateState(
    id: string,
    state: Job['current_state'],
    attemptCount?: number
  ): Promise<ReturnType<JobsRepository['updateState']>> {
    try {
      const updated = await this.store.update(id, (job) => ({
        ...job,
        current_state: state,
        updated_at: new Date().toISOString(),
        attempt_count: attemptCount ?? job.attempt_count,
      }));
      return ok(updated);
    } catch {
      return err('JOB_NOT_FOUND', 'Job not found');
    }
  }

  async updateTimestamps(id: string): Promise<ReturnType<JobsRepository['updateTimestamps']>> {
    try {
      const updated = await this.store.update(id, (job: Job) => ({
        ...job,
        updated_at: new Date().toISOString(),
      }));
      return ok(updated);
    } catch {
      return err('JOB_NOT_FOUND', 'Job not found');
    }
  }

  async listByState(
    state: Job['current_state'],
    limit = 100
  ): Promise<ReturnType<JobsRepository['listByState']>> {
    const jobs = await this.store.list();
    return ok(jobs.filter((j: Job) => j.current_state === state).slice(0, limit));
  }

  clear(): void {
    this.store.clear();
    this.byIdempotencyKey.clear();
  }
}

export class InMemoryJobAttemptsRepository implements JobAttemptsRepository {
  private store = new InMemoryStore<JobAttempt>();
  private byJobId = new Map<string, JobAttempt[]>();

  async create(attempt: JobAttempt): Promise<ReturnType<JobAttemptsRepository['create']>> {
    try {
      await this.store.create(attempt);
      const list = this.byJobId.get(attempt.job_id) ?? [];
      list.push(attempt);
      this.byJobId.set(attempt.job_id, list);
      return ok(attempt);
    } catch {
      return err('DUPLICATE_ATTEMPT', 'Attempt already exists');
    }
  }

  async getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<ReturnType<JobAttemptsRepository['getByJobIdAndAttempt']>> {
    const list = this.byJobId.get(jobId) ?? [];
    return ok(list.find((attempt: JobAttempt) => attempt.attempt_number === attemptNumber) ?? null);
  }

  async update(attempt: JobAttempt): Promise<ReturnType<JobAttemptsRepository['update']>> {
    try {
      const updated = await this.store.update(attempt.id, () => attempt);
      const list = this.byJobId.get(attempt.job_id) ?? [];
      const idx = list.findIndex((attempt: JobAttempt) => attempt.id === attempt.id);
      if (idx >= 0) list[idx] = updated;
      return ok(updated);
    } catch {
      return err('ATTEMPT_NOT_FOUND', 'Attempt not found');
    }
  }

  async listByJobId(jobId: string): Promise<ReturnType<JobAttemptsRepository['listByJobId']>> {
    const list = this.byJobId.get(jobId) ?? [];
    return ok(
      [...list].sort((a: JobAttempt, b: JobAttempt) => a.attempt_number - b.attempt_number)
    );
  }

  clear(): void {
    this.store.clear();
    this.byJobId.clear();
  }
}

export class InMemoryStateEventsRepository implements StateEventsRepository {
  private store = new InMemoryStore<StateEvent>();
  private byJobId = new Map<string, StateEvent[]>();

  async create(event: StateEvent): Promise<ReturnType<StateEventsRepository['create']>> {
    try {
      await this.store.create(event);
      const list = this.byJobId.get(event.job_id) ?? [];
      list.push(event);
      this.byJobId.set(event.job_id, list);
      return ok(event);
    } catch {
      return err('DUPLICATE_EVENT', 'Event already exists');
    }
  }

  async getByJobId(jobId: string): Promise<ReturnType<StateEventsRepository['getByJobId']>> {
    const list = this.byJobId.get(jobId) ?? [];
    return ok(
      [...list].sort(
        (a: StateEvent, b: StateEvent) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    );
  }

  async getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<ReturnType<StateEventsRepository['getByJobIdAndAttempt']>> {
    const list = this.byJobId.get(jobId) ?? [];
    return ok(list.filter((event: StateEvent) => event.attempt_number === attemptNumber));
  }

  clear(): void {
    this.store.clear();
    this.byJobId.clear();
  }
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private store = new InMemoryStore<IdempotencyRecord>();
  private byKey = new Map<string, string>();

  async acquire(record: IdempotencyRecord): Promise<ReturnType<IdempotencyRepository['acquire']>> {
    try {
      await this.store.create(record);
      this.byKey.set(record.idempotency_key, record.id);
      return ok(record);
    } catch {
      return err('IDEMPOTENCY_CONFLICT', 'Idempotency key already exists');
    }
  }

  async getByKey(key: string): Promise<ReturnType<IdempotencyRepository['getByKey']>> {
    const id = this.byKey.get(key);
    if (!id) return ok(null);
    const record = await this.store.get(id);
    return ok(record);
  }

  async getByKeyAndInput(
    key: string,
    inputHash: string,
    inputSchemaHash: string
  ): Promise<ReturnType<IdempotencyRepository['getByKeyAndInput']>> {
    const record = await this.getByKey(key);
    if (!record.ok || !record.value) return ok(null);
    if (
      record.value.input_hash !== inputHash ||
      record.value.input_schema_hash !== inputSchemaHash
    ) {
      return ok(null);
    }
    return ok(record.value);
  }

  async updateResult(
    key: string,
    resultRef: string
  ): Promise<ReturnType<IdempotencyRepository['updateResult']>> {
    const record = await this.getByKey(key);
    if (!record.ok || !record.value) {
      return err('IDEMPOTENCY_NOT_FOUND', 'Idempotency record not found');
    }
    try {
      const updated = await this.store.update(record.value.id, (r) => ({
        ...r,
        original_result_ref: resultRef,
      }));
      return ok(updated);
    } catch {
      return err('IDEMPOTENCY_NOT_FOUND', 'Idempotency record not found');
    }
  }

  async deleteExpired(): Promise<ReturnType<IdempotencyRepository['deleteExpired']>> {
    const now = new Date().toISOString();
    let count = 0;
    for (const [id, record] of this.store['store'].entries()) {
      if (record.expires_at < now) {
        this.byKey.delete(record.idempotency_key);
        this.store.delete(id);
        count++;
      }
    }
    return ok(count);
  }

  clear(): void {
    this.store.clear();
    this.byKey.clear();
  }
}

export class InMemoryArtifactsRepository implements ArtifactsRepository {
  private store = new InMemoryStore<ArtifactRecord>();
  private byContentHash = new Map<string, string>();
  private byJobId = new Map<string, ArtifactRecord[]>();

  async create(artifact: ArtifactRecord): Promise<ReturnType<ArtifactsRepository['create']>> {
    try {
      await this.store.create(artifact);
      this.byContentHash.set(artifact.content_hash, artifact.id);
      const list = this.byJobId.get(artifact.job_id ?? '') ?? [];
      list.push(artifact);
      if (artifact.job_id) this.byJobId.set(artifact.job_id, list);
      return ok(artifact);
    } catch {
      return err('DUPLICATE_ARTIFACT', 'Artifact already exists');
    }
  }

  async getById(id: string): Promise<ReturnType<ArtifactsRepository['getById']>> {
    const artifact = await this.store.get(id);
    return ok(artifact);
  }

  async getByContentHash(
    hash: string
  ): Promise<ReturnType<ArtifactsRepository['getByContentHash']>> {
    const id = this.byContentHash.get(hash);
    if (!id) return ok(null);
    const artifact = await this.store.get(id);
    return ok(artifact);
  }

  async getByJobId(jobId: string): Promise<ReturnType<ArtifactsRepository['getByJobId']>> {
    const list = this.byJobId.get(jobId) ?? [];
    return ok([...list]);
  }

  async delete(id: string): Promise<ReturnType<ArtifactsRepository['delete']>> {
    const artifact = await this.store.get(id);
    if (!artifact) return ok(false);
    this.byContentHash.delete(artifact.content_hash);
    if (artifact.job_id) {
      const list = this.byJobId.get(artifact.job_id) ?? [];
      const idx = list.findIndex((a) => a.id === id);
      if (idx >= 0) list.splice(idx, 1);
    }
    await this.store.delete(id);
    return ok(true);
  }

  async deleteExpired(): Promise<ReturnType<ArtifactsRepository['deleteExpired']>> {
    const now = new Date().toISOString();
    let count = 0;
    for (const [id, artifact] of this.store.entries()) {
      if (artifact.expires_at && artifact.expires_at < now) {
        this.byContentHash.delete(artifact.content_hash);
        if (artifact.job_id) {
          const list = this.byJobId.get(artifact.job_id) ?? [];
          const idx = list.findIndex((a: ArtifactRecord) => a.id === id);
          if (idx >= 0) list.splice(idx, 1);
        }
        this.store.delete(id);
        count++;
      }
    }
    return ok(count);
  }

  clear(): void {
    this.store.clear();
    this.byContentHash.clear();
    this.byJobId.clear();
  }
}

export class InMemoryQueueDispatchRepository implements QueueDispatchRepository {
  private store = new InMemoryStore<QueueDispatch>();
  private byJobAttempt = new Map<string, string>();

  async create(dispatch: QueueDispatch): Promise<ReturnType<QueueDispatchRepository['create']>> {
    try {
      await this.store.create(dispatch);
      const key = `${dispatch.job_id}:${dispatch.attempt_number}`;
      this.byJobAttempt.set(key, dispatch.id);
      return ok(dispatch);
    } catch {
      return err('DUPLICATE_DISPATCH', 'Dispatch already exists');
    }
  }

  async getById(id: string): Promise<ReturnType<QueueDispatchRepository['getById']>> {
    const dispatch = await this.store.get(id);
    return ok(dispatch);
  }

  async getByJobIdAndAttempt(
    jobId: string,
    attemptNumber: number
  ): Promise<ReturnType<QueueDispatchRepository['getByJobIdAndAttempt']>> {
    const key = `${jobId}:${attemptNumber}`;
    const id = this.byJobAttempt.get(key);
    if (!id) return ok(null);
    const dispatch = await this.store.get(id);
    return ok(dispatch);
  }

  async updateRetryCount(
    id: string,
    retryCount: number
  ): Promise<ReturnType<QueueDispatchRepository['updateRetryCount']>> {
    try {
      const updated = await this.store.update(id, (d) => ({ ...d, retry_count: retryCount }));
      return ok(updated);
    } catch {
      return err('DISPATCH_NOT_FOUND', 'Dispatch not found');
    }
  }

  async listPending(limit = 100): Promise<ReturnType<QueueDispatchRepository['listPending']>> {
    const all = await this.store.list();
    return ok(all.slice(0, limit));
  }

  clear(): void {
    this.store.clear();
    this.byJobAttempt.clear();
  }
}

export class InMemoryQuotaRepository implements QuotaRepository {
  private store = new InMemoryStore<QuotaReservation>();
  private byJobId = new Map<string, string>();
  private byResourceClass = new Map<string, QuotaReservation[]>();

  async create(reservation: QuotaReservation): Promise<ReturnType<QuotaRepository['create']>> {
    try {
      await this.store.create(reservation);
      this.byJobId.set(reservation.job_id, reservation.id);
      const list = this.byResourceClass.get(reservation.resource_class) ?? [];
      list.push(reservation);
      this.byResourceClass.set(reservation.resource_class, list);
      return ok(reservation);
    } catch {
      return err('DUPLICATE_RESERVATION', 'Reservation already exists');
    }
  }

  async getByJobId(jobId: string): Promise<ReturnType<QuotaRepository['getByJobId']>> {
    const id = this.byJobId.get(jobId);
    if (!id) return ok(null);
    const reservation = await this.store.get(id);
    return ok(reservation);
  }

  async getByResourceClass(
    resourceClass: string
  ): Promise<ReturnType<QuotaRepository['getByResourceClass']>> {
    const list = this.byResourceClass.get(resourceClass) ?? [];
    return ok([...list]);
  }

  async release(jobId: string): Promise<ReturnType<QuotaRepository['release']>> {
    const id = this.byJobId.get(jobId);
    if (!id) return ok(false);
    try {
      await this.store.update(id, (r) => ({
        ...r,
        released_at: new Date().toISOString(),
        reserved_units: 0,
      }));
      return ok(true);
    } catch {
      return err('RESERVATION_NOT_FOUND', 'Reservation not found');
    }
  }

  async deleteExpired(): Promise<ReturnType<QuotaRepository['deleteExpired']>> {
    const now = new Date().toISOString();
    let count = 0;
    for (const [id, reservation] of this.store.entries()) {
      if (reservation.expires_at < now) {
        this.byJobId.delete(reservation.job_id);
        const list = this.byResourceClass.get(reservation.resource_class) ?? [];
        const idx = list.findIndex((r: QuotaReservation) => r.id === id);
        if (idx >= 0) list.splice(idx, 1);
        this.store.delete(id);
        count++;
      }
    }
    return ok(count);
  }

  clear(): void {
    this.store.clear();
    this.byJobId.clear();
    this.byResourceClass.clear();
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private store = new InMemoryStore<AuditEvent>();
  private byJobId = new Map<string, AuditEvent[]>();
  private byCorrelationId = new Map<string, AuditEvent[]>();

  async create(event: AuditEvent): Promise<ReturnType<AuditRepository['create']>> {
    try {
      await this.store.create(event);
      if (event.job_id) {
        const list = this.byJobId.get(event.job_id) ?? [];
        list.push(event);
        this.byJobId.set(event.job_id, list);
      }
      if (event.correlation_id) {
        const list = this.byCorrelationId.get(event.correlation_id) ?? [];
        list.push(event);
        this.byCorrelationId.set(event.correlation_id, list);
      }
      return ok(event);
    } catch {
      return err('DUPLICATE_AUDIT', 'Audit event already exists');
    }
  }

  async getByJobId(jobId: string): Promise<ReturnType<AuditRepository['getByJobId']>> {
    const list = this.byJobId.get(jobId) ?? [];
    return ok(
      [...list].sort(
        (a: AuditEvent, b: AuditEvent) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    );
  }

  async getByCorrelationId(
    correlationId: string
  ): Promise<ReturnType<AuditRepository['getByCorrelationId']>> {
    const list = this.byCorrelationId.get(correlationId) ?? [];
    return ok(
      [...list].sort(
        (a: AuditEvent, b: AuditEvent) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    );
  }

  async list(limit = 100): Promise<ReturnType<AuditRepository['list']>> {
    const all = await this.store.list();
    return ok(all.slice(-limit).reverse());
  }

  clear(): void {
    this.store.clear();
    this.byJobId.clear();
    this.byCorrelationId.clear();
  }
}

export class InMemorySecurityRepository implements SecurityRepository {
  private store = new InMemoryStore<SecurityEvent>();
  private byJobId = new Map<string, SecurityEvent[]>();

  async create(event: SecurityEvent): Promise<ReturnType<SecurityRepository['create']>> {
    try {
      await this.store.create(event);
      if (event.job_id) {
        const list = this.byJobId.get(event.job_id) ?? [];
        list.push(event);
        this.byJobId.set(event.job_id, list);
      }
      return ok(event);
    } catch {
      return err('DUPLICATE_SECURITY', 'Security event already exists');
    }
  }

  async getByJobId(jobId: string): Promise<ReturnType<SecurityRepository['getByJobId']>> {
    const list = this.byJobId.get(jobId) ?? [];
    return ok(
      [...list].sort(
        (a: SecurityEvent, b: SecurityEvent) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    );
  }

  async list(limit = 100): Promise<ReturnType<SecurityRepository['list']>> {
    const all = await this.store.list();
    return ok(all.slice(-limit).reverse());
  }

  clear(): void {
    this.store.clear();
    this.byJobId.clear();
  }
}

export class InMemoryServicesRepository implements ServicesRepository {
  private store = new Map<string, ServiceMetadata>();

  async create(service: ServiceMetadata): Promise<ReturnType<ServicesRepository['create']>> {
    try {
      if (this.store.has(service.service_id)) {
        return err('DUPLICATE_SERVICE', 'Service already exists');
      }
      this.store.set(service.service_id, service);
      return ok(service);
    } catch {
      return err('DUPLICATE_SERVICE', 'Service already exists');
    }
  }

  async getById(serviceId: string): Promise<ReturnType<ServicesRepository['getById']>> {
    const service = this.store.get(serviceId) ?? null;
    return ok(service);
  }

  async getAll(): Promise<ReturnType<ServicesRepository['getAll']>> {
    const all = Array.from(this.store.values());
    return ok(all);
  }

  async updateProductionEnabled(
    serviceId: string,
    enabled: boolean
  ): Promise<ReturnType<ServicesRepository['updateProductionEnabled']>> {
    const service = this.store.get(serviceId);
    if (!service) {
      return err('SERVICE_NOT_FOUND', 'Service not found');
    }
    const updated = { ...service, production_enabled: enabled };
    this.store.set(serviceId, updated);
    return ok(updated);
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryServiceVersionsRepository implements ServiceVersionsRepository {
  private store = new InMemoryStore<ServiceVersion>();
  private byServiceId = new Map<string, ServiceVersion[]>();

  async create(version: ServiceVersion): Promise<ReturnType<ServiceVersionsRepository['create']>> {
    try {
      await this.store.create(version);
      const list = this.byServiceId.get(version.service_id) ?? [];
      list.push(version);
      this.byServiceId.set(version.service_id, list);
      return ok(version);
    } catch {
      return err('DUPLICATE_VERSION', 'Service version already exists');
    }
  }

  async getByServiceIdAndVersion(
    serviceId: string,
    version: string
  ): Promise<ReturnType<ServiceVersionsRepository['getByServiceIdAndVersion']>> {
    const list = this.byServiceId.get(serviceId) ?? [];
    const v = list.find((v) => v.version === version) ?? null;
    return ok(v);
  }

  async listByServiceId(
    serviceId: string
  ): Promise<ReturnType<ServiceVersionsRepository['listByServiceId']>> {
    const list = this.byServiceId.get(serviceId) ?? [];
    return ok([...list]);
  }

  clear(): void {
    this.store.clear();
    this.byServiceId.clear();
  }
}

export function createInMemoryRepositories() {
  return {
    jobs: new InMemoryJobsRepository(),
    jobAttempts: new InMemoryJobAttemptsRepository(),
    stateEvents: new InMemoryStateEventsRepository(),
    idempotency: new InMemoryIdempotencyRepository(),
    artifacts: new InMemoryArtifactsRepository(),
    queueDispatch: new InMemoryQueueDispatchRepository(),
    quota: new InMemoryQuotaRepository(),
    audit: new InMemoryAuditRepository(),
    security: new InMemorySecurityRepository(),
    services: new InMemoryServicesRepository(),
    serviceVersions: new InMemoryServiceVersionsRepository(),
  };
}
