/**
 * SITEBORNE-OPENAPI-V3-CANDIDATE-01 -- the OpenAPI description of the four
 * Release 3 `.v3` candidate operations, generated from the same canonical
 * sources as `paid-operations.ts`'s v2 builder and nothing else:
 *
 *   - identity / method / path      : the accepted Release 3 OpenAPI route
 *                                      table (`routes.ts`, which already
 *                                      merges `contracts/releases/3.0.0`)
 *   - request schema                : the frozen bundled v3 input schema
 *   - economics                     : `projectServiceEconomics`, whose
 *                                      `contract_role` is already `"candidate"`
 *                                      for every `.v3` id (governed by
 *                                      `@siteborne/pricing`'s economic
 *                                      contract -- not authored here)
 *   - candidate/authorization state : `registry/services/<id>.v3.json`'s own
 *                                      `promotion_state`, `production_enabled`
 *                                      and `authorization_classification`
 *                                      fields (the same registry entry the
 *                                      MCP v3 candidate routes and the
 *                                      v3-service-parity gate already read)
 *
 * A v3 candidate operation is projected into the SAME live document as the
 * v2 paid operations (Publication model: LIVE_DOCUMENT_WITH_EXPLICIT_
 * CANDIDATE_EXTENSION -- see `packages/vcm`'s prior MCP/A2A shadow
 * projections for the same "one live document, explicit machine-readable
 * state extension" pattern). It never claims production activation: runtime
 * production-enablement is intentionally NOT threaded in here the way v2's
 * `operationFor` threads `runtime.productionEnabled` -- a `.v3` operation's
 * `x-siteborne-economics.production_enabled` is always `false` and its
 * `x-siteborne-candidate-state.promotion_state` always reflects the governed
 * registry entry, never a runtime gate.
 */
import { projectServiceEconomics, type PaymentDestination } from '../pricing/economic';
import { BUNDLED_SERVICE_INPUT_SCHEMAS } from '../bazaar/frozen-inputs';
import { purchasableInputExample } from '../bazaar/purchasable-example';
import { REGISTRY_SERVICES } from '../bazaar/registry-source';
import { resolveServiceRoute } from '../bazaar/routes';
import { stripDocumentIdentity } from '../bazaar/schema-bundle';
import type { SiteborneServiceId } from '../types';

/** The four Release 3 candidate identities, in declared order. */
export const V3_CANDIDATE_SERVICE_IDS: readonly SiteborneServiceId[] = [
  'company_evidence_graph.v3',
  'web_context_verified.v3',
  'document_evidence_json.v3',
  'verify_agent_output.v3',
];

const COMPONENT_NAMES: Readonly<Record<string, string>> = {
  company_evidence_graph: 'CompanyEvidenceGraph',
  web_context_verified: 'WebContextVerified',
  document_evidence_json: 'DocumentEvidenceJson',
  verify_agent_output: 'VerifyAgentOutput',
};

function componentName(serviceId: SiteborneServiceId): string {
  return COMPONENT_NAMES[serviceId.slice(0, serviceId.lastIndexOf('.'))];
}

export interface CandidateOperationsRuntime {
  /** OPERATIONAL public payment destination; `null` = not configured. Only
   * used to populate `x-siteborne-economics.payment` -- never used to imply
   * the operation itself is purchasable. */
  readonly destination: PaymentDestination | null;
}

/** Deep copy of the frozen v3 input schema with the purchasable example
 * substituted -- identical treatment to `buildV2InputSchema`, but a v3
 * candidate schema has no unavailable-mode narrowing to apply because no
 * `.v3` economic definition currently declares an unavailable mode. */
export function buildV3CandidateInputSchema(
  serviceId: SiteborneServiceId
): Record<string, unknown> {
  const schema = structuredClone(
    stripDocumentIdentity(BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId])
  ) as Record<string, unknown>;
  schema.examples = [purchasableInputExample(serviceId)];
  return schema;
}

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/PaidServiceError' } } },
  };
}

function operationFor(serviceId: SiteborneServiceId, runtime: CandidateOperationsRuntime) {
  const registry = REGISTRY_SERVICES[serviceId];
  const name = componentName(serviceId);
  // A .v3 candidate is never production-active: `production_enabled` is
  // fixed at `false` here regardless of any runtime gate, so the embedded
  // economics can never assert the operation is live.
  const economics = projectServiceEconomics(serviceId, {
    productionEnabled: false,
    destination: runtime.destination,
  });
  const route = resolveServiceRoute(serviceId);
  const notes: string[] = [
    `Release 3 candidate operation (contract_role: "${economics.contract_role}"). Not production-active: ${registry.production_enabled ? 'true' : 'false'} == production_enabled.`,
    'Economics (price, scheme, tiers, settlement, modes, network/asset/payTo) are in x-siteborne-economics.',
    'Candidate/authorization state (promotion state, result confidentiality) is in x-siteborne-candidate-state.',
  ];
  return {
    [route.method.toLowerCase()]: {
      operationId: `${name.charAt(0).toLowerCase()}${name.slice(1)}V3`,
      summary: `${registry.title} (v3 candidate)`,
      description: `${registry.description} ${notes.join(' ')}`,
      tags: ['release-3-candidate-services'],
      'x-service-id': serviceId,
      'x-siteborne-economics': economics,
      'x-siteborne-candidate-state': {
        contract_release: '3.0.0',
        service_version: 'v3',
        promotion_state: registry.promotion_state,
        production_enabled: registry.production_enabled,
        result_confidentiality_class:
          registry.authorization_classification === 'buyer_authorized'
            ? 'BUYER_AUTHORIZED'
            : 'PUBLIC',
        pcc_version: registry.pcc_version,
      },
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${name}V3Input` } },
        },
      },
      responses: {
        '200': {
          description:
            'Candidate result: a proof-carrying-context document bound to this request. Retrieval of a BUYER_AUTHORIZED result requires an authorized subject binding independent of payment.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Service result; see the output schema for its exact shape.',
                'x-output-schema-uri': registry.output_schema_uri,
                'x-pcc-version': registry.pcc_version,
              },
            },
          },
        },
        '400': errorResponse(
          'Invalid request: schema violation or unsupported request content. No quote was created and nothing was charged.'
        ),
        '404': errorResponse(
          'The candidate route is not enabled on the serving deployment (v3 candidates are not production-active by policy).'
        ),
        '503': errorResponse('The governed candidate executor is not configured.'),
      },
    },
  };
}

export interface V3CandidateOperations {
  readonly paths: Record<string, unknown>;
  readonly schemas: Record<string, unknown>;
}

export function buildV3CandidateOpenApiOperations(
  runtime: CandidateOperationsRuntime
): V3CandidateOperations {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};
  for (const serviceId of V3_CANDIDATE_SERVICE_IDS) {
    paths[resolveServiceRoute(serviceId).path] = operationFor(serviceId, runtime);
    schemas[`${componentName(serviceId)}V3Input`] = buildV3CandidateInputSchema(serviceId);
  }
  return { paths, schemas };
}
