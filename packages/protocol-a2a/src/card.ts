import type { AgentCard, AgentSkill } from '@a2a-js/sdk';
import {
  BAZAAR_PAYMENT_POLICY,
  REGISTRY_SERVICES,
  resolveServiceRoute,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
} from './constants';

const JSON_MEDIA_TYPE = 'application/json';

function buildSkill(serviceId: (typeof SITEBORNE_SERVICE_IDS)[number]): AgentSkill {
  const service = REGISTRY_SERVICES[serviceId];

  return {
    id: service.service_id,
    name: service.title,
    description: service.description,
    tags: [...service.capabilities],
    examples: [],
    inputModes: [JSON_MEDIA_TYPE],
    outputModes: [JSON_MEDIA_TYPE],
    securityRequirements: [],
  };
}

/** SUN-1222B (post-release hardening) -- superseding the SUN-1220P2 stance.
 * That checkpoint hardcoded the top-level `productionEnabled` to a literal
 * `false` regardless of any per-service value, on the reasoning that it was
 * a conservative "blanket disclosure" that predated any service being
 * truthfully active. That reasoning stopped holding the moment SUN-1221G
 * promoted a real service to production (confirmed live, SUN-1222A §4):
 * the deployed card now reads top-level `productionEnabled: false` while
 * `verify_agent_output.v2` and `web_context_verified.v2` underneath it both
 * read `productionEnabled: true` -- the exact "even if intentional, this
 * creates machine-consumer ambiguity" case the field exists to prevent, not
 * cause. A machine client that trusts only the top-level summary (a
 * reasonable reading of a field named identically to, and positioned above,
 * the per-service ones) concludes nothing is callable and never discovers
 * the two services that actually are.
 *
 * Fixed by deriving the top-level flag as a true aggregate ("at least one
 * declared service is production-callable") instead of a hand-set literal,
 * so it can never again silently disagree with the per-service values it
 * summarizes -- no separate invariant to remember to keep in sync, because
 * there is only one source of truth (`effectiveProductionStatusByServiceId`)
 * and the top-level field is computed from it, not set independently. */
function buildX402ExtensionParams(
  effectiveProductionStatusByServiceId?: Partial<Record<SiteborneServiceId, boolean>>
): Record<string, unknown> {
  const services = SITEBORNE_SERVICE_IDS.map((serviceId) => {
    const service = REGISTRY_SERVICES[serviceId];
    const route = resolveServiceRoute(serviceId);
    return {
      serviceId,
      serviceVersion: service.service_version,
      scheme: BAZAAR_PAYMENT_POLICY[serviceId].scheme,
      resource: `${SITEBORNE_A2A_ORIGIN}${route.path}`,
      inputSchemaUri: service.input_schema_uri,
      outputSchemaUri: service.output_schema_uri,
      declaredLimitations: [...service.declared_limitations],
      productionEnabled: effectiveProductionStatusByServiceId?.[serviceId] ?? false,
    };
  });
  return {
    x402Version: 2,
    paymentRequiredForUsefulExecution: true,
    productionEnabled: services.some((service) => service.productionEnabled),
    services,
  };
}

/**
 * Builds the unsigned, immutable public Agent Card from SITEBORNE's accepted
 * registry and x402 payment-policy sources. Signing is a separate boundary so
 * no private key material can enter this credential-independent package API.
 */
export function buildUnsignedSiteborneAgentCard(
  effectiveProductionStatusByServiceId?: Partial<Record<SiteborneServiceId, boolean>>
): AgentCard {
  return {
    name: 'SITEBORNE Utility Network',
    description:
      'Four bounded evidence, context, document, and verification services with PCC receipts and x402 payment enforcement.',
    supportedInterfaces: [
      {
        url: SITEBORNE_A2A_INTERFACE_URL,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ],
    provider: {
      organization: 'SITEBORNE',
      url: 'https://siteborne.com',
    },
    version: '1.0.0',
    documentationUrl: 'https://siteborne.net/docs/a2a',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: SITEBORNE_X402_EXTENSION_URI,
          description:
            'SITEBORNE binding from A2A skill selection to existing x402 paid-service resources.',
          required: false,
          params: buildX402ExtensionParams(effectiveProductionStatusByServiceId),
        },
      ],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: [JSON_MEDIA_TYPE],
    defaultOutputModes: [JSON_MEDIA_TYPE],
    skills: SITEBORNE_SERVICE_IDS.map(buildSkill),
    signatures: [],
  };
}
