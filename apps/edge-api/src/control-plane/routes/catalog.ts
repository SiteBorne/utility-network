import { Hono } from 'hono';
import { z } from 'zod';
import { validateServiceError } from '@siteborne/contracts';
import type { ServicesRepository } from '../../control-plane/repositories/interfaces';
import type { Env } from '../config/env';
import {
  resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus,
  type VerifyAgentOutputV2CdpDiscoveryEnv,
} from '../config/production-payment';

/** SUN-1220P2 -- the one service this checkpoint's discovery overlay
 * applies to. Every other row is served exactly as D1 has it, unchanged
 * (`OTHER_11_PAID_ROUTES_DISCOVERY_CHANGED_TO_ACTIVE=NO`). */
const OVERLAY_SERVICE_ID = 'verify_agent_output.v2';

interface DiscoveryServiceLike {
  service_id: string;
  production_enabled: boolean;
  production_ready: boolean;
  protocol_status: 'preproduction' | 'production';
}

/** Applies the version-local runtime-gate overlay to the one static D1
 * row this checkpoint governs. The shared D1 row (seeded
 * `production_enabled=false`/`protocol_status='preproduction'`, see
 * `paid-services.ts`'s `seedServices`, and never written by this
 * checkpoint or any caller today -- `updateProductionEnabled` has zero
 * runtime callers) is never itself written; this function instead fully
 * DETERMINES the served `production_enabled`/`production_ready`/
 * `protocol_status` for this one service from the identical
 * version-local gates that unlock real execution
 * (`isVerifyAgentOutputV2CdpRouteFlagEnabled` + the four ADR-0055 gates
 * + required-binding presence -- see
 * `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`'s own doc
 * comment), in BOTH directions -- not merely raising a false floor.
 * Deliberately not "OR with the static D1 value": SUN-1220P1 §7 proved a
 * direct D1 write to `true` would falsely activate a gated-off
 * known-good version, and an OR-shaped overlay would reopen exactly
 * that hole the moment the static value ever drifted from its seeded
 * `false` for any reason -- overriding in both directions instead means
 * a stale/drifted D1 value can never leak through as "active" on a
 * version whose runtime gates are off. Every other service's row is
 * returned completely untouched. */
function overlayEffectiveDiscoveryStatus<T extends DiscoveryServiceLike>(
  service: T,
  env: VerifyAgentOutputV2CdpDiscoveryEnv | undefined,
  hasDb: boolean
): T {
  if (service.service_id !== OVERLAY_SERVICE_ID) return service;
  const effectivelyActive = env
    ? resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus(env, hasDb)
    : false;
  return {
    ...service,
    production_enabled: effectivelyActive,
    production_ready: effectivelyActive,
    protocol_status: effectivelyActive ? 'production' : 'preproduction',
  };
}

export const catalogRoute = new Hono<{ Bindings: Env }>();

const ServiceCatalogEntrySchema = z.object({
  service_id: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  price_usd: z.string(),
  production_enabled: z.boolean(),
  production_ready: z.boolean(),
  protocol_status: z.enum(['preproduction', 'production']),
  input_schema_ref: z.string(),
  output_schema_ref: z.string(),
});

const CatalogResponseSchema = z.object({
  services: z.array(ServiceCatalogEntrySchema),
  contract_release: z.string(),
  pcc_version: z.string(),
  generated_at: z.string().datetime({ offset: true }),
});

catalogRoute.get('/', async (c) => {
  const repo = c.get('servicesRepo') as ServicesRepository;
  const result = await repo.getAll();

  if (!result.ok) {
    return c.json(
      validateServiceError({
        code: 'CATALOG_ERROR',
        message: 'Failed to retrieve service catalog',
        request_id: crypto.randomUUID(),
      }),
      500
    );
  }

  const hasDb = Boolean(c.env?.DB);
  const services = result.value.map((s) =>
    overlayEffectiveDiscoveryStatus(
      {
        service_id: s.service_id,
        version: s.version,
        title: s.title,
        description: s.description,
        price_usd: s.price_usd,
        production_enabled: s.production_enabled,
        production_ready: s.production_ready,
        protocol_status: s.protocol_status,
        input_schema_ref: `/schemas/${s.service_id}/input`,
        output_schema_ref: `/schemas/${s.service_id}/output`,
      },
      c.env,
      hasDb
    )
  );

  const response = {
    services,
    contract_release: '1.0.0',
    pcc_version: '1.0.0',
    generated_at: new Date().toISOString(),
  };

  return c.json(CatalogResponseSchema.parse(response));
});

export const serviceMetadataRoute = new Hono<{ Bindings: Env }>();

