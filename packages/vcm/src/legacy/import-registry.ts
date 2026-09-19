/**
 * legacyRegistryToVCM() (Master Reference Part II §XVII). Inputs are
 * exactly the three named by the frozen design: today's
 * registry/services/*.json files, governance/RISK_LIMITS.yaml (via
 * @siteborne/pricing, the repo's single pricing authority), and the schema
 * bodies/digests already declared inline in each registry file
 * (input_schema_hash/output_schema_hash -- this checkpoint trusts the
 * registry's own recorded digest rather than re-fetching and re-hashing
 * the referenced schema documents, which is out of scope for a metadata
 * transformation).
 *
 * Deliberately does NOT throw on an economic-ceiling violation --
 * `validateEconomicConstraints` (validators.ts) is the place that surfaces
 * that, as a structured non-fatal finding, per the explicit resolution
 * recorded in docs/reports/METADATA-VCM-IMPL-01-truth-core-and-registry-parity.md
 * §V ("LEGACY_PARITY ≠ CANONICAL_VALIDITY" -- the importer proves lossless
 * representation; validation is a separate concern that may legitimately
 * fail on real data without blocking representation).
 */
import {
  buildEconomicOffer,
  isEconomicServiceId,
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
} from '@siteborne/pricing';
import { SITEBORNE_SUPPORTED_X402_SCHEMES } from '@siteborne/protocol-x402';
import { deriveCurrentProtocolAuthorityInputs } from '../current-authority-inputs';
import { deriveCurrentCodeExposure } from '../current-exposure';
import {
  parseGitSha,
  parseSemVer,
  parseSha256Digest,
  parseUriString,
  parseUsdAmount,
} from '../primitives';
import { parseServiceIdValue } from '../service-id';
import { contractMapFor } from './contract-map';
import { primaryPricingKey } from './pricing-map';
import type {
  AuthorizationClassification,
  CanonicalService,
  CanonicalStaticModel,
  ExecutionMode,
  LatencyClass,
  LifecycleState,
  ReleaseProtocolExposureDeclaration,
  ReleaseProtocolExposureValue,
  SchemeNetworkSupport,
  SecurityCapability,
} from '../types';
import {
  AUTHORIZATION_CLASSIFICATIONS,
  EXECUTION_MODES,
  LATENCY_CLASSES,
  LIFECYCLE_STATES,
  RELEASE_PROTOCOL_EXPOSURE_SURFACES,
  RELEASE_PROTOCOL_EXPOSURE_VALUES,
} from '../types';
import type { LegacyRegistryServiceFile } from './types';
import { computeModelDigest } from '../digests';

export class LegacyImportError extends Error {
  constructor(
    public readonly serviceId: string,
    public readonly field: string,
    reason: string
  ) {
    super(`legacyRegistryToVCM: ${serviceId}.${field}: ${reason}`);
    this.name = 'LegacyImportError';
  }
}

function requireMember<T extends string>(
  serviceId: string,
  field: string,
  value: string,
  allowed: readonly T[]
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new LegacyImportError(
      serviceId,
      field,
      `"${value}" is not one of [${allowed.join(', ')}]`
    );
  }
  return value as T;
}

/** Real, code-derived scheme/network support -- packages/protocol-x402/src/network/schemes.ts:41-45
 * (`exact` supports eip155+solana; `upto` supports eip155 only, a
 * deliberate SITEBORNE launch subset). Not present in the legacy registry
 * files (which only list scheme names in `pricing_schemes`, no networks),
 * so this checkpoint reads it from the source that actually declares it
 * rather than fabricating a network list. */
/** packages/protocol-mcp/src/server.ts:555 -- the single annotations block
 * generated once and applied identically to every one of the four
 * primary-service-call MCP tools (verified 2026-09-18: grep finds exactly
 * one `annotations:` literal for the whole family, not eight). The legacy
 * registry format has no field for these MCP-specific hints, so this
 * checkpoint reads the real, uniform, verified value from the source that
 * declares it rather than leaving CanonicalInteraction's required booleans
 * fabricated or absent. */
const PRIMARY_INTERACTION_HINTS = {
  readOnly: false,
  destructive: false,
  idempotent: true,
} as const;

function importOrganization() {
  // packages/protocol-a2a/src/card.ts:131,143-144 -- not present in any
  // registry file (organization identity is model-level, not
  // per-service). 'legalName' vs 'publicName' is an inference from which
  // A2A field plays which role (provider.organization vs. the card's own
  // display name); flagged as such in the implementation report rather
  // than presented with the same confidence as the directly-copied fields
  // below. supportContact is genuinely absent from the codebase (grep
  // confirmed) and is left unset rather than fabricated.
  return {
    legalName: 'SITEBORNE',
    publicName: 'SITEBORNE Utility Network',
    network: 'net.siteborne' as const,
    homepageUri: parseUriString('https://siteborne.com'),
  };
}

