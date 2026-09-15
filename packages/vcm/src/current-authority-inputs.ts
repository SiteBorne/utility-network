/**
 * Pure adapters for typed, current protocol facts that already have one
 * repository-owned authority. They deliberately omit mounted REST route
 * exposure, operational activation, and external publication because those
 * facts do not have equivalent typed static authorities today.
 */
import {
  ALL_BAZAAR_SERVICE_IDS,
  SITEBORNE_SUPPORTED_X402_SCHEMES,
  SUPPORTED_X402_VERSION,
} from '@siteborne/protocol-x402';
import { parseGitSha } from './primitives';
import { toServiceIdValue } from './service-id';
import type {
  CanonicalService,
  CurrentBazaarProjectionSupport,
  CurrentExposureProvenance,
  CurrentX402ProtocolCapability,
  SettlementNetworkFamily,
} from './types';

export type CurrentAuthorityInputErrorCode = 'UNKNOWN_BAZAAR_SERVICE';

export class CurrentAuthorityInputError extends Error {
  constructor(
    public readonly code: CurrentAuthorityInputErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CurrentAuthorityInputError';
  }
}

export interface CurrentProtocolAuthorityInputs {
  readonly x402ProtocolCapability: CurrentX402ProtocolCapability;
  readonly bazaarProjectionSupport: CurrentBazaarProjectionSupport;
}

function provenance(
  runtimeSourceCommit: string,
  sourceRegistrationId: string,
  sourceModule: string
): CurrentExposureProvenance {
  return {
    sourcePackage: '@siteborne/protocol-x402',
    sourceModule,
    sourceRegistrationId,
    runtimeSourceCommit: parseGitSha(runtimeSourceCommit),
    derivationMethod: 'typed_export',
  };
}

export function deriveCurrentProtocolAuthorityInputs(
  services: readonly CanonicalService[],
  runtimeSourceCommit: string
): CurrentProtocolAuthorityInputs {
  const canonicalServiceIds = new Set(services.map((service) => toServiceIdValue(service.id)));
  for (const serviceId of ALL_BAZAAR_SERVICE_IDS) {
    if (!canonicalServiceIds.has(serviceId)) {
      throw new CurrentAuthorityInputError(
        'UNKNOWN_BAZAAR_SERVICE',
        `Bazaar projection authority references unknown canonical service "${serviceId}"`
      );
    }
  }

  return {
    x402ProtocolCapability: {
      protocolVersion: SUPPORTED_X402_VERSION,
      supportedSchemes: {
        exact: SITEBORNE_SUPPORTED_X402_SCHEMES.exact.map(
          (network) => network as SettlementNetworkFamily
        ),
        upto: SITEBORNE_SUPPORTED_X402_SCHEMES.upto.map(
          (network) => network as SettlementNetworkFamily
        ),
      },
      provenance: provenance(
        runtimeSourceCommit,
        'SUPPORTED_X402_VERSION+SITEBORNE_SUPPORTED_X402_SCHEMES',
        'src/version.ts+src/network/schemes.ts'
      ),
    },
    bazaarProjectionSupport: {
      projectionSupported: true,
      serviceIds: [...ALL_BAZAAR_SERVICE_IDS],
      provenance: provenance(
        runtimeSourceCommit,
        'ALL_BAZAAR_SERVICE_IDS',
        'src/bazaar/registry-source.ts#ALL_BAZAAR_SERVICE_IDS'
      ),
    },
  };
}