const ServiceMetadataResponseSchema = z.object({
  service_id: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  price_usd: z.string(),
  production_enabled: z.boolean(),
  production_ready: z.boolean(),
  protocol_status: z.enum(['preproduction', 'production']),
  input_schema: z.string(),
  output_schema: z.string(),
  bounds: z
    .object({
      max_input_bytes: z.number(),
      max_output_bytes: z.number(),
      max_execution_time_seconds: z.number(),
    })
    .optional(),
});

serviceMetadataRoute.get('/:service_id', async (c) => {
  const serviceId = c.req.param('service_id');
  const repo = c.get('servicesRepo') as ServicesRepository;

  const result = await repo.getById(serviceId);

  if (!result.ok) {
    return c.json(
      validateServiceError({
        code: 'SERVICE_NOT_FOUND',
        message: `Service ${serviceId} not found`,
        request_id: crypto.randomUUID(),
      }),
      404
    );
  }

  if (!result.value) {
    return c.json(
      validateServiceError({
        code: 'SERVICE_NOT_FOUND',
        message: `Service ${serviceId} not found`,
        request_id: crypto.randomUUID(),
      }),
      404
    );
  }

  const service = overlayEffectiveDiscoveryStatus(result.value, c.env, Boolean(c.env?.DB));
  const response = {
    service_id: service.service_id,
    version: service.version,
    title: service.title,
    description: service.description,
    price_usd: service.price_usd,
    production_enabled: service.production_enabled,
    production_ready: service.production_ready,
    protocol_status: service.protocol_status,
    input_schema: service.input_schema,
    output_schema: service.output_schema,
    bounds: {
      max_input_bytes: 10 * 1024 * 1024,
      max_output_bytes: 50 * 1024 * 1024,
      max_execution_time_seconds: 300,
    },
  };

  return c.json(ServiceMetadataResponseSchema.parse(response));
});

export const schemasRoute = new Hono();

const SchemaResponseSchema = z.object({
  schemas: z.record(z.string()),
  contract_release: z.string(),
  pcc_version: z.string(),
  generated_at: z.string().datetime({ offset: true }),
});

schemasRoute.get('/', async (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const response = {
    schemas: {
      'proof-carrying-context': `${baseUrl}/schemas/proof-carrying-context.schema.json`,
      'common/money': `${baseUrl}/schemas/common/money.schema.json`,
      'common/request-envelope': `${baseUrl}/schemas/common/request-envelope.schema.json`,
      'common/quote-request': `${baseUrl}/schemas/common/quote-request.schema.json`,
      'common/quote-response': `${baseUrl}/schemas/common/quote-response.schema.json`,
      'common/structured-error': `${baseUrl}/schemas/common/structured-error.schema.json`,
      'common/service-metadata': `${baseUrl}/schemas/common/service-metadata.schema.json`,
      'common/async-job': `${baseUrl}/schemas/common/async-job.schema.json`,
      'common/pagination': `${baseUrl}/schemas/common/pagination.schema.json`,
      'common/authorized-artifact-reference': `${baseUrl}/schemas/common/authorized-artifact-reference.schema.json`,
      'services/company-evidence-input': `${baseUrl}/schemas/services/company-evidence-input.schema.json`,
      'services/company-evidence-output': `${baseUrl}/schemas/services/company-evidence-output.schema.json`,
      'services/web-context-input': `${baseUrl}/schemas/services/web-context-input.schema.json`,
      'services/web-context-output': `${baseUrl}/schemas/services/web-context-output.schema.json`,
      'services/document-evidence-input': `${baseUrl}/schemas/services/document-evidence-input.schema.json`,
      'services/document-evidence-output': `${baseUrl}/schemas/services/document-evidence-output.schema.json`,
      'services/agent-verification-input': `${baseUrl}/schemas/services/agent-verification-input.schema.json`,
      'services/agent-verification-output': `${baseUrl}/schemas/services/agent-verification-output.schema.json`,
    },
    contract_release: '1.0.0',
    pcc_version: '1.0.0',
    generated_at: new Date().toISOString(),
  };

  return c.json(SchemaResponseSchema.parse(response));
});

export const openapiRoute = new Hono();

