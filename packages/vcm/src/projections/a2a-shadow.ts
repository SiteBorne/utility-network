/**
 * Pure VCM -> A2A Agent Card shadow projection (METADATA-VCM-IMPL-03B §V).
 * Consumes only the effective view + an injected context of already-real
 * SITEBORNE identifiers -- it does not sign, read secrets, or query
 * runtime. Signing remains `packages/protocol-a2a/src/signing.ts`'s
 * concern, entirely downstream of this adapter.
 */
import { governDeclaredLimitations, projectEconomicOffer } from '@siteborne/pricing';
import type { EffectiveMetadataView, EffectiveServiceView } from '../effective-view';
import type { A2aProjectionContext, UnsignedAgentCard, UnsignedAgentSkill } from './types';

const JSON_MEDIA_TYPE = 'application/json';

function serviceOrderIndex(context: A2aProjectionContext, id: string): number {
  const index = context.serviceOrder.indexOf(id as never);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function buildSkill(service: EffectiveServiceView): UnsignedAgentSkill {
  const versionLabel = service.id.slice(service.id.lastIndexOf('.') + 1).toUpperCase();
  return {
    id: service.id,
    name: `${service.title} (${versionLabel})`,
    description:
      `${service.description} SITEBORNE service contract major ` +
      `${service.id.slice(service.id.lastIndexOf('.') + 1)} -- see this id ("${service.id}") in this ` +
      "Agent Card's x402 extension params and the SITEBORNE service catalog/OpenAPI " +
      'for its exact schema, pricing, and current production status.',
    tags: [...service.capabilities, service.id.slice(service.id.lastIndexOf('.') + 1)],
    examples: [],
    inputModes: [JSON_MEDIA_TYPE],
    outputModes: [JSON_MEDIA_TYPE],
    securityRequirements: [],
  };
}

export function projectA2aFromVcm(
  effective: EffectiveMetadataView,
  context: A2aProjectionContext
): UnsignedAgentCard {
  const services = [...effective.services].sort(
    (a, b) =>
      serviceOrderIndex(context, a.id) - serviceOrderIndex(context, b.id) ||
      a.id.localeCompare(b.id)
  );

  const x402Services = services.map((service) => {
    const resource = `${context.resourceOrigin}${context.resourcePath(service.id)}`;
    const productionEnabled = context.effectiveProductionStatusByServiceId[service.id] ?? false;
    return {
      serviceId: service.id,
      serviceVersion: service.id.slice(service.id.lastIndexOf('.') + 1),
      scheme: context.scheme(service.id),
      resource,
      inputSchemaUri: service.contract.inputSchema.uri,
      outputSchemaUri: service.contract.outputSchema.uri,
      declaredLimitations: governDeclaredLimitations(service.id, service.declaredLimitations),
      productionEnabled,
      economics: projectEconomicOffer(service.economicOffer, {
        resource,
        productionEnabled,
        destination: context.paymentDestination,
      }),
    };
  });

  return {
    name: context.agentName,
    description: context.agentDescription,
    supportedInterfaces: [
      {
        url: context.interfaceUrl,
        protocolBinding: 'JSONRPC',
        protocolVersion: context.protocolVersion,
        tenant: '',
      },
    ],
    provider: context.provider,
    version: context.agentVersion,
    documentationUrl: context.documentationUrl,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: context.x402ExtensionUri,
          description:
            'SITEBORNE binding from A2A skill selection to existing x402 paid-service resources.',
          required: false,
          params: {
            x402Version: context.x402Version,
            paymentRequiredForUsefulExecution: true,
            productionEnabled: x402Services.some((service) => service.productionEnabled),
            services: x402Services,
          },
        },
        ...(context.securityDeclarationExtension ? [context.securityDeclarationExtension] : []),
      ],
    },
    securitySchemes: context.mtlsSecurityScheme
      ? {
          [context.mtlsSecurityScheme.key]: {
            scheme: {
              $case: 'mtlsSecurityScheme',
              value: { description: context.mtlsSecurityScheme.description },
            },
          },
        }
      : {},
    securityRequirements: [],
    defaultInputModes: [JSON_MEDIA_TYPE],
    defaultOutputModes: [JSON_MEDIA_TYPE],
    skills: services.map(buildSkill),
    signatures: [],
  };
}
