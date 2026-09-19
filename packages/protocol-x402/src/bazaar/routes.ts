/**
 * Resolves each service's real planned HTTP route/method from the
 * accepted OpenAPI source (`x-service-id`/`x-implementation-status`
 * extension fields) — directive §9: never assumed, always read from the
 * accepted source material. This module only reads an already-committed,
 * frozen OpenAPI document, never queries a network.
 *
 * SUN-1000 checkpoint 1M: previously hard-coded to
 * `contracts/releases/1.0.0/...` permanently — a real, disclosed landmine
 * (checkpoint 1L section 8, item 9): since this is a static, build-time
 * ES module JSON import (`resolveJsonModule`, required for Cloudflare
 * Worker compatibility — no `fs.readFileSync` is possible here), the
 * import path cannot be derived dynamically from
 * `contracts/CONTRACT_RELEASE.yaml` the way `compat.ts` was generalized
 * to do at checkpoint 1K-A. Instead this literal is now updated to the
 * new active release (`2.0.0`, checkpoint 1M's own governed release) —
 * the same discipline `frozen-inputs.ts`/`frozen-contracts.ts` apply, and
 * the reason those two are deliberately left pointed at `1.0.0`: their
 * imported request/output schema *content* is byte-identical between
 * releases (checkpoint 1L section 7), so repointing them serves no
 * purpose, while THIS module's route paths and implementation-status
 * genuinely differ per release and must track the real active contract.
 *
 * The v2-only `2.0.0` document no longer declares the four `.v1`
 * operations at all (checkpoint 1L section 25: "active OpenAPI = v2-only
 * forward contract"), so this module also statically imports the frozen
 * `1.0.1` document and merges both route tables — `.v1` service IDs
 * still resolve to their real, historical `/v1/...` path and
 * `not_implemented` status (needed by existing v1 regression tests and
 * Model D rail selection, which iterate every currently-known service
 * ID, v1 and v2 alike), while `.v2` IDs resolve from the new document.
 */
import openapiDocV1 from '../../../../contracts/releases/1.0.1/openapi/service-contracts.openapi.json' with { type: 'json' };
import openapiDocV2 from '../../../../contracts/releases/2.0.0/openapi/service-contracts.openapi.json' with { type: 'json' };
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

function addRoutesFrom(table: Record<string, ServiceRoute>, doc: unknown): void {
  const paths = (doc as { paths: Record<string, Record<string, OpenApiOperation>> }).paths;
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
}

function buildRouteTable(): Record<string, ServiceRoute> {
  const table: Record<string, ServiceRoute> = {};
  // v1 first, v2 second — a service ID present in both would take the v2
  // entry, but in practice the two documents' x-service-id sets are
  // disjoint (.v1 vs .v2), so this is simply a merge, never an override.
  addRoutesFrom(table, openapiDocV1);
  addRoutesFrom(table, openapiDocV2);
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

/** The one canonical public origin every discovery surface projects resource
 * URLs from (A2A card, MCP quotes, Bazaar declarations, catalog, OpenAPI).
 * Equality with `SITEBORNE_A2A_ORIGIN` is enforced by a parity test. */
export const CANONICAL_RESOURCE_ORIGIN = 'https://utility.siteborne.net';

/** The canonical origin of every published schema (`$id` host). The schema
 * files themselves are published from `apps/network-site/schemas`, derived from
 * the active contract release by scripts/generate-network-site-publication.mts. */
export const CANONICAL_SCHEMA_ORIGIN = 'https://siteborne.net';

/** Canonical resource URL for a service: canonical origin + the path the
 * accepted OpenAPI contract declares. Never hand-written per surface. */
export function canonicalResourceUrl(serviceId: SiteborneServiceId): string {
  return `${CANONICAL_RESOURCE_ORIGIN}${resolveServiceRoute(serviceId).path}`;
}