openapiRoute.get('/openapi.json', async (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const openapi = {
    openapi: '3.0.3',
    info: {
      title: 'SITEBORNE Utility Network API',
      version: '0.0.0-preproduction',
      description:
        'Preproduction API for SITEBORNE Utility Network - Machine-native utility network for autonomous agents',
      contact: {
        name: 'SITEBORNE',
        url: 'https://siteborne.net',
        email: 'ops@siteborne.net',
      },
      license: {
        name: 'Proprietary',
        url: 'https://siteborne.net/license',
      },
    },
    servers: [{ url: `${baseUrl}`, description: 'Current environment' }],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          operationId: 'health',
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/ready': {
        get: {
          summary: 'Readiness check',
          operationId: 'ready',
          responses: {
            '200': {
              description: 'Readiness status',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReadinessResponse' },
                },
              },
            },
          },
        },
      },
      '/catalog': {
        get: {
          summary: 'Service catalog',
          operationId: 'catalog',
          responses: {
            '200': {
              description: 'Available services',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CatalogResponse' },
                },
              },
            },
          },
        },
      },
      '/schemas': {
        get: {
          summary: 'Schema references',
          operationId: 'schemas',
          responses: {
            '200': {
              description: 'Schema reference list',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SchemaResponse' },
                },
              },
            },
          },
        },
      },
      '/benchmarks': {
        get: {
          summary: 'Fixed local benchmark evidence',
          operationId: 'benchmarks',
          responses: {
            '200': {
              description: 'Disclosed local measurement evidence (not a production SLA)',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BenchmarksResponse' },
                },
              },
            },
          },
        },
      },
      '/services/{service_id}': {
        get: {
          summary: 'Service metadata',
          operationId: 'serviceMetadata',
          parameters: [
            {
              name: 'service_id',
              in: 'path',
              required: true,
              schema: {
                type: 'string',
                enum: [
                  'company_evidence_graph.v1',
                  'web_context_verified.v1',
                  'document_evidence_json.v1',
                  'verify_agent_output.v1',
                ],
              },
            },
          ],
          responses: {
            '200': {
              description: 'Service metadata',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ServiceMetadataResponse' },
                },
              },
            },
            '404': {
              description: 'Service not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ServiceError' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
            timestamp: { type: 'string', format: 'date-time' },
            version: { type: 'string' },
            uptime_seconds: { type: 'integer', minimum: 0 },
          },
          required: ['status', 'timestamp', 'version', 'uptime_seconds'],
        },
        ReadinessResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ready', 'not_ready'] },
            phase: { type: 'string' },
            production_services_enabled: { type: 'boolean' },
            blocked_external: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string' },
          },
          required: [
            'status',
            'phase',
            'production_services_enabled',
            'blocked_external',
            'reason',
          ],
        },
        CatalogResponse: {
          type: 'object',
          properties: {
            services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  service_id: { type: 'string' },
                  version: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  price_usd: { type: 'string' },
                  production_enabled: { type: 'boolean' },
                  production_ready: { type: 'boolean' },
                  protocol_status: { type: 'string', enum: ['preproduction', 'production'] },
                  input_schema_ref: { type: 'string' },
                  output_schema_ref: { type: 'string' },
                },
                required: [
                  'service_id',
                  'version',
                  'title',
                  'description',
                  'price_usd',
                  'production_enabled',
                  'production_ready',
                  'protocol_status',
                  'input_schema_ref',
                  'output_schema_ref',
                ],
              },
            },
            contract_release: { type: 'string' },
            pcc_version: { type: 'string' },
            generated_at: { type: 'string', format: 'date-time' },
          },
          required: ['services', 'contract_release', 'pcc_version', 'generated_at'],
        },
        SchemaResponse: {
          type: 'object',
          properties: {
            schemas: { type: 'object', additionalProperties: { type: 'string' } },
            contract_release: { type: 'string' },
            pcc_version: { type: 'string' },
            generated_at: { type: 'string', format: 'date-time' },
          },
          required: ['schemas', 'contract_release', 'pcc_version', 'generated_at'],
        },
        ServiceMetadataResponse: {
          type: 'object',
          properties: {
            service_id: { type: 'string' },
            version: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            price_usd: { type: 'string' },
            production_enabled: { type: 'boolean' },
            production_ready: { type: 'boolean' },
            protocol_status: { type: 'string', enum: ['preproduction', 'production'] },
            input_schema: { type: 'string' },
            output_schema: { type: 'string' },
            bounds: {
              type: 'object',
              properties: {
                max_input_bytes: { type: 'integer' },
                max_output_bytes: { type: 'integer' },
                max_execution_time_seconds: { type: 'integer' },
              },
            },
          },
          required: [
            'service_id',
            'version',
            'title',
            'description',
            'price_usd',
            'production_enabled',
            'production_ready',
            'protocol_status',
            'input_schema',
            'output_schema',
          ],
        },
        BenchmarksResponse: {
          type: 'object',
          properties: {
            disclosure: { type: 'string' },
            document_worker_local_benchmarks: { type: 'object' },
            v2_load_capacity_baseline: { type: 'object' },
            generated_at: { type: 'string', format: 'date-time' },
          },
          required: [
            'disclosure',
            'document_worker_local_benchmarks',
            'v2_load_capacity_baseline',
            'generated_at',
          ],
        },
        ServiceError: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'object' },
            request_id: { type: 'string' },
          },
          required: ['code', 'message', 'request_id'],
        },
      },
    },
  };

  return c.json(openapi);
});
