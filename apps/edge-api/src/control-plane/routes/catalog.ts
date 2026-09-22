import {
  getCatalogSecurity,
  getOpenApiSecurityDeclaration,
  getOpenApiSecurityOperationExtensions,
  getSecurityPublication,
} from '../security-publication';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateServiceError } from '@siteborne/contracts';
import type { ServicesRepository } from '../../control-plane/repositories/interfaces';
import type { Env } from '../config/env';
import {
  resolveEffectiveServiceRuntimeStatus,
  resolvePublicPaymentDestination,
  type EffectiveDiscoveryEnv,
} from '../config/production-payment';
import {
  CANONICAL_SCHEMA_ORIGIN,
  REGISTRY_SERVICES,
  ECONOMIC_SERVICE_IDS,
  V2_PAID_SERVICE_IDS,
  buildEconomicOffer,
  buildV2PaidOpenApiOperations,
  isEconomicServiceId,
  projectServiceEconomics,
  type EconomicOfferProjection,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';

interface DiscoveryServiceLike {
  service_id: string;
  price_usd: string;
  production_enabled: boolean;
  production_ready: boolean;
  protocol_status: 'preproduction' | 'production';
}

/** PRODUCTION-ECONOMICS-DISCOVERY-01: the economic fields the overlay adds to
 * every served service. `price_usd` stays for compatibility but is now a
 * projection of the canonical offer's unit price (see `price_unit`); the full
 * pricing function -- tiers, authorization ceiling, settlement model, modes,
 * limits, destination -- is in `economics`. */
interface DiscoveryEconomicFields {
  price_unit: 'request' | 'page';
  pricing_model: 'fixed_per_request' | 'metered_per_page_tiered';
  economics: EconomicOfferProjection;
}

/** Applies the version-local runtime-gate overlay to every service that
 * has a real production composition (SUN-1220P2, generalized SUN-1221C
 * from a single hardcoded `OVERLAY_SERVICE_ID` to
 * `EFFECTIVE_DISCOVERY_RESOLVERS`, a small per-service registry --
 * `production-payment.ts`'s own doc comment on that registry has the
 * full "prefer generic over another hardcoded chain" reasoning). A
 * service with NO entry in the registry is returned exactly as D1 has
 * it, unchanged (`OTHER_PAID_ROUTES_DISCOVERY_CHANGED_TO_ACTIVE=NO`).
 *
 * The shared D1 row (seeded `production_enabled=false`/
 * `protocol_status='preproduction'`, see `paid-services.ts`'s
 * `seedServices`, and never written by this checkpoint or any caller
 * today -- `updateProductionEnabled` has zero runtime callers) is never
 * itself written; this function instead fully DETERMINES the served
 * `production_enabled`/`production_ready`/`protocol_status` for each
 * registered service from that service's own version-local gates, in
 * BOTH directions -- not merely raising a false floor. Deliberately not
 * "OR with the static D1 value": SUN-1220P1 §7 proved a direct D1 write
 * to `true` would falsely activate a gated-off known-good version, and
 * an OR-shaped overlay would reopen exactly that hole the moment the
 * static value ever drifted from its seeded `false` for any reason --
 * overriding in both directions instead means a stale/drifted D1 value
 * can never leak through as "active" on a version whose runtime gates
 * are off, for ANY registered service, independently of every other
 * registered service's own gate state.
 *
 * SUN-1222C2-CANDIDATE-DISCOVERY-ECONOMICS-RECONCILIATION: `price_usd` is
 * seeded onto the same shared D1 row once (`seedServices`, insert-only, no
 * caller ever updates it) and had drifted from the governed price by the
 * time SUN-1000 checkpoint 1M/SUN-1222C-R3 later reduced the `.v2` services'
 * economics in `REGISTRY_SERVICES` -- `production_enabled`/
 * `protocol_status` already had a live overlay for exactly this "the static
 * D1 value can drift" reason, but `price_usd` did not. Every one of this
 * repository's four `SiteborneServiceId`s has a `REGISTRY_SERVICES` entry,
 * so this overlay applies unconditionally per-service (not gated on
 * `hasProductionExecutor`, since a stale advertised price is a discovery
 * defect regardless of production-executor status); a service_id absent
 * from the registry is returned with its D1 price unchanged. */
function overlayEffectiveDiscoveryStatus<T extends DiscoveryServiceLike>(
  service: T,
  env: EffectiveDiscoveryEnv | undefined,
  hasDb: boolean
): T & Partial<DiscoveryEconomicFields> {
  const effectiveStatus = resolveEffectiveServiceRuntimeStatus(
    service.service_id as SiteborneServiceId,
    env,
    hasDb
  );
  const productionEnabled = effectiveStatus.hasProductionExecutor
    ? effectiveStatus.productionEnabled
    : service.production_enabled;

  // A service_id outside the canonical contract is returned exactly as D1 has
  // it: no invented economics.
  const economicFields: Partial<DiscoveryEconomicFields> & { price_usd?: string } = {};
  if (isEconomicServiceId(service.service_id)) {
    const offer = buildEconomicOffer(service.service_id);
    const economics = projectServiceEconomics(service.service_id, {
      productionEnabled,
      destination: env ? resolvePublicPaymentDestination(env) : null,
    });
    economicFields.price_usd = economics.list_amount ?? economics.tier_prices?.[0]?.amount;
    economicFields.price_unit = economics.price_unit;
    economicFields.pricing_model = offer.pricingModel;
    economicFields.economics = economics;
  }
  const withEconomics = {
    ...service,
    ...economicFields,
    price_usd: economicFields.price_usd ?? service.price_usd,
  } as T & Partial<DiscoveryEconomicFields>;

  if (!effectiveStatus.hasProductionExecutor) return withEconomics;
  return {
    ...withEconomics,
    production_enabled: productionEnabled,
    production_ready: productionEnabled,
    protocol_status: productionEnabled ? 'production' : 'preproduction',
  };
}

export const catalogRoute = new Hono<{ Bindings: Env }>();

const EconomicsProjectionSchema = z
  .object({
    service_id: z.string(),
    capability_id: z.string(),
    service_version: z.enum(['v1', 'v2', 'v3']),
    contract_role: z.enum(['current', 'compatibility', 'candidate']),
    resource: z.string(),
    scheme: z.enum(['exact', 'upto']),
    pricing_model: z.enum(['fixed_per_request', 'metered_per_page_tiered']),
    currency: z.literal('USD'),
    price_unit: z.enum(['request', 'page']),
    amount_kind: z.enum(['exact', 'authorized_maximum']),
    list_amount: z.string().nullable(),
    authorization_maximum: z.string().nullable(),
    actual_settlement_model: z.enum([
      'equals_exact_amount',
      'measured_usage_not_exceeding_authorization',
    ]),
    tier_prices: z
      .array(
        z.object({
          tier: z.enum(['native', 'ocr', 'table']),
          unit: z.literal('page'),
          amount: z.string(),
        })
      )
      .nullable(),
    measured_usage_semantics: z.record(z.unknown()).nullable(),
    limits: z.object({ max_document_pages: z.number().int() }).nullable(),
    default_mode: z.string(),
    available_modes: z.array(z.string()),
    modes: z.array(
      z.object({
        mode: z.string(),
        amount: z.string(),
        amount_kind: z.enum(['exact', 'authorized_maximum']),
        unit: z.enum(['request', 'job']),
        price_defined: z.literal(true),
        capability_available: z.boolean(),
        unavailable_reason: z.string().optional(),
      })
    ),
    release_posture: z.enum([
      'first_release_candidate',
      'defined_not_production_admitted',
      'compatibility_not_admitted',
    ]),
    production_enabled: z.boolean(),
    payment: z.object({ network: z.string(), asset: z.string(), pay_to: z.string() }).nullable(),
    pricing_source_version: z.string(),
  })
  .strict();

// PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01: additive, optional security
// block derived from the canonical declaration (never authored here).
const CatalogSecurityBlockSchema = z.object({
  declaration: z.record(z.unknown()),
  modes: z.array(z.record(z.unknown())),
});

const ServiceCatalogEntrySchema = z.object({
  service_id: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  price_usd: z.string(),
  price_unit: z.enum(['request', 'page']).optional(),
  pricing_model: z.enum(['fixed_per_request', 'metered_per_page_tiered']).optional(),
  economics: EconomicsProjectionSchema.optional(),
  production_enabled: z.boolean(),
  production_ready: z.boolean(),
  protocol_status: z.enum(['preproduction', 'production']),
  input_schema_ref: z.string(),
  output_schema_ref: z.string(),
  security: CatalogSecurityBlockSchema.optional(),
});

const CatalogResponseSchema = z.object({
  services: z.array(ServiceCatalogEntrySchema),
  security_declaration: z.record(z.unknown()).optional(),
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
        // Canonical schema URIs (the schemas' own $id, published from
        // apps/network-site). The former `/schemas/<id>/input` paths are not
        // served by any route.
        input_schema_ref:
          REGISTRY_SERVICES[s.service_id as SiteborneServiceId]?.input_schema_uri ??
          `/schemas/${s.service_id}/input`,
        output_schema_ref:
          REGISTRY_SERVICES[s.service_id as SiteborneServiceId]?.output_schema_uri ??
          `/schemas/${s.service_id}/output`,
      },
      c.env,
      hasDb
    )
  );

  const response = {
    services: services.map((service) => {
      const security = getCatalogSecurity(service.service_id);
      return security ? { ...service, security } : service;
    }),
    security_declaration: { ...getSecurityPublication().ref },
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
  price_unit: z.enum(['request', 'page']).optional(),
  pricing_model: z.enum(['fixed_per_request', 'metered_per_page_tiered']).optional(),
  economics: EconomicsProjectionSchema.optional(),
  production_enabled: z.boolean(),
  production_ready: z.boolean(),
  protocol_status: z.enum(['preproduction', 'production']),
  input_schema: z.string(),
  output_schema: z.string(),
  security: CatalogSecurityBlockSchema.optional(),
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
    price_unit: service.price_unit,
    pricing_model: service.pricing_model,
    economics: service.economics,
    production_enabled: service.production_enabled,
    production_ready: service.production_ready,
    protocol_status: service.protocol_status,
    input_schema: service.input_schema,
    output_schema: service.output_schema,
    ...(getCatalogSecurity(service.service_id)
      ? { security: getCatalogSecurity(service.service_id) }
      : {}),
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
  // Canonical publication origin, not the request origin: this Worker does not
  // serve the schema files, so request-origin URLs would be dead links.
  const baseUrl = CANONICAL_SCHEMA_ORIGIN;
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
  // PRODUCTION-ECONOMICS-DISCOVERY-01: the four v2 paid operations, their
  // narrowed request schemas and canonical economics come from the one
  // generator in @siteborne/protocol-x402; OPERATIONAL facts (effective
  // production status, public payment destination) are read from real runtime
  // configuration, never authored here.
  const env = c.env as
    | (EffectiveDiscoveryEnv & Parameters<typeof resolvePublicPaymentDestination>[0])
    | undefined;
  const hasDb = Boolean((c.env as { DB?: unknown } | undefined)?.DB);
  const paid = buildV2PaidOpenApiOperations({
    destination: env ? resolvePublicPaymentDestination(env) : null,
    productionEnabled: Object.fromEntries(
      V2_PAID_SERVICE_IDS.map((id) => [
        id,
        resolveEffectiveServiceRuntimeStatus(id, env, hasDb).productionEnabled,
      ])
    ),
    securityOperationExtensions: getOpenApiSecurityOperationExtensions(V2_PAID_SERVICE_IDS),
  });
  const openapi = {
    // 3.1.0: the frozen service input schemas are JSON Schema 2020-12.
    openapi: '3.1.0',
    ...getOpenApiSecurityDeclaration(),
    info: {
      title: 'SITEBORNE Utility Network API',
      version: '0.0.0',
      description:
        'SITEBORNE production public runtime for autonomous agents. Paid service admission is disabled by policy for the initial quiescent release.',
      contact: {
        name: 'SITEBORNE',
        url: 'https://siteborne.net',
        email: 'ops@siteborne.net',
      },
      // No `url`: no license page is published at any canonical location, and a
      // dead canonical URL must not be projected.
      license: {
        name: 'Proprietary',
      },
    },
    servers: [{ url: `${baseUrl}`, description: 'Current environment' }],
    paths: {
      ...paid.paths,
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
                enum: [...ECONOMIC_SERVICE_IDS],
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
        ...paid.schemas,
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
                  price_usd: {
                    type: 'string',
                    description:
                      'Unit price of the default mode in USD: per request for fixed offers, per page (lowest tier) for metered offers -- never a job total. See price_unit and economics for the full pricing function.',
                  },
                  price_unit: { type: 'string', enum: ['request', 'page'] },
                  pricing_model: {
                    type: 'string',
                    enum: ['fixed_per_request', 'metered_per_page_tiered'],
                  },
                  economics: { $ref: '#/components/schemas/EconomicOfferProjection' },
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
            price_usd: {
              type: 'string',
              description:
                'Unit price of the default mode in USD: per request for fixed offers, per page (lowest tier) for metered offers -- never a job total. See price_unit and economics for the full pricing function.',
            },
            price_unit: { type: 'string', enum: ['request', 'page'] },
            pricing_model: {
              type: 'string',
              enum: ['fixed_per_request', 'metered_per_page_tiered'],
            },
            economics: { $ref: '#/components/schemas/EconomicOfferProjection' },
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