function importReleaseProtocolExposure(
  serviceId: string,
  legacy: LegacyRegistryServiceFile['protocols']
): ReleaseProtocolExposureDeclaration {
  return Object.fromEntries(
    RELEASE_PROTOCOL_EXPOSURE_SURFACES.map((surface) => [
      surface,
      requireMember<ReleaseProtocolExposureValue>(
        serviceId,
        `protocols.${surface}`,
        legacy[surface],
        RELEASE_PROTOCOL_EXPOSURE_VALUES
      ),
    ])
  ) as unknown as ReleaseProtocolExposureDeclaration;
}

function importSecurityCapabilities(): SecurityCapability[] {
  // No per-service security data exists in registry/services/*.json --
  // the mechanisms below are cross-cutting (declared once at the protocol
  // level, not per service): packages/protocol-a2a/src/card.ts:126-182
  // (a2a_card_signing is IMPLEMENTED in code and CONFIGURED via
  // AGENT_CARD_SIGNING_KEY_ID/AGENT_CARD_SIGNING_PRIVATE_KEY per
  // wrangler.toml; mtls is IMPLEMENTED but gated CONFIGURED only when
  // `mtlsProductionActive` is true -- treated here as CONFIGURED=false ->
  // IMPLEMENTED only, since this importer does not read live Cloudflare
  // config, per this checkpoint's explicit prohibition on live queries).
  return [
    { mechanism: { kind: 'a2a_card_signing' }, truthLevel: 'CONFIGURED' },
    { mechanism: { kind: 'mtls' }, truthLevel: 'IMPLEMENTED' },
  ];
}

export function importOneService(legacy: LegacyRegistryServiceFile): CanonicalService {
  const id = parseServiceIdValue(legacy.service_id);
  if (legacy.service_version !== id.generation) {
    throw new LegacyImportError(
      legacy.service_id,
      'service_version',
      `"${legacy.service_version}" does not match generation parsed from service_id "${id.generation}"`
    );
  }

  const lifecycleState = requireMember<LifecycleState>(
    legacy.service_id,
    'promotion_state',
    legacy.promotion_state.toUpperCase(),
    LIFECYCLE_STATES
  );
  const expectedLatencyClass = requireMember<LatencyClass>(
    legacy.service_id,
    'expected_latency_class',
    legacy.expected_latency_class,
    LATENCY_CLASSES
  );
  const authorizationClassification = requireMember<AuthorizationClassification>(
    legacy.service_id,
    'authorization_classification',
    legacy.authorization_classification,
    AUTHORIZATION_CLASSIFICATIONS
  );
  const executionMode = requireMember<ExecutionMode>(
    legacy.service_id,
    'execution_mode',
    legacy.execution_mode,
    EXECUTION_MODES
  );

  const contractMap = contractMapFor(id.generation);
  const serviceIdValue = `${id.family}.${id.generation}`;
  if (!isEconomicServiceId(serviceIdValue)) {
    throw new LegacyImportError(
      legacy.service_id,
      'service_id',
      `no canonical economic definition exists for "${serviceIdValue}"`
    );
  }
  const pricingKey = primaryPricingKey(id.family, id.generation);
  const governedMaxAmount = resolveServiceMaxPriceUsd(pricingKey);

  const supportedSchemes: SchemeNetworkSupport[] = legacy.pricing_schemes.map((schemeRaw) => {
    const scheme = requireMember(legacy.service_id, 'pricing_schemes', schemeRaw, [
      'exact',
      'upto',
    ] as const);
    return {
      scheme,
      networks: [...SITEBORNE_SUPPORTED_X402_SCHEMES[scheme]] as ('eip155' | 'solana')[],
    };
  });

  const releaseProtocolExposureDeclared = importReleaseProtocolExposure(
    legacy.service_id,
    legacy.protocols
  );

  return {
    id,
    title: legacy.title,
    description: legacy.description,
    capabilities: [...legacy.capabilities],
    lifecycleState,
    contract: {
      contractReleaseVersion: parseSemVer(contractMap.contractReleaseVersion),
      inputSchema: {
        uri: parseUriString(legacy.input_schema_uri),
        digest: parseSha256Digest(legacy.input_schema_hash),
      },
      outputSchema: {
        uri: parseUriString(legacy.output_schema_uri),
        digest: parseSha256Digest(legacy.output_schema_hash),
      },
      pcc: {
        wireVersion: parseSemVer(legacy.pcc_version),
        schemaRelease: parseSemVer(contractMap.pccSchemaRelease),
      },
    },
    economics: {
      pricingPolicyVersion: resolvePricingSourceVersion(),
      // listPrice and governedMaxPrice both resolve from the same governed
      // pricing authority (METADATA-VCM-04 §III/§VII) -- the frozen legacy
      // base_price is preserved separately below, never promoted here.
      listPrice: { amount: parseUsdAmount(governedMaxAmount), currency: 'USD' },
      governedMaxPrice: { amount: parseUsdAmount(governedMaxAmount), currency: 'USD' },
      releaseBasePriceDeclared: {
        amount: parseUsdAmount(legacy.base_price.amount),
        currency: 'USD',
      },
      releaseMaximumPriceDeclared: {
        amount: parseUsdAmount(legacy.maximum_price.amount),
        currency: 'USD',
      },
      supportedSchemes,
      offer: buildEconomicOffer(serviceIdValue),
    },
    interactions: [
      {
        operationId: 'evaluate',
        kind: 'primary_service_call',
        executionMode,
        maximumInputBytes: legacy.maximum_input_bytes,
        expectedLatencyClass,
        ...PRIMARY_INTERACTION_HINTS,
      },
    ],
    currentStaticExposures: [],
    declaredLimitations: [...legacy.declared_limitations],
    authorizationClassification,
    releaseProtocolExposureDeclared,
    legacyProductionEnabledDeclared: legacy.production_enabled,
    legacyUpdatedAt: legacy.updated_at,
    securityCapabilities: importSecurityCapabilities(),
  };
}

