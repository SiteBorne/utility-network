/**
 * Resolves each service's real planned HTTP route/method from the
 * accepted OpenAPI source (`contracts/releases/1.0.0/openapi/
 * service-contracts.openapi.json`, `x-service-id`/`x-implementation-status`
 * extension fields) — directive §9: never assumed, always read from the
 * accepted source material. No live HTTP route exists yet (every path is
 * `x-implementation-status: "not_implemented"`); this module only reads
 * the already-committed OpenAPI document, never queries a network.
 */
import openapiDoc from '../../../../contracts/releases/1.0.0/openapi/service-contracts.openapi.json' with { type: 'json' };
import type { SiteborneServiceId } from '../types';

interface OpenApiOperation {
  'x-service-id'?: string;
  'x-implementation-status'?: string;
  'x-production-enabled'?: boolean;
}

export interface ServiceRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  implementation_status: string;
  production_enabled: boolean;
}

export class ServiceRouteNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`no OpenAPI path declares x-service-id "${serviceId}"`);
    this.name = 'ServiceRouteNotFoundError';
  }
}

function buildRouteTable(): Record<string, ServiceRoute> {
  const paths = (openapiDoc as { paths: Record<string, Record<string, OpenApiOperation>> }).paths;
  const table: Record<string, ServiceRoute> = {};
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const serviceId = operation['x-service-id'];
      if (!serviceId) continue;
      table[serviceId] = {
        method: method.toUpperCase() as ServiceRoute['method'],
        path,
        implementation_status: operation['x-implementation-status'] ?? 'unknown',
        production_enabled: operation['x-production-enabled'] ?? false,
      };
    }
  }
  return table;
}

const ROUTE_TABLE = buildRouteTable();

/** Fails closed — an unknown service is a hard error, never a guessed
 * route. */
export function resolveServiceRoute(serviceId: SiteborneServiceId): ServiceRoute {
  const route = ROUTE_TABLE[serviceId];
  if (!route) {
    throw new ServiceRouteNotFoundError(serviceId);
  }
  return route;
}
