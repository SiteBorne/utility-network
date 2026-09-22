/**
 * A2A shadow projection parity (METADATA-VCM-IMPL-03B §V-§VIII).
 * `A2A_EXISTING_PROJECTION_ENTRYPOINT` =
 * `packages/protocol-a2a/src/card.ts#buildUnsignedSiteborneAgentCard` -- a
 * pure function returning `AgentCard` directly, already unsigned (signing is
 * a separate boundary in `signing.ts`), so no wrapper/export change to
 * protocol-a2a was needed to compare against it.
 */
import { BAZAAR_PAYMENT_POLICY, resolveServiceRoute } from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  buildUnsignedSiteborneAgentCard,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION,
  SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
} from '@siteborne/protocol-a2a';
import type { PaymentDestination, SiteborneServiceId } from '@siteborne/protocol-x402';
import { describe, expect, it } from 'vitest';
import { compareProjections, summarizeDifferences, unexplainedDifferences } from '../comparator';
import { project } from '../effective-view';
import { emptyOverlay } from '../runtime-overlay';
import { makeFixtureModel, makeFixtureService } from '../test-fixtures';
import type { CanonicalServiceIdValue } from '../service-id';
import { projectA2aFromVcm } from './a2a-shadow';
import type { A2aProjectionContext } from './types';

const GENERATED_AT = '2026-09-18T00:00:00.000Z' as never;

// AGENT_CARD_LITERALS mirrors the literal values card.ts hardcodes inline
// (name/description/version/documentationUrl/provider/capability flags).
// The real builder has no other authority for these either -- they are not
// derived from registry, governance, or any typed export -- so copying them
// verbatim here is faithful, not independently authored, exactly like the
// real system's own treatment of them.
const AGENT_CARD_LITERALS = {
  agentName: 'SITEBORNE Utility Network',
  agentDescription:
    'Four bounded evidence, context, document, and verification services with PCC receipts and x402 payment enforcement.',
  agentVersion: '1.0.0',
  documentationUrl: 'https://siteborne.net/docs/a2a',
  provider: { organization: 'SITEBORNE', url: 'https://siteborne.com' },
};

function realContext(
  effectiveProductionStatusByServiceId: Partial<Record<SiteborneServiceId, boolean>> = {},
  mtlsProductionActive = false,
  paymentDestination: PaymentDestination | null = null
): A2aProjectionContext {
  return {
    ...AGENT_CARD_LITERALS,
    interfaceUrl: SITEBORNE_A2A_INTERFACE_URL,
    protocolVersion: A2A_PROTOCOL_VERSION,
    x402ExtensionUri: SITEBORNE_X402_EXTENSION_URI,
    x402Version: 2,
    resourceOrigin: SITEBORNE_A2A_ORIGIN,
    serviceOrder: SITEBORNE_SERVICE_IDS as readonly CanonicalServiceIdValue[],
    resourcePath: (serviceId) => resolveServiceRoute(serviceId as SiteborneServiceId).path,
    scheme: (serviceId) => BAZAAR_PAYMENT_POLICY[serviceId as SiteborneServiceId].scheme,
    effectiveProductionStatusByServiceId: effectiveProductionStatusByServiceId as Readonly<
      Partial<Record<CanonicalServiceIdValue, boolean>>
    >,
    mtlsSecurityScheme: mtlsProductionActive
      ? {
          key: SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
          description: SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION,
        }
      : null,
    paymentDestination,
  };
}

/** Builds a VCM effective view carrying real registry facts (title,
 * description, capabilities, declared limitations, contract refs) for all
 * eight real service ids, via the real legacy importer fixtures already
 * proven in METADATA-VCM-IMPL-01/02 registry-parity tests -- not
 * hand-typed duplicate literals that could silently drift from the
 * registry. */
