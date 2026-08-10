import type { D1Database } from '@cloudflare/workers-types';
import type { ServiceMetadata, ServiceVersion } from '../../types';
import type {
  ServicesRepository,
  ServiceVersionsRepository,
  RepositoryResponse,
} from '../interfaces';
import { ok, err } from '../interfaces';
import {
  mapServiceMetadata,
  mapServiceVersion,
  toSingleRepositoryResponse,
  toRepositoryResponse,
} from './shared';

export class D1ServicesRepository implements ServicesRepository {
  constructor(private db: D1Database) {}

  async create(service: ServiceMetadata): Promise<RepositoryResponse<ServiceMetadata>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO services (id, version, title, description, input_schema, output_schema, price_usd, production_enabled, production_ready, protocol_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          service.service_id,
          service.version,
          service.title,
          service.description,
          service.input_schema,
          service.output_schema,
          service.price_usd,
          service.production_enabled ? 1 : 0,
          service.production_ready ? 1 : 0,
          service.protocol_status
        )
        .run();

      if (!result.success) {
        if (result.error?.includes('UNIQUE constraint')) {
          return err('DUPLICATE_SERVICE', 'Service already exists');
        }
        return err('DATABASE_ERROR', result.error ?? 'Failed to create service');
      }
      return ok(service);
    } catch (e) {
      // Real D1/Miniflare throws a JS exception on a UNIQUE constraint
      // violation rather than returning `{ success: false }` — the same
      // defect class documented in ADR 0045 for
      // D1PaymentAttemptRepository, surfaced here in SUN-0700A checkpoint
      // 5 the first time this method was actually exercised against real
      // D1 (no prior test ever called it).
      const message = e instanceof Error ? e.message : 'Unknown error';
      if (message.includes('UNIQUE constraint')) {
        return err('DUPLICATE_SERVICE', 'Service already exists');
      }
      return err('DATABASE_ERROR', message);
    }
  }

  async getById(serviceId: string): Promise<RepositoryResponse<ServiceMetadata | null>> {
    const stmt = this.db.prepare(`SELECT * FROM services WHERE id = ?`);
    const result = await stmt.bind(serviceId).all();
    return toSingleRepositoryResponse(result, mapServiceMetadata);
  }

  async getAll(): Promise<RepositoryResponse<ServiceMetadata[]>> {
    const stmt = this.db.prepare(`SELECT * FROM services`);
    const result = await stmt.all();
    return toRepositoryResponse(result, mapServiceMetadata);
  }

  async updateProductionEnabled(
    serviceId: string,
    enabled: boolean
  ): Promise<RepositoryResponse<ServiceMetadata>> {
    try {
      const stmt = this.db.prepare(`
        UPDATE services SET production_enabled = ?, updated_at = datetime('now') WHERE id = ?
      `);
      const result = await stmt.bind(enabled ? 1 : 0, serviceId).run();

      if (!result.success) {
        return err('DATABASE_ERROR', result.error ?? 'Failed to update service');
      }
      if (result.meta.changes === 0) {
        return err('SERVICE_NOT_FOUND', 'Service not found');
      }

      const getStmt = this.db.prepare(`SELECT * FROM services WHERE id = ?`);
      const getResult = await getStmt.bind(serviceId).all();
      return toSingleRepositoryResponse(getResult, mapServiceMetadata);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }
}

export class D1ServiceVersionsRepository implements ServiceVersionsRepository {
  constructor(private db: D1Database) {}

  async create(version: ServiceVersion): Promise<RepositoryResponse<ServiceVersion>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO service_versions (id, service_id, version, input_schema_hash, output_schema_hash, contract_release, pcc_dependency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = await stmt
        .bind(
          version.id,
          version.service_id,
          version.version,
          version.input_schema_hash,
          version.output_schema_hash,
          version.contract_release,
          version.pcc_dependency
        )
        .run();

      if (!result.success) {
        if (result.error?.includes('UNIQUE constraint')) {
          return err('DUPLICATE_VERSION', 'Service version already exists');
        }
        return err('DATABASE_ERROR', result.error ?? 'Failed to create service version');
      }
      return ok(version);
    } catch (e) {
      return err('DATABASE_ERROR', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async getByServiceIdAndVersion(
    serviceId: string,
    version: string
  ): Promise<RepositoryResponse<ServiceVersion | null>> {
    const stmt = this.db.prepare(`
      SELECT * FROM service_versions WHERE service_id = ? AND version = ?
    `);
    const result = await stmt.bind(serviceId, version).all();
    return toSingleRepositoryResponse(result, mapServiceVersion);
  }

  async listByServiceId(serviceId: string): Promise<RepositoryResponse<ServiceVersion[]>> {
    const stmt = this.db.prepare(`
      SELECT * FROM service_versions WHERE service_id = ? ORDER BY created_at
    `);
    const result = await stmt.bind(serviceId).all();
    return toRepositoryResponse(result, mapServiceVersion);
  }
}
