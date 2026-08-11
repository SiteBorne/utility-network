import type { AgentCard, AgentSkill } from '@a2a-js/sdk';
import {
  BAZAAR_PAYMENT_POLICY,
  REGISTRY_SERVICES,
  resolveServiceRoute,
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

function buildX402ExtensionParams(): Record<string, unknown> {
  return {
    x402Version: 2,
    paymentRequiredForUsefulExecution: true,
    productionEnabled: false,
    services: SITEBORNE_SERVICE_IDS.map((serviceId) => {
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
        productionEnabled: false,
      };
    }),
  };
}

/**
 * Builds the unsigned, immutable public Agent Card from SITEBORNE's accepted
 * registry and x402 payment-policy sources. Signing is a separate boundary so
 * no private key material can enter this credential-independent package API.
 */
export function buildUnsignedSiteborneAgentCard(): AgentCard {
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
          params: buildX402ExtensionParams(),
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
