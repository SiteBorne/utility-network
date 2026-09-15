/**
 * Pure adapters from the typed registration authorities used by the current
 * A2A Agent Card and MCP server. This module derives static exposure only; it
 * has no runtime gates, environment reads, publication claims, or projection
 * behavior.
 */
import { SITEBORNE_SERVICE_IDS } from '@siteborne/protocol-a2a';
import { MCP_SERVICE_TOOLS, MCP_TOOL_NAMES } from '@siteborne/protocol-mcp';
import type { GitSha } from './primitives';
import { parseGitSha } from './primitives';
import type { CanonicalServiceIdValue } from './service-id';
import { toServiceIdValue } from './service-id';
import {
  EXPOSURE_SHAPES,
  type CanonicalService,
  type CurrentStaticProtocolExposure,
  type CurrentStaticUtilityExposure,
  type ExposureShape,
  type ProtocolSurface,
} from './types';

export interface CurrentRegistrationAuthority {
  readonly sourcePackage: string;
  readonly sourceModule: string;
  readonly derivationMethod: 'typed_export';
}

export type CurrentRegistrationTarget =
  | {
      readonly kind: 'service_interaction';
      readonly serviceId: CanonicalServiceIdValue;
      readonly operationId: string;
    }
  | {
      readonly kind: 'utility_interaction';
      readonly operationId: string;
      readonly utilityKind: 'quote_request' | 'health_check';
    };

export interface CurrentRegistrationFact {
  readonly surface: ProtocolSurface;
  readonly registrationId: string;
  readonly exposureShape: ExposureShape;
  readonly target: CurrentRegistrationTarget;
  readonly authority: CurrentRegistrationAuthority;
}

export interface ServiceExposureAssignment {
  readonly serviceId: CanonicalServiceIdValue;
  readonly exposure: CurrentStaticProtocolExposure;
}

export interface DerivedCurrentExposure {
  readonly serviceExposures: readonly ServiceExposureAssignment[];
  readonly utilityExposures: readonly CurrentStaticUtilityExposure[];
}

export type CurrentExposureDerivationErrorCode =
  | 'UNKNOWN_SERVICE'
  | 'UNKNOWN_OPERATION'
  | 'DUPLICATE_REGISTRATION'
  | 'DUPLICATE_PROTOCOL_OPERATION'
  | 'UNSUPPORTED_EXPOSURE_SHAPE'
  | 'UNKNOWN_UTILITY_INTERACTION';

export class CurrentExposureDerivationError extends Error {
  constructor(
    public readonly code: CurrentExposureDerivationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CurrentExposureDerivationError';
  }
}

const A2A_AUTHORITY: CurrentRegistrationAuthority = {
  sourcePackage: '@siteborne/protocol-a2a',
  sourceModule: 'src/constants.ts#SITEBORNE_SERVICE_IDS -> src/card.ts#skills',
  derivationMethod: 'typed_export',
};

const MCP_AUTHORITY: CurrentRegistrationAuthority = {
  sourcePackage: '@siteborne/protocol-mcp',
  sourceModule: 'src/constants.ts#MCP_SERVICE_TOOLS/MCP_TOOL_NAMES -> src/server.ts#registerTool',
  derivationMethod: 'typed_export',
};

function currentRegistrationFacts(): CurrentRegistrationFact[] {
  const a2a: CurrentRegistrationFact[] = SITEBORNE_SERVICE_IDS.map((serviceId) => ({
    surface: 'a2a',
    registrationId: serviceId,
    exposureShape: 'skill',
    target: { kind: 'service_interaction', serviceId, operationId: 'evaluate' },
    authority: A2A_AUTHORITY,
  }));

  const serviceToolNames = new Set<string>(Object.keys(MCP_SERVICE_TOOLS));
  const mcpServices: CurrentRegistrationFact[] = Object.entries(MCP_SERVICE_TOOLS).map(
    ([registrationId, serviceId]) => ({
      surface: 'mcp',
      registrationId,
      exposureShape: 'standalone_tool',
      target: { kind: 'service_interaction', serviceId, operationId: 'evaluate' },
      authority: MCP_AUTHORITY,
    })
  );
  const mcpUtilities: CurrentRegistrationFact[] = MCP_TOOL_NAMES.filter(
    (name) => !serviceToolNames.has(name)
  ).map((registrationId) => {
    if (registrationId === 'siteborne_get_quote') {
      return {
        surface: 'mcp',
        registrationId,
        exposureShape: 'standalone_tool',
        target: {
          kind: 'utility_interaction',
          operationId: 'get_quote',
          utilityKind: 'quote_request',
        },
        authority: MCP_AUTHORITY,
      };
    }
    if (registrationId === 'siteborne_get_service_health') {
      return {
        surface: 'mcp',
        registrationId,
        exposureShape: 'standalone_tool',
        target: {
          kind: 'utility_interaction',
          operationId: 'get_service_health',
          utilityKind: 'health_check',
        },
        authority: MCP_AUTHORITY,
      };
    }
    throw new CurrentExposureDerivationError(
      'UNKNOWN_UTILITY_INTERACTION',
      `MCP_TOOL_NAMES contains unclassified utility interaction "${registrationId}"`
    );
  });

  return [...a2a, ...mcpServices, ...mcpUtilities];
}

