/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- the OpenAPI description of the four
 * current v2 paid operations, generated from the canonical sources and nothing
 * else:
 *
 *   - identity / method / path : the accepted OpenAPI route table (`routes.ts`)
 *   - request schema           : the frozen bundled input schema, with each
 *                                mode selector narrowed to the modes the
 *                                canonical contract says are AVAILABLE
 *   - economics                : `projectServiceEconomics` (embedded verbatim
 *                                as `x-siteborne-economics`; no price literal
 *                                is written in this file)
 *   - page limit               : the governed `max_document_pages`
 *
 * The frozen contract schemas are never modified: narrowing happens on a deep
 * copy, and a defined-but-unavailable mode is listed under
 * `x-siteborne-unavailable-modes` rather than silently dropped.
 */
import {
  ECONOMIC_SERVICE_IDS,
  buildEconomicOffer,
  projectServiceEconomics,
  resolveMaxDocumentPages,
  type PaymentDestination,
} from '../pricing/economic';
import { BUNDLED_SERVICE_INPUT_SCHEMAS } from '../bazaar/frozen-inputs';
import { purchasableInputExample } from '../bazaar/purchasable-example';
import { REGISTRY_SERVICES } from '../bazaar/registry-source';
import { canonicalResourceUrl, resolveServiceRoute } from '../bazaar/routes';
import { stripDocumentIdentity } from '../bazaar/schema-bundle';
import type { SiteborneServiceId } from '../types';

/** The four current (v2) commercial identities, in declared order. */
export const V2_PAID_SERVICE_IDS = ECONOMIC_SERVICE_IDS.filter((id) =>
  id.endsWith('.v2')
) as readonly SiteborneServiceId[];

const COMPONENT_NAMES: Readonly<Record<string, string>> = {
  company_evidence_graph: 'CompanyEvidenceGraph',
  web_context_verified: 'WebContextVerified',
  document_evidence_json: 'DocumentEvidenceJson',
  verify_agent_output: 'VerifyAgentOutput',
};

function componentName(serviceId: SiteborneServiceId): string {
  return COMPONENT_NAMES[serviceId.slice(0, serviceId.lastIndexOf('.'))];
}

export interface PaidOperationsRuntime {
  /** OPERATIONAL public payment destination; `null` = not configured. */
  readonly destination: PaymentDestination | null;
  /** OPERATIONAL effective production status per service. */
  readonly productionEnabled: Readonly<Partial<Record<SiteborneServiceId, boolean>>>;
}

/** Deep copy of the frozen input schema with mode selectors narrowed to
 * available modes and the sample replaced by the purchasable example. */
export function buildV2InputSchema(serviceId: SiteborneServiceId): Record<string, unknown> {
  const schema = structuredClone(
    stripDocumentIdentity(BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId])
  ) as Record<string, unknown>;
  const offer = buildEconomicOffer(serviceId);
  const field = offer.modeSelectorField;
  const property = field
    ? ((schema.properties as Record<string, Record<string, unknown>> | undefined)?.[field] ??
      undefined)
    : undefined;
  if (field && property && Array.isArray(property.enum)) {
    property.enum = (property.enum as string[]).filter(
      (value) => offer.modes.find((mode) => mode.mode === value)?.available !== false
    );
    const unavailable = offer.modes.filter((mode) => !mode.available);
    if (unavailable.length > 0) {
      property['x-siteborne-unavailable-modes'] = unavailable.map((mode) => ({
        mode: mode.mode,
        price_defined: true,
        capability_available: false,
        reason: mode.unavailableReason,
      }));
    }
  }
  schema.examples = [purchasableInputExample(serviceId)];
  return schema;
}

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/PaidServiceError' } } },
  };
}