export interface ImportOptions {
  readonly runtimeSourceCommit: string; // GitSha, 40-hex
  readonly compiledAt: string; // IsoTimestamp
  readonly vcmSchemaVersion: string; // SemVer string
  readonly vcmReleaseVersion: string; // SemVer string
}

export async function legacyRegistryToVCM(
  legacyFiles: readonly LegacyRegistryServiceFile[],
  options: ImportOptions
): Promise<CanonicalStaticModel> {
  const importedServices = [...legacyFiles]
    .map(importOneService)
    .sort((a, b) =>
      `${a.id.family}.${a.id.generation}`.localeCompare(`${b.id.family}.${b.id.generation}`)
    );
  const currentExposure = deriveCurrentCodeExposure(importedServices, options.runtimeSourceCommit);
  const currentProtocolAuthority = deriveCurrentProtocolAuthorityInputs(
    importedServices,
    options.runtimeSourceCommit
  );
  const services = importedServices.map((service) => {
    const serviceId = `${service.id.family}.${service.id.generation}`;
    return {
      ...service,
      currentStaticExposures: currentExposure.serviceExposures
        .filter((assignment) => assignment.serviceId === serviceId)
        .map((assignment) => assignment.exposure),
    };
  });

  const modelWithoutDigest: CanonicalStaticModel = {
    modelIdentity: {
      vcmSchemaVersion: parseSemVer(options.vcmSchemaVersion),
      vcmReleaseVersion: parseSemVer(options.vcmReleaseVersion),
      // placeholder, replaced below once the real digest is computed
      modelDigest: parseSha256Digest(`sha256:${'0'.repeat(64)}`),
      compiledAt: options.compiledAt,
    },
    organization: importOrganization(),
    services,
    currentStaticUtilityExposures: currentExposure.utilityExposures,
    currentX402ProtocolCapability: currentProtocolAuthority.x402ProtocolCapability,
    currentBazaarProjectionSupport: currentProtocolAuthority.bazaarProjectionSupport,
    pricingPolicyVersion: resolvePricingSourceVersion(),
    compatibility: [
      {
        contractReleaseVersion: parseSemVer('1.0.0'),
        compatibleWith: [parseSemVer('1.0.1')],
        breakingFrom: [],
      },
      {
        contractReleaseVersion: parseSemVer('1.0.1'),
        compatibleWith: [parseSemVer('1.0.0')],
        breakingFrom: [],
      },
      {
        contractReleaseVersion: parseSemVer('2.0.0'),
        compatibleWith: [],
        breakingFrom: [parseSemVer('1.0.0'), parseSemVer('1.0.1')],
      },
    ],
  };

  const modelDigest = await computeModelDigest(modelWithoutDigest);
  parseGitSha(options.runtimeSourceCommit); // validate, defense-in-depth
  return {
    ...modelWithoutDigest,
    modelIdentity: { ...modelWithoutDigest.modelIdentity, modelDigest },
  };
}
