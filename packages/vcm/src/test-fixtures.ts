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
      legacyBasePriceDeclared: { amount: parseUsdAmount('0.039'), currency: 'USD' },
      legacyMaximumPriceDeclared: { amount: parseUsdAmount('0.19'), currency: 'USD' },
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
    declaredLimitations: [],
    authorizationClassification: 'public',
    protocolExposure: [
      {
        surface: 'a2a',
        capabilityExists: true,
        protocolExposed: false,
        exposureShape: 'not_exposed',
      },
      {
        surface: 'mcp',
        capabilityExists: true,
        protocolExposed: false,
        exposureShape: 'not_exposed',
      },
      {
        surface: 'openapi',
        capabilityExists: true,
        protocolExposed: false,
        exposureShape: 'not_exposed',
      },
      {
        surface: 'x402',
        capabilityExists: true,
        protocolExposed: false,
        exposureShape: 'not_exposed',
      },
      {
        surface: 'bazaar',
        capabilityExists: true,
        protocolExposed: false,
        exposureShape: 'not_exposed',
      },
      {
        surface: 'nevermined',
        capabilityExists: true,
        protocolExposed: false,
        exposureShape: 'not_exposed',
      },
    ],
    legacyProtocolExposureDeclared: {
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
      // 0.2.0: METADATA-VCM-IMPL-02 added ServiceEconomics.legacyBasePriceDeclared
      // (shape change, discipline marker only -- METADATA-VCM-04 §IX, zero
      // external consumers so no compatibility break is possible).
      vcmSchemaVersion: parseSemVer('0.2.0'),
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
    pricingPolicyVersion: '1.0.0',
    compatibility: [],
  };
}
