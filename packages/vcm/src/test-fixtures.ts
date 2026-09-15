/**
 * Minimal, hand-built valid fixtures for unit tests that need a
 * CanonicalStaticModel / CanonicalService without going through the real
 * legacy importer. Not exported from index.ts -- test-only.
 */
import { parseSemVer, parseSha256Digest, parseUriString, parseUsdAmount } from './primitives';
import type { CanonicalService, CanonicalStaticModel } from './types';

const HASH_A = parseSha256Digest(`sha256:${'a'.repeat(64)}`);
const HASH_B = parseSha256Digest(`sha256:${'b'.repeat(64)}`);

export function makeFixtureService(overrides: Partial<CanonicalService> = {}): CanonicalService {
  return {
    id: { family: 'company_evidence_graph', generation: 'v1' },
    title: 'Company Evidence Graph',
    description: 'Test fixture service.',
    capabilities: ['test_capability'],
    lifecycleState: 'EXECUTABLE_CANDIDATE',
    contract: {
      contractReleaseVersion: parseSemVer('1.0.0'),
      inputSchema: { uri: parseUriString('https://siteborne.net/schemas/in.json'), digest: HASH_A },
      outputSchema: {
        uri: parseUriString('https://siteborne.net/schemas/out.json'),
        digest: HASH_B,
      },
      pcc: { wireVersion: parseSemVer('1.0.0'), schemaRelease: parseSemVer('1.0.1') },
    },
    economics: {
      pricingPolicyVersion: '1.0.0',
      listPrice: { amount: parseUsdAmount('0.039'), currency: 'USD' },
      governedMaxPrice: { amount: parseUsdAmount('0.039'), currency: 'USD' },
      releaseBasePriceDeclared: { amount: parseUsdAmount('0.039'), currency: 'USD' },
      releaseMaximumPriceDeclared: { amount: parseUsdAmount('0.19'), currency: 'USD' },
      supportedSchemes: [
        { scheme: 'exact', networks: ['eip155', 'solana'] },
        { scheme: 'upto', networks: ['eip155'] },
      ],
    },
    interactions: [
      {
        operationId: 'evaluate',
        kind: 'primary_service_call',
        executionMode: 'async',
        maximumInputBytes: 1048576,
        expectedLatencyClass: 'slow',
        readOnly: false,
        idempotent: true,
        destructive: false,
      },
    ],
    currentStaticExposures: [],
    declaredLimitations: [],
    authorizationClassification: 'public',
    releaseProtocolExposureDeclared: {
      x402: 'planned',
      mcp: 'planned',
      a2a: 'planned',
      nevermined: 'planned',
      agentverse: 'planned',
      coinbase_bazaar: 'planned',
      mcp_registry: 'planned',
    },
    legacyProductionEnabledDeclared: false,
    legacyUpdatedAt: '2026-08-05T22:00:00Z',
    securityCapabilities: [
      { mechanism: { kind: 'a2a_card_signing' }, truthLevel: 'CONFIGURED' },
      { mechanism: { kind: 'mtls' }, truthLevel: 'IMPLEMENTED' },
    ],
    ...overrides,
  };
}

export function makeFixtureModel(
  services: CanonicalService[] = [makeFixtureService()]
): CanonicalStaticModel {
  return {
    modelIdentity: {
      // 0.3.0: METADATA-VCM-IMPL-03A separated frozen release declarations,
      // current static exposure, operational activation, and external
      // publication. VCM still has zero external consumers.
      vcmSchemaVersion: parseSemVer('0.3.0'),
      vcmReleaseVersion: parseSemVer('0.1.0'),
      modelDigest: parseSha256Digest(`sha256:${'0'.repeat(64)}`),
      compiledAt: '2026-09-18T00:00:00.000Z',
    },
    organization: {
      legalName: 'SITEBORNE',
      publicName: 'SITEBORNE Utility Network',
      network: 'net.siteborne',
      homepageUri: parseUriString('https://siteborne.com'),
    },
    services,
    currentStaticUtilityExposures: [],
    currentX402ProtocolCapability: {
      protocolVersion: 2,
      supportedSchemes: { exact: ['eip155', 'solana'], upto: ['eip155'] },
      provenance: {
        sourcePackage: '@siteborne/protocol-x402',
        sourceModule: 'src/version.ts+src/network/schemes.ts',
        sourceRegistrationId: 'SUPPORTED_X402_VERSION+SITEBORNE_SUPPORTED_X402_SCHEMES',
        runtimeSourceCommit: 'a'.repeat(40) as never,
        derivationMethod: 'typed_export',
      },
    },
    currentBazaarProjectionSupport: {
      projectionSupported: false,
      serviceIds: [],
      provenance: {
        sourcePackage: '@siteborne/protocol-x402',
        sourceModule: 'src/bazaar/registry-source.ts#ALL_BAZAAR_SERVICE_IDS',
        sourceRegistrationId: 'ALL_BAZAAR_SERVICE_IDS',
        runtimeSourceCommit: 'a'.repeat(40) as never,
        derivationMethod: 'typed_export',
      },
    },
    pricingPolicyVersion: '1.0.0',
    compatibility: [],
  };
}