function operationFor(serviceId: SiteborneServiceId, runtime: PaidOperationsRuntime) {
  const registry = REGISTRY_SERVICES[serviceId];
  const offer = buildEconomicOffer(serviceId);
  const name = componentName(serviceId);
  const economics = projectServiceEconomics(serviceId, {
    productionEnabled: runtime.productionEnabled[serviceId] ?? false,
    destination: runtime.destination,
  });
  const availableModes = offer.modes.filter((mode) => mode.available).map((mode) => mode.mode);
  const unavailableModes = offer.modes.filter((mode) => !mode.available).map((mode) => mode.mode);
  const notes: string[] = [];
  if (unavailableModes.length > 0) {
    notes.push(
      `Available modes: ${availableModes.join(', ')}. Modes with a defined price but no production implementation (${unavailableModes.join(', ')}) are rejected with HTTP 400 before any payment challenge.`
    );
  }
  if (offer.maxDocumentPages !== null) {
    notes.push(
      `Maximum ${offer.maxDocumentPages} pages per job. The 402 challenge authorizes a maximum (scheme upto); the charge settles at measured per-page usage and never exceeds it.`
    );
  }
  notes.push(
    'Economics (price, scheme, tiers, settlement, modes, network/asset/payTo) are in x-siteborne-economics.'
  );
  const route = resolveServiceRoute(serviceId);
  return {
    [route.method.toLowerCase()]: {
      operationId: `${name.charAt(0).toLowerCase()}${name.slice(1)}V2`,
      summary: `${registry.title} (v2)`,
      description: `${registry.description} ${notes.join(' ')}`,
      tags: ['paid-services'],
      'x-service-id': serviceId,
      'x-siteborne-economics': economics,
      'x-x402': {
        scheme: economics.scheme,
        resource: canonicalResourceUrl(serviceId),
        payment_required_header: 'PAYMENT-REQUIRED',
        payment_signature_header: 'PAYMENT-SIGNATURE',
        payment_response_header: 'PAYMENT-RESPONSE',
      },
      parameters: [
        {
          name: 'PAYMENT-SIGNATURE',
          in: 'header',
          required: false,
          description:
            'x402 payment payload. Omit on the first call to receive the 402 challenge; retry the identical request body with this header to pay.',
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${name}V2Input` } },
        },
      },
      responses: {
        '200': {
          description:
            'Paid result: a proof-carrying-context document bound to this request and payment.',
          headers: {
            'PAYMENT-RESPONSE': {
              description: 'x402 settlement response.',
              schema: { type: 'string' },
            },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Service result; see the output schema for its exact shape.',
                'x-output-schema-uri': registry.output_schema_uri,
              },
            },
          },
        },
        '400': errorResponse(
          'Invalid request: schema violation, unsupported request content, or an unavailable mode. No quote was created and nothing was charged.'
        ),
        '402': {
          description:
            'Payment required. The PAYMENT-REQUIRED header carries the x402 requirement; it matches x-siteborne-economics.',
          headers: {
            'PAYMENT-REQUIRED': {
              description: 'Base64 x402 payment requirement.',
              schema: { type: 'string' },
            },
          },
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PaidServiceError' } },
          },
        },
        '404': errorResponse(
          'The paid route is not enabled on the serving deployment (paid execution is disabled by policy).'
        ),
        '503': errorResponse('The governed service executor is not configured.'),
      },
    },
  };
}

/** Component schema for the embedded canonical economics projection. */
export const ECONOMIC_PROJECTION_COMPONENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description:
    'The canonical SITEBORNE economic contract for one service. Identical on every discovery surface.',
  required: [
    'service_id',
    'capability_id',
    'service_version',
    'contract_role',
    'resource',
    'scheme',
    'pricing_model',
    'currency',
    'price_unit',
    'amount_kind',
    'list_amount',
    'authorization_maximum',
    'actual_settlement_model',
    'tier_prices',
    'measured_usage_semantics',
    'limits',
    'default_mode',
    'available_modes',
    'modes',
    'release_posture',
    'production_enabled',
    'payment',
    'pricing_source_version',
  ],
  properties: {
    service_id: { type: 'string' },
    capability_id: { type: 'string' },
    service_version: { type: 'string', enum: ['v1', 'v2'] },
    contract_role: { type: 'string', enum: ['current', 'compatibility'] },
    resource: { type: 'string' },
    scheme: { type: 'string', enum: ['exact', 'upto'] },
    pricing_model: { type: 'string', enum: ['fixed_per_request', 'metered_per_page_tiered'] },
    currency: { type: 'string', enum: ['USD'] },
    price_unit: { type: 'string', enum: ['request', 'page'] },
    amount_kind: { type: 'string', enum: ['exact', 'authorized_maximum'] },
    list_amount: { type: ['string', 'null'] },
    authorization_maximum: { type: ['string', 'null'] },
    actual_settlement_model: {
      type: 'string',
      enum: ['equals_exact_amount', 'measured_usage_not_exceeding_authorization'],
    },
    tier_prices: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tier', 'unit', 'amount'],
        properties: {
          tier: { type: 'string', enum: ['native', 'ocr', 'table'] },
          unit: { type: 'string', enum: ['page'] },
          amount: { type: 'string' },
        },
      },
    },
    measured_usage_semantics: { type: ['object', 'null'] },
    limits: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['max_document_pages'],
      properties: { max_document_pages: { type: 'integer' } },
    },
    default_mode: { type: 'string' },
    available_modes: { type: 'array', items: { type: 'string' } },
    modes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'mode',
          'amount',
          'amount_kind',
          'unit',
          'price_defined',
          'capability_available',
        ],
        properties: {
          mode: { type: 'string' },
          amount: { type: 'string' },
          amount_kind: { type: 'string', enum: ['exact', 'authorized_maximum'] },
          unit: { type: 'string', enum: ['request', 'job'] },
          price_defined: { type: 'boolean', enum: [true] },
          capability_available: { type: 'boolean' },
          unavailable_reason: { type: 'string' },
        },
      },
    },
    release_posture: {
      type: 'string',
      enum: [
        'first_release_candidate',
        'defined_not_production_admitted',
        'compatibility_not_admitted',
      ],
    },
    production_enabled: { type: 'boolean' },
    payment: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['network', 'asset', 'pay_to'],
      properties: {
        network: { type: 'string' },
        asset: { type: 'string' },
        pay_to: { type: 'string' },
      },
    },
    pricing_source_version: { type: 'string' },
  },
} as const;

export interface V2PaidOperations {
  readonly paths: Record<string, unknown>;
  readonly schemas: Record<string, unknown>;
  readonly documentPageLimit: number;
}

export function buildV2PaidOpenApiOperations(runtime: PaidOperationsRuntime): V2PaidOperations {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {
    PaidServiceError: {
      type: 'object',
      description:
        'Error body of the paid routes. `error` is a stable machine code (for example `invalid_request`, `retrieval_mode_unavailable`, `verification_mode_unavailable`).',
      properties: {
        error: { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
      required: ['error', 'message'],
    },
    EconomicOfferProjection: ECONOMIC_PROJECTION_COMPONENT_SCHEMA,
  };
  for (const serviceId of V2_PAID_SERVICE_IDS) {
    paths[resolveServiceRoute(serviceId).path] = operationFor(serviceId, runtime);
    schemas[`${componentName(serviceId)}V2Input`] = buildV2InputSchema(serviceId);
  }
  return { paths, schemas, documentPageLimit: resolveMaxDocumentPages() };
}