async function realEightServiceEffectiveView() {
  const { legacyRegistryToVCM } = await import('../legacy/import-registry');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const registryDir = path.resolve(__dirname, '../../../../registry/services');
  const files = fs
    .readdirSync(registryDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const legacyFiles = files.map((file) =>
    JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf8'))
  );
  const model = await legacyRegistryToVCM(legacyFiles, {
    vcmSchemaVersion: '0.3.0',
    vcmReleaseVersion: '0.1.0',
    runtimeSourceCommit: 'a'.repeat(40),
    compiledAt: GENERATED_AT,
  });
  const overlay = emptyOverlay(GENERATED_AT);
  return project(model, overlay, { generatedAt: GENERATED_AT });
}

describe('projectA2aFromVcm -- RED: module must exist', () => {
  it('is a function', () => {
    expect(typeof projectA2aFromVcm).toBe('function');
  });
});

describe('projectA2aFromVcm -- unit shape', () => {
  it('produces exactly one skill per service, in the declared serviceOrder', async () => {
    const svcA = makeFixtureService({ id: { family: 'company_evidence_graph', generation: 'v2' } });
    const svcB = makeFixtureService({ id: { family: 'web_context_verified', generation: 'v2' } });
    const model = makeFixtureModel([svcA, svcB]);
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const context: A2aProjectionContext = {
      ...realContext(),
      serviceOrder: ['web_context_verified.v2', 'company_evidence_graph.v2'],
    };
    const card = projectA2aFromVcm(view, context);
    expect(card.skills.map((s) => s.id)).toEqual([
      'web_context_verified.v2',
      'company_evidence_graph.v2',
    ]);
  });

  it('never emits a stronger security claim than the effective view supports (mTLS off by default)', async () => {
    const model = makeFixtureModel();
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const card = projectA2aFromVcm(view, realContext());
    expect(card.securitySchemes).toEqual({});
  });

  it('declares the mTLS scheme only when the context explicitly supplies it', async () => {
    const model = makeFixtureModel();
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const card = projectA2aFromVcm(view, realContext({}, true));
    expect(card.securitySchemes.mtls).toBeDefined();
  });

  it('root securityRequirements is always empty (x402 is the sole economic gate, per ADR)', async () => {
    const model = makeFixtureModel();
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const card = projectA2aFromVcm(view, realContext());
    expect(card.securityRequirements).toEqual([]);
  });
});

describe('projectA2aFromVcm -- real-data parity against buildUnsignedSiteborneAgentCard()', () => {
  it('reproduces the real Agent Card content with zero unexplained differences', async () => {
    const effective = await realEightServiceEffectiveView();
    const existing = buildUnsignedSiteborneAgentCard();
    const shadow = projectA2aFromVcm(effective, realContext());

    const differences = compareProjections(existing, shadow, {
      governedDifferences: [
        {
          // signatures[] is always [] pre-signing on both sides; nothing to
          // classify here in practice, kept for completeness/documentation.
          pathPattern: /^signatures/,
          classification: 'INTENTIONAL_GOVERNED_DIFFERENCE',
          reason: 'Signing is a separate boundary; both sides are pre-signature.',
        },
      ],
    });
    const unexplained = unexplainedDifferences(differences);
    if (unexplained.length > 0) {
      console.error('A2A_UNEXPLAINED_DIFFERENCES', JSON.stringify(unexplained, null, 2));
    }
    expect(unexplained).toEqual([]);
    expect(existing.skills).toHaveLength(SITEBORNE_SERVICE_IDS.length);
    expect(shadow.skills).toHaveLength(SITEBORNE_SERVICE_IDS.length);

    const summary = summarizeDifferences(differences);
    expect(summary.UNEXPLAINED_DIFFERENCE).toBe(0);
  });
});

describe('projectA2aFromVcm -- adversarial mutation detection', () => {
  async function baseline() {
    const effective = await realEightServiceEffectiveView();
    const existing = buildUnsignedSiteborneAgentCard();
    const shadow = projectA2aFromVcm(effective, realContext());
    return { existing, shadow };
  }

  it('detects a missing skill', async () => {
    const { existing, shadow } = await baseline();
    const mutated = { ...shadow, skills: shadow.skills.slice(1) };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects an extra skill', async () => {
    const { existing, shadow } = await baseline();
    const mutated = { ...shadow, skills: [...shadow.skills, shadow.skills[0]] };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects a changed service id', async () => {
    const { existing, shadow } = await baseline();
    const mutated = {
      ...shadow,
      skills: shadow.skills.map((s, i) => (i === 0 ? { ...s, id: 'mutated_id' } : s)),
    };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.some((d) => d.path === 'skills[0].id')).toBe(true);
  });

  it('detects a changed description', async () => {
    const { existing, shadow } = await baseline();
    const mutated = {
      ...shadow,
      skills: shadow.skills.map((s, i) => (i === 0 ? { ...s, description: 'mutated' } : s)),
    };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.some((d) => d.path === 'skills[0].description')).toBe(true);
  });

  it('detects a changed tag', async () => {
    const { existing, shadow } = await baseline();
    const mutated = {
      ...shadow,
      skills: shadow.skills.map((s, i) =>
        i === 0 ? { ...s, tags: [...s.tags, 'mutated_tag'] } : s
      ),
    };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects a stronger, unsupported security claim (mtls advertised without context authorization)', async () => {
    const { existing, shadow } = await baseline();
    const mutated = { ...shadow, securitySchemes: { mtls: { fabricated: true } } };
    const diff = unexplainedDifferences(compareProjections(existing, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });
});

// PRODUCTION-ECONOMICS-DISCOVERY-01: the economics block is part of the
// compared card content. The VCM projection (effective view -> canonical offer)
// and the legacy builder (canonical contract directly) must agree leaf for
// leaf, with operational facts injected identically to both.
describe('projectA2aFromVcm -- economics parity and mutation detection', () => {
  const DESTINATION: PaymentDestination = {
    network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    payTo: '0x1111111111111111111111111111111111111111',
  };
  const STATUS = { 'web_context_verified.v2': true, 'verify_agent_output.v2': true } as const;

  async function both(destination: PaymentDestination | null, status = STATUS) {
    const effective = await realEightServiceEffectiveView();
    const existing = buildUnsignedSiteborneAgentCard(status, false, destination);
    const shadow = projectA2aFromVcm(effective, realContext(status, false, destination));
    return { existing, shadow };
  }

  it.each([
    ['no destination, all disabled', null, {}],
    ['destination, all disabled', DESTINATION, {}],
    ['destination, first-release services enabled', DESTINATION, STATUS],
  ] as const)('zero unexplained differences: %s', async (_label, destination, status) => {
    const { existing, shadow } = await both(destination, status as typeof STATUS);
    expect(unexplainedDifferences(compareProjections(existing, shadow))).toEqual([]);
  });

  const mutate = async (edit: (economics: Record<string, unknown>) => void) => {
    const { existing, shadow } = await both(DESTINATION);
    const clone = JSON.parse(JSON.stringify(shadow));
    const services = clone.capabilities.extensions[0].params.services as {
      serviceId: string;
      economics: Record<string, unknown>;
    }[];
    const target = services.find((s) => s.serviceId === 'document_evidence_json.v2')!;
    edit(target.economics);
    return unexplainedDifferences(compareProjections(existing, clone)).map((d) => d.path);
  };

  it('detects a changed authorization maximum', async () => {
    const paths = await mutate((e) => (e.authorization_maximum = '0.20'));
    expect(paths.some((p) => p.endsWith('economics.authorization_maximum'))).toBe(true);
  });
  it('detects a changed tier price', async () => {
    const paths = await mutate((e) => ((e.tier_prices as { amount: string }[])[1].amount = '0.02'));
    expect(paths.some((p) => p.includes('economics.tier_prices[1].amount'))).toBe(true);
  });
  it('detects a changed document page limit', async () => {
    const paths = await mutate((e) => (e.limits = { max_document_pages: 100 }));
    expect(paths.some((p) => p.endsWith('economics.limits.max_document_pages'))).toBe(true);
  });
  it('detects a different payTo, network, or asset', async () => {
    for (const [field, value] of [
      ['pay_to', '0x2222222222222222222222222222222222222222'],
      ['network', 'eip155:84532'],
      ['asset', '0xabc'],
    ] as const) {
      const paths = await mutate((e) => ((e.payment as Record<string, string>)[field] = value));
      expect(
        paths.some((p) => p.endsWith(`economics.payment.${field}`)),
        field
      ).toBe(true);
    }
  });
  it('detects exact vs upto and a changed settlement model', async () => {
    const paths = await mutate((e) => {
      e.scheme = 'exact';
      e.actual_settlement_model = 'equals_exact_amount';
    });
    expect(paths.some((p) => p.endsWith('economics.scheme'))).toBe(true);
    expect(paths.some((p) => p.endsWith('economics.actual_settlement_model'))).toBe(true);
  });
  it('detects an unavailable mode advertised as available', async () => {
    const { existing, shadow } = await both(DESTINATION);
    const clone = JSON.parse(JSON.stringify(shadow));
    const web = clone.capabilities.extensions[0].params.services.find(
      (s: { serviceId: string }) => s.serviceId === 'web_context_verified.v2'
    );
    web.economics.available_modes = ['direct', 'rendered'];
    const paths = unexplainedDifferences(compareProjections(existing, clone)).map((d) => d.path);
    expect(paths.some((p) => p.includes('economics.available_modes'))).toBe(true);
  });
});
