import type { D1Database } from '@cloudflare/workers-types';
import type { QuotaReservation, AuditEvent, SecurityEvent } from '../../types';
import type {
  QuotaRepository,
  AuditRepository,
  SecurityRepository,
  RepositoryResponse,
} from '../interfaces';
import { ok, err } from '../interfaces';
import {
  mapQuotaReservation,
  mapAuditEvent,
  mapSecurityEvent,
  toSingleRepositoryResponse,
  toRepositoryResponse,
} from './shared';

export class D1QuotaRepository implements QuotaRepository {
  constructor(private db: D1Database) {}

  async create(reservation: QuotaReservation): Promise<RepositoryResponse<QuotaReservation>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO quota_reservations (
          id, job_id, resource_class, requested_units, remaining_units, reserved_units,
          replacement_cost, scarcity_multiplier, failure_risk_multiplier, max_authorized_cost,
          paid_overflow_enabled, reserved_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          reservation.id,
          reservation.job_id,
          reservation.resource_class,
          reservation.requested_units,
          reservation.remaining_units,
          reservation.reserved_units,
          reservation.replacement_cost,
          reservation.scarcity_multiplier,
          reservation.failure_risk_multiplier,
          reservation.max_authorized_cost,
          reservation.paid_overflow_enabled ? 1 : 0,
          reservation.reserved_at,
          reservation.expires_at
        )
        .run();

      if (!result.success) {
        if (result.error?.includes('UNIQUE constraint')) {
          return err('DUPLICATE_RESERVATION', 'Reservation already exists');
        }
        return err('DATABASE_ERROR', result.error ?? 'Failed to create reservation');
      }
      return ok(reservation);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getByJobId(jobId: string): Promise<RepositoryResponse<QuotaReservation | null>> {
    const stmt = this.db.prepare(`SELECT * FROM quota_reservations WHERE job_id = ?`);
    const result = await stmt.bind(jobId).all();
    return toSingleRepositoryResponse(result, mapQuotaReservation);
  }

  async getByResourceClass(resourceClass: string): Promise<RepositoryResponse<QuotaReservation[]>> {
    const stmt = this.db.prepare(`SELECT * FROM quota_reservations WHERE resource_class = ?`);
    const result = await stmt.bind(resourceClass).all();
    return toRepositoryResponse(result, mapQuotaReservation);
  }

  async release(jobId: string): Promise<RepositoryResponse<boolean>> {
    try {
      const stmt = this.db.prepare(`
        UPDATE quota_reservations SET
          released_at = datetime('now'),
          reserved_units = 0
        WHERE job_id = ?
      `);
      const result = await stmt.bind(jobId).run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to release reservation');
      }
      return ok(result.meta.changes > 0);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async deleteExpired(): Promise<RepositoryResponse<number>> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM quota_reservations WHERE expires_at < datetime('now')
      `);
      const result = await stmt.run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to delete expired reservations');
      }
      return ok(result.meta.changes);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }
}

export class D1AuditRepository implements AuditRepository {
  constructor(private db: D1Database) {}

  async create(event: AuditEvent): Promise<RepositoryResponse<AuditEvent>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO audit_events (
          id, event_type, job_id, attempt_number, service_id, actor, details, timestamp, correlation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          event.id,
          event.event_type,
          event.job_id ?? null,
          event.attempt_number ?? null,
          event.service_id ?? null,
          event.actor,
          JSON.stringify(event.details),
          event.timestamp,
          event.correlation_id ?? null
        )
        .run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to create audit event');
      }
      return ok(event);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getByJobId(jobId: string): Promise<RepositoryResponse<AuditEvent[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_events WHERE job_id = ? ORDER BY timestamp
    `);
    const result = await stmt.bind(jobId).all();
    return toRepositoryResponse(result, mapAuditEvent);
  }

  async getByCorrelationId(correlationId: string): Promise<RepositoryResponse<AuditEvent[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_events WHERE correlation_id = ? ORDER BY timestamp
    `);
    const result = await stmt.bind(correlationId).all();
    return toRepositoryResponse(result, mapAuditEvent);
  }

  async list(limit = 100): Promise<RepositoryResponse<AuditEvent[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ?
    `);
    const result = await stmt.bind(limit).all();
    return toRepositoryResponse(result, mapAuditEvent);
  }
}

export class D1SecurityRepository implements SecurityRepository {
  constructor(private db: D1Database) {}

  async create(event: SecurityEvent): Promise<RepositoryResponse<SecurityEvent>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO security_events (
          id, event_type, job_id, attempt_number, service_id, details, timestamp, correlation_id, severity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          event.id,
          event.event_type,
          event.job_id ?? null,
          event.attempt_number ?? null,
          event.service_id ?? null,
          JSON.stringify(event.details),
          event.timestamp,
          event.correlation_id ?? null,
          event.severity
        )
        .run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to create security event');
      }
      return ok(event);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getByJobId(jobId: string): Promise<RepositoryResponse<SecurityEvent[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM security_events WHERE job_id = ? ORDER BY timestamp
    `);
    const result = await stmt.bind(jobId).all();
    return toRepositoryResponse(result, mapSecurityEvent);
  }

  async list(limit = 100): Promise<RepositoryResponse<SecurityEvent[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM security_events ORDER BY timestamp DESC LIMIT ?
    `);
    const result = await stmt.bind(limit).all();
    return toRepositoryResponse(result, mapSecurityEvent);
  }
}
