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
  /** SUN-1222C0 — physical reclamation's own read: every artifact record
   * created strictly before `olderThanIso` AND whose `expires_at` is
   * either absent or already `<= nowIso`, PLUS every row already in
   * 'reclaiming' regardless of age/expiry (R3-A3-ARTIFACT-RECLAIM-
   * OWNERSHIP-34: resumes a claim whose holder crashed mid-reclamation).
   *
   * SUN-1222C-DOCUMENT-ARTIFACT-LOCAL-CLOSURE-R2 §2 — the `expires_at`
   * half of this condition is load-bearing, not redundant with
   * `created_at`: `refreshExpiry()` (the expired-dedupe fix below) can
   * push a row's `expires_at` into the future WITHOUT touching
   * `created_at`. Before this fix, a row old enough to be
   * `created_at`-reclaimable but freshly refreshed by a dedup hit could
   * be physically deleted out from under a buyer who was just handed a
   * live (non-expired) `upload_id` for it — a real, provable "reclaimed
   * while still validly referenced" gap, not a hypothetical one. Requiring
   * `expires_at <= nowIso` closes it: reclamation now never deletes a row
   * a buyer currently holds a non-expired promise for, regardless of how
   * old `created_at` is. (Buyer-side consumption itself is synchronous and
   * immediate — `resolveUploadReference` reads D1 metadata and the R2
   * bytes inline, before any Workflow/job is created, and never holds a
   * reference beyond that single call — so no separate "nonterminal job
   * still needs this" linkage is needed to prove safety here; the
   * `expires_at` check alone is the complete invariant.) Returns full
   * records (not just ids) because the caller needs `content_hash` to
   * delete the matching R2 object before removing this row. */
  listReclaimable(
    olderThanIso: string,
    nowIso: string
  ): Promise<RepositoryResponse<ArtifactRecord[]>>;
  /** R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34 — `listReclaimable` is only
   * candidate discovery; a listed snapshot never authorizes deletion.
   * Atomically claims `id` for physical reclamation iff, against CURRENT
   * persisted state, it is unclaimed, `created_at < olderThanIso`, and its
   * `expires_at` is absent or `<= nowIso`. `true` = this caller now holds
   * reclaim authority; `false` = lost (renewed, deleted, or already
   * claimed). A claim never expires and is never reverted: the row only
   * leaves 'reclaiming' by being deleted (`deleteReclaimed`). */
  claimForReclamation(
    id: string,
    olderThanIso: string,
    nowIso: string,
    claimedAtIso: string
  ): Promise<RepositoryResponse<boolean>>;
  /** Idempotent, CAS-guarded final metadata delete: removes `id` only while
   * it is in 'reclaiming'. `false` = already gone. */
  deleteReclaimed(id: string): Promise<RepositoryResponse<boolean>>;
  /** SUN-1222C-document-artifact-production-closure — extends a still-live
   * or already-past-TTL artifact's `expires_at` in place, without touching
   * `content_hash`, `id`, or the underlying R2 object. Closes the
   * expired-dedupe gap in `storeDocumentUpload`: a content-addressed
   * dedup hit whose existing row's TTL already lapsed (physical
   * reclamation runs on a much longer, separate horizon — see
   * `../artifacts/artifact-reclamation.ts`) must never hand a buyer back
   * an `upload_id` that is dead on arrival at `resolveUploadReference`.
   * Returns `null` (not an error) if `id` no longer exists OR has been
   * claimed for reclamation (R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34: a
   * 'reclaiming' row is never renewed) — a concurrent physical reclamation
   * pass winning that race is a normal, expected outcome. */
  refreshExpiry(id: string, expiresAt: string): Promise<RepositoryResponse<ArtifactRecord | null>>;
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

/** SUN-1222C0-R1 — the distributed admission-control primitive behind
 * `document-ingress-admission-control.ts`'s two-axis (per-source/global)
 * storage-abuse guard. See that module's doc comment for why this is
 * D1-backed rather than Cloudflare's native Rate Limiting binding. */
/** SUN-1222C2-Q1-R2 — the aggregate, cross-isolate SEC fair-access
 * sliding-window rate primitive behind
 * `../rate-limit/sec-d1-rate-coordinator.ts`. Structural sibling of
 * `DocumentIngressAdmissionRepository` immediately below (same D1-backed,
 * single-atomic-statement admission pattern), but a genuine SLIDING
 * window (one row per admitted request) rather than a fixed-window
 * counter — see migration 0009's own doc comment for why. */
export interface SecRateWindowRepository {
  /** Atomically admits one request for `providerId` if and only if fewer
   * than `ceiling` rows exist for that provider with `requested_at_ms >=
   * windowStartMs` (i.e. within the trailing window ending at `nowMs`).
   * Also deletes rows older than `windowStartMs` for this provider in the
   * same call, so the table never grows unbounded. `admitted: true` iff
   * the row was actually inserted. */
  tryAdmit(
    providerId: string,
    nowMs: number,
    windowStartMs: number,
    ceiling: number
  ): Promise<RepositoryResponse<{ admitted: boolean }>>;
}

export interface DocumentIngressAdmissionRepository {
  /** Atomically increments the counter for `windowKey` if and only if its
   * current count is strictly below `limit`, creating the row (count=1)
   * if this is the window's first request. `admitted: true` iff the
   * increment actually happened — a single SQL statement (the D1
   * implementation's own doc comment explains why this is genuinely
   * atomic under concurrent callers, not merely "eventually
   * consistent"). `scope` and `windowStartMs` are stored alongside for
   * `deleteWindowsOlderThan` and observability; they play no role in the
   * admission decision itself. */
  admitAndIncrement(
    windowKey: string,
    scope: string,
    windowStartMs: number,
    limit: number
  ): Promise<RepositoryResponse<{ admitted: boolean }>>;
  /** Opportunistic cleanup of expired window rows — keeps this table's
   * own storage bounded (a rate limiter that itself accumulated
   * unbounded rows would not actually close the invariant this
   * checkpoint exists to prove). Failure here must never fail the
   * admission decision that triggered it; callers treat this as
   * best-effort. */
  deleteWindowsOlderThan(cutoffMs: number): Promise<RepositoryResponse<number>>;
}