export function deriveCurrentExposureFromRegistrations(
  services: readonly CanonicalService[],
  registrations: readonly CurrentRegistrationFact[],
  runtimeSourceCommit: string
): DerivedCurrentExposure {
  const sourceCommit = parseGitSha(runtimeSourceCommit);
  const servicesById = new Map(services.map((service) => [toServiceIdValue(service.id), service]));
  const seenRegistrations = new Set<string>();
  const seenOperations = new Set<string>();
  const serviceExposures: ServiceExposureAssignment[] = [];
  const utilityExposures: CurrentStaticUtilityExposure[] = [];

  for (const registration of registrations) {
    if (!(EXPOSURE_SHAPES as readonly string[]).includes(registration.exposureShape)) {
      throw new CurrentExposureDerivationError(
        'UNSUPPORTED_EXPOSURE_SHAPE',
        `unsupported exposure shape "${registration.exposureShape}"`
      );
    }
    const registrationKey = `${registration.surface}:${registration.registrationId}`;
    if (seenRegistrations.has(registrationKey)) {
      throw new CurrentExposureDerivationError(
        'DUPLICATE_REGISTRATION',
        `duplicate current registration "${registrationKey}"`
      );
    }
    seenRegistrations.add(registrationKey);

    const target = registration.target;
    const operationKey =
      target.kind === 'service_interaction'
        ? `${registration.surface}:service:${target.serviceId}:${target.operationId}`
        : `${registration.surface}:utility:${target.operationId}`;
    if (seenOperations.has(operationKey)) {
      throw new CurrentExposureDerivationError(
        'DUPLICATE_PROTOCOL_OPERATION',
        `duplicate protocol/operation exposure "${operationKey}"`
      );
    }
    seenOperations.add(operationKey);

    const provenance = {
      ...registration.authority,
      sourceRegistrationId: registration.registrationId,
      runtimeSourceCommit: sourceCommit as GitSha,
    } as const;

    if (target.kind === 'service_interaction') {
      const service = servicesById.get(target.serviceId);
      if (!service) {
        throw new CurrentExposureDerivationError(
          'UNKNOWN_SERVICE',
          `registration "${registrationKey}" references unknown service "${target.serviceId}"`
        );
      }
      if (
        !service.interactions.some((interaction) => interaction.operationId === target.operationId)
      ) {
        throw new CurrentExposureDerivationError(
          'UNKNOWN_OPERATION',
          `registration "${registrationKey}" references unknown operation "${target.operationId}" on "${target.serviceId}"`
        );
      }
      serviceExposures.push({
        serviceId: target.serviceId,
        exposure: {
          surface: registration.surface,
          registrationId: registration.registrationId,
          operationId: target.operationId,
          exposureShape: registration.exposureShape,
          provenance,
        },
      });
      continue;
    }

    utilityExposures.push({
      surface: registration.surface,
      registrationId: registration.registrationId,
      operationId: target.operationId,
      exposureShape: registration.exposureShape,
      utilityKind: target.utilityKind,
      provenance,
    });
  }

  return { serviceExposures, utilityExposures };
}

export function deriveCurrentCodeExposure(
  services: readonly CanonicalService[],
  runtimeSourceCommit: string
): DerivedCurrentExposure {
  return deriveCurrentExposureFromRegistrations(
    services,
    currentRegistrationFacts(),
    runtimeSourceCommit
  );
}
